import { describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import type { CurrentNoteAppendService } from "../../apps/desktop/src/main/services/current-note-append-service";
import type { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { registerCurrentNoteAppendIpc } from "../../apps/desktop/src/main/register-current-note-append-ipc";

const VAULT_ID = "vault_20260728_appendipc";
const PAGE_ID = "page_20260728_appendipc";
const JOB_ID = "job_20260728_appendipc01";
const PROPOSAL_ID = "proposal_20260728_appendipc000001";

describe("registerCurrentNoteAppendIpc", () => {
  it("parses strict identities and resolves the same durable review without exposing private records", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const preview = {
      proposalId: PROPOSAL_ID,
      kind: "append_current_note" as const,
      state: "ready" as const,
      revision: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      lines: [{ kind: "added" as const, text: "Bounded appended fact" }]
    };
    const service = {
      getProposal: vi.fn(() => preview),
      decideProposal: vi.fn(() => ({
        status: "applied" as const,
        proposal: { ...preview, state: "applied" as const, revision: 3 },
        operation: { id: "op_20260728_appendipc0001" }
      }))
    } as unknown as CurrentNoteAppendService;
    const job = {
      id: JOB_ID,
      state: "awaiting_review",
      proposalIds: [PROPOSAL_ID]
    };
    const resolveAgentTurnReview = vi.fn();
    const jobs = {
      readAgentTurnJob: vi.fn(() => job),
      resolveAgentTurnReview
    } as unknown as JobsService;
    registerCurrentNoteAppendIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: VAULT_ID } as VaultSummary),
      activeVaultPath: () => "/synthetic/vault",
      getService: () => service,
      getJobsService: () => jobs
    });

    const getResult = await handlers.get("agent.currentNoteAppendProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID
    });
    expect(getResult).toEqual({ apiVersion: 1, status: "available", proposal: preview });

    const decision = await handlers.get("agent.decideCurrentNoteAppendProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      decision: "approve"
    });
    expect(decision).toMatchObject({
      apiVersion: 1,
      status: "applied",
      operationId: "op_20260728_appendipc0001",
      proposal: { proposalId: PROPOSAL_ID, state: "applied" }
    });
    expect(resolveAgentTurnReview).toHaveBeenCalledWith(expect.objectContaining({
      job,
      proposalId: PROPOSAL_ID,
      result: "completed",
      facts: expect.objectContaining({ operationIds: ["op_20260728_appendipc0001"] })
    }));
    expect(JSON.stringify(decision)).not.toContain("/synthetic/vault");
  });

  it("fails closed on vault drift, malformed input, and private service errors", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    registerCurrentNoteAppendIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: "vault_other" } as VaultSummary),
      activeVaultPath: () => "/private/vault/path",
      getService: () => ({
        getProposal: () => { throw new Error("private markdown and path"); },
        decideProposal: () => { throw new Error("private markdown and path"); }
      } as unknown as CurrentNoteAppendService),
      getJobsService: () => ({}) as JobsService
    });

    const stale = await handlers.get("agent.currentNoteAppendProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID
    });
    expect(stale).toEqual({ apiVersion: 1, status: "unavailable", reason: "vault_changed" });
    expect(JSON.stringify(stale)).not.toContain("/private/vault/path");
    expect(() => handlers.get("agent.currentNoteAppendProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID,
      extra: true
    })).toThrow();
  });
});
