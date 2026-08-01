import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type { KnowledgeActivitySummary, KnowledgeActivityUndoResult } from "@pige/contracts";
import {
  CollectionPurgeDatasetRequestSchema,
  CollectionPurgeDatasetResultSchema,
  OperationRecordSchema,
  type CollectionPurgeDatasetRequest,
  type CollectionPurgeDatasetResult,
  type OperationRecord
} from "@pige/schemas";
import {
  operationIdFor,
  treeMatches,
  readOperation,
  readReceipt,
  readDatasetTrashInventory,
  receiptPath,
  receiptRoot,
  resolveVault,
  matchesTrashOperation
} from "./managed-dataset-lifecycle-service";

interface DatasetPurgeVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
}

interface PurgeTreeEntry {
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly mode: number;
  readonly size?: number;
  readonly sha256?: string;
}

interface DatasetPurgeIntent {
  readonly schemaVersion: 1;
  readonly kind: "dataset_purge_tombstone";
  readonly requestId: string;
  readonly requestDigest: string;
  readonly activeVaultId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly trashOperationId: string;
  readonly expectedTrashRevision: string;
  readonly purgeOperationId: string;
  readonly title: string;
  readonly bundleRelativePath: string;
  readonly quarantineRelativePath: string;
  readonly treeDigest: string;
  readonly entries: readonly PurgeTreeEntry[];
  readonly createdAt: string;
}

interface DatasetPurgeTestHooks { readonly afterOperation?: () => void; }

const MAX_INTENT_BYTES = 8 * 1024 * 1024;

export class ManagedDatasetPurgeService {
  readonly #vaults: DatasetPurgeVaultPort;
  readonly #now: () => Date;
  readonly #hooks: DatasetPurgeTestHooks;

  constructor(vaults: DatasetPurgeVaultPort, now: () => Date = () => new Date(), hooks: DatasetPurgeTestHooks = {}) {
    this.#vaults = vaults;
    this.#now = now;
    this.#hooks = hooks;
  }

