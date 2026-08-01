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
import {
  findMarkdownPageByIdAtSignature,
  readMarkdownPageContentAtSignature,
  scanMarkdownPages
} from "./markdown-page-index";
import { readEntityType } from "./entity-type-service";
import type { NotesTrashResolution } from "./notes-service";

const ROOT = ".pige/entity-merges";
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_AFFECTED_PAGES = 64;
const MAX_ENTITY_IDENTIFIERS = 64;
const MUTABLE_REFERENCE_TYPES = new Set(["note", "claim", "question", "concept", "entity", "topic"]);

export interface EntityMergeVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}
export interface EntityMergeCurrentPort {
  resolveTrashTarget(ownerId: string, request: {
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
    readonly expectedRevision: string;
  }): NotesTrashResolution;
}
export type EntityMergeResult =
  | { readonly status: "committed"; readonly operationId: string }
  | { readonly status: "stale" | "not_found" | "ineligible" | "failed" }
  | undefined;

interface PageImage {
  readonly pageId: string;
  readonly path: string;
  readonly beforePath: string;
  readonly afterPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}
interface EntityReceipt {
  readonly schemaVersion: 1;
  readonly kind: "entity_merge_receipt";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly survivorPageId: string;
  readonly absorbedPageId: string;
  readonly survivorTitle: string;
  readonly absorbedTitle: string;
  readonly absorbedPath: string;
  readonly absorbedTrashPath: string;
  readonly absorbedBeforePath: string;
  readonly absorbedBeforeHash: string;
  readonly images: readonly PageImage[];
  readonly operationId: string;
  readonly createdAt: string;
  readonly redoOfOperationId?: string;
  readonly undoOperationId?: string;
}
interface EntityPage {
  readonly pageId: string;
  readonly title: string;
  readonly absolutePath: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly hash: string;
  readonly entityType: string;
  assertCurrent(): boolean;
}

export class EntityMergeService {
  constructor(
    readonly vaults: EntityMergeVaultPort,
    readonly current: EntityMergeCurrentPort,
    readonly now: () => Date = () => new Date(),
    readonly randomId: () => string = randomUUID
  ) {}

