import { describe, expect, it } from "vitest";
import {
  MacOSVisionOcrAdapter,
  type OcrHelperRequest,
  type OcrHelperRunner
} from "../../apps/desktop/src/main/services/macos-vision-ocr-adapter";
import type { MacOSVisionOcrHelperDescriptor } from "../../apps/desktop/src/main/services/ocr-types";

const helper: MacOSVisionOcrHelperDescriptor = {
  binaryPath: "/verified/pige-vision-ocr",
  binaryChecksum: `sha256:${"a".repeat(64)}`,
  helperVersion: "1.0.0",
  protocolVersion: 1
};

describe("macOS Vision OCR adapter", () => {
  it("normalizes language hints and validates a structured helper result", async () => {
    const runner = new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: validResult()
    }));
    const adapter = new MacOSVisionOcrAdapter(() => helper, runner, "darwin");

    const result = await adapter.recognize("/vault/raw/files/image.png", ["zh_Hans", "en", "bad language", "en"]);

    expect(result).toMatchObject({
      engine: "macos_vision_document",
      adapterVersion: "1.0.0",
      text: "Pige OCR"
    });
    expect(runner.lastRequest?.preferredLanguages).toEqual(["zh-Hans", "en"]);
    expect(runner.lastRequest?.inputPath).toBe("/vault/raw/files/image.png");
    expect(runner.lastRequest?.limits).toMatchObject({ maxFrames: 1, maxDecodedDimension: 4096 });
  });

  it("rejects mismatched text, invalid geometry, and uncorrelated envelopes", async () => {
    const mismatched = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { ...validResult(), text: "different" }
    })), "darwin");
    await expect(mismatched.recognize("/vault/image.png", ["en"])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });

    const invalidGeometry = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: {
        ...validResult(),
        blocks: [{ ...validResult().blocks[0], boundingBox: { x: -1, y: 0, width: 1, height: 1 } }]
      }
    })), "darwin");
    await expect(invalidGeometry.recognize("/vault/image.png", ["en"])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });

    const overflowingGeometry = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: {
        ...validResult(),
        blocks: [{ ...validResult().blocks[0], boundingBox: { x: 0.8, y: 0.2, width: 0.5, height: 0.1 } }]
      }
    })), "darwin");
    await expect(overflowingGeometry.recognize("/vault/image.png", ["en"])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });

    const uncorrelated = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner(() => ({
      schemaVersion: 1,
      requestId: "ocr_wrong_request",
      ok: true,
      result: validResult()
    })), "darwin");
    await expect(uncorrelated.recognize("/vault/image.png", ["en"])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });
  });

  it("maps helper failures without accepting arbitrary error codes", async () => {
    const stable = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: { code: "ocr.image.invalid", message: "The image is invalid." }
    })), "darwin");
    await expect(stable.recognize("/vault/image.png", [])).rejects.toMatchObject({ code: "ocr.image.invalid" });

    const arbitrary = new MacOSVisionOcrAdapter(() => helper, new CapturingRunner((request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      ok: false,
      error: { code: "shell.execute_anything", message: "/private/path leaked" }
    })), "darwin");
    await expect(arbitrary.recognize("/vault/image.png", [])).rejects.toMatchObject({ code: "ocr.helper_failed" });
  });

  it("stays unavailable off macOS or when helper integrity is unavailable", () => {
    expect(new MacOSVisionOcrAdapter(() => helper, new CapturingRunner(() => undefined), "win32").isAvailable()).toBe(false);
    expect(new MacOSVisionOcrAdapter(() => undefined, new CapturingRunner(() => undefined), "darwin").isAvailable()).toBe(false);
  });
});

class CapturingRunner implements OcrHelperRunner {
  lastRequest: OcrHelperRequest | undefined;
  readonly #response: (request: OcrHelperRequest) => unknown;

  constructor(response: (request: OcrHelperRequest) => unknown) {
    this.#response = response;
  }

  async run(_helper: MacOSVisionOcrHelperDescriptor, request: OcrHelperRequest): Promise<unknown> {
    this.lastRequest = request;
    return this.#response(request);
  }
}

function validResult() {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text: "Pige OCR",
    blocks: [{
      text: "Pige OCR",
      kind: "line",
      confidence: 0.98,
      boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 },
      languageHints: ["en"],
      isTitle: true
    }],
    languageHints: ["en"],
    confidence: 0.98,
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1600,
      sourceHeight: 500,
      decodedWidth: 1600,
      decodedHeight: 500,
      downsampled: false
    }
  };
}
