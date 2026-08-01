import { PigeDomainError } from "@pige/domain";
import { z } from "zod";
import {
  ConfirmationProposalSchema,
  type ConfirmationProposal,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import type { StageProposalRequest, StageProposalResult } from "@pige/contracts";
import {
  LINK_KNOWLEDGE_NOTES_TOOL_NAME,
  LINK_KNOWLEDGE_NOTES_TOOL_VERSION
} from "./agent-ingest-tool-registry";
import {
  AGENT_PAGE_UPDATE_CHECKPOINT_ID,
  applyAgentPageUpdate,
  createAgentPageRelationshipOperationId,
  recoverAgentPageUpdate,
  type AgentPageUpdateClaim,
  type AgentPageUpdatePublicationBinding
} from "./agent-page-update-service";
import type { EvidencePack } from "./evidence-assembly-service";
import {
  readCurrentNotePageForMutation,
  type CurrentRetrievalPageMutationBinding
} from "./retrieval-evidence-boundary";

const SOURCE_BINDING_PREFIX = "agent_proposal_source_binding:";
const TOOL_BINDING_PREFIX = "agent_proposal_tool_binding:";
const CATALOG_BINDING_PREFIX = "agent_proposal_catalog_binding:";
const POLICY_BINDING_PREFIX = "agent_proposal_policy_binding:";
const MAX_ARTIFACT_REFS = 32;

const RelationshipIntentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("link_existing_notes"),
  sourceId: z.string().regex(/^src_[a-z0-9_]+$/),
  sourceBindingHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  from: z.object({
    pageId: z.string().regex(/^page_[a-z0-9_]+$/),
    pagePath: z.string().min(1).max(1024),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }).strict(),
  to: z.object({
    pageId: z.string().regex(/^page_[a-z0-9_]+$/),
    pagePath: z.string().min(1).max(1024),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }).strict(),
  summary: z.object({
    text: z.string().min(1).max(4_096),
    citations: z.array(z.string().min(1).max(512)).max(32)
  }).strict(),
  confidence: z.enum(["low", "medium", "high"]),
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/),
  policyContextId: z.string().min(1).max(160),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  catalogHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  canonicalInputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  toolCallProvenanceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  artifactIds: z.array(z.string().regex(/^art_[a-z0-9_]+$/)).max(MAX_ARTIFACT_REFS)
}).strict();

type RelationshipIntent = z.infer<typeof RelationshipIntentSchema>;

export interface RelationshipProposalPort {
  stage(vaultPath: string, request: StageProposalRequest): StageProposalResult;
}

export interface RelationshipProposalBinding {
  readonly toolId: typeof LINK_KNOWLEDGE_NOTES_TOOL_NAME;
  readonly toolVersion: typeof LINK_KNOWLEDGE_NOTES_TOOL_VERSION;
  readonly sourceId: string;
  readonly sourceBindingHash: string;
  readonly canonicalInputHash: string;
  readonly catalogHash: string;
  readonly policyHash: string;
  readonly toolCallProvenanceHash: string;
}

export interface RelationshipProposalResult {
  readonly proposal: ConfirmationProposal;
  readonly binding: RelationshipProposalBinding;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly warnings: readonly string[];
}

