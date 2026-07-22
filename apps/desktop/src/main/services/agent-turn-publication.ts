import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AgentSubmitTurnResult,
  AgentTurnAnswer,
  HomeAgentModelUsage,
  ReaderSelectionIdentity,
  ReaderSelectionTransformAction
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  PigeErrorSummarySchema,
  type ConversationEvent,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import type {
  AgentTurnConversationStore,
  PreservedAgentTurn
} from "./agent-turn-conversation-store";
import type {
  AdoptDurableCompletionInput,
  JobExecutionOutcome
} from "./job-execution-coordinator";
import { readDurableAgentTurnAnswer } from "./durable-agent-turn-answer";
import {
  MAX_AGENT_PAGE_UPDATE_BYTES,
  createReaderSelectionReplacementContentHash,
  createAgentPageUpdateOperationId,
  readAgentPageUpdateOperationBinding
} from "./agent-page-update-service";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  removeGeneratedNoteExact
} from "./generated-note-file";
import {
  createReaderSelectionPublicationArtifact,
  readReaderSelectionTransformBinding
} from "./reader-selection-job-binding";

export interface HomeAgentJobSession {
  current: JobRecord;
  modelInvocationStarted: boolean;
  modelUsage: HomeAgentModelUsage;
}

export interface HomeAgentTurnJobPort {
  settleAgentTurnJob(expected: JobRecord, outcome: JobExecutionOutcome): JobRecord;
  adoptAgentTurnCompletion(expected: JobRecord, input: AdoptDurableCompletionInput): JobRecord;
}

export type HomeAgentReaderSelectionPublication =
  | { readonly status: "applied"; readonly operationId: string; readonly pageContentHash: string }
  | { readonly status: "review_required"; readonly proposalId: string }
  | { readonly status: "resolved"; readonly proposalId: string };

export interface HomeAgentReaderSelectionMutationPort {
  publish(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly action: ReaderSelectionTransformAction;
  }): HomeAgentReaderSelectionPublication;
  readPublication(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly action: ReaderSelectionTransformAction;
  }): HomeAgentReaderSelectionPublication | undefined;
}

export function requireReaderSelectionMutationPort(
  mutations: HomeAgentReaderSelectionMutationPort | undefined
): HomeAgentReaderSelectionMutationPort {
  if (!mutations) {
    throw new PigeDomainError(
      "agent_ingest.update_target_ineligible",
      "Reader selection mutation publication is unavailable."
    );
  }
  return mutations;
}

export function isNonRetryableReaderPublicationErrorCode(code: string): boolean {
  const suffix = code.split(".").slice(1).join(".");
  return new Set([
    "update_content_restricted",
    "update_target_ineligible",
    "update_too_large",
    "page_conflict"
  ]).has(suffix) || new Set(["identity_conflict", "record_invalid"]).has(suffix);
}

interface ReaderSelectionPublicationIntent {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly selection: ReaderSelectionIdentity;
  readonly action: ReaderSelectionTransformAction;
  readonly replacement: string;
}

const MAX_READER_SELECTION_INTENT_BYTES = 24 * 1024;

export function stageReaderSelectionPublicationIntent(
  vaultPath: string,
  job: JobRecord,
  replacement: string
): void {
  const binding = readReaderSelectionTransformBinding(job);
  if (!binding || !replacement || Buffer.byteLength(replacement, "utf8") > 16 * 1024) {
    throw publicationConflict("The Reader transform publication intent is invalid.");
  }
  const intent: ReaderSelectionPublicationIntent = {
    schemaVersion: 1,
    jobId: job.id,
    selection: binding.selection,
    action: binding.action,
    replacement
  };
  const serialized = `${JSON.stringify(intent, null, 2)}\n`;
  const intentPath = readerSelectionIntentPath(vaultPath, job.id);
  const result = createGeneratedNoteExclusive(vaultPath, intentPath, serialized);
  if (result === "created") return;
  const existing = readGeneratedNoteExact(
    vaultPath,
    intentPath,
    MAX_READER_SELECTION_INTENT_BYTES
  );
  if (existing !== serialized) {
    throw publicationConflict("The Reader transform publication intent changed before commit.");
  }
}

