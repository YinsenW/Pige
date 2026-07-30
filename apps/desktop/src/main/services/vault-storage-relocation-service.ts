import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type {
  VaultStorageRelocationRequest,
  VaultStorageRelocationResult,
  VaultStorageRelocationRevision,
  VaultStorageRelocationStatus
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  VaultStorageRelocationRequestSchema,
  VaultStorageRelocationRevisionSchema
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { hasObjectErrorCode as isErrno } from "./object-error-code";
import {
  assertVaultPathAllowed,
  inspectVaultCompatibility,
  isPigeVault,
  loadVaultSummary,
  type VaultPathSafetyOptions
} from "./vault-layout";
import { VaultService, type VaultRestoreTransition } from "./vault-service";

const RECEIPT_DIRECTORY = "vault-relocations";
const RECEIPT_VERSION = 1;
const PRIVATE_FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const BUFFER_BYTES = 1024 * 1024;
const SKIPPED_RUNTIME_PREFIX = ".pige/runtime";
const BLOCKING_JOB_STATES = new Set(["running", "cancel_requested"]);

type RelocationReceiptState =
  | "copying"
  | "verified"
  | "destination_committed"
  | "binding_switched"
  | "completed"
  | "failed";

interface RelocationReceipt {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly expectedRevision: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly stagingPath: string;
  readonly stagingDevice: number;
  readonly stagingInode: number;
  readonly destinationParentDevice: number;
  readonly destinationParentInode: number;
  readonly confirmedAt: string;
  readonly updatedAt: string;
  readonly state: RelocationReceiptState;
  readonly inventoryDigest?: string;
  readonly entryCount?: number;
}

interface VaultTreeEntry {
  readonly relativePath: string;
  readonly kind: "directory" | "file";
  readonly mode: number;
  readonly size?: number;
  readonly checksum?: string;
}

interface VaultTreeInventory {
  readonly entries: readonly VaultTreeEntry[];
  readonly digest: `sha256:${string}`;
}

interface DirectoryIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

interface ActiveRelocationBinding {
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultPath: string;
  readonly revision: VaultStorageRelocationRevision;
}

export interface VaultStorageRelocationRecoverySummary {
  readonly recovered: number;
  readonly failed: number;
}

export interface VaultStorageRelocationServiceOptions {
  readonly userDataPath: string;
  readonly vaultService: VaultService;
  readonly pathSafety: VaultPathSafetyOptions;
  readonly pauseMutableWork: () => Promise<() => void>;
  readonly activeJobStates: () => readonly string[];
  readonly onBindingSwitched?: () => void;
  readonly now?: () => Date;
  readonly testOnlyHooks?: {
    readonly afterWriteFence?: () => void;
    readonly afterCopy?: () => void;
    readonly afterDestinationCommit?: () => void;
    readonly afterBindingSwitch?: () => void;
  };
}

export class VaultStorageRelocationService {
  readonly #receiptRoot: string;
  readonly #vaults: VaultService;
  readonly #pathSafety: VaultPathSafetyOptions;
  readonly #pauseMutableWork: () => Promise<() => void>;
  readonly #activeJobStates: () => readonly string[];
  readonly #onBindingSwitched: () => void;
  readonly #now: () => Date;
  readonly #hooks: NonNullable<VaultStorageRelocationServiceOptions["testOnlyHooks"]>;
  #running = false;

  constructor(options: VaultStorageRelocationServiceOptions) {
    this.#receiptRoot = prepareReceiptRoot(options.userDataPath);
    this.#vaults = options.vaultService;
    this.#pathSafety = options.pathSafety;
    this.#pauseMutableWork = options.pauseMutableWork;
    this.#activeJobStates = options.activeJobStates;
    this.#onBindingSwitched = options.onBindingSwitched ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
    this.#hooks = options.testOnlyHooks ?? {};
  }

  status(): VaultStorageRelocationStatus {
    try {
      const binding = this.#currentBinding();
      return {
        apiVersion: 1,
        status: "ready",
        activeVaultId: binding.vaultId,
        revision: binding.revision
      };
    } catch {
      return { apiVersion: 1, status: "unavailable" };
    }
  }

  async relocate(
    parentWindow: BrowserWindow,
    requestInput: VaultStorageRelocationRequest
  ): Promise<VaultStorageRelocationResult> {
    const request = VaultStorageRelocationRequestSchema.parse(requestInput);
    if (this.#running) {
      try {
        return { ...request, status: "blocked_active_work", currentRevision: this.#currentBinding().revision };
      } catch {
        return { ...request, status: "failed" };
      }
    }
    this.#running = true;
    try {
      const initial = this.#currentBinding();
      if (initial.vaultId !== request.activeVaultId || initial.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: initial.revision };
      }
      if (this.#hasBlockingWork()) {
        return { ...request, status: "blocked_active_work", currentRevision: initial.revision };
      }

      const selection = await dialog.showOpenDialog(parentWindow, {
        title: "Choose a new parent folder for this Pige vault",
        defaultPath: app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"]
      });
      const selectedParent = selection.filePaths.length === 1 ? selection.filePaths[0] : undefined;
      const afterPicker = this.#currentBinding();
      if (afterPicker.vaultId !== request.activeVaultId || afterPicker.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: afterPicker.revision };
      }
      if (selection.canceled || !selectedParent) {
        return { ...request, status: "cancelled", currentRevision: afterPicker.revision };
      }

      let destination: { readonly parent: DirectoryIdentity; readonly path: string };
      try {
        destination = prepareDestination(afterPicker.vaultPath, selectedParent, this.#pathSafety);
      } catch (caught) {
        if (caught instanceof PigeDomainError && caught.code === "vault.relocation_destination_exists") {
          return { ...request, status: "destination_exists", currentRevision: afterPicker.revision };
        }
        return { ...request, status: "failed" };
      }
      const confirmation = await dialog.showMessageBox(parentWindow, {
        type: "warning",
        title: "Move this Pige vault?",
        message: `Pige will copy and verify “${afterPicker.vaultName}” before switching storage.`,
        detail: "The original vault will remain unchanged. Pige will not delete it.",
        buttons: ["Move vault", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      });
      const afterConfirmation = this.#currentBinding();
      if (afterConfirmation.vaultId !== request.activeVaultId || afterConfirmation.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: afterConfirmation.revision };
      }
      if (confirmation.response !== 0) {
        return { ...request, status: "cancelled", currentRevision: afterConfirmation.revision };
      }
      return await this.#runConfirmed(request, destination);
    } catch {
      return { ...request, status: "failed" };
    } finally {
      this.#running = false;
    }
  }

  async recoverInterrupted(): Promise<VaultStorageRelocationRecoverySummary> {
    if (this.#running) return { recovered: 0, failed: 0 };
    this.#running = true;
    let recovered = 0;
    let failed = 0;
    try {
      for (const receipt of this.#readReceipts()) {
        if (receipt.state === "completed" || receipt.state === "failed") continue;
        try {
          if (receipt.state === "copying") {
            removeOwnedStaging(receipt);
            this.#writeReceipt({ ...receipt, state: "failed", updatedAt: this.#now().toISOString() });
            failed += 1;
            continue;
          }
          const current = this.#currentBinding();
          if (current.vaultId === receipt.activeVaultId && current.vaultPath === path.resolve(receipt.destinationPath)) {
            this.#writeReceipt({ ...receipt, state: "completed", updatedAt: this.#now().toISOString() });
            recovered += 1;
            continue;
          }
          if (
            current.vaultId !== receipt.activeVaultId ||
            current.vaultPath !== path.resolve(receipt.sourcePath) ||
            current.revision !== receipt.expectedRevision ||
            !receipt.inventoryDigest
          ) throw new PigeDomainError("vault.relocation_stale", "The relocation receipt is no longer current.");

          const resume = await this.#pauseMutableWork();
          try {
            if (this.#hasBlockingWork()) throw new PigeDomainError("vault.relocation_busy", "Active Vault work blocks recovery.");
            const transition = this.#vaults.beginRestoreTransition({
              expectedActiveVaultPath: receipt.sourcePath,
              expectedActiveVaultId: receipt.activeVaultId
            });
            let committed = false;
            try {
              const destinationPath = adoptVerifiedDestination(receipt, this.#pathSafety);
              const sourceInventory = snapshotVaultTree(receipt.sourcePath);
              if (sourceInventory.digest !== receipt.inventoryDigest || sourceInventory.entries.length !== receipt.entryCount) {
                throw new PigeDomainError("vault.relocation_source_changed", "The original Vault changed before recovery.");
              }
              const inventory = snapshotVaultTree(destinationPath);
              if (inventory.digest !== receipt.inventoryDigest || inventory.entries.length !== receipt.entryCount) {
                throw new PigeDomainError("vault.relocation_copy_invalid", "The relocated Vault copy changed before recovery.");
              }
              const summary = loadVaultSummary(destinationPath);
              if (summary.vaultId !== receipt.activeVaultId) {
                throw new PigeDomainError("vault.relocation_identity_changed", "The relocated Vault identity changed.");
              }
              transition.commit(destinationPath, summary);
              committed = true;
              this.#writeReceipt({ ...receipt, state: "completed", updatedAt: this.#now().toISOString() });
              try { this.#onBindingSwitched(); } catch { /* the durable binding is already authoritative */ }
              recovered += 1;
            } finally {
              if (!committed) transition.rollback();
            }
          } finally {
            resume();
          }
        } catch {
          failed += 1;
        }
      }
      return { recovered, failed };
    } finally {
      this.#running = false;
    }
  }

  async #runConfirmed(
    request: VaultStorageRelocationRequest,
    destination: { readonly parent: DirectoryIdentity; readonly path: string }
  ): Promise<VaultStorageRelocationResult> {
    const resume = await this.#pauseMutableWork();
    let transition: VaultRestoreTransition | undefined;
    let transitionCommitted = false;
    let receipt: RelocationReceipt | undefined;
    try {
      const current = this.#currentBinding();
      if (current.vaultId !== request.activeVaultId || current.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: current.revision };
      }
      if (this.#hasBlockingWork()) {
        return { ...request, status: "blocked_active_work", currentRevision: current.revision };
      }
      assertDirectoryIdentity(destination.parent);
      if (fs.existsSync(destination.path)) {
        return { ...request, status: "destination_exists", currentRevision: current.revision };
      }
      transition = this.#vaults.beginRestoreTransition({
        expectedActiveVaultPath: current.vaultPath,
        expectedActiveVaultId: current.vaultId
      });
      this.#hooks.afterWriteFence?.();
      transition.assertHeld();

      const sourceInventory = snapshotVaultTree(current.vaultPath);
      assertDestinationCapacity(destination.parent.path, sourceInventory);
      const stagingPath = path.join(destination.parent.path, `.${path.basename(destination.path)}.${request.requestId}.pige-relocating`);
      const stagingIdentity = createStaging(stagingPath, destination.parent);
      receipt = {
        schemaVersion: RECEIPT_VERSION,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        expectedRevision: request.expectedRevision,
        sourcePath: current.vaultPath,
        destinationPath: destination.path,
        stagingPath,
        stagingDevice: stagingIdentity.device,
        stagingInode: stagingIdentity.inode,
        destinationParentDevice: destination.parent.device,
        destinationParentInode: destination.parent.inode,
        confirmedAt: this.#now().toISOString(),
        updatedAt: this.#now().toISOString(),
        state: "copying"
      };
      this.#writeReceipt(receipt);

      copyVaultTree(current.vaultPath, stagingPath, sourceInventory);
      this.#hooks.afterCopy?.();
      const sourceAfter = snapshotVaultTree(current.vaultPath);
      const staged = snapshotVaultTree(stagingPath);
      if (
        sourceAfter.digest !== sourceInventory.digest ||
        staged.digest !== sourceInventory.digest ||
        staged.entries.length !== sourceInventory.entries.length
      ) throw new PigeDomainError("vault.relocation_source_changed", "The Vault changed while it was copied.");
      assertCurrentVaultIdentity(stagingPath, request.activeVaultId);
      receipt = {
        ...receipt,
        state: "verified",
        inventoryDigest: sourceInventory.digest,
        entryCount: sourceInventory.entries.length,
        updatedAt: this.#now().toISOString()
      };
      this.#writeReceipt(receipt);

      assertDirectoryIdentity(destination.parent);
      if (fs.existsSync(destination.path)) {
        throw new PigeDomainError("vault.relocation_destination_exists", "The relocation destination already exists.");
      }
      fs.renameSync(stagingPath, destination.path);
      flushDirectoryWhereSupported(destination.parent.path);
      const committedInventory = snapshotVaultTree(destination.path);
      if (
        committedInventory.digest !== sourceInventory.digest ||
        committedInventory.entries.length !== sourceInventory.entries.length
      ) throw new PigeDomainError("vault.relocation_copy_invalid", "The published Vault copy failed verification.");
      ensureEmptyRuntime(destination.path);
      receipt = { ...receipt, state: "destination_committed", updatedAt: this.#now().toISOString() };
      this.#writeReceipt(receipt);
      this.#hooks.afterDestinationCommit?.();

      const relocated = loadVaultSummary(destination.path);
      if (relocated.vaultId !== request.activeVaultId) {
        throw new PigeDomainError("vault.relocation_identity_changed", "The relocated Vault identity changed.");
      }
      const sourceAtCommit = snapshotVaultTree(current.vaultPath);
      if (
        sourceAtCommit.digest !== sourceInventory.digest ||
        sourceAtCommit.entries.length !== sourceInventory.entries.length
      ) throw new PigeDomainError("vault.relocation_source_changed", "The original Vault changed before binding switch.");
      transition.assertHeld();
      transition.commit(destination.path, relocated);
      transitionCommitted = true;
      receipt = { ...receipt, state: "binding_switched", updatedAt: this.#now().toISOString() };
      this.#writeReceipt(receipt);
      this.#hooks.afterBindingSwitch?.();
      this.#onBindingSwitched();
      const completed = { ...receipt, state: "completed" as const, updatedAt: this.#now().toISOString() };
      this.#writeReceipt(completed);
      const next = this.#currentBinding();
      return { ...request, status: "relocated", revision: next.revision };
    } catch {
      if (transitionCommitted) {
        if (receipt) {
          try {
            this.#writeReceipt({ ...receipt, state: "completed", updatedAt: this.#now().toISOString() });
          } catch {
            // Startup recovery can complete a binding-switched receipt.
          }
        }
        try {
          const current = this.#currentBinding();
          if (current.vaultId === request.activeVaultId) {
            return { ...request, status: "relocated", revision: current.revision };
          }
        } catch {
          // A changed binding cannot be represented as a successful exact relocation.
        }
      }
      if (transition && !transitionCommitted) {
        try { transition.rollback(); } catch { /* preserve the authoritative binding */ }
      }
      if (receipt?.state === "copying") {
        removeOwnedStaging(receipt);
        this.#writeReceipt({ ...receipt, state: "failed", updatedAt: this.#now().toISOString() });
      }
      return { ...request, status: "failed" };
    } finally {
      resume();
    }
  }

  #currentBinding(): ActiveRelocationBinding {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) throw new PigeDomainError("vault.relocation_unavailable", "There is no active Vault to relocate.");
    const inspection = inspectVaultCompatibility(vaultPath);
    if (inspection.status !== "current" || inspection.manifest.vault_id !== vault.vaultId || !isPigeVault(vaultPath)) {
      throw new PigeDomainError("vault.relocation_unavailable", "The active Vault is not current.");
    }
    const root = captureDirectoryIdentity(vaultPath);
    const revision = VaultStorageRelocationRevisionSchema.parse(`vaultrelocationrev_${createHash("sha256")
      .update("pige.vault.relocation.binding.v1\0", "utf8")
      .update(vault.vaultId, "utf8").update("\0", "utf8")
      .update(path.resolve(vaultPath), "utf8").update("\0", "utf8")
      .update(String(root.device), "utf8").update(":", "utf8").update(String(root.inode), "utf8").update("\0", "utf8")
      .update(inspection.snapshotId, "utf8").digest("hex")}`);
    return { vaultId: vault.vaultId, vaultName: vault.name, vaultPath: path.resolve(vaultPath), revision };
  }

  #hasBlockingWork(): boolean {
    try { return this.#activeJobStates().some((state) => BLOCKING_JOB_STATES.has(state)); }
    catch { return true; }
  }

  #writeReceipt(receipt: RelocationReceipt): void {
    const parsed = parseReceipt(receipt);
    const filePath = this.#receiptPath(parsed.requestId);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const body = `${JSON.stringify(parsed, null, 2)}\n`;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporaryPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, PRIVATE_FILE_MODE);
      fs.writeFileSync(descriptor, body, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, filePath);
      flushDirectoryWhereSupported(this.#receiptRoot);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporaryPath); } catch (caught) { if (!isErrno(caught, "ENOENT")) throw caught; }
    }
  }

  #readReceipts(): readonly RelocationReceipt[] {
    const receipts: RelocationReceipt[] = [];
    for (const entry of fs.readdirSync(this.#receiptRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const filePath = path.join(this.#receiptRoot, entry.name);
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) continue;
        receipts.push(parseReceipt(JSON.parse(fs.readFileSync(filePath, "utf8"))));
      } catch {
        // An invalid machine-local receipt never authorizes filesystem mutation.
      }
    }
    return receipts.sort((left, right) => left.confirmedAt.localeCompare(right.confirmedAt));
  }

  #receiptPath(requestId: string): string {
    return path.join(this.#receiptRoot, `${requestId}.json`);
  }
}

