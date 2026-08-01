import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DictationLanguagePreferenceService } from
  "../../apps/desktop/src/main/services/dictation-language-preference-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("DictationLanguagePreferenceService", () => {
  it("defaults to app language and persists one preferred language across restart", () => {
    const root = makeRoot();
    const settings = new LocalSettingsStore(root);
    const service = new DictationLanguagePreferenceService(settings);

    expect(service.read(readRequest("a"))).toMatchObject({
      status: "ready",
      summary: {
        revision: 0,
        preference: { mode: "automatic" },
        appliesTo: "new_speech_sessions"
      }
    });

    expect(service.set({
      apiVersion: 1,
      requestId: requestId("b"),
      expectedRevision: 0,
      preference: { mode: "preferred", language: "ja" }
    })).toMatchObject({
      status: "committed",
      summary: { revision: 1, preference: { mode: "preferred", language: "ja" } }
    });

    settings.setAppLocale("fr");
    expect(new DictationLanguagePreferenceService(new LocalSettingsStore(root)).preference())
      .toEqual({ mode: "preferred", language: "ja" });
  });

  it("returns authoritative current preference for stale CAS without overwriting it", () => {
    const service = new DictationLanguagePreferenceService(new LocalSettingsStore(makeRoot()));
    service.set({
      apiVersion: 1,
      requestId: requestId("c"),
      expectedRevision: 0,
      preference: { mode: "preferred", language: "ko" }
    });

    expect(service.set({
      apiVersion: 1,
      requestId: requestId("d"),
      expectedRevision: 0,
      preference: { mode: "preferred", language: "de" }
    })).toMatchObject({
      status: "stale",
      summary: { revision: 1, preference: { mode: "preferred", language: "ko" } }
    });
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dictation-language-"));
  roots.push(root);
  return root;
}

function requestId(character: string): `dictlangreq_${string}` {
  return `dictlangreq_${character.repeat(16)}`;
}

function readRequest(character: string) {
  return { apiVersion: 1 as const, requestId: requestId(character) };
}
