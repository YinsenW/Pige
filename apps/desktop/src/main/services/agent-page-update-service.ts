import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RetrievalSearchResultItem } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  JobRecordSchema,
  MarkdownPageStatusSchema,
  OperationRecordSchema,
  PageIdSchema,
  SourceIdSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import {
  createGeneratedNoteExclusive,
  ensureGeneratedNoteParentSafe,
  readGeneratedNoteExact,
  removeGeneratedNoteExact,
  replaceGeneratedNoteExact
} from "./generated-note-file";
import { containsRestrictedModelContent } from "./model-egress-content";
import type { CurrentRetrievalPageMutationBinding } from "./retrieval-evidence-boundary";

export const AGENT_PAGE_UPDATE_CHECKPOINT_ID = "agent_existing_note_update_started";
export const MAX_AGENT_PAGE_UPDATE_BYTES = 1024 * 1024;
const ELIGIBLE_AGENT_PAGE_UPDATE_STATUSES = new Set(["active", "needs_review"]);

export interface AgentPageUpdateClaim {
  readonly text: string;
  readonly citations: readonly string[];
}

export interface AgentPageUpdatePublicationBinding {
  readonly mutationKind: "update_page";
  readonly sourceId: string;
  readonly sourceRevisionHash: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeContentHash: string;
  readonly contentHash: string;
  readonly beforePath: string;
  readonly stagedPath: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly operationId: string;
  readonly operationPath: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly catalogHash: string;
  readonly canonicalInputHash: string;
  readonly toolCallProvenanceHash: string;
  readonly modelProfileId: string;
  readonly artifactIds: readonly string[];
}

export interface AgentPageUpdateCommitResult {
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly operation: OperationRecord;
  readonly recovered: boolean;
}

export interface AgentPageUpdateOperationBinding {
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeHash: string;
  readonly beforePath: string;
  readonly afterHash: string;
}

