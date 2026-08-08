import { useRef, useState, type DragEvent } from "react";
import type { CaptureFileRejection, CaptureFileRejectionReason } from "@pige/contracts";

const ACCEPTED_FILE_TYPES = ".md,.markdown,.txt,.pdf,.docx,.pptx,.csv,.xlsx,.zip,.sqlite,.sqlite3,.db,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,text/plain,text/markdown,image/*";

export type HomeCaptureBatchStatus = {
  readonly status: "submitting" | "queued" | "partially_queued" | "rejected" | "failed";
  readonly queuedCount: number;
  readonly rejectedFiles: readonly CaptureFileRejection[];
};

export function settleHomeCaptureBatch(
  queuedCount: number,
  rejectedFiles: readonly CaptureFileRejection[],
  failed: boolean
): HomeCaptureBatchStatus {
  if (failed && !(queuedCount === 0 && rejectedFiles.length > 0)) {
    return { status: "failed", queuedCount, rejectedFiles };
  }
  return {
    status: queuedCount === 0 ? "rejected" : rejectedFiles.length > 0 ? "partially_queued" : "queued",
    queuedCount,
    rejectedFiles
  };
}

export function attachmentRejectionMessageKey(reason: CaptureFileRejectionReason): string {
  switch (reason) {
    case "empty_path": return "home.attachmentRejection.emptyPath";
    case "missing": return "home.attachmentRejection.missing";
    case "not_regular_file": return "home.attachmentRejection.notRegularFile";
    case "unsupported_type": return "home.attachmentRejection.unsupportedType";
    case "duplicate": return "home.attachmentRejection.duplicate";
    case "too_many_files": return "home.attachmentRejection.tooManyFiles";
    case "file_too_large": return "home.attachmentRejection.fileTooLarge";
    case "total_size_exceeded": return "home.attachmentRejection.totalSizeExceeded";
    case "copy_failed": return "home.attachmentRejection.copyFailed";
  }
}

export function HomeCaptureDropZone(props: {
  readonly disabled: boolean;
  readonly status: HomeCaptureBatchStatus | null;
  readonly onPick: (files: readonly File[]) => void;
  readonly onDrop: (files: readonly File[]) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const choose = (): void => { if (!props.disabled) inputRef.current?.click(); };
  const drop = (event: DragEvent<HTMLButtonElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (props.disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) props.onDrop(files);
  };
  const rejectedCount = props.status?.rejectedFiles.length ?? 0;

  return (
    <section className="home-capture-drop-entry" aria-label={props.t("home.captureDropZone")}>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        disabled={props.disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) props.onPick(files);
        }}
      />
      <button
        className={`home-capture-drop-trigger${dragActive ? " active" : ""}`}
        type="button"
        disabled={props.disabled}
        aria-label={props.t("home.attachToMessage")}
        aria-describedby="home-capture-drop-hint"
        onClick={choose}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={drop}
      >
        <strong>{props.t("home.captureDropZone")}</strong>
        <small id="home-capture-drop-hint">{props.t("home.captureDropZoneHint")}</small>
      </button>
      {props.status ? (
        <section
          className={`attachment-submission-notice capture-batch-result ${props.status.status}`}
          role={props.status.status === "failed" ? "alert" : "status"}
          aria-live={props.status.status === "failed" ? "assertive" : "polite"}
          aria-atomic="true"
          aria-busy={props.status.status === "submitting" || undefined}
        >
          <strong>{props.t(props.status.status === "submitting"
            ? "home.captureBatchSubmitting"
            : props.status.status === "failed"
              ? "home.captureBatchFailed"
              : props.status.status === "partially_queued"
                ? "home.attachmentsPartiallyAccepted"
                : props.status.status === "rejected"
                  ? "home.attachmentsRejected"
                  : "home.captureBatchComplete")}</strong>
          {props.status.status !== "submitting" ? (
            <p>{props.t("home.captureBatchCounts")
              .replace("{queued}", String(props.status.queuedCount))
              .replace("{rejected}", String(rejectedCount))}</p>
          ) : null}
          {props.status.rejectedFiles.length > 0 ? (
            <ul>
              {props.status.rejectedFiles.map((rejection, index) => (
                <li key={`${rejection.displayName}-${rejection.reason}-${index}`}>
                  <span>{rejection.displayName}</span>
                  <small>{props.t(attachmentRejectionMessageKey(rejection.reason))}</small>
                </li>
              ))}
            </ul>
          ) : null}
          {props.status.status === "failed" || props.status.status === "rejected" || props.status.status === "partially_queued" ? (
            <button type="button" className="secondary" disabled={props.disabled} onClick={choose}>
              {props.t("home.captureChooseAgain")}
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
