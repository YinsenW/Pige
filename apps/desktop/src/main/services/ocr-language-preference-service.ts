import { createHash } from "node:crypto";
import type {
  OcrLanguagePreferenceRequest,
  OcrLanguagePreferenceResult,
  SetOcrLanguagePreferenceRequest,
  SetOcrLanguagePreferenceResult
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  OcrLanguagePreferenceResultSchema,
  OcrLanguagePreferenceSummarySchema,
  SetOcrLanguagePreferenceResultSchema,
  type JobRecord,
  type JobRef,
  type OcrLanguagePreference as PublicOcrLanguagePreference,
  type SourceRecord
} from "@pige/schemas";
import type { LocalSettingsStore } from "./local-settings";

export const OCR_LANGUAGE_PREFERENCES = ["automatic", "en", "de", "fr", "ja", "ko", "zh-Hans"] as const;
export type OcrLanguagePreference = typeof OCR_LANGUAGE_PREFERENCES[number];

export interface OcrLanguagePreferenceState {
  readonly revision: number;
  readonly preference: OcrLanguagePreference;
}

export interface OcrLanguagePreferenceStorePort {
  read(): OcrLanguagePreferenceState;
  mutate(
    expectedRevision: number,
    preference: OcrLanguagePreference
  ): { readonly status: "committed" | "stale"; readonly state: OcrLanguagePreferenceState };
}

export interface OcrLanguageJobBinding {
  readonly preference: OcrLanguagePreference;
  readonly languageHints: readonly string[];
  readonly paddleModelFamily: "default" | "korean" | "latin";
  readonly bindingHash: `sha256:${string}`;
}

const OCR_LANGUAGE_REF_ROLE = "ocr_language_preference";

export class OcrLanguagePreferenceService {
  readonly #store: OcrLanguagePreferenceStorePort;

  constructor(store: OcrLanguagePreferenceStorePort = new AutomaticOcrLanguagePreferenceStore()) {
    this.#store = store;
  }

