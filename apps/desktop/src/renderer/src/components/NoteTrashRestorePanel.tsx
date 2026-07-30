import { useEffect, useRef, useState } from "react";
import type { NoteTrashSummary } from "@pige/contracts";
import type { Locale } from "@pige/schemas";

type RestoreNotice = "restored" | "stale" | "failed";

export function NoteTrashRestorePanel(props: {
  readonly activeVaultId: string | null;
  readonly locale: Locale;
  readonly onCommitted: (pageId: string) => Promise<boolean>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [notes, setNotes] = useState<readonly NoteTrashSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RestoreNotice | null>(null);
  const sequenceRef = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    setLoaded(false);
    setListFailed(false);
    setNotes([]);
    setNotice(null);
    const activeVaultId = props.activeVaultId;
    if (!activeVaultId) { setLoaded(true); return; }
    const requestId = `notetrashlistreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}` as const;
    void window.pige.notes.listTrash({
      apiVersion: 1,
      requestId,
      activeVaultId
    }).then((result) => {
      if (sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.activeVaultId !== activeVaultId || result.status !== "ready") {
        setListFailed(true);
      } else setNotes(result.notes);
      setLoaded(true);
    }).catch(() => {
      if (sequence === sequenceRef.current) { setListFailed(true); setLoaded(true); }
    });
  }, [props.activeVaultId, reloadKey]);

  const restore = async (note: NoteTrashSummary): Promise<void> => {
    const activeVaultId = props.activeVaultId;
    if (!activeVaultId || pendingId || !note.canRestore) return;
    const sequence = ++sequenceRef.current;
    const noteIndex = notes.findIndex((candidate) => candidate.trashOperationId === note.trashOperationId);
    let focusOperationId = note.trashOperationId;
    const requestId = `notetrashrestorereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}` as const;
    setPendingId(note.trashOperationId);
    setNotice(null);
    try {
      const result = await window.pige.notes.restoreTrash({
        apiVersion: 1,
        requestId,
        activeVaultId,
        pageId: note.pageId,
        trashOperationId: note.trashOperationId,
        expectedTrashRevision: note.expectedTrashRevision
      });
      const currentVault = await window.pige.vault.current();
      if (sequence !== sequenceRef.current || currentVault?.vaultId !== activeVaultId ||
        result.requestId !== requestId || result.activeVaultId !== activeVaultId ||
        result.pageId !== note.pageId || result.trashOperationId !== note.trashOperationId ||
        result.expectedTrashRevision !== note.expectedTrashRevision) return;
      if (result.status === "committed") {
        if (!result.render.renderContextId || result.render.summary.pageId !== note.pageId ||
          result.render.summary.pageType !== "note" || result.render.summary.status !== "active") {
          setNotice("failed");
          return;
        }
        focusOperationId = notes[noteIndex + 1]?.trashOperationId ?? notes[noteIndex - 1]?.trashOperationId ?? "";
        setNotes((current) => current.filter((item) => item.trashOperationId !== note.trashOperationId));
        setNotice(await props.onCommitted(note.pageId) ? "restored" : "failed");
      } else setNotice(result.status === "failed" ? "failed" : "stale");
    } catch {
      if (sequence === sequenceRef.current) setNotice("failed");
    } finally {
      if (sequence === sequenceRef.current) {
        setPendingId(null);
        const restoreFocus = (): void => {
          (triggerRefs.current.get(focusOperationId) ?? sectionRef.current)?.focus({ preventScroll: true });
        };
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreFocus);
        else window.setTimeout(restoreFocus, 0);
      }
    }
  };

  const dateLocale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  return <section ref={sectionRef} className="settings-section" aria-labelledby="activity-trash-title" tabIndex={-1}>
    <h2 className="settings-section-title" id="activity-trash-title">{props.t("activity.trashTitle")}</h2>
    {!loaded ? <p className="settings-note">{props.t("activity.trashLoading")}</p>
      : listFailed ? <div className="settings-state-copy">
        <p className="error" role="alert">{props.t("activity.trashLoadFailed")}</p>
        <button type="button" className="settings-button" onClick={() => setReloadKey((current) => current + 1)}>
          {props.t("activity.trashRetry")}
        </button>
      </div>
      : notes.length === 0 ? <p className="settings-note">{props.t("activity.trashEmpty")}</p>
        : <div className="settings-card">{notes.map((note) => <div className="settings-row" key={note.trashOperationId}
          data-restorable-note-id={note.pageId}>
          <div className="settings-row-copy"><strong>{note.title}</strong><span>{new Intl.DateTimeFormat(dateLocale, {
            dateStyle: "medium", timeStyle: "short"
          }).format(new Date(note.trashedAt))}</span></div>
          <button ref={(element) => { if (element) triggerRefs.current.set(note.trashOperationId, element);
            else triggerRefs.current.delete(note.trashOperationId); }} type="button" className="settings-button"
            disabled={pendingId !== null} aria-busy={pendingId === note.trashOperationId || undefined}
            aria-label={`${props.t("activity.restoreFromTrash")}: ${note.title}`}
            onClick={() => void restore(note)}>{props.t(pendingId === note.trashOperationId
              ? "activity.restoringFromTrash" : "activity.restoreFromTrash")}</button>
        </div>)}</div>}
    {notice ? <p className={notice === "restored" ? "settings-note" : "error"}
      role={notice === "restored" ? "status" : "alert"} aria-live="polite">
      {props.t(`activity.restoreFromTrash.${notice}`)}
    </p> : null}
  </section>;
}
