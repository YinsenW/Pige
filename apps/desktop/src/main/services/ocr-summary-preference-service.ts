import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OcrSummaryPreferenceResultSchema,
  OcrSummaryPreferenceSummarySchema,
  SetOcrSummaryPreferenceResultSchema,
  type OcrSummaryPreferenceRequest,
  type OcrSummaryPreferenceResult,
  type SetOcrSummaryPreferenceRequest,
  type SetOcrSummaryPreferenceResult
} from "@pige/schemas";

interface PersistedPreference {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly excludeLowConfidenceOcr: boolean;
}

const DEFAULT_PREFERENCE: PersistedPreference = {
  schemaVersion: 1,
  revision: 0,
  excludeLowConfidenceOcr: true
};

export class OcrSummaryPreferenceService {
  readonly #filePath: string;

  constructor(userDataPath: string) {
    this.#filePath = path.join(userDataPath, "ocr-summary-preference.json");
  }

  excludeLowConfidenceOcr(): boolean {
    return this.#read().excludeLowConfidenceOcr;
  }

  read(request: OcrSummaryPreferenceRequest): OcrSummaryPreferenceResult {
    try {
      return OcrSummaryPreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: projectSummary(this.#read())
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  set(request: SetOcrSummaryPreferenceRequest): SetOcrSummaryPreferenceResult {
    try {
      const current = this.#read();
      if (request.expectedRevision !== current.revision) {
        return SetOcrSummaryPreferenceResultSchema.parse({
          apiVersion: 1,
          requestId: request.requestId,
          status: "stale",
          summary: projectSummary(current)
        });
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error("revision exhausted");
      const next: PersistedPreference = {
        schemaVersion: 1,
        revision: current.revision + 1,
        excludeLowConfidenceOcr: request.excludeLowConfidenceOcr
      };
      this.#write(next);
      return SetOcrSummaryPreferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "committed",
        summary: projectSummary(next)
      });
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }

  #read(): PersistedPreference {
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(this.#filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_PREFERENCE;
      throw error;
    }
    if (!isPersistedPreference(value)) throw new Error("invalid OCR summary preference");
    return value;
  }

  #write(value: PersistedPreference): void {
    fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp-${process.pid}-${randomUUID()}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try {
      fs.renameSync(temporaryPath, this.#filePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function projectSummary(value: PersistedPreference) {
  return OcrSummaryPreferenceSummarySchema.parse({
    apiVersion: 1,
    revision: value.revision,
    excludeLowConfidenceOcr: value.excludeLowConfidenceOcr,
    appliesTo: "new_agent_jobs"
  });
}

function isPersistedPreference(value: unknown): value is PersistedPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "excludeLowConfidenceOcr,revision,schemaVersion" &&
    record.schemaVersion === 1 &&
    Number.isSafeInteger(record.revision) && Number(record.revision) >= 0 &&
    typeof record.excludeLowConfidenceOcr === "boolean";
}
