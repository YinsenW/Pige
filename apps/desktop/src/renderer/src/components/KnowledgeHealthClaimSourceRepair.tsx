import { useEffect, useRef, useState } from "react";
import type { KnowledgeHealthClaimSourceCandidate } from "@pige/contracts";
import type { RepairableUnsourcedClaim } from "./KnowledgeHealthReadyResult";

type State =
  | {
      readonly kind: "open" | "searching" | "failed" | "stale" | "ineligible" | "ready";
      readonly query: string;
      readonly sources: readonly KnowledgeHealthClaimSourceCandidate[];
      readonly truncated: boolean;
      readonly selectedSourceContextId: string | undefined;
    };

export function KnowledgeHealthClaimSourceRepair(props: {
  readonly activeVaultId: string;
  readonly issue: RepairableUnsourcedClaim;
  readonly returnFocus: HTMLButtonElement | null;
  readonly t: (key: string) => string;
  readonly onClose: () => void;
  readonly onCommitted: () => Promise<void>;
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "open", query: "", sources: [], truncated: false, selectedSourceContextId: undefined });
  const [repairing, setRepairing] = useState(false);
  const sequenceRef = useRef(0);
  const busyRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusRef = useRef<HTMLButtonElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const owner = [props.activeVaultId, props.issue.reportRequestId, props.issue.reportEpoch, props.issue.indexGeneration,
    props.issue.page.pageId, props.issue.repairContextId, props.issue.claimRevision, props.issue.claimRenderProof].join("\0");
  const identityRef = useRef(owner);
  identityRef.current = owner;

  useEffect(() => () => { sequenceRef.current += 1; }, []);
  useEffect(() => {
    sequenceRef.current += 1;
    busyRef.current = false;
    setRepairing(false);
    setState({ kind: "open", query: "", sources: [], truncated: false, selectedSourceContextId: undefined });
  }, [owner]);

  const restoreFocus = (): void => { window.setTimeout(() => props.returnFocus?.focus(), 0); };
  const close = (): void => {
    sequenceRef.current += 1;
    props.onClose();
    restoreFocus();
  };
  useEffect(() => {
    if (state.selectedSourceContextId) confirmRef.current?.focus();
  }, [state.selectedSourceContextId]);
  const search = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    const identity = identityRef.current;
    const sequence = ++sequenceRef.current;
    const query = state.query;
    const retained = state;
    setState({ ...state, kind: "searching", query, selectedSourceContextId: undefined });
    try {
      const result = await window.pige.maintenance.searchKnowledgeHealthClaimSources({
        ...claimProof(props),
        requestId: `knowledge_health_claim_source_search_${crypto.randomUUID().replaceAll("-", "")}`,
        query
      });
      if (sequence !== sequenceRef.current || identity !== identityRef.current) return;
      setState(result.status === "ready"
        ? { kind: "ready", query, sources: result.sources, truncated: result.truncated, selectedSourceContextId: undefined }
        : {
            ...retained,
            kind: result.status === "stale" || result.status === "not_found" ? "stale" : "failed",
            query,
            selectedSourceContextId: undefined
          });
    } catch {
      if (sequence === sequenceRef.current && identity === identityRef.current) {
        setState({ ...retained, kind: "failed", query, selectedSourceContextId: undefined });
      }
    } finally {
      busyRef.current = false;
      if (identity === identityRef.current) window.setTimeout(() => searchButtonRef.current?.focus(), 0);
    }
  };
  const repair = async (): Promise<void> => {
    if (busyRef.current) return;
    const source = state.sources.find(({ sourceContextId }) => sourceContextId === state.selectedSourceContextId);
    if (!source) return;
    busyRef.current = true;
    setRepairing(true);
    const identity = identityRef.current;
    const sequence = ++sequenceRef.current;
    try {
      const result = await window.pige.maintenance.repairKnowledgeHealthUnsourcedClaim({
        ...claimProof(props),
        requestId: `knowledge_health_claim_source_repair_${crypto.randomUUID().replaceAll("-", "")}`,
        action: "bind_claim_source",
        sourceContextId: source.sourceContextId
      });
      if (sequence !== sequenceRef.current || identity !== identityRef.current) return;
      if (result.status === "committed") {
        props.onClose();
        await props.onCommitted();
        restoreFocus();
      } else {
        setState({ ...state, kind: result.status === "stale" || result.status === "not_found"
          ? "stale" : result.status === "ineligible" ? "ineligible" : "failed" });
        window.setTimeout(() => (confirmRef.current ?? focusRef.current)?.focus(), 0);
      }
    } catch {
      if (sequence === sequenceRef.current && identity === identityRef.current) {
        setState({ ...state, kind: "failed" });
        window.setTimeout(() => (confirmRef.current ?? focusRef.current)?.focus(), 0);
      }
    } finally {
      busyRef.current = false;
      setRepairing(false);
    }
  };

  return (
    <div className="settings-row tall" role="group" aria-labelledby="knowledge-health-claim-source-title">
      <div className="settings-row-copy">
        <strong id="knowledge-health-claim-source-title">{props.t("maintenance.knowledgeHealth.claimSourceTitle")}</strong>
        <span>{props.t("maintenance.knowledgeHealth.claimSourceDescription")}</span>
        <label htmlFor="knowledge-health-claim-source-query">{props.t("maintenance.knowledgeHealth.claimSourceQuery")}</label>
        <input id="knowledge-health-claim-source-query" className="settings-input" maxLength={120}
          value={state.query} disabled={state.kind === "searching" || repairing}
          onChange={(event) => setState({ ...state, kind: "open", query: event.target.value,
            selectedSourceContextId: undefined })} />
        {state.sources.length > 0 ? (
          <span>{state.sources.map((source) => (
            <button key={source.sourceContextId} className="settings-button" type="button" disabled={repairing}
              aria-pressed={state.selectedSourceContextId === source.sourceContextId}
              onClick={(event) => { focusRef.current = event.currentTarget; setState({ ...state, kind: "ready",
                selectedSourceContextId: source.sourceContextId }); }}>{source.page.title}</button>
          ))}</span>
        ) : state.kind === "ready" ? <span>{props.t("maintenance.knowledgeHealth.noClaimSources")}</span> : null}
        {state.sources.length > 1
          ? <span role="status">{props.t("maintenance.knowledgeHealth.claimSourceAmbiguous")}</span>
          : null}
        {state.truncated
          ? <span>{props.t("maintenance.knowledgeHealth.claimSourceResultsTruncated")}</span> : null}
        {state.kind === "stale" ? <span role="alert">{props.t("maintenance.knowledgeHealth.repairStale")}</span> : null}
        {state.kind === "failed" ? <span role="alert">{props.t("maintenance.knowledgeHealth.claimSourceFailed")}</span> : null}
        {state.kind === "ineligible" ? <span role="alert">{props.t("maintenance.knowledgeHealth.claimSourceIneligible")}</span> : null}
        {state.selectedSourceContextId ? <div role="alertdialog" aria-labelledby="knowledge-health-claim-source-confirm-title">
          <span>{state.sources.find(({ sourceContextId }) => sourceContextId === state.selectedSourceContextId)?.page.title}</span>
          <strong id="knowledge-health-claim-source-confirm-title">
            {props.t("maintenance.knowledgeHealth.claimSourceConfirmTitle")}
          </strong>
          <span>{props.t("maintenance.knowledgeHealth.claimSourceConfirmDescription")}</span>
          <button className="settings-button" type="button" disabled={repairing} onClick={() => {
            setState({ ...state, selectedSourceContextId: undefined });
            window.setTimeout(() => focusRef.current?.focus(), 0);
          }}>{props.t("maintenance.knowledgeHealth.claimSourceCancel")}</button>
          <button ref={confirmRef} className="settings-button primary" type="button" disabled={repairing}
            onClick={() => void repair()}>{props.t("maintenance.knowledgeHealth.claimSourceConfirm")}</button>
        </div> : null}
      </div>
      <div className="settings-row-control">
        <button className="settings-button" type="button" onClick={close}>{props.t("backup.restoreCancel")}</button>
        <button ref={searchButtonRef} className="settings-button primary" type="button" disabled={state.kind === "searching" || repairing}
          onClick={() => void search()}>{props.t(state.kind === "searching"
            ? "maintenance.knowledgeHealth.claimSourceSearching"
            : "maintenance.knowledgeHealth.searchClaimSources")}</button>
      </div>
    </div>
  );
}

function claimProof(props: {
  readonly activeVaultId: string;
  readonly issue: RepairableUnsourcedClaim;
}) {
  return {
    apiVersion: 1 as const,
    activeVaultId: props.activeVaultId,
    reportRequestId: props.issue.reportRequestId,
    reportEpoch: props.issue.reportEpoch,
    indexGeneration: props.issue.indexGeneration,
    issueKind: "unsourced_claim" as const,
    pageId: props.issue.page.pageId,
    repairContextId: props.issue.repairContextId,
    claimRevision: props.issue.claimRevision,
    claimRenderProof: props.issue.claimRenderProof
  };
}
