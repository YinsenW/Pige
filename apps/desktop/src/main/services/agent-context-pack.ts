import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentRuntimePolicyContext } from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import type { ConversationContextCompactionSnapshot } from "./conversation-context-compaction-service";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CONTEXT_ID_PATTERN = /^context_[a-f0-9]{16}$/u;
const COMPACTION_PREFIX = "[Earlier conversation context compacted by Pige]";

const ContextItemRefSchema = z.object({
  refId: z.string().min(1).max(160),
  kind: z.enum(["vault", "policy", "job", "conversation", "memory", "attachment_set"]),
  id: z.string().min(1).max(256).optional(),
  checksum: z.string().regex(SHA256_PATTERN).optional(),
  budgetTokens: z.number().int().nonnegative().max(1_000_000),
  trust: z.enum(["trusted_policy", "vault_knowledge", "memory", "untrusted_source", "tool_result"])
}).strict();

const EvidenceContextRefSchema = z.object({
  refId: z.string().min(1).max(160),
  kind: z.enum(["markdown_page", "source_page", "source_artifact"]),
  pageId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  checksum: z.string().regex(SHA256_PATTERN).optional(),
  locator: z.string().min(1).max(256).optional(),
  citationRefs: z.array(z.string().regex(/^citation_(?:[1-9]|1[0-7])$/u)).max(2),
  budgetTokens: z.number().int().nonnegative().max(1_000_000),
  trust: z.enum(["vault_knowledge", "untrusted_source"])
}).strict().superRefine((ref, context) => {
  if ((ref.kind === "markdown_page" || ref.kind === "source_page") !== (ref.pageId !== undefined)) {
    context.addIssue({ code: "custom", path: ["pageId"], message: "Page evidence must own one page identity." });
  }
  if ((ref.kind === "source_artifact") !== (ref.sourceId !== undefined)) {
    context.addIssue({ code: "custom", path: ["sourceId"], message: "Source evidence must own one source identity." });
  }
});

export const AgentContextPackSchema = z.object({
  schemaVersion: z.literal(1),
  contextPackId: z.string().regex(CONTEXT_ID_PATTERN),
  workflow: z.enum(["query", "note_agent"]),
  budgetClass: z.enum(["home_query", "note_agent"]),
  retrievalScope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("vault"), vaultId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("current_note"), pageId: z.string().min(1) }).strict()
  ]),
  policyContextId: z.string().min(1),
  policyHash: z.string().regex(SHA256_PATTERN),
  authorityRefs: z.array(ContextItemRefSchema).max(8),
  taskStateRefs: z.array(ContextItemRefSchema).max(8),
  memoryRefs: z.array(ContextItemRefSchema).max(8),
  evidenceRefs: z.array(EvidenceContextRefSchema).max(9),
  conversationRefs: z.array(ContextItemRefSchema).max(2),
  toolResultRefs: z.array(ContextItemRefSchema).max(8),
  omitted: z.array(z.object({
    reason: z.enum(["conversation_compacted"]),
    count: z.number().int().positive()
  }).strict()).max(4),
  warnings: z.array(z.object({
    code: z.enum(["attachment_citation_capacity"]),
    count: z.number().int().positive()
  }).strict()).max(4)
}).strict();

export type AgentContextPack = z.infer<typeof AgentContextPackSchema>;

export interface AgentContextPackMemory {
  readonly id: string;
  readonly kind: AgentRuntimePolicyContext["memory"]["allowedMemoryScopes"][number];
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
}

export interface AgentContextPackHistoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface BuiltAgentContextPack {
  readonly pack: AgentContextPack;
  readonly contextPackHash: string;
  readonly durableRefs: readonly {
    readonly kind: "tool" | "memory" | "conversation";
    readonly id: string;
    readonly checksum?: string;
    readonly role: string;
  }[];
}

export interface BoundHomeAgentContextPack extends BuiltAgentContextPack {
  readonly assertCurrent: (job: JobRecord) => void;
}

export function bindHomeAgentContextPack(
  input: Parameters<typeof buildHomeAgentContextPack>[0]
): BoundHomeAgentContextPack {
  const approved = buildHomeAgentContextPack(input);
  if (
    (input.job.contextPackId && input.job.contextPackId !== approved.pack.contextPackId) ||
    (input.job.contextPackHash && input.job.contextPackHash !== approved.contextPackHash)
  ) {
    throw contextChanged("The durable Agent context pack changed before restart recovery.");
  }
  return {
    ...approved,
    assertCurrent: (job) => {
      const current = buildHomeAgentContextPack({ ...input, job });
      if (
        current.pack.contextPackId !== approved.pack.contextPackId ||
        current.contextPackHash !== approved.contextPackHash
      ) {
        throw contextChanged("The bounded Agent context pack changed during the exact turn.");
      }
    }
  };
}

export function contextPackJobFacts(binding: BuiltAgentContextPack) {
  return {
    contextPackId: binding.pack.contextPackId,
    contextPackHash: binding.contextPackHash,
    inputRefs: binding.durableRefs,
    message: "Pi Agent is bound to the exact reference-based context pack."
  };
}

