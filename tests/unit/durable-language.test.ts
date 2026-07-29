import { describe, expect, it } from "vitest";
import {
  conversationLanguageContinuity,
  inheritedChunkLanguage,
  observedOcrArtifactLanguage,
  sourceLanguageAfterOcr,
  unknownLanguageFact
} from "../../apps/desktop/src/main/services/durable-language";

describe("durable language facts", () => {
  it("keeps Chinese and English query/response continuity independent of app locale", () => {
    expect(conversationLanguageContinuity("请整理这份资料", "en")).toEqual({
      queryLanguage: { domain: "query", language: "zh-Hans", basis: "query_detected" },
      responseLanguage: { domain: "response", language: "zh-Hans", basis: "response_policy" }
    });
    expect(conversationLanguageContinuity("Summarize this source", "zh-Hans")).toEqual({
      queryLanguage: { domain: "query", language: "en", basis: "query_detected" },
      responseLanguage: { domain: "response", language: "en", basis: "response_policy" }
    });
  });

  it("uses the configured locale only when query evidence is unavailable", () => {
    expect(conversationLanguageContinuity("12345", "de")).toEqual({
      queryLanguage: { domain: "query", language: "unknown", basis: "unavailable" },
      responseLanguage: { domain: "response", language: "de", basis: "response_policy" }
    });
  });

  it("projects OCR and chunk language only from canonical observed or inherited facts", () => {
    const current = unknownLanguageFact("source_record", "legacy_missing");
    expect(observedOcrArtifactLanguage(["bad_tag", "en-US"]))
      .toEqual({ domain: "ocr_artifact", language: "en-US", basis: "ocr_observed" });
    expect(sourceLanguageAfterOcr(current, ["en-US"]))
      .toEqual({ domain: "source_record", language: "en-US", basis: "ocr_observed" });
    expect(sourceLanguageAfterOcr(current, ["bad_tag"])).toEqual(current);
    expect(inheritedChunkLanguage("fr"))
      .toEqual({ domain: "chunk", language: "fr", basis: "page_inherited" });
    expect(inheritedChunkLanguage("not_a_tag"))
      .toEqual({ domain: "chunk", language: "unknown", basis: "unavailable" });
  });
});
