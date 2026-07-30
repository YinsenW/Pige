import { useEffect, useRef, useState, type RefObject } from "react";
import type { NoteAddTagRequest, NoteAddTagResult, NoteRenderResult } from "@pige/contracts";

export interface ReaderNoteTagLabels {
  readonly title: string; readonly description: string; readonly field: string; readonly placeholder: string;
  readonly cancel: string; readonly confirm: string; readonly pending: string; readonly failed: string;
}
export type ReaderNoteTagOutcome = { readonly status: "committed"; readonly render: NoteRenderResult } | { readonly status: "retained" };
export type ReaderNoteTagSubmit = (request: NoteAddTagRequest) => Promise<NoteAddTagResult>;

export function readerNoteTagLabels(t: (key: string) => string): ReaderNoteTagLabels {
  return { title: t("note.tag.add"), description: t("note.tag.addDescription"), field: t("note.tag.field"), placeholder: t("note.tag.placeholder"),
    cancel: t("note.tag.cancel"), confirm: t("note.tag.confirm"), pending: t("note.tag.adding"), failed: t("note.tag.failed") };
}

export function canonicalNoteTag(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export async function submitReaderNoteTag(input: {
  readonly note: NoteRenderResult | null | undefined; readonly activeVaultId: string | null | undefined;
  readonly tag: string; readonly submit: ReaderNoteTagSubmit | null | undefined;
  readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderNoteTagOutcome> {
  const tag = canonicalNoteTag(input.tag); const eligibility = input.note?.tagging; const renderContextId = input.note?.renderContextId;
  if (!input.note || input.note.summary.status !== "active" || !eligibility?.canAdd || !input.activeVaultId || !renderContextId || !input.submit ||
    !tag || tag.length > 48 || /[\u0000-\u001f\u007f]/u.test(tag) || eligibility.tags.includes(tag)) return { status: "retained" };
  const request: NoteAddTagRequest = { apiVersion: 1, requestId: `noteaddtagreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId, currentPageId: input.note.summary.pageId, renderContextId, expectedRevision: eligibility.revision, tag };
  try {
    const result = await input.submit(request); const current = input.currentNote?.();
    if (result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId || result.currentPageId !== request.currentPageId ||
      result.renderContextId !== request.renderContextId || result.expectedRevision !== request.expectedRevision || result.tag !== request.tag ||
      (current && (current.summary.pageId !== request.currentPageId || current.renderContextId !== request.renderContextId || current.tagging?.revision !== request.expectedRevision)) ||
      result.status !== "committed" || result.render.summary.pageId !== request.currentPageId || !result.render.tagging?.tags.includes(request.tag)) return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch { return { status: "retained" }; }
}

export function ReaderNoteTagDialog(props: {
  readonly ownerIdentity: string; readonly existingTags: readonly string[]; readonly labels: ReaderNoteTagLabels;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>; readonly onAdd: (tag: string) => Promise<ReaderNoteTagOutcome>;
  readonly onCancel: () => void; readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(""); const [pending, setPending] = useState(false); const [failed, setFailed] = useState(false);
  const activeRef = useRef(false); const sequenceRef = useRef(0); const ownerRef = useRef(props.ownerIdentity); const inputRef = useRef<HTMLInputElement>(null); const dialogRef = useRef<HTMLElement>(null);
  ownerRef.current = props.ownerIdentity;
  useEffect(() => { sequenceRef.current += 1; activeRef.current = false; setDraft(""); setPending(false); setFailed(false); inputRef.current?.focus({ preventScroll: true }); }, [props.ownerIdentity]);
  const tag = canonicalNoteTag(draft); const valid = Boolean(tag && tag.length <= 48 && !/[\u0000-\u001f\u007f]/u.test(tag) && !props.existingTags.includes(tag));
  const cancel = (): void => { if (activeRef.current) return; props.onCancel(); window.requestAnimationFrame(() => props.returnFocusRef.current?.focus({ preventScroll: true })); };
  const submit = async (): Promise<void> => {
    if (activeRef.current || !valid) return; activeRef.current = true; const sequence = ++sequenceRef.current; const owner = props.ownerIdentity; setPending(true); setFailed(false);
    try { const outcome = await props.onAdd(tag); if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (outcome.status === "committed") { props.onCommitted(outcome.render); return; } setFailed(true); inputRef.current?.focus({ preventScroll: true });
    } catch { if (sequence === sequenceRef.current && owner === ownerRef.current) { setFailed(true); inputRef.current?.focus({ preventScroll: true }); } }
    finally { if (sequence === sequenceRef.current && owner === ownerRef.current) { activeRef.current = false; setPending(false); } }
  };
  return <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="reader-note-tag-title" aria-describedby="reader-note-tag-description" aria-busy={pending}
    onKeyDown={(event) => { if (event.key === "Escape" && !pending) { event.preventDefault(); cancel(); return; } if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []); const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return event.preventDefault(); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <div className="confirmation-copy"><h2 id="reader-note-tag-title">{props.labels.title}</h2><p id="reader-note-tag-description">{props.labels.description}</p></div>
    <label>{props.labels.field}<input ref={inputRef} value={draft} maxLength={48} placeholder={props.labels.placeholder} disabled={pending} aria-invalid={failed}
      onChange={(event) => { setDraft(event.currentTarget.value); setFailed(false); }} /></label>
    {failed ? <p className="error" role="alert">{props.labels.failed}</p> : null}
    <div className="confirmation-actions"><button type="button" className="secondary" disabled={pending} onClick={cancel}>{props.labels.cancel}</button>
      <button type="button" className="primary" disabled={pending || !valid} onClick={() => void submit()}>{pending ? props.labels.pending : props.labels.confirm}</button></div>
  </section></div>;
}
