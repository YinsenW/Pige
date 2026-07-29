import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type JobRef, type SourceRecord } from "@pige/schemas";

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

export class MachineOcrLanguagePreferenceStore implements OcrLanguagePreferenceStorePort {
  readonly #root: string;
  readonly #filePath: string;

  constructor(userDataPath: string) {
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    this.#root = fs.realpathSync.native(userDataPath);
    this.#filePath = path.join(this.#root, "ocr-language-preference.json");
  }

  read(): OcrLanguagePreferenceState {
    try {
      const entry = fs.lstatSync(this.#filePath);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0 || entry.size > 4 * 1024) {
        throw settingsInvalid();
      }
      const realPath = fs.realpathSync.native(this.#filePath);
      if (path.dirname(realPath) !== this.#root) throw settingsInvalid();
      const descriptor = fs.openSync(realPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const current = fs.fstatSync(descriptor);
        if (!current.isFile() || current.dev !== entry.dev || current.ino !== entry.ino || current.size !== entry.size) {
          throw settingsInvalid();
        }
        const body = Buffer.alloc(current.size);
        if (fs.readSync(descriptor, body, 0, body.length, 0) !== body.length) throw settingsInvalid();
        return validateState(JSON.parse(body.toString("utf8")) as OcrLanguagePreferenceState);
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (caught) {
      if (isErrno(caught, "ENOENT")) return { revision: 0, preference: "automatic" };
      if (caught instanceof PigeDomainError) throw caught;
      throw settingsInvalid();
    }
  }

  mutate(expectedRevision: number, preference: OcrLanguagePreference): {
    readonly status: "committed" | "stale";
    readonly state: OcrLanguagePreferenceState;
  } {
    const current = this.read();
    if (current.revision !== expectedRevision) return { status: "stale", state: current };
    if (current.revision === Number.MAX_SAFE_INTEGER) {
      throw new PigeDomainError("ocr.language_preference_revision_exhausted", "The OCR language preference revision is exhausted.");
    }
    const next = validateState({ revision: current.revision + 1, preference });
    const body = `${JSON.stringify(next)}\n`;
    const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      try {
        fs.writeFileSync(descriptor, body, "utf8");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      if (this.read().revision !== expectedRevision) return { status: "stale", state: this.read() };
      fs.renameSync(temporaryPath, this.#filePath);
      fsyncDirectory(this.#root);
      return { status: "committed", state: next };
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // A stale temporary file must not replace the mutation result.
      }
    }
  }
}

function isErrno(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function settingsInvalid(): PigeDomainError {
  return new PigeDomainError("ocr.language_preference_invalid", "The OCR language preference settings are invalid.");
}
