import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import type { KnowledgeActivityRecoveryResult } from "./knowledge-activity-service";
import { acquireSourceRefreshLocator, readCurrentSourceRecordSnapshot } from "./source-file-access";
import { SourcePageService } from "./source-page-service";
import { redactSensitiveUrl, SourceFetchService, type SourceFetchSnapshot } from "./source-fetch-service";
import {
  sourceRefreshDisplayName,
  sourceRefreshFingerprint,
  sourceRefreshRevision
} from "./source-refresh-identity";
import type { SourceRefreshVaultPort } from "./source-refresh-service";

export interface WebSourceFetchPort {
  fetchSnapshot(url: string, signal?: AbortSignal): Promise<SourceFetchSnapshot>;
}

interface PendingWebPreview {
  readonly request: SourceRefreshPreviewRequest;
  readonly expectedRevision: string;
  readonly beforeRecord: SourceRecord;
  readonly snapshot: SourceFetchSnapshot;
  readonly rawChecksum: string;
  readonly rawSize: number;
  readonly extractedChecksum: string;
  readonly extractedSize: number;
  readonly createdAtMs: number;
}

interface WebRefreshReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly jobId: string;
  readonly sourceId: string;
  readonly state: "prepared" | "ready" | "applied" | "undone" | "rolled_back";
  readonly beforeRecord: SourceRecord;
  readonly beforeRevision: string;
  readonly afterRecord?: SourceRecord;
  readonly afterRevision?: string;
  readonly rawPathChecksum: string;
  readonly artifactPath: string;
  readonly pagePath?: string;
  readonly beforeRawBackup: string;
  readonly beforeArtifactBackup: string;
  readonly beforePageBackup?: string;
  readonly afterRawBackup?: string;
  readonly afterArtifactBackup?: string;
  readonly afterPageBackup?: string;
  readonly sourcePageConflict?: boolean;
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 8;
const MAX_SOURCE_RECORD_BYTES = 2 * 1024 * 1024;

export class WebSourceRefreshService {
  readonly #vaults: SourceRefreshVaultPort;
  readonly #fetcher: WebSourceFetchPort;
  readonly #sourcePages: SourcePageService;
  readonly #previews = new Map<string, PendingWebPreview>();

  constructor(
    vaults: SourceRefreshVaultPort,
    fetcher: WebSourceFetchPort = new SourceFetchService(),
    sourcePages = new SourcePageService()
  ) {
    this.#vaults = vaults;
    this.#fetcher = fetcher;
    this.#sourcePages = sourcePages;
  }

  isEligible(record: SourceRecord): boolean {
    return record.kind === "url" && record.storageStrategy === "copy_to_source_library" &&
      Boolean(record.managedCopy && webArtifact(record) && fetchUrl(record));
  }

  ownsPreview(previewId: string): boolean {
    return this.#previews.has(previewId);
  }

