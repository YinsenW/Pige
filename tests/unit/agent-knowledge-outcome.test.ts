import { describe, expect, it } from "vitest";
import { AgentKnowledgeOutcomeSummarySchema, JobRecordSchema } from "@pige/schemas";
import {
  datasetKnowledgeOutcome,
  failedKnowledgeOutcome,
  pendingReviewKnowledgeOutcome,
  publishedKnowledgeOutcome,
  responseKnowledgeOutcome,
  resolvedReviewKnowledgeOutcome,
  waitingKnowledgeOutcome
} from "../../apps/desktop/src/main/services/agent-knowledge-outcome";

const operationId = "op_20260709_abcdef123456";
const job = JobRecordSchema.parse({
  id: "job_20260709_abcdef123456ag",
  class: "agent_ingest",
  state: "running",
  sourceId: "src_20260709_abcdef123456",
  createdAt: "2026-07-09T12:00:00.000Z",
  updatedAt: "2026-07-09T12:01:00.000Z",
  message: "Running"
});

describe("Agent knowledge outcome summaries", () => {
  it("projects deterministic created, updated, linked, skipped, and attention outcomes", () => {
    const created = publishedKnowledgeOutcome(job, {
      outcome: "published",
      mutationKind: "create_page",
      created: true,
      pageId: "page_20260709_abcdef123456",
      pagePath: "knowledge/note.md",
      title: "Note",
      reviewRequired: false,
      warnings: [],
      operationIds: [operationId],
      operationId
    });
    expect(created).toMatchObject({
      kind: "created",
      knowledgeFields: ["title", "summary", "key_points", "citations", "tags"],
      operationIds: [operationId],
      undoOperationIds: [operationId]
    });
    expect(created.citationRefs).toEqual([
      { kind: "source", id: job.sourceId, role: "knowledge_outcome_source" }
    ]);

    expect(publishedKnowledgeOutcome(job, {
      outcome: "published",
      mutationKind: "update_page",
      created: false,
      pageId: "page_20260709_abcdef123456",
      pagePath: "knowledge/note.md",
      title: "Note",
      reviewRequired: false,
      warnings: [],
      operationIds: [operationId],
      operationId
    }).kind).toBe("updated");

    expect(publishedKnowledgeOutcome(job, {
      outcome: "published",
      mutationKind: "update_page",
      created: false,
      knowledgeAction: "linked",
      pageId: "page_20260709_abcdef123456",
      pagePath: "knowledge/note.md",
      title: "Note",
      reviewRequired: false,
      warnings: [],
      operationIds: [operationId],
      operationId
    })).toMatchObject({ kind: "linked", knowledgeFields: ["relationships"] });

    expect(responseKnowledgeOutcome(job, {
      outcome: "responded",
      answer: "No durable change needed.",
      evidenceRefs: ["ev_01"],
      operationIds: []
    })).toMatchObject({ kind: "skipped", writeRefs: [], undoOperationIds: [] });
    expect(pendingReviewKnowledgeOutcome(job, "proposal_20260709_abcdef123456", [])).toMatchObject({
      kind: "needs_attention",
      writeRefs: []
    });
  });

  it("projects Dataset, failure, waiting, and resolved-review recovery references without bodies or paths", () => {
    const dataset = datasetKnowledgeOutcome(job, {
      outcome: "dataset_materialized",
      datasetId: "dataset_20260709_abcdef123456",
      revisionId: "dsrev_20260709_abcdef123456",
      tableCount: 1,
      rowCount: 2,
      warnings: [],
      operationIds: [operationId]
    });
    expect(dataset).toMatchObject({ kind: "created", knowledgeFields: ["dataset"], undoOperationIds: [] });
    expect(dataset.writeRefs.map((ref) => ref.kind)).toEqual(["dataset", "dataset_revision", "operation"]);

    expect(failedKnowledgeOutcome(job, "agent_runtime.source_turn_failed")).toMatchObject({
      kind: "failed",
      failureCode: "agent_runtime.source_turn_failed"
    });
    expect(waitingKnowledgeOutcome(job).kind).toBe("needs_attention");
    expect(resolvedReviewKnowledgeOutcome({
      job,
      proposalId: "proposal_20260709_abcdef123456",
      applied: false,
      operationIds: [],
      linked: false,
      reviewRequired: false
    }).kind).toBe("skipped");
    expect(JSON.stringify(dataset)).not.toContain("knowledge/note.md");
  });

  it("rejects forged undo and failed-outcome combinations", () => {
    expect(() => AgentKnowledgeOutcomeSummarySchema.parse({
      schemaVersion: 1,
      kind: "created",
      knowledgeFields: [],
      citationRefs: [],
      writeRefs: [],
      operationIds: [],
      undoOperationIds: [operationId],
      recoveryRefs: [{ kind: "source", id: job.sourceId }]
    })).toThrow();
    expect(() => AgentKnowledgeOutcomeSummarySchema.parse({
      schemaVersion: 1,
      kind: "failed",
      knowledgeFields: [],
      citationRefs: [],
      writeRefs: [],
      operationIds: [],
      undoOperationIds: [],
      recoveryRefs: [{ kind: "source", id: job.sourceId }]
    })).toThrow();
    expect(() => AgentKnowledgeOutcomeSummarySchema.parse({
      schemaVersion: 1,
      kind: "created",
      knowledgeFields: [],
      citationRefs: [],
      writeRefs: [{ kind: "page", id: "page_20260709_abcdef123456", role: "write", path: "private.md" }],
      operationIds: [],
      undoOperationIds: [],
      recoveryRefs: [{ kind: "source", id: job.sourceId, role: "source" }]
    })).toThrow();
  });
});
