import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
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
  KnowledgeTreeNode,
  KnowledgeTreePageRef,
  KnowledgeTreeResult,
  LibraryListResult,
  LibraryPageSummary,
  LibraryRelatedPage,
  LibraryRelatedResult,
  LocalDatabaseStatus,
  ModelEgressPendingRequest,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  NoteRenderResult,
  OnboardingStatus,
  PigeErrorSummary,
  ProviderConnectNeedsManualModel,
  ProposalDecisionResult,
  ProposalSummary,
  RecentVaultSummary,
  RetrievalAnswerCitation,
  RetrievalAskResult,
  RetrievalSearchResultItem,
  RestoreMode,
  RestorePreviewWarning,
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

type View = "home" | "library" | "knowledgeTree" | "settings" | "models";
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
type ActiveSourceTurnBinding = {
  readonly clientTurnId: string;
  readonly jobId: string | null;
  readonly pending: boolean;
  readonly sourceDisplayName: string | null;
};
type HomeFileDropRequest = {
  readonly clientTurnId: string;
  readonly files: readonly File[];
  readonly text?: string;
};
type HomeModelEgressPromptState =
  | { readonly kind: "loading"; readonly requestId: string }
  | {
      readonly kind: "ready" | "resolving";
      readonly request: ModelEgressPendingRequest;
      readonly errorMessageKey?: string;
    }
  | { readonly kind: "unknown"; readonly requestId: string };

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
  const [homeFileDropRequest, setHomeFileDropRequest] = useState<HomeFileDropRequest | null>(null);
  const [captureToast, setCaptureToast] = useState<CaptureToast | null>(null);
  const [recentJobs, setRecentJobs] = useState<readonly JobSummary[]>([]);
  const [recentActivities, setRecentActivities] = useState<readonly KnowledgeActivitySummary[]>([]);
  const [activityUndoingId, setActivityUndoingId] = useState<string | null>(null);
  const [activityBlockedIds, setActivityBlockedIds] = useState<readonly string[]>([]);
  const [readyProposals, setReadyProposals] = useState<readonly ProposalSummary[]>([]);
  const [libraryList, setLibraryList] = useState<LibraryListResult | null>(null);
  const [knowledgeTree, setKnowledgeTree] = useState<KnowledgeTreeResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const noteOpenSequence = useRef(0);
  const knowledgeTreeReturnFocusKey = useRef<string | null>(null);

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
    homeJobStateFilter.states.push("waiting_model_egress");
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

  const dismissFirstHomeGuide = async (): Promise<void> => {
    try {
      setOnboarding(await window.pige.vault.dismissFirstHomeGuide());
    } catch {
      setCaptureToast({ kind: "error", message: t("error.generic") });
    }
  };

  const openModelsFromHome = async (): Promise<void> => {
    await dismissFirstHomeGuide();
    setView("models");
  };

  const refreshLibrary = async (): Promise<void> => {
    setLibraryError(null);
    try {
      setLibraryList(await window.pige.library.list({ limit: 50 }));
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : t("error.generic"));
    }
  };

  const refreshKnowledgeTree = async (): Promise<void> => {
    setLibraryError(null);
    setKnowledgeTree(null);
    try {
      setKnowledgeTree(await window.pige.library.tree());
    } catch {
      setLibraryError(t("knowledgeTree.error"));
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
    } catch {
      if (requestId !== noteOpenSequence.current) return;
      setLibraryError(t("error.generic"));
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
    clientTurnId = createAgentClientTurnId(),
    statusOwner: "home" | "shell" = "shell"
  ): Promise<AgentSubmitTurnResult | undefined> => {
    if (files.length === 0) return undefined;
    if (files.length > 1) {
      if (statusOwner === "shell") setCaptureToast({ kind: "error", message: t("home.oneFilePerTurn") });
      return undefined;
    }
    if (!onboarding?.activeVault) {
      if (statusOwner === "shell") setCaptureToast({ kind: "error", message: t("home.createVaultBeforeDrop") });
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
      if (statusOwner === "shell") {
        setCaptureToast(result.state === "completed"
          ? { kind: "success", message: result.answer.answer }
          : { kind: "error", message: t(result.error.messageKey) });
      }
      await refreshVaultState();
      return result;
    } catch {
      if (statusOwner === "shell") setCaptureToast({ kind: "error", message: t("error.generic") });
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
    const files = Array.from(event.dataTransfer.files);
    const clientTurnId = createAgentClientTurnId();
    if (view === "home") {
      setHomeFileDropRequest({
        clientTurnId,
        files,
        ...(homeDraftText.trim() ? { text: homeDraftText } : {})
      });
      return;
    }
    void submitFiles(files, "file_drop", undefined, clientTurnId, "shell");
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
            <button
              className={view === "home" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "home" ? "page" : undefined}
              onClick={() => setView("home")}
            >
              {t("nav.home")}
            </button>
            <button
              className={view === "library" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "library" ? "page" : undefined}
              onClick={() => {
                setView("library");
                void refreshLibrary();
              }}
            >
              {t("nav.library")}
            </button>
            <button
              className={view === "knowledgeTree" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "knowledgeTree" ? "page" : undefined}
              onClick={() => {
                noteOpenSequence.current += 1;
                knowledgeTreeReturnFocusKey.current = null;
                setSelectedNote(null);
                setSelectedNoteRelated(null);
                setView("knowledgeTree");
                void refreshKnowledgeTree();
              }}
            >
              {t("nav.knowledgeTree")}
            </button>
            <button
              className={view === "settings" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => setView("settings")}
            >
              {t("nav.vaultSettings")}
            </button>
            <button
              className={view === "models" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "models" ? "page" : undefined}
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
        ) : view === "knowledgeTree" && activeVault ? (
          selectedNote ? (
            <LibraryPanel
              libraryList={libraryList}
              selectedNote={selectedNote}
              selectedNoteRelated={selectedNoteRelated}
              noteLoadingPageId={noteLoadingPageId}
              error={libraryError}
              readerBackLabel={t("knowledgeTree.back")}
              onRefresh={refreshLibrary}
              onOpenNote={openNote}
              onCloseNote={() => {
                noteOpenSequence.current += 1;
                setSelectedNote(null);
                setSelectedNoteRelated(null);
                restoreKnowledgeTreeFocus(knowledgeTreeReturnFocusKey.current);
              }}
              t={t}
            />
          ) : (
            <KnowledgeTreePanel
              tree={knowledgeTree}
              error={libraryError}
              noteLoadingPageId={noteLoadingPageId}
              onRefresh={refreshKnowledgeTree}
              onOpenNote={async (pageId, focusKey) => {
                knowledgeTreeReturnFocusKey.current = focusKey;
                await openNote(pageId);
              }}
              t={t}
            />
          )
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
            showFirstHomeGuide={onboarding?.showFirstHomeGuide === true}
            fileDropRequest={homeFileDropRequest}
            onFileDropRequestConsumed={(clientTurnId) => {
              setHomeFileDropRequest((current) => current?.clientTurnId === clientTurnId ? null : current);
            }}
            onFilesSelected={(files, text, clientTurnId) =>
              submitFiles(files, "file_picker", text, clientTurnId, "home")}
            onCancelJob={cancelJob}
            onRetryJob={retryJob}
            onUndoActivity={undoActivity}
            onHomeStateChanged={refreshVaultState}
            onProposalChanged={refreshVaultState}
            onOpenModels={openModelsFromHome}
            onDismissFirstHome={dismissFirstHomeGuide}
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

function restoreKnowledgeTreeFocus(focusKey: string | null): void {
  window.setTimeout(() => {
    const exact = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-knowledge-open-key]"))
      .find((element) => element.dataset.knowledgeOpenKey === focusKey && !element.disabled);
    const treeHeading = document.querySelector<HTMLElement>("#knowledge-tree-heading");
    (exact ?? treeHeading)?.focus();
  }, 0);
}

function LibraryPanel(props: {
  readonly libraryList: LibraryListResult | null;
  readonly selectedNote: NoteRenderResult | null;
  readonly selectedNoteRelated: NoteRelatedState;
  readonly noteLoadingPageId: string | null;
  readonly error: string | null;
  readonly readerBackLabel?: string;
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
          {props.readerBackLabel ?? props.t("note.backToLibrary")}
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

export function KnowledgeTreePanel(props: {
  readonly tree: KnowledgeTreeResult | null;
  readonly error: string | null;
  readonly noteLoadingPageId: string | null;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const roots = props.tree?.roots ?? [];
  const maxWeight = Math.max(1, ...roots.map((root) => root.metrics.weight));

  return (
    <section className="knowledge-tree-page" aria-labelledby="knowledge-tree-heading">
      <header className="knowledge-tree-header">
        <div>
          <h1 id="knowledge-tree-heading" tabIndex={-1}>{props.t("knowledgeTree.title")}</h1>
          <p className="muted">{props.t("knowledgeTree.subtitle")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void props.onRefresh()}>
          {props.t("knowledgeTree.refresh")}
        </button>
      </header>

      <div className="knowledge-tree-totals" aria-label={props.t("knowledgeTree.summary")}>
        <span>{props.t("knowledgeTree.domains")}: {roots.length}</span>
        <span>{props.t("knowledgeTree.topics")}: {props.tree?.totals.topicCount ?? 0}</span>
        <span>{props.t("knowledgeTree.concepts")}: {props.tree?.totals.conceptCount ?? 0}</span>
        <span>{props.t("knowledgeTree.fragments")}: {props.tree?.totals.fragmentPageCount ?? 0}</span>
        <span>{props.t("knowledgeTree.sources")}: {props.tree?.totals.sourceCount ?? 0}</span>
      </div>

      {props.error ? <p className="error" role="alert">{props.error}</p> : null}
      {!props.tree && !props.error ? (
        <p className="knowledge-tree-empty" role="status">{props.t("knowledgeTree.loading")}</p>
      ) : props.tree?.degraded ? (
        <p className="knowledge-tree-empty" role="status">{props.t("knowledgeTree.degraded")}</p>
      ) : roots.length === 0 ? (
        <p className="knowledge-tree-empty">{props.t("knowledgeTree.empty")}</p>
      ) : (
        <ul className="knowledge-tree-roots" aria-label={props.t("knowledgeTree.title")}>
          {roots.map((root, index) => (
            <KnowledgeTreeNodeView
              key={root.id}
              node={root}
              pathKey={`root-${index}`}
              maxWeight={maxWeight}
              defaultExpanded
              noteLoadingPageId={props.noteLoadingPageId}
              onOpenNote={props.onOpenNote}
              t={props.t}
            />
          ))}
        </ul>
      )}

      {props.tree && props.tree.invalidPageCount > 0 ? (
        <p className="knowledge-tree-warning">
          {props.t("knowledgeTree.invalid")}: {props.tree.invalidPageCount}
        </p>
      ) : null}
    </section>
  );
}

function KnowledgeTreeNodeView(props: {
  readonly node: KnowledgeTreeNode;
  readonly pathKey: string;
  readonly maxWeight: number;
  readonly defaultExpanded?: boolean;
  readonly noteLoadingPageId: string | null;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const hasContents = props.node.children.length > 0 || props.node.pageRefs.length > 0;
  const groupId = `knowledge-tree-group-${props.pathKey}`;
  const title = knowledgeTreeNodeTitle(props.node, props.t);
  const density = knowledgeTreeDensity(props.node);
  const navigationFocusKey = `${props.pathKey}-node`;

  return (
    <li className={`knowledge-tree-node kind-${props.node.kind} density-${density}${props.node.status === "needs_review" ? " needs-review" : ""}`}>
      <div className="knowledge-tree-node-row">
        {hasContents ? (
          <button
            type="button"
            className="knowledge-tree-disclosure"
            aria-label={`${expanded ? props.t("knowledgeTree.collapse") : props.t("knowledgeTree.expand")}: ${title}`}
            title={`${expanded ? props.t("knowledgeTree.collapse") : props.t("knowledgeTree.expand")}: ${title}`}
            aria-expanded={expanded}
            aria-controls={groupId}
            onClick={() => setExpanded((current) => !current)}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
        ) : <span className="knowledge-tree-disclosure-spacer" aria-hidden="true" />}

        <div className="knowledge-tree-node-main">
          <div className="knowledge-tree-node-title">
            {props.node.navigation ? (
              <button
                type="button"
                className="knowledge-tree-open"
                data-knowledge-open-key={navigationFocusKey}
                disabled={props.noteLoadingPageId === props.node.navigation.pageId}
                onClick={() => void props.onOpenNote(props.node.navigation!.pageId, navigationFocusKey)}
              >
                {title}
              </button>
            ) : <strong>{title}</strong>}
            <span>{props.t(`knowledgeTree.kind.${props.node.kind}`)}</span>
          </div>
          <meter
            className="knowledge-tree-weight"
            min={0}
            max={props.maxWeight}
            value={Math.min(props.node.metrics.weight, props.maxWeight)}
            aria-label={`${props.t("knowledgeTree.weight")}: ${props.node.metrics.weight}`}
          />
          <div className="knowledge-tree-node-metrics">
            <span>{props.t("knowledgeTree.weight")}: {props.node.metrics.weight}</span>
            <span>{props.t("knowledgeTree.fragments")}: {props.node.metrics.fragmentPageCount}</span>
            <span>{props.t("knowledgeTree.sources")}: {props.node.metrics.sourceCount}</span>
            <span>{props.t("knowledgeTree.leaves")}: {props.node.metrics.leafCount}</span>
            {props.node.relatedParentPageIds.length > 0 ? (
              <span>{props.t("knowledgeTree.relatedBranches")}: {props.node.relatedParentPageIds.length}</span>
            ) : null}
          </div>
        </div>
      </div>

      {hasContents && expanded ? (
        <ul id={groupId} className="knowledge-tree-children">
          {props.node.children.map((child, index) => (
            <KnowledgeTreeNodeView
              key={child.id}
              node={child}
              pathKey={`${props.pathKey}-child-${index}`}
              maxWeight={props.maxWeight}
              noteLoadingPageId={props.noteLoadingPageId}
              onOpenNote={props.onOpenNote}
              t={props.t}
            />
          ))}
          {props.node.pageRefs.map((page, index) => (
            <KnowledgeTreePageLeaf
              key={page.pageId}
              page={page}
              focusKey={`${props.pathKey}-page-${index}`}
              noteLoadingPageId={props.noteLoadingPageId}
              onOpenNote={props.onOpenNote}
              t={props.t}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function KnowledgeTreePageLeaf(props: {
  readonly page: KnowledgeTreePageRef;
  readonly focusKey: string;
  readonly noteLoadingPageId: string | null;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <li className={`knowledge-tree-page-leaf${props.page.status === "needs_review" ? " needs-review" : ""}`}>
      <span aria-hidden="true" className="knowledge-tree-leaf-mark" />
      <button
        type="button"
        className="knowledge-tree-open"
        data-knowledge-open-key={props.focusKey}
        disabled={props.noteLoadingPageId === props.page.pageId}
        onClick={() => void props.onOpenNote(props.page.pageId, props.focusKey)}
      >
        {props.page.title}
      </button>
      <span>{props.t(`library.type.${props.page.pageType}`)}</span>
      {props.page.sourceIds.length > 0 ? (
        <span>{props.t("knowledgeTree.sources")}: {props.page.sourceIds.length}</span>
      ) : null}
    </li>
  );
}

function knowledgeTreeNodeTitle(node: KnowledgeTreeNode, t: (key: string) => string): string {
  if (node.synthetic) return t("knowledgeTree.unassigned");
  if (node.kind === "source" && !node.navigation) return t("knowledgeTree.sourceEvidence");
  return node.title;
}

function knowledgeTreeDensity(node: KnowledgeTreeNode): "none" | "light" | "medium" | "strong" {
  const evidenceCount = node.metrics.fragmentPageCount + node.metrics.sourceCount;
  if (evidenceCount === 0) return "none";
  if (evidenceCount <= 2) return "light";
  if (evidenceCount <= 6) return "medium";
  return "strong";
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

type ReadyRestorePreview = Extract<RestorePreviewResult, { readonly status: "ready" }>;

function restoreWarningMessageKey(code: RestorePreviewWarning["code"]): string {
  switch (code) {
    case "invalid_archive_entries": return "backup.warningInvalidArchiveEntries";
    case "excluded_rebuildable_roots": return "backup.warningExcludedRebuildableRoots";
    case "external_originals_not_included": return "backup.warningExternalOriginalsNotIncluded";
  }
}
type RestorePhase = "idle" | "previewing" | "applying";

function restoreDefaultMode(preview: ReadyRestorePreview): RestoreMode | null {
  if (preview.permittedModes.includes("clone_as_new")) return "clone_as_new";
  if (preview.permittedModes.includes(preview.defaultMode)) return preview.defaultMode;
  return preview.permittedModes[0] ?? null;
}

function useRestoreFlow(onRestored: () => Promise<void>, onRestoreStart: () => void) {
  const [restorePreview, setRestorePreview] = useState<ReadyRestorePreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode | null>(null);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("idle");
  const [restoreErrorKey, setRestoreErrorKey] = useState<string | null>(null);
  const restoreInFlight = useRef(false);
  const pendingRestoreFocus = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);

  const commitRestoreFocus = (): void => {
    if (!pendingRestoreFocus.current) return;
    const control = pendingRestoreFocus.current;
    pendingRestoreFocus.current = null;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => control.current?.focus());
    });
  };

  const restoreFocus = (control: RefObject<HTMLButtonElement | null>): void => {
    pendingRestoreFocus.current = control;
  };

  const previewRestore = async (): Promise<void> => {
    if (restoreInFlight.current) return;
    restoreInFlight.current = true;
    onRestoreStart();
    setRestorePreview(null);
    setRestoreMode(null);
    setRestoreErrorKey(null);
    setRestorePhase("previewing");
    try {
      const result = await window.pige.backup.previewRestore();
      if (result.status === "canceled") {
        restoreFocus(previewButtonRef);
        return;
      }
      const mode = restoreDefaultMode(result);
      if (!mode) {
        setRestoreErrorKey("backup.restoreFailed");
        restoreFocus(previewButtonRef);
        return;
      }
      setRestorePreview(result);
      setRestoreMode(mode);
    } catch {
      setRestoreErrorKey("backup.restoreFailed");
      restoreFocus(previewButtonRef);
    } finally {
      restoreInFlight.current = false;
      setRestorePhase("idle");
      commitRestoreFocus();
    }
  };

  const applyRestore = async (): Promise<void> => {
    if (
      restoreInFlight.current ||
      !restorePreview ||
      !restoreMode ||
      restorePreview.invalidFileCount > 0 ||
      !restorePreview.permittedModes.includes(restoreMode)
    ) return;
    restoreInFlight.current = true;
    onRestoreStart();
    setRestoreErrorKey(null);
    setRestorePhase("applying");
    try {
      const result = await window.pige.backup.applyRestore({
        previewId: restorePreview.previewId,
        mode: restoreMode
      });
      if (result.status === "canceled") {
        restoreFocus(applyButtonRef);
        return;
      }
      setRestorePreview(null);
      setRestoreMode(null);
      await onRestored();
    } catch {
      setRestoreErrorKey("backup.restoreFailed");
      restoreFocus(restorePreview ? applyButtonRef : previewButtonRef);
    } finally {
      restoreInFlight.current = false;
      setRestorePhase("idle");
      commitRestoreFocus();
    }
  };

  const cancelRestore = (): void => {
    if (restoreInFlight.current) return;
    setRestorePreview(null);
    setRestoreMode(null);
    setRestoreErrorKey(null);
    restoreFocus(previewButtonRef);
    commitRestoreFocus();
  };

  const selectRestoreMode = (mode: RestoreMode): void => {
    if (!restorePreview?.permittedModes.includes(mode) || restoreInFlight.current) return;
    setRestoreMode(mode);
    setRestoreErrorKey(null);
  };

  return {
    applyButtonRef,
    applyRestore,
    cancelRestore,
    previewButtonRef,
    previewRestore,
    restoreErrorKey,
    restoreMode,
    restorePhase,
    restorePreview,
    selectRestoreMode
  };
}

function RestorePreviewPanel(props: {
  readonly idPrefix: string;
  readonly preview: ReadyRestorePreview;
  readonly mode: RestoreMode | null;
  readonly phase: RestorePhase;
  readonly errorKey: string | null;
  readonly applyButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onModeChange: (mode: RestoreMode) => void;
  readonly onApply: () => Promise<void>;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const applying = props.phase === "applying";
  const applyDisabled =
    props.phase !== "idle" ||
    props.mode === null ||
    props.preview.invalidFileCount > 0 ||
    !props.preview.permittedModes.includes(props.mode);

  return (
    <section className="restore-preview" aria-label={props.t("backup.restorePreview")}>
      <strong>{props.t("backup.restorePreview")}</strong>
      <dl className="restore-summary">
        <div className="info-row">
          <dt>{props.t("backup.vault")}</dt>
          <dd>{props.preview.manifest.vaultName}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.createdAt")}</dt>
          <dd>{props.preview.manifest.createdAt}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.appVersion")}</dt>
          <dd>{props.preview.manifest.appVersion}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.vaultSchemaVersion")}</dt>
          <dd>{props.preview.manifest.vaultSchemaVersion}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("counts.notes")}</dt>
          <dd>{props.preview.manifest.noteCount}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("counts.sources")}</dt>
          <dd>{props.preview.manifest.sourceCount}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.conversations")}</dt>
          <dd>{props.preview.manifest.conversationCount}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.memories")}</dt>
          <dd>{props.preview.manifest.memoryCount}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.invalidFiles")}</dt>
          <dd>{props.preview.invalidFileCount}</dd>
        </div>
        <div className="info-row">
          <dt>{props.t("backup.warnings")}</dt>
          <dd>
            {props.preview.warnings.length === 0 ? props.t("backup.noWarnings") : (
              <ul className="restore-warning-list">
                {props.preview.warnings.map((warning) => (
                  <li key={warning.code}>
                    <span>{props.t(restoreWarningMessageKey(warning.code))}</span>
                    <strong>{warning.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      <fieldset className="restore-mode-options">
        <legend>{props.t("backup.restoreMode")}</legend>
        {props.preview.permittedModes.includes("clone_as_new") ? (
          <label htmlFor={`${props.idPrefix}-restore-clone`}>
            <input
              id={`${props.idPrefix}-restore-clone`}
              type="radio"
              name={`${props.idPrefix}-restore-mode`}
              value="clone_as_new"
              checked={props.mode === "clone_as_new"}
              disabled={props.phase !== "idle"}
              onChange={() => props.onModeChange("clone_as_new")}
            />
            <span>
              <strong>{props.t("backup.modeClone")}</strong>
              <small>{props.t("backup.modeCloneDescription")}</small>
            </span>
          </label>
        ) : null}
        {props.preview.permittedModes.includes("replace_existing") ? (
          <label htmlFor={`${props.idPrefix}-restore-replace`}>
            <input
              id={`${props.idPrefix}-restore-replace`}
              type="radio"
              name={`${props.idPrefix}-restore-mode`}
              value="replace_existing"
              checked={props.mode === "replace_existing"}
              disabled={props.phase !== "idle"}
              onChange={() => props.onModeChange("replace_existing")}
            />
            <span>
              <strong>{props.t("backup.modeReplace")}</strong>
              <small>{props.t("backup.modeReplaceDescription")}</small>
            </span>
          </label>
        ) : null}
      </fieldset>

      {props.mode === "replace_existing" ? (
        <p className="restore-warning" role="note">{props.t("backup.replaceWarning")}</p>
      ) : null}
      {props.preview.invalidFileCount > 0 ? (
        <p className="error" role="alert">{props.t("backup.restoreInvalid")}</p>
      ) : null}
      {props.errorKey ? <p className="error" role="alert">{props.t(props.errorKey)}</p> : null}
      {applying ? <p className="muted" role="status">{props.t("backup.restoreProgress")}</p> : null}

      <div className="settings-actions">
        <button
          ref={props.applyButtonRef}
          type="button"
          disabled={applyDisabled}
          onClick={() => void props.onApply()}
        >
          {applying
            ? props.t("backup.restoring")
            : props.t(props.mode === "replace_existing" ? "backup.applyReplace" : "backup.applyClone")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.phase !== "idle"}
          onClick={props.onCancel}
        >
          {props.t("backup.restoreCancel")}
        </button>
      </div>
    </section>
  );
}

function FirstRunPanel(props: FirstRunPanelProps): React.JSX.Element {
  const restore = useRestoreFlow(props.onRestoreCompleted, () => props.onError(null));

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
          ref={restore.previewButtonRef}
          type="button"
          className="secondary"
          disabled={props.busy || restore.restorePhase !== "idle"}
          title={props.t("firstRun.restoreHint")}
          onClick={() => void restore.previewRestore()}
        >
          {props.t(restore.restorePhase === "previewing" ? "backup.opening" : "firstRun.restoreBackup")}
        </button>
      </div>

      {restore.restorePreview ? (
        <RestorePreviewPanel
          idPrefix="first-run"
          preview={restore.restorePreview}
          mode={restore.restoreMode}
          phase={restore.restorePhase}
          errorKey={restore.restoreErrorKey}
          applyButtonRef={restore.applyButtonRef}
          onModeChange={restore.selectRestoreMode}
          onApply={restore.applyRestore}
          onCancel={restore.cancelRestore}
          t={props.t}
        />
      ) : null}
      {!restore.restorePreview && restore.restoreErrorKey ? (
        <p className="error" role="alert">{props.t(restore.restoreErrorKey)}</p>
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
  readonly showFirstHomeGuide: boolean;
  readonly fileDropRequest: HomeFileDropRequest | null;
  readonly onFileDropRequestConsumed: (clientTurnId: string) => void;
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
  readonly onOpenModels: () => Promise<void>;
  readonly onDismissFirstHome: () => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const text = props.draftText;
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [agentAnswer, setAgentAnswer] = useState<AgentTurnAnswer | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentTurnDraftEvent | null>(null);
  const [agentRunState, setAgentRunState] = useState<HomeAgentUiState>("idle");
  const [agentError, setAgentError] = useState<PigeErrorSummary | null>(null);
  const [modelEgressPrompt, setModelEgressPrompt] = useState<HomeModelEgressPromptState | null>(null);
  const [resolvedModelEgressRequestId, setResolvedModelEgressRequestId] = useState<string | null>(null);
  const [agentModelUsage, setAgentModelUsage] = useState<HomeAgentModelUsage>("none");
  const [activeSourceTurn, setActiveSourceTurn] = useState<ActiveSourceTurnBinding | null>(null);
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
  const composerSubmitInFlightRef = useRef(false);
  const composerCompositionActiveRef = useRef(false);
  const composerCompositionRaceRef = useRef(false);
  const composerCompositionTimerRef = useRef<number | undefined>(undefined);
  const draftRevisionRef = useRef(0);
  const noteOpenSequence = useRef(0);
  const proposalDecisionInFlight = useRef(false);
  const modelEgressDecisionInFlight = useRef(false);
  const modelEgressReadSequence = useRef(0);
  const currentModelEgressRequestIdRef = useRef<string | undefined>(undefined);
  const proposalReviewTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const proposalFocusReturnId = useRef<string | null>(null);
  const proposalFocusReturnPending = useRef(false);
  const proposalQueueHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const conversationLoadSequence = useRef(0);
  const handledFileDropClientTurnIdRef = useRef<string | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(props.activeVault?.vaultId);
  const activeAgentDraftRef = useRef<ActiveAgentDraftBinding | null>(null);
  activeVaultIdRef.current = props.activeVault?.vaultId;
  const agentStatusLabel = props.agentRuntimeStatus?.state === "ready" ? props.t("home.agentReady") : props.t("home.captureOnly");
  const plannedModelUsage = homeRuntimeModelUsage(props.agentRuntimeStatus);
  const cloudUsageMessageKey = agentRunState === "accepted" || agentRunState === "running"
    ? plannedModelUsage === "cloud" ? "home.cloudSend" : null
    : agentModelUsage === "cloud" ? "home.cloudCallAttempted" : null;
  const latestTurn = conversationTimeline?.latestTurn;
  const latestModelEgressJob = props.recentJobs.find((job) =>
    job.state === "waiting_model_egress" &&
    job.modelEgressApprovalRequestId !== undefined
  );
  const pendingModelEgressRequestId = agentError?.modelEgressApprovalRequestId ??
    latestTurn?.error?.modelEgressApprovalRequestId ??
    latestModelEgressJob?.modelEgressApprovalRequestId;
  const modelEgressRequestId = pendingModelEgressRequestId === resolvedModelEgressRequestId
    ? undefined
    : pendingModelEgressRequestId;
  currentModelEgressRequestIdRef.current = modelEgressRequestId;
  const visibleRecentJobs = props.recentJobs.filter((job) =>
    !modelEgressRequestId || job.modelEgressApprovalRequestId !== modelEgressRequestId
  );
  const retryableLatestTurn = latestTurn && (
    latestTurn.state === "failed_retryable" ||
    latestTurn.state === "cancelled" ||
    latestTurn.state === "waiting_dependency"
  ) ? latestTurn : undefined;
  const sourceWaitingForModelJobs = props.recentJobs.filter(isSourceWaitingForModel);
  const activeSourceWaitingForModelJob = activeSourceTurn?.jobId
    ? sourceWaitingForModelJobs.find((job) => job.id === activeSourceTurn.jobId)
    : activeSourceTurn?.pending && activeSourceTurn.sourceDisplayName
      ? sourceWaitingForModelJobs.find((job) => job.sourceDisplayName === activeSourceTurn.sourceDisplayName)
      : undefined;
  const latestSourceWaitingForModelJob = latestTurn
    ? sourceWaitingForModelJobs.find((job) => job.id === latestTurn.jobId)
    : undefined;
  const sourceWaitOwner = activeSourceWaitingForModelJob ?? latestSourceWaitingForModelJob;
  const sourceWaitOwnsAgentState = sourceWaitOwner !== undefined;
  const composerModelRepairOwnsState = agentError?.userAction === "configure_model" &&
    !sourceWaitOwnsAgentState;
  const sourceModelActionOwner = composerModelRepairOwnsState
    ? undefined
    : sourceWaitOwner ?? sourceWaitingForModelJobs[0];
  const showFirstHomeGuide = props.showFirstHomeGuide &&
    agentRunState === "idle" &&
    sourceWaitingForModelJobs.length === 0;
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

  useEffect(() => () => {
    if (composerCompositionTimerRef.current !== undefined) {
      window.clearTimeout(composerCompositionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    conversationLoadSequence.current += 1;
    setConversationTimeline(undefined);
    setLiveAnswerEventId(null);
    setAgentAnswer(null);
    clearAgentDraft();
    setAgentError(null);
    setModelEgressPrompt(null);
    setResolvedModelEgressRequestId(null);
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
    setAgentRunState("idle");
    if (props.activeVault?.vaultId) void refreshConversation();
    return () => {
      conversationLoadSequence.current += 1;
    };
  }, [props.activeVault?.vaultId]);

  useEffect(() => {
    const sequence = modelEgressReadSequence.current + 1;
    modelEgressReadSequence.current = sequence;
    if (!modelEgressRequestId) {
      setModelEgressPrompt(null);
      return;
    }
    setModelEgressPrompt({ kind: "loading", requestId: modelEgressRequestId });
    void window.pige.modelEgress.pending({ requestId: modelEgressRequestId }).then((request) => {
      if (sequence !== modelEgressReadSequence.current) return;
      if (!request) {
        setModelEgressPrompt({ kind: "unknown", requestId: modelEgressRequestId });
        return;
      }
      if (modelEgressRequestId !== request.requestId) {
        setModelEgressPrompt({ kind: "unknown", requestId: modelEgressRequestId });
        return;
      }
      setModelEgressPrompt({ kind: "ready", request });
    }).catch(() => {
      if (sequence === modelEgressReadSequence.current) {
        setModelEgressPrompt({ kind: "unknown", requestId: modelEgressRequestId });
      }
    });
  }, [modelEgressRequestId, props.activeVault?.vaultId]);

  useEffect(() => {
    if (!latestTurn) return;
    const activeDraft = activeAgentDraftRef.current;
    if (
      activeDraft &&
      (agentRunState === "accepted" || agentRunState === "running") &&
      (activeDraft.jobId === undefined || activeDraft.jobId !== latestTurn.jobId)
    ) {
      return;
    }
    const nextState = homeUiStateForJobState(latestTurn.state);
    if (nextState) setAgentRunState(nextState);
    setAgentError(latestTurn.error ?? null);
    if (latestTurn.state !== "queued" && latestTurn.state !== "running") clearAgentDraft();
  }, [
    agentRunState,
    latestTurn?.jobId,
    latestTurn?.state,
    latestTurn?.error?.code,
    latestTurn?.error?.modelEgressApprovalRequestId
  ]);

  useEffect(() => {
    if (!props.activeVault?.vaultId || !isConversationPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshConversation(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.activeVault?.vaultId, latestTurn?.jobId, latestTurn?.state]);

  const submitHomeInput = async (): Promise<void> => {
    if (!text.trim() || composerSubmitInFlightRef.current) return;
    composerSubmitInFlightRef.current = true;
    setCaptureError(null);
    setAgentError(null);
    setAgentRunState("idle");
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
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
    } finally {
      composerSubmitInFlightRef.current = false;
    }
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter") return;
    const nativeEvent = event.nativeEvent;
    if (
      nativeEvent.isComposing ||
      nativeEvent.keyCode === 229 ||
      composerCompositionActiveRef.current ||
      composerCompositionRaceRef.current
    ) {
      return;
    }
    if (event.shiftKey) return;
    event.preventDefault();
    if (
      event.repeat ||
      composerSubmitInFlightRef.current ||
      agentRunState === "accepted" ||
      agentRunState === "running" ||
      !text.trim()
    ) {
      return;
    }
    void submitHomeInput();
  };

  const submitHomeFiles = async (
    files: readonly File[],
    submittedText: string | undefined,
    clientTurnId: string
  ): Promise<void> => {
    const sourceDisplayName = files[0]?.name ?? null;
    setCaptureError(null);
    setAgentAnswer(null);
    setLiveAnswerEventId(null);
    setAgentError(null);
    setAgentModelUsage("none");
    setAgentRunState("running");
    setActiveSourceTurn({ clientTurnId, jobId: null, pending: true, sourceDisplayName });
    beginAgentDraft(clientTurnId);
    try {
      const result = await props.onFilesSelected(files, submittedText, clientTurnId);
      clearAgentDraft();
      if (!result) {
        setActiveSourceTurn(null);
        setAgentRunState("failed");
        return;
      }
      setActiveSourceTurn({
        clientTurnId,
        jobId: result.jobId ?? null,
        pending: false,
        sourceDisplayName
      });
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
    } catch {
      clearAgentDraft();
      setActiveSourceTurn(null);
      setAgentRunState("failed");
    }
  };

  useEffect(() => {
    const request = props.fileDropRequest;
    if (!request || handledFileDropClientTurnIdRef.current === request.clientTurnId) return;
    handledFileDropClientTurnIdRef.current = request.clientTurnId;
    props.onFileDropRequestConsumed(request.clientTurnId);
    void submitHomeFiles(request.files, request.text, request.clientTurnId);
  }, [props.fileDropRequest?.clientTurnId]);

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

  const decideModelEgress = async (decision: "allow_once" | "deny"): Promise<void> => {
    if (
      modelEgressDecisionInFlight.current ||
      modelEgressPrompt?.kind !== "ready" ||
      modelEgressPrompt.request.requestId !== modelEgressRequestId
    ) return;
    const request = modelEgressPrompt.request;
    const decisionVaultId = activeVaultIdRef.current;
    const isCurrentDecision = (): boolean =>
      activeVaultIdRef.current === decisionVaultId &&
      currentModelEgressRequestIdRef.current === request.requestId;
    modelEgressDecisionInFlight.current = true;
    setModelEgressPrompt({ kind: "resolving", request });
    try {
      const result = await window.pige.modelEgress.resolve({
        requestId: request.requestId,
        jobId: request.jobId,
        decision
      });
      if (!isCurrentDecision()) return;
      await props.onHomeStateChanged().catch(() => undefined);
      const timeline = await refreshConversation();
      if (!isCurrentDecision()) return;
      const nextState = homeUiStateForJobState(timeline?.latestTurn?.state);
      setResolvedModelEgressRequestId(request.requestId);
      setModelEgressPrompt(null);
      setAgentRunState(nextState ?? (result.status === "denied" ? "failed" : "accepted"));
      setAgentError(timeline?.latestTurn?.error ?? null);
      if (result.status === "approved") composerInputRef.current?.focus();
    } catch {
      if (!isCurrentDecision()) return;
      try {
        const current = await window.pige.modelEgress.pending({ requestId: request.requestId });
        if (!isCurrentDecision()) return;
        if (current?.requestId === request.requestId && current.jobId === request.jobId) {
          setModelEgressPrompt({
            kind: "ready",
            request: current,
            errorMessageKey: "home.modelEgress.resolveFailed"
          });
        } else {
          await props.onHomeStateChanged().catch(() => undefined);
          const timeline = await refreshConversation();
          if (!isCurrentDecision()) return;
          if (timeline?.latestTurn?.error?.modelEgressApprovalRequestId === request.requestId) {
            setModelEgressPrompt({ kind: "unknown", requestId: request.requestId });
          } else {
            const nextState = homeUiStateForJobState(timeline?.latestTurn?.state);
            setResolvedModelEgressRequestId(request.requestId);
            setModelEgressPrompt(null);
            setAgentRunState(nextState ?? (decision === "deny" ? "failed" : "accepted"));
            setAgentError(timeline?.latestTurn?.error ?? null);
          }
        }
      } catch {
        if (isCurrentDecision()) {
          setModelEgressPrompt({ kind: "unknown", requestId: request.requestId });
        }
      }
    } finally {
      modelEgressDecisionInFlight.current = false;
    }
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
      {showFirstHomeGuide ? (
        <section className="first-home-guide" aria-label={props.t("home.firstGuideAria")}>
          <p>{props.t("home.firstGuideText")}</p>
          <div className="first-home-guide-actions">
            <button type="button" onClick={() => void props.onOpenModels()}>{props.t("home.connectModel")}</button>
            <button type="button" className="ghost" onClick={() => void props.onDismissFirstHome()}>
              {props.t("home.continueCaptureOnly")}
            </button>
          </div>
        </section>
      ) : null}
      {visibleRecentJobs.length > 0 ? (
        <section className="job-strip" aria-label={props.t("home.recentCaptures")}>
          <span className="job-strip-title">
            {props.t("home.recentWork")}
          </span>
          {visibleRecentJobs.slice(0, 3).map((job) => {
            const sourceWaitingForModel = isSourceWaitingForModel(job);
            const ownsSourceModelAction = sourceWaitingForModel && job.id === sourceModelActionOwner?.id;
            const statusMessageKey = jobStateMessageKey(job);
            return (
              <div
                className={`job-pill${sourceWaitingForModel ? " source-waiting-model" : ""}`}
                key={job.id}
                role={sourceWaitingForModel ? "status" : undefined}
                aria-live={sourceWaitingForModel ? "polite" : undefined}
              >
                <span
                  className={`job-state-dot state-${job.state}`}
                  title={props.t(statusMessageKey)}
                  aria-label={props.t(statusMessageKey)}
                />
                <span className="job-copy">
                  <span className="job-source-name">{job.sourceDisplayName ?? job.sourceId ?? job.id}</span>
                  {sourceWaitingForModel ? (
                    <span className="job-status-label">{props.t(statusMessageKey)}</span>
                  ) : null}
                </span>
                {ownsSourceModelAction ? (
                  <button className="job-action" type="button" onClick={() => void props.onOpenModels()}>
                    {props.t("home.connectModel")}
                  </button>
                ) : sourceWaitingForModel ? null : job.state === "queued" || (
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
            );
          })}
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
              {message.answer?.datasetResult ? (
                <DatasetAnswerResult answer={message.answer} modelUsage="none" t={props.t} />
              ) : (
                <p>{message.text}</p>
              )}
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
      ) : agentAnswer?.datasetResult ? (
        <DatasetAnswerResult
          answer={agentAnswer}
          modelUsage={agentModelUsage}
          t={props.t}
        />
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
          onCompositionStart={() => {
            composerCompositionActiveRef.current = true;
            composerCompositionRaceRef.current = false;
            if (composerCompositionTimerRef.current !== undefined) {
              window.clearTimeout(composerCompositionTimerRef.current);
              composerCompositionTimerRef.current = undefined;
            }
          }}
          onCompositionEnd={() => {
            composerCompositionActiveRef.current = false;
            composerCompositionRaceRef.current = true;
            if (composerCompositionTimerRef.current !== undefined) {
              window.clearTimeout(composerCompositionTimerRef.current);
            }
            composerCompositionTimerRef.current = window.setTimeout(() => {
              composerCompositionRaceRef.current = false;
              composerCompositionTimerRef.current = undefined;
            }, 0);
          }}
          onKeyDown={handleComposerKeyDown}
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
              const clientTurnId = createAgentClientTurnId();
              void submitHomeFiles(files, text, clientTurnId);
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
        {modelEgressRequestId ? (
          <div className="model-egress-prompt" role="group" aria-labelledby="home-model-egress-title">
            <strong id="home-model-egress-title">{props.t("home.modelEgress.title")}</strong>
            <span>
              {modelEgressPrompt?.kind === "ready" || modelEgressPrompt?.kind === "resolving"
                ? props.t(modelEgressReasonMessageKey(modelEgressPrompt.request.reasonCode))
                : modelEgressPrompt?.kind === "unknown"
                  ? props.t("home.modelEgress.unknown")
                  : props.t("home.modelEgress.loading")}
            </span>
            {modelEgressPrompt?.kind === "ready" && modelEgressPrompt.errorMessageKey ? (
              <span className="error">{props.t(modelEgressPrompt.errorMessageKey)}</span>
            ) : null}
            {modelEgressPrompt?.kind === "ready" || modelEgressPrompt?.kind === "resolving" ? (
              <div className="model-egress-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={modelEgressPrompt.kind === "resolving"}
                  onClick={() => void decideModelEgress("deny")}
                >
                  {props.t("home.modelEgress.deny")}
                </button>
                <button
                  type="button"
                  disabled={modelEgressPrompt.kind === "resolving"}
                  onClick={() => void decideModelEgress("allow_once")}
                >
                  {modelEgressPrompt.kind === "resolving"
                    ? props.t("home.modelEgress.saving")
                    : props.t("home.modelEgress.allowOnce")}
                </button>
              </div>
            ) : null}
          </div>
        ) : agentRunState !== "idle" && !sourceWaitOwnsAgentState ? (
          <div className={`agent-run-state state-${agentRunState}`} role="status" aria-live="polite">
            <span className="agent-run-dot" aria-hidden="true" />
            <span>{agentError ? props.t(agentError.messageKey) : props.t(`home.agentState.${agentRunState}`)}</span>
            {cloudUsageMessageKey ? (
              <span className="agent-cloud-boundary">{props.t(cloudUsageMessageKey)}</span>
            ) : null}
            {agentError?.userAction === "configure_model" ? (
              <button type="button" className="ghost" onClick={() => void props.onOpenModels()}>{props.t("home.openModels")}</button>
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

function isSourceWaitingForModel(job: JobSummary): boolean {
  return job.class === "agent_turn" &&
    job.state === "waiting_dependency" &&
    job.stage === "waiting_for_model" &&
    Boolean(job.sourceId);
}

function jobStateMessageKey(job: JobSummary): string {
  if (isSourceWaitingForModel(job)) return "home.sourceSavedWaitingModel";
  if (job.state === "queued") return "home.jobQueued";
  if (job.state === "running") return "home.jobRunning";
  if (job.state === "cancel_requested") return "home.jobCancelRequested";
  if (job.state === "waiting_dependency") return "home.jobWaiting";
  if (job.state === "awaiting_review") return "home.jobReview";
  return "home.jobFailed";
}

function homeUiStateForJobState(state: JobState | undefined): HomeAgentUiState | undefined {
  if (state === "queued") return "accepted";
  if (state === "running" || state === "cancel_requested") return "running";
  if (
    state === "waiting_dependency" ||
    state === "waiting_permission" ||
    state === "waiting_model_egress" ||
    state === "awaiting_review"
  ) return "waiting";
  if (state === "completed" || state === "completed_with_warnings" || state === "compacted") return "completed";
  if (state === "failed_retryable" || state === "failed_final" || state === "cancelled") return "failed";
  return undefined;
}

function modelEgressReasonMessageKey(reasonCode: ModelEgressPendingRequest["reasonCode"]): string {
  if (reasonCode === "sensitive_confirmation") return "home.modelEgress.sensitive";
  if (reasonCode === "unknown_boundary_confirmation") return "home.modelEgress.unknownBoundary";
  if (reasonCode === "private_or_large_confirmation") return "home.modelEgress.privateOrLarge";
  return "home.modelEgress.confirmAll";
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

function DatasetAnswerResult(props: {
  readonly answer: AgentTurnAnswer;
  readonly modelUsage: HomeAgentModelUsage;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const result = props.answer.datasetResult;
  if (!result) throw new Error("Dataset result metadata is unavailable.");
  const citations = props.answer.citations.filter((citation) =>
    "kind" in citation && citation.kind === "dataset"
  );
  return (
    <section className="dataset-answer" aria-label={props.t("dataset.result")}>
      <header className="dataset-answer-header">
        <div>
          <p className="retrieval-eyebrow">{props.t("dataset.result")}</p>
          <p className="retrieval-answer-text">{props.answer.answer}</p>
          {props.modelUsage === "cloud" ? (
            <p className="muted retrieval-cloud-boundary">{props.t("retrieval.cloudSent")}</p>
          ) : null}
        </div>
        <p className="muted dataset-answer-count">
          {props.t("dataset.rows")}: {result.returnedRowCount}/{result.matchedRowCount}
        </p>
      </header>
      <div className="dataset-table-scroll" tabIndex={0} aria-label={props.t("dataset.table")}>
        <table className="dataset-table">
          <caption>{result.tableName}</caption>
          <thead>
            <tr>
              {result.columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={row.rowId ?? `${result.resultHash}:${rowIndex}`}>
                {row.values.map((value, columnIndex) => (
                  <td key={result.columns[columnIndex]?.key ?? columnIndex}>{formatDatasetScalar(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated ? <p className="muted retrieval-warning">{props.t("dataset.truncated")}</p> : null}
      {citations.length > 0 ? (
        <div className="dataset-citations" aria-label={props.t("dataset.citations")}>
          {citations.map((citation) => <span key={citation.refId}>{citation.label} {citation.title}</span>)}
        </div>
      ) : null}
    </section>
  );
}

function formatDatasetScalar(value: string | number | boolean | null): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
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
  const citations = answer.citations.filter(
    (citation): citation is RetrievalAnswerCitation => !("kind" in citation)
  );
  return {
    ...answer.retrieval,
    answeredAt: new Date().toISOString(),
    answer: answer.answer,
    answerMode: "model_grounded",
    confidence: answer.grounding === "insufficient_evidence"
      ? "insufficient"
      : citations.length > 1
        ? "grounded"
        : "limited",
    citations,
    warnings: answer.grounding === "insufficient_evidence"
      ? ["insufficient_evidence"]
      : [
          ...(citations.length === 1 ? ["limited_evidence" as const] : []),
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
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const restore = useRestoreFlow(async () => {
    setBackupNotice(props.t("backup.restored"));
    await props.onRefresh();
    await props.onRefreshDiagnostics();
  }, () => props.onError(null));

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
            ref={restore.previewButtonRef}
            type="button"
            className="secondary"
            disabled={
              backupBusy ||
              restore.restorePhase !== "idle" ||
              !props.backupStatus?.restoreAvailable
            }
            onClick={() => void restore.previewRestore()}
          >
            {props.t(restore.restorePhase === "previewing" ? "backup.opening" : "backup.restore")}
          </button>
        </div>
        {backupNotice ? <p className="muted">{backupNotice}</p> : null}
        {restore.restorePreview ? (
          <RestorePreviewPanel
            idPrefix="vault-settings"
            preview={restore.restorePreview}
            mode={restore.restoreMode}
            phase={restore.restorePhase}
            errorKey={restore.restoreErrorKey}
            applyButtonRef={restore.applyButtonRef}
            onModeChange={restore.selectRestoreMode}
            onApply={restore.applyRestore}
            onCancel={restore.cancelRestore}
            t={props.t}
          />
        ) : null}
        {!restore.restorePreview && restore.restoreErrorKey ? (
          <p className="error" role="alert">{props.t(restore.restoreErrorKey)}</p>
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
