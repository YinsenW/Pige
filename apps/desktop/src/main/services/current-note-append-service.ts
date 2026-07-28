import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  JobRecordSchema,
  OperationRecordSchema,
  PageIdSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  createAgentPageUpdateBeforePath,
  createAgentPageUpdateOperationId,
  createAgentPageUpdateStagedPath,
  readAgentPageUpdateOperationBinding
} from "./agent-page-update-service";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  removeGeneratedNoteExact,
  replaceGeneratedNoteExact
} from "./generated-note-file";
import { containsRestrictedModelContent } from "./model-egress-content";
import { readCurrentNotePageForMutation } from "./retrieval-evidence-boundary";

const MAX_APPEND_TEXT_BYTES = 16 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const APPEND_TOOL_ID = "pige_append_current_note";
const APPEND_TOOL_VERSION = "1";

export interface CurrentNoteAppendInspection {
  readonly pageId: string;
  readonly contentHash: string;
  readonly bindingHash: string;
  readonly evidenceRefs: readonly ["citation_1"];
}

export interface CurrentNoteAppendRequest {
  readonly vaultPath: string;
  readonly activeVaultId: string;
  readonly job: JobRecord;
  readonly inspection: CurrentNoteAppendInspection;
  readonly modelProfileId: string;
  readonly markdown: string;
}

export interface CurrentNoteAppendProposalPreview {
  readonly proposalId: string;
  readonly kind: "append_current_note";
  readonly state: "ready" | "resolving" | "applied" | "rejected" | "conflicted";
  readonly revision: number;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly jobId: string;
  readonly lines: readonly {
    readonly kind: "context" | "added";
    readonly text: string;
  }[];
}

export type CurrentNoteAppendResult =
  | {
      readonly status: "committed";
      readonly pageId: string;
      readonly operation: OperationRecord;
      readonly recovered: boolean;
    }
  | {
      readonly status: "awaiting_review";
      readonly proposal: CurrentNoteAppendProposalPreview;
    };

export type CurrentNoteAppendProposalDecisionResult =
  | { readonly status: "applied"; readonly proposal: CurrentNoteAppendProposalPreview; readonly operation: OperationRecord }
  | { readonly status: "rejected" | "conflicted"; readonly proposal: CurrentNoteAppendProposalPreview }
  | { readonly status: "stale"; readonly proposal?: CurrentNoteAppendProposalPreview }
  | { readonly status: "not_found" };

export type CurrentNoteAppendPublicationStatus =
  | { readonly status: "applied"; readonly operationId: string }
  | { readonly status: "review_required"; readonly proposalId: string }
  | { readonly status: "resolved"; readonly proposalId: string };

interface AppendIntentRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_append_intent";
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeHash: string;
  readonly inspectionBindingHash: string;
  readonly evidenceRefs: readonly ["citation_1"];
  readonly markdown: string;
  readonly markdownHash: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly operationId: string;
  readonly beforePath: string;
  readonly stagedPath: string;
  readonly operationPath: string;
  readonly artifactId: string;
  readonly artifactChecksum: string;
}

interface AppendProposalRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_append_proposal";
  readonly proposalId: string;
  readonly intentHash: string;
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly reviewBaseHash: string;
  readonly createdAt: string;
  readonly preview: CurrentNoteAppendProposalPreview["lines"];
}

interface ProposalDecisionRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_append_decision";
  readonly proposalId: string;
  readonly intentHash: string;
  readonly decision: "approve" | "reject";
  readonly decidedAt: string;
}

interface ProposalOutcomeRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_append_outcome";
  readonly proposalId: string;
  readonly intentHash: string;
  readonly outcome: "applied" | "rejected" | "conflicted";
  readonly operationId?: string;
  readonly completedAt: string;
}

interface AppendReceiptRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_append_receipt";
  readonly intentHash: string;
  readonly operationId: string;
  readonly afterHash: string;
  readonly committedAt: string;
}

export class CurrentNoteAppendService {
  publish(request: CurrentNoteAppendRequest): CurrentNoteAppendPublicationStatus {
    const result = this.append(request);
    return result.status === "committed"
      ? { status: "applied", operationId: result.operation.id }
      : { status: "review_required", proposalId: result.proposal.proposalId };
  }

