import type { IpcMain } from "electron";
import type {
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalGetResult,
  VaultSummary
} from "@pige/contracts";
import {
  CurrentNoteReplaceProposalDecisionRequestSchema,
  CurrentNoteReplaceProposalDecisionResultSchema,
  CurrentNoteReplaceProposalGetRequestSchema,
  CurrentNoteReplaceProposalGetResultSchema,
  PigeErrorSummarySchema,
  type JobRecord
} from "@pige/schemas";
import type { CurrentNoteReplaceService } from "./services/current-note-replace-service";
import type { JobsService } from "./services/jobs-service";

interface RegisterCurrentNoteReplaceIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly currentVault: () => VaultSummary | undefined;
  readonly activeVaultPath: () => string | undefined;
  readonly getService: () => CurrentNoteReplaceService;
  readonly getJobsService: () => JobsService;
}

export function registerCurrentNoteReplaceIpc(options: RegisterCurrentNoteReplaceIpcOptions): void {
  options.ipcMain.handle("agent.currentNoteReplaceProposal", (_event, request: unknown) => {
    const parsed = CurrentNoteReplaceProposalGetRequestSchema.parse(request);
    const binding = currentBinding(options, parsed.activeVaultId);
    if (!binding) return getStale();
    try {
      const jobs = options.getJobsService();
      const waitingJob = jobs.readAgentTurnJob(parsed.jobId);
      if (!waitingJob) return getNotFound();
      const pageId = exactCurrentNotePageId(waitingJob, parsed);
      if (!pageId) return getStale();
      const proposal = options.getService().getProposal({
        vaultPath: binding.vaultPath,
        activeVaultId: parsed.activeVaultId,
        pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId
      });
      if (!proposal) return getNotFound();
      if (!reconcileReview(jobs, proposal, parsed.proposalId)) return getFailed();
      return CurrentNoteReplaceProposalGetResultSchema.parse({ apiVersion: 1, status: "available", proposal: projectProposal(proposal) });
    } catch {
      return getFailed();
    }
  });

  options.ipcMain.handle("agent.decideCurrentNoteReplaceProposal", (_event, request: unknown) => {
    const parsed = CurrentNoteReplaceProposalDecisionRequestSchema.parse(request);
    const binding = currentBinding(options, parsed.activeVaultId);
    if (!binding) return decisionStale();
    try {
      const jobs = options.getJobsService();
      const service = options.getService();
      const job = jobs.readAgentTurnJob(parsed.jobId);
      if (!job) return decisionStale();
      const pageId = exactCurrentNotePageId(job, parsed, false);
      if (!pageId) return decisionStale();
      if (!isExactWaitingReviewBinding(job, parsed)) {
        const proposal = service.getProposal({
          vaultPath: binding.vaultPath,
          activeVaultId: parsed.activeVaultId,
          pageId,
          jobId: parsed.jobId,
          proposalId: parsed.proposalId
        });
        const operationId = resolvedReviewOperationId(job);
        if (!proposal || !isResolvedProposalState(proposal.state) ||
          !reviewJobConverged(job, parsed.proposalId, proposal.state, operationId)) return decisionStale();
      }
      const result = service.decideProposal({
        vaultPath: binding.vaultPath,
        activeVaultId: parsed.activeVaultId,
        pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId,
        expectedRevision: parsed.expectedRevision,
        decision: parsed.decision,
        ...(parsed.expectedCurrentRevision ? { expectedCurrentRevision: parsed.expectedCurrentRevision } : {})
      });
      if (result.status === "not_found") return decisionStale();
      if (result.status === "stale") {
        return CurrentNoteReplaceProposalDecisionResultSchema.parse({
          apiVersion: 1,
          status: "stale",
          ...(result.proposal ? { proposal: projectProposal(result.proposal) } : {})
        });
      }
      if (!reconcileReview(jobs, result.proposal, parsed.proposalId, result.status === "applied" || result.status === "saved"
        ? result.operation.id
        : undefined)) throw new Error("The reviewed replacement Job did not converge.");
      return CurrentNoteReplaceProposalDecisionResultSchema.parse({
        apiVersion: 1,
        status: result.status,
        proposal: projectProposal(result.proposal),
        ...(result.status === "applied" ? { operationId: result.operation.id } : {}),
        ...(result.status === "saved" ? { operationId: result.operation.id, createdPageId: result.createdPageId } : {})
      });
    } catch {
      return CurrentNoteReplaceProposalDecisionResultSchema.parse({
        apiVersion: 1,
        status: "failed",
        error: PigeErrorSummarySchema.parse({
          code: "agent_runtime.turn_conflict",
          domain: "agent_runtime",
          messageKey: "errors.agent_runtime.turn_conflict",
          retryable: false,
          severity: "error",
          userAction: "none"
        })
      });
    }
  });
}

function currentBinding(
  options: RegisterCurrentNoteReplaceIpcOptions,
  activeVaultId: string
): { readonly vaultPath: string } | undefined {
  const vault = options.currentVault();
  const vaultPath = options.activeVaultPath();
  return vault?.vaultId === activeVaultId && vaultPath ? { vaultPath } : undefined;
}