function prepareReceiptRoot(userDataPathInput: string): string {
  const userDataPath = path.resolve(userDataPathInput);
  fs.mkdirSync(userDataPath, { recursive: true, mode: DIRECTORY_MODE });
  const root = path.join(userDataPath, RECEIPT_DIRECTORY);
  fs.mkdirSync(root, { recursive: true, mode: DIRECTORY_MODE });
  const identity = fs.lstatSync(root);
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new PigeDomainError("vault.relocation_receipt_invalid", "The relocation receipt root is not safe.");
  }
  return fs.realpathSync.native(root);
}

function prepareDestination(
  sourcePathInput: string,
  selectedParentInput: string,
  pathSafety: VaultPathSafetyOptions
): { readonly parent: DirectoryIdentity; readonly path: string } {
  const sourcePath = path.resolve(sourcePathInput);
  const parent = captureDirectoryIdentity(selectedParentInput);
  const destinationPath = path.resolve(parent.path, path.basename(sourcePath));
  assertVaultPathAllowed(destinationPath, pathSafety);
  if (
    destinationPath === sourcePath ||
    destinationPath.startsWith(`${sourcePath}${path.sep}`) ||
    sourcePath.startsWith(`${destinationPath}${path.sep}`)
  ) throw new PigeDomainError("vault.relocation_destination_invalid", "Vault relocation paths cannot be nested.");
  assertNoAncestorVault(parent.path);
  if (fs.existsSync(destinationPath)) {
    throw new PigeDomainError("vault.relocation_destination_exists", "The relocation destination already exists.");
  }
  return { parent, path: destinationPath };
}