export function applyAgentPageUpdate(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly target: CurrentRetrievalPageMutationBinding;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly catalogHash: string;
  readonly canonicalInputHash: string;
  readonly toolCallProvenanceHash: string;
  readonly artifactIds: readonly string[];
  readonly summary: AgentPageUpdateClaim;
  readonly keyPoints: readonly AgentPageUpdateClaim[];
  readonly confidence: "low" | "medium" | "high";
  readonly onPublicationStart?: (binding: AgentPageUpdatePublicationBinding) => void;
  readonly throwIfCancellationRequested?: () => void;
  readonly assertSourceCurrent?: () => void;
}): AgentPageUpdateCommitResult {
  const job = JobRecordSchema.parse(input.job);
  const sourceRecord = SourceRecordSchema.parse(input.sourceRecord);
  const target = assertEligibleTarget(input.vaultPath, input.target);
  const operationId = createAgentPageUpdateOperationId(job.id, target.pageId);
  const beforePath = createAgentPageUpdateBeforePath(operationId);
  const stagedPath = createAgentPageUpdateStagedPath(operationId);
  const operationPath = createOperationPath(operationId);
  const updatedAt = createMonotonicUpdatedAt(target.updatedAt, job.createdAt);
  const updateBlock = renderUpdateBlock({
    operationId,
    sourceId: sourceRecord.id,
    summary: input.summary,
    keyPoints: input.keyPoints
  });
  if (containsRestrictedModelContent(updateBlock)) {
    throw new PigeDomainError(
      "agent_ingest.update_content_restricted",
      "The existing-note update contains restricted content."
    );
  }
  const nextMarkdown = createUpdatedMarkdown({
    markdown: target.markdown,
    sourceId: sourceRecord.id,
    jobId: job.id,
    modelProfileId: input.modelProfileId,
    confidence: input.confidence,
    updatedAt,
    updateBlock
  });
  assertValidAgentManagedNote(nextMarkdown, target.pageId, target.pagePath, operationId);
  assertAgentPageUpdateTransition(target.markdown, nextMarkdown, {
    operationId,
    sourceId: sourceRecord.id,
    jobId: job.id,
    modelProfileId: input.modelProfileId
  });
  if (Buffer.byteLength(nextMarkdown, "utf8") > MAX_AGENT_PAGE_UPDATE_BYTES) {
    throw new PigeDomainError("agent_ingest.update_too_large", "The existing-note update exceeds the bounded page limit.");
  }
  const afterHash = hashText(nextMarkdown);
  const binding: AgentPageUpdatePublicationBinding = {
    mutationKind: "update_page",
    sourceId: sourceRecord.id,
    sourceRevisionHash: hashJson(sourceRecord),
    pageId: target.pageId,
    pagePath: target.pagePath,
    beforeContentHash: target.contentHash,
    contentHash: afterHash,
    beforePath,
    stagedPath,
    policyContextId: input.policyContextId,
    policyHash: input.policyHash,
    operationId,
    operationPath,
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    catalogHash: input.catalogHash,
    canonicalInputHash: input.canonicalInputHash,
    toolCallProvenanceHash: input.toolCallProvenanceHash,
    modelProfileId: input.modelProfileId,
    artifactIds: normalizeArtifactIds(input.artifactIds)
  };
  const expectedOperation = createUpdateOperation({
    binding,
    job,
    sourceRecord,
    createdAt: job.createdAt
  });
  preflightUpdateOperation(input.vaultPath, expectedOperation);

  stageExact(input.vaultPath, binding.stagedPath, nextMarkdown, binding.contentHash);
  try {
    input.throwIfCancellationRequested?.();
    input.assertSourceCurrent?.();
  } catch (caught) {
    removeGeneratedNoteExact(
      input.vaultPath,
      resolveVaultPath(input.vaultPath, binding.stagedPath),
      binding.contentHash,
      MAX_AGENT_PAGE_UPDATE_BYTES
    );
    throw caught;
  }
  input.onPublicationStart?.(binding);
  input.throwIfCancellationRequested?.();
  input.assertSourceCurrent?.();
  preserveBeforeBytes(input.vaultPath, binding, target.markdown);
  input.throwIfCancellationRequested?.();
  input.assertSourceCurrent?.();
  const liveBefore = requireExact(input.vaultPath, binding.pagePath, binding.beforeContentHash);
  if (liveBefore !== target.markdown) {
    throw pageConflict("The existing-note bytes changed after their retrieval binding was approved.");
  }
  replaceGeneratedNoteExact(
    input.vaultPath,
    resolveVaultPath(input.vaultPath, binding.pagePath),
    resolveVaultPath(input.vaultPath, binding.stagedPath),
    {
      beforeHash: binding.beforeContentHash,
      afterHash: binding.contentHash,
      maximumBytes: MAX_AGENT_PAGE_UPDATE_BYTES
    }
  );
  input.assertSourceCurrent?.();
  const operation = commitUpdateOperation(input.vaultPath, expectedOperation);
  removeGeneratedNoteExact(
    input.vaultPath,
    resolveVaultPath(input.vaultPath, binding.stagedPath),
    binding.contentHash,
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
  return {
    pageId: binding.pageId,
    pagePath: binding.pagePath,
    title: target.title,
    operation,
    recovered: false
  };
}

export function recoverAgentPageUpdate(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly assertSourceCurrent?: () => void;
}): AgentPageUpdateCommitResult | undefined {
  const job = JobRecordSchema.parse(input.job);
  const sourceRecord = SourceRecordSchema.parse(input.sourceRecord);
  const binding = readUpdateBinding(job);
  if (!binding) return undefined;
  if (
    binding.sourceId !== sourceRecord.id ||
    binding.sourceRevisionHash !== hashJson(sourceRecord) ||
    job.policyContextId !== binding.policyContextId ||
    job.policyHash !== binding.policyHash ||
    binding.operationId !== createAgentPageUpdateOperationId(job.id, binding.pageId) ||
    binding.operationPath !== createOperationPath(binding.operationId) ||
    binding.beforePath !== createAgentPageUpdateBeforePath(binding.operationId) ||
    binding.stagedPath !== createAgentPageUpdateStagedPath(binding.operationId)
  ) {
    throw pageConflict("The interrupted existing-note update no longer matches its durable Job binding.");
  }
  const expectedOperation = createUpdateOperation({
    binding,
    job,
    sourceRecord,
    createdAt: job.createdAt
  });
  preflightUpdateOperation(input.vaultPath, expectedOperation);
  input.assertSourceCurrent?.();
  const live = requireExisting(input.vaultPath, binding.pagePath);
  const liveHash = hashText(live);
  if (liveHash === binding.beforeContentHash) {
    assertValidAgentManagedNote(live, binding.pageId, binding.pagePath);
    const staged = requireExact(input.vaultPath, binding.stagedPath, binding.contentHash);
    assertValidAgentManagedNote(staged, binding.pageId, binding.pagePath, binding.operationId);
    assertAgentPageUpdateTransition(live, staged, {
      operationId: binding.operationId,
      sourceId: binding.sourceId,
      jobId: job.id,
      modelProfileId: binding.modelProfileId
    });
    preserveBeforeBytes(input.vaultPath, binding, live);
    assertValidAgentManagedNote(
      requireExact(input.vaultPath, binding.beforePath, binding.beforeContentHash),
      binding.pageId,
      binding.pagePath
    );
    replaceGeneratedNoteExact(
      input.vaultPath,
      resolveVaultPath(input.vaultPath, binding.pagePath),
      resolveVaultPath(input.vaultPath, binding.stagedPath),
      {
        beforeHash: binding.beforeContentHash,
        afterHash: binding.contentHash,
        maximumBytes: MAX_AGENT_PAGE_UPDATE_BYTES
      }
    );
  } else if (liveHash === binding.contentHash) {
    const before = requireExact(input.vaultPath, binding.beforePath, binding.beforeContentHash);
    assertValidAgentManagedNote(before, binding.pageId, binding.pagePath);
    assertValidAgentManagedNote(live, binding.pageId, binding.pagePath, binding.operationId);
    assertAgentPageUpdateTransition(before, live, {
      operationId: binding.operationId,
      sourceId: binding.sourceId,
      jobId: job.id,
      modelProfileId: binding.modelProfileId
    });
  } else {
    throw pageConflict("The existing note changed while its interrupted update was awaiting recovery.");
  }
  input.assertSourceCurrent?.();
  const committed = requireExact(input.vaultPath, binding.pagePath, binding.contentHash);
  const parsed = parsePigeFrontmatter(committed);
  const title = parsed?.frontmatter.title?.replace(/\s+/gu, " ").trim();
  if (!title || parsed?.frontmatter.id !== binding.pageId || parsed.frontmatter.type !== "note") {
    throw pageConflict("The recovered existing note no longer matches its page identity.");
  }
  const operation = commitUpdateOperation(input.vaultPath, expectedOperation);
  removeGeneratedNoteExact(
    input.vaultPath,
    resolveVaultPath(input.vaultPath, binding.stagedPath),
    binding.contentHash,
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
  return {
    pageId: binding.pageId,
    pagePath: binding.pagePath,
    title,
    operation,
    recovered: true
  };
}

export function createAgentPageUpdateOperationId(jobId: string, pageId: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.agent-page-update.v1\0${jobId}\0${pageId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `op_${dateKey}_${suffix}`;
}

export function createAgentPageUpdateBeforePath(operationId: string): string {
  return createUpdatePrivatePath(operationId, "before.md");
}

export function createAgentPageUpdateStagedPath(operationId: string): string {
  return createUpdatePrivatePath(operationId, "after.pending.md");
}

export function readAgentPageUpdateOperationBinding(
  operation: OperationRecord
): AgentPageUpdateOperationBinding | undefined {
  const target = operation.targetRefs[0];
  const before = operation.before;
  const after = operation.after;
  if (
    operation.kind !== "update_page" ||
    operation.actor.kind !== "pige_agent" ||
    operation.reversible !== "yes" ||
    operation.targetRefs.length !== 1 ||
    target?.kind !== "page" ||
    !/^page_\d{8}_[a-z0-9]{8,}$/u.test(target.id) ||
    !target.path ||
    !/^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{8,}\.md$/u.test(target.path) ||
    path.posix.basename(target.path) !== `${target.id}.md` ||
    before?.kind !== "page" ||
    !isContentHash(before.id) ||
    before.path !== createAgentPageUpdateBeforePath(operation.id) ||
    after?.kind !== "page" ||
    !isContentHash(after.id) ||
    after.path !== target.path ||
    !operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === operation.jobId) ||
    !operation.sourceRefs.some((ref) => ref.kind === "source") ||
    operation.sourceRefs.some((ref) => ref.kind === "operation")
  ) {
    return undefined;
  }
  return {
    pageId: target.id,
    pagePath: target.path,
    beforeHash: before.id,
    beforePath: before.path,
    afterHash: after.id
  };
}

export function createAgentPageUpdateUndoOperationId(operationId: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.activity.undo.update-page.v1\0${operationId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `op_${dateKey}_${suffix}`;
}

export function isMatchingAgentPageUpdateUndo(
  operation: OperationRecord,
  candidate: OperationRecord
): boolean {
  const binding = readAgentPageUpdateOperationBinding(operation);
  const target = candidate.targetRefs[0];
  const undoOperationId = createAgentPageUpdateUndoOperationId(operation.id);
  return binding !== undefined &&
    candidate.id === undoOperationId &&
    candidate.kind === "update_page" &&
    candidate.jobId === operation.jobId &&
    candidate.actor.kind === "user" &&
    candidate.permissionDecisionIds.length === 0 &&
    candidate.reversible === "best_effort" &&
    candidate.targetRefs.length === 1 &&
    target?.kind === "page" &&
    target.id === binding.pageId &&
    target.path === binding.pagePath &&
    candidate.sourceRefs.length === 1 &&
    candidate.sourceRefs[0]?.kind === "operation" &&
    candidate.sourceRefs[0].id === operation.id &&
    candidate.before?.kind === "page" &&
    candidate.before.id === binding.afterHash &&
    candidate.before.path === createAgentPageUpdateBeforePath(undoOperationId) &&
    candidate.after?.kind === "page" &&
    candidate.after.id === binding.beforeHash &&
    candidate.after.path === binding.pagePath;
}

export function hasAgentPageUpdateUndoMarker(vaultPath: string, operation: OperationRecord): boolean {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding) return false;
  const undoId = createAgentPageUpdateUndoOperationId(operation.id);
  const markerPath = resolveVaultPath(vaultPath, createAgentPageUpdateBeforePath(undoId));
  try {
    fs.lstatSync(markerPath);
    return true;
  } catch (caught) {
    if (!(caught instanceof Error && "code" in caught && caught.code === "ENOENT")) throw caught;
    return false;
  }
}

export function finalizeAgentPageUpdateUndo(
  vaultPath: string,
  operation: OperationRecord,
  allowStart: boolean
): OperationRecord | undefined {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding) {
    throw new PigeDomainError("activity.operation_conflict", "The page-update Operation is not eligible for Undo.");
  }
  const undoOperationId = createAgentPageUpdateUndoOperationId(operation.id);
  const undoBeforePath = createAgentPageUpdateBeforePath(undoOperationId);
  const undoStagedPath = createAgentPageUpdateStagedPath(undoOperationId);
  const markerExists = hasAgentPageUpdateUndoMarker(vaultPath, operation);
  if (!allowStart && !markerExists) return undefined;
  const originalBefore = requireExact(vaultPath, binding.beforePath, binding.beforeHash);
  const live = requireExisting(vaultPath, binding.pagePath);
  const liveHash = hashText(live);
  if (liveHash === binding.afterHash) {
    stageExact(vaultPath, undoBeforePath, live, binding.afterHash);
    stageExact(vaultPath, undoStagedPath, originalBefore, binding.beforeHash);
    replaceGeneratedNoteExact(
      vaultPath,
      resolveVaultPath(vaultPath, binding.pagePath),
      resolveVaultPath(vaultPath, undoStagedPath),
      {
        beforeHash: binding.afterHash,
        afterHash: binding.beforeHash,
        maximumBytes: MAX_AGENT_PAGE_UPDATE_BYTES
      }
    );
  } else if (liveHash === binding.beforeHash) {
    requireExact(vaultPath, undoBeforePath, binding.afterHash);
  } else {
    throw new PigeDomainError(
      "activity.content_changed",
      "The updated page changed after its recorded Operation and cannot be undone automatically."
    );
  }
  const undoOperation = OperationRecordSchema.parse({
    id: undoOperationId,
    schemaVersion: 1,
    ...(operation.jobId ? { jobId: operation.jobId } : {}),
    createdAt: new Date().toISOString(),
    actor: {
      kind: "user",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    permissionDecisionIds: [],
    kind: "update_page",
    targetRefs: [{ kind: "page", id: binding.pageId, path: binding.pagePath }],
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: { kind: "page", id: binding.afterHash, path: undoBeforePath },
    after: { kind: "page", id: binding.beforeHash, path: binding.pagePath },
    summary: `Undid existing-note update ${operation.id} by restoring its exact preserved before-image.`,
    reversible: "best_effort",
    rollbackHint: "A future redo may restore the preserved post-update bytes after a fresh base-hash check.",
    warnings: []
  });
  const committed = commitUpdateOperation(vaultPath, undoOperation);
  removeGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, undoStagedPath),
    binding.beforeHash,
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
  return committed;
}