  async preview(
    request: SourceRefreshPreviewRequest,
    renderContextCurrent: () => boolean
  ): Promise<SourceRefreshPreviewResult> {
    this.#expirePreviews();
    const identity = { ...request };
    const scope = this.#scope(request.activeVaultId);
    if (!scope || !renderContextCurrent()) return { ...identity, status: "stale" };
    const current = readCurrentSourceRecordSnapshot(scope.vaultPath, request.sourceId)?.record;
    if (!current) return { ...identity, status: "not_found" };
    if (!this.isEligible(current)) return { ...identity, status: "ineligible" };
    try {
      const requestedUrl = fetchUrl(current)!;
      const snapshot = await this.#fetcher.fetchSnapshot(requestedUrl);
      if (normalizeHttpUrl(snapshot.originalUrl) !== normalizeHttpUrl(requestedUrl)) {
        throw new PigeDomainError("source.refresh_binding_changed", "The fetched web source identity changed.");
      }
      if (!renderContextCurrent() || !this.#sameScope(scope)) return { ...identity, status: "stale" };
      const afterFetch = readCurrentSourceRecordSnapshot(scope.vaultPath, request.sourceId)?.record;
      if (!afterFetch || sourceRefreshRevision(afterFetch) !== sourceRefreshRevision(current)) {
        return { ...identity, status: "stale" };
      }
      const raw = Buffer.from(snapshot.rawContent, "utf8");
      const extracted = Buffer.from(snapshot.extractedText, "utf8");
      const rawChecksum = checksum(raw);
      const extractedChecksum = checksum(extracted);
      const artifact = webArtifact(current)!;
      if (current.managedCopy!.checksum === rawChecksum && current.managedCopy!.size === raw.byteLength &&
        artifact.checksum === extractedChecksum && artifact.size === extracted.byteLength) {
        return { ...identity, status: "unchanged" };
      }
      if (this.#previews.size >= MAX_PREVIEWS) this.#disposeOldestPreview();
      const previewId = `sourcerefreshpreview_${randomUUID().replaceAll("-", "")}`;
      const expectedRevision = sourceRefreshRevision(current);
      this.#previews.set(previewId, {
        request,
        expectedRevision,
        beforeRecord: current,
        snapshot,
        rawChecksum,
        rawSize: raw.byteLength,
        extractedChecksum,
        extractedSize: extracted.byteLength,
        createdAtMs: Date.now()
      });
      return {
        ...identity,
        status: "changed",
        preview: {
          previewId,
          expectedSourceRevision: expectedRevision,
          displayName: sourceRefreshDisplayName(current),
          sourceKind: "url",
          previousSize: current.managedCopy!.size,
          currentSize: raw.byteLength,
          sizeDelta: raw.byteLength - current.managedCopy!.size,
          affectedArtifactCount: current.artifacts.length,
          refreshesSourcePage: Boolean(current.knowledgePageId)
        }
      };
    } catch (caught) {
      return { ...identity, status: caught instanceof PigeDomainError ? "unavailable" : "failed" };
    }
  }

