import { PigeDomainError } from "@pige/domain";
import type { JobRecord, SourceRecord } from "@pige/schemas";
import type { JobExecutionControl } from "./job-execution-control";
import type { SourcePagePublicationResult, SourcePageService } from "./source-page-service";

export interface ProcessQueuedCapturesRequest {
  readonly jobIds?: readonly string[];
  readonly limit?: number;
}

export interface ProcessQueuedCapturesResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface CaptureSource {
  readonly path: string;
  readonly record: SourceRecord;
}

export interface ActiveCaptureJob {
  readonly job: JobRecord;
  readonly control: JobExecutionControl;
  prepareFollowUp(result: SourcePagePublicationResult): void;
  complete(result: SourcePagePublicationResult): JobRecord;
  fail(caught: unknown, message: string): void;
}

export interface QueuedCaptureJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly source?: CaptureSource;
  failMissingSource(message: string): void;
  begin(): ActiveCaptureJob;
}

export interface CaptureJobExecutorPort {
  queued(request: ProcessQueuedCapturesRequest): readonly QueuedCaptureJob[];
}

export class CaptureJobExecutor {
  readonly #sourcePages: SourcePageService;
  readonly #port: CaptureJobExecutorPort;

  constructor(sourcePages: SourcePageService, port: CaptureJobExecutorPort) {
    this.#sourcePages = sourcePages;
    this.#port = port;
  }

  process(request: ProcessQueuedCapturesRequest = {}): ProcessQueuedCapturesResult {
    const queued = this.#port.queued(request);
    let completed = 0;
    let failed = 0;

    for (const candidate of queued) {
      const source = candidate.source;
      if (!source) {
        candidate.failMissingSource("Source record is missing. Preserved job remains retryable.");
        failed += 1;
        continue;
      }

      let execution: ActiveCaptureJob;
      try {
        execution = candidate.begin();
      } catch (caught) {
        if (!isJobMutationContention(caught)) throw caught;
        failed += 1;
        continue;
      }
      try {
        const result = this.#sourcePages.createForSource(
          candidate.vaultPath,
          source.record,
          source.path,
          execution.job.id,
          source.record,
          {
            onPublicationStart: () => execution.control.markDurableCheckpoint(
              "capture_source_page_publication_started"
            )
          }
        );
        if (result.sourceId !== source.record.id) {
          throw new PigeDomainError(
            "capture.durable_effect_invalid",
            "The Capture durable effect does not match the selected source identity."
          );
        }
        execution.prepareFollowUp(result);
        const completedJob = execution.complete(result);
        if (completedJob.state === "cancelled") failed += 1;
        else completed += 1;
      } catch (caught) {
        execution.fail(
          caught,
          "Source page creation failed. Preserved source remains retryable."
        );
        failed += 1;
      }
    }

    return { processed: queued.length, completed, failed };
  }
}

function isJobMutationContention(value: unknown): boolean {
  return value instanceof PigeDomainError && new Set([
    "job.revision_conflict",
    "job.claim_conflict",
    "job.claim_lost"
  ]).has(value.code);
}
