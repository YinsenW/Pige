import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import {
  assertNormalizedCommandExecutionRequest,
  terminateCommandProcessTree,
  type CommandProcessLaunchOptions,
  type CommandProcessLauncher,
  type NormalizedCommandExecutionRequest
} from "./command-execution-service";

const MAX_PLAN_STEPS = 8;
const MAX_OUTPUT_BYTES = 256 * 1_024;
const MAX_INTERACTION_URL_BYTES = 4 * 1_024;
const MAX_STREAM_BUFFER_BYTES = MAX_OUTPUT_BYTES + MAX_INTERACTION_URL_BYTES;
const MAX_REDACTIONS = 32;
const MAX_REDACTION_BYTES = 4 * 1_024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface TaskProcessSessionRequest {
  readonly planId: string;
  readonly jobId: string;
  readonly stepOrdinal: number;
  readonly revision: number;
  readonly command: NormalizedCommandExecutionRequest;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly redactions?: readonly string[];
  readonly interaction?: {
    readonly kind: "browser_oauth";
    readonly allowedOrigins: readonly string[];
  };
  readonly assertCurrent: () => void;
  readonly onStream?: (event: TaskProcessStreamEvent) => void;
}

export interface TaskProcessStreamEvent {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
  readonly outputBytes: number;
  readonly truncated: boolean;
}

export interface TaskProcessSessionResult {
  readonly status: "completed" | "failed" | "timed_out" | "interaction_pending";
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly outputBytes: number;
  readonly truncated: boolean;
}

export type TaskInteractionPendingResult =
  | { readonly status: "none" }
  | {
      readonly status: "browser_oauth";
      readonly interactionId: string;
      readonly planId: string;
      readonly jobId: string;
      readonly stepOrdinal: number;
      readonly origin: string;
      readonly revision: number;
    };

export interface TaskInteractionOpenRequest {
  readonly interactionId: string;
  readonly planId: string;
  readonly jobId: string;
  readonly stepOrdinal: number;
  readonly expectedRevision: number;
}

export type TaskInteractionOpenResult =
  | { readonly status: "opened"; readonly revision: number }
  | { readonly status: "stale"; readonly revision: number }
  | { readonly status: "not_found" }
  | { readonly status: "failed"; readonly revision: number };

export interface PrivateBrowserOAuthInteraction {
  readonly url: string;
  readonly deviceCode?: string;
  readonly processIdentity: string;
}

export interface TaskProcessSessionServiceOptions {
  readonly launcher?: CommandProcessLauncher;
  readonly openBrowserOAuth: (interaction: PrivateBrowserOAuthInteraction) => void | Promise<void>;
  readonly terminateProcessTree?: (child: ChildProcess) => void;
}

export interface TaskProcessInterruptedAdoptionHook {
  adopt(input: {
    readonly planId: string;
    readonly jobId: string;
    readonly stepOrdinal: number;
    readonly revision: number;
    readonly processIdentity: string;
    readonly executableIdentity: NormalizedCommandExecutionRequest["executableIdentity"];
  }): TaskProcessSessionResult | undefined | Promise<TaskProcessSessionResult | undefined>;
}

export interface TaskProcessSessionCheckpoint {
  readonly planId: string;
  readonly jobId: string;
  readonly stepOrdinal: number;
  readonly revision: number;
  readonly processIdentity: string;
  readonly interactionRevision?: number;
}

interface PrivateInteractionState {
  readonly interactionId: string;
  readonly planId: string;
  readonly jobId: string;
  readonly stepOrdinal: number;
  readonly origin: string;
  readonly url: string;
  readonly deviceCode?: string;
  readonly processIdentity: string;
  revision: number;
  opened: boolean;
}

interface ActiveSession {
  readonly request: TaskProcessSessionRequest;
  readonly child: ChildProcess;
  readonly processIdentity: string;
  interaction?: PrivateInteractionState;
  settled: boolean;
}

interface CapturedOutput {
  stdout: string;
  stderr: string;
  outputBytes: number;
  truncated: boolean;
}