export function readReaderSelectionPublicationIntent(
  vaultPath: string,
  job: JobRecord
): ReaderSelectionPublicationIntent | undefined {
  const binding = readReaderSelectionTransformBinding(job);
  if (!binding) return undefined;
  const serialized = readGeneratedNoteExact(
    vaultPath,
    readerSelectionIntentPath(vaultPath, job.id),
    MAX_READER_SELECTION_INTENT_BYTES
  );
  if (serialized === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw publicationConflict("The Reader transform publication intent is invalid.");
  }
  if (!isReaderSelectionPublicationIntent(value) ||
    value.jobId !== job.id ||
    JSON.stringify(value.selection) !== JSON.stringify(binding.selection) ||
    value.action !== binding.action) {
    throw publicationConflict("The Reader transform publication intent does not match its Job binding.");
  }
  return value;
}

export function discardReaderSelectionPublicationIntent(vaultPath: string, job: JobRecord): void {
  const intentPath = readerSelectionIntentPath(vaultPath, job.id);
  const serialized = readGeneratedNoteExact(
    vaultPath,
    intentPath,
    MAX_READER_SELECTION_INTENT_BYTES
  );
  if (serialized === undefined) return;
  removeGeneratedNoteExact(
    vaultPath,
    intentPath,
    hashPublicationText(serialized),
    MAX_READER_SELECTION_INTENT_BYTES
  );
}

export function readReaderSelectionTransformPublication(
  mutations: HomeAgentReaderSelectionMutationPort | undefined,
  vaultPath: string,
  job: JobRecord
): HomeAgentReaderSelectionPublication | undefined {
  const binding = readReaderSelectionTransformBinding(job);
  if (!binding) return undefined;
  const intent = readReaderSelectionPublicationIntent(vaultPath, job);
  if (!intent) return undefined;
  return requireReaderSelectionMutationPort(mutations).readPublication({
    vaultPath,
    job,
    selection: binding.selection,
    replacement: intent.replacement,
    action: binding.action
  });
}

export function settleJobAfterAssistant(input: {
  readonly session: HomeAgentJobSession;
  readonly jobs: HomeAgentTurnJobPort;
  readonly mutations: HomeAgentReaderSelectionMutationPort | undefined;
  readonly vaultPath: string;
  readonly result: AgentTurnAnswer;
  readonly assistantEventId: string;
  readonly sourceIds: readonly string[];
  readonly assistantContentHash?: string;
}): boolean {
  const publication = readReaderSelectionTransformPublication(
    input.mutations,
    input.vaultPath,
    input.session.current
  );
  if (publication?.status === "review_required") {
    input.session.current = input.jobs.settleAgentTurnJob(input.session.current, {
      kind: "waiting",
      reason: "review",
      proposalId: publication.proposalId,
      message: "The Reader transform requires bounded review before any note bytes are changed.",
      facts: {
        stage: "planning",
        outputRefs: [
          ...mergeAgentTurnOutputRefs(
            input.session.current,
            input.assistantEventId,
            input.sourceIds,
            input.result,
            input.assistantContentHash
          ),
          { kind: "proposal", id: publication.proposalId, role: "awaiting_review" }
        ]
      }
    });
    return true;
  }
  if (publication?.status === "resolved") {
    throw publicationConflict("The Reader transform proposal resolved before its Job converged.");
  }
  completeJob({
    ...input,
    operationIds: publication?.status === "applied" ? [publication.operationId] : []
  });
  return false;
}

export function completeJob(input: {
  readonly session: HomeAgentJobSession;
  readonly jobs: HomeAgentTurnJobPort;
  readonly result: AgentTurnAnswer;
  readonly assistantEventId: string;
  readonly sourceIds?: readonly string[];
  readonly assistantContentHash?: string;
  readonly operationIds?: readonly string[];
}): void {
  const operationIds = input.operationIds ?? [];
  input.session.current = input.jobs.settleAgentTurnJob(input.session.current, {
    kind: "completed",
    message: completionMessage(input.result),
    facts: {
      stage: "planning",
      outputRefs: mergeAgentTurnOutputRefs(
        input.session.current,
        input.assistantEventId,
        input.sourceIds ?? [],
        input.result,
        input.assistantContentHash,
        operationIds
      ),
      ...(operationIds.length > 0 ? {
        operationIds: Array.from(new Set([...(input.session.current.operationIds ?? []), ...operationIds]))
      } : {}),
      privacy: modelInvocationPrivacy(input.session)
    }
  });
}

