import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AppearanceMachineSettingsSchema,
  DictationLanguagePreferenceMachineSettingsSchema,
  MachineLocalSettingsSchema,
  OcrEnginePreferenceMachineSettingsSchema,
  OcrLanguagePreferenceMachineSettingsSchema,
  SettingsProfilePreferencesSchema,
  UpdateMachineSettingsSchema,
  type AppearanceMachineSettings,
  type DictationLanguagePreferenceMachineSettings,
  type Locale,
  type MachineLocalSettings,
  type OcrEnginePreferenceMachineSettings,
  type OcrLanguagePreferenceMachineSettings,
  type SettingsProfilePreferences,
  type StartupDestination,
  type UpdateMachineSettings,
  type WindowPreferences
} from "@pige/schemas";
import type {
  RecentVaultForgetRequest,
  RecentVaultReconnectRequest,
  RecentVaultSummary,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { hasObjectErrorCode as isErrno } from "./object-error-code";
import { acquireVaultWriterLease } from "./vault-writer-lease";

type RecentVaultSettings = MachineLocalSettings["recentVaults"];
type StartupDestinationMachineSettings = NonNullable<MachineLocalSettings["startupDestination"]>;

export interface RecentVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

export interface RecentVaultSnapshot extends RecentVaultBinding {
  readonly revision: RecentVaultSummary["revision"];
  readonly isActive: boolean;
}

export type RecentVaultForgetStoreMutation =
  | { readonly status: "forgotten" }
  | { readonly status: "stale" | "active"; readonly currentRevision: RecentVaultSummary["revision"] }
  | { readonly status: "not_found" | "failed" };

export type RecentVaultReconnectStoreMutation =
  | { readonly status: "reconnected"; readonly revision: RecentVaultSummary["revision"] }
  | { readonly status: "stale" | "active"; readonly currentRevision: RecentVaultSummary["revision"] }
  | { readonly status: "not_found" | "failed" };

export interface UpdateSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: UpdateMachineSettings;
}

export interface AppearanceSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: AppearanceMachineSettings;
}

export interface OcrLanguagePreferenceSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: OcrLanguagePreferenceMachineSettings;
}

export interface OcrEnginePreferenceSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: OcrEnginePreferenceMachineSettings;
}

export interface DictationLanguagePreferenceSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: DictationLanguagePreferenceMachineSettings;
}

export interface StartupDestinationSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: StartupDestinationMachineSettings;
}

export type SettingsProfileApplyMutation =
  | { readonly status: "committed"; readonly preferences: SettingsProfilePreferences }
  | { readonly status: "stale"; readonly preferences: SettingsProfilePreferences };

export class LocalSettingsStore {
  readonly #userDataPath: string;
  readonly #settingsPath: string;

  constructor(userDataPath: string) {
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    const canonicalUserDataPath = fs.realpathSync.native(userDataPath);
    this.#userDataPath = canonicalUserDataPath;
    this.#settingsPath = path.join(canonicalUserDataPath, "settings.json");
    prepareMachineRuntimeRoot(canonicalUserDataPath);
  }

