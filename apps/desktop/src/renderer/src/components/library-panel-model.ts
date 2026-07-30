import type {
  LibraryListResult,
  LibraryPageSummary,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
} from "@pige/contracts";

export type LibraryFamily = "all" | "notes" | "sources" | "topics" | "tags";
export type LibraryResultGroup = "notes" | "sources" | "topics";
export type LibrarySearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly query: string; readonly family: LibraryFamily }
  | { readonly kind: "result"; readonly query: string; readonly family: LibraryFamily; readonly result: RetrievalSearchResult }
  | { readonly kind: "error"; readonly query: string; readonly family: LibraryFamily };

export const LIBRARY_FAMILIES: readonly LibraryFamily[] = ["all", "notes", "sources", "topics", "tags"];
export const LIBRARY_RESULT_GROUPS: readonly LibraryResultGroup[] = ["notes", "sources", "topics"];
const LIBRARY_TOPIC_PAGE_TYPES = ["topic", "concept", "entity", "claim", "question"] as const;

export function libraryFamilyPageTypes(family: LibraryFamily): RetrievalSearchRequest["pageTypes"] | undefined {
  if (family === "notes") return ["note"];
  if (family === "sources") return ["source"];
  if (family === "topics") return LIBRARY_TOPIC_PAGE_TYPES;
  return undefined;
}

function libraryResultGroup(page: LibraryPageSummary): LibraryResultGroup {
  if (page.pageType === "source") return "sources";
  if (page.pageType === "note") return "notes";
  return "topics";
}

export function groupLibrarySearchItems(
  items: readonly RetrievalSearchResultItem[]
): Record<LibraryResultGroup, readonly RetrievalSearchResultItem[]> {
  const groups: Record<LibraryResultGroup, RetrievalSearchResultItem[]> = { notes: [], sources: [], topics: [] };
  for (const item of items) groups[libraryResultGroup(item.summary)].push(item);
  return groups;
}

export function libraryMatchReasonLabel(matchReasons: readonly string[], t: (key: string) => string): string | null {
  const labels: string[] = [];
  const knownReasons = new Set<string>();
  for (const reason of matchReasons) {
    if (reason !== "title" && reason !== "body" && reason !== "path") continue;
    if (knownReasons.has(reason)) continue;
    knownReasons.add(reason);
    labels.push(t(`library.matchReason.${reason}`));
  }
  return labels.length > 0 ? labels.join(" · ") : null;
}

export function libraryBrowseItems(
  pages: LibraryListResult["pages"],
  family: LibraryFamily
): readonly RetrievalSearchResultItem[] {
  if (family === "tags") return [];
  return pages
    .filter((page) => family === "all" || libraryResultGroup(page) === family)
    .map((summary) => ({ summary, score: 0, snippets: [], matchReasons: [] }));
}

export function libraryResultIconLabel(pageType: LibraryPageSummary["pageType"]): string {
  if (pageType === "source") return "SRC";
  if (pageType === "note") return "MD";
  return "#";
}

export function filterLibraryPages(
  pages: LibraryListResult["pages"],
  filter: "all" | "note" | "source" | "topic",
  query: string
): LibraryListResult["pages"] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return pages.filter((page) => {
    if (filter !== "all" && page.pageType !== filter) return false;
    return !normalizedQuery || page.title.toLocaleLowerCase().includes(normalizedQuery);
  });
}
