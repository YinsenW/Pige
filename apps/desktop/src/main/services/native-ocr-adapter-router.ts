import { PigeDomainError } from "@pige/domain";
import type { OcrEnginePreference } from "@pige/schemas";
import type { NativeImageOcrAdapterPort } from "./ocr-service";

export class NativeOcrAdapterRouter implements NativeImageOcrAdapterPort {
  readonly #nativeAdapter: NativeImageOcrAdapterPort;
  readonly #fallbackAdapter: NativeImageOcrAdapterPort;
  readonly #preference: () => OcrEnginePreference;

  constructor(
    nativeAdapter: NativeImageOcrAdapterPort,
    fallbackAdapter: NativeImageOcrAdapterPort,
    preference?: (() => OcrEnginePreference) | undefined
  ) {
    this.#nativeAdapter = nativeAdapter;
    this.#fallbackAdapter = fallbackAdapter;
    this.#preference = preference ?? (() => "automatic");
  }

  isAvailable(): boolean {
    return this.#nativeAdapter.isAvailable() || this.#fallbackAdapter.isAvailable();
  }

  recognize(
    inputPath: string,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
    const ordered = this.#preference() === "paddleocr_local"
      ? [this.#fallbackAdapter, this.#nativeAdapter]
      : [this.#nativeAdapter, this.#fallbackAdapter];
    for (const adapter of ordered) {
      if (adapter.isAvailable()) return adapter.recognize(inputPath, preferredLanguages, signal);
    }
    return Promise.reject(new PigeDomainError(
      "ocr.helper_unavailable",
      "No verified local OCR adapter is available."
    ));
  }

  recognizeBytes(
    bytes: Uint8Array,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
    const ordered = this.#preference() === "paddleocr_local"
      ? [this.#fallbackAdapter, this.#nativeAdapter]
      : [this.#nativeAdapter, this.#fallbackAdapter];
    for (const adapter of ordered) {
      if (adapter.isAvailable() && adapter.recognizeBytes) {
        return adapter.recognizeBytes(bytes, preferredLanguages, signal);
      }
    }
    return Promise.reject(new PigeDomainError(
      "ocr.pptx.bytes_adapter_unavailable",
      "No verified local OCR adapter accepts in-memory rendered pixels."
    ));
  }
}