  async confirm(
    request: SourceRefreshConfirmRequest,
    renderContextCurrent: () => boolean
  ): Promise<SourceRefreshConfirmResult> {
    this.#expirePreviews();
    const identity = { ...request };
    const pending = this.#previews.get(request.previewId);
    this.#previews.delete(request.previewId);
    if (!pending) return { ...identity, status: "stale" };
    try {
      const scope = this.#scope(request.activeVaultId);
      if (!scope || !renderContextCurrent() || !sameIdentity(pending.request, request) ||
        pending.expectedRevision !== request.expectedSourceRevision) return { ...identity, status: "stale" };
      const current = readCurrentSourceRecordSnapshot(scope.vaultPath, request.sourceId)?.record;
      if (!current) return { ...identity, status: "not_found" };
      if (!this.isEligible(current)) return { ...identity, status: "ineligible" };
      if (sourceRefreshRevision(current) !== pending.expectedRevision ||
        sourceRefreshRevision(current) !== sourceRefreshRevision(pending.beforeRecord)) {
        return { ...identity, status: "stale" };
      }
      if (!renderContextCurrent() || !this.#sameScope(scope)) return { ...identity, status: "stale" };
      const result = this.#publish(scope, current, pending);
      return { ...identity, status: "refreshed", ...result };
    } catch (caught) {
      return { ...identity, status: caught instanceof PigeDomainError && caught.code.includes("unavailable")
        ? "unavailable" : "failed" };
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath || !isWebRefreshOperation(operation)) return undefined;
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt) return undefined;
    const targetLabel = sourceRefreshDisplayName(receipt.beforeRecord);
    if (undo || receipt.state === "undone") {
      return { operationId: operation.id, kind: "update_source_record", createdAt: operation.createdAt,
        targetLabel, status: "undone", canUndo: false, undoUnavailableReason: "already_undone" };
    }
    const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
    const canUndo = Boolean(receipt.afterRevision && current && sourceRefreshRevision(current) === receipt.afterRevision);
    const pageId = receipt.afterRecord?.knowledgePageId ?? receipt.beforeRecord.knowledgePageId;
    return {
      operationId: operation.id,
      kind: "update_source_record",
      createdAt: operation.createdAt,
      targetLabel,
      ...(pageId ? { target: { kind: "page", pageId } as const } : {}),
      status: "applied",
      canUndo,
      ...(!canUndo ? { undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const } : {})
    };
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#requireVaultPath();
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt) throw new PigeDomainError("activity.legacy_record", "The web source refresh receipt is unavailable.");
    if (receipt.state === "undone") return { status: "already_undone", operationId: operation.id };
    const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
    if (!current || !receipt.afterRevision || sourceRefreshRevision(current) !== receipt.afterRevision) {
      return { status: "stale", operationId: operation.id };
    }
    this.#restoreBefore(vaultPath, receipt, current);
    writeSourceRecord(vaultPath, receipt.sourceId, receipt.beforeRecord, recordChecksum(vaultPath, receipt.sourceId));
    const undo = createUndoOperation(operation, receipt);
    writeOperation(vaultPath, undo);
    writeReceipt(vaultPath, { ...receipt, state: "undone" });
    return { status: "undone", operationId: operation.id, undoOperationId: undo.id };
  }

  recoverIncompleteOperations(): KnowledgeActivityRecoveryResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const receipt of listReceipts(vaultPath)) {
      if (receipt.state === "applied" || receipt.state === "undone" || receipt.state === "rolled_back") continue;
      try {
        const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
        if (receipt.state === "prepared") {
          if (current) {
            this.#restoreBefore(vaultPath, receipt, current);
            writeSourceRecord(vaultPath, receipt.sourceId, receipt.beforeRecord, recordChecksum(vaultPath, receipt.sourceId));
          }
          writeFailedJob(vaultPath, receipt.jobId, "Web source refresh was rolled back after restart.");
          writeReceipt(vaultPath, { ...receipt, state: "rolled_back" });
        } else {
          if (!receipt.afterRecord || !receipt.afterRevision || !current) throw new Error("Incomplete web refresh receipt");
          if (sourceRefreshRevision(current) !== receipt.afterRevision) {
            writeSourceRecord(vaultPath, receipt.sourceId, receipt.afterRecord, recordChecksum(vaultPath, receipt.sourceId));
          }
          const operation = createRefreshOperation(receipt);
          writeOperation(vaultPath, operation);
          writeCompletedJob(vaultPath, receipt);
          writeReceipt(vaultPath, { ...receipt, state: "applied" });
        }
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  hasReceipt(vaultPath: string, operationId: string): boolean {
    return Boolean(readReceipt(vaultPath, operationId));
  }

  #publish(
    scope: { readonly vaultId: string; readonly vaultPath: string },
    beforeRecord: SourceRecord,
    pending: PendingWebPreview
  ): { readonly operationId: string; readonly jobId: string; readonly sourceRevision: string; readonly sourcePageConflict: boolean } {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const seed = createHash("sha256").update(`${beforeRecord.id}:${pending.rawChecksum}:${randomUUID()}`).digest("hex");
    const operationId = `op_${date}_${seed.slice(0, 12)}`;
    const jobId = `job_${date}_${seed.slice(12, 24)}`;
    const root = receiptDirectory(scope.vaultPath, operationId);
    ensurePrivateDirectory(root);
    const locator = acquireSourceRefreshLocator(scope.vaultPath, beforeRecord);
    const artifact = webArtifact(beforeRecord)!;
    const artifactPath = resolveVaultPath(scope.vaultPath, artifact.path);
    const pagePath = beforeRecord.knowledgePagePath ? resolveVaultPath(scope.vaultPath, beforeRecord.knowledgePagePath) : undefined;
    try {
      locator.assertCurrent();
      assertRegular(locator.absolutePath, beforeRecord.managedCopy!.checksum);
      assertRegular(artifactPath, artifact.checksum);
      const beforeRawBackup = backupFile(locator.absolutePath, path.join(root, "before-raw"));
      const beforeArtifactBackup = backupFile(artifactPath, path.join(root, "before-artifact"));
      const beforePageBackup = pagePath && fs.existsSync(pagePath)
        ? backupFile(pagePath, path.join(root, "before-page")) : undefined;
      let receipt: WebRefreshReceipt = {
        schemaVersion: 1,
        operationId,
        jobId,
        sourceId: beforeRecord.id,
        state: "prepared",
        beforeRecord,
        beforeRevision: sourceRefreshRevision(beforeRecord),
        rawPathChecksum: beforeRecord.managedCopy!.checksum,
        artifactPath: artifact.path,
        ...(beforeRecord.knowledgePagePath ? { pagePath: beforeRecord.knowledgePagePath } : {}),
        beforeRawBackup: toVaultRelative(scope.vaultPath, beforeRawBackup),
        beforeArtifactBackup: toVaultRelative(scope.vaultPath, beforeArtifactBackup),
        ...(beforePageBackup ? { beforePageBackup: toVaultRelative(scope.vaultPath, beforePageBackup) } : {})
      };
      writeReceipt(scope.vaultPath, receipt);
      writeJob(scope.vaultPath, createRunningJob(scope.vaultId, jobId, beforeRecord));
      writeAtomicExpected(locator.absolutePath, pending.snapshot.rawContent, beforeRecord.managedCopy!.checksum);
      writeAtomicExpected(artifactPath, pending.snapshot.extractedText, artifact.checksum!);
      const now = new Date().toISOString();
      const intermediate = buildUpdatedRecord(beforeRecord, pending, operationId, now);
      writeSourceRecord(scope.vaultPath, beforeRecord.id, intermediate, recordChecksum(scope.vaultPath, beforeRecord.id));
      const page = this.#sourcePages.refreshForSource(
        scope.vaultPath,
        intermediate,
        sourceRecordPath(scope.vaultPath, intermediate.id),
        jobId,
        intermediate
      );
      const published = readCurrentSourceRecordSnapshot(scope.vaultPath, beforeRecord.id)?.record;
      if (!published || published.metadata.sourceRefreshInFlight !== operationId) {
        throw new PigeDomainError("source.refresh_target_changed", "The web source changed during refresh publication.");
      }
      const finalRecord = SourceRecordSchema.parse({
        ...published,
        metadata: {
          ...published.metadata,
          sourceRefreshInFlight: undefined,
          sourceRefreshPreviousRevision: sourceRefreshRevision(beforeRecord),
          sourceRefreshRevision: `sourcerefreshrev_${pending.rawChecksum.slice("sha256:".length)}`,
          sourceRefreshJobId: jobId,
          sourceRefreshOperationId: operationId
        },
        updatedAt: new Date().toISOString()
      });
      delete (finalRecord.metadata as Record<string, unknown>).sourceRefreshInFlight;
      const afterRawBackup = backupFile(locator.absolutePath, path.join(root, "after-raw"));
      const afterArtifactBackup = backupFile(artifactPath, path.join(root, "after-artifact"));
      const afterPageBackup = pagePath && fs.existsSync(pagePath)
        ? backupFile(pagePath, path.join(root, "after-page")) : undefined;
      receipt = {
        ...receipt,
        state: "ready",
        afterRecord: finalRecord,
        afterRevision: sourceRefreshRevision(finalRecord),
        afterRawBackup: toVaultRelative(scope.vaultPath, afterRawBackup),
        afterArtifactBackup: toVaultRelative(scope.vaultPath, afterArtifactBackup),
        ...(afterPageBackup ? { afterPageBackup: toVaultRelative(scope.vaultPath, afterPageBackup) } : {}),
        sourcePageConflict: page.conflict
      };
      writeReceipt(scope.vaultPath, receipt);
      writeSourceRecord(scope.vaultPath, beforeRecord.id, finalRecord, recordChecksum(scope.vaultPath, beforeRecord.id));
      writeOperation(scope.vaultPath, createRefreshOperation(receipt));
      writeCompletedJob(scope.vaultPath, receipt);
      writeReceipt(scope.vaultPath, { ...receipt, state: "applied" });
      return { operationId, jobId, sourceRevision: receipt.afterRevision!, sourcePageConflict: page.conflict };
    } catch (caught) {
      const receipt = readReceipt(scope.vaultPath, operationId);
      const current = readCurrentSourceRecordSnapshot(scope.vaultPath, beforeRecord.id)?.record;
      if (receipt && current) {
        this.#restoreBefore(scope.vaultPath, receipt, current);
        writeSourceRecord(scope.vaultPath, beforeRecord.id, beforeRecord, recordChecksum(scope.vaultPath, beforeRecord.id));
        writeReceipt(scope.vaultPath, { ...receipt, state: "rolled_back" });
      }
      writeFailedJob(scope.vaultPath, jobId, "Web source refresh failed; the previous revision remains active.");
      throw caught;
    } finally {
      locator.release();
    }
  }

  #restoreBefore(vaultPath: string, receipt: WebRefreshReceipt, current: SourceRecord): void {
    const locator = acquireSourceRefreshLocator(vaultPath, receipt.beforeRecord);
    try {
      restoreBackup(vaultPath, receipt.beforeRawBackup, locator.absolutePath);
      restoreBackup(vaultPath, receipt.beforeArtifactBackup, resolveVaultPath(vaultPath, receipt.artifactPath));
      if (receipt.pagePath && receipt.beforePageBackup) {
        const pagePath = resolveVaultPath(vaultPath, receipt.pagePath);
        const currentChecksum = fs.existsSync(pagePath) ? hashFile(pagePath) : undefined;
        const ownedChecksum = typeof current.metadata.knowledgePageChecksum === "string"
          ? current.metadata.knowledgePageChecksum : undefined;
        const afterChecksum = receipt.afterPageBackup
          ? hashFile(resolveVaultPath(vaultPath, receipt.afterPageBackup)) : undefined;
        if (currentChecksum === ownedChecksum || currentChecksum === afterChecksum) {
          restoreBackup(vaultPath, receipt.beforePageBackup, pagePath);
        }
      }
    } finally {
      locator.release();
    }
  }

  #scope(activeVaultId: string): { readonly vaultId: string; readonly vaultPath: string } | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current && vaultPath && current.vaultId === activeVaultId
      ? { vaultId: current.vaultId, vaultPath } : undefined;
  }

  #sameScope(scope: { readonly vaultId: string; readonly vaultPath: string }): boolean {
    return this.#vaults.current()?.vaultId === scope.vaultId && this.#vaults.activeVaultPath() === scope.vaultPath;
  }

  #requireVaultPath(): string {
    const value = this.#vaults.activeVaultPath();
    if (!value) throw new PigeDomainError("vault.not_open", "Open a vault before changing a source revision.");
    return value;
  }

  #expirePreviews(): void {
    for (const [id, preview] of this.#previews) {
      if (Date.now() - preview.createdAtMs > PREVIEW_TTL_MS) this.#previews.delete(id);
    }
  }

  #disposeOldestPreview(): void {
    const oldest = [...this.#previews.entries()].sort((a, b) => a[1].createdAtMs - b[1].createdAtMs)[0];
    if (oldest) this.#previews.delete(oldest[0]);
  }
}

