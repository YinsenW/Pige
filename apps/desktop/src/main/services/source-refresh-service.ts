import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  KnowledgeActivitySummary,
  KnowledgeActivityUndoResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult,
  VaultSummary
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
import type { DocumentParserPort } from "./document-parser-service";
import type { KnowledgeActivityRecoveryResult } from "./knowledge-activity-service";
import { acquireSourceRefreshLocator, readCurrentSourceRecordSnapshot } from "./source-file-access";
import { SourcePageService } from "./source-page-service";
import { createObservedFileSnapshot, type VerifiedFileSnapshot } from "./verified-file-snapshot";

export interface SourceRefreshVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface PendingPreview {
  readonly request: SourceRefreshPreviewRequest;
  readonly sourceRevision: string;
  readonly record: SourceRecord;
  readonly snapshot: VerifiedFileSnapshot;
  readonly location: "managed_copy" | "referenced_original";
  readonly createdAtMs: number;
}

interface ReceiptFile {
  readonly path: string;
  readonly beforeBackup?: string;
  readonly beforeChecksum?: string;
  readonly afterBackup?: string;
  readonly afterChecksum?: string;
}

interface SourceRefreshReceipt {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly jobId: string;
  readonly sourceId: string;
  readonly state: "prepared" | "ready" | "applied" | "undone" | "rolled_back";
  readonly beforeRecord: SourceRecord;
  readonly beforeRevision: string;
  readonly afterRecord?: SourceRecord;
  readonly afterRevision?: string;
  readonly files: readonly ReceiptFile[];
  readonly sourcePageConflict?: boolean;
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 8;
const MAX_REFRESH_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SOURCE_RECORD_BYTES = 2 * 1024 * 1024;
const SUPPORTED_SOURCE_KINDS = new Set([
  "markdown_file", "plain_text_file", "pdf_file", "docx_file", "pptx_file"
]);

export class SourceRefreshService {
  readonly #vaults: SourceRefreshVaultPort;
  readonly #parser: DocumentParserPort;
  readonly #sourcePages: SourcePageService;
  readonly #previews = new Map<string, PendingPreview>();

  constructor(
    vaults: SourceRefreshVaultPort,
    parser: DocumentParserPort,
    sourcePages = new SourcePageService()
  ) {
    this.#vaults = vaults;
    this.#parser = parser;
    this.#sourcePages = sourcePages;
  }

