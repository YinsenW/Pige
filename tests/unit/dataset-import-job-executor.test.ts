import { describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import type { DatasetMaterializerPort } from "../../apps/desktop/src/main/services/dataset-service";
import {
  DatasetImportJobExecutor,
  type ActiveDatasetImportJob,
  type QueuedDatasetImportJob
} from "../../apps/desktop/src/main/services/dataset-import-job-executor";
import type { JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";

describe("DatasetImportJobExecutor", () => {
  it("owns materialization, output projection, activity and durable completion", async () => {
    const fixture = makeQueuedDatasetJob();
    const materializeSource = vi.fn<DatasetMaterializerPort["materializeSource"]>(async () => ({
      sourceRecord: fixture.source,
      created: true,
      datasetId: "dataset_20260723_abcdef12",
      revisionId: "datasetrev_20260723_abcdef12",
      tableCount: 2,
      rowCount: 7,
      warnings: [],
      operationIds: ["op_20260723_dataset01"]
    }));
    const executor = new DatasetImportJobExecutor({
      canMaterialize: () => true,
      materializeSource
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(materializeSource).toHaveBeenCalledWith(
      "/vault-a",
      fixture.source,
      "/vault-a/.pige/source-records/source.json",
      fixture.job,
      fixture.control
    );
    expect(fixture.appendActivity).toHaveBeenCalledWith(expect.stringContaining("2 tables, 7 rows"));
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: "dataset_20260723_abcdef12",
        revisionId: "datasetrev_20260723_abcdef12"
      }),
      "completed",
      "Materialized Dataset revision with 2 tables and 7 rows."
    );
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("settles missing sources and unavailable materializers before execution", async () => {
    const missing = makeQueuedDatasetJob({ source: false });
    const unavailable = makeQueuedDatasetJob();
    let queuedCall = 0;
    const executor = new DatasetImportJobExecutor(undefined, {
      queued: () => queuedCall++ === 0 ? [missing.candidate] : [unavailable.candidate]
    });

    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    expect(missing.failMissingSource).toHaveBeenCalledWith(
      "Source record is missing. Preserved Dataset import remains retryable."
    );
    expect(unavailable.waitForMaterializer).toHaveBeenCalledWith(
      "Waiting for the bundled local Dataset materialization capability."
    );
    expect(missing.begin).not.toHaveBeenCalled();
    expect(unavailable.begin).not.toHaveBeenCalled();
  });

  it("delegates typed failure settlement and always releases execution ownership", async () => {
    const fixture = makeQueuedDatasetJob();
    const failure = new PigeDomainError("dataset.import.invalid", "synthetic private detail");
    const executor = new DatasetImportJobExecutor({
      canMaterialize: () => true,
      materializeSource: async () => { throw failure; }
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(fixture.fail).toHaveBeenCalledWith(failure, {
      final: true,
      waiting: false,
      message: "The preserved structured source cannot be materialized safely within current Dataset bounds. Original evidence remains available."
    });
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("fails closed when the queued vault binding loses its writer lease before execution", async () => {
    const fixture = makeQueuedDatasetJob();
    const bindingFailure = new PigeDomainError(
      "vault.binding_changed",
      "The active vault changed before Dataset execution began."
    );
    fixture.begin.mockImplementation(() => { throw bindingFailure; });
    const materializeSource = vi.fn<DatasetMaterializerPort["materializeSource"]>();
    const executor = new DatasetImportJobExecutor({
      canMaterialize: () => true,
      materializeSource
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).rejects.toBe(bindingFailure);
    expect(materializeSource).not.toHaveBeenCalled();
    expect(fixture.finish).not.toHaveBeenCalled();
  });

  it.each([
    [
      new PigeDomainError("source.external_unavailable", "private path"),
      {
        final: false,
        waiting: true,
        message: "The referenced structured source is unavailable. Reconnect it before retrying Dataset materialization."
      }
    ],
    [
      new Error("raw dataset body"),
      {
        final: false,
        waiting: false,
        message: "Dataset materialization failed. Preserved source and validated immutable outputs remain retryable."
      }
    ]
  ])("keeps Dataset failure classification body-free and owner-specific", async (caught, expected) => {
    const fixture = makeQueuedDatasetJob();
    const executor = new DatasetImportJobExecutor({
      canMaterialize: () => true,
      materializeSource: async () => { throw caught; }
    }, { queued: () => [fixture.candidate] });

    await executor.process();

    expect(fixture.fail).toHaveBeenCalledWith(caught, expected);
  });
});

function makeQueuedDatasetJob(options: { readonly source?: boolean } = {}): {
  readonly job: JobRecord;
  readonly source: SourceRecord;
  readonly candidate: QueuedDatasetImportJob;
  readonly control: JobExecutionControl;
  readonly appendActivity: ReturnType<typeof vi.fn>;
  readonly complete: ReturnType<typeof vi.fn>;
  readonly fail: ReturnType<typeof vi.fn>;
  readonly finish: ReturnType<typeof vi.fn>;
  readonly failMissingSource: ReturnType<typeof vi.fn>;
  readonly waitForMaterializer: ReturnType<typeof vi.fn>;
  readonly begin: ReturnType<typeof vi.fn>;
} {
  const job = JobRecordSchema.parse({
    id: "job_20260723_dataset01",
    class: "dataset_import",
    state: "queued",
    sourceId: "src_20260723_dataset01",
    createdAt: "2026-07-23T05:00:00.000Z",
    updatedAt: "2026-07-23T05:00:00.000Z",
    message: "Queued."
  });
  const source = {
    schemaVersion: 1,
    id: "src_20260723_dataset01",
    kind: "csv_file",
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      pathBasis: "vault_relative",
      path: "raw/files/2026/07/source.csv",
      checksum: `sha256:${"a".repeat(64)}`,
      size: 12
    },
    artifacts: [],
    metadata: {},
    createdAt: "2026-07-23T05:00:00.000Z",
    updatedAt: "2026-07-23T05:00:00.000Z"
  } as SourceRecord;
  const control: JobExecutionControl = {
    signal: new AbortController().signal,
    throwIfCancellationRequested: vi.fn(),
    reportProgress: vi.fn(),
    markDurableCheckpoint: vi.fn(),
    durableWriteState: () => ({ durableWritesApplied: false })
  };
  const appendActivity = vi.fn();
  const complete = vi.fn(() => ({ ...job, state: "completed" as const }));
  const fail = vi.fn();
  const finish = vi.fn();
  const active: ActiveDatasetImportJob = {
    job,
    control,
    appendActivity,
    complete,
    fail,
    finish
  };
  const failMissingSource = vi.fn();
  const waitForMaterializer = vi.fn();
  const begin = vi.fn(() => active);
  return {
    job,
    source,
    candidate: {
      job,
      vaultPath: "/vault-a",
      ...(options.source === false ? {} : {
        source: { path: "/vault-a/.pige/source-records/source.json", record: source }
      }),
      failMissingSource,
      waitForMaterializer,
      begin
    },
    control,
    appendActivity,
    complete,
    fail,
    finish,
    failMissingSource,
    waitForMaterializer,
    begin
  };
}
