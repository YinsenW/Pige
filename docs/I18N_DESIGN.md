# Internationalization Design

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should support internationalization from v0.1.

v0.1 supported UI locales:

- Simplified Chinese: `zh-Hans`
- English: `en`
- Japanese: `ja`
- Korean: `ko`
- French: `fr`
- German: `de`

I18N is not only UI translation. Pige also needs language-aware capture, OCR, search, RAG, metadata, and Agent output.

## 2. Product Principles

- Use the system locale by default.
- Let the user override app language in Settings.
- Keep content in its original language unless the user asks to translate or rewrite it.
- Store language metadata on sources, notes, artifacts, and OCR output.
- Do not require users to choose a language before capture.
- Ask only when language ambiguity materially affects output.
- Preserve multilingual vaults.
- Support cross-language retrieval as much as local RAG allows.

## 3. UI Localization

v0.1 UI requirements:

- All visible UI strings must come from locale message files.
- No hard-coded user-facing strings in React components.
- Use ICU-style messages for pluralization, dates, relative time, and counts.
- Avoid string concatenation.
- Support longer German and French labels without layout breakage.
- Support CJK line breaking and IME composition in capture input, note editor, search, and settings fields.
- Keep icons and compact controls understandable across languages.
- Test compact window layout in all six locales.

Recommended locale files:

```txt
src/locales/
  en/messages.json
  zh-Hans/messages.json
  ja/messages.json
  ko/messages.json
  fr/messages.json
  de/messages.json
```

Language selector labels:

- System
- 简体中文
- English
- 日本語
- 한국어
- Français
- Deutsch

Phase 1 implementation note:

- The desktop shell uses simple key/value message catalogs for core screens and verifies that all six locale files contain the same non-empty keys.
- ICU-style messages remain required when a string needs pluralization, dates, relative time, or grammatical variants.
- The app locale defaults from the supported system locale and can be overridden in machine-local settings without writing to the vault.

## 4. Content Language Metadata

Pige should track language separately from UI locale.

Source frontmatter should include:

```yaml
language: en
language_confidence: 0.92
detected_languages:
  - en
  - ja
```

Generated note frontmatter should include when useful:

```yaml
content_language: en
summary_language: zh-Hans
translation_of: null
```

Rules:

- `language` describes the original source language.
- `summary_language` describes generated summaries.
- Mixed-language sources can store multiple detected languages.
- The Agent should not silently translate the source page unless the workflow asks for translation.

## 5. Agent Output Language Policy

Default behavior:

- If the user asks in a language, answer in that language.
- If the user captures a source without explicit instruction, preserve the source language for source pages.
- For compiled wiki pages, prefer the vault's default knowledge language if configured; otherwise use the dominant source language.
- For Home knowledge retrieval, answer in the query language while citing notes/sources in their original language.
- For Note Agent actions, use the current UI language unless the user asks otherwise.

User controls:

- App language.
- Default knowledge language.
- Unless the user requests translation, source pages retain the detected input language.
- Summarize captures in app language.
- Ask before translating source material.

## 6. Search And RAG

v0.1 should support multilingual retrieval through both lexical and semantic paths.

Requirements:

- Store language metadata for pages, source pages, chunks, memory records, and OCR artifacts.
- Normalize Unicode before indexing.
- Use language-aware case folding and diacritic handling for Latin scripts.
- Add CJK-friendly lexical fallback for Chinese, Japanese, and Korean, such as character n-gram or trigram indexing.
- Use Local RAG embeddings for semantic retrieval across supported languages.
- Let Home query language differ from document language.
- Show snippets in original language.
- Generate grounded summaries in query language by default.

Ranking hints:

- Exact lexical match should still matter.
- Same-language results can get a small boost when query and source language match.
- Cross-language semantic matches should remain eligible.
- Source-backed citations should preserve original titles and paths.

## 7. OCR And Speech

OCR:

- OCR artifacts should include language hints and detected languages.
- Settings should allow preferred OCR languages for engines that support it.
- Apple Vision, Windows AI OCR, and PaddleOCR should receive language hints when available.
- Current macOS direct-image OCR passes a valid source locale as a preferred BCP 47 hint, enables automatic language detection/correction, and persists the engine-returned language hints on blocks, Artifact metadata, and the Source Record.
- PaddleOCR language/model downloads should be explicit and shown in Local Tools.
- v0.1 should prioritize the six supported UI languages for OCR language presets.

Speech:

- macOS SpeechAnalyzer/SpeechTranscriber should use the selected dictation language when supported.
- The microphone button should expose current dictation language in a compact way.
- Unsupported dictation languages should show a clear disabled or unavailable state.
- Voice input language is not necessarily the same as UI language.

## 8. Markdown Rendering And Editing

Requirements:

- Preserve original Unicode text.
- Use UTF-8 for all generated text files.
- Render CJK, Latin, and mixed-language text with appropriate fallback fonts.
- Avoid fixed-width assumptions for translated UI strings.
- Support IME composition in Markdown editing.
- Keep wiki links stable even when page titles contain non-Latin characters.
- Slug generation should support Unicode titles and store stable page IDs to avoid path fragility.

## 9. Skill And Package Localization

Skills and packages may expose localized metadata later.

v0.1:

- Show Skill/package metadata in the language provided by the Skill/package.
- Allow optional localized fields such as `name_zh-Hans`, `description_ja`, or `locales`.
- Do not require third-party Skills to provide all six locales.

## 10. Testing

v0.1 I18N checks:

- App launches in all six locales.
- Compact Home window does not overflow in German or French.
- CJK input works with IME composition.
- Home knowledge retrieval accepts each supported language.
- Notes can preserve original source language.
- OCR can store language hints.
- Markdown reader handles CJK and Latin mixed content.
- Settings language switch works without restart when practical.

Pseudo-locale testing should be added later for overflow and missing-key detection.

## 11. v0.1 Scope

Include:

- UI locale files for `zh-Hans`, `en`, `ja`, `ko`, `fr`, and `de`.
- Settings language selector.
- System locale default.
- Language metadata in source/note frontmatter.
- Language-aware Agent output policy.
- CJK-friendly lexical indexing fallback.
- Multilingual semantic retrieval through Local RAG.
- OCR language hints where supported.
- Dictation language setting where supported by platform APIs.

Defer:

- Right-to-left languages.
- Full locale-specific documentation.
- Human translation QA for every advanced string.
- Per-vault collaborative translation workflows.
- Full Skill/package marketplace localization.

## 12. References

Internationalization standards and update policy are registered once in
[`TECH_ARCHITECTURE.md`](TECH_ARCHITECTURE.md#169-internationalization-and-format-standards).
