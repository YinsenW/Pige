import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary, KnowledgeActivityUndoResult, NoteRenameRequest,
  NoteRenameResult, NoteRenderResult, VaultSummary
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import type { NotesService, NotesTrashResolution } from "./notes-service";

const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const RENAME_ROOT = ".pige/note-renames";

type RenameTargetPort = Pick<NotesService, "resolveTrashTarget" | "render">;
export interface NoteRenameVaultPort { current(): VaultSummary | undefined; activeVaultPath(): string | undefined; }

interface RenameReceipt {
  readonly schemaVersion: 1; readonly kind: "note_rename_receipt"; readonly requestId: string;
  readonly requestDigest: string; readonly activeVaultId: string; readonly pageId: string;
  readonly beforePath: string; readonly afterPath: string; readonly beforeImagePath: string;
  readonly afterImagePath: string; readonly beforeHash: string; readonly afterHash: string;
  readonly beforeTitle: string; readonly afterTitle: string; readonly operationId: string; readonly createdAt: string;
}

export class NoteRenameService {
  readonly #vaults: NoteRenameVaultPort; readonly #targets: RenameTargetPort;
  readonly #now: () => Date; readonly #randomId: () => string;
  constructor(vaults: NoteRenameVaultPort, targets: RenameTargetPort,
    dependencies: { readonly now?: () => Date; readonly randomId?: () => string } = {}) {
    this.#vaults = vaults; this.#targets = targets;
    this.#now = dependencies.now ?? (() => new Date()); this.#randomId = dependencies.randomId ?? randomUUID;
  }

  async rename(ownerId: string, request: NoteRenameRequest): Promise<NoteRenameResult> {
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return closed(request, "stale");
    if (canonicalTitle(request.title) !== request.title) return closed(request, "ineligible");
    try {
      const existing = readReceipt(scope.vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digestRequest(request)) return closed(request, "stale");
        completeForward(scope.vaultPath, existing);
        return this.#renderCommitted(ownerId, request, existing.operationId);
      }
      const target = this.#targets.resolveTrashTarget(ownerId, {
        activeVaultId: request.activeVaultId, pageId: request.currentPageId,
        renderContextId: request.renderContextId, expectedRevision: request.expectedRevision
      });
      if (target.status !== "ready") return closed(request, target.status);
      if (!target.assertCurrent()) return closed(request, "stale");
      if (!target.pagePath.startsWith("wiki/") || path.posix.extname(target.pagePath).toLocaleLowerCase("en-US") !== ".md") {
        return closed(request, "ineligible");
      }
      const targetStat = fs.lstatSync(target.absolutePath);
      if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1) return closed(request, "ineligible");
      const before = readExact(target.absolutePath);
      if (hash(before) !== target.pageContentHash) return closed(request, "stale");
      const renamed = renameMarkdown(before.toString("utf8"), request.currentPageId, request.title, this.#now().toISOString());
      if (!renamed) return closed(request, "ineligible");
      const afterPath = renamedPagePath(target, request.title);
      if (!afterPath) return closed(request, "ineligible");
      if (afterPath !== target.pagePath && pathState(resolve(scope.vaultPath, afterPath)) !== undefined) return closed(request, "conflict");
      if (!target.assertCurrent()) return closed(request, "stale");
      const createdAt = this.#now().toISOString();
      const receipt = createReceipt(scope.vaultPath, request, target, afterPath, Buffer.from(renamed, "utf8"),
        createOperationId(createdAt, request, this.#randomId()), createdAt);
      persistIntent(scope.vaultPath, receipt, before, Buffer.from(renamed, "utf8"));
      completeForward(scope.vaultPath, receipt);
      return this.#renderCommitted(ownerId, request, receipt.operationId);
    } catch (caught) {
      return closed(request, isConflict(caught) ? "conflict" : "failed");
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "rename_page") return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = !!undo && undo.id === undoOperationId(operation.id);
    const current = undone ? beforeStateMatches(vaultPath, receipt) : afterStateMatches(vaultPath, receipt);
    return { operationId: operation.id, kind: "rename_page", createdAt: operation.createdAt,
      targetLabel: receipt.afterTitle, target: { kind: "page", pageId: receipt.pageId },
      status: undone ? "undone" : "applied", canUndo: !undone && current,
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : current ? {} : { undoUnavailableReason: "content_changed" as const }) };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) => candidate.id === undoOperationId(operation.id));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id), existing = readOperation(vaultPath, undoId);
    if (existing) return { status: "already_undone", operationId: operation.id, undoOperationId: undoId };
    if (!afterStateMatches(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
    completeUndo(vaultPath, receipt, operation);
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0, failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        if (!operation) { completeForward(vaultPath, receipt); recovered += 1; continue; }
        if (readOperation(vaultPath, undoOperationId(receipt.operationId))) continue;
        if (undoStarted(vaultPath, receipt)) { completeUndo(vaultPath, receipt, operation); recovered += 1; }
      } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  async #renderCommitted(ownerId: string, request: NoteRenameRequest, operationId: string): Promise<NoteRenameResult> {
    try {
      const render: NoteRenderResult = await this.#targets.render({ pageId: request.currentPageId }, ownerId);
      return render.renderContextId && render.summary.pageId === request.currentPageId && render.summary.pageType === "note" &&
        render.summary.title === request.title
        ? { ...request, status: "committed", operationId, render }
        : closed(request, "failed");
    } catch { return closed(request, "failed"); }
  }

  #scope(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current(), vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? { vaultPath: path.resolve(vaultPath) } : undefined;
  }
}