export function stageRelationshipProposal(input: {
  readonly proposals: RelationshipProposalPort;
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly evidencePack: EvidencePack;
  readonly sourceBindingHash: string;
  readonly target: CurrentRetrievalPageMutationBinding;
  readonly relationshipTarget: CurrentRetrievalPageMutationBinding;
  readonly summary: AgentPageUpdateClaim;
  readonly confidence: "low" | "medium" | "high";
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly catalogHash: string;
  readonly canonicalInputHash: string;
  readonly toolCallProvenanceHash: string;
}): RelationshipProposalResult {
  const intent = RelationshipIntentSchema.parse({
    schemaVersion: 1,
    kind: "link_existing_notes",
    sourceId: input.sourceRecord.id,
    sourceBindingHash: input.sourceBindingHash,
    from: pageIdentity(input.target),
    to: pageIdentity(input.relationshipTarget),
    summary: input.summary,
    confidence: input.confidence,
    modelProfileId: input.modelProfileId,
    policyContextId: input.policyContextId,
    policyHash: input.policyHash,
    catalogHash: input.catalogHash,
    canonicalInputHash: input.canonicalInputHash,
    toolCallProvenanceHash: input.toolCallProvenanceHash,
    artifactIds: uniqueArtifacts(input.evidencePack.artifactIds)
  });
  const proposal = input.proposals.stage(input.vaultPath, {
    jobId: input.job.id,
    trustLevel: "review_required",
    summary: `Review suggested link from ${input.target.item.summary.title} to ${input.relationshipTarget.item.summary.title}`,
    reason: "The evidence suggests this relationship, but its confidence requires explicit review.",
    sourceRefs: createSourceRefs(input.job, input.sourceRecord, intent),
    targetRefs: [{ kind: "page", id: intent.from.pageId, path: intent.from.pagePath }],
    proposedOperations: [{
      kind: "update",
      path: intent.from.pagePath,
      beforeSha256: intent.from.contentHash,
      content: JSON.stringify(intent)
    }],
    diffRefs: [],
    warnings: ["This link will update one current note only after approval."],
    baseHashes: { [intent.from.pagePath]: intent.from.contentHash }
  }).proposal;
  if (!proposal) throw new PigeDomainError("agent_runtime.proposal_tool_unavailable", "The relationship proposal could not be staged.");
  return recoverRelationshipProposal({
    vaultPath: input.vaultPath,
    proposal,
    job: input.job,
    sourceRecord: input.sourceRecord,
    sourceBindingHash: input.sourceBindingHash,
    allowedCatalogHashes: [input.catalogHash],
    expectedPolicyHash: input.policyHash
  });
}

export function recoverRelationshipProposal(input: {
  readonly vaultPath: string;
  readonly proposal: ConfirmationProposal;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly sourceBindingHash: string;
  readonly allowedCatalogHashes: readonly string[];
  readonly expectedPolicyHash?: string;
  readonly allowedStates?: ReadonlySet<ConfirmationProposal["state"]>;
}): RelationshipProposalResult {
  const proposal = ConfirmationProposalSchema.parse(input.proposal);
  const intent = requireRelationshipIntent(proposal);
  const target = readCurrentNotePageForMutation(input.vaultPath, intent.from.pageId);
  const related = readCurrentNotePageForMutation(input.vaultPath, intent.to.pageId);
  const allowedStates = input.allowedStates ?? new Set<ConfirmationProposal["state"]>(["ready"]);
  if (
    !allowedStates.has(proposal.state) ||
    proposal.jobId !== input.job.id ||
    intent.sourceId !== input.sourceRecord.id ||
    intent.sourceBindingHash !== input.sourceBindingHash ||
    (input.job.policyHash !== undefined && intent.policyHash !== input.job.policyHash) ||
    (input.expectedPolicyHash !== undefined && intent.policyHash !== input.expectedPolicyHash) ||
    !input.allowedCatalogHashes.includes(intent.catalogHash) ||
    !samePage(target, intent.from) ||
    !samePage(related, intent.to) ||
    !matchesProposalEnvelope(proposal, intent)
  ) throw relationshipConflict("The durable relationship proposal changed or is no longer current.");
  assertRootBinding(proposal, SOURCE_BINDING_PREFIX, intent.sourceBindingHash);
  assertRootBinding(proposal, TOOL_BINDING_PREFIX, `${LINK_KNOWLEDGE_NOTES_TOOL_NAME}@${LINK_KNOWLEDGE_NOTES_TOOL_VERSION}:${intent.canonicalInputHash}`);
  assertRootBinding(proposal, CATALOG_BINDING_PREFIX, intent.catalogHash);
  assertRootBinding(proposal, POLICY_BINDING_PREFIX, intent.policyHash);
  return {
    proposal,
    binding: bindingFromIntent(intent),
    pageId: intent.from.pageId,
    pagePath: intent.from.pagePath,
    title: target.item.summary.title,
    warnings: proposal.warnings
  };
}

