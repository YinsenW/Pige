import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobCancellationError } from "./job-execution-control";
import type { NativeImageOcrAdapterPort } from "./ocr-service";
import {
  OCR_HELPER_MAX_OUTPUT_BYTES,
  OCR_HELPER_TIMEOUT_MS,
  OCR_MAX_BLOCKS,
  OCR_MAX_DECODED_DIMENSION,
  OCR_MAX_FILE_BYTES,
  OCR_MAX_FRAMES,
  OCR_MAX_OUTPUT_CHARACTERS,
  OCR_MAX_SOURCE_DIMENSION,
  OCR_MAX_SOURCE_PIXELS,
  PADDLE_OCR_ADAPTER_VERSION,
  isSupportedNativeOcrIdentity,
  type NativeOcrBlock,
  type NativeOcrResult
} from "./ocr-types";

const PADDLE_OCR_PROTOCOL_VERSION = 1;
const PADDLE_WRAPPER_RELATIVE_PATH = "pige/paddle_ocr_wrapper.py";
const MAX_REQUEST_BYTES = 64 * 1024;

export interface PaddleOcrRuntimeLease {
  readonly runtimeRoot: string;
  readonly pythonExecutablePath: string;
  readonly engineVersion: string;
}

export interface PaddleOcrRuntimeLeasePort {
  isAvailable(): boolean;
  withVerifiedRuntime<T>(
    callback: (runtime: PaddleOcrRuntimeLease) => Promise<T>
  ): Promise<T>;
}

export interface PaddleOcrProcessRequest {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly networkAllowed: false;
  readonly shell: false;
  readonly signal?: AbortSignal;
}

export interface PaddleOcrProcessResult {
  readonly stdout: string;
}

export interface PaddleOcrProcessRunner {
  run(request: PaddleOcrProcessRequest): Promise<PaddleOcrProcessResult>;
}

interface PaddleOcrHelperRequest {
  readonly schemaVersion: typeof PADDLE_OCR_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "recognize";
  readonly inputPath: string;
  readonly preferredLanguages: readonly string[];
  readonly networkAllowed: false;
  readonly limits: {
    readonly maxFileBytes: number;
    readonly maxSourcePixels: number;
    readonly maxSourceDimension: number;
    readonly maxDecodedDimension: number;
    readonly maxFrames: number;
    readonly maxBlocks: number;
    readonly maxOutputCharacters: number;
  };
}

export class PaddleOcrAdapter implements NativeImageOcrAdapterPort {
  readonly #leases: PaddleOcrRuntimeLeasePort;
  readonly #runner: PaddleOcrProcessRunner;

  constructor(leases: PaddleOcrRuntimeLeasePort, runner: PaddleOcrProcessRunner) {
    this.#leases = leases;
    this.#runner = runner;
  }

  isAvailable(): boolean {
    return this.#leases.isAvailable();
  }

  async recognize(
    inputPath: string,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): Promise<NativeOcrResult> {
    if (signal?.aborted) throw new JobCancellationError();
    const verifiedInputPath = await validateInputFile(inputPath);
    if (!this.#leases.isAvailable()) throw helperUnavailable();
    return this.#leases.withVerifiedRuntime(async (lease) => {
      const runtime = await validateRuntimeLease(lease);
      const requestId = `ocr_${randomUUID().replaceAll("-", "")}`;
      const helperRequest: PaddleOcrHelperRequest = {
        schemaVersion: PADDLE_OCR_PROTOCOL_VERSION,
        requestId,
        operation: "recognize",
        inputPath: verifiedInputPath,
        preferredLanguages: normalizeLanguageHints(preferredLanguages),
        networkAllowed: false,
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
      const stdin = JSON.stringify(helperRequest);
      if (Buffer.byteLength(stdin, "utf8") > MAX_REQUEST_BYTES) {
        throw new PigeDomainError("ocr.helper_request_too_large", "The OCR helper request exceeded its protocol limit.");
      }

      const processResult = await this.#run({
        executablePath: runtime.pythonExecutablePath,
        args: ["-I", "-B", runtime.wrapperPath],
        cwd: runtime.runtimeRoot,
        env: createOfflineEnvironment(runtime.runtimeRoot),
        stdin,
        timeoutMs: OCR_HELPER_TIMEOUT_MS,
        maxOutputBytes: OCR_HELPER_MAX_OUTPUT_BYTES,
        networkAllowed: false,
        shell: false,
        ...(signal ? { signal } : {})
      });
      if (Buffer.byteLength(processResult.stdout, "utf8") > OCR_HELPER_MAX_OUTPUT_BYTES) {
        throw outputTooLarge();
      }
      return parseRecognitionResponse(processResult.stdout, requestId, lease.engineVersion);
    });
  }

  async #run(request: PaddleOcrProcessRequest): Promise<PaddleOcrProcessResult> {
    try {
      return await this.#runner.run(request);
    } catch (error) {
      if (error instanceof JobCancellationError) throw error;
      if (error instanceof PigeDomainError) throw normalizedRunnerError(error.code);
      throw helperFailed();
    }
  }
}

