import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MachineLocalSettingsSchema,
  PermissionMachineSettingsSchema,
  UpdateMachineSettingsSchema,
  type Locale,
  type MachineLocalSettings,
  type PermissionMachineSettings,
  type UpdateMachineSettings,
  type WindowPreferences
} from "@pige/schemas";
import type { RecentVaultSummary, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { acquireVaultWriterLease } from "./vault-writer-lease";

type RecentVaultSettings = MachineLocalSettings["recentVaults"];

export interface RecentVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

export interface PermissionSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: PermissionMachineSettings;
}

export interface UpdateSettingsMutation {
  readonly status: "committed" | "stale";
  readonly settings: UpdateMachineSettings;
}

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

  getPermissionSettings(): PermissionMachineSettings {
    return this.read().permissions ?? createDefaultPermissionSettings();
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
        window: current.window,
        permissions: current.permissions,
        updates: nextUpdates,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: nextUpdates };
    });
  }

  mutatePermissionSettings(
    expectedRevision: number,
    mutation: (settings: PermissionMachineSettings) => PermissionMachineSettings
  ): PermissionSettingsMutation {
    return this.#withWriterLease(() => {
      const current = this.read();
      const permissionSettings = current.permissions ?? createDefaultPermissionSettings();
      if (permissionSettings.revision !== expectedRevision) {
        return { status: "stale", settings: permissionSettings };
      }
      if (permissionSettings.revision === Number.MAX_SAFE_INTEGER) {
        throw new PigeDomainError("permission.revision_exhausted", "Permission settings revision is exhausted.");
      }
      const candidate = PermissionMachineSettingsSchema.parse(mutation(permissionSettings));
      const nextPermissions = PermissionMachineSettingsSchema.parse({
        ...candidate,
        revision: permissionSettings.revision + 1
      });
      this.#writeUnlocked(createMachineLocalSettings({
        activeVaultPath: current.activeVaultPath,
        appLocale: current.appLocale,
        window: current.window,
        permissions: nextPermissions,
        updates: current.updates,
        dismissedFirstHomeVaultIds: current.dismissedFirstHomeVaultIds,
        recentVaults: current.recentVaults
      }));
      return { status: "committed", settings: nextPermissions };
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
        window: settings.window,
        permissions: settings.permissions,
        updates: settings.updates,
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
      window: settings.window,
      permissions: settings.permissions,
      updates: settings.updates,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults
    }));
  }

  setWindowPreferences(window: WindowPreferences): MachineLocalSettings {
    return this.#mutate((settings) => createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale: settings.appLocale,
      window,
      permissions: settings.permissions,
      updates: settings.updates,
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
      window: settings.window,
      permissions: settings.permissions,
      updates: settings.updates,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults
    }));
  }

  removeRecentVault(vaultId: string): RecentVaultSummary[] {
    const nextSettings = this.#mutate((settings) => createMachineLocalSettings({
      activeVaultPath: settings.activeVaultPath,
      appLocale: settings.appLocale,
      window: settings.window,
      permissions: settings.permissions,
      updates: settings.updates,
      dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
      recentVaults: settings.recentVaults.filter((recent) => recent.vaultId !== vaultId)
    }));
    return this.toRecentVaultSummaries(nextSettings);
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
      lastOpenedAt: recent.lastOpenedAt
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
    window: settings.window,
    permissions: settings.permissions,
    updates: settings.updates,
    dismissedFirstHomeVaultIds: settings.dismissedFirstHomeVaultIds,
    recentVaults: nextRecent
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

function isErrno(caught: unknown, code: string): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && caught.code === code);
}

function createMachineLocalSettings(input: {
  readonly activeVaultPath?: string | undefined;
  readonly appLocale?: Locale | undefined;
  readonly window?: WindowPreferences | undefined;
  readonly permissions?: PermissionMachineSettings | undefined;
  readonly updates?: UpdateMachineSettings | undefined;
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

  if (input.window) {
    settings.window = input.window;
  }

  if (input.permissions) {
    settings.permissions = input.permissions;
  }

  if (input.updates) {
    settings.updates = input.updates;
  }

  if (input.dismissedFirstHomeVaultIds?.length) {
    settings.dismissedFirstHomeVaultIds = [...input.dismissedFirstHomeVaultIds];
  }

  return settings;
}

function createDefaultPermissionSettings(): PermissionMachineSettings {
  return PermissionMachineSettingsSchema.parse({
    revision: 0,
    defaultMode: "ask_every_time",
    yoloEnabled: false,
    savedGrants: []
  });
}

function createDefaultUpdateSettings(): UpdateMachineSettings {
  return UpdateMachineSettingsSchema.parse({
    revision: 0,
    channel: "alpha"
  });
}
