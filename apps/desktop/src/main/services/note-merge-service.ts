import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  NoteMergeRequest,
  VaultSummary
} from "@pige/contracts";
import { parsePigeFrontmatter, stripPigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { findMarkdownPageByIdAtSignature, readMarkdownPageContentAtSignature } from "./markdown-page-index";
import type { NotesTrashResolution } from "./notes-service";

const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const MERGE_ROOT = ".pige/note-merges";

export interface NoteMergeVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface NoteMergeCurrentPort {
  resolveTrashTarget(ownerId: string, request: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
    readonly expectedRevision: string;
  }): NotesTrashResolution;
}

interface MergeReceipt {
  readonly schemaVersion: 1;
  readonly kind: "note_merge_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly survivorPageId: string;
  readonly absorbedPageId: string;
  readonly survivorPath: string;
  readonly absorbedPath: string;
  readonly absorbedTrashPath: string;
  readonly survivorBeforePath: string;
  readonly absorbedBeforePath: string;
  readonly survivorMergedPath: string;
  readonly survivorBeforeHash: string;
  readonly absorbedBeforeHash: string;
  readonly survivorMergedHash: string;
  readonly operationId: string;
  readonly survivorTitle: string;
  readonly absorbedTitle: string;
  readonly createdAt: string;
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
}

export type NoteMergeServiceResult =
  | { readonly status: "committed"; readonly operationId: string }
  | { readonly status: "stale" | "not_found" | "ineligible" | "failed" };

