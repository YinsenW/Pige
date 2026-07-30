import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  LibraryRenameTopicRequest,
  LibraryRenameTopicResult,
  NoteRenderResult,
  VaultSummary
} from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { findMarkdownPageByIdAtSignature } from "./markdown-page-index";

const RECEIPT_ROOT = ".pige/topic-renames";
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export interface LibraryTopicRenameVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface LibraryTopicRenameRenderPort {
  render(request: { readonly pageId: string }, ownerId: string): Promise<NoteRenderResult>;
}

interface TopicRenameReceipt {
  readonly schemaVersion: 1;
  readonly kind: "topic_rename_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly beforeImagePath: string;
  readonly afterImagePath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly beforeTitle: string;
  readonly afterTitle: string;
  readonly operationId: string;
  readonly createdAt: string;
}

export class LibraryTopicRenameService {
  readonly #vaults: LibraryTopicRenameVaultPort;
  readonly #renderer: LibraryTopicRenameRenderPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(
    vaults: LibraryTopicRenameVaultPort,
    renderer: LibraryTopicRenameRenderPort,
    dependencies: { readonly now?: () => Date; readonly randomId?: () => string } = {}
  ) {
    this.#vaults = vaults;
    this.#renderer = renderer;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  async rename(ownerId: string, request: LibraryRenameTopicRequest): Promise<LibraryRenameTopicResult> {
    const scope = this.#scope(request.activeVaultId);
    if (!scope) return closed(request, "stale");
    const title = canonicalTitle(request.title);
    if (title !== request.title || canonicalTitle(request.expectedTitle) !== request.expectedTitle) {
      return closed(request, "ineligible");
    }
    try {
      const existing = readReceipt(scope.vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digestRequest(request)) return closed(request, "stale");
        completeForward(scope.vaultPath, existing);
        return this.#renderCommitted(ownerId, request, existing.operationId);
      }

      const located = findMarkdownPageByIdAtSignature(scope.vaultPath, request.pageId);
      if (!located) return closed(request, "not_found");
      if (located.page.summary.pageType !== "topic" || located.page.summary.status !== "active") {
        return closed(request, "ineligible");
      }
      if (
        located.page.summary.updatedAt !== request.expectedUpdatedAt ||
        located.page.summary.title !== request.expectedTitle
      ) return closed(request, "stale");
      const stat = fs.lstatSync(located.page.absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_PAGE_BYTES) {
        return closed(request, "ineligible");
      }
      const before = fs.readFileSync(located.page.absolutePath);
      const beforeHash = hash(before);
      if (publicRevision(beforeHash) !== request.expectedRevision) return closed(request, "stale");
      const updatedAt = this.#now().toISOString();
      const renamed = renameTopicMarkdown(before.toString("utf8"), request, updatedAt);
      if (!renamed) return closed(request, "ineligible");
      const after = Buffer.from(renamed, "utf8");
      if (!sameFileIdentity(located.page.absolutePath, stat) || hash(fs.readFileSync(located.page.absolutePath)) !== beforeHash) {
        return closed(request, "stale");
      }
      const operationId = createOperationId(updatedAt, request, this.#randomId());
      const root = `${RECEIPT_ROOT}/${request.requestId}`;
      const receipt: TopicRenameReceipt = {
        schemaVersion: 1,
        kind: "topic_rename_receipt",
        requestId: request.requestId,
        requestDigest: digestRequest(request),
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        pagePath: located.page.summary.pagePath,
        beforeImagePath: `${root}/before.md`,
        afterImagePath: `${root}/after.md`,
        beforeHash,
        afterHash: hash(after),
        beforeTitle: request.expectedTitle,
        afterTitle: request.title,
        operationId,
        createdAt: updatedAt
      };
      persistIntent(scope.vaultPath, receipt, before, after);
      completeForward(scope.vaultPath, receipt);
      return this.#renderCommitted(ownerId, request, operationId);
    } catch (caught) {
      return closed(request, isConflict(caught) ? "conflict" : "failed");
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "rename_page") return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = undo?.id === undoOperationId(operation.id);
    const current = undone ? beforeMatches(vaultPath, receipt) : afterMatches(vaultPath, receipt);
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      targetLabel: receipt.afterTitle,
      target: { kind: "page", pageId: receipt.pageId },
      status: undone ? "undone" : "applied",
      canUndo: !undone && current,
      ...(undone
        ? { undoUnavailableReason: "already_undone" as const }
        : current ? {} : { undoUnavailableReason: "content_changed" as const })
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) => candidate.id === undoOperationId(operation.id));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id);
    if (readOperation(vaultPath, undoId)) {
      return { status: "already_undone", operationId: operation.id, undoOperationId: undoId };
    }
    if (!afterMatches(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
    persistUndoIntent(vaultPath, receipt);
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
        if (!operation) {
          completeForward(vaultPath, receipt);
          recovered += 1;
        } else if (hasUndoIntent(vaultPath, receipt) && !readOperation(vaultPath, undoOperationId(receipt.operationId))) {
          completeUndo(vaultPath, receipt, operation);
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  async #renderCommitted(
    ownerId: string,
    request: LibraryRenameTopicRequest,
    operationId: string
  ): Promise<LibraryRenameTopicResult> {
    try {
      const render = await this.#renderer.render({ pageId: request.pageId }, ownerId);
      return render.renderContextId && render.summary.pageType === "topic" && render.summary.title === request.title
        ? { ...request, status: "committed", operationId, render: { ...render, renderContextId: render.renderContextId } }
        : closed(request, "failed");
    } catch {
      return closed(request, "failed");
    }
  }

  #scope(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current(), vaultPath = this.#vaults.activeVaultPath();
    return vault?.vaultId === activeVaultId && vaultPath ? { vaultPath: path.resolve(vaultPath) } : undefined;
  }
}

