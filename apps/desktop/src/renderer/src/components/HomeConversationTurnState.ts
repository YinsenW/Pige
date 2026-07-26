import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentConversationInitialTimeline, JobSummary } from "@pige/contracts";
import type { JobState } from "@pige/schemas";

type ConversationTurn = AgentConversationInitialTimeline["latestTurn"];

export type HomeConversationTurnState = "idle" | "accepted" | "running" | "waiting" | "failed" | "completed";
export type HomeComposerSubmissionBinding = {
  readonly vaultId: string;
  readonly clientTurnId: string;
};

export type HomeAcceptedTurnProjectionIdentity = {
  readonly activeVaultId: string;
  readonly clientTurnId: string;
  readonly conversationId: string;
  readonly conversationEventId: string;
  readonly jobId: string;
};

type HomeAcceptedTurnProjectionBinding = HomeAcceptedTurnProjectionIdentity & {
  readonly refreshCount: number;
  readonly terminalRefreshCount: number;
};

export type HomeAcceptedTurnProjectionStatus =
  | "waiting"
  | "paused"
  | "waiting_terminal_event"
  | "converged"
  | "failed"
  | "identity_changed";

const HOME_ACCEPTED_TURN_REFRESH_INTERVAL_MS = 1_200;
export const HOME_ACCEPTED_TURN_MAX_REFRESHES = 600;
export const HOME_ACCEPTED_TURN_MAX_TERMINAL_REFRESHES = 8;

export function homeAcceptedTurnProjectionExhausted(input: {
  readonly status: HomeAcceptedTurnProjectionStatus;
  readonly refreshCount: number;
  readonly terminalRefreshCount: number;
}): boolean {
  return input.refreshCount >= HOME_ACCEPTED_TURN_MAX_REFRESHES || (
    input.status === "waiting_terminal_event" &&
    input.terminalRefreshCount >= HOME_ACCEPTED_TURN_MAX_TERMINAL_REFRESHES
  );
}

export function homeAcceptedTurnProjectionStatus(input: {
  readonly binding: HomeAcceptedTurnProjectionIdentity;
  readonly activeVaultId: string | undefined;
  readonly timeline: AgentConversationInitialTimeline | undefined;
}): HomeAcceptedTurnProjectionStatus {
  const { binding, activeVaultId, timeline } = input;
  if (!activeVaultId || activeVaultId !== binding.activeVaultId) return "identity_changed";
  if (!timeline) return "waiting";
  if (timeline.conversationId !== binding.conversationId) return "identity_changed";

  const acceptedUser = timeline.messages.find((message) => message.id === binding.conversationEventId);
  if (acceptedUser && (acceptedUser.role !== "user" || acceptedUser.jobId !== binding.jobId)) {
    return "identity_changed";
  }
  const tail = timeline.messages.find((message) => message.id === timeline.tailEventId);
  if (
    acceptedUser?.jobId === binding.jobId &&
    tail?.role === "assistant" &&
    tail.jobId === binding.jobId &&
    timeline.canFollowUp
  ) return "converged";

  const latestTurn = timeline.latestTurn;
  if (latestTurn?.jobId === binding.jobId) {
    if (
      latestTurn.state === "failed_retryable" ||
      latestTurn.state === "failed_final" ||
      latestTurn.state === "cancelled"
    ) return "failed";
    if (latestTurn.state === "completed" || latestTurn.state === "completed_with_warnings") {
      return "waiting_terminal_event";
    }
    if (latestTurn.state === "waiting_dependency" || latestTurn.state === "awaiting_review") {
      return "paused";
    }
    return "waiting";
  }
  return acceptedUser ? "identity_changed" : "waiting";
}

