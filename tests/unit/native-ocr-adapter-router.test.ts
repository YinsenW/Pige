import { describe, expect, it } from "vitest";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import type { NativeImageOcrAdapterPort } from "../../apps/desktop/src/main/services/ocr-service";
import { NativeOcrAdapterRouter } from "../../apps/desktop/src/main/services/native-ocr-adapter-router";

const RESULT: NativeOcrResult = {
  adapterId: "macos_vision_ocr",
  engine: "macos_vision_text",
  engineVersion: "1",
  adapterVersion: "1.0.0",
  text: "visible text",
  blocks: [],
  languageHints: [],
  warnings: [],
  image: {
    typeIdentifier: "public.png",
    frameCount: 1,
    sourceWidth: 100,
    sourceHeight: 40,
    decodedWidth: 100,
    decodedHeight: 40,
    downsampled: false
  }
};

class RecordingAdapter implements NativeImageOcrAdapterPort {
  calls = 0;

  constructor(readonly available: boolean, readonly result: NativeOcrResult = RESULT) {}

  isAvailable(): boolean {
    return this.available;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.calls += 1;
    return this.result;
  }
}

describe("native OCR adapter router", () => {
  it("always prefers the native adapter when both adapters are available", async () => {
    const native = new RecordingAdapter(true);
    const fallback = new RecordingAdapter(true);
    const router = new NativeOcrAdapterRouter(native, fallback);

    await expect(router.recognize("/private/input.png", ["en-US"])).resolves.toEqual(RESULT);
    expect(native.calls).toBe(1);
    expect(fallback.calls).toBe(0);
  });

  it("uses the managed fallback only when the native adapter is unavailable", async () => {
    const native = new RecordingAdapter(false);
    const fallback = new RecordingAdapter(true);
    const router = new NativeOcrAdapterRouter(native, fallback);

    expect(router.isAvailable()).toBe(true);
    await expect(router.recognize("/private/input.png", ["zh-Hans"])).resolves.toEqual(RESULT);
    expect(native.calls).toBe(0);
    expect(fallback.calls).toBe(1);
  });

  it("honors an explicit PaddleOCR preference and safely falls back to native", async () => {
    let preference: "paddleocr_local" | "platform_native" = "paddleocr_local";
    const native = new RecordingAdapter(true);
    const fallback = new RecordingAdapter(true);
    const router = new NativeOcrAdapterRouter(native, fallback, () => preference);

    await router.recognize("/private/input.png", []);
    expect(fallback.calls).toBe(1);
    expect(native.calls).toBe(0);

    preference = "platform_native";
    await router.recognize("/private/input.png", []);
    expect(native.calls).toBe(1);
  });

  it("fails closed without invoking either adapter when no verified adapter is available", async () => {
    const native = new RecordingAdapter(false);
    const fallback = new RecordingAdapter(false);
    const router = new NativeOcrAdapterRouter(native, fallback);

    expect(router.isAvailable()).toBe(false);
    await expect(router.recognize("/private/input.png", [])).rejects.toMatchObject({
      code: "ocr.helper_unavailable"
    });
    expect(native.calls).toBe(0);
    expect(fallback.calls).toBe(0);
  });
});