function renameTopicMarkdown(
  markdown: string,
  request: LibraryRenameTopicRequest,
  updatedAt: string
): string | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  const frontmatter = parsed?.frontmatter;
  if (
    !parsed || frontmatter?.id !== request.pageId || frontmatter.type !== "topic" ||
    frontmatter.status !== "active" || frontmatter.title !== request.expectedTitle
  ) return undefined;
  const titleLines = [...parsed.raw.matchAll(/^title:[^\r\n]*$/gmu)];
  const updatedLines = [...parsed.raw.matchAll(/^updated_at:[^\r\n]*$/gmu)];
  const aliasLines = [...parsed.raw.matchAll(/^aliases:[^\r\n]*$/gmu)];
  if (titleLines.length !== 1 || updatedLines.length !== 1 || aliasLines.length > 1) return undefined;
  if (aliasLines[0] && !/^aliases:\s*\[[^\r\n]*\]\s*$/u.test(aliasLines[0][0])) return undefined;
  const aliases = [...(frontmatter.aliases ?? [])];
  if (!aliases.some((alias) => alias.normalize("NFKC").toLocaleLowerCase("en-US") === request.expectedTitle.toLocaleLowerCase("en-US"))) {
    if (aliases.length >= 64) return undefined;
    aliases.push(request.expectedTitle);
  }
  let raw = parsed.raw
    .replace(/^title:[^\r\n]*$/mu, `title: ${JSON.stringify(request.title)}`)
    .replace(/^updated_at:[^\r\n]*$/mu, `updated_at: ${JSON.stringify(updatedAt)}`);
  raw = aliasLines.length === 1
    ? raw.replace(/^aliases:[^\r\n]*$/mu, `aliases: ${JSON.stringify(aliases)}`)
    : raw.replace(/^source_ids:[^\r\n]*$/mu, `aliases: ${JSON.stringify(aliases)}\n$&`);
  const start = markdown.indexOf(parsed.raw);
  if (start < 0) return undefined;
  const result = `${markdown.slice(0, start)}${raw}${markdown.slice(start + parsed.raw.length)}`;
  const verified = parsePigeFrontmatter(result)?.frontmatter;
  return verified?.id === request.pageId && verified.type === "topic" && verified.title === request.title
    ? result
    : undefined;
}

