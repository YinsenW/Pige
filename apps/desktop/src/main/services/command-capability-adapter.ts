import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  assertPermissionedExternalExecutionAuthority,
  type PermissionedExternalCapabilityAdapter
} from "./permissioned-external-capability-service";
import { createPigeTextToolResult } from "./pi-agent-tool-boundary";
import {
  CommandExecutionService,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  type NormalizedCommandExecutionRequest
} from "./command-execution-service";

const ACTOR_DIGEST = `sha256:${createHash("sha256")
  .update("pige.first_party.command_capability.v1", "utf8")
  .digest("hex")}`;
const agentRiskByRequest = new WeakMap<object, AgentCommandRiskProposal>();
const MANDATORY_CONFIRMATION_EXECUTABLES = new Set([
  "bash", "cmd", "cmd.exe", "node", "powershell", "powershell.exe", "pwsh", "python", "python3",
  "rm", "sh", "sudo", "zsh"
]);

interface AgentCommandRiskProposal {
  readonly level: "low" | "medium" | "high";
  readonly reason: string;
}

export function createFirstPartyCommandCapabilityAdapter(
  commands = new CommandExecutionService()
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_run_command",
      label: "Run OS command",
      description: "Runs an OS executable with an argument array in a working directory. Include a concise risk_assessment; Main independently verifies it and may raise the risk. Use this for command-line tools, package installation, scripts, and system utilities. A shell such as zsh, bash, cmd, or PowerShell may be invoked explicitly when shell syntax is needed.",
      parameters: strictObjectSchema({
        executable: { type: "string", minLength: 1, maxLength: 4_096 },
        args: { type: "array", maxItems: 128, items: { type: "string", maxLength: 16_384 } },
        working_directory: { type: "string", minLength: 1, maxLength: 4_096 },
        timeout_ms: { type: "integer", minimum: 1_000, maximum: MAX_COMMAND_TIMEOUT_MS },
        risk_assessment: {
          type: "object",
          additionalProperties: false,
          properties: {
            level: { enum: ["low", "medium", "high"] },
            reason: { type: "string", minLength: 1, maxLength: 240 }
          },
          required: ["level", "reason"]
        }
      }, ["executable"]),
      outputSchema: strictObjectSchema({
        status: { enum: ["completed", "failed", "timed_out"] },
        stdout: { type: "string", maxLength: MAX_COMMAND_OUTPUT_BYTES },
        stderr: { type: "string", maxLength: MAX_COMMAND_OUTPUT_BYTES },
        exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
        signal: { anyOf: [{ type: "string" }, { type: "null" }] },
        outputBytes: { type: "integer", minimum: 0, maximum: MAX_COMMAND_OUTPUT_BYTES },
        truncated: { type: "boolean" }
      }, ["status", "stdout", "stderr", "exitCode", "signal", "outputBytes", "truncated"]),
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "current_vault",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "non_idempotent", scope: "none" },
      limits: {
        maxInputBytes: 80 * 1_024,
        maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES + 8 * 1_024,
        timeoutMs: MAX_COMMAND_TIMEOUT_MS
      },
      ownerService: "CommandExecutionService"
    },
    actor: {
      type: "local_tool",
      id: "pige.command-execution",
      displayName: "Pige OS Command",
      version: "1.0.0",
      digest: ACTOR_DIGEST
    },
    action: { id: "command.run", version: "1", labelKey: "permissions.actions.run_command" },
    permission: {
      capability: "run_shell",
      dataBoundary: "local",
      resourceScope: "current_vault",
      reasonCode: "command.run",
      highRisk: (input, turn) => {
        const request = input as NormalizedCommandExecutionRequest;
        const proposedRisk = agentRiskByRequest.get(request);
        if (
          isInside(request.workingDirectory, turn.vaultPath) &&
          isHostVerifiedReadOnly(request) &&
          (proposedRisk === undefined || proposedRisk.level === "low")
        ) return undefined;
        return {
          effect: "arbitrary_shell",
          presentation: {
            action: "run_shell_command",
            target: "local_system",
            subject: {
              kind: "executable_name",
              value: path.basename(request.executable)
            }
          }
        };
      },
      rememberScope: (input) => {
        const request = input as NormalizedCommandExecutionRequest;
        if (isMandatoryPerCall(request) || agentRiskByRequest.get(request)?.level === "high") return undefined;
        return {
          executableIdentity: request.executableIdentity,
          args: request.args,
          workingDirectoryHash: hash(request.workingDirectory)
        };
      }
    },
    normalizeInput: (args) => {
      const parsed = parseInput(args);
      const normalized = commands.normalize(parsed.command);
      if (parsed.agentRisk) agentRiskByRequest.set(normalized, parsed.agentRisk);
      return normalized;
    },
    resourceIdentity: (input) => {
      const request = input as NormalizedCommandExecutionRequest;
      return {
        executableIdentity: request.executableIdentity,
        workingDirectoryHash: hash(request.workingDirectory)
      };
    },
    resourceDisplayName: (input) => path.basename((input as NormalizedCommandExecutionRequest).executable),
    resourceCount: () => 1,
    execute: async (input, signal, _context, authority) => {
      assertPermissionedExternalExecutionAuthority(authority, "run_shell");
      const result = await commands.execute(input as NormalizedCommandExecutionRequest, signal);
      const details = Object.freeze({ ...result });
      return createPigeTextToolResult(JSON.stringify(details), details);
    }
  };
}

