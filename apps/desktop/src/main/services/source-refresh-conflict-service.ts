import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  SourceRefreshConflictReadRequest,
  SourceRefreshConflictReadResult,
  SourceRefreshConflictResolveRequest,
  SourceRefreshConflictResolveResult,
  VaultSummary
} from "@pige/contracts";
import { parsePigeMarkdownPage } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord, type SourceRecord } from "@pige/schemas";
import {
  CurrentNoteConflictReviewService,
  currentNoteConflictRevision,
  type CurrentNoteConflictLine,
  type CurrentNoteConflictResolution
} from "./current-note-conflict-review-service";
import { ExternalOperationRecordStore } from "./external-operation-record-store";
import { createGeneratedNoteExclusive, readGeneratedNoteExact } from "./generated-note-file";
import type {
  NoteMarkdownEditorOpenRequest,
  NoteMarkdownEditorOpenResult,
  NoteMarkdownEditorSaveRequest,
  NoteMarkdownEditorSaveResult
} from "./note-markdown-editor-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";
import { createSourcePageTitle, renderSourcePage } from "./source-page-service";

const reviews = new CurrentNoteConflictReviewService();
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;

export interface SourceRefreshConflictVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface SourceRefreshConflictEditorPort {
  open(request: NoteMarkdownEditorOpenRequest): NoteMarkdownEditorOpenResult;
  save(request: NoteMarkdownEditorSaveRequest): NoteMarkdownEditorSaveResult;
}

interface ConflictState {
  readonly vaultPath: string;
  readonly record: SourceRecord;
  readonly sourceRevision: `sourcerefreshrev_${string}`;
  readonly jobId: string;
  readonly currentMarkdown: string;
  readonly currentRevision: `noteeditrev_${string}`;
  readonly editorRevision: `sha256:${string}`;
  readonly renderIdentity: string;
  readonly proposedMarkdown: string;
  readonly conflictId: `sourcerefreshconflict_${string}`;
  readonly proposalId: `proposal_${string}`;
  readonly intentHash: `sha256:${string}`;
  readonly lines: readonly CurrentNoteConflictLine[];
}

interface ResolutionReceipt {
  readonly schemaVersion: 1;
  readonly kind: "source_refresh_conflict_apply" | "source_refresh_conflict_save";
  readonly conflictId: string;
  readonly proposalId: string;
  readonly intentHash: string;
  readonly sourceId: string;
  readonly sourcePageId: string;
  readonly sourceRevision: string;
  readonly currentRevision: string;
  readonly proposedHash: `sha256:${string}`;
  readonly operation: OperationRecord;
  readonly createdPageId?: string;
  readonly createdPagePath?: string;
  readonly createdPageHash?: `sha256:${string}`;
}

export class SourceRefreshConflictService {
  readonly #vaults: SourceRefreshConflictVaultPort;
  readonly #editor: SourceRefreshConflictEditorPort;
  readonly #operations = new ExternalOperationRecordStore();

  constructor(vaults: SourceRefreshConflictVaultPort, editor: SourceRefreshConflictEditorPort) {
    this.#vaults = vaults;
    this.#editor = editor;
  }

  read(request: SourceRefreshConflictReadRequest, renderContextCurrent: () => boolean): SourceRefreshConflictReadResult {
    const state = this.#state(request, renderContextCurrent);
    if (!state) return { ...request, status: renderContextCurrent() ? "none" : "stale" };
    try {
      const resolution = this.#resolution(state) ?? this.#adopt(state);
      if (resolution) return { ...request, status: "resolved" };
      return {
        ...request,
        status: "ready",
        review: {
          conflictId: state.conflictId,
          expectedSourceRevision: state.sourceRevision,
          expectedPageRevision: state.currentRevision,
          lines: [...state.lines]
        }
      };
    } catch {
      return { ...request, status: "failed" };
    }
  }

