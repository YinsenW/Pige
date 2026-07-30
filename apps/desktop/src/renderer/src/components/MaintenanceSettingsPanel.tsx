import { useEffect, useRef, useState } from "react";
import type {
  KnowledgeHealthIssueKind,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthOrphanParentCandidate,
  KnowledgeHealthRunResult,
  KnowledgeHealthTargetCandidate,
  LocalDatabaseStatus
} from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import {
  KnowledgeHealthReadyResult,
  knowledgeHealthIssueKey,
  type KnowledgeHealthRepairState,
  type RepairableBrokenLink,
  type RepairableOrphan
} from "./KnowledgeHealthReadyResult";

type KnowledgeHealthState =
  | { readonly kind: "not_run" | "checking" | "unavailable" | "failed" }
  | { readonly kind: "ready"; readonly result: Extract<KnowledgeHealthRunResult, { readonly status: "ready" }> };

type OrphanParentPickerState =
  | { readonly kind: "open" | "searching" | "failed" | "stale";
    readonly issue: RepairableOrphan; readonly query: string }
  | { readonly kind: "ready"; readonly issue: RepairableOrphan; readonly query: string;
    readonly parents: readonly KnowledgeHealthOrphanParentCandidate[]; readonly truncated: boolean }
  | null;

type KnowledgeHealthRetargetState =
  | { readonly kind: "open" | "searching" | "failed" | "stale"; readonly issue: RepairableBrokenLink; readonly query: string }
  | { readonly kind: "ready"; readonly issue: RepairableBrokenLink; readonly query: string;
    readonly targets: readonly KnowledgeHealthTargetCandidate[]; readonly truncated: boolean }
  | null;

const KNOWLEDGE_HEALTH_KINDS: readonly KnowledgeHealthIssueKind[] = [
  "broken_link",
  "orphan_page",
  "duplicate_topic",
  "unsourced_claim"
];