function completeForward(vaultPath: string, receipt: TopicRenameReceipt): void {
  const operation = readOperation(vaultPath, receipt.operationId);
  if (operation) {
    if (!matchesOperation(receipt, operation) || !afterMatches(vaultPath, receipt)) throw new RenameConflictError();
    return;
  }
  const target = resolveVaultPath(vaultPath, receipt.pagePath);
  const current = pathHash(target);
  if (current === receipt.beforeHash) {
    atomicReplace(target, readExact(resolveVaultPath(vaultPath, receipt.afterImagePath)));
  } else if (current !== receipt.afterHash) throw new RenameConflictError();
  writeOperation(vaultPath, createOperation(receipt));
}

function persistUndoIntent(vaultPath: string, receipt: TopicRenameReceipt): void {
  const file = undoIntentPath(vaultPath, receipt);
  if (fs.existsSync(file)) {
    if (readExact(file, 1024).toString("utf8") !== receipt.operationId) throw new RenameConflictError();
    return;
  }
  writeExclusive(file, Buffer.from(receipt.operationId, "utf8"));
}

function completeUndo(vaultPath: string, receipt: TopicRenameReceipt, operation: OperationRecord): void {
  if (!matchesOperation(receipt, operation)) throw new RenameConflictError();
  const undoId = undoOperationId(operation.id);
  if (readOperation(vaultPath, undoId)) {
    if (!beforeMatches(vaultPath, receipt)) throw new RenameConflictError();
    return;
  }
  const target = resolveVaultPath(vaultPath, receipt.pagePath), current = pathHash(target);
  if (current === receipt.afterHash) {
    atomicReplace(target, readExact(resolveVaultPath(vaultPath, receipt.beforeImagePath)));
  } else if (current !== receipt.beforeHash) throw new RenameConflictError();
  writeOperation(vaultPath, createUndoOperation(receipt, operation));
}

function createOperation(receipt: TopicRenameReceipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "rename_page",
    targetRefs: [{ kind: "page", id: receipt.pageId, checksum: receipt.afterHash }],
    sourceRefs: [],
    before: { kind: "page", id: receipt.pageId, checksum: receipt.beforeHash },
    after: { kind: "page", id: receipt.pageId, checksum: receipt.afterHash },
    summary: `Renamed topic “${bounded(receipt.beforeTitle)}” to “${bounded(receipt.afterTitle)}”.`,
    reversible: "yes",
    warnings: []
  });
}

function createUndoOperation(receipt: TopicRenameReceipt, operation: OperationRecord): OperationRecord {
  return OperationRecordSchema.parse({
    id: undoOperationId(operation.id),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "rename_page",
    targetRefs: operation.targetRefs,
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: operation.after,
    after: { kind: "page", id: receipt.pageId, checksum: receipt.beforeHash },
    summary: `Restored topic title “${bounded(receipt.beforeTitle)}”.`,
    reversible: "no",
    warnings: []
  });
}

function persistIntent(vaultPath: string, receipt: TopicRenameReceipt, before: Buffer, after: Buffer): void {
  writeExclusive(resolveVaultPath(vaultPath, receipt.beforeImagePath), before);
  writeExclusive(resolveVaultPath(vaultPath, receipt.afterImagePath), after);
  writeExclusive(receiptPath(vaultPath, receipt.requestId), Buffer.from(JSON.stringify(receipt), "utf8"));
}

function readReceipt(vaultPath: string, requestId: string): TopicRenameReceipt | undefined {
  const file = receiptPath(vaultPath, requestId);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 64 * 1024).toString("utf8")) as Partial<TopicRenameReceipt>;
  return value.schemaVersion === 1 && value.kind === "topic_rename_receipt" && value.requestId === requestId &&
    typeof value.operationId === "string" ? value as TopicRenameReceipt : undefined;
}

function listReceipts(vaultPath: string): TopicRenameReceipt[] {
  const root = resolveVaultPath(vaultPath, RECEIPT_ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; }
    catch { return []; }
  });
}

