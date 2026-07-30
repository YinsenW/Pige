import { useEffect, useRef, useState } from "react";
import type {
  LibraryTagFacet,
  LibraryRenameTagRequest,
  LibraryRenameTagResult,
  LibraryTaggedPageSummary,
  LibraryTagsRequest,
  LibraryTagsResult,
} from "@pige/contracts";

export interface LibraryTagsApi {
  readonly tags: (request: LibraryTagsRequest) => Promise<LibraryTagsResult>;
  readonly renameTag: (request: LibraryRenameTagRequest) => Promise<LibraryRenameTagResult>;
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
  readonly rename: string;
  readonly renameTitle: string;
  readonly renameDescription: string;
  readonly renameCurrent: string;
  readonly renameReplacement: string;
  readonly renameCancel: string;
  readonly renameConfirm: string;
  readonly renamePending: string;
  readonly renameFailed: string;
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
type RenameDialogState = {
  readonly tag: string;
  readonly expectedPageCount: number;
  readonly expectedSnapshotId: string;
  readonly draft: string;
  readonly state: "ready" | "pending" | "failed";
};

function createRequestId(): string {
  return `library_tags_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createRenameRequestId(): `library_tag_rename_request_${string}` {
  return `library_tag_rename_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function canonicalTag(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const loadingMoreOwnerRef = useRef<"tags" | "notes" | null>(null);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const selectedTagRef = useRef<string | null>(null);
  const tagsSequenceRef = useRef(0);
  const notesSequenceRef = useRef(0);
  const tagsRetryRef = useRef<HTMLButtonElement>(null);
  const notesRetryRef = useRef<HTMLButtonElement>(null);
  const tagsLoadMoreRef = useRef<HTMLButtonElement>(null);
  const notesLoadMoreRef = useRef<HTMLButtonElement>(null);
  const tagsHeadingRef = useRef<HTMLHeadingElement>(null);
  const tagRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameDialogRef = useRef<HTMLElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCancelRef = useRef<HTMLButtonElement>(null);
  const renameRequestActiveRef = useRef(false);
  const renameSequenceRef = useRef(0);
  const pendingRenamedFocusRef = useRef<string | null>(null);
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
      if (!append && pendingRenamedFocusRef.current) {
        const renamedTag = pendingRenamedFocusRef.current;
        pendingRenamedFocusRef.current = null;
        window.requestAnimationFrame(() => {
          (tagRowRefs.current.get(renamedTag) ?? tagsHeadingRef.current)?.focus({ preventScroll: true });
        });
      }
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
    renameSequenceRef.current += 1;
    renameRequestActiveRef.current = false;
    pendingRenamedFocusRef.current = null;
    setRenameDialog(null);
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

  const openRename = (tag: LibraryTagFacet): void => {
    const snapshotId = tagsContinuation?.snapshotId;
    if (!snapshotId || tag.pageCount <= 0 || renameRequestActiveRef.current) return;
    setRenameDialog({
      tag: tag.tag,
      expectedPageCount: tag.pageCount,
      expectedSnapshotId: snapshotId,
      draft: tag.tag,
      state: "ready",
    });
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus({ preventScroll: true });
      renameInputRef.current?.select();
    });
  };

  const cancelRename = (): void => {
    if (!renameDialog || renameRequestActiveRef.current) return;
    const tag = renameDialog.tag;
    setRenameDialog(null);
    window.requestAnimationFrame(() => renameTriggerRefs.current.get(tag)?.focus({ preventScroll: true }));
  };

  const submitRename = async (): Promise<void> => {
    if (!renameDialog || renameRequestActiveRef.current) return;
    const replacementTag = canonicalTag(renameDialog.draft);
    if (
      !replacementTag ||
      replacementTag.length > 48 ||
      /[\u0000-\u001f\u007f]/u.test(replacementTag) ||
      replacementTag.toLocaleLowerCase("en-US") === renameDialog.tag.toLocaleLowerCase("en-US")
    ) return;
    renameRequestActiveRef.current = true;
    const sequence = ++renameSequenceRef.current;
    const request: LibraryRenameTagRequest = {
      apiVersion: 1,
      requestId: createRenameRequestId(),
      activeVaultId: props.activeVaultId,
      tag: renameDialog.tag,
      replacementTag,
      expectedSnapshotId: renameDialog.expectedSnapshotId,
      expectedPageCount: renameDialog.expectedPageCount,
    };
    setRenameDialog((current) => current ? { ...current, state: "pending" } : current);
    try {
      const result = await props.api.renameTag(request);
      if (
        sequence !== renameSequenceRef.current ||
        activeVaultIdRef.current !== request.activeVaultId
      ) return;
      if (!renameIdentityMatches(request, result)) {
        setRenameDialog((current) => current ? { ...current, state: "failed" } : current);
        window.requestAnimationFrame(() => renameInputRef.current?.focus({ preventScroll: true }));
        return;
      }
      if (result.status === "committed") {
        setRenameDialog(null);
        setSelectedTag(null);
        selectedTagRef.current = null;
        setNotes([]);
        setNotesContinuation(null);
        pendingRenamedFocusRef.current = replacementTag;
        await loadTags(false);
        if (pendingRenamedFocusRef.current === replacementTag) {
          pendingRenamedFocusRef.current = null;
          window.requestAnimationFrame(() => tagsHeadingRef.current?.focus({ preventScroll: true }));
        }
        return;
      }
      setRenameDialog((current) => current ? { ...current, state: "failed" } : current);
      window.requestAnimationFrame(() => renameInputRef.current?.focus({ preventScroll: true }));
    } catch {
      if (sequence === renameSequenceRef.current && activeVaultIdRef.current === request.activeVaultId) {
        setRenameDialog((current) => current ? { ...current, state: "failed" } : current);
        window.requestAnimationFrame(() => renameInputRef.current?.focus({ preventScroll: true }));
      }
    } finally {
      if (sequence === renameSequenceRef.current && activeVaultIdRef.current === request.activeVaultId) {
        renameRequestActiveRef.current = false;
      }
    }
  };

