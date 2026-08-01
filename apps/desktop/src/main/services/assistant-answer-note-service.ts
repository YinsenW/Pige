import { createHash } from "node:crypto";
import path from "node:path";
import { parsePigeMarkdownPage } from "@pige/markdown";
import {
  AgentSaveAnswerAsNoteRequestSchema,
  AgentSaveAnswerAsNoteResultSchema,
  OperationRecordSchema,
  type AgentSaveAnswerAsNoteRequest,
  type AgentSaveAnswerAsNoteResult,
  type ConversationEvent,
  type OperationRecord
} from "@pige/schemas";
import type { AgentTurnAnswer, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { readDurableAgentTurnAnswer } from "./durable-agent-turn-answer";
import { ExternalOperationRecordStore } from "./external-operation-record-store";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact
} from "./generated-note-file";

const MAX_PAGE_BYTES = 128 * 1024;
const MAX_TITLE_CODE_POINTS = 120;
type AnswerCitation = AgentTurnAnswer["citations"][number];

export interface AssistantAnswerNoteVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface AssistantAnswerNoteConversationPort {
  readAssistantEvent(input: {
    readonly vaultPath: string;
    readonly conversationId: string;
    readonly assistantEventId: string;
  }): ConversationEvent | undefined;
}

export class AssistantAnswerNoteService {
  readonly #vaults: AssistantAnswerNoteVaultPort;
  readonly #conversations: AssistantAnswerNoteConversationPort;
  readonly #operations: ExternalOperationRecordStore;

  constructor(
    vaults: AssistantAnswerNoteVaultPort,
    conversations: AssistantAnswerNoteConversationPort,
    operations = new ExternalOperationRecordStore()
  ) {
    this.#vaults = vaults;
    this.#conversations = conversations;
    this.#operations = operations;
  }

  save(request: AgentSaveAnswerAsNoteRequest): AgentSaveAnswerAsNoteResult {
    const parsed = AgentSaveAnswerAsNoteRequestSchema.parse(request);
    const identity = resultIdentity(parsed);
    const active = this.#activeBinding(parsed.activeVaultId);
    if (!active) return AgentSaveAnswerAsNoteResultSchema.parse({ ...identity, status: "stale" });

    let event: ConversationEvent;
    try {
      const current = this.#conversations.readAssistantEvent({
        vaultPath: active.vaultPath,
        conversationId: parsed.conversationId,
        assistantEventId: parsed.assistantEventId
      });
      if (!current) return AgentSaveAnswerAsNoteResultSchema.parse({ ...identity, status: "not_found" });
      event = requireBoundAssistantEvent(current);
    } catch {
      return AgentSaveAnswerAsNoteResultSchema.parse({ ...identity, status: "stale" });
    }

    try {
      const artifact = createArtifact(event, parsed.conversationId);
      const expectedContentHash = event.contentHash!;
      const assertCurrent = (): void => {
        const binding = this.#activeBinding(parsed.activeVaultId);
        if (!binding || binding.vaultPath !== active.vaultPath) throw new StaleAnswerError();
        const current = this.#conversations.readAssistantEvent({
          vaultPath: binding.vaultPath,
          conversationId: parsed.conversationId,
          assistantEventId: parsed.assistantEventId
        });
        if (!current || requireBoundAssistantEvent(current).contentHash !== expectedContentHash) {
          throw new StaleAnswerError();
        }
      };

      const absolutePagePath = resolveVaultPath(active.vaultPath, artifact.pagePath);
      const existingPage = readGeneratedNoteExact(active.vaultPath, absolutePagePath, MAX_PAGE_BYTES);
      if (existingPage === undefined) {
        this.#vaults.assertWriterLease(active.vaultPath);
        createGeneratedNoteExclusive(active.vaultPath, absolutePagePath, artifact.markdown, {
          assertSourceCurrent: assertCurrent
        });
      }
      requireExactPage(active.vaultPath, absolutePagePath, artifact.markdown);
      assertCurrent();
      const operation = this.#operations.write(
        active.vaultPath,
        artifact.operation,
        () => {
          this.#vaults.assertWriterLease(active.vaultPath);
          assertCurrent();
        }
      );
      requireExactPage(active.vaultPath, absolutePagePath, artifact.markdown);
      return AgentSaveAnswerAsNoteResultSchema.parse({
        ...identity,
        status: "saved",
        pageId: artifact.pageId,
        operationId: operation.id,
        title: artifact.title
      });
    } catch (caught) {
      const status = caught instanceof StaleAnswerError || isDurableConflict(caught) ? "stale" : "failed";
      return AgentSaveAnswerAsNoteResultSchema.parse({ ...identity, status });
    }
  }

  #activeBinding(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === activeVaultId && vaultPath ? { vaultPath } : undefined;
  }
}

function requireBoundAssistantEvent(event: ConversationEvent): ConversationEvent {
  if (!event.contentHash || !event.jobId || !event.parentEventId) throw new StaleAnswerError();
  readDurableAgentTurnAnswer(event);
  return event;
}