  current(): OcrLanguagePreferenceState {
    return validateState(this.#store.read());
  }

  read(request: OcrLanguagePreferenceRequest): OcrLanguagePreferenceResult {
    try {
      return OcrLanguagePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: projectSummary(this.current())
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  set(request: SetOcrLanguagePreferenceRequest): SetOcrLanguagePreferenceResult {
    try {
      const result = this.mutate(request.expectedRevision, fromPublicPreference(request.preference));
      return SetOcrLanguagePreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: result.status,
        summary: projectSummary(result.state)
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  mutate(expectedRevision: number, preference: OcrLanguagePreference): {
    readonly status: "committed" | "stale";
    readonly state: OcrLanguagePreferenceState;
  } {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !isPreference(preference)) {
      throw new PigeDomainError("ocr.language_preference_invalid", "The OCR language preference request is invalid.");
    }
    const result = this.#store.mutate(expectedRevision, preference);
    return { status: result.status, state: validateState(result.state) };
  }

  policyLanguageHints(): readonly string[] {
    return resolvePreference(this.current().preference, undefined).languageHints;
  }

  createJobRef(sourceRecord: SourceRecord): JobRef {
    const binding = resolvePreference(this.current().preference, sourceRecord);
    return {
      kind: "tool",
      id: `ocr_language:${binding.preference}`,
      role: OCR_LANGUAGE_REF_ROLE,
      checksum: binding.bindingHash,
      locator: encodeBinding(binding)
    };
  }

  readJobBinding(jobValue: JobRecord): OcrLanguageJobBinding {
    const job = JobRecordSchema.parse(jobValue);
    const refs = (job.inputRefs ?? []).filter((ref) => ref.role === OCR_LANGUAGE_REF_ROLE);
    if (refs.length === 0) {
      return resolvePreference("automatic", undefined);
    }
    if (refs.length !== 1) throw bindingInvalid();
    return parseBinding(refs[0]!);
  }

  mergeJobRef(inputRefs: readonly JobRef[] | undefined, sourceRecord: SourceRecord): readonly JobRef[] {
    const refs = inputRefs ?? [];
    const existing = refs.filter((ref) => ref.role === OCR_LANGUAGE_REF_ROLE);
    if (existing.length > 1) throw bindingInvalid();
    if (existing.length === 1) {
      parseBinding(existing[0]!);
      return refs;
    }
    return [...refs, this.createJobRef(sourceRecord)];
  }
}

export function resolveOcrJobLanguageHints(job: JobRecord): readonly string[] {
  return new OcrLanguagePreferenceService().readJobBinding(job).languageHints;
}

function resolvePreference(
  preference: OcrLanguagePreference,
  sourceRecord: SourceRecord | undefined
): OcrLanguageJobBinding {
  const selected = preference === "automatic"
    ? normalizeSupportedLanguage(sourceRecord?.metadata.locale)
    : preference;
  return createBinding(preference, selected);
}

function createBinding(
  preference: OcrLanguagePreference,
  selected: Exclude<OcrLanguagePreference, "automatic"> | undefined
): OcrLanguageJobBinding {
  const languageHints = selected ? [appleRecognitionLanguage(selected)] : [];
  const paddleModelFamily = selected === "ko"
    ? "korean" as const
    : selected === "de" || selected === "fr"
      ? "latin" as const
      : "default" as const;
  const canonical = { preference, languageHints, paddleModelFamily };
  return {
    ...canonical,
    bindingHash: `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}`
  };
}

function appleRecognitionLanguage(preference: Exclude<OcrLanguagePreference, "automatic">): string {
  if (preference === "en") return "en-US";
  if (preference === "de") return "de-DE";
  if (preference === "fr") return "fr-FR";
  if (preference === "ja") return "ja-JP";
  if (preference === "ko") return "ko-KR";
  return "zh-Hans";
}

function normalizeSupportedLanguage(value: unknown): Exclude<OcrLanguagePreference, "automatic"> | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-Hans";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("de")) return "de";
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("en")) return "en";
  return undefined;
}

function encodeBinding(binding: OcrLanguageJobBinding): string {
  return `v1:${binding.preference}:${binding.paddleModelFamily}:${binding.languageHints.join(",") || "none"}`;
}

function parseBinding(ref: JobRef): OcrLanguageJobBinding {
  const match = /^v1:(automatic|en|de|fr|ja|ko|zh-Hans):(default|korean|latin):(none|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)$/u.exec(ref.locator ?? "");
  if (!match || ref.kind !== "tool" || ref.id !== `ocr_language:${match[1]}` || !ref.checksum) {
    throw bindingInvalid();
  }
  const preference = match[1] as OcrLanguagePreference;
  const languageHints = match[3] === "none" ? [] : [match[3]!];
  const canonical = {
    preference,
    languageHints,
    paddleModelFamily: match[2] as OcrLanguageJobBinding["paddleModelFamily"]
  };
  const bindingHash = `sha256:${createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex")}` as const;
  if (bindingHash !== ref.checksum) throw bindingInvalid();
  const expected = createBinding(
    preference,
    preference === "automatic" ? normalizeSupportedLanguage(languageHints[0]) : preference
  );
  if (
    expected.paddleModelFamily !== canonical.paddleModelFamily ||
    JSON.stringify(expected.languageHints) !== JSON.stringify(languageHints)
  ) throw bindingInvalid();
  return { ...canonical, bindingHash };
}

function validateState(value: OcrLanguagePreferenceState): OcrLanguagePreferenceState {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !isPreference(value.preference)) {
    throw new PigeDomainError("ocr.language_preference_invalid", "The OCR language preference settings are invalid.");
  }
  return value;
}

function isPreference(value: unknown): value is OcrLanguagePreference {
  return OCR_LANGUAGE_PREFERENCES.includes(value as OcrLanguagePreference);
}

function bindingInvalid(): PigeDomainError {
  return new PigeDomainError("ocr.language_binding_invalid", "The OCR Job language binding is invalid.");
}

class AutomaticOcrLanguagePreferenceStore implements OcrLanguagePreferenceStorePort {
  read(): OcrLanguagePreferenceState {
    return { revision: 0, preference: "automatic" };
  }

  mutate(): { readonly status: "stale"; readonly state: OcrLanguagePreferenceState } {
    return { status: "stale", state: this.read() };
  }
}

export class LocalSettingsOcrLanguagePreferenceStore implements OcrLanguagePreferenceStorePort {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  read(): OcrLanguagePreferenceState {
    const current = this.#settings.getOcrLanguagePreferenceSettings();
    return { revision: current.revision, preference: fromPublicPreference(current.preference) };
  }

  mutate(expectedRevision: number, preference: OcrLanguagePreference) {
    const result = this.#settings.mutateOcrLanguagePreferenceSettings(expectedRevision, (current) => ({
      ...current,
      preference: toPublicPreference(preference)
    }));
    return {
      status: result.status,
      state: {
        revision: result.settings.revision,
        preference: fromPublicPreference(result.settings.preference)
      }
    };
  }
}

function projectSummary(state: OcrLanguagePreferenceState) {
  return OcrLanguagePreferenceSummarySchema.parse({
    apiVersion: 1,
    revision: state.revision,
    preference: toPublicPreference(state.preference),
    appliesTo: "new_ocr_jobs"
  });
}

function fromPublicPreference(preference: PublicOcrLanguagePreference): OcrLanguagePreference {
  return preference.mode === "automatic" ? "automatic" : preference.language;
}

function toPublicPreference(preference: OcrLanguagePreference): PublicOcrLanguagePreference {
  return preference === "automatic"
    ? { mode: "automatic" }
    : { mode: "preferred", language: preference };
}
