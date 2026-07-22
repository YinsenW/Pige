import type {
  AgentConversationInputPresentation,
  AgentSubmitTurnResult,
  AgentTurnAnswer,
  HomeAgentModelUsage,
  ReaderSelectionIdentity,
  ReaderSelectionReadAction,
  ReaderSelectionTransformAction
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  PigeErrorSummarySchema,
  ReaderSelectionIdentitySchema,
  type ConversationEvent,
  type JobRecord
} from "@pige/schemas";
import type {
  AgentTurnConversationStore,
  PreservedAgentTurn
} from "./agent-turn-conversation-store";
import type {
  AdoptDurableCompletionInput,
  JobExecutionOutcome
} from "./job-execution-coordinator";
import {
  readCurrentNoteEvidenceBinding,
  readCurrentNoteSelectionEvidenceBinding,
  type CurrentNoteEvidenceBinding
} from "./retrieval-evidence-boundary";

export interface HomeAgentJobSession {
  current: JobRecord;
  modelInvocationStarted: boolean;
  modelUsage: HomeAgentModelUsage;
}

export interface HomeAgentTurnJobPort {
  settleAgentTurnJob(expected: JobRecord, outcome: JobExecutionOutcome): JobRecord;
  adoptAgentTurnCompletion(expected: JobRecord, input: AdoptDurableCompletionInput): JobRecord;
}

export interface HomeAgentReaderSelectionContext {
  readonly currentNoteSelection?: ReaderSelectionIdentity;
  readonly currentNoteReadAction?: ReaderSelectionReadAction;
  readonly currentNoteTransformAction?: ReaderSelectionTransformAction;
}

export interface HomeAgentCurrentNoteJobScope {
  readonly pageId: string;
  readonly bindingHash: string;
  readonly selection?: ReaderSelectionIdentity;
  readonly transformAction?: ReaderSelectionTransformAction;
}

export type HomeAgentReaderSelectionPublication =
  | { readonly status: "applied"; readonly operationId: string }
  | { readonly status: "review_required"; readonly proposalId: string };

export interface HomeAgentReaderSelectionMutationPort {
  apply(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly action: ReaderSelectionTransformAction;
  }): HomeAgentReaderSelectionPublication;
}

export function validateReaderSelectionTurnContext(input: {
  readonly scopePageId?: string;
  readonly sourceTurn: boolean;
  readonly prepared: boolean;
  readonly context: HomeAgentReaderSelectionContext;
}): void {
  const { context } = input;
  if (
    context.currentNoteSelection &&
    (input.scopePageId !== context.currentNoteSelection.pageId || input.sourceTurn || input.prepared)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "A Reader selection action requires the exact current-note scope."
    );
  }
  if ((context.currentNoteReadAction || context.currentNoteTransformAction) && !context.currentNoteSelection) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "A Reader selection presentation requires an exact selection identity."
    );
  }
  if (context.currentNoteReadAction && context.currentNoteTransformAction) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "One Reader selection turn cannot bind read and transform actions together."
    );
  }
}

export function readerSelectionInputPresentation(
  context: HomeAgentReaderSelectionContext
): AgentConversationInputPresentation | undefined {
  if (context.currentNoteReadAction) {
    return { kind: "reader_selection_action", action: context.currentNoteReadAction };
  }
  if (context.currentNoteTransformAction) {
    return { kind: "reader_selection_transform", action: context.currentNoteTransformAction };
  }
  return undefined;
}

export function readInitialCurrentNoteEvidence(
  vaultPath: string,
  pageId: string,
  context: HomeAgentReaderSelectionContext
): CurrentNoteEvidenceBinding {
  return context.currentNoteSelection
    ? readCurrentNoteSelectionEvidenceBinding(vaultPath, context.currentNoteSelection)
    : readCurrentNoteEvidenceBinding(vaultPath, pageId);
}

export function createCurrentNoteJobScope(
  pageId: string,
  bindingHash: string,
  context: HomeAgentReaderSelectionContext
): HomeAgentCurrentNoteJobScope {
  return {
    pageId,
    bindingHash,
    ...(context.currentNoteSelection ? { selection: context.currentNoteSelection } : {}),
    ...(context.currentNoteSelection && context.currentNoteTransformAction
      ? { transformAction: context.currentNoteTransformAction }
      : {})
  };
}

export function readBoundCurrentNoteEvidence(
  vaultPath: string,
  pageId: string,
  job: JobRecord
): CurrentNoteEvidenceBinding {
  const selectionRefs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_reader_selection");
  if (selectionRefs.length === 0) return readCurrentNoteEvidenceBinding(vaultPath, pageId);
  const selectionRef = selectionRefs[0];
  const locator = /^utf8_bytes:(\d+):(\d+)$/u.exec(selectionRef?.locator ?? "");
  if (
    selectionRefs.length !== 1 ||
    selectionRef?.kind !== "page" ||
    selectionRef.id !== pageId ||
    !selectionRef.checksum ||
    !locator
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The durable Reader selection binding is invalid.");
  }
  const current = readCurrentNoteEvidenceBinding(vaultPath, pageId);
  return readCurrentNoteSelectionEvidenceBinding(vaultPath, {
    pageId,
    pageContentHash: current.contentHash,
    span: {
      unit: "utf8_bytes",
      start: Number(locator[1]),
      endExclusive: Number(locator[2])
    },
    selectedContentHash: selectionRef.checksum
  });
}

