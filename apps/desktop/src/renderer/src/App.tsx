import { useEffect, useRef, useState, type DragEvent } from "react";
import { ProposalReviewPanel } from "./components/ProposalReviewPanel";
import deMessages from "./locales/de/messages.json";
import enMessages from "./locales/en/messages.json";
import frMessages from "./locales/fr/messages.json";
import jaMessages from "./locales/ja/messages.json";
import koMessages from "./locales/ko/messages.json";
import zhHansMessages from "./locales/zh-Hans/messages.json";
import type {
  AgentConversationTimeline,
  AgentTurnAnswer,
  AgentTurnDraftEvent,
  AgentSubmitTurnResult,
  AgentRuntimeStatus,
  AppHealth,
  BackupRestoreStatus,
  DiagnosticsHealth,
  HomeAgentModelUsage,
  JobSummary,
  KnowledgeActivitySummary,
  LibraryListResult,
  LibraryPageSummary,
  LibraryRelatedPage,
  LibraryRelatedResult,
  LocalDatabaseStatus,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  NoteRenderResult,
  OnboardingStatus,
  PigeErrorSummary,
  ProviderConnectNeedsManualModel,
  ProposalDecisionResult,
  ProposalSummary,
  RecentVaultSummary,
  RetrievalAskResult,
  RetrievalSearchResultItem,
  RestorePreviewResult,
  SupportBundlePreview,
  ToolchainHealth,
  VaultSummary,
  WindowState
} from "@pige/contracts";
import type {
  ConfirmationProposal,
  JobState,
  Locale,
  ProviderEndpointProtocol,
  SourceStorageStrategy,
  WindowLayoutMode
} from "@pige/schemas";

type View = "home" | "library" | "settings" | "models";
type CaptureToast = { readonly kind: "success" | "error"; readonly message: string };
type NoteRelatedState = LibraryRelatedResult | "loading" | "unavailable" | null;
type HomeAgentUiState = "idle" | "accepted" | "running" | "waiting" | "failed" | "completed";
type ActiveAgentDraftBinding = {
  readonly clientTurnId: string;
  requestId?: string;
  jobId?: string;
  conversationId?: string;
  conversationEventId?: string;
  sequence: number;
};

