import { createHash } from "node:crypto";
import path from "node:path";
import { parsePigeFrontmatter, stripPigeFrontmatter } from "@pige/markdown";
import {
  OperationRecordSchema,
  type JobRecord,
  type OperationRecord,
  type ReaderSelectionIdentity,
  type ReaderSelectionTransformAction
} from "@pige/schemas";
import {
  commitUpdateOperation,
  createAgentPageUpdateBeforePath,
  createAgentPageUpdateOperationId,
  createAgentPageUpdateStagedPath,
  createReaderSelectionReplacementContentHash,
  hashText,
  stageExact
} from "./agent-page-update-service";
import {
  CurrentNoteConflictReviewService,
  currentNoteConflictRevision,
  projectCurrentNoteConflictLines,
  type CurrentNoteConflictLine
} from "./current-note-conflict-review-service";
import {
  CurrentNoteConflictSaveService,
  currentNoteConflictSavedOperationMatches
} from "./current-note-conflict-save-service";
import {
  readGeneratedNoteExact,
  removeGeneratedNoteExact,
  replaceGeneratedNoteExact
} from "./generated-note-file";
import { createReaderSelectionPublicationArtifact } from "./reader-selection-job-binding";
import { readCurrentNotePageForMutation } from "./retrieval-evidence-boundary";

const MAX_PAGE_BYTES = 1024 * 1024;
const conflictReviews = new CurrentNoteConflictReviewService();
const conflictSaves = new CurrentNoteConflictSaveService();

export type ReaderSelectionConflictDecision =
  | "keep_current"
  | "apply_proposed"
  | "save_proposed_as_new_page";

export interface ReaderSelectionConflictInput {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly proposalId: string;
  readonly intentHash: string;
  readonly selection: ReaderSelectionIdentity;
  readonly replacement: string;
  readonly modelProfileId: string;
  readonly action: ReaderSelectionTransformAction;
  readonly previewLines: readonly CurrentNoteConflictLine[];
}

export type ReaderSelectionConflictState =
  | {
      readonly state: "conflicted";
      readonly currentRevision: `noteeditrev_${string}`;
      readonly lines: readonly CurrentNoteConflictLine[];
    }
  | {
      readonly state: "rejected";
      readonly lines: readonly CurrentNoteConflictLine[];
    }
  | {
      readonly state: "applied";
      readonly operation: OperationRecord;
      readonly lines: readonly CurrentNoteConflictLine[];
      readonly createdPageId?: string;
    };

export class ReaderSelectionConflictService {
  read(input: ReaderSelectionConflictInput): ReaderSelectionConflictState {
    const resolution = conflictReviews.read({
      vaultPath: input.vaultPath,
      mutationKind: "selection_transform",
      proposalId: input.proposalId,
      intentHash: input.intentHash
    });
    if (resolution) return this.#readResolved(input, resolution);
    const current = readCurrent(input);
    return {
      state: "conflicted",
      currentRevision: currentNoteConflictRevision(current.markdown),
      lines: projectCurrentNoteConflictLines(input.previewLines, current.markdown)
    };
  }

  resolve(input: ReaderSelectionConflictInput & {
    readonly expectedCurrentRevision: string;
    readonly decision: ReaderSelectionConflictDecision;
  }): ReaderSelectionConflictState {
    const existing = conflictReviews.read({
      vaultPath: input.vaultPath,
      mutationKind: "selection_transform",
      proposalId: input.proposalId,
      intentHash: input.intentHash
    });
    if (existing) {
      if (existing.decision !== input.decision) throw new Error("reader_selection_conflict.already_resolved");
      return this.#readResolved(input, existing);
    }
    const current = readCurrent(input);
    const currentRevision = currentNoteConflictRevision(current.markdown);
    const lines = projectCurrentNoteConflictLines(input.previewLines, current.markdown);
    if (currentRevision !== input.expectedCurrentRevision) {
      return { state: "conflicted", currentRevision, lines };
    }
    if (input.decision === "keep_current") {
      conflictReviews.resolve({
        vaultPath: input.vaultPath,
        mutationKind: "selection_transform",
        proposalId: input.proposalId,
        intentHash: input.intentHash,
        currentRevision,
        lines,
        decision: "keep_current"
      });
      return { state: "rejected", lines };
    }
    const proposed = readProposedMarkdown(input);
    if (input.decision === "save_proposed_as_new_page") {
      const parsed = parsePigeFrontmatter(proposed);
      if (!parsed) throw new Error("reader_selection_conflict.proposed_page_invalid");
      const saved = conflictSaves.resolve({
        vaultPath: input.vaultPath,
        mutationKind: "selection_transform",
        proposalId: input.proposalId,
        intentHash: input.intentHash,
        jobId: input.job.id,
        createdAt: input.job.createdAt,
        sourcePageId: input.selection.pageId,
        sourceTitle: parsed.frontmatter.title ?? "Untitled note",
        body: stripPigeFrontmatter(proposed).trim(),
        modelProfileId: input.modelProfileId,
        policyContextId: requirePolicyContextId(input.job),
        policyHash: requirePolicyHash(input.job),
        currentRevision,
        expectedRevision: 3,
        expectedCurrentRevision: currentRevision,
        readPreview: () => {
          const latest = this.read(input);
          return latest.state === "conflicted"
            ? { state: latest.state, revision: 3, currentRevision: latest.currentRevision, lines: latest.lines }
            : { state: latest.state, revision: 4, lines: latest.lines };
        }
      });
      if (!saved) return this.read(input);
      return { state: "applied", operation: saved.operation, lines: saved.lines, createdPageId: saved.pageId };
    }
    const operation = applyProposed(input, current.markdown, current.contentHash, proposed);
    conflictReviews.resolve({
      vaultPath: input.vaultPath,
      mutationKind: "selection_transform",
      proposalId: input.proposalId,
      intentHash: input.intentHash,
      currentRevision,
      lines,
      decision: "apply_proposed",
      operationId: operation.id
    });
    return { state: "applied", operation, lines };
  }