export function applyReaderSelectionTransform(
  mutations: HomeAgentReaderSelectionMutationPort | undefined,
  vaultPath: string,
  job: JobRecord,
  answer: AgentTurnAnswer
): HomeAgentReaderSelectionPublication | undefined {
  const binding = readReaderSelectionTransformBinding(job);
  if (!binding) return undefined;
  if (!mutations) {
    throw new PigeDomainError(
      "agent_ingest.update_target_ineligible",
      "Reader selection mutation publication is unavailable."
    );
  }
  return mutations.apply({
    vaultPath,
    job,
    selection: binding.selection,
    replacement: answer.answer,
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
  const publication = applyReaderSelectionTransform(
    input.mutations,
    input.vaultPath,
    input.session.current,
    input.result
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
    const answer = readAssistantAnswer(assistant);
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
  readonly vaultPath: string;
  readonly session: HomeAgentJobSession;
  readonly assistant: ConversationEvent;
  readonly jobs: HomeAgentTurnJobPort;
  readonly mutations: HomeAgentReaderSelectionMutationPort | undefined;
}): "completed" | "waiting" {
  input.session.modelInvocationStarted = true;
  const answer = readAssistantAnswer(input.assistant);
  const publication = applyReaderSelectionTransform(
    input.mutations,
    input.vaultPath,
    input.session.current,
    answer
  );
  if (publication?.status === "review_required") {
    settleJobAfterAssistant({
      session: input.session,
      jobs: input.jobs,
      mutations: input.mutations,
      vaultPath: input.vaultPath,
      result: answer,
      assistantEventId: input.assistant.id,
      sourceIds: collectAgentTurnSourceIds(input.session.current, []),
      ...(input.assistant.contentHash ? { assistantContentHash: input.assistant.contentHash } : {})
    });
    return "waiting";
  }
  input.session.current = input.jobs.adoptAgentTurnCompletion(input.session.current, {
    checkpointId: "agent_turn_assistant_event_persisted",
    message: "Recovered the durable assistant result without another model call.",
    facts: {
      outputRefs: [{
        kind: "conversation",
        id: input.assistant.id,
        role: "agent_turn_assistant_event",
        ...(input.assistant.contentHash ? { checksum: input.assistant.contentHash } : {})
      }, ...(publication?.status === "applied" ? [{
        kind: "operation" as const,
        id: publication.operationId,
        role: "reader_selection_transform_operation"
      }] : [])],
      ...(publication?.status === "applied" ? { operationIds: [publication.operationId] } : {}),
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

export function readAssistantAnswer(event: ConversationEvent): AgentTurnAnswer {
  if (event.type !== "assistant_message" || typeof event.text !== "string") {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The durable assistant event is invalid.");
  }
  return {
    answer: event.text,
    grounding: event.answerGrounding ?? "general",
    citations: event.answerCitations ?? [],
    ...(event.answerDatasetResult ? { datasetResult: event.answerDatasetResult } : {})
  };
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

function readReaderSelectionTransformBinding(job: JobRecord): {
  readonly selection: ReaderSelectionIdentity;
  readonly action: ReaderSelectionTransformAction;
} | undefined {
  const refs = job.inputRefs ?? [];
  const transformRefs = refs.filter((ref) => ref.role === "agent_turn_reader_transform");
  if (transformRefs.length === 0) return undefined;
  const scopeRefs = refs.filter((ref) => ref.role === "agent_turn_current_note_scope");
  const selectionRefs = refs.filter((ref) => ref.role === "agent_turn_reader_selection");
  const transform = transformRefs[0];
  const scope = scopeRefs[0];
  const selection = selectionRefs[0];
  const actionMatch = /^reader_selection_(translate|polish|expand)$/u.exec(transform?.id ?? "");
  const locatorMatch = /^utf8_bytes:(\d+):(\d+)$/u.exec(selection?.locator ?? "");
  const parsed = ReaderSelectionIdentitySchema.safeParse({
    pageId: scope?.id,
    pageContentHash: transform?.checksum,
    span: {
      unit: "utf8_bytes",
      start: Number(locatorMatch?.[1]),
      endExclusive: Number(locatorMatch?.[2])
    },
    selectedContentHash: selection?.checksum
  });
  if (
    transformRefs.length !== 1 ||
    scopeRefs.length !== 1 ||
    selectionRefs.length !== 1 ||
    transform?.kind !== "tool" ||
    selection?.kind !== "page" ||
    selection.id !== scope?.id ||
    !actionMatch ||
    !locatorMatch ||
    !parsed.success
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The durable Reader transform binding is invalid.");
  }
  return { selection: parsed.data, action: actionMatch[1] as ReaderSelectionTransformAction };
}

function completionMessage(result: AgentTurnAnswer): string {
  if (result.grounding === "insufficient_evidence") {
    return "Agent turn completed with a contract-owned insufficient-evidence result.";
  }
  if (result.grounding === "local_knowledge") return "Agent turn completed with validated local citations.";
  if (result.grounding === "source") {
    return "Agent turn completed from one Agent-selected preserved URL source.";
  }
  return "Agent turn completed with a validated general response.";
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
