import type { IpcMain } from "electron";
import type {
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalGetResult,
  VaultSummary
} from "@pige/contracts";
import {
  CurrentNoteAppendProposalDecisionRequestSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  CurrentNoteAppendProposalGetRequestSchema,
  CurrentNoteAppendProposalGetResultSchema,
  PigeErrorSummarySchema,
  type JobRecord
} from "@pige/schemas";
import type { CurrentNoteAppendService } from "./services/current-note-append-service";
import type { JobsService } from "./services/jobs-service";

interface RegisterCurrentNoteAppendIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly currentVault: () => VaultSummary | undefined;
  readonly activeVaultPath: () => string | undefined;
  readonly getService: () => CurrentNoteAppendService;
  readonly getJobsService: () => JobsService;
}

export function registerCurrentNoteAppendIpc(options: RegisterCurrentNoteAppendIpcOptions): void {
  options.ipcMain.handle("agent.currentNoteAppendProposal", (_event, request: unknown) => {
    const parsed = CurrentNoteAppendProposalGetRequestSchema.parse(request);
    const binding = currentBinding(options, parsed.activeVaultId);
    if (!binding) return unavailable("vault_changed");
    try {
      const jobs = options.getJobsService();
      const waitingJob = jobs.readAgentTurnJob(parsed.jobId);
      if (!waitingJob || !isExactWaitingReviewBinding(waitingJob, parsed)) return unavailable("binding_changed");
      const proposal = options.getService().getProposal({
        vaultPath: binding.vaultPath,
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId
      });
      if (!proposal) return unavailable("not_found");
      if (!reconcileReview(jobs, proposal, parsed.proposalId)) return unavailable("record_invalid");
      return CurrentNoteAppendProposalGetResultSchema.parse({ apiVersion: 1, status: "available", proposal });
    } catch {
      return unavailable("record_invalid");
    }
  });

  options.ipcMain.handle("agent.decideCurrentNoteAppendProposal", (_event, request: unknown) => {
    const parsed = CurrentNoteAppendProposalDecisionRequestSchema.parse(request);
    const binding = currentBinding(options, parsed.activeVaultId);
    if (!binding) return decisionStale();
    try {
      const jobs = options.getJobsService();
      const service = options.getService();
      const job = jobs.readAgentTurnJob(parsed.jobId);
      if (!job) return decisionStale();
      if (!isExactWaitingReviewBinding(job, parsed)) {
        const proposal = service.getProposal({
          vaultPath: binding.vaultPath,
          activeVaultId: parsed.activeVaultId,
          pageId: parsed.pageId,
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
        pageId: parsed.pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId,
        expectedRevision: parsed.expectedRevision,
        decision: parsed.decision,
        ...(parsed.expectedCurrentRevision ? { expectedCurrentRevision: parsed.expectedCurrentRevision } : {})
      });
      if (result.status === "not_found") return decisionStale();
      if (result.status === "stale") {
        return CurrentNoteAppendProposalDecisionResultSchema.parse({
          apiVersion: 1,
          status: "stale",
          ...(result.proposal ? { proposal: result.proposal } : {})
        });
      }
      if (!reconcileReview(jobs, result.proposal, parsed.proposalId, result.status === "applied" || result.status === "saved"
        ? result.operation.id
        : undefined)) throw new Error("The reviewed append Job did not converge.");
      return CurrentNoteAppendProposalDecisionResultSchema.parse({
        apiVersion: 1,
        status: result.status,
        proposal: result.proposal,
        ...(result.status === "applied" ? { operationId: result.operation.id } : {}),
        ...(result.status === "saved" ? { operationId: result.operation.id, createdPageId: result.createdPageId } : {})
      });
    } catch {
      return CurrentNoteAppendProposalDecisionResultSchema.parse({
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
  options: RegisterCurrentNoteAppendIpcOptions,
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
        message: "The current-note append review was resolved.",
        facts: {
          stage: "planning",
          ...(operationId ? {
            operationIds: [operationId],
            outputRefs: [{ kind: "operation", id: operationId, role: "current_note_append_operation" }]
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
  readonly pageId: string;
  readonly proposalId: string;
}): boolean {
  const scopeRefs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_current_note_scope");
  return isExactWaitingReview(job, input.proposalId) &&
    job.activeVaultId === input.activeVaultId &&
    scopeRefs.length === 1 &&
    scopeRefs[0]?.kind === "page" &&
    scopeRefs[0].id === input.pageId;
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
    job.outputRefs?.some((ref) => ref.kind === "operation" && ref.id === operationId && ref.role === "current_note_append_operation") === true
  );
}

function resolvedReviewOperationId(job: JobRecord): string | undefined {
  const refs = (job.outputRefs ?? []).filter((ref) =>
    ref.kind === "operation" && typeof ref.id === "string" &&
    ref.role === "current_note_append_operation" && job.operationIds?.includes(ref.id)
  );
  return refs.length === 1 ? refs[0]?.id : undefined;
}

function unavailable(reason: "not_found" | "vault_changed" | "binding_changed" | "record_invalid"): CurrentNoteAppendProposalGetResult {
  return CurrentNoteAppendProposalGetResultSchema.parse({ apiVersion: 1, status: "unavailable", reason });
}

function decisionStale(): CurrentNoteAppendProposalDecisionResult {
  return CurrentNoteAppendProposalDecisionResultSchema.parse({ apiVersion: 1, status: "stale" });
}
