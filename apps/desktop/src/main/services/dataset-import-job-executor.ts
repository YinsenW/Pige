import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobState, SourceRecord } from "@pige/schemas";
import type {
  DatasetMaterializationResult,
  DatasetMaterializerPort
} from "./dataset-service";
import type { JobExecutionControl } from "./job-execution-control";

export interface ProcessQueuedDatasetImportsRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ProcessQueuedDatasetImportsResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface DatasetImportSource {
  readonly path: string;
  readonly record: SourceRecord;
}

export interface DatasetImportFailure {
  readonly final: boolean;
  readonly waiting: boolean;
  readonly message: string;
}

export interface ActiveDatasetImportJob {
  readonly job: JobRecord;
  readonly control: JobExecutionControl;
  patchOutput(result: DatasetMaterializationResult): void;
  appendActivity(message: string): void;
  complete(
    state: Extract<JobState, "completed" | "completed_with_warnings">,
    message: string,
    operationIds: readonly string[]
  ): JobRecord;
  fail(caught: unknown, failure: DatasetImportFailure): void;
  finish(): void;
}

export interface QueuedDatasetImportJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  readonly source?: DatasetImportSource;
  failMissingSource(message: string): void;
  waitForMaterializer(message: string): void;
  begin(abortSignal?: AbortSignal): ActiveDatasetImportJob;
}

export interface DatasetImportJobExecutorPort {
  queued(request: ProcessQueuedDatasetImportsRequest): readonly QueuedDatasetImportJob[];
}

export class DatasetImportJobExecutor {
  readonly #datasets: DatasetMaterializerPort | undefined;
  readonly #port: DatasetImportJobExecutorPort;

  constructor(datasets: DatasetMaterializerPort | undefined, port: DatasetImportJobExecutorPort) {
    this.#datasets = datasets;
    this.#port = port;
  }

  async process(
    request: ProcessQueuedDatasetImportsRequest = {}
  ): Promise<ProcessQueuedDatasetImportsResult> {
    const queued = this.#port.queued(request);
    let completed = 0;
    let failed = 0;

    for (const candidate of queued) {
      const source = candidate.source;
      if (!source) {
        candidate.failMissingSource(
          "Source record is missing. Preserved Dataset import remains retryable."
        );
        failed += 1;
        continue;
      }
      const datasets = this.#datasets;
      if (!datasets || !datasets.canMaterialize(source.record.kind)) {
        candidate.waitForMaterializer(
          "Waiting for the bundled local Dataset materialization capability."
        );
        failed += 1;
        continue;
      }

      const execution = candidate.begin(request.abortSignal);
      try {
        execution.control.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "dataset" });
        const result = await datasets.materializeSource(
          candidate.vaultPath,
          source.record,
          source.path,
          execution.job,
          execution.control
        );
        execution.patchOutput(result);
        execution.appendActivity(
          `${new Date().toISOString()} Materialized Dataset \`${result.datasetId}\` revision \`${result.revisionId}\` from source \`${source.record.id}\`: ${result.tableCount} tables, ${result.rowCount} rows.`
        );
        const completedJob = execution.complete(
          result.warnings.length > 0 ? "completed_with_warnings" : "completed",
          `Materialized Dataset revision with ${result.tableCount} table${result.tableCount === 1 ? "" : "s"} and ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`,
          result.operationIds
        );
        if (completedJob.state === "cancelled") failed += 1;
        else completed += 1;
      } catch (caught) {
        execution.fail(caught, datasetImportFailure(caught));
        failed += 1;
      } finally {
        execution.finish();
      }
    }

    return { processed: queued.length, completed, failed };
  }
}

function datasetImportFailure(caught: unknown): DatasetImportFailure {
  if (caught instanceof PigeDomainError) {
    if (caught.code === "source.external_unavailable") {
      return {
        final: false,
        waiting: true,
        message: "The referenced structured source is unavailable. Reconnect it before retrying Dataset materialization."
      };
    }
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return {
        final: true,
        waiting: false,
        message: "The preserved structured source cannot be verified safely. Re-import it to create a new source version."
      };
    }
    if (
      /^dataset\.ingest\.(?:csv|xlsx|sqlite|limit)\./u.test(caught.code) ||
      /^dataset\.(?:import\.(?:invalid|unsupported|source_changed)|path_(?:invalid|unsafe)|identity_conflict|operation_conflict)$/u.test(caught.code)
    ) {
      return {
        final: true,
        waiting: false,
        message: "The preserved structured source cannot be materialized safely within current Dataset bounds. Original evidence remains available."
      };
    }
  }
  return {
    final: false,
    waiting: false,
    message: "Dataset materialization failed. Preserved source and validated immutable outputs remain retryable."
  };
}
