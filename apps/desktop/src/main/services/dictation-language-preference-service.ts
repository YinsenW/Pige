import type {
  DictationLanguagePreferenceRequest,
  DictationLanguagePreferenceResult,
  SetDictationLanguagePreferenceRequest,
  SetDictationLanguagePreferenceResult
} from "@pige/contracts";
import {
  DictationLanguagePreferenceResultSchema,
  DictationLanguagePreferenceSummarySchema,
  SetDictationLanguagePreferenceResultSchema,
  type DictationLanguagePreference,
  type DictationLanguagePreferenceMachineSettings
} from "@pige/schemas";
import type { LocalSettingsStore } from "./local-settings";

export class DictationLanguagePreferenceService {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  read(request: DictationLanguagePreferenceRequest): DictationLanguagePreferenceResult {
    try {
      return DictationLanguagePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: projectSummary(this.#settings.getDictationLanguagePreferenceSettings())
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  set(request: SetDictationLanguagePreferenceRequest): SetDictationLanguagePreferenceResult {
    try {
      const mutation = this.#settings.mutateDictationLanguagePreferenceSettings(
        request.expectedRevision,
        (current) => ({ ...current, preference: request.preference })
      );
      return SetDictationLanguagePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: mutation.status,
        summary: projectSummary(mutation.settings)
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  preference(): DictationLanguagePreference {
    return this.#settings.getDictationLanguagePreferenceSettings().preference;
  }
}

function projectSummary(settings: DictationLanguagePreferenceMachineSettings) {
  return DictationLanguagePreferenceSummarySchema.parse({
    apiVersion: 1,
    revision: settings.revision,
    preference: settings.preference,
    appliesTo: "new_speech_sessions"
  });
}