export function assertCompletedAgentPageUpdateUndo(
  vaultPath: string,
  operation: OperationRecord,
  undoOperation: OperationRecord
): void {
  const binding = readAgentPageUpdateOperationBinding(operation);
  if (!binding || !isMatchingAgentPageUpdateUndo(operation, undoOperation)) {
    throw new PigeDomainError("activity.operation_conflict", "The page-update Undo bindings are inconsistent.");
  }
  requireExact(vaultPath, binding.beforePath, binding.beforeHash);
  requireExact(
    vaultPath,
    createAgentPageUpdateBeforePath(createAgentPageUpdateUndoOperationId(operation.id)),
    binding.afterHash
  );
}

function assertValidAgentManagedNote(
  markdown: string,
  expectedPageId: string,
  expectedPagePath: string,
  expectedUpdateOperationId?: string
): void {
  if (
    Buffer.byteLength(markdown, "utf8") > MAX_AGENT_PAGE_UPDATE_BYTES ||
    markdown.includes("\0") ||
    !PageIdSchema.safeParse(expectedPageId).success ||
    expectedPagePath !== createGeneratedNotePath(expectedPageId) ||
    containsRestrictedModelContent(markdown)
  ) {
    throw pageConflict("The existing note fails its bounded Pige-managed page validation.");
  }
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed) throw pageConflict("The existing note has no supported frontmatter.");
  const id = readRequiredTopLevelScalar(parsed.raw, "id");
  const schemaVersion = readRequiredTopLevelScalar(parsed.raw, "schema_version");
  const title = readRequiredTopLevelScalar(parsed.raw, "title");
  const pageType = readRequiredTopLevelScalar(parsed.raw, "type");
  const createdAt = readRequiredTopLevelScalar(parsed.raw, "created_at");
  const updatedAt = readRequiredTopLevelScalar(parsed.raw, "updated_at");
  const status = readRequiredTopLevelScalar(parsed.raw, "status");
  const language = readRequiredTopLevelScalar(parsed.raw, "language");
  const sourceIds = readRequiredInlineStringArray(parsed.raw, "source_ids", 64);
  const relatedPageIds = readRequiredInlineStringArray(parsed.raw, "related_page_ids", 64);
  for (const field of ["aliases", "tags", "topics", "entities"] as const) {
    readRequiredInlineStringArray(parsed.raw, field, 64);
  }
  const generatedBy = readRequiredNestedScalar(parsed.raw, "provenance", "generated_by");
  const lastJobId = readRequiredNestedScalar(parsed.raw, "provenance", "last_job_id");
  const modelProfileId = readRequiredNestedScalar(parsed.raw, "provenance", "model_profile_id");
  const confidence = readRequiredNestedScalar(parsed.raw, "provenance", "confidence");
  const noteKind = readRequiredNestedScalar(parsed.raw, "note", "note_kind");
  const reviewState = readRequiredNestedScalar(parsed.raw, "note", "review_state");
  const parsedStatus = MarkdownPageStatusSchema.safeParse(status);
  if (
    id !== expectedPageId ||
    parsed.frontmatter.id !== expectedPageId ||
    schemaVersion !== "1" ||
    !title ||
    title.length > 240 ||
    parsed.frontmatter.title !== title ||
    pageType !== "note" ||
    parsed.frontmatter.type !== "note" ||
    !isIsoTimestamp(createdAt) ||
    !isIsoTimestamp(updatedAt) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    !parsedStatus.success ||
    !ELIGIBLE_AGENT_PAGE_UPDATE_STATUSES.has(parsedStatus.data) ||
    parsed.frontmatter.status !== parsedStatus.data ||
    parsed.frontmatter.updated_at !== updatedAt ||
    !isSupportedPageLanguage(language) ||
    sourceIds.some((sourceId) => !SourceIdSchema.safeParse(sourceId).success) ||
    relatedPageIds.some((pageId) => !PageIdSchema.safeParse(pageId).success) ||
    generatedBy !== "pige" ||
    !/^job_\d{8}_[a-z0-9]{8,}$/u.test(lastJobId) ||
    !/^model_[a-z0-9_]+$/u.test(modelProfileId) ||
    !["low", "medium", "high"].includes(confidence) ||
    noteKind !== "summary" ||
    !["clean", "needs_review"].includes(reviewState) ||
    markdown.slice(parsed.bodyStartOffset).trim().length === 0
  ) {
    throw pageConflict("The existing note does not satisfy the complete generated-note schema.");
  }
  assertBalancedManagedBlocks(markdown, expectedUpdateOperationId);
}