  #readResolved(
    input: ReaderSelectionConflictInput,
    resolution: NonNullable<ReturnType<CurrentNoteConflictReviewService["read"]>>
  ): ReaderSelectionConflictState {
    if (resolution.decision === "keep_current") return { state: "rejected", lines: resolution.lines };
    if (resolution.decision === "save_proposed_as_new_page") {
      const proposed = readProposedMarkdown(input);
      const parsed = parsePigeFrontmatter(proposed);
      if (!parsed) throw new Error("reader_selection_conflict.proposed_page_invalid");
      const saved = conflictSaves.adopt({
        vaultPath: input.vaultPath,
        mutationKind: "selection_transform",
        proposalId: input.proposalId,
        intentHash: input.intentHash,
        jobId: input.job.id,
        createdAt: input.job.createdAt,
        sourcePageId: input.selection.pageId,
        sourceTitle: parsed.frontmatter.title ?? "Untitled note",
        body: stripPigeFrontmatter(proposed).trim(),
        modelProfileId: input.modelProfileId,
        policyContextId: requirePolicyContextId(input.job),
        policyHash: requirePolicyHash(input.job),
        currentRevision: resolution.currentRevision
      });
      if (!saved || !currentNoteConflictSavedOperationMatches(
        saved.operation,
        {
          jobId: input.job.id,
          pageId: input.selection.pageId,
          modelProfileId: input.modelProfileId,
          policyContextId: requirePolicyContextId(input.job),
          policyHash: requirePolicyHash(input.job)
        },
        input.proposalId,
        resolution.pageId
      )) throw new Error("reader_selection_conflict.saved_page_invalid");
      return { state: "applied", operation: saved.operation, lines: resolution.lines, createdPageId: saved.pageId };
    }
    const operation = readOperation(input.vaultPath, resolution.operationId);
    if (!operation) throw new Error("reader_selection_conflict.operation_missing");
    requireConflictOperation(input, operation);
    const current = readCurrent(input);
    if (current.contentHash !== operation.after?.id) throw new Error("reader_selection_conflict.page_changed_after_apply");
    return { state: "applied", operation, lines: resolution.lines };
  }
}

function readCurrent(input: Pick<ReaderSelectionConflictInput, "vaultPath" | "selection">): {
  readonly markdown: string;
  readonly contentHash: string;
  readonly pagePath: string;
} {
  const target = readCurrentNotePageForMutation(input.vaultPath, input.selection.pageId);
  if (target.page.contentHash !== hashText(target.markdown)) throw new Error("reader_selection_conflict.current_page_invalid");
  return { markdown: target.markdown, contentHash: target.page.contentHash, pagePath: target.item.summary.pagePath };
}

function readProposedMarkdown(input: ReaderSelectionConflictInput): string {
  const operationId = createAgentPageUpdateOperationId(input.job.id, input.selection.pageId);
  const before = readGeneratedNoteExact(
    input.vaultPath,
    path.join(input.vaultPath, createAgentPageUpdateBeforePath(operationId)),
    MAX_PAGE_BYTES
  );
  if (!before || hashText(before) !== input.selection.pageContentHash) {
    throw new Error("reader_selection_conflict.before_image_invalid");
  }
  const expectedHash = createReaderSelectionReplacementContentHash(
    before,
    input.job.createdAt,
    input.selection,
    input.replacement
  );
  const proposed = readGeneratedNoteExact(
    input.vaultPath,
    path.join(input.vaultPath, createAgentPageUpdateStagedPath(operationId)),
    MAX_PAGE_BYTES
  );
  if (!proposed || hashText(proposed) !== expectedHash) throw new Error("reader_selection_conflict.proposal_invalid");
  return proposed;
}

