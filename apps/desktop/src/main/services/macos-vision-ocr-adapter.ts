import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
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
  OCR_MAX_SOURCE_PIXELS,
  type MacOSVisionOcrHelperDescriptor,
  type NativeOcrBlock,
  type NativeOcrResult
} from "./ocr-types";
import { JobCancellationError } from "./job-execution-control";

export interface OcrHelperRequest {
  readonly schemaVersion: typeof MACOS_VISION_OCR_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "probe" | "recognize";
  readonly inputPath?: string;
  readonly preferredLanguages?: readonly string[];
  readonly limits?: {
    readonly maxFileBytes: number;
    readonly maxSourcePixels: number;
    readonly maxSourceDimension: number;
    readonly maxDecodedDimension: number;
    readonly maxFrames: number;
    readonly maxBlocks: number;
    readonly maxOutputCharacters: number;
  };
}

export interface MacOSVisionOcrProbe {
  readonly available: boolean;
  readonly helperVersion: string;
  readonly protocolVersion: number;
  readonly platform: "macos";
  readonly operatingSystemVersion: string;
  readonly engines: readonly { readonly id: string; readonly revision: string }[];
}

export interface OcrHelperRunner {
  run(helper: MacOSVisionOcrHelperDescriptor, request: OcrHelperRequest, signal?: AbortSignal): Promise<unknown>;
}

export type OcrHelperLocator = () => MacOSVisionOcrHelperDescriptor | undefined;

export class MacOSVisionOcrAdapter {
  readonly #locateHelper: OcrHelperLocator;
  readonly #platform: NodeJS.Platform;
  readonly #runner: OcrHelperRunner;

  constructor(
    locateHelper: OcrHelperLocator = locateVerifiedMacOSVisionOcrHelper,
    runner: OcrHelperRunner = new JsonOcrHelperRunner(),
    platform: NodeJS.Platform = process.platform
  ) {
    this.#locateHelper = locateHelper;
    this.#runner = runner;
    this.#platform = platform;
  }

  isAvailable(): boolean {
    return this.#platform === "darwin" && Boolean(this.#locateHelper());
  }

  async probe(): Promise<MacOSVisionOcrProbe> {
    const helper = this.#requireHelper();
    const request: OcrHelperRequest = {
      schemaVersion: MACOS_VISION_OCR_PROTOCOL_VERSION,
      requestId: createRequestId(),
      operation: "probe"
    };
    const response = await this.#runner.run(helper, request);
    return parseProbeResponse(response, request.requestId);
  }

  async recognize(
    inputPath: string,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): Promise<NativeOcrResult> {
    const helper = this.#requireHelper();
    const request: OcrHelperRequest = {
      schemaVersion: MACOS_VISION_OCR_PROTOCOL_VERSION,
      requestId: createRequestId(),
      operation: "recognize",
      inputPath,
      preferredLanguages: normalizeLanguageHints(preferredLanguages),
      limits: {
        maxFileBytes: OCR_MAX_FILE_BYTES,
        maxSourcePixels: OCR_MAX_SOURCE_PIXELS,
        maxSourceDimension: OCR_MAX_SOURCE_DIMENSION,
        maxDecodedDimension: OCR_MAX_DECODED_DIMENSION,
        maxFrames: OCR_MAX_FRAMES,
        maxBlocks: OCR_MAX_BLOCKS,
        maxOutputCharacters: OCR_MAX_OUTPUT_CHARACTERS
      }
    };
    const response = await this.#runner.run(helper, request, signal);
    return parseRecognitionResponse(response, request.requestId);
  }

  #requireHelper(): MacOSVisionOcrHelperDescriptor {
    if (this.#platform !== "darwin") {
      throw new PigeDomainError("ocr.platform_unsupported", "Apple Vision OCR is available only on supported macOS systems.");
    }
    const helper = this.#locateHelper();
    if (!helper) {
      throw new PigeDomainError("ocr.helper_unavailable", "The bundled macOS Vision OCR helper is missing or failed integrity verification.");
    }
    return helper;
  }
}