  resolve(request: SourceRefreshConflictResolveRequest, renderContextCurrent: () => boolean): SourceRefreshConflictResolveResult {
    try {
      const state = this.#state(request, renderContextCurrent);
      if (!state) return { ...request, status: renderContextCurrent() ? "not_found" : "stale" };
      if (state.conflictId !== request.conflictId || state.sourceRevision !== request.expectedSourceRevision ||
        state.currentRevision !== request.expectedPageRevision) return { ...request, status: "stale" };
      const adopted = this.#resolution(state) ?? this.#adopt(state);
      if (adopted) return resolutionResult(request, adopted);
      if (request.decision === "keep_current") {
        const resolution = reviews.resolve({
          vaultPath: state.vaultPath, mutationKind: "source_refresh", proposalId: state.proposalId,
          intentHash: state.intentHash, currentRevision: state.currentRevision, lines: state.lines,
          decision: "keep_current"
        });
        return resolutionResult(request, resolution);
      }
      return request.decision === "apply_proposed"
        ? this.#apply(request, state, renderContextCurrent)
        : this.#save(request, state, renderContextCurrent);
    } catch {
      return { ...request, status: "failed" };
    }
  }

  #state(
    request: Pick<SourceRefreshConflictReadRequest, "activeVaultId" | "currentPageId" | "sourceId">,
    renderContextCurrent: () => boolean
  ): ConflictState | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== request.activeVaultId || !renderContextCurrent()) return undefined;
    const snapshot = readCurrentSourceRecordSnapshot(vaultPath, request.sourceId);
    const record = snapshot?.record;
    const sourceRevision = record?.metadata.sourceRefreshRevision;
    const jobId = record?.metadata.sourceRefreshJobId;
    if (!record || record.knowledgePageId !== request.currentPageId || record.metadata.sourcePageRefreshConflict !== true ||
      typeof sourceRevision !== "string" || !/^sourcerefreshrev_[a-f0-9]{64}$/u.test(sourceRevision) ||
      typeof jobId !== "string" || !/^job_\d{8}_[a-z0-9_]{8,}$/u.test(jobId) || !record.knowledgePagePath) return undefined;
    const opened = this.#editor.open({ activeVaultId: request.activeVaultId, pageId: request.currentPageId });
    if (opened.status !== "opened" || !renderContextCurrent()) return undefined;
    const proposedMarkdown = renderSourcePage({
      pageId: record.knowledgePageId,
      pagePath: record.knowledgePagePath,
      sourceRecord: record,
      sourceRecordPath: sourceRecordRelativePath(record.id),
      jobId,
      title: createSourcePageTitle(vaultPath, record),
      now: record.updatedAt,
      vaultPath
    });
    const editorRevision = opened.revisionId as `sha256:${string}`;
    const currentRevision = currentNoteConflictRevision(opened.markdown);
    const seed = digest(`${record.id}\0${sourceRevision}\0${hashText(proposedMarkdown)}`);
    const conflictId = `sourcerefreshconflict_${seed.slice(0, 32)}` as const;
    const proposalId = `proposal_${jobId.slice(4, 12)}_${seed.slice(0, 32)}` as const;
    const intentHash = hashText(`${conflictId}\0${hashText(proposedMarkdown)}`);
    return {
      vaultPath, record, sourceRevision: sourceRevision as `sourcerefreshrev_${string}`, jobId,
      currentMarkdown: opened.markdown, currentRevision, editorRevision, renderIdentity: opened.renderIdentity,
      proposedMarkdown, conflictId, proposalId, intentHash,
      lines: conflictLines(opened.markdown, proposedMarkdown)
    };
  }

  #resolution(state: ConflictState): CurrentNoteConflictResolution | undefined {
    return reviews.read({
      vaultPath: state.vaultPath, mutationKind: "source_refresh",
      proposalId: state.proposalId, intentHash: state.intentHash
    });
  }

  #adopt(state: ConflictState): CurrentNoteConflictResolution | undefined {
    const receipt = readReceipt(state.vaultPath, state.proposalId);
    if (!receipt || receipt.conflictId !== state.conflictId || receipt.intentHash !== state.intentHash ||
      receipt.currentRevision !== state.currentRevision && receipt.kind === "source_refresh_conflict_save") return undefined;
    if (receipt.kind === "source_refresh_conflict_apply") {
      if (hashText(state.currentMarkdown) !== receipt.proposedHash ||
        !editorOperationMatches(state.vaultPath, receipt.operation.id, state, receipt.operation.before?.id)) return undefined;
      return reviews.resolve({ vaultPath: state.vaultPath, mutationKind: "source_refresh", proposalId: state.proposalId,
        intentHash: state.intentHash, currentRevision: state.currentRevision, lines: state.lines,
        decision: "apply_proposed", operationId: receipt.operation.id });
    }
    if (!receipt.createdPageId || !receipt.createdPagePath || !receipt.createdPageHash ||
      !pageMatches(state.vaultPath, receipt.createdPagePath, receipt.createdPageHash) ||
      !operationMatches(state.vaultPath, receipt.operation)) return undefined;
    return reviews.resolve({ vaultPath: state.vaultPath, mutationKind: "source_refresh", proposalId: state.proposalId,
      intentHash: state.intentHash, currentRevision: state.currentRevision, lines: state.lines,
      decision: "save_proposed_as_new_page", operationId: receipt.operation.id, pageId: receipt.createdPageId });
  }

  #apply(
    request: SourceRefreshConflictResolveRequest,
    state: ConflictState,
    renderContextCurrent: () => boolean
  ): SourceRefreshConflictResolveResult {
    const operationId = operationIdFor(state, "apply");
    const operation = expectedEditorOperation(state, operationId);
    persistReceipt(state.vaultPath, state.proposalId, {
      schemaVersion: 1, kind: "source_refresh_conflict_apply", conflictId: state.conflictId,
      proposalId: state.proposalId, intentHash: state.intentHash, sourceId: state.record.id,
      sourcePageId: state.record.knowledgePageId!, sourceRevision: state.sourceRevision,
      currentRevision: state.currentRevision, proposedHash: hashText(state.proposedMarkdown), operation
    });
    if (!renderContextCurrent()) return { ...request, status: "stale" };
    const saved = this.#editor.save({
      requestId: request.requestId, activeVaultId: request.activeVaultId, pageId: request.currentPageId,
      expectedRevisionId: state.editorRevision, renderIdentity: state.renderIdentity,
      markdown: state.proposedMarkdown, operationId
    });
    if (saved.status !== "committed" || saved.operationId !== operationId) return { ...request, status: saved.status === "stale" ? "stale" : "failed" };
    const resolution = reviews.resolve({ vaultPath: state.vaultPath, mutationKind: "source_refresh",
      proposalId: state.proposalId, intentHash: state.intentHash,
      currentRevision: currentNoteConflictRevision(state.proposedMarkdown), lines: state.lines,
      decision: "apply_proposed", operationId });
    return resolutionResult(request, resolution);
  }

  #save(
    request: SourceRefreshConflictResolveRequest,
    state: ConflictState,
    renderContextCurrent: () => boolean
  ): SourceRefreshConflictResolveResult {
    const dateKey = state.jobId.slice(4, 12);
    const suffix = digest(`source-refresh-save\0${state.conflictId}`).slice(0, 16);
    const pageId = `page_${dateKey}_${suffix}`;
    const pagePath = `wiki/generated/${dateKey.slice(0, 4)}/${pageId}.md`;
    const operationId = operationIdFor(state, "save");
    const markdown = savedNoteMarkdown(state, pageId, operationId);
    const pageHash = hashText(markdown);
    const operation = savedNoteOperation(state, pageId, pagePath, pageHash, operationId);
    persistReceipt(state.vaultPath, state.proposalId, {
      schemaVersion: 1, kind: "source_refresh_conflict_save", conflictId: state.conflictId,
      proposalId: state.proposalId, intentHash: state.intentHash, sourceId: state.record.id,
      sourcePageId: state.record.knowledgePageId!, sourceRevision: state.sourceRevision,
      currentRevision: state.currentRevision, proposedHash: hashText(state.proposedMarkdown), operation,
      createdPageId: pageId, createdPagePath: pagePath, createdPageHash: pageHash
    });
    if (!renderContextCurrent()) return { ...request, status: "stale" };
    const absolutePagePath = path.join(state.vaultPath, pagePath);
    createGeneratedNoteExclusive(state.vaultPath, absolutePagePath, markdown);
    if (!pageMatches(state.vaultPath, pagePath, pageHash)) throw new Error("source_refresh_conflict.page_changed");
    this.#operations.write(fs.realpathSync.native(state.vaultPath), operation, () => {
      if (!renderContextCurrent() || !pageMatches(state.vaultPath, pagePath, pageHash)) throw new Error("source_refresh_conflict.stale");
    });
    const resolution = reviews.resolve({ vaultPath: state.vaultPath, mutationKind: "source_refresh",
      proposalId: state.proposalId, intentHash: state.intentHash, currentRevision: state.currentRevision,
      lines: state.lines, decision: "save_proposed_as_new_page", operationId, pageId });
    return resolutionResult(request, resolution);
  }
}