  merge(ownerId: string, request: NoteMergeRequest): EntityMergeResult {
    const vaultPath = this.#scope(request.activeVaultId);
    if (!vaultPath) return { status: "stale" };
    try {
      const existing = readReceipt(vaultPath, request.requestId);
      if (existing) {
        if (existing.requestDigest !== digest(request)) return { status: "stale" };
        complete(vaultPath, existing);
        return { status: "committed", operationId: existing.operationId };
      }
      const survivorTarget = this.current.resolveTrashTarget(ownerId, {
        activeVaultId: request.activeVaultId, pageId: request.currentPageId,
        renderContextId: request.renderContextId, expectedRevision: request.expectedRevision
      });
      if (survivorTarget.status !== "ready") return { status: survivorTarget.status };
      if (survivorTarget.pageType !== "entity") return undefined;
      const survivor = readEntity(vaultPath, request.currentPageId, survivorTarget.pageContentHash);
      const absorbed = readEntity(vaultPath, request.targetPageId, undefined, request.expectedTargetUpdatedAt);
      if (!survivor || !absorbed) return { status: "not_found" };
      if (survivor.entityType !== absorbed.entityType) return { status: "ineligible" };
      if (!survivorTarget.assertCurrent() || !survivor.assertCurrent() || !absorbed.assertCurrent()) {
        return { status: "stale" };
      }
      const createdAt = this.now().toISOString();
      const plan = createPlan(vaultPath, survivor, absorbed, createdAt);
      if (!plan) return { status: "ineligible" };
      const operationId = operationIdFor(createdAt, request.requestId, this.randomId());
      const receipt = createReceipt(vaultPath, request, survivor, absorbed, plan, operationId, createdAt);
      persistIntent(vaultPath, receipt, plan, absorbed.markdown);
      if (!survivorTarget.assertCurrent() || !receiptBeforeStateMatches(vaultPath, receipt)) {
        discardUncommittedIntent(vaultPath, receipt);
        return { status: "stale" };
      }
      complete(vaultPath, receipt);
      return { status: "committed", operationId };
    } catch {
      return { status: "failed" };
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.vaults.activeVaultPath();
    if (!vaultPath || operation.kind !== "update_page") return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const undone = !!undo && matchesUndo(operation, undo);
    const current = undone ? beforeStateMatches(vaultPath, receipt) : mergedStateMatches(vaultPath, receipt);
    const redoReceipt = undone ? findRedoReceipt(vaultPath, operation.id) : undefined;
    const redoOperation = redoReceipt ? readOperation(vaultPath, redoReceipt.operationId) : undefined;
    const matchingRedo = !!redoReceipt && !!redoOperation && matchesOperation(redoReceipt, redoOperation);
    const canRedo = undone && !redoOperation && current;
    return { operationId: operation.id, kind: "update_page", createdAt: operation.createdAt,
      targetLabel: receipt.survivorTitle, target: { kind: "page", pageId: receipt.survivorPageId },
      status: undone ? "undone" : "applied", canUndo: !undone && current,
      ...(undone ? { canRedo, ...(!canRedo ? { redoUnavailableReason: matchingRedo
        ? "already_redone" as const : "content_changed" as const } : {}) } : {}),
      ...(undone ? { undoUnavailableReason: "already_undone" as const } : {}),
      ...(!undone && !current ? { undoUnavailableReason: "content_changed" as const } : {}) };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    const vaultPath = this.vaults.activeVaultPath();
    const receipt = vaultPath ? findReceipt(vaultPath, operation.id) : undefined;
    return receipt && matchesOperation(receipt, operation)
      ? operations.find((candidate) => matchesUndo(operation, candidate)) : undefined;
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult | undefined {
    const vaultPath = this.vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = findReceipt(vaultPath, operation.id);
    if (!receipt || !matchesOperation(receipt, operation)) return undefined;
    const id = undoOperationId(operation.id);
    if (readOperation(vaultPath, id)) return { status: "already_undone", operationId: operation.id, undoOperationId: id };
    if (!mergedStateMatches(vaultPath, receipt)) return { status: "stale", operationId: operation.id };
    restore(vaultPath, receipt);
    writeOperation(vaultPath, OperationRecordSchema.parse({ id, schemaVersion: 1, createdAt: this.now().toISOString(),
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
      targetRefs: operation.targetRefs, sourceRefs: [{ kind: "operation", id: operation.id }], before: operation.after,
      after: { kind: "page", id: receipt.survivorPageId, checksum: receipt.images[0]!.beforeHash },
      summary: "Restored both entities and every exact mention changed by the merge.", reversible: "no", warnings: [] }));
    return { status: "undone", operationId: operation.id, undoOperationId: id };
  }

  redo(request: KnowledgeActivityRedoRequest): KnowledgeActivityRedoResult | undefined {
    const vaultPath = this.vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    try {
      const operation = readOperation(vaultPath, request.operationId);
      const receipt = operation ? findReceipt(vaultPath, operation.id) : undefined;
      if (!operation || !receipt || !matchesOperation(receipt, operation)) return undefined;
      const undo = readOperation(vaultPath, undoOperationId(operation.id));
      if (!undo || !matchesUndo(operation, undo)) return { status: "not_found", operationId: operation.id };
      const existingReceipt = findRedoReceipt(vaultPath, operation.id);
      if (existingReceipt && !matchesRedoReceipt(existingReceipt, receipt, undo)) {
        return { status: "stale", operationId: operation.id };
      }
      const redoReceipt = existingReceipt ?? createRedoReceipt(receipt, undo, this.now().toISOString());
      const existingOperation = readOperation(vaultPath, redoReceipt.operationId);
      if (existingOperation) {
        if (!matchesOperation(redoReceipt, existingOperation) || !mergedStateMatches(vaultPath, redoReceipt)) {
          return { status: "stale", operationId: operation.id };
        }
        return { status: "already_redone", operationId: operation.id, undoOperationId: undo.id,
          redoOperationId: existingOperation.id, revisionId: redoReceipt.images[0]!.afterHash };
      }
      const survivorRevision = fileHash(resolvePath(vaultPath, receipt.images[0]!.path));
      if ((request.expectedRevisionId !== undefined && request.expectedRevisionId !== receipt.images[0]!.beforeHash) ||
        !beforeStateMatches(vaultPath, receipt)) {
        return { status: "stale", operationId: operation.id,
          ...(survivorRevision ? { currentRevisionId: survivorRevision } : {}) };
      }
      if (!existingReceipt) persistRedoReceipt(vaultPath, redoReceipt);
      complete(vaultPath, redoReceipt);
      return { status: "redone", operationId: operation.id, undoOperationId: undo.id,
        redoOperationId: redoReceipt.operationId, revisionId: redoReceipt.images[0]!.afterHash };
    } catch {
      return { status: "stale", operationId: request.operationId };
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0; let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      if (readOperation(vaultPath, receipt.operationId)) continue;
      try { complete(vaultPath, receipt); recovered += 1; } catch { failed += 1; }
    }
    return { recovered, failed };
  }

  #scope(activeVaultId: string): string | undefined {
    const vault = this.vaults.current(); const vaultPath = this.vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? vaultPath : undefined;
  }
}

function readEntity(vaultPath: string, pageId: string, expectedHash?: string, expectedUpdatedAt?: string): EntityPage | undefined {
  const located = findMarkdownPageByIdAtSignature(vaultPath, pageId);
  if (!located || located.page.summary.pageType !== "entity" || located.page.summary.status !== "active" ||
    located.signature.sizeBytes > MAX_PAGE_BYTES ||
    (expectedUpdatedAt !== undefined && located.page.summary.updatedAt !== expectedUpdatedAt)) return undefined;
  const markdown = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_PAGE_BYTES + 1).markdown;
  const parsed = parsePigeFrontmatter(markdown); const hash = sha(markdown);
  const entityType = parsed ? readEntityType(parsed.raw) : undefined;
  if (!parsed || parsed.frontmatter.id !== pageId || parsed.frontmatter.type !== "entity" ||
    parsed.frontmatter.status !== "active" || entityType === undefined ||
    (expectedHash !== undefined && expectedHash !== hash)) return undefined;
  const signature = located.signature;
  return { pageId, title: located.page.summary.title, absolutePath: located.page.absolutePath,
    pagePath: located.page.summary.pagePath, markdown, hash, entityType, assertCurrent: () => {
      const current = findMarkdownPageByIdAtSignature(vaultPath, pageId);
      return Boolean(current && current.page.summary.updatedAt === located.page.summary.updatedAt &&
        current.signature.deviceId === signature.deviceId && current.signature.fileId === signature.fileId &&
        current.signature.mtimeMs === signature.mtimeMs && current.signature.sizeBytes === signature.sizeBytes);
    } };
}