export class TaskProcessSessionService {
  readonly #launcher: CommandProcessLauncher;
  readonly #openBrowserOAuth: TaskProcessSessionServiceOptions["openBrowserOAuth"];
  readonly #terminateProcessTree: (child: ChildProcess) => void;
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #interactions = new Map<string, ActiveSession>();
  readonly #interactionListeners = new Set<(event: TaskInteractionPendingResult) => void>();

  constructor(options: TaskProcessSessionServiceOptions) {
    if (!options || (options.launcher !== undefined && typeof options.launcher.spawn !== "function") ||
      typeof options.openBrowserOAuth !== "function") {
      throw processError("task_process.configuration_invalid");
    }
    this.#launcher = options.launcher ?? DEFAULT_PROCESS_LAUNCHER;
    this.#openBrowserOAuth = options.openBrowserOAuth;
    this.#terminateProcessTree = options.terminateProcessTree ?? terminateCommandProcessTree;
  }

  run(request: TaskProcessSessionRequest, signal: AbortSignal): Promise<TaskProcessSessionResult> {
    const normalized = normalizeRequest(request);
    signal.throwIfAborted();
    normalized.assertCurrent();
    assertNormalizedCommandExecutionRequest(normalized.command);
    const key = sessionKey(normalized);
    if (this.#sessions.has(key)) throw processError("task_process.session_active");

    const child = this.#launcher.spawn(normalized.command.executable, normalized.command.args, {
      cwd: normalized.command.workingDirectory,
      env: { ...normalized.environment, NO_COLOR: "1", PIGE_TASK_PLAN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    if (!child.stdout || !child.stderr) {
      this.#terminateProcessTree(child);
      throw processError("task_process.spawn_failed");
    }
    const active: ActiveSession = {
      request: normalized,
      child,
      processIdentity: processIdentity(normalized, child.pid),
      settled: false
    };
    this.#sessions.set(key, active);
    const captured: CapturedOutput = { stdout: "", stderr: "", outputBytes: 0, truncated: false };
    let protocolFailure: unknown;
    const failProtocol = (caught: unknown): void => {
      if (protocolFailure) return;
      protocolFailure = caught instanceof PigeDomainError
        ? caught
        : processError("task_process.interaction_invalid");
      this.#terminateProcessTree(child);
    };
    const stdout = createStreamCollector("stdout", active, captured, (interaction) => {
      this.#registerInteraction(active, interaction);
    }, failProtocol);
    const stderr = createStreamCollector("stderr", active, captured, (interaction) => {
      this.#registerInteraction(active, interaction);
    }, failProtocol);
    child.stdout.on("data", stdout.push);
    child.stderr.on("data", stderr.push);

    return new Promise((resolve, reject) => {
      let timedOut = false;
      const finish = (action: () => void): void => {
        if (active.settled) return;
        active.settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        child.stdout?.removeListener("data", stdout.push);
        child.stderr?.removeListener("data", stderr.push);
        stdout.flush();
        stderr.flush();
        if (!active.interaction || active.interaction.opened) this.#sessions.delete(key);
        action();
      };
      const onAbort = (): void => {
        this.#terminateProcessTree(child);
        this.#removeInteraction(active);
        finish(() => reject(processError("task_process.cancelled")));
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        this.#terminateProcessTree(child);
      }, normalized.command.timeoutMs);
      timeout.unref?.();
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", () => finish(() => reject(processError("task_process.spawn_failed"))));
      child.once("close", (exitCode, processSignal) => finish(() => {
        if (protocolFailure) {
          reject(protocolFailure);
          return;
        }
        try {
          normalized.assertCurrent();
          assertNormalizedCommandExecutionRequest(normalized.command);
        } catch (caught) {
          reject(caught);
          return;
        }
        resolve(Object.freeze({
          ...captured,
          status: timedOut
            ? "timed_out"
            : active.interaction && !active.interaction.opened
              ? "interaction_pending"
              : exitCode === 0 ? "completed" : "failed",
          exitCode,
          signal: processSignal
        }));
      }));
    });
  }

  interaction(): TaskInteractionPendingResult {
    for (const active of this.#sessions.values()) {
      const interaction = active.interaction;
      if (interaction && !interaction.opened) return publicInteraction(interaction);
    }
    return { status: "none" };
  }

  onInteractionChanged(listener: (event: TaskInteractionPendingResult) => void): () => void {
    this.#interactionListeners.add(listener);
    return () => this.#interactionListeners.delete(listener);
  }

  async openInteraction(request: TaskInteractionOpenRequest): Promise<TaskInteractionOpenResult> {
    const active = this.#interactions.get(request.interactionId);
    if (!active?.interaction) return { status: "not_found" };
    const interaction = active.interaction;
    if (
      interaction.planId !== request.planId ||
      interaction.jobId !== request.jobId ||
      interaction.stepOrdinal !== request.stepOrdinal ||
      interaction.revision !== request.expectedRevision ||
      interaction.opened
    ) return { status: "stale", revision: interaction.revision };
    try {
      active.request.assertCurrent();
      assertNormalizedCommandExecutionRequest(active.request.command);
      await this.#openBrowserOAuth({
        url: interaction.url,
        ...(interaction.deviceCode ? { deviceCode: interaction.deviceCode } : {}),
        processIdentity: interaction.processIdentity
      });
      active.request.assertCurrent();
      interaction.opened = true;
      interaction.revision += 1;
      this.#interactions.delete(interaction.interactionId);
      if (active.settled) this.#sessions.delete(sessionKey(active.request));
      this.#emitInteractionChanged();
      return { status: "opened", revision: interaction.revision };
    } catch {
      return { status: "failed", revision: interaction.revision };
    }
  }

  cancel(input: { readonly planId: string; readonly jobId: string; readonly stepOrdinal: number }): boolean {
    const active = this.#sessions.get(sessionKey(input));
    if (!active) return false;
    this.#terminateProcessTree(active.child);
    this.#removeInteraction(active);
    return true;
  }

  cancelJob(jobId: string): boolean {
    let cancelled = false;
    for (const active of [...this.#sessions.values()]) {
      if (active.request.jobId !== jobId) continue;
      this.#terminateProcessTree(active.child);
      this.#removeInteraction(active);
      cancelled = true;
    }
    return cancelled;
  }

  checkpoint(
    input: { readonly planId: string; readonly jobId: string; readonly stepOrdinal: number }
  ): TaskProcessSessionCheckpoint | undefined {
    const active = this.#sessions.get(sessionKey(input));
    if (!active) return undefined;
    active.request.assertCurrent();
    return Object.freeze({
      planId: active.request.planId,
      jobId: active.request.jobId,
      stepOrdinal: active.request.stepOrdinal,
      revision: active.request.revision,
      processIdentity: active.processIdentity,
      ...(active.interaction ? { interactionRevision: active.interaction.revision } : {})
    });
  }

  async adoptInterrupted(
    request: TaskProcessSessionRequest,
    checkpoint: TaskProcessSessionCheckpoint,
    hook: TaskProcessInterruptedAdoptionHook
  ): Promise<TaskProcessSessionResult> {
    const normalized = normalizeRequest(request);
    normalized.assertCurrent();
    assertNormalizedCommandExecutionRequest(normalized.command);
    if (
      !checkpoint ||
      checkpoint.planId !== normalized.planId ||
      checkpoint.jobId !== normalized.jobId ||
      checkpoint.stepOrdinal !== normalized.stepOrdinal ||
      checkpoint.revision !== normalized.revision ||
      !SHA256_PATTERN.test(checkpoint.processIdentity)
    ) throw processError("task_process.adoption_unavailable");
    const adopted = await hook.adopt({
      planId: normalized.planId,
      jobId: normalized.jobId,
      stepOrdinal: normalized.stepOrdinal,
      revision: normalized.revision,
      processIdentity: checkpoint.processIdentity,
      executableIdentity: normalized.command.executableIdentity
    });
    normalized.assertCurrent();
    if (!adopted || !["completed", "interaction_pending"].includes(adopted.status)) {
      throw processError("task_process.adoption_unavailable");
    }
    return Object.freeze({ ...adopted });
  }

  #registerInteraction(
    active: ActiveSession,
    parsed: { readonly url: string; readonly deviceCode?: string }
  ): void {
    if (!active.request.interaction || active.interaction) return;
    const url = parseAllowedInteractionUrl(parsed.url, active.request.interaction.allowedOrigins);
    const interaction: PrivateInteractionState = {
      interactionId: interactionId(active.request, active.processIdentity),
      planId: active.request.planId,
      jobId: active.request.jobId,
      stepOrdinal: active.request.stepOrdinal,
      origin: url.origin,
      url: url.href,
      ...(parsed.deviceCode ? { deviceCode: parsed.deviceCode } : {}),
      processIdentity: active.processIdentity,
      revision: active.request.revision,
      opened: false
    };
    active.interaction = interaction;
    this.#interactions.set(interaction.interactionId, active);
    this.#emitInteractionChanged();
  }

  #removeInteraction(active: ActiveSession): void {
    if (!active.interaction) return;
    this.#interactions.delete(active.interaction.interactionId);
    delete active.interaction;
    this.#emitInteractionChanged();
  }

  #emitInteractionChanged(): void {
    const event = this.interaction();
    for (const listener of this.#interactionListeners) listener(event);
  }
}

