import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  LibraryRenameTagRequest,
  LibraryRenameTagResult,
  VaultSummary
} from "@pige/contracts";
import { createPigeTagKey, normalizePigeTag, parsePigeFrontmatter } from "@pige/markdown";
import { LibraryRenameTagResultSchema, OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { z } from "zod";
import {
  createLibraryTagsSnapshotId,
  readLibraryTagSnapshot
} from "./library-tags-service";
import {
  readMarkdownPageContentAtSignature,
  scanMarkdownPages,
  type MarkdownFileSignatureRecord
} from "./markdown-page-index";

const ROOT = ".pige/library-tag-renames";
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 1_000;

const ReceiptItemSchema = z.object({
  pageId: z.string().regex(/^page_[a-z0-9_]+$/u),
  pagePath: z.string().min(1),
  beforePath: z.string().min(1),
  afterPath: z.string().min(1),
  beforeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  afterHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("library_tag_rename_receipt"),
  requestId: z.string().regex(/^library_tag_rename_request_[a-z0-9]{16,64}$/u),
  requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  activeVaultId: z.string().regex(/^vault_[a-z0-9_]+$/u),
  tag: z.string().min(1).max(48),
  replacementTag: z.string().min(1).max(48),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/u),
  createdAt: z.string().datetime({ offset: true }),
  items: z.array(ReceiptItemSchema).min(1).max(MAX_PAGES)
}).strict();

const UndoIntentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("library_tag_rename_undo"),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/u),
  undoOperationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}undo$/u),
  createdAt: z.string().datetime({ offset: true })
}).strict();

type Receipt = z.infer<typeof ReceiptSchema>;
type UndoIntent = z.infer<typeof UndoIntentSchema>;

