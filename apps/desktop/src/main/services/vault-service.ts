import { app, dialog, shell, type BrowserWindow } from "electron";
import path from "node:path";
import type {
  CreateVaultRequest,
  OnboardingStatus,
  OpenRecentVaultRequest,
  RecentVaultSummary,
  UpdateSourceStoragePolicyRequest,
  VaultActionResult,
  VaultRevealResult,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import { PIGE_DEFAULT_VAULT_NAME, PigeDomainError } from "@pige/domain";
import { LocalSettingsStore, type RecentVaultBinding } from "./local-settings";
import {
  createVaultOnDisk,
  isPigeVault,
  loadVaultSummary,
  normalizeVaultName,
  prepareVaultStorageRevealBinding,
  resetRebuildableVaultStorage,
  updateVaultSourceStorageStrategy
} from "./vault-layout";
import {
  acquireVaultWriterLease
} from "./vault-writer-lease";

export interface VaultWriterLeasePort {
  readonly vaultPath: string;
  assertHeld(): void;
  release(): void;
}

export type VaultWriterLeaseFactory = (vaultPath: string) => VaultWriterLeasePort;
export type VaultPathRevealer = (targetPath: string) => Promise<string>;

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
  #activeVaultPath: string | undefined;
  #activeVault: VaultSummary | undefined;
  #activeWriterLease: VaultWriterLeasePort | undefined;
  #restoreTransition: ActiveRestoreTransition | undefined;

  constructor(
    settings: LocalSettingsStore,
    hasDefaultModel: () => boolean = () => false,
    acquireWriterLease: VaultWriterLeaseFactory = acquireVaultWriterLease,
    revealPath: VaultPathRevealer = (targetPath) => shell.openPath(targetPath)
  ) {
    this.#settings = settings;
    this.#hasDefaultModel = hasDefaultModel;
    this.#acquireWriterLease = acquireWriterLease;
    this.#revealPath = revealPath;
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
      state: activeVault ? (hasDefaultModel ? "ready" : "capture_only") : "blocked_no_vault",
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
    return { status: "completed", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
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
    if (!isPigeVault(vaultPath)) {
      throw new PigeDomainError("vault_not_compatible", "Selected folder is not a compatible Pige vault.");
    }

    const vault = loadVaultSummary(vaultPath);
    this.#setActiveVault(vaultPath, vault);
    return { status: "completed", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
  }

  openPath(vaultPathInput: string): VaultActionResult {
    this.#assertNoRestoreTransition();
    const vaultPath = path.resolve(vaultPathInput);
    if (!isPigeVault(vaultPath)) {
      throw new PigeDomainError("vault_not_compatible", "Selected folder is not a compatible Pige vault.");
    }
    const vault = loadVaultSummary(vaultPath);
    this.#setActiveVault(vaultPath, vault);
    return { status: "completed", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
  }

  openRecent(request: OpenRecentVaultRequest): VaultActionResult {
    this.#assertNoRestoreTransition();
    const binding = this.#settings.resolveRecentVaultBinding(request.vaultId);
    if (!isPigeVault(binding.vaultPath)) {
      throw new PigeDomainError("vault.recent_not_found", "The recent vault is no longer available.");
    }
    const vault = loadVaultSummary(binding.vaultPath);
    if (vault.vaultId !== binding.vaultId) {
      throw new PigeDomainError("vault.recent_stale", "The recent vault identity changed.");
    }
    this.#setActiveVault(binding.vaultPath, vault, binding);
    return { status: "completed", vault: this.#requireActiveVault(), onboarding: this.onboardingStatus() };
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
    this.#activeVault = vault;
    this.#settings.setActiveVault(activeVaultPath, vault);
    return vault;
  }

  resetLocalDatabase() {
    return resetRebuildableVaultStorage(this.#requireActiveVaultPath());
  }

  removeRecent(vaultId: string): RecentVaultSummary[] {
    this.#assertNoRestoreTransition();
    return this.#settings.removeRecentVault(vaultId);
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
      if (!isPigeVault(activeVaultPath)) {
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
      this.#activeVault = vault;
      if (recentBinding) this.#settings.activateRecentVault(recentBinding, requestedPath, vault);
      else this.#settings.setActiveVault(requestedPath, vault);
      return;
    }

    const nextLease = this.#acquireWriterLease(requestedPath);
    const nextPath = nextLease.vaultPath;
    let settingsCommitted = false;
    try {
      nextLease.assertHeld();
      const nextVault = nextPath === requestedPath ? vault : loadVaultSummary(nextPath);
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
