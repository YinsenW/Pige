import { describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import type { JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";
import {
  OcrJobExecutor,
  type ActiveOcrJob,
  type QueuedOcrJob
} from "../../apps/desktop/src/main/services/ocr-job-executor";
import type { OcrPort } from "../../apps/desktop/src/main/services/ocr-service";

describe("OcrJobExecutor", () => {
  it("owns OCR execution and projects durable completion through its port", async () => {
    const fixture = makeQueuedOcrJob();
    const ocrSource = vi.fn<OcrPort["ocrSource"]>(async () => ocrResult());
    fixture.prepareFollowUp.mockReturnValue({ agentReadySourceId: fixture.source.id });
    const executor = new OcrJobExecutor({
      canOcr: () => true,
      inspectSource: () => ({ ready: true, message: "ready" }),
      ocrSource
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toEqual({
      processed: 1,
      completed: 1,
      failed: 0,
      agentReadySourceIds: [fixture.source.id]
    });
    expect(ocrSource).toHaveBeenCalledWith(
      "/vault-a",
      fixture.source,
      "/vault-a/.pige/source-records/source.json",
      fixture.job,
      fixture.control
    );
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: fixture.source.id }),
      "completed",
      "Image OCR extracted 42 characters at confidence 0.940.",
      "image"
    );
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("keeps the parent-child startup barrier in the queued owner", async () => {
    const ocrSource = vi.fn<OcrPort["ocrSource"]>();
    const executor = new OcrJobExecutor({ canOcr: () => true, ocrSource }, { queued: () => [] });

    await expect(executor.process()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
      agentReadySourceIds: []
    });
    expect(ocrSource).not.toHaveBeenCalled();
  });

  it("settles missing sources and unavailable OCR before execution", async () => {
    const missing = makeQueuedOcrJob({ source: false });
    const unavailable = makeQueuedOcrJob();
    let queuedCall = 0;
    const executor = new OcrJobExecutor(undefined, {
      queued: () => queuedCall++ === 0 ? [missing.candidate] : [unavailable.candidate]
    });

    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    expect(missing.failMissingSource).toHaveBeenCalledWith(
      "Source record is missing. Preserved OCR job remains retryable."
    );
    expect(unavailable.waitForCapability).toHaveBeenCalledWith(
      "Image source preserved; waiting for local OCR capability from a healthy platform helper."
    );
    expect(missing.begin).not.toHaveBeenCalled();
    expect(unavailable.begin).not.toHaveBeenCalled();
  });

  it("keeps OCR failures body-free and always releases execution ownership", async () => {
    const fixture = makeQueuedOcrJob();
    const failure = new PigeDomainError("source.external_unavailable", "/private/source.png");
    const executor = new OcrJobExecutor({
      canOcr: () => true,
      ocrSource: async () => { throw failure; }
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.fail).toHaveBeenCalledWith(failure, {
      final: false,
      waiting: true,
      message: "Waiting for the referenced original image to be reconnected before local OCR can continue."
    });
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("fails closed when the queued vault binding loses its lease before begin", async () => {
    const fixture = makeQueuedOcrJob();
    const bindingFailure = new PigeDomainError("vault.binding_changed", "private vault detail");
    fixture.begin.mockImplementation(() => { throw bindingFailure; });
    const ocrSource = vi.fn<OcrPort["ocrSource"]>();
    const executor = new OcrJobExecutor({ canOcr: () => true, ocrSource }, {
      queued: () => [fixture.candidate]
    });

    await expect(executor.process()).rejects.toBe(bindingFailure);
    expect(ocrSource).not.toHaveBeenCalled();
    expect(fixture.finish).not.toHaveBeenCalled();
  });

  it("rejects a durable result bound to a different source identity", async () => {
    const fixture = makeQueuedOcrJob();
    const executor = new OcrJobExecutor({
      canOcr: () => true,
      ocrSource: async () => ({ ...ocrResult(), sourceId: "src_20260726_other001" })
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(fixture.prepareFollowUp).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ocr.durable_effect_invalid" }),
      expect.objectContaining({ final: false, waiting: false })
    );
    expect(fixture.finish).toHaveBeenCalledOnce();
  });
});

function ocrResult() {
  return {
    sourceId: "src_20260726_ocr00001",
    created: true,
    ocrTextArtifactPath: "artifacts/ocr/image.txt",
    metadataArtifactPath: "artifacts/metadata/image.json",
    textCharacterCount: 42,
    confidence: 0.94,
    agentTextReady: true,
    warnings: [],
    sourcePageUpdated: true,
    sourcePageConflict: false,
    durableEffect: {
      outputRefs: [{
        kind: "artifact" as const,
        id: "art_20260726_ocr_text",
        path: "artifacts/ocr/image.txt",
        checksum: `sha256:${"a".repeat(64)}`,
        role: "ocr_text"
      }],
      operationIds: ["op_20260726_ocr00001"]
    }
  };
}

function makeQueuedOcrJob(options: { readonly source?: boolean } = {}) {
  const job = JobRecordSchema.parse({
    id: "job_20260726_ocr00001",
    class: "ocr",
    state: "queued",
    sourceId: "src_20260726_ocr00001",
    createdAt: "2026-07-26T04:00:00.000Z",
    updatedAt: "2026-07-26T04:00:00.000Z",
    message: "Queued."
  });
  const source = {
    schemaVersion: 1,
    id: "src_20260726_ocr00001",
    kind: "image_file",
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      pathBasis: "vault_relative",
      path: "raw/files/2026/07/source.png",
      checksum: `sha256:${"b".repeat(64)}`,
      size: 12
    },
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
  const prepareFollowUp = vi.fn(() => ({}));
  const complete = vi.fn(() => ({ ...job, state: "completed" as const }));
  const fail = vi.fn(() => ({}));
  const finish = vi.fn();
  const active: ActiveOcrJob = { job, control, prepareFollowUp, complete, fail, finish };
  const failMissingSource = vi.fn();
  const waitForCapability = vi.fn(() => ({}));
  const begin = vi.fn(() => active);
  const candidate: QueuedOcrJob = {
    job,
    vaultPath: "/vault-a",
    ...(options.source === false ? {} : {
      source: { path: "/vault-a/.pige/source-records/source.json", record: source }
    }),
    failMissingSource,
    waitForCapability,
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
    finish,
    failMissingSource,
    waitForCapability,
    begin
  };
}
