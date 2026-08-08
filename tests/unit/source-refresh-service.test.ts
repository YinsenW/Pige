import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobRecordSchema, OperationRecordSchema, SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import type { DocumentParserPort } from "../../apps/desktop/src/main/services/document-parser-service";
import {
  OcrService,
  type NativeImageOcrAdapterPort,
  type OcrPort
} from "../../apps/desktop/src/main/services/ocr-service";
import type { OcrSourceResult } from "../../apps/desktop/src/main/services/ocr-artifact-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import { ParserArtifactService } from "../../apps/desktop/src/main/services/parser-artifact-service";
import { SourceRefreshService } from "../../apps/desktop/src/main/services/source-refresh-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SourceRefreshService", () => {
  it("projects only current sources supported by the active refresh adapters", () => {
    const fixture = makeFixture("plain_text_file", "current evidence\n");
    const service = makeService(fixture);

    expect(service.refreshableSourceIds([
      fixture.source.id,
      "src_20260731_missing123"
    ])).toEqual([fixture.source.id]);
  });

  it("previews without exposing local evidence and publishes the exact confirmed text revision", async () => {
    const fixture = makeFixture("plain_text_file", "old evidence\n");
    fs.writeFileSync(fixture.originalPath, "new confirmed evidence\n", "utf8");
    const service = makeService(fixture);

    const preview = await service.preview(previewRequest(fixture), () => true);
    expect(preview).toMatchObject({
      status: "changed",
      sourceId: fixture.source.id,
      preview: { displayName: "evidence.txt", sourceKind: "plain_text_file", affectedArtifactCount: 0 }
    });
    expect(JSON.stringify(preview)).not.toContain(fixture.originalPath);
    expect(JSON.stringify(preview)).not.toContain("new confirmed evidence");
    expect(JSON.stringify(preview)).not.toContain("sha256:");
    if (preview.status !== "changed") throw new Error("Expected changed preview");

    const result = await service.confirm({
      ...confirmIdentity(fixture),
      previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);

    expect(result).toMatchObject({ status: "refreshed", sourceId: fixture.source.id, sourcePageConflict: false });
    if (result.status !== "refreshed") throw new Error("Expected refreshed result");
    const published = readSource(fixture);
    expect(published.original?.checksum).toBe(checksum("new confirmed evidence\n"));
    expect(published.metadata).toMatchObject({
      sourceRefreshJobId: result.jobId,
      sourceRefreshOperationId: result.operationId
    });
    expect(published.metadata.sourceRefreshInput).toBeUndefined();
    expect(published.metadata.sourceRefreshInFlight).toBeUndefined();
    expect(fs.readFileSync(path.join(fixture.vaultPath, published.knowledgePagePath!), "utf8"))
      .toContain("new confirmed evidence");
    expect(readJob(fixture.vaultPath, result.jobId).state).toBe("completed");
    expect(readOperation(fixture.vaultPath, result.operationId)).toMatchObject({
      kind: "update_source_record",
      reversible: "yes",
      targetRefs: [{ kind: "source", id: fixture.source.id }]
    });
  });

  it("rejects candidate drift after preview without creating a job or changing the Source Record", async () => {
    const fixture = makeFixture("plain_text_file", "old evidence\n");
    fs.writeFileSync(fixture.originalPath, "previewed evidence\n", "utf8");
    const service = makeService(fixture);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");
    fs.writeFileSync(fixture.originalPath, "different evidence after preview\n", "utf8");

    await expect(service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true)).resolves.toMatchObject({ status: "stale" });

    expect(readSource(fixture)).toEqual(fixture.source);
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "jobs"))).toEqual([]);
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toEqual([]);
  });

  it("refreshes a changed managed text copy without reading from an external original", async () => {
    const fixture = makeFixture("plain_text_file", "managed old evidence\n", "managed.txt", true);
    fs.writeFileSync(fixture.originalPath, "managed new evidence\n", "utf8");
    const service = makeService(fixture);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed managed preview");
    const result = await service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    expect(result.status).toBe("refreshed");
    const published = readSource(fixture);
    expect(published.managedCopy?.checksum).toBe(checksum("managed new evidence\n"));
    expect(fs.readFileSync(path.join(fixture.vaultPath, published.knowledgePagePath!), "utf8"))
      .toContain("managed new evidence");
  });

  it("rolls back parser output and Source Record publication when document refresh fails", async () => {
    const fixture = makeFixture("pdf_file", "%PDF-old\n", "evidence.pdf");
    fs.writeFileSync(fixture.originalPath, "%PDF-new\n", "utf8");
    const artifactPath = path.join(
      fixture.vaultPath, "artifacts", "extracted-text", "2026", "07", `${fixture.source.id}.txt`
    );
    const parser: DocumentParserPort = {
      canParse: () => true,
      parseSource: vi.fn(async () => {
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(artifactPath, "partial parser output", "utf8");
        throw new Error("simulated parser failure");
      })
    };
    const service = makeService(fixture, parser);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");

    const result = await service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);

    expect(result.status).toBe("failed");
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(fs.existsSync(artifactPath)).toBe(false);
    const jobs = listJsonFiles(path.join(fixture.vaultPath, ".pige", "jobs"));
    expect(jobs).toHaveLength(1);
    expect(JobRecordSchema.parse(JSON.parse(fs.readFileSync(jobs[0]!, "utf8"))).state).toBe("failed_final");
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toEqual([]);
  });

  it("routes confirmed PDF, DOCX, and PPTX revisions through the parser publication boundary", async () => {
    const revisions = [
      { kind: "pdf_file" as const, name: "evidence.pdf", bytes: Buffer.from("new PDF revision"), text: "Fresh PDF evidence" },
      { kind: "docx_file" as const, name: "evidence.docx", bytes: Buffer.from("new DOCX revision"), text: "Local knowledge architecture" },
      { kind: "pptx_file" as const, name: "evidence.pptx", bytes: Buffer.from("new PPTX revision"), text: "Local-first Agent" }
    ];
    for (const revision of revisions) {
      const fixture = makeFixture(revision.kind, "old revision", revision.name);
      fs.writeFileSync(fixture.originalPath, revision.bytes);
      const service = makeService(fixture, successfulDocumentParser(revision.text));
      const preview = await service.preview(previewRequest(fixture), () => true);
      if (preview.status !== "changed") throw new Error(`Expected changed ${revision.kind} preview`);
      const result = await service.confirm({
        ...confirmIdentity(fixture), previewId: preview.preview.previewId,
        expectedSourceRevision: preview.preview.expectedSourceRevision
      }, () => true);
      expect(result.status, revision.kind).toBe("refreshed");
      const published = readSource(fixture);
      expect(published.artifacts.some((artifact) => artifact.kind === "extracted_text"), revision.kind).toBe(true);
      const extracted = published.artifacts.find((artifact) => artifact.kind === "extracted_text")!;
      expect(fs.readFileSync(path.join(fixture.vaultPath, extracted.path), "utf8"), revision.kind)
        .toContain(revision.text);
      expect(published.original?.checksum).toBe(checksum(revision.bytes));
    }
  });

  it("atomically refreshes PDF parser and OCR evidence as one source revision", async () => {
    const fixture = makeFixture("pdf_file", "%PDF-old\n", "evidence.pdf");
    fs.writeFileSync(fixture.originalPath, "%PDF-new\n", "utf8");
    const service = makeService(
      fixture,
      successfulDocumentParser("Fresh parsed PDF evidence", true),
      successfulPdfOcr("Fresh OCR PDF evidence")
    );

    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed PDF preview");
    const result = await service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);

    expect(result).toMatchObject({ status: "refreshed", sourceId: fixture.source.id });
    if (result.status !== "refreshed") throw new Error("Expected refreshed PDF");
    const published = readSource(fixture);
    expect(published.artifacts.map((artifact) => artifact.kind).sort())
      .toEqual(["extracted_text", "metadata", "metadata", "ocr", "rendered_page"]);
    expect(fs.readFileSync(path.join(fixture.vaultPath, "artifacts", "ocr", "2026", "07", `${fixture.source.id}.pdf.txt`), "utf8"))
      .toContain("Fresh OCR PDF evidence");
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(1);

    expect(service.undo(readOperation(fixture.vaultPath, result.operationId))).toMatchObject({ status: "undone" });
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "rendered-pages", "2026", "07", fixture.source.id, "page-0001.png")))
      .toBe(false);
    expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "ocr", "2026", "07", `${fixture.source.id}.pdf.txt`)))
      .toBe(false);
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(2);
  });

  it("recovers an interrupted PDF parser-to-OCR refresh without retaining its new page artifacts", async () => {
    const fixture = makeFixture("pdf_file", "%PDF-old\n", "evidence.pdf");
    fs.writeFileSync(fixture.originalPath, "%PDF-new\n", "utf8");
    const enteredOcr = deferred<void>();
    const blockedOcr = deferred<never>();
    const completeOcr = successfulPdfOcr("Fresh OCR PDF evidence");
    const ocr: OcrPort = {
      canOcr: completeOcr.canOcr,
      async ocrSource(...args) {
        await completeOcr.ocrSource(...args);
        enteredOcr.resolve();
        return blockedOcr.promise;
      }
    };
    const service = makeService(fixture, successfulDocumentParser("Fresh parsed PDF evidence", true), ocr);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed PDF preview");
    const confirming = service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    await enteredOcr.promise;

    const restarted = makeService(fixture, successfulDocumentParser("Fresh parsed PDF evidence", true), ocr);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "rendered-pages", "2026", "07", fixture.source.id, "page-0001.png")))
      .toBe(false);
    expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "ocr", "2026", "07", `${fixture.source.id}.pdf.txt`)))
      .toBe(false);
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toEqual([]);
    blockedOcr.reject(new Error("old process stopped"));
    await expect(confirming).resolves.toMatchObject({ status: "failed" });
  });

  it("refreshes referenced and managed images through local OCR and restores prior evidence through Undo", async () => {
    for (const managed of [false, true]) {
      const fixture = makeFixture("image_file", "old-image", managed ? "managed.png" : "evidence.png", managed);
      fs.writeFileSync(fixture.originalPath, "new-image", "utf8");
      const service = makeService(fixture, undefined, new OcrService(new StaticOcrAdapter()));
      const preview = await service.preview(previewRequest(fixture), () => true);
      expect(preview).toMatchObject({ status: "changed", preview: { sourceKind: "image_file" } });
      if (preview.status !== "changed") throw new Error("Expected changed image preview");

      const result = await service.confirm({
        ...confirmIdentity(fixture), previewId: preview.preview.previewId,
        expectedSourceRevision: preview.preview.expectedSourceRevision
      }, () => true);

      expect(result).toMatchObject({ status: "refreshed", sourcePageConflict: false });
      if (result.status !== "refreshed") throw new Error("Expected refreshed image result");
      const published = readSource(fixture);
      expect(managed ? published.managedCopy?.checksum : published.original?.checksum).toBe(checksum("new-image"));
      expect(published.metadata).toMatchObject({ ocrStatus: "completed", sourceRefreshJobId: result.jobId });
      expect(published.artifacts.map((artifact) => artifact.kind)).toEqual(["ocr", "metadata"]);
      expect(readJob(fixture.vaultPath, result.jobId)).toMatchObject({ class: "ocr", state: "completed" });
      const operation = readOperation(fixture.vaultPath, result.operationId);
      expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(1);
      expect(service.undo(operation)).toMatchObject({ status: "undone" });
      expect(readSource(fixture)).toEqual(fixture.source);
      expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "ocr", "2026", "07", `${fixture.source.id}.txt`)))
        .toBe(false);
      expect(fs.existsSync(path.join(fixture.vaultPath, "artifacts", "metadata", "2026", "07", `${fixture.source.id}.ocr.json`)))
        .toBe(false);
    }
  });

  it("rejects image Source Record drift after preview before invoking OCR", async () => {
    const fixture = makeFixture("image_file", "old-image", "evidence.png");
    fs.writeFileSync(fixture.originalPath, "new-image", "utf8");
    const ocr: OcrPort = { canOcr: () => true, ocrSource: vi.fn() };
    const service = makeService(fixture, undefined, ocr);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed image preview");
    fs.writeFileSync(fixture.sourcePath, `${JSON.stringify(SourceRecordSchema.parse({
      ...fixture.source,
      metadata: { ...fixture.source.metadata, title: "Concurrent source edit" }
    }), null, 2)}\n`, "utf8");

    await expect(service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true)).resolves.toMatchObject({ status: "stale" });
    expect(ocr.ocrSource).not.toHaveBeenCalled();
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "jobs"))).toEqual([]);
  });

  it("keeps changed images ineligible when no local OCR capability is ready", async () => {
    const fixture = makeFixture("image_file", "old-image", "evidence.png");
    fs.writeFileSync(fixture.originalPath, "new-image", "utf8");
    const ocr: OcrPort = { canOcr: () => false, ocrSource: vi.fn() };
    const service = makeService(fixture, undefined, ocr);

    await expect(service.preview(previewRequest(fixture), () => true))
      .resolves.toMatchObject({ status: "ineligible" });
    expect(ocr.ocrSource).not.toHaveBeenCalled();
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "jobs"))).toEqual([]);
  });

  it("restores the previous source revision and evidence through Activity Undo", async () => {
    const fixture = makeFixture("plain_text_file", "old evidence\n");
    fs.writeFileSync(fixture.originalPath, "new evidence\n", "utf8");
    const service = makeService(fixture);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");
    const result = await service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    if (result.status !== "refreshed") throw new Error("Expected refreshed result");
    const operation = readOperation(fixture.vaultPath, result.operationId);

    expect(service.activitySummary(operation)).toMatchObject({
      kind: "update_source_record", target: { kind: "page", pageId: "page_20260731_refresh01" }, canUndo: true
    });
    expect(service.undo(operation)).toMatchObject({ status: "undone", operationId: operation.id });
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(service.activitySummary(operation)).toMatchObject({ status: "undone", canUndo: false });
    expect(listJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(2);
  });

  it("recovers a prepared refresh after restart once and marks its rollback terminal", async () => {
    const fixture = makeFixture("pdf_file", "%PDF-old\n", "evidence.pdf");
    fs.writeFileSync(fixture.originalPath, "%PDF-new\n", "utf8");
    const enteredParser = deferred<void>();
    const blockedParser = deferred<never>();
    const parser: DocumentParserPort = {
      canParse: () => true,
      parseSource: vi.fn(async () => {
        enteredParser.resolve();
        return blockedParser.promise;
      })
    };
    const service = makeService(fixture, parser);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");
    const confirming = service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    await enteredParser.promise;
    expect(readSource(fixture).metadata.sourceRefreshInFlight).toMatch(/^op_/u);

    const restarted = makeService(fixture, parser);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    blockedParser.reject(new Error("old process stopped"));
    await expect(confirming).resolves.toMatchObject({ status: "failed" });
    expect(readSource(fixture)).toEqual(fixture.source);
  });

  it("rolls back an interrupted image OCR refresh after restart without replaying OCR", async () => {
    const fixture = makeFixture("image_file", "old-image", "evidence.png");
    fs.writeFileSync(fixture.originalPath, "new-image", "utf8");
    const enteredOcr = deferred<void>();
    const blockedOcr = deferred<never>();
    const ocr: OcrPort = {
      canOcr: () => true,
      ocrSource: vi.fn(async () => {
        enteredOcr.resolve();
        return blockedOcr.promise;
      })
    };
    const service = makeService(fixture, undefined, ocr);
    const preview = await service.preview(previewRequest(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed image preview");
    const confirming = service.confirm({
      ...confirmIdentity(fixture), previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    await enteredOcr.promise;
    const job = listJsonFiles(path.join(fixture.vaultPath, ".pige", "jobs"))
      .map((jobPath) => JobRecordSchema.parse(JSON.parse(fs.readFileSync(jobPath, "utf8"))))[0]!;
    expect(job).toMatchObject({ class: "ocr", state: "running" });
    expect(readSource(fixture).metadata.sourceRefreshInFlight).toMatch(/^op_/u);

    const restarted = makeService(fixture, undefined, ocr);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(readSource(fixture)).toEqual(fixture.source);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(ocr.ocrSource).toHaveBeenCalledTimes(1);
    blockedOcr.reject(new Error("old process stopped"));
    await expect(confirming).resolves.toMatchObject({ status: "failed" });
    expect(readSource(fixture)).toEqual(fixture.source);
  });
});

function makeFixture(
  kind: "plain_text_file" | "pdf_file" | "docx_file" | "pptx_file" | "image_file",
  body: string,
  displayName = "evidence.txt",
  managed = false
): {
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: ReturnType<typeof createVaultOnDisk>;
  readonly originalPath: string;
  readonly sourcePath: string;
  readonly source: SourceRecord;
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-refresh-")));
  roots.push(root);
  const vault = createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Refresh Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-31T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "Refresh Vault");
  const originalPath = managed ? path.join(vaultPath, "raw", "files", displayName) : path.join(root, displayName);
  fs.mkdirSync(path.dirname(originalPath), { recursive: true });
  fs.writeFileSync(originalPath, body, "utf8");
  const stat = fs.statSync(originalPath);
  const source = SourceRecordSchema.parse({
    id: "src_20260731_refresh01",
    kind,
    storageStrategy: managed ? "copy_to_source_library" : "reference_original",
    semanticOrchestration: "agent_turn",
    original: {
      uri: pathToFileURL(originalPath).href,
      path: originalPath,
      displayName,
      lastKnownMtime: stat.mtime.toISOString(),
      lastKnownSize: stat.size,
      checksum: checksum(body)
    },
    ...(managed ? { managedCopy: {
      path: path.relative(vaultPath, originalPath).split(path.sep).join("/"),
      checksum: checksum(body),
      size: stat.size
    } } : {}),
    artifacts: [],
    metadata: { title: "Evidence", parserStatus: kind === "plain_text_file" ? "text_ready" : "pending" },
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z"
  });
  const sourcePath = path.join(vaultPath, ".pige", "source-records", "2026", "07", `${source.id}.json`);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  return { root, vaultPath, vault, originalPath, sourcePath, source };
}

function makeService(
  fixture: ReturnType<typeof makeFixture>,
  parser: DocumentParserPort = { canParse: () => false, parseSource: vi.fn() },
  ocr?: OcrPort
): SourceRefreshService {
  return new SourceRefreshService(
    { current: () => fixture.vault, activeVaultPath: () => fixture.vaultPath },
    parser,
    undefined,
    ocr
  );
}

class StaticOcrAdapter implements NativeImageOcrAdapterPort {
  isAvailable(): boolean { return true; }
  async recognize(): Promise<NativeOcrResult> {
    return {
      adapterId: "macos_vision_ocr", adapterVersion: "1.0.0",
      engine: "macos_vision_document", engineVersion: "revision1",
      text: "Updated image evidence", languageHints: ["en"], confidence: 0.98, warnings: [],
      blocks: [{
        text: "Updated image evidence", kind: "line", confidence: 0.98,
        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, languageHints: ["en"], isTitle: false
      }],
      image: {
        typeIdentifier: "public.png", frameCount: 1, sourceWidth: 100, sourceHeight: 100,
        decodedWidth: 100, decodedHeight: 100, downsampled: false
      }
    };
  }
}

function successfulDocumentParser(text: string, needsOcr = false): DocumentParserPort {
  return {
    canParse: (kind) => kind === "pdf_file" || kind === "docx_file" || kind === "pptx_file",
    parseSource: async (vaultPath, sourceRecord, sourceRecordPath, job) => {
      const format = sourceRecord.kind.replace("_file", "") as "pdf" | "docx" | "pptx";
      return new ParserArtifactService().persist(vaultPath, sourceRecord, sourceRecordPath, job, {
        format,
        parser: { id: `test.${format}`, engine: "test", version: "1" },
        text,
        textCharacterCount: text.length,
        textCoverage: "high",
        truncated: false,
        needsOcr,
        agentTextReady: !needsOcr,
        ocrCandidateLocators: needsOcr ? ["page:1"] : [],
        sidecarMetadata: {},
        sourceMetadata: {},
        warnings: []
      });
    }
  };
}

function successfulPdfOcr(text: string): OcrPort {
  return {
    canOcr: (kind) => kind === "pdf_file",
    async ocrSource(vaultPath, sourceRecord, sourceRecordPath, job): Promise<OcrSourceResult> {
      expect(sourceRecord.kind).toBe("pdf_file");
      const date = /^job_(\d{8})_/u.exec(job.id)?.[1];
      if (!date) throw new Error("Expected dated refresh Job");
      const year = sourceRecord.id.slice(4, 8);
      const month = sourceRecord.id.slice(8, 10);
      const renderedPath = `artifacts/rendered-pages/${year}/${month}/${sourceRecord.id}/page-0001.png`;
      const textPath = `artifacts/ocr/${year}/${month}/${sourceRecord.id}.pdf.txt`;
      const metadataPath = `artifacts/metadata/${year}/${month}/${sourceRecord.id}.pdf-ocr.json`;
      for (const [relativePath, contents] of [
        [renderedPath, "rendered-new-page"],
        [textPath, `${text}\n`],
        [metadataPath, JSON.stringify({ sourceId: sourceRecord.id, sourceChecksum: sourceRecord.original?.checksum })]
      ] as const) {
        const target = path.join(vaultPath, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents, "utf8");
      }
      const artifacts = [
        ...sourceRecord.artifacts,
        { id: `art_${sourceRecord.id.slice(4)}_pdf_page_0001`, kind: "rendered_page" as const, path: renderedPath,
          checksum: checksum("rendered-new-page"), size: Buffer.byteLength("rendered-new-page") },
        { id: `art_${sourceRecord.id.slice(4)}_pdf_ocr_text`, kind: "ocr" as const, path: textPath,
          checksum: checksum(`${text}\n`), size: Buffer.byteLength(`${text}\n`) },
        { id: `art_${sourceRecord.id.slice(4)}_pdf_ocr_metadata`, kind: "metadata" as const, path: metadataPath,
          checksum: checksum(JSON.stringify({ sourceId: sourceRecord.id, sourceChecksum: sourceRecord.original?.checksum })),
          size: Buffer.byteLength(JSON.stringify({ sourceId: sourceRecord.id, sourceChecksum: sourceRecord.original?.checksum })) }
      ];
      const updated = SourceRecordSchema.parse({
        ...sourceRecord,
        artifacts,
        metadata: {
          ...sourceRecord.metadata,
          needsOcr: false,
          agentTextReady: true,
          ocrStatus: "completed",
          ocrJobId: job.id,
          ocrTextCharacterCount: text.length
        },
        updatedAt: "2026-08-08T12:00:00.000Z"
      });
      fs.writeFileSync(sourceRecordPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
      const operationId = `op_${date}_cafebabefeed`;
      const operationPath = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operationId}.json`);
      fs.mkdirSync(path.dirname(operationPath), { recursive: true });
      fs.writeFileSync(operationPath, `${JSON.stringify(OperationRecordSchema.parse({
        id: operationId,
        schemaVersion: 1,
        jobId: job.id,
        createdAt: "2026-08-08T12:00:00.000Z",
        actor: { kind: "system", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
        kind: "create_artifact",
        targetRefs: [{ kind: "artifact", id: `art_${sourceRecord.id.slice(4)}_pdf_ocr_text`, path: textPath }],
        sourceRefs: [{ kind: "source", id: sourceRecord.id }],
        summary: "Created refreshed PDF OCR evidence.",
        reversible: "best_effort",
        rollbackHint: "The parent source refresh owns this artifact set.",
        warnings: []
      }), null, 2)}\n`, "utf8");
      return {
        sourceId: sourceRecord.id,
        created: true,
        ocrTextArtifactPath: textPath,
        metadataArtifactPath: metadataPath,
        textCharacterCount: text.length,
        agentTextReady: true,
        warnings: [],
        sourcePageUpdated: false,
        sourcePageConflict: false,
        durableEffect: {
          outputRefs: [{ kind: "artifact", id: `art_${sourceRecord.id.slice(4)}_pdf_ocr_text`, path: textPath, role: "ocr_text" }],
          operationIds: [operationId]
        }
      };
    }
  };
}

function previewRequest(fixture: ReturnType<typeof makeFixture>) {
  return {
    apiVersion: 1 as const,
    requestId: "sourcerefreshreq_abcdefghijklmnop",
    activeVaultId: fixture.vault.vaultId,
    currentPageId: "page_20260731_refresh01",
    renderContextId: `notectx_${"a".repeat(32)}`,
    sourceId: fixture.source.id
  };
}

function confirmIdentity(fixture: ReturnType<typeof makeFixture>) {
  return { ...previewRequest(fixture), requestId: "sourcerefreshreq_qrstuvwxyzabcdef" };
}

function checksum(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readSource(fixture: ReturnType<typeof makeFixture>): SourceRecord {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(fixture.sourcePath, "utf8")));
}

function readJob(vaultPath: string, jobId: string) {
  const file = listJsonFiles(path.join(vaultPath, ".pige", "jobs")).find((candidate) => candidate.endsWith(`${jobId}.json`));
  if (!file) throw new Error(`Missing job ${jobId}`);
  return JobRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

function readOperation(vaultPath: string, operationId: string) {
  const file = listJsonFiles(path.join(vaultPath, ".pige", "operations"))
    .find((candidate) => candidate.endsWith(`${operationId}.json`));
  if (!file) throw new Error(`Missing operation ${operationId}`);
  return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

function listJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listJsonFiles(target) : entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}
