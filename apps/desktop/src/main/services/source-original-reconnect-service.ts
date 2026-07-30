import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ReferencedOriginalReconnectCandidate, ReferencedOriginalReconnectProof, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  ReferencedOriginalReconnectCandidateSchema,
  SourceRecordSchema,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import { createObservedFileSnapshot, type VerifiedFileSnapshot } from "./verified-file-snapshot";
import { verifyRevealableSourceFile } from "./source-file-access";
import type { ReferencedOriginalReplacementInput } from "./source-refresh-service";

const MAX_SOURCE_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_RECONNECTABLE_SOURCES = 20;
const MAX_RECONNECT_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const CHANGED_PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_CHANGED_PREVIEWS = 8;

export interface SourceOriginalReconnectVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface SourceOriginalReconnectBinding extends ReferencedOriginalReconnectProof {
  readonly activeVaultId: string;
  readonly requestId: string;
}

export interface SourceOriginalReplacementPort {
  canReplaceReferencedOriginal(record: SourceRecord): boolean;
  replaceReferencedOriginal(
    input: ReferencedOriginalReplacementInput,
    assertCurrent: () => boolean
  ): Promise<{
    readonly operationId: string;
    readonly refreshOperationId: string;
    readonly jobId: string;
    readonly sourceRevision: string;
    readonly sourcePageConflict: boolean;
  }>;
}

export interface SourceOriginalChangedPreview {
  readonly previewId: string;
  readonly expectedSourceRevision: string;
  readonly displayName: string;
  readonly sourceKind: SourceRecord["kind"];
  readonly previousSize: number;
  readonly currentSize: number;
  readonly affectedArtifactCount: number;
  readonly refreshesSourcePage: boolean;
}

export type SourceOriginalReconnectResult =
  | { readonly status: "reconnected"; readonly operationId: string; readonly contentState: "current" | "changed" }
  | { readonly status: "changed"; readonly preview: SourceOriginalChangedPreview }
  | { readonly status: "stale" | "not_found" | "ineligible" | "mismatch" | "failed" };

interface SourceRecordSnapshot {
  readonly filePath: string;
  readonly checksum: string;
  readonly record: SourceRecord;
}

interface SourceReconnectReceipt {
  readonly schemaVersion: 1;
  readonly sourceId: string;
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
  readonly beforeRecord: SourceRecord;
  readonly afterRecord: SourceRecord;
  readonly operation: OperationRecord;
}

interface SelectedFileIdentity {
  readonly path: string;
  readonly parentRealPath: string;
  readonly parentDev: number;
  readonly parentIno: number;
  readonly fileDev: number;
  readonly fileIno: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface PendingChangedReconnect {
  readonly binding: SourceOriginalReconnectBinding;
  readonly recordChecksum: string;
  readonly record: SourceRecord;
  readonly selected: SelectedFileIdentity;
  readonly snapshot: VerifiedFileSnapshot;
  readonly createdAtMs: number;
}

export class SourceOriginalReconnectService {
  readonly #vaults: SourceOriginalReconnectVaultPort;
  readonly #now: () => Date;
  readonly #replacement: SourceOriginalReplacementPort | undefined;
  readonly #changedPreviews = new Map<string, PendingChangedReconnect>();

  constructor(
    vaults: SourceOriginalReconnectVaultPort,
    now: () => Date = () => new Date(),
    replacement?: SourceOriginalReplacementPort
  ) {
    this.#vaults = vaults;
    this.#now = now;
    this.#replacement = replacement;
  }

  listUnavailable(activeVaultId: string): { readonly sources: ReferencedOriginalReconnectCandidate[]; readonly truncated: boolean } {
    const binding = this.#activeBinding(activeVaultId);
    if (!binding) throw new PigeDomainError("source.reconnect_stale", "The active vault changed.");
    this.recoverIncompleteOperations();
    const candidates = listSourceRecordIds(binding.vaultPath)
      .map((sourceId) => readSourceRecordSnapshot(binding.vaultPath, sourceId))
      .filter((snapshot): snapshot is SourceRecordSnapshot => snapshot !== undefined)
      .map((snapshot) => reconnectCandidate(binding.vaultPath, snapshot))
      .filter((candidate): candidate is ReferencedOriginalReconnectCandidate => candidate !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "en-US") ||
        left.sourceId.localeCompare(right.sourceId, "en-US"));
    return {
      sources: candidates.slice(0, MAX_RECONNECTABLE_SOURCES),
      truncated: candidates.length > MAX_RECONNECTABLE_SOURCES
    };
  }

