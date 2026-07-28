import { PigeDomainError } from "@pige/domain";
import type { NativeImageOcrAdapterPort } from "./ocr-service";

export class NativeOcrAdapterRouter implements NativeImageOcrAdapterPort {
  readonly #nativeAdapter: NativeImageOcrAdapterPort;
  readonly #fallbackAdapter: NativeImageOcrAdapterPort;

  constructor(
    nativeAdapter: NativeImageOcrAdapterPort,
    fallbackAdapter: NativeImageOcrAdapterPort
  ) {
    this.#nativeAdapter = nativeAdapter;
    this.#fallbackAdapter = fallbackAdapter;
  }

  isAvailable(): boolean {
    return this.#nativeAdapter.isAvailable() || this.#fallbackAdapter.isAvailable();
  }

  recognize(
    inputPath: string,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
    if (this.#nativeAdapter.isAvailable()) {
      return this.#nativeAdapter.recognize(inputPath, preferredLanguages, signal);
    }
    if (this.#fallbackAdapter.isAvailable()) {
      return this.#fallbackAdapter.recognize(inputPath, preferredLanguages, signal);
    }
    return Promise.reject(new PigeDomainError(
      "ocr.helper_unavailable",
      "No verified local OCR adapter is available."
    ));
  }
}