  append(request: CurrentNoteAppendRequest): CurrentNoteAppendResult {
    const job = assertAppendJob(request);
    const intent = createIntent(request, job);
    const intentHash = hashJson(intent);
    persistExactJson(request.vaultPath, jobBindingPath(job.id), {
      schemaVersion: 1,
      kind: "current_note_append_job_binding",
      jobId: job.id,
      pageId: intent.pageId,
      operationId: intent.operationId
    });
    persistExactJson(request.vaultPath, intentPath(intent.operationId), intent);
    const durableIntent = readRequiredIntent(request.vaultPath, intent.operationId);
    if (stableJson(durableIntent) !== stableJson(intent)) throw turnConflict("The current-note append Job is already bound to another immutable intent.");

    const adopted = this.#adoptCommitted(request.vaultPath, durableIntent, intentHash);
    if (adopted) return adopted;

    const current = readCurrentTarget(request.vaultPath, durableIntent);
    const recovered = this.#adoptPageEffect(request.vaultPath, durableIntent, intentHash, current.contentHash, durableIntent.beforeHash);
    if (recovered) return recovered;
    if (current.contentHash !== durableIntent.beforeHash) {
      const proposal = this.#stageProposal(request.vaultPath, durableIntent, intentHash, current.markdown, current.contentHash);
      return { status: "awaiting_review", proposal: this.#preview(request.vaultPath, proposal, durableIntent) };
    }
    return this.#commit(request.vaultPath, durableIntent, intentHash, current.markdown, durableIntent.beforeHash, false);
  }

  recover(request: CurrentNoteAppendRequest): CurrentNoteAppendResult {
    return this.append(request);
  }

  readPublication(input: {
    readonly vaultPath: string;
    readonly activeVaultId: string;
    readonly job: JobRecord;
  }): CurrentNoteAppendPublicationStatus | undefined {
    const job = JobRecordSchema.parse(input.job);
    if (job.class !== "agent_turn" || job.activeVaultId !== input.activeVaultId) return undefined;
    const binding = readJobBinding(input.vaultPath, job.id);
    if (!binding) return undefined;
    if (binding.jobId !== job.id) throw turnConflict("The current-note append Job binding changed identity.");
    const intent = readRequiredIntent(input.vaultPath, binding.operationId);
    if (
      intent.activeVaultId !== input.activeVaultId ||
      intent.jobId !== job.id ||
      intent.pageId !== binding.pageId ||
      intent.operationId !== binding.operationId
    ) {
      throw turnConflict("The current-note append publication does not match its durable Job binding.");
    }
    const intentHash = hashJson(intent);
    const adopted = this.#adoptCommitted(input.vaultPath, intent, intentHash);
    if (adopted) return { status: "applied", operationId: adopted.operation.id };
    const proposal = readProposal(input.vaultPath, createProposalId(job.id, intent.pageId));
    if (!proposal) {
      if ((job.operationIds ?? []).includes(intent.operationId) || (job.proposalIds?.length ?? 0) > 0) {
        throw turnConflict("The current-note append publication referenced by the Job is unavailable.");
      }
      return undefined;
    }
    if (proposal.intentHash !== intentHash) throw turnConflict("The current-note append proposal changed immutable intent.");
    return readOutcome(input.vaultPath, proposal.proposalId)
      ? { status: "resolved", proposalId: proposal.proposalId }
      : { status: "review_required", proposalId: proposal.proposalId };
  }

  getProposal(input: {
    readonly vaultPath: string;
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly jobId: string;
    readonly proposalId: string;
  }): CurrentNoteAppendProposalPreview | undefined {
    const proposal = readProposal(input.vaultPath, input.proposalId);
    if (!proposal || proposal.activeVaultId !== input.activeVaultId || proposal.pageId !== input.pageId || proposal.jobId !== input.jobId) return undefined;
    const intent = readRequiredIntent(input.vaultPath, createAgentPageUpdateOperationId(input.jobId, input.pageId));
    return this.#preview(input.vaultPath, proposal, intent);
  }

  get(input: Parameters<CurrentNoteAppendService["getProposal"]>[0]): CurrentNoteAppendProposalPreview | undefined {
    return this.getProposal(input);
  }

  decide(input: Parameters<CurrentNoteAppendService["decideProposal"]>[0]): CurrentNoteAppendPublicationStatus {
    const result = this.decideProposal(input);
    if (result.status === "not_found") throw turnConflict("The current-note append proposal is unavailable.");
    if (result.status === "stale" && !result.proposal) {
      throw turnConflict("The current-note append proposal no longer has a durable identity.");
    }
    return result.status === "applied"
      ? { status: "applied", operationId: result.operation.id }
      : { status: "resolved", proposalId: result.proposal!.proposalId };
  }

  decideProposal(input: {
    readonly vaultPath: string;
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly jobId: string;
    readonly proposalId: string;
    readonly expectedRevision: number;
    readonly decision: "approve" | "reject";
  }): CurrentNoteAppendProposalDecisionResult {
    const proposal = readProposal(input.vaultPath, input.proposalId);
    if (!proposal || proposal.activeVaultId !== input.activeVaultId || proposal.pageId !== input.pageId || proposal.jobId !== input.jobId) return { status: "not_found" };
    const operationId = createAgentPageUpdateOperationId(input.jobId, input.pageId);
    const intent = readRequiredIntent(input.vaultPath, operationId);
    const intentHash = hashJson(intent);
    if (proposal.intentHash !== intentHash) throw turnConflict("The current-note append proposal no longer matches its immutable intent.");
    const currentPreview = this.#preview(input.vaultPath, proposal, intent);
    if (currentPreview.revision !== input.expectedRevision || currentPreview.state !== "ready") {
      return { status: "stale", proposal: currentPreview };
    }
    const decision: ProposalDecisionRecord = {
      schemaVersion: 1,
      kind: "current_note_append_decision",
      proposalId: proposal.proposalId,
      intentHash,
      decision: input.decision,
      decidedAt: new Date().toISOString()
    };
    persistExactJson(input.vaultPath, decisionPath(proposal.proposalId), decision, proposalDecisionIdentity);
    const durableDecision = readRequiredDecision(input.vaultPath, proposal.proposalId);
    if (durableDecision.decision !== input.decision || durableDecision.intentHash !== intentHash) {
      throw turnConflict("The current-note append proposal already has another durable decision.");
    }
    const existingOutcome = readOutcome(input.vaultPath, proposal.proposalId);
    if (existingOutcome) return this.#decisionResult(input.vaultPath, proposal, intent, existingOutcome);
    if (input.decision === "reject") {
      const outcome = commitOutcome(input.vaultPath, proposal, intentHash, "rejected");
      return { status: "rejected", proposal: this.#preview(input.vaultPath, proposal, intent, outcome) };
    }

    const adopted = this.#adoptCommitted(input.vaultPath, intent, intentHash);
    if (adopted) {
      const outcome = commitOutcome(input.vaultPath, proposal, intentHash, "applied", adopted.operation.id);
      return { status: "applied", proposal: this.#preview(input.vaultPath, proposal, intent, outcome), operation: adopted.operation };
    }
    const current = readCurrentTarget(input.vaultPath, intent);
    const recoveredEffect = this.#adoptPageEffect(input.vaultPath, intent, intentHash, current.contentHash, proposal.reviewBaseHash);
    if (recoveredEffect) {
      const outcome = commitOutcome(input.vaultPath, proposal, intentHash, "applied", recoveredEffect.operation.id);
      return { status: "applied", proposal: this.#preview(input.vaultPath, proposal, intent, outcome), operation: recoveredEffect.operation };
    }
    if (current.contentHash !== proposal.reviewBaseHash) {
      const outcome = commitOutcome(input.vaultPath, proposal, intentHash, "conflicted");
      return { status: "conflicted", proposal: this.#preview(input.vaultPath, proposal, intent, outcome) };
    }
    const committed = this.#commit(input.vaultPath, intent, intentHash, current.markdown, proposal.reviewBaseHash, false);
    if (committed.status !== "committed") throw turnConflict("The approved current-note append did not reach a durable Operation.");
    const outcome = commitOutcome(input.vaultPath, proposal, intentHash, "applied", committed.operation.id);
    return { status: "applied", proposal: this.#preview(input.vaultPath, proposal, intent, outcome), operation: committed.operation };
  }

  #adoptCommitted(vaultPath: string, intent: AppendIntentRecord, intentHash: string): Extract<CurrentNoteAppendResult, { status: "committed" }> | undefined {
    const operation = readOperation(vaultPath, intent.operationId);
    if (!operation) return undefined;
    assertOperationMatchesIntent(operation, intent);
    const binding = readAgentPageUpdateOperationBinding(operation);
    if (!binding) throw turnConflict("The current-note append Operation is not compatible with Activity and Undo.");
    const current = readCurrentTarget(vaultPath, intent);
    if (current.contentHash !== binding.afterHash) throw turnConflict("The current note changed after its durable append Operation.");
    persistReceipt(vaultPath, intent, intentHash, operation, true);
    return { status: "committed", pageId: intent.pageId, operation, recovered: true };
  }

  #adoptPageEffect(
    vaultPath: string,
    intent: AppendIntentRecord,
    intentHash: string,
    liveHash: string,
    expectedBeforeHash: string
  ): Extract<CurrentNoteAppendResult, { status: "committed" }> | undefined {
    const before = readGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, intent.beforePath), MAX_PAGE_BYTES);
    if (before === undefined || hashText(before) !== expectedBeforeHash) return undefined;
    const expectedAfterHash = hashText(createAppendedMarkdown(before, intent));
    if (liveHash !== expectedAfterHash) return undefined;
    return this.#commit(vaultPath, intent, intentHash, before, expectedBeforeHash, true);
  }

  #commit(
    vaultPath: string,
    intent: AppendIntentRecord,
    intentHash: string,
    before: string,
    beforeHash: string,
    recovered: boolean
  ): Extract<CurrentNoteAppendResult, { status: "committed" }> {
    const next = createAppendedMarkdown(before, intent);
    const afterHash = hashText(next);
    const operation = createOperation(intent, beforeHash, afterHash);
    const existing = readOperation(vaultPath, operation.id);
    if (existing) {
      assertExactOperation(existing, operation);
      persistReceipt(vaultPath, intent, intentHash, existing, true);
      return { status: "committed", pageId: intent.pageId, operation: existing, recovered: true };
    }
    stageExact(vaultPath, intent.beforePath, before, beforeHash);
    stageExact(vaultPath, intent.stagedPath, next, afterHash);
    const live = readCurrentTarget(vaultPath, intent);
    if (live.contentHash === beforeHash) {
      replaceGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, intent.pagePath), resolveVaultPath(vaultPath, intent.stagedPath), {
        beforeHash,
        afterHash,
        maximumBytes: MAX_PAGE_BYTES
      });
    } else if (live.contentHash !== afterHash) {
      throw turnConflict("The current note changed before its append could commit.");
    }
    const committed = commitOperation(vaultPath, operation);
    removeGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, intent.stagedPath), afterHash, MAX_PAGE_BYTES);
    persistReceipt(vaultPath, intent, intentHash, committed, recovered || live.contentHash === afterHash);
    return { status: "committed", pageId: intent.pageId, operation: committed, recovered: recovered || live.contentHash === afterHash };
  }

  #stageProposal(vaultPath: string, intent: AppendIntentRecord, intentHash: string, current: string, currentHash: string): AppendProposalRecord {
    const proposal: AppendProposalRecord = {
      schemaVersion: 1,
      kind: "current_note_append_proposal",
      proposalId: createProposalId(intent.jobId, intent.pageId),
      intentHash,
      activeVaultId: intent.activeVaultId,
      jobId: intent.jobId,
      pageId: intent.pageId,
      pagePath: intent.pagePath,
      reviewBaseHash: currentHash,
      createdAt: intent.createdAt,
      preview: createSafePreview(current, intent.markdown)
    };
    persistExactJson(vaultPath, proposalPath(proposal.proposalId), proposal);
    const durable = readProposal(vaultPath, proposal.proposalId);
    if (!durable || stableJson(durable) !== stableJson(proposal)) throw turnConflict("The current-note append proposal identity is occupied by another review.");
    return durable;
  }

  #preview(vaultPath: string, proposal: AppendProposalRecord, intent: AppendIntentRecord, knownOutcome?: ProposalOutcomeRecord): CurrentNoteAppendProposalPreview {
    const outcome = knownOutcome ?? readOutcome(vaultPath, proposal.proposalId);
    const decision = readDecision(vaultPath, proposal.proposalId);
    return {
      proposalId: proposal.proposalId,
      kind: "append_current_note",
      state: outcome?.outcome ?? (decision?.decision === "approve" ? "resolving" : "ready"),
      revision: outcome ? 3 : decision ? 2 : 1,
      activeVaultId: intent.activeVaultId,
      pageId: intent.pageId,
      jobId: intent.jobId,
      lines: proposal.preview
    };
  }

  #decisionResult(vaultPath: string, proposal: AppendProposalRecord, intent: AppendIntentRecord, outcome: ProposalOutcomeRecord): CurrentNoteAppendProposalDecisionResult {
    const preview = this.#preview(vaultPath, proposal, intent, outcome);
    if (outcome.outcome === "applied") {
      const operation = readOperation(vaultPath, intent.operationId);
      if (!operation || outcome.operationId !== operation.id) throw turnConflict("The applied append proposal is missing its exact Operation.");
      assertOperationMatchesIntent(operation, intent);
      return { status: "applied", proposal: preview, operation };
    }
    return { status: outcome.outcome, proposal: preview };
  }
}