  read(): MachineLocalSettings {
    const body = readBoundedFileNoFollow(this.#settingsPath);
    return body === undefined
      ? { schemaVersion: 1, recentVaults: [] }
      : MachineLocalSettingsSchema.parse(JSON.parse(body));
  }

  write(settings: MachineLocalSettings): void {
    this.#withWriterLease(() => this.#writeUnlocked(settings));
  }

  getActiveVaultPath(): string | undefined {
    return this.read().activeVaultPath;
  }

  getWindowPreferences(): WindowPreferences | undefined {
    return this.read().window;
  }

  getAppLocale(fallback: Locale = "zh-Hans"): Locale {
    return this.read().appLocale ?? fallback;
  }

  getAppearanceSettings(): AppearanceMachineSettings {
    return this.read().appearance ?? createDefaultAppearanceSettings();
  }

  getSettingsProfilePreferences(fallbackLocale: Locale): SettingsProfilePreferences {
    return projectSettingsProfilePreferences(this.read(), fallbackLocale);
  }

  applySettingsProfilePreferences(
    expectedDigest: string,
    fallbackLocale: Locale,
    preferences: SettingsProfilePreferences
  ): SettingsProfileApplyMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const currentPreferences = projectSettingsProfilePreferences(current, fallbackLocale);
      if (digestSettingsProfilePreferences(currentPreferences) !== expectedDigest) {
        return { status: "stale", preferences: currentPreferences };
      }
      const appearance = current.appearance ?? createDefaultAppearanceSettings();
      const startup = current.startupDestination ?? { revision: 0, destination: "home" as const };
      const updates = current.updates ?? createDefaultUpdateSettings();
      const ocrEngine = current.ocrEnginePreference ?? createDefaultOcrEnginePreferenceSettings();
      const ocrLanguage = current.ocrLanguagePreference ?? createDefaultOcrLanguagePreferenceSettings();
      const dictationLanguage = current.dictationLanguagePreference ?? createDefaultDictationLanguagePreferenceSettings();
      const nextRevision = (revision: number): number => {
        if (revision === Number.MAX_SAFE_INTEGER) {
          throw new PigeDomainError("settings.revision_exhausted", "Settings revision is exhausted.");
        }
        return revision + 1;
      };
      const differs = (before: unknown, after: unknown): boolean =>
        JSON.stringify(before) !== JSON.stringify(after);
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: currentPreferences.appLocale === preferences.appLocale ? current.appLocale : preferences.appLocale,
        appearance: differs(currentPreferences.appearance, preferences.appearance)
          ? AppearanceMachineSettingsSchema.parse({ revision: nextRevision(appearance.revision), ...preferences.appearance })
          : current.appearance,
        startupDestination: currentPreferences.startupDestination === preferences.startupDestination
          ? current.startupDestination
          : { revision: nextRevision(startup.revision), destination: preferences.startupDestination },
        window: current.window,
        updates: currentPreferences.updateChannel === preferences.updateChannel
          ? current.updates
          : UpdateMachineSettingsSchema.parse({ revision: nextRevision(updates.revision), channel: preferences.updateChannel }),
        ocrEnginePreference: currentPreferences.ocrEnginePreference === preferences.ocrEnginePreference
          ? current.ocrEnginePreference
          : OcrEnginePreferenceMachineSettingsSchema.parse({ revision: nextRevision(ocrEngine.revision), preference: preferences.ocrEnginePreference }),
        ocrLanguagePreference: differs(currentPreferences.ocrLanguagePreference, preferences.ocrLanguagePreference)
          ? OcrLanguagePreferenceMachineSettingsSchema.parse({ revision: nextRevision(ocrLanguage.revision), preference: preferences.ocrLanguagePreference })
          : current.ocrLanguagePreference,
        dictationLanguagePreference: differs(currentPreferences.dictationLanguagePreference, preferences.dictationLanguagePreference)
          ? DictationLanguagePreferenceMachineSettingsSchema.parse({ revision: nextRevision(dictationLanguage.revision), preference: preferences.dictationLanguagePreference })
          : current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return {
        status: "committed",
        preferences: projectSettingsProfilePreferences(this.read(), fallbackLocale)
      };
    });
  }

  getOcrLanguagePreferenceSettings(): OcrLanguagePreferenceMachineSettings {
    return this.read().ocrLanguagePreference ?? createDefaultOcrLanguagePreferenceSettings();
  }

  getOcrEnginePreferenceSettings(): OcrEnginePreferenceMachineSettings {
    return this.read().ocrEnginePreference ?? createDefaultOcrEnginePreferenceSettings();
  }

  getDictationLanguagePreferenceSettings(): DictationLanguagePreferenceMachineSettings {
    return this.read().dictationLanguagePreference ?? createDefaultDictationLanguagePreferenceSettings();
  }

  getStartupDestinationSettings(): StartupDestinationMachineSettings {
    return this.read().startupDestination ?? { revision: 0, destination: "home" };
  }

  mutateStartupDestinationSettings(
    expectedRevision: number,
    destination: StartupDestination
  ): StartupDestinationSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const settings = current.startupDestination ?? { revision: 0, destination: "home" as const };
      if (settings.revision !== expectedRevision) return { status: "stale", settings };
      if (settings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError("settings.revision_exhausted", "Startup destination revision is exhausted.");
      }
      const next = { revision: settings.revision + 1, destination };
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: current.appearance,
        startupDestination: next,
        window: current.window,
        updates: current.updates,
        ocrEnginePreference: current.ocrEnginePreference,
        ocrLanguagePreference: current.ocrLanguagePreference,
        dictationLanguagePreference: current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: next };
    });
  }

  mutateOcrLanguagePreferenceSettings(
    expectedRevision: number,
    mutation: (settings: OcrLanguagePreferenceMachineSettings) => OcrLanguagePreferenceMachineSettings
  ): OcrLanguagePreferenceSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const settings = current.ocrLanguagePreference ?? createDefaultOcrLanguagePreferenceSettings();
      if (settings.revision !== expectedRevision) return { status: "stale", settings };
      if (settings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError("ocr.language_preference_revision_exhausted", "The OCR language preference revision is exhausted.");
      }
      const candidate = OcrLanguagePreferenceMachineSettingsSchema.parse(mutation(settings));
      const next = OcrLanguagePreferenceMachineSettingsSchema.parse({
        ...candidate,
        revision: settings.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: current.appearance,
        startupDestination: current.startupDestination,
        window: current.window,
        updates: current.updates,
        ocrEnginePreference: current.ocrEnginePreference,
        ocrLanguagePreference: next,
        dictationLanguagePreference: current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: next };
    });
  }

  mutateOcrEnginePreferenceSettings(
    expectedRevision: number,
    mutation: (settings: OcrEnginePreferenceMachineSettings) => OcrEnginePreferenceMachineSettings
  ): OcrEnginePreferenceSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const settings = current.ocrEnginePreference ?? createDefaultOcrEnginePreferenceSettings();
      if (settings.revision !== expectedRevision) return { status: "stale", settings };
      if (settings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError(
          "ocr.engine_preference_revision_exhausted",
          "The OCR engine preference revision is exhausted."
        );
      }
      const candidate = OcrEnginePreferenceMachineSettingsSchema.parse(mutation(settings));
      const next = OcrEnginePreferenceMachineSettingsSchema.parse({
        ...candidate,
        revision: settings.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: current.appearance,
        startupDestination: current.startupDestination,
        window: current.window,
        updates: current.updates,
        ocrEnginePreference: next,
        ocrLanguagePreference: current.ocrLanguagePreference,
        dictationLanguagePreference: current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: next };
    });
  }

  mutateDictationLanguagePreferenceSettings(
    expectedRevision: number,
    mutation: (
      settings: DictationLanguagePreferenceMachineSettings
    ) => DictationLanguagePreferenceMachineSettings
  ): DictationLanguagePreferenceSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const settings = current.dictationLanguagePreference ??
        createDefaultDictationLanguagePreferenceSettings();
      if (settings.revision !== expectedRevision) return { status: "stale", settings };
      if (settings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError(
          "speech.dictation_language_revision_exhausted",
          "The dictation language preference revision is exhausted."
        );
      }
      const candidate = DictationLanguagePreferenceMachineSettingsSchema.parse(mutation(settings));
      const next = DictationLanguagePreferenceMachineSettingsSchema.parse({
        ...candidate,
        revision: settings.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: current.appearance,
        startupDestination: current.startupDestination,
        window: current.window,
        updates: current.updates,
        ocrEnginePreference: current.ocrEnginePreference,
        ocrLanguagePreference: current.ocrLanguagePreference,
        dictationLanguagePreference: next,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: next };
    });
  }

  mutateAppearanceSettings(
    expectedRevision: number,
    mutation: (settings: AppearanceMachineSettings) => AppearanceMachineSettings
  ): AppearanceSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const appearance = current.appearance ?? createDefaultAppearanceSettings();
      if (appearance.revision !== expectedRevision) {
        return { status: "stale", settings: appearance };
      }
      if (appearance.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError("settings.revision_exhausted", "Appearance settings revision is exhausted.");
      }
      const candidate = AppearanceMachineSettingsSchema.parse(mutation(appearance));
      const nextAppearance = AppearanceMachineSettingsSchema.parse({
        ...candidate,
        revision: appearance.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: nextAppearance,
        startupDestination: current.startupDestination,
        window: current.window,
        updates: current.updates,
        ocrEnginePreference: current.ocrEnginePreference,
        ocrLanguagePreference: current.ocrLanguagePreference,
        dictationLanguagePreference: current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: nextAppearance };
    });
  }

  getUpdateSettings(): UpdateMachineSettings {
    return this.read().updates ?? createDefaultUpdateSettings();
  }

  mutateUpdateSettings(
    expectedRevision: number,
    mutation: (settings: UpdateMachineSettings) => UpdateMachineSettings
  ): UpdateSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const updateSettings = current.updates ?? createDefaultUpdateSettings();
      if (updateSettings.revision !== expectedRevision) {
        return { status: "stale", settings: updateSettings };
      }
      if (updateSettings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError("update.revision_exhausted", "Update settings revision is exhausted.");
      }
      const candidate = UpdateMachineSettingsSchema.parse(mutation(updateSettings));
      const nextUpdates = UpdateMachineSettingsSchema.parse({
        ...candidate,
        revision: updateSettings.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        appearance: current.appearance,
        startupDestination: current.startupDestination,
        window: current.window,
        updates: nextUpdates,
        ocrEnginePreference: current.ocrEnginePreference,
        ocrLanguagePreference: current.ocrLanguagePreference,
        dictationLanguagePreference: current.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: nextUpdates };
    });
  }

  hasDismissedFirstHome(vaultId: string): boolean {
    return this.read().dismissedFirstHomeVaultIds?.includes(vaultId) ?? false;
  }

  dismissFirstHome(vaultId: string): MachineLocalSettings {
    return this.#mutate((settings) =>
      createMachineLocalSettings({
        activeVaultPath: settings.activeVaultPath,
        appLocale: settings.appLocale,
        appearance: settings.appearance,
        startupDestination: settings.startupDestination,
        window: settings.window,
        updates: settings.updates,
        ocrEnginePreference: settings.ocrEnginePreference,
        ocrLanguagePreference: settings.ocrLanguagePreference,
        dictationLanguagePreference: settings.dictationLanguagePreference,
        dismissedFirstHomeVaultIds: [
          vaultId,
          ...(settings.dismissedFirstHomeVaultIds ?? []).filter((id) => id !== vaultId)
        ].slice(0, 32),
        recentVaults: settings.recentVaults
      })
    );
  }

  setAppLocale(appLocale: Locale): MachineLocalSettings {
    return this.#mutate((settings) => createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale,
      appearance: settings.appearance,
      startupDestination: settings.startupDestination,
      window: settings.window,
      updates: settings.updates,
      ocrEnginePreference: settings.ocrEnginePreference,
      ocrLanguagePreference: settings.ocrLanguagePreference,
      dictationLanguagePreference: settings.dictationLanguagePreference,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults
    }));
  }

  setWindowPreferences(window: WindowPreferences): MachineLocalSettings {
    return this.#mutate((settings) => createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale: settings.appLocale,
      appearance: settings.appearance,
      startupDestination: settings.startupDestination,
      window,
      updates: settings.updates,
      ocrEnginePreference: settings.ocrEnginePreference,
      ocrLanguagePreference: settings.ocrLanguagePreference,
      dictationLanguagePreference: settings.dictationLanguagePreference,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults
    }));
  }

  setActiveVault(vaultPath: string, summary: VaultSummary): MachineLocalSettings {
    return this.#mutate((settings) => activateVault(settings, vaultPath, summary));
  }

  swapActiveVaultBinding(input: {
    readonly expectedActiveVaultPath?: string;
    readonly expectedActiveVaultId?: string;
    readonly nextVaultPath: string;
    readonly nextVault: VaultSummary;
  }): MachineLocalSettings {
    return this.#mutate((settings) => {
      assertExpectedActiveVault(settings, input.expectedActiveVaultPath, input.expectedActiveVaultId);
      return activateVault(settings, input.nextVaultPath, input.nextVault);
    });
  }

  assertActiveVaultBinding(expectedActiveVaultPath?: string, expectedActiveVaultId?: string): void {
    this.#withWriterLease(() => {
      assertExpectedActiveVault(this.read(), expectedActiveVaultPath, expectedActiveVaultId);
    });
  }

  clearActiveVault(): MachineLocalSettings {
    return this.#mutate((settings) => createMachineLocalSettings({
      appLocale: settings.appLocale,
      appearance: settings.appearance,
      startupDestination: settings.startupDestination,
      window: settings.window,
      updates: settings.updates,
      ocrEnginePreference: settings.ocrEnginePreference,
      ocrLanguagePreference: settings.ocrLanguagePreference,
      dictationLanguagePreference: settings.dictationLanguagePreference,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults
    }));
  }

  recentVaultSnapshot(vaultId: string): RecentVaultSnapshot | undefined {
    const settings = this.read();
    const record = exactRecentVaultRecord(settings.recentVaults, vaultId);
    return record ? {
      vaultId,
      vaultPath: path.resolve(record.path),
      revision: createRecentVaultRevision(record),
      isActive: isActiveRecentRecord(settings.activeVaultPath, record)
    } : undefined;
  }

  forgetRecentVault(
    request: RecentVaultForgetRequest,
    activeVaultId?: string
  ): RecentVaultForgetStoreMutation {
    return this.#withWriterLease(() => {
      const settings = this.read();
      const record = exactRecentVaultRecord(settings.recentVaults, request.vaultId);
      if (!record) return { status: "not_found" };
      const currentRevision = createRecentVaultRevision(record);
      if (currentRevision !== request.expectedRevision) return { status: "stale", currentRevision };
      if (activeVaultId === request.vaultId || isActiveRecentRecord(settings.activeVaultPath, record)) {
        return { status: "active", currentRevision };
      }
      this.#writeUnlocked(withRecentVaults(
        settings,
        settings.recentVaults.filter((recent) => recent.vaultId !== request.vaultId)
      ));
      return { status: "forgotten" };
    });
  }

  reconnectRecentVault(
    request: RecentVaultReconnectRequest,
    selectedVaultPath: string,
    summary: VaultSummary,
    activeVaultId?: string
  ): RecentVaultReconnectStoreMutation {
    return this.#withWriterLease(() => {
      const settings = this.read();
      const record = exactRecentVaultRecord(settings.recentVaults, request.vaultId);
      if (!record) return { status: "not_found" };
      const currentRevision = createRecentVaultRevision(record);
      if (currentRevision !== request.expectedRevision) return { status: "stale", currentRevision };
      if (activeVaultId === request.vaultId || isActiveRecentRecord(settings.activeVaultPath, record)) {
        return { status: "active", currentRevision };
      }
      const selectedPath = path.resolve(selectedVaultPath);
      if (
        summary.vaultId !== request.vaultId ||
        settings.recentVaults.some((recent) =>
          recent.vaultId !== request.vaultId && path.resolve(recent.path) === selectedPath
        )
      ) return { status: "failed" };
      const replacement = {
        vaultId: record.vaultId,
        name: summary.name,
        path: selectedPath,
        schemaVersion: summary.schemaVersion,
        lastOpenedAt: record.lastOpenedAt
      };
      this.#writeUnlocked(withRecentVaults(
        settings,
        settings.recentVaults.map((recent) => recent.vaultId === request.vaultId ? replacement : recent)
      ));
      return { status: "reconnected", revision: createRecentVaultRevision(replacement) };
    });
  }

  resolveRecentVaultBinding(vaultId: string): RecentVaultBinding {
    const matches = this.read().recentVaults.filter((recent) => recent.vaultId === vaultId);
    if (matches.length === 0) {
      throw new PigeDomainError("vault.recent_not_found", "The recent vault is no longer available.");
    }
    if (matches.length !== 1) {
      throw new PigeDomainError("vault.recent_ambiguous", "The recent vault identity is ambiguous.");
    }
    return { vaultId, vaultPath: path.resolve(matches[0]!.path) };
  }

  activateRecentVault(
    binding: RecentVaultBinding,
    activeVaultPath: string,
    summary: VaultSummary
  ): MachineLocalSettings {
    return this.#mutate((settings) => {
      const matches = settings.recentVaults.filter((recent) => recent.vaultId === binding.vaultId);
      if (matches.length === 0) {
        throw new PigeDomainError("vault.recent_not_found", "The recent vault is no longer available.");
      }
      if (matches.length !== 1) {
        throw new PigeDomainError("vault.recent_ambiguous", "The recent vault identity is ambiguous.");
      }
      if (
        path.resolve(matches[0]!.path) !== binding.vaultPath ||
        summary.vaultId !== binding.vaultId
      ) {
        throw new PigeDomainError("vault.recent_stale", "The recent vault identity changed.");
      }
      return activateVault(settings, activeVaultPath, summary);
    });
  }

  toRecentVaultSummaries(settings = this.read()): RecentVaultSummary[] {
    return settings.recentVaults.map((recent) => ({
      vaultId: recent.vaultId,
      name: recent.name,
      pathDisplay: recent.path,
      schemaVersion: recent.schemaVersion,
      lastOpenedAt: recent.lastOpenedAt,
      revision: createRecentVaultRevision(recent)
    }));
  }

  #mutate(mutation: (settings: MachineLocalSettings) => MachineLocalSettings): MachineLocalSettings {
    return this.#withWriterLease(() => {
      const next = MachineLocalSettingsSchema.parse(mutation(this.read()));
      this.#writeUnlocked(next);
      return next;
    });
  }

  #withWriterLease<Result>(operation: () => Result): Result {
    const lease = acquireVaultWriterLease(this.#userDataPath);
    try {
      lease.assertHeld();
      const result = operation();
      lease.release();
      return result;
    } catch (caught) {
      try {
        lease.release();
      } catch {
        // Preserve the operation failure; a lost lease cannot authorize cleanup.
      }
      throw caught;
    }
  }

  #writeUnlocked(settings: MachineLocalSettings): void {
    const parsed = MachineLocalSettingsSchema.parse(settings);
    const body = `${JSON.stringify(parsed, null, 2)}\n`;
    const parentPath = path.dirname(this.#settingsPath);
    const temporaryPath = path.join(
      parentPath,
      `.${path.basename(this.#settingsPath)}.${process.pid}.${randomUUID()}.tmp`
    );
    let descriptor: number | undefined;
    let temporaryIdentity: fs.Stats | undefined;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      temporaryIdentity = fs.fstatSync(descriptor);
      fs.writeFileSync(descriptor, body, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.#settingsPath);
      temporaryIdentity = undefined;
      flushDirectory(parentPath);
      const reread = this.read();
      if (JSON.stringify(reread) !== JSON.stringify(parsed)) {
        throw new PigeDomainError("settings.write_failed", "Machine-local settings failed exact readback.");
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (temporaryIdentity) removeOwnedFile(temporaryPath, temporaryIdentity);
    }
  }
}