export class SpawnPaddleOcrProcessRunner implements PaddleOcrProcessRunner {
  run(request: PaddleOcrProcessRequest): Promise<PaddleOcrProcessResult> {
    if (request.signal?.aborted) return Promise.reject(new JobCancellationError());
    return new Promise((resolve, reject) => {
      const child = spawn(request.executablePath, [...request.args], {
        cwd: request.cwd,
        env: { ...request.env },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      let timedOut = false;
      let exceededOutput = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = (): void => {
        child.kill("SIGKILL");
        finish(() => reject(new JobCancellationError()));
      };
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);
      request.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > request.maxOutputBytes) {
          exceededOutput = true;
          child.kill("SIGKILL");
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on("data", () => undefined);
      child.once("error", () => finish(() => reject(helperLaunchFailed())));
      child.once("close", (code, closeSignal) => {
        if (settled) return;
        if (exceededOutput) {
          finish(() => reject(outputTooLarge()));
          return;
        }
        if (timedOut) {
          finish(() => reject(helperTimeout()));
          return;
        }
        if (code !== 0 || closeSignal) {
          finish(() => reject(helperFailed()));
          return;
        }
        finish(() => resolve({ stdout: Buffer.concat(chunks).toString("utf8") }));
      });
      child.stdin.once("error", () => finish(() => reject(helperFailed())));
      child.stdin.end(request.stdin);
    });
  }
}

async function validateInputFile(inputPath: string): Promise<string> {
  if (!path.isAbsolute(inputPath)) throw invalidInput();
  try {
    const resolvedPath = path.resolve(inputPath);
    const entry = await fs.promises.lstat(resolvedPath);
    if (!entry.isFile() || entry.isSymbolicLink()) throw invalidInput();
    const realPath = await fs.promises.realpath(resolvedPath);
    const handle = await fs.promises.open(
      realPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    try {
      const descriptor = await handle.stat();
      if (
        !descriptor.isFile() ||
        descriptor.size <= 0 ||
        descriptor.size > OCR_MAX_FILE_BYTES ||
        descriptor.dev !== entry.dev ||
        descriptor.ino !== entry.ino
      ) {
        if (descriptor.size > OCR_MAX_FILE_BYTES) throw inputTooLarge();
        throw invalidInput();
      }
    } finally {
      await handle.close();
    }
    return realPath;
  } catch (error) {
    if (error instanceof PigeDomainError) throw error;
    throw invalidInput();
  }
}

async function validateRuntimeLease(lease: PaddleOcrRuntimeLease): Promise<{
  readonly runtimeRoot: string;
  readonly pythonExecutablePath: string;
  readonly wrapperPath: string;
}> {
  try {
    if (!path.isAbsolute(lease.runtimeRoot) || !path.isAbsolute(lease.pythonExecutablePath)) throw helperUnavailable();
    const runtimeRoot = path.resolve(lease.runtimeRoot);
    const rootEntry = await fs.promises.lstat(runtimeRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw helperUnavailable();
    const realRoot = await fs.promises.realpath(runtimeRoot);
    const pythonExecutablePath = await validateRuntimeFile(realRoot, lease.pythonExecutablePath);
    const wrapperPath = await validateRuntimeFile(realRoot, path.join(realRoot, PADDLE_WRAPPER_RELATIVE_PATH));
    return { runtimeRoot: realRoot, pythonExecutablePath, wrapperPath };
  } catch (error) {
    if (error instanceof PigeDomainError) throw error;
    throw helperUnavailable();
  }
}

async function validateRuntimeFile(runtimeRoot: string, candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const entry = await fs.promises.lstat(resolved);
  if (!entry.isFile() || entry.isSymbolicLink()) throw helperUnavailable();
  const realPath = await fs.promises.realpath(resolved);
  const realRelative = path.relative(runtimeRoot, realPath);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw helperUnavailable();
  return realPath;
}

function createOfflineEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries({
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL,
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PIGE_NETWORK_DISABLED: "1",
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
    PADDLE_PDX_CACHE_HOME: path.join(runtimeRoot, "models"),
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: ""
  }).filter((entry) => typeof entry[1] === "string"));
}

function parseRecognitionResponse(stdout: string, requestId: string, leasedEngineVersion: string): NativeOcrResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim()) as unknown;
  } catch {
    throw invalidResponse();
  }
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "requestId", "ok", "result"])) {
    throw invalidResponse();
  }
  if (value.schemaVersion !== PADDLE_OCR_PROTOCOL_VERSION || value.requestId !== requestId || value.ok !== true) {
    throw invalidResponse();
  }
  const result = value.result;
  if (!isRecord(result)) throw invalidResponse();
  const allowedResultKeys = [
    "adapterId", "adapterVersion", "engine", "engineVersion", "text", "blocks",
    "languageHints", "confidence", "warnings", "image"
  ];
  if (!hasOnlyKeys(result, allowedResultKeys) || !hasRequiredKeys(result, allowedResultKeys.filter((key) => key !== "confidence"))) {
    throw invalidResponse();
  }
  if (
    result.adapterId !== "paddleocr_local" ||
    result.adapterVersion !== PADDLE_OCR_ADAPTER_VERSION ||
    result.engine !== "Paddle" ||
    result.engineVersion !== leasedEngineVersion ||
    typeof result.text !== "string" ||
    result.text.length > OCR_MAX_OUTPUT_CHARACTERS ||
    !Array.isArray(result.blocks) ||
    result.blocks.length > OCR_MAX_BLOCKS ||
    !Array.isArray(result.languageHints) ||
    !Array.isArray(result.warnings) ||
    !isRecord(result.image)
  ) {
    throw invalidResponse();
  }
  const blocks = result.blocks.map(parseBlock);
  if (blocks.map((block) => block.text).join("\n") !== result.text) throw invalidResponse();
  const languageHints = parseStringList(result.languageHints, 16, 35, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);
  const warnings = parseStringList(result.warnings, 32, 80, /^[a-z0-9_]+$/u);
  const image = parseImage(result.image);
  if (result.confidence !== undefined && !isNormalizedNumber(result.confidence)) throw invalidResponse();
  const identity = {
    adapterId: "paddleocr_local",
    adapterVersion: PADDLE_OCR_ADAPTER_VERSION,
    engine: "Paddle",
    engineVersion: leasedEngineVersion
  } as const;
  if (!isSupportedNativeOcrIdentity(identity)) throw invalidResponse();
  return {
    ...identity,
    text: result.text,
    blocks,
    languageHints,
    ...(typeof result.confidence === "number" ? { confidence: result.confidence } : {}),
    warnings,
    image
  };
}

