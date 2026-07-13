import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
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
      expandedSize: { width: 960, height: 760 }
    });
    store.setActiveVault("/tmp/Pige Vault", vault);

    expect(store.read().activeVaultPath).toBe("/tmp/Pige Vault");
    expect(store.read().appLocale).toBe("fr");
    expect(store.read().window).toMatchObject({
      mode: "expanded",
      alwaysOnTop: true,
      sidebarOpen: true
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
});
