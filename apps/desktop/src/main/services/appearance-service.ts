import {
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  type AppearanceMachineSettings,
  type AppearanceSettingsSummary,
  type AppearanceThemeMutationResult,
  type AppearanceThemePreference,
  type EffectiveAppearanceTheme,
  type Locale,
  type SetLocaleRequest,
  type SetThemeRequest
} from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export const PIGE_AVAILABLE_LOCALES: readonly Locale[] = ["zh-Hans", "en", "ja", "ko", "fr", "de"];

export interface NativeThemePort {
  themeSource: AppearanceThemePreference;
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): unknown;
  removeListener(event: "updated", listener: () => void): unknown;
}

export class AppearanceService {
  readonly #settings: LocalSettingsStore;
  readonly #defaultLocale: Locale;
  readonly #nativeTheme: NativeThemePort;
  readonly #listeners = new Set<(summary: AppearanceSettingsSummary) => void>();
  readonly #handleNativeThemeUpdated = (): void => this.#onNativeThemeUpdated();
  #current: AppearanceSettingsSummary;
  #applyingThemeSource = false;
  #disposed = false;

  constructor(settings: LocalSettingsStore, systemLocale: string, nativeTheme: NativeThemePort) {
    this.#settings = settings;
    this.#defaultLocale = normalizeSupportedLocale(systemLocale);
    this.#nativeTheme = nativeTheme;
    const appearance = this.#settings.getAppearanceSettings();
    this.#applyThemeSource(appearance.themePreference);
    this.#current = this.#project(appearance);
    this.#nativeTheme.on("updated", this.#handleNativeThemeUpdated);
  }

  summary(): AppearanceSettingsSummary {
    return this.#current;
  }

  setLocale(request: SetLocaleRequest): AppearanceSettingsSummary {
    if (!PIGE_AVAILABLE_LOCALES.includes(request.locale)) {
      throw new Error("Unsupported locale.");
    }
    this.#settings.setAppLocale(request.locale);
    this.#current = this.#project(this.#settings.getAppearanceSettings());
    return this.#current;
  }

  setTheme(request: SetThemeRequest): AppearanceThemeMutationResult {
    try {
      const result = this.#settings.mutateAppearanceSettings(request.expectedRevision, (current) => ({
        ...current,
        themePreference: request.themePreference
      }));
      this.#applyThemeSource(result.settings.themePreference);
      const next = this.#project(result.settings);
      const changed = !sameSummary(this.#current, next);
      this.#current = next;
      if (changed) this.#publish(next);
      return AppearanceThemeMutationResultSchema.parse({ status: result.status, settings: next });
    } catch {
      try {
        const current = this.#settings.getAppearanceSettings();
        try {
          this.#applyThemeSource(current.themePreference);
        } catch {
          // Preserve the last safe projection when Electron rejects theme application.
        }
        this.#current = this.#project(current);
      } catch {
        // Preserve the last safe projection when machine-local settings cannot be reread.
      }
      return AppearanceThemeMutationResultSchema.parse({ status: "failed", settings: this.#current });
    }
  }

  onChanged(listener: (summary: AppearanceSettingsSummary) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#nativeTheme.removeListener("updated", this.#handleNativeThemeUpdated);
    this.#listeners.clear();
  }

  #onNativeThemeUpdated(): void {
    if (this.#disposed || this.#applyingThemeSource) return;
    const appearance = this.#settings.getAppearanceSettings();
    if (appearance.themePreference !== "system") {
      const next = this.#project(appearance);
      if (!sameSummary(this.#current, next)) {
        this.#current = next;
        this.#publish(next);
      }
      return;
    }

    const effectiveTheme = this.#effectiveTheme();
    if (
      this.#current.revision === appearance.revision &&
      this.#current.themePreference === "system" &&
      this.#current.effectiveTheme === effectiveTheme
    ) return;

    try {
      const result = this.#settings.mutateAppearanceSettings(appearance.revision, (current) => current);
      const next = this.#project(result.settings);
      this.#current = next;
      this.#publish(next);
    } catch {
      // A failed machine-local write must not publish an uncommitted revision.
    }
  }

  #applyThemeSource(themePreference: AppearanceThemePreference): void {
    this.#applyingThemeSource = true;
    try {
      this.#nativeTheme.themeSource = themePreference;
    } finally {
      this.#applyingThemeSource = false;
    }
  }

  #effectiveTheme(): EffectiveAppearanceTheme {
    return this.#nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  #project(appearance: AppearanceMachineSettings): AppearanceSettingsSummary {
    return AppearanceSettingsSummarySchema.parse({
      apiVersion: 1,
      locale: this.#settings.getAppLocale(this.#defaultLocale),
      availableLocales: [...PIGE_AVAILABLE_LOCALES],
      themePreference: appearance.themePreference,
      effectiveTheme: this.#effectiveTheme(),
      revision: appearance.revision
    });
  }

  #publish(summary: AppearanceSettingsSummary): void {
    for (const listener of this.#listeners) listener(summary);
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

function sameSummary(left: AppearanceSettingsSummary, right: AppearanceSettingsSummary): boolean {
  return left.revision === right.revision &&
    left.locale === right.locale &&
    left.themePreference === right.themePreference &&
    left.effectiveTheme === right.effectiveTheme;
}