  async preview(
    request: SourceRefreshPreviewRequest,
    renderContextCurrent: () => boolean
  ): Promise<SourceRefreshPreviewResult> {
    this.#expirePreviews();
    const identity = { ...request };
    const scope = this.#scope(request.activeVaultId);
    if (!scope || !renderContextCurrent()) return { ...identity, status: "stale" };
    const current = readCurrentSourceRecordSnapshot(scope.vaultPath, request.sourceId);
    if (!current) return { ...identity, status: "not_found" };
    if (!isEligible(current.record, this.#parser)) return { ...identity, status: "ineligible" };
    let locator: ReturnType<typeof acquireSourceRefreshLocator> | undefined;
    let snapshot: VerifiedFileSnapshot | undefined;
    try {
      locator = acquireSourceRefreshLocator(scope.vaultPath, current.record);
      snapshot = await createObservedFileSnapshot({
        sourcePath: locator.absolutePath,
        unavailableCode: "source.refresh_unavailable",
        integrityCode: "source.refresh_changed",
        containmentRoot: locator.containmentRoot,
        maximumSize: MAX_REFRESH_INPUT_BYTES
      });
      locator.assertCurrent();
      if (!renderContextCurrent() || !this.#sameScope(scope)) {
        await snapshot.dispose();
        return { ...identity, status: "stale" };
      }
      const prior = sourceFingerprint(current.record);
      if (prior.checksum === snapshot.checksum && prior.size === snapshot.size) {
        await snapshot.dispose();
        return { ...identity, status: "unchanged" };
      }
      if (this.#previews.size >= MAX_PREVIEWS) this.#disposeOldestPreview();
      const previewId = `sourcerefreshpreview_${randomUUID().replaceAll("-", "")}`;
      const revision = sourceRevision(current.record);
      this.#previews.set(previewId, {
        request,
        sourceRevision: revision,
        record: current.record,
        snapshot,
        location: locator.location,
        createdAtMs: Date.now()
      });
      snapshot = undefined;
      return {
        ...identity,
        status: "changed",
        preview: {
          previewId,
          expectedSourceRevision: revision,
          displayName: safeDisplayName(current.record),
          sourceKind: supportedSourceKind(current.record.kind),
          previousSize: prior.size,
          currentSize: this.#previews.get(previewId)!.snapshot.size,
          sizeDelta: this.#previews.get(previewId)!.snapshot.size - prior.size,
          affectedArtifactCount: current.record.artifacts.length,
          refreshesSourcePage: Boolean(current.record.knowledgePageId)
        }
      };
    } catch (caught) {
      await snapshot?.dispose().catch(() => undefined);
      return { ...identity, status: caught instanceof PigeDomainError ? "unavailable" : "failed" };
    } finally {
      locator?.release();
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
      if (
        !scope || !renderContextCurrent() ||
        !samePreviewIdentity(pending.request, request) ||
        pending.sourceRevision !== request.expectedSourceRevision
      ) return { ...identity, status: "stale" };
      const current = readCurrentSourceRecordSnapshot(scope.vaultPath, request.sourceId);
      if (!current) return { ...identity, status: "not_found" };
      if (sourceRevision(current.record) !== pending.sourceRevision) return { ...identity, status: "stale" };
      if (!isEligible(current.record, this.#parser)) return { ...identity, status: "ineligible" };

      const stillCurrent = await observeCurrent(scope.vaultPath, current.record);
      try {
        if (
          stillCurrent.snapshot.checksum !== pending.snapshot.checksum ||
          stillCurrent.snapshot.size !== pending.snapshot.size
        ) return { ...identity, status: "stale" };
      } finally {
        stillCurrent.locator.release();
        await stillCurrent.snapshot.dispose();
      }
      if (!renderContextCurrent() || !this.#sameScope(scope)) return { ...identity, status: "stale" };

      const result = await this.#publish(scope, current.record, pending);
      return { ...identity, status: "refreshed", ...result };
    } catch (caught) {
      return { ...identity, status: caught instanceof PigeDomainError && caught.code.includes("unavailable") ? "unavailable" : "failed" };
    } finally {
      await pending.snapshot.dispose().catch(() => undefined);
    }
  }

  activitySummary(operation: OperationRecord, undo?: OperationRecord): KnowledgeActivitySummary | undefined {
    if (!isRefreshOperation(operation)) return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return undefined;
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt) return undefined;
    const targetLabel = safeDisplayName(receipt.beforeRecord);
    if (undo || receipt.state === "undone") {
      return {
        operationId: operation.id,
        kind: "update_source_record",
        createdAt: operation.createdAt,
        targetLabel,
        status: "undone",
        canUndo: false,
        undoUnavailableReason: "already_undone"
      };
    }
    const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
    const canUndo = Boolean(receipt.afterRevision && current && sourceRevision(current) === receipt.afterRevision);
    const targetPageId = receipt.afterRecord?.knowledgePageId ?? receipt.beforeRecord.knowledgePageId;
    return {
      operationId: operation.id,
      kind: "update_source_record",
      createdAt: operation.createdAt,
      targetLabel,
      ...(targetPageId ? { target: { kind: "page", pageId: targetPageId } as const } : {}),
      status: "applied",
      canUndo,
      ...(!canUndo ? {
        undoUnavailableReason: current ? "revision_changed" as const : "target_missing" as const
      } : {})
    };
  }

  findUndoOperation(operation: OperationRecord, operations: readonly OperationRecord[]): OperationRecord | undefined {
    return operations.find((candidate) =>
      candidate.kind === "update_source_record" &&
      candidate.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === operation.id)
    );
  }

  undo(operation: OperationRecord): KnowledgeActivityUndoResult {
    const vaultPath = this.#requireVaultPath();
    const receipt = readReceipt(vaultPath, operation.id);
    if (!receipt) throw new PigeDomainError("activity.legacy_record", "The source refresh receipt is unavailable.");
    if (receipt.state === "undone") return { status: "already_undone", operationId: operation.id };
    const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
    if (!current || !receipt.afterRevision || sourceRevision(current) !== receipt.afterRevision) {
      return { status: "stale", operationId: operation.id };
    }
    restoreBeforeFiles(vaultPath, receipt, current);
    writeSourceRecord(vaultPath, receipt.sourceId, receipt.beforeRecord, recordFileChecksum(vaultPath, receipt.sourceId));
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
        if (receipt.state === "prepared") {
          const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
          if (current && current.metadata.sourceRefreshInFlight === receipt.operationId) {
            restoreBeforeFiles(vaultPath, receipt, current);
            writeSourceRecord(vaultPath, receipt.sourceId, receipt.beforeRecord, recordFileChecksum(vaultPath, receipt.sourceId));
          }
          writeFailedJob(vaultPath, receipt.jobId, "Source refresh was rolled back after restart.");
          writeReceipt(vaultPath, { ...receipt, state: "rolled_back" });
          recovered += 1;
          continue;
        }
        if (!receipt.afterRecord || !receipt.afterRevision) throw new Error("Incomplete ready receipt");
        const current = readCurrentSourceRecordSnapshot(vaultPath, receipt.sourceId)?.record;
        if (!current) throw new Error("Missing source");
        if (sourceRevision(current) !== receipt.afterRevision) {
          if (current.metadata.sourceRefreshInFlight !== receipt.operationId) throw new Error("Changed source");
          writeSourceRecord(vaultPath, receipt.sourceId, receipt.afterRecord, recordFileChecksum(vaultPath, receipt.sourceId));
        }
        writeOperation(vaultPath, createRefreshOperation(receipt));
        writeCompletedJob(vaultPath, receipt);
        writeReceipt(vaultPath, { ...receipt, state: "applied" });
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    return { recovered, failed };
  }

  async #publish(
    scope: { readonly vaultId: string; readonly vaultPath: string },
    beforeRecord: SourceRecord,
    pending: PendingPreview
  ): Promise<{
    readonly operationId: string;
    readonly jobId: string;
    readonly sourceRevision: string;
    readonly sourcePageConflict: boolean;
  }> {
    const dateKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const seed = createHash("sha256").update(`${beforeRecord.id}:${pending.snapshot.checksum}:${randomUUID()}`).digest("hex");
    const operationId = `op_${dateKey}_${seed.slice(0, 12)}`;
    const jobId = `job_${dateKey}_${seed.slice(12, 24)}`;
    const receiptRoot = receiptDirectory(scope.vaultPath, operationId);
    ensurePrivateDirectory(receiptRoot);
    const inputExtension = safeExtension(pending.snapshot.absolutePath);
    const inputPath = path.join(receiptRoot, `input${inputExtension}`);
    fs.copyFileSync(pending.snapshot.absolutePath, inputPath, fs.constants.COPYFILE_EXCL);
    if (process.platform !== "win32") fs.chmodSync(inputPath, 0o400);
    const relativeInputPath = toVaultRelative(scope.vaultPath, inputPath);
    const files = snapshotBeforeFiles(scope.vaultPath, operationId, beforeRecord);
    let receipt: SourceRefreshReceipt = {
      schemaVersion: 1,
      operationId,
      jobId,
      sourceId: beforeRecord.id,
      state: "prepared",
      beforeRecord,
      beforeRevision: sourceRevision(beforeRecord),
      files
    };
    writeReceipt(scope.vaultPath, receipt);
    writeJob(scope.vaultPath, createRunningJob(scope.vaultId, jobId, beforeRecord, pending.location));
    const now = new Date().toISOString();
    const intermediate = SourceRecordSchema.parse({
      ...beforeRecord,
      ...(beforeRecord.storageStrategy === "reference_original" ? {
        original: {
          ...beforeRecord.original!,
          checksum: pending.snapshot.checksum,
          lastKnownSize: pending.snapshot.size,
          lastKnownMtime: now
        }
      } : {
        managedCopy: {
          ...beforeRecord.managedCopy!,
          checksum: pending.snapshot.checksum,
          size: pending.snapshot.size
        }
      }),
      metadata: {
        ...beforeRecord.metadata,
        sourceRefreshInFlight: operationId,
        sourceRefreshInput: {
          path: relativeInputPath,
          checksum: pending.snapshot.checksum,
          size: pending.snapshot.size,
          location: pending.location
        }
      },
      updatedAt: now
    });
    try {
      writeSourceRecord(scope.vaultPath, beforeRecord.id, intermediate, recordFileChecksum(scope.vaultPath, beforeRecord.id));
      let sourcePageConflict = false;
      if (isDocumentKind(intermediate.kind)) {
        const result = await this.#parser.parseSource(
          scope.vaultPath,
          intermediate,
          sourceRecordPath(scope.vaultPath, intermediate.id),
          readJob(scope.vaultPath, jobId)!
        );
        sourcePageConflict = result.sourcePageConflict;
      } else {
        const page = this.#sourcePages.refreshForSource(
          scope.vaultPath,
          intermediate,
          sourceRecordPath(scope.vaultPath, intermediate.id),
          jobId,
          intermediate
        );
        sourcePageConflict = page.conflict;
      }
      const published = readCurrentSourceRecordSnapshot(scope.vaultPath, beforeRecord.id)?.record;
      if (!published || published.metadata.sourceRefreshInFlight !== operationId) {
        throw new PigeDomainError("source.refresh_target_changed", "The source changed during refresh publication.");
      }
      const finalRecord = SourceRecordSchema.parse({
        ...published,
        metadata: {
          ...published.metadata,
          sourceRefreshInFlight: undefined,
          sourceRefreshInput: undefined,
          sourceRefreshPreviousRevision: sourceRevision(beforeRecord),
          sourceRefreshRevision: `sourcerefreshrev_${pending.snapshot.checksum.slice("sha256:".length)}`,
          sourceRefreshJobId: jobId,
          sourceRefreshOperationId: operationId
        },
        updatedAt: new Date().toISOString()
      });
      delete (finalRecord.metadata as Record<string, unknown>).sourceRefreshInFlight;
      delete (finalRecord.metadata as Record<string, unknown>).sourceRefreshInput;
      const afterFiles = snapshotAfterFiles(scope.vaultPath, operationId, receipt.files);
      receipt = {
        ...receipt,
        state: "ready",
        afterRecord: finalRecord,
        afterRevision: sourceRevision(finalRecord),
        files: afterFiles,
        sourcePageConflict
      };
      writeReceipt(scope.vaultPath, receipt);
      writeSourceRecord(scope.vaultPath, beforeRecord.id, finalRecord, recordFileChecksum(scope.vaultPath, beforeRecord.id));
      writeOperation(scope.vaultPath, createRefreshOperation(receipt));
      writeCompletedJob(scope.vaultPath, receipt);
      writeReceipt(scope.vaultPath, { ...receipt, state: "applied" });
      return { operationId, jobId, sourceRevision: receipt.afterRevision!, sourcePageConflict };
    } catch (caught) {
      const current = readCurrentSourceRecordSnapshot(scope.vaultPath, beforeRecord.id)?.record;
      if (current?.metadata.sourceRefreshInFlight === operationId) {
        restoreBeforeFiles(scope.vaultPath, receipt, current);
        writeSourceRecord(scope.vaultPath, beforeRecord.id, beforeRecord, recordFileChecksum(scope.vaultPath, beforeRecord.id));
      }
      writeFailedJob(scope.vaultPath, jobId, "Source refresh failed; the previous revision remains active.");
      writeReceipt(scope.vaultPath, { ...receipt, state: "rolled_back" });
      throw caught;
    }
  }

