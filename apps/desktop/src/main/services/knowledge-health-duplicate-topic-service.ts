import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  KnowledgeHealthDuplicateTopicRepairRequest,
  KnowledgeHealthDuplicateTopicRepairResult,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRunRequest,
  VaultSummary
} from "@pige/contracts";
import { parsePigeFrontmatter, stripPigeFrontmatter } from "@pige/markdown";
import { KnowledgeHealthDuplicateTopicRepairResultSchema, OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import type { LocalDatabaseKnowledgeHealthSnapshot } from "./local-database-knowledge-health";
import { findMarkdownPageByIdAtSignature, readMarkdownPageContentAtSignature } from "./markdown-page-index";

const ROOT = ".pige/knowledge-health-topic-merges";
const MAX_BYTES = 4 * 1024 * 1024;

export interface KnowledgeHealthDuplicateTopicVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}
export interface KnowledgeHealthDuplicateTopicDatabasePort {
  knowledgeHealth(vaultPath: string): LocalDatabaseKnowledgeHealthSnapshot | undefined;
}

interface PageState {
  readonly pageId: string;
  readonly title: string;
  readonly pagePath: string;
  readonly absolutePath: string;
  readonly markdown: string;
  readonly revision: `noteeditrev_${string}`;
  readonly renderProof: `knowledge_health_render_${string}`;
  readonly contentHash: string;
}

interface RepairContext {
  readonly activeVaultId: string;
  readonly reportRequestId: string;
  readonly indexGeneration: string;
  readonly pages: readonly [PageState, PageState];
}

interface Receipt {
  readonly schemaVersion: 1;
  readonly kind: "knowledge_health_duplicate_topic_merge";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly survivorPageId: string;
  readonly absorbedPageId: string;
  readonly survivorPath: string;
  readonly absorbedPath: string;
  readonly trashPath: string;
  readonly beforePath: string;
  readonly absorbedBeforePath: string;
  readonly mergedPath: string;
  readonly survivorBeforeHash: string;
  readonly absorbedBeforeHash: string;
  readonly mergedHash: string;
  readonly survivorTitle: string;
  readonly absorbedTitle: string;
  readonly operationId: string;
  readonly createdAt: string;
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
}

export class KnowledgeHealthDuplicateTopicService {
  readonly #vaults: KnowledgeHealthDuplicateTopicVaultPort;
  readonly #database: KnowledgeHealthDuplicateTopicDatabasePort;
  readonly #contexts = new Map<string, RepairContext>();
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(vaults: KnowledgeHealthDuplicateTopicVaultPort, database: KnowledgeHealthDuplicateTopicDatabasePort, dependencies: {
    readonly now?: () => Date;
    readonly randomId?: () => string;
  } = {}) {
    this.#vaults = vaults;
    this.#database = database;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
  }

  resetContexts(): void {
    this.#contexts.clear();
  }

