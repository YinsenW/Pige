import { useEffect, useRef, useState } from "react";
import type { KnowledgeHealthClaimSourceCandidate } from "@pige/contracts";
import type { RepairableUnsourcedClaim } from "./KnowledgeHealthReadyResult";

type State =
  | { readonly kind: "open" | "searching" | "failed" | "stale"; readonly query: string }
  | { readonly kind: "ready"; readonly query: string;
    readonly sources: readonly KnowledgeHealthClaimSourceCandidate[]; readonly truncated: boolean };

export function KnowledgeHealthClaimSourceRepair(props: {
  readonly activeVaultId: string;
  readonly issue: RepairableUnsourcedClaim;
  readonly returnFocus: HTMLButtonElement | null;
  readonly t: (key: string) => string;
  readonly onClose: () => void;
  readonly onCommitted: () => Promise<void>;
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: "open", query: "" });
  const [repairing, setRepairing] = useState(false);
  const sequenceRef = useRef(0);
  const busyRef = useRef(false);
  const identityRef = useRef(`${props.activeVaultId}\0${props.issue.repairContextId}`);
  identityRef.current = `${props.activeVaultId}\0${props.issue.repairContextId}`;

  useEffect(() => () => { sequenceRef.current += 1; }, []);

  const restoreFocus = (): void => { window.setTimeout(() => props.returnFocus?.focus(), 0); };
  const close = (): void => {
    sequenceRef.current += 1;
    props.onClose();
    restoreFocus();
  };
  const search = async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    const identity = identityRef.current;
    const sequence = ++sequenceRef.current;
    const query = state.query;
    setState({ kind: "searching", query });
    try {
      const result = await window.pige.maintenance.searchKnowledgeHealthClaimSources({
        ...claimProof(props),
        requestId: `knowledge_health_claim_source_search_${crypto.randomUUID().replaceAll("-", "")}`,
        query
      });
      if (sequence !== sequenceRef.current || identity !== identityRef.current) return;
      setState(result.status === "ready"
        ? { kind: "ready", query, sources: result.sources, truncated: result.truncated }
        : { kind: result.status === "stale" || result.status === "not_found" ? "stale" : "failed", query });
    } catch {
      if (sequence === sequenceRef.current && identity === identityRef.current) setState({ kind: "failed", query });
    } finally {
      busyRef.current = false;
    }
  };
  const repair = async (source: KnowledgeHealthClaimSourceCandidate): Promise<void> => {
    if (busyRef.current) return;
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
        setState({ kind: result.status === "stale" || result.status === "not_found" ? "stale" : "failed", query: state.query });
      }
    } catch {
      if (sequence === sequenceRef.current && identity === identityRef.current) setState({ kind: "failed", query: state.query });
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
          onChange={(event) => setState({ kind: "open", query: event.target.value })} />
        {state.kind === "ready" ? state.sources.length > 0 ? (
          <span>{state.sources.map((source) => (
            <button key={source.sourceContextId} className="settings-button" type="button" disabled={repairing}
              onClick={() => void repair(source)}>{source.page.title}</button>
          ))}</span>
        ) : <span>{props.t("maintenance.knowledgeHealth.noClaimSources")}</span> : null}
        {state.kind === "ready" && state.truncated
          ? <span>{props.t("maintenance.knowledgeHealth.claimSourceResultsTruncated")}</span> : null}
        {state.kind === "stale" ? <span role="alert">{props.t("maintenance.knowledgeHealth.repairStale")}</span> : null}
        {state.kind === "failed" ? <span role="alert">{props.t("maintenance.knowledgeHealth.claimSourceFailed")}</span> : null}
      </div>
      <div className="settings-row-control">
        <button className="settings-button" type="button" onClick={close}>{props.t("backup.restoreCancel")}</button>
        <button className="settings-button primary" type="button" disabled={state.kind === "searching" || repairing}
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
    indexGeneration: props.issue.indexGeneration,
    issueKind: "unsourced_claim" as const,
    pageId: props.issue.page.pageId,
    repairContextId: props.issue.repairContextId,
    claimRevision: props.issue.claimRevision,
    claimRenderProof: props.issue.claimRenderProof
  };
}
