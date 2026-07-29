import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JobRecord, SourceRecord } from "@pige/schemas";
import {
  OcrLanguagePreferenceService,
  LocalSettingsOcrLanguagePreferenceStore,
  type OcrLanguagePreferenceState,
  type OcrLanguagePreferenceStorePort
} from "../../apps/desktop/src/main/services/ocr-language-preference-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OcrLanguagePreferenceService", () => {
  it("maps the bounded preference set to stable Apple hints and Paddle model families", () => {
    const store = new MemoryStore();
    const service = new OcrLanguagePreferenceService(store);

    expect(service.readJobBinding(jobWith(service.createJobRef(source("en"))))).toMatchObject({
      preference: "automatic",
      languageHints: ["en-US"],
      paddleModelFamily: "default"
    });
    store.state = { revision: 1, preference: "ko" };
    expect(service.readJobBinding(jobWith(service.createJobRef(source("en"))))).toMatchObject({
      preference: "ko",
      languageHints: ["ko-KR"],
      paddleModelFamily: "korean"
    });
    store.state = { revision: 2, preference: "fr" };
    expect(service.readJobBinding(jobWith(service.createJobRef(source("ja"))))).toMatchObject({
      preference: "fr",
      languageHints: ["fr-FR"],
      paddleModelFamily: "latin"
    });
  });

  it("keeps one immutable Job binding across preference changes and rejects tampering", () => {
    const store = new MemoryStore();
    const service = new OcrLanguagePreferenceService(store);
    const bound = service.mergeJobRef([], source("ja"));
    store.state = { revision: 1, preference: "de" };

    expect(service.mergeJobRef(bound, source("de"))).toEqual(bound);
    expect(service.readJobBinding(jobWith(bound[0]!))).toMatchObject({
      preference: "automatic",
      languageHints: ["ja-JP"]
    });
    expect(() => service.readJobBinding(jobWith({ ...bound[0]!, locator: "v1:de:latin:de-DE" })))
      .toThrowError(expect.objectContaining({ code: "ocr.language_binding_invalid" }));
  });

  it("defaults, commits with CAS, survives restart, and survives unrelated settings rebuilds", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-language-"));
    roots.push(root);
    const store = new LocalSettingsOcrLanguagePreferenceStore(new LocalSettingsStore(root));
    expect(store.read()).toEqual({ revision: 0, preference: "automatic" });
    expect(store.mutate(0, "ja")).toEqual({
      status: "committed",
      state: { revision: 1, preference: "ja" }
    });
    expect(new LocalSettingsOcrLanguagePreferenceStore(new LocalSettingsStore(root)).read())
      .toEqual({ revision: 1, preference: "ja" });
    expect(store.mutate(0, "en")).toEqual({
      status: "stale",
      state: { revision: 1, preference: "ja" }
    });

    const local = new LocalSettingsStore(root);
    local.setAppLocale("fr");
    expect(new LocalSettingsOcrLanguagePreferenceStore(local).read())
      .toEqual({ revision: 1, preference: "ja" });
  });

  it("projects body-free public read and CAS results", () => {
    const service = new OcrLanguagePreferenceService(new MemoryStore());
    const requestId = "ocrlangreq_abcdefghijklmnop";

    expect(service.read({ apiVersion: 1, requestId })).toEqual({
      apiVersion: 1,
      requestId,
      status: "ready",
      summary: {
        apiVersion: 1,
        revision: 0,
        preference: { mode: "automatic" },
        appliesTo: "new_ocr_jobs"
      }
    });
    expect(service.set({
      apiVersion: 1,
      requestId,
      expectedRevision: 0,
      preference: { mode: "preferred", language: "de" }
    })).toMatchObject({
      status: "committed",
      summary: { revision: 1, preference: { mode: "preferred", language: "de" } }
    });
  });
});

class MemoryStore implements OcrLanguagePreferenceStorePort {
  state: OcrLanguagePreferenceState = { revision: 0, preference: "automatic" };

  read(): OcrLanguagePreferenceState {
    return this.state;
  }

  mutate(expectedRevision: number, preference: OcrLanguagePreferenceState["preference"]) {
    if (expectedRevision !== this.state.revision) return { status: "stale" as const, state: this.state };
    this.state = { revision: this.state.revision + 1, preference };
    return { status: "committed" as const, state: this.state };
  }
}

function source(locale: string): SourceRecord {
  return { metadata: { locale } } as SourceRecord;
}

function jobWith(ref: NonNullable<JobRecord["inputRefs"]>[number]): JobRecord {
  return {
    id: "job_20260729_ocrpref01",
    class: "ocr",
    state: "queued",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    message: "OCR queued.",
    inputRefs: [ref]
  } as JobRecord;
}
