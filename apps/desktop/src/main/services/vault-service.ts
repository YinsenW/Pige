import { app, dialog, shell, type BrowserWindow } from "electron";
import path from "node:path";
import type {
  CreateVaultRequest,
  OnboardingStatus,
  OpenRecentVaultRequest,
  RecentVaultForgetRequest,
  RecentVaultForgetResult,
  RecentVaultReconnectRequest,
  RecentVaultReconnectResult,
  RecentVaultSummary,
  UpdateSourceStoragePolicyRequest,
  ManagedCopyRootConfigureRequest,
  ManagedCopyRootConfigureResult,
  VaultActionResult,
  VaultMigrationApplyRequest,
  VaultMigrationApplyResult,
  VaultRenameDisplayNameRequest,
  VaultRenameDisplayNameResult,
  VaultRevealResult,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import { PIGE_DEFAULT_VAULT_NAME, PigeDomainError } from "@pige/domain";
import { LocalSettingsStore, type RecentVaultBinding } from "./local-settings";
import {
  createVaultOnDisk,
  inspectVaultCompatibility,
  isPigeVault,
  loadVaultSummary,
  normalizeVaultName,
  prepareVaultStorageRevealBinding,
  resetRebuildableVaultStorage,
  updateVaultSourceAssetRootKind,
  updateVaultSourceStorageStrategy
} from "./vault-layout";
import {
  acquireVaultWriterLease
} from "./vault-writer-lease";
import { VaultMigrationService } from "./vault-migration-service";
import { VaultMetadataService } from "./vault-metadata-service";

export interface VaultWriterLeasePort {
  readonly vaultPath: string;
  assertHeld(): void;
  release(): void;
}

export type VaultWriterLeaseFactory = (vaultPath: string) => VaultWriterLeasePort;
export type VaultPathRevealer = (targetPath: string) => Promise<string>;

export interface VaultManagedCopyRootPort {
  summary(vaultId: string, mode: VaultSummary["sourceAssetRootKind"]): VaultSummary["managedCopyRoot"];
  selection(vaultId: string): { readonly rootPath: string } | undefined;
  bindDefault(input: {
    readonly vaultId: string;
    readonly selectedDirectory: string;
  }): unknown;
  reconnectDefault(input: {
    readonly vaultPath: string;
    readonly vaultId: string;
    readonly selectedDirectory: string;
    readonly expectedSourceStorageRevision: string;
  }): unknown;
}

export interface VaultRestoreTransition {
  readonly previousVaultPath?: string;
  readonly previousVault?: VaultSummary;
  assertHeld(): void;
  commit(vaultPath: string, vault: VaultSummary): void;
  rollback(): void;
}

interface ActiveRestoreTransition {
  readonly token: symbol;
  readonly previousVaultPath?: string;
  readonly previousVault?: VaultSummary;
  readonly previousWriterLease?: VaultWriterLeasePort;
}

export class VaultService {
  readonly #settings: LocalSettingsStore;
  readonly #hasDefaultModel: () => boolean;
  readonly #acquireWriterLease: VaultWriterLeaseFactory;
  readonly #revealPath: VaultPathRevealer;
  readonly #migration: VaultMigrationService;
  readonly #managedRoots: VaultManagedCopyRootPort | undefined;
  readonly #metadata: VaultMetadataService;
  #activeVaultPath: string | undefined;
  #activeVault: VaultSummary | undefined;
  #activeWriterLease: VaultWriterLeasePort | undefined;
  #restoreTransition: ActiveRestoreTransition | undefined;

  constructor(
    settings: LocalSettingsStore,
    hasDefaultModel: () => boolean = () => false,
    acquireWriterLease: VaultWriterLeaseFactory = acquireVaultWriterLease,
    revealPath: VaultPathRevealer = (targetPath) => shell.openPath(targetPath),
    migration = new VaultMigrationService(app.getPath("userData") || process.cwd()),
    managedRoots?: VaultManagedCopyRootPort,
    metadata = new VaultMetadataService()
  ) {
    this.#settings = settings;
    this.#hasDefaultModel = hasDefaultModel;
    this.#acquireWriterLease = acquireWriterLease;
    this.#revealPath = revealPath;
    this.#migration = migration;
    this.#managedRoots = managedRoots;
    this.#metadata = metadata;
    this.#restoreActiveVaultFromSettings();
  }

  current(): VaultSummary | undefined {
    this.#assertNoRestoreTransition();
    if (this.#activeVault) this.#assertActiveWriterLease();
    return this.#activeVault;
  }

  activeVaultPath(): string | undefined {
    this.#assertNoRestoreTransition();
    if (this.#activeVaultPath) this.#assertActiveWriterLease();
    return this.#activeVaultPath;
  }

  assertWriterLease(vaultPath: string): void {
    this.#assertNoRestoreTransition();
    if (
      !this.#activeVaultPath ||
      path.resolve(vaultPath) !== this.#activeVaultPath
    ) {
      throw new PigeDomainError("vault.binding_changed", "The active vault binding changed.");
    }
    this.#assertActiveWriterLease();
  }

  close(): void {
    const lease = this.#activeWriterLease;
    this.#activeWriterLease = undefined;
    this.#activeVaultPath = undefined;
    this.#activeVault = undefined;
    this.#restoreTransition = undefined;
    try {
      lease?.release();
    } catch {
      // A lost lease is no longer ours to remove; local write authority is already revoked.
    }
  }

  recent(): RecentVaultSummary[] {
    return this.#settings.toRecentVaultSummaries();
  }

  onboardingStatus(): OnboardingStatus {
    const activeVault = this.current();
    const hasDefaultModel = this.#hasDefaultModel();
    return {
      state: activeVault ? "ready" : "blocked_no_vault",
      ...(activeVault ? { activeVault } : {}),
      hasDefaultModel,
      showFirstHomeGuide: Boolean(
        activeVault && !hasDefaultModel && !this.#settings.hasDismissedFirstHome(activeVault.vaultId)
      ),
      waitingDependencyCounts: {
        modelProvider: activeVault && !hasDefaultModel ? 1 : 0,
        localTool: 0,
        localModel: 0,
        runtimeCapability: 0,
        vaultBinding: activeVault ? 0 : 1,
        externalSource: 0
      }
    };
  }

  dismissFirstHomeGuide(): OnboardingStatus {
    const activeVault = this.#requireActiveVault();
    this.#settings.dismissFirstHome(activeVault.vaultId);
    return this.onboardingStatus();
  }

  async create(parentWindow: BrowserWindow, request: CreateVaultRequest): Promise<VaultActionResult> {
    this.#assertNoRestoreTransition();
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "Choose where to create the Pige vault",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"]
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { status: "canceled" };
    }

    const parentDirectory = selection.filePaths[0];
    if (!parentDirectory) return { status: "canceled" };

    const vault = createVaultOnDisk({
      parentDirectory,
      vaultName: request.vaultName,
      appDataPath: app.getPath("appData"),
      tempPath: app.getPath("temp")
    });
    const vaultPath = path.join(parentDirectory, normalizeVaultName(request.vaultName));
    this.#setActiveVault(vaultPath, vault);
    return { status: "completed", compatibility: "current", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
  }

  async open(parentWindow: BrowserWindow): Promise<VaultActionResult> {
    this.#assertNoRestoreTransition();
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: "Open a Pige vault",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory"]
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { status: "canceled" };
    }

    const vaultPath = selection.filePaths[0];
    if (!vaultPath) return { status: "canceled" };
    return this.#openCompatiblePath(vaultPath);
  }

  openPath(vaultPathInput: string): VaultActionResult {
    this.#assertNoRestoreTransition();
    const vaultPath = path.resolve(vaultPathInput);
    return this.#openCompatiblePath(vaultPath);
  }

  openRecent(request: OpenRecentVaultRequest): VaultActionResult {
    this.#assertNoRestoreTransition();
    const binding = this.#settings.resolveRecentVaultBinding(request.vaultId);
    return this.#openCompatiblePath(binding.vaultPath, binding);
  }

  async applyMigration(request: VaultMigrationApplyRequest): Promise<VaultMigrationApplyResult> {
    this.#assertNoRestoreTransition();
    const vaultPath = this.#migration.resolvePreviewPath(request);
    if (!vaultPath) return { ...request, status: "stale", current: "invalid" };
    const lease = this.#acquireWriterLease(vaultPath);
    let adopted = false;
    try {
      const outcome = await this.#migration.apply(request, lease);
      if ("status" in outcome) return outcome;
      lease.assertHeld();
      this.#adoptMigratedVaultLease(lease, outcome.vault);
      adopted = true;
      return {
        ...request,
        status: "completed",
        jobId: outcome.jobId,
        operationId: outcome.operationId,
        vault: this.#requireActiveVault(),
        onboarding: this.onboardingStatus()
      };
    } finally {
      if (!adopted) {
        try { lease.release(); } catch { /* failed migration has no retained authority */ }
      }
    }
  }

  async revealKnowledgeRoot(): Promise<VaultRevealResult> {
    return this.#revealStorageRoot("knowledge_root");
  }

  async revealSourceAssetRoot(): Promise<VaultRevealResult> {
    return this.#revealStorageRoot("source_asset_root");
  }

  updateSourceStoragePolicy(request: UpdateSourceStoragePolicyRequest): VaultSummary {
    const activeVaultPath = this.#requireActiveVaultPath();
    const vault = updateVaultSourceStorageStrategy(activeVaultPath, request.defaultStrategy);
    this.#assertActiveWriterLease();
    this.#activeVault = this.#decorateVault(activeVaultPath, vault);
    this.#settings.setActiveVault(activeVaultPath, this.#activeVault);
    return this.#activeVault;
  }

  renameDisplayName(request: VaultRenameDisplayNameRequest): VaultRenameDisplayNameResult {
    const identity = { ...request };
    const current = this.current();
    const activeVaultPath = this.activeVaultPath();
    if (!current || !activeVaultPath || current.vaultId !== request.activeVaultId) {
      return { ...identity, status: "not_found" };
    }
    this.#assertActiveWriterLease();
    const result = this.#metadata.renameDisplayName(
      { vaultId: current.vaultId, vaultPath: activeVaultPath },
      request
    );
    this.#assertActiveWriterLease();
    if (result.status === "renamed" || result.status === "stale") {
      const authoritative = this.#decorateVault(activeVaultPath, loadVaultSummary(activeVaultPath));
      if (
        authoritative.vaultId !== result.metadata.activeVaultId ||
        authoritative.metadataRevision !== result.metadata.revision
      ) {
        return { ...identity, status: "failed" };
      }
      this.#activeVault = authoritative;
      this.#settings.setActiveVault(activeVaultPath, authoritative);
    }
    return result;
  }

  async configureManagedCopyRoot(
    parentWindow: BrowserWindow,
    request: ManagedCopyRootConfigureRequest
  ): Promise<ManagedCopyRootConfigureResult> {
    const identity = {
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      expectedSourceStorageRevision: request.expectedSourceStorageRevision
    };
    const activeVaultPath = this.#requireActiveVaultPath();
    const current = this.#requireActiveVault();
    if (current.vaultId !== request.activeVaultId) return { ...identity, status: "not_found" };
    if (!this.#managedRoots || !current.managedCopyRoot.canConfigure) {
      return { ...identity, status: "ineligible", summary: current.managedCopyRoot };
    }
    if (current.managedCopyRoot.sourceStorageRevision !== request.expectedSourceStorageRevision) {
      return { ...identity, status: "stale", summary: current.managedCopyRoot };
    }
    const reconnectMissingDefault = current.sourceAssetRootKind === "external_binding" &&
      current.managedCopyRoot.availability !== "available";
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: reconnectMissingDefault
        ? "Reconnect the existing source-copy folder"
        : "Choose a folder for future source copies",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"]
    });
    if (selection.canceled || selection.filePaths.length !== 1 || !selection.filePaths[0]) {
      return { ...identity, status: "cancelled" };
    }
    try {
      if (this.#requireActiveVaultPath() !== activeVaultPath) return { ...identity, status: "stale", summary: this.#requireActiveVault().managedCopyRoot };
      const beforeCommit = this.#requireActiveVault();
      if (
        beforeCommit.vaultId !== request.activeVaultId ||
        beforeCommit.managedCopyRoot.sourceStorageRevision !== request.expectedSourceStorageRevision
      ) return { ...identity, status: "stale", summary: beforeCommit.managedCopyRoot };
      if (reconnectMissingDefault) {
        this.#managedRoots.reconnectDefault({
          vaultPath: activeVaultPath,
          vaultId: request.activeVaultId,
          selectedDirectory: selection.filePaths[0],
          expectedSourceStorageRevision: request.expectedSourceStorageRevision
        });
      } else {
        this.#managedRoots.bindDefault({ vaultId: request.activeVaultId, selectedDirectory: selection.filePaths[0] });
      }
      const updated = this.#decorateVault(
        activeVaultPath,
        updateVaultSourceAssetRootKind(activeVaultPath, "external_binding")
      );
      this.assertWriterLease(activeVaultPath);
      this.#activeVault = updated;
      this.#settings.setActiveVault(activeVaultPath, updated);
      return { ...identity, status: "configured", summary: updated.managedCopyRoot };
    } catch {
      return { ...identity, status: "failed" };
    }
  }

  resetLocalDatabase(expected: { readonly activeVaultId: string; readonly vaultPath: string }) {
    const activeVault = this.#requireActiveVault();
    const activeVaultPath = this.#requireActiveVaultPath();
    if (
      activeVault.vaultId !== expected.activeVaultId ||
      activeVaultPath !== path.resolve(expected.vaultPath)
    ) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed while local database reset confirmation was open."
      );
    }
    const result = resetRebuildableVaultStorage(activeVaultPath);
    this.assertWriterLease(activeVaultPath);
    return result;
  }

  forgetRecent(request: RecentVaultForgetRequest): RecentVaultForgetResult {
    this.#assertNoRestoreTransition();
    if (this.#activeVault) this.#assertActiveWriterLease();
    try {
      return { ...request, ...this.#settings.forgetRecentVault(request, this.#activeVault?.vaultId) };
    } catch {
      return { ...request, status: "failed" };
    }
  }

  async reconnectRecent(
    parentWindow: BrowserWindow,
    request: RecentVaultReconnectRequest
  ): Promise<RecentVaultReconnectResult> {
    this.#assertNoRestoreTransition();
    if (this.#activeVault) this.#assertActiveWriterLease();
    try {
      const initial = this.#settings.recentVaultSnapshot(request.vaultId);
      if (!initial) return { ...request, status: "not_found" };
      if (initial.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: initial.revision };
      }
      if (initial.isActive || this.#activeVault?.vaultId === request.vaultId) {
        return { ...request, status: "active", currentRevision: initial.revision };
      }
      const selection = await dialog.showOpenDialog(parentWindow, {
        title: "Reconnect a Pige vault",
        defaultPath: app.getPath("documents"),
        properties: ["openDirectory"]
      });
      const current = this.#settings.recentVaultSnapshot(request.vaultId);
      if (!current) return { ...request, status: "not_found" };
      if (current.revision !== request.expectedRevision) {
        return { ...request, status: "stale", currentRevision: current.revision };
      }
      if (current.isActive || this.#activeVault?.vaultId === request.vaultId) {
        return { ...request, status: "active", currentRevision: current.revision };
      }
      if (selection.canceled || selection.filePaths.length === 0) {
        return { ...request, status: "cancelled", currentRevision: current.revision };
      }
      const selectedPath = selection.filePaths[0];
      if (!selectedPath) return { ...request, status: "cancelled", currentRevision: current.revision };
      const inspection = inspectVaultCompatibility(selectedPath);
      if (inspection.status === "invalid") return { ...request, status: "failed" };
      const selectedVaultId = inspection.status === "unsupported_newer"
        ? inspection.vaultId
        : inspection.manifest.vault_id;
      if (selectedVaultId !== request.vaultId) return { ...request, status: "mismatch" };
      if (inspection.status === "unsupported_newer" || !isPigeVault(selectedPath)) {
        return { ...request, status: "failed" };
      }
      const summary = loadVaultSummary(selectedPath);
      const verified = inspectVaultCompatibility(selectedPath);
      if (verified.status === "invalid" || verified.status === "unsupported_newer") {
        return { ...request, status: "failed" };
      }
      if (verified.manifest.vault_id !== request.vaultId) return { ...request, status: "mismatch" };
      if (verified.snapshotId !== inspection.snapshotId) return { ...request, status: "failed" };
      return {
        ...request,
        ...this.#settings.reconnectRecentVault(
          request,
          selectedPath,
          summary,
          this.#activeVault?.vaultId
        )
      };
    } catch {
      return { ...request, status: "failed" };
    }
  }

  beginRestoreTransition(input: {
    readonly expectedActiveVaultPath?: string;
    readonly expectedActiveVaultId?: string;
  } = {}): VaultRestoreTransition {
    this.#assertNoRestoreTransition();
    if (this.#activeVaultPath || this.#activeVault || this.#activeWriterLease) {
      this.#assertActiveWriterLease();
    }

    const expectedPath = input.expectedActiveVaultPath && path.resolve(input.expectedActiveVaultPath);
    if (
      (input.expectedActiveVaultPath !== undefined && expectedPath !== this.#activeVaultPath) ||
      (input.expectedActiveVaultId !== undefined && input.expectedActiveVaultId !== this.#activeVault?.vaultId)
    ) {
      throw new PigeDomainError("vault.binding_changed", "The active vault changed before restore coordination.");
    }

    const state: ActiveRestoreTransition = {
      token: Symbol("vault-restore-transition"),
      ...(this.#activeVaultPath ? { previousVaultPath: this.#activeVaultPath } : {}),
      ...(this.#activeVault ? { previousVault: this.#activeVault } : {}),
      ...(this.#activeWriterLease ? { previousWriterLease: this.#activeWriterLease } : {})
    };
    this.#restoreTransition = state;
    let finished = false;

    const assertHeld = (): void => {
      if (finished || this.#restoreTransition?.token !== state.token) {
        throw new PigeDomainError("vault.binding_changed", "The restore transition is no longer current.");
      }
      if (
        this.#activeVaultPath !== state.previousVaultPath ||
        this.#activeVault?.vaultId !== state.previousVault?.vaultId ||
        this.#activeWriterLease !== state.previousWriterLease
      ) {
        throw new PigeDomainError("vault.binding_changed", "The active vault changed during restore coordination.");
      }
      state.previousWriterLease?.assertHeld();
    };

    return {
      ...(state.previousVaultPath ? { previousVaultPath: state.previousVaultPath } : {}),
      ...(state.previousVault ? { previousVault: state.previousVault } : {}),
      assertHeld,
      commit: (vaultPathInput, vault) => {
        assertHeld();
        const requestedPath = path.resolve(vaultPathInput);
        if (state.previousVaultPath && requestedPath === state.previousVaultPath) {
          throw new PigeDomainError("restore.destination_conflict", "Restore must commit to a fresh destination.");
        }

        const nextLease = this.#acquireWriterLease(requestedPath);
        let settingsCommitted = false;
        try {
          nextLease.assertHeld();
          assertHeld();
          this.#settings.swapActiveVaultBinding({
            ...(state.previousVaultPath ? { expectedActiveVaultPath: state.previousVaultPath } : {}),
            ...(state.previousVault ? { expectedActiveVaultId: state.previousVault.vaultId } : {}),
            nextVaultPath: nextLease.vaultPath,
            nextVault: vault
          });
          settingsCommitted = true;
        } finally {
          if (!settingsCommitted) {
            try {
              nextLease.release();
            } catch {
              // A failed new lease cannot authorize binding or cleanup.
            }
          }
        }

        this.#activeWriterLease = nextLease;
        this.#activeVaultPath = nextLease.vaultPath;
        this.#activeVault = vault;
        this.#restoreTransition = undefined;
        finished = true;
        try {
          state.previousWriterLease?.release();
        } catch {
          // The old binding is already replaced and no longer grants write authority here.
        }
      },
      rollback: () => {
        assertHeld();
        this.#settings.assertActiveVaultBinding(state.previousVaultPath, state.previousVault?.vaultId);
        this.#restoreTransition = undefined;
        finished = true;
      }
    };
  }

  #restoreActiveVaultFromSettings(): void {
    const activeVaultPath = this.#settings.getActiveVaultPath();
    if (!activeVaultPath) return;

    try {
      if (inspectVaultCompatibility(activeVaultPath).status !== "current" || !isPigeVault(activeVaultPath)) {
        this.#settings.clearActiveVault();
        return;
      }
      this.#setActiveVault(activeVaultPath, loadVaultSummary(activeVaultPath));
    } catch (caught) {
      if (
        caught instanceof PigeDomainError &&
        new Set(["vault.writer_locked", "vault.writer_lease_invalid", "vault.writer_lease_lost"])
          .has(caught.code)
      ) {
        return;
      }
      this.#settings.clearActiveVault();
    }
  }

  #setActiveVault(vaultPath: string, vault: VaultSummary, recentBinding?: RecentVaultBinding): void {
    this.#assertNoRestoreTransition();
    const requestedPath = path.resolve(vaultPath);
    if (this.#activeWriterLease?.vaultPath === requestedPath) {
      this.#activeWriterLease.assertHeld();
      this.#activeVaultPath = requestedPath;
      this.#activeVault = this.#decorateVault(vaultPath, vault);
      if (recentBinding) this.#settings.activateRecentVault(recentBinding, requestedPath, this.#activeVault);
      else this.#settings.setActiveVault(requestedPath, this.#activeVault);
      return;
    }

    const nextLease = this.#acquireWriterLease(requestedPath);
    const nextPath = nextLease.vaultPath;
    let settingsCommitted = false;
    try {
      nextLease.assertHeld();
      const loadedVault = nextPath === requestedPath ? vault : loadVaultSummary(nextPath);
      const nextVault = this.#decorateVault(nextPath, loadedVault);
      if (nextVault.vaultId !== vault.vaultId) {
        throw new PigeDomainError("vault.binding_changed", "The canonical vault identity changed.");
      }
      if (recentBinding) {
        this.#settings.activateRecentVault(recentBinding, nextPath, nextVault);
      } else {
        this.#settings.setActiveVault(nextPath, nextVault);
      }
      this.#activeVault = nextVault;
      settingsCommitted = true;
    } finally {
      if (!settingsCommitted) nextLease.release();
    }

    const previousLease = this.#activeWriterLease;
    this.#activeWriterLease = nextLease;
    this.#activeVaultPath = nextPath;
    if (previousLease) {
      try {
        previousLease.release();
      } catch {
        // The previous vault is no longer writable through this service.
      }
    }
  }

  #decorateVault(vaultPath: string, vault: VaultSummary): VaultSummary {
    if (!this.#managedRoots) return vault;
    const managedCopyRoot = this.#managedRoots.summary(vault.vaultId, vault.sourceAssetRootKind);
    const selection = vault.sourceAssetRootKind === "external_binding"
      ? this.#managedRoots.selection(vault.vaultId)
      : undefined;
    return {
      ...vault,
      sourceAssetRootDisplay: selection ? path.basename(selection.rootPath) || "External folder" : vault.sourceAssetRootDisplay,
      managedCopyRoot
    };
  }

  #adoptMigratedVaultLease(lease: VaultWriterLeasePort, vault: VaultSummary): void {
    lease.assertHeld();
    const nextPath = path.resolve(lease.vaultPath);
    const current = inspectVaultCompatibility(nextPath);
    if (current.status !== "current" || current.manifest.vault_id !== vault.vaultId) {
      throw new PigeDomainError("vault.binding_changed", "The migrated vault identity changed before activation.");
    }
    this.#settings.setActiveVault(nextPath, vault);
    const previous = this.#activeWriterLease;
    this.#activeWriterLease = lease;
    this.#activeVaultPath = nextPath;
    this.#activeVault = vault;
    if (previous && previous !== lease) {
      try { previous.release(); } catch { /* previous binding is already revoked */ }
    }
  }

  #openCompatiblePath(vaultPathInput: string, recentBinding?: RecentVaultBinding): VaultActionResult {
    const vaultPath = path.resolve(vaultPathInput);
    const inspection = inspectVaultCompatibility(vaultPath);
    if (inspection.status === "invalid") return { status: "invalid", reason: inspection.reason };
    if (recentBinding) {
      const observedVaultId = inspection.status === "unsupported_newer"
        ? inspection.vaultId
        : inspection.manifest.vault_id;
      if (observedVaultId !== recentBinding.vaultId) {
        throw new PigeDomainError("vault.recent_stale", "The recent vault identity changed.");
      }
    }
    if (inspection.status === "unsupported_newer") {
      return { status: "unsupported_newer", vaultId: inspection.vaultId, foundVersion: inspection.foundVersion, supportedVersion: 2 };
    }
    if (inspection.status === "needs_migration") {
      const preview = this.#migration.inspect(vaultPath);
      return preview ? { status: "needs_migration", preview } : { status: "invalid", reason: "manifest_malformed" };
    }
    const vault = loadVaultSummary(vaultPath);
    this.#setActiveVault(vaultPath, vault, recentBinding);
    this.#migration.recoverCommitted(vaultPath, this.#activeWriterLease!);
    return { status: "completed", compatibility: "current", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
  }

  #assertActiveWriterLease(): void {
    if (!this.#activeWriterLease) {
      throw new PigeDomainError("vault.writer_lease_lost", "The active vault writer lease is unavailable.");
    }
    this.#activeWriterLease.assertHeld();
  }

  #assertNoRestoreTransition(): void {
    if (this.#restoreTransition) {
      throw new PigeDomainError("restore.in_progress", "The active vault is closed for restore coordination.");
    }
  }

  async #revealStorageRoot(target: VaultRevealTarget): Promise<VaultRevealResult> {
    let binding: ReturnType<typeof prepareVaultStorageRevealBinding> | undefined;
    try {
      const activeVaultPath = this.#requireActiveVaultPath();
      const activeVault = this.#requireActiveVault();
      if (target === "source_asset_root" && activeVault.sourceAssetRootKind === "external_binding") {
        const selected = this.#managedRoots?.selection(activeVault.vaultId);
        if (!selected) throw new PigeDomainError("vault.external_binding_unavailable", "The external root is unavailable.");
        const expectedRevision = activeVault.managedCopyRoot.sourceStorageRevision;
        const openError = await this.#revealPath(selected.rootPath);
        const current = this.#requireActiveVault();
        if (
          openError !== "" ||
          current.vaultId !== activeVault.vaultId ||
          this.#managedRoots?.summary(current.vaultId, current.sourceAssetRootKind).sourceStorageRevision !== expectedRevision
        ) throw new PigeDomainError("vault.reveal_failed", "The managed-copy root changed before reveal completed.");
        return { status: "revealed", target };
      }
      binding = prepareVaultStorageRevealBinding(activeVaultPath, target);
      this.assertWriterLease(activeVaultPath);
      binding.assertCurrent();
      const openError = await this.#revealPath(binding.targetPath);
      binding.assertCurrent();
      this.assertWriterLease(activeVaultPath);
      if (openError !== "") throw new Error("The operating system did not reveal the storage root.");
      return { status: "revealed", target };
    } catch {
      return {
        status: "failed",
        target,
        error: {
          code: "vault.reveal_failed",
          domain: "vault",
          messageKey: "errors.vault.reveal_failed",
          retryable: true,
          severity: "warning",
          userAction: "retry"
        }
      };
    } finally {
      binding?.release();
    }
  }

  #requireActiveVault(): VaultSummary {
    this.#assertNoRestoreTransition();
    if (!this.#activeVault) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    this.#assertActiveWriterLease();
    return this.#activeVault;
  }

  #requireActiveVaultPath(): string {
    this.#assertNoRestoreTransition();
    if (!this.#activeVaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    this.#assertActiveWriterLease();
    return this.#activeVaultPath;
  }
}

export function createVaultService(hasDefaultModel: () => boolean = () => false): VaultService {
  return new VaultService(new LocalSettingsStore(app.getPath("userData")), hasDefaultModel);
}

export function suggestedVaultName(): string {
  return PIGE_DEFAULT_VAULT_NAME;
}