export function applyRelationshipProposal(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly proposal: ConfirmationProposal;
  readonly sourceBindingHash: string;
  readonly onPublicationStart?: (checkpointId: string, binding: AgentPageUpdatePublicationBinding) => void;
  readonly assertSourceCurrent?: () => void;
}): { readonly pageId: string; readonly pagePath: string; readonly title: string; readonly operation: OperationRecord } {
  const intent = requireRelationshipIntent(input.proposal);
  const recovered = recoverAgentPageUpdate({
    vaultPath: input.vaultPath,
    job: input.job,
    sourceRecord: input.sourceRecord,
    allowedCatalogHashes: { update: [], relationship: [intent.catalogHash] },
    ...(input.assertSourceCurrent ? { assertSourceCurrent: input.assertSourceCurrent } : {})
  });
  if (recovered) return recovered;
  recoverRelationshipProposal({
    vaultPath: input.vaultPath,
    proposal: input.proposal,
    job: input.job,
    sourceRecord: input.sourceRecord,
    sourceBindingHash: input.sourceBindingHash,
    allowedCatalogHashes: [intent.catalogHash],
    expectedPolicyHash: intent.policyHash,
    allowedStates: new Set(["approved", "applied"])
  });
  const committed = applyAgentPageUpdate({
    vaultPath: input.vaultPath,
    job: input.job,
    sourceRecord: input.sourceRecord,
    target: readCurrentNotePageForMutation(input.vaultPath, intent.from.pageId),
    relationshipTarget: readCurrentNotePageForMutation(input.vaultPath, intent.to.pageId),
    modelProfileId: intent.modelProfileId,
    policyContextId: intent.policyContextId,
    policyHash: intent.policyHash,
    toolId: LINK_KNOWLEDGE_NOTES_TOOL_NAME,
    toolVersion: LINK_KNOWLEDGE_NOTES_TOOL_VERSION,
    catalogHash: intent.catalogHash,
    canonicalInputHash: intent.canonicalInputHash,
    toolCallProvenanceHash: intent.toolCallProvenanceHash,
    artifactIds: intent.artifactIds,
    summary: intent.summary,
    keyPoints: [],
    confidence: intent.confidence,
    ...(input.onPublicationStart ? {
      onPublicationStart: (binding) => input.onPublicationStart?.(AGENT_PAGE_UPDATE_CHECKPOINT_ID, binding)
    } : {}),
    ...(input.assertSourceCurrent ? { assertSourceCurrent: input.assertSourceCurrent } : {})
  });
  if (committed.relationshipPageId !== intent.to.pageId) throw relationshipConflict("The approved relationship target changed during apply.");
  return committed;
}

export function verifyRelationshipProposal(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly proposal: ConfirmationProposal;
}): OperationRecord {
  const intent = requireRelationshipIntent(input.proposal);
  const recovered = recoverAgentPageUpdate({
    vaultPath: input.vaultPath,
    job: input.job,
    sourceRecord: input.sourceRecord,
    allowedCatalogHashes: { update: [], relationship: [intent.catalogHash] }
  });
  if (
    !recovered ||
    recovered.pageId !== intent.from.pageId ||
    recovered.relationshipPageId !== intent.to.pageId ||
    recovered.operation.id !== createAgentPageRelationshipOperationId(input.job.id, intent.from.pageId, intent.to.pageId)
  ) throw relationshipConflict("The applied relationship proposal effect is missing or changed.");
  return recovered.operation;
}

export function isSupportedRelationshipProposal(proposal: ConfirmationProposal): boolean {
  try {
    const intent = requireRelationshipIntent(proposal);
    return matchesProposalEnvelope(proposal, intent);
  } catch {
    return false;
  }
}

export function relationshipProposalOperationId(proposal: ConfirmationProposal, jobId: string): string | undefined {
  if (!isSupportedRelationshipProposal(proposal)) return undefined;
  const intent = requireRelationshipIntent(proposal);
  return createAgentPageRelationshipOperationId(jobId, intent.from.pageId, intent.to.pageId);
}

function requireRelationshipIntent(proposal: ConfirmationProposal): RelationshipIntent {
  const operation = proposal.proposedOperations[0];
  if (proposal.proposedOperations.length !== 1 || operation?.kind !== "update") throw relationshipConflict("The proposal is not one relationship update.");
  try {
    return RelationshipIntentSchema.parse(JSON.parse(operation.content));
  } catch {
    throw relationshipConflict("The relationship proposal intent is invalid.");
  }
}