const DEFAULT_PROCESS_LAUNCHER: CommandProcessLauncher = Object.freeze({
  spawn: (executable: string, args: readonly string[], options: CommandProcessLaunchOptions) =>
    spawn(executable, [...args], { ...options, stdio: ["ignore", "pipe", "pipe"] })
});

function normalizeRequest(request: TaskProcessSessionRequest): TaskProcessSessionRequest {
  if (
    !request ||
    !/^plan_[a-f0-9]{32}$/u.test(request.planId) ||
    !/^job_\d{8}_[a-z0-9]{8,}$/u.test(request.jobId) ||
    !Number.isInteger(request.stepOrdinal) || request.stepOrdinal < 1 || request.stepOrdinal > MAX_PLAN_STEPS ||
    !Number.isInteger(request.revision) || request.revision < 1 ||
    typeof request.assertCurrent !== "function"
  ) throw processError("task_process.request_invalid");
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(request.environment)) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/u.test(key) || typeof value !== "string" || Buffer.byteLength(value, "utf8") > 16_384) {
      throw processError("task_process.environment_invalid");
    }
    environment[key] = value;
  }
  const redactions = request.redactions ?? [];
  if (
    redactions.length > MAX_REDACTIONS ||
    redactions.some((value) => typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_REDACTION_BYTES)
  ) throw processError("task_process.redaction_invalid");
  if (request.interaction) {
    if (
      request.interaction.kind !== "browser_oauth" ||
      request.interaction.allowedOrigins.length < 1 ||
      request.interaction.allowedOrigins.length > 4
    ) throw processError("task_process.interaction_invalid");
    for (const origin of request.interaction.allowedOrigins) parseOrigin(origin);
  }
  return Object.freeze({
    ...request,
    environment: Object.freeze(environment),
    redactions: Object.freeze([...redactions]),
    ...(request.interaction
      ? { interaction: Object.freeze({ ...request.interaction, allowedOrigins: Object.freeze([...request.interaction.allowedOrigins]) }) }
      : {})
  });
}