function activateVault(
  settings: MachineLocalSettings,
  vaultPath: string,
  summary: VaultSummary
): MachineLocalSettings {
  const resolvedVaultPath = path.resolve(vaultPath);
  const openedAt = new Date().toISOString();
  const nextRecent = [
    {
      vaultId: summary.vaultId,
      name: summary.name,
      path: resolvedVaultPath,
      schemaVersion: summary.schemaVersion,
      lastOpenedAt: openedAt
    },
    ...settings.recentVaults.filter((recent) =>
      recent.vaultId !== summary.vaultId && path.resolve(recent.path) !== resolvedVaultPath
    )
  ].slice(0, 8);
  return createMachineLocalSettings({
    activeVaultPath: resolvedVaultPath,
    appLocale: settings.appLocale,
    appearance: settings.appearance,
    startupDestination: settings.startupDestination,
    window: settings.window,
    updates: settings.updates,
    ocrEnginePreference: settings.ocrEnginePreference,
    ocrLanguagePreference: settings.ocrLanguagePreference,
    dictationLanguagePreference: settings.dictationLanguagePreference,
    dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
    recentVaults: nextRecent
  });
}

function exactRecentVaultRecord(
  recentVaults: RecentVaultSettings,
  vaultId: string
): RecentVaultSettings[number] | undefined {
  const matches = recentVaults.filter((recent) => recent.vaultId === vaultId);
  if (matches.length > 1) {
    throw new PigeDomainError("vault.recent_ambiguous", "The recent vault identity is ambiguous.");
  }
  return matches[0];
}