function resolutionResult(
  request: SourceRefreshConflictResolveRequest,
  resolution: CurrentNoteConflictResolution
): SourceRefreshConflictResolveResult {
  if (resolution.decision === "keep_current") return { ...request, status: "kept" };
  if (resolution.decision === "apply_proposed" && resolution.operationId) {
    return { ...request, status: "applied", operationId: resolution.operationId };
  }
  if (resolution.operationId && resolution.pageId) {
    return { ...request, status: "saved", operationId: resolution.operationId, createdPageId: resolution.pageId };
  }
  return { ...request, status: "failed" };
}

function conflictLines(current: string, proposed: string): readonly CurrentNoteConflictLine[] {
  const currentBody = bodyLines(current);
  const proposedBody = bodyLines(proposed);
  const lines: CurrentNoteConflictLine[] = [
    { kind: "context", text: safeLine(currentBody[0] ?? "Current Source Page") },
    ...(currentBody.at(-1) ? [{ kind: "removed" as const, text: safeLine(currentBody.at(-1)!) }] : []),
    ...proposedBody.slice(0, 5).map((text) => ({ kind: "added" as const, text: safeLine(text) }))
  ];
  return lines.slice(0, 8);
}

function bodyLines(markdown: string): readonly string[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/u, "");
  return body.split(/\r?\n/u).map((line) => line.replace(/^#+\s*/u, "").trim()).filter(Boolean);
}

function safeLine(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim()).slice(0, 160).join("") || "Source Page";
}