  #scope(activeVaultId: string): { readonly vaultId: string; readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? { vaultId: vault.vaultId, vaultPath } : undefined;
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
      if (Date.now() - preview.createdAtMs <= PREVIEW_TTL_MS) continue;
      this.#previews.delete(id);
      void preview.snapshot.dispose();
    }
  }

  #disposeOldestPreview(): void {
    const oldest = [...this.#previews.entries()].sort((a, b) => a[1].createdAtMs - b[1].createdAtMs)[0];
    if (!oldest) return;
    this.#previews.delete(oldest[0]);
    void oldest[1].snapshot.dispose();
  }
}

function isEligible(record: SourceRecord, parser: DocumentParserPort): boolean {
  return SUPPORTED_SOURCE_KINDS.has(record.kind) &&
    (record.storageStrategy === "reference_original" || record.storageStrategy === "copy_to_source_library") &&
    (!isDocumentKind(record.kind) || parser.canParse(record.kind));
}

function supportedSourceKind(
  kind: SourceRecord["kind"]
): "markdown_file" | "plain_text_file" | "pdf_file" | "docx_file" | "pptx_file" {
  if (kind === "markdown_file" || kind === "plain_text_file" || kind === "pdf_file" ||
    kind === "docx_file" || kind === "pptx_file") return kind;
  throw new PigeDomainError("source.refresh_ineligible", "This source format cannot be refreshed.");
}