  candidate(activeVaultId: string, sourceId: string): ReferencedOriginalReconnectCandidate | undefined {
    const binding = this.#activeBinding(activeVaultId);
    if (!binding) return undefined;
    this.recoverIncompleteOperations();
    const snapshot = readSourceRecordSnapshot(binding.vaultPath, sourceId);
    return snapshot ? reconnectCandidate(binding.vaultPath, snapshot) : undefined;
  }

  async reconnect(
    binding: SourceOriginalReconnectBinding,
    selectedPath: string,
    assertCurrent: () => boolean = () => true
  ): Promise<SourceOriginalReconnectResult> {
    this.#expireChangedPreviews();
    const active = this.#activeBinding(binding.activeVaultId);
    if (!active) return { status: "stale" };
    this.recoverIncompleteOperations();
    const snapshot = readSourceRecordSnapshot(active.vaultPath, binding.sourceId);
    if (!snapshot) return { status: "not_found" };
    const candidate = reconnectCandidate(active.vaultPath, snapshot);
    if (!candidate) return { status: "ineligible" };
    if (!sameReconnectProof(candidate, binding)) return { status: "stale" };

    let selected: SelectedFileIdentity;
    let observed: VerifiedFileSnapshot | undefined;
    try {
      selected = selectedFileIdentity(selectedPath);
      if (!sameFormatIdentity(snapshot.record, selected.path, binding.formatIdentity)) {
        return { status: "mismatch" };
      }
      observed = await createObservedFileSnapshot({
        sourcePath: selected.path,
        unavailableCode: "source.external_unavailable",
        integrityCode: "source.checksum_mismatch",
        maximumSize: MAX_RECONNECT_INPUT_BYTES
      });
    } catch (caught) {
      await observed?.dispose().catch(() => undefined);
      return {
        status: caught instanceof PigeDomainError && caught.code === "source.checksum_mismatch" ? "mismatch" : "failed"
      };
    }

    if (observed.checksum !== binding.expectedChecksum || observed.size !== binding.expectedSize) {
      if (!this.#replacement) {
        await observed.dispose();
        return { status: "mismatch" };
      }
      if (!this.#replacement.canReplaceReferencedOriginal(snapshot.record)) {
        await observed.dispose();
        return { status: "ineligible" };
      }
      if (!assertCurrent()) {
        await observed.dispose();
        return { status: "stale" };
      }
      if (this.#changedPreviews.size >= MAX_CHANGED_PREVIEWS) this.#disposeOldestChangedPreview();
      const previewId = `sourcerelinkpreview_${randomUUID().replaceAll("-", "")}`;
      this.#changedPreviews.set(previewId, {
        binding,
        recordChecksum: snapshot.checksum,
        record: snapshot.record,
        selected,
        snapshot: observed,
        createdAtMs: Date.now()
      });
      return {
        status: "changed",
        preview: {
          previewId,
          expectedSourceRevision: candidate.sourceRevision,
          displayName: candidate.displayName,
          sourceKind: snapshot.record.kind,
          previousSize: binding.expectedSize,
          currentSize: observed.size,
          affectedArtifactCount: snapshot.record.artifacts.length,
          refreshesSourcePage: Boolean(snapshot.record.knowledgePageId)
        }
      };
    }
    await observed.dispose();