  purge(request: CollectionPurgeDatasetRequest): CollectionPurgeDatasetResult {
    const parsed = CollectionPurgeDatasetRequestSchema.parse(request);
    const identity = requestIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "not_found" });
    try {
      const purgeOperationId = operationIdFor(parsed.requestId, parsed.datasetId, "purge", this.#now());
      const existing = readIntent(vaultPath, purgeOperationId);
      if (existing) {
        if (!matchesRequest(existing, parsed)) return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "stale" });
        this.#complete(vaultPath, existing);
        return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "committed", operationId: purgeOperationId });
      }
      const trashOperation = readOperation(vaultPath, parsed.trashOperationId);
      const receipt = trashOperation ? readReceipt(vaultPath, trashOperation.id) : undefined;
      if (!trashOperation || !receipt || !matchesTrashOperation(receipt, trashOperation) ||
          receipt.datasetId !== parsed.datasetId || receipt.revisionId !== parsed.expectedRevisionId) {
        return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "not_found" });
      }
      const inventory = readDatasetTrashInventory(vaultPath);
      if (inventory.revision !== parsed.expectedTrashRevision) {
        return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "stale" });
      }
      if (!inventory.datasets.some((item) => item.trashOperationId === parsed.trashOperationId)) {
        return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "not_found" });
      }
      const bundlePath = resolveVault(vaultPath, receipt.trashRelativePath);
      if (!treeMatches(bundlePath, receipt.treeDigest)) {
        return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "stale" });
      }
      const intent: DatasetPurgeIntent = {
        schemaVersion: 1,
        kind: "dataset_purge_tombstone",
        requestId: parsed.requestId,
        requestDigest: digestRequest(parsed),
        activeVaultId: parsed.activeVaultId,
        datasetId: parsed.datasetId,
        revisionId: parsed.expectedRevisionId,
        trashOperationId: parsed.trashOperationId,
        expectedTrashRevision: parsed.expectedTrashRevision,
        purgeOperationId,
        title: receipt.title,
        bundleRelativePath: receipt.trashRelativePath,
        quarantineRelativePath: path.posix.join(".pige", "dataset-lifecycle", "purge-quarantine", purgeOperationId),
        treeDigest: receipt.treeDigest,
        entries: collectTreeManifest(bundlePath),
        createdAt: this.#now().toISOString()
      };
      writeIntent(vaultPath, intent);
      this.#complete(vaultPath, intent);
      return CollectionPurgeDatasetResultSchema.parse({ ...identity, status: "committed", operationId: purgeOperationId });
    } catch (caught) {
      const status = caught instanceof PigeDomainError && caught.code === "dataset_purge.stale" ? "stale" : "failed";
      return CollectionPurgeDatasetResultSchema.parse({ ...identity, status });
    }
  }

  recoverIncompletePurges(): { readonly recovered: number; readonly failed: number } {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vaultPath) return { recovered: 0, failed: 0 };
    let recovered = 0;
    let failed = 0;
    for (const intent of readIntents(vaultPath)) {
      try {
        if (isSettled(vaultPath, intent)) continue;
        this.#complete(vaultPath, intent); recovered += 1;
      }
      catch { failed += 1; }
    }
    return { recovered, failed };
  }

  activitySummary(operation: OperationRecord): KnowledgeActivitySummary | undefined {
    if (operation.kind !== "purge_dataset") return undefined;
    const vaultPath = this.#vaults.activeVaultPath();
    const intent = vaultPath ? readIntent(vaultPath, operation.id) : undefined;
    if (!intent || !matchesPurgeOperation(intent, operation)) return undefined;
    return { operationId: operation.id, kind: "purge_dataset", createdAt: operation.createdAt,
      targetLabel: intent.title, status: "applied", canUndo: false };
  }

  findUndoOperation(): undefined { return undefined; }
  undo(operation: OperationRecord): KnowledgeActivityUndoResult { return { status: "not_found", operationId: operation.id }; }

  #complete(vaultPath: string, intent: DatasetPurgeIntent): void {
    const bundlePath = resolveVault(vaultPath, intent.bundleRelativePath);
    const quarantinePath = resolveVault(vaultPath, intent.quarantineRelativePath);
    assertDirectoryChain(vaultPath, path.dirname(bundlePath));
    if (exists(path.dirname(quarantinePath))) assertDirectoryChain(vaultPath, path.dirname(quarantinePath));
    const operation = readOperation(vaultPath, intent.purgeOperationId);
    if (operation && !matchesPurgeOperation(intent, operation)) throw stale();
    if (exists(bundlePath)) {
      if (exists(quarantinePath) || !treeMatches(bundlePath, intent.treeDigest) ||
          !manifestMatches(bundlePath, intent.entries, false)) throw stale();
      ensureDirectoryChain(vaultPath, path.dirname(quarantinePath));
      assertDirectoryChain(vaultPath, path.dirname(quarantinePath));
      fs.renameSync(bundlePath, quarantinePath);
      syncDirectory(path.dirname(bundlePath));
      syncDirectory(path.dirname(quarantinePath));
    }
    if (!operation) {
      if (!exists(quarantinePath) || !manifestMatches(quarantinePath, intent.entries, false)) throw stale();
      writePurgeOperation(vaultPath, createPurgeOperation(intent));
      this.#hooks.afterOperation?.();
    }
    if (exists(quarantinePath)) {
      if (!manifestMatches(quarantinePath, intent.entries, true)) throw stale();
      removeManifestTree(quarantinePath, intent.entries);
      syncDirectory(path.dirname(quarantinePath));
    }
    removeReceipt(vaultPath, intent.trashOperationId);
  }

  #activeVaultPath(vaultId: string): string | undefined {
    return this.#vaults.current()?.vaultId === vaultId ? this.#vaults.activeVaultPath() : undefined;
  }
}

