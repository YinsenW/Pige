import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PigeDomainError } from "@pige/domain";
import type { SpeechNativePort, SpeechNativeProbeResult, SpeechNativeStartResult } from "./speech-service";

const SPEECH_HELPER_VERSION = "1.1.0";
const SPEECH_PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 128 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const START_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 15_000;
const ASSET_INSTALL_TIMEOUT_MS = 30 * 60_000;

interface SpeechHelperDescriptor {
  readonly binaryPath: string;
  readonly binarySha256: string;
}

interface ActiveHelperSession {
  readonly sessionId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly onTranscript: (transcript: string) => void;
  readonly onMeter: (elapsedMs: number, level: number) => void;
  readonly onFailure: () => void;
  readonly framer: SpeechProtocolFramer;
  stderrBytes: number;
  settled: boolean;
  blocked: boolean;
  finalTranscript?: string;
  stopPromise?: Promise<string>;
  resolveStop?: (transcript: string) => void;
  rejectStop?: () => void;
}

interface ActiveAssetInstall {
  readonly installationId: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly onProgress: (completedFraction: number) => void;
  readonly framer: SpeechProtocolFramer;
  readonly closed: Promise<void>;
  readonly resolveClosed: () => void;
  stderrBytes: number;
  settled: boolean;
  failed: boolean;
}

export class MacOSSpeechAdapter implements SpeechNativePort {
  readonly #locateHelper: () => SpeechHelperDescriptor | undefined;
  #active: ActiveHelperSession | undefined;
  #assetInstall: ActiveAssetInstall | undefined;

  constructor(locateHelper: () => SpeechHelperDescriptor | undefined = locateVerifiedMacOSSpeechHelper) {
    this.#locateHelper = locateHelper;
  }

  async probe(languageTag: string): Promise<SpeechNativeProbeResult> {
    const helper = this.#requireHelper();
    const result = spawnSync(helper.binaryPath, ["--probe", languageTag], {
      cwd: path.parse(helper.binaryPath).root,
      env: sanitizedEnvironment(),
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: MAX_LINE_BYTES,
      shell: false,
      windowsHide: true
    });
    if (result.error || result.status !== 0 || result.signal || result.stderr.length > MAX_LINE_BYTES) {
      throw new PigeDomainError("speech.probe_failed", "The local speech capability probe failed.");
    }
    const response = parseJsonLine(result.stdout.trim());
    if (response.kind !== "probe" || response.protocolVersion !== SPEECH_PROTOCOL_VERSION) {
      throw new PigeDomainError("speech.invalid_response", "The local speech helper returned an invalid probe.");
    }
    const permission = parsePermission(response.permission);
    if (response.status === "supported") return { status: "supported", permission };
    if (["language_unavailable", "assets_unavailable", "service_unavailable"].includes(String(response.reason))) {
      return {
        status: "unsupported",
        reason: response.reason as "language_unavailable" | "assets_unavailable" | "service_unavailable",
        permission
      };
    }
    throw new PigeDomainError("speech.invalid_response", "The local speech helper returned an invalid probe.");
  }

