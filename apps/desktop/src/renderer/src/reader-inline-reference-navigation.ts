import type {
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult
} from "@pige/contracts";
import type { ReaderInlineReferenceActivation } from "./components/ReaderInlineReferenceSurface";

type SourcePreview = NonNullable<Extract<
  Extract<NoteResolveInlineReferenceResult, { status: "resolved" }>["target"],
  { kind: "source" }
>["preview"]>;

export async function resolveAndOpenInlineReference(
  request: NoteResolveInlineReferenceRequest,
  isCurrent: () => boolean,
  openPage: (pageId: string, preview?: SourcePreview) => Promise<boolean>
): Promise<ReaderInlineReferenceActivation> {
  try {
    const result = await window.pige.notes.resolveInlineReference(request);
    if (!isCurrent()) return "stale";
    if (result.requestId !== request.requestId) return "failed";
    if (result.status !== "resolved") return result.status;
    if (
      result.target.kind === "source" && result.target.locator &&
      (!result.target.preview || result.target.preview.locator !== result.target.locator)
    ) return "failed";
    if (!await openPage(
      result.target.pageId,
      result.target.kind === "source" ? result.target.preview : undefined
    )) return "failed";
    window.requestAnimationFrame(() => {
      const target = result.target.kind === "source" && result.target.preview
        ? document.querySelector<HTMLElement>(".reader-source-citation-preview")
        : document.querySelector<HTMLElement>(".note-reader");
      target?.focus({ preventScroll: true });
    });
    return result.target.kind === "source" ? "opened_source" : "opened_page";
  } catch {
    return isCurrent() ? "failed" : "stale";
  }
}