    if (!assertCurrent()) return { status: "stale" };
    const current = readSourceRecordSnapshot(active.vaultPath, binding.sourceId);
    if (!current || current.checksum !== snapshot.checksum ||
      reconnectCandidate(active.vaultPath, current) === undefined) return { status: "stale" };
    if (!sameSelectedFileIdentity(selected, selectedFileIdentity(selected.path))) return { status: "stale" };
    const selectedStat = fs.statSync(selected.path);
    const updated = SourceRecordSchema.parse({
      ...snapshot.record,
      original: {
        ...snapshot.record.original!,
        uri: pathToFileURL(selected.path).href,
        path: selected.path,
        lastKnownMtime: selectedStat.mtime.toISOString(),
        lastKnownSize: selectedStat.size
      },
      updatedAt: this.#now().toISOString()
    });
    const afterBytes = serializeSourceRecord(updated);
    const afterChecksum = hashBytes(afterBytes);
    const operation = createRelinkOperation(binding.requestId, snapshot, afterChecksum, this.#now());
    const receipt: SourceReconnectReceipt = {
      schemaVersion: 1,
      sourceId: binding.sourceId,
      beforeChecksum: snapshot.checksum,
      afterChecksum,
      beforeRecord: snapshot.record,
      afterRecord: updated,
      operation
    };
    try {
      writeReceipt(active.vaultPath, receipt);
      if (!assertCurrent()) {
        removeReceipt(active.vaultPath, operation.id);
        return { status: "stale" };
      }
      replaceSourceRecord(active.vaultPath, snapshot, updated);
      const committed = readSourceRecordSnapshot(active.vaultPath, binding.sourceId);
      if (!committed || committed.checksum !== afterChecksum || committed.record.original?.path !== selected.path ||
          !verifyExactReferencedOriginal(active.vaultPath, committed.record)) {
        throw new PigeDomainError("source.reconnect_failed", "The reconnected source could not be verified after commit.");
      }
      writeOperation(active.vaultPath, operation);
      return { status: "reconnected", operationId: operation.id, contentState: "current" };
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "source.reconnect_stale") {
        try { removeReceipt(active.vaultPath, operation.id); } catch { return { status: "failed" }; }
        return { status: "stale" };
      }
      return {
        status: "failed"
      };
    }
  }

  acknowledge(operationId: string): void {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return;
    try {
      const receipt = readReceipt(receiptPath(vaultPath, operationId));
      const current = readSourceRecordSnapshot(vaultPath, receipt.sourceId);
      if (current?.checksum !== receipt.afterChecksum) return;
      writeOperation(vaultPath, receipt.operation);
      removeReceipt(vaultPath, operationId);
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
    }
  }

  async confirmChanged(
    binding: SourceOriginalReconnectBinding & { readonly previewId: string },
    assertCurrent: () => boolean = () => true
  ): Promise<SourceOriginalReconnectResult> {
    this.#expireChangedPreviews();
    const pending = this.#changedPreviews.get(binding.previewId);
    this.#changedPreviews.delete(binding.previewId);
    if (!pending) return { status: "stale" };
    try {
      const active = this.#activeBinding(binding.activeVaultId);
      if (!active || !sameReconnectProof(pending.binding, binding) || !assertCurrent()) return { status: "stale" };
      const current = readSourceRecordSnapshot(active.vaultPath, binding.sourceId);
      const candidate = current ? reconnectCandidate(active.vaultPath, current) : undefined;
      if (!current) return { status: "not_found" };
      if (!candidate || current.checksum !== pending.recordChecksum || !sameReconnectProof(candidate, binding)) {
        return { status: "stale" };
      }
      if (!this.#replacement?.canReplaceReferencedOriginal(current.record)) return { status: "ineligible" };
      const selected = selectedFileIdentity(pending.selected.path);
      if (!sameSelectedFileIdentity(pending.selected, selected)) return { status: "stale" };
      const observed = await createObservedFileSnapshot({
        sourcePath: selected.path,
        unavailableCode: "source.external_unavailable",
        integrityCode: "source.checksum_mismatch",
        maximumSize: MAX_RECONNECT_INPUT_BYTES
      });
      try {
        if (observed.checksum !== pending.snapshot.checksum || observed.size !== pending.snapshot.size) {
          return { status: "stale" };
        }
      } finally {
        await observed.dispose();
      }
      if (!assertCurrent()) return { status: "stale" };
      const result = await this.#replacement.replaceReferencedOriginal({
        activeVaultId: binding.activeVaultId,
        requestId: binding.requestId,
        beforeRecord: pending.record,
        selectedPath: selected.path,
        selectedMtime: new Date(selected.mtimeMs).toISOString(),
        snapshot: pending.snapshot
      }, assertCurrent);
      return { status: "reconnected", operationId: result.operationId, contentState: "changed" };
    } catch (caught) {
      return { status: caught instanceof PigeDomainError && caught.code === "source.reconnect_stale" ? "stale" : "failed" };
    } finally {
      await pending.snapshot.dispose().catch(() => undefined);
    }
  }

  recoverIncompleteOperations(): { readonly recovered: number; readonly failed: number; readonly relinkedSourceIds?: readonly string[] } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    const relinkedSourceIds = new Set<string>();
    for (const receiptPath of listReceiptPaths(vaultPath)) {
      try {
        const receipt = readReceipt(receiptPath);
        const current = readSourceRecordSnapshot(vaultPath, receipt.sourceId);
        if (current?.checksum === receipt.afterChecksum) {
          writeOperation(vaultPath, receipt.operation);
          removeReceipt(vaultPath, receipt.operation.id);
          relinkedSourceIds.add(receipt.sourceId);
          recovered += 1;
        } else if (current?.checksum === receipt.beforeChecksum) {
          removeReceipt(vaultPath, receipt.operation.id);
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return {
      recovered,
      failed,
      ...(relinkedSourceIds.size > 0 ? { relinkedSourceIds: [...relinkedSourceIds].sort() } : {})
    };
  }

  #activeBinding(activeVaultId: string): { readonly vaultPath: string } | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return vault && vaultPath && vault.vaultId === activeVaultId ? { vaultPath } : undefined;
  }

  #expireChangedPreviews(): void {
    for (const [id, preview] of this.#changedPreviews) {
      if (Date.now() - preview.createdAtMs <= CHANGED_PREVIEW_TTL_MS) continue;
      this.#changedPreviews.delete(id);
      void preview.snapshot.dispose();
    }
  }

  #disposeOldestChangedPreview(): void {
    const oldest = [...this.#changedPreviews.entries()].sort((left, right) => left[1].createdAtMs - right[1].createdAtMs)[0];
    if (!oldest) return;
    this.#changedPreviews.delete(oldest[0]);
    void oldest[1].snapshot.dispose();
  }
}

