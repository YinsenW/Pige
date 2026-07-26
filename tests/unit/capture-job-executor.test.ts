import { describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import {
  CaptureJobExecutor,
  type ActiveCaptureJob,
  type QueuedCaptureJob
} from "../../apps/desktop/src/main/services/capture-job-executor";
import type { JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";
import type {
  SourcePagePublicationResult,
  SourcePageService
} from "../../apps/desktop/src/main/services/source-page-service";

describe("CaptureJobExecutor", () => {
  it("owns non-cooperative source-page publication and durable completion", () => {
    const fixture = makeQueuedCaptureJob();
    const createForSource = vi.fn(() => sourcePageResult());
    const executor = new CaptureJobExecutor({ createForSource } as unknown as SourcePageService, {
      queued: () => [fixture.candidate]
    });

    expect(executor.process()).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(createForSource).toHaveBeenCalledWith(
      "/vault-a",
      fixture.source,
      "/vault-a/.pige/source-records/source.json",
      fixture.job.id,
      fixture.source,
      expect.objectContaining({ onPublicationStart: expect.any(Function) })
    );
    const hooks = createForSource.mock.calls[0]?.[5];
    hooks?.onPublicationStart?.();
    expect(fixture.control.markDurableCheckpoint).toHaveBeenCalledWith(
      "capture_source_page_publication_started"
    );
    expect(fixture.prepareFollowUp).toHaveBeenCalledWith(sourcePageResult());
    expect(fixture.complete).toHaveBeenCalledWith(sourcePageResult());
  });

  it("settles a missing source before execution", () => {
    const fixture = makeQueuedCaptureJob({ source: false });
    const createForSource = vi.fn();
    const executor = new CaptureJobExecutor({ createForSource } as unknown as SourcePageService, {
      queued: () => [fixture.candidate]
    });

    expect(executor.process()).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(fixture.failMissingSource).toHaveBeenCalledWith(
      "Source record is missing. Preserved job remains retryable."
    );
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(createForSource).not.toHaveBeenCalled();
  });

  it("keeps publication failures body-free", () => {
    const fixture = makeQueuedCaptureJob();
    const failure = new PigeDomainError("source_page.target_changed", "/private/source body");
    const executor = new CaptureJobExecutor({
      createForSource: () => { throw failure; }
    } as unknown as SourcePageService, { queued: () => [fixture.candidate] });

    expect(executor.process()).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(fixture.fail).toHaveBeenCalledWith(
      failure,
      "Source page creation failed. Preserved source remains retryable."
    );
    expect(JSON.stringify(fixture.fail.mock.calls)).not.toContain("source body");
  });

  it("fails closed when the queued vault binding loses its lease before begin", () => {
    const fixture = makeQueuedCaptureJob();
    const bindingFailure = new PigeDomainError("vault.binding_changed", "private vault detail");
    fixture.begin.mockImplementation(() => { throw bindingFailure; });
    const createForSource = vi.fn();
    const executor = new CaptureJobExecutor({ createForSource } as unknown as SourcePageService, {
      queued: () => [fixture.candidate]
    });

    expect(() => executor.process()).toThrow(bindingFailure);
    expect(createForSource).not.toHaveBeenCalled();
  });

  it("rejects a durable result bound to a different source identity", () => {
    const fixture = makeQueuedCaptureJob();
    const executor = new CaptureJobExecutor({
      createForSource: () => ({ ...sourcePageResult(), sourceId: "src_20260726_other001" })
    } as unknown as SourcePageService, { queued: () => [fixture.candidate] });

    expect(executor.process()).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(fixture.prepareFollowUp).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "capture.durable_effect_invalid" }),
      "Source page creation failed. Preserved source remains retryable."
    );
  });
});

function sourcePageResult(): SourcePagePublicationResult {
  return {
    sourceId: "src_20260726_capture01",
    pageId: "page_20260726_capture01",
    pagePath: "sources/text/2026/source.md",
    created: true,
    conflict: false,
    title: "Captured source",
    durableEffect: {
      outputRefs: [{
        kind: "source",
        id: "src_20260726_capture01",
        path: ".pige/source-records/2026/07/source.json",
        checksum: `sha256:${"a".repeat(64)}`,
        role: "capture_source_record"
      }, {
        kind: "page",
        id: "page_20260726_capture01",
        path: "sources/text/2026/source.md",
        checksum: `sha256:${"b".repeat(64)}`,
        role: "capture_source_page"
      }]
    }
  };
}

function makeQueuedCaptureJob(options: { readonly source?: boolean } = {}) {
  const job = JobRecordSchema.parse({
    id: "job_20260726_capture01",
    class: "capture",
    state: "queued",
    sourceId: "src_20260726_capture01",
    createdAt: "2026-07-26T04:00:00.000Z",
    updatedAt: "2026-07-26T04:00:00.000Z",
    message: "Queued."
  });
  const source = {
    schemaVersion: 1,
    id: "src_20260726_capture01",
    kind: "text",
    storageStrategy: "copy_to_source_library",
    artifacts: [],
    metadata: {},
    createdAt: "2026-07-26T04:00:00.000Z",
    updatedAt: "2026-07-26T04:00:00.000Z"
  } as SourceRecord;
  const control: JobExecutionControl = {
    signal: new AbortController().signal,
    throwIfCancellationRequested: vi.fn(),
    reportProgress: vi.fn(),
    markDurableCheckpoint: vi.fn(),
    durableWriteState: () => ({ durableWritesApplied: false })
  };
  const prepareFollowUp = vi.fn();
  const complete = vi.fn(() => ({ ...job, state: "completed" as const }));
  const fail = vi.fn();
  const active: ActiveCaptureJob = { job, control, prepareFollowUp, complete, fail };
  const failMissingSource = vi.fn();
  const begin = vi.fn(() => active);
  const candidate: QueuedCaptureJob = {
    job,
    vaultPath: "/vault-a",
    ...(options.source === false ? {} : {
      source: { path: "/vault-a/.pige/source-records/source.json", record: source }
    }),
    failMissingSource,
    begin
  };
  return {
    job,
    source,
    candidate,
    control,
    prepareFollowUp,
    complete,
    fail,
    failMissingSource,
    begin
  };
}