export function readDurableTurnResult(input: {
  readonly vaultPath: string;
  readonly session: HomeAgentJobSession;
  readonly preservedTurn: PreservedAgentTurn;
  readonly requestId: string;
  readonly sourceIds: readonly string[];
  readonly conversations: AgentTurnConversationStore;
  readonly jobs: HomeAgentTurnJobPort;
  readonly mutations: HomeAgentReaderSelectionMutationPort | undefined;
}): AgentSubmitTurnResult | undefined {
  const assistant = input.conversations.findAssistantTurn(
    input.vaultPath,
    input.preservedTurn.locator,
    input.session.current.id
  );
  if (assistant) {
    const answer = readDurableAgentTurnAnswer(assistant);
    input.session.modelInvocationStarted = true;
    input.session.modelUsage = input.session.current.privacy?.usedCloudModel === true ? "cloud" : "local";
    if (input.session.current.state === "awaiting_review") {
      return reviewRequiredTurnResult(input, assistant.id);
    }
    if (!new Set(["completed", "completed_with_warnings"]).has(input.session.current.state)) {
      const reviewRequired = settleJobAfterAssistant({
        session: input.session,
        jobs: input.jobs,
        mutations: input.mutations,
        vaultPath: input.vaultPath,
        result: answer,
        assistantEventId: assistant.id,
        sourceIds: collectAgentTurnSourceIds(input.session.current, input.sourceIds),
        ...(assistant.contentHash ? { assistantContentHash: assistant.contentHash } : {})
      });
      if (reviewRequired) return reviewRequiredTurnResult(input, assistant.id);
    }
    return {
      requestId: input.requestId,
      jobId: input.session.current.id,
      conversationEventId: input.preservedTurn.event.id,
      conversationId: input.preservedTurn.event.conversationId,
      tailEventId: assistant.id,
      state: "completed",
      modelUsage: actualHomeModelUsage(input.session),
      sourceIds: collectAgentTurnSourceIds(input.session.current, input.sourceIds),
      answer
    };
  }
  if (input.session.current.state === "queued") return undefined;
  if (new Set([
    "running",
    "cancel_requested",
    "waiting_dependency",
    "awaiting_review"
  ]).has(input.session.current.state)) {
    return {
      requestId: input.requestId,
      jobId: input.session.current.id,
      conversationEventId: input.preservedTurn.event.id,
      conversationId: input.preservedTurn.event.conversationId,
      tailEventId: input.preservedTurn.event.id,
      state: "waiting",
      modelUsage: actualHomeModelUsage(input.session),
      sourceIds: collectAgentTurnSourceIds(input.session.current, input.sourceIds),
      error: input.session.current.error ?? PigeErrorSummarySchema.parse({
        code: "agent_runtime.turn_in_progress",
        domain: "agent_runtime",
        messageKey: "errors.agent_runtime.turn_in_progress",
        retryable: false,
        severity: "info",
        userAction: "none"
      })
    };
  }
  const cancelled = input.session.current.state === "cancelled";
  return {
    requestId: input.requestId,
    jobId: input.session.current.id,
    conversationEventId: input.preservedTurn.event.id,
    conversationId: input.preservedTurn.event.conversationId,
    tailEventId: input.preservedTurn.event.id,
    state: "failed",
    modelUsage: actualHomeModelUsage(input.session),
    sourceIds: collectAgentTurnSourceIds(input.session.current, input.sourceIds),
    error: input.session.current.error ?? PigeErrorSummarySchema.parse({
      code: cancelled ? "agent_runtime.turn_cancelled" : "agent_runtime.turn_conflict",
      domain: "agent_runtime",
      messageKey: cancelled ? "errors.agent_runtime.turn_cancelled" : "errors.agent_runtime.turn_conflict",
      retryable: cancelled,
      severity: "error",
      userAction: cancelled ? "retry" : "none"
    })
  };
}

