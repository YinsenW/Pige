import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentConversationInitialTimeline,
  AgentConversationMessage,
  AgentSubmitTurnResult,
  AgentTurnDraftEvent,
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalPreview,
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalPreview,
  PigeErrorSummary,
  ReaderSelectionProposalPreview
} from "@pige/contracts";
import type { JobState, Locale } from "@pige/schemas";
import {
  NoteAgentPanel,
  type NoteAgentAvailability,
  type NoteAgentMessage,
  type NoteAgentModelOption
} from "./NoteAgentPanel";
import { useConversationPagination } from "./ConversationPagination";

type ActiveDraftBinding = {
  readonly clientTurnId: string;
  requestId?: string;
  jobId?: string;
  conversationId?: string;
  conversationEventId?: string;
  sequence: number;
};

type CurrentNoteMutationProposalPreview = CurrentNoteAppendProposalPreview | CurrentNoteReplaceProposalPreview;
type CurrentNoteMutationProposalDecisionResult =
  CurrentNoteAppendProposalDecisionResult | CurrentNoteReplaceProposalDecisionResult;

export function CurrentNoteAgent(props: {
  readonly modal: boolean;
  readonly vaultId: string;
  readonly pageId: string;
  readonly noteTitle: string;
  readonly locale: Locale;
  readonly models: readonly NoteAgentModelOption[];
  readonly onClose: () => void;
  readonly onOpenModels: (opener: HTMLButtonElement) => void;
  readonly onSelectModel: (modelId: string) => Promise<boolean>;
  readonly proposal?: ReaderSelectionProposalPreview | null;
  readonly proposalErrorMessageKey?: string;
  readonly onProposalAction?: (proposalId: string, action: "reject" | "later" | "apply") => void;
  readonly onDurableTurnCompleted?: (identity: {
    readonly vaultId: string;
    readonly pageId: string;
    readonly jobId: string;
  }) => void;
  readonly onOpenCitation: (pageId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [timeline, setTimeline] = useState<AgentConversationInitialTimeline | undefined>();
  const [timelineReadState, setTimelineReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [draft, setDraft] = useState("");
  const [liveDraft, setLiveDraft] = useState<AgentTurnDraftEvent | null>(null);
  const [currentOutcome, setCurrentOutcome] = useState<AgentSubmitTurnResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<PigeErrorSummary | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [appendProposal, setAppendProposal] = useState<{
    readonly preview: CurrentNoteMutationProposalPreview;
    readonly errorMessageKey?: string;
  } | null>(null);
  const [appendProposalLoadErrorMessageKey, setAppendProposalLoadErrorMessageKey] = useState<string | null>(null);
  const [dismissedAppendProposalId, setDismissedAppendProposalId] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const appendProposalSequenceRef = useRef(0);
  const appendProposalDecisionInFlightRef = useRef(false);
  const resolvedMutationRef = useRef<{ readonly jobId: string; readonly kind: CurrentNoteMutationProposalPreview["kind"] } | null>(null);
  const reportedTerminalJobsRef = useRef(new Set<string>());
  const activePageIdRef = useRef<string | null>(props.pageId);
  const activeVaultIdRef = useRef<string | null>(props.vaultId);
  const activeDraftRef = useRef<ActiveDraftBinding | null>(null);
  const currentOutcomeRef = useRef<AgentSubmitTurnResult | null>(null);
  const submitInFlightRef = useRef(false);
  const modelSwitchInFlightRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  activePageIdRef.current = props.pageId;
  activeVaultIdRef.current = props.vaultId;
  currentOutcomeRef.current = currentOutcome;

  const timelineLatestTurn = timeline?.latestTurn;
  const timelineOwnsCurrentOutcome = !currentOutcome?.jobId || timelineLatestTurn?.jobId === currentOutcome.jobId;
  const latestTurn = timelineOwnsCurrentOutcome ? timelineLatestTurn : undefined;
  const outcomeError = currentOutcome?.state === "completed" ? null : currentOutcome?.error ?? null;
  const effectiveError = latestTurn?.error ?? outcomeError ?? error;
  const currentJobId = latestTurn?.jobId ?? currentOutcome?.jobId;
  const appendProposalBinding = currentNoteAppendProposalBinding(latestTurn, currentOutcome);

  const pagination = useConversationPagination({
    ownerKey: `${props.vaultId}:current_note:${props.pageId}`,
    initial: timeline,
    scope: { kind: "current_note", pageId: props.pageId },
    scrollRef: threadRef
  });

  const refreshTimeline = async (): Promise<AgentConversationInitialTimeline | undefined> => {
    const pageId = props.pageId;
    const vaultId = props.vaultId;
    const sequence = ++loadSequenceRef.current;
    try {
      const next = await window.pige.agent.conversation({
        scope: { kind: "current_note", pageId },
        limit: 100
      });
      if (
        sequence === loadSequenceRef.current &&
        activePageIdRef.current === pageId &&
        activeVaultIdRef.current === vaultId
      ) {
        setTimeline(next);
        setTimelineReadState("ready");
        const activeOutcome = currentOutcomeRef.current;
        if (!activeOutcome?.jobId || next?.latestTurn?.jobId === activeOutcome.jobId) {
          setError(next?.latestTurn?.error ?? (activeOutcome?.state === "completed" ? null : activeOutcome?.error ?? null));
        }
        if (!isDraftState(next?.latestTurn?.state)) {
          activeDraftRef.current = null;
          setLiveDraft(null);
        }
      }
      return next;
    } catch {
      if (
        sequence === loadSequenceRef.current &&
        activePageIdRef.current === pageId &&
        activeVaultIdRef.current === vaultId
      ) {
        setTimelineReadState("failed");
        setError(genericAgentError());
      }
      return undefined;
    }
  };

  useEffect(() => {
    loadSequenceRef.current += 1;
    activeDraftRef.current = null;
    setTimeline(undefined);
    setTimelineReadState("loading");
    setDraft("");
    setLiveDraft(null);
    setCurrentOutcome(null);
    setSubmitting(false);
    setError(null);
    setSwitchingModel(false);
    setAppendProposal(null);
    setAppendProposalLoadErrorMessageKey(null);
    setDismissedAppendProposalId(null);
    appendProposalSequenceRef.current += 1;
    appendProposalDecisionInFlightRef.current = false;
    resolvedMutationRef.current = null;
    reportedTerminalJobsRef.current.clear();
    modelSwitchInFlightRef.current = false;
    void refreshTimeline();
    return () => {
      loadSequenceRef.current += 1;
      activePageIdRef.current = null;
      activeVaultIdRef.current = null;
      activeDraftRef.current = null;
    };
  }, [props.pageId, props.vaultId]);

  useEffect(() => {
    const binding = appendProposalBinding;
    if (!binding || binding.proposalId === dismissedAppendProposalId) {
      appendProposalSequenceRef.current += 1;
      setAppendProposal(null);
      setAppendProposalLoadErrorMessageKey(null);
      return;
    }
    const vaultId = props.vaultId;
    const pageId = props.pageId;
    const sequence = appendProposalSequenceRef.current + 1;
    appendProposalSequenceRef.current = sequence;
    const read = async (): Promise<void> => {
      try {
        const appendRead = await window.pige.agent.currentNoteAppendProposal({
            apiVersion: 1,
            activeVaultId: vaultId,
            pageId,
            jobId: binding.jobId,
            proposalId: binding.proposalId
          }).catch(() => null);
        const appendReadFailed = appendRead === null;
        if (!appendProposalReadIsCurrent(sequence, vaultId, pageId, binding, activeVaultIdRef, activePageIdRef, appendProposalSequenceRef)) return;
        if (appendRead?.status === "available") {
          if (currentNoteMutationProposalMatches(appendRead.proposal, vaultId, pageId, binding)) {
            setAppendProposal({ preview: appendRead.proposal });
            setAppendProposalLoadErrorMessageKey(null);
          } else {
            setAppendProposal(null);
            setAppendProposalLoadErrorMessageKey("note.proposal.unavailable");
          }
          return;
        }
        const replaceRead = await window.pige.agent.currentNoteReplaceProposal({
            apiVersion: 1,
            activeVaultId: vaultId,
            jobId: binding.jobId,
            proposalId: binding.proposalId
          }).catch(() => null);
        if (!appendProposalReadIsCurrent(sequence, vaultId, pageId, binding, activeVaultIdRef, activePageIdRef, appendProposalSequenceRef)) return;
        if (
          replaceRead?.status === "available" &&
          currentNoteMutationProposalMatches(replaceRead.proposal, vaultId, pageId, binding)
        ) {
          setAppendProposal({ preview: replaceRead.proposal });
          setAppendProposalLoadErrorMessageKey(null);
        } else {
          setAppendProposal(null);
          setAppendProposalLoadErrorMessageKey(
            appendReadFailed || replaceRead === null || replaceRead.status === "failed"
              ? "note.proposal.decisionFailed"
              : "note.proposal.unavailable"
          );
        }
      } catch {
        if (!appendProposalReadIsCurrent(sequence, vaultId, pageId, binding, activeVaultIdRef, activePageIdRef, appendProposalSequenceRef)) return;
        setAppendProposal(null);
        setAppendProposalLoadErrorMessageKey("note.proposal.decisionFailed");
      }
    };
    void read();
    return () => {
      appendProposalSequenceRef.current += 1;
    };
  }, [appendProposalBinding?.jobId, appendProposalBinding?.proposalId, dismissedAppendProposalId, props.pageId, props.vaultId]);

  const terminalJobId = terminalSuccessfulJobId(latestTurn, currentOutcome, resolvedMutationRef.current);
  useEffect(() => {
    if (!terminalJobId || reportedTerminalJobsRef.current.has(terminalJobId)) return;
    reportedTerminalJobsRef.current.add(terminalJobId);
    props.onDurableTurnCompleted?.({ vaultId: props.vaultId, pageId: props.pageId, jobId: terminalJobId });
  }, [props.onDurableTurnCompleted, props.pageId, props.vaultId, terminalJobId]);

  useEffect(() => window.pige.agent.onTurnDraft((event) => {
    const active = activeDraftRef.current;
    if (!active || !validDraftEvent(event) || event.clientTurnId !== active.clientTurnId || event.sequence <= active.sequence) return;
    if (
      active.requestId !== undefined &&
      (
        event.requestId !== active.requestId ||
        event.jobId !== active.jobId ||
        event.conversationId !== active.conversationId ||
        event.conversationEventId !== active.conversationEventId
      )
    ) return;
    active.requestId ??= event.requestId;
    active.jobId ??= event.jobId;
    active.conversationId ??= event.conversationId;
    active.conversationEventId ??= event.conversationEventId;
    active.sequence = event.sequence;
    setLiveDraft(event);
  }), []);

  useEffect(() => {
    if (!isPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshTimeline(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.pageId, latestTurn?.jobId, latestTurn?.state]);

  const messages = useMemo(
    () => timelineMessages(pagination.messages, liveDraft, currentOutcome, props.t),
    [pagination.messages, liveDraft, currentOutcome, props.t]
  );
  const availability = noteAgentAvailability(
    latestTurn?.state,
    submitting,
    timelineReadState,
    effectiveError,
    currentOutcome?.state
  );
  const modelSwitchBlocked = timelineReadState !== "ready" ||
    isModelSwitchBlocked(latestTurn?.state, submitting);

  const selectModel = async (modelId: string): Promise<boolean> => {
    if (modelSwitchInFlightRef.current || modelSwitchBlocked) return false;
    modelSwitchInFlightRef.current = true;
    setSwitchingModel(true);
    try {
      return await props.onSelectModel(modelId);
    } finally {
      modelSwitchInFlightRef.current = false;
      if (activePageIdRef.current === props.pageId && activeVaultIdRef.current === props.vaultId) {
        setSwitchingModel(false);
      }
    }
  };

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || submitInFlightRef.current || availability !== "ready") return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    currentOutcomeRef.current = null;
    setCurrentOutcome(null);
    const pageId = props.pageId;
    const vaultId = props.vaultId;
    const clientTurnId = createClientTurnId();
    activeDraftRef.current = { clientTurnId, sequence: 0 };
    setLiveDraft(null);
    const followUp = canFollowUp(timeline) ? timeline : undefined;
    try {
      const outcome = await window.pige.agent.submitTurn({
        schemaVersion: 1,
        text,
        inputKind: followUp ? "follow_up" : "typed_text",
        scope: { kind: "current_note", pageId },
        locale: props.locale,
        clientTurnId,
        ...(followUp ? {
          conversationId: followUp.conversationId,
          expectedTailEventId: followUp.tailEventId
        } : {})
      });
      if (activePageIdRef.current !== pageId || activeVaultIdRef.current !== vaultId) return;
      currentOutcomeRef.current = outcome;
      setCurrentOutcome(outcome);
      if (outcome.state !== "failed") {
        setDraft("");
        activeDraftRef.current = {
          clientTurnId,
          requestId: outcome.requestId,
          jobId: outcome.jobId,
          conversationId: outcome.conversationId,
          conversationEventId: outcome.conversationEventId,
          sequence: activeDraftRef.current?.sequence ?? 0
        };
      }
      setError(outcome.state === "completed" ? null : outcome.error);
      if (outcome.state === "completed" || outcome.state === "failed") {
        activeDraftRef.current = null;
        setLiveDraft(null);
      }
      await refreshTimeline();
    } catch {
      if (activePageIdRef.current === pageId && activeVaultIdRef.current === vaultId) {
        activeDraftRef.current = null;
        setLiveDraft(null);
        setError(genericAgentError());
      }
    } finally {
      if (activePageIdRef.current === pageId && activeVaultIdRef.current === vaultId) setSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const cancel = async (): Promise<void> => {
    if (!latestTurn || (latestTurn.state !== "running" && latestTurn.state !== "cancel_requested")) return;
    await window.pige.jobs.cancel({ jobId: latestTurn.jobId }).catch(() => undefined);
    await refreshTimeline();
  };

  const retry = async (): Promise<void> => {
    if (effectiveError?.retryable !== true || effectiveError.userAction !== "retry") return;
    setError(null);
    if (currentJobId) {
      await window.pige.jobs.retry({ jobId: currentJobId }).catch(() => undefined);
    }
    await refreshTimeline();
  };

  const decideAppendProposal = async (
    proposalId: string,
    action: "reject" | "later" | "apply"
  ): Promise<void> => {
    const current = appendProposal;
    if (!current || current.preview.proposalId !== proposalId) return;
    if (action === "later") {
      appendProposalSequenceRef.current += 1;
      setDismissedAppendProposalId(proposalId);
      setAppendProposal(null);
      return;
    }
    if (appendProposalDecisionInFlightRef.current || current.preview.state !== "ready") return;
    const vaultId = props.vaultId;
    const pageId = props.pageId;
    if (
      activeVaultIdRef.current !== vaultId ||
      activePageIdRef.current !== pageId ||
      current.preview.activeVaultId !== vaultId ||
      (current.preview.kind === "append_current_note" && current.preview.pageId !== pageId)
    ) return;
    appendProposalDecisionInFlightRef.current = true;
    const sequence = appendProposalSequenceRef.current + 1;
    appendProposalSequenceRef.current = sequence;
    setAppendProposal({ preview: { ...current.preview, state: "resolving" } });
    let result: CurrentNoteMutationProposalDecisionResult;
    try {
      const decision = action === "apply" ? "approve" as const : "reject" as const;
      result = current.preview.kind === "append_current_note"
        ? await window.pige.agent.decideCurrentNoteAppendProposal({
            apiVersion: 1,
            activeVaultId: vaultId,
            pageId,
            jobId: current.preview.jobId,
            proposalId,
            expectedRevision: current.preview.revision,
            decision
          })
        : await window.pige.agent.decideCurrentNoteReplaceProposal({
            apiVersion: 1,
            activeVaultId: vaultId,
            jobId: current.preview.jobId,
            proposalId,
            expectedRevision: current.preview.revision,
            decision
          });
    } catch {
      if (sequence === appendProposalSequenceRef.current) {
        setAppendProposal({ ...current, errorMessageKey: "note.proposal.decisionFailed" });
      }
      appendProposalDecisionInFlightRef.current = false;
      return;
    }
    appendProposalDecisionInFlightRef.current = false;
    if (
      sequence !== appendProposalSequenceRef.current ||
      activeVaultIdRef.current !== vaultId ||
      activePageIdRef.current !== pageId
    ) return;
    applyMutationProposalDecisionResult(result, current, vaultId, pageId, setAppendProposal);
    if (result.status === "applied") {
      resolvedMutationRef.current = { jobId: current.preview.jobId, kind: current.preview.kind };
    }
    if (result.status === "applied" || result.status === "rejected") await refreshTimeline();
  };

  const visibleProposal = appendProposal?.preview ?? props.proposal ?? null;
  const visibleProposalError = appendProposal?.errorMessageKey ?? props.proposalErrorMessageKey;
  const panelErrorMessageKey = appendProposalLoadErrorMessageKey ?? effectiveError?.messageKey;

  return (
    <NoteAgentPanel
      modal={props.modal}
      noteTitle={props.noteTitle}
      availability={availability}
      composerDisabled={timelineReadState !== "ready"}
      messages={messages}
      threadRef={threadRef}
      pagination={pagination}
      proposal={visibleProposal ? {
        id: visibleProposal.proposalId,
        action: "kind" in visibleProposal ? visibleProposal.kind : visibleProposal.action,
        revision: visibleProposal.revision,
        lines: visibleProposal.lines,
        state: visibleProposal.state,
        ...(visibleProposalError ? { errorMessageKey: visibleProposalError } : {})
      } : null}
      draft={draft}
      models={props.models}
      switchingModel={switchingModel || modelSwitchBlocked}
      onClose={props.onClose}
      onDraftChange={setDraft}
      onSubmit={() => void submit()}
      {...(panelErrorMessageKey ? { errorMessageKey: panelErrorMessageKey } : {})}
      {...(latestTurn && (latestTurn.state === "running" || latestTurn.state === "cancel_requested")
        ? { onCancel: () => void cancel() }
        : {})}
      {...(effectiveError?.retryable === true && effectiveError.userAction === "retry" ? { onRetry: () => void retry() } : {})}
      onOpenModels={props.onOpenModels}
      onSelectModel={selectModel}
      onProposalAction={(proposalId, action) => {
        if (appendProposal?.preview.proposalId === proposalId) void decideAppendProposal(proposalId, action);
        else props.onProposalAction?.(proposalId, action);
      }}
      onOpenCitation={props.onOpenCitation}
      onCopyMessage={async (messageId) => {
        const message = messages.find((candidate) => candidate.id === messageId);
        if (!message || !navigator.clipboard?.writeText) return false;
        try {
          await navigator.clipboard.writeText(message.body);
          return true;
        } catch {
          return false;
        }
      }}
      t={props.t}
    />
  );
}

function timelineMessages(
  timelineMessages: readonly AgentConversationMessage[],
  liveDraft: AgentTurnDraftEvent | null,
  currentOutcome: AgentSubmitTurnResult | null,
  t: (key: string) => string
): readonly NoteAgentMessage[] {
  const messages: NoteAgentMessage[] = timelineMessages.map((message) => {
    const timestamp = formatMessageTime(message.createdAt);
    return {
      id: message.id,
      role: message.role,
      body: message.inputPresentation
        ? t(message.inputPresentation.kind === "reader_selection_action"
          ? `note.selection.${message.inputPresentation.action}`
          : `note.proposal.action.${message.inputPresentation.action}`)
        : message.text,
      ...(timestamp ? { timestamp } : {}),
      ...(message.answer?.citations.length ? {
      citations: message.answer.citations.flatMap((citation) =>
        "pageId" in citation
          ? [{ pageId: citation.pageId, label: citation.label || citation.title }]
          : [])
      } : {})
    };
  }).filter((message) => message.body.trim().length > 0 || Boolean(message.citations?.length));
  if (liveDraft?.text) {
    messages.push({
      id: `draft:${liveDraft.jobId}`,
      role: "assistant",
      body: liveDraft.text,
      provisional: true
    });
  } else if (
    currentOutcome?.state === "completed" &&
    !messages.some((message) => message.id === currentOutcome.tailEventId)
  ) {
    messages.push({
      id: currentOutcome.tailEventId,
      role: "assistant",
      body: currentOutcome.answer.answer,
      ...(currentOutcome.answer.citations.length ? {
        citations: currentOutcome.answer.citations.flatMap((citation) =>
          "pageId" in citation
            ? [{ pageId: citation.pageId, label: citation.label || citation.title }]
            : [])
      } : {})
    });
  }
  return messages;
}

function noteAgentAvailability(
  state: JobState | undefined,
  submitting: boolean,
  timelineReadState: "loading" | "ready" | "failed",
  error: PigeErrorSummary | null,
  outcomeState: AgentSubmitTurnResult["state"] | undefined
): NoteAgentAvailability {
  if (timelineReadState === "loading") return "running";
  if (timelineReadState === "failed") return "failed";
  if (
    submitting ||
    state === "queued" ||
    state === "running" ||
    state === "cancel_requested"
  ) return "running";
  if (
    outcomeState === "waiting" ||
    outcomeState === "failed" ||
    error ||
    state === "failed_retryable" ||
    state === "failed_final" ||
    state === "cancelled"
  ) return "failed";
  return "ready";
}

function isModelSwitchBlocked(
  state: JobState | undefined,
  submitting: boolean
): boolean {
  return submitting ||
    state === "queued" ||
    state === "running" ||
    state === "cancel_requested";
}

function isPollingState(state: JobState | undefined): boolean {
  return state === "queued" ||
    state === "running" ||
    state === "cancel_requested" ||
    state === "waiting_dependency";
}

function isDraftState(state: JobState | undefined): boolean {
  return state === "queued" || state === "running" || state === "cancel_requested";
}

function canFollowUp(timeline: AgentConversationInitialTimeline | undefined): timeline is AgentConversationInitialTimeline {
  return timeline?.canFollowUp === true && (
    timeline.latestTurn?.state === "completed" || timeline.latestTurn?.state === "completed_with_warnings"
  );
}

type AppendProposalBinding = {
  readonly jobId: string;
  readonly proposalId: string;
};

function currentNoteAppendProposalBinding(
  latestTurn: AgentConversationInitialTimeline["latestTurn"],
  currentOutcome: AgentSubmitTurnResult | null
): AppendProposalBinding | null {
  if (latestTurn?.proposalId) return { jobId: latestTurn.jobId, proposalId: latestTurn.proposalId };
  if (currentOutcome?.state === "waiting" && currentOutcome.proposalId) {
    return { jobId: currentOutcome.jobId, proposalId: currentOutcome.proposalId };
  }
  return null;
}

function terminalSuccessfulJobId(
  latestTurn: AgentConversationInitialTimeline["latestTurn"],
  currentOutcome: AgentSubmitTurnResult | null,
  resolvedMutation: { readonly jobId: string; readonly kind: CurrentNoteMutationProposalPreview["kind"] } | null
): string | null {
  if (
    (latestTurn?.state === "completed" || latestTurn?.state === "completed_with_warnings") &&
    latestTurn.jobId === resolvedMutation?.jobId &&
    (resolvedMutation.kind === "replace_current_note" || latestTurn.currentNoteAppendApplied === true)
  ) return latestTurn.jobId;
  return currentOutcome?.state === "completed" && currentOutcome.currentNoteAppendApplied === true
    ? currentOutcome.jobId
    : null;
}

function currentNoteMutationProposalMatches(
  proposal: CurrentNoteMutationProposalPreview,
  vaultId: string,
  pageId: string,
  binding: AppendProposalBinding
): boolean {
  return proposal.activeVaultId === vaultId &&
    (proposal.kind === "replace_current_note" || proposal.pageId === pageId) &&
    proposal.jobId === binding.jobId &&
    proposal.proposalId === binding.proposalId;
}

function appendProposalReadIsCurrent(
  sequence: number,
  vaultId: string,
  pageId: string,
  binding: AppendProposalBinding,
  activeVaultIdRef: React.RefObject<string | null>,
  activePageIdRef: React.RefObject<string | null>,
  sequenceRef: React.RefObject<number>
): boolean {
  return sequence === sequenceRef.current &&
    activeVaultIdRef.current === vaultId &&
    activePageIdRef.current === pageId &&
    binding.jobId.length > 0 &&
    binding.proposalId.length > 0;
}

function applyMutationProposalDecisionResult(
  result: CurrentNoteMutationProposalDecisionResult,
  current: { readonly preview: CurrentNoteMutationProposalPreview; readonly errorMessageKey?: string },
  vaultId: string,
  pageId: string,
  setProposal: React.Dispatch<React.SetStateAction<{
    readonly preview: CurrentNoteMutationProposalPreview;
    readonly errorMessageKey?: string;
  } | null>>
): void {
  if (result.status === "failed") {
    setProposal({ ...current, errorMessageKey: "note.proposal.decisionFailed" });
    return;
  }
  if (result.status === "not_found") {
    setProposal({ ...current, errorMessageKey: "note.proposal.unavailable" });
    return;
  }
  if (result.status === "stale") {
    const preview = result.proposal;
    setProposal(preview && preview.kind === current.preview.kind && currentNoteMutationProposalMatches(preview, vaultId, pageId, {
      jobId: current.preview.jobId,
      proposalId: current.preview.proposalId
    })
      ? { preview, errorMessageKey: "note.proposal.stale" }
      : { preview: { ...current.preview, state: "conflicted" }, errorMessageKey: "note.proposal.stale" });
    return;
  }
  if (result.proposal.kind !== current.preview.kind || !currentNoteMutationProposalMatches(result.proposal, vaultId, pageId, {
    jobId: current.preview.jobId,
    proposalId: current.preview.proposalId
  })) {
    setProposal({ preview: { ...current.preview, state: "conflicted" }, errorMessageKey: "note.proposal.unavailable" });
    return;
  }
  setProposal({ preview: result.proposal });
}

function validDraftEvent(value: unknown): value is AgentTurnDraftEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AgentTurnDraftEvent>;
  return event.apiVersion === 1 &&
    event.kind === "draft_replace" &&
    typeof event.clientTurnId === "string" &&
    typeof event.requestId === "string" &&
    typeof event.jobId === "string" &&
    typeof event.conversationId === "string" &&
    typeof event.conversationEventId === "string" &&
    typeof event.sequence === "number" &&
    Number.isInteger(event.sequence) &&
    event.sequence > 0 &&
    typeof event.text === "string" &&
    Array.from(event.text).length > 0 &&
    Array.from(event.text).length <= 8_000 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(event.text);
}

function createClientTurnId(now = new Date()): string {
  const date = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0")
  ].join("");
  return `turn_${date}_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function formatMessageTime(createdAt: string): string | undefined {
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function genericAgentError(): PigeErrorSummary {
  return {
    code: "model_provider.call_failed",
    domain: "model_provider",
    messageKey: "errors.model_provider.call_failed",
    retryable: true,
    severity: "error",
    userAction: "retry"
  };
}
