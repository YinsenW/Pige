import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MACOS_VISION_OCR_ADAPTER_VERSION,
  MACOS_VISION_OCR_PROTOCOL_VERSION,
  OCR_HELPER_MAX_OUTPUT_BYTES,
  OCR_HELPER_TIMEOUT_MS,
  OCR_MAX_BLOCKS,
  OCR_MAX_DECODED_DIMENSION,
  OCR_MAX_FILE_BYTES,
  OCR_MAX_FRAMES,
  OCR_MAX_OUTPUT_CHARACTERS,
  OCR_MAX_SOURCE_DIMENSION,
  OCR_MAX_SOURCE_PIXELS
} from "../../apps/desktop/src/main/services/ocr-types";

describe("macOS Vision OCR release manifest", () => {
  it("stays aligned with TypeScript limits, Swift protocol constants, and build entry points", () => {
    const root = process.cwd();
    const manifestPath = path.join(root, "resources/parser-manifests/macos-vision-ocr.helper.manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      helperVersion: string;
      protocolVersion: number;
      executionBoundary: string;
      sourcePath: string;
      buildScript: string;
      smokeScript: string;
      adapterSmokeTest: string;
      limits: Record<string, number>;
    };

    expect(manifest.helperVersion).toBe(MACOS_VISION_OCR_ADAPTER_VERSION);
    expect(manifest.protocolVersion).toBe(MACOS_VISION_OCR_PROTOCOL_VERSION);
    expect(manifest.executionBoundary).toBe("native_helper_process");
    expect(manifest.limits).toEqual({
      maxFileBytes: OCR_MAX_FILE_BYTES,
      maxSourcePixels: OCR_MAX_SOURCE_PIXELS,
      maxSourceDimension: OCR_MAX_SOURCE_DIMENSION,
      maxDecodedDimension: OCR_MAX_DECODED_DIMENSION,
      maxFrames: OCR_MAX_FRAMES,
      maxBlocks: OCR_MAX_BLOCKS,
      maxOutputCharacters: OCR_MAX_OUTPUT_CHARACTERS,
      maxProtocolOutputBytes: OCR_HELPER_MAX_OUTPUT_BYTES,
      timeoutMs: OCR_HELPER_TIMEOUT_MS
    });
    for (const relativePath of [manifest.sourcePath, manifest.buildScript, manifest.smokeScript, manifest.adapterSmokeTest]) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
    }

    const swiftSource = fs.readFileSync(path.join(root, manifest.sourcePath), "utf8");
    expect(swiftSource).toContain(`private let protocolVersion = ${MACOS_VISION_OCR_PROTOCOL_VERSION}`);
    expect(swiftSource).toContain(`private let helperVersion = "${MACOS_VISION_OCR_ADAPTER_VERSION}"`);
    const buildScript = fs.readFileSync(path.join(root, manifest.buildScript), "utf8");
    expect(buildScript).toContain(`const helperVersion = "${MACOS_VISION_OCR_ADAPTER_VERSION}"`);
    expect(buildScript).toContain(`const protocolVersion = ${MACOS_VISION_OCR_PROTOCOL_VERSION}`);
    expect(buildScript).toContain("buildScriptSha256");
    expect(buildScript).toContain("Developer ID signature");
  });
});