function assertNoAncestorVault(directoryPathInput: string): void {
  let current = path.resolve(directoryPathInput);
  const root = path.parse(current).root;
  while (true) {
    if (fs.existsSync(path.join(current, ".pige", "manifest.json"))) {
      throw new PigeDomainError("vault.relocation_destination_invalid", "The relocation destination cannot be inside a Vault.");
    }
    if (current === root) return;
    current = path.dirname(current);
  }
}

function captureDirectoryIdentity(directoryPathInput: string): DirectoryIdentity {
  const directoryPath = fs.realpathSync.native(path.resolve(directoryPathInput));
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("vault.relocation_destination_invalid", "The relocation directory is not safe.");
  }
  return { path: directoryPath, device: stat.dev, inode: stat.ino };
}

function assertDirectoryIdentity(expected: DirectoryIdentity): void {
  const current = captureDirectoryIdentity(expected.path);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new PigeDomainError("vault.relocation_destination_invalid", "The relocation directory changed.");
  }
}

function createStaging(stagingPath: string, parent: DirectoryIdentity): DirectoryIdentity {
  assertDirectoryIdentity(parent);
  fs.mkdirSync(stagingPath, { mode: DIRECTORY_MODE });
  const staging = captureDirectoryIdentity(stagingPath);
  assertDirectoryIdentity(parent);
  return staging;
}

