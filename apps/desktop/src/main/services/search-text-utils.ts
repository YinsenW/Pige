const MAX_SNIPPET_LENGTH = 260;
const CJK_PATTERN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

export interface QueryTerms {
  readonly normalizedQuery: string;
  readonly terms: readonly string[];
}

export function createQueryTerms(query: string): QueryTerms {
  const normalizedQuery = normalizeSearchText(query);
  const terms = new Set<string>();

  for (const token of normalizedQuery.match(/[\p{Letter}\p{Number}_-]+/gu) ?? []) {
    if (token.length >= 2) terms.add(token);
  }

  for (const gram of createCjkGrams(normalizedQuery)) {
    terms.add(gram);
  }

  if (terms.size === 0 && normalizedQuery) terms.add(normalizedQuery);
  return { normalizedQuery, terms: Array.from(terms) };
}

export function createSnippet(markdownBody: string, query: QueryTerms): string {
  const plain = normalizeDisplayText(markdownBody);
  const plainSearch = normalizeSearchText(plain);
  const firstNeedle = [query.normalizedQuery, ...query.terms].find((term) => term && plainSearch.includes(term));
  if (!firstNeedle) return truncateSnippet(plain);

  const matchIndex = plainSearch.indexOf(firstNeedle);
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(plain.length, matchIndex + firstNeedle.length + 140);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < plain.length ? " ..." : "";
  return truncateSnippet(`${prefix}${plain.slice(start, end).trim()}${suffix}`);
}

export function normalizeDisplayText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[#>*_\-[\]()`~|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function sanitizeSearchBody(value: string): string {
  return redactLikelySecrets(
    value
      .split(/\r?\n/u)
      .filter((line) => !/\b(managed[_ ]copy|source[_ ]record|original[_ ]uri)\b|\.pige\/source-records|raw\/(?:files|text)\//iu.test(line))
      .join("\n")
  );
}

export function normalizeSearchText(value: string): string {
  return normalizeDisplayText(value).normalize("NFKC").toLocaleLowerCase();
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (count < 20) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) break;
    count += 1;
    cursor = found + Math.max(1, needle.length);
  }
  return count;
}

export function createCjkSearchAugmentation(value: string): string {
  return createCjkGrams(normalizeSearchText(value)).join(" ");
}

function createCjkGrams(value: string): readonly string[] {
  if (!CJK_PATTERN.test(value)) return [];
  const grams = new Set<string>();
  const chars = Array.from(value).filter((char) => CJK_PATTERN.test(char));
  for (const size of [2, 3]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.add(chars.slice(index, index + size).join(""));
    }
  }
  return Array.from(grams);
}

function truncateSnippet(value: string): string {
  if (value.length <= MAX_SNIPPET_LENGTH) return value;
  return `${value.slice(0, MAX_SNIPPET_LENGTH - 3).trimEnd()}...`;
}

function redactLikelySecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[redacted-secret]")
    .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/gu, "[redacted-secret]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu, "[redacted-secret]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/giu,
      "$1=[redacted-secret]"
    );
}
