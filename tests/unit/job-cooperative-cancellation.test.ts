import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type SourceKind, type SourceRecord } from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { JobCancellationError, type JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import {
  OcrService,
  type NativeImageOcrAdapterPort,
  type OcrPort
} from "../../apps/desktop/src/main/services/ocr-service";
import {
  OcrArtifactService,
  type OcrSourceResult
} from "../../apps/desktop/src/main/services/ocr-artifact-service";
import { ParserArtifactService } from "../../apps/desktop/src/main/services/parser-artifact-service";
import { extractPdfText } from "../../apps/desktop/src/main/services/pdf-parser-core";
import { PdfParserService, type PdfTextExtractor } from "../../apps/desktop/src/main/services/pdf-parser-service";
import type { PdfPageRendererPort } from "../../apps/desktop/src/main/services/pdf-page-renderer-service";
import {
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_VERSION,
  type PdfPageRendererResult
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import { SourcePageService } from "../../apps/desktop/src/main/services/source-page-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture } from "../helpers/legacy-agent-ingest-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";

const tempRoots: string[] = [];
const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("cooperative durable job cancellation", { timeout: 15_000 }, () => {
  it("cancels running image OCR before durable output and clears retry orchestration state", async () => {
    const fixture = makeFixture();
    const adapter = new BlockingNativeOcrAdapter();
    const { capture, jobs } = makeServices(fixture, undefined, new OcrService(adapter));
    const imagePath = path.join(fixture.root, "cancel-image.png");
    fs.writeFileSync(imagePath, Buffer.from("synthetic cancellable image"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);

    const processing = jobs.processQueuedOcr({ sourceIds: [sourceId] });
    await adapter.started.promise;
    const running = requireValue(jobs.list({ classes: ["ocr"], states: ["running"] }).jobs[0]);
    expect(running).toMatchObject({
      sourceId,
      stage: "ocr",
      progress: { completedUnits: 0, totalUnits: 1, unit: "image" }
    });

    const action = jobs.cancel({ jobId: running.id });
    expect(action).toMatchObject({ status: "cancel_requested", job: { state: "cancel_requested" } });
    expect(jobs.cancel({ jobId: running.id })).toMatchObject({
      status: "cancel_requested",
      job: { state: "cancel_requested", updatedAt: action.job?.updatedAt }
    });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });

    const cancelled = requireValue(jobs.list({ classes: ["ocr"], states: ["cancelled"] }).jobs[0]);
    const cancelledRecord = readJobRecord(fixture.vaultPath, cancelled.id);
    const source = readSourceRecord(fixture.vaultPath, sourceId);
    const managedPath = path.join(fixture.vaultPath, requireValue(source.managedCopy?.path));
    expect(cancelled.message).toContain("safe checkpoint");
    expect(cancelledRecord.cancellation?.durableWritesApplied).toBe(false);
    expect(source.artifacts).toEqual([]);
    expect(fs.readFileSync(managedPath, "utf8")).toBe("synthetic cancellable image");

    expect(jobs.retry({ jobId: cancelled.id }).status).toBe("requeued");
    const retriedRecord = readJobRecord(fixture.vaultPath, cancelled.id);
    expect(retriedRecord).not.toHaveProperty("stage");
    expect(retriedRecord).not.toHaveProperty("progress");
    expect(retriedRecord).not.toHaveProperty("cancellation");
    expect(retriedRecord).not.toHaveProperty("startedAt");
    expect(retriedRecord).not.toHaveProperty("finishedAt");
  });

  it("cancels a running parser before artifact publication and disposes its private snapshot", async () => {
    const fixture = makeFixture();
    const extractor = new BlockingPdfExtractor();
    const parser = new PdfParserService(extractor);
    const { capture, jobs } = makeServices(fixture, parser);
    const pdfPath = path.join(fixture.root, "cancel-parse.pdf");
    fs.writeFileSync(pdfPath, createTestPdf(["Parser cancellation fixture."]));
    const captured = await capture.submitFiles({
      filePaths: [pdfPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);

    const processing = jobs.processQueuedParses({ sourceIds: [sourceId] });
    await extractor.started.promise;
    const running = requireValue(jobs.list({ classes: ["parse"], states: ["running"] }).jobs[0]);
    expect(running.progress).toEqual({ completedUnits: 0, totalUnits: 1, unit: "document" });
    expect(jobs.cancel({ jobId: running.id }).status).toBe("cancel_requested");
    expect(await processing).toMatchObject({ processed: 1, completed: 0, failed: 1 });

    const cancelled = requireValue(jobs.list({ classes: ["parse"], states: ["cancelled"] }).jobs[0]);
    const source = readSourceRecord(fixture.vaultPath, sourceId);
    expect(cancelled.sourceId).toBe(sourceId);
    expect(source.artifacts).toEqual([]);
    expect(extractor.snapshotPath).toBeDefined();
    expect(fs.existsSync(requireValue(extractor.snapshotPath))).toBe(false);
  });

  it("lets cancel_requested win before a durable guard mutation without rewriting the request pair", async () => {
    const fixture = makeFixture();
    const started = deferred<void>();
    const release = deferred<void>();
    const ocr: OcrPort = {
      canOcr: () => true,
      inspectSource: () => ({ ready: true, message: "Linearization fixture is ready." }),
      ocrSource: async (_vaultPath, _sourceRecord, _sourceRecordPath, _job, control) => {
        started.resolve();
        await release.promise;
        control?.markDurableCheckpoint("must_not_be_persisted");
        throw new Error("The cancellation should win before publication.");
      }
    };
    const { capture, jobs } = makeServices(fixture, undefined, ocr);
    const imagePath = path.join(fixture.root, "linearization.png");
    fs.writeFileSync(imagePath, Buffer.from("synthetic linearization image"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);

    const processing = jobs.processQueuedOcr({ sourceIds: [sourceId] });
    await started.promise;
    const running = requireValue(jobs.list({ classes: ["ocr"], states: ["running"] }).jobs[0]);
    const requested = jobs.cancel({ jobId: running.id });
    expect(requested).toMatchObject({ status: "cancel_requested" });
    release.resolve();
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });

    const cancelled = readJobRecord(fixture.vaultPath, running.id);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.cancellation).toMatchObject({
      requestedAt: requested.job?.updatedAt,
      requestedBy: "user",
      safeCheckpointId: "before_durable_write",
      durableWritesApplied: false
    });
    expect(cancelled.cancellation?.safeCheckpointId).not.toBe("must_not_be_persisted");
  });

  it("keeps staged PDF pages retryable when cancellation arrives between OCR page units", async () => {
    const fixture = makeFixture();
    const adapter = new SecondCallBlockingNativeOcrAdapter();
    const renderer = new StaticPdfPageRenderer();
    const parser = new PdfParserService({
      extract: (filePath) => extractPdfText({
        requestId: "cooperative-cancel-pdf",
        filePath,
        limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
      })
    });
    const { capture, jobs } = makeServices(fixture, parser, new OcrService(adapter, undefined, renderer));
    const pdfPath = path.join(fixture.root, "two-page-scan.pdf");
    fs.writeFileSync(pdfPath, createTestPdf(["", ""], "Two page scan"));
    const captured = await capture.submitFiles({
      filePaths: [pdfPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);
    await jobs.processQueuedParses({ sourceIds: [sourceId] });

    const processing = jobs.processQueuedOcr({ sourceIds: [sourceId] });
    await adapter.secondCallStarted.promise;
    const running = requireValue(jobs.list({ classes: ["ocr"], states: ["running"] }).jobs[0]);
    expect(running.progress).toEqual({ completedUnits: 1, totalUnits: 2, unit: "page" });
    const stagedSource = readSourceRecord(fixture.vaultPath, sourceId);
    expect(stagedSource.artifacts.filter((artifact) => artifact.kind === "rendered_page")).toHaveLength(2);

    expect(jobs.cancel({ jobId: running.id }).status).toBe("cancel_requested");
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });
    const retryable = requireValue(jobs.list({ classes: ["ocr"], states: ["failed_retryable"] }).jobs[0]);
    const retryableRecord = readJobRecord(fixture.vaultPath, retryable.id);
    expect(retryable.message).toBe(
      "A retained action-safety guard prevents clean cancellation; the job remains retryable."
    );
    expect(retryable.progress).toEqual({ completedUnits: 1, totalUnits: 2, unit: "page" });
    expect(retryableRecord.cancellation?.safeCheckpointId).toBe("pdf_pages_staging_started");
    expect(retryableRecord.cancellation?.durableWritesApplied).toBe(true);
    expect(readSourceRecord(fixture.vaultPath, sourceId).artifacts.some((artifact) => artifact.id.endsWith("_pdf_ocr_metadata")))
      .toBe(false);

    const sourceBeforeSecondCancel = readSourceRecord(fixture.vaultPath, sourceId);
    const jobBeforeSecondCancel = readJobRecord(fixture.vaultPath, retryable.id);
    expect(jobs.cancel({ jobId: retryable.id })).toMatchObject({
      status: "not_allowed",
      job: { id: retryable.id, state: "failed_retryable" }
    });
    expect(readJobRecord(fixture.vaultPath, retryable.id)).toEqual(jobBeforeSecondCancel);
    expect(readSourceRecord(fixture.vaultPath, sourceId)).toEqual(sourceBeforeSecondCancel);
  });

  it("protects durable partial outputs across failure, dependency wait, retry, and cooperative cancellation", async () => {
    const failedFixture = makeFixture();
    const failedAdapter = new SecondCallFailingNativeOcrAdapter();
    const failedSetup = await prepareParsedPdfOcr(failedFixture, failedAdapter, "generic-failure");

    expect(await failedSetup.jobs.processQueuedOcr({ sourceIds: [failedSetup.sourceId] }))
      .toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });
    const failed = requireValue(failedSetup.jobs.list({ classes: ["ocr"], states: ["failed_retryable"] }).jobs[0]);
    const failedJobBeforeCancel = readJobRecord(failedFixture.vaultPath, failed.id);
    const failedSourceBeforeCancel = readSourceRecord(failedFixture.vaultPath, failedSetup.sourceId);
    const failedArtifactsBeforeCancel = snapshotFiles(path.join(failedFixture.vaultPath, "artifacts"));
    expect(failedJobBeforeCancel.cancellation).toEqual({
      safeCheckpointId: "pdf_pages_staging_started",
      durableWritesApplied: true
    });
    expect(failedSourceBeforeCancel.artifacts.filter((artifact) => artifact.kind === "rendered_page")).toHaveLength(2);
    expect(failedSetup.jobs.cancel({ jobId: failed.id })).toMatchObject({
      status: "not_allowed",
      job: { id: failed.id, state: "failed_retryable" }
    });
    expect(readJobRecord(failedFixture.vaultPath, failed.id)).toEqual(failedJobBeforeCancel);
    expect(readSourceRecord(failedFixture.vaultPath, failedSetup.sourceId)).toEqual(failedSourceBeforeCancel);
    expect(snapshotFiles(path.join(failedFixture.vaultPath, "artifacts"))).toEqual(failedArtifactsBeforeCancel);

    const waitingFixture = makeFixture();
    const waitingAdapter = new SecondCallUnavailableNativeOcrAdapter();
    const waitingSetup = await prepareParsedPdfOcr(waitingFixture, waitingAdapter, "dependency-wait");
    expect(await waitingSetup.jobs.processQueuedOcr({ sourceIds: [waitingSetup.sourceId] }))
      .toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });
    const waiting = requireValue(waitingSetup.jobs.list({ classes: ["ocr"], states: ["waiting_dependency"] }).jobs[0]);
    const waitingJobBeforeCancel = readJobRecord(waitingFixture.vaultPath, waiting.id);
    const waitingSourceBeforeCancel = readSourceRecord(waitingFixture.vaultPath, waitingSetup.sourceId);
    const waitingArtifactsBeforeCancel = snapshotFiles(path.join(waitingFixture.vaultPath, "artifacts"));
    expect(waitingJobBeforeCancel.cancellation).toEqual({
      safeCheckpointId: "pdf_pages_staging_started",
      durableWritesApplied: true
    });
    expect(waitingSetup.jobs.cancel({ jobId: waiting.id }).status).toBe("not_allowed");
    expect(readJobRecord(waitingFixture.vaultPath, waiting.id)).toEqual(waitingJobBeforeCancel);
    expect(readSourceRecord(waitingFixture.vaultPath, waitingSetup.sourceId)).toEqual(waitingSourceBeforeCancel);
    expect(snapshotFiles(path.join(waitingFixture.vaultPath, "artifacts"))).toEqual(waitingArtifactsBeforeCancel);

    expect(waitingSetup.jobs.retry({ jobId: waiting.id }).status).toBe("requeued");
    const queued = readJobRecord(waitingFixture.vaultPath, waiting.id);
    expect(queued.cancellation).toEqual({ durableWritesApplied: true });
    expect(waitingSetup.jobs.cancel({ jobId: waiting.id }).status).toBe("not_allowed");
    expect(readJobRecord(waitingFixture.vaultPath, waiting.id)).toEqual(queued);

    const retryStarted = deferred<void>();
    const retryBeforePublicationOcr: OcrPort = {
      canOcr: () => true,
      inspectSource: () => ({ ready: true, message: "Retry fixture is ready." }),
      ocrSource: async (_vaultPath, _sourceRecord, _sourceRecordPath, _job, control) => {
        retryStarted.resolve();
        return rejectOnAbort<OcrSourceResult>(control?.signal);
      }
    };
    const retryServices = makeServices(waitingFixture, undefined, retryBeforePublicationOcr);
    const retryProcessing = retryServices.jobs.processQueuedOcr({ sourceIds: [waitingSetup.sourceId] });
    await retryStarted.promise;
    expect(retryServices.jobs.cancel({ jobId: waiting.id }).status).toBe("cancel_requested");
    expect(await retryProcessing).toEqual({ processed: 1, completed: 0, failed: 1, agentReadySourceIds: [] });
    const retryCancelled = readJobRecord(waitingFixture.vaultPath, waiting.id);
    expect(retryCancelled.state).toBe("failed_retryable");
    expect(retryCancelled.cancellation?.durableWritesApplied).toBe(true);
    expect(retryCancelled.cancellation?.requestedBy).toBe("user");
    expect(retryCancelled.cancellation).not.toHaveProperty("safeCheckpointId");
    expect(retryCancelled.message).toBe(
      "A retained action-safety guard prevents clean cancellation; the job remains retryable."
    );

    const cleanWaitingFixture = makeFixture();
    const cleanWaitingOcr: OcrPort = {
      canOcr: (kind) => kind === "image_file",
      inspectSource: () => ({ ready: false, message: "Fixture dependency is not ready." }),
      ocrSource: async () => { throw new Error("Pre-durable waiting OCR must not run."); }
    };
    const cleanWaitingServices = makeServices(cleanWaitingFixture, undefined, cleanWaitingOcr);
    const cleanImagePath = path.join(cleanWaitingFixture.root, "pre-durable-wait.png");
    fs.writeFileSync(cleanImagePath, Buffer.from("pre-durable waiting fixture"));
    const cleanCaptured = await cleanWaitingServices.capture.submitFiles({
      filePaths: [cleanImagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    cleanWaitingServices.jobs.processQueuedCaptures({ jobIds: cleanCaptured.jobIds });
    seedExplicitImageOcrJob(
      cleanWaitingFixture.vaultPath,
      requireFirst(cleanCaptured.jobIds),
      requireFirst(cleanCaptured.sourceIds),
      "waiting_dependency"
    );
    const cleanWaiting = requireValue(cleanWaitingServices.jobs.list({
      classes: ["ocr"],
      states: ["waiting_dependency"]
    }).jobs[0]);
    expect(cleanWaitingServices.jobs.cancel({ jobId: cleanWaiting.id }).status).toBe("cancelled");
    expect(readJobRecord(cleanWaitingFixture.vaultPath, cleanWaiting.id).cancellation?.durableWritesApplied)
      .toBe(false);
  });

  it("marks parser artifact publication durable before a partial publication failure", async () => {
    const fixture = makeFixture();
    const parser = new PdfParserService({
      extract: (filePath) => extractPdfText({
        requestId: "parser-partial-publication",
        filePath,
        limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
      })
    }, new ParserArtifactService(new FailingSourcePageService()));
    const { capture, jobs } = makeServices(fixture, parser);
    const pdfPath = path.join(fixture.root, "parser-partial-publication.pdf");
    fs.writeFileSync(pdfPath, createTestPdf(["Durable parser publication fixture."]));
    const captured = await capture.submitFiles({
      filePaths: [pdfPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);

    expect(await jobs.processQueuedParses({ sourceIds: [sourceId] })).toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const retryable = requireValue(jobs.list({ classes: ["parse"], states: ["failed_retryable"] }).jobs[0]);
    const retryableRecord = readJobRecord(fixture.vaultPath, retryable.id);
    const sourceBeforeCancel = readSourceRecord(fixture.vaultPath, sourceId);
    const artifactsBeforeCancel = snapshotFiles(path.join(fixture.vaultPath, "artifacts"));
    expect(retryableRecord.cancellation).toEqual({
      safeCheckpointId: "pdf_parser_artifact_publication_started",
      durableWritesApplied: true
    });
    expect(sourceBeforeCancel.artifacts).toEqual([]);
    expect(Object.keys(artifactsBeforeCancel).some((file) => file.endsWith(".txt"))).toBe(true);
    expect(Object.keys(artifactsBeforeCancel).some((file) => file.endsWith(".pdf.json"))).toBe(true);
    expect(jobs.cancel({ jobId: retryable.id }).status).toBe("not_allowed");
    expect(readJobRecord(fixture.vaultPath, retryable.id)).toEqual(retryableRecord);
    expect(readSourceRecord(fixture.vaultPath, sourceId)).toEqual(sourceBeforeCancel);
    expect(snapshotFiles(path.join(fixture.vaultPath, "artifacts"))).toEqual(artifactsBeforeCancel);
  });

  it("marks verified parser reuse publication durable before source-page refresh", async () => {
    const fixture = makeFixture();
    const initialParser = new PdfParserService({
      extract: (filePath) => extractPdfText({
        requestId: "parser-reuse-initial",
        filePath,
        limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
      })
    });
    const initialServices = makeServices(fixture, initialParser);
    const pdfPath = path.join(fixture.root, "parser-reuse.pdf");
    fs.writeFileSync(pdfPath, createTestPdf(["Reusable parser artifact fixture."]));
    const captured = await initialServices.capture.submitFiles({
      filePaths: [pdfPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    initialServices.jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);
    expect(await initialServices.jobs.processQueuedParses({ sourceIds: [sourceId] })).toMatchObject({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const reuseJob = JobRecordSchema.parse({
      id: "job_20260710_reuseparse1",
      class: "parse",
      state: "queued",
      sourceId,
      createdAt: "2026-07-10T12:00:30.000Z",
      updatedAt: "2026-07-10T12:00:30.000Z",
      message: "Reuse verified parser outputs."
    });
    writeJobRecord(fixture.vaultPath, reuseJob);
    const sourceBeforeReuse = readSourceRecord(fixture.vaultPath, sourceId);
    const artifactsBeforeReuse = snapshotFiles(path.join(fixture.vaultPath, "artifacts"));
    const reuseParser = new PdfParserService({
      extract: async () => { throw new Error("Verified parser reuse must not call the extractor."); }
    }, new ParserArtifactService(new FailingSourcePageService()));
    const reuseServices = makeServices(fixture, reuseParser);

    expect(await reuseServices.jobs.processQueuedParses({ jobIds: [reuseJob.id] })).toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const failedReuse = readJobRecord(fixture.vaultPath, reuseJob.id);
    expect(failedReuse.state).toBe("failed_retryable");
    expect(failedReuse.cancellation).toEqual({
      safeCheckpointId: "pdf_parser_artifact_publication_started",
      durableWritesApplied: true
    });
    expect(reuseServices.jobs.cancel({ jobId: reuseJob.id }).status).toBe("not_allowed");
    expect(readJobRecord(fixture.vaultPath, reuseJob.id)).toEqual(failedReuse);
    expect(readSourceRecord(fixture.vaultPath, sourceId)).toEqual(sourceBeforeReuse);
    expect(snapshotFiles(path.join(fixture.vaultPath, "artifacts"))).toEqual(artifactsBeforeReuse);
  });

  it("marks verified OCR reuse publication durable before source-page refresh", async () => {
    const fixture = makeFixture();
    const initialServices = makeServices(
      fixture,
      undefined,
      new OcrService(new SecondCallFailingNativeOcrAdapter())
    );
    const imagePath = path.join(fixture.root, "reusable-image.png");
    fs.writeFileSync(imagePath, Buffer.from("reusable image fixture"));
    const captured = await initialServices.capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    initialServices.jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);
    expect(await initialServices.jobs.processQueuedOcr({ sourceIds: [sourceId] })).toMatchObject({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completedInitial = requireValue(initialServices.jobs.list({
      classes: ["ocr"],
      states: ["completed"]
    }).jobs[0]);
    expect(readJobRecord(fixture.vaultPath, completedInitial.id).cancellation).toEqual({
      safeCheckpointId: "image_ocr_commit_started",
      durableWritesApplied: true
    });

    const reuseJob = JobRecordSchema.parse({
      id: "job_20260710_reuseocr01",
      class: "ocr",
      state: "queued",
      sourceId,
      createdAt: "2026-07-10T12:01:00.000Z",
      updatedAt: "2026-07-10T12:01:00.000Z",
      message: "Reuse verified OCR outputs."
    });
    writeJobRecord(fixture.vaultPath, reuseJob);
    const sourceBeforeReuse = readSourceRecord(fixture.vaultPath, sourceId);
    const artifactsBeforeReuse = snapshotFiles(path.join(fixture.vaultPath, "artifacts"));
    const reuseServices = makeServices(
      fixture,
      undefined,
      new OcrService(
        new SecondCallFailingNativeOcrAdapter(),
        new OcrArtifactService(new FailingSourcePageService())
      )
    );

    expect(await reuseServices.jobs.processQueuedOcr({ jobIds: [reuseJob.id] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1,
      agentReadySourceIds: []
    });
    const failedReuse = readJobRecord(fixture.vaultPath, reuseJob.id);
    expect(failedReuse.state).toBe("failed_retryable");
    expect(failedReuse.cancellation).toEqual({
      safeCheckpointId: "image_ocr_existing_publication_started",
      durableWritesApplied: true
    });
    expect(reuseServices.jobs.cancel({ jobId: reuseJob.id }).status).toBe("not_allowed");
    expect(readJobRecord(fixture.vaultPath, reuseJob.id)).toEqual(failedReuse);
    expect(readSourceRecord(fixture.vaultPath, sourceId)).toEqual(sourceBeforeReuse);
    expect(snapshotFiles(path.join(fixture.vaultPath, "artifacts"))).toEqual(artifactsBeforeReuse);
  });

  it.each(["queued", "waiting_dependency", "failed_retryable"] as const)(
    "refuses direct cancellation after a durable-write boundary in %s",
    (state) => {
      const fixture = makeFixture();
      const { jobs } = makeServices(fixture);
      const job = JobRecordSchema.parse({
        id: `job_20260710_${state.replaceAll("_", "").padEnd(8, "0").slice(0, 12)}`,
        class: "ocr",
        state,
        createdAt: "2026-07-10T12:02:00.000Z",
        updatedAt: "2026-07-10T12:02:00.000Z",
        cancellation: {
          safeCheckpointId: "fixture_domain_publication_started",
          durableWritesApplied: true
        },
        message: "Fixture crossed a durable-write boundary."
      });
      const jobPath = writeJobRecord(fixture.vaultPath, job);
      const before = fs.readFileSync(jobPath);

      expect(jobs.cancel({ jobId: job.id })).toMatchObject({
        status: "not_allowed",
        reason: "A retained action-safety guard prevents clean cancellation; the job remains retryable.",
        job: { id: job.id, state }
      });
      expect(fs.readFileSync(jobPath)).toEqual(before);
    }
  );

  it("preserves a completed result when cancellation races the final durable publication fence", async () => {
    const fixture = makeFixture();
    let jobs: JobsService;
    let cancellationStatus: string | undefined;
    const ocr: OcrPort = {
      canOcr: (kind: SourceKind) => kind === "image_file",
      inspectSource: () => ({ ready: true, message: "Fixture OCR ready." }),
      ocrSource: async (
        vaultPath: string,
        sourceRecord: SourceRecord,
        _sourceRecordPath: string,
        job: JobRecord,
        control?: JobExecutionControl
      ): Promise<OcrSourceResult> => {
        control?.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "image" });
        control?.markDurableCheckpoint("fixture_output_committed");
        fs.writeFileSync(path.join(vaultPath, "artifacts", `${sourceRecord.id}.fixture`), "committed", {
          encoding: "utf8",
          flag: "w"
        });
        cancellationStatus = jobs.cancel({ jobId: job.id }).status;
        return {
          sourceId: sourceRecord.id,
          created: true,
          metadataArtifactPath: `artifacts/${sourceRecord.id}.fixture`,
          textCharacterCount: 0,
          agentTextReady: false,
          warnings: [],
          sourcePageUpdated: false,
          sourcePageConflict: false
        };
      }
    };
    const services = makeServices(fixture, undefined, ocr);
    jobs = services.jobs;
    const imagePath = path.join(fixture.root, "late-cancel.png");
    fs.writeFileSync(imagePath, Buffer.from("late cancellation fixture"));
    const captured = await services.capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const completed = requireValue(jobs.list({ classes: ["ocr"], states: ["completed_with_warnings"] }).jobs[0]);
    const completedRecord = readJobRecord(fixture.vaultPath, completed.id);
    expect(cancellationStatus).toBe("cancel_requested");
    expect(result).toEqual({ processed: 1, completed: 1, failed: 0, agentReadySourceIds: [] });
    expect(completed.message).toContain("Durable output committed");
    expect(completed.progress).toEqual({ completedUnits: 1, totalUnits: 1, unit: "image" });
    expect(completedRecord.cancellation?.safeCheckpointId).toBe("fixture_output_committed");
    expect(completedRecord.cancellation?.durableWritesApplied).toBe(true);
    expect(jobs.list({ classes: ["ocr"], states: ["cancelled"] }).jobs).toEqual([]);
  });
});

interface Fixture {
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: VaultSummary;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-cooperative-job-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Jobs",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Jobs");
  return { root, vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeServices(
  fixture: Fixture,
  parser?: PdfParserService,
  ocr?: OcrPort
): { readonly capture: LegacyCaptureFixture; readonly jobs: JobsService } {
  const vaults = {
    current: () => fixture.vault,
    activeVaultPath: () => fixture.vaultPath
  };
  return {
    capture: new LegacyCaptureFixture(vaults, fixture.vaultPath),
    jobs: new JobsService(vaults, undefined, undefined, parser, ocr)
  };
}

class BlockingNativeOcrAdapter implements NativeImageOcrAdapterPort {
  readonly started = deferred<void>();

  isAvailable(): boolean {
    return true;
  }

  recognize(_inputPath: string, _languages: readonly string[], signal?: AbortSignal): Promise<NativeOcrResult> {
    this.started.resolve();
    return rejectOnAbort(signal);
  }
}

class SecondCallBlockingNativeOcrAdapter implements NativeImageOcrAdapterPort {
  readonly secondCallStarted = deferred<void>();
  #callCount = 0;

  isAvailable(): boolean {
    return true;
  }

  recognize(_inputPath: string, _languages: readonly string[], signal?: AbortSignal): Promise<NativeOcrResult> {
    this.#callCount += 1;
    if (this.#callCount === 1) return Promise.resolve(validOcrResult("First page"));
    this.secondCallStarted.resolve();
    return rejectOnAbort(signal);
  }
}

class SecondCallFailingNativeOcrAdapter implements NativeImageOcrAdapterPort {
  #callCount = 0;

  isAvailable(): boolean {
    return true;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.#callCount += 1;
    if (this.#callCount === 1) return validOcrResult("First page");
    throw new Error("Synthetic retryable OCR page failure.");
  }
}

class SecondCallUnavailableNativeOcrAdapter implements NativeImageOcrAdapterPort {
  #callCount = 0;

  isAvailable(): boolean {
    return true;
  }

  recognize(_inputPath: string, _languages: readonly string[], _signal?: AbortSignal): Promise<NativeOcrResult> {
    this.#callCount += 1;
    if (this.#callCount === 1) return Promise.resolve(validOcrResult("First page"));
    if (this.#callCount === 2) {
      return Promise.reject(new PigeDomainError("ocr.adapter_unavailable", "Synthetic OCR dependency loss."));
    }
    return Promise.reject(new Error("Unexpected OCR adapter reuse after dependency wait."));
  }
}

class BlockingPdfExtractor implements PdfTextExtractor {
  readonly started = deferred<void>();
  snapshotPath: string | undefined;

  isAvailable(): boolean {
    return true;
  }

  extract(filePath: string, signal?: AbortSignal): ReturnType<PdfTextExtractor["extract"]> {
    this.snapshotPath = filePath;
    this.started.resolve();
    return rejectOnAbort(signal);
  }
}

class StaticPdfPageRenderer implements PdfPageRendererPort {
  isAvailable(): boolean {
    return true;
  }

  async renderPages(_filePath: string, pageCandidates: readonly number[]): Promise<PdfPageRendererResult> {
    const requestedPages = [...pageCandidates];
    const pages = requestedPages.map((page) => ({
      requestedPage: page,
      renderedPage: page,
      locator: `page:${page}`,
      mimeType: "image/png" as const,
      png: Uint8Array.from(ONE_PIXEL_PNG),
      width: 1,
      height: 1,
      pngByteSize: ONE_PIXEL_PNG.byteLength
    }));
    return {
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      rendererId: PDF_PAGE_RENDERER_ID,
      rendererVersion: PDF_PAGE_RENDERER_VERSION,
      pageCount: requestedPages.at(-1) ?? 1,
      requestedPages,
      renderedPages: requestedPages,
      pages,
      totalPngByteSize: pages.reduce((total, page) => total + page.pngByteSize, 0),
      warnings: [],
      truncated: false
    };
  }
}

class FailingSourcePageService extends SourcePageService {
  override refreshForSource(): never {
    throw new Error("Synthetic source-page failure after parser artifacts were written.");
  }
}

async function prepareParsedPdfOcr(
  fixture: Fixture,
  adapter: NativeImageOcrAdapterPort,
  fixtureName: string
): Promise<{ readonly jobs: JobsService; readonly sourceId: string }> {
  const parser = new PdfParserService({
    extract: (filePath) => extractPdfText({
      requestId: `durable-${fixtureName}`,
      filePath,
      limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
    })
  });
  const services = makeServices(fixture, parser, new OcrService(adapter, undefined, new StaticPdfPageRenderer()));
  const pdfPath = path.join(fixture.root, `${fixtureName}.pdf`);
  fs.writeFileSync(pdfPath, createTestPdf(["", ""], fixtureName));
  const captured = await services.capture.submitFiles({
    filePaths: [pdfPath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireFirst(captured.sourceIds);
  markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
  services.jobs.processQueuedCaptures({ jobIds: captured.jobIds });
  seedExplicitPdfParseJob(fixture.vaultPath, requireFirst(captured.jobIds), sourceId);
  await services.jobs.processQueuedParses({ sourceIds: [sourceId] });
  return { jobs: services.jobs, sourceId };
}

function rejectOnAbort<T>(signal?: AbortSignal): Promise<T> {
  return new Promise((_resolve, reject) => {
    const onAbort = (): void => reject(new JobCancellationError());
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function validOcrResult(text: string): NativeOcrResult {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text,
    blocks: [{
      text,
      kind: "line",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.6, height: 0.1 },
      languageHints: ["en"],
      isTitle: false
    }],
    languageHints: ["en"],
    confidence: 0.95,
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1,
      sourceHeight: 1,
      decodedWidth: 1,
      decodedHeight: 1,
      downsampled: false
    }
  };
}

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord {
  return JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`), "utf8")) as SourceRecord;
}

function readJobRecord(vaultPath: string, jobId: string): JobRecord {
  return JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`), "utf8")) as JobRecord;
}

function seedExplicitPdfParseJob(vaultPath: string, parentJobId: string, sourceId: string): void {
  const parent = JobRecordSchema.parse(readJobRecord(vaultPath, parentJobId));
  const dateKey = requireValue(/^src_(\d{8})_/u.exec(sourceId)?.[1]);
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const child = JobRecordSchema.parse({
    id: `job_${dateKey}_${suffix}pa`,
    class: "parse",
    state: "queued",
    parentJobId,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    sourceId,
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    message: "Explicit parser-substrate fixture queued."
  });
  writeJobRecord(vaultPath, child);
  writeJobRecord(vaultPath, JobRecordSchema.parse({
    ...parent,
    childJobIds: [...(parent.childJobIds ?? []), child.id]
  }));
}

function seedExplicitImageOcrJob(
  vaultPath: string,
  parentJobId: string,
  sourceId: string,
  state: "queued" | "waiting_dependency" = "queued"
): void {
  const parent = JobRecordSchema.parse(readJobRecord(vaultPath, parentJobId));
  const dateKey = requireValue(/^src_(\d{8})_/u.exec(sourceId)?.[1]);
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const child = JobRecordSchema.parse({
    id: `job_${dateKey}_${suffix}oa`,
    class: "ocr",
    state,
    parentJobId,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
    sourceId,
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    message: state === "waiting_dependency"
      ? "Persisted image OCR fixture is waiting for local OCR capability."
      : "Persisted image OCR fixture queued."
  });
  writeJobRecord(vaultPath, child);
  writeJobRecord(vaultPath, JobRecordSchema.parse({
    ...parent,
    childJobIds: [...(parent.childJobIds ?? []), child.id]
  }));
}

function writeJobRecord(vaultPath: string, job: JobRecord): string {
  const dateKey = /^job_(\d{8})_/.exec(job.id)?.[1];
  if (!dateKey) throw new Error("Invalid fixture Job ID.");
  const jobPath = path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${job.id}.json`);
  fs.mkdirSync(path.dirname(jobPath), { recursive: true });
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  return jobPath;
}

function snapshotFiles(root: string): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const filePath of listFiles(root)) {
    snapshot[path.relative(root, filePath)] = fs.readFileSync(filePath).toString("base64");
  }
  return snapshot;
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : entry.isFile() ? [fullPath] : [];
  }).sort();
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  throw new Error(`Missing file ending with ${suffix}`);
}

function findFileOptional(root: string, suffix: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return undefined;
}

function requireFirst<T>(values: readonly T[]): T {
  const first = values[0];
  if (first === undefined) throw new Error("Expected at least one value.");
  return first;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