function webArtifact(record: SourceRecord): SourceRecord["artifacts"][number] | undefined {
  const artifacts = record.artifacts.filter((artifact) => artifact.kind === "extracted_text");
  return artifacts.length === 1 && artifacts[0]?.checksum && artifacts[0].size !== undefined ? artifacts[0] : undefined;
}

function fetchUrl(record: SourceRecord): string | undefined {
  const value = typeof record.metadata.originalUrl === "string" ? record.metadata.originalUrl : record.original?.uri;
  try {
    const parsed = new URL(value ?? "");
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return undefined;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildUpdatedRecord(
  before: SourceRecord,
  pending: PendingWebPreview,
  operationId: string,
  now: string
): SourceRecord {
  const artifact = webArtifact(before)!;
  const metadata: Record<string, unknown> = { ...before.metadata };
  for (const key of ["canonicalUrl", "charset", "title", "byline", "siteName", "sourceLanguage", "publishedTime",
    "excerpt", "imageReferences", "webExtraction"] as const) delete metadata[key];
  metadata.originalUrl = redactSensitiveUrl(pending.snapshot.originalUrl);
  metadata.finalUrl = redactSensitiveUrl(pending.snapshot.finalUrl);
  if (pending.snapshot.canonicalUrl) metadata.canonicalUrl = redactSensitiveUrl(pending.snapshot.canonicalUrl);
  metadata.contentType = pending.snapshot.contentType;
  if (pending.snapshot.charset) metadata.charset = bounded(pending.snapshot.charset, 80);
  if (pending.snapshot.title) metadata.title = bounded(pending.snapshot.title, 240);
  if (pending.snapshot.byline) metadata.byline = bounded(pending.snapshot.byline, 240);
  if (pending.snapshot.siteName) metadata.siteName = bounded(pending.snapshot.siteName, 240);
  if (pending.snapshot.language) metadata.sourceLanguage = bounded(pending.snapshot.language, 35);
  if (pending.snapshot.publishedTime) metadata.publishedTime = bounded(pending.snapshot.publishedTime, 240);
  if (pending.snapshot.excerpt) metadata.excerpt = bounded(pending.snapshot.excerpt, 500);
  metadata.imageReferences = (pending.snapshot.imageReferences ?? [])
    .map(normalizeHttpUrl).filter((value): value is string => Boolean(value)).slice(0, 64);
  metadata.extractionWarnings = [...new Set(pending.snapshot.warnings.map((value) => bounded(value, 120)))].slice(0, 32);
  metadata.extractedTextSize = pending.extractedSize;
  if (pending.snapshot.extraction) metadata.webExtraction = {
    parserId: bounded(pending.snapshot.extraction.parserId, 80),
    engine: bounded(pending.snapshot.extraction.engine, 120),
    version: bounded(pending.snapshot.extraction.version, 80),
    mode: bounded(pending.snapshot.extraction.mode, 80),
    textCharacterCount: pending.snapshot.extraction.textCharacterCount,
    ...(pending.snapshot.extraction.elementCount !== undefined
      ? { elementCount: pending.snapshot.extraction.elementCount } : {}),
    truncated: pending.snapshot.extraction.truncated
  };
  metadata.sourceRefreshInFlight = operationId;
  return SourceRecordSchema.parse({
    ...before,
    original: { ...before.original!, checksum: pending.rawChecksum },
    managedCopy: { ...before.managedCopy!, checksum: pending.rawChecksum, size: pending.rawSize },
    artifacts: before.artifacts.map((candidate) => candidate.id === artifact.id
      ? { ...candidate, checksum: pending.extractedChecksum, size: pending.extractedSize } : candidate),
    metadata,
    updatedAt: now
  });
}

function bounded(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, max);
}

function normalizeHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return undefined;
    parsed.hash = "";
    return redactSensitiveUrl(parsed.toString());
  } catch {
    return undefined;
  }
}