function snapshotVaultTree(rootPathInput: string): VaultTreeInventory {
  const rootPath = path.resolve(rootPathInput);
  const root = captureDirectoryIdentity(rootPath);
  const entries: VaultTreeEntry[] = [];
  scanDirectory(rootPath, "", entries);
  const current = captureDirectoryIdentity(rootPath);
  if (root.device !== current.device || root.inode !== current.inode) {
    throw new PigeDomainError("vault.relocation_source_changed", "The Vault root changed during inspection.");
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  const digest = createHash("sha256").update("pige.vault.relocation.inventory.v1\0", "utf8");
  for (const entry of entries) digest.update(JSON.stringify(entry), "utf8").update("\n", "utf8");
  return { entries, digest: `sha256:${digest.digest("hex")}` };
}

function scanDirectory(rootPath: string, relativeDirectory: string, entries: VaultTreeEntry[]): void {
  const directoryPath = relativeDirectory ? path.join(rootPath, ...relativeDirectory.split("/")) : rootPath;
  const names = fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right, "en"));
  for (const name of names) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    if (relativePath === SKIPPED_RUNTIME_PREFIX || relativePath.startsWith(`${SKIPPED_RUNTIME_PREFIX}/`)) continue;
    const filePath = path.join(rootPath, ...relativePath.split("/"));
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new PigeDomainError("vault.relocation_symlink", "Vault relocation does not follow symbolic links.");
    if (stat.isDirectory()) {
      entries.push({ relativePath, kind: "directory", mode: stat.mode & 0o777 });
      scanDirectory(rootPath, relativePath, entries);
    } else if (stat.isFile()) {
      const checksum = checksumRegularFile(filePath, stat);
      entries.push({ relativePath, kind: "file", mode: stat.mode & 0o777, size: stat.size, checksum });
    } else {
      throw new PigeDomainError("vault.relocation_entry_invalid", "Vault relocation supports only regular files and directories.");
    }
  }
}

