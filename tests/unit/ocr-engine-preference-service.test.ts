import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalSettingsOcrEnginePreferenceStore,
  OcrEnginePreferenceService
} from "../../apps/desktop/src/main/services/ocr-engine-preference-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OcrEnginePreferenceService", () => {
  it("defaults, commits with CAS, survives restart and preserves unrelated settings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-engine-"));
    roots.push(root);
    const local = new LocalSettingsStore(root);
    const store = new LocalSettingsOcrEnginePreferenceStore(local);

    expect(store.read()).toEqual({ revision: 0, preference: "automatic" });
    expect(store.mutate(0, "paddleocr_local")).toEqual({
      status: "committed",
      state: { revision: 1, preference: "paddleocr_local" }
    });
    expect(store.mutate(0, "platform_native")).toEqual({
      status: "stale",
      state: { revision: 1, preference: "paddleocr_local" }
    });
    local.setAppLocale("fr");
    expect(new LocalSettingsOcrEnginePreferenceStore(new LocalSettingsStore(root)).read())
      .toEqual({ revision: 1, preference: "paddleocr_local" });
  });

  it("projects strict path-free read and authoritative mutation results", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-engine-api-"));
    roots.push(root);
    const service = new OcrEnginePreferenceService(
      new LocalSettingsOcrEnginePreferenceStore(new LocalSettingsStore(root))
    );
    const requestId = "ocrenginereq_abcdefghijklmnop";

    expect(service.read({ apiVersion: 1, requestId })).toEqual({
      apiVersion: 1,
      requestId,
      status: "ready",
      summary: {
        apiVersion: 1,
        revision: 0,
        preference: "automatic",
        appliesTo: "new_ocr_jobs"
      }
    });
    expect(service.set({
      apiVersion: 1,
      requestId,
      expectedRevision: 0,
      preference: "platform_native"
    })).toMatchObject({
      status: "committed",
      summary: { revision: 1, preference: "platform_native" }
    });
  });
});