const initialVaultName = "Pige Vault";
const localeLabels: Record<Locale, string> = {
  "zh-Hans": "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch"
};
const messageCatalogs: Record<Locale, Record<string, string>> = {
  "zh-Hans": zhHansMessages,
  en: enMessages,
  ja: jaMessages,
  ko: koMessages,
  fr: frMessages,
  de: deMessages
};

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<readonly RecentVaultSummary[]>([]);
  const [vaultName, setVaultName] = useState(initialVaultName);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [view, setView] = useState<View>("home");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<DiagnosticsHealth | null>(null);
  const [localDatabaseStatus, setLocalDatabaseStatus] = useState<LocalDatabaseStatus | null>(null);
  const [supportBundlePreview, setSupportBundlePreview] = useState<SupportBundlePreview | null>(null);
  const [modelSummary, setModelSummary] = useState<ModelProviderSettingsSummary | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupRestoreStatus | null>(null);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [availableLocales, setAvailableLocales] = useState<readonly Locale[]>(["zh-Hans", "en", "ja", "ko", "fr", "de"]);
  const [toolchainHealth, setToolchainHealth] = useState<ToolchainHealth | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [homeDraftText, setHomeDraftText] = useState("");
  const [captureToast, setCaptureToast] = useState<CaptureToast | null>(null);
  const [recentJobs, setRecentJobs] = useState<readonly JobSummary[]>([]);
  const [recentActivities, setRecentActivities] = useState<readonly KnowledgeActivitySummary[]>([]);
  const [activityUndoingId, setActivityUndoingId] = useState<string | null>(null);
  const [activityBlockedIds, setActivityBlockedIds] = useState<readonly string[]>([]);
  const [readyProposals, setReadyProposals] = useState<readonly ProposalSummary[]>([]);
  const [libraryList, setLibraryList] = useState<LibraryListResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const noteOpenSequence = useRef(0);

  useEffect(() => {
    void window.pige.getHealth().then(setHealth);
    void window.pige.window.current().then(setWindowState);
    void window.pige.settings.appearance().then((appearance) => {
      setLocale(appearance.locale);
      setAvailableLocales(appearance.availableLocales);
    });
    void window.pige.system.toolchainHealth().then(setToolchainHealth);
    void refreshVaultState();
  }, []);

  useEffect(() => {
    if (!recentJobs.some((job) => job.state === "queued" || job.state === "running")) return;
    const timer = window.setTimeout(() => void refreshVaultState(), 1_200);
    return () => window.clearTimeout(timer);
  }, [recentJobs]);

  const t = (key: string): string => messageCatalogs[locale][key] ?? messageCatalogs.en[key] ?? key;

  const refreshVaultState = async (): Promise<void> => {
    const nextOnboarding = await window.pige.vault.onboardingStatus();
    const [nextRecentVaults, nextBackupStatus, nextAgentRuntimeStatus] = await Promise.all([
      window.pige.vault.recent(),
      window.pige.backup.status(),
      window.pige.agent.runtimeStatus()
    ]);
    const homeJobStateFilter = {
      states: ["queued", "running", "waiting_dependency", "failed_retryable", "failed_final"] as JobState[]
    };
    homeJobStateFilter.states.push("awaiting_review");
    homeJobStateFilter.states.push("cancel_requested");
    const [nextJobs, nextProposals, nextActivities] = nextOnboarding.activeVault
      ? await Promise.all([
        window.pige.jobs.list({
          limit: 6,
          classes: ["capture", "parse", "ocr", "agent_ingest", "agent_turn", "index_rebuild"],
          ...homeJobStateFilter
        }).catch(() => undefined),
        window.pige.proposals.list({ limit: 100, states: ["ready"] }).catch(() => undefined),
        window.pige.activity.list({ limit: 5 }).catch(() => undefined)
      ])
      : [undefined, undefined, undefined];
    setOnboarding(nextOnboarding);
    setRecentVaults(nextRecentVaults);
    setBackupStatus(nextBackupStatus);
    setAgentRuntimeStatus(nextAgentRuntimeStatus);
    setRecentJobs(nextJobs?.jobs ?? []);
    setReadyProposals(nextProposals?.proposals ?? []);
    setRecentActivities(nextActivities?.activities ?? []);
  };

  const runVaultAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshVaultState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const createVault = (): Promise<void> =>
    runVaultAction(async () => {
      const result = await window.pige.vault.create({ vaultName });
      if (result.status === "completed") setView("home");
    });

  const openVault = (): Promise<void> =>
    runVaultAction(async () => {
      const result = await window.pige.vault.open();
      if (result.status === "completed") setView("home");
    });

  const removeRecent = (vaultId: string): Promise<void> =>
    runVaultAction(async () => {
      setRecentVaults(await window.pige.vault.removeRecent(vaultId));
    });

  const refreshDiagnostics = async (): Promise<void> => {
    const [nextDiagnostics, nextDatabaseStatus, nextToolchainHealth] = await Promise.all([
      window.pige.diagnostics.health(),
      window.pige.maintenance.localDatabaseStatus(),
      window.pige.system.toolchainHealth()
    ]);
    setDiagnosticsHealth(nextDiagnostics);
    setLocalDatabaseStatus(nextDatabaseStatus);
    setToolchainHealth(nextToolchainHealth);
  };

  const refreshModels = async (): Promise<void> => {
    setModelSummary(await window.pige.models.summary());
  };

  const refreshLibrary = async (): Promise<void> => {
    setLibraryError(null);
    try {
      setLibraryList(await window.pige.library.list({ limit: 50 }));
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : t("error.generic"));
    }
  };

  const openNote = async (pageId: string): Promise<void> => {
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setLibraryError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (requestId !== noteOpenSequence.current) return;
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    } catch (caught) {
      if (requestId !== noteOpenSequence.current) return;
      setLibraryError(caught instanceof Error ? caught.message : t("error.generic"));
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  const toggleSidebar = async (): Promise<void> => {
    const nextSidebarOpen = !(windowState?.sidebarOpen ?? false);
    setWindowState(await window.pige.window.setSidebarOpen({ sidebarOpen: nextSidebarOpen }));
  };

  const setWindowMode = async (mode: WindowLayoutMode): Promise<void> => {
    setWindowState(await window.pige.window.setMode({ mode }));
  };

  const toggleAlwaysOnTop = async (): Promise<void> => {
    setWindowState(await window.pige.window.setAlwaysOnTop({ alwaysOnTop: !(windowState?.alwaysOnTop ?? false) }));
  };

  const updateLocale = async (nextLocale: Locale): Promise<void> => {
    const appearance = await window.pige.settings.setLocale({ locale: nextLocale });
    setLocale(appearance.locale);
    setAvailableLocales(appearance.availableLocales);
  };

  const submitFiles = async (
    files: readonly File[],
    inputKind: "file_drop" | "file_picker",
    text?: string,
    clientTurnId = createAgentClientTurnId()
  ): Promise<AgentSubmitTurnResult | undefined> => {
    if (files.length === 0) return undefined;
    if (files.length > 1) {
      setCaptureToast({ kind: "error", message: t("home.oneFilePerTurn") });
      return undefined;
    }
    if (!onboarding?.activeVault) {
      setCaptureToast({ kind: "error", message: t("home.createVaultBeforeDrop") });
      return undefined;
    }

    try {
      const submission = window.pige.agent.submitTurn({
        schemaVersion: 1,
        clientTurnId,
        ...(text?.trim() ? { text: text.trim() } : {}),
        inputKind,
        objective: "auto",
        locale
      }, files);
      void submission.catch(() => undefined);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await refreshVaultState();
      const result = await submission;
      setCaptureToast(result.state === "completed"
        ? { kind: "success", message: result.answer.answer }
        : { kind: "error", message: t(result.error.messageKey) });
      await refreshVaultState();
      return result;
    } catch {
      setCaptureToast({ kind: "error", message: t("error.generic") });
      return undefined;
    }
  };

  const cancelJob = async (jobId: string): Promise<void> => {
    const result = await window.pige.jobs.cancel({ jobId });
    if (result.status === "cancelled" || result.status === "cancel_requested") {
      setCaptureToast({
        kind: "success",
        message: t(result.status === "cancel_requested" ? "home.jobCancelRequested" : "home.jobCancelled")
      });
      await refreshVaultState();
      return;
    }
    setCaptureToast({ kind: "error", message: t("error.generic") });
  };

  const retryJob = async (jobId: string): Promise<void> => {
    const result = await window.pige.jobs.retry({ jobId });
    if (result.status === "requeued") {
      setCaptureToast({ kind: "success", message: t("home.jobRequeued") });
      await refreshVaultState();
      return;
    }
    setCaptureToast({ kind: "error", message: t("error.generic") });
  };

  const undoActivity = async (operationId: string): Promise<void> => {
    if (activityUndoingId) return;
    setActivityUndoingId(operationId);
    try {
      const result = await window.pige.activity.undo({ operationId });
      setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
      setCaptureToast({
        kind: "success",
        message: t(result.status === "already_undone" ? "activity.alreadyUndone" : "activity.undoCompleted")
      });
      await refreshVaultState();
    } catch {
      try {
        const current = await window.pige.activity.list({ limit: 20 });
        const exact = current.activities.find((activity) => activity.operationId === operationId);
        if (exact?.status === "undone") {
          setRecentActivities(current.activities.slice(0, 5));
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "success", message: t("activity.undoCompleted") });
        } else if (exact?.status === "applied" && exact.canUndo) {
          setRecentActivities(current.activities.slice(0, 5));
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "error", message: t("activity.undoFailed") });
        } else {
          if (exact) setRecentActivities(current.activities.slice(0, 5));
          setActivityBlockedIds((blocked) => Array.from(new Set([...blocked, operationId])));
          setCaptureToast({ kind: "error", message: t("activity.undoStateUnknown") });
        }
      } catch {
        setActivityBlockedIds((blocked) => Array.from(new Set([...blocked, operationId])));
        setCaptureToast({ kind: "error", message: t("activity.undoStateUnknown") });
      }
    } finally {
      setActivityUndoingId(null);
      restoreActivityFocus(operationId);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    setDropActive(false);
    void submitFiles(
      Array.from(event.dataTransfer.files),
      "file_drop",
      view === "home" ? homeDraftText : undefined
    );
  };

  const activeVault = onboarding?.activeVault;
  const blocked = !onboarding || onboarding.state === "blocked_no_vault";
  const sidebarOpen = windowState?.sidebarOpen ?? false;

  return (
    <main
      className={`shell mode-${windowState?.mode ?? "compact"}${dropActive ? " drop-active" : ""}`}
      aria-label="Pige"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <button
          className="icon-button"
          type="button"
          aria-label={sidebarOpen ? t("topbar.collapseSidebar") : t("topbar.expandSidebar")}
          onClick={() => void toggleSidebar()}
        >
          =
        </button>
        <span>Pige</span>
        <div className="topbar-actions">
          <span className="status">{health?.status === "ok" ? t("status.ready") : t("status.starting")}</span>
          <select
            className="locale-select"
            aria-label={t("language.label")}
            value={locale}
            onChange={(event) => void updateLocale(event.target.value as Locale)}
          >
            {availableLocales.map((availableLocale) => (
              <option key={availableLocale} value={availableLocale}>
                {localeLabels[availableLocale]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={windowState?.alwaysOnTop ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.pin")}
            title={t("topbar.pin")}
            aria-pressed={windowState?.alwaysOnTop ?? false}
            onClick={() => void toggleAlwaysOnTop()}
          >
            {t("topbar.pinShort")}
          </button>
          <button
            type="button"
            className={windowState?.mode === "compact" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.compact")}
            title={t("topbar.compact")}
            aria-pressed={windowState?.mode === "compact"}
            onClick={() => void setWindowMode("compact")}
          >
            C
          </button>
          <button
            type="button"
            className={windowState?.mode === "expanded" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.expanded")}
            title={t("topbar.expanded")}
            aria-pressed={windowState?.mode === "expanded"}
            onClick={() => void setWindowMode("expanded")}
          >
            W
          </button>
          <button
            type="button"
            className={windowState?.mode === "fullscreen" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.fullscreen")}
            title={t("topbar.fullscreen")}
            aria-pressed={windowState?.mode === "fullscreen"}
            onClick={() => void setWindowMode("fullscreen")}
          >
            F
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen ? (
          <aside className="sidebar">
            <button className={view === "home" ? "nav-item active" : "nav-item"} type="button" onClick={() => setView("home")}>
              {t("nav.home")}
            </button>
            <button
              className={view === "library" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => {
                setView("library");
                void refreshLibrary();
              }}
            >
              {t("nav.library")}
            </button>
            <button
              className={view === "settings" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => setView("settings")}
            >
              {t("nav.vaultSettings")}
            </button>
            <button
              className={view === "models" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => {
                setView("models");
                void refreshModels();
              }}
            >
              {t("nav.models")}
            </button>
          </aside>
        ) : null}

        {blocked ? (
          <FirstRunPanel
            busy={busy}
            error={error}
            recentVaults={recentVaults}
            vaultName={vaultName}
            onCreate={createVault}
            onOpen={openVault}
            onRemoveRecent={removeRecent}
            onRestoreCompleted={async () => {
              await refreshVaultState();
              setView("home");
            }}
            onVaultNameChange={setVaultName}
            onError={setError}
            t={t}
          />
        ) : view === "library" && activeVault ? (
          <LibraryPanel
            libraryList={libraryList}
            selectedNote={selectedNote}
            selectedNoteRelated={selectedNoteRelated}
            noteLoadingPageId={noteLoadingPageId}
            error={libraryError}
            onRefresh={refreshLibrary}
            onOpenNote={openNote}
            onCloseNote={() => {
              noteOpenSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
            t={t}
          />
        ) : view === "settings" && activeVault ? (
          <VaultSettingsPanel
            busy={busy}
            error={error}
            vault={activeVault}
            diagnosticsHealth={diagnosticsHealth}
            localDatabaseStatus={localDatabaseStatus}
            supportBundlePreview={supportBundlePreview}
            backupStatus={backupStatus}
            toolchainHealth={toolchainHealth}
            recentVaults={recentVaults}
            onOpen={openVault}
            onCreate={createVault}
            onRefresh={refreshVaultState}
            onRefreshDiagnostics={refreshDiagnostics}
            onSupportBundlePreviewChange={setSupportBundlePreview}
            onRemoveRecent={removeRecent}
            onError={setError}
            t={t}
          />
        ) : view === "models" ? (
          <ModelSettingsPanel
            busy={busy}
            error={error}
            modelSummary={modelSummary}
            onRefreshModels={refreshModels}
            onRefreshVaultState={refreshVaultState}
            onError={setError}
            onBusy={setBusy}
            t={t}
          />
        ) : (
          <HomeComposer
            activeVault={activeVault}
            captureOnly={onboarding?.state === "capture_only"}
            agentRuntimeStatus={agentRuntimeStatus}
            recentJobs={recentJobs}
            recentActivities={recentActivities}
            activityUndoingId={activityUndoingId}
            activityBlockedIds={activityBlockedIds}
            readyProposals={readyProposals}
            locale={locale}
            draftText={homeDraftText}
            onDraftChange={setHomeDraftText}
            onFilesSelected={(files, text, clientTurnId) => submitFiles(files, "file_picker", text, clientTurnId)}
            onCancelJob={cancelJob}
            onRetryJob={retryJob}
            onUndoActivity={undoActivity}
            onHomeStateChanged={refreshVaultState}
            onProposalChanged={refreshVaultState}
            onOpenModels={() => setView("models")}
            t={t}
          />
        )}
      </div>
      {dropActive ? <div className="drop-overlay">{t("home.dropToCapture")}</div> : null}
      {captureToast ? (
        <div
          className={`capture-toast ${captureToast.kind}`}
          role={captureToast.kind === "error" ? "alert" : "status"}
          aria-live={captureToast.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {captureToast.message}
        </div>
      ) : null}
    </main>
  );
}

function restoreActivityFocus(operationId: string): void {
  window.setTimeout(() => {
    const undoButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-undo-id]"))
      .find((element) => element.dataset.activityUndoId === operationId && !element.disabled);
    const activityRow = Array.from(document.querySelectorAll<HTMLElement>("[data-activity-row-id]"))
      .find((element) => element.dataset.activityRowId === operationId);
    const composer = document.querySelector<HTMLTextAreaElement>('[data-home-composer="true"]');
    (undoButton ?? activityRow ?? composer)?.focus();
  }, 0);
}

function LibraryPanel(props: {
  readonly libraryList: LibraryListResult | null;
  readonly selectedNote: NoteRenderResult | null;
  readonly selectedNoteRelated: NoteRelatedState;
  readonly noteLoadingPageId: string | null;
  readonly error: string | null;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly onCloseNote: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const pages = props.libraryList?.pages ?? [];

  if (props.selectedNote) {
    return (
      <section className="library-page reader-page" aria-label={props.t("note.reader")}>
        <button type="button" className="ghost back-button" onClick={props.onCloseNote}>
          {props.t("note.backToLibrary")}
        </button>
        <NoteReader
          note={props.selectedNote}
          related={props.selectedNoteRelated}
          relatedLoadingPageId={props.noteLoadingPageId}
          onOpenRelated={props.onOpenNote}
          t={props.t}
        />
        {props.error ? <p className="error">{props.error}</p> : null}
      </section>
    );
  }

  return (
    <section className="library-page" aria-label={props.t("nav.library")}>
      <header className="library-header">
        <div>
          <h1>{props.t("library.title")}</h1>
          <p className="muted">{props.t("library.subtitle")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void props.onRefresh()}>
          {props.t("library.refresh")}
        </button>
      </header>

      <div className="library-meta">
        <span>
          {props.t("library.total")}: {props.libraryList?.total ?? 0}
        </span>
        {props.libraryList && props.libraryList.invalidPageCount > 0 ? (
          <span>
            {props.t("library.invalid")}: {props.libraryList.invalidPageCount}
          </span>
        ) : null}
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}
      {!props.libraryList && !props.error ? (
        <p className="library-empty">{props.t("library.loading")}</p>
      ) : pages.length === 0 ? (
        <p className="library-empty">{props.t("library.empty")}</p>
      ) : (
        <div className="library-list">
          {pages.map((page) => (
            <LibraryPageRow
              key={page.pageId}
              page={page}
              loading={props.noteLoadingPageId === page.pageId}
              onOpen={props.onOpenNote}
              t={props.t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryPageRow(props: {
  readonly page: LibraryPageSummary;
  readonly loading: boolean;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const typeLabel = props.t(`library.type.${props.page.pageType}`);
  return (
    <article className="library-row">
      <div className="library-row-main">
        <strong>{props.page.title}</strong>
        <span>{props.page.pagePath}</span>
      </div>
      <div className="library-row-meta">
        <span>{typeLabel}</span>
        <span>{props.page.status}</span>
        {props.page.language ? <span>{props.page.language}</span> : null}
        {props.page.sourceIds.length > 0 ? (
          <span>
            {props.t("library.sources")}: {props.page.sourceIds.length}
          </span>
        ) : null}
        <button type="button" className="ghost" disabled={props.loading} onClick={() => void props.onOpen(props.page.pageId)}>
          {props.loading ? props.t("note.opening") : props.t("note.open")}
        </button>
      </div>
    </article>
  );
}

async function loadNoteRelated(
  pageId: string,
  requestId: number,
  sequence: { readonly current: number },
  setRelated: (related: NoteRelatedState) => void
): Promise<void> {
  try {
    const related = await window.pige.library.related({ pageId, limit: 8 });
    if (requestId === sequence.current) setRelated(related);
  } catch {
    if (requestId === sequence.current) setRelated("unavailable");
  }
}

function NoteReader(props: {
  readonly note: NoteRenderResult;
  readonly related: NoteRelatedState;
  readonly relatedLoadingPageId: string | null;
  readonly onOpenRelated: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const summary = props.note.summary;

  return (
    <article className="note-reader">
      <header className="note-header">
        <div>
          <p className="note-kicker">{props.t(`library.type.${summary.pageType}`)}</p>
          <h1>{summary.title}</h1>
        </div>
        <div className="note-meta" aria-label={props.t("note.metadata")}>
          <span>{summary.status}</span>
          {summary.language ? <span>{summary.language}</span> : null}
          <span>{summary.pagePath}</span>
          <span>
            {props.t("note.size")}: {Math.ceil(props.note.byteSize / 1024)} KB
          </span>
          {summary.sourceIds.length > 0 ? (
            <span>
              {props.t("library.sources")}: {summary.sourceIds.length}
            </span>
          ) : null}
        </div>
      </header>
      <div
        className="markdown-body"
        // HTML is produced by the main-process Markdown renderer after sanitization.
        dangerouslySetInnerHTML={{ __html: props.note.html }}
      />
      <NoteRelatedPanel
        related={props.related}
        loadingPageId={props.relatedLoadingPageId}
        onOpen={props.onOpenRelated}
        t={props.t}
      />
    </article>
  );
}

function NoteRelatedPanel(props: {
  readonly related: NoteRelatedState;
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.related === "loading" || props.related === "unavailable") {
    return (
      <aside className="note-related" aria-label={props.t("note.related")}>
        <h2>{props.t("note.related")}</h2>
        <p className="related-empty">
          {props.related === "loading" ? props.t("note.relatedLoading") : props.t("note.relatedUnavailable")}
        </p>
      </aside>
    );
  }

  const outgoing = props.related?.outgoing ?? [];
  const backlinks = props.related?.backlinks ?? [];
  const total = (props.related?.totalOutgoing ?? 0) + (props.related?.totalBacklinks ?? 0);

  if (!props.related || total === 0) {
    return (
      <aside className="note-related" aria-label={props.t("note.related")}>
        <h2>{props.t("note.related")}</h2>
        <p className="related-empty">{props.related?.degraded ? props.t("note.relatedUnavailable") : props.t("note.relatedEmpty")}</p>
      </aside>
    );
  }

  return (
    <aside className="note-related" aria-label={props.t("note.related")}>
      <h2>{props.t("note.related")}</h2>
      <RelatedGroup
        title={props.t("note.outgoingLinks")}
        pages={outgoing}
        loadingPageId={props.loadingPageId}
        onOpen={props.onOpen}
        t={props.t}
      />
      <RelatedGroup
        title={props.t("note.backlinks")}
        pages={backlinks}
        loadingPageId={props.loadingPageId}
        onOpen={props.onOpen}
        t={props.t}
      />
    </aside>
  );
}

function RelatedGroup(props: {
  readonly title: string;
  readonly pages: readonly LibraryRelatedPage[];
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.pages.length === 0) return null;

  return (
    <section className="related-group">
      <h3>{props.title}</h3>
      <div className="related-list">
        {props.pages.map((page) => (
          <article className="related-row" key={`${page.relation}:${page.summary.pageId}`}>
            <div>
              <strong>{page.summary.title}</strong>
              <span>{page.target || page.summary.pagePath}</span>
            </div>
            <button
              type="button"
              className="ghost"
              aria-label={`${props.t("note.open")}: ${page.summary.title}`}
              disabled={props.loadingPageId === page.summary.pageId}
              onClick={() => void props.onOpen(page.summary.pageId)}
            >
              {props.loadingPageId === page.summary.pageId ? props.t("note.opening") : props.t("note.open")}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function dragEventHasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

interface FirstRunPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly vaultName: string;
  readonly onCreate: () => Promise<void>;
  readonly onOpen: () => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onRestoreCompleted: () => Promise<void>;
  readonly onVaultNameChange: (value: string) => void;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function FirstRunPanel(props: FirstRunPanelProps): React.JSX.Element {
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResult | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const previewRestore = async (): Promise<void> => {
    props.onError(null);
    setRestorePreview(null);
    setRestoreBusy(true);
    try {
      const result = await window.pige.backup.previewRestore();
      if (result.status === "ready") setRestorePreview(result);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setRestoreBusy(false);
    }
  };

  const applyRestore = async (): Promise<void> => {
    if (!restorePreview?.backupPath || !restorePreview.previewToken) return;
    props.onError(null);
    setRestoreBusy(true);
    try {
      const result = await window.pige.backup.applyRestore({
        backupPath: restorePreview.backupPath,
        previewToken: restorePreview.previewToken
      });
      if (result.status === "restored") {
        setRestorePreview(null);
        await props.onRestoreCompleted();
      }
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <section className="first-run" aria-label={props.t("firstRun.aria")}>
      <div className="first-run-copy">
        <h1>Pige</h1>
        <p>{props.t("firstRun.subtitle")}</p>
      </div>

      <div className="vault-create">
        <label htmlFor="vault-name">{props.t("firstRun.vaultName")}</label>
        <input
          id="vault-name"
          value={props.vaultName}
          onChange={(event) => props.onVaultNameChange(event.target.value)}
          disabled={props.busy}
        />
        <button type="button" onClick={props.onCreate} disabled={props.busy}>
          {props.t("firstRun.createVault")}
        </button>
        <button type="button" className="secondary" onClick={props.onOpen} disabled={props.busy}>
          {props.t("firstRun.openExisting")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.busy || restoreBusy}
          title={props.t("firstRun.restoreHint")}
          onClick={() => void previewRestore()}
        >
          {props.t("firstRun.restoreBackup")}
        </button>
      </div>

      {restorePreview?.manifest ? (
        <div className="support-preview">
          <strong>{props.t("backup.restorePreview")}</strong>
          <span>{props.t("backup.vault")}: {restorePreview.manifest.vaultName}</span>
          <span>{props.t("backup.createdAt")}: {restorePreview.manifest.createdAt}</span>
          <span>{props.t("counts.notes")}: {restorePreview.manifest.noteCount}</span>
          <span>{props.t("counts.sources")}: {restorePreview.manifest.sourceCount}</span>
          <span>{props.t("backup.invalidFiles")}: {restorePreview.invalidFileCount ?? 0}</span>
          <button
            type="button"
            className="secondary"
            disabled={restoreBusy || (restorePreview.invalidFileCount ?? 0) > 0}
            onClick={() => void applyRestore()}
          >
            {props.t("backup.restoreApply")}
          </button>
        </div>
      ) : null}

      <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

function HomeComposer(props: {
  readonly activeVault: VaultSummary | undefined;
  readonly captureOnly: boolean;
  readonly agentRuntimeStatus: AgentRuntimeStatus | null;
  readonly recentJobs: readonly JobSummary[];
  readonly recentActivities: readonly KnowledgeActivitySummary[];
  readonly activityUndoingId: string | null;
  readonly activityBlockedIds: readonly string[];
  readonly readyProposals: readonly ProposalSummary[];
  readonly locale: Locale;
  readonly draftText: string;
  readonly onDraftChange: (text: string) => void;
  readonly onFilesSelected: (
    files: readonly File[],
    text: string | undefined,
    clientTurnId: string
  ) => Promise<AgentSubmitTurnResult | undefined>;
  readonly onCancelJob: (jobId: string) => Promise<void>;
  readonly onRetryJob: (jobId: string) => Promise<void>;
  readonly onUndoActivity: (operationId: string) => Promise<void>;
  readonly onHomeStateChanged: () => Promise<void>;
  readonly onProposalChanged: () => Promise<void>;
  readonly onOpenModels: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const text = props.draftText;
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [agentAnswer, setAgentAnswer] = useState<AgentTurnAnswer | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentTurnDraftEvent | null>(null);
  const [agentRunState, setAgentRunState] = useState<HomeAgentUiState>("idle");
  const [agentError, setAgentError] = useState<PigeErrorSummary | null>(null);
  const [agentModelUsage, setAgentModelUsage] = useState<HomeAgentModelUsage>("none");
  const [conversationTimeline, setConversationTimeline] = useState<AgentConversationTimeline | undefined>();
  const [liveAnswerEventId, setLiveAnswerEventId] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ConfirmationProposal | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [openingProposalId, setOpeningProposalId] = useState<string | null>(null);
  const [proposalListExpanded, setProposalListExpanded] = useState(false);
  const [proposalOutcome, setProposalOutcome] = useState<ProposalDecisionResult["status"] | null>(null);
  const [proposalDecisionStateUnknown, setProposalDecisionStateUnknown] = useState(false);
  const [proposalErrorMessageKey, setProposalErrorMessageKey] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRevisionRef = useRef(0);
  const noteOpenSequence = useRef(0);
  const proposalDecisionInFlight = useRef(false);
  const proposalReviewTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const proposalFocusReturnId = useRef<string | null>(null);
  const proposalFocusReturnPending = useRef(false);
  const proposalQueueHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const conversationLoadSequence = useRef(0);
  const activeVaultIdRef = useRef<string | undefined>(props.activeVault?.vaultId);
  const activeAgentDraftRef = useRef<ActiveAgentDraftBinding | null>(null);
  activeVaultIdRef.current = props.activeVault?.vaultId;
  const agentStatusLabel = props.agentRuntimeStatus?.state === "ready" ? props.t("home.agentReady") : props.t("home.captureOnly");
  const plannedModelUsage = homeRuntimeModelUsage(props.agentRuntimeStatus);
  const cloudUsageMessageKey = agentRunState === "accepted" || agentRunState === "running"
    ? plannedModelUsage === "cloud" ? "home.cloudSend" : null
    : agentModelUsage === "cloud" ? "home.cloudCallAttempted" : null;
  const latestTurn = conversationTimeline?.latestTurn;
  const retryableLatestTurn = latestTurn && (
    latestTurn.state === "failed_retryable" ||
    latestTurn.state === "cancelled" ||
    latestTurn.state === "waiting_dependency"
  ) ? latestTurn : undefined;
  const visibleConversationMessages = (conversationTimeline?.messages ?? []).filter((message) =>
    !(agentAnswer && message.role === "assistant" && message.id === liveAnswerEventId)
  );

  const beginAgentDraft = (clientTurnId: string): void => {
    activeAgentDraftRef.current = { clientTurnId, sequence: 0 };
    setAgentDraft(null);
  };

  const clearAgentDraft = (): void => {
    activeAgentDraftRef.current = null;
    setAgentDraft(null);
  };

  const refreshConversation = async (): Promise<AgentConversationTimeline | undefined> => {
    const vaultId = props.activeVault?.vaultId;
    if (!vaultId) {
      setConversationTimeline(undefined);
      return undefined;
    }
    const requestId = conversationLoadSequence.current + 1;
    conversationLoadSequence.current = requestId;
    try {
      const nextTimeline = await window.pige.agent.conversation({ limit: 24 });
      if (requestId === conversationLoadSequence.current && activeVaultIdRef.current === vaultId) {
        setConversationTimeline(nextTimeline);
      }
      return nextTimeline;
    } catch {
      return undefined;
    }
  };

  useEffect(() => window.pige.agent.onTurnDraft?.((event) => {
    if (!isAgentTurnDraftEvent(event)) return;
    const active = activeAgentDraftRef.current;
    if (!active || event.clientTurnId !== active.clientTurnId || event.sequence <= active.sequence) return;
    if (
      active.requestId !== undefined &&
      (
        event.requestId !== active.requestId ||
        event.jobId !== active.jobId ||
        event.conversationId !== active.conversationId ||
        event.conversationEventId !== active.conversationEventId
      )
    ) {
      return;
    }
    active.requestId ??= event.requestId;
    active.jobId ??= event.jobId;
    active.conversationId ??= event.conversationId;
    active.conversationEventId ??= event.conversationEventId;
    active.sequence = event.sequence;
    setAgentDraft(event);
  }), []);

  useEffect(() => {
    conversationLoadSequence.current += 1;
    setConversationTimeline(undefined);
    setLiveAnswerEventId(null);
    setAgentAnswer(null);
    clearAgentDraft();
    setAgentError(null);
    setAgentModelUsage("none");
    setAgentRunState("idle");
    if (props.activeVault?.vaultId) void refreshConversation();
    return () => {
      conversationLoadSequence.current += 1;
    };
  }, [props.activeVault?.vaultId]);

  useEffect(() => {
    if (!latestTurn) return;
    const nextState = homeUiStateForJobState(latestTurn.state);
    if (nextState) setAgentRunState(nextState);
    setAgentError(latestTurn.error ?? null);
    if (latestTurn.state !== "queued" && latestTurn.state !== "running") clearAgentDraft();
  }, [latestTurn?.jobId, latestTurn?.state, latestTurn?.error?.code]);

  useEffect(() => {
    if (!props.activeVault?.vaultId || !isConversationPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshConversation(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.activeVault?.vaultId, latestTurn?.jobId, latestTurn?.state]);

  const submitHomeInput = async (): Promise<void> => {
    if (!text.trim()) return;
    setCaptureError(null);
    setCaptureStatus(null);
    setAgentError(null);
    setAgentRunState("idle");
    setAgentModelUsage("none");
    noteOpenSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    const turnText = text.trim();
    const submittedDraftRevision = draftRevisionRef.current;
    setAgentError(null);
    setAgentAnswer(null);
    setLiveAnswerEventId(null);
    setAgentModelUsage("none");
    setAgentRunState("accepted");
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    setAgentRunState("running");
    const followUpConversation = canFollowUpToConversation(conversationTimeline)
      ? conversationTimeline
      : undefined;
    const clientTurnId = createAgentClientTurnId();
    beginAgentDraft(clientTurnId);
    try {
      const submission = window.pige.agent.submitTurn({
        schemaVersion: 1,
        text: turnText,
        inputKind: followUpConversation ? "follow_up" : classifyTextTransportKind(turnText),
        objective: "auto",
        locale: props.locale,
        clientTurnId,
        ...(followUpConversation ? {
          conversationId: followUpConversation.conversationId,
          expectedTailEventId: followUpConversation.tailEventId
        } : {})
      });
      void submission.catch(() => undefined);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await props.onHomeStateChanged().catch(() => undefined);
      const outcome = await submission;
      if (outcome.state === "completed") {
        clearAgentDraft();
        setAgentAnswer(outcome.answer);
        setLiveAnswerEventId(outcome.tailEventId);
        setAgentModelUsage(outcome.modelUsage);
        setAgentRunState("completed");
        if (draftRevisionRef.current === submittedDraftRevision) {
          draftRevisionRef.current += 1;
          props.onDraftChange("");
        }
        await refreshConversation();
        return;
      }
      clearAgentDraft();
      setAgentModelUsage(outcome.modelUsage);
      setAgentError(outcome.error);
      setAgentRunState(outcome.state);
      if (outcome.state === "waiting" && draftRevisionRef.current === submittedDraftRevision) {
        draftRevisionRef.current += 1;
        props.onDraftChange("");
      }
      await refreshConversation();
    } catch {
      clearAgentDraft();
      setAgentError({
        code: "model_provider.call_failed",
        domain: "model_provider",
        messageKey: "errors.model_provider.call_failed",
        retryable: true,
        severity: "error",
        userAction: "retry"
      });
      setAgentRunState("failed");
      await refreshConversation();
    }
  };

  const retryLatestConversationTurn = async (): Promise<void> => {
    if (!retryableLatestTurn) return;
    setAgentError(null);
    setAgentRunState("accepted");
    await props.onRetryJob(retryableLatestTurn.jobId);
    const nextTimeline = await refreshConversation();
    const nextState = homeUiStateForJobState(nextTimeline?.latestTurn?.state);
    setAgentRunState(nextState ?? "failed");
    setAgentError(nextTimeline?.latestTurn?.error ?? null);
  };

  const openProposal = async (proposalId: string): Promise<void> => {
    proposalFocusReturnId.current = proposalId;
    setOpeningProposalId(proposalId);
    setProposalOutcome(null);
    setProposalDecisionStateUnknown(false);
    setProposalErrorMessageKey(null);
    try {
      const result = await window.pige.proposals.get({ proposalId });
      setSelectedProposal(result.proposal);
    } catch {
      setProposalErrorMessageKey("proposal.error.load");
    } finally {
      setOpeningProposalId(null);
    }
  };

  const decideProposal = async (decision: "approve" | "reject"): Promise<void> => {
    if (!selectedProposal || proposalDecisionInFlight.current) return;
    const proposalId = selectedProposal.id;
    proposalDecisionInFlight.current = true;
    setProposalBusy(true);
    setProposalDecisionStateUnknown(false);
    setProposalErrorMessageKey(null);
    try {
      const result = await window.pige.proposals[decision]({ proposalId });
      setProposalOutcome(result.status);
      if (result.proposal) setSelectedProposal(result.proposal);
      await props.onProposalChanged().catch(() => undefined);
    } catch {
      try {
        const current = await window.pige.proposals.get({ proposalId });
        if (current.proposal.id !== proposalId) throw new Error("Proposal identity changed.");
        const durableOutcome = proposalOutcomeForDurableState(current.proposal.state);
        setSelectedProposal(current.proposal);
        if (durableOutcome === null) {
          setProposalOutcome(null);
          setProposalErrorMessageKey("proposal.error.decision");
        } else if (durableOutcome !== undefined) {
          setProposalOutcome(durableOutcome);
          setProposalErrorMessageKey(null);
          await props.onProposalChanged().catch(() => undefined);
        } else {
          setProposalOutcome(null);
          setProposalDecisionStateUnknown(true);
          setProposalErrorMessageKey(null);
        }
      } catch {
        setProposalOutcome(null);
        setProposalDecisionStateUnknown(true);
        setProposalErrorMessageKey(null);
      }
    } finally {
      proposalDecisionInFlight.current = false;
      setProposalBusy(false);
    }
  };

  const closeProposal = (): void => {
    if (proposalBusy) return;
    proposalFocusReturnPending.current = true;
    setSelectedProposal(null);
    setProposalOutcome(null);
    setProposalDecisionStateUnknown(false);
    setProposalErrorMessageKey(null);
  };

  useEffect(() => {
    if (selectedProposal !== null || !proposalFocusReturnPending.current) return;
    proposalFocusReturnPending.current = false;
    const exactTrigger = proposalFocusReturnId.current
      ? proposalReviewTriggerRefs.current.get(proposalFocusReturnId.current)
      : undefined;
    const firstTrigger = Array.from(proposalReviewTriggerRefs.current.values())
      .find((trigger) => trigger.isConnected && !trigger.disabled);
    const focusTarget = exactTrigger?.isConnected
      ? exactTrigger
      : firstTrigger ?? proposalQueueHeadingRef.current ?? composerInputRef.current;
    focusTarget?.focus();
  }, [selectedProposal, props.readyProposals]);

  const openResult = async (pageId: string): Promise<void> => {
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setCaptureError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (requestId !== noteOpenSequence.current) return;
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    } catch (caught) {
      if (requestId !== noteOpenSequence.current) return;
      setCaptureError(caught instanceof Error ? caught.message : props.t("error.generic"));
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  if (selectedProposal) {
    return (
      <section className="home proposal-review-home" aria-label={props.t("nav.home")}>
        <ProposalReviewPanel
          proposal={selectedProposal}
          busy={proposalBusy}
          outcome={proposalOutcome}
          decisionStateUnknown={proposalDecisionStateUnknown}
          errorMessageKey={proposalErrorMessageKey}
          onApprove={() => void decideProposal("approve")}
          onReject={() => void decideProposal("reject")}
          onClose={closeProposal}
          t={props.t}
        />
      </section>
    );
  }

  return (
    <section className="home" aria-label={props.t("nav.home")}>
      <div className="home-center">
        <span className="vault-chip">{props.activeVault?.name ?? props.t("home.noVault")}</span>
        {props.captureOnly || props.agentRuntimeStatus ? <span className="mode-chip">{agentStatusLabel}</span> : null}
      </div>
      {props.recentJobs.length > 0 ? (
        <section className="job-strip" aria-label={props.t("home.recentCaptures")}>
          <span className="job-strip-title">
            {props.t("home.processing")}
          </span>
          {props.recentJobs.slice(0, 3).map((job) => (
            <div className="job-pill" key={job.id}>
              <span
                className={`job-state-dot state-${job.state}`}
                title={props.t(jobStateMessageKey(job.state))}
                aria-label={props.t(jobStateMessageKey(job.state))}
              />
              <span>{job.sourceDisplayName ?? job.sourceId ?? job.id}</span>
              {job.state === "queued" || (
                job.class === "agent_turn" && (job.state === "running" || job.state === "cancel_requested")
              ) ? (
                <button
                  className="job-action"
                  type="button"
                  title={props.t("home.cancelJob")}
                  aria-label={props.t("home.cancelJob")}
                  disabled={job.state === "cancel_requested"}
                  onClick={() => void props.onCancelJob(job.id)}
                >
                  {props.t("home.cancelJob")}
                </button>
              ) : job.state === "failed_retryable" && job.class !== "retrieval_query" ? (
                <button
                  className="job-action"
                  type="button"
                  title={props.t("home.retryJob")}
                  aria-label={props.t("home.retryJob")}
                  onClick={() => void props.onRetryJob(job.id)}
                >
                  {props.t("home.retryJob")}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {props.recentActivities.length > 0 ? (
        <section className="activity-strip" aria-label={props.t("activity.title")}>
          <h2>{props.t("activity.title")}</h2>
          <div className="activity-list">
            {props.recentActivities.slice(0, 3).map((activity, index) => {
              const activityMessageKey = activity.kind === "update_page"
                ? "activity.updatedPage"
                : "activity.createdPage";
              const activityLabel = `${props.t(activityMessageKey)}${activity.targetLabel ? `: ${activity.targetLabel}` : ""} (${index + 1})`;
              return (
                <article
                  className="activity-row"
                  key={activity.operationId}
                  aria-label={activityLabel}
                  data-activity-row-id={activity.operationId}
                  tabIndex={-1}
                >
                  <div>
                    <strong>
                      {props.t(activityMessageKey)}
                      {activity.targetLabel ? `: ${activity.targetLabel}` : ""}
                    </strong>
                    <span>{props.t(activity.status === "undone" ? "activity.statusUndone" : "activity.statusApplied")}</span>
                  </div>
                  {activity.canUndo ? (
                    <button
                      type="button"
                      className="ghost"
                      aria-label={`${props.t("activity.undo")}: ${activityLabel}`}
                      data-activity-undo-id={activity.operationId}
                      disabled={props.activityUndoingId !== null || props.activityBlockedIds.includes(activity.operationId)}
                      onClick={() => void props.onUndoActivity(activity.operationId)}
                    >
                      {props.t(props.activityUndoingId === activity.operationId ? "activity.undoing" : "activity.undo")}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {props.readyProposals.length > 0 ? (
        <section className="proposal-strip" aria-label={props.t("proposal.queueTitle")}>
          <header className="proposal-strip-header">
            <h2 ref={proposalQueueHeadingRef} tabIndex={-1}>{props.t("proposal.queueTitle")}</h2>
            <div className="proposal-strip-meta">
              <span>{props.readyProposals.length}</span>
              {props.readyProposals.length > 3 ? (
                <button
                  type="button"
                  className="ghost"
                  aria-expanded={proposalListExpanded}
                  aria-controls="home-proposal-summary-list"
                  onClick={() => setProposalListExpanded((expanded) => !expanded)}
                >
                  {props.t(proposalListExpanded ? "proposal.showLess" : "proposal.showAll")}
                </button>
              ) : null}
            </div>
          </header>
          <div className="proposal-summary-list" id="home-proposal-summary-list">
            {props.readyProposals.slice(0, proposalListExpanded ? props.readyProposals.length : 3).map((proposal, index) => {
              const accessibleProposalLabel = `${proposal.summary} (${index + 1})`;
              return (
                <article className="proposal-summary-card" key={proposal.id} aria-label={accessibleProposalLabel}>
                  <div>
                    <strong>{proposal.summary}</strong>
                    <p>{proposal.reason}</p>
                  </div>
                  <button
                    ref={(element) => {
                      if (element) proposalReviewTriggerRefs.current.set(proposal.id, element);
                      else proposalReviewTriggerRefs.current.delete(proposal.id);
                    }}
                    type="button"
                    className="secondary"
                    aria-label={`${props.t("proposal.review")}: ${accessibleProposalLabel}`}
                    disabled={openingProposalId !== null}
                    onClick={() => void openProposal(proposal.id)}
                  >
                    {props.t(openingProposalId === proposal.id ? "proposal.opening" : "proposal.review")}
                  </button>
                </article>
              );
            })}
          </div>
          {proposalErrorMessageKey ? (
            <p className="error" role="alert">{props.t(proposalErrorMessageKey)}</p>
          ) : null}
        </section>
      ) : null}
      {visibleConversationMessages.length > 0 || agentDraft ? (
        <section
          className="conversation-timeline"
          aria-label={props.t("home.conversation")}
          aria-busy={agentDraft !== null}
        >
          {visibleConversationMessages.map((message) => (
            <article
              className={`conversation-message role-${message.role}`}
              data-message-id={message.id}
              key={message.id}
            >
              <span className="conversation-message-role">
                {props.t(message.role === "user" ? "home.userMessage" : "home.assistantMessage")}
              </span>
              <p>{message.text}</p>
            </article>
          ))}
          {agentDraft ? (
            <article
              className="conversation-message role-assistant provisional"
              data-agent-draft="true"
              data-draft-sequence={agentDraft.sequence}
            >
              <span className="conversation-message-role">
                {props.t("home.assistantMessage")}
              </span>
              <p>{agentDraft.text}</p>
            </article>
          ) : null}
        </section>
      ) : null}
      {selectedNote ? (
        <section className="home-reader">
          <button
            type="button"
            className="ghost back-button"
            onClick={() => {
              noteOpenSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
          >
            {props.t("retrieval.backToResults")}
          </button>
          <NoteReader
            note={selectedNote}
            related={selectedNoteRelated}
            relatedLoadingPageId={noteLoadingPageId}
            onOpenRelated={openResult}
            t={props.t}
          />
        </section>
      ) : agentAnswer?.retrieval ? (
        <RetrievalResults
          result={toRetrievalAskResult(agentAnswer)}
          modelUsage={agentModelUsage}
          noteLoadingPageId={noteLoadingPageId}
          onOpen={openResult}
          t={props.t}
        />
      ) : agentAnswer ? (
        <section className="retrieval-answer" aria-live="polite">
          <p>{agentAnswer.answer}</p>
        </section>
      ) : null}
      <section className="composer">
        <textarea
          ref={composerInputRef}
          data-home-composer="true"
          aria-label={props.t("home.composerAria")}
          placeholder={props.t("home.placeholder")}
          rows={4}
          value={text}
          onChange={(event) => {
            draftRevisionRef.current += 1;
            props.onDraftChange(event.target.value);
          }}
        />
        <div className="toolbar">
          <span>{props.t("home.toolbarHint")}</span>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx,.pptx,.csv,.xlsx,.sqlite,.sqlite3,.db,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,text/plain,text/markdown,image/*"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              setAgentAnswer(null);
              setLiveAnswerEventId(null);
              setAgentError(null);
              setAgentModelUsage("none");
              setAgentRunState("running");
              const clientTurnId = createAgentClientTurnId();
              beginAgentDraft(clientTurnId);
              void props.onFilesSelected(files, text, clientTurnId).then(async (result) => {
                clearAgentDraft();
                if (!result) {
                  setAgentRunState("failed");
                  return;
                }
                setAgentModelUsage(result.modelUsage);
                setAgentRunState(result.state);
                if (result.state === "completed") {
                  setAgentAnswer(result.answer);
                  setLiveAnswerEventId(result.tailEventId);
                  setAgentError(null);
                  props.onDraftChange("");
                } else {
                  setAgentAnswer(null);
                  setAgentError(result.error);
                }
                await refreshConversation();
              }).catch(() => {
                clearAgentDraft();
                setAgentRunState("failed");
              });
            }}
          />
          <button
            className="round-button"
            type="button"
            aria-label={props.t("home.attachFile")}
            onClick={() => fileInputRef.current?.click()}
          >
            +
          </button>
          <button
            type="button"
            aria-label={props.t("home.send")}
            disabled={!text.trim() || agentRunState === "accepted" || agentRunState === "running"}
            onClick={() => void submitHomeInput()}
          >
            {agentRunState === "accepted" || agentRunState === "running" ? props.t("home.agentRunning") : props.t("home.send")}
          </button>
        </div>
        {captureStatus ? <p className="capture-status">{captureStatus}</p> : null}
        {agentRunState !== "idle" ? (
          <div className={`agent-run-state state-${agentRunState}`} role="status" aria-live="polite">
            <span className="agent-run-dot" aria-hidden="true" />
            <span>{agentError ? props.t(agentError.messageKey) : props.t(`home.agentState.${agentRunState}`)}</span>
            {cloudUsageMessageKey ? (
              <span className="agent-cloud-boundary">{props.t(cloudUsageMessageKey)}</span>
            ) : null}
            {agentError?.userAction === "configure_model" ? (
              <button type="button" className="ghost" onClick={props.onOpenModels}>{props.t("home.openModels")}</button>
            ) : null}
            {retryableLatestTurn ? (
              <button type="button" className="ghost" onClick={() => void retryLatestConversationTurn()}>
                {props.t("home.retryAnswer")}
              </button>
            ) : null}
          </div>
        ) : null}
        {captureError ? <p className="error">{captureError}</p> : null}
      </section>
    </section>
  );
}

function jobStateMessageKey(state: JobState): string {
  if (state === "queued") return "home.jobQueued";
  if (state === "running") return "home.jobRunning";
  if (state === "cancel_requested") return "home.jobCancelRequested";
  if (state === "waiting_dependency") return "home.jobWaiting";
  if (state === "awaiting_review") return "home.jobReview";
  return "home.jobFailed";
}

function homeUiStateForJobState(state: JobState | undefined): HomeAgentUiState | undefined {
  if (state === "queued") return "accepted";
  if (state === "running" || state === "cancel_requested") return "running";
  if (state === "waiting_dependency" || state === "waiting_permission" || state === "awaiting_review") return "waiting";
  if (state === "completed" || state === "completed_with_warnings" || state === "compacted") return "completed";
  if (state === "failed_retryable" || state === "failed_final" || state === "cancelled") return "failed";
  return undefined;
}

function isConversationPollingState(state: JobState | undefined): boolean {
  return state === "queued" ||
    state === "running" ||
    state === "waiting_dependency" ||
    state === "cancel_requested";
}

function canFollowUpToConversation(timeline: AgentConversationTimeline | undefined): timeline is AgentConversationTimeline {
  return timeline?.canFollowUp === true && (
    timeline.latestTurn?.state === "completed" ||
    timeline.latestTurn?.state === "completed_with_warnings"
  );
}

function isAgentTurnDraftEvent(value: unknown): value is AgentTurnDraftEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AgentTurnDraftEvent>;
  const identifiers = [
    event.requestId,
    event.clientTurnId,
    event.jobId,
    event.conversationId,
    event.conversationEventId
  ];
  return event.apiVersion === 1 &&
    event.kind === "draft_replace" &&
    identifiers.every((identifier) => typeof identifier === "string" && identifier.length > 0 && identifier.length <= 256) &&
    Number.isSafeInteger(event.sequence) &&
    (event.sequence ?? 0) > 0 &&
    typeof event.text === "string" &&
    Array.from(event.text).length > 0 &&
    Array.from(event.text).length <= 8_000 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(event.text);
}

function createAgentClientTurnId(now = new Date()): string {
  const date = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0")
  ].join("");
  const opaqueId = window.crypto.randomUUID().replaceAll("-", "").toLowerCase();
  return `turn_${date}_${opaqueId}`;
}

function proposalOutcomeForDurableState(
  state: ConfirmationProposal["state"]
): ProposalDecisionResult["status"] | null | undefined {
  if (state === "ready") return null;
  if (state === "approved" || state === "applied" || state === "rejected" || state === "conflicted") return state;
  return undefined;
}

function RetrievalResults(props: {
  readonly result: RetrievalAskResult;
  readonly modelUsage: HomeAgentModelUsage;
  readonly noteLoadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="retrieval-results" aria-label={props.t("retrieval.results")}>
      <section className="retrieval-answer" aria-label={props.t("retrieval.summary")}>
        <p className="retrieval-eyebrow">{props.t("retrieval.summary")}</p>
        <p className="retrieval-answer-text">{props.result.answer}</p>
        {props.result.warnings.includes("insufficient_evidence") ? (
          <p className="muted retrieval-warning">{props.t("retrieval.insufficientEvidence")}</p>
        ) : null}
        {props.result.citations.length > 0 ? (
          <div className="retrieval-citations" aria-label={props.t("retrieval.citations")}>
            {props.result.citations.map((citation) => (
              <button
                type="button"
                className="ghost"
                key={citation.refId}
                disabled={props.noteLoadingPageId === citation.pageId}
                onClick={() => void props.onOpen(citation.pageId)}
              >
                {citation.label} {citation.title}
              </button>
            ))}
          </div>
        ) : null}
        {props.result.warnings.includes("limited_evidence") ? (
          <p className="muted retrieval-warning">{props.t("retrieval.limitedEvidence")}</p>
        ) : null}
        {props.result.degraded ? (
          <p className="muted retrieval-warning">{props.t("retrieval.degraded")}</p>
        ) : null}
      </section>
      <header className="retrieval-header">
        <div>
          <h2>{props.t("retrieval.results")}</h2>
          <p className="muted">
            {props.t(props.result.answerMode === "model_grounded" ? "retrieval.modelGrounded" : "retrieval.localOnly")} · {props.t("retrieval.total")}: {props.result.total}
          </p>
          {props.modelUsage === "cloud" ? (
            <p className="muted retrieval-cloud-boundary">{props.t("retrieval.cloudSent")}</p>
          ) : null}
        </div>
      </header>
      {props.result.results.length === 0 ? (
        <p className="library-empty">{props.t("retrieval.empty")}</p>
      ) : (
        <div className="retrieval-list">
          {props.result.results.map((item) => (
            <RetrievalResultRow
              key={item.summary.pageId}
              item={item}
              loading={props.noteLoadingPageId === item.summary.pageId}
              citationLabel={props.result.citations.find((citation) => citation.pageId === item.summary.pageId)?.label}
              onOpen={props.onOpen}
              t={props.t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function toRetrievalAskResult(answer: AgentTurnAnswer): RetrievalAskResult {
  if (!answer.retrieval) {
    throw new Error("Agent retrieval metadata is unavailable.");
  }
  return {
    ...answer.retrieval,
    answeredAt: new Date().toISOString(),
    answer: answer.answer,
    answerMode: "model_grounded",
    confidence: answer.grounding === "insufficient_evidence"
      ? "insufficient"
      : answer.citations.length > 1
        ? "grounded"
        : "limited",
    citations: answer.citations,
    warnings: answer.grounding === "insufficient_evidence"
      ? ["insufficient_evidence"]
      : [
          ...(answer.citations.length === 1 ? ["limited_evidence" as const] : []),
          ...(answer.retrieval.degraded ? ["search_degraded" as const] : [])
        ]
  };
}

function RetrievalResultRow(props: {
  readonly item: RetrievalSearchResultItem;
  readonly loading: boolean;
  readonly citationLabel: string | undefined;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <article className="retrieval-row">
      <div className="retrieval-row-main">
        <strong>{props.item.summary.title}</strong>
        <span>{props.item.snippets[0] ?? props.item.summary.pagePath}</span>
      </div>
      <div className="retrieval-row-meta">
        {props.citationLabel ? <span>{props.citationLabel}</span> : null}
        <span>{props.t(`library.type.${props.item.summary.pageType}`)}</span>
        <button type="button" className="ghost" disabled={props.loading} onClick={() => void props.onOpen(props.item.summary.pageId)}>
          {props.loading ? props.t("note.opening") : props.t("note.open")}
        </button>
      </div>
    </article>
  );
}

function homeRuntimeModelUsage(status: AgentRuntimeStatus | null): HomeAgentModelUsage {
  if (status?.state !== "ready") return "none";
  return status.policySnapshot?.cloudBoundary === "local" &&
    status.policySnapshot.boundaryVerification === "loopback_verified"
    ? "local"
    : "cloud";
}

function classifyTextTransportKind(text: string): "typed_text" | "typed_url" {
  try {
    const parsed = new URL(text);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.toString() === text
      ? "typed_url"
      : "typed_text";
  } catch {
    return "typed_text";
  }
}

interface VaultSettingsPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly vault: VaultSummary;
  readonly diagnosticsHealth: DiagnosticsHealth | null;
  readonly localDatabaseStatus: LocalDatabaseStatus | null;
  readonly supportBundlePreview: SupportBundlePreview | null;
  readonly backupStatus: BackupRestoreStatus | null;
  readonly toolchainHealth: ToolchainHealth | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onOpen: () => Promise<void>;
  readonly onCreate: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onSupportBundlePreviewChange: (preview: SupportBundlePreview | null) => void;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function VaultSettingsPanel(props: VaultSettingsPanelProps): React.JSX.Element {
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResult | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const runBackupAction = async (action: () => Promise<void>): Promise<void> => {
    props.onError(null);
    setBackupNotice(null);
    setBackupBusy(true);
    try {
      await action();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBackupBusy(false);
    }
  };

  const createBackup = async (): Promise<void> =>
    runBackupAction(async () => {
      const result = await window.pige.backup.create();
      if (result.status === "created" && result.manifest) {
        setBackupNotice(`${props.t("backup.created")}: ${result.manifest.fileCount}`);
        await props.onRefresh();
      }
    });

  const previewRestore = async (): Promise<void> =>
    runBackupAction(async () => {
      setRestorePreview(null);
      const result = await window.pige.backup.previewRestore();
      if (result.status === "ready") {
        setRestorePreview(result);
      }
    });

  const applyRestore = async (): Promise<void> => {
    if (!restorePreview?.backupPath || !restorePreview.previewToken) return;
    await runBackupAction(async () => {
      const result = await window.pige.backup.applyRestore({
        backupPath: restorePreview.backupPath!,
        previewToken: restorePreview.previewToken!
      });
      if (result.status === "restored") {
        setRestorePreview(null);
        setBackupNotice(props.t("backup.restored"));
        await props.onRefresh();
        await props.onRefreshDiagnostics();
      }
    });
  };

  const updatePolicy = async (defaultStrategy: SourceStorageStrategy): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.vault.updateSourceStoragePolicy({ defaultStrategy });
      await props.onRefresh();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const resetLocalDatabase = async (): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.maintenance.resetLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const rebuildLocalDatabase = async (): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.maintenance.rebuildLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const previewSupportBundle = async (): Promise<void> => {
    props.onError(null);
    try {
      props.onSupportBundlePreviewChange(await window.pige.diagnostics.previewSupportBundle());
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const exportSupportBundle = async (): Promise<void> => {
    if (!props.supportBundlePreview) return;
    props.onError(null);
    try {
      const result = await window.pige.diagnostics.exportSupportBundle({
        previewId: props.supportBundlePreview.previewId
      });
      if (result.status === "exported") {
        props.onSupportBundlePreviewChange(null);
        await props.onRefreshDiagnostics();
      }
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  return (
    <section className="settings-page" aria-label={props.t("nav.vaultSettings")}>
      <div>
        <h1>{props.t("vaultSettings.title")}</h1>
        <p className="muted">{props.t("vaultSettings.subtitle")}</p>
      </div>

      <InfoGroup
        title={props.t("vaultSettings.currentVault")}
        rows={[
          [props.t("field.name"), props.vault.name],
          [props.t("field.vaultPath"), props.vault.activeVaultPathDisplay],
          [props.t("field.noteStorage"), props.vault.knowledgeRootDisplay],
          [props.t("field.sourceAssets"), props.vault.sourceAssetRootDisplay],
          [props.t("field.schema"), String(props.vault.schemaVersion)]
        ]}
      />

      <section className="settings-group">
        <h2>{props.t("sourceStorage.title")}</h2>
        <select
          value={props.vault.defaultSourceStorageStrategy}
          disabled={props.busy}
          onChange={(event) => void updatePolicy(event.target.value as SourceStorageStrategy)}
        >
          <option value="copy_to_source_library">{props.t("sourceStorage.copy")}</option>
          <option value="reference_original">{props.t("sourceStorage.reference")}</option>
        </select>
      </section>

      <section className="settings-actions">
        <button type="button" onClick={() => void window.pige.vault.revealKnowledgeRoot()}>
          {props.t("vaultSettings.openInFinder")}
        </button>
        <button type="button" className="secondary" onClick={() => void window.pige.vault.revealSourceAssetRoot()}>
          {props.t("vaultSettings.openSourceAssets")}
        </button>
        <button type="button" className="secondary" onClick={props.onOpen} disabled={props.busy}>
          {props.t("vaultSettings.openAnother")}
        </button>
        <button type="button" className="secondary" onClick={props.onCreate} disabled={props.busy}>
          {props.t("vaultSettings.createNew")}
        </button>
      </section>

      <InfoGroup
        title={props.t("counts.title")}
        rows={[
          [props.t("counts.notes"), String(props.vault.counts?.notes ?? 0)],
          [props.t("counts.sources"), String(props.vault.counts?.sources ?? 0)],
          [props.t("counts.managedCopies"), String(props.vault.counts?.managedSourceCopies ?? 0)],
          [props.t("counts.referencedOriginals"), String(props.vault.counts?.referencedOriginals ?? 0)]
        ]}
      />

      <section className="settings-group">
        <h2>{props.t("backup.title")}</h2>
        <dl>
          <div className="info-row">
            <dt>{props.t("backup.lastBackup")}</dt>
            <dd>{props.backupStatus?.lastBackupAt ?? props.t("backup.never")}</dd>
          </div>
        </dl>
        <p className="muted">
          {props.backupStatus?.messageKey ? props.t(props.backupStatus.messageKey) : props.t("backup.loading")}
        </p>
        <div className="settings-actions">
          <button
            type="button"
            disabled={backupBusy || !props.backupStatus?.createAvailable}
            onClick={() => void createBackup()}
          >
            {props.t("backup.create")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={backupBusy || !props.backupStatus?.restoreAvailable}
            onClick={() => void previewRestore()}
          >
            {props.t("backup.restore")}
          </button>
        </div>
        {backupNotice ? <p className="muted">{backupNotice}</p> : null}
        {restorePreview?.manifest ? (
          <div className="support-preview">
            <strong>{props.t("backup.restorePreview")}</strong>
            <span>{props.t("backup.vault")}: {restorePreview.manifest.vaultName}</span>
            <span>{props.t("backup.createdAt")}: {restorePreview.manifest.createdAt}</span>
            <span>{props.t("counts.notes")}: {restorePreview.manifest.noteCount}</span>
            <span>{props.t("counts.sources")}: {restorePreview.manifest.sourceCount}</span>
            <span>{props.t("backup.conversations")}: {restorePreview.manifest.conversationCount}</span>
            <span>{props.t("backup.memories")}: {restorePreview.manifest.memoryCount}</span>
            <span>{props.t("backup.invalidFiles")}: {restorePreview.invalidFileCount ?? 0}</span>
            <button
              type="button"
              className="secondary"
              disabled={backupBusy || (restorePreview.invalidFileCount ?? 0) > 0}
              onClick={() => void applyRestore()}
            >
              {props.t("backup.restoreApply")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="settings-group">
        <h2>{props.t("maintenance.title")}</h2>
        <p className="muted">
          {props.t("maintenance.resetCopy")}
        </p>
        <div className="settings-actions">
          <button type="button" className="secondary" onClick={() => void rebuildLocalDatabase()}>
            {props.t("maintenance.rebuildIndex")}
          </button>
          <button type="button" className="secondary" onClick={() => void resetLocalDatabase()}>
            {props.t("maintenance.resetDatabase")}
          </button>
          <button type="button" className="secondary" onClick={() => void props.onRefreshDiagnostics()}>
            {props.t("maintenance.checkDiagnostics")}
          </button>
          <button type="button" className="secondary" onClick={() => void previewSupportBundle()}>
            {props.t("maintenance.previewSupport")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!props.supportBundlePreview}
            onClick={() => void exportSupportBundle()}
          >
            {props.t("maintenance.exportSupport")}
          </button>
        </div>
        {props.diagnosticsHealth ? (
          <p className="muted">
            {props.t("maintenance.diagnostics")}: {props.diagnosticsHealth.status}; {props.t("maintenance.recentErrors")}: {props.diagnosticsHealth.recentErrorCount}
          </p>
        ) : null}
        {props.localDatabaseStatus ? (
          <p className="muted">
            {props.t("maintenance.localDb")}: {props.localDatabaseStatus.status}; {props.t("maintenance.migrations")}: {props.localDatabaseStatus.appliedMigrationCount}
          </p>
        ) : null}
        {props.toolchainHealth ? (
          <p className="muted">
            {props.t("maintenance.toolchain")}: {props.toolchainHealth.status}; {props.t("maintenance.missingTools")}:{" "}
            {props.toolchainHealth.tools.filter((tool) => tool.status === "missing").length}
          </p>
        ) : null}
        {props.supportBundlePreview ? (
          <div className="support-preview">
            <strong>{props.t("support.previewReady")}</strong>
            <span>{props.t("support.estimatedSize")}: {Math.ceil(props.supportBundlePreview.estimatedBytes / 1024)} KB</span>
            <span>{props.t("support.included")}: {props.supportBundlePreview.includedCategories.map((category) => category.label).join(", ")}</span>
            <span>{props.t("support.excluded")}: {props.supportBundlePreview.excludedCategories.map((category) => category.label).join(", ")}</span>
          </div>
        ) : null}
      </section>

      <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

interface ModelSettingsPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly onRefreshModels: () => Promise<void>;
  readonly onRefreshVaultState: () => Promise<void>;
  readonly onError: (error: string | null) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly t: (key: string) => string;
}

function ModelSettingsPanel(props: ModelSettingsPanelProps): React.JSX.Element {
  const [presetApiKeys, setPresetApiKeys] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("Custom provider");
  const [endpointProtocol, setEndpointProtocol] = useState<ProviderEndpointProtocol>("openai_responses");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [manualBootstrap, setManualBootstrap] = useState<ProviderConnectNeedsManualModel | null>(null);
  const [providerSyncFailures, setProviderSyncFailures] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void props.onRefreshModels();
  }, []);

  const connectPreset = async (presetId: string): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      const apiKey = presetApiKeys[presetId]?.trim();
      const result = await window.pige.models.addPresetProvider({
        presetId,
        ...(apiKey ? { apiKey } : {})
      });
      if ("status" in result) throw new Error("Reviewed preset did not select a bootstrap model.");
      setPresetApiKeys((current) => ({ ...current, [presetId]: "" }));
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const saveProvider = async (): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      const result = await window.pige.models.addManualProvider({
        displayName,
        providerKind: endpointProtocol === "anthropic_messages" ? "anthropic_compatible" : "custom",
        endpointProtocol,
        baseUrl: baseUrl.trim(),
        apiKey,
        ...(manualBootstrap ? { manualModelId: manualModelId.trim() } : {}),
        cloudBoundary: "unknown"
      });
      if ("status" in result) {
        setManualBootstrap(result);
        setManualModelId(result.discoveredModels[0]?.modelId ?? "");
        if (result.error) props.onError(props.t("models.discoveryFailed"));
        return;
      }
      setApiKey("");
      setManualModelId("");
      setManualBootstrap(null);
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const setDefaultModel = async (modelProfileId: string): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.setDefaultModel({ modelProfileId });
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const refreshProviderModels = async (providerProfileId: string): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.refreshProviderModels({ providerProfileId });
      setProviderSyncFailures((current) => {
        const next = new Set(current);
        next.delete(providerProfileId);
        return next;
      });
      await props.onRefreshModels();
    } catch {
      setProviderSyncFailures((current) => new Set(current).add(providerProfileId));
      props.onError(props.t("models.discoveryFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const addManualModel = async (
    providerProfileId: string,
    modelId: string,
    modelDisplayName: string
  ): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.addManualModel({
        providerProfileId,
        modelId,
        ...(modelDisplayName.trim() ? { displayName: modelDisplayName.trim() } : {})
      });
      await props.onRefreshModels();
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const setModelEnabled = async (modelProfileId: string, enabled: boolean): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.updateModel({ modelProfileId, enabled });
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const setModelDisplayName = async (
    modelProfileId: string,
    displayName: string | null
  ): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.updateModel({ modelProfileId, displayName });
      await props.onRefreshModels();
    } catch {
      props.onError(props.t("models.connectionFailed"));
    } finally {
      props.onBusy(false);
    }
  };

  const summary = props.modelSummary;
  const defaultModel = summary?.models.find((model) => model.id === summary.defaultModelProfileId);
  const defaultProvider = summary?.providers.find((provider) => provider.id === defaultModel?.providerProfileId);

  return (
    <section className="settings-page" aria-label={props.t("nav.models")}>
      <div>
        <h1>{props.t("models.title")}</h1>
        <p className="muted">{props.t("models.subtitle")}</p>
      </div>

      <section className="settings-group">
        <h2>{props.t("models.addProvider")}</h2>
        {props.modelSummary?.presets.map((preset) => (
          <div className="preset-provider" key={preset.presetId}>
            <div>
              <strong>{preset.displayName}</strong>
              <span>{props.t("models.recommended")}</span>
            </div>
            {preset.authRequirement !== "none" ? (
              <>
                <label htmlFor={`preset-key-${preset.presetId}`}>{props.t("models.apiKey")}</label>
                <input
                  id={`preset-key-${preset.presetId}`}
                  value={presetApiKeys[preset.presetId] ?? ""}
                  type="password"
                  autoComplete="off"
                  onChange={(event) => setPresetApiKeys((current) => ({
                    ...current,
                    [preset.presetId]: event.target.value
                  }))}
                />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void connectPreset(preset.presetId)}
              disabled={props.busy || (
                preset.authRequirement === "api_key" && !(presetApiKeys[preset.presetId] ?? "").trim()
              )}
            >
              {props.t("models.connect")}
            </button>
          </div>
        ))}

        <details className="custom-provider">
          <summary>{props.t("models.customProvider")}</summary>
          <div className="custom-provider-fields">
            <label htmlFor="provider-name">{props.t("field.name")}</label>
            <input id="provider-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />

            <label htmlFor="provider-protocol">{props.t("models.endpointProtocol")}</label>
            <select
              id="provider-protocol"
              value={endpointProtocol}
              onChange={(event) => setEndpointProtocol(event.target.value as ProviderEndpointProtocol)}
            >
              <option value="openai_responses">{props.t("models.protocol.openaiResponses")}</option>
              <option value="openai_chat_completions">{props.t("models.protocol.openaiChatCompletions")}</option>
              <option value="anthropic_messages">{props.t("models.protocol.anthropicMessages")}</option>
            </select>

            <label htmlFor="provider-base-url">{props.t("models.baseUrl")}</label>
            <input
              id="provider-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />

            <label htmlFor="provider-key">{props.t("models.apiKey")}</label>
            <input
              id="provider-key"
              value={apiKey}
              type="password"
              onChange={(event) => setApiKey(event.target.value)}
            />

            {manualBootstrap ? (
              <>
                <p className="muted">{props.t("models.bootstrapModelRequired")}</p>
                <label htmlFor="provider-model">{props.t("models.modelId")}</label>
                <input
                  id="provider-model"
                  list="provider-discovered-models"
                  value={manualModelId}
                  onChange={(event) => setManualModelId(event.target.value)}
                />
                <datalist id="provider-discovered-models">
                  {manualBootstrap.discoveredModels.map((model) => (
                    <option key={model.modelId} value={model.modelId}>{model.displayName ?? model.modelId}</option>
                  ))}
                </datalist>
              </>
            ) : null}

            <button
              type="button"
              onClick={() => void saveProvider()}
              disabled={props.busy || !baseUrl.trim() || !apiKey.trim() || (
                manualBootstrap !== null && !manualModelId.trim()
              )}
            >
              {props.t("models.testAndSave")}
            </button>
          </div>
        </details>
      </section>

      <section className="settings-group">
        <h2>{props.t("models.availableModels")}</h2>
        {summary?.defaultBinding.state === "configured_unusable" ? (
          <p className="error" role="alert">{props.t(summary.defaultBinding.error.messageKey)}</p>
        ) : null}
        {summary && summary.providers.length > 0 ? (
          <div className="provider-model-groups">
            {summary.providers.map((provider) => (
              <ProviderModelGroup
                key={provider.id}
                providerId={provider.id}
                providerName={provider.displayName}
                models={summary.models.filter((model) => model.providerProfileId === provider.id)}
                syncFailed={providerSyncFailures.has(provider.id)}
                busy={props.busy}
                onRefresh={() => refreshProviderModels(provider.id)}
                onAddCustom={(modelId, modelDisplayName) => addManualModel(provider.id, modelId, modelDisplayName)}
                onSetEnabled={setModelEnabled}
                onSetDisplayName={setModelDisplayName}
                t={props.t}
              />
            ))}
          </div>
        ) : (
          <p className="muted">{props.t("models.noModel")}</p>
        )}
      </section>

      <section className="settings-group">
        <h2>{props.t("models.defaultModel")}</h2>
        <label htmlFor="global-default-model">{props.t("models.defaultModel")}</label>
        <select
          id="global-default-model"
          value={summary?.defaultModelProfileId ?? ""}
          disabled={props.busy || !summary?.models.some((model) => model.enabled)}
          onChange={(event) => void setDefaultModel(event.target.value)}
        >
          <option value="" disabled>{props.t("models.noModel")}</option>
          {summary?.providers.map((provider) => (
            <optgroup key={provider.id} label={provider.displayName}>
              {summary.models
                .filter((model) => model.providerProfileId === provider.id && model.enabled)
                .map((model) => (
                  <option key={model.id} value={model.id}>{model.displayName ?? model.modelId}</option>
                ))}
            </optgroup>
          ))}
        </select>
      </section>

      {defaultProvider ? (
        <InfoGroup
          title={props.t("models.currentProvider")}
          rows={[
            [props.t("field.name"), defaultProvider.displayName],
            [props.t("models.defaultModel"), defaultModel?.displayName ?? defaultModel?.modelId ?? props.t("models.unknown")]
          ]}
        />
      ) : null}

      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

function ProviderModelGroup(props: {
  readonly providerId: string;
  readonly providerName: string;
  readonly models: readonly ModelProfileSummary[];
  readonly syncFailed: boolean;
  readonly busy: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onAddCustom: (modelId: string, displayName: string) => Promise<void>;
  readonly onSetEnabled: (modelProfileId: string, enabled: boolean) => Promise<void>;
  readonly onSetDisplayName: (modelProfileId: string, displayName: string | null) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const addModel = async (): Promise<void> => {
    await props.onAddCustom(modelId.trim(), displayName.trim());
    setModelId("");
    setDisplayName("");
  };
  return (
    <section className="provider-model-group" aria-labelledby={`provider-models-${props.providerId}`}>
      <div className="provider-model-heading">
        <h3 id={`provider-models-${props.providerId}`}>{props.providerName}</h3>
        <button type="button" className="secondary" disabled={props.busy} onClick={() => void props.onRefresh()}>
          {props.t("library.refresh")}
        </button>
      </div>
      {props.models.length > 0 ? (
        <div className="model-list">
          {props.models.map((model) => (
            <ModelInventoryRow
              key={model.id}
              model={model}
              busy={props.busy}
              onSetEnabled={props.onSetEnabled}
              onSetDisplayName={props.onSetDisplayName}
              t={props.t}
            />
          ))}
        </div>
      ) : <p className="muted">{props.t("models.noModel")}</p>}
      {props.syncFailed ? (
        <p className="error" role="alert">{props.t("models.discoveryFailed")}</p>
      ) : null}
      <details className="custom-model">
        <summary>{props.t("models.addCustomModel")}</summary>
        <div className="custom-provider-fields">
          <label htmlFor={`custom-model-id-${props.providerId}`}>{props.t("models.modelId")}</label>
          <input
            id={`custom-model-id-${props.providerId}`}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          />
          <label htmlFor={`custom-model-name-${props.providerId}`}>{props.t("field.name")}</label>
          <input
            id={`custom-model-name-${props.providerId}`}
            value={displayName}
            placeholder={props.t("models.optional")}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button type="button" disabled={props.busy || !modelId.trim()} onClick={() => void addModel()}>
            {props.t("models.addCustomModel")}
          </button>
        </div>
      </details>
    </section>
  );
}

function ModelInventoryRow(props: {
  readonly model: ModelProfileSummary;
  readonly busy: boolean;
  readonly onSetEnabled: (modelProfileId: string, enabled: boolean) => Promise<void>;
  readonly onSetDisplayName: (modelProfileId: string, displayName: string | null) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const initialName = props.model.displayName && props.model.displayName !== props.model.modelId
    ? props.model.displayName
    : "";
  const [displayName, setDisplayName] = useState(initialName);
  return (
    <div className="model-row">
      <span>
        <strong>{props.model.displayName ?? props.model.modelId}</strong>
        <small>{props.model.source === "manual" ? props.t("models.manual") : props.model.modelId}</small>
      </span>
      <div className="model-row-controls">
        <label>
          <input
            type="checkbox"
            checked={props.model.enabled}
            disabled={props.busy || props.model.isDefault}
            aria-label={`${props.t("models.enabled")}: ${props.model.displayName ?? props.model.modelId}`}
            onChange={(event) => void props.onSetEnabled(props.model.id, event.target.checked)}
          />
          {props.model.isDefault ? props.t("models.default") : props.t("models.enabled")}
        </label>
        <details className="model-name-editor">
          <summary>{props.t("models.editDisplayName")}</summary>
          <div className="model-name-fields">
            <label htmlFor={`model-display-name-${props.model.id}`}>{props.t("models.displayName")}</label>
            <input
              id={`model-display-name-${props.model.id}`}
              value={displayName}
              placeholder={props.model.modelId}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button
              type="button"
              className="secondary"
              disabled={props.busy}
              onClick={() => void props.onSetDisplayName(props.model.id, displayName.trim() || null)}
            >
              {props.t("models.saveDisplayName")}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

function InfoGroup(props: { readonly title: string; readonly rows: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <section className="settings-group">
      <h2>{props.title}</h2>
      <dl>
        {props.rows.map(([label, value]) => (
          <div className="info-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RecentVaults(props: {
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.recentVaults.length === 0) return null;

  return (
    <section className="settings-group recent-list">
      <h2>{props.t("recent.title")}</h2>
      {props.recentVaults.map((recent) => (
        <div className="recent-item" key={recent.vaultId}>
          <div>
            <strong>{recent.name}</strong>
            <span>{recent.pathDisplay}</span>
          </div>
          <button type="button" className="ghost" onClick={() => void props.onRemoveRecent(recent.vaultId)}>
            {props.t("recent.remove")}
          </button>
        </div>
      ))}
    </section>
  );
}
