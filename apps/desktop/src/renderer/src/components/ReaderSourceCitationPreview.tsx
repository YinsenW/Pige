import { useLayoutEffect, useRef } from "react";
import type { NoteResolveInlineReferenceResult } from "@pige/contracts";

export type ReaderSourceCitationPreviewValue = Extract<
  Extract<NoteResolveInlineReferenceResult, { status: "resolved" }>["target"],
  { kind: "source" }
>["preview"];

export function ReaderSourceCitationPreview(props: {
  readonly preview: NonNullable<ReaderSourceCitationPreviewValue>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    if (typeof root?.scrollIntoView === "function") root.scrollIntoView({ block: "nearest" });
  }, [props.preview.locator, props.preview.excerpt]);
  return (
    <aside
      ref={rootRef}
      className="reader-source-citation-preview"
      tabIndex={-1}
      aria-label={props.t("note.citationPreview")}
      data-citation-locator={props.preview.locator}
    >
      <strong>{props.t("note.citationPreview")}</strong>
      <span>{props.preview.locator}</span>
      <p>{props.preview.excerpt}{props.preview.truncated ? "..." : ""}</p>
    </aside>
  );
}