export function canReconnectOriginalSource(sourceRecord: SourceRecord): boolean {
  return sourceRecord.storageStrategy === "reference_original" &&
    Boolean(sourceRecord.original?.checksum) &&
    sourceRecord.original?.lastKnownSize !== undefined;
}

export function readReferencedOriginalReconnectCandidate(
  vaultPath: string,
  sourceId: string
): ReferencedOriginalReconnectCandidate | undefined {
  const snapshot = readSourceRecordSnapshot(vaultPath, sourceId);
  return snapshot ? reconnectCandidate(vaultPath, snapshot) : undefined;
}

function reconnectCandidate(
  vaultPath: string,
  snapshot: SourceRecordSnapshot
): ReferencedOriginalReconnectCandidate | undefined {
  const original = snapshot.record.original;
  if (!canReconnectOriginalSource(snapshot.record) || !original?.checksum || original.lastKnownSize === undefined ||
    verifyExactReferencedOriginal(vaultPath, snapshot.record)) return undefined;
  return ReferencedOriginalReconnectCandidateSchema.parse({
    sourceId: snapshot.record.id,
    sourceKind: snapshot.record.kind,
    sourceRevision: `sourcerev_${snapshot.checksum.slice("sha256:".length)}`,
    expectedAvailability: "unavailable",
    expectedChecksum: original.checksum,
    expectedSize: original.lastKnownSize,
    formatIdentity: sourceFormatIdentity(snapshot.record),
    displayName: boundedDisplayName(original.displayName, snapshot.record.kind)
  });
}

function sameReconnectProof(
  candidate: ReferencedOriginalReconnectProof,
  binding: ReferencedOriginalReconnectProof
): boolean {
  return candidate.sourceId === binding.sourceId && candidate.sourceKind === binding.sourceKind &&
    candidate.sourceRevision === binding.sourceRevision &&
    candidate.expectedAvailability === binding.expectedAvailability &&
    candidate.expectedChecksum === binding.expectedChecksum && candidate.expectedSize === binding.expectedSize &&
    candidate.formatIdentity === binding.formatIdentity;
}

function verifyExactReferencedOriginal(vaultPath: string, sourceRecord: SourceRecord): boolean {
  try {
    const verified = verifyRevealableSourceFile(vaultPath, sourceRecord);
    return verified.location === "referenced_original";
  } catch {
    return false;
  }
}

function sourceFormatIdentity(sourceRecord: SourceRecord): `sourcefmt_${string}` {
  const original = sourceRecord.original;
  const extension = normalizedExtension(original?.displayName || original?.path || "");
  return `sourcefmt_${createHash("sha256")
    .update(`pige.source-reconnect.format.v1\0${sourceRecord.kind}\0${extension}`)
    .digest("hex")}`;
}

function sameFormatIdentity(sourceRecord: SourceRecord, selectedPath: string, expected: string): boolean {
  if (sourceFormatIdentity(sourceRecord) !== expected) return false;
  const expectedExtension = normalizedExtension(sourceRecord.original?.displayName || sourceRecord.original?.path || "");
  return !expectedExtension || normalizedExtension(selectedPath) === expectedExtension;
}

