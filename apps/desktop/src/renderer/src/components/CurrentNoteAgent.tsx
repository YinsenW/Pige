import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentConversationTimeline,
  AgentSubmitTurnResult,
  AgentTurnDraftEvent,
  ModelEgressPendingRequest,
  PigeErrorSummary,
  ReaderSelectionProposalPreview
} from "@pige/contracts";
import type { JobState, Locale } from "@pige/schemas";
import {
  NoteAgentPanel,
  type NoteAgentAvailability,
  type NoteAgentMessage,
  type NoteAgentModelEgressPrompt,
  type NoteAgentModelOption
} from "./NoteAgentPanel";

type ActiveDraftBinding = {
  readonly clientTurnId: string;
  requestId?: string;
  jobId?: string;
  conversationId?: string;
  conversationEventId?: string;
  sequence: number;
};

type EgressState =
  | { readonly kind: "loading"; readonly requestId: string }
  | { readonly kind: "unknown"; readonly requestId: string }
  | {
      readonly kind: "ready" | "resolving";
      readonly request: ModelEgressPendingRequest;
      readonly errorMessageKey?: string;
    };

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
  readonly onOpenCitation: (pageId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [timeline, setTimeline] = useState<AgentConversationTimeline | undefined>();
  const [timelineReadState, setTimelineReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [draft, setDraft] = useState("");
  const [liveDraft, setLiveDraft] = useState<AgentTurnDraftEvent | null>(null);
  const [currentOutcome, setCurrentOutcome] = useState<AgentSubmitTurnResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<PigeErrorSummary | null>(null);
  const [egress, setEgress] = useState<EgressState | null>(null);
  const [resolvedEgressRequestId, setResolvedEgressRequestId] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  const loadSequenceRef = useRef(0);
  const activePageIdRef = useRef<string | null>(props.pageId);
  const activeVaultIdRef = useRef<string | null>(props.vaultId);
  const activeDraftRef = useRef<ActiveDraftBinding | null>(null);
  const currentOutcomeRef = useRef<AgentSubmitTurnResult | null>(null);
  const submitInFlightRef = useRef(false);
  const egressReadSequenceRef = useRef(0);
  const egressDecisionRef = useRef(false);
  const modelSwitchInFlightRef = useRef(false);
  activePageIdRef.current = props.pageId;
  activeVaultIdRef.current = props.vaultId;
  currentOutcomeRef.current = currentOutcome;

  const timelineLatestTurn = timeline?.latestTurn;
  const timelineOwnsCurrentOutcome = !currentOutcome?.jobId || timelineLatestTurn?.jobId === currentOutcome.jobId;
  const latestTurn = timelineOwnsCurrentOutcome ? timelineLatestTurn : undefined;
  const outcomeError = currentOutcome?.state === "completed" ? null : currentOutcome?.error ?? null;
  const effectiveError = latestTurn?.error ?? outcomeError ?? error;
  const currentJobId = latestTurn?.jobId ?? currentOutcome?.jobId;
  const requestId = effectiveError?.modelEgressApprovalRequestId;
  const activeEgressRequestId = requestId === resolvedEgressRequestId ? undefined : requestId;

  const refreshTimeline = async (): Promise<AgentConversationTimeline | undefined> => {
    const pageId = props.pageId;
    const vaultId = props.vaultId;
    const sequence = ++loadSequenceRef.current;
    try {
      const next = await window.pige.agent.conversation({
        scope: { kind: "current_note", pageId },
        limit: 24
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
    setEgress(null);
    setResolvedEgressRequestId(null);
    setSwitchingModel(false);
    modelSwitchInFlightRef.current = false;
    void refreshTimeline();
    return () => {
      loadSequenceRef.current += 1;
      activePageIdRef.current = null;
      activeVaultIdRef.current = null;
      activeDraftRef.current = null;
    };
  }, [props.pageId, props.vaultId]);

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

  useEffect(() => {
    const sequence = ++egressReadSequenceRef.current;
    if (!activeEgressRequestId) {
      setEgress(null);
      return;
    }
    setEgress({ kind: "loading", requestId: activeEgressRequestId });
    void window.pige.modelEgress.pending({ requestId: activeEgressRequestId }).then((request) => {
      if (sequence !== egressReadSequenceRef.current || activePageIdRef.current !== props.pageId) return;
      if (!request || request.requestId !== activeEgressRequestId || request.jobId !== currentJobId) {
        setEgress({ kind: "unknown", requestId: activeEgressRequestId });
        return;
      }
      setEgress({ kind: "ready", request });
    }).catch(() => {
      if (sequence === egressReadSequenceRef.current && activePageIdRef.current === props.pageId) {
        setEgress({ kind: "unknown", requestId: activeEgressRequestId });
      }
    });
  }, [activeEgressRequestId, currentJobId, props.pageId]);

  const messages = useMemo(
    () => timelineMessages(timeline, liveDraft, currentOutcome, props.t),
    [timeline, liveDraft, currentOutcome, props.t]
  );
  const availability = noteAgentAvailability(
    latestTurn?.state,
    submitting,
    timelineReadState,
    effectiveError,
    activeEgressRequestId,
    currentOutcome?.state
  );
  const egressPrompt = noteAgentEgressPrompt(egress);
  const modelSwitchBlocked = timelineReadState !== "ready" ||
    isModelSwitchBlocked(latestTurn?.state, activeEgressRequestId, submitting);

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
        objective: "auto",
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

  const decideEgress = async (decision: "allow_once" | "deny"): Promise<void> => {
    if (egressDecisionRef.current || egress?.kind !== "ready" || activePageIdRef.current !== props.pageId) return;
    const request = egress.request;
    const pageId = props.pageId;
    egressDecisionRef.current = true;
    setEgress({ kind: "resolving", request });
    try {
      await window.pige.modelEgress.resolve({
        requestId: request.requestId,
        jobId: request.jobId,
        decision
      });
      if (activePageIdRef.current !== pageId) return;
      setResolvedEgressRequestId(request.requestId);
      setEgress(null);
      await refreshTimeline();
    } catch {
      if (activePageIdRef.current !== pageId) return;
      try {
        const current = await window.pige.modelEgress.pending({ requestId: request.requestId });
        if (activePageIdRef.current !== pageId) return;
        if (current?.requestId === request.requestId && current.jobId === request.jobId) {
          setEgress({ kind: "ready", request: current, errorMessageKey: "home.modelEgress.resolveFailed" });
        } else {
          setResolvedEgressRequestId(request.requestId);
          setEgress(null);
          await refreshTimeline();
        }
      } catch {
        if (activePageIdRef.current === pageId) setEgress({ kind: "unknown", requestId: request.requestId });
      }
    } finally {
      egressDecisionRef.current = false;
    }
  };

  return (
    <NoteAgentPanel
      modal={props.modal}
      noteTitle={props.noteTitle}
      availability={availability}
      composerDisabled={timelineReadState !== "ready"}
      messages={messages}
      proposal={props.proposal ? {
        id: props.proposal.proposalId,
        action: props.proposal.action,
        revision: props.proposal.revision,
        lines: props.proposal.lines,
        state: props.proposal.state,
        ...(props.proposalErrorMessageKey ? { errorMessageKey: props.proposalErrorMessageKey } : {})
      } : null}
      draft={draft}
      models={props.models}
      switchingModel={switchingModel || modelSwitchBlocked}
      modelEgressPrompt={egressPrompt}
      onClose={props.onClose}
      onDraftChange={setDraft}
      onSubmit={() => void submit()}
      {...(effectiveError?.messageKey ? { errorMessageKey: effectiveError.messageKey } : {})}
      {...(latestTurn && (latestTurn.state === "running" || latestTurn.state === "cancel_requested")
        ? { onCancel: () => void cancel() }
        : {})}
      {...(effectiveError?.retryable === true && effectiveError.userAction === "retry" ? { onRetry: () => void retry() } : {})}
      onOpenModels={props.onOpenModels}
      onSelectModel={selectModel}
      onModelEgressDecision={(decision) => void decideEgress(decision)}
      {...(props.onProposalAction ? { onProposalAction: props.onProposalAction } : {})}
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
  timeline: AgentConversationTimeline | undefined,
  liveDraft: AgentTurnDraftEvent | null,
  currentOutcome: AgentSubmitTurnResult | null,
  t: (key: string) => string
): readonly NoteAgentMessage[] {
  const messages: NoteAgentMessage[] = (timeline?.messages ?? []).map((message) => {
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
  });
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
  egressRequestId: string | undefined,
  outcomeState: AgentSubmitTurnResult["state"] | undefined
): NoteAgentAvailability {
  if (timelineReadState === "loading") return "running";
  if (timelineReadState === "failed") return "failed";
  if (
    submitting ||
    state === "queued" ||
    state === "running" ||
    state === "cancel_requested" ||
    state === "waiting_model_egress" ||
    egressRequestId
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
  egressRequestId: string | undefined,
  submitting: boolean
): boolean {
  return submitting ||
    Boolean(egressRequestId) ||
    state === "queued" ||
    state === "running" ||
    state === "cancel_requested" ||
    state === "waiting_model_egress";
}

function noteAgentEgressPrompt(state: EgressState | null): NoteAgentModelEgressPrompt | null {
  if (!state) return null;
  if (state.kind === "loading" || state.kind === "unknown") return { kind: state.kind };
  return {
    kind: state.kind,
    reasonMessageKey: egressReasonMessageKey(state.request.reasonCode),
    ...(state.errorMessageKey ? { errorMessageKey: state.errorMessageKey } : {})
  };
}

function egressReasonMessageKey(reasonCode: ModelEgressPendingRequest["reasonCode"]): string {
  if (reasonCode === "sensitive_confirmation") return "home.modelEgress.sensitive";
  if (reasonCode === "unknown_boundary_confirmation") return "home.modelEgress.unknownBoundary";
  if (reasonCode === "private_or_large_confirmation") return "home.modelEgress.privateOrLarge";
  return "home.modelEgress.confirmAll";
}

function isPollingState(state: JobState | undefined): boolean {
  return state === "queued" ||
    state === "running" ||
    state === "cancel_requested" ||
    state === "waiting_dependency" ||
    state === "waiting_model_egress";
}

function isDraftState(state: JobState | undefined): boolean {
  return state === "queued" || state === "running" || state === "cancel_requested";
}

function canFollowUp(timeline: AgentConversationTimeline | undefined): timeline is AgentConversationTimeline {
  return timeline?.canFollowUp === true && (
    timeline.latestTurn?.state === "completed" || timeline.latestTurn?.state === "completed_with_warnings"
  );
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