  project(vaultPath: string, request: KnowledgeHealthRunRequest, snapshot: LocalDatabaseKnowledgeHealthSnapshot,
    issue: Extract<KnowledgeHealthIssueSummary, { kind: "duplicate_topic" }>): KnowledgeHealthIssueSummary {
    if (issue.candidatePageCount !== 2 || issue.pages.length !== 2) return issue;
    const first = readPage(vaultPath, issue.pages[0]!.pageId);
    const second = readPage(vaultPath, issue.pages[1]!.pageId);
    if (!first || !second || first.title !== issue.pages[0]!.title || second.title !== issue.pages[1]!.title) return issue;
    const repairContextId = `knowledge_health_repair_context_${this.#randomId().replaceAll("-", "").toLowerCase()}`;
    this.#contexts.set(repairContextId, {
      activeVaultId: request.activeVaultId,
      reportRequestId: request.requestId,
      indexGeneration: snapshot.indexGeneration,
      pages: [first, second]
    });
    return {
      ...issue,
      repairContextId,
      pageProofs: [first, second].map(({ pageId, revision, renderProof }) => ({ pageId, revision, renderProof }))
    };
  }

  repair(vaultPath: string, request: KnowledgeHealthDuplicateTopicRepairRequest): KnowledgeHealthDuplicateTopicRepairResult {
    const scope = this.#scope(request.activeVaultId, vaultPath);
    if (!scope) return result(request, "stale");
    try {
      const existing = readReceipt(vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digest(request)) return result(request, "stale");
        complete(vaultPath, existing);
        return committed(request, existing.operationId);
      }
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot) return result(request, "not_found");
      const context = this.#contexts.get(request.repairContextId);
      if (!context) return result(request, "not_found");
      if (!matchesContext(context, request) || !snapshotMatches(snapshot, context)) return result(request, "stale");
      const survivor = readPage(vaultPath, request.survivorPageId);
      const absorbed = readPage(vaultPath, request.absorbedPageId);
      if (!survivor || !absorbed) return result(request, "not_found");
      if (!matchesRequestPage(survivor, request, "survivor") || !matchesRequestPage(absorbed, request, "absorbed")) {
        return result(request, "stale");
      }
      const merged = mergeTopics(survivor.markdown, absorbed.markdown, absorbed.title, this.#now().toISOString());
      if (Buffer.byteLength(merged, "utf8") > MAX_BYTES) return result(request, "ineligible");
      const receipt = createReceipt(vaultPath, request, survivor, absorbed, merged, this.#now().toISOString(), this.#randomId());
      persistIntent(vaultPath, receipt, survivor.markdown, absorbed.markdown, merged);
      const currentSnapshot = readPage(vaultPath, survivor.pageId);
      const currentAbsorbed = readPage(vaultPath, absorbed.pageId);
      if (!currentSnapshot || !currentAbsorbed || currentSnapshot.contentHash !== survivor.contentHash ||
        currentAbsorbed.contentHash !== absorbed.contentHash) return result(request, "stale");
      complete(vaultPath, receipt);
      this.#contexts.delete(request.repairContextId);
      return committed(request, receipt.operationId);
    } catch {
      return result(request, "failed");
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "update_page") return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = !!undo && matchesUndoOperation(operation, undo);
    const current = undone ? originalsStateMatches(vaultPath, receipt) : mergeStateMatches(vaultPath, receipt);
    const redoReceipt = undone ? findRedoReceipt(vaultPath, operation.id) : undefined;
    const redoOperation = redoReceipt ? readOperation(vaultPath, redoReceipt.operationId) : undefined;
    const matchingRedo = !!redoReceipt && !!redoOperation && matchesOperation(redoReceipt, redoOperation);
    const canRedo = undone && !redoOperation && current;
    return { operationId: operation.id, kind: "update_page", createdAt: operation.createdAt,
      targetLabel: receipt.survivorTitle, target: { kind: "page", pageId: receipt.survivorPageId },
      status: undone ? "undone" : "applied", canUndo: !undone && current,
      ...(undone ? { canRedo,
        ...(!canRedo ? { redoUnavailableReason: matchingRedo
          ? "already_redone" as const : "content_changed" as const } : {}) } : {}),
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : {}),
      ...(!undone && !current ? { undoUnavailableReason: "content_changed" as const } : {}) };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    return operations.find((candidate) => matchesUndoOperation(operation, candidate));
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: operation.id };
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return { status: "not_found", operationId: operation.id };
    const id = undoId(operation.id);
    if (readOperation(vaultPath, id)) return { status: "already_undone", operationId: operation.id, undoOperationId: id };
    if (!mergeStateMatches(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
    restore(vaultPath, receipt);
    writeOperation(vaultPath, OperationRecordSchema.parse({ id, schemaVersion: 1, createdAt: new Date().toISOString(),
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
      targetRefs: operation.targetRefs, sourceRefs: [{ kind: "operation", id: operation.id }], before: operation.after,
      after: { kind: "page", id: receipt.survivorPageId, checksum: `sha256:${receipt.survivorBeforeHash}` },
      summary: "Restored both topics from a Knowledge Health merge.", reversible: "no", warnings: [] }));
    return { status: "undone", operationId: operation.id, undoOperationId: id };
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { status: "not_found", operationId: request.operationId };
    try {
      const operation = readOperation(vaultPath, request.operationId);
      const receipt = operation ? findReceipt(vaultPath, operation.id) : undefined;
      if (!operation || !receipt || !matchesOperation(receipt, operation)) {
        return { status: "not_found", operationId: request.operationId };
      }
      const undo = readOperation(vaultPath, undoId(operation.id));
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
          redoOperationId: existingOperation.id, revisionId: `sha256:${redoReceipt.mergedHash}` };
      }
      const current = fileHash(resolve(vaultPath, receipt.survivorPath));
      if ((request.expectedRevisionId !== undefined && request.expectedRevisionId !== `sha256:${receipt.survivorBeforeHash}`) ||
        !originalsStateMatches(vaultPath, receipt)) {
        return { status: "stale", operationId: operation.id,
          ...(current ? { currentRevisionId: `sha256:${current}` } : {}) };
      }
      if (!existingReceipt) persistRedoReceipt(vaultPath, redoReceipt);
      complete(vaultPath, redoReceipt);
      return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
        redoOperationId: redoReceipt.operationId, revisionId: `sha256:${redoReceipt.mergedHash}` };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0; let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      if (readOperation(vaultPath, receipt.operationId)) continue;
      try { complete(vaultPath, receipt); recovered += 1; } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #scope(activeVaultId: string, vaultPath: string): boolean {
    const vault = this.#vaults.current();
    return !!vault && vault.vaultId === activeVaultId && this.#vaults.activeVaultPath() === vaultPath;
  }
}