function sourceRecordRelativePath(sourceId: string): string {
  const date = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!date) throw new Error("source_refresh_conflict.invalid_source");
  return `.pige/source-records/${date.slice(0, 4)}/${date.slice(4, 6)}/${sourceId}.json`;
}

function operationIdFor(state: ConflictState, suffix: string): string {
  return `op_${state.jobId.slice(4, 12)}_${digest(`${state.conflictId}\0${suffix}`).slice(0, 16)}`;
}

function expectedEditorOperation(state: ConflictState, operationId: string): OperationRecord {
  return OperationRecordSchema.parse({
    id: operationId, schemaVersion: 1, createdAt: state.record.updatedAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_page", targetRefs: [{ kind: "page", id: state.record.knowledgePageId }],
    sourceRefs: [{ kind: "source", id: state.record.id }, { kind: "job", id: state.jobId }],
    before: { kind: "page", id: state.editorRevision },
    after: { kind: "page", id: hashText(state.proposedMarkdown) },
    summary: "Applied the reviewed refreshed Source Page.", reversible: "yes",
    rollbackHint: "Restore the exact prior Source Page bytes while the applied revision remains current.", warnings: []
  });
}

function savedNoteMarkdown(state: ConflictState, pageId: string, operationId: string): string {
  const title = `${createSourcePageTitle(state.vaultPath, state.record)} — refreshed copy`;
  const body = state.proposedMarkdown.replace(/^---\n[\s\S]*?\n---\n/u, "").trim();
  const markdown = `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "note"\ncreated_at: ${JSON.stringify(state.record.updatedAt)}\nupdated_at: ${JSON.stringify(state.record.updatedAt)}\nstatus: "active"\nlanguage: ${JSON.stringify(state.record.language.language)}\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: [${JSON.stringify(state.record.id)}]\nrelated_page_ids: [${JSON.stringify(state.record.knowledgePageId)}]\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(state.jobId)}\n  last_operation_id: ${JSON.stringify(operationId)}\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n${body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeMarkdownPage(markdown)) throw new Error("source_refresh_conflict.invalid_page");
  return markdown;
}

function savedNoteOperation(
  state: ConflictState, pageId: string, pagePath: string, pageHash: string, operationId: string
): OperationRecord {
  return OperationRecordSchema.parse({
    id: operationId, schemaVersion: 1, jobId: state.jobId, proposalId: state.proposalId,
    createdAt: state.record.updatedAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_page", targetRefs: [{ kind: "page", id: pageId, path: pagePath }],
    sourceRefs: [{ kind: "source", id: state.record.id }, { kind: "page", id: state.record.knowledgePageId,
      checksum: state.editorRevision }, { kind: "job", id: state.jobId }],
    after: { kind: "page", id: pageHash, path: pagePath },
    summary: "Saved the reviewed refreshed Source Page as a new note.", reversible: "best_effort",
    rollbackHint: "Move the unchanged generated note to recoverable trash.", warnings: []
  });
}

function persistReceipt(vaultPath: string, proposalId: string, receipt: ResolutionReceipt): void {
  const target = receiptPath(vaultPath, proposalId);
  createGeneratedNoteExclusive(vaultPath, target, `${JSON.stringify(receipt, null, 2)}\n`);
  const durable = readReceipt(vaultPath, proposalId);
  if (!durable || JSON.stringify(durable) !== JSON.stringify(receipt)) throw new Error("source_refresh_conflict.receipt_changed");
}

function readReceipt(vaultPath: string, proposalId: string): ResolutionReceipt | undefined {
  const raw = readGeneratedNoteExact(vaultPath, receiptPath(vaultPath, proposalId), MAX_RECEIPT_BYTES);
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw) as ResolutionReceipt;
  return value?.schemaVersion === 1 && (value.kind === "source_refresh_conflict_apply" || value.kind === "source_refresh_conflict_save") &&
    value.proposalId === proposalId && OperationRecordSchema.safeParse(value.operation).success ? value : undefined;
}

function receiptPath(vaultPath: string, proposalId: string): string {
  return path.join(vaultPath, ".pige", "source-refresh-conflicts", `${proposalId}.receipt.json`);
}

function operationMatches(vaultPath: string, operation: OperationRecord): boolean {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1];
  if (!date) return false;
  try {
    const file = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operation.id}.json`);
    return JSON.stringify(OperationRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))) === JSON.stringify(operation);
  } catch { return false; }
}

function editorOperationMatches(
  vaultPath: string,
  operationId: string,
  state: ConflictState,
  expectedBeforeRevision: string | undefined
): boolean {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) return false;
  try {
    const file = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operationId}.json`);
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    return operation.id === operationId && operation.kind === "update_page" &&
      operation.targetRefs.length === 1 && operation.targetRefs[0]?.kind === "page" &&
      operation.targetRefs[0].id === state.record.knowledgePageId && operation.targetRefs[0].path === state.record.knowledgePagePath &&
      operation.before?.kind === "page" && operation.before.id === expectedBeforeRevision &&
      operation.after?.kind === "page" && operation.after.id === hashText(state.proposedMarkdown);
  } catch { return false; }
}

function pageMatches(vaultPath: string, pagePath: string, checksum: string): boolean {
  const page = readGeneratedNoteExact(vaultPath, path.join(vaultPath, pagePath), MAX_PAGE_BYTES);
  return page !== undefined && hashText(page) === checksum;
}

function hashText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
