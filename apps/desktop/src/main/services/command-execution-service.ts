import { Buffer } from "node:buffer";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const MAX_EXECUTABLE_BYTES = 4 * 1_024;
const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 16 * 1_024;
const MAX_TOTAL_ARGUMENT_BYTES = 64 * 1_024;
const MAX_WORKING_DIRECTORY_BYTES = 4 * 1_024;
export const MAX_COMMAND_OUTPUT_BYTES = 256 * 1_024;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const TERMINATION_GRACE_MS = 1_000;

export interface CommandExecutionRequest {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
}

export interface NormalizedCommandExecutionRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly timeoutMs: number;
  readonly executableIdentity: {
    readonly pathHash: `sha256:${string}`;
    readonly device: number;
    readonly inode: number;
    readonly size: number;
    readonly modifiedAtMs: number;
  };
}

export interface CommandExecutionResult {
  readonly status: "completed" | "failed" | "timed_out";
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly outputBytes: number;
  readonly truncated: boolean;
}

export interface CommandExecutionServiceOptions {
  readonly managedBinDirectories?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}

interface CapturedOutput {
  stdout: string;
  stderr: string;
  outputBytes: number;
  truncated: boolean;
}

export class CommandExecutionService {
  readonly #managedBinDirectories: readonly string[];
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: CommandExecutionServiceOptions = {}) {
    this.#managedBinDirectories = Object.freeze(
      (options.managedBinDirectories ?? []).map((directory) => path.resolve(directory))
    );
    this.#environment = options.environment ?? process.env;
  }

  normalize(input: CommandExecutionRequest): NormalizedCommandExecutionRequest {
    if (!input || typeof input !== "object") throw commandError("command.request_invalid");
    const executable = this.#resolveExecutable(input.executable);
    const args = normalizeArguments(input.args);
    const workingDirectory = normalizeWorkingDirectory(input.workingDirectory);
    const timeoutMs = normalizeTimeout(input.timeoutMs);
    const stats = statExecutable(executable);
    return Object.freeze({
      executable,
      args: Object.freeze(args),
      workingDirectory,
      timeoutMs,
      executableIdentity: Object.freeze({
        pathHash: digest(executable),
        device: stats.dev,
        inode: stats.ino,
        size: stats.size,
        modifiedAtMs: stats.mtimeMs
      })
    });
  }

  async execute(
    input: NormalizedCommandExecutionRequest,
    abortSignal: AbortSignal
  ): Promise<CommandExecutionResult> {
    abortSignal.throwIfAborted();
    assertExecutableUnchanged(input);
    const child = spawn(input.executable, [...input.args], {
      cwd: input.workingDirectory,
      env: this.#safeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    const captured: CapturedOutput = { stdout: "", stderr: "", outputBytes: 0, truncated: false };
    if (!child.stdout || !child.stderr) {
      terminateProcessTree(child);
      throw commandError("command.spawn_failed");
    }
    capture(child.stdout, "stdout", captured);
    capture(child.stderr, "stderr", captured);

    return await new Promise((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        abortSignal.removeEventListener("abort", onAbort);
        action();
      };
      const onAbort = (): void => {
        terminateProcessTree(child);
        finish(() => reject(commandError("command.cancelled")));
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, input.timeoutMs);
      timeout.unref?.();
      abortSignal.addEventListener("abort", onAbort, { once: true });
      child.once("error", () => finish(() => reject(commandError("command.spawn_failed"))));
      child.once("close", (exitCode, processSignal) => finish(() => resolve(Object.freeze({
        ...captured,
        status: timedOut ? "timed_out" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        signal: processSignal
      }))));
    });
  }

  #resolveExecutable(value: unknown): string {
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      Buffer.byteLength(value, "utf8") > MAX_EXECUTABLE_BYTES ||
      /\0|[\u0001-\u001f\u007f]/u.test(value)
    ) throw commandError("command.executable_invalid");
    if (path.isAbsolute(value)) return requireExecutable(value);
    if (value.includes("/") || value.includes("\\") || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)) {
      throw commandError("command.executable_invalid");
    }
    const searchDirectories = [
      ...this.#managedBinDirectories,
      ...(this.#environment.PATH ?? "").split(path.delimiter).filter(Boolean)
    ];
    const names = process.platform === "win32"
      ? windowsExecutableNames(value, this.#environment.PATHEXT)
      : [value];
    for (const directory of searchDirectories) {
      for (const name of names) {
        const candidate = path.resolve(directory, name);
        try { return requireExecutable(candidate); } catch { /* keep searching */ }
      }
    }
    throw commandError("command.executable_not_found");
  }

  #safeEnvironment(): NodeJS.ProcessEnv {
    const allowed = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SystemRoot", "PATHEXT"];
    const env: NodeJS.ProcessEnv = { NO_COLOR: "1", PIGE_AGENT_COMMAND: "1" };
    for (const key of allowed) {
      const value = this.#environment[key];
      if (value !== undefined) env[key] = value;
    }
    const managedPath = this.#managedBinDirectories.join(path.delimiter);
    if (managedPath) env.PATH = env.PATH ? `${managedPath}${path.delimiter}${env.PATH}` : managedPath;
    return env;
  }
}

