import type { IpcMain } from "electron";
import type {
  ProposalReviewDecisionRequest,
  ProposalReviewDecisionResult,
  ProposalReviewPreview,
  ProposalReviewRequest,
  ProposalReviewResult
} from "@pige/contracts";
import {
  ProposalReviewDecisionRequestSchema,
  ProposalReviewDecisionResultSchema,
  ProposalReviewPreviewSchema,
  ProposalReviewRequestSchema,
  ProposalReviewResultSchema,
  type ConfirmationProposal
} from "@pige/schemas";
import type { ProposalDecisionResult } from "@pige/contracts";

interface ProposalReviewPort {
  readonly activeVaultId: () => string | undefined;
  readonly read: (proposalId: string) => ConfirmationProposal | undefined;
  readonly approve: (proposalId: string) => Promise<ProposalDecisionResult>;
  readonly reject: (proposalId: string) => ProposalDecisionResult;
}

interface RegisterProposalIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly review: ProposalReviewPort;
}

const identity = (request: ProposalReviewRequest | ProposalReviewDecisionRequest) => ({
  apiVersion: 1 as const,
  requestId: request.requestId,
  activeVaultId: request.activeVaultId,
  jobId: request.jobId,
  proposalId: request.proposalId
});

function project(proposal: ConfirmationProposal): ProposalReviewPreview | undefined {
  if (!proposal.jobId || !new Set(["ready", "approved", "applied", "rejected", "conflicted"]).has(proposal.state)) {
    return undefined;
  }
  return ProposalReviewPreviewSchema.parse({
    proposalId: proposal.id,
    jobId: proposal.jobId,
    revision: proposal.updatedAt,
    state: proposal.state,
    trustLevel: proposal.trustLevel,
    summary: proposal.summary,
    reason: proposal.reason,
    operationKinds: proposal.proposedOperations.map(({ kind }) => kind),
    warnings: proposal.warnings
  });
}

function readBoundProposal(
  request: ProposalReviewRequest | ProposalReviewDecisionRequest,
  port: ProposalReviewPort
): { readonly proposal?: ConfirmationProposal; readonly preview?: ProposalReviewPreview; readonly status?: "not_found" | "stale" } {
  if (port.activeVaultId() !== request.activeVaultId) return { status: "stale" };
  const proposal = port.read(request.proposalId);
  if (!proposal) return { status: "not_found" };
  const preview = project(proposal);
  if (!preview || preview.jobId !== request.jobId || preview.proposalId !== request.proposalId) {
    return { status: "stale" };
  }
  return { proposal, preview };
}

export function reviewProposal(request: unknown, port: ProposalReviewPort): ProposalReviewResult {
  const parsed = ProposalReviewRequestSchema.parse(request);
  try {
    const current = readBoundProposal(parsed, port);
    if (current.status) return ProposalReviewResultSchema.parse({ ...identity(parsed), status: current.status });
    return ProposalReviewResultSchema.parse({ ...identity(parsed), status: "available", preview: current.preview });
  } catch {
    return ProposalReviewResultSchema.parse({ ...identity(parsed), status: "failed" });
  }
}

export async function decideProposal(
  request: unknown,
  port: ProposalReviewPort
): Promise<ProposalReviewDecisionResult> {
  const parsed = ProposalReviewDecisionRequestSchema.parse(request);
  try {
    const current = readBoundProposal(parsed, port);
    if (current.status) {
      return ProposalReviewDecisionResultSchema.parse({ ...identity(parsed), status: current.status });
    }
    if (current.preview!.revision !== parsed.expectedRevision || current.preview!.state !== "ready") {
      return ProposalReviewDecisionResultSchema.parse({
        ...identity(parsed),
        status: "stale",
        preview: current.preview
      });
    }
    const result = parsed.decision === "approve"
      ? await port.approve(parsed.proposalId)
      : port.reject(parsed.proposalId);
    const after = readBoundProposal(parsed, port);
    const preview = after.preview;
    const status = result.status === "applied" || result.status === "rejected"
      ? result.status
      : result.status === "conflicted" ? "conflicted" : "stale";
    return ProposalReviewDecisionResultSchema.parse({
      ...identity(parsed),
      status,
      ...(preview ? { preview } : {})
    });
  } catch {
    return ProposalReviewDecisionResultSchema.parse({ ...identity(parsed), status: "failed" });
  }
}

export function registerProposalIpc(options: RegisterProposalIpcOptions): void {
  options.ipcMain.handle("proposals.review", (_event, request) => reviewProposal(request, options.review));
  options.ipcMain.handle("proposals.decide", (_event, request) => decideProposal(request, options.review));
}