function parseBlock(value: unknown): NativeOcrBlock {
  if (!isRecord(value) || !hasExactKeys(value, [
    "text", "kind", "confidence", "boundingBox", "languageHints", "isTitle"
  ])) throw invalidResponse();
  if (
    typeof value.text !== "string" || value.text.length === 0 || value.text.length > OCR_MAX_OUTPUT_CHARACTERS ||
    value.kind !== "line" || !isNormalizedNumber(value.confidence) || !isRecord(value.boundingBox) ||
    !Array.isArray(value.languageHints) || typeof value.isTitle !== "boolean"
  ) throw invalidResponse();
  const box = value.boundingBox;
  if (!hasExactKeys(box, ["x", "y", "width", "height"]) ||
    ![box.x, box.y, box.width, box.height].every(isNormalizedNumber) ||
    (box.x as number) + (box.width as number) > 1.000_001 ||
    (box.y as number) + (box.height as number) > 1.000_001) throw invalidResponse();
  return {
    text: value.text,
    kind: "line",
    confidence: value.confidence,
    boundingBox: { x: box.x as number, y: box.y as number, width: box.width as number, height: box.height as number },
    languageHints: parseStringList(value.languageHints, 8, 35, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u),
    isTitle: value.isTitle
  };
}

function parseImage(value: Record<string, unknown>): NativeOcrResult["image"] {
  if (!hasExactKeys(value, [
    "typeIdentifier", "frameCount", "sourceWidth", "sourceHeight",
    "decodedWidth", "decodedHeight", "downsampled"
  ])) throw invalidResponse();
  const numbers = [value.frameCount, value.sourceWidth, value.sourceHeight, value.decodedWidth, value.decodedHeight];
  if (
    typeof value.typeIdentifier !== "string" || value.typeIdentifier.length === 0 || value.typeIdentifier.length > 160 ||
    numbers.some((number) => !Number.isSafeInteger(number) || (number as number) <= 0) ||
    typeof value.frameCount !== "number" || typeof value.sourceWidth !== "number" ||
    typeof value.sourceHeight !== "number" || typeof value.decodedWidth !== "number" ||
    typeof value.decodedHeight !== "number" || value.frameCount > OCR_MAX_FRAMES ||
    value.sourceWidth > OCR_MAX_SOURCE_DIMENSION || value.sourceHeight > OCR_MAX_SOURCE_DIMENSION ||
    value.sourceWidth > Math.floor(OCR_MAX_SOURCE_PIXELS / value.sourceHeight) ||
    value.decodedWidth > OCR_MAX_DECODED_DIMENSION || value.decodedHeight > OCR_MAX_DECODED_DIMENSION ||
    typeof value.downsampled !== "boolean"
  ) throw invalidResponse();
  return {
    typeIdentifier: value.typeIdentifier,
    frameCount: value.frameCount,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    decodedWidth: value.decodedWidth,
    decodedHeight: value.decodedHeight,
    downsampled: value.downsampled
  };
}