export interface LibraryTagRenameVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export class LibraryTagRenameService {
  readonly #vaults: LibraryTagRenameVaultPort;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(
    vaults: LibraryTagRenameVaultPort,
    dependencies: { readonly now?: () => Date; readonly randomId?: () => string } = {}
  ) {
    this.#vaults = vaults;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  rename(request: LibraryRenameTagRequest): LibraryRenameTagResult {
    const identity = { ...request };
    const vaultPath = this.#activeVaultPath(request.activeVaultId);
    if (!vaultPath) return LibraryRenameTagResultSchema.parse({ ...identity, status: "stale" });
    try {
      const existing = readReceipt(vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digest(request)) return LibraryRenameTagResultSchema.parse({ ...identity, status: "stale" });
        completeRename(vaultPath, existing);
        return committed(identity, existing);
      }
      const scan = scanMarkdownPages(vaultPath);
      if (scan.invalidPageCount !== 0) return LibraryRenameTagResultSchema.parse({ ...identity, status: "ineligible" });
      const snapshot = readLibraryTagSnapshot(vaultPath);
      const snapshotId = createLibraryTagsSnapshotId("list_tags", undefined, snapshot.tags);
      if (snapshotId !== request.expectedSnapshotId) return LibraryRenameTagResultSchema.parse({ ...identity, status: "stale" });
      const sourceKey = createPigeTagKey(request.tag);
      const replacementKey = createPigeTagKey(request.replacementTag);
      if (!sourceKey || !replacementKey || sourceKey === replacementKey) {
        return LibraryRenameTagResultSchema.parse({ ...identity, status: "ineligible" });
      }
      const source = snapshot.tags.find((candidate) => createPigeTagKey(candidate.tag) === sourceKey);
      if (!source) return LibraryRenameTagResultSchema.parse({ ...identity, status: "not_found" });
      if (source.pageCount !== request.expectedPageCount) return LibraryRenameTagResultSchema.parse({ ...identity, status: "stale" });
      if (snapshot.tags.some((candidate) => createPigeTagKey(candidate.tag) === replacementKey)) {
        return LibraryRenameTagResultSchema.parse({ ...identity, status: "ineligible" });
      }
      const affected = scan.pages.filter((page) => page.knowledge.tags.some((tag) => createPigeTagKey(tag) === sourceKey));
      if (affected.length !== source.pageCount || affected.length > MAX_PAGES) {
        return LibraryRenameTagResultSchema.parse({ ...identity, status: "stale" });
      }
      const createdAt = this.#now().toISOString();
      const operationId = createOperationId(createdAt, request.requestId, this.#randomId());
      const signaturesByPath = new Map(scan.files.map((signature) => [signature.absolutePath, signature]));
      const receipt = stageReceipt(
        vaultPath,
        request,
        affected.map((page) => {
          const signature = signaturesByPath.get(page.absolutePath);
          if (!signature) throw new Error("tag rename page signature missing");
          return { pageId: page.summary.pageId, signature };
        }),
        createdAt,
        operationId
      );
      completeRename(vaultPath, receipt);
      return committed(identity, receipt);
    } catch {
      return LibraryRenameTagResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "update_page") return undefined;
    const receipt = findReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = undo?.id === undoOperationId(operation.id);
    const current = undone ? allHashes(vaultPath, receipt, "before") : allHashes(vaultPath, receipt, "after");
    return {
      operationId: operation.id,
      kind: "update_page",
      createdAt: operation.createdAt,
      targetLabel: `${receipt.tag} → ${receipt.replacementTag}`,
      status: undone ? "undone" : "applied",
      canUndo: !undone && current,
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : {}),
      ...(!undone && !current ? { undoUnavailableReason: "content_changed" as const } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) => candidate.id === undoOperationId(operation.id));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceiptByOperation(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const undoId = undoOperationId(operation.id);
    const existing = readOperation(vaultPath, undoId);
    if (existing) return { status: "already_undone", operationId: operation.id, undoOperationId: undoId };
    if (!allHashes(vaultPath, receipt, "after")) return { status: "stale", operationId: operation.id };
    const priorIntent = readUndoIntent(vaultPath, receipt.requestId);
    const intent: UndoIntent = priorIntent ?? { schemaVersion: 1, kind: "library_tag_rename_undo", operationId: operation.id,
      undoOperationId: undoId, createdAt: this.#now().toISOString() };
    if (intent.operationId !== operation.id || intent.undoOperationId !== undoId) {
      return { status: "stale", operationId: operation.id };
    }
    if (!priorIntent) writeExclusive(undoIntentPath(vaultPath, receipt.requestId), Buffer.from(JSON.stringify(intent), "utf8"));
    completeUndo(vaultPath, receipt, operation, intent);
    return { status: "undone", operationId: operation.id, undoOperationId: undoId };
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      try {
        const operation = readOperation(vaultPath, receipt.operationId);
        const intent = readUndoIntent(vaultPath, receipt.requestId);
        if (operation && intent && !readOperation(vaultPath, intent.undoOperationId)) {
          completeUndo(vaultPath, receipt, operation, intent);
          recovered += 1;
        } else if (!operation && hasAfterState(vaultPath, receipt)) {
          completeRename(vaultPath, receipt);
          recovered += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  #activeVaultPath(activeVaultId: string): string | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === activeVaultId ? vaultPath : undefined;
  }
}

function stageReceipt(
  vaultPath: string,
  request: LibraryRenameTagRequest,
  pages: readonly { readonly pageId: string; readonly signature: MarkdownFileSignatureRecord }[],
  createdAt: string,
  operationId: string
): Receipt {
  let totalBytes = 0;
  const items: Receipt["items"][number][] = [];
  for (const { pageId, signature } of pages) {
    const before = Buffer.from(readMarkdownPageContentAtSignature(vaultPath, signature, MAX_PAGE_BYTES).markdown, "utf8");
    totalBytes += before.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("tag rename aggregate exceeds limit");
    const after = Buffer.from(renameTag(before.toString("utf8"), request.tag, request.replacementTag, createdAt), "utf8");
    const item = {
      pageId,
      pagePath: relative(vaultPath, signature.absolutePath),
      beforePath: `${ROOT}/${request.requestId}/${pageId}.before.md`,
      afterPath: `${ROOT}/${request.requestId}/${pageId}.after.md`,
      beforeHash: hash(before),
      afterHash: hash(after)
    };
    writeExclusive(resolve(vaultPath, item.beforePath), before);
    writeExclusive(resolve(vaultPath, item.afterPath), after);
    items.push(item);
  }
  const receipt = ReceiptSchema.parse({ schemaVersion: 1, kind: "library_tag_rename_receipt", requestId: request.requestId,
    requestDigest: digest(request), activeVaultId: request.activeVaultId, tag: request.tag,
    replacementTag: request.replacementTag, operationId, createdAt, items });
  writeExclusive(receiptPath(vaultPath, request.requestId), Buffer.from(JSON.stringify(receipt), "utf8"));
  return receipt;
}

function completeRename(vaultPath: string, receipt: Receipt): void {
  const operation = readOperation(vaultPath, receipt.operationId);
  if (operation) {
    if (!matchesOperation(receipt, operation) || !allHashes(vaultPath, receipt, "after")) throw new Error("tag rename operation conflict");
    return;
  }
  assertOnlyExpectedHashes(vaultPath, receipt);
  try {
    for (const item of receipt.items) {
      const live = resolve(vaultPath, item.pagePath);
      if (fileHash(live) === item.beforeHash) atomicReplace(live, readExact(resolve(vaultPath, item.afterPath)));
    }
    writeOperation(vaultPath, createRenameOperation(receipt));
  } catch (caught) {
    rollbackAfterFiles(vaultPath, receipt);
    throw caught;
  }
}

function completeUndo(vaultPath: string, receipt: Receipt, operation: OperationRecord, intent: UndoIntent): void {
  const existing = readOperation(vaultPath, intent.undoOperationId);
  if (existing) {
    if (!allHashes(vaultPath, receipt, "before")) throw new Error("tag rename undo conflict");
    return;
  }
  assertOnlyExpectedHashes(vaultPath, receipt);
  for (const item of receipt.items) {
    const live = resolve(vaultPath, item.pagePath);
    if (fileHash(live) === item.afterHash) atomicReplace(live, readExact(resolve(vaultPath, item.beforePath)));
  }
  writeOperation(vaultPath, createUndoOperation(receipt, operation, intent));
}

function renameTag(markdown: string, oldTag: string, replacementTag: string, updatedAt: string): string {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed) throw new Error("tag rename frontmatter missing");
  const oldKey = createPigeTagKey(oldTag);
  const replacement = normalizePigeTag(replacementTag);
  if (!oldKey || !replacement) throw new Error("tag rename identity invalid");
  let matched = 0;
  const tags = (parsed.frontmatter.tags ?? []).map((tag) => {
    if (createPigeTagKey(tag) !== oldKey) return tag;
    matched += 1;
    return replacement;
  });
  if (matched !== 1 || new Set(tags.map(createPigeTagKey)).size !== tags.length) throw new Error("tag rename is ambiguous");
  let raw = replaceField(parsed.raw, "tags", JSON.stringify(tags));
  raw = replaceField(raw, "updated_at", JSON.stringify(updatedAt));
  const frontmatterStart = markdown.indexOf("\n") + 1;
  const frontmatterEnd = frontmatterStart + parsed.raw.length;
  return `${markdown.slice(0, frontmatterStart)}${raw}${markdown.slice(frontmatterEnd)}`;
}

function replaceField(raw: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}:.*$`, "mu");
  if (!pattern.test(raw)) throw new Error(`tag rename ${key} missing`);
  return raw.replace(pattern, `${key}: ${value}`);
}

function createRenameOperation(receipt: Receipt): OperationRecord {
  return OperationRecordSchema.parse({
    id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: receipt.items.map((item) => ({ kind: "page" as const, id: item.pageId, checksum: item.afterHash })),
    sourceRefs: [], before: { kind: "operation", id: receipt.requestId, checksum: digest(receipt.items.map((item) => item.beforeHash)) },
    after: { kind: "operation", id: receipt.operationId, checksum: digest(receipt.items.map((item) => item.afterHash)) },
    summary: `Renamed tag ${receipt.tag} to ${receipt.replacementTag} on ${receipt.items.length} page(s).`,
    reversible: "yes", rollbackHint: "Restore every exact prior page while all renamed page revisions remain current.", warnings: []
  });
}

function createUndoOperation(receipt: Receipt, operation: OperationRecord, intent: UndoIntent): OperationRecord {
  return OperationRecordSchema.parse({
    id: intent.undoOperationId, schemaVersion: 1, createdAt: intent.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: operation.targetRefs, sourceRefs: [{ kind: "operation", id: operation.id }], before: operation.after,
    after: operation.before, summary: `Restored tag ${receipt.tag} on ${receipt.items.length} page(s).`,
    reversible: "no", warnings: []
  });
}

function matchesOperation(receipt: Receipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "update_page" &&
    operation.targetRefs.length === receipt.items.length && receipt.items.every((item, index) =>
      operation.targetRefs[index]?.kind === "page" && operation.targetRefs[index]?.id === item.pageId &&
      operation.targetRefs[index]?.checksum === item.afterHash);
}

function assertOnlyExpectedHashes(vaultPath: string, receipt: Receipt): void {
  for (const item of receipt.items) {
    const current = fileHash(resolve(vaultPath, item.pagePath));
    if (current !== item.beforeHash && current !== item.afterHash) throw new Error("tag rename page changed");
  }
}

function rollbackAfterFiles(vaultPath: string, receipt: Receipt): void {
  for (const item of receipt.items) {
    const live = resolve(vaultPath, item.pagePath);
    if (fileHash(live) === item.afterHash) atomicReplace(live, readExact(resolve(vaultPath, item.beforePath)));
  }
}

function allHashes(vaultPath: string, receipt: Receipt, state: "before" | "after"): boolean {
  return receipt.items.every((item) => fileHash(resolve(vaultPath, item.pagePath)) === item[`${state}Hash`]);
}

function hasAfterState(vaultPath: string, receipt: Receipt): boolean {
  return receipt.items.some((item) => fileHash(resolve(vaultPath, item.pagePath)) === item.afterHash);
}

function committed(identity: LibraryRenameTagRequest, receipt: Receipt): LibraryRenameTagResult {
  return LibraryRenameTagResultSchema.parse({ ...identity, status: "committed", operationId: receipt.operationId,
    renamedPageCount: receipt.items.length });
}

function createOperationId(createdAt: string, requestId: string, randomId: string): string {
  return `op_${createdAt.slice(0, 10).replace(/-/gu, "")}_${createHash("sha256").update(`${requestId}\0${randomId}`).digest("hex").slice(0, 16)}`;
}

function undoOperationId(operationId: string): string { return `${operationId}undo`; }
function receiptPath(vaultPath: string, requestId: string): string { return resolve(vaultPath, `${ROOT}/${requestId}/receipt.json`); }
function undoIntentPath(vaultPath: string, requestId: string): string { return resolve(vaultPath, `${ROOT}/${requestId}/undo.json`); }

function readReceipt(vaultPath: string, requestId: string): Receipt | undefined {
  const file = receiptPath(vaultPath, requestId);
  return fs.existsSync(file) ? ReceiptSchema.parse(JSON.parse(readExact(file, 512 * 1024).toString("utf8"))) : undefined;
}

function readUndoIntent(vaultPath: string, requestId: string): UndoIntent | undefined {
  const file = undoIntentPath(vaultPath, requestId);
  return fs.existsSync(file) ? UndoIntentSchema.parse(JSON.parse(readExact(file, 16 * 1024).toString("utf8"))) : undefined;
}

function listReceipts(vaultPath: string): Receipt[] {
  const root = resolve(vaultPath, ROOT);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; } catch { return []; }
  });
}

function findReceiptByOperation(vaultPath: string, operationId: string): Receipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}

function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const date = /^op_(\d{4})(\d{2})\d{2}_/u.exec(operationId);
  if (!date) return undefined;
  const file = resolve(vaultPath, `.pige/operations/${date[1]}/${date[2]}/${operationId}.json`);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const date = /^op_(\d{4})(\d{2})\d{2}_/u.exec(operation.id);
  if (!date) throw new Error("tag rename operation id invalid");
  writeExclusive(resolve(vaultPath, `.pige/operations/${date[1]}/${date[2]}/${operation.id}.json`), Buffer.from(JSON.stringify(operation), "utf8"));
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

function resolve(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error("tag rename path escape");
  return target;
}

function relative(vaultPath: string, absolutePath: string): string {
  const value = path.relative(path.resolve(vaultPath), path.resolve(absolutePath));
  if (!value || value.startsWith("..") || path.isAbsolute(value)) throw new Error("tag rename path escape");
  return value.split(path.sep).join("/");
}

function readExact(file: string, max = MAX_PAGE_BYTES): Buffer {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > max) throw new Error("tag rename file invalid");
  return fs.readFileSync(file);
}

function fileHash(file: string): string | undefined {
  try { return hash(readExact(file)); } catch (caught) {
    if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return undefined;
    throw caught;
  }
}

function hash(value: Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function digest(value: unknown): `sha256:${string}` { return hash(Buffer.from(JSON.stringify(value), "utf8")); }