export function useHomeAcceptedTurnProjection(input: {
  readonly activeVaultId: string | undefined;
  readonly timeline: AgentConversationInitialTimeline | undefined;
  readonly refreshConversation: (expectedConversationId: string) => Promise<unknown>;
  readonly onExhausted: () => void;
}): {
  readonly bind: (identity: HomeAcceptedTurnProjectionIdentity) => void;
  readonly clear: (clientTurnId?: string) => void;
} {
  const [revision, setRevision] = useState(0);
  const bindingRef = useRef<HomeAcceptedTurnProjectionBinding | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const clear = useCallback((clientTurnId?: string): void => {
    const current = bindingRef.current;
    if (!current || (clientTurnId && current.clientTurnId !== clientTurnId)) return;
    bindingRef.current = null;
    setRevision((value) => value + 1);
  }, []);

  const bind = useCallback((identity: HomeAcceptedTurnProjectionIdentity): void => {
    bindingRef.current = { ...identity, refreshCount: 0, terminalRefreshCount: 0 };
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const initialBinding = bindingRef.current;
    if (!initialBinding) return;
    const initialStatus = homeAcceptedTurnProjectionStatus({
      binding: initialBinding,
      activeVaultId: input.activeVaultId,
      timeline: input.timeline
    });
    if (initialStatus === "converged" || initialStatus === "failed" || initialStatus === "identity_changed") {
      clear(initialBinding.clientTurnId);
      return;
    }
    if (initialStatus === "paused") return;
    let disposed = false;
    let refreshActive = false;
    const poll = async (): Promise<void> => {
      if (disposed || refreshActive) return;
      const current = bindingRef.current;
      if (!current) return;
      const latest = inputRef.current;
      const status = homeAcceptedTurnProjectionStatus({
        binding: current,
        activeVaultId: latest.activeVaultId,
        timeline: latest.timeline
      });
      if (status === "converged" || status === "failed" || status === "identity_changed") {
        clear(current.clientTurnId);
        return;
      }
      if (homeAcceptedTurnProjectionExhausted({
        status,
        refreshCount: current.refreshCount,
        terminalRefreshCount: current.terminalRefreshCount
      })) {
        clear(current.clientTurnId);
        latest.onExhausted();
        return;
      }
      bindingRef.current = {
        ...current,
        refreshCount: current.refreshCount + 1,
        terminalRefreshCount: current.terminalRefreshCount + (status === "waiting_terminal_event" ? 1 : 0)
      };
      refreshActive = true;
      try {
        await latest.refreshConversation(current.conversationId);
      } finally {
        refreshActive = false;
      }
    };
    const timer = window.setInterval(() => void poll(), HOME_ACCEPTED_TURN_REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    clear,
    input.activeVaultId,
    input.timeline?.canFollowUp,
    input.timeline?.conversationId,
    input.timeline?.latestTurn?.jobId,
    input.timeline?.latestTurn?.state,
    input.timeline?.tailEventId,
    revision
  ]);

  return { bind, clear };
}

export function terminalTurnOwnsComposerSubmission(input: {
  readonly conversationId: string;
  readonly latestTurn: ConversationTurn;
  readonly activeDraft?: {
    readonly clientTurnId: string;
    readonly conversationId?: string;
    readonly jobId?: string;
  };
  readonly submission: HomeComposerSubmissionBinding | null;
  readonly activeVaultId: string | undefined;
}): boolean {
  const activeDraft = input.activeDraft;
  const submission = input.submission;
  if (!input.latestTurn || !activeDraft || !submission || !input.activeVaultId) return false;
  return isTerminalConversationTurn(input.latestTurn.state) &&
    activeDraft.jobId === input.latestTurn.jobId &&
    activeDraft.conversationId === input.conversationId &&
    submission.clientTurnId === activeDraft.clientTurnId &&
    submission.vaultId === input.activeVaultId;
}

export function selectCurrentNoSourceTurn(input: {
  readonly latestTurn: ConversationTurn;
  readonly recentJobs: readonly JobSummary[];
  readonly activeDraftJobId?: string;
}): JobSummary | undefined {
  const activeDraftJob = input.activeDraftJobId
    ? input.recentJobs.find((job) => job.id === input.activeDraftJobId)
    : undefined;
  if (
    isActiveNoSourceTurn(activeDraftJob) &&
    (
      !input.latestTurn ||
      activeDraftJob.id !== input.latestTurn.jobId ||
      !isTerminalConversationTurn(input.latestTurn.state)
    )
  ) return activeDraftJob;

  if (input.latestTurn) {
    if (isTerminalConversationTurn(input.latestTurn.state)) return undefined;
    const latestTurnJob = input.recentJobs.find((job) => job.id === input.latestTurn?.jobId);
    return isNoSourceTurn(latestTurnJob) ? latestTurnJob : undefined;
  }

  return input.recentJobs.find(isActiveNoSourceTurn);
}

export function isTerminalConversationTurn(state: JobState): boolean {
  return state === "completed" ||
    state === "completed_with_warnings" ||
    state === "compacted" ||
    state === "failed_retryable" ||
    state === "failed_final" ||
    state === "cancelled";
}

export function homeConversationStateForJob(state: JobSummary["state"] | undefined): HomeConversationTurnState | undefined {
  if (state === "queued") return "accepted";
  if (state === "running" || state === "cancel_requested") return "running";
  if (state === "waiting_dependency" || state === "awaiting_review") return "waiting";
  if (state === "completed" || state === "completed_with_warnings" || state === "compacted") return "completed";
  if (state === "failed_retryable" || state === "failed_final" || state === "cancelled") return "failed";
  return undefined;
}

function isNoSourceTurn(job: JobSummary | undefined): job is JobSummary {
  return Boolean(job) &&
    job?.class === "agent_turn" &&
    !job.sourceDisplayName &&
    !job.sourceId;
}

function isActiveNoSourceTurn(job: JobSummary | undefined): job is JobSummary {
  return isNoSourceTurn(job) && (job.state === "running" || job.state === "cancel_requested");
}