function assertAgentPageUpdateTransition(
  before: string,
  after: string,
  expected: {
    readonly operationId: string;
    readonly sourceId: string;
    readonly jobId: string;
    readonly modelProfileId: string;
  }
): void {
  const beforeParsed = parsePigeFrontmatter(before);
  const afterParsed = parsePigeFrontmatter(after);
  if (!beforeParsed || !afterParsed || !before.startsWith("---\n") || !after.startsWith("---\n")) {
    throw pageConflict("The existing-note update uses an unsupported Markdown transition.");
  }
  const updatedAt = readRequiredTopLevelScalar(afterParsed.raw, "updated_at");
  const sourceIds = readRequiredInlineStringArray(afterParsed.raw, "source_ids", 64);
  const lastJobId = readRequiredNestedScalar(afterParsed.raw, "provenance", "last_job_id");
  const modelProfileId = readRequiredNestedScalar(afterParsed.raw, "provenance", "model_profile_id");
  const confidence = readRequiredNestedScalar(afterParsed.raw, "provenance", "confidence");
  if (
    lastJobId !== expected.jobId ||
    modelProfileId !== expected.modelProfileId ||
    !sourceIds.includes(expected.sourceId)
  ) {
    throw pageConflict("The existing-note update changed its source, Job, or model binding.");
  }
  let expectedRaw = replaceUniqueFrontmatterLine(beforeParsed.raw, "updated_at", JSON.stringify(updatedAt));
  expectedRaw = replaceUniqueFrontmatterLine(expectedRaw, "source_ids", JSON.stringify(sourceIds));
  expectedRaw = replaceUniqueNestedFrontmatterLine(expectedRaw, "provenance", "last_job_id", JSON.stringify(lastJobId));
  expectedRaw = replaceUniqueNestedFrontmatterLine(
    expectedRaw,
    "provenance",
    "model_profile_id",
    JSON.stringify(modelProfileId)
  );
  expectedRaw = replaceUniqueNestedFrontmatterLine(
    expectedRaw,
    "provenance",
    "confidence",
    JSON.stringify(confidence)
  );
  const beforeRawStart = before.indexOf("\n") + 1;
  const beforeRawEnd = beforeRawStart + beforeParsed.raw.length;
  const withExpectedFrontmatter = `${before.slice(0, beforeRawStart)}${expectedRaw}${before.slice(beforeRawEnd)}`;
  const separator = withExpectedFrontmatter.endsWith("\n") ? "\n" : "\n\n";
  const prefix = `${withExpectedFrontmatter}${separator}`;
  const blockStart = `<!-- pige:managed:start agent-update ${expected.operationId} -->\n`;
  if (!after.startsWith(prefix)) {
    throw pageConflict("The existing-note update changed bytes outside its managed append boundary.");
  }
  const appended = after.slice(prefix.length);
  const citations = [...appended.matchAll(/\[source:(src_\d{8}_[a-z0-9]{8,})#[^\]\r\n]+\]/gu)];
  if (
    !appended.startsWith(blockStart) ||
    !appended.endsWith("<!-- pige:managed:end -->\n") ||
    !appended.includes(`- Preserved source: \`${expected.sourceId}\``) ||
    citations.length === 0 ||
    citations.some((match) => match[1] !== expected.sourceId)
  ) {
    throw pageConflict("The existing-note update managed block is not bound to its preserved source evidence.");
  }
}

function readRequiredTopLevelScalar(raw: string, key: string): string {
  const lines = raw.split("\n");
  const matches = lines.filter((line) => line.startsWith(`${key}:`));
  if (matches.length !== 1) throw pageConflict(`The existing note has an ambiguous ${key} field.`);
  if (lines.some((line) => /^\s+/u.test(line) && line.trimStart().startsWith(`${key}:`))) {
    throw pageConflict(`The existing note has a malformed reserved ${key} field.`);
  }
  return parseYamlScalar(matches[0]!.slice(key.length + 1).trim(), key);
}

function readRequiredNestedScalar(raw: string, parentKey: string, key: string): string {
  const lines = raw.split("\n");
  const parents = lines.flatMap((line, index) => line === `${parentKey}:` ? [index] : []);
  if (parents.length !== 1) throw pageConflict(`The existing note has an ambiguous ${parentKey} block.`);
  const parentIndex = parents[0]!;
  let end = lines.length;
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    if (lines[index] && !/^\s/u.test(lines[index]!)) {
      end = index;
      break;
    }
  }
  const matches = lines
    .slice(parentIndex + 1, end)
    .filter((line) => line.startsWith(`  ${key}:`));
  if (matches.length !== 1) throw pageConflict(`The existing note has an ambiguous ${parentKey}.${key} field.`);
  return parseYamlScalar(matches[0]!.slice(`  ${key}:`.length).trim(), `${parentKey}.${key}`);
}

function readRequiredInlineStringArray(raw: string, key: string, maximumItems: number): readonly string[] {
  const value = readUniqueTopLevelRawValue(raw, key);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw pageConflict(`The existing note has an invalid ${key} array.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > maximumItems ||
    parsed.some((item) => typeof item !== "string" || item.length > 240 || /[\u0000-\u001f\u007f]/u.test(item))
  ) {
    throw pageConflict(`The existing note has an invalid ${key} array.`);
  }
  return parsed;
}

function readUniqueTopLevelRawValue(raw: string, key: string): string {
  const lines = raw.split("\n");
  const matches = lines.filter((line) => line.startsWith(`${key}:`));
  if (matches.length !== 1) throw pageConflict(`The existing note has an ambiguous ${key} field.`);
  return matches[0]!.slice(key.length + 1).trim();
}

function parseYamlScalar(value: string, key: string): string {
  if (!value) throw pageConflict(`The existing note has an empty ${key} field.`);
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to the fail-closed error below.
    }
    throw pageConflict(`The existing note has an invalid ${key} field.`);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (/[:#[\]{},&*!|>@`"'\s]/u.test(value)) {
    throw pageConflict(`The existing note has an invalid ${key} field.`);
  }
  return value;
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}

function isSupportedPageLanguage(value: string): boolean {
  return value === "unknown" || /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value);
}

function assertBalancedManagedBlocks(markdown: string, expectedUpdateOperationId?: string): void {
  let depth = 0;
  let expectedMatches = 0;
  for (const line of markdown.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const isCurrentStart = /^<!-- pige:managed:start [^\r\n]+ -->$/u.test(trimmed);
    const isLegacyStart = /^<!-- pige:managed (?!end\b)[^\r\n]+ -->$/u.test(trimmed);
    const isCurrentEnd = trimmed === "<!-- pige:managed:end -->";
    const isLegacyEnd = trimmed === "<!-- /pige:managed -->";
    if (trimmed.includes("pige:managed:start") && !isCurrentStart) {
      throw pageConflict("The existing note has a malformed managed-block start marker.");
    }
    if (trimmed.includes("pige:managed:end") && !isCurrentEnd) {
      throw pageConflict("The existing note has a malformed managed-block end marker.");
    }
    if (isCurrentStart || isLegacyStart) {
      depth += 1;
      if (depth !== 1) throw pageConflict("The existing note has nested managed blocks.");
      if (expectedUpdateOperationId && trimmed === `<!-- pige:managed:start agent-update ${expectedUpdateOperationId} -->`) {
        expectedMatches += 1;
      }
    } else if (isCurrentEnd || isLegacyEnd) {
      depth -= 1;
      if (depth < 0) throw pageConflict("The existing note has an unmatched managed-block end marker.");
    }
  }
  if (depth !== 0 || (expectedUpdateOperationId !== undefined && expectedMatches !== 1)) {
    throw pageConflict("The existing note has an incomplete or ambiguous managed update block.");
  }
}

function assertEligibleTarget(
  vaultPath: string,
  target: CurrentRetrievalPageMutationBinding
): {
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly contentHash: string;
  readonly markdown: string;
} {
  const summary = target.item.summary;
  if (
    summary.pageType !== "note" ||
    !ELIGIBLE_AGENT_PAGE_UPDATE_STATUSES.has(summary.status) ||
    !/^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{8,}\.md$/u.test(summary.pagePath) ||
    target.page.pageId !== summary.pageId ||
    target.page.updatedAt !== summary.updatedAt ||
    target.page.contentHash !== hashText(target.markdown) ||
    Buffer.byteLength(target.markdown, "utf8") > MAX_AGENT_PAGE_UPDATE_BYTES ||
    path.resolve(target.absolutePath) !== resolveVaultPath(vaultPath, summary.pagePath)
  ) {
    throw new PigeDomainError(
      "agent_ingest.update_target_ineligible",
      "The selected related page is not an eligible Pige-managed note."
    );
  }
  const parsed = parsePigeFrontmatter(target.markdown);
  if (
    !parsed ||
    parsed.frontmatter.id !== summary.pageId ||
    parsed.frontmatter.type !== "note" ||
    parsed.frontmatter.updated_at !== summary.updatedAt ||
    !/^\s*generated_by:\s*["']?pige["']?\s*$/mu.test(parsed.raw)
  ) {
    throw new PigeDomainError(
      "agent_ingest.update_target_ineligible",
      "The selected related page lacks a current Pige-managed note binding."
    );
  }
  assertValidAgentManagedNote(target.markdown, summary.pageId, summary.pagePath);
  return {
    pageId: summary.pageId,
    pagePath: summary.pagePath,
    title: summary.title,
    updatedAt: summary.updatedAt,
    contentHash: target.page.contentHash,
    markdown: target.markdown
  };
}

function createUpdatedMarkdown(input: {
  readonly markdown: string;
  readonly sourceId: string;
  readonly jobId: string;
  readonly modelProfileId: string;
  readonly confidence: "low" | "medium" | "high";
  readonly updatedAt: string;
  readonly updateBlock: string;
}): string {
  const parsed = parsePigeFrontmatter(input.markdown);
  if (!parsed) throw pageConflict("The existing note has no supported frontmatter.");
  const firstLineEnd = input.markdown.indexOf("\n") + 1;
  if (firstLineEnd <= 0 || !input.markdown.startsWith("---\n")) {
    throw pageConflict("The existing note uses an unsupported frontmatter encoding.");
  }
  const sourceIds = parsed.frontmatter.source_ids;
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.some((sourceId) => !/^src_\d{8}_[a-z0-9]{8,}$/u.test(sourceId)) ||
    sourceIds.length > 63
  ) {
    throw pageConflict("The existing note source references are not eligible for bounded update.");
  }
  const nextSourceIds = Array.from(new Set([...sourceIds, input.sourceId]));
  let raw = replaceUniqueFrontmatterLine(parsed.raw, "updated_at", JSON.stringify(input.updatedAt));
  raw = replaceUniqueFrontmatterLine(raw, "source_ids", JSON.stringify(nextSourceIds));
  raw = replaceUniqueNestedFrontmatterLine(raw, "provenance", "last_job_id", JSON.stringify(input.jobId));
  raw = replaceUniqueNestedFrontmatterLine(raw, "provenance", "model_profile_id", JSON.stringify(input.modelProfileId));
  raw = replaceUniqueNestedFrontmatterLine(raw, "provenance", "confidence", JSON.stringify(input.confidence));
  const rawStart = firstLineEnd;
  const rawEnd = rawStart + parsed.raw.length;
  const withFrontmatter = `${input.markdown.slice(0, rawStart)}${raw}${input.markdown.slice(rawEnd)}`;
  const separator = withFrontmatter.endsWith("\n") ? "\n" : "\n\n";
  return `${withFrontmatter}${separator}${input.updateBlock}\n`;
}

function renderUpdateBlock(input: {
  readonly operationId: string;
  readonly sourceId: string;
  readonly summary: AgentPageUpdateClaim;
  readonly keyPoints: readonly AgentPageUpdateClaim[];
}): string {
  const renderClaim = (claim: AgentPageUpdateClaim) => {
    const citations = Array.from(new Set(claim.citations));
    return `${escapeManagedText(claim.text)}${citations.length > 0 ? ` ${citations.join(" ")}` : ""}`;
  };
  const points = input.keyPoints.map((claim) => `- ${renderClaim(claim)}`).join("\n");
  return `<!-- pige:managed:start agent-update ${input.operationId} -->
## Knowledge update

${renderClaim(input.summary)}

${points || "- No additional key points."}

- Preserved source: \`${input.sourceId}\`
<!-- pige:managed:end -->`;
}

function replaceUniqueFrontmatterLine(raw: string, key: string, value: string): string {
  const lines = raw.split("\n");
  const matches = lines.flatMap((line, index) => line.startsWith(`${key}:`) ? [index] : []);
  if (matches.length !== 1) throw pageConflict(`The existing note has an ambiguous ${key} field.`);
  lines[matches[0]!] = `${key}: ${value}`;
  return lines.join("\n");
}

function replaceUniqueNestedFrontmatterLine(
  raw: string,
  parentKey: string,
  key: string,
  value: string
): string {
  const lines = raw.split("\n");
  const parents = lines.flatMap((line, index) => line === `${parentKey}:` ? [index] : []);
  if (parents.length !== 1) throw pageConflict(`The existing note has an ambiguous ${parentKey} block.`);
  const parentIndex = parents[0]!;
  let end = lines.length;
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    if (lines[index] && !/^\s/u.test(lines[index]!)) {
      end = index;
      break;
    }
  }
  const matches: number[] = [];
  for (let index = parentIndex + 1; index < end; index += 1) {
    if (lines[index]?.startsWith(`  ${key}:`)) matches.push(index);
  }
  if (matches.length !== 1) throw pageConflict(`The existing note has an ambiguous ${parentKey}.${key} field.`);
  lines[matches[0]!] = `  ${key}: ${value}`;
  return lines.join("\n");
}

