import { useEffect, useRef, useState, type RefObject } from "react";
import type { NoteRenameRequest, NoteRenameResult, NoteRenderResult } from "@pige/contracts";

export interface ReaderNoteRenameLabels {
  readonly action: string; readonly title: string; readonly description: string; readonly field: string;
  readonly cancel: string; readonly confirm: string; readonly pending: string; readonly failed: string;
}
export type ReaderNoteRenameOutcome = { readonly status: "committed"; readonly render: NoteRenderResult } | { readonly status: "retained" };
export type ReaderNoteRenameSubmit = (request: NoteRenameRequest) => Promise<NoteRenameResult>;

export function readerNoteRenameLabels(t: (key: string) => string): ReaderNoteRenameLabels {
  return { action: t("note.rename.action"), title: t("note.rename.title"), description: t("note.rename.description"),
    field: t("note.rename.field"), cancel: t("note.rename.cancel"), confirm: t("note.rename.confirm"),
    pending: t("note.rename.pending"), failed: t("note.rename.failed") };
}

export function canonicalNoteTitle(value: string): string { return value.normalize("NFKC").replace(/\s+/gu, " ").trim(); }

export async function submitReaderNoteRename(input: {
  readonly note: NoteRenderResult | null | undefined; readonly activeVaultId: string | null | undefined;
  readonly title: string; readonly submit: ReaderNoteRenameSubmit | null | undefined;
  readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderNoteRenameOutcome> {
  const title = canonicalNoteTitle(input.title), eligibility = input.note?.renameEligibility, renderContextId = input.note?.renderContextId;
  const pageType = input.note?.summary.pageType;
  if (!input.note || !pageType || !["note", "claim", "question", "concept", "entity"].includes(pageType) ||
    input.note.summary.status !== "active" || !eligibility?.canRename ||
    !input.activeVaultId || !renderContextId || !input.submit || !title || title === input.note.summary.title || title.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(title)) return { status: "retained" };
  const request: NoteRenameRequest = { apiVersion: 1,
    requestId: `noterenamereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId, currentPageId: input.note.summary.pageId, renderContextId,
    expectedRevision: eligibility.revision, title };
  try {
    const result = await input.submit(request), current = input.currentNote?.();
    if (!identityMatches(request, result) || (current && !requestMatchesNote(request, current)) || result.status !== "committed" ||
      result.render.summary.pageId !== request.currentPageId || result.render.summary.pageType !== pageType ||
      result.render.summary.title !== request.title || !result.render.renderContextId) return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch { return { status: "retained" }; }
}

export function ReaderNoteRenameDialog(props: {
  readonly ownerIdentity: string; readonly currentTitle: string; readonly labels: ReaderNoteRenameLabels;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>; readonly onRename: (title: string) => Promise<ReaderNoteRenameOutcome>;
  readonly onCancel: () => void; readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(props.currentTitle), [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const activeRef = useRef(false), sequenceRef = useRef(0), ownerRef = useRef(props.ownerIdentity);
  const inputRef = useRef<HTMLInputElement>(null), dialogRef = useRef<HTMLElement>(null), restoreFocusRef = useRef(false); ownerRef.current = props.ownerIdentity;
  useEffect(() => { sequenceRef.current += 1; activeRef.current = false; setDraft(props.currentTitle); setPending(false); setFailed(false); restoreFocusRef.current = false; inputRef.current?.select(); }, [props.ownerIdentity]);
  const scheduleRestoreFocus = (): void => {
    if (!restoreFocusRef.current) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      restoreFocusRef.current = false;
      inputRef.current?.focus({ preventScroll: true });
    }));
  };
  const title = canonicalNoteTitle(draft), valid = Boolean(title && title !== props.currentTitle && title.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(title));
  const cancel = (): void => { if (activeRef.current) return; props.onCancel(); window.requestAnimationFrame(() => props.returnFocusRef.current?.focus({ preventScroll: true })); };
  const submit = async (): Promise<void> => {
    if (activeRef.current || !valid) return; activeRef.current = true; const sequence = ++sequenceRef.current, owner = props.ownerIdentity; setPending(true); setFailed(false);
    try { const outcome = await props.onRename(title); if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (outcome.status === "committed") { props.onCommitted(outcome.render); return; } setFailed(true); restoreFocusRef.current = true;
    } catch { if (sequence === sequenceRef.current && owner === ownerRef.current) { setFailed(true); restoreFocusRef.current = true; } }
    finally { if (sequence === sequenceRef.current && owner === ownerRef.current) { activeRef.current = false; setPending(false); scheduleRestoreFocus(); } }
  };
  return <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true"
    aria-labelledby="reader-note-rename-title" aria-describedby="reader-note-rename-description" aria-busy={pending}
    onKeyDown={(event) => { if (event.key === "Escape" && !pending) { event.preventDefault(); cancel(); return; } if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []), first = controls[0], last = controls.at(-1);
      if (!first || !last) return event.preventDefault(); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <div className="confirmation-copy"><h2 id="reader-note-rename-title">{props.labels.title}</h2><p id="reader-note-rename-description">{props.labels.description}</p></div>
    <label>{props.labels.field}<input ref={inputRef} value={draft} maxLength={120} disabled={pending} aria-invalid={failed}
      onInput={(event) => { setDraft(event.currentTarget.value); setFailed(false); }} /></label>
    {failed ? <p className="error" role="alert">{props.labels.failed}</p> : null}
    <div className="confirmation-actions"><button type="button" className="secondary" disabled={pending} onClick={cancel}>{props.labels.cancel}</button>
      <button type="button" className="primary" disabled={pending || !valid} onClick={() => void submit()}>{pending ? props.labels.pending : props.labels.confirm}</button></div>
  </section></div>;
}

function identityMatches(request: NoteRenameRequest, result: NoteRenameResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.title === request.title;
}
function requestMatchesNote(request: NoteRenameRequest, note: NoteRenderResult | null | undefined): boolean {
  return note?.summary.pageId === request.currentPageId && note.renderContextId === request.renderContextId && note.renameEligibility?.revision === request.expectedRevision;
}