function isDocumentKind(kind: SourceRecord["kind"]): boolean {
  return kind === "pdf_file" || kind === "docx_file" || kind === "pptx_file";
}

async function observeCurrent(vaultPath: string, record: SourceRecord): Promise<{
  readonly locator: ReturnType<typeof acquireSourceRefreshLocator>;
  readonly snapshot: VerifiedFileSnapshot;
}> {
  const locator = acquireSourceRefreshLocator(vaultPath, record);
  try {
    const snapshot = await createObservedFileSnapshot({
      sourcePath: locator.absolutePath,
      unavailableCode: "source.refresh_unavailable",
      integrityCode: "source.refresh_changed",
      containmentRoot: locator.containmentRoot,
      maximumSize: MAX_REFRESH_INPUT_BYTES
    });
    locator.assertCurrent();
    return { locator, snapshot };
  } catch (caught) {
    locator.release();
    throw caught;
  }
}

function samePreviewIdentity(left: SourceRefreshPreviewRequest, right: SourceRefreshConfirmRequest): boolean {
  return left.activeVaultId === right.activeVaultId && left.currentPageId === right.currentPageId &&
    left.renderContextId === right.renderContextId && left.sourceId === right.sourceId;
}

function sourceFingerprint(record: SourceRecord): { readonly checksum: string; readonly size: number } {
  if (record.storageStrategy === "copy_to_source_library" && record.managedCopy) {
    return { checksum: record.managedCopy.checksum, size: record.managedCopy.size };
  }
  if (record.storageStrategy === "reference_original" && record.original?.checksum !== undefined && record.original.lastKnownSize !== undefined) {
    return { checksum: record.original.checksum, size: record.original.lastKnownSize };
  }
  throw new PigeDomainError("source.refresh_ineligible", "This source has no recorded input fingerprint.");
}

