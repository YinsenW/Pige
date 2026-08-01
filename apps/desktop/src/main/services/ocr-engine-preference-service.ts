import { PigeDomainError } from "@pige/domain";
import {
  OcrEnginePreferenceResultSchema,
  OcrEnginePreferenceSummarySchema,
  SetOcrEnginePreferenceResultSchema,
  type OcrEnginePreference,
  type OcrEnginePreferenceRequest,
  type OcrEnginePreferenceResult,
  type SetOcrEnginePreferenceRequest,
  type SetOcrEnginePreferenceResult
} from "@pige/schemas";
import type { LocalSettingsStore } from "./local-settings";

export interface OcrEnginePreferenceState {
  readonly revision: number;
  readonly preference: OcrEnginePreference;
}

export interface OcrEnginePreferenceStorePort {
  read(): OcrEnginePreferenceState;
  mutate(
    expectedRevision: number,
    preference: OcrEnginePreference
  ): { readonly status: "committed" | "stale"; readonly state: OcrEnginePreferenceState };
}

export class OcrEnginePreferenceService {
  readonly #store: OcrEnginePreferenceStorePort;

  constructor(store: OcrEnginePreferenceStorePort = new AutomaticOcrEnginePreferenceStore()) {
    this.#store = store;
  }

  current(): OcrEnginePreferenceState {
    return validateState(this.#store.read());
  }

  preference(): OcrEnginePreference {
    return this.current().preference;
  }

  read(request: OcrEnginePreferenceRequest): OcrEnginePreferenceResult {
    try {
      return OcrEnginePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: projectSummary(this.current())
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  set(request: SetOcrEnginePreferenceRequest): SetOcrEnginePreferenceResult {
    try {
      const result = this.#store.mutate(request.expectedRevision, request.preference);
      return SetOcrEnginePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: result.status,
        summary: projectSummary(validateState(result.state))
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }
}

function projectSummary(state: OcrEnginePreferenceState) {
  return OcrEnginePreferenceSummarySchema.parse({
    apiVersion: 1,
    revision: state.revision,
    preference: state.preference,
    appliesTo: "new_ocr_jobs"
  });
}

function validateState(value: OcrEnginePreferenceState): OcrEnginePreferenceState {
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !["automatic", "platform_native", "paddleocr_local"].includes(value.preference)
  ) {
    throw new PigeDomainError("ocr.engine_preference_invalid", "The OCR engine preference settings are invalid.");
  }
  return value;
}

class AutomaticOcrEnginePreferenceStore implements OcrEnginePreferenceStorePort {
  read(): OcrEnginePreferenceState {
    return { revision: 0, preference: "automatic" };
  }

  mutate(): { readonly status: "stale"; readonly state: OcrEnginePreferenceState } {
    return { status: "stale", state: this.read() };
  }
}

export class LocalSettingsOcrEnginePreferenceStore implements OcrEnginePreferenceStorePort {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  read(): OcrEnginePreferenceState {
    const current = this.#settings.getOcrEnginePreferenceSettings();
    return { revision: current.revision, preference: current.preference };
  }

  mutate(expectedRevision: number, preference: OcrEnginePreference) {
    const result = this.#settings.mutateOcrEnginePreferenceSettings(
      expectedRevision,
      (current) => ({ ...current, preference })
    );
    return {
      status: result.status,
      state: { revision: result.settings.revision, preference: result.settings.preference }
    };
  }
}
