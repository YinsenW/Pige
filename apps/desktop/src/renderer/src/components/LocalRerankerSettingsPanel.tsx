import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LocalRerankerDisableRequest,
  LocalRerankerDisableResult,
  LocalRerankerEnableRequest,
  LocalRerankerEnableResult,
  LocalRerankerInstallRequest,
  LocalRerankerInstallResult,
  LocalRerankerRemoveRequest,
  LocalRerankerRemoveResult,
  LocalRerankerStatus,
  LocalRerankerStatusRequest
} from "@pige/contracts";

type Action = "install" | "enable" | "disable" | "remove";
type Translate = (key: string) => string;

export interface LocalRerankerApi {
  readonly localRerankerStatus: (request: LocalRerankerStatusRequest) => Promise<LocalRerankerStatus>;
  readonly installLocalReranker: (request: LocalRerankerInstallRequest) => Promise<LocalRerankerInstallResult>;
  readonly enableLocalReranker: (request: LocalRerankerEnableRequest) => Promise<LocalRerankerEnableResult>;
  readonly disableLocalReranker: (request: LocalRerankerDisableRequest) => Promise<LocalRerankerDisableResult>;
  readonly removeLocalReranker: (request: LocalRerankerRemoveRequest) => Promise<LocalRerankerRemoveResult>;
}

function requestId(): string {
  return `rerankasset_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function actions(status: LocalRerankerStatus): readonly Action[] {
  switch (status.assetState) {
    case "not_installed": return ["install"];
    case "ready": return ["disable", "remove"];
    case "disabled": return ["enable", "remove"];
    case "needs_repair": return ["install", "remove"];
    case "installing":
    case "verifying": return [];
  }
}
function actionKey(action: Action, pending: boolean): string {
  if (!pending) return `capabilities.semanticAsset.action.${action}`;
  return `capabilities.semanticAsset.action.${action === "install" ? "installing"
    : action === "enable" ? "enabling" : action === "disable" ? "disabling" : "removing"}`;
}

export function LocalRerankerSettingsPanel(props: {
  readonly api: LocalRerankerApi;
  readonly t: Translate;
}): React.JSX.Element {
  const [status, setStatus] = useState<LocalRerankerStatus | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [pending, setPending] = useState<Action | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const actionTriggerRefs = useRef(new Map<Action, HTMLButtonElement>());
  const pendingFocusActionRef = useRef<Action | null>(null);

  useEffect(() => {
    if (pending !== null || pendingFocusActionRef.current === null) return;
    const action = pendingFocusActionRef.current;
    pendingFocusActionRef.current = null;
    const firstAvailableAction = actionTriggerRefs.current.values().next().value;
    (actionTriggerRefs.current.get(action) ?? firstAvailableAction ?? rowRef.current)?.focus({ preventScroll: true });
  }, [failed, pending, readState, status]);

  const read = useCallback(async (id: number, minimumRevision = 0): Promise<void> => {
    try {
      const next = await props.api.localRerankerStatus({ apiVersion: 1 });
      if (!mounted.current || sequence.current !== id || next.revision < minimumRevision) return;
      setStatus(next);
      setReadState("ready");
    } catch {
      if (mounted.current && sequence.current === id) setReadState("failed");
    }
  }, [props.api]);

  const refresh = useCallback(async (): Promise<void> => {
    const id = ++sequence.current;
    await read(id, status?.revision ?? 0);
  }, [read, status?.revision]);

  useEffect(() => {
    mounted.current = true;
    const id = ++sequence.current;
    void read(id);
    return () => { mounted.current = false; sequence.current += 1; };
  }, [read]);

  useEffect(() => {
    if (!status || !["installing", "verifying"].includes(status.assetState)) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const run = async (action: Action): Promise<void> => {
    const current = status;
    if (!current || pending || !actions(current).includes(action)) return;
    const id = ++sequence.current;
    const idempotencyKey = requestId();
    pendingFocusActionRef.current = action;
    setPending(action);
    setFailed(false);
    try {
      const request = { apiVersion: 1 as const, requestId: idempotencyKey, expectedRevision: current.revision };
      const result = action === "install" ? await props.api.installLocalReranker(request)
        : action === "enable" ? await props.api.enableLocalReranker(request)
          : action === "disable" ? await props.api.disableLocalReranker(request)
            : await props.api.removeLocalReranker(request);
      if (!mounted.current || sequence.current !== id) return;
      if (result.requestId !== idempotencyKey || result.status === "failed") setFailed(true);
      else await read(id, Math.max(current.revision, result.revision));
    } catch {
      if (mounted.current && sequence.current === id) setFailed(true);
    } finally {
      if (mounted.current && sequence.current === id) setPending(null);
    }
  };

  const statusKey = readState === "loading" ? "capabilities.semanticAsset.state.checking"
    : readState === "failed" ? "capabilities.semanticAsset.state.failed"
      : `capabilities.semanticAsset.state.${status?.assetState ?? "failed"}`;

  return (
    <div ref={rowRef} className="settings-row tall" data-reranker-state={status?.assetState ?? readState} tabIndex={-1}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.reranker.title")}</strong>
        <span>{props.t("capabilities.reranker.description")}</span>
      </div>
      <div className="settings-row-control">
        <span className="settings-status" role={readState === "failed" ? "alert" : "status"} aria-live="polite">
          {props.t(statusKey)}
        </span>
        {readState === "ready" && status ? actions(status).map((action) => (
          <button
            className="settings-button"
            type="button"
            key={action}
            ref={(node) => {
              if (node) actionTriggerRefs.current.set(action, node);
              else actionTriggerRefs.current.delete(action);
            }}
            data-reranker-action={action}
            disabled={pending !== null}
            onClick={() => void run(action)}
          >
            {props.t(actionKey(action, pending === action))}
          </button>
        )) : null}
        {readState === "failed" ? (
          <button className="settings-button" type="button" onClick={() => void refresh()}>
            {props.t("capabilities.semanticAsset.retry")}
          </button>
        ) : null}
      </div>
      {failed ? <p className="settings-inline-status error" role="alert">{props.t("capabilities.reranker.actionFailed")}</p> : null}
    </div>
  );
}
