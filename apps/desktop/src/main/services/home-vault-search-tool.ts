import type { RetrievalSearchResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { z } from "zod";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition,
  type PigeAgentToolResult
} from "./pi-agent-runtime-adapter";

export const HOME_SEARCH_TOOL_NAME = "pige_search_knowledge";

const HomeVaultSearchInputSchema = z.object({
  scope: z.enum(["optional", "vault_only"]).optional()
}).strict();

export type HomeVaultSearchScope = "optional" | "vault_only";

export function createHomeVaultSearchTool(options: {
  readonly authorize: () => void;
  readonly allowVaultOnly: boolean;
  readonly search: (scope: HomeVaultSearchScope) => RetrievalSearchResult | Promise<RetrievalSearchResult>;
  readonly projectResult: (result: RetrievalSearchResult) => PigeAgentToolResult;
}): PigeAgentToolDefinition {
  const parseScope = (args: unknown, errorCode: string): HomeVaultSearchScope => {
    const parsed = HomeVaultSearchInputSchema.safeParse(args);
    if (!parsed.success || (!options.allowVaultOnly && parsed.data.scope === "vault_only")) {
      throw new PigeDomainError(errorCode, "The local-knowledge search scope is invalid for this turn.");
    }
    return parsed.data.scope ?? "optional";
  };

  return {
    name: HOME_SEARCH_TOOL_NAME,
    label: "Search local knowledge",
    description: options.allowVaultOnly
      ? "Search bounded evidence in the active Pige vault. Use vault_only only when the user explicitly requires an answer solely from saved local knowledge."
      : "Search bounded evidence in the active Pige vault for this exact Reader action.",
    version: "2",
    capability: "read_current_vault_knowledge",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: options.allowVaultOnly ? ["optional", "vault_only"] : ["optional"]
        }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        evidence: { type: "array" },
        total: { type: "number" },
        degraded: { type: "boolean" }
      },
      required: ["status", "evidence", "total", "degraded"],
      additionalProperties: false
    },
    effect: "read_only",
    inputTrust: "model_generated",
    outputTrust: "untrusted_source",
    dataBoundary: {
      resourceScope: "current_vault",
      pathAuthority: "host_only",
      sourceIdAuthority: "host_only",
      modelAuthority: "none"
    },
    execution: "parallel_read_only",
    idempotency: { mode: "idempotent", scope: "current_vault" },
    limits: { maxInputBytes: 1_024, maxOutputBytes: 64 * 1_024, timeoutMs: 30_000 },
    ownerService: "HomeVaultSearchTool",
    authorize: (args) => {
      options.authorize();
      parseScope(args, "agent_runtime.tool_call_invalid");
      return true;
    },
    execute: async (args) => {
      options.authorize();
      const scope = parseScope(args, "agent_runtime.tool_binding_changed");
      return options.projectResult(await options.search(scope));
    }
  };
}

export function projectHomeVaultSearchResult(
  result: RetrievalSearchResult,
  modelText: string,
  resultCount: number
): PigeAgentToolResult {
  return createPigeTextToolResult(modelText, {
    resultCount,
    invalidPageCount: result.invalidPageCount,
    degraded: result.degraded
  });
}