function matchesProposalEnvelope(proposal: ConfirmationProposal, intent: RelationshipIntent): boolean {
  const operation = proposal.proposedOperations[0];
  const target = proposal.targetRefs[0];
  return Boolean(
    proposal.jobId &&
    (proposal.state === "ready" || proposal.decision?.decidedBy === "user") &&
    proposal.trustLevel === "review_required" &&
    proposal.proposedOperations.length === 1 &&
    operation?.kind === "update" &&
    operation.path === intent.from.pagePath &&
    operation.beforeSha256 === intent.from.contentHash &&
    proposal.targetRefs.length === 1 &&
    target?.kind === "page" && target.id === intent.from.pageId && target.path === intent.from.pagePath &&
    proposal.baseHashes[intent.from.pagePath] === intent.from.contentHash &&
    Object.keys(proposal.baseHashes).length === 1 &&
    proposal.sourceRefs.some((ref) => ref.kind === "page" && ref.id === intent.to.pageId && ref.path === intent.to.pagePath) &&
    proposal.sourceRefs.some((ref) => ref.kind === "source" && ref.id === intent.sourceId)
  );
}

function createSourceRefs(job: JobRecord, source: SourceRecord, intent: RelationshipIntent): NonNullable<StageProposalRequest["sourceRefs"]> {
  return [
    { kind: "job", id: job.id },
    { kind: "source", id: source.id },
    ...intent.artifactIds.map((id) => ({ kind: "artifact" as const, id })),
    { kind: "page", id: intent.from.pageId, path: intent.from.pagePath },
    { kind: "page", id: intent.to.pageId, path: intent.to.pagePath },
    { kind: "root_binding", id: `${SOURCE_BINDING_PREFIX}${intent.sourceBindingHash}` },
    { kind: "root_binding", id: `${TOOL_BINDING_PREFIX}${LINK_KNOWLEDGE_NOTES_TOOL_NAME}@${LINK_KNOWLEDGE_NOTES_TOOL_VERSION}:${intent.canonicalInputHash}` },
    { kind: "root_binding", id: `${CATALOG_BINDING_PREFIX}${intent.catalogHash}` },
    { kind: "root_binding", id: `${POLICY_BINDING_PREFIX}${intent.policyHash}` }
  ];
}

function bindingFromIntent(intent: RelationshipIntent): RelationshipProposalBinding {
  return {
    toolId: LINK_KNOWLEDGE_NOTES_TOOL_NAME,
    toolVersion: LINK_KNOWLEDGE_NOTES_TOOL_VERSION,
    sourceId: intent.sourceId,
    sourceBindingHash: intent.sourceBindingHash,
    canonicalInputHash: intent.canonicalInputHash,
    catalogHash: intent.catalogHash,
    policyHash: intent.policyHash,
    toolCallProvenanceHash: intent.toolCallProvenanceHash
  };
}

function pageIdentity(binding: CurrentRetrievalPageMutationBinding): RelationshipIntent["from"] {
  return { pageId: binding.page.pageId, pagePath: binding.item.summary.pagePath, contentHash: binding.page.contentHash };
}

function samePage(binding: CurrentRetrievalPageMutationBinding, expected: RelationshipIntent["from"]): boolean {
  return binding.page.pageId === expected.pageId && binding.item.summary.pagePath === expected.pagePath && binding.page.contentHash === expected.contentHash;
}

function assertRootBinding(proposal: ConfirmationProposal, prefix: string, expected: string): void {
  const matches = proposal.sourceRefs.filter((ref) => ref.kind === "root_binding" && ref.id === `${prefix}${expected}`);
  if (matches.length !== 1) throw relationshipConflict("The relationship proposal binding is missing or ambiguous.");
}

function uniqueArtifacts(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => /^art_[a-z0-9_]+$/u.test(id)))].sort().slice(0, MAX_ARTIFACT_REFS);
}

function relationshipConflict(message: string): PigeDomainError {
  return new PigeDomainError("proposal.binding_changed", message);
}