export function buildHomeAgentContextPack(input: {
  readonly activeVaultId: string;
  readonly job: JobRecord;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly history: readonly AgentContextPackHistoryMessage[];
  readonly contextSnapshot?: ConversationContextCompactionSnapshot;
  readonly memories: readonly AgentContextPackMemory[];
}): BuiltAgentContextPack {
  const currentNote = input.job.inputRefs?.find(
    (ref) => ref.kind === "page" && ref.role === "agent_turn_current_note_scope" && ref.id
  );
  const sourceRefs = (input.job.inputRefs ?? [])
    .filter((ref) => ref.kind === "source" && ref.role === "agent_turn_source" && ref.id)
    .sort((left, right) => (left.locator ?? "").localeCompare(right.locator ?? "", "en-US"));
  const attachmentSet = input.job.inputRefs?.find(
    (ref) => ref.kind === "tool" && ref.role === "agent_turn_attachment_set" && ref.checksum
  );
  const memories = [...input.memories]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id, "en-US"))
    .slice(0, 8);
  const conversationHash = input.contextSnapshot?.contextHash ?? sha256(JSON.stringify({
    conversationId: input.conversationId,
    userEventId: input.userEventId,
    history: input.history
  }));
  const compactedCount = input.contextSnapshot?.omittedMessageCount || readCompactedMessageCount(input.history[0]?.text);
  const evidenceRefs = [
    ...(currentNote ? [{
      refId: "current_note",
      kind: "markdown_page" as const,
      pageId: currentNote.id!,
      ...(currentNote.checksum ? { checksum: currentNote.checksum } : {}),
      locator: currentNote.locator ?? "current_note",
      citationRefs: ["citation_1"],
      budgetTokens: 0,
      trust: "vault_knowledge" as const
    }] : []),
    ...sourceRefs.map((ref, index) => ({
      refId: `attachment_${index + 1}`,
      kind: "source_artifact" as const,
      sourceId: ref.id!,
      ...(ref.checksum ? { checksum: ref.checksum } : {}),
      locator: ref.locator ?? `attachment_${index + 1}`,
      citationRefs: index < 6 ? [`citation_${index + 11}`] : [],
      budgetTokens: 0,
      trust: "untrusted_source" as const
    }))
  ];
  const packBody = {
    schemaVersion: 1 as const,
    workflow: currentNote ? "note_agent" as const : "query" as const,
    budgetClass: currentNote ? "note_agent" as const : "home_query" as const,
    retrievalScope: currentNote
      ? { kind: "current_note" as const, pageId: currentNote.id! }
      : { kind: "vault" as const, vaultId: input.activeVaultId },
    policyContextId: input.policyContextId,
    policyHash: input.policyHash,
    authorityRefs: [
      { refId: "active_vault", kind: "vault" as const, id: input.activeVaultId, budgetTokens: 0, trust: "trusted_policy" as const },
      { refId: "runtime_policy", kind: "policy" as const, id: input.policyContextId, checksum: input.policyHash, budgetTokens: 0, trust: "trusted_policy" as const }
    ],
    taskStateRefs: [
      { refId: "agent_job", kind: "job" as const, id: input.job.id, budgetTokens: 0, trust: "trusted_policy" as const },
      { refId: "user_turn", kind: "conversation" as const, id: input.userEventId, budgetTokens: 0, trust: "trusted_policy" as const }
    ],
    memoryRefs: memories.map((memory) => ({
      refId: `memory_${memory.id}`,
      kind: "memory" as const,
      id: memory.id,
      checksum: sha256(JSON.stringify(memory)),
      budgetTokens: estimateTokens(`${memory.title}\n${memory.body}`),
      trust: "memory" as const
    })),
    evidenceRefs,
    conversationRefs: [{
      refId: "conversation_context",
      kind: "conversation" as const,
      id: input.conversationId,
      checksum: conversationHash,
      budgetTokens: input.history.reduce((total, message) => total + estimateTokens(message.text), 0),
      trust: "vault_knowledge" as const
    }],
    toolResultRefs: attachmentSet ? [{
      refId: "attachment_set",
      kind: "attachment_set" as const,
      id: attachmentSet.id ?? "pige_agent_attachment_set",
      checksum: attachmentSet.checksum!,
      budgetTokens: 0,
      trust: "tool_result" as const
    }] : [],
    omitted: compactedCount ? [{ reason: "conversation_compacted" as const, count: compactedCount }] : [],
    warnings: sourceRefs.length > 6
      ? [{ code: "attachment_citation_capacity" as const, count: sourceRefs.length - 6 }]
      : []
  };
  const contextPackHash = sha256(JSON.stringify(packBody));
  const contextPackId = `context_${contextPackHash.slice("sha256:".length, "sha256:".length + 16)}`;
  const pack = AgentContextPackSchema.parse({ ...packBody, contextPackId });
  return {
    pack,
    contextPackHash,
    durableRefs: [
      { kind: "tool", id: contextPackId, checksum: contextPackHash, role: "agent_context_pack" },
      { kind: "conversation", id: input.conversationId, checksum: conversationHash, role: "agent_context_conversation" },
      ...memories.map((memory) => ({
        kind: "memory" as const,
        id: memory.id,
        checksum: sha256(JSON.stringify(memory)),
        role: "agent_context_memory"
      }))
    ]
  };
}

function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(Array.from(text).length / 4));
}

function readCompactedMessageCount(text: string | undefined): number | undefined {
  if (!text?.startsWith(COMPACTION_PREFIX)) return undefined;
  const match = /\nOmitted (\d+) earlier user\/assistant messages/u.exec(text);
  const count = match ? Number.parseInt(match[1]!, 10) : 0;
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function contextChanged(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_conflict", message);
}