function readPage(vaultPath: string, pageId: string): PageState | undefined {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located || located.page.summary.pageType !== "topic" || located.page.summary.status !== "active" ||
    located.signature.sizeBytes > MAX_BYTES) return undefined;
  const markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_BYTES + 1).markdown;
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || parsed.frontmatter.id !== pageId || parsed.frontmatter.type !== "topic" || parsed.frontmatter.status !== "active") return undefined;
  const contentHash = sha(markdown);
  return { pageId, title: located.page.summary.title, pagePath: located.page.summary.pagePath,
    absolutePath: located.page.absolutePath, markdown, contentHash, revision: `noteeditrev_${contentHash}`,
    renderProof: `knowledge_health_render_${sha(`${pageId}\0${located.signature.pagePath}\0${contentHash}\0${located.signature.deviceId}\0${located.signature.fileId}\0${located.signature.mtimeMs}\0${located.signature.sizeBytes}`)}` };
}

function matchesContext(context: RepairContext, request: KnowledgeHealthDuplicateTopicRepairRequest): boolean {
  const pages = new Map(context.pages.map((page) => [page.pageId, page]));
  const survivor = pages.get(request.survivorPageId); const absorbed = pages.get(request.absorbedPageId);
  return context.activeVaultId === request.activeVaultId && context.reportRequestId === request.reportRequestId &&
    context.indexGeneration === request.indexGeneration && !!survivor && !!absorbed &&
    survivor.revision === request.survivorRevision && survivor.renderProof === request.survivorRenderProof &&
    absorbed.revision === request.absorbedRevision && absorbed.renderProof === request.absorbedRenderProof;
}

function snapshotMatches(snapshot: LocalDatabaseKnowledgeHealthSnapshot, context: RepairContext): boolean {
  const expected = [...context.pages.map(({ pageId }) => pageId)].sort().join(":");
  return snapshot.invalidPageCount === 0 && snapshot.indexGeneration === context.indexGeneration &&
    snapshot.issues.some((issue) => issue.kind === "duplicate_topic" && issue.candidatePageCount === 2 &&
      issue.pages.map(({ pageId }) => pageId).sort().join(":") === expected);
}

function matchesRequestPage(page: PageState, request: KnowledgeHealthDuplicateTopicRepairRequest, role: "survivor" | "absorbed"): boolean {
  return page.revision === request[`${role}Revision`] && page.renderProof === request[`${role}RenderProof`];
}