function createPlan(vaultPath: string, survivor: EntityPage, absorbed: EntityPage, updatedAt: string):
  readonly { readonly pageId: string; readonly absolutePath: string; readonly before: string; readonly after: string }[] | undefined {
  const merged = mergeEntities(survivor.markdown, absorbed.markdown, survivor.pageId, absorbed.pageId, absorbed.title, updatedAt);
  if (!merged || Buffer.byteLength(merged, "utf8") > MAX_PAGE_BYTES) return undefined;
  const changes = [{ pageId: survivor.pageId, absolutePath: survivor.absolutePath, before: survivor.markdown, after: merged }];
  for (const page of scanMarkdownPages(vaultPath).pages) {
    if (page.summary.pageId === survivor.pageId || page.summary.pageId === absorbed.pageId ||
      (!page.knowledge.entities.includes(absorbed.pageId) && !page.knowledge.relatedPageIds.includes(absorbed.pageId))) continue;
    if (!MUTABLE_REFERENCE_TYPES.has(page.summary.pageType)) return undefined;
    if (changes.length > MAX_AFFECTED_PAGES) return undefined;
    const located = findMarkdownPageByIdAtSignature(vaultPath, page.summary.pageId);
    if (!located || located.signature.sizeBytes > MAX_PAGE_BYTES) return undefined;
    const before = readMarkdownPageContentAtSignature(vaultPath, located.signature, MAX_PAGE_BYTES + 1).markdown;
    const after = replaceEntityReferences(before, absorbed.pageId, survivor.pageId, updatedAt);
    if (!after || Buffer.byteLength(after, "utf8") > MAX_PAGE_BYTES) return undefined;
    changes.push({ pageId: page.summary.pageId, absolutePath: page.absolutePath, before, after });
  }
  return changes;
}

