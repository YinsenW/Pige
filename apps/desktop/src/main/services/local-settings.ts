import fs from "node:fs";
import path from "node:path";
import { MachineLocalSettingsSchema, type Locale, type MachineLocalSettings, type WindowPreferences } from "@pige/schemas";
import type { RecentVaultSummary, VaultSummary } from "@pige/contracts";

type RecentVaultSettings = MachineLocalSettings["recentVaults"];

export class LocalSettingsStore {
  readonly #settingsPath: string;

  constructor(userDataPath: string) {
    this.#settingsPath = path.join(userDataPath, "settings.json");
  }

  read(): MachineLocalSettings {
    if (!fs.existsSync(this.#settingsPath)) {
      return { schemaVersion: 1, recentVaults: [] };
    }

    return MachineLocalSettingsSchema.parse(JSON.parse(fs.readFileSync(this.#settingsPath, "utf8")));
  }

  write(settings: MachineLocalSettings): void {
    const parsed = MachineLocalSettingsSchema.parse(settings);
    fs.mkdirSync(path.dirname(this.#settingsPath), { recursive: true });
    const temporaryPath = `${this.#settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.#settingsPath);
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

  setAppLocale(appLocale: Locale): MachineLocalSettings {
    const settings = this.read();
    const nextSettings = createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale,
      window: settings.window,
      recentVaults: settings.recentVaults
    });
    this.write(nextSettings);
    return nextSettings;
  }

  setWindowPreferences(window: WindowPreferences): MachineLocalSettings {
    const settings = this.read();
    const nextSettings = createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale: settings.appLocale,
      window,
      recentVaults: settings.recentVaults
    });
    this.write(nextSettings);
    return nextSettings;
  }

  setActiveVault(vaultPath: string, summary: VaultSummary): MachineLocalSettings {
    const openedAt = new Date().toISOString();
    const settings = this.read();
    const nextRecent = [
      {
        vaultId: summary.vaultId,
        name: summary.name,
        path: vaultPath,
        schemaVersion: summary.schemaVersion,
        lastOpenedAt: openedAt
      },
      ...settings.recentVaults.filter((recent) => recent.vaultId !== summary.vaultId && recent.path !== vaultPath)
    ].slice(0, 8);

    const nextSettings = createMachineLocalSettings({
      activeVaultPath: vaultPath,
      appLocale: settings.appLocale,
      window: settings.window,
      recentVaults: nextRecent
    });
    this.write(nextSettings);
    return nextSettings;
  }

  clearActiveVault(): MachineLocalSettings {
    const settings = this.read();
    const nextSettings = createMachineLocalSettings({
      appLocale: settings.appLocale,
      window: settings.window,
      recentVaults: settings.recentVaults
    });
    this.write(nextSettings);
    return nextSettings;
  }

  removeRecentVault(vaultId: string): RecentVaultSummary[] {
    const settings = this.read();
    const nextSettings = createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale: settings.appLocale,
      window: settings.window,
      recentVaults: settings.recentVaults.filter((recent) => recent.vaultId !== vaultId)
    });
    this.write(nextSettings);
    return this.toRecentVaultSummaries(nextSettings);
  }

  toRecentVaultSummaries(settings = this.read()): RecentVaultSummary[] {
    return settings.recentVaults.map((recent) => ({
      vaultId: recent.vaultId,
      name: recent.name,
      pathDisplay: recent.path,
      schemaVersion: recent.schemaVersion,
      lastOpenedAt: recent.lastOpenedAt
    }));
  }
}

function createMachineLocalSettings(input: {
  readonly activeVaultPath?: string | undefined;
  readonly appLocale?: Locale | undefined;
  readonly window?: WindowPreferences | undefined;
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

  if (input.window) {
    settings.window = input.window;
  }

  return settings;
}
