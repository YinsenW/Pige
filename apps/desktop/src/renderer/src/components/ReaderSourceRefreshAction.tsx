import { useEffect, useRef, useState } from "react";
import type {
  NoteRenderResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult
} from "@pige/contracts";

type ChangedPreview = Extract<SourceRefreshPreviewResult, { readonly status: "changed" }>["preview"];
type Notice = "unchanged" | "refreshed" | "refreshedConflict" | "stale" | "ineligible" | "unavailable" | "failed";

export function ReaderSourceRefreshAction(props: {
  readonly activeVaultId?: string;
  readonly currentPageId: string;
  readonly renderContextId?: string;
  readonly sourceIds: readonly string[];
  readonly sourceLabel: (number: number) => string;
  readonly t: (key: string) => string;
  readonly onPreview?: (request: SourceRefreshPreviewRequest) => Promise<SourceRefreshPreviewResult>;
  readonly onConfirm?: (request: SourceRefreshConfirmRequest) => Promise<SourceRefreshConfirmResult>;
  readonly onRender?: (pageId: string) => Promise<NoteRenderResult>;
  readonly onRefreshed?: (render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  const identity = `${props.activeVaultId ?? ""}:${props.currentPageId}:${props.renderContextId ?? ""}`;
  const identityRef = useRef(identity);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ readonly sourceId: string; readonly value: ChangedPreview } | null>(null);
  const [notice, setNotice] = useState<{ readonly sourceId: string; readonly value: Notice } | null>(null);
  const [restoreFocusSourceId, setRestoreFocusSourceId] = useState<string | null>(null);

  useEffect(() => {
    identityRef.current = identity;
    setPendingSourceId(null);
    setPreview(null);
    setNotice(null);
    setRestoreFocusSourceId(null);
  }, [identity]);

  useEffect(() => {
    if (preview) cancelRef.current?.focus({ preventScroll: true });
  }, [preview]);

  useEffect(() => {
    if (!restoreFocusSourceId || pendingSourceId !== null || preview !== null) return;
    restoreTriggerFocus(restoreFocusSourceId, triggerRefs);
    setRestoreFocusSourceId(null);
  }, [pendingSourceId, preview, restoreFocusSourceId]);

  if (!props.activeVaultId || !props.renderContextId || props.sourceIds.length === 0 ||
    !props.onPreview || !props.onConfirm) return null;

  const check = async (sourceId: string): Promise<void> => {
    if (pendingSourceId) return;
    const startedIdentity = identity;
    setPendingSourceId(sourceId);
    setPreview(null);
    setNotice(null);
    const request = {
      apiVersion: 1 as const,
      requestId: `sourcerefreshreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId!,
      currentPageId: props.currentPageId,
      renderContextId: props.renderContextId!,
      sourceId
    };
    try {
      const result = await props.onPreview!(request);
      if (identityRef.current !== startedIdentity || !sameRequestIdentity(request, result)) return;
      if (result.status === "changed") setPreview({ sourceId, value: result.preview });
      else setNotice({ sourceId, value: toNotice(result.status) });
    } catch {
      if (identityRef.current === startedIdentity) setNotice({ sourceId, value: "failed" });
    } finally {
      if (identityRef.current === startedIdentity) setPendingSourceId(null);
    }
  };

  const confirm = async (): Promise<void> => {
    if (!preview || pendingSourceId) return;
    const startedIdentity = identity;
    const { sourceId, value } = preview;
    setPendingSourceId(sourceId);
    const request = {
      apiVersion: 1 as const,
      requestId: `sourcerefreshreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId!,
      currentPageId: props.currentPageId,
      renderContextId: props.renderContextId!,
      sourceId,
      previewId: value.previewId,
      expectedSourceRevision: value.expectedSourceRevision
    };
    try {
      const result = await props.onConfirm!(request);
      if (identityRef.current !== startedIdentity || !sameConfirmResult(request, result)) return;
      setPreview(null);
      setNotice({ sourceId, value: result.status === "refreshed"
        ? (result.sourcePageConflict ? "refreshedConflict" : "refreshed")
        : toNotice(result.status) });
      setRestoreFocusSourceId(sourceId);
      if (result.status === "refreshed" && props.onRender && props.onRefreshed) {
        const render = await props.onRender(props.currentPageId);
        if (identityRef.current === startedIdentity) props.onRefreshed(render);
      }
    } catch {
      if (identityRef.current === startedIdentity) setNotice({ sourceId, value: "failed" });
    } finally {
      if (identityRef.current === startedIdentity) setPendingSourceId(null);
    }
  };

  return (
    <div aria-label={props.t("note.refreshSource.region")}>
      {props.sourceIds.map((sourceId, index) => (
        <div key={sourceId}>
          <button type="button" className="reader-source-action" disabled={pendingSourceId !== null}
            ref={(element) => { if (element) triggerRefs.current.set(sourceId, element); else triggerRefs.current.delete(sourceId); }}
            data-reader-source-refresh={sourceId}
            aria-busy={pendingSourceId === sourceId} onClick={() => void check(sourceId)}>
            {props.t(pendingSourceId === sourceId ? "note.refreshSource.checking" : "note.refreshSource.action")}
            {` · ${props.sourceLabel(index + 1)}`}
          </button>
          {notice?.sourceId === sourceId ? (
            <span role={notice.value === "failed" || notice.value === "unavailable" ? "alert" : "status"}>
              {props.t(`note.refreshSource.${notice.value}`)}
            </span>
          ) : null}
        </div>
      ))}
      {preview ? (
        <div className="confirmation-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true"
          aria-labelledby="source-refresh-title" aria-describedby="source-refresh-description"
          aria-busy={pendingSourceId !== null} className="confirmation-dialog"
          onKeyDown={(event) => {
            if (event.key === "Escape" && pendingSourceId === null) {
              event.preventDefault(); closePreview(preview.sourceId, setPreview, triggerRefs); return;
            }
            if (event.key !== "Tab") return;
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const first = controls[0]; const last = controls.at(-1);
            if (!first || !last) return event.preventDefault();
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }}>
          <div className="confirmation-copy"><h2 id="source-refresh-title">{props.t("note.refreshSource.confirmTitle")}</h2>
          <p id="source-refresh-description">{preview.value.displayName}</p>
          <p>{props.t("note.refreshSource.changeSummary")
            .replace("{before}", formatBytes(preview.value.previousSize))
            .replace("{after}", formatBytes(preview.value.currentSize))}</p>
          <p>{props.t(preview.value.refreshesSourcePage
            ? "note.refreshSource.effectSummary"
            : "note.refreshSource.effectSummaryNoPage")
            .replace("{count}", String(preview.value.affectedArtifactCount))}</p></div>
          <div className="confirmation-actions"><button ref={cancelRef} type="button" className="secondary"
            disabled={pendingSourceId !== null} onClick={() => closePreview(preview.sourceId, setPreview, triggerRefs)}>
            {props.t("note.refreshSource.cancel")}</button>
          <button type="button" className="primary" disabled={pendingSourceId !== null}
            onClick={() => void confirm()}>{props.t("note.refreshSource.confirm")}</button></div>
        </section></div>
      ) : null}
    </div>
  );
}

function closePreview(
  sourceId: string,
  setPreview: React.Dispatch<React.SetStateAction<{ readonly sourceId: string; readonly value: ChangedPreview } | null>>,
  triggerRefs: React.RefObject<Map<string, HTMLButtonElement>>
): void {
  setPreview(null);
  restoreTriggerFocus(sourceId, triggerRefs);
}

function restoreTriggerFocus(sourceId: string, triggerRefs: React.RefObject<Map<string, HTMLButtonElement>>): void {
  triggerRefs.current?.get(sourceId)?.focus({ preventScroll: true });
}

function sameRequestIdentity(
  request: Pick<SourceRefreshPreviewRequest, "requestId" | "activeVaultId" | "currentPageId" | "renderContextId" | "sourceId">,
  result: Pick<SourceRefreshPreviewResult, "requestId" | "activeVaultId" | "currentPageId" | "renderContextId" | "sourceId">
): boolean {
  return request.requestId === result.requestId && request.activeVaultId === result.activeVaultId &&
    request.currentPageId === result.currentPageId && request.renderContextId === result.renderContextId &&
    request.sourceId === result.sourceId;
}

function sameConfirmResult(request: SourceRefreshConfirmRequest, result: SourceRefreshConfirmResult): boolean {
  return sameRequestIdentity(request, result) && request.previewId === result.previewId;
}

function toNotice(status: Exclude<SourceRefreshPreviewResult["status"] | SourceRefreshConfirmResult["status"], "changed" | "refreshed">): Notice {
  return status === "not_found" ? "stale" : status;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
