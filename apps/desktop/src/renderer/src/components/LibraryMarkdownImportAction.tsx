import { useEffect, useRef, useState } from "react";
import type {
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteRenderResult,
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export interface LibraryMarkdownImportLabels {
  readonly action: string;
  readonly pending: string;
  readonly stale: string;
  readonly invalid: string;
  readonly failed: string;
}

export function LibraryMarkdownImportAction(props: {
  readonly activeVaultId: string;
  readonly labels: LibraryMarkdownImportLabels;
  readonly onImport: (request: NoteImportMarkdownRequest) => Promise<NoteImportMarkdownResult>;
  readonly onImported: (render: NoteRenderResult) => void;
}): React.JSX.Element {
  const [state, setState] = useState<"idle" | "pending" | "stale" | "invalid" | "failed">("idle");
  const sequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    sequenceRef.current += 1;
    requestActiveRef.current = false;
    setState("idle");
  }, [props.activeVaultId]);

  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const importMarkdown = async (): Promise<void> => {
    if (requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const request: NoteImportMarkdownRequest = {
      apiVersion: 1,
      requestId: createNoteImportRequestId(),
      activeVaultId: props.activeVaultId,
    };
    setState("pending");
    try {
      const result = await props.onImport(request);
      if (
        sequence !== sequenceRef.current ||
        activeVaultIdRef.current !== request.activeVaultId ||
        !noteImportIdentityMatches(request, result)
      ) return;
      if (
        result.status === "imported" &&
        result.render.summary.pageType === "note" &&
        result.render.summary.status !== "archived"
      ) {
        setState("idle");
        props.onImported(result.render);
        return;
      }
      if (result.status === "cancelled") setState("idle");
      else setState(result.status === "imported" ? "failed" : result.status);
      restoreFocus();
    } catch {
      if (sequence !== sequenceRef.current || activeVaultIdRef.current !== request.activeVaultId) return;
      setState("failed");
      restoreFocus();
    } finally {
      if (sequence === sequenceRef.current) requestActiveRef.current = false;
    }
  };

  const feedback = state === "stale" || state === "invalid" || state === "failed"
    ? props.labels[state]
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        title={props.labels.action}
        aria-label={props.labels.action}
        aria-busy={state === "pending"}
        disabled={state === "pending"}
        onClick={() => void importMarkdown()}
      >
        <PigeIcon name={state === "pending" ? "loading" : "fileText"} size={16} />
      </button>
      {state === "pending" ? (
        <span className="toolbar-meta" role="status">{props.labels.pending}</span>
      ) : feedback ? (
        <span className="toolbar-meta" role="alert">{feedback}</span>
      ) : null}
    </>
  );
}

function createNoteImportRequestId(): `noteimport_${string}` {
  return `noteimport_${crypto.randomUUID().replaceAll("-", "")}`;
}

function noteImportIdentityMatches(
  request: NoteImportMarkdownRequest,
  result: NoteImportMarkdownResult,
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId;
}
