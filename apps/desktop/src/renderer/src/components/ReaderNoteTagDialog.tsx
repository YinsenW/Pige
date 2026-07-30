import { useEffect, useRef, useState, type RefObject } from "react";
import type { NoteEditTaxonomyRequest, NoteEditTaxonomyResult, NoteRenderResult } from "@pige/contracts";

export interface ReaderNoteTagLabels {
  readonly title: string; readonly description: string; readonly tagsField: string; readonly tagsPlaceholder: string;
  readonly topicsField: string; readonly topicsPlaceholder: string; readonly cancel: string; readonly confirm: string;
  readonly pending: string; readonly failed: string;
}
export type ReaderNoteTagOutcome = { readonly status: "committed"; readonly render: NoteRenderResult } | { readonly status: "retained" };
export type ReaderNoteTagSubmit = (request: NoteEditTaxonomyRequest) => Promise<NoteEditTaxonomyResult>;

export function readerNoteTagLabels(t: (key: string) => string): ReaderNoteTagLabels {
  return {
    title: t("note.taxonomy.edit"), description: t("note.taxonomy.description"),
    tagsField: t("note.taxonomy.tags"), tagsPlaceholder: t("note.taxonomy.tagsPlaceholder"),
    topicsField: t("note.taxonomy.topics"), topicsPlaceholder: t("note.taxonomy.topicsPlaceholder"),
    cancel: t("note.tag.cancel"), confirm: t("note.taxonomy.confirm"), pending: t("note.taxonomy.saving"),
    failed: t("note.taxonomy.failed")
  };
}

export function canonicalNoteTag(value: string): string { return value.normalize("NFKC").replace(/\s+/gu, " ").trim(); }
function parseDraft(value: string): string[] { return value.split(",").map(canonicalNoteTag).filter(Boolean); }
function validEntries(values: readonly string[], max: number, length: number): boolean {
  return values.length <= max && values.every((value) => value.length <= length && !/[\u0000-\u001f\u007f]/u.test(value)) &&
    new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size === values.length;
}

export async function submitReaderNoteTag(input: {
  readonly note: NoteRenderResult | null | undefined; readonly activeVaultId: string | null | undefined;
  readonly tags: readonly string[]; readonly topics: readonly string[]; readonly submit: ReaderNoteTagSubmit | null | undefined;
  readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderNoteTagOutcome> {
  const eligibility = input.note?.tagging, renderContextId = input.note?.renderContextId;
  if (!input.note || input.note.summary.pageType !== "note" || input.note.summary.status !== "active" || !eligibility?.canEdit ||
    !input.activeVaultId || !renderContextId || !input.submit || !validEntries(input.tags, 12, 48) || !validEntries(input.topics, 8, 80)) return { status: "retained" };
  const request: NoteEditTaxonomyRequest = {
    apiVersion: 1, requestId: `notetaxonomyreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId, currentPageId: input.note.summary.pageId, renderContextId,
    expectedRevision: eligibility.revision, tags: [...input.tags], topics: [...input.topics]
  };
  try {
    const result = await input.submit(request), current = input.currentNote?.();
    if (result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId || result.currentPageId !== request.currentPageId ||
      result.renderContextId !== request.renderContextId || result.expectedRevision !== request.expectedRevision ||
      (current && (current.summary.pageId !== request.currentPageId || current.renderContextId !== request.renderContextId || current.tagging?.revision !== request.expectedRevision)) ||
      result.status !== "committed" || result.render.summary.pageId !== request.currentPageId ||
      JSON.stringify(result.render.tagging?.tags) !== JSON.stringify(request.tags) || JSON.stringify(result.render.tagging?.topics) !== JSON.stringify(request.topics)) return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch { return { status: "retained" }; }
}

export function ReaderNoteTagDialog(props: {
  readonly ownerIdentity: string; readonly existingTags: readonly string[]; readonly existingTopics: readonly string[];
  readonly labels: ReaderNoteTagLabels; readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onEdit: (tags: readonly string[], topics: readonly string[]) => Promise<ReaderNoteTagOutcome>;
  readonly onCancel: () => void; readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [tagsDraft, setTagsDraft] = useState(props.existingTags.join(", "));
  const [topicsDraft, setTopicsDraft] = useState(props.existingTopics.join(", "));
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const activeRef = useRef(false), sequenceRef = useRef(0), ownerRef = useRef(props.ownerIdentity);
  const inputRef = useRef<HTMLInputElement>(null), dialogRef = useRef<HTMLElement>(null); ownerRef.current = props.ownerIdentity;
  useEffect(() => { sequenceRef.current += 1; activeRef.current = false; setTagsDraft(props.existingTags.join(", ")); setTopicsDraft(props.existingTopics.join(", ")); setPending(false); setFailed(false); inputRef.current?.focus({ preventScroll: true }); }, [props.ownerIdentity]);
  const tags = parseDraft(tagsDraft), topics = parseDraft(topicsDraft);
  const changed = JSON.stringify(tags) !== JSON.stringify(props.existingTags) || JSON.stringify(topics) !== JSON.stringify(props.existingTopics);
  const valid = changed && validEntries(tags, 12, 48) && validEntries(topics, 8, 80);
  const cancel = (): void => { if (activeRef.current) return; props.onCancel(); window.requestAnimationFrame(() => props.returnFocusRef.current?.focus({ preventScroll: true })); };
  const submit = async (): Promise<void> => {
    if (activeRef.current || !valid) return; activeRef.current = true; const sequence = ++sequenceRef.current, owner = props.ownerIdentity; setPending(true); setFailed(false);
    try { const outcome = await props.onEdit(tags, topics); if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (outcome.status === "committed") { props.onCommitted(outcome.render); return; } setFailed(true); inputRef.current?.focus({ preventScroll: true });
    } catch { if (sequence === sequenceRef.current && owner === ownerRef.current) { setFailed(true); inputRef.current?.focus({ preventScroll: true }); } }
    finally { if (sequence === sequenceRef.current && owner === ownerRef.current) { activeRef.current = false; setPending(false); } }
  };
  return <div className="confirmation-backdrop"><section ref={dialogRef} className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="reader-note-tag-title" aria-describedby="reader-note-tag-description" aria-busy={pending}
    onKeyDown={(event) => { if (event.key === "Escape" && !pending) { event.preventDefault(); cancel(); return; } if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []), first = controls[0], last = controls.at(-1);
      if (!first || !last) return event.preventDefault(); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
    <div className="confirmation-copy"><h2 id="reader-note-tag-title">{props.labels.title}</h2><p id="reader-note-tag-description">{props.labels.description}</p></div>
    <label>{props.labels.tagsField}<input ref={inputRef} value={tagsDraft} placeholder={props.labels.tagsPlaceholder} disabled={pending} aria-invalid={failed}
      onInput={(event) => { setTagsDraft(event.currentTarget.value); setFailed(false); }} /></label>
    <label>{props.labels.topicsField}<input value={topicsDraft} placeholder={props.labels.topicsPlaceholder} disabled={pending} aria-invalid={failed}
      onInput={(event) => { setTopicsDraft(event.currentTarget.value); setFailed(false); }} /></label>
    {failed ? <p className="error" role="alert">{props.labels.failed}</p> : null}
    <div className="confirmation-actions"><button type="button" className="secondary" disabled={pending} onClick={cancel}>{props.labels.cancel}</button>
      <button type="button" className="primary" disabled={pending || !valid} onClick={() => void submit()}>{pending ? props.labels.pending : props.labels.confirm}</button></div>
  </section></div>;
}
