import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceService, normalizeSupportedLocale } from "../../apps/desktop/src/main/services/appearance-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";

const tempRoots: string[] = [];

function makeService(): { root: string; service: AppearanceService; store: LocalSettingsStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-appearance-test-"));
  tempRoots.push(root);
  const store = new LocalSettingsStore(root);
  return { root, service: new AppearanceService(store, "en-US"), store };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("appearance service", () => {
  it("defaults to the supported system locale and persists user override in machine-local settings", () => {
    const { service, store } = makeService();

    expect(service.summary().locale).toBe("en");
    expect(service.setLocale({ locale: "fr" }).locale).toBe("fr");
    expect(store.read().appLocale).toBe("fr");
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
