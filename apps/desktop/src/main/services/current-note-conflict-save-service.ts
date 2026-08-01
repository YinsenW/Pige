import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parsePigeMarkdownPage } from "@pige/markdown";
import {
  OperationIdSchema,
  OperationRecordSchema,
  PageIdSchema,
  type OperationRecord
} from "@pige/schemas";
import {
  CurrentNoteConflictReviewService,
  type CurrentNoteConflictLine,
  type CurrentNoteConflictMutationKind
} from "./current-note-conflict-review-service";
import { ExternalOperationRecordStore } from "./external-operation-record-store";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact
} from "./generated-note-file";

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 128 * 1024;
const PROPOSAL_ID = /^proposal_[a-z0-9_]{8,128}$/u;
const INTENT_HASH = /^sha256:[a-f0-9]{64}$/u;
const NOTE_REVISION = /^noteeditrev_[a-f0-9]{64}$/u;
const conflictReviews = new CurrentNoteConflictReviewService();

export interface CurrentNoteConflictSavedPage {
  readonly operation: OperationRecord;
  readonly pageId: string;
  readonly currentRevision: `noteeditrev_${string}`;
  readonly lines: readonly CurrentNoteConflictLine[];
}

export interface CurrentNoteConflictSaveBaseInput {
  readonly vaultPath: string;
  readonly mutationKind: CurrentNoteConflictMutationKind;
  readonly proposalId: string;
  readonly intentHash: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly sourcePageId: string;
  readonly sourceTitle: string;
  readonly body: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly currentRevision: `noteeditrev_${string}`;
}

export interface CurrentNoteConflictSavePreview {
  readonly state: string;
  readonly revision: number;
  readonly currentRevision?: string;
  readonly lines: readonly CurrentNoteConflictLine[];
}

interface SaveReceiptRecord {
  readonly schemaVersion: 1;
  readonly kind: "current_note_conflict_save";
  readonly mutationKind: CurrentNoteConflictMutationKind;
  readonly proposalId: string;
  readonly intentHash: string;
  readonly jobId: string;
  readonly sourcePageId: string;
  readonly currentRevision: `noteeditrev_${string}`;
  readonly lines: readonly CurrentNoteConflictLine[];
  readonly pageId: string;
  readonly pagePath: string;
  readonly pageHash: `sha256:${string}`;
  readonly operationId: string;
}

export class CurrentNoteConflictSaveService {
  readonly #operations = new ExternalOperationRecordStore();

  resolve(input: CurrentNoteConflictSaveBaseInput & {
    readonly expectedRevision: number;
    readonly expectedCurrentRevision: string;
    readonly readPreview: () => CurrentNoteConflictSavePreview;
  }): CurrentNoteConflictSavedPage | undefined {
    const adopted = this.adopt(input);
    if (adopted) {
      persistResolution(input, adopted);
      return adopted;
    }
    const preview = input.readPreview();
    if (preview.state !== "conflicted" || preview.revision !== input.expectedRevision ||
      preview.currentRevision !== input.expectedCurrentRevision) return undefined;
    const saved = this.save({
      ...input,
      currentRevision: input.expectedCurrentRevision as `noteeditrev_${string}`,
      lines: preview.lines,
      assertCurrent: () => {
        const latest = input.readPreview();
        if (latest.state !== "conflicted" || latest.revision !== input.expectedRevision ||
          latest.currentRevision !== input.expectedCurrentRevision) {
          throw new Error("current_note_conflict_save.current_changed");
        }
      }
    });
    persistResolution(input, saved);
    return saved;
  }

  adopt(input: CurrentNoteConflictSaveBaseInput): CurrentNoteConflictSavedPage | undefined {
    const artifact = buildArtifact(input);
    const receipt = readReceipt(input.vaultPath, input.proposalId);
    if (!receipt) return undefined;
    requireExactReceipt(receipt, createReceipt(input, artifact, receipt.lines));
    return this.#publish(input, artifact, receipt);
  }

