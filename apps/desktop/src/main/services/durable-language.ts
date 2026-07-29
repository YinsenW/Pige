import {
  Bcp47LanguageTagSchema,
  ConversationLanguageContinuitySchema,
  ChunkLanguageFactSchema,
  DurableLanguageFactSchema,
  OcrArtifactLanguageFactSchema,
  SourceRecordLanguageFactSchema,
  type ConversationLanguageContinuity,
  type DurableLanguageBasis,
  type DurableLanguageDomain,
  type DurableLanguageFact,
  type ChunkLanguageFact,
  type OcrArtifactLanguageFact,
  type SourceRecordLanguageFact,
  type Locale
} from "@pige/schemas";

export function unknownLanguageFact(
  domain: DurableLanguageDomain,
  basis: Extract<DurableLanguageBasis, "legacy_missing" | "unavailable"> = "unavailable"
): DurableLanguageFact {
  return DurableLanguageFactSchema.parse({ domain, language: "unknown", basis });
}

export function observedLanguageFact(
  domain: DurableLanguageDomain,
  value: unknown,
  basis: Exclude<DurableLanguageBasis, "legacy_missing" | "unavailable">
): DurableLanguageFact {
  const language = canonicalLanguage(value);
  return language
    ? DurableLanguageFactSchema.parse({ domain, language, basis })
    : unknownLanguageFact(domain, "unavailable");
}

export function canonicalLanguage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const canonical = Intl.getCanonicalLocales(value.trim())[0];
    return Bcp47LanguageTagSchema.safeParse(canonical).success ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export function observedOcrArtifactLanguage(languageHints: readonly string[]): OcrArtifactLanguageFact {
  const language = languageHints.map(canonicalLanguage).find((value): value is string => Boolean(value));
  return OcrArtifactLanguageFactSchema.parse(language
    ? { domain: "ocr_artifact", language, basis: "ocr_observed" }
    : { domain: "ocr_artifact", language: "unknown", basis: "unavailable" });
}

export function sourceLanguageAfterOcr(
  current: SourceRecordLanguageFact,
  languageHints: readonly string[]
): SourceRecordLanguageFact {
  const language = languageHints.map(canonicalLanguage).find((value): value is string => Boolean(value));
  return language
    ? SourceRecordLanguageFactSchema.parse({ domain: "source_record", language, basis: "ocr_observed" })
    : current;
}

export function inheritedChunkLanguage(value: unknown): ChunkLanguageFact {
  const language = canonicalLanguage(value);
  return ChunkLanguageFactSchema.parse(language
    ? { domain: "chunk", language, basis: "page_inherited" }
    : { domain: "chunk", language: "unknown", basis: "unavailable" });
}

export function conversationLanguageContinuity(
  text: string,
  locale: Locale
): ConversationLanguageContinuity {
  const detected = detectQueryLanguage(text);
  const queryLanguage = detected
    ? observedLanguageFact("query", detected, "query_detected")
    : unknownLanguageFact("query");
  const responseLanguage = observedLanguageFact(
    "response",
    detected ?? locale,
    "response_policy"
  );
  return ConversationLanguageContinuitySchema.parse({ queryLanguage, responseLanguage });
}

function detectQueryLanguage(text: string): string | undefined {
  const sample = text.slice(0, 4_096);
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(sample)) return "ja";
  if (/\p{Script=Hangul}/u.test(sample)) return "ko";
  if (/\p{Script=Han}/u.test(sample)) return "zh-Hans";
  if (/\p{Script=Arabic}/u.test(sample)) return "ar";
  if (/\p{Script=Hebrew}/u.test(sample)) return "he";
  if (/\p{Script=Cyrillic}/u.test(sample)) return "ru";
  if (/\p{Script=Latin}/u.test(sample)) {
    if (/[äöüß]/iu.test(sample)) return "de";
    if (/[àâçéèêëîïôùûüÿœæ]/iu.test(sample)) return "fr";
    return "en";
  }
  return undefined;
}