function normalizedExtension(filePath: string): string {
  const extension = path.extname(filePath).normalize("NFKC").toLocaleLowerCase("en-US");
  return /^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : "";
}

function boundedDisplayName(value: string | undefined, kind: SourceRecord["kind"]): string {
  const displayName = value?.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/\s+/gu, " ").trim().slice(0, 512);
  return displayName || kind.replaceAll("_", " ");
}

function selectedFileIdentity(selectedPath: string): SelectedFileIdentity {
  if (!path.isAbsolute(selectedPath) || selectedPath.includes("\0")) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source path is invalid.");
  }
  const resolved = path.resolve(selectedPath);
  const selectedStat = fs.lstatSync(resolved);
  if (!selectedStat.isFile() || selectedStat.isSymbolicLink() || selectedStat.nlink !== 1) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source is not a private regular file.");
  }
  const parent = path.dirname(resolved);
  const parentRealPath = fs.realpathSync.native(parent);
  const parentStat = fs.lstatSync(parentRealPath);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source parent is unsafe.");
  }
  const real = fs.realpathSync.native(resolved);
  const stat = fs.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source is not a private regular file.");
  }
  return {
    path: real,
    parentRealPath,
    parentDev: parentStat.dev,
    parentIno: parentStat.ino,
    fileDev: stat.dev,
    fileIno: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  };
}

function sameSelectedFileIdentity(left: SelectedFileIdentity, right: SelectedFileIdentity): boolean {
  return left.path === right.path && left.parentRealPath === right.parentRealPath &&
    left.parentDev === right.parentDev && left.parentIno === right.parentIno &&
    left.fileDev === right.fileDev && left.fileIno === right.fileIno && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readSourceRecordSnapshot(vaultPath: string, sourceId: string): SourceRecordSnapshot | undefined {
  const dateKey = /^src_(\d{8})_[a-z0-9]{8,}$/u.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const root = path.join(vaultPath, ".pige", "source-records");
  const filePath = path.join(root, dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  assertConfinedFile(vaultPath, root, filePath);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw caught;
  }
  if (bytes.byteLength > MAX_SOURCE_RECORD_BYTES) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record exceeds its read bound.");
  }
  const parsed = SourceRecordSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success || parsed.data.id !== sourceId) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record is invalid.");
  }
  return { filePath, checksum: hashBytes(bytes), record: parsed.data };
}

function listSourceRecordIds(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "source-records");
  const result: string[] = [];
  for (const year of safeDirectories(root)) {
    if (!/^\d{4}$/u.test(year)) continue;
    for (const month of safeDirectories(path.join(root, year))) {
      if (!/^\d{2}$/u.test(month)) continue;
      const directory = path.join(root, year, month);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        const match = /^(src_\d{8}_[a-z0-9]{8,})\.json$/u.exec(entry.name);
        if (match) result.push(match[1]!);
      }
    }
  }
  return result.sort((left, right) => left.localeCompare(right, "en-US"));
}

function safeDirectories(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw caught;
  }
}

function replaceSourceRecord(vaultPath: string, expected: SourceRecordSnapshot, record: SourceRecord): void {
  const current = readSourceRecordSnapshot(vaultPath, record.id);
  if (!current || current.filePath !== expected.filePath || current.checksum !== expected.checksum) {
    throw new PigeDomainError("source.reconnect_stale", "The Source Record changed before reconnect commit.");
  }
  writeAtomic(expected.filePath, serializeSourceRecord(record), () => {
    const latest = readSourceRecordSnapshot(vaultPath, record.id);
    if (!latest || latest.checksum !== expected.checksum) {
      throw new PigeDomainError("source.reconnect_stale", "The Source Record changed during reconnect commit.");
    }
  });
}

function createRelinkOperation(
  requestId: string,
  before: SourceRecordSnapshot,
  afterChecksum: string,
  now: Date
): OperationRecord {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = createHash("sha256")
    .update(`pige.source-reconnect.operation.v1\0${requestId}\0${before.record.id}\0${before.checksum}\0${afterChecksum}`)
    .digest("hex").slice(0, 24);
  return OperationRecordSchema.parse({
    id: `op_${day}_${suffix}`,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "relink_source",
    targetRefs: [{ kind: "source", id: before.record.id }],
    sourceRefs: [],
    before: { kind: "source", id: before.record.id, checksum: before.checksum },
    after: { kind: "source", id: before.record.id, checksum: afterChecksum },
    summary: "Reconnected one unavailable referenced original after exact content verification.",
    reversible: "best_effort",
    rollbackHint: "Reconnect this source again only to the same verified content if its location changes.",
    warnings: []
  });
}