function createRecentVaultRevision(record: RecentVaultSettings[number]): `recentvaultrev_${string}` {
  return `recentvaultrev_${createHash("sha256").update(JSON.stringify({
    vaultId: record.vaultId,
    name: record.name,
    path: path.resolve(record.path),
    schemaVersion: record.schemaVersion,
    lastOpenedAt: record.lastOpenedAt
  })).digest("hex")}`;
}

function isActiveRecentRecord(
  activeVaultPath: string | undefined,
  record: RecentVaultSettings[number]
): boolean {
  return Boolean(activeVaultPath && path.resolve(activeVaultPath) === path.resolve(record.path));
}

function withRecentVaults(
  settings: MachineLocalSettings,
  recentVaults: RecentVaultSettings
): MachineLocalSettings {
  return createMachineLocalSettings({
    activeVaultPath: settings.activeVaultPath,
    appLocale: settings.appLocale,
    appearance: settings.appearance,
    startupDestination: settings.startupDestination,
    window: settings.window,
    updates: settings.updates,
    ocrEnginePreference: settings.ocrEnginePreference,
    ocrLanguagePreference: settings.ocrLanguagePreference,
    dictationLanguagePreference: settings.dictationLanguagePreference,
    dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
    recentVaults
  });
}

function assertExpectedActiveVault(
  settings: MachineLocalSettings,
  expectedActiveVaultPath?: string,
  expectedActiveVaultId?: string
): void {
  const expectedPath = expectedActiveVaultPath && path.resolve(expectedActiveVaultPath);
  const currentPath = settings.activeVaultPath && path.resolve(settings.activeVaultPath);
  if (expectedPath !== currentPath) {
    throw new PigeDomainError("vault.binding_changed", "The active vault path changed during restore.");
  }

  if (expectedActiveVaultId) {
    const activeRecord = settings.recentVaults.find((recent) =>
      path.resolve(recent.path) === currentPath
    );
    if (activeRecord?.vaultId !== expectedActiveVaultId) {
      throw new PigeDomainError("vault.binding_changed", "The active vault identity changed during restore.");
    }
  }
}

function flushDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFsync(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function prepareMachineRuntimeRoot(userDataPath: string): void {
  const pigePath = path.join(userDataPath, ".pige");
  try {
    fs.mkdirSync(pigePath, { mode: 0o700 });
    flushDirectory(userDataPath);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) {
      throw new PigeDomainError("settings.write_failed", "Machine-local coordination could not be prepared.");
    }
  }

  const stat = fs.lstatSync(pigePath);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync.native(pigePath) !== path.resolve(pigePath)
  ) {
    throw new PigeDomainError("settings.write_failed", "Machine-local coordination is unsafe.");
  }
  fs.chmodSync(pigePath, 0o700);
}

function readBoundedFileNoFollow(filePath: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 256 * 1024) {
      throw new PigeDomainError("settings.read_failed", "Machine-local settings are unsafe or oversized.");
    }
    return fs.readFileSync(descriptor, "utf8");
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("settings.read_failed", "Machine-local settings could not be read safely.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function removeOwnedFile(filePath: string, identity: fs.Stats): void {
  try {
    const current = fs.lstatSync(filePath);
    if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) {
      fs.rmSync(filePath);
    }
  } catch (caught) {
    if (!isErrno(caught, "ENOENT")) throw caught;
  }
}

export function isUnsupportedDirectoryFsync(
  caught: unknown,
  platform = process.platform
): boolean {
  const portableUnsupported = ["EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"];
  return portableUnsupported.some((code) => isErrno(caught, code)) ||
    (platform === "win32" && ["EBADF", "EPERM"].some((code) => isErrno(caught, code)));
}

