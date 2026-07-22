import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { acquireVaultWriterLease } from "../../apps/desktop/src/main/services/vault-writer-lease";
import type { VaultSummary } from "@pige/contracts";

const tempRoots: string[] = [];

function makeStore(): LocalSettingsStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
  tempRoots.push(root);
  return new LocalSettingsStore(root);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local settings store", () => {
  it("preserves machine-local window preferences when activating a vault", () => {
    const store = makeStore();
    const vault: VaultSummary = {
      vaultId: "vault_20260709_ab12cd",
      name: "Pige Vault",
      activeVaultPathDisplay: "/tmp/Pige Vault",
      knowledgeRootDisplay: "/tmp/Pige Vault",
      sourceAssetRootDisplay: "/tmp/Pige Vault/raw",
      sourceAssetRootKind: "inside_vault",
      defaultSourceStorageStrategy: "copy_to_source_library",
      schemaVersion: 1
    };

    store.setAppLocale("fr");
    store.setWindowPreferences({
      mode: "expanded",
      alwaysOnTop: true,
      sidebarOpen: true,
      noteAgentOpen: true,
      expandedSize: { width: 960, height: 760 }
    });
    store.setActiveVault("/tmp/Pige Vault", vault);

    expect(store.read().activeVaultPath).toBe("/tmp/Pige Vault");
    expect(store.read().appLocale).toBe("fr");
    expect(store.read().window).toMatchObject({
      mode: "expanded",
      alwaysOnTop: true,
      sidebarOpen: true,
      noteAgentOpen: true
    });
  });

  it("persists an explicit first-Home choice across settings rewrites and restart", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const vaultId = "vault_20260709_ab12cd";
    const store = new LocalSettingsStore(root);

    expect(store.hasDismissedFirstHome(vaultId)).toBe(false);
    store.dismissFirstHome(vaultId);
    store.setAppLocale("en");
    store.setWindowPreferences({
      mode: "compact",
      alwaysOnTop: false,
      sidebarOpen: false
    });

    const reopened = new LocalSettingsStore(root);
    expect(reopened.hasDismissedFirstHome(vaultId)).toBe(true);
    expect(reopened.read().dismissedFirstHomeVaultIds).toEqual([vaultId]);
  });

  it("CAS-writes appearance independently and preserves it through unrelated settings writes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const store = new LocalSettingsStore(root);

    expect(store.mutateAppearanceSettings(0, (current) => ({
      ...current,
      themePreference: "dark"
    }))).toEqual({
      status: "committed",
      settings: { revision: 1, themePreference: "dark" }
    });
    expect(store.mutateAppearanceSettings(0, (current) => current)).toEqual({
      status: "stale",
      settings: { revision: 1, themePreference: "dark" }
    });

    store.setAppLocale("fr");
    store.setWindowPreferences({ mode: "compact", alwaysOnTop: false, sidebarOpen: false });

    expect(new LocalSettingsStore(root).getAppearanceSettings()).toEqual({
      revision: 1,
      themePreference: "dark"
    });
  });

  it("atomically swaps one active vault binding without retaining a duplicate identity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const store = new LocalSettingsStore(root);
    const original = makeVaultSummary("vault_20260709_ab12cd", "Original");
    const restored = makeVaultSummary(original.vaultId, "Restored");
    const originalPath = path.join(root, "Original");
    const restoredPath = path.join(root, "Restored");
    store.setActiveVault(originalPath, original);

    store.swapActiveVaultBinding({
      expectedActiveVaultPath: originalPath,
      expectedActiveVaultId: original.vaultId,
      nextVaultPath: restoredPath,
      nextVault: restored
    });

    const settings = store.read();
    expect(settings.activeVaultPath).toBe(restoredPath);
    expect(settings.recentVaults).toEqual([
      expect.objectContaining({ vaultId: original.vaultId, path: restoredPath })
    ]);
  });

  it("rejects a stale binding swap without changing the committed settings bytes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const store = new LocalSettingsStore(root);
    const original = makeVaultSummary("vault_20260709_ab12cd", "Original");
    const originalPath = path.join(root, "Original");
    store.setActiveVault(originalPath, original);
    const settingsPath = path.join(root, "settings.json");
    const before = fs.readFileSync(settingsPath);

    expect(() => store.swapActiveVaultBinding({
      expectedActiveVaultPath: path.join(root, "Stale"),
      expectedActiveVaultId: original.vaultId,
      nextVaultPath: path.join(root, "Restored"),
      nextVault: original
    })).toThrowError(expect.objectContaining({ code: "vault.binding_changed" }));

    expect(fs.readFileSync(settingsPath)).toEqual(before);
  });

  it("fails closed when settings are replaced by a symbolic link", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-external-"));
    tempRoots.push(root, externalRoot);
    const externalPath = path.join(externalRoot, "settings.json");
    fs.writeFileSync(externalPath, '{"schemaVersion":1,"recentVaults":[]}\n', "utf8");
    fs.symlinkSync(externalPath, path.join(root, "settings.json"));
    const store = new LocalSettingsStore(root);

    expect(() => store.read()).toThrowError(expect.objectContaining({
      code: "settings.read_failed"
    }));
    expect(fs.readFileSync(externalPath, "utf8")).toContain('"recentVaults":[]');
  });

  it("serializes settings mutations behind the machine-local writer lease", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const store = new LocalSettingsStore(root);
    const lease = acquireVaultWriterLease(root);

    try {
      expect(() => store.setAppLocale("fr")).toThrowError(expect.objectContaining({
        code: "vault.writer_locked"
      }));
      expect(store.read().appLocale).toBeUndefined();
    } finally {
      lease.release();
    }

    expect(store.setAppLocale("fr").appLocale).toBe("fr");
  });

  it("CAS-updates and preserves machine-local update status across unrelated settings writes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-settings-test-"));
    tempRoots.push(root);
    const store = new LocalSettingsStore(root);

    expect(store.getUpdateSettings()).toEqual({ revision: 0, channel: "alpha" });
    expect(store.mutateUpdateSettings(0, (settings) => ({
      ...settings,
      lastCheck: { phase: "up_to_date", checkedAt: "2026-07-18T08:00:00.000Z" }
    }))).toMatchObject({ status: "committed", settings: { revision: 1, channel: "alpha" } });
    expect(store.mutateUpdateSettings(0, (settings) => settings)).toMatchObject({
      status: "stale",
      settings: { revision: 1 }
    });

    store.setAppLocale("ja");
    store.setActiveVault(path.join(root, "Vault"), makeVaultSummary("vault_20260709_ab12cd", "Vault"));
    store.clearActiveVault();
    expect(store.getUpdateSettings()).toEqual({
      revision: 1,
      channel: "alpha",
      lastCheck: { phase: "up_to_date", checkedAt: "2026-07-18T08:00:00.000Z" }
    });
  });
});

function makeVaultSummary(vaultId: string, name: string): VaultSummary {
  const displayRoot = `/tmp/${name}`;
  return {
    vaultId,
    name,
    activeVaultPathDisplay: displayRoot,
    knowledgeRootDisplay: displayRoot,
    sourceAssetRootDisplay: `${displayRoot}/raw`,
    sourceAssetRootKind: "inside_vault",
    defaultSourceStorageStrategy: "copy_to_source_library",
    schemaVersion: 1
  };
}
