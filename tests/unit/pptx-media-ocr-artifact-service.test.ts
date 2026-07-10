import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { NativeImageOcrAdapterPort } from "../../apps/desktop/src/main/services/ocr-service";
import { OcrService } from "../../apps/desktop/src/main/services/ocr-service";
import type { OfficeMediaMaterializerPort } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import { OfficeParserService } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_MEDIA_MATERIALIZER_ID,
  OFFICE_MEDIA_MATERIALIZER_VERSION,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  type OfficeMediaTarget
} from "../../apps/desktop/src/main/services/office-parser-types";
import {
  PptxMediaOcrArtifactService,
  type PptxMediaOcrItemResult
} from "../../apps/desktop/src/main/services/pptx-media-ocr-artifact-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { JobRecordSchema, SourceRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import { createTestPptx, TINY_PNG } from "./helpers/office-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PPTX media OCR artifact service", () => {
  it("persists locator-correct media OCR once and reuses body-free metadata", async () => {
    const setup = await makeParsedPptx();
    const service = new PptxMediaOcrArtifactService();
    const target = await service.resolveTarget(setup.vaultPath, setup.sourceRecord);
    expect(target.targets).toEqual([{
      slide: 1,
      parentLocator: "slide:1",
      mediaIndex: 1,
      locator: "slide:1/media:1",
      packagePath: "ppt/media/image1.png",
      size: TINY_PNG.length,
      extension: ".png"
    }]);

    const result = await service.persist(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      [itemResult(target.targets[0]!, "Roadmap screenshot knowledge")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const textArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_text")));
    const metadataArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_metadata")));
    const text = fs.readFileSync(path.join(setup.vaultPath, textArtifact.path), "utf8");
    const sidecarText = fs.readFileSync(path.join(setup.vaultPath, metadataArtifact.path), "utf8");
    const sourcePage = fs.readFileSync(path.join(setup.vaultPath, requireValue(finalRecord.knowledgePagePath)), "utf8");

    expect(result).toMatchObject({ created: true, agentTextReady: true });
    expect(text).toBe("--- Slide 1 Media 1 ---\nRoadmap screenshot knowledge\n");
    expect(sidecarText).toContain('"locator": "slide:1/media:1/ocr:block:1"');
    expect(sidecarText).toContain('"parentLocator": "slide:1"');
    expect(sidecarText).not.toContain("Roadmap screenshot knowledge");
    expect(sourcePage).toContain("Roadmap screenshot knowledge");
    expect(finalRecord.artifacts.some((artifact) => artifact.id.endsWith("_pptx_text"))).toBe(true);
    expect(finalRecord.metadata).toMatchObject({
      parserStatus: "parsed_needs_ocr",
      ocrStatus: "completed",
      ocrProcessedMediaCount: 1,
      ocrSkippedMediaCount: 0,
      needsOcr: false,
      agentTextReady: true
    });

    expect(await service.readExisting(
      setup.vaultPath,
      finalRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    )).toMatchObject({ created: false, agentTextReady: true });
  });

  it("keeps useful native slide text ready when selected media OCR is empty", async () => {
    const setup = await makeParsedPptx();
    const service = new PptxMediaOcrArtifactService();
    const target = await service.resolveTarget(setup.vaultPath, setup.sourceRecord);

    const result = await service.persist(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      [itemResult(target.targets[0]!, "")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const sidecarArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_metadata")));
    const sidecar = JSON.parse(fs.readFileSync(path.join(setup.vaultPath, sidecarArtifact.path), "utf8")) as Record<string, unknown>;

    expect(result).toMatchObject({ agentTextReady: true, textCharacterCount: 0 });
    expect(finalRecord.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(false);
    expect(finalRecord.metadata).toMatchObject({
      ocrStatus: "completed_empty",
      ocrProcessedMediaCount: 1,
      needsOcr: false,
      agentTextReady: true
    });
    expect(sidecar).toMatchObject({
      nativeTextReady: true,
      ocrTextReady: false,
      agentTextReady: true,
      complete: true
    });
    expect(await service.readExisting(
      setup.vaultPath,
      finalRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    )).toMatchObject({ created: false, agentTextReady: true, textCharacterCount: 0 });
  });

  it("rejects a detected Source Record update before final OCR replacement", async () => {
    const setup = await makeParsedPptx();
    const service = new PptxMediaOcrArtifactService();
    const target = await service.resolveTarget(setup.vaultPath, setup.sourceRecord);
    const ordinary = itemResult(target.targets[0]!, "Do not overwrite newer metadata");
    let changed = false;
    const racing = {
      target: ordinary.target,
      mediaChecksum: ordinary.mediaChecksum,
      mediaSize: ordinary.mediaSize,
      get result() {
        if (!changed) {
          changed = true;
          const current = readSourceRecord(setup.sourceRecordPath);
          fs.writeFileSync(setup.sourceRecordPath, `${JSON.stringify({
            ...current,
            metadata: { ...current.metadata, concurrentMarker: "newer-record" },
            updatedAt: "2026-07-10T08:03:00.000Z"
          }, null, 2)}\n`, "utf8");
        }
        return ordinary.result;
      }
    } satisfies PptxMediaOcrItemResult;

    await expect(service.persist(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      [racing]
    )).rejects.toMatchObject({ code: "ocr.pptx.target_changed" });
    expect(readSourceRecord(setup.sourceRecordPath).metadata.concurrentMarker).toBe("newer-record");
  });

  it("rejects parser-sidecar drift before materializing selected media", async () => {
    const setup = await makeParsedPptx();
    const metadata = requireValue(setup.sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_metadata")));
    fs.appendFileSync(path.join(setup.vaultPath, metadata.path), " ");

    await expect(new PptxMediaOcrArtifactService().resolveTarget(setup.vaultPath, setup.sourceRecord))
      .rejects.toMatchObject({ code: "ocr.pptx.parser_metadata_invalid" });
  });

  it.skipIf(process.platform === "win32")("rejects OCR artifact writes through a parent symlink outside the vault", async () => {
    const setup = await makeParsedPptx();
    const service = new PptxMediaOcrArtifactService();
    const target = await service.resolveTarget(setup.vaultPath, setup.sourceRecord);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pptx-ocr-outside-"));
    tempRoots.push(outside);
    fs.symlinkSync(outside, path.join(setup.vaultPath, "artifacts", "ocr"), "dir");

    await expect(service.persist(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      [itemResult(target.targets[0]!, "Must stay inside the vault")]
    )).rejects.toMatchObject({ code: "ocr.path_outside_vault" });
    expect(listFiles(outside, ".txt")).toHaveLength(0);
  });

  it("runs materialized bytes through a private disposable OCR input", async () => {
    const setup = await makeParsedPptx();
    const materializer = new StaticOfficeMediaMaterializer();
    const adapter = new InspectingOcrAdapter();
    const service = new OcrService(adapter, undefined, undefined, undefined, materializer);

    const result = await service.ocrSource(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    );

    expect(result).toMatchObject({ created: true, agentTextReady: true });
    expect(materializer.inputPath).toBeTruthy();
    expect(materializer.inputPath).not.toBe(path.join(setup.vaultPath, requireValue(setup.sourceRecord.managedCopy?.path)));
    expect(fs.existsSync(requireValue(materializer.inputPath))).toBe(false);
    expect(adapter.inputPath).toBeTruthy();
    expect(fs.existsSync(requireValue(adapter.inputPath))).toBe(false);
    expect(adapter.inputBytes).toEqual(TINY_PNG);
  });

  it("supports a verified referenced-original PPTX without copying its path into OCR metadata", async () => {
    const setup = await makeParsedPptx();
    const referenced = SourceRecordSchema.parse({
      ...setup.sourceRecord,
      storageStrategy: "reference_original",
      managedCopy: undefined,
      original: {
        ...setup.sourceRecord.original,
        path: setup.originalPath,
        checksum: checksum(fs.readFileSync(setup.originalPath)),
        lastKnownSize: fs.statSync(setup.originalPath).size
      }
    });
    fs.writeFileSync(setup.sourceRecordPath, `${JSON.stringify(referenced, null, 2)}\n`, "utf8");
    const service = new PptxMediaOcrArtifactService();
    const target = await service.resolveTarget(setup.vaultPath, referenced);
    await service.persist(
      setup.vaultPath,
      referenced,
      setup.sourceRecordPath,
      setup.ocrJob,
      [itemResult(target.targets[0]!, "Referenced source evidence")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const metadata = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_metadata")));
    const sidecar = fs.readFileSync(path.join(setup.vaultPath, metadata.path), "utf8");

    expect(sidecar).toContain('"sourceLocation": "referenced_original"');
    expect(sidecar).not.toContain(setup.originalPath);
  });
});

class StaticOfficeMediaMaterializer implements OfficeMediaMaterializerPort {
  inputPath: string | undefined;

  isAvailable(): boolean {
    return true;
  }

  async materialize(filePath: string, targets: readonly OfficeMediaTarget[]) {
    this.inputPath = filePath;
    expect(fs.existsSync(filePath)).toBe(true);
    return {
      materializerId: OFFICE_MEDIA_MATERIALIZER_ID,
      materializerVersion: OFFICE_MEDIA_MATERIALIZER_VERSION,
      media: targets.map((target) => ({ ...target, bytes: Uint8Array.from(TINY_PNG) }))
    };
  }
}

class InspectingOcrAdapter implements NativeImageOcrAdapterPort {
  inputPath: string | undefined;
  inputBytes: Buffer | undefined;

  isAvailable(): boolean {
    return true;
  }

  async recognize(inputPath: string): Promise<NativeOcrResult> {
    this.inputPath = inputPath;
    this.inputBytes = fs.readFileSync(inputPath);
    return nativeResult("Private media OCR evidence");
  }
}

async function makeParsedPptx(): Promise<{
  readonly vaultPath: string;
  readonly originalPath: string;
  readonly sourceRecordPath: string;
  readonly sourceRecord: SourceRecord;
  readonly ocrJob: JobRecord;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pptx-media-ocr-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "Vault");
  const vault = loadVaultSummary(vaultPath);
  const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
  const capture = new CaptureService(vaultPort);
  const parser = new OfficeParserService({
    isAvailable: () => true,
    extract: (filePath, sourceKind) => extractOfficeText({
      requestId: "pptx-media-ocr-test",
      filePath,
      sourceKind,
      limits: {
        maxBytes: OFFICE_PARSER_MAX_BYTES,
        maxEntries: OFFICE_PARSER_MAX_ENTRIES,
        maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
        maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
        maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
        maxSlides: OFFICE_PARSER_MAX_SLIDES,
        maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS
      }
    })
  });
  const jobs = new JobsService(vaultPort, undefined, undefined, parser);
  const originalPath = path.join(root, "roadmap.pptx");
  fs.writeFileSync(originalPath, await createTestPptx());
  const captured = await capture.submitFiles({
    filePaths: [originalPath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(captured.sourceIds[0]);
  jobs.processQueuedCaptures({ jobIds: captured.jobIds });
  await jobs.processQueuedParses({ sourceIds: [sourceId] });
  const sourceRecordPath = requireValue(listFiles(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`)[0]);
  return {
    vaultPath,
    originalPath,
    sourceRecordPath,
    sourceRecord: readSourceRecord(sourceRecordPath),
    ocrJob: JobRecordSchema.parse({
      id: `job_20260710_${"pptxocr".padEnd(12, "0")}`,
      class: "ocr",
      state: "running",
      sourceId,
      createdAt: "2026-07-10T08:01:00.000Z",
      updatedAt: "2026-07-10T08:01:00.000Z",
      message: "PPTX media OCR test"
    })
  };
}

function itemResult(target: OfficeMediaTarget, text: string): PptxMediaOcrItemResult {
  return {
    target,
    mediaChecksum: checksum(TINY_PNG),
    mediaSize: TINY_PNG.length,
    result: nativeResult(text)
  };
}

function nativeResult(text: string): NativeOcrResult {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text,
    blocks: text ? [{
      text,
      kind: "line",
      confidence: 0.94,
      boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.12 },
      languageHints: ["en"],
      isTitle: true
    }] : [],
    languageHints: text ? ["en"] : [],
    ...(text ? { confidence: 0.94 } : {}),
    warnings: text ? [] : ["ocr_empty_text"],
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

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readSourceRecord(filePath: string): SourceRecord {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(child);
  }
  return files.sort();
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}