function assertAppendJob(request: CurrentNoteAppendRequest): JobRecord {
  const job = JobRecordSchema.parse(request.job);
  const scopeRefs = (job.inputRefs ?? []).filter((ref) => ref.role === "agent_turn_current_note_scope");
  const scope = scopeRefs[0];
  if (
    job.class !== "agent_turn" ||
    job.activeVaultId !== request.activeVaultId ||
    !job.policyContextId ||
    !job.policyHash ||
    scopeRefs.length !== 1 ||
    scope?.kind !== "page" ||
    scope.id !== request.inspection.pageId ||
    scope.checksum !== request.inspection.bindingHash ||
    request.inspection.evidenceRefs.length !== 1 ||
    request.inspection.evidenceRefs[0] !== "citation_1"
  ) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The current-note append is not bound to one successful current-note inspection.");
  }
  return job;
}

function createIntent(request: CurrentNoteAppendRequest, job: JobRecord): AppendIntentRecord {
  assertAppendMarkdown(request.markdown);
  if (!PageIdSchema.safeParse(request.inspection.pageId).success || !isContentHash(request.inspection.contentHash) || !isContentHash(request.inspection.bindingHash)) {
    throw new PigeDomainError("agent_runtime.tool_input_invalid", "The current-note append inspection identity is invalid.");
  }
  if (!/^model_[a-z0-9_]+$/u.test(request.modelProfileId)) throw new PigeDomainError("agent_runtime.tool_input_invalid", "The current-note append model identity is invalid.");
  const target = readCurrentNotePageForMutation(request.vaultPath, request.inspection.pageId);
  const pagePath = target.item.summary.pagePath;
  const operationId = createAgentPageUpdateOperationId(job.id, request.inspection.pageId);
  const artifactId = createArtifactId(job.id, request.inspection.pageId);
  const artifactChecksum = hashJson({
    kind: "current_note_append_evidence",
    jobId: job.id,
    pageId: request.inspection.pageId,
    pagePath,
    beforeHash: request.inspection.contentHash,
    bindingHash: request.inspection.bindingHash,
    evidenceRefs: request.inspection.evidenceRefs
  });
  return {
    schemaVersion: 1,
    kind: "current_note_append_intent",
    activeVaultId: request.activeVaultId,
    jobId: job.id,
    createdAt: job.createdAt,
    pageId: request.inspection.pageId,
    pagePath,
    beforeHash: request.inspection.contentHash,
    inspectionBindingHash: request.inspection.bindingHash,
    evidenceRefs: ["citation_1"],
    markdown: request.markdown,
    markdownHash: hashText(request.markdown),
    modelProfileId: request.modelProfileId,
    policyContextId: job.policyContextId!,
    policyHash: job.policyHash!,
    operationId,
    beforePath: createAgentPageUpdateBeforePath(operationId),
    stagedPath: createAgentPageUpdateStagedPath(operationId),
    operationPath: operationPath(operationId),
    artifactId,
    artifactChecksum
  };
}

