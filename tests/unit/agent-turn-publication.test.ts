import { describe, expect, it, vi } from "vitest";
import type { AgentTurnAnswer } from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import {
  settleJobAfterAssistant,
  type HomeAgentJobSession,
  type HomeAgentTurnJobPort
} from "../../apps/desktop/src/main/services/agent-turn-publication";

const answer: AgentTurnAnswer = {
  answer: "The current note append was handled. [citation_1]",
  grounding: "local_knowledge",
  citations: [{
    refId: "citation_1",
    label: "[1]",
    pageId: "page_20260728_publication",
    title: "Publication note",
    pageType: "note",
    locator: "note_page"
  }]
};

describe("settleJobAfterAssistant current-note append publication", () => {
  it("merges one applied append Operation into the existing assistant/citation settlement", () => {
    const session = makeSession();
    const settleAgentTurnJob = vi.fn((expected: JobRecord, outcome: any) => ({
      ...expected,
      state: "completed",
      outputRefs: outcome.facts.outputRefs,
      operationIds: outcome.facts.operationIds
    }) as JobRecord);
    const waiting = settleJobAfterAssistant({
      session,
      jobs: makeJobs(settleAgentTurnJob),
      mutations: undefined,
      currentNoteAppendPublication: {
        status: "applied",
        operationId: "op_20260728_appendpublication"
      },
      vaultPath: "/synthetic/vault",
      result: answer,
      assistantEventId: "evt_20260728_appendassistant",
      sourceIds: []
    });

    expect(waiting).toBe(false);
    expect(settleAgentTurnJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: "completed",
      facts: expect.objectContaining({
        operationIds: ["op_20260728_appendpublication"],
        outputRefs: expect.arrayContaining([expect.objectContaining({
          kind: "operation",
          id: "op_20260728_appendpublication",
          role: "current_note_append_operation"
        })])
      })
    }));
  });

  it("settles exactly one append proposal into durable review", () => {
    const session = makeSession();
    const settleAgentTurnJob = vi.fn((expected: JobRecord) => ({
      ...expected,
      state: "awaiting_review",
      proposalIds: ["proposal_20260728_appendpublication"]
    }) as JobRecord);
    const waiting = settleJobAfterAssistant({
      session,
      jobs: makeJobs(settleAgentTurnJob),
      mutations: undefined,
      currentNoteAppendPublication: {
        status: "review_required",
        proposalId: "proposal_20260728_appendpublication"
      },
      vaultPath: "/synthetic/vault",
      result: answer,
      assistantEventId: "evt_20260728_appendassistant",
      sourceIds: []
    });
    expect(waiting).toBe(true);
    expect(settleAgentTurnJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: "waiting",
      reason: "review",
      proposalId: "proposal_20260728_appendpublication"
    }));
  });
});

function makeSession(): HomeAgentJobSession {
  return {
    current: {
      id: "job_20260728_appendpublication",
      activeVaultId: "vault_20260728_appendpublication",
      outputRefs: []
    } as JobRecord,
    modelInvocationStarted: true,
    modelUsage: "local"
  };
}

function makeJobs(
  settleAgentTurnJob: (expected: JobRecord, outcome: any) => JobRecord
): HomeAgentTurnJobPort {
  return {
    settleAgentTurnJob,
    adoptAgentTurnCompletion: vi.fn()
  };
}
