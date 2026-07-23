import type { LocalDatabaseRebuildResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobState } from "@pige/schemas";
import type { JobExecutionControl } from "./job-execution-control";
import type { LocalDatabaseRebuildExecutionOptions } from "./local-database-rebuild-types";

export interface ProcessQueuedIndexRebuildRequest {
  readonly jobIds?: readonly string[];
  readonly limit?: number;
}

export interface ProcessQueuedIndexRebuildResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
  readonly lastRebuild?: LocalDatabaseRebuildResult;
}

export interface IndexRebuildExecutionBinding {
  readonly vaultPath: string;
}

export interface ActiveIndexRebuildJob {
  readonly job: JobRecord;
  readonly control: JobExecutionControl;
  complete(
    state: Extract<JobState, "completed" | "completed_with_warnings">,
    message: string
  ): JobRecord;
  fail(caught: unknown, message: string): void;
  finish(): void;
}

export interface QueuedIndexRebuildJob {
  readonly job: JobRecord;
  readonly vaultPath: string;
  waitForDatabase(message: string): void;
  begin(): ActiveIndexRebuildJob;
}

export interface IndexRebuildJobExecutorPort {
  bind(): IndexRebuildExecutionBinding;
  createJob(binding: IndexRebuildExecutionBinding): JobRecord;
  queued(
    binding: IndexRebuildExecutionBinding,
    request: ProcessQueuedIndexRebuildRequest
  ): readonly QueuedIndexRebuildJob[];
  appendActivity(vaultPath: string, message: string): void;
}

export interface IndexRebuildDatabasePort {
  rebuildInWorker(
    vaultPath: string,
    options?: LocalDatabaseRebuildExecutionOptions
  ): Promise<LocalDatabaseRebuildResult>;
}

export class IndexRebuildJobExecutor {
  readonly #database: IndexRebuildDatabasePort | undefined;
  readonly #port: IndexRebuildJobExecutorPort;
  #tail: Promise<void> = Promise.resolve();

  constructor(database: IndexRebuildDatabasePort | undefined, port: IndexRebuildJobExecutorPort) {
    this.#database = database;
    this.#port = port;
  }

  async request(): Promise<LocalDatabaseRebuildResult> {
    const binding = this.#port.bind();
    const job = this.#port.createJob(binding);
    const result = await this.#enqueue(binding, { jobIds: [job.id] });
    if (!result.lastRebuild) {
      throw new PigeDomainError("index_rebuild_failed", "Index rebuild failed. The job remains retryable.");
    }
    return result.lastRebuild;
  }

  async process(
    request: ProcessQueuedIndexRebuildRequest = {}
  ): Promise<ProcessQueuedIndexRebuildResult> {
    return this.#enqueue(this.#port.bind(), request);
  }

  #enqueue(
    binding: IndexRebuildExecutionBinding,
    request: ProcessQueuedIndexRebuildRequest
  ): Promise<ProcessQueuedIndexRebuildResult> {
    const next = this.#tail.then(() => this.#process(binding, request));
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }

  async #process(
    binding: IndexRebuildExecutionBinding,
    request: ProcessQueuedIndexRebuildRequest
  ): Promise<ProcessQueuedIndexRebuildResult> {
    const queued = this.#port.queued(binding, request);
    let completed = 0;
    let failed = 0;
    let lastRebuild: LocalDatabaseRebuildResult | undefined;

    for (const candidate of queued) {
      const database = this.#database;
      if (!database) {
        candidate.waitForDatabase("Waiting for the Local Database Service before index rebuild.");
        failed += 1;
        continue;
      }

      const execution = candidate.begin();
      try {
        const rebuild = await database.rebuildInWorker(candidate.vaultPath, {
          signal: execution.control.signal,
          onProgress: (progress) => execution.control.reportProgress(progress)
        });
        execution.control.throwIfCancellationRequested();
        let completionState: Extract<JobState, "completed" | "completed_with_warnings"> = "completed";
        let message = `Index rebuilt from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`;
        try {
          this.#port.appendActivity(
            candidate.vaultPath,
            `${new Date().toISOString()} Rebuilt local database index from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`
          );
        } catch {
          completionState = "completed_with_warnings";
          message = `${message} Local activity log update needs repair.`;
        }
        const completedJob = execution.complete(completionState, message);
        if (completedJob.state === "cancelled") {
          failed += 1;
          continue;
        }
        lastRebuild = { ...rebuild, jobId: execution.job.id, state: completedJob.state };
        completed += 1;
      } catch (caught) {
        execution.fail(
          caught,
          "Index rebuild failed. Markdown knowledge and the previous committed index remain intact; the job is retryable."
        );
        failed += 1;
      } finally {
        execution.finish();
      }
    }

    return {
      processed: queued.length,
      completed,
      failed,
      ...(lastRebuild ? { lastRebuild } : {})
    };
  }
}