export function recoverDurableAssistantPublication(input: {
  readonly session: HomeAgentJobSession;
  readonly assistant: ConversationEvent;
  readonly jobs: HomeAgentTurnJobPort;
  readonly mutations: HomeAgentReaderSelectionMutationPort | undefined;
  readonly vaultPath: string;
  readonly sourceIds: readonly string[];
}): "completed" | "waiting" {
  input.session.modelInvocationStarted = true;
  const answer = readDurableAgentTurnAnswer(input.assistant);
  const publication = readReaderSelectionTransformPublication(
    input.mutations,
    input.vaultPath,
    input.session.current
  );
  if (publication?.status === "review_required") {
    input.session.current = input.jobs.settleAgentTurnJob(input.session.current, {
      kind: "waiting",
      reason: "review",
      proposalId: publication.proposalId,
      message: "Recovered the durable assistant result and its bounded Reader review.",
      facts: {
        stage: "planning",
        outputRefs: [
          ...mergeAgentTurnOutputRefs(
            input.session.current,
            input.assistant.id,
            input.sourceIds,
            answer,
            input.assistant.contentHash
          ),
          { kind: "proposal", id: publication.proposalId, role: "awaiting_review" }
        ]
      }
    });
    return "waiting";
  }
  if (publication?.status === "resolved") {
    throw publicationConflict("The Reader transform proposal resolved before recovery converged.");
  }
  const operationIds = publication?.status === "applied" ? [publication.operationId] : [];
  input.session.current = input.jobs.adoptAgentTurnCompletion(input.session.current, {
    checkpointId: "agent_turn_assistant_event_persisted",
    message: "Recovered the durable assistant result without another model call.",
    facts: {
      outputRefs: mergeAgentTurnOutputRefs(
        input.session.current,
        input.assistant.id,
        input.sourceIds,
        answer,
        input.assistant.contentHash,
        operationIds
      ),
      ...(operationIds.length > 0 ? {
        operationIds: Array.from(new Set([...(input.session.current.operationIds ?? []), ...operationIds]))
      } : {}),
      privacy: modelInvocationPrivacy(input.session)
    }
  });
  return "completed";
}

export function actualHomeModelUsage(session: HomeAgentJobSession | undefined): HomeAgentModelUsage {
  return session?.modelInvocationStarted ? session.modelUsage : "none";
}

export function collectAgentTurnSourceIds(
  job: JobRecord | undefined,
  contextualSourceIds: readonly string[] | undefined
): readonly string[] {
  return Array.from(new Set([
    ...(contextualSourceIds ?? []),
    ...(job?.outputRefs ?? [])
      .filter((ref) => ref.kind === "source" && (
        ref.role === "agent_turn_url_source" || ref.role === "agent_turn_dataset_source"
      ))
      .flatMap((ref) => ref.id ? [ref.id] : [])
  ]));
}

export function isDatasetAnswerCitation(
  citation: AgentTurnAnswer["citations"][number]
): citation is Extract<AgentTurnAnswer["citations"][number], { readonly kind: "dataset" }> {
  return "kind" in citation && citation.kind === "dataset";
}

function reviewRequiredTurnResult(
  input: Pick<Parameters<typeof readDurableTurnResult>[0], "requestId" | "session" | "preservedTurn" | "sourceIds">,
  tailEventId: string
): AgentSubmitTurnResult {
  return {
    requestId: input.requestId,
    jobId: input.session.current.id,
    conversationEventId: input.preservedTurn.event.id,
    conversationId: input.preservedTurn.event.conversationId,
    tailEventId,
    state: "waiting",
    modelUsage: actualHomeModelUsage(input.session),
    sourceIds: collectAgentTurnSourceIds(input.session.current, input.sourceIds),
    error: PigeErrorSummarySchema.parse({
      code: "agent_runtime.review_required",
      domain: "agent_runtime",
      messageKey: "errors.agent_runtime.review_required",
      retryable: false,
      severity: "info",
      userAction: "review_proposal"
    })
  };
}

function completionMessage(result: AgentTurnAnswer): string {
  if (result.grounding === "insufficient_evidence") {
    return "Agent turn completed with a contract-owned insufficient-evidence result.";
  }
  if (result.grounding === "local_knowledge") return "Agent turn completed with explicit local citations.";
  if (result.grounding === "source") {
    return "Agent turn completed from one Agent-selected preserved URL source.";
  }
  return "Agent turn completed with a general response.";
}

function mergeAgentTurnOutputRefs(
  job: JobRecord,
  assistantEventId: string,
  sourceIds: readonly string[],
  result: AgentTurnAnswer,
  assistantContentHash?: string,
  operationIds: readonly string[] = []
): NonNullable<JobRecord["outputRefs"]> {
  type OutputRef = NonNullable<JobRecord["outputRefs"]>[number];
  const refs = new Map<string, OutputRef>();
  const add = (ref: OutputRef): void => {
    refs.set(`${ref.kind}:${ref.id ?? ""}:${ref.role ?? ""}`, ref);
  };
  for (const ref of job.outputRefs ?? []) add(ref);
  add({
    kind: "conversation",
    id: assistantEventId,
    role: "agent_turn_assistant_event",
    ...(assistantContentHash ? { checksum: assistantContentHash } : {})
  });
  for (const sourceId of sourceIds) {
    add({
      kind: "source",
      id: sourceId,
      role: result.datasetResult ? "agent_turn_dataset_source" : "agent_turn_url_source"
    });
  }
  for (const operationId of operationIds) {
    add({ kind: "operation", id: operationId, role: "reader_selection_transform_operation" });
  }
  for (const citation of result.citations) {
    if (isDatasetAnswerCitation(citation)) {
      add({ kind: "dataset", id: citation.evidence.datasetId, role: "answer_dataset_citation" });
      add({
        kind: "dataset_revision",
        id: citation.evidence.revisionId,
        locator: citation.evidence.resultHash,
        role: "answer_dataset_query_result"
      });
      add({
        kind: "table",
        id: citation.evidence.tableId,
        locator: citation.locator,
        role: "answer_dataset_table"
      });
    } else {
      add({ kind: "page", id: citation.pageId, locator: citation.locator, role: "answer_citation" });
    }
  }
  return Array.from(refs.values());
}

