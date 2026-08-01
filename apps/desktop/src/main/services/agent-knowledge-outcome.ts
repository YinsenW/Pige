import {
  AgentKnowledgeOutcomeSummarySchema,
  type AgentKnowledgeOutcomeSummary,
  type JobRecord,
  type JobRef
} from "@pige/schemas";
import type {
  AgentIngestDatasetResult,
  AgentIngestProposalResult,
  AgentIngestPublishedResult,
  AgentIngestResponseResult
} from "./agent-ingest-service";

const PAGE_FIELDS = ["title", "summary", "key_points", "citations", "tags"] as const;

function reference(kind: JobRef["kind"], id: string, role: string): JobRef {
  return { kind, id, role };
}

function sourceRecovery(job: JobRecord): JobRef {
  if (!job.sourceId) throw new Error("A source-bound knowledge outcome requires its durable source identity.");
  return reference("source", job.sourceId, "knowledge_outcome_source");
}

function operationReferences(operationIds: readonly string[]): JobRef[] {
  return operationIds.map((operationId) => reference("operation", operationId, "knowledge_outcome_operation"));
}

export function publishedKnowledgeOutcome(
  job: JobRecord,
  result: AgentIngestPublishedResult
): AgentKnowledgeOutcomeSummary {
  const source = sourceRecovery(job);
  const page = reference("page", result.pageId, "knowledge_outcome_page");
  const operations = Array.from(new Set(result.operationIds));
  const kind = result.reviewRequired
    ? "needs_attention"
    : result.knowledgeAction === "linked"
      ? "linked"
      : result.mutationKind === "update_page"
        ? "updated"
        : result.created
          ? "created"
          : "skipped";
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind,
    knowledgeFields: result.knowledgeAction === "linked" ? ["relationships"] : PAGE_FIELDS,
    citationRefs: result.knowledgeAction === "linked" ? [] : [source],
    writeRefs: kind === "skipped" ? [] : [page, ...operationReferences(operations)],
    operationIds: operations,
    undoOperationIds: operations,
    recoveryRefs: [source, page, ...operationReferences(operations)]
  });
}

export function proposalKnowledgeOutcome(
  job: JobRecord,
  result: AgentIngestProposalResult
): AgentKnowledgeOutcomeSummary {
  return pendingReviewKnowledgeOutcome(job, result.proposalId, result.operationIds);
}

export function pendingReviewKnowledgeOutcome(
  job: JobRecord,
  proposalId: string,
  operationIds: readonly string[]
): AgentKnowledgeOutcomeSummary {
  const source = sourceRecovery(job);
  const proposal = reference("proposal", proposalId, "knowledge_outcome_review");
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "needs_attention",
    knowledgeFields: PAGE_FIELDS,
    citationRefs: [source],
    writeRefs: [],
    operationIds: Array.from(new Set(operationIds)),
    undoOperationIds: [],
    recoveryRefs: [source, proposal]
  });
}

export function responseKnowledgeOutcome(
  job: JobRecord,
  result: AgentIngestResponseResult
): AgentKnowledgeOutcomeSummary {
  const source = sourceRecovery(job);
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "skipped",
    knowledgeFields: [],
    citationRefs: result.evidenceRefs.length > 0 ? [source] : [],
    writeRefs: [],
    operationIds: Array.from(new Set(result.operationIds)),
    undoOperationIds: [],
    recoveryRefs: [source]
  });
}

export function datasetKnowledgeOutcome(
  job: JobRecord,
  result: AgentIngestDatasetResult
): AgentKnowledgeOutcomeSummary {
  const source = sourceRecovery(job);
  const dataset = reference("dataset", result.datasetId, "knowledge_outcome_dataset");
  const revision = reference("dataset_revision", result.revisionId, "knowledge_outcome_dataset_revision");
  const operations = Array.from(new Set(result.operationIds));
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "created",
    knowledgeFields: ["dataset"],
    citationRefs: [source],
    writeRefs: [dataset, revision, ...operationReferences(operations)],
    operationIds: operations,
    undoOperationIds: [],
    recoveryRefs: [source, dataset, revision, ...operationReferences(operations)]
  });
}

export function failedKnowledgeOutcome(
  job: JobRecord,
  failureCode: string
): AgentKnowledgeOutcomeSummary {
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "failed",
    knowledgeFields: [],
    citationRefs: [],
    writeRefs: [],
    operationIds: [],
    undoOperationIds: [],
    recoveryRefs: [sourceRecovery(job)],
    failureCode
  });
}

export function waitingKnowledgeOutcome(job: JobRecord): AgentKnowledgeOutcomeSummary {
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "needs_attention",
    knowledgeFields: [],
    citationRefs: [],
    writeRefs: [],
    operationIds: [],
    undoOperationIds: [],
    recoveryRefs: [sourceRecovery(job)]
  });
}

export function cancelledKnowledgeOutcome(job: JobRecord): AgentKnowledgeOutcomeSummary {
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: "skipped",
    knowledgeFields: [],
    citationRefs: [],
    writeRefs: [],
    operationIds: [],
    undoOperationIds: [],
    recoveryRefs: [sourceRecovery(job)]
  });
}

export function resolvedReviewKnowledgeOutcome(input: {
  readonly job: JobRecord;
  readonly proposalId: string;
  readonly applied: boolean;
  readonly pageId?: string;
  readonly operationIds: readonly string[];
  readonly linked: boolean;
  readonly reviewRequired: boolean;
}): AgentKnowledgeOutcomeSummary {
  const source = sourceRecovery(input.job);
  const proposal = reference("proposal", input.proposalId, "knowledge_outcome_review");
  const operations = Array.from(new Set(input.operationIds));
  const page = input.pageId ? reference("page", input.pageId, "knowledge_outcome_page") : undefined;
  return AgentKnowledgeOutcomeSummarySchema.parse({
    schemaVersion: 1,
    kind: !input.applied
      ? "skipped"
      : input.reviewRequired
        ? "needs_attention"
        : input.linked
          ? "linked"
          : "created",
    knowledgeFields: !input.applied ? [] : input.linked ? ["relationships"] : PAGE_FIELDS,
    citationRefs: input.applied && !input.linked ? [source] : [],
    writeRefs: input.applied ? [...(page ? [page] : []), ...operationReferences(operations)] : [],
    operationIds: operations,
    undoOperationIds: input.applied ? operations : [],
    recoveryRefs: [source, proposal, ...(page ? [page] : []), ...operationReferences(operations)]
  });
}
