import { describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import type { CurrentNoteReplaceService } from "../../apps/desktop/src/main/services/current-note-replace-service";
import type { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { registerCurrentNoteReplaceIpc } from "../../apps/desktop/src/main/register-current-note-replace-ipc";

const VAULT_ID = "vault_20260728_replaceipc";
const PAGE_ID = "page_20260728_replaceipc";
const JOB_ID = "job_20260728_replaceipc01";
const PROPOSAL_ID = "proposal_20260728_replaceipc000001";

describe("registerCurrentNoteReplaceIpc", () => {
  it("parses strict identities and resolves the same durable review without exposing private records", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const preview = {
      proposalId: PROPOSAL_ID,
      kind: "replace_current_note" as const,
      state: "ready" as const,
      revision: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      lines: [{ kind: "added" as const, text: "Bounded replacement" }]
    };
    const service = {
      getProposal: vi.fn(() => preview),
      decideProposal: vi.fn(() => ({
        status: "applied" as const,
        proposal: { ...preview, state: "applied" as const, revision: 3 },
        operation: { id: "op_20260728_replaceipc0001" }
      }))
    } as unknown as CurrentNoteReplaceService;
    let job = waitingJob();
    const resolveAgentTurnReview = vi.fn((input: any) => {
      job = {
        ...input.job,
        state: input.result,
        proposalIds: [PROPOSAL_ID],
        operationIds: input.facts.operationIds,
        outputRefs: input.facts.outputRefs
      } as JobRecord;
      return job;
    });
    const jobs = {
      readAgentTurnJob: vi.fn(() => job),
      resolveAgentTurnReview
    } as unknown as JobsService;
    registerCurrentNoteReplaceIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: VAULT_ID } as VaultSummary),
      activeVaultPath: () => "/synthetic/vault",
      getService: () => service,
      getJobsService: () => jobs
    });

    const getResult = await handlers.get("agent.currentNoteReplaceProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID
    });
    expect(getResult).toEqual({ apiVersion: 1, status: "available", proposal: preview });

    const decision = await handlers.get("agent.decideCurrentNoteReplaceProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      decision: "approve"
    });
    expect(decision).toMatchObject({
      apiVersion: 1,
      status: "applied",
      operationId: "op_20260728_replaceipc0001",
      proposal: { proposalId: PROPOSAL_ID, state: "applied" }
    });
    expect(resolveAgentTurnReview).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ id: JOB_ID, state: "awaiting_review" }),
      proposalId: PROPOSAL_ID,
      result: "completed",
      facts: expect.objectContaining({ operationIds: ["op_20260728_replaceipc0001"] })
    }));
    expect(JSON.stringify(decision)).not.toContain("/synthetic/vault");
  });

  it("rejects a stale Job before the proposal service can mutate", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const decideProposal = vi.fn();
    const getProposal = vi.fn();
    registerCurrentNoteReplaceIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: VAULT_ID } as VaultSummary),
      activeVaultPath: () => "/synthetic/vault",
      getService: () => ({ decideProposal, getProposal } as unknown as CurrentNoteReplaceService),
      getJobsService: () => ({
        readAgentTurnJob: () => ({ ...waitingJob(), state: "completed" })
      } as unknown as JobsService)
    });

    const getResult = await handlers.get("agent.currentNoteReplaceProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID
    });
    expect(getResult).toEqual({ apiVersion: 1, status: "stale" });
    expect(getProposal).not.toHaveBeenCalled();
    const result = await decide(handlers);
    expect(result).toEqual({ apiVersion: 1, status: "stale" });
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("rereads CAS contention and returns success only after the same Job converges", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const preview = replacePreview();
    const operationId = "op_20260728_replaceipc0001";
    let job = waitingJob();
    let attempts = 0;
    const resolveAgentTurnReview = vi.fn((input: any) => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic CAS contention");
      job = {
        ...input.job,
        state: "completed",
        proposalIds: [PROPOSAL_ID],
        operationIds: [operationId],
        outputRefs: [{ kind: "operation", id: operationId, role: "current_note_replace_operation" }]
      } as JobRecord;
      return job;
    });
    registerCurrentNoteReplaceIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: VAULT_ID } as VaultSummary),
      activeVaultPath: () => "/synthetic/vault",
      getService: () => ({
        decideProposal: () => ({
          status: "applied",
          proposal: { ...preview, state: "applied", revision: 3 },
          operation: { id: operationId }
        })
      } as unknown as CurrentNoteReplaceService),
      getJobsService: () => ({
        readAgentTurnJob: () => job,
        resolveAgentTurnReview
      } as unknown as JobsService)
    });

    expect(await decide(handlers)).toMatchObject({ status: "applied", operationId });
    expect(resolveAgentTurnReview).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({ state: "completed", operationIds: [operationId] });
  });

  it("replays an exact terminal decision after response loss without reopening review", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    const operationId = "op_20260728_replaceipc0001";
    const proposal = { ...replacePreview(), state: "applied" as const, revision: 3 };
    const job = {
      ...waitingJob(),
      state: "completed",
      operationIds: [operationId],
      outputRefs: [{ kind: "operation", id: operationId, role: "current_note_replace_operation" }]
    } as JobRecord;
    const decideProposal = vi.fn(() => ({ status: "applied" as const, proposal, operation: { id: operationId } }));
    registerCurrentNoteReplaceIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: VAULT_ID } as VaultSummary),
      activeVaultPath: () => "/synthetic/vault",
      getService: () => ({ getProposal: () => proposal, decideProposal } as unknown as CurrentNoteReplaceService),
      getJobsService: () => ({ readAgentTurnJob: () => job } as unknown as JobsService)
    });

    expect(await decide(handlers)).toMatchObject({ status: "applied", operationId });
    expect(decideProposal).toHaveBeenCalledOnce();
  });

  it("fails closed on vault drift, malformed input, and private service errors", async () => {
    const handlers = new Map<string, (_event: unknown, request: unknown) => unknown>();
    registerCurrentNoteReplaceIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      currentVault: () => ({ vaultId: "vault_other" } as VaultSummary),
      activeVaultPath: () => "/private/vault/path",
      getService: () => ({
        getProposal: () => { throw new Error("private markdown and path"); },
        decideProposal: () => { throw new Error("private markdown and path"); }
      } as unknown as CurrentNoteReplaceService),
      getJobsService: () => ({}) as JobsService
    });

    const stale = await handlers.get("agent.currentNoteReplaceProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID
    });
    expect(stale).toEqual({ apiVersion: 1, status: "stale" });
    expect(JSON.stringify(stale)).not.toContain("/private/vault/path");
    expect(() => handlers.get("agent.currentNoteReplaceProposal")?.({}, {
      apiVersion: 1,
      activeVaultId: VAULT_ID,
      jobId: JOB_ID,
      proposalId: PROPOSAL_ID,
      extra: true
    })).toThrow();
  });
});

function replacePreview() {
  return {
    proposalId: PROPOSAL_ID,
    kind: "replace_current_note" as const,
    state: "ready" as const,
    revision: 1,
    activeVaultId: VAULT_ID,
    jobId: JOB_ID,
    lines: [{ kind: "added" as const, text: "Bounded replacement" }]
  };
}

function waitingJob(): JobRecord {
  return {
    id: JOB_ID,
    state: "awaiting_review",
    activeVaultId: VAULT_ID,
    proposalIds: [PROPOSAL_ID],
    inputRefs: [{ kind: "page", id: PAGE_ID, role: "agent_turn_current_note_scope" }]
  } as JobRecord;
}

function decide(handlers: Map<string, (_event: unknown, request: unknown) => unknown>): unknown {
  return handlers.get("agent.decideCurrentNoteReplaceProposal")?.({}, {
    apiVersion: 1,
    activeVaultId: VAULT_ID,
    jobId: JOB_ID,
    proposalId: PROPOSAL_ID,
    expectedRevision: 1,
    decision: "approve"
  });
}