function createPurgeOperation(intent: DatasetPurgeIntent): OperationRecord {
  return OperationRecordSchema.parse({
    id: intent.purgeOperationId,
    schemaVersion: 1,
    createdAt: intent.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "purge_dataset",
    targetRefs: [{ kind: "dataset", id: intent.datasetId }],
    sourceRefs: [{ kind: "operation", id: intent.trashOperationId }],
    before: { kind: "dataset_revision", id: intent.revisionId },
    summary: `Permanently deleted ${intent.title} from recoverable trash.`,
    reversible: "no",
    warnings: ["This deletion cannot be undone."]
  });
}

function matchesPurgeOperation(intent: DatasetPurgeIntent, operation: OperationRecord): boolean {
  return operation.id === intent.purgeOperationId && operation.kind === "purge_dataset" &&
    operation.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === intent.datasetId && ref.path === undefined) &&
    operation.sourceRefs.some((ref) => ref.kind === "operation" && ref.id === intent.trashOperationId) &&
    operation.before?.kind === "dataset_revision" && operation.before.id === intent.revisionId &&
    operation.after === undefined && operation.reversible === "no";
}

function isSettled(vaultPath: string, intent: DatasetPurgeIntent): boolean {
  const operation = readOperation(vaultPath, intent.purgeOperationId);
  if (!operation || !matchesPurgeOperation(intent, operation)) return false;
  const bundlePath = resolveVault(vaultPath, intent.bundleRelativePath);
  const quarantinePath = resolveVault(vaultPath, intent.quarantineRelativePath);
  assertDirectoryChain(vaultPath, path.dirname(bundlePath));
  if (exists(path.dirname(quarantinePath))) assertDirectoryChain(vaultPath, path.dirname(quarantinePath));
  assertDirectoryChain(vaultPath, receiptRoot(vaultPath));
  return !exists(bundlePath) && !exists(quarantinePath) && !exists(receiptPath(vaultPath, intent.trashOperationId));
}

function writePurgeOperation(vaultPath: string, operation: OperationRecord): void {
  const root = resolveVault(vaultPath, path.posix.join(".pige", "operations"));
  ensureDirectoryChain(vaultPath, root);
  const filePath = path.join(root, `${operation.id}.json`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(operation, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  syncDirectory(root);
}

function collectTreeManifest(root: string): PurgeTreeEntry[] {
  const entries: PurgeTreeEntry[] = [];
  const visit = (current: string, relativePath: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw stale();
    if (stat.isDirectory()) {
      entries.push({ relativePath, kind: "directory", mode: stat.mode & 0o777 });
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), relativePath ? `${relativePath}/${name}` : name);
    } else if (stat.isFile()) {
      entries.push({ relativePath, kind: "file", mode: stat.mode & 0o777, size: stat.size,
        sha256: createHash("sha256").update(fs.readFileSync(current)).digest("hex") });
    } else throw stale();
  };
  visit(root, "");
  if (entries.length > 20_000 || Buffer.byteLength(JSON.stringify(entries)) > MAX_INTENT_BYTES / 2) throw stale();
  return entries;
}

function manifestMatches(root: string, manifest: readonly PurgeTreeEntry[], allowMissing: boolean): boolean {
  try {
    const expected = new Map(manifest.map((entry) => [entry.relativePath, entry]));
    const visit = (current: string, relativePath: string): void => {
      const entry = expected.get(relativePath);
      if (!entry) throw stale();
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.mode & 0o777) !== entry.mode) throw stale();
      if (entry.kind === "directory") {
        if (!stat.isDirectory()) throw stale();
        for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), relativePath ? `${relativePath}/${name}` : name);
      } else {
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== entry.size ||
            createHash("sha256").update(fs.readFileSync(current)).digest("hex") !== entry.sha256) throw stale();
      }
    };
    visit(root, "");
    if (!allowMissing) return collectTreeManifest(root).length === manifest.length;
    return true;
  } catch { return false; }
}