export interface MaintenanceSettingsPanelProps {
  readonly activeVaultId: string;
  readonly locale: Locale;
  readonly error: string | null;
  readonly localDatabaseStatus: LocalDatabaseStatus | null;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onOpenPage: (pageId: string) => Promise<boolean>;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

export function MaintenanceSettingsPanel(props: MaintenanceSettingsPanelProps): React.JSX.Element {
  const [maintenanceBusy, setMaintenanceBusy] = useState<"check" | "rebuild" | "reset" | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<{ readonly kind: "success" | "error"; readonly key: string } | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [knowledgeHealthState, setKnowledgeHealthState] = useState<KnowledgeHealthState>({ kind: "not_run" });
  const [knowledgeHealthRepairState, setKnowledgeHealthRepairState] = useState<KnowledgeHealthRepairState>(null);
  const [knowledgeHealthRetargetState, setKnowledgeHealthRetargetState] = useState<KnowledgeHealthRetargetState>(null);
  const [orphanParentPickerState, setOrphanParentPickerState] = useState<OrphanParentPickerState>(null);
  const [knowledgeHealthOpenFailed, setKnowledgeHealthOpenFailed] = useState(false);
  const resetDatabaseButtonRef = useRef<HTMLButtonElement>(null);
  const cancelResetButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const knowledgeHealthSequenceRef = useRef(0);
  const knowledgeHealthRepairSequenceRef = useRef(0);
  const knowledgeHealthTargetSearchSequenceRef = useRef(0);
  const orphanParentSearchSequenceRef = useRef(0);
  const knowledgeHealthRepairBusyRef = useRef(false);
  const knowledgeHealthStateRef = useRef(knowledgeHealthState);
  activeVaultIdRef.current = props.activeVaultId;
  knowledgeHealthStateRef.current = knowledgeHealthState;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      knowledgeHealthSequenceRef.current += 1;
      knowledgeHealthRepairSequenceRef.current += 1;
      knowledgeHealthTargetSearchSequenceRef.current += 1;
      orphanParentSearchSequenceRef.current += 1;
      knowledgeHealthRepairBusyRef.current = false;
    };
  }, []);

  useEffect(() => {
    knowledgeHealthSequenceRef.current += 1;
    knowledgeHealthRepairSequenceRef.current += 1;
    knowledgeHealthTargetSearchSequenceRef.current += 1;
    orphanParentSearchSequenceRef.current += 1;
    knowledgeHealthRepairBusyRef.current = false;
    setKnowledgeHealthState({ kind: "not_run" });
    setKnowledgeHealthRepairState(null);
    setKnowledgeHealthRetargetState(null);
    setOrphanParentPickerState(null);
    setKnowledgeHealthOpenFailed(false);
  }, [props.activeVaultId]);

  useEffect(() => {
    let active = true;
    void props.onRefreshDiagnostics().catch(() => {
      if (active) setMaintenanceNotice({ kind: "error", key: "error.generic" });
    });
    return () => { active = false; };
  }, []);

  const runMaintenanceAction = async (
    kind: "check" | "rebuild" | "reset",
    action: () => Promise<void>,
    successKey: string
  ): Promise<void> => {
    if (maintenanceBusy) return;
    props.onError(null);
    setMaintenanceBusy(kind);
    setMaintenanceNotice(null);
    try {
      await action();
      setMaintenanceNotice({ kind: "success", key: successKey });
    } catch {
      setMaintenanceNotice({ kind: "error", key: "error.generic" });
    } finally {
      setMaintenanceBusy(null);
    }
  };

  const refreshMaintenance = async (): Promise<void> =>
    runMaintenanceAction("check", props.onRefreshDiagnostics, "maintenance.checkCompleted");

  const resetLocalDatabase = async (): Promise<void> => {
    setResetConfirming(false);
    await runMaintenanceAction("reset", async () => {
      await window.pige.maintenance.resetLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    }, "maintenance.resetCompleted");
    window.requestAnimationFrame(() => resetDatabaseButtonRef.current?.focus());
  };

  const rebuildLocalDatabase = async (): Promise<void> =>
    runMaintenanceAction("rebuild", async () => {
      await window.pige.maintenance.rebuildLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    }, "maintenance.rebuildStarted");

  const beginResetConfirmation = (): void => {
    if (maintenanceBusy) return;
    setMaintenanceNotice(null);
    setResetConfirming(true);
    window.requestAnimationFrame(() => cancelResetButtonRef.current?.focus());
  };

  const cancelResetConfirmation = (): void => {
    setResetConfirming(false);
    window.requestAnimationFrame(() => resetDatabaseButtonRef.current?.focus());
  };

  const runKnowledgeHealth = async (preserveRepairNotice = false): Promise<void> => {
    if (knowledgeHealthState.kind === "checking") return;
    if (!preserveRepairNotice) {
      knowledgeHealthRepairSequenceRef.current += 1;
      knowledgeHealthRepairBusyRef.current = false;
      setKnowledgeHealthRepairState(null);
      setKnowledgeHealthRetargetState(null);
      setOrphanParentPickerState(null);
    }
    const activeVaultId = props.activeVaultId;
    const sequence = knowledgeHealthSequenceRef.current + 1;
    knowledgeHealthSequenceRef.current = sequence;
    const requestId = `knowledge_health_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    setKnowledgeHealthOpenFailed(false);
    setKnowledgeHealthState({ kind: "checking" });
    try {
      const result = await window.pige.maintenance.runKnowledgeHealth({
        apiVersion: 1,
        requestId,
        activeVaultId
      });
      if (
        !mountedRef.current ||
        sequence !== knowledgeHealthSequenceRef.current ||
        activeVaultIdRef.current !== activeVaultId
      ) return;
      if (result.requestId !== requestId || result.activeVaultId !== activeVaultId) {
        setKnowledgeHealthState({ kind: "failed" });
        return;
      }
      setKnowledgeHealthState(result.status === "ready"
        ? { kind: "ready", result }
        : { kind: result.status });
    } catch {
      if (
        mountedRef.current &&
        sequence === knowledgeHealthSequenceRef.current &&
        activeVaultIdRef.current === activeVaultId
      ) setKnowledgeHealthState({ kind: "failed" });
    }
  };

  const repairKnowledgeHealthIssue = async (
    issue: RepairableBrokenLink,
    target?: KnowledgeHealthTargetCandidate
  ): Promise<void> => {
    const reportState = knowledgeHealthStateRef.current;
    if (reportState.kind !== "ready" || knowledgeHealthRepairBusyRef.current) return;
    knowledgeHealthRepairBusyRef.current = true;
    const report = reportState.result;
    const activeVaultId = props.activeVaultId;
    const reportSequence = knowledgeHealthSequenceRef.current;
    const repairSequence = knowledgeHealthRepairSequenceRef.current + 1;
    knowledgeHealthRepairSequenceRef.current = repairSequence;
    const issueKey = knowledgeHealthIssueKey(issue);
    const request = {
      apiVersion: 1 as const,
      requestId: `knowledge_health_repair_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId,
      reportRequestId: report.requestId,
      indexGeneration: report.indexGeneration,
      issueKind: "broken_link" as const,
      pageId: issue.page.pageId,
      action: target ? "retarget_broken_reference" as const : "unlink_broken_reference" as const,
      repairContextId: issue.repairContextId,
      sourceRevision: issue.sourceRevision,
      sourceRenderProof: issue.sourceRenderProof,
      occurrenceId: issue.occurrenceId,
      ...(target ? {
        targetPageId: target.page.pageId,
        targetContextId: target.targetContextId,
        targetRevision: target.targetRevision,
        targetRenderProof: target.targetRenderProof
      } : {})
    };
    setKnowledgeHealthOpenFailed(false);
    setKnowledgeHealthRepairState({ kind: "repairing", issueKey });
    try {
      const result = await window.pige.maintenance.repairKnowledgeHealth(request);
      const currentState = knowledgeHealthStateRef.current;
      const currentIssue = currentState.kind === "ready"
        ? currentState.result.issues.find((candidate) =>
          candidate.kind === "broken_link" &&
          candidate.page.pageId === issue.page.pageId &&
          candidate.repairContextId === issue.repairContextId
        )
        : undefined;
      if (
        !mountedRef.current ||
        repairSequence !== knowledgeHealthRepairSequenceRef.current ||
        reportSequence !== knowledgeHealthSequenceRef.current ||
        activeVaultIdRef.current !== activeVaultId ||
        currentState.kind !== "ready" ||
        currentState.result.requestId !== report.requestId ||
        currentState.result.indexGeneration !== report.indexGeneration ||
        !currentIssue
      ) return;
      if (
        result.requestId !== request.requestId ||
        result.activeVaultId !== request.activeVaultId ||
        result.reportRequestId !== request.reportRequestId ||
        result.indexGeneration !== request.indexGeneration ||
        result.issueKind !== request.issueKind ||
        result.pageId !== request.pageId ||
        result.action !== request.action ||
        result.repairContextId !== request.repairContextId ||
        result.sourceRevision !== request.sourceRevision ||
        result.sourceRenderProof !== request.sourceRenderProof ||
        result.occurrenceId !== request.occurrenceId ||
        result.targetPageId !== request.targetPageId ||
        result.targetContextId !== request.targetContextId ||
        result.targetRevision !== request.targetRevision ||
        result.targetRenderProof !== request.targetRenderProof
      ) {
        setKnowledgeHealthRepairState({ kind: "failed" });
        return;
      }
      if (result.status === "committed") {
        setKnowledgeHealthRetargetState(null);
        setOrphanParentPickerState(null);
        setKnowledgeHealthRepairState({ kind: "committed", issueKind: "broken_link" });
        await runKnowledgeHealth(true);
        return;
      }
      setKnowledgeHealthRepairState({
        kind: result.status === "failed" ? "failed" : "stale"
      });
    } catch {
      if (
        mountedRef.current &&
        repairSequence === knowledgeHealthRepairSequenceRef.current &&
        reportSequence === knowledgeHealthSequenceRef.current &&
        activeVaultIdRef.current === activeVaultId
      ) setKnowledgeHealthRepairState({ kind: "failed" });
    } finally {
      if (repairSequence === knowledgeHealthRepairSequenceRef.current) {
        knowledgeHealthRepairBusyRef.current = false;
      }
    }
  };

  const openKnowledgeHealthRetarget = (issue: RepairableBrokenLink): void => {
    if (knowledgeHealthRepairBusyRef.current) return;
    knowledgeHealthTargetSearchSequenceRef.current += 1;
    setKnowledgeHealthRetargetState({ kind: "open", issue, query: "" });
  };

  const updateKnowledgeHealthRetargetQuery = (query: string): void => {
    knowledgeHealthTargetSearchSequenceRef.current += 1;
    setKnowledgeHealthRetargetState((state) => state
      ? { kind: "open", issue: state.issue, query: query.slice(0, 120) }
      : state);
  };

  const openOrphanParentPicker = (issue: RepairableOrphan): void => {
    if (knowledgeHealthRepairBusyRef.current) return;
    orphanParentSearchSequenceRef.current += 1;
    setOrphanParentPickerState({ kind: "open", issue, query: "" });
  };

  const updateOrphanParentQuery = (query: string): void => {
    orphanParentSearchSequenceRef.current += 1;
    setOrphanParentPickerState((state) => state
      ? { kind: "open", issue: state.issue, query: query.slice(0, 120) }
      : state);
  };

  const searchKnowledgeHealthTargets = async (): Promise<void> => {
    const picker = knowledgeHealthRetargetState;
    const reportState = knowledgeHealthStateRef.current;
    if (!picker || reportState.kind !== "ready" || picker.kind === "searching") return;
    const report = reportState.result;
    const activeVaultId = props.activeVaultId;
    const reportSequence = knowledgeHealthSequenceRef.current;
    const searchSequence = knowledgeHealthTargetSearchSequenceRef.current + 1;
    knowledgeHealthTargetSearchSequenceRef.current = searchSequence;
    const request = {
      apiVersion: 1 as const,
      requestId: `knowledge_health_target_search_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId,
      reportRequestId: report.requestId,
      indexGeneration: report.indexGeneration,
      issueKind: "broken_link" as const,
      pageId: picker.issue.page.pageId,
      repairContextId: picker.issue.repairContextId,
      sourceRevision: picker.issue.sourceRevision,
      sourceRenderProof: picker.issue.sourceRenderProof,
      occurrenceId: picker.issue.occurrenceId,
      query: picker.query
    };
    setKnowledgeHealthRetargetState({ kind: "searching", issue: picker.issue, query: picker.query });
    try {
      const result = await window.pige.maintenance.searchKnowledgeHealthTargets(request);
      const current = knowledgeHealthStateRef.current;
      if (!mountedRef.current || searchSequence !== knowledgeHealthTargetSearchSequenceRef.current ||
        reportSequence !== knowledgeHealthSequenceRef.current || activeVaultIdRef.current !== activeVaultId ||
        current.kind !== "ready" || current.result.requestId !== report.requestId ||
        current.result.indexGeneration !== report.indexGeneration ||
        result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId ||
        result.reportRequestId !== request.reportRequestId || result.indexGeneration !== request.indexGeneration ||
        result.issueKind !== request.issueKind || result.pageId !== request.pageId ||
        result.repairContextId !== request.repairContextId || result.sourceRevision !== request.sourceRevision ||
        result.sourceRenderProof !== request.sourceRenderProof || result.occurrenceId !== request.occurrenceId ||
        result.query !== request.query) return;
      setKnowledgeHealthRetargetState(result.status === "ready"
        ? { kind: "ready", issue: picker.issue, query: picker.query, targets: result.targets, truncated: result.truncated }
        : { kind: result.status === "failed" ? "failed" : "stale", issue: picker.issue, query: picker.query });
    } catch {
      if (mountedRef.current && searchSequence === knowledgeHealthTargetSearchSequenceRef.current &&
        reportSequence === knowledgeHealthSequenceRef.current && activeVaultIdRef.current === activeVaultId) {
        setKnowledgeHealthRetargetState({ kind: "failed", issue: picker.issue, query: picker.query });
      }
    }
  };

  const searchOrphanParents = async (): Promise<void> => {
    const picker = orphanParentPickerState;
    const reportState = knowledgeHealthStateRef.current;
    if (!picker || reportState.kind !== "ready" || picker.kind === "searching") return;
    const report = reportState.result;
    const activeVaultId = props.activeVaultId;
    const reportSequence = knowledgeHealthSequenceRef.current;
    const searchSequence = orphanParentSearchSequenceRef.current + 1;
    orphanParentSearchSequenceRef.current = searchSequence;
    const request = {
      apiVersion: 1 as const,
      requestId: `knowledge_health_orphan_parent_search_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId,
      reportRequestId: report.requestId,
      indexGeneration: report.indexGeneration,
      issueKind: "orphan_page" as const,
      pageId: picker.issue.page.pageId,
      repairContextId: picker.issue.repairContextId,
      targetRevision: picker.issue.targetRevision,
      targetRenderProof: picker.issue.targetRenderProof,
      query: picker.query
    };
    setOrphanParentPickerState({ kind: "searching", issue: picker.issue, query: picker.query });
    try {
      const result = await window.pige.maintenance.searchKnowledgeHealthOrphanParents(request);
      const current = knowledgeHealthStateRef.current;
      if (!mountedRef.current || searchSequence !== orphanParentSearchSequenceRef.current ||
        reportSequence !== knowledgeHealthSequenceRef.current || activeVaultIdRef.current !== activeVaultId ||
        current.kind !== "ready" || current.result.requestId !== report.requestId ||
        current.result.indexGeneration !== report.indexGeneration || result.requestId !== request.requestId ||
        result.activeVaultId !== request.activeVaultId || result.reportRequestId !== request.reportRequestId ||
        result.indexGeneration !== request.indexGeneration || result.issueKind !== request.issueKind ||
        result.pageId !== request.pageId || result.repairContextId !== request.repairContextId ||
        result.targetRevision !== request.targetRevision || result.targetRenderProof !== request.targetRenderProof ||
        result.query !== request.query) return;
      setOrphanParentPickerState(result.status === "ready"
        ? { kind: "ready", issue: picker.issue, query: picker.query,
          parents: result.parents, truncated: result.truncated }
        : { kind: result.status === "failed" ? "failed" : "stale", issue: picker.issue, query: picker.query });
    } catch {
      if (mountedRef.current && searchSequence === orphanParentSearchSequenceRef.current &&
        reportSequence === knowledgeHealthSequenceRef.current && activeVaultIdRef.current === activeVaultId) {
        setOrphanParentPickerState({ kind: "failed", issue: picker.issue, query: picker.query });
      }
    }
  };

  const repairOrphan = async (
    issue: RepairableOrphan,
    parent: KnowledgeHealthOrphanParentCandidate
  ): Promise<void> => {
    const reportState = knowledgeHealthStateRef.current;
    if (reportState.kind !== "ready" || knowledgeHealthRepairBusyRef.current) return;
    knowledgeHealthRepairBusyRef.current = true;
    const report = reportState.result;
    const activeVaultId = props.activeVaultId;
    const reportSequence = knowledgeHealthSequenceRef.current;
    const repairSequence = knowledgeHealthRepairSequenceRef.current + 1;
    knowledgeHealthRepairSequenceRef.current = repairSequence;
    const issueKey = knowledgeHealthIssueKey(issue);
    const request = {
      apiVersion: 1 as const,
      requestId: `knowledge_health_orphan_repair_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId,
      reportRequestId: report.requestId,
      indexGeneration: report.indexGeneration,
      issueKind: "orphan_page" as const,
      pageId: issue.page.pageId,
      repairContextId: issue.repairContextId,
      targetRevision: issue.targetRevision,
      targetRenderProof: issue.targetRenderProof,
      action: "connect_orphan_to_parent" as const,
      sourcePageId: parent.page.pageId,
      sourceContextId: parent.sourceContextId,
      sourceRevision: parent.sourceRevision,
      sourceRenderProof: parent.sourceRenderProof
    };
    setKnowledgeHealthRepairState({ kind: "repairing", issueKey });
    try {
      const result = await window.pige.maintenance.repairKnowledgeHealthOrphan(request);
      const current = knowledgeHealthStateRef.current;
      const currentIssue = current.kind === "ready" ? current.result.issues.find((candidate) =>
        candidate.kind === "orphan_page" && candidate.page.pageId === issue.page.pageId &&
        candidate.repairContextId === issue.repairContextId) : undefined;
      if (!mountedRef.current || repairSequence !== knowledgeHealthRepairSequenceRef.current ||
        reportSequence !== knowledgeHealthSequenceRef.current || activeVaultIdRef.current !== activeVaultId ||
        current.kind !== "ready" || current.result.requestId !== report.requestId ||
        current.result.indexGeneration !== report.indexGeneration || !currentIssue) return;
      if (result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId ||
        result.reportRequestId !== request.reportRequestId || result.indexGeneration !== request.indexGeneration ||
        result.issueKind !== request.issueKind || result.pageId !== request.pageId ||
        result.repairContextId !== request.repairContextId || result.targetRevision !== request.targetRevision ||
        result.targetRenderProof !== request.targetRenderProof || result.action !== request.action ||
        result.sourcePageId !== request.sourcePageId || result.sourceContextId !== request.sourceContextId ||
        result.sourceRevision !== request.sourceRevision || result.sourceRenderProof !== request.sourceRenderProof) {
        setKnowledgeHealthRepairState({ kind: "failed" });
        return;
      }
      if (result.status === "committed") {
        orphanParentSearchSequenceRef.current += 1;
        setOrphanParentPickerState(null);
        setKnowledgeHealthState({ kind: "not_run" });
        setKnowledgeHealthRepairState({ kind: "committed", issueKind: "orphan_page" });
        return;
      }
      setKnowledgeHealthRepairState({ kind: result.status === "failed" ? "failed" : "stale" });
    } catch {
      if (mountedRef.current && repairSequence === knowledgeHealthRepairSequenceRef.current &&
        reportSequence === knowledgeHealthSequenceRef.current && activeVaultIdRef.current === activeVaultId) {
        setKnowledgeHealthRepairState({ kind: "failed" });
      }
    } finally {
      if (repairSequence === knowledgeHealthRepairSequenceRef.current) {
        knowledgeHealthRepairBusyRef.current = false;
      }
    }
  };

  const openKnowledgePage = async (pageId: string): Promise<void> => {
    setKnowledgeHealthOpenFailed(false);
    try {
      if (!await props.onOpenPage(pageId)) setKnowledgeHealthOpenFailed(true);
    } catch {
      setKnowledgeHealthOpenFailed(true);
    }
  };

  const databaseStatus = props.localDatabaseStatus?.status ?? "checking";
  const databaseStatusClass = databaseStatus === "error"
    ? " error"
    : databaseStatus === "needs_rebuild" || databaseStatus === "not_initialized"
      ? " warning"
      : "";
  const databaseUpdatedAt = props.localDatabaseStatus?.updatedAt
    ? new Date(props.localDatabaseStatus.updatedAt)
    : null;
  const databaseUpdatedLabel = databaseUpdatedAt && !Number.isNaN(databaseUpdatedAt.getTime())
    ? new Intl.DateTimeFormat(props.locale === "zh-Hans" ? "zh-CN" : props.locale, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(databaseUpdatedAt)
    : props.t("maintenance.timeUnavailable");
  const groupedIssues = knowledgeHealthState.kind === "ready"
    ? KNOWLEDGE_HEALTH_KINDS.map((kind) => ({
      kind,
      issues: knowledgeHealthState.result.issues.filter((issue) => issue.kind === kind)
    })).filter(({ issues }) => issues.length > 0)
    : [];

  return (
    <section className="settings-page maintenance-settings-page" aria-labelledby="settings-maintenance-title">
      <header className="settings-panel-header">
        <h1 id="settings-maintenance-title">{props.t("maintenance.title")}</h1>
        <p>{props.t("maintenance.subtitle")}</p>
      </header>
      <section className="settings-section" aria-labelledby="maintenance-index-title">
        <h2 className="settings-section-title" id="maintenance-index-title">{props.t("maintenance.indexSection")}</h2>
        <div className="settings-card" aria-busy={maintenanceBusy ? "true" : undefined}>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("maintenance.indexStatus")}</strong>
              <span>{props.t("maintenance.statusDescription." + databaseStatus)}</span>
            </div>
            <span className={"settings-status" + databaseStatusClass}>
              {props.t("maintenance.status." + databaseStatus)}
            </span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("maintenance.lastChecked")}</strong>
              <span>
                {databaseUpdatedLabel}
                {props.localDatabaseStatus
                  ? " · " + props.t("maintenance.migrations") + ": " + props.localDatabaseStatus.appliedMigrationCount
                  : ""}
              </span>
            </div>
            <button
              className="settings-button settings-action"
              type="button"
              disabled={maintenanceBusy !== null}
              onClick={() => void refreshMaintenance()}
            >
              {props.t(maintenanceBusy === "check" ? "maintenance.checking" : "maintenance.checkIndex")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("maintenance.rebuildIndex")}</strong>
              <span>{props.t("maintenance.rebuildDescription")}</span>
            </div>
            <button
              className="settings-button settings-action"
              type="button"
              disabled={maintenanceBusy !== null}
              onClick={() => void rebuildLocalDatabase()}
            >
              {props.t(maintenanceBusy === "rebuild" ? "maintenance.rebuilding" : "maintenance.rebuild")}
            </button>
          </div>
        </div>
      </section>

      <section
        className="settings-section"
        aria-labelledby="maintenance-knowledge-health-title"
        aria-busy={knowledgeHealthState.kind === "checking" || knowledgeHealthRepairState?.kind === "repairing"
          ? "true"
          : undefined}
      >
        <h2 className="settings-section-title" id="maintenance-knowledge-health-title">
          {props.t("maintenance.knowledgeHealth.title")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("maintenance.knowledgeHealth.checkTitle")}</strong>
              <span>{props.t("maintenance.knowledgeHealth.description")}</span>
            </div>
            <button
              className="settings-button settings-action"
              type="button"
              disabled={knowledgeHealthState.kind === "checking" || knowledgeHealthRepairState?.kind === "repairing"}
              onClick={() => void runKnowledgeHealth()}
            >
              {props.t(knowledgeHealthState.kind === "checking"
                ? "maintenance.knowledgeHealth.checking"
                : "maintenance.knowledgeHealth.run")}
            </button>
          </div>
          {knowledgeHealthState.kind === "ready" ? (
            <KnowledgeHealthReadyResult
              result={knowledgeHealthState.result}
              groupedIssues={groupedIssues}
              locale={props.locale}
              onOpenPage={openKnowledgePage}
              onRepairIssue={repairKnowledgeHealthIssue}
              onRetargetIssue={openKnowledgeHealthRetarget}
              onChooseOrphanParent={openOrphanParentPicker}
              repairState={knowledgeHealthRepairState}
              t={props.t}
            />
          ) : null}
          {knowledgeHealthRetargetState ? (
            <div className="settings-row tall" role="group" aria-labelledby="knowledge-health-retarget-title">
              <div className="settings-row-copy">
                <strong id="knowledge-health-retarget-title">{props.t("maintenance.knowledgeHealth.retargetTitle")}</strong>
                <span>{props.t("maintenance.knowledgeHealth.retargetDescription")}</span>
                <label htmlFor="knowledge-health-target-query">{props.t("maintenance.knowledgeHealth.targetQuery")}</label>
                <input
                  id="knowledge-health-target-query"
                  className="settings-input"
                  value={knowledgeHealthRetargetState.query}
                  maxLength={120}
                  disabled={knowledgeHealthRetargetState.kind === "searching" || knowledgeHealthRepairState?.kind === "repairing"}
                  onChange={(event) => updateKnowledgeHealthRetargetQuery(event.target.value)}
                />
                {knowledgeHealthRetargetState.kind === "ready" ? (
                  knowledgeHealthRetargetState.targets.length > 0 ? (
                    <span>
                      {knowledgeHealthRetargetState.targets.map((target) => (
                        <button
                          key={target.targetContextId}
                          className="settings-button"
                          type="button"
                          disabled={knowledgeHealthRepairState?.kind === "repairing"}
                          onClick={() => void repairKnowledgeHealthIssue(knowledgeHealthRetargetState.issue, target)}
                        >
                          {target.page.title}
                        </button>
                      ))}
                    </span>
                  ) : <span>{props.t("maintenance.knowledgeHealth.noTargets")}</span>
                ) : knowledgeHealthRetargetState.kind === "failed" ? (
                  <span role="alert">{props.t("maintenance.knowledgeHealth.targetSearchFailed")}</span>
                ) : knowledgeHealthRetargetState.kind === "stale" ? (
                  <span role="alert">{props.t("maintenance.knowledgeHealth.repairStale")}</span>
                ) : null}
                {knowledgeHealthRetargetState.kind === "ready" && knowledgeHealthRetargetState.truncated
                  ? <span>{props.t("maintenance.knowledgeHealth.targetResultsTruncated")}</span>
                  : null}
              </div>
              <div className="settings-row-control">
                <button className="settings-button" type="button" onClick={() => {
                  knowledgeHealthTargetSearchSequenceRef.current += 1;
                  setKnowledgeHealthRetargetState(null);
                }}>
                  {props.t("backup.restoreCancel")}
                </button>
                <button
                  className="settings-button primary"
                  type="button"
                  disabled={knowledgeHealthRetargetState.kind === "searching" ||
                    knowledgeHealthRepairState?.kind === "repairing"}
                  onClick={() => void searchKnowledgeHealthTargets()}
                >
                  {props.t(knowledgeHealthRetargetState.kind === "searching"
                    ? "maintenance.knowledgeHealth.targetSearching"
                    : "maintenance.knowledgeHealth.searchTargets")}
                </button>
              </div>
            </div>
          ) : null}
          {orphanParentPickerState ? (
            <div className="settings-row tall" role="group" aria-labelledby="knowledge-health-orphan-parent-title">
              <div className="settings-row-copy">
                <strong id="knowledge-health-orphan-parent-title">
                  {props.t("maintenance.knowledgeHealth.orphanParentTitle")}
                </strong>
                <span>{props.t("maintenance.knowledgeHealth.orphanParentDescription")}</span>
                <label htmlFor="knowledge-health-orphan-parent-query">
                  {props.t("maintenance.knowledgeHealth.orphanParentQuery")}
                </label>
                <input
                  id="knowledge-health-orphan-parent-query"
                  className="settings-input"
                  value={orphanParentPickerState.query}
                  maxLength={120}
                  disabled={orphanParentPickerState.kind === "searching" ||
                    knowledgeHealthRepairState?.kind === "repairing"}
                  onChange={(event) => updateOrphanParentQuery(event.target.value)}
                />
                {orphanParentPickerState.kind === "ready" ? (
                  orphanParentPickerState.parents.length > 0 ? (
                    <span>
                      {orphanParentPickerState.parents.map((parent) => (
                        <button
                          key={parent.sourceContextId}
                          className="settings-button"
                          type="button"
                          disabled={knowledgeHealthRepairState?.kind === "repairing"}
                          onClick={() => void repairOrphan(orphanParentPickerState.issue, parent)}
                        >
                          {parent.page.title}
                        </button>
                      ))}
                    </span>
                  ) : <span>{props.t("maintenance.knowledgeHealth.noOrphanParents")}</span>
                ) : orphanParentPickerState.kind === "failed" ? (
                  <span role="alert">{props.t("maintenance.knowledgeHealth.orphanParentSearchFailed")}</span>
                ) : orphanParentPickerState.kind === "stale" ? (
                  <span role="alert">{props.t("maintenance.knowledgeHealth.repairStale")}</span>
                ) : null}
                {orphanParentPickerState.kind === "ready" && orphanParentPickerState.truncated
                  ? <span>{props.t("maintenance.knowledgeHealth.orphanParentResultsTruncated")}</span>
                  : null}
              </div>
              <div className="settings-row-control">
                <button className="settings-button" type="button" onClick={() => {
                  orphanParentSearchSequenceRef.current += 1;
                  setOrphanParentPickerState(null);
                }}>
                  {props.t("backup.restoreCancel")}
                </button>
                <button
                  className="settings-button primary"
                  type="button"
                  disabled={orphanParentPickerState.kind === "searching" ||
                    knowledgeHealthRepairState?.kind === "repairing"}
                  onClick={() => void searchOrphanParents()}
                >
                  {props.t(orphanParentPickerState.kind === "searching"
                    ? "maintenance.knowledgeHealth.orphanParentSearching"
                    : "maintenance.knowledgeHealth.searchOrphanParents")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {knowledgeHealthState.kind === "not_run" ? (
          <p className="settings-note" role="status">{props.t("maintenance.knowledgeHealth.notRun")}</p>
        ) : knowledgeHealthState.kind === "checking" ? (
          <p className="settings-note" role="status" aria-live="polite">{props.t("maintenance.knowledgeHealth.checkingStatus")}</p>
        ) : knowledgeHealthState.kind === "unavailable" ? (
          <p className="settings-note" role="status">{props.t("maintenance.knowledgeHealth.unavailable")}</p>
        ) : knowledgeHealthState.kind === "failed" ? (
          <p className="error" role="alert">{props.t("maintenance.knowledgeHealth.failed")}</p>
        ) : null}
        {knowledgeHealthOpenFailed ? (
          <p className="error" role="alert">{props.t("maintenance.knowledgeHealth.openFailed")}</p>
        ) : null}
        {knowledgeHealthRepairState && knowledgeHealthRepairState.kind !== "repairing" ? (
          <p
            className={knowledgeHealthRepairState.kind === "committed" ? "settings-note" : "error"}
            role={knowledgeHealthRepairState.kind === "committed" ? "status" : "alert"}
            aria-live="polite"
          >
            {props.t(knowledgeHealthRepairState.kind === "committed"
              ? knowledgeHealthRepairState.issueKind === "orphan_page"
                ? "maintenance.knowledgeHealth.orphanRepairCommitted"
                : "maintenance.knowledgeHealth.repairCommitted"
              : knowledgeHealthRepairState.kind === "stale"
                ? "maintenance.knowledgeHealth.repairStale"
                : "maintenance.knowledgeHealth.repairFailed")}
          </p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="maintenance-repair-title">
        <h2 className="settings-section-title" id="maintenance-repair-title">{props.t("maintenance.repairSection")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("maintenance.resetDatabase")}</strong>
              <span>{props.t("maintenance.resetCopy")}</span>
            </div>
            <button
              ref={resetDatabaseButtonRef}
              className="settings-button danger settings-action"
              type="button"
              aria-expanded={resetConfirming}
              aria-controls="maintenance-reset-preview"
              disabled={maintenanceBusy !== null}
              onClick={beginResetConfirmation}
            >
              {props.t("maintenance.previewReset")}
            </button>
          </div>
          {resetConfirming ? (
            <div
              className="settings-row tall maintenance-reset-preview"
              id="maintenance-reset-preview"
              role="group"
              aria-labelledby="maintenance-reset-preview-title"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                cancelResetConfirmation();
              }}
            >
              <div className="settings-row-copy">
                <strong id="maintenance-reset-preview-title">{props.t("maintenance.confirmResetTitle")}</strong>
                <span>{props.t("maintenance.confirmResetDescription")}</span>
              </div>
              <div className="settings-row-control">
                <button
                  ref={cancelResetButtonRef}
                  className="settings-button"
                  type="button"
                  onClick={cancelResetConfirmation}
                >
                  {props.t("backup.restoreCancel")}
                </button>
                <button
                  className="settings-button danger"
                  type="button"
                  onClick={() => void resetLocalDatabase()}
                >
                  {props.t("maintenance.confirmReset")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      {maintenanceNotice ? (
        <p
          className={maintenanceNotice.kind === "error" ? "error" : "settings-note"}
          role={maintenanceNotice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {props.t(maintenanceNotice.key)}
        </p>
      ) : null}

      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}
