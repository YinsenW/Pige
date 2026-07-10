import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { MacOSVisionOcrAdapter } from "../../apps/desktop/src/main/services/macos-vision-ocr-adapter";
import { materializeOfficeMedia } from "../../apps/desktop/src/main/services/office-media-materializer-core";
import type { OfficeMediaMaterializerPort } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { OcrService } from "../../apps/desktop/src/main/services/ocr-service";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import { OfficeParserService } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  type OfficeMediaTarget
} from "../../apps/desktop/src/main/services/office-parser-types";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { createTestPptx } from "./helpers/office-fixture";

const helperPath = path.join(
  process.cwd(),
  "artifacts/native/macos",
  process.arch,
  "pige-vision-ocr"
);
const hasBuiltHelper = process.platform === "darwin" && fs.existsSync(helperPath);

describe.runIf(hasBuiltHelper)("macOS Vision OCR production adapter smoke", () => {
  it("locates the verified helper and recognizes generated text through the production adapter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-adapter-smoke-"));
    try {
      const imagePath = path.join(root, "adapter-smoke.png");
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 128px Helvetica";
      context.fillText("PIGE ADAPTER OCR", 80, 300);
      fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

      const adapter = new MacOSVisionOcrAdapter();
      expect(adapter.isAvailable()).toBe(true);
      const probe = await adapter.probe();
      expect(probe).toMatchObject({
        available: true,
        helperVersion: "1.0.0",
        protocolVersion: 1,
        platform: "macos"
      });

      const result = await adapter.recognize(imagePath, ["en"]);
      const normalized = result.text.replace(/\s+/gu, " ").toLocaleUpperCase();
      expect(normalized).toContain("PIGE");
      expect(normalized).toContain("OCR");
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.image.frameCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recognizes parser-selected embedded PPTX media through the source-to-artifact pipeline", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pptx-vision-smoke-"));
    try {
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 112px Helvetica";
      context.fillText("PIGE MEDIA OCR", 90, 300);
      const pptxPath = path.join(root, "media-ocr.pptx");
      fs.writeFileSync(pptxPath, await createTestPptx(canvas.toBuffer("image/png")));
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
      const parser = new OfficeParserService({
        isAvailable: () => true,
        extract: (filePath, sourceKind) => extractOfficeText({
          requestId: "pptx-vision-smoke",
          filePath,
          sourceKind,
          limits: parserLimits()
        })
      });
      const ocr = new OcrService(
        new MacOSVisionOcrAdapter(),
        undefined,
        undefined,
        undefined,
        new InlineOfficeMediaMaterializer()
      );
      const capture = new CaptureService(vaultPort);
      const jobs = new JobsService(vaultPort, undefined, undefined, parser, ocr);
      const captured = await capture.submitFiles({
        filePaths: [pptxPath],
        inputKind: "file_drop",
        userIntent: "capture",
        locale: "en"
      });
      const sourceId = captured.sourceIds[0];
      expect(sourceId).toBeTruthy();
      jobs.processQueuedCaptures({ jobIds: captured.jobIds });
      await jobs.processQueuedParses({ sourceIds: captured.sourceIds });
      const result = await jobs.processQueuedOcr({ sourceIds: captured.sourceIds });
      const sourceRecordPath = findFile(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`);
      const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
        artifacts: Array<{ id: string; kind: string; path: string }>;
      };
      const textArtifact = sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_text"));
      expect(textArtifact).toBeTruthy();
      const text = fs.readFileSync(path.join(vaultPath, textArtifact!.path), "utf8").replace(/\s+/gu, " ").toLocaleUpperCase();

      expect(result).toMatchObject({ completed: 1, failed: 0, agentReadySourceIds: [sourceId] });
      expect(text).toContain("PIGE");
      expect(text).toContain("OCR");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

class InlineOfficeMediaMaterializer implements OfficeMediaMaterializerPort {
  isAvailable(): boolean {
    return true;
  }

  materialize(filePath: string, targets: readonly OfficeMediaTarget[]) {
    return materializeOfficeMedia({
      operation: "materialize_pptx_media",
      requestId: "pptx-vision-smoke-materializer",
      filePath,
      sourceKind: "pptx_file",
      targets,
      limits: {
        maxBytes: OFFICE_PARSER_MAX_BYTES,
        maxEntries: OFFICE_PARSER_MAX_ENTRIES,
        maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
        maxTargets: OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
        maxBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
        maxTotalBytes: OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES
      }
    });
  }
}

function parserLimits() {
  return {
    maxBytes: OFFICE_PARSER_MAX_BYTES,
    maxEntries: OFFICE_PARSER_MAX_ENTRIES,
    maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
    maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
    maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
    maxSlides: OFFICE_PARSER_MAX_SLIDES,
    maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS
  };
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileOrUndefined(child, suffix);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return child;
    }
  }
  throw new Error(`Missing fixture file ending in ${suffix}`);
}

function findFileOrUndefined(root: string, suffix: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileOrUndefined(child, suffix);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return child;
    }
  }
  return undefined;
}