function mergeTopics(survivor: string, absorbed: string, absorbedTitle: string, updatedAt: string): string {
  const parsed = parsePigeFrontmatter(survivor); const other = parsePigeFrontmatter(absorbed);
  if (!parsed || !other) throw new Error("topic frontmatter invalid");
  let raw = parsed.raw;
  for (const key of ["aliases", "tags", "topics", "source_ids"] as const) {
    const values = [...new Set([...(parsed.frontmatter[key] ?? []), ...(other.frontmatter[key] ?? []),
      ...(key === "aliases" ? [absorbedTitle, String(other.frontmatter.id)] : [])])];
    raw = replaceField(raw, key, values.slice(0, key === "source_ids" ? 1_000 : 64));
  }
  raw = replaceField(raw, "updated_at", updatedAt);
  return `---\n${raw.trimEnd()}\n---\n\n${survivor.slice(parsed.bodyStartOffset).trimEnd()}\n\n## ${absorbedTitle.replace(/[\r\n#]/gu, " ").trim()}\n\n${stripPigeFrontmatter(absorbed).trim()}\n`;
}

function replaceField(raw: string, key: string, value: string | readonly string[]): string {
  const line = `${key}: ${JSON.stringify(value)}`; const pattern = new RegExp(`^${key}:.*$`, "mu");
  return pattern.test(raw) ? raw.replace(pattern, line) : `${raw.trimEnd()}\n${line}\n`;
}

function createReceipt(vaultPath: string, request: KnowledgeHealthDuplicateTopicRepairRequest, survivor: PageState,
  absorbed: PageState, merged: string, createdAt: string, randomId: string): Receipt {
  const operationId = `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${randomId.replaceAll("-", "").slice(0, 24).toLowerCase()}`;
  const root = `${ROOT}/${request.requestId}`;
  return { schemaVersion: 1, kind: "knowledge_health_duplicate_topic_merge", requestId: request.requestId,
    requestDigest: digest(request), survivorPageId: survivor.pageId, absorbedPageId: absorbed.pageId,
    survivorPath: relative(vaultPath, survivor.absolutePath), absorbedPath: relative(vaultPath, absorbed.absolutePath),
    trashPath: `.pige/trash/knowledge-health-topic-merge/${operationId}/${path.basename(absorbed.pagePath)}`,
    beforePath: `${root}/survivor-before.md`, absorbedBeforePath: `${root}/absorbed-before.md`, mergedPath: `${root}/merged.md`,
    survivorBeforeHash: survivor.contentHash, absorbedBeforeHash: absorbed.contentHash, mergedHash: sha(merged),
    survivorTitle: survivor.title, absorbedTitle: absorbed.title, operationId, createdAt };
}

function persistIntent(vaultPath: string, receipt: Receipt, before: string, absorbed: string, merged: string): void {
  writeExclusive(resolve(vaultPath, receipt.beforePath), before); writeExclusive(resolve(vaultPath, receipt.absorbedBeforePath), absorbed);
  writeExclusive(resolve(vaultPath, receipt.mergedPath), merged); writeExclusive(receiptPath(vaultPath, receipt.requestId), JSON.stringify(receipt));
}

function createRedoReceipt(parent: Receipt, undo: OperationRecord, createdAt: string): Receipt {
  return { ...parent,
    requestId: `duplicatetopicredoreq_${sha(parent.operationId).slice(0, 32)}`,
    requestDigest: sha(`${parent.operationId}\0${undo.id}\0${parent.survivorBeforeHash}\0${parent.absorbedBeforeHash}\0${parent.mergedHash}`),
    operationId: redoOperationId(parent.operationId), createdAt,
    redoOfOperationId: parent.operationId, undoOperationId: undo.id };
}

function persistRedoReceipt(vaultPath: string, receipt: Receipt): void {
  writeExclusive(receiptPath(vaultPath, receipt.requestId), JSON.stringify(receipt));
}