function findReceipt(vaultPath: string, operationId: string): TopicRenameReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function receiptPath(vaultPath: string, requestId: string): string {
  return resolveVaultPath(vaultPath, `${RECEIPT_ROOT}/${requestId}/receipt.json`);
}
function undoIntentPath(vaultPath: string, receipt: TopicRenameReceipt): string {
  return resolveVaultPath(vaultPath, `${RECEIPT_ROOT}/${receipt.requestId}/undo.intent`);
}
function hasUndoIntent(vaultPath: string, receipt: TopicRenameReceipt): boolean {
  return fs.existsSync(undoIntentPath(vaultPath, receipt));
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const [, date] = /^op_(\d{8})_/u.exec(operation.id) ?? [];
  if (!date) throw new RenameConflictError();
  const file = resolveVaultPath(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operation.id}.json`);
  if (fs.existsSync(file)) {
    if (JSON.stringify(readOperation(vaultPath, operation.id)) !== JSON.stringify(operation)) throw new RenameConflictError();
    return;
  }
  writeExclusive(file, Buffer.from(JSON.stringify(operation), "utf8"));
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const [, date] = /^op_(\d{8})_/u.exec(operationId) ?? [];
  if (!date) return undefined;
  const file = resolveVaultPath(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`);
  return fs.existsSync(file)
    ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8")))
    : undefined;
}

function writeExclusive(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
}

function atomicReplace(file: string, bytes: Buffer): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  fs.renameSync(temp, file);
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath), target = path.resolve(root, ...relativePath.split("/"));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new RenameConflictError();
  return target;
}

function readExact(file: string, maxBytes = MAX_PAGE_BYTES): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.size > maxBytes) throw new RenameConflictError();
  return fs.readFileSync(file);
}

function pathHash(file: string): string | undefined {
  try { return hash(readExact(file)); }
  catch (caught) {
    if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return undefined;
    throw caught;
  }
}

function sameFileIdentity(file: string, expected: fs.Stats): boolean {
  try {
    const current = fs.lstatSync(file);
    return current.isFile() && !current.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino &&
      current.size === expected.size && current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
  } catch { return false; }
}

function matchesOperation(receipt: TopicRenameReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "rename_page" &&
    operation.targetRefs[0]?.id === receipt.pageId && operation.before?.checksum === receipt.beforeHash &&
    operation.after?.checksum === receipt.afterHash;
}
function beforeMatches(vaultPath: string, receipt: TopicRenameReceipt): boolean { return pathHash(resolveVaultPath(vaultPath, receipt.pagePath)) === receipt.beforeHash; }
function afterMatches(vaultPath: string, receipt: TopicRenameReceipt): boolean { return pathHash(resolveVaultPath(vaultPath, receipt.pagePath)) === receipt.afterHash; }
function digestRequest(request: LibraryRenameTopicRequest): string { return hash(Buffer.from(JSON.stringify(request), "utf8")); }
function hash(bytes: Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function undoOperationId(operationId: string): string { return `${operationId}undo`; }
function createOperationId(createdAt: string, request: LibraryRenameTopicRequest, randomId: string): string {
  return `op_${createdAt.slice(0, 10).replace(/-/gu, "")}_${createHash("sha256").update(`${request.requestId}\0${randomId}`).digest("hex").slice(0, 16)}`;
}
function canonicalTitle(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : undefined;
}
function publicRevision(privateRevision: string): `noteeditrev_${string}` {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(privateRevision);
  if (!match) throw new RenameConflictError();
  return `noteeditrev_${match[1]}`;
}
function bounded(value: string): string { return value.replace(/[\r\n]/gu, " ").slice(0, 120); }
function isConflict(caught: unknown): boolean {
  return caught instanceof RenameConflictError || (typeof caught === "object" && caught !== null && "code" in caught &&
    ["EEXIST", "EPERM", "EACCES"].includes(String(caught.code)));
}
function closed(
  request: LibraryRenameTopicRequest,
  status: Exclude<LibraryRenameTopicResult["status"], "committed">
): LibraryRenameTopicResult { return { ...request, status }; }
class RenameConflictError extends Error {}
