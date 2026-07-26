import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobState, SourceKind, SourceRecord } from "@pige/schemas";
import type { JobExecutionControl } from "./job-execution-control";
import type { OcrSourceResult } from "./ocr-artifact-service";
import type { OcrPort, OcrSourceCapability } from "./ocr-service";

export interface ProcessQueuedOcrRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ProcessQueuedOcrResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
  readonly agentReadySourceIds: readonly string[];
}

export interface OcrSource {
  readonly path: string;
  readonly record: SourceRecord;
}

export interface OcrFailure {
  readonly final: boolean;
  readonly waiting: boolean;
  readonly message: string;
}

export interface OcrFollowUp {
  readonly agentReadySourceId?: string;
}

export interface ActiveOcrJob {
  readonly job: JobRecord;
  readonly control: JobExecutionControl;
  prepareFollowUp(result: OcrSourceResult): OcrFollowUp;
  complete(
    result: OcrSourceResult,
    state: Extract<JobState, "completed" | "completed_with_warnings">,
    message: string,
    unit: "image" | "media" | "page"
  ): JobRecord;
  fail(caught: unknown, failure: OcrFailure): OcrFollowUp;
  finish(): void;
}

export interface QueuedOcrJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly source?: OcrSource;
  failMissingSource(message: string): void;
  waitForCapability(message: string): OcrFollowUp;
  begin(abortSignal?: AbortSignal): ActiveOcrJob;
}

export interface OcrJobExecutorPort {
  queued(request: ProcessQueuedOcrRequest): readonly QueuedOcrJob[];
}

export class OcrJobExecutor {
  readonly #ocr: OcrPort | undefined;
  readonly #port: OcrJobExecutorPort;

  constructor(ocr: OcrPort | undefined, port: OcrJobExecutorPort) {
    this.#ocr = ocr;
    this.#port = port;
  }

  async process(request: ProcessQueuedOcrRequest = {}): Promise<ProcessQueuedOcrResult> {
    const queued = this.#port.queued(request);
    const agentReadySourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const candidate of queued) {
      const source = candidate.source;
      if (!source) {
        candidate.failMissingSource("Source record is missing. Preserved OCR job remains retryable.");
        failed += 1;
        continue;
      }
      const capability = inspectOcrSource(this.#ocr, source.record);
      if (!this.#ocr || !capability.ready) {
        addFollowUp(agentReadySourceIds, candidate.waitForCapability(capability.message));
        failed += 1;
        continue;
      }

      const execution = candidate.begin(request.abortSignal);
      try {
        const result = await this.#ocr.ocrSource(
          candidate.vaultPath,
          source.record,
          source.path,
          execution.job,
          execution.control
        );
        if (result.sourceId !== source.record.id) {
          throw new PigeDomainError("ocr.durable_effect_invalid", "The OCR durable effect does not match the selected source identity.");
        }
        addFollowUp(agentReadySourceIds, execution.prepareFollowUp(result));
        const hasWarnings = !result.agentTextReady || result.sourcePageConflict || result.warnings.length > 0;
        const completedJob = execution.complete(
          result,
          hasWarnings ? "completed_with_warnings" : "completed",
          createOcrCompletionMessage(result, source.record.kind),
          source.record.kind === "pdf_file" ? "page" : source.record.kind === "pptx_file" ? "media" : "image"
        );
        if (completedJob.state === "cancelled") failed += 1;
        else completed += 1;
      } catch (caught) {
        addFollowUp(agentReadySourceIds, execution.fail(caught, ocrFailure(caught, source.record.kind)));
        failed += 1;
      } finally {
        execution.finish();
      }
    }

    return { processed: queued.length, completed, failed, agentReadySourceIds };
  }
}

function addFollowUp(target: string[], followUp: OcrFollowUp): void {
  const sourceId = followUp.agentReadySourceId;
  if (sourceId && !target.includes(sourceId)) target.push(sourceId);
}

function inspectOcrSource(ocr: OcrPort | undefined, sourceRecord: SourceRecord): OcrSourceCapability {
  if (!ocr) return { ready: false, message: createOcrDependencyMessage(sourceRecord.kind) };
  if (ocr.inspectSource) return ocr.inspectSource(sourceRecord);
  return ocr.canOcr(sourceRecord.kind)
    ? { ready: true, message: `${documentLabel(sourceRecord.kind)} local OCR job queued.` }
    : { ready: false, message: createOcrDependencyMessage(sourceRecord.kind) };
}