function mergeEntities(survivor: string, absorbed: string, survivorId: string, absorbedId: string,
  absorbedTitle: string, updatedAt: string): string | undefined {
  const current = parsePigeFrontmatter(survivor); const other = parsePigeFrontmatter(absorbed);
  const currentMetadata = current ? readEntityMetadata(current.raw) : undefined;
  const otherMetadata = other ? readEntityMetadata(other.raw) : undefined;
  if (!current || !other || !currentMetadata || !otherMetadata ||
    readEntityType(current.raw) !== readEntityType(other.raw)) return undefined;
  const rawStart = survivor.indexOf(current.raw); if (rawStart < 0) return undefined;
  const aliases = unique([...(current.frontmatter.aliases ?? []), absorbedTitle, otherMetadata.canonicalName,
    ...(other.frontmatter.aliases ?? [])]);
  const tags = unique([...(current.frontmatter.tags ?? []), ...(other.frontmatter.tags ?? [])]);
  const topics = unique([...(current.frontmatter.topics ?? []), ...(other.frontmatter.topics ?? [])]);
  const sourceIds = unique([...(current.frontmatter.source_ids ?? []), ...(other.frontmatter.source_ids ?? [])]);
  const entities = unique([...(current.frontmatter.entities ?? []), ...(other.frontmatter.entities ?? [])])
    .map((id) => id === absorbedId ? survivorId : id).filter((id) => id !== survivorId);
  const related = unique([...(current.frontmatter.related_page_ids ?? []), ...(other.frontmatter.related_page_ids ?? [])])
    .map((id) => id === absorbedId ? survivorId : id).filter((id) => id !== survivorId);
  const identifiers = uniqueExact([...currentMetadata.identifiers, ...otherMetadata.identifiers]);
  if (aliases.length > 64 || tags.length > 12 || topics.length > 8 || sourceIds.length > 1_000 ||
    entities.length > 12 || related.length > 64 || identifiers.length > MAX_ENTITY_IDENTIFIERS) return undefined;
  let raw = replaceArray(current.raw, "aliases", aliases); raw = raw && replaceArray(raw, "tags", tags);
  raw = raw && replaceArray(raw, "topics", topics); raw = raw && replaceArray(raw, "source_ids", sourceIds);
  raw = raw && replaceArray(raw, "entities", entities); raw = raw && replaceArray(raw, "related_page_ids", related);
  raw = raw && replaceEntityIdentifiers(raw, identifiers);
  raw = raw && replaceScalar(raw, "updated_at", updatedAt); if (!raw) return undefined;
  const body = survivor.slice(current.bodyStartOffset).trimEnd(); const absorbedBody = stripPigeFrontmatter(absorbed).trim();
  return `---\n${raw.trimEnd()}\n---\n\n${body}\n\n## ${escapeHeading(absorbedTitle)}\n\n${absorbedBody}\n`;
}

function replaceEntityReferences(markdown: string, absorbedId: string, survivorId: string, updatedAt: string): string | undefined {
  const parsed = parsePigeFrontmatter(markdown); if (!parsed) return undefined;
  const entities = parsed.frontmatter.entities ?? [], related = parsed.frontmatter.related_page_ids ?? [];
  if (!entities.includes(absorbedId) && !related.includes(absorbedId)) return undefined;
  const nextEntities = unique(entities.map((id) => id === absorbedId ? survivorId : id));
  const nextRelated = unique(related.map((id) => id === absorbedId ? survivorId : id));
  if (nextEntities.length > 12 || nextRelated.length > 64) return undefined;
  let raw = entities.includes(absorbedId) ? replaceArray(parsed.raw, "entities", nextEntities) : parsed.raw;
  raw = raw && (related.includes(absorbedId) ? replaceArray(raw, "related_page_ids", nextRelated) : raw);
  raw = raw && replaceScalar(raw, "updated_at", updatedAt);
  const offset = markdown.indexOf(parsed.raw); return raw && offset >= 0
    ? `${markdown.slice(0, offset)}${raw}${markdown.slice(offset + parsed.raw.length)}` : undefined;
}

