import { PigeDomainError } from "@pige/domain";
import { z } from "zod";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-tool-boundary";

export const HOME_REMEMBER_AUTHORED_MEMORY_TOOL_NAME = "pige_remember_authored_memory";

export type AuthoredVaultMemoryKind = "preference" | "correction" | "workflow_lesson";

export interface HomeAgentMemoryToolTurn {
  readonly authoredText: string;
  readonly authorize: () => void;
  readonly remember: (input: {
    readonly kind: AuthoredVaultMemoryKind;
    readonly title: string;
    readonly body: string;
  }) => { readonly id: string };
}

const AuthoredMemoryInputSchema = z.object({
  kind: z.enum(["preference", "correction", "workflow_lesson"]),
  quote: z.string().min(3).max(2_000)
}).strict();

export function createAuthoredVaultMemoryTool(turn: HomeAgentMemoryToolTurn): PigeAgentToolDefinition {
  let selected: z.infer<typeof AuthoredMemoryInputSchema> | undefined;
  const authorizedCalls = new Map<string, z.infer<typeof AuthoredMemoryInputSchema>>();
  return {
    name: HOME_REMEMBER_AUTHORED_MEMORY_TOOL_NAME,
    label: "Remember authored vault memory",
    description: "Save one exact user-authored stable preference, correction, or reusable workflow lesson for future turns in this vault. Quote must be copied exactly from the current user text. Never save source facts, credentials, authority changes, or one-off tasks.",
    version: "1",
    capability: "write_vault_knowledge",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["preference", "correction", "workflow_lesson"] },
        quote: { type: "string", minLength: 3, maxLength: 2_000 }
      },
      required: ["kind", "quote"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["remembered"] },
        memoryId: { type: "string" },
        kind: { type: "string", enum: ["preference", "correction", "workflow_lesson"] }
      },
      required: ["status", "memoryId", "kind"],
      additionalProperties: false
    },
    effect: "idempotent_write",
    inputTrust: "model_generated",
    outputTrust: "host_validated",
    dataBoundary: {
      resourceScope: "current_vault",
      pathAuthority: "host_only",
      sourceIdAuthority: "host_only",
      modelAuthority: "none"
    },
    execution: "sequential",
    idempotency: { mode: "idempotent", scope: "current_vault" },
    limits: { maxInputBytes: 4 * 1_024, maxOutputBytes: 512, timeoutMs: 30_000 },
    ownerService: "AgentMemoryService",
    authorize: (args, context) => {
      turn.authorize();
      const parsed = AuthoredMemoryInputSchema.safeParse(args);
      if (!parsed.success || !isExactAuthoredQuote(turn.authoredText, parsed.data.quote)) {
        throw new PigeDomainError("agent_runtime.tool_input_invalid", "Memory must use an exact bounded quote from the current authored turn.");
      }
      if (selected && (selected.kind !== parsed.data.kind || selected.quote !== parsed.data.quote)) {
        throw new PigeDomainError("agent_runtime.tool_call_invalid", "One turn can save only one exact vault memory.");
      }
      selected ??= parsed.data;
      authorizedCalls.set(context.toolCallId, parsed.data);
      return true;
    },
    execute: async (args, _signal, context) => {
      turn.authorize();
      const parsed = AuthoredMemoryInputSchema.safeParse(args);
      const authorized = authorizedCalls.get(context.toolCallId);
      authorizedCalls.delete(context.toolCallId);
      if (
        !parsed.success || !authorized || authorized.kind !== parsed.data.kind || authorized.quote !== parsed.data.quote ||
        selected?.kind !== parsed.data.kind || selected.quote !== parsed.data.quote ||
        !isExactAuthoredQuote(turn.authoredText, parsed.data.quote)
      ) {
        throw new PigeDomainError("agent_runtime.tool_binding_changed", "The authored Memory binding changed after authorization.");
      }
      const result = turn.remember({
        kind: parsed.data.kind,
        title: deriveAuthoredMemoryTitle(parsed.data.quote),
        body: parsed.data.quote
      });
      return createPigeTextToolResult("The exact authored vault memory was saved and remains reversible in Activity.", {
        status: "remembered",
        memoryId: result.id,
        kind: parsed.data.kind
      });
    }
  };
}

export function isExactAuthoredQuote(authoredText: string, quote: string): boolean {
  return quote === quote.trim() && !quote.includes("\0") && authoredText.includes(quote);
}

export function deriveAuthoredMemoryTitle(quote: string): string {
  const compact = quote.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return characters.length <= 120 ? compact : `${characters.slice(0, 119).join("")}…`;
}