function readCurrentTarget(vaultPath: string, intent: Pick<AppendIntentRecord, "pageId" | "pagePath">): { readonly markdown: string; readonly contentHash: string } {
  const target = readCurrentNotePageForMutation(vaultPath, intent.pageId);
  if (target.item.summary.pagePath !== intent.pagePath || target.page.contentHash !== hashText(target.markdown)) {
    throw turnConflict("The current-note append target path or durable bytes changed identity.");
  }
  return { markdown: target.markdown, contentHash: target.page.contentHash };
}

function createAppendedMarkdown(before: string, intent: AppendIntentRecord): string {
  if (hashText(intent.markdown) !== intent.markdownHash) throw turnConflict("The current-note append text no longer matches its immutable intent.");
  const parsed = parsePigeFrontmatter(before);
  if (!parsed || parsed.frontmatter.id !== intent.pageId || parsed.frontmatter.type !== "note") throw turnConflict("The current-note append target is not the exact supported note page.");
  const updatedAt = monotonicTimestamp(String(parsed.frontmatter.updated_at), intent.createdAt);
  let raw = replaceUniqueLine(parsed.raw, "updated_at", JSON.stringify(updatedAt));
  raw = replaceUniqueNestedLine(raw, "provenance", "last_job_id", JSON.stringify(intent.jobId));
  raw = replaceUniqueNestedLine(raw, "provenance", "model_profile_id", JSON.stringify(intent.modelProfileId));
  const frontmatterStart = before.indexOf("\n") + 1;
  const frontmatterEnd = frontmatterStart + parsed.raw.length;
  const withMetadata = `${before.slice(0, frontmatterStart)}${raw}${before.slice(frontmatterEnd)}`;
  const separator = withMetadata.endsWith("\n") ? "\n" : "\n\n";
  const block = [
    `<!-- pige:managed:start agent-note-append ${intent.operationId} -->`,
    intent.markdown.trim(),
    "",
    "Evidence: [citation_1]",
    "<!-- pige:managed:end -->",
    ""
  ].join("\n");
  const result = `${withMetadata}${separator}${block}`;
  if (Buffer.byteLength(result, "utf8") > MAX_PAGE_BYTES || containsRestrictedModelContent(result)) throw new PigeDomainError("agent_runtime.tool_input_invalid", "The current-note append would create an unsafe or oversized note.");
  return result;
}