export class JsonOcrHelperRunner implements OcrHelperRunner {
  readonly #maxOutputBytes: number;
  readonly #timeoutMs: number;

  constructor(timeoutMs = OCR_HELPER_TIMEOUT_MS, maxOutputBytes = OCR_HELPER_MAX_OUTPUT_BYTES) {
    this.#timeoutMs = timeoutMs;
    this.#maxOutputBytes = maxOutputBytes;
  }

  run(helper: MacOSVisionOcrHelperDescriptor, request: OcrHelperRequest, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new JobCancellationError());
    return new Promise((resolve, reject) => {
      const child = spawn(helper.binaryPath, [], {
        cwd: path.parse(helper.binaryPath).root,
        env: sanitizedHelperEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = (): void => {
        child.kill("SIGKILL");
        finish(() => reject(new JobCancellationError()));
      };
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > this.#maxOutputBytes) {
          child.kill("SIGKILL");
          finish(() => reject(new PigeDomainError("ocr.helper_output_too_large", "The OCR helper response exceeded its protocol limit.")));
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += Math.min(chunk.byteLength, 8 * 1024 - stderrBytes);
      });
      child.once("error", () => {
        finish(() => reject(new PigeDomainError("ocr.helper_launch_failed", "The local OCR helper could not be launched.")));
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        if (timedOut) {
          const error = stdoutBytes > this.#maxOutputBytes
            ? new PigeDomainError("ocr.helper_output_too_large", "The OCR helper response exceeded its protocol limit.")
            : new PigeDomainError("ocr.helper_timeout", "The local OCR helper exceeded its time limit.");
          finish(() => reject(error));
          return;
        }
        if (code !== 0 || signal) {
          finish(() => reject(new PigeDomainError("ocr.helper_failed", "The local OCR helper exited without a valid response.")));
          return;
        }
        try {
          const output = Buffer.concat(stdoutChunks).toString("utf8").trim();
          if (!output) throw new Error("empty");
          const parsed = JSON.parse(output) as unknown;
          finish(() => resolve(parsed));
        } catch {
          finish(() => reject(new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned invalid JSON.")));
        }
      });

      const payload = Buffer.from(JSON.stringify(request), "utf8");
      if (payload.byteLength > 64 * 1024) {
        child.kill("SIGKILL");
        finish(() => reject(new PigeDomainError("ocr.helper_request_too_large", "The OCR helper request exceeded its protocol limit.")));
        return;
      }
      child.stdin.end(payload);
    });
  }
}

export function locateVerifiedMacOSVisionOcrHelper(): MacOSVisionOcrHelperDescriptor | undefined {
  if (process.platform !== "darwin") return undefined;
  const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
  const candidates = [
    ...(resourcesPath ? [
      path.join(resourcesPath, "native/macos", process.arch, "pige-vision-ocr"),
      path.join(resourcesPath, "artifacts/native/macos", process.arch, "pige-vision-ocr")
    ] : []),
    path.resolve(process.cwd(), "artifacts/native/macos", process.arch, "pige-vision-ocr"),
    path.resolve(process.cwd(), "../../artifacts/native/macos", process.arch, "pige-vision-ocr")
  ];
  for (const candidate of candidates) {
    const verified = verifyHelper(candidate);
    if (verified) return verified;
  }
  return undefined;
}

function verifyHelper(binaryPath: string): MacOSVisionOcrHelperDescriptor | undefined {
  try {
    const binaryStat = fs.lstatSync(binaryPath);
    if (!binaryStat.isFile() || binaryStat.isSymbolicLink() || (binaryStat.mode & 0o111) === 0) return undefined;
    const manifest = JSON.parse(fs.readFileSync(`${binaryPath}.manifest.json`, "utf8")) as unknown;
    if (!isRecord(manifest)) return undefined;
    const checksum = checksumFile(binaryPath);
    if (
      manifest.schemaVersion !== 1 ||
      manifest.id !== "pige-vision-ocr" ||
      manifest.helperVersion !== MACOS_VISION_OCR_ADAPTER_VERSION ||
      manifest.protocolVersion !== MACOS_VISION_OCR_PROTOCOL_VERSION ||
      manifest.platform !== "macos" ||
      manifest.arch !== process.arch ||
      manifest.binarySize !== binaryStat.size ||
      manifest.binarySha256 !== checksum
    ) {
      return undefined;
    }
    return {
      binaryPath,
      binaryChecksum: checksum,
      helperVersion: MACOS_VISION_OCR_ADAPTER_VERSION,
      protocolVersion: MACOS_VISION_OCR_PROTOCOL_VERSION
    };
  } catch {
    return undefined;
  }
}

function parseProbeResponse(value: unknown, requestId: string): MacOSVisionOcrProbe {
  const envelope = parseEnvelope(value, requestId);
  const probe = isRecord(envelope.probe) ? envelope.probe : undefined;
  if (
    !probe ||
    typeof probe.available !== "boolean" ||
    probe.helperVersion !== MACOS_VISION_OCR_ADAPTER_VERSION ||
    probe.protocolVersion !== MACOS_VISION_OCR_PROTOCOL_VERSION ||
    probe.platform !== "macos" ||
    typeof probe.operatingSystemVersion !== "string" ||
    !Array.isArray(probe.engines)
  ) {
    throw new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid capability response.");
  }
  const engines = probe.engines.map((engine) => {
    if (!isRecord(engine) || typeof engine.id !== "string" || typeof engine.revision !== "string") {
      throw new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid engine descriptor.");
    }
    return { id: engine.id.slice(0, 80), revision: engine.revision.slice(0, 80) };
  }).slice(0, 8);
  return {
    available: probe.available,
    helperVersion: probe.helperVersion,
    protocolVersion: probe.protocolVersion,
    platform: "macos",
    operatingSystemVersion: probe.operatingSystemVersion.slice(0, 80),
    engines
  };
}

function parseRecognitionResponse(value: unknown, requestId: string): NativeOcrResult {
  const envelope = parseEnvelope(value, requestId);
  const result = isRecord(envelope.result) ? envelope.result : undefined;
  if (!result) throw invalidRecognitionResponse();
  const engine = result.engine === "macos_vision_document" || result.engine === "macos_vision_text"
    ? result.engine
    : undefined;
  if (
    !engine ||
    typeof result.engineVersion !== "string" ||
    result.adapterVersion !== MACOS_VISION_OCR_ADAPTER_VERSION ||
    typeof result.text !== "string" ||
    result.text.length > OCR_MAX_OUTPUT_CHARACTERS ||
    !Array.isArray(result.blocks) ||
    result.blocks.length > OCR_MAX_BLOCKS ||
    !Array.isArray(result.languageHints) ||
    !Array.isArray(result.warnings) ||
    !isRecord(result.image)
  ) {
    throw invalidRecognitionResponse();
  }
  const blocks = result.blocks.map(parseBlock);
  if (blocks.map((block) => block.text).join("\n") !== result.text) throw invalidRecognitionResponse();
  const languageHints = parseStringList(result.languageHints, 16, 35, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);
  const warnings = parseStringList(result.warnings, 32, 80, /^[a-z0-9_]+$/u);
  const image = result.image;
  const frameCount = image.frameCount;
  const sourceWidth = image.sourceWidth;
  const sourceHeight = image.sourceHeight;
  const decodedWidth = image.decodedWidth;
  const decodedHeight = image.decodedHeight;
  const imageNumbers = [
    frameCount,
    sourceWidth,
    sourceHeight,
    decodedWidth,
    decodedHeight
  ];
  if (
    typeof image.typeIdentifier !== "string" ||
    image.typeIdentifier.length === 0 ||
    image.typeIdentifier.length > 160 ||
    imageNumbers.some((number) => !Number.isSafeInteger(number) || (number as number) <= 0) ||
    typeof frameCount !== "number" ||
    typeof sourceWidth !== "number" ||
    typeof sourceHeight !== "number" ||
    typeof decodedWidth !== "number" ||
    typeof decodedHeight !== "number" ||
    frameCount > OCR_MAX_FRAMES ||
    sourceWidth > OCR_MAX_SOURCE_DIMENSION ||
    sourceHeight > OCR_MAX_SOURCE_DIMENSION ||
    sourceWidth > Math.floor(OCR_MAX_SOURCE_PIXELS / sourceHeight) ||
    decodedWidth > OCR_MAX_DECODED_DIMENSION ||
    decodedHeight > OCR_MAX_DECODED_DIMENSION ||
    typeof image.downsampled !== "boolean"
  ) {
    throw invalidRecognitionResponse();
  }
  const confidence = result.confidence;
  if (confidence !== null && confidence !== undefined && !isNormalizedNumber(confidence)) {
    throw invalidRecognitionResponse();
  }
  return {
    engine,
    engineVersion: result.engineVersion.slice(0, 80),
    adapterVersion: MACOS_VISION_OCR_ADAPTER_VERSION,
    text: result.text,
    blocks,
    languageHints,
    ...(typeof confidence === "number" ? { confidence } : {}),
    warnings,
    image: {
      typeIdentifier: image.typeIdentifier,
      frameCount,
      sourceWidth,
      sourceHeight,
      decodedWidth,
      decodedHeight,
      downsampled: image.downsampled
    }
  };
}

function parseEnvelope(value: unknown, requestId: string): Record<string, unknown> {
  if (!isRecord(value) || value.schemaVersion !== MACOS_VISION_OCR_PROTOCOL_VERSION || value.requestId !== requestId) {
    throw new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid protocol envelope.");
  }
  if (value.ok === false) {
    const error = isRecord(value.error) ? value.error : undefined;
    const code = typeof error?.code === "string" && /^ocr\.[a-z0-9_.]+$/u.test(error.code)
      ? error.code
      : "ocr.helper_failed";
    const message = typeof error?.message === "string" && error.message.length > 0
      ? error.message.slice(0, 240)
      : "The local OCR helper failed.";
    throw new PigeDomainError(code, message);
  }
  if (value.ok !== true) {
    throw new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid success flag.");
  }
  return value;
}

function parseBlock(value: unknown): NativeOcrBlock {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text.length > OCR_MAX_OUTPUT_CHARACTERS ||
    value.kind !== "line" ||
    !isNormalizedNumber(value.confidence) ||
    !isRecord(value.boundingBox) ||
    !Array.isArray(value.languageHints) ||
    typeof value.isTitle !== "boolean"
  ) {
    throw invalidRecognitionResponse();
  }
  const box = value.boundingBox;
  if (
    ![box.x, box.y, box.width, box.height].every(isNormalizedNumber) ||
    (box.x as number) + (box.width as number) > 1.000_001 ||
    (box.y as number) + (box.height as number) > 1.000_001
  ) {
    throw invalidRecognitionResponse();
  }
  return {
    text: value.text,
    kind: "line",
    confidence: value.confidence,
    boundingBox: { x: box.x as number, y: box.y as number, width: box.width as number, height: box.height as number },
    languageHints: parseStringList(value.languageHints, 8, 35, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u),
    isTitle: value.isTitle
  };
}

function parseStringList(value: readonly unknown[], maxItems: number, maxLength: number, pattern: RegExp): string[] {
  if (value.length > maxItems) throw invalidRecognitionResponse();
  const strings = value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLength || !pattern.test(item)) {
      throw invalidRecognitionResponse();
    }
    return item;
  });
  if (new Set(strings).size !== strings.length) throw invalidRecognitionResponse();
  return strings;
}

function normalizeLanguageHints(values: readonly string[]): string[] {
  return Array.from(new Set(values
    .map((value) => value.trim().replaceAll("_", "-"))
    .filter((value) => /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value))))
    .slice(0, 8);
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidRecognitionResponse(): PigeDomainError {
  return new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid recognition response.");
}

function sanitizedHelperEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR
  }).filter((entry) => typeof entry[1] === "string"));
}

function checksumFile(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function createRequestId(): string {
  return `ocr_${randomUUID().replaceAll("-", "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