function readEntityMetadata(raw: string): { readonly canonicalName: string; readonly identifiers: readonly string[] } | undefined {
  const section = entitySection(raw); if (!section) return undefined;
  const canonicalLines = [...section.text.matchAll(/^  canonical_name:\s*([^\r\n]+)$/gmu)];
  const identifierLines = [...section.text.matchAll(/^  identifiers:\s*([^\r\n]+)$/gmu)];
  if (canonicalLines.length !== 1 || identifierLines.length !== 1) return undefined;
  const canonicalName = parseStringScalar(canonicalLines[0]![1] ?? "");
  let identifiers: unknown;
  try { identifiers = JSON.parse(identifierLines[0]![1] ?? ""); } catch { return undefined; }
  if (!canonicalName || canonicalName.length > 256 || !Array.isArray(identifiers) ||
    identifiers.length > MAX_ENTITY_IDENTIFIERS || identifiers.some((value) => typeof value !== "string" ||
      value.length < 1 || value.length > 256 || value !== value.normalize("NFKC").trim())) return undefined;
  return { canonicalName, identifiers: identifiers as string[] };
}

function replaceEntityIdentifiers(raw: string, identifiers: readonly string[]): string | undefined {
  const section = entitySection(raw); if (!section) return undefined;
  const matches = [...section.text.matchAll(/^  identifiers:[^\r\n]*$/gmu)];
  if (matches.length !== 1) return undefined;
  const match = matches[0]!, start = section.start + (match.index ?? 0), end = start + match[0].length;
  return `${raw.slice(0, start)}  identifiers: ${JSON.stringify(identifiers)}${raw.slice(end)}`;
}

function entitySection(raw: string): { readonly start: number; readonly text: string } | undefined {
  const headings = [...raw.matchAll(/^entity:\s*$/gmu)]; if (headings.length !== 1) return undefined;
  const start = headings[0]!.index ?? 0, following = raw.slice(start + headings[0]![0].length);
  const next = following.search(/\r?\n(?=[a-z][a-z0-9_]*:)/u);
  return { start, text: raw.slice(start, next < 0 ? raw.length : start + headings[0]![0].length + next) };
}