function receiptRoot(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "private", "source-reconnect-receipts");
}

function receiptPath(vaultPath: string, operationId: string): string {
  return path.join(receiptRoot(vaultPath), `${operationId}.json`);
}

function writeReceipt(vaultPath: string, receipt: SourceReconnectReceipt): void {
  const root = receiptRoot(vaultPath);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const filePath = receiptPath(vaultPath, receipt.operation.id);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (fs.existsSync(filePath)) {
    if (!fs.readFileSync(filePath).equals(bytes)) throw new PigeDomainError("source.reconnect_stale", "Reconnect receipt conflict.");
    return;
  }
  writeExclusive(filePath, bytes);
}

function readReceipt(filePath: string): SourceReconnectReceipt {
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Reconnect receipt is too large.");
  const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== 1 || typeof value.sourceId !== "string" ||
    typeof value.beforeChecksum !== "string" || typeof value.afterChecksum !== "string") throw new Error("Invalid reconnect receipt.");
  return {
    schemaVersion: 1,
    sourceId: value.sourceId,
    beforeChecksum: value.beforeChecksum,
    afterChecksum: value.afterChecksum,
    beforeRecord: SourceRecordSchema.parse(value.beforeRecord),
    afterRecord: SourceRecordSchema.parse(value.afterRecord),
    operation: OperationRecordSchema.parse(value.operation)
  };
}

function listReceiptPaths(vaultPath: string): string[] {
  const root = receiptRoot(vaultPath);
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^op_\d{8}_[a-z0-9]{8,}\.json$/u.test(entry.name))
      .map((entry) => path.join(root, entry.name));
  } catch (caught) {
    return (caught as NodeJS.ErrnoException).code === "ENOENT" ? [] : (() => { throw caught; })();
  }
}

function removeReceipt(vaultPath: string, operationId: string): void {
  try { fs.unlinkSync(receiptPath(vaultPath, operationId)); } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const day = /^op_(\d{8})_/u.exec(operation.id)?.[1];
  if (!day) throw new Error("Invalid reconnect Operation ID.");
  const directory = path.join(vaultPath, ".pige", "operations", day.slice(0, 4), day.slice(4, 6));
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${operation.id}.json`);
  const bytes = Buffer.from(`${JSON.stringify(OperationRecordSchema.parse(operation), null, 2)}\n`, "utf8");
  if (fs.existsSync(filePath)) {
    if (!fs.readFileSync(filePath).equals(bytes)) throw new PigeDomainError("source.reconnect_stale", "Operation identity conflict.");
    return;
  }
  writeExclusive(filePath, bytes);
}

function writeExclusive(filePath: string, bytes: Buffer): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  flushDirectory(path.dirname(filePath));
}

function writeAtomic(filePath: string, bytes: Buffer, assertCurrent: () => void): void {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertCurrent();
    fs.renameSync(temporary, filePath);
    flushDirectory(directory);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* already committed */ }
  }
}

function serializeSourceRecord(record: SourceRecord): Buffer {
  return Buffer.from(`${JSON.stringify(SourceRecordSchema.parse(record), null, 2)}\n`, "utf8");
}

function hashBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function flushDirectory(directory: string): void {
  try {
    const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch {
    // Directory fsync is unavailable on some supported filesystems.
  }
}

function assertConfinedFile(vaultPath: string, root: string, filePath: string): void {
  const vaultReal = fs.realpathSync.native(vaultPath);
  const relativeToRoot = path.relative(root, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record escapes its durable root.");
  }
  let current = vaultPath;
  for (const segment of path.relative(vaultPath, path.dirname(filePath)).split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("source.reconnect_invalid", "The Source Record parent is unsafe.");
    }
  }
  const parentReal = fs.realpathSync.native(path.dirname(filePath));
  if (parentReal !== vaultReal && !parentReal.startsWith(`${vaultReal}${path.sep}`)) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record escapes the active vault.");
  }
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new PigeDomainError("source.reconnect_invalid", "The Source Record file is unsafe.");
    }
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}
