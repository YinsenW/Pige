import type { AppearanceSettingsSummary, SetLocaleRequest } from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export const PIGE_AVAILABLE_LOCALES: readonly Locale[] = ["zh-Hans", "en", "ja", "ko", "fr", "de"];

export class AppearanceService {
  readonly #settings: LocalSettingsStore;
  readonly #defaultLocale: Locale;

  constructor(settings: LocalSettingsStore, systemLocale = "zh-Hans") {
    this.#settings = settings;
    this.#defaultLocale = normalizeSupportedLocale(systemLocale);
  }

  summary(): AppearanceSettingsSummary {
    return {
      locale: this.#settings.getAppLocale(this.#defaultLocale),
      availableLocales: PIGE_AVAILABLE_LOCALES
    };
  }

  setLocale(request: SetLocaleRequest): AppearanceSettingsSummary {
    if (!PIGE_AVAILABLE_LOCALES.includes(request.locale)) {
      throw new Error("Unsupported locale.");
    }
    this.#settings.setAppLocale(request.locale);
    return this.summary();
  }
}

export function normalizeSupportedLocale(input: string): Locale {
  const normalized = input.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-Hans";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("de")) return "de";
  return "en";
}
