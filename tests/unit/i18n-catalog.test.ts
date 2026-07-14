import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const locales = ["zh-Hans", "en", "ja", "ko", "fr", "de"] as const;
const localeRoot = path.resolve(process.cwd(), "apps/desktop/src/renderer/src/locales");

describe("renderer i18n catalogs", () => {
  it("keeps every v0.1 locale populated with the same keys", () => {
    const catalogs = new Map<string, Record<string, string>>();
    for (const locale of locales) {
      const filePath = path.join(localeRoot, locale, "messages.json");
      catalogs.set(locale, JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>);
    }

    const englishKeys = Object.keys(catalogs.get("en") ?? {}).sort();
    expect(englishKeys.length).toBeGreaterThan(80);

    for (const locale of locales) {
      const catalog = catalogs.get(locale) ?? {};
      expect(Object.keys(catalog).sort()).toEqual(englishKeys);
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
    }
  });

  it("keeps preset recovery scoped to the fields visible in the preset flow", () => {
    for (const locale of locales) {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(localeRoot, locale, "messages.json"), "utf8")
      ) as Record<string, string>;
      expect(catalog["models.presetConnectionFailedApiKey"]).toBeTruthy();
      expect(catalog["models.presetConnectionFailedNoAuth"]).toBeTruthy();
      expect(catalog["models.manualModelFailed"]).toBeTruthy();
      expect(catalog["models.refreshAfterSaveFailed"]).toBeTruthy();
      expect(catalog["models.retry"]).toBeTruthy();
      expect(catalog["models.presetConnectionFailedApiKey"]).not.toContain("Base URL");
      expect(catalog["models.presetConnectionFailedNoAuth"]).not.toContain("Base URL");
    }
  });
});