function removeManifestTree(root: string, manifest: readonly PurgeTreeEntry[]): void {
  const depth = (value: string): number => value ? value.split("/").length : 0;
  const byDepth = [...manifest].sort((left, right) => depth(right.relativePath) - depth(left.relativePath) ||
    right.relativePath.localeCompare(left.relativePath, "en"));
  for (const entry of byDepth) {
    const current = entry.relativePath ? path.join(root, ...entry.relativePath.split("/")) : root;
    if (!exists(current)) continue;
    const stat = fs.lstatSync(current);
    if (entry.kind === "file") {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== entry.size ||
          createHash("sha256").update(fs.readFileSync(current)).digest("hex") !== entry.sha256) throw stale();
      fs.unlinkSync(current);
    } else {
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(current).length > 0) throw stale();
      fs.rmdirSync(current);
    }
  }
}

function intentRoot(vaultPath: string): string {
  return resolveVault(vaultPath, path.posix.join(".pige", "dataset-lifecycle", "purge-tombstones"));
}
function intentPath(vaultPath: string, operationId: string): string { return path.join(intentRoot(vaultPath), `${operationId}.json`); }

function writeIntent(vaultPath: string, intent: DatasetPurgeIntent): void {
  ensureDirectoryChain(vaultPath, intentRoot(vaultPath));
  const bytes = `${JSON.stringify(intent, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_INTENT_BYTES) throw stale();
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(intentPath(vaultPath, intent.purgeOperationId), fs.constants.O_WRONLY |
      fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  syncDirectory(intentRoot(vaultPath));
}

function readIntent(vaultPath: string, operationId: string): DatasetPurgeIntent | undefined {
  try { return parseIntent(readIntentBytes(vaultPath, intentPath(vaultPath, operationId))); }
  catch (caught) { if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw caught; }
}
function readIntents(vaultPath: string): DatasetPurgeIntent[] {
  if (!exists(intentRoot(vaultPath))) return [];
  assertDirectoryChain(vaultPath, intentRoot(vaultPath));
  const names = fs.readdirSync(intentRoot(vaultPath)).filter((name) => /^op_\d{8}_[a-z0-9]{8,}\.json$/u.test(name));
  if (names.length > 10_000) throw stale();
  return names.map((name) => parseIntent(readIntentBytes(vaultPath, path.join(intentRoot(vaultPath), name))));
}
function parseIntent(bytes: string): DatasetPurgeIntent {
  if (Buffer.byteLength(bytes) > MAX_INTENT_BYTES) throw stale();
  const value = JSON.parse(bytes) as Partial<DatasetPurgeIntent>;
  const exactKeys = "activeVaultId,bundleRelativePath,createdAt,datasetId,entries,expectedTrashRevision,kind,purgeOperationId,quarantineRelativePath,requestDigest,requestId,revisionId,schemaVersion,title,trashOperationId,treeDigest";
  if (Object.keys(value).sort().join(",") !== exactKeys || value.schemaVersion !== 1 ||
      value.kind !== "dataset_purge_tombstone" || typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) || typeof value.purgeOperationId !== "string" ||
      typeof value.requestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.requestDigest) ||
      typeof value.title !== "string" || value.title.length < 1 || value.title.length > 120 ||
      typeof value.treeDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.treeDigest) ||
      !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 20_000) throw stale();
  const request = CollectionPurgeDatasetRequestSchema.safeParse({ apiVersion: 1, requestId: value.requestId,
    activeVaultId: value.activeVaultId, datasetId: value.datasetId, expectedRevisionId: value.revisionId,
    trashOperationId: value.trashOperationId, expectedTrashRevision: value.expectedTrashRevision,
    confirmation: "delete_permanently" });
  if (!request.success || value.requestDigest !== digestRequest(request.data) ||
      value.purgeOperationId !== operationIdFor(request.data.requestId, request.data.datasetId, "purge", new Date(value.createdAt)) ||
      value.bundleRelativePath !== path.posix.join(".pige", "trash", "datasets", request.data.trashOperationId, "bundle") ||
      value.quarantineRelativePath !== path.posix.join(".pige", "dataset-lifecycle", "purge-quarantine", value.purgeOperationId)) throw stale();
  const seen = new Set<string>();
  for (const [index, entry] of value.entries.entries()) {
    if (!entry || typeof entry !== "object") throw stale();
    const candidate = entry as Partial<PurgeTreeEntry>;
    const file = candidate.kind === "file";
    const expectedKeys = file ? "kind,mode,relativePath,sha256,size" : "kind,mode,relativePath";
    if (Object.keys(candidate).sort().join(",") !== expectedKeys ||
        (candidate.kind !== "directory" && candidate.kind !== "file") || typeof candidate.relativePath !== "string" ||
        (candidate.relativePath !== "" && (candidate.relativePath.split("/").some((part) => !part || part === "." || part === "..") ||
          candidate.relativePath.includes("\\") || candidate.relativePath.includes("\0"))) ||
        seen.has(candidate.relativePath) || !Number.isInteger(candidate.mode) || candidate.mode! < 0 || candidate.mode! > 0o777 ||
        (file && (!Number.isSafeInteger(candidate.size) || candidate.size! < 0 ||
          typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)))) throw stale();
    if (index === 0 && (candidate.relativePath !== "" || candidate.kind !== "directory")) throw stale();
    if (index > 0 && candidate.relativePath === "") throw stale();
    seen.add(candidate.relativePath);
  }
  return value as DatasetPurgeIntent;
}

function readIntentBytes(vaultPath: string, filePath: string): string {
  assertDirectoryChain(vaultPath, path.dirname(filePath));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_INTENT_BYTES) throw stale();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw stale();
    return bytes.toString("utf8");
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function requestIdentity(request: CollectionPurgeDatasetRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    datasetId: request.datasetId, expectedRevisionId: request.expectedRevisionId,
    trashOperationId: request.trashOperationId, expectedTrashRevision: request.expectedTrashRevision,
    confirmation: request.confirmation };
}
function digestRequest(request: CollectionPurgeDatasetRequest): string {
  return `sha256:${createHash("sha256").update("pige.dataset.purge-request.v1\0")
    .update(JSON.stringify(requestIdentity(request))).digest("hex")}`;
}
function matchesRequest(intent: DatasetPurgeIntent, request: CollectionPurgeDatasetRequest): boolean {
  return intent.requestId === request.requestId && intent.requestDigest === digestRequest(request) &&
    intent.activeVaultId === request.activeVaultId && intent.datasetId === request.datasetId &&
    intent.revisionId === request.expectedRevisionId && intent.trashOperationId === request.trashOperationId &&
    intent.expectedTrashRevision === request.expectedTrashRevision;
}

function removeReceipt(vaultPath: string, operationId: string): void {
  try {
    assertDirectoryChain(vaultPath, receiptRoot(vaultPath));
    const stat = fs.lstatSync(receiptPath(vaultPath, operationId));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw stale();
    fs.unlinkSync(receiptPath(vaultPath, operationId)); syncDirectory(receiptRoot(vaultPath));
  }
  catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught; }
}

function ensureDirectoryChain(vaultPath: string, directoryPath: string): void {
  const root = path.resolve(vaultPath);
  const target = path.resolve(directoryPath);
  if (!target.startsWith(`${root}${path.sep}`)) throw stale();
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const stat = fs.lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw stale(); }
    catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
      fs.mkdirSync(current, { mode: 0o700 }); syncDirectory(path.dirname(current));
    }
  }
}
function assertDirectoryChain(vaultPath: string, directoryPath: string): void {
  const root = path.resolve(vaultPath);
  const target = path.resolve(directoryPath);
  if (!target.startsWith(`${root}${path.sep}`)) throw stale();
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw stale();
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw stale();
  }
}
function exists(filePath: string): boolean { try { fs.lstatSync(filePath); return true; } catch (caught) {
  if ((caught as NodeJS.ErrnoException).code === "ENOENT") return false; throw caught;
} }
function syncDirectory(directory: string): void { const descriptor = fs.openSync(directory, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } }
function stale(): PigeDomainError { return new PigeDomainError("dataset_purge.stale", "The Dataset purge binding changed."); }