function createStreamCollector(
  stream: "stdout" | "stderr",
  active: ActiveSession,
  captured: CapturedOutput,
  registerInteraction: (interaction: { readonly url: string; readonly deviceCode?: string }) => void,
  failProtocol: (caught: unknown) => void
): { readonly push: (chunk: Buffer | string) => void; readonly flush: () => void } {
  let pending = "";
  const emit = (rawLine: string): void => {
    const interaction = parseInteractionEnvelope(rawLine);
    if (interaction && active.request.interaction) {
      registerInteraction(interaction);
      appendSafeOutput(stream, "[browser_oauth interaction ready]\n", active, captured);
      return;
    }
    appendSafeOutput(stream, sanitizeOutput(rawLine, active.request.redactions ?? []), active, captured);
  };
  const emitSafely = (line: string): void => {
    try { emit(line); } catch (caught) { failProtocol(caught); }
  };
  const flushLines = (final: boolean): void => {
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline + 1);
      pending = pending.slice(newline + 1);
      emitSafely(line);
      newline = pending.indexOf("\n");
    }
    if (final && pending) {
      emitSafely(pending);
      pending = "";
    }
  };
  return {
    push: (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      if (Buffer.byteLength(pending, "utf8") + Buffer.byteLength(value, "utf8") > MAX_STREAM_BUFFER_BYTES) {
        captured.truncated = true;
        pending = `${pending}${value}`.slice(0, MAX_STREAM_BUFFER_BYTES);
        flushLines(true);
        return;
      }
      pending += value;
      flushLines(false);
    },
    flush: () => flushLines(true)
  };
}

