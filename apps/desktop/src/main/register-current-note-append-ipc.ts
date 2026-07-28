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
      const proposal = options.getService().getProposal({
        vaultPath: binding.vaultPath,
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId
      });
      if (!proposal) return unavailable("not_found");
      reconcileReview(options.getJobsService(), proposal, parsed.proposalId);
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
      const result = options.getService().decideProposal({
        vaultPath: binding.vaultPath,
        activeVaultId: parsed.activeVaultId,
        pageId: parsed.pageId,
        jobId: parsed.jobId,
        proposalId: parsed.proposalId,
        expectedRevision: parsed.expectedRevision,
        decision: parsed.decision
      });
      if (result.status === "not_found") return decisionStale();
      if (result.status === "stale") {
        return CurrentNoteAppendProposalDecisionResultSchema.parse({
          apiVersion: 1,
          status: "stale",
          ...(result.proposal ? { proposal: result.proposal } : {})
        });
      }
      reconcileReview(options.getJobsService(), result.proposal, parsed.proposalId, result.status === "applied"
        ? result.operation.id
        : undefined);
      return CurrentNoteAppendProposalDecisionResultSchema.parse({
        apiVersion: 1,
        status: result.status,
        proposal: result.proposal,
        ...(result.status === "applied" ? { operationId: result.operation.id } : {})
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
    readonly state: "ready" | "resolving" | "applied" | "rejected" | "conflicted";
  },
  expectedProposalId: string,
  operationId?: string
): void {
  if (proposal.proposalId !== expectedProposalId || !new Set(["applied", "rejected", "conflicted"]).has(proposal.state)) return;
  const job = jobs.readAgentTurnJob(proposal.jobId);
  if (!job || !isExactWaitingReview(job, proposal.proposalId)) return;
  try {
    jobs.resolveAgentTurnReview({
      job,
      proposalId: proposal.proposalId,
      result: proposal.state === "conflicted" ? "failed_final" : "completed",
      message: proposal.state === "conflicted"
        ? "The current-note append review conflicted with the current page."
        : "The current-note append review was resolved.",
      ...(proposal.state === "conflicted" ? {
        error: PigeErrorSummarySchema.parse({
          code: "agent_runtime.turn_conflict",
          domain: "agent_runtime",
          messageKey: "errors.agent_runtime.turn_conflict",
          retryable: false,
          severity: "error",
          userAction: "none"
        })
      } : {}),
      facts: {
        stage: "planning",
        ...(operationId ? {
          operationIds: [operationId],
          outputRefs: [{ kind: "operation", id: operationId, role: "current_note_append_operation" }]
        } : {})
      }
    });
  } catch {
    // The durable proposal outcome remains authoritative; a later read reconciles the Job.
  }
}

function isExactWaitingReview(job: JobRecord, proposalId: string): boolean {
  return job.state === "awaiting_review" &&
    job.proposalIds?.length === 1 &&
    job.proposalIds[0] === proposalId;
}

function unavailable(reason: "not_found" | "vault_changed" | "record_invalid"): CurrentNoteAppendProposalGetResult {
  return CurrentNoteAppendProposalGetResultSchema.parse({ apiVersion: 1, status: "unavailable", reason });
}

function decisionStale(): CurrentNoteAppendProposalDecisionResult {
  return CurrentNoteAppendProposalDecisionResultSchema.parse({ apiVersion: 1, status: "stale" });
}