export class NoteMergeService {
  readonly #vaults: NoteMergeVaultPort;
  readonly #current: NoteMergeCurrentPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(
    vaults: NoteMergeVaultPort,
    current: NoteMergeCurrentPort,
    dependencies: { readonly now?: () => Date; readonly randomId?: () => string } = {}
  ) {
    this.#vaults = vaults;
    this.#current = current;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  merge(ownerId: string, request: NoteMergeRequest): NoteMergeServiceResult {
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return { status: "stale" };
    try {
      const existing = readReceipt(scope.vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digestRequest(request)) return { status: "stale" };
        completeMerge(scope.vaultPath, existing);
        return { status: "committed", operationId: existing.operationId };
      }
      const survivor = this.#current.resolveTrashTarget(ownerId, {
        activeVaultId: request.activeVaultId,
        pageId: request.currentPageId,
        renderContextId: request.renderContextId,
        expectedRevision: request.expectedRevision
      });
      if (survivor.status !== "ready") return { status: survivor.status };
      const absorbed = readMergeTarget(scope.vaultPath, request.targetPageId, request.expectedTargetUpdatedAt);
      if (absorbed.status !== "ready") return { status: absorbed.status };
      if (!survivor.assertCurrent()) return { status: "stale" };

      const survivorBytes = readExactFile(survivor.absolutePath);
      if (hash(survivorBytes) !== survivor.pageContentHash) return { status: "stale" };
      const merged = mergeMarkdown(survivorBytes.toString("utf8"), absorbed.markdown, {
        absorbedPageId: request.targetPageId,
        absorbedTitle: absorbed.title,
        mergedAt: this.#now().toISOString()
      });
      if (Buffer.byteLength(merged, "utf8") > MAX_NOTE_BYTES) return { status: "ineligible" };
      const createdAt = this.#now().toISOString();
      const operationId = createOperationId(createdAt, request, this.#randomId());
      const receipt = createReceipt(scope.vaultPath, request, survivor, absorbed, merged, operationId, createdAt);
      persistMergeIntent(scope.vaultPath, receipt, survivorBytes, Buffer.from(absorbed.markdown, "utf8"), Buffer.from(merged, "utf8"));
      if (!survivor.assertCurrent() || !absorbed.assertCurrent()) return { status: "stale" };
      try {
        completeMerge(scope.vaultPath, receipt);
      } catch (caught) {
        rollbackUncommittedMerge(scope.vaultPath, receipt);
        throw caught;
      }
      return { status: "committed", operationId };
    } catch {
      return { status: "failed" };
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "update_page") return undefined;
    const receipt = findReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = !!undo && matchesUndoOperation(operation, undo);
    const current = undone ? originalsStateMatches(vaultPath, receipt) : mergeStateMatches(vaultPath, receipt);
    const redoReceipt = undone ? findRedoReceipt(vaultPath, operation.id) : undefined;
    const redoOperation = redoReceipt ? readOperation(vaultPath, redoReceipt.operationId) : undefined;
    const matchingRedo = !!redoReceipt && !!redoOperation && matchesOperation(redoReceipt, redoOperation);
    const canRedo = undone && !redoOperation && current;
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      targetLabel: receipt.survivorTitle,
      target: { kind: "page", pageId: receipt.survivorPageId },
      status: undone ? "undone" : "applied",
      canUndo: !undone && current,
      ...(undone ? { canRedo,
        ...(!canRedo ? { redoUnavailableReason: matchingRedo
          ? "already_redone" as const : "content_changed" as const } : {}) } : {}),
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : {}),
      ...(!undone && !current ? { undoUnavailableReason: "content_changed" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = findReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    return operations.find((candidate) => matchesUndoOperation(operation, candidate));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id);
    const existing = readOperation(vaultPath, undoId);
    if (existing) return { status: "already_undone", operationId: operation.id, undoOperationId: undoId };
    if (!mergeStateMatches(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
    restoreOriginals(vaultPath, receipt);
    writeOperation(vaultPath, createUndoOperation(receipt, operation, undoId));
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    try {
      const operation = readOperation(vaultPath, request.operationId);
      const receipt = operation ? findReceiptByOperation(vaultPath, operation.id) : undefined;
      if (!operation || !receipt || !matchesOperation(receipt, operation)) {
        return { status: "not_found", operationId: request.operationId };
      }
      const undo = readOperation(vaultPath, undoOperationId(operation.id));
      if (!undo || !matchesUndoOperation(operation, undo)) {
        return { status: "not_found", operationId: operation.id };
      }
      const existingReceipt = findRedoReceipt(vaultPath, operation.id);
      if (existingReceipt && !matchesRedoReceipt(existingReceipt, receipt, undo)) {
        return { status: "stale", operationId: operation.id };
      }
      const redoReceipt = existingReceipt ?? createRedoReceipt(receipt, undo, this.#now().toISOString());
      const existingOperation = readOperation(vaultPath, redoReceipt.operationId);
      if (existingOperation) {
        if (!matchesOperation(redoReceipt, existingOperation) || !mergeStateMatches(vaultPath, redoReceipt)) {
          return { status: "stale", operationId: operation.id };
        }
        return { status: "already_redone", operationId: operation.id, undoOperationId: undo.id,
          redoOperationId: existingOperation.id, revisionId: redoReceipt.survivorMergedHash };
      }
      const currentRevisionId = fileHash(resolve(vaultPath, receipt.survivorPath));
      if ((request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.survivorBeforeHash) ||
        !originalsStateMatches(vaultPath, receipt)) {
        return { status: "stale", operationId: operation.id, ...(currentRevisionId ? { currentRevisionId } : {}) };
      }
      if (!existingReceipt) persistRedoReceipt(vaultPath, redoReceipt);
      completeMerge(vaultPath, redoReceipt);
      return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
        redoOperationId: redoReceipt.operationId, revisionId: redoReceipt.survivorMergedHash };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      if (readOperation(vaultPath, receipt.operationId)) continue;
      try { completeMerge(vaultPath, receipt); recovered += 1; } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #scope(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? { vaultPath } : undefined;
  }
}

function readMergeTarget(vaultPath: string, pageId: string, expectedUpdatedAt: string):
  | { readonly status: "ready"; readonly pagePath: string; readonly absolutePath: string; readonly markdown: string; readonly hash: string; readonly title: string; assertCurrent(): boolean }
  | { readonly status: "stale" | "not_found" | "ineligible" } {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located) return { status: "not_found" };
  if (located.page.summary.pageType !== "note") return { status: "ineligible" };
  if (located.page.summary.updatedAt !== expectedUpdatedAt || located.signature.sizeBytes > MAX_NOTE_BYTES) return { status: "stale" };
  const content = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_NOTE_BYTES);
  const markdownHash = hash(Buffer.from(content.markdown, "utf8"));
  const signature = located.signature;
  return {
    status: "ready",
    pagePath: located.page.summary.pagePath,
    absolutePath: located.page.absolutePath,
    markdown: content.markdown,
    hash: markdownHash,
    title: located.page.summary.title.slice(0, 120),
    assertCurrent: () => {
      const current = findMarkdownPageByIdAtSignature(vaultPath, pageId);
      return Boolean(current && current.page.summary.updatedAt === expectedUpdatedAt &&
        current.signature.deviceId === signature.deviceId && current.signature.fileId === signature.fileId &&
        current.signature.mtimeMs === signature.mtimeMs && current.signature.sizeBytes === signature.sizeBytes);
    }
  };
}