  save(input: CurrentNoteConflictSaveBaseInput & {
    readonly lines: readonly CurrentNoteConflictLine[];
    readonly assertCurrent: () => void;
  }): CurrentNoteConflictSavedPage {
    const adopted = this.adopt(input);
    if (adopted) return adopted;
    requireLines(input.lines);
    input.assertCurrent();
    const artifact = buildArtifact(input);
    persistReceipt(input.vaultPath, createReceipt(input, artifact, input.lines));
    const receipt = readReceipt(input.vaultPath, input.proposalId);
    if (!receipt) throw new Error("current_note_conflict_save.receipt_missing");
    requireExactReceipt(receipt, createReceipt(input, artifact, input.lines));
    return this.#publish(input, artifact, receipt);
  }

  #publish(
    input: CurrentNoteConflictSaveBaseInput,
    artifact: ReturnType<typeof buildArtifact>,
    receipt: SaveReceiptRecord
  ): CurrentNoteConflictSavedPage {
    const absolutePagePath = path.join(input.vaultPath, artifact.pagePath);
    const existing = readGeneratedNoteExact(input.vaultPath, absolutePagePath, MAX_PAGE_BYTES);
    if (existing === undefined) {
      createGeneratedNoteExclusive(input.vaultPath, absolutePagePath, artifact.markdown);
    }
    requireExactPage(input.vaultPath, absolutePagePath, artifact.markdown);
    const operation = this.#operations.write(fs.realpathSync.native(input.vaultPath), artifact.operation, () => {
      requireExactPage(input.vaultPath, absolutePagePath, artifact.markdown);
    });
    requireExactOperation(operation, artifact.operation);
    return {
      operation,
      pageId: receipt.pageId,
      currentRevision: receipt.currentRevision,
      lines: receipt.lines
    };
  }
}

function persistResolution(input: CurrentNoteConflictSaveBaseInput, saved: CurrentNoteConflictSavedPage): void {
  conflictReviews.resolve({
    vaultPath: input.vaultPath, mutationKind: input.mutationKind, proposalId: input.proposalId,
    intentHash: input.intentHash, currentRevision: saved.currentRevision, lines: saved.lines,
    decision: "save_proposed_as_new_page", operationId: saved.operation.id, pageId: saved.pageId
  });
}

function buildArtifact(input: CurrentNoteConflictSaveBaseInput): {
  readonly operation: OperationRecord;
  readonly pageId: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly pageHash: `sha256:${string}`;
} {
  assertBaseInput(input);
  const dateKey = /^job_(\d{8})_[a-z0-9_]+$/u.exec(input.jobId)?.[1];
  if (!dateKey) throw new Error("current_note_conflict_save.invalid_job");
  const suffix = digest(`current-note-conflict-save\0${input.jobId}\0${input.proposalId}`).slice(0, 16);
  const pageId = `page_${dateKey}_${suffix}`;
  const operationId = `op_${dateKey}_${digest(`current-note-conflict-save-operation\0${input.jobId}\0${input.proposalId}`).slice(0, 16)}`;
  const pagePath = `wiki/generated/${dateKey.slice(0, 4)}/${pageId}.md`;
  const title = proposedTitle(input.sourceTitle);
  const markdown = createMarkdown({ ...input, pageId, operationId, title });
  const pageHash = hashText(markdown);
  const operation = createOperation({
    ...input,
    pageId,
    pagePath,
    operationId,
    title,
    pageHash
  });
  return { operation, pageId, pagePath, markdown, pageHash };
}

function createReceipt(
  input: CurrentNoteConflictSaveBaseInput,
  artifact: ReturnType<typeof buildArtifact>,
  lines: readonly CurrentNoteConflictLine[]
): SaveReceiptRecord {
  requireLines(lines);
  return {
    schemaVersion: 1,
    kind: "current_note_conflict_save",
    mutationKind: input.mutationKind,
    proposalId: input.proposalId,
    intentHash: input.intentHash,
    jobId: input.jobId,
    sourcePageId: input.sourcePageId,
    currentRevision: input.currentRevision,
    lines,
    pageId: artifact.pageId,
    pagePath: artifact.pagePath,
    pageHash: artifact.pageHash,
    operationId: artifact.operation.id
  };
}