function createArtifact(event: ConversationEvent, conversationId: string): {
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly markdown: string;
  readonly operation: OperationRecord;
} {
  const answer = readDurableAgentTurnAnswer(event);
  const dateKey = /^evt_(\d{8})_/u.exec(event.id)?.[1];
  if (!dateKey) throw new StaleAnswerError();
  const suffix = hashHex(`saved-answer-note\0${conversationId}\0${event.id}`).slice(0, 16);
  const pageId = `page_${dateKey}_${suffix}`;
  const operationId = `op_${dateKey}_${hashHex(`saved-answer-operation\0${conversationId}\0${event.id}`).slice(0, 16)}`;
  const pagePath = `wiki/generated/${dateKey.slice(0, 4)}/${pageId}.md`;
  const title = deriveTitle(answer.answer);
  const relatedPageIds = answer.citations.filter(isPageCitation).map(({ pageId: id }) => id);
  const sourceIds = answer.citations.filter(isDatasetCitation).map(({ evidence }) => evidence.sourceId);
  const markdown = createMarkdown({
    pageId,
    operationId,
    title,
    createdAt: event.createdAt,
    jobId: event.jobId!,
    body: answer.answer,
    citations: answer.citations,
    sourceIds: unique(sourceIds),
    relatedPageIds: unique(relatedPageIds)
  });
  const contentHash = sha256(markdown);
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: event.jobId,
    createdAt: event.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: pageId, path: pagePath }],
    sourceRefs: createOperationSourceRefs(event, conversationId, answer.citations),
    after: { kind: "page", id: contentHash, path: pagePath },
    summary: `Saved assistant answer as note ${JSON.stringify(title)}.`,
    reversible: "best_effort",
    rollbackHint: "Move the saved answer note to trash after verifying that it has not changed.",
    warnings: []
  });
  return { pageId, pagePath, title, markdown, operation };
}

function createMarkdown(input: {
  readonly pageId: string;
  readonly operationId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly jobId: string;
  readonly body: string;
  readonly citations: readonly AnswerCitation[];
  readonly sourceIds: readonly string[];
  readonly relatedPageIds: readonly string[];
}): string {
  const citations = formatCitations(input.citations);
  const markdown = `---\nid: ${JSON.stringify(input.pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(input.title)}\ntype: "note"\ncreated_at: ${JSON.stringify(input.createdAt)}\nupdated_at: ${JSON.stringify(input.createdAt)}\nstatus: "active"\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: ${JSON.stringify(input.sourceIds)}\nrelated_page_ids: ${JSON.stringify(input.relatedPageIds)}\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(input.jobId)}\n  last_operation_id: ${JSON.stringify(input.operationId)}\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# ${escapeHeading(input.title)}\n\n${input.body.trim()}${citations}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeMarkdownPage(markdown)) {
    throw new Error("assistant_answer_note.invalid_markdown");
  }
  return markdown;
}

function formatCitations(citations: readonly AnswerCitation[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map((citation) => {
    if (isDatasetCitation(citation)) {
      return `- ${escapeInline(citation.label)} — [source:${citation.evidence.sourceId}#${citation.locator}]`;
    }
    return `- [[${escapeWikiTarget(citation.title)}]] — ${escapeInline(citation.label)} (${escapeInline(citation.locator)})`;
  });
  return `\n\n## Sources\n\n${lines.join("\n")}`;
}

function createOperationSourceRefs(
  event: ConversationEvent,
  conversationId: string,
  citations: readonly AnswerCitation[]
): OperationRecord["sourceRefs"] {
  const refs: OperationRecord["sourceRefs"][number][] = [
    { kind: "conversation", id: event.id, checksum: event.contentHash },
    { kind: "job", id: event.jobId! },
    { kind: "conversation", id: conversationId }
  ];
  for (const citation of citations) {
    if (isDatasetCitation(citation)) {
      refs.push(
        { kind: "source", id: citation.evidence.sourceId },
        { kind: "dataset", id: citation.evidence.datasetId },
        { kind: "dataset_revision", id: citation.evidence.revisionId },
        { kind: "table", id: citation.evidence.tableId }
      );
    } else {
      refs.push({ kind: "page", id: citation.pageId });
    }
  }
  const deduped = new Map(refs.map((ref) => [`${ref.kind}:${ref.id}:${ref.checksum ?? ""}`, ref]));
  return Array.from(deduped.values());
}

function deriveTitle(answer: string): string {
  const first = answer.split(/\r?\n/gu)
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/u, "").trim())
    .find(Boolean) ?? "Saved answer";
  const normalized = first
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const points = Array.from(normalized || "Saved answer");
  return points.slice(0, MAX_TITLE_CODE_POINTS).join("");
}

function isDatasetCitation(citation: AnswerCitation): citation is Extract<AnswerCitation, { kind: "dataset" }> {
  return "kind" in citation && citation.kind === "dataset";
}

function isPageCitation(citation: AnswerCitation): citation is Exclude<AnswerCitation, { kind: "dataset" }> {
  return !isDatasetCitation(citation);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new StaleAnswerError();
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new StaleAnswerError();
  return resolved;
}

function requireExactPage(vaultPath: string, absolutePath: string, expected: string): void {
  if (readGeneratedNoteExact(vaultPath, absolutePath, MAX_PAGE_BYTES) !== expected) throw new StaleAnswerError();
}

function resultIdentity(request: AgentSaveAnswerAsNoteRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId,
    assistantEventId: request.assistantEventId
  } as const;
}

function hashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256(value: string): string {
  return `sha256:${hashHex(value)}`;
}

function escapeHeading(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/gu, "\\$1");
}

function escapeInline(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/([\\`*_{}\[\]()|>])/gu, "\\$1");
}

function escapeWikiTarget(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/([\\\]|])/gu, "\\$1");
}

function isDurableConflict(caught: unknown): boolean {
  return caught instanceof PigeDomainError && (
    caught.code === "agent_runtime.turn_changed" ||
    caught.code === "agent_runtime.turn_conflict" ||
    caught.code === "external_mutation.operation_conflict" ||
    caught.code === "external_mutation.operation_invalid"
  );
}

class StaleAnswerError extends Error {}
