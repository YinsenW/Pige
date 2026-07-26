import type { JobRecord, SourceKind, SourceRecord } from "@pige/schemas";
import type { AgentIngestResult, AgentIngestService } from "./agent-ingest-service";
import type { OcrPort } from "./ocr-service";

export interface ProcessQueuedAgentIngestRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
}

export interface ProcessQueuedAgentIngestResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface LegacyAgentIngestSource {
  readonly path: string;
  readonly record: SourceRecord;
}

export interface ActiveLegacyAgentIngestJob {
  readonly job: JobRecord;
  readonly hooks: Parameters<AgentIngestService["ingestSource"]>[3];
  settle(result: AgentIngestResult): boolean;
  fail(caught: unknown): "completed" | "failed";
  finish(): void;
}

export interface QueuedLegacyAgentIngestJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly source?: LegacyAgentIngestSource;
  waitForModel(): void;
  failMissingSource(): void;
  waitForOcr(message: string): void;
  begin(): ActiveLegacyAgentIngestJob;
}

export interface LegacyAgentIngestJobExecutorPort {
  queued(request: ProcessQueuedAgentIngestRequest): readonly QueuedLegacyAgentIngestJob[];
}

export class LegacyAgentIngestJobExecutor {
  readonly #agentIngest: AgentIngestService | undefined;
  readonly #ocr: OcrPort | undefined;
  readonly #port: LegacyAgentIngestJobExecutorPort;

  constructor(
    agentIngest: AgentIngestService | undefined,
    ocr: OcrPort | undefined,
    port: LegacyAgentIngestJobExecutorPort
  ) {
    this.#agentIngest = agentIngest;
    this.#ocr = ocr;
    this.#port = port;
  }

  async process(
    request: ProcessQueuedAgentIngestRequest = {}
  ): Promise<ProcessQueuedAgentIngestResult> {
    const queued = this.#port.queued(request);
    let completed = 0;
    let failed = 0;

    for (const candidate of queued) {
      const agentIngest = this.#agentIngest;
      if (!agentIngest) {
        candidate.waitForModel();
        failed += 1;
        continue;
      }
      const source = candidate.source;
      if (!source) {
        candidate.failMissingSource();
        failed += 1;
        continue;
      }
      if (!supportsAgentSelectedOcr(source.record.kind) && shouldWaitForRunnableOcr(this.#ocr, source.record)) {
        candidate.waitForOcr(createAgentOcrWaitMessage(source.record));
        failed += 1;
        continue;
      }

      const execution = candidate.begin();
      try {
        const result = await agentIngest.ingestSource(
          candidate.vaultPath,
          source.record,
          execution.job,
          execution.hooks
        );
        if (execution.settle(result)) completed += 1;
        else failed += 1;
      } catch (caught) {
        if (execution.fail(caught) === "completed") completed += 1;
        else failed += 1;
      } finally {
        execution.finish();
      }
    }

    return { processed: queued.length, completed, failed };
  }
}

function supportsAgentSelectedOcr(sourceKind: SourceKind): boolean {
  return sourceKind === "image_file" || sourceKind === "pdf_file" || sourceKind === "pptx_file";
}

function shouldWaitForRunnableOcr(ocr: OcrPort | undefined, sourceRecord: SourceRecord): boolean {
  if (sourceRecord.metadata.needsOcr !== true) return false;
  if (sourceRecord.metadata.agentTextReady !== true) return true;
  if (!ocr) return false;
  if (ocr.inspectSource) return ocr.inspectSource(sourceRecord).ready;
  return ocr.canOcr(sourceRecord.kind);
}

function createAgentOcrWaitMessage(sourceRecord: SourceRecord): string {
  const label = documentLabel(sourceRecord.kind);
  return sourceRecord.metadata.agentTextReady === true
    ? `Waiting for selected ${label} OCR enrichment before Agent ingest.`
    : `Waiting for readable ${label} OCR evidence before Agent ingest.`;
}

function documentLabel(sourceKind: SourceKind): string {
  if (sourceKind === "docx_file") return "DOCX";
  if (sourceKind === "pptx_file") return "PPTX";
  return "PDF";
}