function normalizeArguments(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS) throw commandError("command.arguments_invalid");
  let totalBytes = 0;
  const result = value.map((argument) => {
    if (
      typeof argument !== "string" ||
      Buffer.byteLength(argument, "utf8") > MAX_ARGUMENT_BYTES ||
      /\0/u.test(argument)
    ) throw commandError("command.arguments_invalid");
    totalBytes += Buffer.byteLength(argument, "utf8");
    return argument;
  });
  if (totalBytes > MAX_TOTAL_ARGUMENT_BYTES) throw commandError("command.arguments_invalid");
  return result;
}

function normalizeWorkingDirectory(value: unknown): string {
  const candidate = value === undefined ? os.homedir() : value;
  if (
    typeof candidate !== "string" ||
    !path.isAbsolute(candidate) ||
    Buffer.byteLength(candidate, "utf8") > MAX_WORKING_DIRECTORY_BYTES
  ) throw commandError("command.working_directory_invalid");
  const resolved = path.resolve(candidate);
  let stats: fs.Stats;
  try { stats = fs.statSync(resolved); } catch { throw commandError("command.working_directory_invalid"); }
  if (!stats.isDirectory()) throw commandError("command.working_directory_invalid");
  return resolved;
}

function normalizeTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isInteger(value) || (value as number) < 1_000 || (value as number) > MAX_COMMAND_TIMEOUT_MS) {
    throw commandError("command.timeout_invalid");
  }
  return value as number;
}

function requireExecutable(candidate: string): string {
  let resolved: string;
  try { resolved = fs.realpathSync.native(candidate); } catch { throw commandError("command.executable_not_found"); }
  const stats = statExecutable(resolved);
  if (!stats.isFile()) throw commandError("command.executable_invalid");
  if (process.platform !== "win32") {
    try { fs.accessSync(resolved, fs.constants.X_OK); } catch { throw commandError("command.executable_not_found"); }
  }
  return resolved;
}

function statExecutable(executable: string): fs.Stats {
  try {
    const stats = fs.statSync(executable);
    if (!stats.isFile()) throw commandError("command.executable_invalid");
    return stats;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw commandError("command.executable_not_found");
  }
}

function assertExecutableUnchanged(input: NormalizedCommandExecutionRequest): void {
  const stats = statExecutable(input.executable);
  const identity = input.executableIdentity;
  if (
    stats.dev !== identity.device ||
    stats.ino !== identity.inode ||
    stats.size !== identity.size ||
    stats.mtimeMs !== identity.modifiedAtMs
  ) throw commandError("command.executable_changed");
}

function capture(
  stream: NodeJS.ReadableStream,
  target: "stdout" | "stderr",
  output: CapturedOutput
): void {
  stream.on("data", (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    const available = MAX_COMMAND_OUTPUT_BYTES - output.outputBytes;
    if (available <= 0) {
      output.truncated = true;
      return;
    }
    const accepted = bytes.length <= available ? bytes : bytes.subarray(0, available);
    output[target] += accepted.toString("utf8");
    output.outputBytes += accepted.length;
    if (accepted.length < bytes.length) output.truncated = true;
  });
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
      shell: false
    });
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { return; } }
  const force = setTimeout(() => {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
  }, TERMINATION_GRACE_MS);
  force.unref?.();
}

function windowsExecutableNames(name: string, pathExt: string | undefined): readonly string[] {
  if (path.extname(name)) return [name];
  return (pathExt ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean).map((extension) => `${name}${extension.toLowerCase()}`);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function commandError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The local command could not be executed.");
}