function sourceRevision(record: SourceRecord): string {
  return `sourcerefreshrev_${createHash("sha256").update(JSON.stringify(record)).digest("hex")}`;
}

function safeDisplayName(record: SourceRecord): string {
  const raw = record.original?.displayName ?? (typeof record.metadata.title === "string" ? record.metadata.title : "Saved source");
  const safe = path.basename(raw).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ").replace(/\s+/gu, " ").trim();
  return (safe || "Saved source").slice(0, 160);
}

function sourceRecordPath(vaultPath: string, sourceId: string): string {
  const date = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!date) throw new PigeDomainError("source.refresh_invalid", "The source identity is invalid.");
  return path.join(vaultPath, ".pige", "source-records", date.slice(0, 4), date.slice(4, 6), `${sourceId}.json`);
}

function recordFileChecksum(vaultPath: string, sourceId: string): string {
  return hashFile(sourceRecordPath(vaultPath, sourceId));
}

function writeSourceRecord(vaultPath: string, sourceId: string, record: SourceRecord, expectedChecksum: string): void {
  const target = sourceRecordPath(vaultPath, sourceId);
  const root = path.resolve(vaultPath, ".pige", "source-records");
  if (!target.startsWith(`${root}${path.sep}`) || hashFile(target) !== expectedChecksum) {
    throw new PigeDomainError("source.refresh_target_changed", "The Source Record changed before refresh could commit.");
  }
  const current = fs.lstatSync(target);
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size > MAX_SOURCE_RECORD_BYTES) {
    throw new PigeDomainError("source.refresh_target_changed", "The Source Record is unsafe to replace.");
  }
  const validated = SourceRecordSchema.parse(record);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (hashFile(target) !== expectedChecksum) {
    fs.rmSync(temporary, { force: true });
    throw new PigeDomainError("source.refresh_target_changed", "The Source Record changed during refresh commit.");
  }
  fs.renameSync(temporary, target);
}