function applyProposed(
  input: ReaderSelectionConflictInput,
  before: string,
  beforeHash: string,
  proposed: string
): OperationRecord {
  const operationId = conflictOperationId(input.job.id, input.selection.pageId, input.proposalId);
  const beforePath = createAgentPageUpdateBeforePath(operationId);
  const stagedPath = createAgentPageUpdateStagedPath(operationId);
  const afterHash = hashText(proposed);
  const current = readCurrent(input);
  const operation = createOperation(input, current.pagePath, operationId, beforePath, beforeHash, afterHash);
  const existing = readOperation(input.vaultPath, operationId);
  if (existing) {
    requireExactOperation(existing, operation);
    if (current.contentHash !== afterHash) throw new Error("reader_selection_conflict.page_changed_after_apply");
    return existing;
  }
  stageExact(input.vaultPath, beforePath, before, beforeHash);
  stageExact(input.vaultPath, stagedPath, proposed, afterHash);
  const live = readCurrent(input);
  if (live.contentHash === beforeHash) {
    replaceGeneratedNoteExact(
      input.vaultPath,
      path.join(input.vaultPath, live.pagePath),
      path.join(input.vaultPath, stagedPath),
      { beforeHash, afterHash, maximumBytes: MAX_PAGE_BYTES }
    );
  } else if (live.contentHash !== afterHash) {
    throw new Error("reader_selection_conflict.current_page_changed");
  }
  const committed = commitUpdateOperation(input.vaultPath, operation);
  removeGeneratedNoteExact(
    input.vaultPath,
    path.join(input.vaultPath, stagedPath),
    afterHash,
    MAX_PAGE_BYTES
  );
  return committed;
}

function createOperation(
  input: ReaderSelectionConflictInput,
  pagePath: string,
  operationId: string,
  beforePath: string,
  beforeHash: string,
  afterHash: string
): OperationRecord {
  const artifact = createReaderSelectionPublicationArtifact(
    input.job.id,
    input.action,
    input.selection,
    input.replacement
  );
  return OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    proposalId: input.proposalId,
    createdAt: input.job.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: input.modelProfileId,
    ...(input.job.policyContextId && input.job.policyHash ? {
      policyAudit: {
        policyContextId: input.job.policyContextId,
        policyHash: input.job.policyHash,
        enforcementOwners: ["Reader Selection Conflict Service", "Reader Selection Proposal Service"]
      }
    } : {}),
    kind: "update_page",
    targetRefs: [{ kind: "page", id: input.selection.pageId, path: pagePath }],
    sourceRefs: [
      { kind: "job", id: input.job.id },
      { kind: "artifact", id: artifact.id, checksum: artifact.checksum }
    ],
    before: { kind: "page", id: beforeHash, path: beforePath },
    after: { kind: "page", id: afterHash, path: pagePath },
    summary: `Applied the reviewed ${input.action} selection transform to current note ${input.selection.pageId}.`,
    reversible: "yes",
    rollbackHint: "Restore the exact reviewed current-note before-image only while the live page matches this Operation's after hash.",
    warnings: []
  });
}

function conflictOperationId(jobId: string, pageId: string, proposalId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.reader-selection-conflict.v1\0${jobId}\0${pageId}\0${proposalId}`, "utf8")
    .digest("hex")
    .slice(0, 20);
  return `op_${dateKey}_${suffix}`;
}

function readOperation(vaultPath: string, operationId: string | undefined): OperationRecord | undefined {
  if (!operationId) return undefined;
  const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("reader_selection_conflict.operation_invalid");
  const raw = readGeneratedNoteExact(
    vaultPath,
    path.join(vaultPath, ".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`),
    256 * 1024
  );
  if (raw === undefined) return undefined;
  return OperationRecordSchema.parse(JSON.parse(raw));
}

function requireConflictOperation(input: ReaderSelectionConflictInput, operation: OperationRecord): void {
  if (
    operation.jobId !== input.job.id ||
    operation.proposalId !== input.proposalId ||
    operation.kind !== "update_page" ||
    operation.targetRefs.length !== 1 ||
    operation.targetRefs[0]?.kind !== "page" ||
    operation.targetRefs[0].id !== input.selection.pageId ||
    !operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === input.job.id) ||
    operation.proposalId !== input.proposalId
  ) throw new Error("reader_selection_conflict.operation_invalid");
}

function requireExactOperation(actual: OperationRecord, expected: OperationRecord): void {
  if (stableJson(actual) !== stableJson(expected)) throw new Error("reader_selection_conflict.operation_conflict");
}

function requirePolicyContextId(job: JobRecord): string {
  if (!job.policyContextId) throw new Error("reader_selection_conflict.policy_missing");
  return job.policyContextId;
}

function requirePolicyHash(job: JobRecord): string {
  if (!job.policyHash) throw new Error("reader_selection_conflict.policy_missing");
  return job.policyHash;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