function createOperation(intent: AppendIntentRecord, beforeHash: string, afterHash: string): OperationRecord {
  return OperationRecordSchema.parse({
    id: intent.operationId,
    schemaVersion: 1,
    jobId: intent.jobId,
    createdAt: intent.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: intent.modelProfileId,
    policyAudit: {
      policyContextId: intent.policyContextId,
      policyHash: intent.policyHash,
      enforcementOwners: ["Home Agent Service", "Current Note Append Service"]
    },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: intent.pageId, path: intent.pagePath }],
    sourceRefs: [
      { kind: "job", id: intent.jobId },
      { kind: "artifact", id: intent.artifactId, checksum: intent.artifactChecksum }
    ],
    before: { kind: "page", id: beforeHash, path: intent.beforePath },
    after: { kind: "page", id: afterHash, path: intent.pagePath },
    summary: `Appended one evidence-bound managed block to current note ${intent.pageId}.`,
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image only while the live page matches this Operation's after hash.",
    warnings: []
  });
}

function assertOperationMatchesIntent(operation: OperationRecord, intent: AppendIntentRecord): void {
  if (
    operation.id !== intent.operationId ||
    operation.jobId !== intent.jobId ||
    operation.modelProfileId !== intent.modelProfileId ||
    operation.policyAudit?.policyContextId !== intent.policyContextId ||
    operation.policyAudit.policyHash !== intent.policyHash ||
    operation.targetRefs[0]?.id !== intent.pageId ||
    operation.targetRefs[0]?.path !== intent.pagePath ||
    operation.sourceRefs.length !== 2 ||
    !operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === intent.jobId) ||
    !operation.sourceRefs.some((ref) => ref.kind === "artifact" && ref.id === intent.artifactId && ref.checksum === intent.artifactChecksum)
  ) throw turnConflict("The current-note append Operation does not match its immutable intent.");
}