function stageExact(vaultPath: string, relativePath: string, content: string, expectedHash: string): void {
  const absolutePath = resolveVaultPath(vaultPath, relativePath);
  const result = createGeneratedNoteExclusive(vaultPath, absolutePath, content);
  if (result === "exists") requireExact(vaultPath, relativePath, expectedHash);
}

function preserveBeforeBytes(
  vaultPath: string,
  binding: AgentPageUpdatePublicationBinding,
  content: string
): void {
  stageExact(vaultPath, binding.beforePath, content, binding.beforeContentHash);
}

function requireExisting(vaultPath: string, relativePath: string): string {
  const content = readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, relativePath),
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
  if (content === undefined) throw pageConflict("The existing-note update target is unavailable.");
  return content;
}

function requireExact(vaultPath: string, relativePath: string, expectedHash: string): string {
  const content = requireExisting(vaultPath, relativePath);
  if (hashText(content) !== expectedHash) {
    throw pageConflict("A durable existing-note update file no longer matches its recorded checksum.");
  }
  return content;
}

function createUpdateOperation(input: {
  readonly binding: AgentPageUpdatePublicationBinding;
  readonly job: JobRecord;
  readonly sourceRecord: SourceRecord;
  readonly createdAt: string;
}): OperationRecord {
  return OperationRecordSchema.parse({
    id: input.binding.operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    createdAt: input.createdAt,
    actor: {
      kind: "pige_agent",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    modelProfileId: input.binding.modelProfileId,
    permissionDecisionIds: [],
    policyAudit: {
      policyContextId: input.binding.policyContextId,
      policyHash: input.binding.policyHash,
      enforcementOwners: ["Agent Orchestrator", "Knowledge Compiler", "Model Egress Policy"]
    },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: input.binding.pageId, path: input.binding.pagePath }],
    sourceRefs: [
      { kind: "job", id: input.job.id },
      { kind: "source", id: input.sourceRecord.id },
      ...input.binding.artifactIds.map((artifactId) => ({ kind: "artifact" as const, id: artifactId }))
    ],
    before: { kind: "page", id: input.binding.beforeContentHash, path: input.binding.beforePath },
    after: { kind: "page", id: input.binding.contentHash, path: input.binding.pagePath },
    summary: `Updated existing Pige-managed note ${input.binding.pageId} from preserved source ${input.sourceRecord.id}.`,
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image only while the live page matches this Operation's after hash.",
    warnings: []
  });
}