function modelInvocationPrivacy(session: HomeAgentJobSession): NonNullable<JobRecord["privacy"]> {
  const actualUsage = actualHomeModelUsage(session);
  const usesExternalProvider = actualUsage === "cloud";
  return {
    usedCloudModel: usesExternalProvider,
    usedNetwork: usesExternalProvider || session.current.privacy?.usedNetwork === true,
    usedShell: false,
    accessedExternalFiles: false
  };
}

export function readReaderSelectionPageUpdateOperation(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly selection: ReaderSelectionIdentity;
  readonly replacement: string;
  readonly action: ReaderSelectionTransformAction;
}): OperationRecord | undefined {
  const operationId = createAgentPageUpdateOperationId(input.job.id, input.selection.pageId);
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  const serialized = readGeneratedNoteExact(
    input.vaultPath,
    resolvePublicationPath(input.vaultPath, [
      ".pige",
      "operations",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${operationId}.json`
    ].join("/")),
    256 * 1024
  );
  if (serialized === undefined) return undefined;
  let operation: OperationRecord;
  try {
    operation = OperationRecordSchema.parse(JSON.parse(serialized));
  } catch {
    throw publicationConflict("The Reader transform Operation is invalid.");
  }
  const binding = readAgentPageUpdateOperationBinding(operation);
  const artifact = createReaderSelectionPublicationArtifact(
    input.job.id,
    input.action,
    input.selection,
    input.replacement
  );
  const before = binding
    ? readGeneratedNoteExact(
        input.vaultPath,
        resolvePublicationPath(input.vaultPath, binding.beforePath),
        MAX_AGENT_PAGE_UPDATE_BYTES
      )
    : undefined;
  const expectedAfterHash = before
    ? createReaderSelectionReplacementContentHash(
        before,
        input.job.createdAt,
        input.selection,
        input.replacement
      )
    : undefined;
  if (
    operation.id !== operationId ||
    operation.jobId !== input.job.id ||
    binding?.pageId !== input.selection.pageId ||
    binding.beforeHash !== input.selection.pageContentHash ||
    hashPublicationText(before ?? "") !== binding.beforeHash ||
    binding.afterHash !== expectedAfterHash ||
    operation.summary !== `Applied a bounded ${input.action} transform to Pige-managed note ${input.selection.pageId}.` ||
    !operation.sourceRefs.some((ref) =>
      ref.kind === "artifact" &&
      ref.id === artifact.id &&
      ref.checksum === artifact.checksum
    )
  ) {
    throw publicationConflict("The Reader transform Operation does not match its durable turn binding.");
  }
  return operation;
}

function publicationConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_binding_invalid", message);
}

function resolvePublicationPath(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw publicationConflict("The Reader transform Operation path escapes the active vault.");
  }
  return resolved;
}

function readerSelectionIntentPath(vaultPath: string, jobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  return resolvePublicationPath(vaultPath, [
    ".pige",
    "private",
    "reader-selection-publications",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${jobId}.json`
  ].join("/"));
}

function isReaderSelectionPublicationIntent(value: unknown): value is ReaderSelectionPublicationIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "action,jobId,replacement,schemaVersion,selection" &&
    record.schemaVersion === 1 &&
    typeof record.jobId === "string" &&
    typeof record.replacement === "string" &&
    record.replacement.length > 0 &&
    Buffer.byteLength(record.replacement, "utf8") <= 16 * 1024 &&
    typeof record.action === "string" &&
    ["translate", "polish", "expand"].includes(record.action) &&
    typeof record.selection === "object" &&
    record.selection !== null;
}

function hashPublicationText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