  async start(input: {
    readonly sessionId: string;
    readonly languageTag: string;
    readonly onTranscript: (transcript: string) => void;
    readonly onMeter: (elapsedMs: number, level: number) => void;
    readonly onFailure: () => void;
  }): Promise<SpeechNativeStartResult> {
    if (this.#active || this.#assetInstall) {
      throw new PigeDomainError("speech.session_busy", "A local speech operation is already active.");
    }
    const helper = this.#requireHelper();
    const child = spawn(helper.binaryPath, ["--session", input.sessionId, input.languageTag], {
      cwd: path.parse(helper.binaryPath).root,
      env: sanitizedEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const session: ActiveHelperSession = {
      sessionId: input.sessionId,
      child,
      onTranscript: input.onTranscript,
      onMeter: input.onMeter,
      onFailure: input.onFailure,
      framer: new SpeechProtocolFramer(),
      stderrBytes: 0,
      settled: false,
      blocked: false
    };
    this.#active = session;
    return new Promise<SpeechNativeStartResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#terminate(session);
        reject(new PigeDomainError("speech.start_timeout", "The local speech helper did not become ready."));
      }, START_TIMEOUT_MS);
      const rejectStart = (): void => {
        clearTimeout(timer);
        if (this.#active === session) this.#active = undefined;
        reject(new PigeDomainError("speech.start_failed", "The local speech helper could not start."));
      };
      child.once("error", rejectStart);
      child.stdout.on("data", (chunk: Buffer) => this.#consume(session, chunk, (result) => {
        clearTimeout(timer);
        child.removeListener("error", rejectStart);
        resolve(result);
      }));
      child.stderr.on("data", (chunk: Buffer) => {
        session.stderrBytes += chunk.byteLength;
        if (session.stderrBytes > MAX_LINE_BYTES) this.#terminate(session);
      });
      child.once("close", () => {
        try {
          session.framer.end();
          if (!session.settled) rejectStart();
          else this.#closed(session);
        } catch {
          rejectStart();
          session.rejectStop?.();
          session.onFailure();
        }
      });
    });
  }

  async installLanguageAsset(input: {
    readonly installationId: string;
    readonly languageTag: string;
    readonly onProgress: (completedFraction: number) => void;
  }): Promise<void> {
    if (this.#active || this.#assetInstall) {
      throw new PigeDomainError("speech.asset_install_busy", "A local speech operation is already active.");
    }
    const helper = this.#requireHelper();
    const child = spawn(helper.binaryPath, ["--install", input.installationId, input.languageTag], {
      cwd: path.parse(helper.binaryPath).root,
      env: sanitizedEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let resolveClosed = (): void => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const install: ActiveAssetInstall = {
      installationId: input.installationId,
      child,
      onProgress: input.onProgress,
      framer: new SpeechProtocolFramer(),
      closed,
      resolveClosed,
      stderrBytes: 0,
      settled: false,
      failed: false
    };
    this.#assetInstall = install;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => failInstall(), ASSET_INSTALL_TIMEOUT_MS);
      timer.unref();
      const failInstall = (): void => {
        if (install.failed) return;
        install.failed = true;
        this.#terminateAssetInstall(install);
      };
      child.once("error", failInstall);
      child.stdout.on("data", (chunk: Buffer) => {
        if (this.#assetInstall !== install) return;
        try {
          for (const line of install.framer.push(chunk)) {
            const event = parseJsonLine(line);
            if (
              event.protocolVersion !== SPEECH_PROTOCOL_VERSION ||
              event.installationId !== install.installationId
            ) {
              throw new Error("identity");
            }
            if (
              event.kind === "asset_install_progress" &&
              typeof event.completedFraction === "number" &&
              Number.isFinite(event.completedFraction) &&
              event.completedFraction >= 0 &&
              event.completedFraction <= 1
            ) {
              install.onProgress(event.completedFraction);
              continue;
            }
            if (event.kind === "asset_installed" && !install.settled) {
              install.settled = true;
              continue;
            }
            if (event.kind === "asset_install_failed") {
              failInstall();
              return;
            }
            throw new Error("shape");
          }
        } catch {
          failInstall();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        install.stderrBytes += chunk.byteLength;
        if (install.stderrBytes > MAX_LINE_BYTES) {
          failInstall();
        }
      });
      child.once("close", (code, signal) => {
        install.resolveClosed();
        try {
          install.framer.end();
        } catch {
          clearTimeout(timer);
          if (this.#assetInstall === install) this.#assetInstall = undefined;
          reject(new PigeDomainError("speech.asset_install_failed", "The language asset installation failed."));
          return;
        }
        clearTimeout(timer);
        if (this.#assetInstall === install) this.#assetInstall = undefined;
        if (install.failed || !install.settled || code !== 0 || signal !== null) {
          reject(new PigeDomainError("speech.asset_install_failed", "The language asset installation failed."));
          return;
        }
        resolve();
      });
    });
  }

  async abandonLanguageAssetInstall(installationId: string): Promise<void> {
    const install = this.#assetInstall;
    if (!install || install.installationId !== installationId) return;
    this.#terminateAssetInstall(install);
    await install.closed;
    if (this.#assetInstall === install) this.#assetInstall = undefined;
  }

  async stop(sessionId: string): Promise<string> {
    const session = this.#active;
    if (!session || session.sessionId !== sessionId) {
      throw new PigeDomainError("speech.stale_session", "The local speech session is no longer active.");
    }
    if (session.stopPromise) return session.stopPromise;
    session.stopPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#terminate(session);
        reject(new PigeDomainError("speech.stop_timeout", "The local speech helper did not stop in time."));
      }, STOP_TIMEOUT_MS);
      session.resolveStop = (transcript) => {
        clearTimeout(timer);
        resolve(transcript);
      };
      session.rejectStop = () => {
        clearTimeout(timer);
        reject(new PigeDomainError("speech.stop_failed", "The local speech helper did not finalize transcription."));
      };
    });
    session.child.stdin.write(`${JSON.stringify({ operation: "stop", sessionId })}\n`);
    return session.stopPromise;
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.#active;
    if (!session || session.sessionId !== sessionId) return;
    this.#active = undefined;
    if (!session.settled) {
      this.#terminate(session);
      return;
    }
    try {
      session.child.stdin.end(`${JSON.stringify({ operation: "cancel", sessionId })}\n`);
    } catch {
      this.#terminate(session);
    }
    setTimeout(() => this.#terminate(session), 500).unref();
  }

  #consume(
    session: ActiveHelperSession,
    chunk: Buffer,
    ready: (result: SpeechNativeStartResult) => void
  ): void {
    if (this.#active !== session) return;
    try {
      for (const line of session.framer.push(chunk)) {
        try {
          const event = parseJsonLine(line);
          if (event.protocolVersion !== SPEECH_PROTOCOL_VERSION || event.sessionId !== session.sessionId) {
            throw new Error("identity");
          }
          if (event.kind === "ready" && !session.settled) {
            session.settled = true;
            ready({
              status: "started",
              metering: event.metering === "available" ? "available" : "unavailable"
            });
          } else if (
            event.kind === "blocked" &&
            !session.settled &&
            (event.reason === "permission_denied" || event.reason === "permission_restricted")
          ) {
            session.settled = true;
            session.blocked = true;
            if (this.#active === session) this.#active = undefined;
            ready({ status: "blocked", reason: event.reason });
          } else if (
            event.kind === "meter" &&
            session.settled &&
            Number.isInteger(event.elapsedMs) &&
            Number(event.elapsedMs) >= 0 &&
            typeof event.level === "number" &&
            Number.isFinite(event.level) &&
            event.level >= 0 &&
            event.level <= 1
          ) {
            session.onMeter(Number(event.elapsedMs), event.level);
          } else if (event.kind === "transcript" && session.settled && typeof event.transcript === "string") {
            session.onTranscript(event.transcript.slice(0, 32_000));
          } else if (event.kind === "final" && session.settled && typeof event.transcript === "string") {
            session.finalTranscript = event.transcript.slice(0, 32_000);
          } else if (event.kind === "failed") {
            session.rejectStop?.();
            session.onFailure();
            this.#terminate(session);
          } else {
            throw new Error("shape");
          }
        } catch {
          session.rejectStop?.();
          session.onFailure();
          this.#terminate(session);
          return;
        }
      }
    } catch {
      session.rejectStop?.();
      session.onFailure();
      this.#terminate(session);
    }
  }

  #closed(session: ActiveHelperSession): void {
    if (this.#active === session) this.#active = undefined;
    if (session.blocked) return;
    if (session.resolveStop && session.finalTranscript !== undefined) {
      session.resolveStop(session.finalTranscript);
      return;
    }
    if (session.settled) {
      session.rejectStop?.();
      session.onFailure();
    }
  }

  #terminate(session: ActiveHelperSession): void {
    if (this.#active === session) this.#active = undefined;
    if (!session.child.killed) session.child.kill("SIGKILL");
  }

  #terminateAssetInstall(install: ActiveAssetInstall): void {
    if (!install.child.killed) install.child.kill("SIGKILL");
  }

  #requireHelper(): SpeechHelperDescriptor {
    if (process.platform !== "darwin") {
      throw new PigeDomainError("speech.unsupported_platform", "Local dictation is unavailable on this platform.");
    }
    const helper = this.#locateHelper();
    if (!helper) throw new PigeDomainError("speech.helper_unavailable", "The local speech helper is unavailable.");
    return helper;
  }
}