  const renameReplacement = canonicalTag(renameDialog?.draft ?? "");
  const renameValid = Boolean(renameDialog) && renameReplacement.length > 0 && renameReplacement.length <= 48 &&
    !/[\u0000-\u001f\u007f]/u.test(renameReplacement) &&
    renameReplacement.toLocaleLowerCase("en-US") !== renameDialog?.tag.toLocaleLowerCase("en-US");

  return (
    <section className="search-group" aria-labelledby="library-tags-heading">
      <h2 ref={tagsHeadingRef} id="library-tags-heading" tabIndex={-1}>{props.labels.title}</h2>
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
                  ref={(element) => {
                    if (element) tagRowRefs.current.set(tag.tag, element);
                    else tagRowRefs.current.delete(tag.tag);
                  }}
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
                {tag.pageCount > 0 && tagsContinuation?.snapshotId ? <button
                  ref={(element) => {
                    if (element) renameTriggerRefs.current.set(tag.tag, element);
                    else renameTriggerRefs.current.delete(tag.tag);
                  }}
                  type="button"
                  className="settings-button"
                  aria-label={`${props.labels.rename}: ${tag.tag}`}
                  onClick={() => openRename(tag)}
                >
                  {props.labels.rename}
                </button> : null}
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
      {renameDialog ? (
        <div className="confirmation-backdrop">
          <section
            ref={renameDialogRef}
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="library-tag-rename-title"
            aria-describedby="library-tag-rename-description"
            aria-busy={renameDialog.state === "pending"}
            onKeyDown={(event) => {
              if (event.key === "Escape" && renameDialog.state !== "pending") {
                event.preventDefault();
                cancelRename();
                return;
              }
              if (event.key !== "Tab") return;
              const controls = Array.from(renameDialogRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []);
              if (controls.length === 0) return event.preventDefault();
              const first = controls[0]!;
              const last = controls.at(-1)!;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="confirmation-icon" aria-hidden="true">!</div>
            <div className="confirmation-copy">
              <h2 id="library-tag-rename-title">{props.labels.renameTitle}</h2>
              <p id="library-tag-rename-description">{props.labels.renameDescription}</p>
              <p><strong>{props.labels.renameCurrent}</strong> {renameDialog.tag}</p>
              <label>
                <span>{props.labels.renameReplacement}</span>
                <input
                  ref={renameInputRef}
                  value={renameDialog.draft}
                  maxLength={48}
                  disabled={renameDialog.state === "pending"}
                  onChange={(event) => {
                    const draft = event.currentTarget.value;
                    setRenameDialog((current) => current ? { ...current, draft, state: "ready" } : current);
                  }}
                />
              </label>
              {renameDialog.state === "failed" ? <p className="error" role="alert">{props.labels.renameFailed}</p> : null}
            </div>
            <div className="confirmation-actions">
              <button ref={renameCancelRef} type="button" className="secondary" disabled={renameDialog.state === "pending"} onClick={cancelRename}>
                {props.labels.renameCancel}
              </button>
              <button type="button" className="primary" disabled={renameDialog.state === "pending" || !renameValid} onClick={() => void submitRename()}>
                {renameDialog.state === "pending" ? props.labels.renamePending : props.labels.renameConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function renameIdentityMatches(request: LibraryRenameTagRequest, result: LibraryRenameTagResult): boolean {
  return result.apiVersion === request.apiVersion && result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId && result.tag === request.tag &&
    result.replacementTag === request.replacementTag && result.expectedSnapshotId === request.expectedSnapshotId &&
    result.expectedPageCount === request.expectedPageCount;
}