function createMachineLocalSettings(input: {
  readonly activeVaultPath?: string | undefined;
  readonly appLocale?: Locale | undefined;
  readonly appearance?: AppearanceMachineSettings | undefined;
  readonly startupDestination?: StartupDestinationMachineSettings | undefined;
  readonly window?: WindowPreferences | undefined;
  readonly updates?: UpdateMachineSettings | undefined;
  readonly ocrEnginePreference?: OcrEnginePreferenceMachineSettings | undefined;
  readonly ocrLanguagePreference?: OcrLanguagePreferenceMachineSettings | undefined;
  readonly dictationLanguagePreference?: DictationLanguagePreferenceMachineSettings | undefined;
  readonly dismissedFirstHomeVaultIds?: readonly string[] | undefined;
  readonly recentVaults: RecentVaultSettings;
}): MachineLocalSettings {
  const settings: MachineLocalSettings = {
    schemaVersion: 1,
    recentVaults: input.recentVaults
  };

  if (input.activeVaultPath) {
    settings.activeVaultPath = input.activeVaultPath;
  }

  if (input.appLocale) {
    settings.appLocale = input.appLocale;
  }

  if (input.appearance) {
    settings.appearance = input.appearance;
  }

  if (input.startupDestination) {
    settings.startupDestination = input.startupDestination;
  }

  if (input.window) {
    settings.window = input.window;
  }

  if (input.updates) {
    settings.updates = input.updates;
  }

  if (input.ocrEnginePreference) {
    settings.ocrEnginePreference = input.ocrEnginePreference;
  }

  if (input.ocrLanguagePreference) {
    settings.ocrLanguagePreference = input.ocrLanguagePreference;
  }

  if (input.dictationLanguagePreference) {
    settings.dictationLanguagePreference = input.dictationLanguagePreference;
  }

  if (input.dismissedFirstHomeVaultIds?.length) {
    settings.dismissedFirstHomeVaultIds = [...input.dismissedFirstHomeVaultIds];
  }

  return settings;
}

