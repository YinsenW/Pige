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
});