function reconcileReview(
  jobs: JobsService,
  proposal: {
    readonly proposalId: string;
    readonly jobId: string;
    readonly state: "ready" | "resolving" | "applied" | "saved_as_note" | "rejected" | "conflicted";
  },
  expectedProposalId: string,
  operationId?: string
): boolean {
  if (proposal.proposalId !== expectedProposalId || proposal.state === "conflicted" || !isResolvedProposalState(proposal.state)) return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const job = jobs.readAgentTurnJob(proposal.jobId);
    if (!job) return false;
    if (!isExactWaitingReview(job, proposal.proposalId)) return reviewJobConverged(job, proposal.proposalId, proposal.state, operationId);
    try {
      const settled = jobs.resolveAgentTurnReview({
        job,
        proposalId: proposal.proposalId,
        result: "completed",
        message: "The current-note replacement review was resolved.",
        facts: {
          stage: "planning",
          ...(operationId ? {
            operationIds: [operationId],
            outputRefs: [{ kind: "operation", id: operationId, role: "current_note_replace_operation" }]
          } : {})
        }
      });
      return reviewJobConverged(settled, proposal.proposalId, proposal.state, operationId);
    } catch {
      // Reread and adopt an exact concurrent settlement before retrying the same review.
    }
  }
  return false;
}

function isResolvedProposalState(
  state: "ready" | "resolving" | "applied" | "saved_as_note" | "rejected" | "conflicted"
): state is "applied" | "saved_as_note" | "rejected" {
  return state === "applied" || state === "saved_as_note" || state === "rejected";
}

function isExactWaitingReview(job: JobRecord, proposalId: string): boolean {
  return job.state === "awaiting_review" &&
    job.proposalIds?.length === 1 &&
    job.proposalIds[0] === proposalId;
}

function isExactWaitingReviewBinding(job: JobRecord, input: {
  readonly activeVaultId: string;
  readonly proposalId: string;
}): boolean {
  const scopeRefs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_current_note_scope");
  return isExactWaitingReview(job, input.proposalId) &&
    job.activeVaultId === input.activeVaultId &&
    scopeRefs.length === 1 && scopeRefs[0]?.kind === "page";
}

function exactCurrentNotePageId(
  job: JobRecord,
  input: { readonly activeVaultId: string; readonly proposalId: string },
  requireWaiting = true
): string | undefined {
  if (job.activeVaultId !== input.activeVaultId || (requireWaiting && !isExactWaitingReview(job, input.proposalId))) return undefined;
  const refs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_current_note_scope");
  return refs.length === 1 && refs[0]?.kind === "page" ? refs[0].id : undefined;
}

function reviewJobConverged(
  job: JobRecord,
  proposalId: string,
  proposalState: "applied" | "saved_as_note" | "rejected" | "conflicted",
  operationId: string | undefined
): boolean {
  if (!job.proposalIds?.includes(proposalId)) return false;
  if (proposalState === "conflicted") return job.state === "failed_final";
  if (job.state !== "completed" && job.state !== "completed_with_warnings") return false;
  return proposalState === "rejected" || (
    !!operationId &&
    job.operationIds?.includes(operationId) === true &&
    job.outputRefs?.some((ref) => ref.kind === "operation" && ref.id === operationId && ref.role === "current_note_replace_operation") === true
  );
}

function resolvedReviewOperationId(job: JobRecord): string | undefined {
  const refs = (job.outputRefs ?? []).filter((ref) =>
    ref.kind === "operation" && typeof ref.id === "string" &&
    ref.role === "current_note_replace_operation" && job.operationIds?.includes(ref.id)
  );
  return refs.length === 1 ? refs[0]?.id : undefined;
}

function projectProposal(proposal: {
  readonly proposalId: string;
  readonly kind: "replace_current_note";
  readonly state: "ready" | "resolving" | "applied" | "saved_as_note" | "rejected" | "conflicted";
  readonly revision: number;
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly currentRevision?: `noteeditrev_${string}`;
  readonly lines: readonly { readonly kind: "context" | "removed" | "added"; readonly text: string }[];
}) {
  return {
    proposalId: proposal.proposalId,
    kind: proposal.kind,
    state: proposal.state,
    revision: proposal.revision,
    activeVaultId: proposal.activeVaultId,
    jobId: proposal.jobId,
    ...(proposal.currentRevision ? { currentRevision: proposal.currentRevision } : {}),
    lines: proposal.lines
  };
}

function getStale(): CurrentNoteReplaceProposalGetResult {
  return CurrentNoteReplaceProposalGetResultSchema.parse({ apiVersion: 1, status: "stale" });
}

function getNotFound(): CurrentNoteReplaceProposalGetResult {
  return CurrentNoteReplaceProposalGetResultSchema.parse({ apiVersion: 1, status: "not_found" });
}

function getFailed(): CurrentNoteReplaceProposalGetResult {
  return CurrentNoteReplaceProposalGetResultSchema.parse({
    apiVersion: 1,
    status: "failed",
    error: PigeErrorSummarySchema.parse({
      code: "agent_runtime.turn_conflict",
      domain: "agent_runtime",
      messageKey: "errors.agent_runtime.turn_conflict",
      retryable: false,
      severity: "error",
      userAction: "none"
    })
  });
}

function decisionStale(): CurrentNoteReplaceProposalDecisionResult {
  return CurrentNoteReplaceProposalDecisionResultSchema.parse({ apiVersion: 1, status: "stale" });
}