function commitUpdateOperation(vaultPath: string, operation: OperationRecord): OperationRecord {
  const operationPath = resolveVaultPath(vaultPath, createOperationPath(operation.id));
  const content = `${JSON.stringify(operation, null, 2)}\n`;
  const result = createGeneratedNoteExclusive(vaultPath, operationPath, content);
  if (result === "created") return operation;
  const existing = readGeneratedNoteExact(vaultPath, operationPath, 256 * 1024);
  if (!existing) throw pageConflict("The existing-note update Operation is unavailable.");
  let parsed: OperationRecord;
  try {
    parsed = OperationRecordSchema.parse(JSON.parse(existing));
  } catch {
    throw pageConflict("The existing-note update Operation is invalid.");
  }
  if (stableJson(parsed) !== stableJson(operation)) {
    throw pageConflict("The existing-note update Operation identity is occupied by different audit facts.");
  }
  return parsed;
}

function preflightUpdateOperation(vaultPath: string, operation: OperationRecord): void {
  const operationPath = resolveVaultPath(vaultPath, createOperationPath(operation.id));
  ensureGeneratedNoteParentSafe(vaultPath, operationPath);
  const existing = readGeneratedNoteExact(vaultPath, operationPath, 256 * 1024);
  if (existing === undefined) return;
  let parsed: OperationRecord;
  try {
    parsed = OperationRecordSchema.parse(JSON.parse(existing));
  } catch {
    throw pageConflict("The existing-note update Operation identity is occupied by an invalid record.");
  }
  if (stableJson(parsed) !== stableJson(operation)) {
    throw pageConflict("The existing-note update Operation identity is occupied by different audit facts.");
  }
}

