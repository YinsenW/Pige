import { useEffect, useRef, useState } from "react";
import type { LibraryRenameTopicRequest, LibraryRenameTopicResult, NoteRenderResult } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export interface ReaderTopicRenameDialogProps {
  readonly activeVaultId?: string;
  readonly note: NoteRenderResult;
  readonly onRename?: (request: LibraryRenameTopicRequest) => Promise<LibraryRenameTopicResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}

export function ReaderTopicRenameDialog(props: ReaderTopicRenameDialogProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.note.summary.title);
  const [status, setStatus] = useState<"idle" | "saving" | "stale" | "failed">("idle");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<string | null>(null);
  const ownerIdentity = `${props.activeVaultId ?? ""}:${props.note.summary.pageId}:${props.note.renderContextId ?? ""}:${props.note.topicRenameEligibility?.revision ?? ""}`;

  useEffect(() => {
    requestRef.current = null;
    setOpen(false);
    setTitle(props.note.summary.title);
    setStatus("idle");
  }, [ownerIdentity]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (props.note.summary.pageType !== "topic" || props.note.summary.status !== "active" ||
    props.note.topicRenameEligibility?.canRename !== true || !props.activeVaultId || !props.onRename) {
    return null;
  }

  const close = (): void => {
    if (status === "saving") return;
    setOpen(false);
    setStatus("idle");
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const submit = async (): Promise<void> => {
    const normalized = title.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!normalized || normalized === props.note.summary.title || requestRef.current) return;
    const requestId = `library_topic_rename_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    const request: LibraryRenameTopicRequest = {
      apiVersion: 1,
      requestId,
      activeVaultId: props.activeVaultId!,
      pageId: props.note.summary.pageId,
      expectedUpdatedAt: props.note.summary.updatedAt,
      expectedRevision: props.note.topicRenameEligibility!.revision,
      expectedTitle: props.note.summary.title,
      title: normalized
    };
    requestRef.current = requestId;
    setStatus("saving");
    try {
      const result = await props.onRename!(request);
      if (requestRef.current !== requestId) return;
      requestRef.current = null;
      if (!sameIdentity(request, result)) {
        setStatus("failed");
        window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        return;
      }
      if (
        result.status === "committed" && result.render.summary.pageId === request.pageId &&
        result.render.summary.pageType === "topic" && result.render.summary.title === request.title
      ) {
        setOpen(false);
        setStatus("idle");
        props.onCommitted(result.render);
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
        return;
      }
      setStatus(result.status === "stale" || result.status === "not_found" ? "stale" : "failed");
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } catch {
      if (requestRef.current === requestId) {
        requestRef.current = null;
        setStatus("failed");
        window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        data-reader-action="rename-topic"
        aria-label={props.t("topic.rename.action")}
        title={props.t("topic.rename.action")}
        onClick={() => { setTitle(props.note.summary.title); setStatus("idle"); setOpen(true); }}
      >
        <PigeIcon name="edit" size={16} />
      </button>
      {open ? (
        <div className="reader-action-dialog" role="dialog" aria-modal="true" aria-labelledby="topic-rename-title">
          <h2 id="topic-rename-title">{props.t("topic.rename.title")}</h2>
          <p>{props.t("topic.rename.description")}</p>
          <label>
            <span>{props.t("topic.rename.field")}</span>
            <input
              ref={inputRef}
              value={title}
              maxLength={240}
              disabled={status === "saving"}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); close(); }
                else if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
              }}
            />
          </label>
          {status === "stale" || status === "failed" ? (
            <p className="error" role="alert">{props.t(`topic.rename.${status}`)}</p>
          ) : null}
          <div className="settings-inline-actions">
            <button type="button" className="settings-button" disabled={status === "saving"} onClick={close}>
              {props.t("topic.rename.cancel")}
            </button>
            <button
              type="button"
              className="settings-button primary"
              disabled={status === "saving" || !title.trim() || title.normalize("NFKC").replace(/\s+/gu, " ").trim() === props.note.summary.title}
              onClick={() => void submit()}
            >
              {props.t(status === "saving" ? "topic.rename.saving" : "topic.rename.confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function sameIdentity(request: LibraryRenameTopicRequest, result: LibraryRenameTopicResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.pageId === request.pageId && result.expectedUpdatedAt === request.expectedUpdatedAt &&
    result.expectedRevision === request.expectedRevision && result.expectedTitle === request.expectedTitle &&
    result.title === request.title;
}