function parseStringList(value: readonly unknown[], maxItems: number, maxLength: number, pattern: RegExp): string[] {
  if (value.length > maxItems) throw invalidResponse();
  const parsed = value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLength || !pattern.test(item)) {
      throw invalidResponse();
    }
    return item;
  });
  if (new Set(parsed).size !== parsed.length) throw invalidResponse();
  return parsed;
}

function normalizeLanguageHints(values: readonly string[]): string[] {
  return Array.from(new Set(values
    .map((value) => value.trim().replaceAll("_", "-"))
    .filter((value) => /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value))))
    .slice(0, 8);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(value, keys) && hasRequiredKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasRequiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidInput(): PigeDomainError {
  return new PigeDomainError("ocr.input_invalid", "The OCR input is not a verified regular file.");
}

function inputTooLarge(): PigeDomainError {
  return new PigeDomainError("ocr.input_too_large", "The OCR input exceeds the local size limit.");
}

function helperUnavailable(): PigeDomainError {
  return new PigeDomainError("ocr.helper_unavailable", "The verified PaddleOCR runtime is unavailable.");
}

function helperLaunchFailed(): PigeDomainError {
  return new PigeDomainError("ocr.helper_launch_failed", "The local OCR helper could not be launched.");
}

function helperTimeout(): PigeDomainError {
  return new PigeDomainError("ocr.helper_timeout", "The local OCR helper exceeded its time limit.");
}

function helperFailed(): PigeDomainError {
  return new PigeDomainError("ocr.helper_failed", "The local OCR helper exited without a valid response.");
}

function outputTooLarge(): PigeDomainError {
  return new PigeDomainError("ocr.helper_output_too_large", "The OCR helper response exceeded its protocol limit.");
}

function invalidResponse(): PigeDomainError {
  return new PigeDomainError("ocr.helper_invalid_response", "The local OCR helper returned an invalid recognition response.");
}

function normalizedRunnerError(code: string): PigeDomainError {
  switch (code) {
    case "ocr.helper_launch_failed": return helperLaunchFailed();
    case "ocr.helper_timeout": return helperTimeout();
    case "ocr.helper_output_too_large": return outputTooLarge();
    case "ocr.helper_invalid_response": return invalidResponse();
    default: return helperFailed();
  }
}
