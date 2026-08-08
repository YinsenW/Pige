import { useEffect, useRef, useState, type RefObject } from "react";
import type { NoteAliasChangeRequest, NoteAliasChangeResult, NoteRenderResult } from "@pige/contracts";

export interface ReaderNoteAliasLabels { readonly action: string; readonly title: string; readonly description: string;
  readonly field: string; readonly add: string; readonly remove: string; readonly cancel: string; readonly pending: string;
  readonly empty: string; readonly failed: string; }
export type ReaderNoteAliasOutcome = { readonly status: "committed"; readonly render: NoteRenderResult } | { readonly status: "retained" };
export type ReaderNoteAliasSubmit = (request: NoteAliasChangeRequest) => Promise<NoteAliasChangeResult>;

export function readerNoteAliasLabels(t: (key: string) => string): ReaderNoteAliasLabels { return {
  action: t("note.alias.action"), title: t("note.alias.title"), description: t("note.alias.description"),
  field: t("note.alias.field"), add: t("note.alias.add"), remove: t("note.alias.remove"), cancel: t("note.alias.cancel"),
  pending: t("note.alias.pending"), empty: t("note.alias.empty"), failed: t("note.alias.failed") }; }
export function canonicalNoteAlias(value: string): string { return value.normalize("NFKC").replace(/\s+/gu, " ").trim(); }