export class SpeechProtocolFramer {
  readonly #decoder = new StringDecoder("utf8");
  #buffer = "";
  #pendingBytes = 0;

  push(chunk: Buffer): readonly string[] {
    this.#pendingBytes += chunk.byteLength;
    this.#buffer += this.#decoder.write(chunk);
    const lines: string[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const rawLine = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#pendingBytes -= Buffer.byteLength(rawLine, "utf8") + 1;
      if (Buffer.byteLength(rawLine, "utf8") > MAX_LINE_BYTES) throw new Error("speech_protocol_line_too_large");
      const line = rawLine.trim();
      if (line) lines.push(line);
    }
    if (this.#pendingBytes > MAX_LINE_BYTES) throw new Error("speech_protocol_line_too_large");
    return lines;
  }

  end(): void {
    this.#buffer += this.#decoder.end();
    if (this.#buffer.length > 0 || this.#pendingBytes > 0) {
      throw new Error("speech_protocol_incomplete_line");
    }
  }
}

export function locateVerifiedMacOSSpeechHelper(): SpeechHelperDescriptor | undefined {
  if (process.platform !== "darwin") return undefined;
  const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, "native/macos", process.arch, "pige-speech")] : []),
    path.resolve(process.cwd(), "artifacts/native/macos", process.arch, "pige-speech"),
    path.resolve(process.cwd(), "../../artifacts/native/macos", process.arch, "pige-speech")
  ];
  for (const binaryPath of candidates) {
    try {
      const stat = fs.lstatSync(binaryPath);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) continue;
      const manifest = JSON.parse(fs.readFileSync(`${binaryPath}.manifest.json`, "utf8")) as Record<string, unknown>;
      const binarySha256 = checksum(binaryPath);
      if (
        manifest.schemaVersion === 1 &&
        manifest.id === "pige-speech" &&
        manifest.helperVersion === SPEECH_HELPER_VERSION &&
        manifest.protocolVersion === SPEECH_PROTOCOL_VERSION &&
        manifest.platform === "macos" &&
        manifest.arch === process.arch &&
        typeof manifest.infoPlistSha256 === "string" &&
        manifest.binarySize === stat.size &&
        manifest.binarySha256 === binarySha256
      ) {
        return { binaryPath, binarySha256 };
      }
    } catch {
      // Try the next reviewed location.
    }
  }
  return undefined;
}

function parsePermission(value: unknown): "not-determined" | "granted" | "denied" | "restricted" {
  if (value === "not-determined" || value === "granted" || value === "denied" || value === "restricted") {
    return value;
  }
  throw new PigeDomainError("speech.invalid_response", "The local speech helper returned an invalid permission state.");
}

function parseJsonLine(value: string): Record<string, unknown> {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_LINE_BYTES) {
    throw new PigeDomainError("speech.invalid_response", "The local speech helper returned an invalid response.");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PigeDomainError("speech.invalid_response", "The local speech helper returned an invalid response.");
  }
  return parsed as Record<string, unknown>;
}

function checksum(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR
  }).filter((entry) => typeof entry[1] === "string"));
}
