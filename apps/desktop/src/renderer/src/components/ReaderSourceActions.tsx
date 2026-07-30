import { useEffect, useRef, useState } from "react";
import type {
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  NoteRenderResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult
} from "@pige/contracts";
import { ReaderSourceRefreshAction } from "./ReaderSourceRefreshAction";

export type ReaderSourceActionOutcome =
  | "revealed"
  | "reconnected"
  | "cancelled"
  | "stale"
  | "not_found"
  | "ineligible"
  | "unavailable"
  | "failed";

export interface ReaderSourceActionItem {
  readonly sourceId: string;
  readonly label: string;
  readonly canRevealOriginal: boolean;
  readonly canReconnectOriginal: boolean;
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
  readonly reconnect: string;
  readonly reconnecting: string;
  readonly reconnected: string;
  readonly reconnectIneligible: string;
  readonly reconnectFailed: string;
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
    failed: t("note.revealSource.failed"),
    reconnect: t("note.reconnectOriginalSource.action"),
    reconnecting: t("note.reconnectOriginalSource.reconnecting"),
    reconnected: t("note.reconnectOriginalSource.reconnected"),
    reconnectIneligible: t("note.reconnectOriginalSource.ineligible"),
    reconnectFailed: t("note.reconnectOriginalSource.failed")
  };
}

interface PendingSourceAction {
  readonly ownerIdentity: string;
  readonly sourceId: string;
  readonly action: "reveal" | "reconnect";
}

type ReaderSourceActionNotice = Exclude<ReaderSourceActionOutcome, "cancelled">;
type ReaderSourceReconnectResponse = {
  readonly outcome: Exclude<ReaderSourceActionOutcome, "revealed" | "unavailable">;
  readonly render?: NoteRenderResult;
};