export async function submitReaderNoteAliasChange(input: { readonly note: NoteRenderResult | null | undefined;
  readonly activeVaultId: string | null | undefined; readonly action: "add" | "remove"; readonly alias: string;
  readonly submit: ReaderNoteAliasSubmit | null | undefined; readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderNoteAliasOutcome> {
  const alias = canonicalNoteAlias(input.alias), eligibility = input.note?.aliasing, renderContextId = input.note?.renderContextId;
  if (!input.note || !isTaxonomyKnowledgePageType(input.note.summary.pageType) || input.note.summary.status !== "active" || !eligibility || !input.activeVaultId ||
    !renderContextId || !input.submit || !alias || alias.length > 120 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(alias) ||
    (input.action === "add" ? !eligibility.canAdd : !eligibility.canRemove)) return { status: "retained" };
  const request: NoteAliasChangeRequest = { apiVersion: 1, requestId: `notealiasreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId, currentPageId: input.note.summary.pageId, renderContextId,
    expectedRevision: eligibility.revision, action: input.action, alias };
  try {
    const result = await input.submit(request), current = input.currentNote?.();
    if (!identityMatches(request, result) || (current && !requestMatchesNote(request, current)) || result.status !== "committed" ||
      result.render.summary.pageId !== request.currentPageId || result.render.summary.pageType !== input.note.summary.pageType || !result.render.renderContextId) {
      return { status: "retained" };
    }
    return { status: "committed", render: result.render };
  } catch { return { status: "retained" }; }
}

function isTaxonomyKnowledgePageType(pageType: NoteRenderResult["summary"]["pageType"]): boolean {
  return pageType === "note" || pageType === "claim" || pageType === "question" || pageType === "concept" || pageType === "entity";
}

export function ReaderNoteAliasDialog(props: { readonly ownerIdentity: string; readonly aliases: readonly string[]; readonly canAdd: boolean;
  readonly labels: ReaderNoteAliasLabels; readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onChange: (action: "add" | "remove", alias: string) => Promise<ReaderNoteAliasOutcome>;
  readonly onCancel: () => void; readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(""), [pendingAlias, setPendingAlias] = useState<string | null>(null), [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null), dialogRef = useRef<HTMLElement>(null), sequenceRef = useRef(0), ownerRef = useRef(props.ownerIdentity);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusRef = useRef<{ readonly action: "add" | "remove"; readonly alias: string } | null>(null);
  ownerRef.current = props.ownerIdentity;
  useEffect(() => { sequenceRef.current += 1; setDraft(""); setPendingAlias(null); setFailed(false);
    restoreFocusRef.current = null;
    (props.canAdd ? inputRef.current : dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
  }, [props.ownerIdentity, props.canAdd]);
  const scheduleRestoreFocus = (): void => {
    const request = restoreFocusRef.current;
    if (!request) return;
    const restore = (): void => {
      const target = request.action === "remove" ? removeButtonRefs.current.get(request.alias) : inputRef.current;
      restoreFocusRef.current = null;
      target?.focus({ preventScroll: true });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(restore));
  };
  const alias = canonicalNoteAlias(draft), valid = Boolean(props.canAdd && alias && alias.length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(alias));
  const cancel = (): void => { if (pendingAlias) return; props.onCancel(); window.requestAnimationFrame(() => props.returnFocusRef.current?.focus({ preventScroll: true })); };
  const change = async (action: "add" | "remove", value: string): Promise<void> => {
    if (pendingAlias || (action === "add" && !valid)) return; const sequence = ++sequenceRef.current, owner = props.ownerIdentity;
    setPendingAlias(value); setFailed(false);
    try { const outcome = await props.onChange(action, value); if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (outcome.status === "committed") { props.onCommitted(outcome.render); return; }
      setFailed(true); restoreFocusRef.current = { action, alias: value };
    } catch { if (sequence === sequenceRef.current && owner === ownerRef.current) {
      setFailed(true); restoreFocusRef.current = { action, alias: value };
    } }
    finally { if (sequence === sequenceRef.current && owner === ownerRef.current) {
      setPendingAlias(null); scheduleRestoreFocus();
    } }
  };
  return <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true"
    aria-labelledby="reader-note-alias-title" aria-describedby="reader-note-alias-description" aria-busy={pendingAlias !== null}
    onKeyDown={(event) => { if (event.key === "Escape" && !pendingAlias) { event.preventDefault(); cancel(); return; } if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []), first = controls[0], last = controls.at(-1);
      if (!first || !last) return event.preventDefault(); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <div className="confirmation-copy"><h2 id="reader-note-alias-title">{props.labels.title}</h2><p id="reader-note-alias-description">{props.labels.description}</p></div>
    {props.aliases.length ? <div>{props.aliases.map((current) => <div className="settings-row" key={current}><span>{current}</span>
      <button type="button" className="secondary" ref={(element) => { if (element) removeButtonRefs.current.set(current, element); else removeButtonRefs.current.delete(current); }} disabled={pendingAlias !== null} onClick={() => void change("remove", current)}>
        {pendingAlias === current ? props.labels.pending : props.labels.remove}</button></div>)}</div> : <p>{props.labels.empty}</p>}
    <label>{props.labels.field}<input ref={inputRef} value={draft} maxLength={120} disabled={!props.canAdd || pendingAlias !== null} aria-invalid={failed}
      onChange={(event) => { setDraft(event.currentTarget.value); setFailed(false); }} /></label>
    {failed ? <p className="error" role="alert">{props.labels.failed}</p> : null}
    <div className="confirmation-actions"><button type="button" className="secondary" disabled={pendingAlias !== null} onClick={cancel}>{props.labels.cancel}</button>
      <button type="button" className="primary" disabled={!props.canAdd || pendingAlias !== null || !valid} onClick={() => void change("add", alias)}>
        {pendingAlias === alias ? props.labels.pending : props.labels.add}</button></div>
  </section></div>;
}

function identityMatches(request: NoteAliasChangeRequest, result: NoteAliasChangeResult): boolean { return result.requestId === request.requestId &&
  result.activeVaultId === request.activeVaultId && result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
  result.expectedRevision === request.expectedRevision && result.action === request.action && result.alias === request.alias; }
function requestMatchesNote(request: NoteAliasChangeRequest, note: NoteRenderResult | null | undefined): boolean { return note?.summary.pageId === request.currentPageId &&
  note.renderContextId === request.renderContextId && note.aliasing?.revision === request.expectedRevision; }