function assertExactOperation(actual: OperationRecord, expected: OperationRecord): void {
  if (stableJson(actual) !== stableJson(expected)) throw turnConflict("The current-note append Operation identity is occupied by different facts.");
}

function assertAppendMarkdown(value: string): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    bytes < 1 ||
    bytes > MAX_APPEND_TEXT_BYTES ||
    value.trim().length === 0 ||
    /[\u0000\u000b\u000c\u007f]/u.test(value) ||
    /<!--\s*pige:managed:/iu.test(value) ||
    /\[(?:citation_(?!1\])[a-z0-9_]+|source:[^\]]+)\]/iu.test(value) ||
    containsRestrictedModelContent(value)
  ) throw new PigeDomainError("agent_runtime.tool_input_invalid", "The current-note append text is unsafe, restricted, or outside its bound.");
}

function createSafePreview(current: string, added: string): CurrentNoteAppendProposalPreview["lines"] {
  const context = current.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? "Current note";
  return [
    { kind: "context", text: truncateSafe(context, 160) },
    { kind: "added", text: truncateSafe(added.replace(/\s+/gu, " ").trim(), 160) }
  ];
}

function truncateSafe(value: string, maximum: number): string {
  const safe = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return Array.from(safe).slice(0, maximum).join("") || "(empty)";
}

function persistReceipt(vaultPath: string, intent: AppendIntentRecord, intentHash: string, operation: OperationRecord, recovered: boolean): void {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding) throw turnConflict("The current-note append receipt cannot bind an invalid Operation.");
  const receipt: AppendReceiptRecord = {
    schemaVersion: 1,
    kind: "current_note_append_receipt",
    intentHash,
    operationId: operation.id,
    afterHash: binding.afterHash,
    committedAt: recovered ? operation.createdAt : new Date().toISOString()
  };
  persistExactJson(vaultPath, receiptPath(operation.id), receipt, receiptIdentity);
}

function commitOperation(vaultPath: string, operation: OperationRecord): OperationRecord {
  persistExactJson(vaultPath, operationPath(operation.id), operation);
  const committed = readOperation(vaultPath, operation.id);
  if (!committed) throw turnConflict("The current-note append Operation could not be adopted.");
  assertExactOperation(committed, operation);
  return committed;
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const value = readJson(vaultPath, operationPath(operationId));
  return value === undefined ? undefined : OperationRecordSchema.parse(value);
}

function stageExact(vaultPath: string, relativePath: string, value: string, expectedHash: string): void {
  if (hashText(value) !== expectedHash) throw turnConflict("The current-note append staging checksum is invalid.");
  const absolutePath = resolveVaultPath(vaultPath, relativePath);
  const result = createGeneratedNoteExclusive(vaultPath, absolutePath, value);
  if (result === "exists") {
    const existing = readGeneratedNoteExact(vaultPath, absolutePath, MAX_PAGE_BYTES);
    if (existing === undefined || hashText(existing) !== expectedHash) throw turnConflict("The current-note append staging identity is occupied by different bytes.");
  }
}

function persistExactJson(
  vaultPath: string,
  relativePath: string,
  value: unknown,
  identity: (value: unknown) => string = stableJson
): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const absolutePath = resolveVaultPath(vaultPath, relativePath);
  const result = createGeneratedNoteExclusive(vaultPath, absolutePath, content);
  if (result === "exists") {
    const existing = readGeneratedNoteExact(vaultPath, absolutePath, MAX_RECORD_BYTES);
    if (existing === undefined) throw turnConflict("A durable current-note append record became unavailable.");
    let parsed: unknown;
    try { parsed = JSON.parse(existing); } catch { throw turnConflict("A durable current-note append record is invalid."); }
    if (identity(parsed) !== identity(value)) throw turnConflict("A durable current-note append record identity is occupied by different facts.");
  }
}