function complete(vaultPath: string, receipt: Receipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) { if (!matchesOperation(receipt, existing)) throw new Error("operation conflict"); return; }
  const survivor = resolve(vaultPath, receipt.survivorPath); const absorbed = resolve(vaultPath, receipt.absorbedPath);
  const trash = resolve(vaultPath, receipt.trashPath);
  if (fileHash(survivor) === receipt.survivorBeforeHash) atomicReplace(survivor, fs.readFileSync(resolve(vaultPath, receipt.mergedPath)));
  else if (fileHash(survivor) !== receipt.mergedHash) throw new Error("survivor changed");
  if (fileHash(absorbed) === receipt.absorbedBeforeHash && fileHash(trash) === undefined) {
    fs.mkdirSync(path.dirname(trash), { recursive: true }); fs.renameSync(absorbed, trash);
  } else if (!(fileHash(absorbed) === undefined && fileHash(trash) === receipt.absorbedBeforeHash)) throw new Error("absorbed changed");
  writeOperation(vaultPath, OperationRecordSchema.parse({ id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: [{ kind: "page", id: receipt.survivorPageId, checksum: `sha256:${receipt.mergedHash}` },
      { kind: "page", id: receipt.absorbedPageId, checksum: `sha256:${receipt.absorbedBeforeHash}` }],
    sourceRefs: receipt.redoOfOperationId && receipt.undoOperationId
      ? [{ kind: "operation", id: receipt.redoOfOperationId }, { kind: "operation", id: receipt.undoOperationId }]
      : [],
    before: { kind: "operation", id: receipt.requestId, checksum: `sha256:${receipt.survivorBeforeHash}` },
    after: { kind: "page", id: receipt.survivorPageId, checksum: `sha256:${receipt.mergedHash}` },
    summary: `${receipt.redoOfOperationId ? "Reapplied" : "Merged"} two duplicate topics from Knowledge Health.`,
    reversible: "yes", warnings: [] }));
}

function restore(vaultPath: string, receipt: Receipt): void {
  atomicReplace(resolve(vaultPath, receipt.survivorPath), fs.readFileSync(resolve(vaultPath, receipt.beforePath)));
  const live = resolve(vaultPath, receipt.absorbedPath); const trash = resolve(vaultPath, receipt.trashPath);
  fs.mkdirSync(path.dirname(live), { recursive: true }); fs.renameSync(trash, live);
}

