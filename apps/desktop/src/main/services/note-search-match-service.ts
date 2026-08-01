import type {
  NoteOpenSearchMatchRequest,
  NoteOpenSearchMatchResult,
  NoteRenderResult
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { PigeMarkdownSelectionSegment } from "@pige/markdown";

export interface NoteSearchMatchPort {
  currentVaultId(): string | undefined;
  render(pageId: string, ownerId: string): Promise<NoteRenderResult>;
  selectionSegments(
    ownerId: string,
    renderContextId: string
  ): ReadonlyMap<string, PigeMarkdownSelectionSegment> | undefined;
}

export async function openNoteSearchMatch(
  request: NoteOpenSearchMatchRequest,
  ownerId: string,
  port: NoteSearchMatchPort
): Promise<NoteOpenSearchMatchResult> {
  const identity = {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId
  };
  if (port.currentVaultId() !== request.activeVaultId) return { ...identity, status: "stale" };
  try {
    const render = await port.render(request.pageId, ownerId);
    if (port.currentVaultId() !== request.activeVaultId) return { ...identity, status: "stale" };
    const segments = render.renderContextId
      ? port.selectionSegments(ownerId, render.renderContextId)
      : undefined;
    const focusSegmentId = segments ? findSearchFocusSegment(segments, request.query) : undefined;
    return { ...identity, status: "ready", render, ...(focusSegmentId ? { focusSegmentId } : {}) };
  } catch (caught) {
    if (caught instanceof PigeDomainError) {
      if (caught.code === "note_not_found") return { ...identity, status: "not_found" };
      if (caught.code === "note_changed" || caught.code === "vault_missing") {
        return { ...identity, status: "stale" };
      }
    }
    return { ...identity, status: "failed" };
  }
}

function findSearchFocusSegment(
  segments: ReadonlyMap<string, PigeMarkdownSelectionSegment>,
  query: string
): string | undefined {
  const normalizedQuery = normalizeSearchFocusText(query);
  const terms = [...new Set(normalizedQuery.split(/[^\p{L}\p{N}]+/gu).filter(Boolean))]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  let best: { readonly id: string; readonly score: number } | undefined;
  for (const [id, segment] of segments) {
    const text = normalizeSearchFocusText(segment.text);
    const exact = normalizedQuery.length > 0 && text.includes(normalizedQuery);
    const matchedCharacters = terms.reduce(
      (total, term) => total + (text.includes(term) ? Array.from(term).length : 0), 0
    );
    const score = (exact ? 1_000_000 : 0) + matchedCharacters;
    if (score > 0 && (!best || score > best.score)) best = { id, score };
  }
  return best?.id;
}

function normalizeSearchFocusText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}
