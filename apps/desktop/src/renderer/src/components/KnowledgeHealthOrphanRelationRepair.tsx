import { useEffect, useRef, useState } from "react";
import type { KnowledgeHealthOrphanParentCandidate } from "@pige/contracts";
import type { KnowledgeHealthRepairState, RepairableOrphan } from "./KnowledgeHealthReadyResult";

export type OrphanParentPickerState =
  | { readonly kind: "open" | "searching" | "failed" | "stale";
    readonly issue: RepairableOrphan; readonly query: string }
  | { readonly kind: "ready"; readonly issue: RepairableOrphan; readonly query: string;
    readonly parents: readonly KnowledgeHealthOrphanParentCandidate[]; readonly truncated: boolean }
  | null;

export function KnowledgeHealthOrphanRelationRepair(props: {
  readonly state: Exclude<OrphanParentPickerState, null>;
  readonly repairState: KnowledgeHealthRepairState;
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => Promise<void>;
  readonly onRepair: (issue: RepairableOrphan, parent: KnowledgeHealthOrphanParentCandidate) => Promise<void>;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [selected, setSelected] = useState<KnowledgeHealthOrphanParentCandidate | null>(null);
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const repairing = props.repairState?.kind === "repairing";

  useEffect(() => {
    setSelected(null);
  }, [props.state.issue.repairContextId, props.state.query]);

  useEffect(() => {
    if (selected) cancelConfirmRef.current?.focus();
  }, [selected?.sourceContextId]);

  useEffect(() => {
    if (selected && (props.repairState?.kind === "failed" || props.repairState?.kind === "stale")) {
      confirmRef.current?.focus();
    }
  }, [props.repairState?.kind, selected?.sourceContextId]);

  const cancelConfirmation = (): void => {
    setSelected(null);
    window.setTimeout(() => selectedTriggerRef.current?.focus(), 0);
  };

  return (
    <div className="settings-row tall" role="group" aria-labelledby="knowledge-health-orphan-parent-title">
      <div className="settings-row-copy">
        <strong id="knowledge-health-orphan-parent-title">
          {props.t("maintenance.knowledgeHealth.orphanParentTitle")}
        </strong>
        <span>{props.t("maintenance.knowledgeHealth.orphanParentDescription")}</span>
        <label htmlFor="knowledge-health-orphan-parent-query">
          {props.t("maintenance.knowledgeHealth.orphanParentQuery")}
        </label>
        <input id="knowledge-health-orphan-parent-query" className="settings-input" value={props.state.query}
          maxLength={120} disabled={props.state.kind === "searching" || repairing}
          onChange={(event) => props.onQueryChange(event.target.value)} />
        {selected ? (
          <span role="group" aria-labelledby="knowledge-health-orphan-confirm-title">
            <strong id="knowledge-health-orphan-confirm-title">
              {props.t("maintenance.knowledgeHealth.orphanRelationConfirmTitle")}
            </strong>
            <span>{props.t("maintenance.knowledgeHealth.orphanRelationConfirmDescription")}</span>
            <span>{selected.page.title} → {props.state.issue.page.title}</span>
            <button ref={cancelConfirmRef} className="settings-button" type="button" disabled={repairing}
              onClick={cancelConfirmation}>{props.t("backup.restoreCancel")}</button>
            <button ref={confirmRef} className="settings-button primary" type="button" disabled={repairing}
              onClick={() => void props.onRepair(props.state.issue, selected)}>
              {props.t(repairing
                ? "maintenance.knowledgeHealth.repairing"
                : "maintenance.knowledgeHealth.orphanRelationConfirm")}
            </button>
          </span>
        ) : props.state.kind === "ready" ? (
          props.state.parents.length > 0 ? <span>{props.state.parents.map((parent) => (
            <button key={parent.sourceContextId} className="settings-button" type="button" disabled={repairing}
              onClick={(event) => { selectedTriggerRef.current = event.currentTarget; setSelected(parent); }}>
              {parent.page.title}
            </button>
          ))}</span> : <span>{props.t("maintenance.knowledgeHealth.noOrphanParents")}</span>
        ) : props.state.kind === "failed" ? (
          <span role="alert">{props.t("maintenance.knowledgeHealth.orphanParentSearchFailed")}</span>
        ) : props.state.kind === "stale" ? (
          <span role="alert">{props.t("maintenance.knowledgeHealth.repairStale")}</span>
        ) : null}
        {props.state.kind === "ready" && props.state.truncated
          ? <span>{props.t("maintenance.knowledgeHealth.orphanParentResultsTruncated")}</span>
          : null}
        {selected && (props.repairState?.kind === "failed" || props.repairState?.kind === "stale")
          ? <span role="alert">{props.t(props.repairState.kind === "failed"
            ? "maintenance.knowledgeHealth.repairFailed"
            : "maintenance.knowledgeHealth.repairStale")}</span>
          : null}
      </div>
      {!selected ? <div className="settings-row-control">
        <button className="settings-button" type="button" onClick={props.onCancel}>
          {props.t("backup.restoreCancel")}
        </button>
        <button className="settings-button primary" type="button"
          disabled={props.state.kind === "searching" || repairing} onClick={() => void props.onSearch()}>
          {props.t(props.state.kind === "searching"
            ? "maintenance.knowledgeHealth.orphanParentSearching"
            : "maintenance.knowledgeHealth.searchOrphanParents")}
        </button>
      </div> : null}
    </div>
  );
}