function checksumRegularFile(filePath: string, expected: fs.Stats): `sha256:${string}` {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    assertSameFileIdentity(expected, opened);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (read <= 0) throw new PigeDomainError("vault.relocation_source_changed", "A Vault file changed while it was read.");
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    const named = fs.lstatSync(filePath);
    assertSameFileIdentity(opened, after);
    assertSameFileIdentity(opened, named);
    return `sha256:${hash.digest("hex")}`;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function copyVaultTree(sourceRoot: string, targetRoot: string, inventory: VaultTreeInventory): void {
  const directories = inventory.entries.filter(({ kind }) => kind === "directory");
  for (const entry of directories) {
    const targetPath = path.join(targetRoot, ...entry.relativePath.split("/"));
    fs.mkdirSync(targetPath, { mode: entry.mode });
    fs.chmodSync(targetPath, entry.mode);
  }
  for (const entry of inventory.entries.filter(({ kind }) => kind === "file")) {
    copyRegularFileExact(
      path.join(sourceRoot, ...entry.relativePath.split("/")),
      path.join(targetRoot, ...entry.relativePath.split("/")),
      entry
    );
  }
  for (const entry of [...directories].reverse()) {
    flushDirectoryWhereSupported(path.join(targetRoot, ...entry.relativePath.split("/")));
  }
  flushDirectoryWhereSupported(targetRoot);
}

function copyRegularFileExact(sourcePath: string, targetPath: string, expected: VaultTreeEntry): void {
  if (expected.kind !== "file" || expected.size === undefined || !expected.checksum) {
    throw new PigeDomainError("vault.relocation_copy_invalid", "The Vault copy plan is invalid.");
  }
  let sourceDescriptor: number | undefined;
  let targetDescriptor: number | undefined;
  try {
    sourceDescriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const sourceBefore = fs.fstatSync(sourceDescriptor);
    if (!sourceBefore.isFile() || sourceBefore.size !== expected.size) {
      throw new PigeDomainError("vault.relocation_source_changed", "A Vault file changed before copy.");
    }
    const named = fs.lstatSync(sourcePath);
    assertSameFileIdentity(sourceBefore, named);
    targetDescriptor = fs.openSync(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, expected.mode);
    fs.fchmodSync(targetDescriptor, expected.mode);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let offset = 0;
    while (offset < sourceBefore.size) {
      const read = fs.readSync(sourceDescriptor, buffer, 0, Math.min(buffer.length, sourceBefore.size - offset), offset);
      if (read <= 0) throw new PigeDomainError("vault.relocation_source_changed", "A Vault file changed during copy.");
      let written = 0;
      while (written < read) {
        const count = fs.writeSync(targetDescriptor, buffer, written, read - written, offset + written);
        if (count <= 0) throw new PigeDomainError("vault.relocation_copy_invalid", "The Vault copy stopped before completion.");
        written += count;
      }
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    fs.fsyncSync(targetDescriptor);
    const sourceAfter = fs.fstatSync(sourceDescriptor);
    assertSameFileIdentity(sourceBefore, sourceAfter);
    assertSameFileIdentity(sourceBefore, fs.lstatSync(sourcePath));
    if (`sha256:${hash.digest("hex")}` !== expected.checksum) {
      throw new PigeDomainError("vault.relocation_source_changed", "A Vault file changed during copy.");
    }
  } finally {
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    if (targetDescriptor !== undefined) fs.closeSync(targetDescriptor);
  }
}

function assertDestinationCapacity(parentPath: string, inventory: VaultTreeInventory): void {
  if (typeof fs.statfsSync !== "function") return;
  const totalBytes = inventory.entries.reduce((total, entry) => total + (entry.size ?? 0), 0);
  const filesystem = fs.statfsSync(parentPath);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const safetyMargin = Math.max(16 * 1024 * 1024, Math.ceil(totalBytes * 0.05));
  if (!Number.isSafeInteger(availableBytes) || availableBytes < totalBytes + safetyMargin) {
    throw new PigeDomainError("vault.relocation_space_insufficient", "The relocation destination has insufficient free space.");
  }
}

function assertSameFileIdentity(expected: fs.Stats, current: fs.Stats): void {
  if (
    !current.isFile() || current.isSymbolicLink() ||
    expected.dev !== current.dev || expected.ino !== current.ino || expected.size !== current.size ||
    expected.mtimeMs !== current.mtimeMs || expected.ctimeMs !== current.ctimeMs
  ) throw new PigeDomainError("vault.relocation_source_changed", "A Vault file changed during relocation.");
}

function assertCurrentVaultIdentity(vaultPath: string, vaultId: string): void {
  const inspection = inspectVaultCompatibility(vaultPath);
  if (inspection.status !== "current" || inspection.manifest.vault_id !== vaultId || !isPigeVault(vaultPath)) {
    throw new PigeDomainError("vault.relocation_identity_changed", "The relocated Vault identity is invalid.");
  }
}

function ensureEmptyRuntime(vaultPath: string): void {
  const runtimePath = path.join(vaultPath, ".pige", "runtime");
  if (fs.existsSync(runtimePath)) throw new PigeDomainError("vault.relocation_copy_invalid", "Relocation copied transient runtime state.");
  fs.mkdirSync(runtimePath, { mode: DIRECTORY_MODE });
  flushDirectoryWhereSupported(path.dirname(runtimePath));
}

function adoptVerifiedDestination(receipt: RelocationReceipt, pathSafety: VaultPathSafetyOptions): string {
  const parent = captureDirectoryIdentity(path.dirname(receipt.destinationPath));
  if (parent.device !== receipt.destinationParentDevice || parent.inode !== receipt.destinationParentInode) {
    throw new PigeDomainError("vault.relocation_destination_invalid", "The relocation destination parent changed.");
  }
  assertVaultPathAllowed(receipt.destinationPath, pathSafety);
  if (fs.existsSync(receipt.destinationPath)) {
    captureDirectoryIdentity(receipt.destinationPath);
    assertCurrentVaultIdentity(receipt.destinationPath, receipt.activeVaultId);
    ensureRuntimePresent(receipt.destinationPath);
    return path.resolve(receipt.destinationPath);
  }
  const staging = captureDirectoryIdentity(receipt.stagingPath);
  if (staging.device !== receipt.stagingDevice || staging.inode !== receipt.stagingInode) {
    throw new PigeDomainError("vault.relocation_copy_invalid", "The relocation staging identity changed.");
  }
  const inventory = snapshotVaultTree(receipt.stagingPath);
  if (inventory.digest !== receipt.inventoryDigest || inventory.entries.length !== receipt.entryCount) {
    throw new PigeDomainError("vault.relocation_copy_invalid", "The relocation staging copy changed.");
  }
  fs.renameSync(receipt.stagingPath, receipt.destinationPath);
  flushDirectoryWhereSupported(parent.path);
  ensureEmptyRuntime(receipt.destinationPath);
  return path.resolve(receipt.destinationPath);
}

function ensureRuntimePresent(vaultPath: string): void {
  const runtimePath = path.join(vaultPath, ".pige", "runtime");
  if (!fs.existsSync(runtimePath)) {
    fs.mkdirSync(runtimePath, { mode: DIRECTORY_MODE });
    return;
  }
  const stat = fs.lstatSync(runtimePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("vault.relocation_copy_invalid", "The relocated runtime root is invalid.");
  }
}

function removeOwnedStaging(receipt: RelocationReceipt): void {
  try {
    const staging = captureDirectoryIdentity(receipt.stagingPath);
    if (staging.device !== receipt.stagingDevice || staging.inode !== receipt.stagingInode) return;
    fs.rmSync(receipt.stagingPath, { recursive: true });
    flushDirectoryWhereSupported(path.dirname(receipt.stagingPath));
  } catch {
    // Uncertain staging is preserved rather than deleting a changed path.
  }
}

function parseReceipt(value: unknown): RelocationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid relocation receipt.");
  const candidate = value as Record<string, unknown>;
  const keys = new Set(Object.keys(candidate));
  const allowed = new Set([
    "schemaVersion", "requestId", "activeVaultId", "expectedRevision", "sourcePath", "destinationPath",
    "stagingPath", "stagingDevice", "stagingInode", "destinationParentDevice", "destinationParentInode",
    "confirmedAt", "updatedAt", "state", "inventoryDigest", "entryCount"
  ]);
  if ([...keys].some((key) => !allowed.has(key)) || candidate.schemaVersion !== RECEIPT_VERSION) throw new Error("Invalid relocation receipt.");
  const request = VaultStorageRelocationRequestSchema.parse({
    apiVersion: 1,
    requestId: candidate.requestId,
    activeVaultId: candidate.activeVaultId,
    expectedRevision: candidate.expectedRevision
  });
  const states = new Set<RelocationReceiptState>(["copying", "verified", "destination_committed", "binding_switched", "completed", "failed"]);
  if (
    typeof candidate.sourcePath !== "string" || typeof candidate.destinationPath !== "string" ||
    typeof candidate.stagingPath !== "string" || typeof candidate.confirmedAt !== "string" ||
    typeof candidate.updatedAt !== "string" || typeof candidate.state !== "string" ||
    !states.has(candidate.state as RelocationReceiptState) ||
    typeof candidate.stagingDevice !== "number" || !Number.isSafeInteger(candidate.stagingDevice) ||
    typeof candidate.stagingInode !== "number" || !Number.isSafeInteger(candidate.stagingInode) ||
    typeof candidate.destinationParentDevice !== "number" || !Number.isSafeInteger(candidate.destinationParentDevice) ||
    typeof candidate.destinationParentInode !== "number" || !Number.isSafeInteger(candidate.destinationParentInode)
  ) throw new Error("Invalid relocation receipt.");
  if ((candidate.inventoryDigest === undefined) !== (candidate.entryCount === undefined)) throw new Error("Invalid relocation receipt.");
  if (candidate.inventoryDigest !== undefined && (
    typeof candidate.inventoryDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(candidate.inventoryDigest) ||
    !Number.isSafeInteger(candidate.entryCount) || Number(candidate.entryCount) < 1
  )) throw new Error("Invalid relocation receipt.");
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    expectedRevision: request.expectedRevision,
    sourcePath: path.resolve(candidate.sourcePath),
    destinationPath: path.resolve(candidate.destinationPath),
    stagingPath: path.resolve(candidate.stagingPath),
    stagingDevice: Number(candidate.stagingDevice),
    stagingInode: Number(candidate.stagingInode),
    destinationParentDevice: Number(candidate.destinationParentDevice),
    destinationParentInode: Number(candidate.destinationParentInode),
    confirmedAt: candidate.confirmedAt,
    updatedAt: candidate.updatedAt,
    state: candidate.state as RelocationReceiptState,
    ...(candidate.inventoryDigest === undefined ? {} : {
      inventoryDigest: candidate.inventoryDigest,
      entryCount: Number(candidate.entryCount)
    })
  };
}