export function ReaderSourceActions(props: {
  readonly ownerIdentity: string;
  readonly sources: readonly ReaderSourceActionItem[];
  readonly labels: ReaderSourceActionLabels;
  readonly onRevealOriginal: (sourceId: string) => Promise<ReaderSourceActionOutcome>;
  readonly onReconnectOriginal?: (sourceId: string) => Promise<ReaderSourceReconnectResponse>;
  readonly onReconnected?: (sourceId: string, render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  const eligibleSources = props.sources.filter((source) =>
    source.canRevealOriginal === true || source.canReconnectOriginal === true
  );
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const pendingRef = useRef<PendingSourceAction | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingAction, setPendingAction] = useState<PendingSourceAction | null>(null);
  const [notice, setNotice] = useState<{
    readonly sourceId: string;
    readonly action: "reveal" | "reconnect";
    readonly outcome: ReaderSourceActionNotice;
  } | null>(null);

  useEffect(() => {
    ownerIdentityRef.current = props.ownerIdentity;
    pendingRef.current = null;
    setPendingAction(null);
    setNotice(null);
  }, [props.ownerIdentity]);

  const activate = async (
    source: ReaderSourceActionItem,
    action: "reveal" | "reconnect"
  ): Promise<void> => {
    if (
      pendingRef.current ||
      (action === "reveal" && !source.canRevealOriginal) ||
      (action === "reconnect" && (!source.canReconnectOriginal || !props.onReconnectOriginal))
    ) return;
    const pending: PendingSourceAction = {
      ownerIdentity: props.ownerIdentity,
      sourceId: source.sourceId,
      action
    };
    pendingRef.current = pending;
    setPendingAction(pending);
    setNotice(null);
    let outcome: ReaderSourceActionOutcome = "failed";
    let reconnectedRender: NoteRenderResult | undefined;
    try {
      if (action === "reveal") outcome = await props.onRevealOriginal(source.sourceId);
      else {
        const response = await props.onReconnectOriginal!(source.sourceId);
        outcome = response.outcome;
        reconnectedRender = response.render;
      }
    } catch {
      outcome = "failed";
    } finally {
      if (
        ownerIdentityRef.current !== pending.ownerIdentity ||
        pendingRef.current !== pending
      ) return;
      pendingRef.current = null;
      setPendingAction(null);
      setNotice(outcome === "cancelled" ? null : { sourceId: source.sourceId, action, outcome });
      if (action === "reconnect" && outcome === "reconnected" && reconnectedRender) {
        props.onReconnected?.(source.sourceId, reconnectedRender);
      }
      const restoreFocus = (): void => {
        const trigger = triggerRefs.current.get(`${action}:${source.sourceId}`);
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
        const outcome = notice?.sourceId === source.sourceId ? notice : null;
        return (
          <div key={source.sourceId}>
            {source.canRevealOriginal ? (
              <button
                ref={(element) => {
                  const key = `reveal:${source.sourceId}`;
                  if (element) triggerRefs.current.set(key, element);
                  else triggerRefs.current.delete(key);
                }}
                className="ghost"
                type="button"
                disabled={pendingAction !== null}
                aria-label={`${props.labels.reveal}: ${source.label}`}
                aria-busy={pendingAction?.sourceId === source.sourceId && pendingAction.action === "reveal"}
                data-reader-source-reveal={source.sourceId}
                onClick={() => void activate(source, "reveal")}
              >{pendingAction?.sourceId === source.sourceId && pendingAction.action === "reveal"
                  ? props.labels.revealing
                  : props.labels.reveal}</button>
            ) : null}
            {source.canReconnectOriginal && props.onReconnectOriginal ? (
              <button
                ref={(element) => {
                  const key = `reconnect:${source.sourceId}`;
                  if (element) triggerRefs.current.set(key, element);
                  else triggerRefs.current.delete(key);
                }}
                className="ghost"
                type="button"
                disabled={pendingAction !== null}
                aria-label={`${props.labels.reconnect}: ${source.label}`}
                aria-busy={pendingAction?.sourceId === source.sourceId && pendingAction.action === "reconnect"}
                data-reader-source-reconnect={source.sourceId}
                onClick={() => void activate(source, "reconnect")}
              >{pendingAction?.sourceId === source.sourceId && pendingAction.action === "reconnect"
                  ? props.labels.reconnecting
                  : props.labels.reconnect}</button>
            ) : null}
            {outcome ? (
              <p role={outcome.outcome === "failed" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
                {sourceActionNotice(outcome.action, outcome.outcome, props.labels)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ReaderSourceActionSurface(props: {
  readonly activeVaultId?: string;
  readonly currentPageId: string;
  readonly renderContextId?: string;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly sourceLabel: string;
    readonly canRevealOriginal: boolean;
    readonly canReconnectOriginal: boolean;
  }[];
  readonly labels: ReaderSourceActionLabels;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  readonly onReconnectOriginalSource?: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onReconnected?: (sourceId: string, render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  return (
    <ReaderSourceActions
      ownerIdentity={`${props.activeVaultId ?? "unavailable"}:${props.currentPageId}:${props.renderContextId ?? "unavailable"}`}
      sources={props.sources.map((source) => ({
        sourceId: source.sourceId,
        label: source.sourceLabel,
        canRevealOriginal: source.canRevealOriginal && Boolean(props.onRevealSource),
        canReconnectOriginal: source.canReconnectOriginal && Boolean(props.onReconnectOriginalSource)
      }))}
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
      {...(props.onReconnectOriginalSource ? {
        onReconnectOriginal: async (sourceId: string): Promise<ReaderSourceReconnectResponse> => {
          const { activeVaultId, currentPageId, renderContextId, onReconnectOriginalSource } = props;
          if (!activeVaultId || !renderContextId || !onReconnectOriginalSource) return { outcome: "failed" };
          const request: NoteReconnectOriginalSourceRequest = {
            apiVersion: 1,
            requestId: `notesourcereconnect_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
            activeVaultId,
            currentPageId,
            renderContextId,
            sourceId
          };
          const result = await onReconnectOriginalSource(request);
          if (!reconnectResultMatches(request, result)) return { outcome: "failed" };
          return result.status === "reconnected"
            ? { outcome: "reconnected", render: result.render }
            : { outcome: result.status };
        }
      } : {})}
      {...(props.onReconnected ? { onReconnected: props.onReconnected } : {})}
    />
  );
}

export function NoteReaderSourceActions(props: {
  readonly activeVaultId?: string;
  readonly currentPageId: string;
  readonly renderContextId?: string;
  readonly sourceIds: readonly string[];
  readonly reconnectOriginalSourceIds?: readonly string[];
  readonly labels: ReaderSourceActionLabels;
  readonly sourceLabel: (number: number) => string;
  readonly t: (key: string) => string;
  readonly getFocusRoot: () => HTMLElement | null;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  readonly onReconnectOriginalSource?: (request: NoteReconnectOriginalSourceRequest) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onSourceReconnected?: (render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  const visibleSourceIds = props.sourceIds.slice(0, 5);
  const reconnectSourceIds = props.reconnectOriginalSourceIds ?? [];
  return <><ReaderSourceActionSurface
    currentPageId={props.currentPageId}
    sources={Array.from(new Set([...visibleSourceIds, ...reconnectSourceIds.filter((id) => props.sourceIds.includes(id))])).map((sourceId) => ({
      sourceId,
      sourceLabel: props.sourceLabel(props.sourceIds.indexOf(sourceId) + 1),
      canRevealOriginal: visibleSourceIds.includes(sourceId),
      canReconnectOriginal: reconnectSourceIds.includes(sourceId)
    }))}
    labels={props.labels}
    {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
    {...(props.renderContextId ? { renderContextId: props.renderContextId } : {})}
    {...(props.onRevealSource ? { onRevealSource: props.onRevealSource } : {})}
    {...(props.onReconnectOriginalSource ? { onReconnectOriginalSource: props.onReconnectOriginalSource } : {})}
    {...(props.onSourceReconnected ? { onReconnected: (sourceId: string, render: NoteRenderResult) => {
      props.onSourceReconnected?.(render);
      window.requestAnimationFrame(() => {
        const root = props.getFocusRoot();
        (root?.querySelector<HTMLElement>(`[data-reader-source-open="${sourceId}"]`) ?? root)?.focus({ preventScroll: true });
      });
    } } : {})}
  />
    <ReaderSourceRefreshAction currentPageId={props.currentPageId} sourceIds={props.sourceIds}
      sourceLabel={props.sourceLabel} t={props.t}
      {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
      {...(props.renderContextId ? { renderContextId: props.renderContextId } : {})}
      onPreview={(request) => window.pige.sourceRefresh.preview(request)}
      onConfirm={(request) => window.pige.sourceRefresh.confirm(request)}
      onRender={(pageId) => window.pige.notes.render({ pageId })}
      {...(props.onSourceReconnected ? { onRefreshed: props.onSourceReconnected } : {})}
    />
  </>;
}

export function ReaderSourceRevealAction(props: {
  readonly activeVaultId?: string;
  readonly currentPageId: string;
  readonly renderContextId?: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly canReconnectOriginal?: boolean;
  readonly labels: ReaderSourceActionLabels;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  readonly onReconnectOriginalSource?: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onReconnected?: (sourceId: string, render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  return (
    <ReaderSourceActionSurface
      currentPageId={props.currentPageId}
      sources={[{
        sourceId: props.sourceId,
        sourceLabel: props.sourceLabel,
        canRevealOriginal: true,
        canReconnectOriginal: props.canReconnectOriginal === true
      }]}
      labels={props.labels}
      {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
      {...(props.renderContextId ? { renderContextId: props.renderContextId } : {})}
      {...(props.onRevealSource ? { onRevealSource: props.onRevealSource } : {})}
      {...(props.onReconnectOriginalSource ? {
        onReconnectOriginalSource: props.onReconnectOriginalSource
      } : {})}
      {...(props.onReconnected ? { onReconnected: props.onReconnected } : {})}
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

function reconnectResultMatches(
  request: NoteReconnectOriginalSourceRequest,
  result: NoteReconnectOriginalSourceResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.sourceId === request.sourceId &&
    (result.status !== "reconnected" || result.render.summary.pageId === request.currentPageId);
}

function sourceActionNotice(
  action: "reveal" | "reconnect",
  outcome: ReaderSourceActionNotice,
  labels: ReaderSourceActionLabels
): string {
  if (action === "reconnect") {
    if (outcome === "reconnected") return labels.reconnected;
    if (outcome === "ineligible") return labels.reconnectIneligible;
    if (outcome === "failed") return labels.reconnectFailed;
  }
  if (outcome === "revealed") return labels.revealed;
  if (outcome === "stale") return labels.stale;
  if (outcome === "not_found") return labels.notFound;
  if (outcome === "unavailable") return labels.unavailable;
  return labels.failed;
}
