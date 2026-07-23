import { describe, expect, it, vi } from "vitest";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import type { JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";
import {
  IndexRebuildJobExecutor,
  type ActiveIndexRebuildJob,
  type IndexRebuildDatabasePort,
  type QueuedIndexRebuildJob
} from "../../apps/desktop/src/main/services/index-rebuild-job-executor";

describe("IndexRebuildJobExecutor", () => {
  it("owns worker progress, durable completion and vault-bound activity", async () => {
    const fixture = makeQueuedJob("job_20260723_index0001", "/vault-a");
    const rebuildInWorker = vi.fn<IndexRebuildDatabasePort["rebuildInWorker"]>(
      async (_vaultPath, options) => {
        options?.onProgress?.({ completedUnits: 2, totalUnits: 3, unit: "index_item" });
        return {
          rebuiltAt: "2026-07-23T03:00:00.000Z",
          pageCount: 4,
          invalidPageCount: 1
        };
      }
    );
    const appendActivity = vi.fn();
    const executor = new IndexRebuildJobExecutor({ rebuildInWorker }, {
      bind: () => ({ vaultPath: "/vault-a" }),
      createJob: () => fixture.job,
      queued: () => [fixture.candidate],
      appendActivity
    });

    const result = await executor.process();

    expect(rebuildInWorker).toHaveBeenCalledWith("/vault-a", expect.objectContaining({
      signal: fixture.control.signal,
      onProgress: expect.any(Function)
    }));
    expect(fixture.reportProgress).toHaveBeenCalledWith({
      completedUnits: 2,
      totalUnits: 3,
      unit: "index_item"
    });
    expect(appendActivity).toHaveBeenCalledWith("/vault-a", expect.stringContaining(
      "Rebuilt local database index from Markdown: 4 pages, 1 invalid pages skipped."
    ));
    expect(fixture.complete).toHaveBeenCalledWith("completed", expect.stringContaining("4 pages"));
    expect(fixture.finish).toHaveBeenCalledOnce();
    expect(result).toEqual({
      processed: 1,
      completed: 1,
      failed: 0,
      lastRebuild: {
        rebuiltAt: "2026-07-23T03:00:00.000Z",
        pageCount: 4,
        invalidPageCount: 1,
        jobId: fixture.job.id,
        state: "completed"
      }
    });
  });

  it("keeps a queued job waiting when the local database capability is unavailable", async () => {
    const fixture = makeQueuedJob("job_20260723_index0002", "/vault-b");
    const executor = new IndexRebuildJobExecutor(undefined, {
      bind: () => ({ vaultPath: "/vault-b" }),
      createJob: () => fixture.job,
      queued: () => [fixture.candidate],
      appendActivity: vi.fn()
    });

    await expect(executor.process()).resolves.toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(fixture.waitForDatabase).toHaveBeenCalledWith(
      "Waiting for the Local Database Service before index rebuild."
    );
    expect(fixture.begin).not.toHaveBeenCalled();
  });

  it("serializes concurrent process requests through one executor-owned worker tail", async () => {
    const fixtures = [
      makeQueuedJob("job_20260723_index0003", "/vault-c"),
      makeQueuedJob("job_20260723_index0004", "/vault-c")
    ];
    let queuedCall = 0;
    let active = 0;
    let maxActive = 0;
    const rebuildInWorker = vi.fn<IndexRebuildDatabasePort["rebuildInWorker"]>(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        rebuiltAt: "2026-07-23T03:00:00.000Z",
        pageCount: 0,
        invalidPageCount: 0
      };
    });
    const executor = new IndexRebuildJobExecutor({ rebuildInWorker }, {
      bind: () => ({ vaultPath: "/vault-c" }),
      createJob: () => fixtures[0].job,
      queued: () => [fixtures[queuedCall++]!.candidate],
      appendActivity: vi.fn()
    });

    const results = await Promise.all([executor.process(), executor.process()]);

    expect(maxActive).toBe(1);
    expect(results.map((result) => result.completed)).toEqual([1, 1]);
    expect(rebuildInWorker).toHaveBeenCalledTimes(2);
  });

  it("freezes each queued request binding before it enters the worker tail", async () => {
    const fixtures = [
      makeQueuedJob("job_20260723_index0006", "/vault-a"),
      makeQueuedJob("job_20260723_index0007", "/vault-a")
    ];
    let activeVaultPath = "/vault-a";
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let rebuildCall = 0;
    const queued = vi.fn((_binding: { readonly vaultPath: string }) => [
      fixtures[rebuildCall]!.candidate
    ]);
    const executor = new IndexRebuildJobExecutor({
      rebuildInWorker: async () => {
        rebuildCall += 1;
        if (rebuildCall === 1) await firstBlocked;
        return {
          rebuiltAt: "2026-07-23T03:00:00.000Z",
          pageCount: 0,
          invalidPageCount: 0
        };
      }
    }, {
      bind: () => ({ vaultPath: activeVaultPath }),
      createJob: () => fixtures[0].job,
      queued,
      appendActivity: vi.fn()
    });

    const first = executor.process();
    const second = executor.process();
    activeVaultPath = "/vault-b";
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(queued.mock.calls.map(([binding]) => binding.vaultPath)).toEqual([
      "/vault-a",
      "/vault-a"
    ]);
  });

  it("delegates exact durable failure settlement and always releases execution ownership", async () => {
    const fixture = makeQueuedJob("job_20260723_index0005", "/vault-d");
    const failure = new Error("synthetic worker failure");
    const executor = new IndexRebuildJobExecutor({
      rebuildInWorker: async () => { throw failure; }
    }, {
      bind: () => ({ vaultPath: "/vault-d" }),
      createJob: () => fixture.job,
      queued: () => [fixture.candidate],
      appendActivity: vi.fn()
    });

    await expect(executor.process()).resolves.toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(fixture.fail).toHaveBeenCalledWith(
      failure,
      "Index rebuild failed. Markdown knowledge and the previous committed index remain intact; the job is retryable."
    );
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

});

function makeQueuedJob(jobId: string, vaultPath: string): {
  readonly job: JobRecord;
  readonly candidate: QueuedIndexRebuildJob;
  readonly control: JobExecutionControl;
  readonly reportProgress: ReturnType<typeof vi.fn>;
  readonly complete: ReturnType<typeof vi.fn>;
  readonly fail: ReturnType<typeof vi.fn>;
  readonly finish: ReturnType<typeof vi.fn>;
  readonly waitForDatabase: ReturnType<typeof vi.fn>;
  readonly begin: ReturnType<typeof vi.fn>;
} {
  const job = JobRecordSchema.parse({
    schemaVersion: 1,
    id: jobId,
    class: "index_rebuild",
    state: "queued",
    createdAt: "2026-07-23T03:00:00.000Z",
    updatedAt: "2026-07-23T03:00:00.000Z",
    message: "Queued."
  });
  const controller = new AbortController();
  const reportProgress = vi.fn();
  const control: JobExecutionControl = {
    signal: controller.signal,
    throwIfCancellationRequested: vi.fn(),
    reportProgress,
    markDurableCheckpoint: vi.fn(),
    durableWriteState: () => ({ durableWritesApplied: false })
  };
  const complete = vi.fn((state: "completed" | "completed_with_warnings", message: string) => ({
    ...job,
    state,
    message
  }));
  const fail = vi.fn();
  const finish = vi.fn();
  const active: ActiveIndexRebuildJob = { job, control, complete, fail, finish };
  const waitForDatabase = vi.fn();
  const begin = vi.fn(() => active);
  return {
    job,
    candidate: { job, vaultPath, waitForDatabase, begin },
    control,
    reportProgress,
    complete,
    fail,
    finish,
    waitForDatabase,
    begin
  };
}