function readJson(vaultPath: string, relativePath: string): unknown | undefined {
  const content = readGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, relativePath), MAX_RECORD_BYTES);
  if (content === undefined) return undefined;
  try { return JSON.parse(content); } catch { throw turnConflict("A durable current-note append record is invalid."); }
}

function readRequiredIntent(vaultPath: string, operationId: string): AppendIntentRecord {
  const value = readJson(vaultPath, intentPath(operationId));
  if (!isIntent(value)) throw turnConflict("The durable current-note append intent is unavailable or invalid.");
  return value;
}

function readJobBinding(vaultPath: string, jobId: string): {
  readonly jobId: string;
  readonly pageId: string;
  readonly operationId: string;
} | undefined {
  const value = readJson(vaultPath, jobBindingPath(jobId));
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "current_note_append_job_binding" ||
    typeof value.jobId !== "string" ||
    typeof value.pageId !== "string" ||
    typeof value.operationId !== "string"
  ) {
    throw turnConflict("The durable current-note append Job binding is invalid.");
  }
  return { jobId: value.jobId, pageId: value.pageId, operationId: value.operationId };
}

function readProposal(vaultPath: string, proposalId: string): AppendProposalRecord | undefined {
  const value = readJson(vaultPath, proposalPath(proposalId));
  if (value === undefined) return undefined;
  if (!isProposal(value)) throw turnConflict("The durable current-note append proposal is invalid.");
  return value;
}

function readDecision(vaultPath: string, proposalId: string): ProposalDecisionRecord | undefined {
  const value = readJson(vaultPath, decisionPath(proposalId));
  if (value === undefined) return undefined;
  if (!isDecision(value)) throw turnConflict("The durable current-note append decision is invalid.");
  return value;
}

function readRequiredDecision(vaultPath: string, proposalId: string): ProposalDecisionRecord {
  const decision = readDecision(vaultPath, proposalId);
  if (!decision) throw turnConflict("The durable current-note append decision is unavailable.");
  return decision;
}

function readOutcome(vaultPath: string, proposalId: string): ProposalOutcomeRecord | undefined {
  const value = readJson(vaultPath, outcomePath(proposalId));
  if (value === undefined) return undefined;
  if (!isOutcome(value)) throw turnConflict("The durable current-note append outcome is invalid.");
  return value;
}

function commitOutcome(vaultPath: string, proposal: AppendProposalRecord, intentHash: string, outcome: ProposalOutcomeRecord["outcome"], operationId?: string): ProposalOutcomeRecord {
  const record: ProposalOutcomeRecord = {
    schemaVersion: 1,
    kind: "current_note_append_outcome",
    proposalId: proposal.proposalId,
    intentHash,
    outcome,
    ...(operationId ? { operationId } : {}),
    completedAt: new Date().toISOString()
  };
  persistExactJson(vaultPath, outcomePath(proposal.proposalId), record, proposalOutcomeIdentity);
  const durable = readOutcome(vaultPath, proposal.proposalId);
  if (!durable) throw turnConflict("The current-note append outcome could not be adopted.");
  return durable;
}

function isIntent(value: unknown): value is AppendIntentRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1 && value.kind === "current_note_append_intent" && typeof value.activeVaultId === "string" && typeof value.jobId === "string" && typeof value.createdAt === "string" && typeof value.pageId === "string" && typeof value.pagePath === "string" && typeof value.beforeHash === "string" && typeof value.inspectionBindingHash === "string" && Array.isArray(value.evidenceRefs) && value.evidenceRefs.length === 1 && value.evidenceRefs[0] === "citation_1" && typeof value.markdown === "string" && typeof value.markdownHash === "string" && typeof value.modelProfileId === "string" && typeof value.policyContextId === "string" && typeof value.policyHash === "string" && typeof value.operationId === "string" && typeof value.beforePath === "string" && typeof value.stagedPath === "string" && typeof value.operationPath === "string" && typeof value.artifactId === "string" && typeof value.artifactChecksum === "string";
}

function isProposal(value: unknown): value is AppendProposalRecord {
  return isRecord(value) && value.schemaVersion === 1 && value.kind === "current_note_append_proposal" && typeof value.proposalId === "string" && typeof value.intentHash === "string" && typeof value.activeVaultId === "string" && typeof value.jobId === "string" && typeof value.pageId === "string" && typeof value.pagePath === "string" && typeof value.reviewBaseHash === "string" && typeof value.createdAt === "string" && Array.isArray(value.preview);
}

function isDecision(value: unknown): value is ProposalDecisionRecord {
  return isRecord(value) && value.schemaVersion === 1 && value.kind === "current_note_append_decision" && typeof value.proposalId === "string" && typeof value.intentHash === "string" && (value.decision === "approve" || value.decision === "reject") && typeof value.decidedAt === "string";
}