function sameIdentity(left: SourceRefreshPreviewRequest, right: SourceRefreshConfirmRequest): boolean {
  return left.activeVaultId === right.activeVaultId && left.currentPageId === right.currentPageId &&
    left.renderContextId === right.renderContextId && left.sourceId === right.sourceId;
}

function sourceRecordPath(vaultPath: string, sourceId: string): string {
  const date = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!date) throw new PigeDomainError("source.refresh_invalid", "The source identity is invalid.");
  return path.join(vaultPath, ".pige", "source-records", date.slice(0, 4), date.slice(4, 6), `${sourceId}.json`);
}

function recordChecksum(vaultPath: string, sourceId: string): string {
  return hashFile(sourceRecordPath(vaultPath, sourceId));
}

function writeSourceRecord(vaultPath: string, sourceId: string, record: SourceRecord, expectedChecksum: string): void {
  const target = sourceRecordPath(vaultPath, sourceId);
  const root = path.resolve(vaultPath, ".pige", "source-records");
  if (!target.startsWith(`${root}${path.sep}`) || hashFile(target) !== expectedChecksum) {
    throw new PigeDomainError("source.refresh_target_changed", "The Source Record changed before refresh could commit.");
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_SOURCE_RECORD_BYTES) {
    throw new PigeDomainError("source.refresh_target_changed", "The Source Record is unsafe to replace.");
  }
  writeAtomicExpected(target, `${JSON.stringify(SourceRecordSchema.parse(record), null, 2)}\n`, expectedChecksum);
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const parts = relativePath.split("/");
  if (path.isAbsolute(relativePath) || parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new PigeDomainError("source.refresh_path_unsafe", "A web source refresh path is invalid.");
  }
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(`${root}${path.sep}`)) throw new PigeDomainError("source.refresh_path_unsafe", "A web source refresh path escaped the vault.");
  assertNoSymlinkParents(root, path.dirname(target));
  return target;
}