function snapshotBeforeFiles(vaultPath: string, operationId: string, record: SourceRecord): readonly ReceiptFile[] {
  const paths = new Set(record.artifacts.map((artifact) => artifact.path));
  if (record.knowledgePagePath) paths.add(record.knowledgePagePath);
  if (isDocumentKind(record.kind)) {
    const date = /^src_(\d{8})_/u.exec(record.id)?.[1];
    const format = record.kind.replace("_file", "");
    if (date) {
      paths.add(`artifacts/extracted-text/${date.slice(0, 4)}/${date.slice(4, 6)}/${record.id}.txt`);
      paths.add(`artifacts/metadata/${date.slice(0, 4)}/${date.slice(4, 6)}/${record.id}.${format}.json`);
    }
  }
  return [...paths].map((relativePath) => {
    const absolute = resolveVaultFile(vaultPath, relativePath);
    if (!fs.existsSync(absolute)) return { path: relativePath };
    const checksum = hashFile(absolute);
    const backup = backupPath(vaultPath, operationId, "before", relativePath);
    ensurePrivateDirectory(path.dirname(backup));
    fs.copyFileSync(absolute, backup, fs.constants.COPYFILE_EXCL);
    return { path: relativePath, beforeBackup: toVaultRelative(vaultPath, backup), beforeChecksum: checksum };
  });
}

function snapshotAfterFiles(vaultPath: string, operationId: string, files: readonly ReceiptFile[]): readonly ReceiptFile[] {
  return files.map((file) => {
    const absolute = resolveVaultFile(vaultPath, file.path);
    if (!fs.existsSync(absolute)) return file;
    const checksum = hashFile(absolute);
    const backup = backupPath(vaultPath, operationId, "after", file.path);
    ensurePrivateDirectory(path.dirname(backup));
    fs.copyFileSync(absolute, backup, fs.constants.COPYFILE_EXCL);
    return { ...file, afterBackup: toVaultRelative(vaultPath, backup), afterChecksum: checksum };
  });
}