function appendSafeOutput(
  stream: "stdout" | "stderr",
  value: string,
  active: ActiveSession,
  captured: CapturedOutput
): void {
  const bytes = Buffer.from(value, "utf8");
  const available = MAX_OUTPUT_BYTES - captured.outputBytes;
  if (available <= 0) {
    captured.truncated = true;
    return;
  }
  const accepted = bytes.length <= available ? bytes : bytes.subarray(0, available);
  const text = accepted.toString("utf8");
  captured[stream] += text;
  captured.outputBytes += accepted.length;
  if (accepted.length < bytes.length) captured.truncated = true;
  active.request.onStream?.({
    stream,
    text,
    outputBytes: captured.outputBytes,
    truncated: captured.truncated
  });
}

function parseInteractionEnvelope(line: string): { readonly url: string; readonly deviceCode?: string } | undefined {
  let value: unknown;
  try { value = JSON.parse(line.trim()); } catch { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.type !== "browser_oauth" || typeof record.url !== "string") return undefined;
  const deviceCode = record.deviceCode ?? record.device_code;
  if (deviceCode !== undefined && (typeof deviceCode !== "string" || Buffer.byteLength(deviceCode, "utf8") > 4_096)) {
    throw processError("task_process.interaction_invalid");
  }
  return { url: record.url, ...(typeof deviceCode === "string" ? { deviceCode } : {}) };
}

function sanitizeOutput(value: string, redactions: readonly string[]): string {
  let result = value;
  for (const secret of [...redactions].sort((left, right) => right.length - left.length)) {
    result = result.split(secret).join("[redacted]");
  }
  result = result.replace(/("?(?:device_code|deviceCode|access_token|refresh_token)"?\s*[:=]\s*)[^\s,}"']+/giu, "$1[redacted]");
  result = result.replace(/https:\/\/[^\s"'<>]+/giu, (candidate) => {
    try {
      const url = new URL(candidate);
      return url.search || url.hash ? `${url.origin}${url.pathname}?[redacted]` : candidate;
    } catch {
      return "[redacted-url]";
    }
  });
  return result;
}

function parseAllowedInteractionUrl(value: string, origins: readonly string[]): URL {
  if (Buffer.byteLength(value, "utf8") > MAX_INTERACTION_URL_BYTES) throw processError("task_process.interaction_invalid");
  let url: URL;
  try { url = new URL(value); } catch { throw processError("task_process.interaction_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || !origins.includes(url.origin)) {
    throw processError("task_process.interaction_invalid");
  }
  return url;
}

function parseOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw processError("task_process.interaction_invalid"); }
  if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" || url.search || url.hash) {
    throw processError("task_process.interaction_invalid");
  }
  return value;
}

function publicInteraction(interaction: PrivateInteractionState): TaskInteractionPendingResult {
  return Object.freeze({
    status: "browser_oauth",
    interactionId: interaction.interactionId,
    planId: interaction.planId,
    jobId: interaction.jobId,
    stepOrdinal: interaction.stepOrdinal,
    origin: interaction.origin,
    revision: interaction.revision
  });
}

function sessionKey(input: { readonly planId: string; readonly jobId: string; readonly stepOrdinal: number }): string {
  return `${input.planId}\0${input.jobId}\0${input.stepOrdinal}`;
}

function processIdentity(request: TaskProcessSessionRequest, pid: number | undefined): string {
  return digest({
    planId: request.planId,
    jobId: request.jobId,
    stepOrdinal: request.stepOrdinal,
    revision: request.revision,
    executableIdentity: request.command.executableIdentity,
    pid: pid ?? null
  });
}

function interactionId(request: TaskProcessSessionRequest, identity: string): string {
  return `interaction_${digest({
    planId: request.planId,
    jobId: request.jobId,
    stepOrdinal: request.stepOrdinal,
    revision: request.revision,
    processIdentity: identity
  }).slice("sha256:".length, "sha256:".length + 32)}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function processError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The reviewed task process session is unavailable.");
}
