import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobState, SourceRecord } from "@pige/schemas";
import type { DocumentParserPort } from "./document-parser-service";
import type { JobExecutionControl } from "./job-execution-control";
import type { DocumentParseSourceResult } from "./parser-artifact-service";

export interface ProcessQueuedParsesRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ProcessQueuedParsesResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
  readonly agentReadySourceIds: readonly string[];
  readonly ocrWaitingSourceIds: readonly string[];
}

export interface DocumentParseSource {
  readonly path: string;
  readonly record: SourceRecord;
}

export interface DocumentParseFailure {
  readonly final: boolean;
  readonly waiting: boolean;
  readonly message: string;
}

export interface DocumentParseFollowUp {
  readonly agentReadySourceId?: string;
  readonly ocrWaitingSourceId?: string;
}

export interface ActiveDocumentParseJob {
  readonly job: JobRecord;
  readonly control: JobExecutionControl;
  prepareFollowUp(result: DocumentParseSourceResult): DocumentParseFollowUp;
  complete(
    result: DocumentParseSourceResult,
    state: Extract<JobState, "completed" | "completed_with_warnings">,
    message: string
  ): JobRecord;
  fail(caught: unknown, failure: DocumentParseFailure): void;
  finish(): void;
}

export interface QueuedDocumentParseJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly source?: DocumentParseSource;
  failMissingSource(message: string): void;
  waitForParser(message: string): void;
  begin(abortSignal?: AbortSignal): ActiveDocumentParseJob;
}

export interface DocumentParseJobExecutorPort {
  queued(request: ProcessQueuedParsesRequest): readonly QueuedDocumentParseJob[];
}

export class DocumentParseJobExecutor {
  readonly #parser: DocumentParserPort | undefined;
  readonly #port: DocumentParseJobExecutorPort;

  constructor(parser: DocumentParserPort | undefined, port: DocumentParseJobExecutorPort) {
    this.#parser = parser;
    this.#port = port;
  }

  async process(request: ProcessQueuedParsesRequest = {}): Promise<ProcessQueuedParsesResult> {
    const queued = this.#port.queued(request);
    const agentReadySourceIds: string[] = [];
    const ocrWaitingSourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const candidate of queued) {
      const source = candidate.source;
      if (!source) {
        candidate.failMissingSource("Source record is missing. Preserved parse job remains retryable.");
        failed += 1;
        continue;
      }
      const parser = this.#parser;
      if (!parser || !parser.canParse(source.record.kind)) {
        candidate.waitForParser("Waiting for a bundled local parser that supports this document type.");
        failed += 1;
        continue;
      }

      const execution = candidate.begin(request.abortSignal);
      try {
        execution.control.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "document" });
        const result = await parser.parseSource(
          candidate.vaultPath,
          source.record,
          source.path,
          execution.job,
          execution.control
        );
        const hasWarnings = result.needsOcr || result.sourcePageConflict || result.warnings.length > 0;
        const followUp = execution.prepareFollowUp(result);
        if (followUp.agentReadySourceId) agentReadySourceIds.push(followUp.agentReadySourceId);
        if (followUp.ocrWaitingSourceId) ocrWaitingSourceIds.push(followUp.ocrWaitingSourceId);
        const completedJob = execution.complete(
          result,
          hasWarnings ? "completed_with_warnings" : "completed",
          createParseCompletionMessage(result, source.record.kind)
        );
        if (completedJob.state === "cancelled") {
          failed += 1;
        } else {
          completed += 1;
        }
      } catch (caught) {
        execution.fail(caught, parseFailure(caught, source.record.kind));
        failed += 1;
      } finally {
        execution.finish();
      }
    }

    return { processed: queued.length, completed, failed, agentReadySourceIds, ocrWaitingSourceIds };
  }
}

function createParseCompletionMessage(
  result: Pick<DocumentParseSourceResult, "textCharacterCount" | "textCoverage" | "needsOcr" | "agentTextReady" | "sourcePageConflict">,
  sourceKind: SourceRecord["kind"]
): string {
  const label = documentLabel(sourceKind);
  if (result.sourcePageConflict) {
    return `${label} text extracted; the edited source page was preserved and requires review before refresh.`;
  }
  if (!result.agentTextReady) {
    return `${label} parser found insufficient embedded text; waiting for OCR before Agent ingest.`;
  }
  if (result.needsOcr) {
    return `${label} text extracted (${result.textCharacterCount} characters, ${result.textCoverage} coverage); image-heavy or text-sparse content is waiting for OCR enrichment.`;
  }
  return `${label} text extracted (${result.textCharacterCount} characters, ${result.textCoverage} coverage).`;
}

function parseFailure(caught: unknown, sourceKind: SourceRecord["kind"]): DocumentParseFailure {
  const label = documentLabel(sourceKind);
  if (caught instanceof PigeDomainError) {
    if (caught.code === "parser.pdf.password_required") {
      return { final: true, waiting: false, message: "Encrypted PDF requires a password. The preserved source remains available, but password input is not supported yet." };
    }
    if (caught.code === "parser.docx.encrypted" || caught.code === "parser.pptx.encrypted") {
      return { final: true, waiting: false, message: `Encrypted ${label} files are not supported. The preserved source remains available.` };
    }
    if (isDeterministicParserInputFailure(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be parsed safely in its current form. The source record and original bytes remain available.` };
    }
    if (caught.code === "parser.source_checksum_mismatch") {
      return { final: true, waiting: false, message: `The preserved ${label} changed after capture. Re-import it to create a verified source version.` };
    }
    if (caught.code === "source.external_unavailable") {
      return { final: false, waiting: true, message: `The referenced original ${label} is unavailable. Reconnect it before retrying this job.` };
    }
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be verified safely. Re-import it to create a new source version.` };
    }
  }
  return { final: false, waiting: false, message: `${label} parsing failed. Preserved source and validated partial artifacts remain retryable.` };
}

function isDeterministicParserInputFailure(code: string): boolean {
  return /^(?:parser\.(?:pdf|docx|pptx)\.(?:file_too_large|invalid|invalid_archive|invalid_output|required_part_missing|too_many_entries|duplicate_entry|duplicate_relationship|unsafe_entry|unsafe_relationship|invalid_entry_size|encrypted|unsupported_compression|entry_too_large|expanded_too_large|suspicious_compression|xml_part_too_large|selected_xml_too_large|doctype_not_allowed|invalid_xml)|parser\.(?:path_outside_vault|source_unavailable))$/u.test(code);
}

function documentLabel(sourceKind: SourceRecord["kind"]): string {
  if (sourceKind === "docx_file") return "DOCX";
  if (sourceKind === "pptx_file") return "PPTX";
  return "PDF";
}