function mergeMarkdown(survivor: string, absorbed: string, input: { absorbedPageId: string; absorbedTitle: string; mergedAt: string }): string {
  const parsed = parsePigeFrontmatter(survivor);
  if (!parsed) throw new Error("invalid survivor frontmatter");
  const absorbedFrontmatter = parsePigeFrontmatter(absorbed);
  if (!absorbedFrontmatter) throw new Error("invalid absorbed frontmatter");
  const aliases = unique([
    ...(parsed.frontmatter.aliases ?? []), input.absorbedTitle, input.absorbedPageId,
    ...(absorbedFrontmatter.frontmatter.aliases ?? [])
  ]).slice(0, 64);
  const sourceIds = unique([...(parsed.frontmatter.source_ids ?? []), ...(absorbedFrontmatter.frontmatter.source_ids ?? [])]).slice(0, 1_000);
  let raw = replaceFrontmatterField(parsed.raw, "aliases", aliases);
  raw = replaceFrontmatterField(raw, "source_ids", sourceIds);
  raw = replaceFrontmatterField(raw, "updated_at", input.mergedAt);
  const body = survivor.slice(parsed.bodyStartOffset).trimEnd();
  const absorbedBody = stripPigeFrontmatter(absorbed).trim();
  return `---\n${raw.trimEnd()}\n---\n\n${body}\n\n## ${escapeHeading(input.absorbedTitle)}\n\n${absorbedBody}\n`;
}

function replaceFrontmatterField(raw: string, key: string, value: string | readonly string[]): string {
  const line = `${key}: ${typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}:.*$`, "mu");
  return pattern.test(raw) ? raw.replace(pattern, line) : `${raw.trimEnd()}\n${line}\n`;
}

function createReceipt(vaultPath: string, request: NoteMergeRequest, survivor: Extract<NotesTrashResolution, { status: "ready" }>, absorbed: Extract<ReturnType<typeof readMergeTarget>, { status: "ready" }>, merged: string, operationId: string, createdAt: string): MergeReceipt {
  const root = `${MERGE_ROOT}/${request.requestId}`;
  return {
    schemaVersion: 1, kind: "note_merge_receipt", requestId: request.requestId,
    requestDigest: digestRequest(request), activeVaultId: request.activeVaultId,
    survivorPageId: request.currentPageId, absorbedPageId: request.targetPageId,
    survivorPath: relativePath(vaultPath, survivor.absolutePath), absorbedPath: relativePath(vaultPath, absorbed.absolutePath),
    absorbedTrashPath: `.pige/trash/note-merge/${operationId}/${path.basename(absorbed.pagePath)}`,
    survivorBeforePath: `${root}/survivor-before.md`, absorbedBeforePath: `${root}/absorbed-before.md`, survivorMergedPath: `${root}/survivor-merged.md`,
    survivorBeforeHash: survivor.pageContentHash, absorbedBeforeHash: absorbed.hash, survivorMergedHash: hash(Buffer.from(merged, "utf8")),
    operationId, survivorTitle: survivor.title, absorbedTitle: absorbed.title, createdAt
  };
}

