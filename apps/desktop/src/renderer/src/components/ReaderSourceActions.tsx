import { useEffect, useRef, useState } from "react";
import type { NoteRevealSourceRequest, NoteRevealSourceResult } from "@pige/contracts";

export type ReaderSourceActionOutcome =
  | "revealed"
  | "cancelled"
  | "stale"
  | "not_found"
  | "unavailable"
  | "failed";

export interface ReaderSourceActionItem {
  readonly sourceId: string;
  readonly label: string;
  readonly canRevealOriginal: boolean;
}

export interface ReaderSourceActionLabels {
  readonly region: string;
  readonly reveal: string;
  readonly revealing: string;
  readonly revealed: string;
  readonly stale: string;
  readonly notFound: string;
  readonly unavailable: string;
  readonly failed: string;
}

export function readerSourceActionLabels(t: (key: string) => string): ReaderSourceActionLabels {
  return {
    region: t("note.revealSource.region"),
    reveal: t("note.revealSource.action"),
    revealing: t("note.revealSource.revealing"),
    revealed: t("note.revealSource.revealed"),
    stale: t("note.revealSource.stale"),
    notFound: t("note.revealSource.notFound"),
    unavailable: t("note.revealSource.unavailable"),
    failed: t("note.revealSource.failed")
  };
}

interface PendingReveal {
  readonly ownerIdentity: string;
  readonly sourceId: string;
}

type ReaderSourceActionNotice = Exclude<ReaderSourceActionOutcome, "cancelled">;

export function ReaderSourceActions(props: {
  readonly ownerIdentity: string;
  readonly sources: readonly ReaderSourceActionItem[];
  readonly labels: ReaderSourceActionLabels;
  readonly onRevealOriginal: (sourceId: string) => Promise<ReaderSourceActionOutcome>;
}): React.JSX.Element | null {
  const eligibleSources = props.sources.filter((source) => source.canRevealOriginal === true);
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const pendingRef = useRef<PendingReveal | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly sourceId: string;
    readonly outcome: ReaderSourceActionNotice;
  } | null>(null);

  useEffect(() => {
    ownerIdentityRef.current = props.ownerIdentity;
    pendingRef.current = null;
    setPendingSourceId(null);
    setNotice(null);
  }, [props.ownerIdentity]);

  const revealOriginal = async (source: ReaderSourceActionItem): Promise<void> => {
    if (!source.canRevealOriginal || pendingRef.current) return;
    const pending: PendingReveal = {
      ownerIdentity: props.ownerIdentity,
      sourceId: source.sourceId
    };
    pendingRef.current = pending;
    setPendingSourceId(source.sourceId);
    setNotice(null);
    let outcome: ReaderSourceActionOutcome = "failed";
    try {
      outcome = await props.onRevealOriginal(source.sourceId);
    } catch {
      outcome = "failed";
    } finally {
      if (
        ownerIdentityRef.current !== pending.ownerIdentity ||
        pendingRef.current !== pending
      ) return;
      pendingRef.current = null;
      setPendingSourceId(null);
      setNotice(outcome === "cancelled" ? null : { sourceId: source.sourceId, outcome });
      const restoreFocus = (): void => {
        const trigger = triggerRefs.current.get(source.sourceId);
        if (trigger?.isConnected) trigger.focus();
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(restoreFocus);
      } else {
        window.setTimeout(restoreFocus, 0);
      }
    }
  };

  if (eligibleSources.length === 0) return null;

  return (
    <div aria-label={props.labels.region}>
      {eligibleSources.map((source) => {
        const pending = pendingSourceId === source.sourceId;
        const outcome = notice?.sourceId === source.sourceId ? notice.outcome : null;
        return (
          <div key={source.sourceId}>
            <button
              ref={(element) => {
                if (element) triggerRefs.current.set(source.sourceId, element);
                else triggerRefs.current.delete(source.sourceId);
              }}
              className="ghost"
              type="button"
              disabled={pendingSourceId !== null}
              aria-label={`${props.labels.reveal}: ${source.label}`}
              aria-busy={pending}
              data-reader-source-reveal={source.sourceId}
              onClick={() => void revealOriginal(source)}
            >{pending ? props.labels.revealing : props.labels.reveal}</button>
            {outcome ? (
              <p role={outcome === "failed" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
                {sourceActionNotice(outcome, props.labels)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReaderSourceRevealAction(props: {
  readonly activeVaultId?: string;
  readonly currentPageId: string;
  readonly renderContextId?: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly labels: ReaderSourceActionLabels;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
}): React.JSX.Element | null {
  return (
    <ReaderSourceActions
      ownerIdentity={`${props.activeVaultId ?? "unavailable"}:${props.currentPageId}:${props.renderContextId ?? "unavailable"}`}
      sources={[{
        sourceId: props.sourceId,
        label: props.sourceLabel,
        canRevealOriginal: Boolean(props.onRevealSource)
      }]}
      labels={props.labels}
      onRevealOriginal={async (sourceId) => {
        const { activeVaultId, currentPageId, renderContextId, onRevealSource } = props;
        if (!activeVaultId || !renderContextId || !onRevealSource) return "unavailable";
        const request: NoteRevealSourceRequest = {
          apiVersion: 1,
          requestId: `notesourcereveal_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
          activeVaultId,
          currentPageId,
          renderContextId,
          sourceId
        };
        const result = await onRevealSource(request);
        return revealResultMatches(request, result) ? result.status : "failed";
      }}
    />
  );
}

function revealResultMatches(
  request: NoteRevealSourceRequest,
  result: NoteRevealSourceResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.sourceId === request.sourceId;
}

function sourceActionNotice(
  outcome: ReaderSourceActionNotice,
  labels: ReaderSourceActionLabels
): string {
  if (outcome === "revealed") return labels.revealed;
  if (outcome === "stale") return labels.stale;
  if (outcome === "not_found") return labels.notFound;
  if (outcome === "unavailable") return labels.unavailable;
  return labels.failed;
}
