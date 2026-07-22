import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppearanceService,
  normalizeSupportedLocale,
  type NativeThemePort
} from "../../apps/desktop/src/main/services/appearance-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { acquireVaultWriterLease } from "../../apps/desktop/src/main/services/vault-writer-lease";
import type { AppearanceThemePreference } from "@pige/contracts";

const tempRoots: string[] = [];

class FakeNativeTheme extends EventEmitter implements NativeThemePort {
  #themeSource: AppearanceThemePreference = "system";
  #systemDark = false;

  get themeSource(): AppearanceThemePreference { return this.#themeSource; }
  set themeSource(value: AppearanceThemePreference) { this.#themeSource = value; }

  get shouldUseDarkColors(): boolean {
    if (this.#themeSource === "dark") return true;
    if (this.#themeSource === "light") return false;
    return this.#systemDark;
  }

  setSystemDark(value: boolean): void {
    this.#systemDark = value;
    this.emit("updated");
  }
}

function makeService(): {
  root: string;
  service: AppearanceService;
  store: LocalSettingsStore;
  nativeTheme: FakeNativeTheme;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-appearance-test-"));
  tempRoots.push(root);
  const store = new LocalSettingsStore(root);
  const nativeTheme = new FakeNativeTheme();
  return { root, service: new AppearanceService(store, "en-US", nativeTheme), store, nativeTheme };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("appearance service", () => {
  it("defaults to system without falsely claiming an explicit Light preference", () => {
    const { service, nativeTheme } = makeService();

    expect(service.summary()).toMatchObject({
      apiVersion: 1,
      locale: "en",
      themePreference: "system",
      effectiveTheme: "light",
      revision: 0
    });
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("persists explicit themes, applies native themeSource, and rejects stale writes", () => {
    const { service, store, nativeTheme } = makeService();

    expect(service.setTheme({ themePreference: "dark", expectedRevision: 0 })).toMatchObject({
      status: "committed",
      settings: { themePreference: "dark", effectiveTheme: "dark", revision: 1 }
    });
    expect(nativeTheme.themeSource).toBe("dark");
    expect(store.getAppearanceSettings()).toEqual({ revision: 1, themePreference: "dark" });

    expect(service.setTheme({ themePreference: "light", expectedRevision: 0 })).toMatchObject({
      status: "stale",
      settings: { themePreference: "dark", effectiveTheme: "dark", revision: 1 }
    });
    expect(nativeTheme.themeSource).toBe("dark");
  });

  it("returns a body-free failed result when machine-local persistence is unavailable", () => {
    const { root, service } = makeService();
    const lease = acquireVaultWriterLease(root);
    try {
      expect(service.setTheme({ themePreference: "dark", expectedRevision: 0 })).toEqual({
        status: "failed",
        settings: expect.objectContaining({ themePreference: "system", revision: 0 })
      });
    } finally {
      lease.release();
    }
  });

  it("publishes one monotonic projection to every listener when the system theme changes", () => {
    const { service, nativeTheme, store } = makeService();
    const first = vi.fn();
    const second = vi.fn();
    service.onChanged(first);
    const unsubscribeSecond = service.onChanged(second);

    nativeTheme.setSystemDark(true);

    expect(first).toHaveBeenCalledWith(expect.objectContaining({
      themePreference: "system",
      effectiveTheme: "dark",
      revision: 1
    }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(store.getAppearanceSettings()).toEqual({ revision: 1, themePreference: "system" });

    unsubscribeSecond();
    nativeTheme.setSystemDark(false);
    expect(first).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveTheme: "light", revision: 2 }));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores OS color changes while an explicit theme is active", () => {
    const { service, nativeTheme } = makeService();
    const listener = vi.fn();
    service.onChanged(listener);
    service.setTheme({ themePreference: "light", expectedRevision: 0 });
    listener.mockClear();

    nativeTheme.setSystemDark(true);

    expect(service.summary()).toMatchObject({ themePreference: "light", effectiveTheme: "light", revision: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("restores persisted preference before presentation and removes the native listener on dispose", () => {
    const { root, service, store, nativeTheme } = makeService();
    service.setTheme({ themePreference: "dark", expectedRevision: 0 });
    service.dispose();
    expect(nativeTheme.listenerCount("updated")).toBe(0);

    const restartedTheme = new FakeNativeTheme();
    const restarted = new AppearanceService(new LocalSettingsStore(root), "en-US", restartedTheme);
    expect(restartedTheme.themeSource).toBe("dark");
    expect(restarted.summary()).toMatchObject({ themePreference: "dark", effectiveTheme: "dark", revision: 1 });
    expect(store.read().activeVaultPath).toBeUndefined();
    restarted.dispose();
  });

  it("persists locale overrides without changing theme authority", () => {
    const { service, store } = makeService();
    service.setTheme({ themePreference: "dark", expectedRevision: 0 });

    expect(service.setLocale({ locale: "fr" })).toMatchObject({
      locale: "fr",
      themePreference: "dark",
      revision: 1
    });
    expect(store.read()).toMatchObject({
      appLocale: "fr",
      appearance: { themePreference: "dark", revision: 1 }
    });
  });

  it("maps system locales to the six supported UI locales", () => {
    expect(normalizeSupportedLocale("zh-CN")).toBe("zh-Hans");
    expect(normalizeSupportedLocale("ja-JP")).toBe("ja");
    expect(normalizeSupportedLocale("ko-KR")).toBe("ko");
    expect(normalizeSupportedLocale("fr-FR")).toBe("fr");
    expect(normalizeSupportedLocale("de-DE")).toBe("de");
    expect(normalizeSupportedLocale("es-ES")).toBe("en");
  });
});