function persistMergeIntent(vaultPath: string, receipt: MergeReceipt, survivor: Buffer, absorbed: Buffer, merged: Buffer): void {
  writeExclusive(resolve(vaultPath, receipt.survivorBeforePath), survivor);
  writeExclusive(resolve(vaultPath, receipt.absorbedBeforePath), absorbed);
  writeExclusive(resolve(vaultPath, receipt.survivorMergedPath), merged);
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(JSON.stringify(receipt), "utf8"));
}

function createRedoReceipt(parent: MergeReceipt, undo: OperationRecord, createdAt: string): MergeReceipt {
  return { ...parent,
    requestId: `notemergeredoreq_${createHash("sha256").update(parent.operationId).digest("hex").slice(0, 32)}`,
    requestDigest: hash(Buffer.from(`${parent.operationId}\0${undo.id}\0${parent.survivorBeforeHash}\0${parent.absorbedBeforeHash}\0${parent.survivorMergedHash}`, "utf8")),
    operationId: redoOperationId(parent.operationId), createdAt,
    redoOfOperationId: parent.operationId, undoOperationId: undo.id };
}

function persistRedoReceipt(vaultPath: string, receipt: MergeReceipt): void {
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(JSON.stringify(receipt), "utf8"));
}

function completeMerge(vaultPath: string, receipt: MergeReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) { if (!matchesOperation(receipt, existing)) throw new Error("operation conflict"); return; }
  const survivorPath = resolve(vaultPath, receipt.survivorPath);
  const absorbedPath = resolve(vaultPath, receipt.absorbedPath);
  const trashPath = resolve(vaultPath, receipt.absorbedTrashPath);
  const survivorHash = fileHash(survivorPath);
  if (survivorHash === receipt.survivorBeforeHash) atomicReplace(survivorPath, readExactFile(resolve(vaultPath, receipt.survivorMergedPath)));
  else if (survivorHash !== receipt.survivorMergedHash) throw new Error("survivor changed");
  const absorbedHash = fileHash(absorbedPath);
  const trashHash = fileHash(trashPath);
  if (absorbedHash === receipt.absorbedBeforeHash && trashHash === undefined) {
    fs.mkdirSync(path.dirname(trashPath), { recursive: true });
    fs.renameSync(absorbedPath, trashPath);
  } else if (!(absorbedHash === undefined && trashHash === receipt.absorbedBeforeHash)) throw new Error("absorbed note changed");
  writeOperation(vaultPath, createMergeOperation(receipt));
}

function restoreOriginals(vaultPath: string, receipt: MergeReceipt): void {
  atomicReplace(resolve(vaultPath, receipt.survivorPath), readExactFile(resolve(vaultPath, receipt.survivorBeforePath)));
  const live = resolve(vaultPath, receipt.absorbedPath);
  const trash = resolve(vaultPath, receipt.absorbedTrashPath);
  fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.renameSync(trash, live);
}

function rollbackUncommittedMerge(vaultPath: string, receipt: MergeReceipt): void {
  if (readOperation(vaultPath, receipt.operationId)) return;
  const survivor = resolve(vaultPath, receipt.survivorPath);
  if (fileHash(survivor) === receipt.survivorMergedHash) {
    atomicReplace(survivor, readExactFile(resolve(vaultPath, receipt.survivorBeforePath)));
  }
  const absorbed = resolve(vaultPath, receipt.absorbedPath);
  const trash = resolve(vaultPath, receipt.absorbedTrashPath);
  if (fileHash(absorbed) === undefined && fileHash(trash) === receipt.absorbedBeforeHash) {
    fs.mkdirSync(path.dirname(absorbed), { recursive: true });
    fs.renameSync(trash, absorbed);
  }
}