function matchesOperation(receipt: Receipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "update_page" && operation.targetRefs.length === 2 &&
    operation.targetRefs[0]?.kind === "page" && operation.targetRefs[0].id === receipt.survivorPageId &&
    operation.targetRefs[0].checksum === `sha256:${receipt.mergedHash}` &&
    operation.targetRefs[1]?.kind === "page" && operation.targetRefs[1].id === receipt.absorbedPageId &&
    operation.targetRefs[1].checksum === `sha256:${receipt.absorbedBeforeHash}` &&
    operation.before?.checksum === `sha256:${receipt.survivorBeforeHash}` &&
    operation.after?.checksum === `sha256:${receipt.mergedHash}` &&
    (receipt.redoOfOperationId && receipt.undoOperationId
      ? operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.redoOfOperationId) &&
        operation.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === receipt.undoOperationId)
      : operation.sourceRefs.length === 0);
}
function matchesUndoOperation(operation: OperationRecord, undo: OperationRecord): boolean {
  return undo.id === undoId(operation.id) && undo.kind === "update_page" &&
    undo.sourceRefs.some((reference) => reference.kind === "operation" && reference.id === operation.id) &&
    undo.before?.checksum === operation.after?.checksum && undo.after?.checksum === operation.before?.checksum;
}
function matchesRedoReceipt(child: Receipt, parent: Receipt, undo: OperationRecord): boolean {
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId) && child.survivorPageId === parent.survivorPageId &&
    child.absorbedPageId === parent.absorbedPageId && child.survivorPath === parent.survivorPath &&
    child.absorbedPath === parent.absorbedPath && child.trashPath === parent.trashPath &&
    child.beforePath === parent.beforePath && child.absorbedBeforePath === parent.absorbedBeforePath &&
    child.mergedPath === parent.mergedPath && child.survivorBeforeHash === parent.survivorBeforeHash &&
    child.absorbedBeforeHash === parent.absorbedBeforeHash && child.mergedHash === parent.mergedHash;
}
function mergeStateMatches(vaultPath: string, receipt: Receipt): boolean {
  return fileHash(resolve(vaultPath, receipt.survivorPath)) === receipt.mergedHash &&
    fileHash(resolve(vaultPath, receipt.absorbedPath)) === undefined && fileHash(resolve(vaultPath, receipt.trashPath)) === receipt.absorbedBeforeHash;
}
function originalsStateMatches(vaultPath: string, receipt: Receipt): boolean {
  return fileHash(resolve(vaultPath, receipt.survivorPath)) === receipt.survivorBeforeHash &&
    fileHash(resolve(vaultPath, receipt.absorbedPath)) === receipt.absorbedBeforeHash &&
    fileHash(resolve(vaultPath, receipt.trashPath)) === undefined;
}
function readReceipt(vaultPath: string, requestId: string): Receipt | undefined {
  const file = receiptPath(vaultPath, requestId); if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Receipt>;
  return value.schemaVersion === 1 && value.kind === "knowledge_health_duplicate_topic_merge" && value.requestId === requestId ? value as Receipt : undefined;
}
function listReceipts(vaultPath: string): Receipt[] {
  const root = resolve(vaultPath, ROOT); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; });
}
function findReceipt(vaultPath: string, operationId: string): Receipt | undefined { return listReceipts(vaultPath).find((r) => r.operationId === operationId); }
function findRedoReceipt(vaultPath: string, operationId: string): Receipt | undefined {
  const matches = listReceipts(vaultPath).filter((receipt) => receipt.redoOfOperationId === operationId);
  if (matches.length > 1) throw new Error("multiple duplicate-topic Redo receipts");
  return matches[0];
}
function receiptPath(vaultPath: string, requestId: string): string { return resolve(vaultPath, `${ROOT}/${requestId}/receipt.json`); }
function undoId(operationId: string): string { return `${operationId}undo`; }
function redoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("duplicate-topic Redo operation id invalid");
  return `op_${date}_${sha(`pige.duplicate-topic-redo.v1\0${operationId}`).slice(0, 16)}`;
}
function digest(value: unknown): string { return sha(JSON.stringify(value)); }
function sha(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function fileHash(file: string): string | undefined { try { return sha(fs.readFileSync(file)); } catch (caught) { if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw caught; } }
function relative(vaultPath: string, absolute: string): string { const value = path.relative(path.resolve(vaultPath), absolute); if (!value || value.startsWith("..") || path.isAbsolute(value)) throw new Error("path escape"); return value.split(path.sep).join("/"); }
function resolve(vaultPath: string, relativePath: string): string { const root = path.resolve(vaultPath); const target = path.resolve(root, ...relativePath.split("/")); if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error("path escape"); return target; }
function writeExclusive(file: string, value: string): void { fs.mkdirSync(path.dirname(file), { recursive: true }); const descriptor = fs.openSync(file, "wx", 0o600); try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } }
function atomicReplace(file: string, bytes: Buffer): void { const temp = `${file}.${randomUUID()}.tmp`; const descriptor = fs.openSync(temp, "wx", 0o600); try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } fs.renameSync(temp, file); }
function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined { const [, date] = /^op_(\d{8})_/u.exec(operationId) ?? []; if (!date) return undefined; const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`); return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : undefined; }
function writeOperation(vaultPath: string, operation: OperationRecord): void { const [, date] = /^op_(\d{8})_/u.exec(operation.id) ?? []; if (!date) throw new Error("operation id invalid"); const file = resolve(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operation.id}.json`); if (fs.existsSync(file)) { if (JSON.stringify(readOperation(vaultPath, operation.id)) !== JSON.stringify(operation)) throw new Error("operation conflict"); return; } writeExclusive(file, JSON.stringify(operation)); }
function committed(request: KnowledgeHealthDuplicateTopicRepairRequest, operationId: string): KnowledgeHealthDuplicateTopicRepairResult { return KnowledgeHealthDuplicateTopicRepairResultSchema.parse({ ...request, status: "committed", operationId }); }
function result(request: KnowledgeHealthDuplicateTopicRepairRequest, status: "stale" | "not_found" | "ineligible" | "failed"): KnowledgeHealthDuplicateTopicRepairResult { return KnowledgeHealthDuplicateTopicRepairResultSchema.parse({ ...request, status }); }
