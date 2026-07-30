import { useEffect, useRef, useState, type RefObject } from "react";
import type { NoteRelateRequest, NoteRelateResult, NoteRenderResult } from "@pige/contracts";
import type { ReaderNoteMergeTarget } from "./ReaderNoteMergeDialog";

export type ReaderNoteRelateOutcome =
  | { readonly status: "committed"; readonly render: NoteRenderResult }
  | { readonly status: "retained" };

export interface ReaderNoteRelateLabels {
  readonly title: string;
  readonly description: string;
  readonly target: string;
  readonly loading: string;
  readonly empty: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly pending: string;
  readonly failed: string;
}

export interface ReaderNoteRelateSubmit {
  readonly activeVaultId: string;
  readonly currentPageId: string;
  readonly renderContextId: string;
  readonly expectedRevision: string;
  readonly execute: (request: NoteRelateRequest) => Promise<NoteRelateResult>;
  readonly isCurrent?: () => boolean;
}

export async function submitReaderNoteRelation(
  binding: ReaderNoteRelateSubmit,
  target: ReaderNoteMergeTarget
): Promise<ReaderNoteRelateOutcome> {
  const request: NoteRelateRequest = {
    apiVersion: 1,
    requestId: `noterelatereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: binding.activeVaultId,
    currentPageId: binding.currentPageId,
    renderContextId: binding.renderContextId,
    expectedRevision: binding.expectedRevision,
    targetPageId: target.pageId,
    expectedTargetUpdatedAt: target.updatedAt,
  };
  try {
    const result = await binding.execute(request);
    if (
      binding.isCurrent?.() === false ||
      !noteRelateIdentityMatches(request, result) ||
      result.status !== "committed" ||
      result.render.summary.pageId !== request.currentPageId ||
      result.render.summary.pageType !== "note"
    ) return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch {
    return { status: "retained" };
  }
}

export function readerNoteRelateLabels(t: (key: string) => string): ReaderNoteRelateLabels {
  return {
    title: t("note.relate.title"), description: t("note.relate.description"), target: t("note.relate.target"),
    loading: t("note.relate.loading"), empty: t("note.relate.empty"), cancel: t("note.relate.cancel"),
    confirm: t("note.relate.confirm"), pending: t("note.relate.pending"), failed: t("note.relate.failed"),
  };
}

function noteRelateIdentityMatches(request: NoteRelateRequest, result: NoteRelateResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.targetPageId === request.targetPageId &&
    result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}

export function ReaderNoteRelateDialog(props: {
  readonly ownerIdentity: string;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly labels: ReaderNoteRelateLabels;
  readonly onLoadTargets: () => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onRelate: (target: ReaderNoteMergeTarget) => Promise<ReaderNoteRelateOutcome>;
  readonly onCancel: () => void;
  readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [targets, setTargets] = useState<readonly ReaderNoteMergeTarget[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "failed" | "pending">("loading");
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const requestActiveRef = useRef(false);
  const sequenceRef = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  ownerIdentityRef.current = props.ownerIdentity;

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    const ownerIdentity = props.ownerIdentity;
    void props.onLoadTargets().then((loaded) => {
      if (sequence !== sequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      setTargets(loaded);
      setSelectedPageId(loaded[0]?.pageId ?? "");
      setState("ready");
      window.requestAnimationFrame(() => (loaded.length > 0 ? selectRef.current : cancelRef.current)?.focus({ preventScroll: true }));
    }).catch(() => {
      if (sequence !== sequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      setState("failed");
      window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    });
    return () => { sequenceRef.current += 1; };
  }, [props.ownerIdentity]);

  const cancel = (): void => {
    if (requestActiveRef.current) return;
    props.onCancel();
    window.requestAnimationFrame(() => props.returnFocusRef.current?.focus({ preventScroll: true }));
  };

  const submit = async (): Promise<void> => {
    if (requestActiveRef.current || (state !== "ready" && state !== "failed")) return;
    const target = targets.find((candidate) => candidate.pageId === selectedPageId);
    if (!target) return;
    requestActiveRef.current = true;
    const sequence = ++sequenceRef.current;
    const ownerIdentity = props.ownerIdentity;
    setState("pending");
    try {
      const outcome = await props.onRelate(target);
      if (sequence !== sequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      if (outcome.status === "committed") {
        props.onCommitted(outcome.render);
        return;
      }
      setState("failed");
      window.requestAnimationFrame(() => selectRef.current?.focus({ preventScroll: true }));
    } catch {
      if (sequence === sequenceRef.current && ownerIdentity === ownerIdentityRef.current) {
        setState("failed");
        window.requestAnimationFrame(() => selectRef.current?.focus({ preventScroll: true }));
      }
    } finally {
      if (sequence === sequenceRef.current && ownerIdentity === ownerIdentityRef.current) requestActiveRef.current = false;
    }
  };

  const pending = state === "pending";
  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reader-note-relate-title"
        aria-describedby="reader-note-relate-description"
        aria-busy={state === "loading" || pending}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) {
            event.preventDefault();
            cancel();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)") ?? []);
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
          <h2 id="reader-note-relate-title">{props.labels.title}</h2>
          <p id="reader-note-relate-description">{props.labels.description}</p>
          {state === "loading" ? <p role="status">{props.labels.loading}</p> : null}
          {targets.length > 0 ? (
            <label>
              <span>{props.labels.target}</span>
              <select
                ref={selectRef}
                value={selectedPageId}
                disabled={pending}
                onChange={(event) => setSelectedPageId(event.currentTarget.value)}
              >
                {targets.map((target) => <option key={target.pageId} value={target.pageId}>{target.title}</option>)}
              </select>
            </label>
          ) : state === "ready" ? <p role="status">{props.labels.empty}</p> : null}
          {state === "failed" ? <p className="error" role="alert">{props.labels.failed}</p> : null}
        </div>
        <div className="confirmation-actions">
          <button ref={cancelRef} type="button" className="secondary" disabled={pending} onClick={cancel}>
            {props.labels.cancel}
          </button>
          <button type="button" className="primary" disabled={pending || state === "loading" || !selectedPageId} onClick={() => void submit()}>
            {pending ? props.labels.pending : props.labels.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
