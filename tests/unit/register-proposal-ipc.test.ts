import { describe, expect, it, vi } from "vitest";
import type { ProposalDecisionResult } from "@pige/contracts";
import { ConfirmationProposalSchema, type ConfirmationProposal } from "@pige/schemas";
import { decideProposal, reviewProposal } from "../../apps/desktop/src/main/register-proposal-ipc";

const activeVaultId = "vault_20260729_abcdefghijkl";
const jobId = "job_20260729_abcdefghijkl";
const proposalId = "proposal_20260729_abcdefghijkl";
const revision = "2026-07-29T10:00:00.000Z";

function proposal(state: ConfirmationProposal["state"] = "ready", updatedAt = revision): ConfirmationProposal {
  return ConfirmationProposalSchema.parse({
    id: proposalId,
    schemaVersion: 1,
    jobId,
    createdAt: revision,
    updatedAt,
    state,
    trustLevel: "review_required",
    summary: "Create the reviewed note",
    reason: "The user asked to preserve this knowledge.",
    sourceRefs: [{ kind: "source", id: "src_private", path: "sources/private.txt" }],
    targetRefs: [{ kind: "page", id: "page_private", path: "notes/private.md" }],
    proposedOperations: [{ kind: "create", path: "notes/private.md", content: "private body" }],
    diffRefs: [],
    warnings: ["Review before applying."],
    baseHashes: { "notes/private.md": `sha256:${"a".repeat(64)}` }
  });
}

function request(overrides: Partial<{
  activeVaultId: string;
  jobId: string;
  proposalId: string;
  expectedRevision: string;
}> = {}) {
  return {
    apiVersion: 1 as const,
    requestId: "proposalreq_abcdefghijklmnop",
    activeVaultId,
    jobId,
    proposalId,
    expectedRevision: revision,
    ...overrides
  };
}

describe("proposal renderer boundary", () => {
  it("projects only bounded review metadata", () => {
    const { expectedRevision: _expectedRevision, ...reviewRequest } = request();
    const result = reviewProposal(reviewRequest, {
      activeVaultId: () => activeVaultId,
      read: () => proposal(),
      approve: vi.fn(),
      reject: vi.fn()
    });

    expect(result.status).toBe("available");
    expect(JSON.stringify(result)).not.toMatch(/private body|private\.md|private\.txt|sha256|sourceRefs|targetRefs/);
    if (result.status === "available") {
      expect(result.preview).toMatchObject({
        proposalId,
        jobId,
        revision,
        operationKinds: ["create"]
      });
    }
  });

  it("fails stale identity and revision before any durable decision", async () => {
    const approve = vi.fn<() => Promise<ProposalDecisionResult>>();
    const reject = vi.fn<() => ProposalDecisionResult>();
    const port = { activeVaultId: () => activeVaultId, read: () => proposal(), approve, reject };

    await expect(decideProposal({ ...request({ jobId: "job_20260729_changedid" }), decision: "approve" }, port))
      .resolves.toMatchObject({ status: "stale" });
    await expect(decideProposal({ ...request({ expectedRevision: "2026-07-29T10:00:01.000Z" }), decision: "reject" }, port))
      .resolves.toMatchObject({ status: "stale" });
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it("applies or rejects the exact ready revision and returns a safe refreshed preview", async () => {
    let current = proposal();
    const port = {
      activeVaultId: () => activeVaultId,
      read: () => current,
      approve: vi.fn(async () => {
        current = proposal("applied", "2026-07-29T10:00:01.000Z");
        return { status: "applied", proposal: current } satisfies ProposalDecisionResult;
      }),
      reject: vi.fn(() => ({ status: "rejected" }) satisfies ProposalDecisionResult)
    };

    const result = await decideProposal({ ...request(), decision: "approve" }, port);
    expect(result).toMatchObject({ status: "applied", preview: { state: "applied" } });
    expect(port.approve).toHaveBeenCalledOnce();
  });
});
