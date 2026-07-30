import { useEffect, useRef } from "react";

export interface SourceRelinkChangedPreview {
  readonly displayName: string;
  readonly previousSize: number;
  readonly currentSize: number;
  readonly affectedArtifactCount: number;
  readonly refreshesSourcePage: boolean;
}

export function SourceRelinkChangedDialog(props: {
  readonly preview: SourceRelinkChangedPreview;
  readonly pending: boolean;
  readonly t: (key: string) => string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
  return <div className="confirmation-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true"
    aria-labelledby="source-relink-changed-title" aria-describedby="source-relink-changed-description"
    aria-busy={props.pending} className="confirmation-dialog" onKeyDown={(event) => {
      if (event.key === "Escape" && !props.pending) { event.preventDefault(); props.onCancel(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return event.preventDefault();
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <div className="confirmation-copy">
      <h2 id="source-relink-changed-title">{props.t("sourceRelinkChanged.title")}</h2>
      <p id="source-relink-changed-description">{props.preview.displayName}</p>
      <p>{props.t("sourceRelinkChanged.changeSummary")
        .replace("{before}", formatBytes(props.preview.previousSize))
        .replace("{after}", formatBytes(props.preview.currentSize))}</p>
      <p>{props.t(props.preview.refreshesSourcePage
        ? "sourceRelinkChanged.effectSummary"
        : "sourceRelinkChanged.effectSummaryNoPage")
        .replace("{count}", String(props.preview.affectedArtifactCount))}</p>
    </div>
    <div className="confirmation-actions">
      <button ref={cancelRef} type="button" className="secondary" disabled={props.pending}
        onClick={props.onCancel}>{props.t("sourceRelinkChanged.cancel")}</button>
      <button type="button" className="primary" disabled={props.pending}
        onClick={props.onConfirm}>{props.t("sourceRelinkChanged.confirm")}</button>
    </div>
  </section></div>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