function createDefaultUpdateSettings(): UpdateMachineSettings {
  return UpdateMachineSettingsSchema.parse({
    revision: 0,
    channel: "alpha"
  });
}

function createDefaultAppearanceSettings(): AppearanceMachineSettings {
  return AppearanceMachineSettingsSchema.parse({
    revision: 0,
    themePreference: "system"
  });
}

function createDefaultOcrLanguagePreferenceSettings(): OcrLanguagePreferenceMachineSettings {
  return OcrLanguagePreferenceMachineSettingsSchema.parse({
    revision: 0,
    preference: { mode: "automatic" }
  });
}

function createDefaultOcrEnginePreferenceSettings(): OcrEnginePreferenceMachineSettings {
  return OcrEnginePreferenceMachineSettingsSchema.parse({
    revision: 0,
    preference: "automatic"
  });
}

function createDefaultDictationLanguagePreferenceSettings(): DictationLanguagePreferenceMachineSettings {
  return DictationLanguagePreferenceMachineSettingsSchema.parse({
    revision: 0,
    preference: { mode: "automatic" }
  });
}

export function digestSettingsProfilePreferences(preferences: SettingsProfilePreferences): string {
  return createHash("sha256").update(JSON.stringify(preferences), "utf8").digest("hex");
}

function projectSettingsProfilePreferences(
  settings: MachineLocalSettings,
  fallbackLocale: Locale
): SettingsProfilePreferences {
  const appearance = settings.appearance ?? createDefaultAppearanceSettings();
  return SettingsProfilePreferencesSchema.parse({
    appLocale: settings.appLocale ?? fallbackLocale,
    appearance: {
      themePreference: appearance.themePreference,
      generatedKnowledgeLanguage: appearance.generatedKnowledgeLanguage ?? "preserve_source"
    },
    startupDestination: settings.startupDestination?.destination ?? "home",
    updateChannel: (settings.updates ?? createDefaultUpdateSettings()).channel,
    ocrEnginePreference: (
      settings.ocrEnginePreference ?? createDefaultOcrEnginePreferenceSettings()
    ).preference,
    ocrLanguagePreference: (
      settings.ocrLanguagePreference ?? createDefaultOcrLanguagePreferenceSettings()
    ).preference,
    dictationLanguagePreference: (
      settings.dictationLanguagePreference ?? createDefaultDictationLanguagePreferenceSettings()
    ).preference
  });
}