function assertNoSymlinkParents(root: string, directory: string): void {
  const relative = path.relative(root, directory);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PigeDomainError("source.refresh_path_unsafe", "A web source directory is unsafe.");
  }
}

function assertRegular(filePath: string, expectedChecksum?: string): void {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
    (expectedChecksum !== undefined && hashFile(filePath) !== expectedChecksum)) {
    throw new PigeDomainError("source.refresh_target_changed", "A web source file changed before refresh.");
  }
}

function writeAtomicExpected(filePath: string, value: string | Buffer, expectedChecksum: string): void {
  assertRegular(filePath, expectedChecksum);
  const directory = path.dirname(filePath);
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new PigeDomainError("source.refresh_path_unsafe", "A web source parent directory is unsafe.");
  }
  const realDirectory = fs.realpathSync(directory);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertRegular(filePath, expectedChecksum);
    const currentDirectory = fs.lstatSync(directory);
    if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() ||
      currentDirectory.dev !== directoryStat.dev || currentDirectory.ino !== directoryStat.ino ||
      fs.realpathSync(directory) !== realDirectory) {
      throw new PigeDomainError("source.refresh_path_unsafe", "The web source parent changed before publication.");
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function backupFile(source: string, target: string): string {
  assertRegular(source);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  if (process.platform !== "win32") fs.chmodSync(target, 0o400);
  return target;
}

function restoreBackup(vaultPath: string, relativeBackup: string, target: string): void {
  const backup = resolveVaultPath(vaultPath, relativeBackup);
  assertRegular(backup);
  const expected = hashFile(target);
  writeAtomicExpected(target, fs.readFileSync(backup), expected);
}

function checksum(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashFile(filePath: string): string {
  return checksum(fs.readFileSync(filePath));
}

function toVaultRelative(vaultPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(vaultPath), path.resolve(absolutePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PigeDomainError("source.refresh_path_unsafe", "A web source receipt escaped the vault.");
  }
  return relative.split(path.sep).join("/");
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PigeDomainError("source.refresh_path_unsafe", "A web refresh receipt directory is unsafe.");
}

function receiptDirectory(vaultPath: string, operationId: string): string {
  return path.join(vaultPath, ".pige", "private", "web-source-refresh-receipts", operationId);
}

function receiptPath(vaultPath: string, operationId: string): string {
  return path.join(receiptDirectory(vaultPath, operationId), "receipt.json");
}

function writeReceipt(vaultPath: string, receipt: WebRefreshReceipt): void {
  const target = receiptPath(vaultPath, receipt.operationId);
  ensurePrivateDirectory(path.dirname(target));
  const currentChecksum = fs.existsSync(target) ? hashFile(target) : undefined;
  if (currentChecksum) writeAtomicExpected(target, `${JSON.stringify(receipt, null, 2)}\n`, currentChecksum);
  else fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function readReceipt(vaultPath: string, operationId: string): WebRefreshReceipt | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(receiptPath(vaultPath, operationId), "utf8")) as WebRefreshReceipt;
    return value.schemaVersion === 1 && value.operationId === operationId && value.sourceId.startsWith("src_") ? value : undefined;
  } catch {
    return undefined;
  }
}