function parseInput(value: unknown): {
  readonly command: {
    readonly executable: string;
    readonly args?: readonly string[];
    readonly workingDirectory?: string;
    readonly timeoutMs?: number;
  };
  readonly agentRisk?: AgentCommandRiskProposal;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const input = value as Record<string, unknown>;
  const allowed = new Set(["executable", "args", "working_directory", "timeout_ms", "risk_assessment"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw invalidRequest();
  if (typeof input.executable !== "string") throw invalidRequest();
  const agentRisk = parseAgentRisk(input.risk_assessment);
  return {
    command: {
      executable: input.executable,
      ...(input.args !== undefined ? { args: input.args as readonly string[] } : {}),
      ...(input.working_directory !== undefined ? { workingDirectory: input.working_directory as string } : {}),
      ...(input.timeout_ms !== undefined ? { timeoutMs: input.timeout_ms as number } : {})
    },
    ...(agentRisk ? { agentRisk } : {})
  };
}

function parseAgentRisk(value: unknown): AgentCommandRiskProposal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const risk = value as Record<string, unknown>;
  if (
    Object.keys(risk).some((key) => key !== "level" && key !== "reason") ||
    !["low", "medium", "high"].includes(String(risk.level)) ||
    typeof risk.reason !== "string" || risk.reason.trim() === "" || risk.reason.length > 240
  ) throw invalidRequest();
  return { level: risk.level as AgentCommandRiskProposal["level"], reason: risk.reason };
}

function isHostVerifiedReadOnly(request: NormalizedCommandExecutionRequest): boolean {
  const executable = path.basename(request.executable).toLowerCase();
  if (executable === "pwd" && request.args.length === 0) return true;
  if (executable === "ls" && safeReadOnlyArgs(request.args)) return true;
  if (executable === "git" || executable === "git.exe") return safeGitArgs(request.args);
  if (!["bash", "sh", "zsh"].includes(executable) || request.args.length !== 2) return false;
  if (request.args[0] !== "-c" && request.args[0] !== "-lc") return false;
  const tokens = request.args[1]?.trim().split(/\s+/u) ?? [];
  if (tokens[0] === "pwd" && tokens.length === 1) return true;
  if (tokens[0] === "ls") return safeReadOnlyArgs(tokens.slice(1));
  return tokens[0] === "git" && safeGitArgs(tokens.slice(1));
}

function safeGitArgs(commandArgs: readonly string[]): boolean {
  const [subcommand, ...args] = commandArgs;
  if (!subcommand || !new Set(["status", "diff", "log", "show", "rev-parse"]).has(subcommand)) return false;
  return safeReadOnlyArgs(args) && args.every((argument) =>
    !argument.startsWith("-c") && argument !== "--config-env" &&
    argument !== "--ext-diff" && argument !== "--no-index"
  );
}

function safeReadOnlyArgs(args: readonly string[]): boolean {
  return args.every((argument) =>
    /^[\w./:=,@+-]+$/u.test(argument) && !path.isAbsolute(argument) &&
    argument !== ".." && !argument.startsWith(`..${path.sep}`)
  );
}

function isMandatoryPerCall(request: NormalizedCommandExecutionRequest): boolean {
  return MANDATORY_CONFIRMATION_EXECUTABLES.has(path.basename(request.executable).toLowerCase()) &&
    !isHostVerifiedReadOnly(request);
}

function fsRealPath(value: string): string {
  try { return fs.realpathSync.native(value); } catch { throw invalidRequest(); }
}

function isInside(candidate: string, root: string): boolean {
  const resolvedCandidate = fsRealPath(candidate);
  const resolvedRoot = fsRealPath(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function invalidRequest(): PigeDomainError {
  return new PigeDomainError("command.request_invalid", "The command request is invalid.");
}
