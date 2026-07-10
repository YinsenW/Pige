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

export class VaultService {
  readonly #settings: LocalSettingsStore;
  readonly #hasDefaultModel: () => boolean;
  #activeVaultPath: string | undefined;
  #activeVault: VaultSummary | undefined;

  constructor(settings: LocalSettingsStore, hasDefaultModel: () => boolean = () => false) {
    this.#settings = settings;
    this.#hasDefaultModel = hasDefaultModel;
    this.#restoreActiveVaultFromSettings();
  }

  current(): VaultSummary | undefined {
    return this.#activeVault;
  }

  activeVaultPath(): string | undefined {
    return this.#activeVaultPath;
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
    this.#setActiveVault(activeVaultPath, vault);
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
    } catch {
      this.#settings.clearActiveVault();
    }
  }

  #setActiveVault(vaultPath: string, vault: VaultSummary): void {
    this.#activeVaultPath = vaultPath;
    this.#activeVault = vault;
    this.#settings.setActiveVault(vaultPath, vault);
  }

  #requireActiveVault(): VaultSummary {
    if (!this.#activeVault) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return this.#activeVault;
  }

  #requireActiveVaultPath(): string {
    if (!this.#activeVaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return this.#activeVaultPath;
  }
}

export function createVaultService(hasDefaultModel: () => boolean = () => false): VaultService {
  return new VaultService(new LocalSettingsStore(app.getPath("userData")), hasDefaultModel);
}

export function suggestedVaultName(): string {
  return PIGE_DEFAULT_VAULT_NAME;
}
