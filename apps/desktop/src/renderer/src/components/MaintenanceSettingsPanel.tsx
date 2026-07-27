import { useEffect, useRef, useState } from "react";
import type {
  KnowledgeHealthIssueKind,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRunResult,
  LocalDatabaseStatus
} from "@pige/contracts";
import type { Locale } from "@pige/schemas";

type KnowledgeHealthState =
  | { readonly kind: "not_run" | "checking" | "unavailable" | "failed" }
  | { readonly kind: "ready"; readonly result: Extract<KnowledgeHealthRunResult, { readonly status: "ready" }> };

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
  const [knowledgeHealthOpenFailed, setKnowledgeHealthOpenFailed] = useState(false);
  const resetDatabaseButtonRef = useRef<HTMLButtonElement>(null);
  const cancelResetButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const knowledgeHealthSequenceRef = useRef(0);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      knowledgeHealthSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    knowledgeHealthSequenceRef.current += 1;
    setKnowledgeHealthState({ kind: "not_run" });
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

  const runKnowledgeHealth = async (): Promise<void> => {
    if (knowledgeHealthState.kind === "checking") return;
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
        aria-busy={knowledgeHealthState.kind === "checking" ? "true" : undefined}
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
              disabled={knowledgeHealthState.kind === "checking"}
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
              t={props.t}
            />
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

function KnowledgeHealthReadyResult(props: {
  readonly result: Extract<KnowledgeHealthRunResult, { readonly status: "ready" }>;
  readonly groupedIssues: readonly {
    readonly kind: KnowledgeHealthIssueKind;
    readonly issues: readonly KnowledgeHealthIssueSummary[];
  }[];
  readonly locale: Locale;
  readonly onOpenPage: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const resultDescription = props.result.counts.totalIssueCount === 0
    ? props.t("maintenance.knowledgeHealth.readyZero")
    : `${props.result.counts.totalIssueCount} ${props.t("maintenance.knowledgeHealth.issueCount")}`;
  const checkedAt = new Intl.DateTimeFormat(props.locale === "zh-Hans" ? "zh-CN" : props.locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(props.result.checkedAt));
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{props.t("maintenance.knowledgeHealth.resultTitle")}</strong>
          <span>{resultDescription} · {props.t("maintenance.lastChecked")}: {checkedAt}</span>
        </div>
        <span className={props.result.coverage === "partial" || props.result.truncated
          ? "settings-status warning"
          : "settings-status"}
        >
          {props.t(props.result.coverage === "partial"
            ? "maintenance.knowledgeHealth.partial"
            : props.result.truncated
              ? "maintenance.knowledgeHealth.truncated"
              : "maintenance.knowledgeHealth.complete")}
        </span>
      </div>
      {props.result.coverage === "partial" ? (
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{props.t("maintenance.knowledgeHealth.partialTitle")}</strong>
            <span>{props.result.invalidPageCount} {props.t("maintenance.knowledgeHealth.invalidPageCount")}</span>
          </div>
        </div>
      ) : null}
      {props.result.truncated ? (
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{props.t("maintenance.knowledgeHealth.truncatedTitle")}</strong>
            <span>{props.t("maintenance.knowledgeHealth.truncatedDescription")}</span>
          </div>
        </div>
      ) : null}
      {props.groupedIssues.map((group) => (
        <div key={group.kind} className="settings-row tall">
          <div className="settings-row-copy">
            <strong>{props.t(`maintenance.knowledgeHealth.kind.${group.kind}`)}</strong>
            {group.issues.map((issue) => (
              <KnowledgeHealthIssueRow
                key={knowledgeHealthIssueKey(issue)}
                issue={issue}
                onOpenPage={props.onOpenPage}
                t={props.t}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function KnowledgeHealthIssueRow(props: {
  readonly issue: KnowledgeHealthIssueSummary;
  readonly onOpenPage: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.issue.kind === "duplicate_topic") {
    return (
      <span>
        {props.issue.pages.map((page, index) => (
          <span key={page.pageId}>
            {index > 0 ? " · " : ""}
            <button className="settings-button" type="button" onClick={() => void props.onOpenPage(page.pageId)}>
              {page.title}
            </button>
          </span>
        ))}
        {props.issue.candidatePageCount > props.issue.pages.length
          ? ` · +${props.issue.candidatePageCount - props.issue.pages.length}`
          : ""}
      </span>
    );
  }
  const detail = props.issue.kind === "broken_link"
    ? ` · ${props.issue.unresolvedLinkCount} ${props.t("maintenance.knowledgeHealth.unresolvedLinks")}`
    : "";
  const page = props.issue.page;
  return (
    <span>
      <button className="settings-button" type="button" onClick={() => void props.onOpenPage(page.pageId)}>
        {page.title}
      </button>
      {detail}
    </span>
  );
}

function knowledgeHealthIssueKey(issue: KnowledgeHealthIssueSummary): string {
  return issue.kind === "duplicate_topic"
    ? `${issue.kind}:${issue.pages.map(({ pageId }) => pageId).join(":")}`
    : `${issue.kind}:${issue.page.pageId}`;
}
