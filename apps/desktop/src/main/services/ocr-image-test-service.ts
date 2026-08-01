import {
  OcrImageTestResultSchema,
  type OcrImageTestRequest,
  type OcrImageTestResult
} from "@pige/schemas";
import type { OcrLanguagePreferenceService } from "./ocr-language-preference-service";
import type { NativeImageOcrAdapterPort } from "./ocr-service";

const PREVIEW_LIMIT = 4_096;

export class OcrImageTestService {
  readonly #adapter: NativeImageOcrAdapterPort;
  readonly #languages: OcrLanguagePreferenceService;
  #active = false;

  constructor(adapter: NativeImageOcrAdapterPort, languages: OcrLanguagePreferenceService) {
    this.#adapter = adapter;
    this.#languages = languages;
  }

  async run(request: OcrImageTestRequest, inputPath: string): Promise<OcrImageTestResult> {
    if (this.#active) return result(request, "busy");
    if (!this.#adapter.isAvailable()) return result(request, "unavailable");
    this.#active = true;
    try {
      const recognized = await this.#adapter.recognize(
        inputPath,
        this.#languages.policyLanguageHints()
      );
      const text = recognized.text.slice(0, PREVIEW_LIMIT);
      return OcrImageTestResultSchema.parse({
        ...identity(request),
        status: "ready",
        preview: {
          adapterId: recognized.adapterId,
          engine: recognized.engine,
          engineVersion: recognized.engineVersion,
          text,
          truncated: text.length < recognized.text.length,
          blockCount: recognized.blocks.length,
          ...(recognized.confidence === undefined ? {} : { confidence: recognized.confidence }),
          languageHints: recognized.languageHints.slice(0, 8),
          warnings: recognized.warnings.slice(0, 8).map((warning) => warning.slice(0, 160))
        }
      });
    } catch {
      return result(request, this.#adapter.isAvailable() ? "failed" : "unavailable");
    } finally {
      this.#active = false;
    }
  }
}

function identity(request: OcrImageTestRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId };
}

function result(
  request: OcrImageTestRequest,
  status: "busy" | "failed" | "unavailable"
): OcrImageTestResult {
  return OcrImageTestResultSchema.parse({ ...identity(request), status });
}
