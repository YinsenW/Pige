import { describe, expect, it } from "vitest";
import { OcrImageTestService } from "../../apps/desktop/src/main/services/ocr-image-test-service";
import { OcrLanguagePreferenceService } from "../../apps/desktop/src/main/services/ocr-language-preference-service";
import type { NativeImageOcrAdapterPort } from "../../apps/desktop/src/main/services/ocr-service";

const request = { apiVersion: 1, requestId: "ocrimagetest_abcdefghijklmnop" } as const;

function adapter(overrides: Partial<NativeImageOcrAdapterPort> = {}): NativeImageOcrAdapterPort {
  return {
    isAvailable: () => true,
    recognize: async (_path, languages) => ({
      adapterId: "macos_vision_ocr",
      adapterVersion: "1.0.0",
      engine: "macos_vision_document",
      engineVersion: "1",
      text: "hello",
      blocks: [{
        text: "hello", kind: "line", confidence: 0.9,
        boundingBox: { x: 0, y: 0, width: 1, height: 1 }, languageHints: [...languages], isTitle: false
      }],
      languageHints: [...languages], confidence: 0.9, warnings: [],
      image: { typeIdentifier: "public.png", frameCount: 1, sourceWidth: 10, sourceHeight: 10, decodedWidth: 10, decodedHeight: 10, downsampled: false }
    }),
    ...overrides
  };
}

describe("OcrImageTestService", () => {
  it("returns a bounded renderer-safe preview without persisting the selected path", async () => {
    const result = await new OcrImageTestService(adapter(), new OcrLanguagePreferenceService())
      .run(request, "/private/user/image.png");
    expect(result).toMatchObject({ status: "ready", preview: { text: "hello", blockCount: 1 } });
    expect(JSON.stringify(result)).not.toContain("/private/user");
  });

  it("fails closed when no local adapter is available", async () => {
    const result = await new OcrImageTestService(adapter({ isAvailable: () => false }), new OcrLanguagePreferenceService())
      .run(request, "/private/user/image.png");
    expect(result).toEqual({ ...request, status: "unavailable" });
  });

  it("serializes tests and truncates oversized recognized text", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const slow = adapter({ recognize: async (...args) => { await pending; return adapter().recognize(...args); } });
    const service = new OcrImageTestService(slow, new OcrLanguagePreferenceService());
    const first = service.run(request, "/tmp/one.png");
    await expect(service.run({ ...request, requestId: "ocrimagetest_ponmlkjihgfedcba" }, "/tmp/two.png"))
      .resolves.toMatchObject({ status: "busy" });
    release();
    await expect(first).resolves.toMatchObject({ status: "ready" });

    const oversized = adapter({ recognize: async (...args) => ({ ...(await adapter().recognize(...args)), text: "x".repeat(5_000) }) });
    const truncated = await new OcrImageTestService(oversized, new OcrLanguagePreferenceService()).run(request, "/tmp/three.png");
    expect(truncated).toMatchObject({ status: "ready", preview: { truncated: true } });
    if (truncated.status === "ready") expect(truncated.preview.text).toHaveLength(4_096);
  });
});
