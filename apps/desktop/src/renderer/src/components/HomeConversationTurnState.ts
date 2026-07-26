import type { AgentConversationInitialTimeline, JobSummary } from "@pige/contracts";
import type { JobState } from "@pige/schemas";

type ConversationTurn = AgentConversationInitialTimeline["latestTurn"];

export type HomeConversationTurnState = "idle" | "accepted" | "running" | "waiting" | "failed" | "completed";

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