function readUpdateBinding(job: JobRecord): AgentPageUpdatePublicationBinding | undefined {
  const matches = job.checkpoints?.filter((checkpoint) => checkpoint.id === AGENT_PAGE_UPDATE_CHECKPOINT_ID) ?? [];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw pageConflict("The existing-note update checkpoint is ambiguous.");
  const checkpoint = matches[0]!;
  const findInput = (role: string) => checkpoint.inputRefs.filter((ref) => ref.role === role);
  const findOutput = (role: string) => checkpoint.outputRefs.filter((ref) => ref.role === role);
  const source = findInput("publication_source_revision");
  const policy = findInput("publication_policy");
  const toolInput = findInput("update_tool_input");
  const catalog = findInput("agent_tool_catalog");
  const provenance = findInput("agent_tool_call_provenance");
  const target = findInput("update_target_base");
  const model = findInput("update_model_profile");
  const page = findOutput("expected_updated_note");
  const before = findOutput("preserved_update_before");
  const staged = findOutput("staged_update_after");
  const operation = findOutput("expected_update_operation");
  const artifactIds = findInput("update_evidence_artifact").map((ref) => ref.id).filter((id): id is string => !!id);
  if (
    checkpoint.step !== AGENT_PAGE_UPDATE_CHECKPOINT_ID ||
    !["running", "done"].includes(checkpoint.state) ||
    source.length !== 1 || policy.length !== 1 || toolInput.length !== 1 || catalog.length !== 1 ||
    provenance.length !== 1 || target.length !== 1 || model.length !== 1 || page.length !== 1 ||
    before.length !== 1 || staged.length !== 1 || operation.length !== 1 ||
    !source[0]?.id || !source[0].checksum || !policy[0]?.id || !policy[0].checksum ||
    !toolInput[0]?.id || !toolInput[0].checksum || !catalog[0]?.checksum || !provenance[0]?.checksum ||
    target[0]?.kind !== "page" || !target[0].id || !target[0].path || !target[0].checksum ||
    !model[0]?.id || page[0]?.kind !== "page" || page[0].id !== target[0].id ||
    page[0].path !== target[0].path || !page[0].checksum || before[0]?.kind !== "page" ||
    !before[0].path || before[0].checksum !== target[0].checksum || staged[0]?.kind !== "page" ||
    !staged[0].path || staged[0].checksum !== page[0].checksum || operation[0]?.kind !== "operation" ||
    !operation[0].id || !operation[0].path || checkpoint.checksumBefore !== target[0].checksum ||
    checkpoint.checksumAfter !== page[0].checksum
  ) {
    throw pageConflict("The existing-note update checkpoint is incomplete or invalid.");
  }
  const [toolId, toolVersion] = toolInput[0].id.split("@", 2);
  if (!toolId || !toolVersion) throw pageConflict("The existing-note update tool binding is invalid.");
  if (
    !PageIdSchema.safeParse(target[0].id).success ||
    target[0].path !== createGeneratedNotePath(target[0].id) ||
    operation[0].id !== createAgentPageUpdateOperationId(job.id, target[0].id) ||
    operation[0].path !== createOperationPath(operation[0].id) ||
    before[0].path !== createAgentPageUpdateBeforePath(operation[0].id) ||
    staged[0].path !== createAgentPageUpdateStagedPath(operation[0].id)
  ) {
    throw pageConflict("The existing-note update checkpoint paths do not match their deterministic identities.");
  }
  return {
    mutationKind: "update_page",
    sourceId: source[0].id,
    sourceRevisionHash: source[0].checksum,
    pageId: target[0].id,
    pagePath: target[0].path,
    beforeContentHash: target[0].checksum,
    contentHash: page[0].checksum,
    beforePath: before[0].path,
    stagedPath: staged[0].path,
    policyContextId: policy[0].id,
    policyHash: policy[0].checksum,
    operationId: operation[0].id,
    operationPath: operation[0].path,
    toolId,
    toolVersion,
    catalogHash: catalog[0].checksum,
    canonicalInputHash: toolInput[0].checksum,
    toolCallProvenanceHash: provenance[0].checksum,
    modelProfileId: model[0].id,
    artifactIds: normalizeArtifactIds(artifactIds)
  };
}