function parseStringScalar(value: string): string | undefined {
  const trimmed = value.trim(); if (!trimmed) return undefined;
  if (trimmed.startsWith('"')) {
    try { const parsed: unknown = JSON.parse(trimmed); return typeof parsed === "string" ? parsed : undefined; }
    catch { return undefined; }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}

function createReceipt(vaultPath: string, request: NoteMergeRequest, survivor: EntityPage, absorbed: EntityPage,
  plan: readonly { readonly pageId: string; readonly absolutePath: string; readonly before: string; readonly after: string }[],
  operationId: string, createdAt: string): EntityReceipt {
  const root = `${ROOT}/${request.requestId}`;
  return { schemaVersion: 1, kind: "entity_merge_receipt", requestId: request.requestId,
    requestDigest: digest(request), activeVaultId: request.activeVaultId, survivorPageId: survivor.pageId,
    absorbedPageId: absorbed.pageId, survivorTitle: survivor.title, absorbedTitle: absorbed.title,
    absorbedPath: relativePath(vaultPath, absorbed.absolutePath),
    absorbedTrashPath: `.pige/trash/entity-merge/${operationId}/${path.basename(absorbed.pagePath)}`,
    absorbedBeforePath: `${root}/absorbed-before.md`, absorbedBeforeHash: absorbed.hash,
    images: plan.map((image, index) => ({ pageId: image.pageId, path: relativePath(vaultPath, image.absolutePath),
      beforePath: `${root}/pages/${index}-before.md`, afterPath: `${root}/pages/${index}-after.md`,
      beforeHash: sha(image.before), afterHash: sha(image.after) })), operationId, createdAt };
}

function persistIntent(vaultPath: string, receipt: EntityReceipt,
  plan: readonly { readonly before: string; readonly after: string }[], absorbed: string): void {
  for (const [index, image] of receipt.images.entries()) {
    writeExclusive(resolvePath(vaultPath, image.beforePath), plan[index]!.before);
    writeExclusive(resolvePath(vaultPath, image.afterPath), plan[index]!.after);
  }
  writeExclusive(resolvePath(vaultPath, receipt.absorbedBeforePath), absorbed);
  writeExclusive(receiptPath(vaultPath, receipt.requestId), JSON.stringify(receipt));
}

function complete(vaultPath: string, receipt: EntityReceipt): void {
  const existing = readOperation(vaultPath, receipt.operationId);
  if (existing) { if (!matchesOperation(receipt, existing)) throw new Error("operation conflict"); return; }
  const imageStates = receipt.images.map((image) => fileHash(resolvePath(vaultPath, image.path)));
  if (imageStates.some((current, index) => current !== receipt.images[index]!.beforeHash &&
    current !== receipt.images[index]!.afterHash)) throw new Error("affected page changed");
  const absorbed = resolvePath(vaultPath, receipt.absorbedPath); const trash = resolvePath(vaultPath, receipt.absorbedTrashPath);
  const liveHash = fileHash(absorbed); const trashHash = fileHash(trash);
  if (!((liveHash === receipt.absorbedBeforeHash && trashHash === undefined) ||
    (liveHash === undefined && trashHash === receipt.absorbedBeforeHash))) throw new Error("absorbed entity changed");
  for (const image of receipt.images) {
    const file = resolvePath(vaultPath, image.path); const hash = fileHash(file);
    if (hash === image.beforeHash) atomicReplace(file, readExact(resolvePath(vaultPath, image.afterPath)));
    else if (hash !== image.afterHash) throw new Error("affected page changed");
  }
  if (liveHash === receipt.absorbedBeforeHash && trashHash === undefined) {
    fs.mkdirSync(path.dirname(trash), { recursive: true }); fs.renameSync(absorbed, trash);
  } else if (!(liveHash === undefined && trashHash === receipt.absorbedBeforeHash)) throw new Error("absorbed entity changed");
  writeOperation(vaultPath, createOperation(receipt));
}

function restore(vaultPath: string, receipt: EntityReceipt): void {
  if (!mergedStateMatches(vaultPath, receipt)) throw new Error("entity merge changed");
  for (const image of receipt.images) atomicReplace(resolvePath(vaultPath, image.path), readExact(resolvePath(vaultPath, image.beforePath)));
  const live = resolvePath(vaultPath, receipt.absorbedPath); const trash = resolvePath(vaultPath, receipt.absorbedTrashPath);
  fs.mkdirSync(path.dirname(live), { recursive: true }); fs.renameSync(trash, live);
}

function createOperation(receipt: EntityReceipt): OperationRecord {
  return OperationRecordSchema.parse({ id: receipt.operationId, schemaVersion: 1, createdAt: receipt.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, kind: "update_page",
    targetRefs: [...receipt.images.map((image) => ({ kind: "page" as const, id: image.pageId, checksum: image.afterHash })),
      { kind: "page", id: receipt.absorbedPageId, checksum: receipt.absorbedBeforeHash }],
    sourceRefs: receipt.redoOfOperationId && receipt.undoOperationId
      ? [{ kind: "operation", id: receipt.redoOfOperationId }, { kind: "operation", id: receipt.undoOperationId }] : [],
    before: { kind: "operation", id: receipt.requestId, checksum: receipt.images[0]!.beforeHash },
    after: { kind: "page", id: receipt.survivorPageId, checksum: receipt.images[0]!.afterHash },
    summary: `${receipt.redoOfOperationId ? "Reapplied" : "Merged"} two entities and rewrote ${receipt.images.length - 1} exact mention pages.`,
    reversible: "yes", warnings: [] });
}

function createRedoReceipt(parent: EntityReceipt, undo: OperationRecord, createdAt: string): EntityReceipt {
  return { ...parent, requestId: `entitymergeredoreq_${sha(parent.operationId).slice(7, 39)}`,
    requestDigest: sha(`${parent.operationId}\0${undo.id}\0${parent.images.map(({ beforeHash, afterHash }) => `${beforeHash}:${afterHash}`).join("\0")}`),
    operationId: redoOperationId(parent.operationId), createdAt, redoOfOperationId: parent.operationId, undoOperationId: undo.id };
}
function persistRedoReceipt(vaultPath: string, receipt: EntityReceipt): void {
  writeExclusive(receiptPath(vaultPath, receipt.requestId), JSON.stringify(receipt));
}
function discardUncommittedIntent(vaultPath: string, receipt: EntityReceipt): void {
  if (readOperation(vaultPath, receipt.operationId) ||
    receipt.images.some((image) => fileHash(resolvePath(vaultPath, image.path)) === image.afterHash) ||
    fileHash(resolvePath(vaultPath, receipt.absorbedTrashPath)) !== undefined) return;
  fs.rmSync(resolvePath(vaultPath, `${ROOT}/${receipt.requestId}`), { recursive: true, force: true });
}
function receiptBeforeStateMatches(vaultPath: string, receipt: EntityReceipt): boolean {
  return receipt.images.every((image) => fileHash(resolvePath(vaultPath, image.path)) === image.beforeHash) &&
    fileHash(resolvePath(vaultPath, receipt.absorbedPath)) === receipt.absorbedBeforeHash &&
    fileHash(resolvePath(vaultPath, receipt.absorbedTrashPath)) === undefined;
}
function beforeStateMatches(vaultPath: string, receipt: EntityReceipt): boolean { return receiptBeforeStateMatches(vaultPath, receipt); }
function mergedStateMatches(vaultPath: string, receipt: EntityReceipt): boolean {
  return receipt.images.every((image) => fileHash(resolvePath(vaultPath, image.path)) === image.afterHash) &&
    fileHash(resolvePath(vaultPath, receipt.absorbedPath)) === undefined &&
    fileHash(resolvePath(vaultPath, receipt.absorbedTrashPath)) === receipt.absorbedBeforeHash;
}
function matchesOperation(receipt: EntityReceipt, operation: OperationRecord): boolean {
  return operation.id === receipt.operationId && operation.kind === "update_page" && operation.reversible === "yes" &&
    operation.after?.kind === "page" && operation.after.id === receipt.survivorPageId &&
    operation.after.checksum === receipt.images[0]?.afterHash;
}
function matchesUndo(operation: OperationRecord, undo: OperationRecord): boolean {
  return undo.id === undoOperationId(operation.id) && undo.kind === "update_page" &&
    undo.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === operation.id);
}
function matchesRedoReceipt(child: EntityReceipt, parent: EntityReceipt, undo: OperationRecord): boolean {
  return child.redoOfOperationId === parent.operationId && child.undoOperationId === undo.id &&
    child.operationId === redoOperationId(parent.operationId) && child.requestDigest === createRedoReceipt(parent, undo, child.createdAt).requestDigest;
}

