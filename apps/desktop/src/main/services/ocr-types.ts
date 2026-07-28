export const MACOS_VISION_OCR_ADAPTER_VERSION = "1.0.0";
export const PADDLE_OCR_ADAPTER_VERSION = "1.0.0";
export const MACOS_VISION_OCR_PROTOCOL_VERSION = 1;
export const OCR_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const OCR_MAX_SOURCE_PIXELS = 40_000_000;
export const OCR_MAX_SOURCE_DIMENSION = 20_000;
export const OCR_MAX_DECODED_DIMENSION = 4_096;
export const OCR_MAX_FRAMES = 1;
export const OCR_MAX_BLOCKS = 10_000;
export const OCR_MAX_OUTPUT_CHARACTERS = 1_000_000;
export const OCR_HELPER_TIMEOUT_MS = 60_000;
export const OCR_HELPER_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type NativeOcrAdapterId = "macos_vision_ocr" | "paddleocr_local";
export type NativeOcrEngineId = "macos_vision_document" | "macos_vision_text" | "Paddle";

export type NativeOcrIdentity =
  | {
    readonly adapterId: "macos_vision_ocr";
    readonly adapterVersion: typeof MACOS_VISION_OCR_ADAPTER_VERSION;
    readonly engine: "macos_vision_document" | "macos_vision_text";
    readonly engineVersion: string;
  }
  | {
    readonly adapterId: "paddleocr_local";
    readonly adapterVersion: typeof PADDLE_OCR_ADAPTER_VERSION;
    readonly engine: "Paddle";
    readonly engineVersion: string;
  };

export interface NativeOcrBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeOcrBlock {
  readonly text: string;
  readonly kind: "line";
  readonly confidence: number;
  readonly boundingBox: NativeOcrBoundingBox;
  readonly languageHints: readonly string[];
  readonly isTitle: boolean;
}

export interface NativeOcrImageMetadata {
  readonly typeIdentifier: string;
  readonly frameCount: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly downsampled: boolean;
}

export type NativeOcrResult = NativeOcrIdentity & {
  readonly text: string;
  readonly blocks: readonly NativeOcrBlock[];
  readonly languageHints: readonly string[];
  readonly confidence?: number;
  readonly warnings: readonly string[];
  readonly image: NativeOcrImageMetadata;
};

export function isSupportedNativeOcrIdentity(value: unknown): value is NativeOcrIdentity {
  if (!isRecord(value) || !isSafeIdentityVersion(value.engineVersion)) return false;
  return (
    value.adapterId === "macos_vision_ocr" &&
    value.adapterVersion === MACOS_VISION_OCR_ADAPTER_VERSION &&
    (value.engine === "macos_vision_document" || value.engine === "macos_vision_text")
  ) || (
    value.adapterId === "paddleocr_local" &&
    value.adapterVersion === PADDLE_OCR_ADAPTER_VERSION &&
    value.engine === "Paddle"
  );
}

function isSafeIdentityVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface MacOSVisionOcrHelperDescriptor {
  readonly binaryPath: string;
  readonly binaryChecksum: string;
  readonly helperVersion: typeof MACOS_VISION_OCR_ADAPTER_VERSION;
  readonly protocolVersion: typeof MACOS_VISION_OCR_PROTOCOL_VERSION;
}