function createUpdatePrivatePath(operationId: string, fileName: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1] ?? "19700101";
  return [
    ".pige",
    "trash",
    "page-updates",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    operationId,
    fileName
  ].join("/");
}

function createGeneratedNotePath(pageId: string): string {
  const year = /^page_(\d{4})\d{4}_/u.exec(pageId)?.[1];
  if (!year) throw pageConflict("The existing-note update page identity is invalid.");
  return `wiki/generated/${year}/${pageId}.md`;
}

function createOperationPath(operationId: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1] ?? "19700101";
  return [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
}

function createMonotonicUpdatedAt(current: string, requested: string): string {
  const currentTime = Date.parse(current);
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(currentTime) || !Number.isFinite(requestedTime)) {
    throw pageConflict("The existing-note update timestamp binding is invalid.");
  }
  return new Date(Math.max(requestedTime, currentTime + 1)).toISOString();
}

function normalizeArtifactIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => /^art_[a-z0-9_]+$/u.test(value)))).slice(0, 64);
}

function escapeManagedText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/[\[\]()`*_#]/gu, "\\$&")
    .replace(/\s+/gu, " ")
    .trim();
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw pageConflict("The existing-note update path is invalid.");
  }
  const resolvedVault = path.resolve(vaultPath);
  const vaultStat = fs.lstatSync(resolvedVault);
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw pageConflict("The active vault is not a safe update root.");
  }
  const resolved = path.resolve(resolvedVault, ...relativePath.split("/"));
  if (!resolved.startsWith(`${resolvedVault}${path.sep}`)) {
    throw pageConflict("The existing-note update path escapes the active vault.");
  }
  return resolved;
}

function hashJson(value: unknown): string {
  return hashText(stableJson(value));
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isContentHash(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pageConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_ingest.page_conflict", message);
}