function renameMarkdown(markdown: string, pageId: string, title: string, updatedAt: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (parsed?.frontmatter.id !== pageId || parsed.frontmatter.type !== "note" || parsed.frontmatter.status !== "active") return undefined;
  const beforeTitle = parsed.frontmatter.title?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!beforeTitle || beforeTitle === title) return undefined;
  const titleLines = [...parsed.raw.matchAll(/^title:[^\r\n]*$/gmu)], updatedLines = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const aliasLines = [...parsed.raw.matchAll(/^aliases:[^\r\n]*$/gmu)];
  if (titleLines.length !== 1 || updatedLines.length !== 1 || aliasLines.length > 1) return undefined;
  if (aliasLines[0] && !/^aliases:\s*\[[^\r\n]*\]\s*$/u.test(aliasLines[0][0])) return undefined;
  const aliases = [...(parsed.frontmatter.aliases ?? [])];
  if (!aliases.some((alias) => alias.normalize("NFKC").toLocaleLowerCase("en-US") === beforeTitle.toLocaleLowerCase("en-US"))) {
    if (aliases.length >= 64) return undefined;
    aliases.push(beforeTitle);
  }
  let raw = parsed.raw.replace(/^title:[^\r\n]*$/mu, `title: ${JSON.stringify(title)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  raw = aliasLines.length === 1 ? raw.replace(/^aliases:[^\r\n]*$/mu, `aliases: ${JSON.stringify(aliases)}`)
    : insertField(raw, `aliases: ${JSON.stringify(aliases)}`);
  const rawStart = markdown.indexOf(parsed.raw);
  if (rawStart < 0) return undefined;
  const result = `${markdown.slice(0, rawStart)}${raw}${markdown.slice(rawStart + parsed.raw.length)}`;
  const verified = parsePigeFrontmatter(result)?.frontmatter;
  return verified?.id === pageId && verified.type === "note" && verified.title === title ? result : undefined;
}

function insertField(raw: string, line: string): string {
  const sourceIds = /^source_ids:[^\r\n]*$/mu;
  return sourceIds.test(raw) ? raw.replace(sourceIds, `${line}\n$&`) : `${raw.trimEnd()}\n${line}\n`;
}

function renamedPagePath(target: Extract<NotesTrashResolution, { status: "ready" }>, title: string): string | undefined {
  const directory = path.posix.dirname(target.pagePath), suffix = target.pageId.split("_").at(-1)!.slice(-16);
  const slug = Array.from(title.normalize("NFKD").replace(/\p{Mark}+/gu, "").toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/gu, "")).slice(0, 80).join("");
  if (!slug) return undefined;
  const safeSlug = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(slug) ? `note-${slug}` : slug;
  return `${directory}/${safeSlug}--${suffix}.md`;
}

function createReceipt(vaultPath: string, request: NoteRenameRequest, target: Extract<NotesTrashResolution, { status: "ready" }>,
  afterPath: string, after: Buffer, operationId: string, createdAt: string): RenameReceipt {
  const root = `${RENAME_ROOT}/${request.requestId}`;
  return { schemaVersion: 1, kind: "note_rename_receipt", requestId: request.requestId,
    requestDigest: digestRequest(request), activeVaultId: request.activeVaultId, pageId: request.currentPageId,
    beforePath: relative(vaultPath, target.absolutePath), afterPath, beforeImagePath: `${root}/before.md`, afterImagePath: `${root}/after.md`,
    beforeHash: target.pageContentHash, afterHash: hash(after), beforeTitle: target.title, afterTitle: request.title, operationId, createdAt };
}

function persistIntent(vaultPath: string, receipt: RenameReceipt, before: Buffer, after: Buffer): void {
  writeExclusive(resolve(vaultPath, receipt.beforeImagePath), before); writeExclusive(resolve(vaultPath, receipt.afterImagePath), after);
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(JSON.stringify(receipt), "utf8"));
}

function completeForward(vaultPath: string, receipt: RenameReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) { if (!matchesOperation(receipt, existing) || !afterStateMatches(vaultPath, receipt)) throw new RenameConflictError(); return; }
  if (!afterStateMatches(vaultPath, receipt)) {
    transition(vaultPath, receipt.beforePath, receipt.afterPath, receipt.beforeHash);
    const after = resolve(vaultPath, receipt.afterPath), current = pathState(after);
    if (current === receipt.beforeHash) atomicReplace(after, readExact(resolve(vaultPath, receipt.afterImagePath)));
    else if (current !== receipt.afterHash) throw new RenameConflictError();
  }
  writeOperation(vaultPath, createOperation(receipt));
}

function completeUndo(vaultPath: string, receipt: RenameReceipt, operation: OperationRecord): void {
  const undoId = undoOperationId(operation.id), existing = readOperation(vaultPath, undoId);
  if (existing) { if (!beforeStateMatches(vaultPath, receipt)) throw new RenameConflictError(); return; }
  if (!beforeStateMatches(vaultPath, receipt)) {
    transition(vaultPath, receipt.afterPath, receipt.beforePath, receipt.afterHash);
    const before = resolve(vaultPath, receipt.beforePath), current = pathState(before);
    if (current === receipt.afterHash) atomicReplace(before, readExact(resolve(vaultPath, receipt.beforeImagePath)));
    else if (current !== receipt.beforeHash) throw new RenameConflictError();
  }
  writeOperation(vaultPath, createUndoOperation(receipt, operation));
}

function transition(vaultPath: string, fromRelative: string, toRelative: string, expectedHash: string): void {
  if (fromRelative === toRelative) { if (pathState(resolve(vaultPath, fromRelative)) !== expectedHash) throw new RenameConflictError(); return; }
  const from = resolve(vaultPath, fromRelative), to = resolve(vaultPath, toRelative);
  const fromHash = pathState(from), toHash = pathState(to);
  if (fromHash === expectedHash && toHash === undefined) { fs.linkSync(from, to); flushDirectory(path.dirname(from)); }
  const fromAfter = pathState(from), toAfter = pathState(to);
  if (fromAfter === expectedHash && toAfter === expectedHash) {
    const left = fs.lstatSync(from), right = fs.lstatSync(to);
    if (left.dev !== right.dev || left.ino !== right.ino) throw new RenameConflictError();
    fs.unlinkSync(from); flushDirectory(path.dirname(from)); return;
  }
  if (!(fromAfter === undefined && toAfter === expectedHash)) throw new RenameConflictError();
}

function createOperation(receipt: RenameReceipt): OperationRecord {
  return OperationRecordSchema.parse({ id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "rename_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, checksum: receipt.afterHash }], sourceRefs: [],
    before: { kind: "page", id: receipt.pageId, checksum: receipt.beforeHash },
    after: { kind: "page", id: receipt.pageId, checksum: receipt.afterHash },
    summary: `Renamed note “${bounded(receipt.beforeTitle)}” to “${bounded(receipt.afterTitle)}”.`, reversible: "yes", warnings: [] });
}

function createUndoOperation(receipt: RenameReceipt, operation: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({ id: undoOperationId(operation.id), schemaVersion: 1, createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "rename_page",
    targetRefs: operation.targetRefs, sourceRefs: [{ kind: "operation", id: operation.id }], before: operation.after,
    after: { kind: "page", id: receipt.pageId, checksum: receipt.beforeHash },
    summary: `Restored note title “${bounded(receipt.beforeTitle)}”.`, reversible: "no", warnings: [] });
}

function matchesOperation(receipt: RenameReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "rename_page" && operation.targetRefs[0]?.id === receipt.pageId &&
    operation.before?.checksum === receipt.beforeHash && operation.after?.checksum === receipt.afterHash;
}
function afterStateMatches(vaultPath: string, receipt: RenameReceipt): boolean { return receipt.beforePath === receipt.afterPath ? pathState(resolve(vaultPath, receipt.afterPath)) === receipt.afterHash : pathState(resolve(vaultPath, receipt.beforePath)) === undefined && pathState(resolve(vaultPath, receipt.afterPath)) === receipt.afterHash; }
function beforeStateMatches(vaultPath: string, receipt: RenameReceipt): boolean { return receipt.beforePath === receipt.afterPath ? pathState(resolve(vaultPath, receipt.beforePath)) === receipt.beforeHash : pathState(resolve(vaultPath, receipt.afterPath)) === undefined && pathState(resolve(vaultPath, receipt.beforePath)) === receipt.beforeHash; }
function undoStarted(vaultPath: string, receipt: RenameReceipt): boolean {
  const before = resolve(vaultPath, receipt.beforePath), after = resolve(vaultPath, receipt.afterPath);
  if (receipt.beforePath === receipt.afterPath) return pathState(before) === receipt.beforeHash;
  const beforeHash = pathState(before), afterHash = pathState(after);
  if (afterHash === undefined) return [receipt.afterHash, receipt.beforeHash].includes(beforeHash ?? "");
  if (beforeHash !== receipt.afterHash || afterHash !== receipt.afterHash) return false;
  const left = fs.lstatSync(before), right = fs.lstatSync(after); return left.dev === right.dev && left.ino === right.ino;
}

function listReceipts(vaultPath: string): RenameReceipt[] {
  const root = resolve(vaultPath, RENAME_ROOT); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}
function findReceipt(vaultPath: string, operationId: string): RenameReceipt | undefined { return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId); }
function readReceipt(vaultPath: string, requestId: string): RenameReceipt | undefined {
  const file = receiptPath(vaultPath, requestId); if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 64 * 1024).toString("utf8")) as Partial<RenameReceipt>;
  return value.schemaVersion === 1 && value.kind === "note_rename_receipt" && value.requestId === requestId && typeof value.operationId === "string" ? value as RenameReceipt : undefined;
}
function receiptPath(vaultPath: string, requestId: string): string { return resolve(vaultPath, `${RENAME_ROOT}/${requestId}/receipt.json`); }

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const [, date] = /^op_(\d{8})_/u.exec(operation.id) ?? []; if (!date) throw new Error("invalid operation id");
  const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operation.id}.json`);
  if (fs.existsSync(file)) { if (JSON.stringify(readOperation(vaultPath, operation.id)) !== JSON.stringify(operation)) throw new RenameConflictError(); return; }
  writeExclusive(file, Buffer.from(JSON.stringify(operation), "utf8"));
}
function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const [, date] = /^op_(\d{8})_/u.exec(operationId) ?? []; if (!date) return undefined;
  const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}