function isOutcome(value: unknown): value is ProposalOutcomeRecord {
  return isRecord(value) && value.schemaVersion === 1 && value.kind === "current_note_append_outcome" && typeof value.proposalId === "string" && typeof value.intentHash === "string" && ["applied", "rejected", "conflicted"].includes(String(value.outcome)) && typeof value.completedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proposalDecisionIdentity(value: unknown): string {
  const record = value as Partial<ProposalDecisionRecord>;
  return stableJson({ schemaVersion: record.schemaVersion, kind: record.kind, proposalId: record.proposalId, intentHash: record.intentHash, decision: record.decision });
}

function proposalOutcomeIdentity(value: unknown): string {
  const record = value as Partial<ProposalOutcomeRecord>;
  return stableJson({ schemaVersion: record.schemaVersion, kind: record.kind, proposalId: record.proposalId, intentHash: record.intentHash, outcome: record.outcome, operationId: record.operationId });
}

function receiptIdentity(value: unknown): string {
  const record = value as Partial<AppendReceiptRecord>;
  return stableJson({ schemaVersion: record.schemaVersion, kind: record.kind, intentHash: record.intentHash, operationId: record.operationId, afterHash: record.afterHash });
}

function replaceUniqueLine(raw: string, key: string, next: string): string {
  const lines = raw.split("\n");
  const matches = lines.flatMap((line, index) => line.startsWith(`${key}:`) ? [index] : []);
  if (matches.length !== 1) throw turnConflict(`The current note has an ambiguous ${key} field.`);
  lines[matches[0]!] = `${key}: ${next}`;
  return lines.join("\n");
}

function replaceUniqueNestedLine(raw: string, parent: string, key: string, next: string): string {
  const lines = raw.split("\n");
  const parents = lines.flatMap((line, index) => line === `${parent}:` ? [index] : []);
  if (parents.length !== 1) throw turnConflict(`The current note has an ambiguous ${parent} block.`);
  let end = lines.length;
  for (let index = parents[0]! + 1; index < lines.length; index += 1) if (lines[index] && !/^\s/u.test(lines[index]!)) { end = index; break; }
  const matches: number[] = [];
  for (let index = parents[0]! + 1; index < end; index += 1) if (lines[index]?.startsWith(`  ${key}:`)) matches.push(index);
  if (matches.length !== 1) throw turnConflict(`The current note has an ambiguous ${parent}.${key} field.`);
  lines[matches[0]!] = `  ${key}: ${next}`;
  return lines.join("\n");
}

function monotonicTimestamp(current: string, requested: string): string {
  const currentTime = Date.parse(current);
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(currentTime) || !Number.isFinite(requestedTime)) throw turnConflict("The current-note append timestamp binding is invalid.");
  return new Date(Math.max(requestedTime, currentTime + 1)).toISOString();
}

function createArtifactId(jobId: string, pageId: string): string {
  return `art_current_note_append_${digest(`artifact\0${jobId}\0${pageId}`).slice(0, 16)}`;
}

function createProposalId(jobId: string, pageId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  return `proposal_${dateKey}_${digest(`proposal\0${jobId}\0${pageId}`).slice(0, 16)}`;
}

function privateRoot(operationId: string): string {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  return [".pige", "agent", "current-note-appends", dateKey.slice(0, 4), dateKey.slice(4, 6)].join("/");
}

function intentPath(operationId: string): string { return `${privateRoot(operationId)}/${operationId}.intent.json`; }
function receiptPath(operationId: string): string { return `${privateRoot(operationId)}/${operationId}.receipt.json`; }
function jobBindingPath(jobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  return `.pige/agent/current-note-appends/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${jobId}.binding.json`;
}
function proposalPath(proposalId: string): string { return `.pige/agent/current-note-append-proposals/${proposalId}.json`; }
function decisionPath(proposalId: string): string { return `.pige/agent/current-note-append-proposals/${proposalId}.decision.json`; }
function outcomePath(proposalId: string): string { return `.pige/agent/current-note-append-proposals/${proposalId}.outcome.json`; }
function operationPath(operationId: string): string {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  return `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.json`;
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw turnConflict("The current-note append path is invalid.");
  const root = path.resolve(vaultPath);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw turnConflict("The active vault is not a safe current-note append root.");
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw turnConflict("The current-note append path escapes the active vault.");
  return resolved;
}

function isContentHash(value: string): boolean { return /^sha256:[a-f0-9]{64}$/u.test(value); }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function hashText(value: string): string { return `sha256:${digest(value)}`; }
function hashJson(value: unknown): string { return hashText(stableJson(value)); }
function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}

function turnConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_conflict", message);
}

export const CURRENT_NOTE_APPEND_TOOL = Object.freeze({ id: APPEND_TOOL_ID, version: APPEND_TOOL_VERSION });