function createMarkdown(input: CurrentNoteConflictSaveBaseInput & {
  readonly pageId: string;
  readonly operationId: string;
  readonly title: string;
}): string {
  const body = normalizeBody(input.body);
  const markdown = `---\nid: ${JSON.stringify(input.pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(input.title)}\ntype: "note"\ncreated_at: ${JSON.stringify(input.createdAt)}\nupdated_at: ${JSON.stringify(input.createdAt)}\nstatus: "active"\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: ${JSON.stringify([input.sourcePageId])}\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(input.jobId)}\n  last_operation_id: ${JSON.stringify(input.operationId)}\n  model_profile_id: ${JSON.stringify(input.modelProfileId)}\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# ${escapeHeading(input.title)}\n\n${body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeMarkdownPage(markdown)) {
    throw new Error("current_note_conflict_save.invalid_page");
  }
  return markdown;
}

function createOperation(input: CurrentNoteConflictSaveBaseInput & {
  readonly pageId: string;
  readonly pagePath: string;
  readonly operationId: string;
  readonly title: string;
  readonly pageHash: `sha256:${string}`;
}): OperationRecord {
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    jobId: input.jobId,
    proposalId: input.proposalId,
    createdAt: input.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: input.modelProfileId,
    policyAudit: {
      policyContextId: input.policyContextId,
      policyHash: input.policyHash,
      enforcementOwners: [
        "Current Note Conflict Save Service",
        input.mutationKind === "append"
          ? "Current Note Append Service"
          : input.mutationKind === "replace"
            ? "Current Note Replace Service"
            : "Reader Selection Conflict Service"
      ]
    },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: input.pageId, path: input.pagePath }],
    sourceRefs: [
      { kind: "proposal", id: input.proposalId },
      { kind: "job", id: input.jobId },
      { kind: "page", id: input.sourcePageId, checksum: currentRevisionHash(input.currentRevision) }
    ],
    after: { kind: "page", id: input.pageHash, path: input.pagePath },
    summary: `Saved proposed version as note ${JSON.stringify(input.title)}.`,
    reversible: "best_effort",
    rollbackHint: "Move the unchanged generated note to recoverable trash.",
    warnings: []
  });
}

function persistReceipt(vaultPath: string, receipt: SaveReceiptRecord): void {
  const target = receiptPath(vaultPath, receipt.proposalId);
  const result = createGeneratedNoteExclusive(vaultPath, target, `${JSON.stringify(receipt, null, 2)}\n`);
  const durable = readReceipt(vaultPath, receipt.proposalId);
  if (!durable) throw new Error("current_note_conflict_save.receipt_missing");
  if (result === "exists") requireExactReceipt(durable, receipt);
}

function readReceipt(vaultPath: string, proposalId: string): SaveReceiptRecord | undefined {
  if (!PROPOSAL_ID.test(proposalId)) throw new Error("current_note_conflict_save.invalid_proposal");
  const raw = readGeneratedNoteExact(vaultPath, receiptPath(vaultPath, proposalId), MAX_RECEIPT_BYTES);
  if (raw === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("current_note_conflict_save.invalid_receipt"); }
  if (!isReceipt(value)) throw new Error("current_note_conflict_save.invalid_receipt");
  return value;
}

function isReceipt(value: unknown): value is SaveReceiptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<SaveReceiptRecord>;
  return record.schemaVersion === 1 && record.kind === "current_note_conflict_save" &&
    (record.mutationKind === "append" || record.mutationKind === "replace" || record.mutationKind === "selection_transform") &&
    typeof record.proposalId === "string" && PROPOSAL_ID.test(record.proposalId) &&
    typeof record.intentHash === "string" && INTENT_HASH.test(record.intentHash) &&
    typeof record.jobId === "string" && /^job_\d{8}_[a-z0-9_]+$/u.test(record.jobId) &&
    typeof record.sourcePageId === "string" && PageIdSchema.safeParse(record.sourcePageId).success &&
    typeof record.currentRevision === "string" && NOTE_REVISION.test(record.currentRevision) &&
    Array.isArray(record.lines) && validLines(record.lines) &&
    typeof record.pageId === "string" && PageIdSchema.safeParse(record.pageId).success &&
    typeof record.pagePath === "string" && /^wiki\/generated\/\d{4}\/page_\d{8}_[a-z0-9]{8,}\.md$/u.test(record.pagePath) &&
    typeof record.pageHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(record.pageHash) &&
    typeof record.operationId === "string" && OperationIdSchema.safeParse(record.operationId).success;
}

function assertBaseInput(input: CurrentNoteConflictSaveBaseInput): void {
  if (!PROPOSAL_ID.test(input.proposalId) || !INTENT_HASH.test(input.intentHash) ||
    !NOTE_REVISION.test(input.currentRevision) || !PageIdSchema.safeParse(input.sourcePageId).success ||
    !/^model_[a-z0-9_]+$/u.test(input.modelProfileId) ||
    input.policyContextId.length < 1 || input.policyContextId.length > 256 ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.policyHash)) {
    throw new Error("current_note_conflict_save.invalid_identity");
  }
}

function requireLines(value: readonly CurrentNoteConflictLine[]): void {
  if (!validLines(value)) throw new Error("current_note_conflict_save.invalid_review");
}

function validLines(value: readonly unknown[]): value is readonly CurrentNoteConflictLine[] {
  return value.length > 0 && value.length <= 8 && value.every((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return false;
    const item = line as Partial<CurrentNoteConflictLine>;
    return (item.kind === "context" || item.kind === "removed" || item.kind === "added") &&
      typeof item.text === "string" && item.text.length > 0 && Array.from(item.text).length <= 160 &&
      !/[\u0000-\u001f\u007f]/u.test(item.text);
  });
}

function requireExactReceipt(actual: SaveReceiptRecord, expected: SaveReceiptRecord): void {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error("current_note_conflict_save.receipt_conflict");
  }
}

function requireExactPage(vaultPath: string, absolutePath: string, expected: string): void {
  const actual = readGeneratedNoteExact(vaultPath, absolutePath, MAX_PAGE_BYTES);
  if (actual !== expected) throw new Error("current_note_conflict_save.page_conflict");
}

function requireExactOperation(actual: OperationRecord, expected: OperationRecord): void {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error("current_note_conflict_save.operation_conflict");
  }
}

function receiptPath(vaultPath: string, proposalId: string): string {
  return path.join(vaultPath, ".pige", "agent", "current-note-conflict-saves", `${proposalId}.json`);
}

function normalizeBody(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, "utf8") > MAX_PAGE_BYTES - 4096 ||
    /[\u0000\u000b\u000c\u007f]/u.test(trimmed)) {
    throw new Error("current_note_conflict_save.invalid_body");
  }
  return trimmed.replace(/^#\s+[^\r\n]+\r?\n(?:\r?\n)?/u, "").trim() || trimmed;
}

function proposedTitle(value: string): string {
  const base = value.trim().replace(/\s+/gu, " ").slice(0, 100) || "Untitled note";
  return `${base} — proposed`;
}

function currentRevisionHash(value: `noteeditrev_${string}`): `sha256:${string}` {
  return `sha256:${value.slice("noteeditrev_".length)}`;
}

function escapeHeading(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/gu, "\\$1");
}

function hashText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function currentNoteConflictSavedOperationMatches(
  operation: OperationRecord,
  intent: {
    readonly jobId: string;
    readonly pageId: string;
    readonly modelProfileId: string;
    readonly policyContextId: string;
    readonly policyHash: string;
  },
  proposalId: string,
  targetPageId: string | undefined
): boolean {
  const target = operation.targetRefs[0];
  return operation.kind === "create_page" && operation.jobId === intent.jobId &&
    operation.proposalId === proposalId && !!targetPageId &&
    operation.targetRefs.length === 1 && target?.kind === "page" && target.id === targetPageId &&
    operation.modelProfileId === intent.modelProfileId &&
    operation.policyAudit?.policyContextId === intent.policyContextId &&
    operation.policyAudit.policyHash === intent.policyHash &&
    operation.sourceRefs.some((ref) => ref.kind === "proposal" && ref.id === proposalId) &&
    operation.sourceRefs.some((ref) => ref.kind === "job" && ref.id === intent.jobId) &&
    operation.sourceRefs.some((ref) => ref.kind === "page" && ref.id === intent.pageId &&
      /^sha256:[a-f0-9]{64}$/u.test(ref.checksum ?? ""));
}

export function readCurrentNoteConflictReviewBase(
  vaultPath: string,
  relativePath: string,
  expectedHash: string
): string {
  const base = readGeneratedNoteExact(vaultPath, path.join(vaultPath, relativePath), MAX_PAGE_BYTES);
  if (base === undefined || hashText(base) !== expectedHash) {
    throw new Error("current_note_conflict_save.review_base_unavailable");
  }
  return base;
}