function createMergeOperation(receipt: MergeReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: [
      { kind: "page", id: receipt.survivorPageId, checksum: receipt.survivorMergedHash },
      { kind: "page", id: receipt.absorbedPageId, checksum: receipt.absorbedBeforeHash }
    ],
    sourceRefs: receipt.redoOfOperationId && receipt.undoOperationId
      ? [{ kind: "operation", id: receipt.redoOfOperationId }, { kind: "operation", id: receipt.undoOperationId }]
      : [], before: { kind: "operation", id: receipt.requestId, checksum: receipt.survivorBeforeHash },
    after: { kind: "page", id: receipt.survivorPageId, checksum: receipt.survivorMergedHash },
    summary: `${receipt.redoOfOperationId ? "Reapplied" : "Merged"} one note into another while preserving both prior versions.`,
    reversible: "yes", warnings: []
  });
}

function createUndoOperation(receipt: MergeReceipt, operation: OperationRecord, id: string): OperationRecord {
  return OperationRecordSchema.parse({
    id, schemaVersion: 1, createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: operation.targetRefs, sourceRefs: [{ kind: "operation", id: operation.id }],
    before: operation.after, after: { kind: "page", id: receipt.survivorPageId, checksum: receipt.survivorBeforeHash },
    summary: "Restored both notes from a note merge.", reversible: "no", warnings: []
  });
}

function matchesOperation(receipt: MergeReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "update_page" && operation.targetRefs.length === 2 &&
    operation.targetRefs[0]?.kind === "page" && operation.targetRefs[0].id === receipt.survivorPageId &&
    operation.targetRefs[0].checksum === receipt.survivorMergedHash &&
    operation.targetRefs[1]?.kind === "page" && operation.targetRefs[1].id === receipt.absorbedPageId &&
    operation.targetRefs[1].checksum === receipt.absorbedBeforeHash &&
    operation.before?.checksum === receipt.survivorBeforeHash && operation.after?.checksum === receipt.survivorMergedHash &&
    (receipt.redoOfOperationId && receipt.undoOperationId
      ? operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.redoOfOperationId) &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.undoOperationId)
      : operation.sourceRefs.length === 0);
}

function matchesUndoOperation(operation: OperationRecord, undo: OperationRecord): boolean {
  return undo.id === undoOperationId(operation.id) && undo.kind === "update_page" &&
    undo.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === operation.id) &&
    undo.before?.checksum === operation.after?.checksum && undo.after?.checksum === operation.before?.checksum;
}

function matchesRedoReceipt(child: MergeReceipt, parent: MergeReceipt, undo: OperationRecord): boolean {
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId) && child.activeVaultId === parent.activeVaultId &&
    child.survivorPageId === parent.survivorPageId && child.absorbedPageId === parent.absorbedPageId &&
    child.survivorPath === parent.survivorPath && child.absorbedPath === parent.absorbedPath &&
    child.absorbedTrashPath === parent.absorbedTrashPath && child.survivorBeforePath === parent.survivorBeforePath &&
    child.absorbedBeforePath === parent.absorbedBeforePath && child.survivorMergedPath === parent.survivorMergedPath &&
    child.survivorBeforeHash === parent.survivorBeforeHash && child.absorbedBeforeHash === parent.absorbedBeforeHash &&
    child.survivorMergedHash === parent.survivorMergedHash;
}

function mergeStateMatches(vaultPath: string, receipt: MergeReceipt): boolean {
  return fileHash(resolve(vaultPath, receipt.survivorPath)) === receipt.survivorMergedHash &&
    fileHash(resolve(vaultPath, receipt.absorbedPath)) === undefined &&
    fileHash(resolve(vaultPath, receipt.absorbedTrashPath)) === receipt.absorbedBeforeHash;
}

