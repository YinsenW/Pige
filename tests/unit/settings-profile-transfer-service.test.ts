import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsProfileDocumentSchema } from "@pige/schemas";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { SettingsProfileTransferService } from "../../apps/desktop/src/main/services/settings-profile-transfer-service";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SettingsProfileTransferService", () => {
  it("exports only the portable safe preference profile", () => {
    const fixture = createFixture();
    const destination = path.join(fixture.root, "profile.json");
    const result = fixture.service.export(request("settingsprofilereq_export0000000001"), destination);
    expect(result.status).toBe("exported");
    const raw = fs.readFileSync(destination, "utf8");
    const parsed = SettingsProfileDocumentSchema.parse(JSON.parse(raw));
    expect(parsed.preferences.appLocale).toBe("en");
    expect(parsed.preferences.appearance.themePreference).toBe("dark");
    expect(raw).not.toContain("/private/vault");
    expect(raw).not.toContain("vault_secret_identifier");
    expect(raw).not.toContain("recent vault");
    expect(raw).not.toContain("width");
    expect(fs.statSync(destination).mode & 0o777).toBe(0o600);
  });

  it("previews pathlessly and atomically imports while preserving excluded machine state", () => {
    const fixture = createFixture();
    const source = writeProfile(fixture.root, {
      appLocale: "fr",
      appearance: { themePreference: "light", generatedKnowledgeLanguage: "app_locale" },
      startupDestination: "library",
      updateChannel: "alpha",
      ocrEnginePreference: "paddleocr_local",
      ocrLanguagePreference: { mode: "preferred", language: "fr" },
      dictationLanguagePreference: { mode: "preferred", language: "fr" }
    });
    const preview = fixture.service.preview(
      { apiVersion: 1, requestId: "settingsprofilereq_aaaaaaaaaaaaaaaa" },
      source
    );
    expect(preview.status).toBe("ready");
    expect(JSON.stringify(preview)).not.toContain(source);
    if (preview.status !== "ready") throw new Error("expected ready preview");
    const applied = fixture.service.apply({
      apiVersion: 1,
      requestId: "settingsprofilereq_bbbbbbbbbbbbbbbb",
      previewId: preview.previewId
    });
    expect(applied.status).toBe("committed");
    expect(fixture.applied()).toBe(1);
    const current = fixture.store.read();
    expect(current.appLocale).toBe("fr");
    expect(current.appearance?.themePreference).toBe("light");
    expect(current.activeVaultPath).toBe("/private/vault");
    expect(current.recentVaults[0]?.vaultId).toBe("vault_20260802_secret1");
    expect(current.window?.compactSize?.width).toBe(1280);
    expect(current.dismissedFirstHomeVaultIds).toEqual(["vault_20260802_secret1"]);
  });

  it("fails stale when a safe preference changes after preview", () => {
    const fixture = createFixture();
    const source = writeProfile(fixture.root, fixture.store.getSettingsProfilePreferences("zh-Hans"));
    const preview = fixture.service.preview(
      { apiVersion: 1, requestId: "settingsprofilereq_cccccccccccccccc" },
      source
    );
    if (preview.status !== "ready") throw new Error("expected ready preview");
    fixture.store.setAppLocale("de");
    const result = fixture.service.apply({
      apiVersion: 1,
      requestId: "settingsprofilereq_dddddddddddddddd",
      previewId: preview.previewId
    });
    expect(result.status).toBe("stale");
    expect(fixture.store.getAppLocale()).toBe("de");
    expect(fixture.applied()).toBe(0);
  });

  it("rejects linked and oversized import files without publishing a preview", () => {
    const fixture = createFixture();
    const target = writeProfile(fixture.root, fixture.store.getSettingsProfilePreferences("zh-Hans"));
    const linked = path.join(fixture.root, "linked.json");
    fs.symlinkSync(target, linked);
    expect(fixture.service.preview(
      { apiVersion: 1, requestId: "settingsprofilereq_eeeeeeeeeeeeeeee" }, linked
    ).status).toBe("failed");
    const oversized = path.join(fixture.root, "oversized.json");
    fs.writeFileSync(oversized, "x".repeat(64 * 1024 + 1));
    expect(fixture.service.preview(
      { apiVersion: 1, requestId: "settingsprofilereq_ffffffffffffffff" }, oversized
    ).status).toBe("failed");
  });
});

function createFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-settings-profile-")));
  roots.push(root);
  const store = new LocalSettingsStore(path.join(root, "user-data"));
  store.write({
    schemaVersion: 1,
    activeVaultPath: "/private/vault",
    appLocale: "en",
    appearance: { revision: 4, themePreference: "dark", generatedKnowledgeLanguage: "follow_query" },
    startupDestination: { revision: 2, destination: "home" },
    window: {
      mode: "compact", alwaysOnTop: false, sidebarOpen: true,
      compactSize: { width: 1280, height: 800 }
    },
    updates: { revision: 3, channel: "alpha" },
    ocrEnginePreference: { revision: 2, preference: "automatic" },
    ocrLanguagePreference: { revision: 2, preference: { mode: "automatic" } },
    dictationLanguagePreference: { revision: 2, preference: { mode: "automatic" } },
    dismissedFirstHomeVaultIds: ["vault_20260802_secret1"],
    recentVaults: [{
      vaultId: "vault_20260802_secret1",
      name: "recent vault",
      path: "/private/vault",
      schemaVersion: 2,
      lastOpenedAt: "2026-08-02T00:00:00.000Z"
    }]
  });
  let applyCount = 0;
  return {
    root,
    store,
    applied: () => applyCount,
    service: new SettingsProfileTransferService({
      settings: store,
      fallbackLocale: "zh-Hans",
      onApplied: () => { applyCount += 1; }
    })
  };
}

function request(requestId: string) {
  return { apiVersion: 1 as const, requestId };
}

function writeProfile(root: string, preferences: unknown): string {
  const filePath = path.join(root, `profile-${Math.random()}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, kind: "pige_preferences", preferences }));
  return filePath;
}
