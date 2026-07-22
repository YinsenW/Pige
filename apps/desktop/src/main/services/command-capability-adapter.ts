import { createHash } from "node:crypto";
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

export function createFirstPartyCommandCapabilityAdapter(
  commands = new CommandExecutionService()
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_run_command",
      label: "Run OS command",
      description: "Runs an OS executable with an argument array in a working directory. Use this for command-line tools, package installation, scripts, and system utilities. A shell such as zsh, bash, cmd, or PowerShell may be invoked explicitly when shell syntax is needed.",
      parameters: strictObjectSchema({
        executable: { type: "string", minLength: 1, maxLength: 4_096 },
        args: { type: "array", maxItems: 128, items: { type: "string", maxLength: 16_384 } },
        working_directory: { type: "string", minLength: 1, maxLength: 4_096 },
        timeout_ms: { type: "integer", minimum: 1_000, maximum: MAX_COMMAND_TIMEOUT_MS }
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
      highRisk: (input) => ({
        effect: "arbitrary_shell",
        presentation: {
          action: "run_shell_command",
          target: "local_system",
          subject: {
            kind: "executable_name",
            value: path.basename((input as NormalizedCommandExecutionRequest).executable)
          }
        }
      })
    },
    normalizeInput: (args) => commands.normalize(parseInput(args)),
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
  readonly executable: string;
  readonly args?: readonly string[];
  readonly workingDirectory?: string;
  readonly timeoutMs?: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const input = value as Record<string, unknown>;
  const allowed = new Set(["executable", "args", "working_directory", "timeout_ms"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw invalidRequest();
  if (typeof input.executable !== "string") throw invalidRequest();
  return {
    executable: input.executable,
    ...(input.args !== undefined ? { args: input.args as readonly string[] } : {}),
    ...(input.working_directory !== undefined ? { workingDirectory: input.working_directory as string } : {}),
    ...(input.timeout_ms !== undefined ? { timeoutMs: input.timeout_ms as number } : {})
  };
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