function listReceipts(vaultPath: string): readonly WebRefreshReceipt[] {
  const root = path.join(vaultPath, ".pige", "private", "web-source-refresh-receipts");
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => readReceipt(vaultPath, entry.name)).filter((value): value is WebRefreshReceipt => Boolean(value));
  } catch {
    return [];
  }
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = /^job_(\d{8})_/u.exec(jobId)?.[1];
  if (!date) throw new Error("Invalid job ID");
  return path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6), `${jobId}.json`);
}

function createRunningJob(vaultId: string, jobId: string, record: SourceRecord): JobRecord {
  const now = new Date().toISOString();
  return JobRecordSchema.parse({ schemaVersion: 1, id: jobId, class: "parse", state: "running", stage: "fetching",
    priority: "interactive", scope: "vault", createdAt: now, updatedAt: now, startedAt: now, activeVaultId: vaultId,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" }, sourceId: record.id,
    inputRefs: [{ kind: "source", id: record.id, checksum: sourceRefreshFingerprint(record).checksum,
      role: "source_refresh_previous_revision" }],
    privacy: { usedCloudModel: false, usedNetwork: true, usedShell: false, accessedExternalFiles: false },
    message: "Refreshing an explicitly confirmed saved web source." });
}

function writeJob(vaultPath: string, job: JobRecord): void {
  const target = jobPath(vaultPath, job.id);
  ensurePrivateDirectory(path.dirname(target));
  if (fs.existsSync(target)) writeAtomicExpected(target, `${JSON.stringify(JobRecordSchema.parse(job), null, 2)}\n`, hashFile(target));
  else fs.writeFileSync(target, `${JSON.stringify(JobRecordSchema.parse(job), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function readJob(vaultPath: string, jobId: string): JobRecord | undefined {
  try { return JobRecordSchema.parse(JSON.parse(fs.readFileSync(jobPath(vaultPath, jobId), "utf8"))); } catch { return undefined; }
}

function writeCompletedJob(vaultPath: string, receipt: WebRefreshReceipt): void {
  const current = readJob(vaultPath, receipt.jobId);
  if (!current || !receipt.afterRevision) return;
  const now = new Date().toISOString();
  writeJob(vaultPath, JobRecordSchema.parse({ ...current,
    state: receipt.sourcePageConflict ? "completed_with_warnings" : "completed", updatedAt: now, finishedAt: now,
    outputRefs: [{ kind: "source", id: receipt.sourceId,
      checksum: receipt.afterRecord ? sourceRefreshFingerprint(receipt.afterRecord).checksum : undefined,
      role: "source_refresh_revision" }], operationIds: [receipt.operationId],
    message: receipt.sourcePageConflict
      ? "Web source refreshed; a user-edited source page was preserved."
      : "Web source and extracted evidence refreshed." }));
}

function writeFailedJob(vaultPath: string, jobId: string, message: string): void {
  const current = readJob(vaultPath, jobId);
  if (!current || current.state === "failed_final") return;
  const now = new Date().toISOString();
  writeJob(vaultPath, JobRecordSchema.parse({ ...current, state: "failed_final", updatedAt: now, finishedAt: now, message }));
}

function createRefreshOperation(receipt: WebRefreshReceipt): OperationRecord {
  if (!receipt.afterRevision) throw new Error("Missing after revision");
  return OperationRecordSchema.parse({ id: receipt.operationId, schemaVersion: 1, jobId: receipt.jobId,
    createdAt: receipt.afterRecord?.updatedAt ?? new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_source_record", targetRefs: [{ kind: "source", id: receipt.sourceId }],
    sourceRefs: [{ kind: "job", id: receipt.jobId }],
    before: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.beforeRevision) },
    after: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.afterRevision) },
    summary: `Refreshed saved web source ${receipt.sourceId} after explicit confirmation.`, reversible: "yes",
    rollbackHint: "Restore the private before-evidence receipt only while the refreshed source is current.",
    warnings: receipt.sourcePageConflict ? ["A user-edited source page was preserved instead of being replaced."] : [] });
}

function createUndoOperation(operation: OperationRecord, receipt: WebRefreshReceipt): OperationRecord {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return OperationRecordSchema.parse({ id: `op_${date}_${createHash("sha256").update(`${operation.id}:undo`).digest("hex").slice(0, 12)}`,
    schemaVersion: 1, createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_source_record", targetRefs: [{ kind: "source", id: receipt.sourceId }],
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.afterRevision!) },
    after: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.beforeRevision) },
    summary: `Restored the previous saved web source revision ${receipt.sourceId}.`, reversible: "best_effort",
    rollbackHint: "The refreshed evidence remains in the private receipt for deliberate forward restore.", warnings: [] });
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1];
  if (!date) throw new Error("Invalid operation ID");
  const target = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operation.id}.json`);
  if (fs.existsSync(target)) return;
  ensurePrivateDirectory(path.dirname(target));
  fs.writeFileSync(target, `${JSON.stringify(OperationRecordSchema.parse(operation), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function isWebRefreshOperation(operation: OperationRecord): boolean {
  return operation.kind === "update_source_record" && operation.reversible === "yes" &&
    operation.targetRefs.length === 1 && operation.targetRefs[0]?.kind === "source" &&
    operation.sourceRefs.some((ref) => ref.kind === "job");
}

function revisionChecksum(revision: string): string {
  return `sha256:${revision.replace(/^sourcerefreshrev_/u, "")}`;
}