function restoreBeforeFiles(vaultPath: string, receipt: SourceRefreshReceipt, current: SourceRecord): void {
  for (const file of receipt.files) {
    const target = resolveVaultFile(vaultPath, file.path);
    const isPage = current.knowledgePagePath === file.path || receipt.beforeRecord.knowledgePagePath === file.path;
    if (isPage && fs.existsSync(target)) {
      const currentHash = hashFile(target);
      const ownedHash = typeof current.metadata.knowledgePageChecksum === "string" ? current.metadata.knowledgePageChecksum : undefined;
      if (currentHash !== file.beforeChecksum && currentHash !== file.afterChecksum && currentHash !== ownedHash) continue;
    }
    if (file.beforeBackup && file.beforeChecksum) {
      const backup = resolveVaultFile(vaultPath, file.beforeBackup);
      if (hashFile(backup) !== file.beforeChecksum) throw new PigeDomainError("source.refresh_receipt_changed", "The rollback evidence changed.");
      ensurePrivateDirectory(path.dirname(target));
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.restore`);
      fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temporary, target);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
}

function createRunningJob(vaultId: string, jobId: string, record: SourceRecord, location: PendingPreview["location"]): JobRecord {
  const now = new Date().toISOString();
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: jobId,
    class: "parse",
    state: "running",
    stage: "parsing",
    priority: "interactive",
    scope: "vault",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    activeVaultId: vaultId,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    sourceId: record.id,
    inputRefs: [{ kind: "source", id: record.id, checksum: sourceFingerprint(record).checksum, role: "source_refresh_previous_revision" }],
    privacy: { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: location === "referenced_original" },
    message: "Refreshing a user-confirmed linked source revision."
  });
}

function writeCompletedJob(vaultPath: string, receipt: SourceRefreshReceipt): void {
  const current = readJob(vaultPath, receipt.jobId);
  if (!current || !receipt.afterRevision) return;
  const now = new Date().toISOString();
  writeJob(vaultPath, JobRecordSchema.parse({
    ...current,
    state: receipt.sourcePageConflict ? "completed_with_warnings" : "completed",
    updatedAt: now,
    finishedAt: now,
    outputRefs: [{ kind: "source", id: receipt.sourceId, checksum: receipt.afterRecord ? sourceFingerprint(receipt.afterRecord).checksum : undefined, role: "source_refresh_revision" }],
    operationIds: [receipt.operationId],
    message: receipt.sourcePageConflict
      ? "Source revision refreshed; a user-edited source page was preserved."
      : "Source revision refreshed and derived local evidence updated."
  }));
}

function writeFailedJob(vaultPath: string, jobId: string, message: string): void {
  const current = readJob(vaultPath, jobId);
  if (!current || current.state === "failed_final") return;
  const now = new Date().toISOString();
  writeJob(vaultPath, JobRecordSchema.parse({ ...current, state: "failed_final", updatedAt: now, finishedAt: now, message }));
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = /^job_(\d{8})_/u.exec(jobId)?.[1];
  if (!date) throw new Error("Invalid job ID");
  return path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6), `${jobId}.json`);
}

function writeJob(vaultPath: string, job: JobRecord): void {
  const target = jobPath(vaultPath, job.id);
  ensurePrivateDirectory(path.dirname(target));
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(JobRecordSchema.parse(job), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, target);
}

function readJob(vaultPath: string, jobId: string): JobRecord | undefined {
  try { return JobRecordSchema.parse(JSON.parse(fs.readFileSync(jobPath(vaultPath, jobId), "utf8"))); } catch { return undefined; }
}

function createRefreshOperation(receipt: SourceRefreshReceipt): OperationRecord {
  if (!receipt.afterRevision) throw new Error("Missing after revision");
  return OperationRecordSchema.parse({
    id: receipt.operationId,
    schemaVersion: 1,
    jobId: receipt.jobId,
    createdAt: receipt.afterRecord?.updatedAt ?? new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_source_record",
    targetRefs: [{ kind: "source", id: receipt.sourceId }],
    sourceRefs: [{ kind: "job", id: receipt.jobId }],
    before: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.beforeRevision) },
    after: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.afterRevision) },
    summary: `Refreshed linked source ${receipt.sourceId} from a user-confirmed file revision.`,
    reversible: "yes",
    rollbackHint: "Restore the private before-evidence receipt only while the published source revision is unchanged.",
    warnings: receipt.sourcePageConflict ? ["A user-edited source page was preserved instead of being replaced."] : []
  });
}

function createUndoOperation(operation: OperationRecord, receipt: SourceRefreshReceipt): OperationRecord {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const id = `op_${date}_${createHash("sha256").update(`${operation.id}:undo`).digest("hex").slice(0, 12)}`;
  return OperationRecordSchema.parse({
    id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "update_source_record",
    targetRefs: [{ kind: "source", id: receipt.sourceId }],
    sourceRefs: [{ kind: "operation", id: operation.id }],
    before: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.afterRevision!) },
    after: { kind: "source", id: receipt.sourceId, checksum: revisionChecksum(receipt.beforeRevision) },
    summary: `Restored the previous evidence revision for source ${receipt.sourceId}.`,
    reversible: "best_effort",
    rollbackHint: "The refreshed evidence remains in the private receipt for a deliberate forward restore.",
    warnings: []
  });
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const date = /^op_(\d{8})_/u.exec(operation.id)?.[1];
  if (!date) throw new Error("Invalid operation ID");
  const target = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operation.id}.json`);
  if (fs.existsSync(target)) return;
  ensurePrivateDirectory(path.dirname(target));
  fs.writeFileSync(target, `${JSON.stringify(OperationRecordSchema.parse(operation), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function isRefreshOperation(operation: OperationRecord): boolean {
  return operation.kind === "update_source_record" && operation.targetRefs.length === 1 &&
    operation.targetRefs[0]?.kind === "source" && operation.sourceRefs.some((ref) => ref.kind === "job") &&
    operation.reversible === "yes";
}

function revisionChecksum(revision: string): string {
  const value = revision.replace(/^sourcerefreshrev_/u, "");
  return `sha256:${value}`;
}

function receiptDirectory(vaultPath: string, operationId: string): string {
  return path.join(vaultPath, ".pige", "private", "source-refresh-receipts", operationId);
}

function receiptPath(vaultPath: string, operationId: string): string {
  return path.join(receiptDirectory(vaultPath, operationId), "receipt.json");
}

function writeReceipt(vaultPath: string, receipt: SourceRefreshReceipt): void {
  const target = receiptPath(vaultPath, receipt.operationId);
  ensurePrivateDirectory(path.dirname(target));
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, target);
}

function readReceipt(vaultPath: string, operationId: string): SourceRefreshReceipt | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(receiptPath(vaultPath, operationId), "utf8")) as SourceRefreshReceipt;
    return value.schemaVersion === 1 && value.operationId === operationId ? value : undefined;
  } catch { return undefined; }
}

function listReceipts(vaultPath: string): readonly SourceRefreshReceipt[] {
  const root = path.join(vaultPath, ".pige", "private", "source-refresh-receipts");
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, 10_000)
      .map((entry) => readReceipt(vaultPath, entry.name)).filter((value): value is SourceRefreshReceipt => Boolean(value));
  } catch { return []; }
}

function backupPath(vaultPath: string, operationId: string, lane: "before" | "after", relativePath: string): string {
  const digest = createHash("sha256").update(relativePath).digest("hex");
  return path.join(receiptDirectory(vaultPath, operationId), lane, `${digest}.bin`);
}

function resolveVaultFile(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new PigeDomainError("source.refresh_path_unsafe", "A refresh receipt path escaped the vault.");
  return resolved;
}

function toVaultRelative(vaultPath: string, absolutePath: string): string {
  return path.relative(path.resolve(vaultPath), path.resolve(absolutePath)).split(path.sep).join("/");
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function hashFile(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new PigeDomainError("source.refresh_file_unsafe", "A refresh-owned file is unsafe.");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally { fs.closeSync(descriptor); }
  return `sha256:${hash.digest("hex")}`;
}

function safeExtension(filePath: string): string {
  const extension = path.extname(filePath);
  return /^\.[a-z0-9]{1,12}$/iu.test(extension) ? extension : ".bin";
}