function originalsStateMatches(vaultPath: string, receipt: MergeReceipt): boolean {
  return fileHash(resolve(vaultPath, receipt.survivorPath)) === receipt.survivorBeforeHash &&
    fileHash(resolve(vaultPath, receipt.absorbedPath)) === receipt.absorbedBeforeHash &&
    fileHash(resolve(vaultPath, receipt.absorbedTrashPath)) === undefined;
}

function listReceipts(vaultPath: string): MergeReceipt[] {
  const root = resolve(vaultPath, MERGE_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const receipt = readReceipt(vaultPath, entry.name);
    return receipt ? [receipt] : [];
  });
}

function findReceiptByOperation(vaultPath: string, operationId: string): MergeReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function findRedoReceipt(vaultPath: string, operationId: string): MergeReceipt | undefined {
  const matches = listReceipts(vaultPath).filter((receipt) => receipt.redoOfOperationId === operationId);
  if (matches.length > 1) throw new Error("multiple note merge Redo receipts");
  return matches[0];
}

function readReceipt(vaultPath: string, requestId: string): MergeReceipt | undefined {
  const file = receiptPath(vaultPath, requestId);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExactFile(file, 64 * 1024).toString("utf8")) as Partial<MergeReceipt>;
  return value.schemaVersion === 1 && value.kind === "note_merge_receipt" && value.requestId === requestId && typeof value.operationId === "string"
    ? value as MergeReceipt : undefined;
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const [, date] = /^op_(\d{8})_/u.exec(operation.id) ?? [];
  if (!date) throw new Error("invalid operation id");
  const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operation.id}.json`);
  if (fs.existsSync(file)) {
    if (JSON.stringify(readOperation(vaultPath, operation.id)) !== JSON.stringify(operation)) throw new Error("operation conflict");
    return;
  }
  writeExclusive(file, Buffer.from(JSON.stringify(operation), "utf8"));
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const [, date] = /^op_(\d{8})_/u.exec(operationId) ?? [];
  if (!date) return undefined;
  const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExactFile(file, 256 * 1024).toString("utf8"))) : undefined;
}

function writeExclusive(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function atomicReplace(file: string, bytes: Buffer): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temp, file);
}

function resolve(vaultPath: string, relative: string): string {
  const root = path.resolve(vaultPath);
  const target = path.resolve(root, ...relative.split("/"));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error("path escape");
  return target;
}

function relativePath(vaultPath: string, absolute: string): string {
  const relative = path.relative(path.resolve(vaultPath), path.resolve(absolute));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escape");
  return relative.split(path.sep).join("/");
}

function receiptPath(vaultPath: string, requestId: string): string { return resolve(vaultPath, `${MERGE_ROOT}/${requestId}/receipt.json`); }
function readExactFile(file: string, max = MAX_NOTE_BYTES): Buffer { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error("invalid file"); return fs.readFileSync(file); }
function fileHash(file: string): string | undefined { try { return hash(readExactFile(file)); } catch (caught) { return typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT" ? undefined : (() => { throw caught; })(); } }
function hash(bytes: Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function digestRequest(request: NoteMergeRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
function unique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim()).filter(Boolean))]; }
function escapeHeading(value: string): string { return value.replace(/[\r\n#]/gu, " ").replace(/\s+/gu, " ").trim(); }
function createOperationId(createdAt: string, request: NoteMergeRequest, randomId: string): string { return `op_${createdAt.slice(0, 10).replace(/-/gu, "")}_${createHash("sha256").update(`${request.requestId}\0${randomId}`).digest("hex").slice(0, 16)}`; }
function undoOperationId(operationId: string): string { return `${operationId}undo`; }
function redoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("note merge Redo operation id invalid");
  return `op_${date}_${createHash("sha256").update(`pige.note-merge-redo.v1\0${operationId}`).digest("hex").slice(0, 16)}`;
}