function createOcrCompletionMessage(result: OcrSourceResult, sourceKind: SourceKind): string {
  const label = sourceKind === "pdf_file" ? "PDF page OCR" : sourceKind === "pptx_file" ? "PPTX media OCR" : "Image OCR";
  if (result.sourcePageConflict) return `${label} completed; the edited source page was preserved and requires review before refresh.`;
  if (!result.agentTextReady) return `${label} completed without readable text. The preserved source remains available.`;
  if (sourceKind === "pdf_file" && result.textCharacterCount === 0) {
    return "PDF page OCR enrichment completed without additional text; verified native PDF text remains ready for Agent ingest.";
  }
  return `${label} extracted ${result.textCharacterCount} characters${result.confidence !== undefined ? ` at confidence ${result.confidence.toFixed(3)}` : ""}.`;
}

function createOcrDependencyMessage(sourceKind: SourceKind): string {
  if (sourceKind === "image_file") return "Image source preserved; waiting for local OCR capability from a healthy platform helper.";
  return `${documentLabel(sourceKind)} OCR is waiting for a reviewed page, slide, or media pixel materializer.`;
}

function ocrFailure(caught: unknown, sourceKind: SourceKind): OcrFailure {
  const label = documentLabel(sourceKind);
  if (caught instanceof PigeDomainError) {
    if (/^ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)$/u.test(caught.code) || caught.code === "parser.pdf_page_renderer.unavailable" || caught.code === "ocr.pptx.target_not_ready") {
      return { final: false, waiting: true, message: `Waiting for a healthy local OCR capability before retrying this preserved ${label}.` };
    }
    if (caught.code === "source.external_unavailable") return { final: false, waiting: true, message: `Waiting for the referenced original ${label} to be reconnected before local OCR can continue.` };
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be processed safely in its current form. Re-import it to create a verified source version.` };
    }
    if (/^parser\.pdf_page_renderer\.(?:invalid_request|invalid_page|file_too_large|password_required|invalid_pdf|page_out_of_range)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The preserved PDF cannot be rendered safely for OCR in its current form. Re-import or replace it with a supported PDF." };
    }
    if (/^ocr\.pdf\.(?:parser_metadata_invalid|source_record_invalid|render_result_invalid|rendered_page_invalid|rendered_pages_too_large|result_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The verified PDF OCR target or derived page data failed validation. Re-parse or re-import the preserved PDF before retrying." };
    }
    if (/^ocr\.pptx\.(?:parser_metadata_invalid|source_record_invalid|media_target_invalid|media_target_changed|materializer_result_invalid|result_invalid|invalid_archive|duplicate_entry|expanded_too_large|media_too_large)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The verified PPTX OCR target or embedded media failed validation. Re-parse or re-import the preserved presentation before retrying." };
    }
    if (sourceKind === "pptx_file" && isDeterministicParserInputFailure(caught.code)) {
      return { final: true, waiting: false, message: "The preserved PPTX media cannot be materialized safely. Re-import it to create a verified source version." };
    }
    if (/^ocr\.(?:source_checksum_mismatch|source_unavailable|source_unsupported|path_outside_vault|image\.(?:source_missing|not_regular|file_too_large|invalid|unsupported_format|multiframe_unsupported|dimensions_invalid|dimensions_too_large|decode_failed))$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be processed safely in its current form. Re-import it to create a verified source version.` };
    }
  }
  return { final: false, waiting: false, message: `Local OCR failed for this ${label}. The preserved source and validated artifacts remain retryable.` };
}

function isDeterministicParserInputFailure(code: string): boolean {
  return /^(?:parser\.(?:pdf|docx|pptx)\.(?:file_too_large|invalid|invalid_archive|invalid_output|required_part_missing|too_many_entries|duplicate_entry|duplicate_relationship|unsafe_entry|unsafe_relationship|invalid_entry_size|encrypted|unsupported_compression|entry_too_large|expanded_too_large|suspicious_compression|xml_part_too_large|selected_xml_too_large|doctype_not_allowed|invalid_xml)|parser\.(?:path_outside_vault|source_unavailable))$/u.test(code);
}

function documentLabel(sourceKind: SourceKind): string {
  if (sourceKind === "pdf_file") return "PDF";
  if (sourceKind === "pptx_file") return "PPTX";
  return "image";
}
