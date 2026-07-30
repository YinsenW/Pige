import { useEffect, useRef, useState } from "react";
import type {
  LibraryTagFacet,
  LibraryTaggedPageSummary,
  LibraryTagsRequest,
  LibraryTagsResult,
} from "@pige/contracts";

export interface LibraryTagsApi {
  readonly tags: (request: LibraryTagsRequest) => Promise<LibraryTagsResult>;
}

export interface LibraryTagsBrowserLabels {
  readonly title: string;
  readonly loading: string;
  readonly empty: string;
  readonly failed: string;
  readonly retry: string;
  readonly notesLoading: string;
  readonly notesEmpty: string;
  readonly notesFailed: string;
  readonly loadMore: string;
  readonly loadingMore: string;
  readonly open: string;
  readonly noteCount: (count: number) => string;
}

export interface LibraryTagsBrowserProps {
  readonly activeVaultId: string;
  readonly api: LibraryTagsApi;
  readonly labels: LibraryTagsBrowserLabels;
  readonly onOpenNote: (pageId: string) => Promise<void>;
}

type LoadState = "loading" | "ready" | "failed";
type Continuation = {
  readonly snapshotId: string;
  readonly nextCursor?: string;
};

function createRequestId(): string {
  return `library_tags_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function mergeTags(
  current: readonly LibraryTagFacet[],
  incoming: readonly LibraryTagFacet[],
): readonly LibraryTagFacet[] {
  const seen = new Set(current.map(({ tag }) => tag));
  return [...current, ...incoming.filter(({ tag }) => !seen.has(tag))];
}

function mergePages(
  current: readonly LibraryTaggedPageSummary[],
  incoming: readonly LibraryTaggedPageSummary[],
): readonly LibraryTaggedPageSummary[] {
  const seen = new Set(current.map(({ pageId }) => pageId));
  return [...current, ...incoming.filter(({ pageId }) => !seen.has(pageId))];
}

export function LibraryTagsBrowser(
  props: LibraryTagsBrowserProps,
): React.JSX.Element {
  const [tagsState, setTagsState] = useState<LoadState>("loading");
  const [tags, setTags] = useState<readonly LibraryTagFacet[]>([]);
  const [tagsContinuation, setTagsContinuation] = useState<Continuation | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [notesState, setNotesState] = useState<LoadState>("loading");
  const [notes, setNotes] = useState<readonly LibraryTaggedPageSummary[]>([]);
  const [notesContinuation, setNotesContinuation] = useState<Continuation | null>(null);
  const [loadingMoreOwner, setLoadingMoreOwner] = useState<"tags" | "notes" | null>(null);
  const [continuationFailedOwner, setContinuationFailedOwner] = useState<"tags" | "notes" | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const loadingMoreOwnerRef = useRef<"tags" | "notes" | null>(null);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const selectedTagRef = useRef<string | null>(null);
  const tagsSequenceRef = useRef(0);
  const notesSequenceRef = useRef(0);
  const tagsRetryRef = useRef<HTMLButtonElement>(null);
  const notesRetryRef = useRef<HTMLButtonElement>(null);
  const tagsLoadMoreRef = useRef<HTMLButtonElement>(null);
  const notesLoadMoreRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<"tags-retry" | "notes-retry" | "tags-more" | "notes-more" | null>(null);
  activeVaultIdRef.current = props.activeVaultId;
  selectedTagRef.current = selectedTag;

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending === "tags-retry") tagsRetryRef.current?.focus();
    else if (pending === "notes-retry") notesRetryRef.current?.focus();
    else if (pending === "tags-more") tagsLoadMoreRef.current?.focus();
    else if (pending === "notes-more") notesLoadMoreRef.current?.focus();
  }, [focusRevision]);

  const restorePendingFocus = (): void => {
    setFocusRevision((current) => current + 1);
  };

  const loadTags = async (append: boolean): Promise<void> => {
    const vaultId = props.activeVaultId;
    const continuation = append ? tagsContinuation : null;
    if (append && !continuation?.nextCursor) return;
    const sequence = tagsSequenceRef.current + 1;
    tagsSequenceRef.current = sequence;
    if (append) {
      setLoadingMoreOwner("tags");
      setContinuationFailedOwner(null);
    } else {
      setTagsState("loading");
      setTags([]);
      setTagsContinuation(null);
    }
    const request: LibraryTagsRequest = {
      apiVersion: 1,
      requestId: createRequestId(),
      activeVaultId: vaultId,
      mode: "list_tags",
      limit: 50,
      ...(continuation?.nextCursor
        ? { snapshotId: continuation.snapshotId, cursor: continuation.nextCursor }
        : {}),
    };
    try {
      const result = await props.api.tags(request);
      if (
        sequence !== tagsSequenceRef.current ||
        activeVaultIdRef.current !== vaultId ||
        result.requestId !== request.requestId ||
        result.activeVaultId !== vaultId ||
        result.mode !== "list_tags"
      ) return;
      if (result.status !== "ready" || (append && result.snapshotId !== continuation?.snapshotId)) {
        if (append) setContinuationFailedOwner("tags");
        else setTagsState("failed");
        return;
      }
      setTags((current) => append ? mergeTags(current, result.tags) : result.tags);
      setTagsContinuation({
        snapshotId: result.snapshotId,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      });
      setTagsState("ready");
      setContinuationFailedOwner(null);
    } catch {
      if (sequence !== tagsSequenceRef.current || activeVaultIdRef.current !== vaultId) return;
      if (append) setContinuationFailedOwner("tags");
      else setTagsState("failed");
    } finally {
      if (sequence === tagsSequenceRef.current && activeVaultIdRef.current === vaultId) {
        loadingMoreOwnerRef.current = null;
        setLoadingMoreOwner(null);
        restorePendingFocus();
      }
    }
  };

  const loadNotes = async (tag: string, append: boolean): Promise<void> => {
    const vaultId = props.activeVaultId;
    const continuation = append ? notesContinuation : null;
    if (append && !continuation?.nextCursor) return;
    const sequence = notesSequenceRef.current + 1;
    notesSequenceRef.current = sequence;
    if (append) {
      setLoadingMoreOwner("notes");
      setContinuationFailedOwner(null);
    } else {
      setNotesState("loading");
      setNotes([]);
      setNotesContinuation(null);
    }
    const request: LibraryTagsRequest = {
      apiVersion: 1,
      requestId: createRequestId(),
      activeVaultId: vaultId,
      mode: "list_pages_for_tag",
      tag,
      limit: 50,
      ...(continuation?.nextCursor
        ? { snapshotId: continuation.snapshotId, cursor: continuation.nextCursor }
        : {}),
    };
    try {
      const result = await props.api.tags(request);
      if (
        sequence !== notesSequenceRef.current ||
        activeVaultIdRef.current !== vaultId ||
        selectedTagRef.current !== tag ||
        result.requestId !== request.requestId ||
        result.activeVaultId !== vaultId ||
        result.mode !== "list_pages_for_tag" ||
        result.tag !== tag
      ) return;
      if (result.status !== "ready" || (append && result.snapshotId !== continuation?.snapshotId)) {
        if (append) setContinuationFailedOwner("notes");
        else setNotesState("failed");
        return;
      }
      setNotes((current) => append ? mergePages(current, result.pages) : result.pages);
      setNotesContinuation({
        snapshotId: result.snapshotId,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      });
      setNotesState("ready");
      setContinuationFailedOwner(null);
    } catch {
      if (
        sequence !== notesSequenceRef.current ||
        activeVaultIdRef.current !== vaultId ||
        selectedTagRef.current !== tag
      ) return;
      if (append) setContinuationFailedOwner("notes");
      else setNotesState("failed");
    } finally {
      if (
        sequence === notesSequenceRef.current &&
        activeVaultIdRef.current === vaultId &&
        selectedTagRef.current === tag
      ) {
        loadingMoreOwnerRef.current = null;
        setLoadingMoreOwner(null);
        restorePendingFocus();
      }
    }
  };

  useEffect(() => {
    tagsSequenceRef.current += 1;
    notesSequenceRef.current += 1;
    setSelectedTag(null);
    setNotes([]);
    setNotesContinuation(null);
    loadingMoreOwnerRef.current = null;
    setLoadingMoreOwner(null);
    setContinuationFailedOwner(null);
    void loadTags(false);
  }, [props.activeVaultId]);

  const selectTag = (tag: string): void => {
    if (selectedTagRef.current === tag) return;
    notesSequenceRef.current += 1;
    setSelectedTag(tag);
    selectedTagRef.current = tag;
    setContinuationFailedOwner(null);
    void loadNotes(tag, false);
  };

  const retryInitial = (owner: "tags" | "notes"): void => {
    pendingFocusRef.current = owner === "tags" ? "tags-retry" : "notes-retry";
    if (owner === "tags") void loadTags(false);
    else if (selectedTag) void loadNotes(selectedTag, false);
  };

  const loadMore = (owner: "tags" | "notes"): void => {
    if (loadingMoreOwnerRef.current) return;
    loadingMoreOwnerRef.current = owner;
    setLoadingMoreOwner(owner);
    pendingFocusRef.current = owner === "tags" ? "tags-more" : "notes-more";
    if (owner === "tags") void loadTags(true);
    else if (selectedTag) void loadNotes(selectedTag, true);
  };

  return (
    <section className="search-group" aria-labelledby="library-tags-heading">
      <h2 id="library-tags-heading">{props.labels.title}</h2>
      {tagsState === "loading" ? (
        <p role="status" aria-busy="true">{props.labels.loading}</p>
      ) : tagsState === "failed" ? (
        <div className="library-state inline-unavailable" role="alert">
          <div className="state-copy">
            <p>{props.labels.failed}</p>
            <button ref={tagsRetryRef} type="button" className="primary-button" onClick={() => retryInitial("tags")}>
              {props.labels.retry}
            </button>
          </div>
        </div>
      ) : tags.length === 0 ? (
        <p className="search-empty visible" role="status">{props.labels.empty}</p>
      ) : (
        <>
          <div aria-label={props.labels.title} role="list">
            {tags.map((tag) => (
              <div key={tag.tag} role="listitem">
                <button
                  type="button"
                  className="search-result"
                  aria-pressed={selectedTag === tag.tag}
                  onClick={() => selectTag(tag.tag)}
                >
                  <span className="search-result-copy">
                    <strong>{tag.tag}</strong>
                    <span>{props.labels.noteCount(tag.pageCount)}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          {continuationFailedOwner === "tags" ? <p role="alert">{props.labels.failed}</p> : null}
          {tagsContinuation?.nextCursor ? (
            <button
              ref={tagsLoadMoreRef}
              type="button"
              className="settings-button"
              disabled={loadingMoreOwner !== null}
              aria-busy={loadingMoreOwner === "tags"}
              onClick={() => loadMore("tags")}
            >
              {loadingMoreOwner === "tags" ? props.labels.loadingMore : props.labels.loadMore}
            </button>
          ) : null}
        </>
      )}

      {selectedTag ? (
        <section aria-live="polite">
          {notesState === "loading" ? (
            <p role="status" aria-busy="true">{props.labels.notesLoading}</p>
          ) : notesState === "failed" ? (
            <div className="library-state inline-unavailable" role="alert">
              <div className="state-copy">
                <p>{props.labels.notesFailed}</p>
                <button ref={notesRetryRef} type="button" className="primary-button" onClick={() => retryInitial("notes")}>
                  {props.labels.retry}
                </button>
              </div>
            </div>
          ) : notes.length === 0 ? (
            <p className="search-empty visible" role="status">{props.labels.notesEmpty}</p>
          ) : (
            <>
              {notes.map((note) => (
                <button
                  key={note.pageId}
                  type="button"
                  className="search-result"
                  onClick={() => void props.onOpenNote(note.pageId)}
                >
                  <span className="search-result-copy">
                    <strong>{note.title}</strong>
                    <span>{note.pageType}</span>
                  </span>
                  <small>{props.labels.open}</small>
                </button>
              ))}
              {continuationFailedOwner === "notes" ? <p role="alert">{props.labels.notesFailed}</p> : null}
              {notesContinuation?.nextCursor ? (
                <button
                  ref={notesLoadMoreRef}
                  type="button"
                  className="settings-button"
                  disabled={loadingMoreOwner !== null}
                  aria-busy={loadingMoreOwner === "notes"}
                  onClick={() => loadMore("notes")}
                >
                  {loadingMoreOwner === "notes" ? props.labels.loadingMore : props.labels.loadMore}
                </button>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}
