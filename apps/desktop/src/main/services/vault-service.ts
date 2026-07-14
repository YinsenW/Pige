import { app, dialog, shell, type BrowserWindow } from "electron";
import path from "node:path";
import type {
  CreateVaultRequest,
  OnboardingStatus,
  RecentVaultSummary,
  UpdateSourceStoragePolicyRequest,
  VaultActionResult,
  VaultSummary
} from "@pige/contracts";
import { PIGE_DEFAULT_VAULT_NAME, PigeDomainError } from "@pige/domain";
import { LocalSettingsStore } from "./local-settings";
import {
  createVaultOnDisk,
  isPigeVault,
  loadVaultSummary,
  normalizeVaultName,
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

export class VaultService {
  readonly #settings: LocalSettingsStore;
  readonly #hasDefaultModel: () => boolean;
  readonly #acquireWriterLease: VaultWriterLeaseFactory;
  #activeVaultPath: string | undefined;
  #activeVault: VaultSummary | undefined;
  #activeWriterLease: VaultWriterLeasePort | undefined;

  constructor(
    settings: LocalSettingsStore,
    hasDefaultModel: () => boolean = () => false,
    acquireWriterLease: VaultWriterLeaseFactory = acquireVaultWriterLease
  ) {
    this.#settings = settings;
    this.#hasDefaultModel = hasDefaultModel;
    this.#acquireWriterLease = acquireWriterLease;
    this.#restoreActiveVaultFromSettings();
  }

  current(): VaultSummary | undefined {
    if (this.#activeVault) this.#assertActiveWriterLease();
    return this.#activeVault;
  }

  activeVaultPath(): string | undefined {
    if (this.#activeVaultPath) this.#assertActiveWriterLease();
    return this.#activeVaultPath;
  }

  assertWriterLease(vaultPath: string): void {
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
    return { status: "completed", vault, onboarding: this.onboardingStatus() };
  }

  async open(parentWindow: BrowserWindow): Promise<VaultActionResult> {
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
    return { status: "completed", vault, onboarding: this.onboardingStatus() };
  }

  openPath(vaultPathInput: string): VaultActionResult {
    const vaultPath = path.resolve(vaultPathInput);
    if (!isPigeVault(vaultPath)) {
      throw new PigeDomainError("vault_not_compatible", "Selected folder is not a compatible Pige vault.");
    }
    const vault = loadVaultSummary(vaultPath);
    this.#setActiveVault(vaultPath, vault);
    return { status: "completed", vault, onboarding: this.onboardingStatus() };
  }

  async revealKnowledgeRoot(): Promise<void> {
    const activeVaultPath = this.#requireActiveVaultPath();
    await shell.openPath(activeVaultPath);
  }

  async revealSourceAssetRoot(): Promise<void> {
    const activeVault = this.#requireActiveVault();
    await shell.openPath(activeVault.sourceAssetRootDisplay);
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
    return this.#settings.removeRecentVault(vaultId);
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

  #setActiveVault(vaultPath: string, vault: VaultSummary): void {
    const requestedPath = path.resolve(vaultPath);
    if (this.#activeWriterLease?.vaultPath === requestedPath) {
      this.#activeWriterLease.assertHeld();
      this.#activeVaultPath = requestedPath;
      this.#activeVault = vault;
      this.#settings.setActiveVault(requestedPath, vault);
      return;
    }

    const nextLease = this.#acquireWriterLease(requestedPath);
    const nextPath = nextLease.vaultPath;
    let settingsCommitted = false;
    try {
      nextLease.assertHeld();
      this.#settings.setActiveVault(nextPath, vault);
      settingsCommitted = true;
    } finally {
      if (!settingsCommitted) nextLease.release();
    }

    const previousLease = this.#activeWriterLease;
    this.#activeWriterLease = nextLease;
    this.#activeVaultPath = nextPath;
    this.#activeVault = vault;
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

  #requireActiveVault(): VaultSummary {
    if (!this.#activeVault) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    this.#assertActiveWriterLease();
    return this.#activeVault;
  }

  #requireActiveVaultPath(): string {
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