function readReceipt(vaultPath: string, requestId: string): EntityReceipt | undefined {
  const file = receiptPath(vaultPath, requestId); if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(readExact(file, 256 * 1024).toString("utf8")) as Partial<EntityReceipt>;
  return value.schemaVersion === 1 && value.kind === "entity_merge_receipt" && value.requestId === requestId &&
    typeof value.operationId === "string" && Array.isArray(value.images) && value.images.length >= 1 &&
    value.images.length <= MAX_AFFECTED_PAGES + 1 ? value as EntityReceipt : undefined;
}
function listReceipts(vaultPath: string): EntityReceipt[] {
  const root = resolvePath(vaultPath, ROOT); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap((entry) => { const receipt = readReceipt(vaultPath, entry.name); return receipt ? [receipt] : []; });
}
function findReceipt(vaultPath: string, operationId: string): EntityReceipt | undefined {
  return listReceipts(vaultPath).find((receipt) => receipt.operationId === operationId);
}
function findRedoReceipt(vaultPath: string, operationId: string): EntityReceipt | undefined {
  const matches = listReceipts(vaultPath).filter((receipt) => receipt.redoOfOperationId === operationId);
  if (matches.length > 1) throw new Error("multiple Entity merge Redo receipts"); return matches[0];
}
function readOperation(vaultPath: string, operationId: string): OperationRecord | undefined {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1]; if (!date) return undefined;
  const file = resolvePath(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`);
  return fs.existsSync(file) ? OperationRecordSchema.parse(JSON.parse(readExact(file, 256 * 1024).toString("utf8"))) : undefined;
}
function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1]; if (!date) throw new Error("invalid operation ID");
  const file = resolvePath(vaultPath, `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operation.id}.json`);
  if (fs.existsSync(file)) { if (JSON.stringify(readOperation(vaultPath, operation.id)) !== JSON.stringify(operation)) throw new Error("operation conflict"); return; }
  writeExclusive(file, JSON.stringify(operation));
}

function replaceArray(raw: string, key: string, value: readonly string[]): string | undefined {
  const pattern = new RegExp(`^${key}:[^\\r\\n]*$`, "gmu"); const matches = [...raw.matchAll(pattern)];
  if (matches.length !== 1) return undefined; return raw.replace(new RegExp(`^${key}:[^\\r\\n]*$`, "mu"), `${key}: ${JSON.stringify(value)}`);
}
function replaceScalar(raw: string, key: string, value: string): string | undefined {
  const pattern = new RegExp(`^${key}:[^\\r\\n]*$`, "gmu"); const matches = [...raw.matchAll(pattern)];
  if (matches.length !== 1) return undefined; return raw.replace(new RegExp(`^${key}:[^\\r\\n]*$`, "mu"), `${key}: ${JSON.stringify(value)}`);
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim()).filter(Boolean))];
}
function uniqueExact(values: readonly string[]): string[] { return [...new Set(values)]; }
function escapeHeading(value: string): string { return value.replace(/[\r\n#]/gu, " ").replace(/\s+/gu, " ").trim(); }
function digest(request: NoteMergeRequest): string { return sha(JSON.stringify(request)); }
function sha(value: string | Buffer): `sha256:${string}` { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function operationIdFor(createdAt: string, requestId: string, randomId: string): string {
  return `op_${createdAt.slice(0, 10).replaceAll("-", "")}_${createHash("sha256").update(`${requestId}\0${randomId}`).digest("hex").slice(0, 16)}`;
}
function undoOperationId(operationId: string): string { return `${operationId}undo`; }
function redoOperationId(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1]; if (!date) throw new Error("invalid Entity merge Operation");
  return `op_${date}_${createHash("sha256").update(`pige.entity-merge-redo.v1\0${operationId}`).digest("hex").slice(0, 16)}`;
}
function receiptPath(vaultPath: string, requestId: string): string { return resolvePath(vaultPath, `${ROOT}/${requestId}/receipt.json`); }
function resolvePath(vaultPath: string, relative: string): string {
  const root = path.resolve(vaultPath); const target = path.resolve(root, ...relative.split("/"));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error("path escape"); return target;
}
function relativePath(vaultPath: string, absolute: string): string {
  const relative = path.relative(path.resolve(vaultPath), path.resolve(absolute));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escape");
  return relative.split(path.sep).join("/");
}
function readExact(file: string, max = MAX_PAGE_BYTES): Buffer {
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error("invalid file");
  return fs.readFileSync(file);
}
function fileHash(file: string): string | undefined {
  try { return sha(readExact(file)); } catch (caught) {
    if (typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT") return undefined;
    throw caught;
  }
}
function writeExclusive(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, value, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function atomicReplace(file: string, bytes: Buffer): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temp, file);
}