function writeExclusive(file: string, bytes: Buffer): void { fs.mkdirSync(path.dirname(file), { recursive: true }); const fd = fs.openSync(file, "wx", 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicReplace(file: string, bytes: Buffer): void { const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`); const fd = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, file); flushDirectory(path.dirname(file)); }
function flushDirectory(directory: string): void { try { const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* Some platforms cannot fsync directories. */ } }
function readExact(file: string, max = MAX_NOTE_BYTES): Buffer { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.size > max) throw new Error("invalid file"); return fs.readFileSync(file); }
function pathState(file: string): string | undefined { try { return hash(readExact(file)); } catch (caught) { if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return undefined; throw caught; } }
function resolve(vaultPath: string, relativePath: string): string { const root = path.resolve(vaultPath), target = path.resolve(root, ...relativePath.split("/")); if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new RenameConflictError(); return target; }
function relative(vaultPath: string, absolutePath: string): string { const result = path.relative(path.resolve(vaultPath), path.resolve(absolutePath)); if (!result || result.startsWith("..") || path.isAbsolute(result)) throw new RenameConflictError(); return result.split(path.sep).join("/"); }
function hash(bytes: Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function digestRequest(request: NoteRenameRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
function createOperationId(createdAt: string, request: NoteRenameRequest, randomId: string): string { return `op_${createdAt.slice(0, 10).replace(/-/gu, "")}_${createHash("sha256").update(`${request.requestId}\0${randomId}`).digest("hex").slice(0, 16)}`; }
function undoOperationId(operationId: string): string { return `${operationId}undo`; }
function bounded(value: string): string { return value.replace(/[\r\n]/gu, " ").slice(0, 120); }
function canonicalTitle(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : undefined;
}
function isConflict(caught: unknown): boolean { return caught instanceof RenameConflictError || (typeof caught === "object" && caught !== null && "code" in caught && ["EEXIST", "EPERM", "EACCES"].includes(String(caught.code))); }
function closed(request: NoteRenameRequest, status: Exclude<NoteRenameResult["status"], "committed">): NoteRenameResult { return { ...request, status }; }
class RenameConflictError extends Error {}
