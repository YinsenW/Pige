import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { PigeIcon, type PigeIconName } from "./components/PigeIcon";
import { KnowledgeTreeMap } from "./components/KnowledgeTreeMap";
import { CurrentNoteAgent } from "./components/CurrentNoteAgent";
import { ProposalReviewPanel } from "./components/ProposalReviewPanel";
import pigeMarkUrl from "../../../../../resources/brand/pige-icon/master/pige-icon-1024.png";
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
  PermissionPendingRequest,
  ProviderConnectNeedsManualModel,
  ProposalDecisionResult,
  ProposalSummary,
  RecentVaultSummary,
  RetrievalAnswerCitation,
  RetrievalAskResult,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RestoreMode,
  RestorePreviewWarning,
  RestorePreviewResult,
  SupportBundlePreview,
  ToolchainHealth,
  VaultRevealTarget,
  VaultSummary,
  WindowState
} from "@pige/contracts";
import type {
  ConfirmationProposal,
  JobState,
  Locale,
  ProviderEndpointProtocol,
  SourceStorageStrategy
} from "@pige/schemas";

type View = "home" | "library" | "knowledgeTree";
export type SettingsSection =
  | "general"
  | "appearance"
  | "vault"
  | "maintenance"
  | "models"
  | "capabilities"
  | "memory"
  | "privacy"
  | "skills"
  | "packages"
  | "system";
type CaptureToast = { readonly kind: "success" | "error"; readonly message: string };
type DevelopmentSurface = "home" | "reader" | "knowledge" | "settings";
export type DevelopmentCapability =
  | "voice_input"
  | "knowledge_search"
  | "knowledge_filter"
  | "knowledge_view"
  | "note_agent"
  | "document_actions"
  | "selection_actions"
  | "source_reference"
  | "appearance"
  | "local_capabilities"
  | "agent_memory"
  | "permissions_privacy"
  | "skills"
  | "packages"
  | "updates";
export type DevelopmentNotice = {
  readonly surface: DevelopmentSurface;
  readonly capability: DevelopmentCapability;
  readonly state: "development" | "unavailable";
};
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
type HomePermissionPromptState =
  | { readonly kind: "loading"; readonly requestId: string }
  | {
      readonly kind: "ready" | "resolving";
      readonly request: PermissionPendingRequest;
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function App(): React.JSX.Element {
  const macosWindowShell = /Macintosh|Mac OS X/.test(window.navigator.userAgent);
  const sidebarOverlayLayout = useMediaQuery("(max-width: 831px)");
  const agentOverlayLayout = useMediaQuery("(max-width: 1199px)");
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<readonly RecentVaultSummary[]>([]);
  const [vaultName, setVaultName] = useState(initialVaultName);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [view, setView] = useState<View>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [developmentNotice, setDevelopmentNotice] = useState<DevelopmentNotice | null>(null);
  const [noteAgentOpen, setNoteAgentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<DiagnosticsHealth | null>(null);
  const [localDatabaseStatus, setLocalDatabaseStatus] = useState<LocalDatabaseStatus | null>(null);
  const [supportBundlePreview, setSupportBundlePreview] = useState<SupportBundlePreview | null>(null);
  const [modelSummary, setModelSummary] = useState<ModelProviderSettingsSummary | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupRestoreStatus | null>(null);
  const [backupJobs, setBackupJobs] = useState<readonly JobSummary[]>([]);
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
  const [librarySearchFocusRequest, setLibrarySearchFocusRequest] = useState(0);
  const [librarySidebarExpandedGroups, setLibrarySidebarExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(["family:knowledge", "family:sources"])
  );
  const [knowledgeTree, setKnowledgeTree] = useState<KnowledgeTreeResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteVaultId, setSelectedNoteVaultId] = useState<string | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const noteOpenSequence = useRef(0);
  const noteAgentDisclosureInitialized = useRef(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const noteAgentToggleRef = useRef<HTMLButtonElement | null>(null);
  const knowledgeTreeReturnFocusKey = useRef<string | null>(null);
  const modelRefreshSequence = useRef(0);
  const agentRuntimeRefreshSequence = useRef(0);
  const vaultRefreshSequence = useRef(0);
  const activeVaultIdRef = useRef<string | undefined>(onboarding?.activeVault?.vaultId);
  activeVaultIdRef.current = onboarding?.activeVault?.vaultId;

  const refreshAgentRuntimeStatus = async (): Promise<void> => {
    const refreshId = ++agentRuntimeRefreshSequence.current;
    const nextStatus = await window.pige.agent.runtimeStatus();
    if (refreshId === agentRuntimeRefreshSequence.current) setAgentRuntimeStatus(nextStatus);
  };

  const refreshModels = async (): Promise<ModelProviderSettingsSummary | null> => {
    const refreshId = ++modelRefreshSequence.current;
    try {
      const nextSummary = await window.pige.models.summary();
      if (refreshId !== modelRefreshSequence.current) return null;
      setModelSummary(nextSummary);
      return nextSummary;
    } catch (caught) {
      if (refreshId === modelRefreshSequence.current) throw caught;
      return null;
    }
  };

  useEffect(() => {
    void window.pige.getHealth().then(setHealth).catch((error) => {
      console.error("Failed to get health status:", error);
    });
    void window.pige.window.current().then(setWindowState).catch((error) => {
      console.error("Failed to get window state:", error);
    });
    void window.pige.settings.appearance().then((appearance) => {
      setLocale(appearance.locale);
      setAvailableLocales(appearance.availableLocales);
    }).catch((error) => {
      console.error("Failed to load appearance settings:", error);
    });
    void window.pige.system.toolchainHealth().then(setToolchainHealth).catch((error) => {
      console.error("Failed to get toolchain health:", error);
    });
    void refreshVaultState().catch((error) => {
      console.error("Failed to refresh vault state:", error);
    });
    void refreshModels().catch((error) => {
      console.error("Failed to refresh models:", error);
    });
  }, []);

  useEffect(() => {
    const homeWorkActive = recentJobs.some((job) => job.state === "queued" || job.state === "running");
    const backupWorkActive = backupJobs.some((job) =>
      job.state === "queued" || job.state === "running" || job.state === "cancel_requested"
    );
    if (!homeWorkActive && !backupWorkActive) return;
    const timer = window.setTimeout(() => void refreshVaultState(), 1_200);
    return () => window.clearTimeout(timer);
  }, [recentJobs, backupJobs]);

  const t = (key: string): string => messageCatalogs[locale][key] ?? messageCatalogs.en[key] ?? key;

  const refreshVaultState = async (): Promise<void> => {
    const refreshId = ++vaultRefreshSequence.current;
    const runtimeRefreshId = ++agentRuntimeRefreshSequence.current;
    try {
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
      homeJobStateFilter.states.push("waiting_permission");
      homeJobStateFilter.states.push("waiting_model_egress");
      const [nextJobs, nextBackupJobs, nextProposals, nextActivities] = nextOnboarding.activeVault
        ? await Promise.all([
          window.pige.jobs.list({
            limit: 100,
            classes: ["capture", "parse", "ocr", "agent_ingest", "agent_turn", "index_rebuild"],
            ...homeJobStateFilter
          }).catch(() => undefined),
          window.pige.jobs.list({
            limit: 20,
            classes: ["backup"],
            states: ["queued", "running", "cancel_requested", "failed_retryable", "failed_final"]
          }).catch(() => undefined),
          window.pige.proposals.list({ limit: 100, states: ["ready"] }).catch(() => undefined),
          window.pige.activity.list({ limit: 5 }).catch(() => undefined)
        ])
        : [undefined, undefined, undefined, undefined];
      if (refreshId !== vaultRefreshSequence.current) return;
      if (activeVaultIdRef.current !== nextOnboarding.activeVault?.vaultId) {
        noteOpenSequence.current += 1;
        setSelectedNote(null);
        setSelectedNoteRelated(null);
        setSelectedNoteVaultId(null);
        setNoteLoadingPageId(null);
        setNoteAgentOpen(false);
      }
      setOnboarding(nextOnboarding);
      setRecentVaults(nextRecentVaults);
      setBackupStatus(nextBackupStatus);
      if (runtimeRefreshId === agentRuntimeRefreshSequence.current) {
        setAgentRuntimeStatus(nextAgentRuntimeStatus);
      }
      setRecentJobs(nextJobs?.jobs ?? []);
      setBackupJobs(nextBackupJobs?.jobs.filter((job) => job.backupKind === "user_backup") ?? []);
      setReadyProposals(nextProposals?.proposals ?? []);
      setRecentActivities(nextActivities?.activities ?? []);
    } catch (caught) {
      if (refreshId === vaultRefreshSequence.current) throw caught;
    }
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

  const setHomeDefaultModel = async (modelProfileId: string): Promise<boolean> => {
    const modelRequestId = ++modelRefreshSequence.current;
    try {
      await window.pige.models.setDefaultModel({ modelProfileId });
      const nextSummary = await window.pige.models.summary();
      if (modelRequestId !== modelRefreshSequence.current) return false;
      const runtimeRequestId = ++agentRuntimeRefreshSequence.current;
      const nextRuntimeStatus = await window.pige.agent.runtimeStatus();
      if (
        modelRequestId !== modelRefreshSequence.current ||
        runtimeRequestId !== agentRuntimeRefreshSequence.current
      ) return false;
      setModelSummary(nextSummary);
      setAgentRuntimeStatus(nextRuntimeStatus);
      return true;
    } catch {
      return false;
    }
  };

  const dismissFirstHomeGuide = async (): Promise<void> => {
    try {
      setOnboarding(await window.pige.vault.dismissFirstHomeGuide());
    } catch {
      setCaptureToast({ kind: "error", message: t("error.generic") });
    }
  };

  const openModelsFromHome = async (opener: HTMLButtonElement): Promise<void> => {
    settingsOpenerRef.current = opener;
    await dismissFirstHomeGuide();
    setSettingsSection("models");
    setDevelopmentNotice(null);
    setSettingsOpen(true);
  };

  const openSettings = (section: SettingsSection, opener: HTMLButtonElement): void => {
    settingsOpenerRef.current = opener;
    setSettingsSection(section);
    setDevelopmentNotice(null);
    setSettingsOpen(true);
  };

  const closeSettings = (): void => {
    setSettingsOpen(false);
    setDevelopmentNotice(null);
    void refreshVaultState().catch(() => {
      setCaptureToast({ kind: "error", message: t("error.generic") });
    });
    const opener = settingsOpenerRef.current;
    settingsOpenerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
      else if (settingsTriggerRef.current?.isConnected) settingsTriggerRef.current.focus();
    });
  };

  const showDevelopmentCapability = (
    surface: DevelopmentSurface,
    capability: DevelopmentCapability,
    state: DevelopmentNotice["state"] = "development"
  ): void => {
    setDevelopmentNotice({ surface, capability, state });
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
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return;
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setDevelopmentNotice(null);
    setLibraryError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (requestId !== noteOpenSequence.current || activeVaultIdRef.current !== vaultId) return;
      if (!noteAgentDisclosureInitialized.current) {
        noteAgentDisclosureInitialized.current = true;
        setNoteAgentOpen(!agentOverlayLayout);
      }
      setSelectedNoteVaultId(vaultId);
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    } catch {
      if (requestId !== noteOpenSequence.current) return;
      setLibraryError(t("error.generic"));
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  const copyNoteMarkdown = async (pageId: string): Promise<boolean> => {
    const requestId = noteOpenSequence.current;
    try {
      const note = await window.pige.notes.get({ pageId });
      if (
        requestId !== noteOpenSequence.current ||
        note.summary.pageId !== pageId ||
        selectedNote?.summary.pageId !== pageId ||
        !navigator.clipboard?.writeText
      ) return false;
      await navigator.clipboard.writeText(note.markdownBody);
      return requestId === noteOpenSequence.current && selectedNote?.summary.pageId === pageId;
    } catch {
      return false;
    }
  };

  const toggleSidebar = async (): Promise<void> => {
    const nextSidebarOpen = !(windowState?.sidebarOpen ?? false);
    if (nextSidebarOpen && sidebarOverlayLayout && noteAgentOpen) setNoteAgentOpen(false);
    if (nextSidebarOpen && windowState?.mode === "compact") {
      setWindowState(await window.pige.window.setMode({ mode: "expanded" }));
    } else if (!nextSidebarOpen && view === "home" && windowState?.mode === "expanded") {
      setWindowState(await window.pige.window.setMode({ mode: "compact" }));
    }
    setWindowState(await window.pige.window.setSidebarOpen({ sidebarOpen: nextSidebarOpen }));
    if (nextSidebarOpen && activeVault) void refreshLibrary();
    if (!nextSidebarOpen && sidebarOverlayLayout) {
      window.requestAnimationFrame(() => sidebarToggleRef.current?.focus());
    }
  };

  const navigateHome = (): void => {
    noteOpenSequence.current += 1;
    knowledgeTreeReturnFocusKey.current = null;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setView("home");
    void refreshVaultState().catch(() => {
      setCaptureToast({ kind: "error", message: t("error.generic") });
    });
  };

  const navigateLibrarySearch = async (): Promise<void> => {
    noteOpenSequence.current += 1;
    knowledgeTreeReturnFocusKey.current = null;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setDevelopmentNotice(null);
    setView("library");
    void refreshLibrary();
    if (sidebarOverlayLayout && (windowState?.sidebarOpen ?? false)) {
      try {
        setWindowState(await window.pige.window.setSidebarOpen({ sidebarOpen: false }));
      } finally {
        setLibrarySearchFocusRequest((current) => current + 1);
      }
      return;
    }
    setLibrarySearchFocusRequest((current) => current + 1);
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
  const sidebarModal = sidebarOverlayLayout && sidebarOpen;
  const agentModal = agentOverlayLayout && Boolean(selectedNote && noteAgentOpen);
  const currentTitle = view === "home"
    ? "Pige"
    : view === "library"
      ? t("nav.library")
      : t("nav.knowledgeTree");

  useEffect(() => {
    if (!sidebarOpen || !activeVault || libraryList) return;
    void refreshLibrary();
  }, [activeVault?.vaultId, libraryList, sidebarOpen]);

  useEffect(() => {
    if (!selectedNote || selectedNoteVaultId === activeVault?.vaultId) return;
    noteOpenSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteLoadingPageId(null);
    setNoteAgentOpen(false);
  }, [activeVault?.vaultId, selectedNote?.summary.pageId, selectedNoteVaultId]);

  useEffect(() => {
    if (!sidebarModal) return;
    const frame = window.requestAnimationFrame(() => {
      focusFirstOverlayControl(sidebarRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarModal]);

  const toggleNoteAgent = (): void => {
    const nextOpen = !noteAgentOpen;
    if (nextOpen && sidebarOverlayLayout && sidebarOpen) {
      void toggleSidebar()
        .then(() => setNoteAgentOpen(true))
        .catch((error) => {
          console.error("Failed to toggle sidebar:", error);
        });
      return;
    }
    setNoteAgentOpen(nextOpen);
  };

  return (
    <div
      className={`shell app-window mode-${windowState?.mode ?? "compact"}${macosWindowShell ? " platform-macos" : ""}${sidebarOpen ? " sidebar-expanded" : ""}${selectedNote ? " note-mode" : ""}${dropActive ? " drop-active" : ""}`}
      aria-label="Pige"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="topbar titlebar" inert={agentModal}>
        <div className="topbar-leading titlebar-navigation">
          {view !== "home" ? (
            <button
              className="icon-button home-return-button"
              type="button"
              aria-label={t("nav.home")}
              title={t("nav.home")}
              tabIndex={sidebarModal ? -1 : undefined}
              onClick={navigateHome}
            >
              <PigeIcon name="home" />
            </button>
          ) : null}
          <button
            ref={sidebarToggleRef}
            className="icon-button sidebar-toggle-button"
            type="button"
            aria-label={sidebarOpen ? t("topbar.collapseSidebar") : t("topbar.expandSidebar")}
            title={sidebarOpen ? t("topbar.collapseSidebar") : t("topbar.expandSidebar")}
            aria-expanded={sidebarOpen}
            aria-controls="pige-library-sidebar"
            onClick={() => void toggleSidebar()}
          >
            <PigeIcon name="panel" />
          </button>
        </div>
        <span className="topbar-title" aria-hidden="true">{currentTitle}</span>
        <div className="topbar-actions">
          <button
            type="button"
            className={windowState?.alwaysOnTop ? "icon-button pin-button active" : "icon-button pin-button"}
            aria-label={t("topbar.pin")}
            title={t("topbar.pin")}
            aria-pressed={windowState?.alwaysOnTop ?? false}
            tabIndex={sidebarModal ? -1 : undefined}
            onClick={() => void toggleAlwaysOnTop()}
          >
            <PigeIcon name="pin" />
          </button>
        </div>
      </header>

      <div className={`main-layout${sidebarOpen ? " sidebar-open" : ""}${selectedNote ? " note-open" : ""}${selectedNote && noteAgentOpen ? " agent-open" : ""}`}>
        {sidebarOpen ? (
          <aside
            ref={sidebarRef}
            className="sidebar"
            id="pige-library-sidebar"
            role={sidebarModal ? "dialog" : undefined}
            aria-modal={sidebarModal ? "true" : undefined}
            aria-label={sidebarModal ? t("nav.library") : undefined}
            inert={agentModal}
            onKeyDown={(event) => {
              if (!sidebarModal) return;
              containOverlayFocus(event, event.currentTarget, () => void toggleSidebar());
            }}
          >
            <div className="sidebar-inner">
            <div className="sidebar-brand">
              <img src={pigeMarkUrl} alt="" />
              <span>Pige Agent</span>
              <button
                className="icon-button sidebar-search"
                type="button"
                aria-label={t("library.search")}
                title={t("library.search")}
                onClick={() => void navigateLibrarySearch()}
              >
                <PigeIcon name="search" />
              </button>
            </div>
            <nav className="primary-navigation nav-list" aria-label={t("nav.library")}>
            <button
              className={view === "home" ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={view === "home" ? "page" : undefined}
              onClick={navigateHome}
            >
              <PigeIcon name="home" size={16} />
              <span>{t("nav.home")}</span>
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
              <PigeIcon name="knowledge" size={16} />
              <span>{t("nav.knowledgeTree")}</span>
            </button>
            </nav>
            {activeVault ? (
              <LibrarySidebarTree
                libraryList={libraryList}
                selectedPageId={selectedNote?.summary.pageId}
                expandedGroups={librarySidebarExpandedGroups}
                onToggleGroup={(groupId) => {
                  setLibrarySidebarExpandedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(groupId)) next.delete(groupId);
                    else next.add(groupId);
                    return next;
                  });
                }}
                onOpenNote={async (pageId) => {
                  setView("library");
                  await openNote(pageId);
                }}
                t={t}
              />
            ) : null}
            <button
              ref={settingsTriggerRef}
              className="sidebar-settings-control"
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => openSettings("general", event.currentTarget)}
            >
              <PigeIcon name="settings" size={16} />
              <span>
                <strong>{activeVault?.name ?? "Pige"}</strong>
                <small>{t("settings.open")}</small>
              </span>
              <PigeIcon name="expand" size={14} />
            </button>
            </div>
          </aside>
        ) : null}
        <main className="workspace" inert={sidebarModal || agentModal}>
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
            onGoHome={navigateHome}
            onRefresh={refreshLibrary}
            onSearch={(request) => window.pige.retrieval.search(request)}
            searchFocusRequest={librarySearchFocusRequest}
            onOpenNote={openNote}
            onCloseNote={() => {
              noteOpenSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
            noteAgentOpen={noteAgentOpen}
            onToggleNoteAgent={toggleNoteAgent}
            noteAgentToggleRef={noteAgentToggleRef}
            developmentNotice={developmentNotice?.surface === "reader" ? developmentNotice : null}
            onClearDevelopment={() => setDevelopmentNotice(null)}
            onCopyNote={copyNoteMarkdown}
            onDevelopment={(capability) => showDevelopmentCapability("reader", capability)}
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
              onGoHome={navigateHome}
              onRefresh={refreshLibrary}
              onSearch={(request) => window.pige.retrieval.search(request)}
              searchFocusRequest={librarySearchFocusRequest}
              onOpenNote={openNote}
              onCloseNote={() => {
                noteOpenSequence.current += 1;
                setSelectedNote(null);
                setSelectedNoteRelated(null);
                restoreKnowledgeTreeFocus(knowledgeTreeReturnFocusKey.current);
              }}
              noteAgentOpen={noteAgentOpen}
              onToggleNoteAgent={toggleNoteAgent}
              noteAgentToggleRef={noteAgentToggleRef}
              developmentNotice={developmentNotice?.surface === "reader" ? developmentNotice : null}
              onClearDevelopment={() => setDevelopmentNotice(null)}
              onCopyNote={copyNoteMarkdown}
              onDevelopment={(capability) => showDevelopmentCapability("reader", capability)}
              t={t}
            />
          ) : (
            <KnowledgeTreePanel
              tree={knowledgeTree}
              error={libraryError}
              noteLoadingPageId={noteLoadingPageId}
              onGoHome={navigateHome}
              onRefresh={refreshKnowledgeTree}
              onOpenNote={async (pageId, focusKey) => {
                knowledgeTreeReturnFocusKey.current = focusKey;
                await openNote(pageId);
              }}
              developmentNotice={developmentNotice?.surface === "knowledge" ? developmentNotice : null}
              onDevelopment={(capability) => showDevelopmentCapability("knowledge", capability)}
              t={t}
            />
          )
        ) : (
          <HomeComposer
            activeVault={activeVault}
            captureOnly={onboarding?.state === "capture_only"}
            agentRuntimeStatus={agentRuntimeStatus}
            modelSummary={modelSummary}
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
            onSetDefaultModel={setHomeDefaultModel}
            onOpenModels={openModelsFromHome}
            onDismissFirstHome={dismissFirstHomeGuide}
            developmentNotice={developmentNotice?.surface === "home" ? developmentNotice : null}
            onDevelopment={(capability) => showDevelopmentCapability("home", capability)}
            t={t}
          />
        )}
        </main>
        {selectedNote && noteAgentOpen && activeVault && selectedNoteVaultId === activeVault.vaultId ? (
          <CurrentNoteAgent
            key={`${activeVault.vaultId}:${selectedNote.summary.pageId}`}
            modal={agentModal}
            vaultId={activeVault.vaultId}
            pageId={selectedNote.summary.pageId}
            noteTitle={selectedNote.summary.title}
            locale={locale}
            models={(modelSummary?.models ?? []).filter((model) => model.enabled).map((model) => {
              const providerName = modelSummary?.providers.find((provider) => provider.id === model.providerProfileId)?.displayName;
              return {
                id: model.id,
                name: model.displayName ?? model.modelId,
                ...(providerName ? { providerName } : {}),
                selected: model.id === modelSummary?.defaultModelProfileId,
                ready: model.id === modelSummary?.defaultModelProfileId &&
                  agentRuntimeStatus?.state === "ready" &&
                  agentRuntimeStatus.canRunModelJobs &&
                  agentRuntimeStatus.defaultModelProfileId === model.id
              };
            })}
            onClose={() => {
              setNoteAgentOpen(false);
              window.requestAnimationFrame(() => noteAgentToggleRef.current?.focus());
            }}
            onOpenModels={(opener) => openSettings("models", opener)}
            onSelectModel={setHomeDefaultModel}
            onOpenCitation={(pageId) => {
              if (pageId !== selectedNote.summary.pageId) return;
              void openNote(pageId);
            }}
            t={t}
          />
        ) : null}
      </div>
      {settingsOpen ? (
        <SettingsSurface
          section={settingsSection}
          locale={locale}
          availableLocales={availableLocales}
          alwaysOnTop={windowState?.alwaysOnTop ?? false}
          developmentNotice={developmentNotice?.surface === "settings" ? developmentNotice : null}
          onSectionChange={(section) => {
            setSettingsSection(section);
            setDevelopmentNotice(null);
          }}
          onClose={closeSettings}
          onLocaleChange={updateLocale}
          onAlwaysOnTopChange={toggleAlwaysOnTop}
          onDevelopment={(capability) => showDevelopmentCapability("settings", capability)}
          t={t}
        >
          {settingsSection === "models" ? (
            <ModelSettingsPanel
              busy={busy}
              modelSummary={modelSummary}
              onRefreshModels={refreshModels}
              onRefreshAgentRuntimeStatus={refreshAgentRuntimeStatus}
              onBusy={setBusy}
              t={t}
            />
          ) : settingsSection === "vault" || settingsSection === "maintenance" ? (
            activeVault ? (
              <VaultSettingsPanel
                surface={settingsSection}
                busy={busy}
                error={error}
                vault={activeVault}
                localDatabaseStatus={localDatabaseStatus}
                backupStatus={backupStatus}
                backupJobs={backupJobs}
                toolchainHealth={toolchainHealth}
                recentVaults={recentVaults}
                onOpen={openVault}
                onCreate={createVault}
                onRefresh={refreshVaultState}
                onRefreshDiagnostics={refreshDiagnostics}
                onRemoveRecent={removeRecent}
                onError={setError}
                t={t}
              />
            ) : null
          ) : settingsSection === "general" ? (
            <GeneralSettingsPanel
              locale={locale}
              availableLocales={availableLocales}
              alwaysOnTop={windowState?.alwaysOnTop ?? false}
              onLocaleChange={updateLocale}
              onAlwaysOnTopChange={toggleAlwaysOnTop}
              t={t}
            />
          ) : settingsSection === "skills" ? (
            <SkillsSettingsPanel
              onDevelopment={() => showDevelopmentCapability("settings", "skills")}
              t={t}
            />
          ) : settingsSection === "system" ? (
            <SystemSettingsPanel
              diagnosticsHealth={diagnosticsHealth}
              supportBundlePreview={supportBundlePreview}
              onRefreshDiagnostics={refreshDiagnostics}
              onSupportBundlePreviewChange={setSupportBundlePreview}
              t={t}
            />
          ) : (
            <DevelopmentSettingsSection section={settingsSection} t={t} />
          )}
        </SettingsSurface>
      ) : null}
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
    </div>
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

const libraryKnowledgePageTypes = ["note", "topic", "concept", "entity", "claim", "question"] as const;

function LibrarySidebarTree(props: {
  readonly libraryList: LibraryListResult | null;
  readonly selectedPageId: string | undefined;
  readonly expandedGroups: ReadonlySet<string>;
  readonly onToggleGroup: (groupId: string) => void;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const pages = props.libraryList?.pages ?? [];
  const families = [
    {
      id: "sources",
      label: props.t("library.sources"),
      types: ["source"] as const,
      icon: "file" as const
    },
    {
      id: "knowledge",
      label: props.t("library.knowledge"),
      types: libraryKnowledgePageTypes,
      icon: "folder" as const
    }
  ];

  return (
    <section className="library-sidebar-tree" aria-labelledby="library-sidebar-heading">
      <div className="library-sidebar-heading-row">
        <h2 id="library-sidebar-heading">{props.t("nav.library")}</h2>
        <span>{props.libraryList?.total ?? 0}</span>
      </div>
      {!props.libraryList ? (
        <p className="library-sidebar-state" role="status">{props.t("library.loading")}</p>
      ) : pages.length === 0 ? (
        <p className="library-sidebar-state">{props.t("library.empty")}</p>
      ) : (
        <ul className="library-tree-root">
          {families.map((family) => {
            const familyPages = pages.filter((page) => family.types.some((pageType) => pageType === page.pageType));
            if (familyPages.length === 0) return null;
            const familyKey = `family:${family.id}`;
            const familyExpanded = props.expandedGroups.has(familyKey);
            const familyPanelId = `library-sidebar-${family.id}`;
            return (
              <li key={family.id}>
                <button
                  className="library-tree-disclosure"
                  type="button"
                  aria-expanded={familyExpanded}
                  aria-controls={familyPanelId}
                  onClick={() => props.onToggleGroup(familyKey)}
                >
                  <PigeIcon name={familyExpanded ? "collapse" : "expand"} size={14} />
                  <PigeIcon name={family.icon} size={15} />
                  <span>{family.label}</span>
                  <small>{familyPages.length}</small>
                </button>
                {familyExpanded ? (
                  <ul id={familyPanelId} className="library-tree-types">
                    {family.types.map((pageType) => {
                      const typedPages = familyPages.filter((page) => page.pageType === pageType);
                      if (typedPages.length === 0) return null;
                      const typeKey = `type:${pageType}`;
                      const typeExpanded = props.expandedGroups.has(typeKey);
                      const typePanelId = `library-sidebar-type-${pageType}`;
                      return (
                        <li key={pageType}>
                          <button
                            className="library-tree-disclosure type-disclosure"
                            type="button"
                            aria-expanded={typeExpanded}
                            aria-controls={typePanelId}
                            onClick={() => props.onToggleGroup(typeKey)}
                          >
                            <PigeIcon name={typeExpanded ? "collapse" : "expand"} size={13} />
                            <span>{props.t(`library.type.${pageType}`)}</span>
                            <small>{typedPages.length}</small>
                          </button>
                          {typeExpanded ? (
                            <ul id={typePanelId} className="library-tree-pages">
                              {typedPages.map((page) => (
                                <li key={page.pageId}>
                                  <button
                                    type="button"
                                    className={props.selectedPageId === page.pageId ? "library-tree-page active" : "library-tree-page"}
                                    aria-current={props.selectedPageId === page.pageId ? "page" : undefined}
                                    title={page.title}
                                    onClick={() => void props.onOpenNote(page.pageId)}
                                  >
                                    <PigeIcon name={page.pageType === "source" ? "file" : "fileText"} size={14} />
                                    <span>{page.title}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function LibraryPanel(props: {
  readonly libraryList: LibraryListResult | null;
  readonly selectedNote: NoteRenderResult | null;
  readonly selectedNoteRelated: NoteRelatedState;
  readonly noteLoadingPageId: string | null;
  readonly error: string | null;
  readonly readerBackLabel?: string;
  readonly onGoHome: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSearch: (request: RetrievalSearchRequest) => Promise<RetrievalSearchResult>;
  readonly searchFocusRequest: number;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly onCloseNote: () => void;
  readonly noteAgentOpen: boolean;
  readonly onToggleNoteAgent: () => void;
  readonly noteAgentToggleRef: RefObject<HTMLButtonElement | null>;
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onClearDevelopment: () => void;
  readonly onCopyNote: (pageId: string) => Promise<boolean>;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const pages = props.libraryList?.pages ?? [];
  const [family, setFamily] = useState<LibraryFamily>("all");
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [searchState, setSearchState] = useState<LibrarySearchState>({ kind: "idle" });
  const searchSequence = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef(new Map<LibraryFamily, HTMLButtonElement>());
  const focusSearchAfterRetry = useRef(false);
  const readerActionSequence = useRef(0);
  const [readerActionState, setReaderActionState] = useState<"idle" | "copying" | "copied" | "copy_failed">("idle");
  const normalizedQuery = query.trim();
  const activeVaultId = props.libraryList?.activeVaultId;

  useEffect(() => {
    readerActionSequence.current += 1;
    setReaderActionState("idle");
  }, [props.selectedNote?.summary.pageId]);

  const showReaderDevelopment = (capability: DevelopmentCapability): void => {
    readerActionSequence.current += 1;
    setReaderActionState("idle");
    props.onClearDevelopment();
    props.onDevelopment(capability);
  };

  const copySelectedNote = async (pageId: string): Promise<void> => {
    const requestId = readerActionSequence.current + 1;
    readerActionSequence.current = requestId;
    props.onClearDevelopment();
    setReaderActionState("copying");
    const copied = await props.onCopyNote(pageId);
    if (requestId !== readerActionSequence.current) return;
    setReaderActionState(copied ? "copied" : "copy_failed");
  };

  useEffect(() => {
    if (props.searchFocusRequest <= 0) return;
    searchInputRef.current?.focus();
  }, [props.searchFocusRequest]);

  useEffect(() => {
    const requestId = ++searchSequence.current;
    if (props.selectedNote || !activeVaultId || !normalizedQuery || family === "tags") {
      setSearchState({ kind: "idle" });
      return;
    }
    setSearchState({ kind: "loading", query: normalizedQuery, family });
    const timer = window.setTimeout(() => {
      const pageTypes = libraryFamilyPageTypes(family);
      const request = {
        query: normalizedQuery,
        limit: 20,
        ...(pageTypes ? { pageTypes } : {}),
        scope: { kind: "active_vault" as const, vaultId: activeVaultId }
      };
      void props.onSearch(request).then((result) => {
        if (requestId !== searchSequence.current) return;
        if (activeVaultId && result.activeVaultId !== activeVaultId) {
          setSearchState({ kind: "error", query: normalizedQuery, family });
          return;
        }
        setSearchState({ kind: "result", query: normalizedQuery, family, result });
        if (focusSearchAfterRetry.current) {
          focusSearchAfterRetry.current = false;
          window.requestAnimationFrame(() => searchInputRef.current?.focus());
        }
      }).catch(() => {
        if (requestId !== searchSequence.current) return;
        setSearchState({ kind: "error", query: normalizedQuery, family });
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeVaultId, family, normalizedQuery, props.selectedNote?.summary.pageId, searchRevision]);

  const selectFamily = (nextFamily: LibraryFamily, restoreFocus = false): void => {
    setFamily(nextFamily);
    if (restoreFocus) window.requestAnimationFrame(() => tabRefs.current.get(nextFamily)?.focus());
  };

  const handleFamilyKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentFamily: LibraryFamily
  ): void => {
    const currentIndex = LIBRARY_FAMILIES.indexOf(currentFamily);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % LIBRARY_FAMILIES.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + LIBRARY_FAMILIES.length) % LIBRARY_FAMILIES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = LIBRARY_FAMILIES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextFamily = LIBRARY_FAMILIES[nextIndex];
    if (nextFamily) selectFamily(nextFamily, true);
  };

  if (props.selectedNote) {
    const summary = props.selectedNote.summary;
    return (
      <section className="library-page reader-page" aria-label={props.t("note.reader")}>
        <header className="reader-toolbar">
          <nav className="reader-breadcrumbs" aria-label={props.t("note.path")}>
            <span>{props.readerBackLabel ?? props.t("library.title")}</span>
            <span aria-hidden="true">›</span>
            <span>{props.t(`library.type.${summary.pageType}`)}</span>
            <span aria-hidden="true">›</span>
            <strong aria-current="page" title={summary.title}>{summary.title}</strong>
          </nav>
          <div className="reader-toolbar-actions">
            <button
              ref={props.noteAgentToggleRef}
              type="button"
              className="icon-button reader-pane-toggle"
              aria-label={props.noteAgentOpen ? props.t("noteAgent.hide") : props.t("noteAgent.show")}
              title={props.noteAgentOpen ? props.t("noteAgent.hide") : props.t("noteAgent.show")}
              aria-expanded={props.noteAgentOpen}
              aria-controls="note-agent-pane"
              onClick={props.onToggleNoteAgent}
            >
              <PigeIcon name="panel" size={17} />
            </button>
            <button
              type="button"
              data-reader-action="edit"
              className="icon-button prototype-action"
              aria-label={props.t("note.edit")}
              title={props.t("note.edit")}
              onClick={() => showReaderDevelopment("document_actions")}
            >
              <PigeIcon name="edit" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              data-reader-action="copy"
              aria-label={props.t("note.copy")}
              title={props.t("note.copy")}
              disabled={readerActionState === "copying"}
              aria-busy={readerActionState === "copying"}
              onClick={() => void copySelectedNote(summary.pageId)}
            >
              <PigeIcon name="copy" size={16} />
            </button>
            <button
              type="button"
              data-reader-action="more"
              className="icon-button prototype-action"
              aria-label={props.t("note.moreActions")}
              title={props.t("note.moreActions")}
              onClick={() => showReaderDevelopment("document_actions")}
            >
              <PigeIcon name="more" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={props.t("note.close")}
              title={props.t("note.close")}
              onClick={props.onCloseNote}
            >
              <PigeIcon name="close" size={17} />
            </button>
          </div>
        </header>
        {readerActionState !== "idle" ? (
          <p className={`reader-action-status ${readerActionState}`} role="status" aria-live="polite" aria-atomic="true">
            {props.t(`note.document.${readerActionState}`)}
          </p>
        ) : (
          <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
        )}
        <NoteReader
          note={props.selectedNote}
          related={props.selectedNoteRelated}
          relatedLoadingPageId={props.noteLoadingPageId}
          onOpenRelated={props.onOpenNote}
          onDevelopment={showReaderDevelopment}
          t={props.t}
        />
        {props.error ? <p className="error">{props.error}</p> : null}
      </section>
    );
  }

  const resultMatchesCurrentQuery = searchState.kind === "result" &&
    searchState.query === normalizedQuery && searchState.family === family;
  const errorMatchesCurrentQuery = searchState.kind === "error" &&
    searchState.query === normalizedQuery && searchState.family === family;
  const loadingCurrentQuery = normalizedQuery.length > 0 && family !== "tags" &&
    (!resultMatchesCurrentQuery && !errorMatchesCurrentQuery);
  const displayedItems = resultMatchesCurrentQuery
    ? searchState.result.results
    : normalizedQuery.length === 0
      ? libraryBrowseItems(pages, family)
      : [];
  const groupedItems = groupLibrarySearchItems(displayedItems);

  return (
    <section className="library-page library-search-view" aria-label={props.t("nav.library")}>
      <header className="library-header view-toolbar">
        <strong>{props.t("library.title")}</strong>
        <span className="toolbar-meta">{props.t("library.content")}</span>
        <button
          type="button"
          className="icon-button"
          title={props.t("library.refresh")}
          aria-label={props.t("library.refresh")}
          onClick={() => void props.onRefresh()}
        >
          <PigeIcon name="loading" size={16} />
        </button>
      </header>

      <div className="library-search-content">
        <label className="library-search-field">
          <PigeIcon name="search" size={15} />
          <input
            ref={searchInputRef}
            id="librarySearchInput"
            type="search"
            maxLength={320}
            value={query}
            placeholder={props.t("library.search")}
            aria-label={props.t("library.search")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div className="library-tabs" role="tablist" aria-label={props.t("library.content")}>
          {LIBRARY_FAMILIES.map((value) => (
            <button
              key={value}
              ref={(element) => {
                if (element) tabRefs.current.set(value, element);
                else tabRefs.current.delete(value);
              }}
              id={`library-tab-${value}`}
              className={family === value ? "library-tab active" : "library-tab"}
              type="button"
              role="tab"
              aria-selected={family === value}
              aria-controls="library-search-results"
              tabIndex={family === value ? 0 : -1}
              onClick={() => selectFamily(value)}
              onKeyDown={(event) => handleFamilyKeyDown(event, value)}
            >
              {props.t(`library.family.${value}`)}
            </button>
          ))}
        </div>

        <div
          id="library-search-results"
          role="tabpanel"
          aria-labelledby={`library-tab-${family}`}
        >
      {props.error ? (
        <section className="library-state unavailable" role="alert">
          <div className="state-copy">
            <h2>{props.t("library.unavailableTitle")}</h2>
            <p>{props.t("library.unavailableDescription")}</p>
            <button className="primary-button" type="button" onClick={() => void props.onRefresh()}>
              {props.t("library.refresh")}
            </button>
          </div>
        </section>
      ) : !props.libraryList ? (
        <section className="library-state loading" role="status" aria-busy="true">
          <div className="state-copy">
            <span className="state-spinner" aria-hidden="true" />
            <h2>{props.t("library.loading")}</h2>
            <p>{props.t("library.loadingDescription")}</p>
          </div>
        </section>
      ) : family === "tags" ? (
        <section className="library-state inline-unavailable" role="status" aria-live="polite">
          <div className="state-copy">
            <h2>{props.t("library.tagsUnavailableTitle")}</h2>
            <p>{props.t("library.tagsUnavailableDescription")}</p>
          </div>
        </section>
      ) : loadingCurrentQuery ? (
        <section className="library-state inline-loading" role="status" aria-live="polite" aria-busy="true">
          <div className="state-copy">
            <span className="state-spinner" aria-hidden="true" />
            <h2>{props.t("library.searchLoading")}</h2>
          </div>
        </section>
      ) : errorMatchesCurrentQuery ? (
        <section className="library-state inline-unavailable" role="alert">
          <div className="state-copy">
            <h2>{props.t("library.searchUnavailableTitle")}</h2>
            <p>{props.t("library.searchUnavailableDescription")}</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                focusSearchAfterRetry.current = true;
                setSearchRevision((current) => current + 1);
              }}
            >
              {props.t("library.refresh")}
            </button>
          </div>
        </section>
      ) : pages.length === 0 && normalizedQuery.length === 0 ? (
        <section className="library-state empty" role="status">
          <div className="state-copy">
            <h2>{props.t("library.empty")}</h2>
            <p>{props.t("library.emptyDescription")}</p>
            <button className="primary-button" type="button" onClick={props.onGoHome}>
              {props.t("library.addSource")}
            </button>
          </div>
        </section>
      ) : displayedItems.length === 0 ? (
        <p className="search-empty visible" role="status">{props.t("library.noMatches")}</p>
      ) : (
        <>
          {resultMatchesCurrentQuery && searchState.result.degraded ? (
            <p className="library-search-degraded" role="status">{props.t("library.searchDegraded")}</p>
          ) : null}
          {LIBRARY_RESULT_GROUPS.map((group) => {
            const items = groupedItems[group];
            if (items.length === 0) return null;
            return (
              <section className="search-group" key={group} aria-labelledby={`library-group-${group}`}>
                <h2 id={`library-group-${group}`}>{props.t(`library.family.${group}`)}</h2>
                {items.map((item) => {
                  const opening = props.noteLoadingPageId === item.summary.pageId;
                  const matchReason = resultMatchesCurrentQuery
                    ? libraryMatchReasonLabel(item.matchReasons, props.t)
                    : null;
                  const resultMeta = opening
                    ? props.t("note.opening")
                    : resultMatchesCurrentQuery
                      ? matchReason
                      : props.t(`library.type.${item.summary.pageType}`);
                  return (
                    <button
                      className="search-result"
                      type="button"
                      key={item.summary.pageId}
                      disabled={opening}
                      aria-busy={opening}
                      onClick={() => void props.onOpenNote(item.summary.pageId)}
                    >
                      <span className="search-result-icon" aria-hidden="true">
                        {libraryResultIconLabel(item.summary.pageType)}
                      </span>
                      <span className="search-result-copy">
                        <strong>{item.summary.title}</strong>
                        <span>{item.snippets[0] ?? props.t(`library.type.${item.summary.pageType}`)}</span>
                      </span>
                      {resultMeta ? <small>{resultMeta}</small> : null}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </>
      )}
        </div>
      </div>
    </section>
  );
}

type LibraryFamily = "all" | "notes" | "sources" | "topics" | "tags";
type LibraryResultGroup = "notes" | "sources" | "topics";
type LibrarySearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly query: string; readonly family: LibraryFamily }
  | { readonly kind: "result"; readonly query: string; readonly family: LibraryFamily; readonly result: RetrievalSearchResult }
  | { readonly kind: "error"; readonly query: string; readonly family: LibraryFamily };

const LIBRARY_FAMILIES: readonly LibraryFamily[] = ["all", "notes", "sources", "topics", "tags"];
const LIBRARY_RESULT_GROUPS: readonly LibraryResultGroup[] = ["notes", "sources", "topics"];
const LIBRARY_TOPIC_PAGE_TYPES = ["topic", "concept", "entity", "claim", "question"] as const;

function libraryFamilyPageTypes(family: LibraryFamily): RetrievalSearchRequest["pageTypes"] | undefined {
  if (family === "notes") return ["note"];
  if (family === "sources") return ["source"];
  if (family === "topics") return LIBRARY_TOPIC_PAGE_TYPES;
  return undefined;
}

function libraryResultGroup(page: LibraryPageSummary): LibraryResultGroup {
  if (page.pageType === "source") return "sources";
  if (page.pageType === "note") return "notes";
  return "topics";
}

function groupLibrarySearchItems(
  items: readonly RetrievalSearchResultItem[]
): Record<LibraryResultGroup, readonly RetrievalSearchResultItem[]> {
  const groups: Record<LibraryResultGroup, RetrievalSearchResultItem[]> = {
    notes: [],
    sources: [],
    topics: []
  };
  for (const item of items) groups[libraryResultGroup(item.summary)].push(item);
  return groups;
}

function libraryMatchReasonLabel(
  matchReasons: readonly string[],
  t: (key: string) => string
): string | null {
  const labels: string[] = [];
  const knownReasons = new Set<string>();
  for (const reason of matchReasons) {
    if (reason !== "title" && reason !== "body" && reason !== "path") continue;
    if (knownReasons.has(reason)) continue;
    knownReasons.add(reason);
    labels.push(t(`library.matchReason.${reason}`));
  }
  return labels.length > 0 ? labels.join(" · ") : null;
}

function libraryBrowseItems(
  pages: LibraryListResult["pages"],
  family: LibraryFamily
): readonly RetrievalSearchResultItem[] {
  if (family === "tags") return [];
  return pages
    .filter((page) => family === "all" || libraryResultGroup(page) === family)
    .map((summary) => ({ summary, score: 0, snippets: [], matchReasons: [] }));
}

function libraryResultIconLabel(pageType: LibraryPageSummary["pageType"]): string {
  if (pageType === "source") return "SRC";
  if (pageType === "note") return "MD";
  return "#";
}

export function filterLibraryPages(
  pages: LibraryListResult["pages"],
  filter: "all" | "note" | "source" | "topic",
  query: string
): LibraryListResult["pages"] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return pages.filter((page) => {
    if (filter !== "all" && page.pageType !== filter) return false;
    return !normalizedQuery || page.title.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function KnowledgeTreePanel(props: {
  readonly tree: KnowledgeTreeResult | null;
  readonly error: string | null;
  readonly noteLoadingPageId: string | null;
  readonly onGoHome: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const roots = props.tree?.roots ?? [];

  return (
    <section className="knowledge-tree-page" aria-labelledby="knowledge-tree-heading">
      <header className="knowledge-tree-header">
        <div>
          <h1 id="knowledge-tree-heading" tabIndex={-1}>{props.t("knowledgeTree.title")}</h1>
          <p className="muted">{props.t("knowledgeTree.subtitle")}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          title={props.t("knowledgeTree.refresh")}
          aria-label={props.t("knowledgeTree.refresh")}
          onClick={() => void props.onRefresh()}
        >
          <PigeIcon name="loading" size={16} />
        </button>
      </header>

      <DevelopmentStatus notice={props.developmentNotice} t={props.t} />

      {props.error || props.tree?.degraded ? (
        <section className="knowledge-state degraded" role={props.error ? "alert" : "status"}>
          <div className="state-copy">
            <h2>{props.t("knowledgeTree.degraded")}</h2>
            <p>{props.t("knowledgeTree.degradedDescription")}</p>
            <button className="primary-button" type="button" onClick={() => void props.onRefresh()}>
              {props.t("library.refresh")}
            </button>
          </div>
        </section>
      ) : !props.tree ? (
        <section className="knowledge-state loading" role="status" aria-busy="true">
          <div className="state-copy">
            <span className="state-spinner" aria-hidden="true" />
            <h2>{props.t("knowledgeTree.loading")}</h2>
            <p>{props.t("knowledgeTree.loadingDescription")}</p>
          </div>
        </section>
      ) : roots.length === 0 ? (
        <section className="knowledge-state empty" role="status">
          <div className="state-copy">
            <h2>{props.t("knowledgeTree.empty")}</h2>
            <p>{props.t("knowledgeTree.emptyDescription")}</p>
            <button className="primary-button" type="button" onClick={props.onGoHome}>
              {props.t("knowledgeTree.addSource")}
            </button>
          </div>
        </section>
      ) : (
        <>
          <p className="knowledge-tree-totals visually-hidden" aria-label={props.t("knowledgeTree.summary")}>
            <span>{props.t("knowledgeTree.domains")}: {roots.length}</span>
            <span>{props.t("knowledgeTree.topics")}: {props.tree?.totals.topicCount ?? 0}</span>
            <span>{props.t("knowledgeTree.concepts")}: {props.tree?.totals.conceptCount ?? 0}</span>
            <span>{props.t("knowledgeTree.fragments")}: {props.tree?.totals.fragmentPageCount ?? 0}</span>
            <span>{props.t("knowledgeTree.sources")}: {props.tree?.totals.sourceCount ?? 0}</span>
          </p>
          <KnowledgeTreeMap
            roots={roots}
            noteLoadingPageId={props.noteLoadingPageId}
            onOpenNote={props.onOpenNote}
            t={props.t}
          />
        </>
      )}

      {props.tree && props.tree.invalidPageCount > 0 ? (
        <p className="knowledge-tree-warning">
          {props.t("knowledgeTree.invalid")}: {props.tree.invalidPageCount}
        </p>
      ) : null}
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

export function NoteReader(props: {
  readonly note: NoteRenderResult;
  readonly related: NoteRelatedState;
  readonly relatedLoadingPageId: string | null;
  readonly onOpenRelated: (pageId: string) => Promise<void>;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const summary = props.note.summary;
  const readerRef = useRef<HTMLElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const selectionActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectionFocusTransition = useRef(false);
  const selectionFocusOwnerRef = useRef<HTMLElement | null>(null);
  const currentSelectionRef = useRef<{
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  } | null>(null);
  const dismissedSelectionRef = useRef<typeof currentSelectionRef.current>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
    readonly width: number;
  } | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ readonly left: number; readonly top: number } | null>(null);
  const [selectionActionIndex, setSelectionActionIndex] = useState(0);

  const closeSelectionToolbar = (restoreFocus: boolean): void => {
    selectionFocusTransition.current = false;
    dismissedSelectionRef.current = currentSelectionRef.current;
    setSelectionAnchor(null);
    setSelectionPosition(null);
    if (!restoreFocus) return;
    const priorOwner = selectionFocusOwnerRef.current;
    const focusTarget = priorOwner?.isConnected ? priorOwner : readerRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    const updateSelection = (): void => {
      if (selectionFocusTransition.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        currentSelectionRef.current = null;
        dismissedSelectionRef.current = null;
        if (selectionToolbarRef.current?.contains(document.activeElement)) return;
        setSelectionAnchor(null);
        setSelectionPosition(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const selectionNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer as Element
        : range.commonAncestorContainer.parentElement;
      if (!selectionNode || !readerRef.current?.contains(selectionNode) || typeof range.getBoundingClientRect !== "function") {
        setSelectionPosition(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0) {
        setSelectionAnchor(null);
        setSelectionPosition(null);
        return;
      }
      const nextSelection = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
      currentSelectionRef.current = nextSelection;
      const dismissed = dismissedSelectionRef.current;
      if (dismissed
        && dismissed.left === nextSelection.left
        && dismissed.top === nextSelection.top
        && dismissed.right === nextSelection.right
        && dismissed.bottom === nextSelection.bottom) return;
      dismissedSelectionRef.current = null;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && !selectionToolbarRef.current?.contains(activeElement)) {
        selectionFocusOwnerRef.current = activeElement === document.body ? readerRef.current : activeElement;
      }
      const anchor = {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width
      };
      setSelectionAnchor(anchor);
      setSelectionActionIndex(0);
      setSelectionPosition({ left: Math.max(12, anchor.left), top: Math.max(12, anchor.top) });
    };
    const dismissOnScroll = (): void => {
      dismissedSelectionRef.current = currentSelectionRef.current;
      setSelectionAnchor(null);
      setSelectionPosition(null);
    };
    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("resize", updateSelection);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("resize", updateSelection);
      window.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [summary.pageId]);

  useEffect(() => {
    if (!selectionAnchor) return;
    const frame = window.requestAnimationFrame(() => {
      const toolbar = selectionToolbarRef.current;
      if (!toolbar) return;
      const toolbarRect = toolbar.getBoundingClientRect();
      const width = Math.max(toolbarRect.width, toolbar.offsetWidth, toolbar.scrollWidth);
      const height = Math.max(toolbarRect.height, toolbar.offsetHeight, toolbar.scrollHeight);
      if (width <= 0 || height <= 0) return;
      const maxLeft = Math.max(12, window.innerWidth - width - 12);
      const maxTop = Math.max(12, window.innerHeight - height - 12);
      const preferredLeft = selectionAnchor.left + (selectionAnchor.width / 2) - (width / 2);
      const above = selectionAnchor.top - height - 8;
      const preferredTop = above >= 12 ? above : selectionAnchor.bottom + 8;
      const next = {
        left: Math.max(12, Math.min(maxLeft, preferredLeft)),
        top: Math.max(12, Math.min(maxTop, preferredTop))
      };
      setSelectionPosition((current) => current?.left === next.left && current.top === next.top ? current : next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectionAnchor]);

  const moveSelectionActionFocus = (index: number): void => {
    selectionFocusTransition.current = true;
    setSelectionActionIndex(index);
    window.requestAnimationFrame(() => {
      selectionActionRefs.current.get(index)?.focus();
      window.requestAnimationFrame(() => { selectionFocusTransition.current = false; });
    });
  };

  return (
    <article className="note-reader" ref={readerRef} tabIndex={-1}>
      {selectionAnchor && selectionPosition ? (
        <div
          ref={selectionToolbarRef}
          className="selection-toolbar visible"
          role="toolbar"
          aria-label={props.t("note.selectionActions")}
          style={{ left: selectionPosition.left, top: selectionPosition.top }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSelectionToolbar(true);
              return;
            }
            let nextIndex: number | null = null;
            if (event.key === "ArrowRight") nextIndex = (selectionActionIndex + 1) % 4;
            else if (event.key === "ArrowLeft") nextIndex = (selectionActionIndex + 3) % 4;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = 3;
            if (nextIndex === null) return;
            event.preventDefault();
            moveSelectionActionFocus(nextIndex);
          }}
        >
          {(["explain", "summarize", "link", "more"] as const).map((action, index) => (
            <button
              key={action}
              ref={(element) => {
                if (element) selectionActionRefs.current.set(index, element);
                else selectionActionRefs.current.delete(index);
              }}
              type="button"
              tabIndex={selectionActionIndex === index ? 0 : -1}
              data-selection-action={action}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                closeSelectionToolbar(true);
                props.onDevelopment("selection_actions");
              }}
            >
              {props.t(`note.selection.${action}`)}
            </button>
          ))}
        </div>
      ) : null}
      <header className="note-header">
        <h1>{summary.title}</h1>
        <div className="note-meta" aria-label={props.t("note.metadata")}>
          <span>{summary.status}</span>
          {summary.language ? <span>{summary.language}</span> : null}
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
      {summary.sourceIds.length > 0 ? (
        <section className="reader-sources" aria-label={props.t("note.sources")}>
          <h2>{props.t("note.sources")}</h2>
          <div className="reader-source-list">
            {summary.sourceIds.slice(0, 5).map((sourceId, index) => (
              <button
                className="reader-source"
                type="button"
                key={sourceId}
                data-reader-source-action="unavailable"
                onClick={() => props.onDevelopment("source_reference")}
              >
                <span className="reader-source-icon" aria-hidden="true">SRC</span>
                <span className="reader-source-copy">
                  <strong>{props.t("note.savedSource").replace("{number}", String(index + 1))}</strong>
                  <span>{props.t("note.sourceReferenceUnavailable")}</span>
                </span>
                <small>{props.t("note.preview")}</small>
              </button>
            ))}
          </div>
          {summary.sourceIds.length > 5 ? (
            <p className="reader-source-overflow">
              {props.t("note.moreSources").replace("{count}", String(summary.sourceIds.length - 5))}
            </p>
          ) : null}
        </section>
      ) : null}
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

const overlayFocusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusFirstOverlayControl(container: HTMLElement | null): void {
  container?.querySelector<HTMLElement>(overlayFocusableSelector)?.focus({ preventScroll: true });
}

function containOverlayFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement,
  onClose: () => void
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;

  const controls = Array.from(container.querySelectorAll<HTMLElement>(overlayFocusableSelector))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }
  const first = controls[0]!;
  const last = controls.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
  const showingRestore = Boolean(restore.restorePreview);

  return (
    <section className="first-run" aria-label={props.t("firstRun.aria")}>
      <div className="first-run-card">
        <div className="first-run-brand">
          <img src={pigeMarkUrl} alt="" />
          <strong>Pige</strong>
        </div>

        {!showingRestore ? (
          <div className="first-run-step vault">
            <h1>{props.t("firstRun.title")}</h1>
            <p>{props.t("firstRun.subtitle")}</p>
            <label className="first-run-vault-name" htmlFor="vault-name">
              <span>{props.t("firstRun.vaultName")}</span>
              <input
                id="vault-name"
                value={props.vaultName}
                onChange={(event) => props.onVaultNameChange(event.target.value)}
                disabled={props.busy}
              />
            </label>
            <button className="first-run-choice" type="button" onClick={props.onCreate} disabled={props.busy}>
              <PigeIcon name="folder" size={20} />
              <span className="first-run-choice-copy">
                <strong>{props.t("firstRun.createVault")}</strong>
                <span>{props.t("firstRun.createDescription")}</span>
              </span>
            </button>
            <button className="first-run-choice" type="button" onClick={props.onOpen} disabled={props.busy}>
              <PigeIcon name="folder" size={20} />
              <span className="first-run-choice-copy">
                <strong>{props.t("firstRun.openExisting")}</strong>
                <span>{props.t("firstRun.openDescription")}</span>
              </span>
            </button>
            <button
              ref={restore.previewButtonRef}
              type="button"
              className="first-run-choice"
              disabled={props.busy || restore.restorePhase !== "idle"}
              title={props.t("firstRun.restoreHint")}
              onClick={() => void restore.previewRestore()}
            >
              <PigeIcon name={restore.restorePhase === "previewing" ? "loading" : "restore"} size={20} />
              <span className="first-run-choice-copy">
                <strong>{props.t(restore.restorePhase === "previewing" ? "backup.opening" : "firstRun.restoreBackup")}</strong>
                <span>{props.t("firstRun.restoreDescription")}</span>
              </span>
            </button>
            {!restore.restorePreview && restore.restoreErrorKey ? (
              <p className="error" role="alert">{props.t(restore.restoreErrorKey)}</p>
            ) : null}
            <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
          </div>
        ) : (
          <div className="first-run-step restore">
            <RestorePreviewPanel
              idPrefix="first-run"
              preview={restore.restorePreview!}
              mode={restore.restoreMode}
              phase={restore.restorePhase}
              errorKey={restore.restoreErrorKey}
              applyButtonRef={restore.applyButtonRef}
              onModeChange={restore.selectRestoreMode}
              onApply={restore.applyRestore}
              onCancel={restore.cancelRestore}
              t={props.t}
            />
          </div>
        )}
        {props.error ? <p className="error" role="alert">{props.error}</p> : null}
      </div>
    </section>
  );
}

function HomeComposer(props: {
  readonly activeVault: VaultSummary | undefined;
  readonly captureOnly: boolean;
  readonly agentRuntimeStatus: AgentRuntimeStatus | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
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
  readonly onSetDefaultModel: (modelProfileId: string) => Promise<boolean>;
  readonly onOpenModels: (opener: HTMLButtonElement) => Promise<void>;
  readonly onDismissFirstHome: () => Promise<void>;
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const text = props.draftText;
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [agentAnswer, setAgentAnswer] = useState<AgentTurnAnswer | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentTurnDraftEvent | null>(null);
  const [agentRunState, setAgentRunState] = useState<HomeAgentUiState>("idle");
  const [agentError, setAgentError] = useState<PigeErrorSummary | null>(null);
  const [permissionPrompt, setPermissionPrompt] = useState<HomePermissionPromptState | null>(null);
  const [resolvedPermissionRequestId, setResolvedPermissionRequestId] = useState<string | null>(null);
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
  const [processingListExpanded, setProcessingListExpanded] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [modelSwitchFailed, setModelSwitchFailed] = useState(false);
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
  const permissionDecisionInFlight = useRef<string | null>(null);
  const permissionReadSequence = useRef(0);
  const currentPermissionRequestIdRef = useRef<string | undefined>(undefined);
  const currentPermissionJobIdRef = useRef<string | undefined>(undefined);
  const permissionDenyButtonRef = useRef<HTMLButtonElement | null>(null);
  const permissionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const modelEgressDecisionInFlight = useRef(false);
  const modelEgressReadSequence = useRef(0);
  const currentModelEgressRequestIdRef = useRef<string | undefined>(undefined);
  const proposalReviewTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const proposalFocusReturnId = useRef<string | null>(null);
  const proposalFocusReturnPending = useRef(false);
  const proposalQueueHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const modelSwitcherRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const conversationLoadSequence = useRef(0);
  const handledFileDropClientTurnIdRef = useRef<string | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(props.activeVault?.vaultId);
  const activeAgentDraftRef = useRef<ActiveAgentDraftBinding | null>(null);
  activeVaultIdRef.current = props.activeVault?.vaultId;
  const agentStatusLabel = props.agentRuntimeStatus?.state === "ready" ? props.t("home.agentReady") : props.t("home.captureOnly");
  const enabledHomeModels = props.modelSummary?.models.filter((model) => model.enabled) ?? [];
  const selectedHomeModel = enabledHomeModels.find(
    (model) => model.id === props.modelSummary?.defaultModelProfileId
  );
  const selectedHomeModelReady = Boolean(
    selectedHomeModel &&
    props.agentRuntimeStatus?.state === "ready" &&
    props.agentRuntimeStatus.canRunModelJobs &&
    props.agentRuntimeStatus.defaultModelProfileId === selectedHomeModel.id
  );
  const homeModelSendAvailable = props.captureOnly || selectedHomeModelReady;
  const selectedHomeModelName = selectedHomeModel?.displayName ?? selectedHomeModel?.modelId ?? agentStatusLabel;
  const homeModelProviders = new Map(
    (props.modelSummary?.providers ?? []).map((provider) => [provider.id, provider.displayName] as const)
  );

  const closeModelMenu = (restoreFocus = false): void => {
    setModelMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => modelSwitcherRef.current?.focus());
    }
  };

  const openModelMenu = (): void => {
    if (enabledHomeModels.length === 0 || modelSwitching) return;
    setModelSwitchFailed(false);
    setModelMenuOpen(true);
    const focusId = selectedHomeModel?.id ?? enabledHomeModels[0]?.id;
    window.requestAnimationFrame(() => {
      if (focusId) modelOptionRefs.current.get(focusId)?.focus();
    });
  };

  const moveModelOptionFocus = (delta: 1 | -1): void => {
    const options = enabledHomeModels
      .map((model) => modelOptionRefs.current.get(model.id))
      .filter((option): option is HTMLButtonElement => option !== undefined);
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = currentIndex < 0
      ? delta === 1 ? 0 : options.length - 1
      : (currentIndex + delta + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const switchHomeModel = async (modelProfileId: string): Promise<void> => {
    if (modelSwitching || modelProfileId === selectedHomeModel?.id) {
      if (modelProfileId === selectedHomeModel?.id) closeModelMenu(true);
      return;
    }
    setModelSwitching(true);
    setModelSwitchFailed(false);
    const changed = await props.onSetDefaultModel(modelProfileId);
    setModelSwitching(false);
    if (changed) closeModelMenu(true);
    else setModelSwitchFailed(true);
  };

  useEffect(() => {
    if (!modelMenuOpen) return;
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !modelMenuRef.current?.contains(event.target) && event.target !== modelSwitcherRef.current) {
        closeModelMenu(false);
      }
    };
    document.addEventListener("pointerdown", dismissOnPointerDown);
    return () => document.removeEventListener("pointerdown", dismissOnPointerDown);
  }, [modelMenuOpen]);

  const plannedModelUsage = homeRuntimeModelUsage(props.agentRuntimeStatus);
  const cloudUsageMessageKey = agentRunState === "accepted" || agentRunState === "running"
    ? plannedModelUsage === "cloud" ? "home.cloudSend" : null
    : agentModelUsage === "cloud" ? "home.cloudCallAttempted" : null;
  const latestTurn = conversationTimeline?.latestTurn;
  const latestPermissionJob = props.recentJobs.find((job) =>
    job.state === "waiting_permission" &&
    job.permissionRequestId !== undefined
  );
  const latestTurnPermissionRequestId = latestTurn?.state === "waiting_permission"
    ? latestTurn.error?.permissionRequestId
    : undefined;
  const pendingPermissionRequestId = latestTurnPermissionRequestId ?? latestPermissionJob?.permissionRequestId;
  const permissionRequestId = pendingPermissionRequestId === resolvedPermissionRequestId
    ? undefined
    : pendingPermissionRequestId;
  const permissionRequestJobId = permissionRequestId
    ? latestTurnPermissionRequestId === permissionRequestId
      ? latestTurn?.jobId
      : latestPermissionJob?.id
    : undefined;
  currentPermissionRequestIdRef.current = permissionRequestId;
  currentPermissionJobIdRef.current = permissionRequestJobId;
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
  const visibleRecentJobs = props.recentJobs
    .filter((job) =>
      isActiveProcessingFileJob(job) &&
      (!permissionRequestId || job.permissionRequestId !== permissionRequestId) &&
      (!modelEgressRequestId || job.modelEgressApprovalRequestId !== modelEgressRequestId) &&
      !(
        job.class === "agent_turn" &&
        job.sourceId === undefined &&
        job.state === "waiting_dependency" &&
        job.stage === "waiting_for_model"
      )
    )
    .slice(0, 5);
  const latestTurnJob = latestTurn
    ? props.recentJobs.find((job) => job.id === latestTurn.jobId)
    : undefined;
  const newestNoSourceActiveTurn = props.recentJobs.find((job) =>
    job.class === "agent_turn" &&
    !job.sourceDisplayName &&
    !job.sourceId &&
    (job.state === "running" || job.state === "cancel_requested")
  );
  const exactNoSourceCurrentTurn = latestTurnJob &&
    latestTurnJob.class === "agent_turn" &&
    !latestTurnJob.sourceDisplayName &&
    !latestTurnJob.sourceId &&
    (
      !activeAgentDraftRef.current ||
      activeAgentDraftRef.current.jobId === latestTurnJob.id
    )
    ? latestTurnJob
    : undefined;
  const noSourceCurrentTurn = exactNoSourceCurrentTurn ??
    (latestTurn ? undefined : newestNoSourceActiveTurn);
  const noSourceCancellableLatestTurn = noSourceCurrentTurn &&
    (noSourceCurrentTurn.state === "running" || noSourceCurrentTurn.state === "cancel_requested")
    ? noSourceCurrentTurn
    : undefined;
  const effectiveAgentRunState = noSourceCurrentTurn
    ? homeUiStateForJobState(noSourceCurrentTurn.state) ?? agentRunState
    : agentRunState;
  const effectiveAgentError = noSourceCurrentTurn
    ? noSourceCurrentTurn.error ?? agentError
    : agentError;
  const effectiveCloudUsageMessageKey = cloudUsageMessageKey ?? (
    effectiveAgentRunState === "running" && plannedModelUsage === "cloud" ? "home.cloudSend" : null
  );
  const retryableLatestTurn = latestTurn && (
    latestTurn.state === "cancelled" ||
    (
      (latestTurn.state === "failed_retryable" || latestTurn.state === "waiting_dependency") &&
      latestTurn.error?.retryable === true &&
      latestTurn.error.userAction === "retry"
    )
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
    effectiveAgentRunState === "idle" &&
    sourceWaitingForModelJobs.length === 0;
  const visibleConversationMessages = (conversationTimeline?.messages ?? []).filter((message) =>
    !(agentAnswer && message.role === "assistant" && message.id === liveAnswerEventId)
  );
  const showHomeHero = visibleConversationMessages.length === 0 &&
    agentDraft === null &&
    agentAnswer === null &&
    selectedNote === null &&
    permissionPrompt === null &&
    modelEgressPrompt === null;

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
    setPermissionPrompt(null);
    setResolvedPermissionRequestId(null);
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
    const sequence = permissionReadSequence.current + 1;
    permissionReadSequence.current = sequence;
    const vaultId = props.activeVault?.vaultId;
    const requestId = permissionRequestId;
    const jobId = permissionRequestJobId;
    if (!requestId) {
      setPermissionPrompt(null);
      return;
    }
    if (!vaultId || !jobId) {
      setPermissionPrompt({ kind: "unknown", requestId });
      return;
    }
    const isCurrentRead = (): boolean =>
      sequence === permissionReadSequence.current &&
      activeVaultIdRef.current === vaultId &&
      currentPermissionRequestIdRef.current === requestId &&
      currentPermissionJobIdRef.current === jobId;
    setPermissionPrompt({ kind: "loading", requestId });
    void window.pige.permissions.pending({ requestId }).then((request) => {
      if (!isCurrentRead()) return;
      if (!request || request.requestId !== requestId || request.jobId !== jobId) {
        setPermissionPrompt({ kind: "unknown", requestId });
        return;
      }
      setPermissionPrompt({ kind: "ready", request });
    }).catch(() => {
      if (isCurrentRead()) setPermissionPrompt({ kind: "unknown", requestId });
    });
  }, [permissionRequestId, props.activeVault?.vaultId]);

  useEffect(() => {
    if (permissionPrompt?.kind !== "ready" && permissionPrompt?.kind !== "unknown") return;
    const timer = window.setTimeout(() => {
      if (permissionPrompt.kind === "ready") permissionDenyButtonRef.current?.focus();
      else permissionHeadingRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [permissionPrompt]);

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
    latestTurn?.error?.permissionRequestId,
    latestTurn?.error?.modelEgressApprovalRequestId
  ]);

  useEffect(() => {
    if (!props.activeVault?.vaultId || !isConversationPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshConversation(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.activeVault?.vaultId, latestTurn?.jobId, latestTurn?.state]);

  const submitHomeInput = async (): Promise<void> => {
    if (!text.trim() || !homeModelSendAvailable || modelSwitching || composerSubmitInFlightRef.current) return;
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
      !homeModelSendAvailable ||
      modelSwitching ||
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

  const decidePermission = async (decision: "allow_once" | "deny"): Promise<void> => {
    if (
      permissionPrompt?.kind !== "ready" ||
      permissionPrompt.request.requestId !== permissionRequestId ||
      permissionPrompt.request.jobId !== permissionRequestJobId
    ) return;
    const request = permissionPrompt.request;
    const decisionVaultId = activeVaultIdRef.current;
    if (!decisionVaultId) return;
    const decisionKey = `${decisionVaultId}:${request.requestId}`;
    if (permissionDecisionInFlight.current === decisionKey) return;
    const isCurrentDecision = (): boolean =>
      activeVaultIdRef.current === decisionVaultId &&
      currentPermissionRequestIdRef.current === request.requestId &&
      currentPermissionJobIdRef.current === request.jobId;
    permissionDecisionInFlight.current = decisionKey;
    setPermissionPrompt({ kind: "resolving", request });
    try {
      await window.pige.permissions.resolve({
        requestId: request.requestId,
        jobId: request.jobId,
        decision
      });
      if (!isCurrentDecision()) return;
      await props.onHomeStateChanged().catch(() => undefined);
      const timeline = await refreshConversation();
      if (!isCurrentDecision()) return;
      const nextState = homeUiStateForJobState(timeline?.latestTurn?.state);
      setResolvedPermissionRequestId(request.requestId);
      setPermissionPrompt(null);
      setAgentRunState(nextState ?? (decision === "deny" ? "failed" : "accepted"));
      setAgentError(timeline?.latestTurn?.error ?? null);
      if (decision === "allow_once") composerInputRef.current?.focus();
    } catch {
      if (!isCurrentDecision()) return;
      try {
        const current = await window.pige.permissions.pending({ requestId: request.requestId });
        if (!isCurrentDecision()) return;
        if (current) {
          if (current.requestId === request.requestId && current.jobId === request.jobId) {
            setPermissionPrompt({
              kind: "ready",
              request: current,
              errorMessageKey: "home.permission.resolveFailed"
            });
          } else {
            setPermissionPrompt({ kind: "unknown", requestId: request.requestId });
          }
          return;
        }

        setResolvedPermissionRequestId(request.requestId);
        setPermissionPrompt(null);
        await props.onHomeStateChanged().catch(() => undefined);
        const timeline = await refreshConversation();
        if (activeVaultIdRef.current !== decisionVaultId) return;
        const nextState = homeUiStateForJobState(timeline?.latestTurn?.state);
        setAgentRunState(nextState ?? (decision === "deny" ? "failed" : "accepted"));
        setAgentError(timeline?.latestTurn?.error ?? null);
        if (decision === "allow_once") composerInputRef.current?.focus();
      } catch {
        if (isCurrentDecision()) {
          setPermissionPrompt({ kind: "unknown", requestId: request.requestId });
        }
      }
    } finally {
      if (permissionDecisionInFlight.current === decisionKey) {
        permissionDecisionInFlight.current = null;
      }
    }
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
    <section className={`home${showHomeHero ? " home-empty" : " home-active"}`} aria-label={props.t("nav.home")}>
      {showHomeHero ? (
        <div className="hero">
          <div className="hero-content">
            <img className="brand-mark" src={pigeMarkUrl} alt="" />
            <h1>{props.t("home.heroTitle")}</h1>
            <p className="hero-subtitle">{props.t("home.heroSubtitle")}</p>
            <div className="source-picker">
              <ul className="source-format-legend source-types" aria-label={props.t("home.supportedFormats")}>
                <li className="source-type"><span className="source-icon"><PigeIcon name="file" /></span><span>PDF</span></li>
                <li className="source-type"><span className="source-icon"><PigeIcon name="fileText" /></span><span>{props.t("home.formatText")}</span></li>
                <li className="source-type"><span className="source-icon"><PigeIcon name="presentation" /></span><span>PPT</span></li>
                <li className="source-type"><span className="source-icon"><PigeIcon name="spreadsheet" /></span><span>Excel</span></li>
                <li className="source-type"><span className="source-icon"><PigeIcon name="image" /></span><span>{props.t("home.formatImage")}</span></li>
                <li className="source-type"><span className="source-icon"><PigeIcon name="more" /></span><span>{props.t("home.formatMore")}</span></li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {showFirstHomeGuide ? (
        <section className="first-home-guide" aria-label={props.t("home.firstGuideAria")}>
          <p>{props.t("home.firstGuideText")}</p>
          <div className="first-home-guide-actions">
            <button type="button" onClick={(event) => void props.onOpenModels(event.currentTarget)}>{props.t("home.connectModel")}</button>
            <button type="button" className="ghost" onClick={() => void props.onDismissFirstHome()}>
              {props.t("home.continueCaptureOnly")}
            </button>
          </div>
        </section>
      ) : null}
      {visibleRecentJobs.length > 0 ? (
        <section
          className={processingListExpanded ? "task-panel" : "task-panel collapsed"}
          aria-labelledby="home-processing-title"
        >
          <header className="task-header">
            <div className="task-summary">
              <PigeIcon className="task-processing-icon" name="loading" size={16} />
              <h2 id="home-processing-title">{props.t("home.processingFiles")}</h2>
              <span className="task-current-file">
                {visibleRecentJobs[0]?.sourceDisplayName ?? props.t("home.processingItem")}
              </span>
              {!processingListExpanded && visibleRecentJobs[0] ? (
                <span className="task-current-state">{props.t(jobStateMessageKey(visibleRecentJobs[0]))}</span>
              ) : null}
            </div>
            <span className="task-count">{visibleRecentJobs.length} {props.t("home.files")}</span>
            {!processingListExpanded && visibleRecentJobs[0] ? (() => {
              const currentJob = visibleRecentJobs[0];
              const sourceWaitingForModel = isSourceWaitingForModel(currentJob);
              const ownsSourceModelAction = sourceWaitingForModel && currentJob.id === sourceModelActionOwner?.id;
              if (ownsSourceModelAction) {
                return <button className="job-action" type="button" onClick={(event) => void props.onOpenModels(event.currentTarget)}>{props.t("home.connectModel")}</button>;
              }
              if (sourceWaitingForModel) return null;
              if (currentJob.state === "queued" || (currentJob.class === "agent_turn" && (currentJob.state === "running" || currentJob.state === "cancel_requested"))) {
                return (
                  <button
                    className="task-icon-action"
                    type="button"
                    title={props.t("home.cancelJob")}
                    aria-label={props.t("home.cancelJob")}
                    disabled={currentJob.state === "cancel_requested"}
                    onClick={() => void props.onCancelJob(currentJob.id)}
                  >
                    <PigeIcon name="trash" size={13} />
                  </button>
                );
              }
              if (currentJob.state === "failed_retryable" && currentJob.class !== "retrieval_query") {
                return <button className="job-action" type="button" onClick={() => void props.onRetryJob(currentJob.id)}>{props.t("home.retryJob")}</button>;
              }
              return null;
            })() : null}
            <button
              className="task-toggle"
              type="button"
              aria-expanded={processingListExpanded}
              aria-controls="home-processing-list"
              aria-label={props.t(processingListExpanded ? "home.collapseProcessing" : "home.expandProcessing")}
              onClick={() => setProcessingListExpanded((current) => !current)}
            >
              <PigeIcon className="chevron" name="expand" size={15} />
            </button>
          </header>
          {processingListExpanded ? (
            <div className="task-list" id="home-processing-list">
            {visibleRecentJobs.map((job) => {
            const sourceWaitingForModel = isSourceWaitingForModel(job);
            const ownsSourceModelAction = sourceWaitingForModel && job.id === sourceModelActionOwner?.id;
            const statusMessageKey = jobStateMessageKey(job);
            const sourceName = job.sourceDisplayName ?? props.t("home.processingItem");
            const totalUnits = job.progress?.totalUnits;
            const progressValue = totalUnits
              ? Math.min(100, Math.max(0, Math.round((job.progress?.completedUnits ?? 0) / totalUnits * 100)))
              : null;
            return (
              <div
                className={`task-row${sourceWaitingForModel ? " source-waiting-model" : ""}`}
                key={job.id}
                data-job-state={job.state}
                role={sourceWaitingForModel ? "status" : undefined}
                aria-live={sourceWaitingForModel ? "polite" : undefined}
              >
                <span className="task-name">
                  <span className="file-badge"><PigeIcon name={job.sourceKind === "image_file" ? "image" : "fileText"} size={14} /></span>
                  <span className="task-file-copy">
                    <strong>{sourceName}</strong>
                    <small>{props.t(statusMessageKey)}</small>
                  </span>
                </span>
                {progressValue !== null ? (
                  <span
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${sourceName} ${props.t(statusMessageKey)}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressValue}
                    aria-valuetext={`${props.t(statusMessageKey)} ${progressValue}%`}
                  >
                    <span className="progress-fill" style={{ "--progress": `${progressValue}%` } as CSSProperties} />
                  </span>
                ) : <span className="progress-track indeterminate" aria-hidden="true"><span className="progress-fill" /></span>}
                <span className="task-row-actions">
                  {progressValue === null ? null : <span className="task-status">{progressValue}%</span>}
                {ownsSourceModelAction ? (
                  <button className="job-action" type="button" onClick={(event) => void props.onOpenModels(event.currentTarget)}>
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
                    <PigeIcon name="trash" size={13} />
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
                </span>
              </div>
            );
            })}
            </div>
          ) : null}
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
                  <span
                    className={`activity-row-dot${activity.status === "undone" ? " is-undone" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="activity-row-copy">
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
            onDevelopment={props.onDevelopment}
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
          <div className="model-switcher-wrap home-model-switcher-wrap">
            <button
              ref={modelSwitcherRef}
              className="composer-model-switcher model-switcher"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              aria-controls="home-model-menu"
              aria-label={`${props.t("home.modelSwitcher")}: ${selectedHomeModelName}, ${props.t(selectedHomeModelReady ? "home.modelConnected" : "home.modelUnavailable")}`}
              disabled={enabledHomeModels.length === 0 || modelSwitching}
              onClick={() => {
                if (modelMenuOpen) closeModelMenu(true);
                else openModelMenu();
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                openModelMenu();
              }}
            >
              <span className={selectedHomeModelReady ? "model-status-dot connected" : "model-status-dot unavailable"} aria-hidden="true" />
              <span className="model-switcher-name">{selectedHomeModelName}</span>
              <PigeIcon name="collapse" size={14} />
            </button>
            {modelMenuOpen ? (
              <div
                ref={modelMenuRef}
                className="model-menu home-model-menu"
                id="home-model-menu"
                role="listbox"
                aria-label={props.t("home.modelMenu")}
                aria-busy={modelSwitching}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeModelMenu(true);
                  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveModelOptionFocus(event.key === "ArrowDown" ? 1 : -1);
                  }
                }}
              >
                {enabledHomeModels.map((model) => {
                  const selected = model.id === selectedHomeModel?.id;
                  const ready = selected && selectedHomeModelReady;
                  const providerName = homeModelProviders.get(model.providerProfileId);
                  return (
                    <button
                      key={model.id}
                      ref={(element) => {
                        if (element) modelOptionRefs.current.set(model.id, element);
                        else modelOptionRefs.current.delete(model.id);
                      }}
                      className="model-option"
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={modelSwitching}
                      onClick={() => void switchHomeModel(model.id)}
                    >
                      <span
                        className={ready
                          ? "model-status-dot connected"
                          : selected
                            ? "model-status-dot unavailable"
                            : "model-status-dot enabled"}
                        aria-hidden="true"
                      />
                      <span className="model-option-copy">
                        <strong>{model.displayName ?? model.modelId}</strong>
                        <small>{selected
                          ? props.t(ready ? "home.modelConnected" : "home.modelUnavailable")
                          : providerName ?? props.t("models.enabled")}</small>
                      </span>
                      <span className="model-option-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                    </button>
                  );
                })}
                {modelSwitching ? (
                  <div className="model-menu-status" role="status" aria-live="polite">
                    {props.t("home.modelSwitching")}
                  </div>
                ) : modelSwitchFailed ? (
                  <div className="model-menu-status error" role="status" aria-live="polite">
                    {props.t("home.modelSwitchFailed")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
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
          <span id="home-voice-unavailable-description" className="visually-hidden">
            {props.t("home.voice.unsupportedDescription")}
          </span>
          <button
            className="round-button"
            type="button"
            title={props.t("home.voice.unsupportedTitle")}
            aria-label={props.t("home.voice.unsupportedTitle")}
            aria-describedby="home-voice-unavailable-description"
            disabled
          >
            <PigeIcon name="voice" size={17} />
          </button>
          <button
            className="round-button"
            type="button"
            title={props.t("home.attachFile")}
            aria-label={props.t("home.attachFile")}
            onClick={() => fileInputRef.current?.click()}
          >
            <PigeIcon name="attach" size={17} />
          </button>
          <button
            type="button"
            className="composer-send"
            aria-label={props.t("home.send")}
            title={!homeModelSendAvailable && !props.captureOnly ? props.t("home.modelUnavailable") : undefined}
            disabled={!text.trim() || !homeModelSendAvailable || modelSwitching || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running"}
            onClick={() => void submitHomeInput()}
          >
            <PigeIcon
              name={effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running" ? "loading" : "send"}
              className={effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running" ? "spinning" : undefined}
              size={16}
            />
            <span>{effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running" ? props.t("home.agentRunning") : props.t("home.send")}</span>
          </button>
        </div>
        <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
        {permissionRequestId ? (
          <section
            className="permission-prompt"
            role="group"
            aria-labelledby="home-permission-title"
            aria-describedby="home-permission-status"
            aria-busy={permissionPrompt?.kind === "loading" || permissionPrompt?.kind === "resolving"}
          >
            <h2 id="home-permission-title" ref={permissionHeadingRef} tabIndex={-1}>
              {props.t("home.permission.title")}
            </h2>
            <div
              id="home-permission-status"
              className="permission-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {permissionPrompt?.kind === "ready" || permissionPrompt?.kind === "resolving" ? (
                <div className="permission-summary">
                  <strong>{permissionPrompt.request.actorDisplayName}</strong>
                  <span>{permissionActionMessage(permissionPrompt.request.actionLabelKey, props.t)}</span>
                  <span className="permission-category">
                    {props.t(permissionResourceMessageKey(permissionPrompt.request.resourceKind))}
                  </span>
                  {permissionPrompt.kind === "ready" && permissionPrompt.errorMessageKey ? (
                    <span className="error">{props.t(permissionPrompt.errorMessageKey)}</span>
                  ) : null}
                </div>
              ) : permissionPrompt?.kind === "unknown" ? (
                props.t("home.permission.unknown")
              ) : (
                props.t("home.permission.loading")
              )}
            </div>
            {permissionPrompt?.kind === "ready" || permissionPrompt?.kind === "resolving" ? (
              <div className="permission-actions">
                <button
                  ref={permissionDenyButtonRef}
                  type="button"
                  className="ghost"
                  disabled={permissionPrompt.kind === "resolving"}
                  onClick={() => void decidePermission("deny")}
                >
                  {props.t("home.permission.deny")}
                </button>
                <button
                  type="button"
                  disabled={permissionPrompt.kind === "resolving"}
                  onClick={() => void decidePermission("allow_once")}
                >
                  {props.t("home.permission.allowOnce")}
                </button>
              </div>
            ) : null}
          </section>
        ) : modelEgressRequestId ? (
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
        ) : effectiveAgentRunState !== "idle" && !sourceWaitOwnsAgentState ? (
          <div className={`agent-run-state state-${effectiveAgentRunState}`} role="status" aria-live="polite">
            <span className="agent-run-dot" aria-hidden="true" />
            <span>
              {effectiveAgentError
                ? props.t(effectiveAgentError.messageKey)
                : noSourceCurrentTurn
                  ? props.t(jobStateMessageKey(noSourceCurrentTurn))
                  : props.t(`home.agentState.${effectiveAgentRunState}`)}
            </span>
            {effectiveCloudUsageMessageKey ? (
              <span className="agent-cloud-boundary">{props.t(effectiveCloudUsageMessageKey)}</span>
            ) : null}
            {agentError?.userAction === "configure_model" ? (
              <button type="button" className="ghost" onClick={(event) => void props.onOpenModels(event.currentTarget)}>{props.t("home.openModels")}</button>
            ) : null}
            {retryableLatestTurn ? (
              <button type="button" className="ghost" onClick={() => void retryLatestConversationTurn()}>
                {props.t("home.retryAnswer")}
              </button>
            ) : null}
            {noSourceCancellableLatestTurn ? (
              <button
                type="button"
                className="ghost"
                title={props.t("home.cancelJob")}
                aria-label={props.t("home.cancelJob")}
                disabled={noSourceCancellableLatestTurn.state === "cancel_requested"}
                onClick={() => void props.onCancelJob(noSourceCancellableLatestTurn.id)}
              >
                {props.t("home.cancelJob")}
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

function isActiveProcessingFileJob(job: JobSummary): boolean {
  if (!job.sourceDisplayName && !job.sourceId) return false;
  return job.state === "queued" ||
    job.state === "running" ||
    job.state === "waiting_dependency" ||
    job.state === "waiting_permission" ||
    job.state === "waiting_model_egress" ||
    job.state === "awaiting_review" ||
    job.state === "cancel_requested" ||
    job.state === "failed_retryable";
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

function permissionActionMessage(
  actionLabelKey: PermissionPendingRequest["actionLabelKey"],
  t: (key: string) => string
): string {
  const translated = t(actionLabelKey);
  return translated === actionLabelKey ? t("permissions.action.generic") : translated;
}

function permissionResourceMessageKey(resourceKind: PermissionPendingRequest["resourceKind"]): string {
  return `permissions.resource.${resourceKind}`;
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

function backupJobMessageKey(job: JobSummary): string {
  if (job.state === "queued" || job.state === "running") return "backup.running";
  if (job.state === "cancel_requested") return "backup.cancelRequested";
  if (job.state === "failed_retryable" && job.error?.userAction === "retry") {
    return "backup.failedRetryable";
  }
  return "backup.failedFinal";
}

const settingsSections: readonly {
  readonly id: SettingsSection;
  readonly icon: PigeIconName;
  readonly status: "real" | "partial" | "development";
  readonly capability?: DevelopmentCapability;
}[] = [
  { id: "general", icon: "settings", status: "real" },
  { id: "appearance", icon: "palette", status: "development", capability: "appearance" },
  { id: "vault", icon: "folder", status: "real" },
  { id: "maintenance", icon: "database", status: "real" },
  { id: "models", icon: "model", status: "real" },
  { id: "capabilities", icon: "wrench", status: "development", capability: "local_capabilities" },
  { id: "memory", icon: "memory", status: "development", capability: "agent_memory" },
  { id: "privacy", icon: "shield", status: "development", capability: "permissions_privacy" },
  { id: "skills", icon: "skill", status: "development", capability: "skills" },
  { id: "packages", icon: "package", status: "development", capability: "packages" },
  { id: "system", icon: "activity", status: "partial" }
];

const settingsGroups: readonly {
  readonly id: "basic" | "knowledge" | "ai" | "security" | "extensions" | "system";
  readonly sections: readonly SettingsSection[];
}[] = [
  { id: "basic", sections: ["general", "appearance"] },
  { id: "knowledge", sections: ["vault", "maintenance"] },
  { id: "ai", sections: ["models", "capabilities", "memory"] },
  { id: "security", sections: ["privacy"] },
  { id: "extensions", sections: ["skills", "packages"] },
  { id: "system", sections: ["system"] }
];

export function DevelopmentStatus(props: {
  readonly notice: DevelopmentNotice | null;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (!props.notice) return null;
  return (
    <p className="development-status" role="status" aria-live="polite" aria-atomic="true">
      <strong>{props.t(`development.capability.${props.notice.capability}`)}</strong>
      <span>{props.t(`development.state.${props.notice.state}`)}</span>
    </p>
  );
}

export function SettingsSurface(props: {
  readonly section: SettingsSection;
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly alwaysOnTop: boolean;
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly onClose: () => void;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onAlwaysOnTopChange: () => Promise<void>;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const sectionMatches = (section: SettingsSection): boolean =>
    normalizedQuery.length === 0 || props.t(`settings.section.${section}`).toLocaleLowerCase().includes(normalizedQuery);
  const matchingSectionCount = settingsSections.filter((item) => sectionMatches(item.id)).length;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="settings-overlay" data-settings-overlay="true">
      <div
        ref={dialogRef}
        className="settings-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-surface-title"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="settings-surface-body">
          <aside className="settings-sidebar" aria-label={props.t("settings.navigation") }>
            <div className="settings-sidebar-top">
              <button
                ref={closeButtonRef}
                type="button"
                className="settings-return"
                title={props.t("settings.close")}
                aria-label={props.t("settings.close")}
                onClick={props.onClose}
              >
                <PigeIcon name="arrowLeft" size={16} />
                <span>{props.t("settings.back")}</span>
              </button>
              <label className="settings-search-wrap">
                <PigeIcon name="search" size={14} />
                <input
                  className="settings-search"
                  type="search"
                  value={searchQuery}
                  placeholder={props.t("settings.search")}
                  aria-label={props.t("settings.search")}
                  onInput={(event) => setSearchQuery(event.currentTarget.value)}
                />
              </label>
            </div>
            <div className="settings-nav-scroll">
              <nav className="settings-navigation" aria-label={props.t("settings.navigation") }>
                {settingsGroups.map((group) => {
                  const items = settingsSections.filter((item) => group.sections.includes(item.id) && sectionMatches(item.id));
                  if (items.length === 0) return null;
                  return (
                    <div
                      className="settings-nav-group"
                      key={group.id}
                      role="group"
                      aria-labelledby={`settings-group-${group.id}`}
                    >
                      <div className="settings-nav-label" id={`settings-group-${group.id}`}>
                        {props.t(`settings.group.${group.id}`)}
                      </div>
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={props.section === item.id ? "settings-nav-item active" : "settings-nav-item"}
                          aria-current={props.section === item.id ? "page" : undefined}
                          onClick={() => {
                            props.onSectionChange(item.id);
                            if (item.capability) props.onDevelopment(item.capability);
                          }}
                        >
                          <PigeIcon name={item.icon} size={16} />
                          <span>{props.t(`settings.section.${item.id}`)}</span>
                          <small>{props.t(`settings.status.${item.status}`)}</small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </nav>
              {matchingSectionCount === 0 ? (
                <p className="settings-search-empty visible" role="status" aria-live="polite">{props.t("settings.noMatches")}</p>
              ) : null}
            </div>
          </aside>
          <div className="settings-content">
            <h1 id="settings-surface-title" className="visually-hidden">{props.t("settings.title")}</h1>
            <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSettingsPanel(props: {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly alwaysOnTop: boolean;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onAlwaysOnTopChange: () => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page settings-general" aria-labelledby="settings-general-title">
      <div>
        <h1 id="settings-general-title">{props.t("settings.general.title")}</h1>
        <p className="muted">{props.t("settings.general.subtitle")}</p>
      </div>
      <section className="settings-group">
        <label htmlFor="settings-language">{props.t("language.label")}</label>
        <select
          id="settings-language"
          value={props.locale}
          onChange={(event) => void props.onLocaleChange(event.target.value as Locale)}
        >
          {props.availableLocales.map((availableLocale) => (
            <option key={availableLocale} value={availableLocale}>{localeLabels[availableLocale]}</option>
          ))}
        </select>
      </section>
      <section className="settings-group settings-toggle-row">
        <div>
          <h2>{props.t("settings.general.alwaysOnTop")}</h2>
          <p className="muted">{props.t("settings.general.alwaysOnTopDescription")}</p>
        </div>
        <button
          type="button"
          className={props.alwaysOnTop ? "toggle-button active" : "toggle-button"}
          role="switch"
          aria-checked={props.alwaysOnTop}
          onClick={() => void props.onAlwaysOnTopChange()}
        >
          {props.t(props.alwaysOnTop ? "settings.enabled" : "settings.disabled")}
        </button>
      </section>
    </section>
  );
}

function DevelopmentSettingsSection(props: {
  readonly section: Exclude<SettingsSection, "general" | "vault" | "maintenance" | "models">;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page settings-development" aria-labelledby={`settings-${props.section}-title`}>
      <PigeIcon name={settingsSections.find((item) => item.id === props.section)?.icon ?? "settings"} size={28} />
      <div>
        <h1 id={`settings-${props.section}-title`}>{props.t(`settings.section.${props.section}`)}</h1>
        <p className="muted">{props.t("development.settingsDescription")}</p>
      </div>
    </section>
  );
}

export function SkillsSettingsPanel(props: {
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page settings-skills" aria-labelledby="settings-skills-title">
      <header className="settings-panel-header">
        <h1 id="settings-skills-title">{props.t("skills.title")}</h1>
        <p>{props.t("skills.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="skills-installed-title">
        <h2 className="settings-section-title" id="skills-installed-title">{props.t("skills.installedTitle")}</h2>
        <div className="settings-card skills-empty-card">
          <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="skill" size={19} /></span>
          <div className="settings-row-copy">
            <strong>{props.t("skills.emptyTitle")}</strong>
            <span>{props.t("skills.emptyDescription")}</span>
          </div>
        </div>
        <div className="settings-inline-actions">
          <button className="settings-button primary settings-action" type="button" onClick={props.onDevelopment}>
            <PigeIcon name="link" size={15} aria-hidden="true" />
            {props.t("skills.installFromLink")}
          </button>
          <button className="settings-button settings-action" type="button" onClick={props.onDevelopment}>
            <PigeIcon name="fileText" size={15} aria-hidden="true" />
            {props.t("skills.chooseFile")}
          </button>
        </div>
      </section>

      <section className="settings-section" role="group" aria-labelledby="skills-review-title">
        <h2 className="settings-section-title" id="skills-review-title">{props.t("skills.reviewTitle")}</h2>
        <div className="settings-card">
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="fileText" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.reviewMetadata")}</strong>
              <span>{props.t("skills.reviewMetadataDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="shield" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.reviewPermissions")}</strong>
              <span>{props.t("skills.reviewPermissionsDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="folder" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.scopeTitle")}</strong>
              <span>{props.t("skills.scopeDescription")}</span>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

type SupportBundleCategoryProjection = {
  readonly titleKey: string;
  readonly descriptionKey: string;
};

function projectSupportBundleCategory(categoryId: string): SupportBundleCategoryProjection | null {
  const projections: Readonly<Record<string, SupportBundleCategoryProjection>> = {
    app_runtime: {
      titleKey: "support.category.appRuntime",
      descriptionKey: "support.category.appRuntimeDescription"
    },
    diagnostics_health: {
      titleKey: "support.category.diagnosticsHealth",
      descriptionKey: "support.category.diagnosticsHealthDescription"
    },
    recent_errors: {
      titleKey: "support.category.recentErrors",
      descriptionKey: "support.category.recentErrorsDescription"
    },
    secrets: {
      titleKey: "support.category.secrets",
      descriptionKey: "support.category.secretsDescription"
    },
    content: {
      titleKey: "support.category.privateContent",
      descriptionKey: "support.category.privateContentDescription"
    },
    binaries: {
      titleKey: "support.category.binaries",
      descriptionKey: "support.category.binariesDescription"
    }
  };
  return projections[categoryId] ?? null;
}

function projectSupportBundlePrivacyWarning(warning: string): string | null {
  const projections: Readonly<Record<string, string>> = {
    "The bundle is created locally and is not uploaded automatically.": "support.warning.localOnly",
    "Paths, emails, and common secret patterns are redacted by default.": "support.warning.redacted",
    "Review the preview before exporting.": "support.warning.review"
  };
  return projections[warning] ?? null;
}

function supportBundlePreviewIsFullyProjected(preview: SupportBundlePreview): boolean {
  return preview.includedCategories.every((category) => projectSupportBundleCategory(category.id) !== null) &&
    preview.excludedCategories.every((category) => projectSupportBundleCategory(category.id) !== null) &&
    preview.privacyWarnings.every((warning) => projectSupportBundlePrivacyWarning(warning) !== null);
}

export function SystemSettingsPanel(props: {
  readonly diagnosticsHealth: DiagnosticsHealth | null;
  readonly supportBundlePreview: SupportBundlePreview | null;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onSupportBundlePreviewChange: (preview: SupportBundlePreview | null) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<"refresh" | "preview" | "export" | "cancel" | null>(null);
  const [notice, setNotice] = useState<{ readonly kind: "success" | "error"; readonly key: string } | null>(null);
  const supportBundleExportRequestRef = useRef<string | null>(null);
  const supportBundleCancelRequestRef = useRef<string | null>(null);

  useEffect(() => () => {
    const exportRequestId = supportBundleExportRequestRef.current;
    if (!exportRequestId) return;
    supportBundleCancelRequestRef.current = exportRequestId;
    void window.pige.diagnostics.cancelSupportBundleExport({ exportRequestId }).catch(() => undefined);
  }, []);

  const refreshDiagnostics = async (): Promise<void> => {
    if (diagnosticsBusy) return;
    setDiagnosticsBusy("refresh");
    setNotice(null);
    try {
      await props.onRefreshDiagnostics();
      setNotice({ kind: "success", key: "system.healthRefreshed" });
    } catch {
      setNotice({ kind: "error", key: "system.healthFailed" });
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const previewSupportBundle = async (): Promise<void> => {
    if (diagnosticsBusy) return;
    setDiagnosticsBusy("preview");
    setNotice(null);
    try {
      props.onSupportBundlePreviewChange(await window.pige.diagnostics.previewSupportBundle());
    } catch {
      setNotice({ kind: "error", key: "system.previewFailed" });
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const exportSupportBundle = async (): Promise<void> => {
    if (
      !props.supportBundlePreview ||
      !supportBundlePreviewIsFullyProjected(props.supportBundlePreview) ||
      diagnosticsBusy ||
      supportBundleExportRequestRef.current
    ) return;
    const exportRequestId = crypto.randomUUID();
    supportBundleExportRequestRef.current = exportRequestId;
    setDiagnosticsBusy("export");
    setNotice(null);
    try {
      const result = await window.pige.diagnostics.exportSupportBundle({
        previewId: props.supportBundlePreview.previewId,
        exportRequestId
      });
      if (result.status === "exported") {
        props.onSupportBundlePreviewChange(null);
        await props.onRefreshDiagnostics();
        setNotice({ kind: "success", key: "system.exported" });
      }
    } catch {
      if (supportBundleCancelRequestRef.current !== exportRequestId) {
        setNotice({ kind: "error", key: "support.exportFailed" });
      }
    } finally {
      if (supportBundleExportRequestRef.current === exportRequestId) {
        supportBundleExportRequestRef.current = null;
        setDiagnosticsBusy(null);
      }
      if (supportBundleCancelRequestRef.current === exportRequestId) {
        supportBundleCancelRequestRef.current = null;
      }
    }
  };

  const cancelSupportBundleExport = async (): Promise<void> => {
    const exportRequestId = supportBundleExportRequestRef.current;
    if (!exportRequestId || supportBundleCancelRequestRef.current === exportRequestId) return;
    supportBundleCancelRequestRef.current = exportRequestId;
    setDiagnosticsBusy("cancel");
    try {
      await window.pige.diagnostics.cancelSupportBundleExport({ exportRequestId });
      setNotice({ kind: "success", key: "system.exportCanceled" });
    } catch {
      supportBundleCancelRequestRef.current = null;
      setDiagnosticsBusy("export");
      setNotice({ kind: "error", key: "support.exportFailed" });
    }
  };

  const healthStatusKey = props.diagnosticsHealth?.status === "ok"
    ? "system.healthOk"
    : props.diagnosticsHealth?.status === "degraded"
      ? "system.healthDegraded"
      : "system.healthLoading";
  const showUpdateUnavailable = (): void => {
    setNotice({ kind: "success", key: "system.updateUnavailable" });
  };
  const supportPreviewProjection = props.supportBundlePreview
    ? {
        included: props.supportBundlePreview.includedCategories.map((category) => projectSupportBundleCategory(category.id)),
        excluded: props.supportBundlePreview.excludedCategories.map((category) => projectSupportBundleCategory(category.id)),
        warnings: props.supportBundlePreview.privacyWarnings.map(projectSupportBundlePrivacyWarning),
        complete: supportBundlePreviewIsFullyProjected(props.supportBundlePreview)
      }
    : null;

  return (
    <section className="settings-page settings-system-page" aria-labelledby="settings-system-title">
      <header className="settings-panel-header">
        <h1 id="settings-system-title">{props.t("system.title")}</h1>
        <p>{props.t("system.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="system-update-title">
        <h2 className="settings-section-title" id="system-update-title">{props.t("system.updateSection")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.updateChannel")}</strong>
              <span>{props.t("system.updateChannelDescription")}</span>
            </div>
            <span className="settings-status unavailable">{props.t("development.state.unavailable")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.autoDownload")}</strong>
              <span>{props.t("system.autoDownloadDescription")}</span>
            </div>
            <button className="settings-button" type="button" disabled title={props.t("development.state.unavailable")}>
              {props.t("development.state.unavailable")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.updateStatus")}</strong>
              <span>{props.t("system.updateStatusDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={showUpdateUnavailable}>
              {props.t("system.checkUpdates")}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="system-health-title">
        <h2 className="settings-section-title" id="system-health-title">{props.t("system.localHealth")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.health")}</strong>
              <span>{props.t("system.healthDescription")}</span>
            </div>
            <div className="settings-row-control">
              <span className={`settings-status ${props.diagnosticsHealth?.status === "degraded" ? "degraded" : ""}`}>
                {props.t(healthStatusKey)}
              </span>
              <button
                className="settings-button"
                type="button"
                disabled={Boolean(diagnosticsBusy)}
                onClick={() => void refreshDiagnostics()}
              >
                {props.t("system.refreshHealth")}
              </button>
            </div>
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("system.supportBundle")}</strong>
              <span>{props.t("system.supportBundleDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              disabled={Boolean(diagnosticsBusy)}
              onClick={() => void previewSupportBundle()}
            >
              {props.t("system.previewSupport")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.clearDiagnostics")}</strong>
              <span>{props.t("system.clearDiagnosticsDescription")}</span>
            </div>
            <button className="settings-button" type="button" disabled title={props.t("development.state.unavailable")}>
              {props.t("system.clear")}
            </button>
          </div>
        </div>

        {props.supportBundlePreview && supportPreviewProjection ? (
          <div className="support-preview system-support-preview" aria-label={props.t("support.previewReady")}>
            <strong>{props.t("support.previewReady")}</strong>
            <span>{props.t("support.estimatedSize")}: {Math.ceil(props.supportBundlePreview.estimatedBytes / 1024)} KB</span>
            <section className="support-preview-section" aria-labelledby="support-preview-included">
              <h3 id="support-preview-included">{props.t("support.included")}</h3>
              <ul className="support-preview-list">
                {supportPreviewProjection.included.map((projection, index) => projection ? (
                  <li key={props.supportBundlePreview?.includedCategories[index]?.id ?? `included-${index}`}>
                    <strong>{props.t(projection.titleKey)}</strong>
                    <span>{props.t(projection.descriptionKey)}</span>
                  </li>
                ) : null)}
              </ul>
            </section>
            <section className="support-preview-section" aria-labelledby="support-preview-excluded">
              <h3 id="support-preview-excluded">{props.t("support.excluded")}</h3>
              <ul className="support-preview-list">
                {supportPreviewProjection.excluded.map((projection, index) => projection ? (
                  <li key={props.supportBundlePreview?.excludedCategories[index]?.id ?? `excluded-${index}`}>
                    <strong>{props.t(projection.titleKey)}</strong>
                    <span>{props.t(projection.descriptionKey)}</span>
                  </li>
                ) : null)}
              </ul>
            </section>
            <section className="support-preview-section" aria-labelledby="support-preview-warnings">
              <h3 id="support-preview-warnings">{props.t("system.privacyWarnings")}</h3>
              <ul className="support-preview-list warnings">
                {supportPreviewProjection.warnings.map((warningKey, index) => warningKey ? (
                  <li key={warningKey}>{props.t(warningKey)}</li>
                ) : null)}
              </ul>
            </section>
            {!supportPreviewProjection.complete ? (
              <p className="error" role="alert">{props.t("support.previewUnsafe")}</p>
            ) : null}
            <div className="settings-inline-actions">
              {diagnosticsBusy === "export" || diagnosticsBusy === "cancel" ? (
                <button className="settings-button" type="button" disabled={diagnosticsBusy === "cancel"} onClick={() => void cancelSupportBundleExport()}>
                  {props.t("maintenance.cancelSupportExport")}
                </button>
              ) : (
                <button
                  className="settings-button primary"
                  type="button"
                  disabled={!supportPreviewProjection.complete}
                  onClick={() => void exportSupportBundle()}
                >
                  {props.t("maintenance.exportSupport")}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {notice ? (
          <p className={notice.kind === "error" ? "error" : "muted"} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
            {props.t(notice.key)}
          </p>
        ) : null}
        <p className="settings-note">{props.t("system.localOnlyNote")}</p>
      </section>
    </section>
  );
}

interface VaultSettingsPanelProps {
  readonly surface: "vault" | "maintenance";
  readonly busy: boolean;
  readonly error: string | null;
  readonly vault: VaultSummary;
  readonly localDatabaseStatus: LocalDatabaseStatus | null;
  readonly backupStatus: BackupRestoreStatus | null;
  readonly backupJobs: readonly JobSummary[];
  readonly toolchainHealth: ToolchainHealth | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onOpen: () => Promise<void>;
  readonly onCreate: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function VaultSettingsPanel(props: VaultSettingsPanelProps): React.JSX.Element {
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [revealTarget, setRevealTarget] = useState<VaultRevealTarget | null>(null);
  const [revealNotice, setRevealNotice] = useState<{ readonly kind: "success" | "error"; readonly message: string } | null>(null);
  const revealRequestSequence = useRef(0);
  const revealRequestActiveRef = useRef(false);
  const knowledgeRootButtonRef = useRef<HTMLButtonElement>(null);
  const sourceAssetRootButtonRef = useRef<HTMLButtonElement>(null);
  const activeBackupJob = props.backupJobs[0];
  const restore = useRestoreFlow(async () => {
    setBackupNotice(props.t("backup.restored"));
    await props.onRefresh();
    await props.onRefreshDiagnostics();
  }, () => props.onError(null));

  useEffect(() => () => {
    revealRequestSequence.current += 1;
    revealRequestActiveRef.current = false;
  }, []);

  const runBackupAction = async (action: () => Promise<void>): Promise<void> => {
    props.onError(null);
    setBackupNotice(null);
    setBackupBusy(true);
    try {
      await action();
    } catch {
      setBackupNotice(props.t("backup.actionFailed"));
      await props.onRefresh().catch(() => undefined);
    } finally {
      setBackupBusy(false);
    }
  };

  useEffect(() => {
    if (!backupBusy) return;
    const timer = window.setInterval(() => void props.onRefresh(), 1_200);
    return () => window.clearInterval(timer);
  }, [backupBusy, props.onRefresh]);

  useEffect(() => {
    if (activeBackupJob) setBackupNotice(null);
  }, [activeBackupJob?.id, activeBackupJob?.state]);

  const createBackup = async (): Promise<void> =>
    runBackupAction(async () => {
      const result = await window.pige.backup.create();
      if (result.status === "created" && result.manifest) {
        setBackupNotice(`${props.t("backup.created")}: ${result.manifest.fileCount}`);
        await props.onRefresh();
      }
    });

  const cancelBackup = async (): Promise<void> =>
    runBackupAction(async () => {
      if (!activeBackupJob) return;
      await window.pige.jobs.cancel({ jobId: activeBackupJob.id });
      await props.onRefresh();
    });

  const retryBackup = async (): Promise<void> =>
    runBackupAction(async () => {
      if (!activeBackupJob) return;
      await window.pige.jobs.retry({ jobId: activeBackupJob.id });
      await props.onRefresh();
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

  const revealStorageRoot = async (target: VaultRevealTarget): Promise<void> => {
    if (props.busy || revealRequestActiveRef.current) return;
    revealRequestActiveRef.current = true;
    const requestId = ++revealRequestSequence.current;
    setRevealTarget(target);
    setRevealNotice(null);
    try {
      const result = target === "knowledge_root"
        ? await window.pige.vault.revealKnowledgeRoot()
        : await window.pige.vault.revealSourceAssetRoot();
      if (requestId !== revealRequestSequence.current) return;
      setRevealNotice(result.status === "revealed"
        ? { kind: "success", message: props.t("vaultSettings.revealSucceeded") }
        : { kind: "error", message: props.t(result.error.messageKey) });
    } catch {
      if (requestId === revealRequestSequence.current) {
        setRevealNotice({ kind: "error", message: props.t("errors.vault.reveal_failed") });
      }
    } finally {
      if (requestId === revealRequestSequence.current) {
        revealRequestActiveRef.current = false;
        setRevealTarget(null);
        window.requestAnimationFrame(() => {
          const button = target === "knowledge_root"
            ? knowledgeRootButtonRef.current
            : sourceAssetRootButtonRef.current;
          button?.focus();
        });
      }
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

  return (
    <section className="settings-page" aria-label={props.t(
      props.surface === "maintenance" ? "maintenance.title" : "nav.vaultSettings"
    )}>
      <div>
        <h1>{props.t(props.surface === "maintenance" ? "maintenance.title" : "vaultSettings.title")}</h1>
        <p className="muted">{props.t(
          props.surface === "maintenance" ? "maintenance.resetCopy" : "vaultSettings.subtitle"
        )}</p>
      </div>

      {props.surface === "vault" ? <>
      <InfoGroup
        title={props.t("vaultSettings.currentVault")}
        rows={[
          [props.t("field.name"), props.vault.name],
          [props.t("field.vaultPath"), props.vault.activeVaultPathDisplay],
          [props.t("field.noteStorage"), props.vault.knowledgeRootDisplay],
          [
            props.t("field.sourceAssets"),
            props.vault.sourceAssetRootKind === "external_binding"
              ? props.t("vaultSettings.externalRootUnavailable")
              : props.vault.sourceAssetRootDisplay
          ],
          [props.t("field.schema"), String(props.vault.schemaVersion)]
        ]}
      />

      <section className="settings-group">
        <h2>{props.t("sourceStorage.title")}</h2>
        <select
          value={props.vault.defaultSourceStorageStrategy}
          disabled={props.busy || Boolean(revealTarget)}
          onChange={(event) => void updatePolicy(event.target.value as SourceStorageStrategy)}
        >
          <option value="copy_to_source_library">{props.t("sourceStorage.copy")}</option>
          <option value="reference_original">{props.t("sourceStorage.reference")}</option>
        </select>
      </section>

      <section className="settings-actions" aria-busy={revealTarget ? "true" : undefined}>
        <button
          ref={knowledgeRootButtonRef}
          type="button"
          disabled={props.busy || Boolean(revealTarget)}
          onClick={() => void revealStorageRoot("knowledge_root")}
        >
          {props.t("vaultSettings.openInFinder")}
        </button>
        <button
          ref={sourceAssetRootButtonRef}
          type="button"
          className="secondary"
          disabled={props.busy || Boolean(revealTarget)}
          onClick={() => void revealStorageRoot("source_asset_root")}
        >
          {props.t("vaultSettings.openSourceAssets")}
        </button>
        <button type="button" className="secondary" onClick={props.onOpen} disabled={props.busy || Boolean(revealTarget)}>
          {props.t("vaultSettings.openAnother")}
        </button>
        <button type="button" className="secondary" onClick={props.onCreate} disabled={props.busy || Boolean(revealTarget)}>
          {props.t("vaultSettings.createNew")}
        </button>
      </section>
      {revealNotice ? (
        <p className={revealNotice.kind === "error" ? "error" : "muted"} role="status" aria-live="polite">
          {revealNotice.message}
        </p>
      ) : null}

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
        {activeBackupJob ? (
          <div className="backup-job-status" role="status" aria-live="polite">
            <p>{props.t(backupJobMessageKey(activeBackupJob))}</p>
            <div className="settings-actions">
              {activeBackupJob.state === "queued" || activeBackupJob.state === "running" ? (
                <button type="button" className="secondary" disabled={backupBusy} onClick={() => void cancelBackup()}>
                  {props.t("home.cancelJob")}
                </button>
              ) : activeBackupJob.state === "failed_retryable" && activeBackupJob.error?.userAction === "retry" ? (
                <button type="button" className="secondary" disabled={backupBusy} onClick={() => void retryBackup()}>
                  {props.t("home.retryJob")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
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
      </> : null}

      {props.surface === "maintenance" ? (
      <section className="settings-group">
        <div className="settings-actions">
          <button type="button" className="secondary" onClick={() => void rebuildLocalDatabase()}>
            {props.t("maintenance.rebuildIndex")}
          </button>
          <button type="button" className="secondary" onClick={() => void resetLocalDatabase()}>
            {props.t("maintenance.resetDatabase")}
          </button>
        </div>
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
      </section>
      ) : null}

      {props.surface === "vault" ? (
        <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
      ) : null}
      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

type ModelSettingsFailure =
  | { readonly kind: "preset"; readonly presetId: string }
  | { readonly kind: "custom_connection" }
  | { readonly kind: "custom_discovery" }
  | { readonly kind: "manual_model"; readonly providerId: string }
  | { readonly kind: "summary_refresh" }
  | { readonly kind: "post_commit_refresh" }
  | { readonly kind: "model_change" };

interface ModelSettingsPanelProps {
  readonly busy: boolean;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly onRefreshModels: () => Promise<ModelProviderSettingsSummary | null>;
  readonly onRefreshAgentRuntimeStatus: () => Promise<void>;
  readonly onBusy: (busy: boolean) => void;
  readonly t: (key: string) => string;
}

type ModelSettingsView =
  | { readonly kind: "overview" }
  | { readonly kind: "add_provider" }
  | { readonly kind: "preset"; readonly presetId: string }
  | { readonly kind: "custom" }
  | { readonly kind: "provider"; readonly providerId: string };

export function ModelSettingsPanel(props: ModelSettingsPanelProps): React.JSX.Element {
  const [view, setView] = useState<ModelSettingsView>({ kind: "overview" });
  const [presetApiKeys, setPresetApiKeys] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("Custom provider");
  const [endpointProtocol, setEndpointProtocol] = useState<ProviderEndpointProtocol>("openai_responses");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [manualBootstrap, setManualBootstrap] = useState<ProviderConnectNeedsManualModel | null>(null);
  const [providerSyncFailures, setProviderSyncFailures] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<ModelSettingsFailure | null>(null);
  const refreshRequestSequence = useRef(0);

  const refreshModelSummary = async (): Promise<void> => {
    const refreshId = ++refreshRequestSequence.current;
    try {
      await props.onRefreshModels();
    } catch (caught) {
      if (refreshId === refreshRequestSequence.current) throw caught;
    }
  };

  useEffect(() => {
    let active = true;
    void refreshModelSummary().catch(() => {
      if (active) setFailure({ kind: "summary_refresh" });
    });
    return () => {
      active = false;
    };
  }, []);

  const retryModelsSummary = async (): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await refreshModelSummary();
    } catch {
      setFailure({ kind: "summary_refresh" });
    } finally {
      props.onBusy(false);
    }
  };

  const refreshCommittedSettings = async (): Promise<boolean> => {
    try {
      await refreshModelSummary();
      setFailure(null);
      void props.onRefreshAgentRuntimeStatus().catch(() => undefined);
      return true;
    } catch {
      setFailure({ kind: "post_commit_refresh" });
      return false;
    }
  };

  const retryCommittedRefresh = async (): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await refreshCommittedSettings();
    } finally {
      props.onBusy(false);
    }
  };

  const connectPreset = async (presetId: string): Promise<boolean> => {
    props.onBusy(true);
    setFailure(null);
    try {
      const apiKey = presetApiKeys[presetId]?.trim();
      const result = await window.pige.models.addPresetProvider({
        presetId,
        ...(apiKey ? { apiKey } : {})
      });
      if ("status" in result) throw new Error("Reviewed preset did not select a bootstrap model.");
      setPresetApiKeys((current) => ({ ...current, [presetId]: "" }));
      await refreshCommittedSettings();
      return true;
    } catch {
      setFailure({ kind: "preset", presetId });
      return false;
    } finally {
      props.onBusy(false);
    }
  };

  const saveProvider = async (retryDiscovery = false): Promise<boolean> => {
    props.onBusy(true);
    setFailure(null);
    try {
      const result = await window.pige.models.addManualProvider({
        displayName,
        providerKind: endpointProtocol === "anthropic_messages" ? "anthropic_compatible" : "custom",
        endpointProtocol,
        baseUrl: baseUrl.trim(),
        apiKey,
        ...(!retryDiscovery && manualBootstrap ? { manualModelId: manualModelId.trim() } : {}),
        cloudBoundary: "unknown"
      });
      if ("status" in result) {
        setManualBootstrap(result);
        setManualModelId(result.discoveredModels[0]?.modelId ?? "");
        if (result.error) setFailure({ kind: "custom_discovery" });
        return false;
      }
      setApiKey("");
      setManualModelId("");
      setManualBootstrap(null);
      await refreshCommittedSettings();
      return true;
    } catch {
      setFailure({ kind: "custom_connection" });
      return false;
    } finally {
      props.onBusy(false);
    }
  };

  const setDefaultModel = async (modelProfileId: string): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await window.pige.models.setDefaultModel({ modelProfileId });
      await refreshCommittedSettings();
    } catch {
      setFailure({ kind: "model_change" });
    } finally {
      props.onBusy(false);
    }
  };

  const refreshProviderModels = async (providerProfileId: string): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    setProviderSyncFailures((current) => {
      const next = new Set(current);
      next.delete(providerProfileId);
      return next;
    });
    try {
      await window.pige.models.refreshProviderModels({ providerProfileId });
      setProviderSyncFailures((current) => {
        const next = new Set(current);
        next.delete(providerProfileId);
        return next;
      });
      try {
        await refreshModelSummary();
        setFailure(null);
      } catch {
        setFailure({ kind: "post_commit_refresh" });
      }
    } catch {
      setProviderSyncFailures((current) => new Set(current).add(providerProfileId));
    } finally {
      props.onBusy(false);
    }
  };

  const addManualModel = async (
    providerProfileId: string,
    modelId: string,
    modelDisplayName: string
  ): Promise<boolean> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await window.pige.models.addManualModel({
        providerProfileId,
        modelId,
        ...(modelDisplayName.trim() ? { displayName: modelDisplayName.trim() } : {})
      });
      await refreshCommittedSettings();
      return true;
    } catch {
      setFailure({ kind: "manual_model", providerId: providerProfileId });
      return false;
    } finally {
      props.onBusy(false);
    }
  };

  const setModelEnabled = async (modelProfileId: string, enabled: boolean): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await window.pige.models.updateModel({ modelProfileId, enabled });
      await refreshCommittedSettings();
    } catch {
      setFailure({ kind: "model_change" });
    } finally {
      props.onBusy(false);
    }
  };

  const setModelDisplayName = async (
    modelProfileId: string,
    displayName: string | null
  ): Promise<void> => {
    props.onBusy(true);
    setFailure(null);
    try {
      await window.pige.models.updateModel({ modelProfileId, displayName });
      await refreshCommittedSettings();
    } catch {
      setFailure({ kind: "model_change" });
    } finally {
      props.onBusy(false);
    }
  };

  const summary = props.modelSummary;
  const selectedPreset = view.kind === "preset"
    ? summary?.presets.find((preset) => preset.presetId === view.presetId)
    : undefined;
  const selectedProvider = view.kind === "provider"
    ? summary?.providers.find((provider) => provider.id === view.providerId)
    : undefined;

  const navigate = (nextView: ModelSettingsView): void => {
    setFailure(null);
    setManualBootstrap(null);
    setView(nextView);
  };

  const heading = (
    title: string,
    description: string,
    back?: { readonly label: string; readonly target: ModelSettingsView }
  ): React.JSX.Element => (
    <header className="settings-panel-header model-settings-header">
      {back ? (
        <button
          type="button"
          className="settings-button model-settings-back"
          onClick={() => navigate(back.target)}
        >
          <PigeIcon name="arrowLeft" size={15} />
          {back.label}
        </button>
      ) : null}
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );

  const summaryFailure = failure?.kind === "summary_refresh" || failure?.kind === "post_commit_refresh"
    ? (
        <div className="settings-warning model-settings-error" role="alert">
          <span>{props.t(failure.kind === "summary_refresh"
            ? "models.summaryRefreshFailed"
            : "models.refreshAfterSaveFailed")}</span>
          <button
            type="button"
            className="settings-button"
            disabled={props.busy}
            onClick={() => void (failure.kind === "summary_refresh"
              ? retryModelsSummary()
              : retryCommittedRefresh())}
          >
            {props.t("models.retry")}
          </button>
        </div>
      )
    : null;

  if (view.kind === "preset" && !selectedPreset) {
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(props.t("models.addProvider"), props.t("models.chooseProviderDescription"), {
          label: props.t("models.backToModels"),
          target: { kind: "overview" }
        })}
        <div className="settings-warning" role="status">{props.t("models.providerUnavailable")}</div>
      </section>
    );
  }

  if (view.kind === "provider" && !selectedProvider) {
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(props.t("models.title"), props.t("models.subtitle"), {
          label: props.t("models.backToModels"),
          target: { kind: "overview" }
        })}
        <div className="settings-warning" role="status">{props.t("models.providerUnavailable")}</div>
      </section>
    );
  }

  if (view.kind === "preset" && selectedPreset) {
    const presetFailure = failure?.kind === "preset" && failure.presetId === selectedPreset.presetId;
    const presetApiKey = presetApiKeys[selectedPreset.presetId] ?? "";
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(`${props.t("models.connect")} ${selectedPreset.displayName}`, props.t("models.presetDescription"), {
          label: props.t("models.backToProviders"),
          target: { kind: "add_provider" }
        })}
        {summaryFailure}
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.credentials")}</h2>
          <div className="settings-card">
            {selectedPreset.authRequirement !== "none" ? (
              <label className="settings-row" htmlFor={`preset-key-${selectedPreset.presetId}`}>
                <span className="settings-row-copy">
                  <strong>{props.t("models.apiKey")}</strong>
                  <span>{props.t("models.apiKeyDescription")}</span>
                </span>
                <input
                  className="settings-input"
                  id={`preset-key-${selectedPreset.presetId}`}
                  value={presetApiKey}
                  type="password"
                  autoComplete="off"
                  onChange={(event) => setPresetApiKeys((current) => ({
                    ...current,
                    [selectedPreset.presetId]: event.target.value
                  }))}
                />
              </label>
            ) : (
              <div className="settings-row">
                <div className="settings-row-copy">
                  <strong>{props.t("models.noCredentialRequired")}</strong>
                  <span>{props.t("models.noCredentialDescription")}</span>
                </div>
                <span className="settings-status">{props.t("models.readyToConnect")}</span>
              </div>
            )}
          </div>
          {presetFailure ? (
            <div className="settings-warning model-settings-error" role="alert">
              {props.t(
                selectedPreset.authRequirement === "api_key" || Boolean(presetApiKey.trim())
                  ? "models.presetConnectionFailedApiKey"
                  : "models.presetConnectionFailedNoAuth"
              )}
            </div>
          ) : null}
        </section>
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.connectionDisclosureTitle")}</h2>
          <p className="settings-disclosure">{props.t("models.connectionDisclosure")}</p>
          <div className="settings-inline-actions model-settings-footer-actions">
            <button type="button" className="settings-button" onClick={() => navigate({ kind: "overview" })}>
              {props.t("models.cancel")}
            </button>
            <button
              type="button"
              className="settings-button primary"
              disabled={props.busy || (
                selectedPreset.authRequirement === "api_key" && !presetApiKey.trim()
              )}
              onClick={() => void connectPreset(selectedPreset.presetId).then((connected) => {
                if (connected) setView({ kind: "overview" });
              })}
            >
              {props.t(presetFailure ? "models.retry" : "models.connectService")}
            </button>
          </div>
        </section>
      </section>
    );
  }

  if (view.kind === "custom") {
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(props.t("models.customProvider"), props.t("models.customProviderDescription"), {
          label: props.t("models.backToProviders"),
          target: { kind: "add_provider" }
        })}
        {summaryFailure}
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.connection")}</h2>
          <div className="settings-card">
            <label className="settings-row" htmlFor="provider-name">
              <span className="settings-row-copy">
                <strong>{props.t("models.displayName")}</strong>
                <span>{props.t("models.displayNameDescription")}</span>
              </span>
              <input className="settings-input" id="provider-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="settings-row" htmlFor="provider-protocol">
              <span className="settings-row-copy">
                <strong>{props.t("models.endpointProtocol")}</strong>
                <span>{props.t("models.protocolDescription")}</span>
              </span>
              <select
                className="settings-select"
                id="provider-protocol"
                value={endpointProtocol}
                onChange={(event) => setEndpointProtocol(event.target.value as ProviderEndpointProtocol)}
              >
                <option value="openai_responses">{props.t("models.protocol.openaiResponses")}</option>
                <option value="openai_chat_completions">{props.t("models.protocol.openaiChatCompletions")}</option>
                <option value="anthropic_messages">{props.t("models.protocol.anthropicMessages")}</option>
              </select>
            </label>
            <label className="settings-row" htmlFor="provider-base-url">
              <span className="settings-row-copy">
                <strong>{props.t("models.baseUrl")}</strong>
                <span>{props.t("models.baseUrlDescription")}</span>
              </span>
              <input className="settings-input" id="provider-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            </label>
            <label className="settings-row" htmlFor="provider-key">
              <span className="settings-row-copy">
                <strong>{props.t("models.apiKey")}</strong>
                <span>{props.t("models.apiKeyDescription")}</span>
              </span>
              <input className="settings-input" id="provider-key" value={apiKey} type="password" autoComplete="off" onChange={(event) => setApiKey(event.target.value)} />
            </label>
            {manualBootstrap ? (
              <label className="settings-row" htmlFor="provider-model">
                <span className="settings-row-copy">
                  <strong>{props.t("models.modelId")}</strong>
                  <span>{props.t("models.bootstrapModelRequired")}</span>
                </span>
                <span className="model-bootstrap-field">
                  <input
                    className="settings-input"
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
                </span>
              </label>
            ) : null}
          </div>
          {failure?.kind === "custom_connection" || failure?.kind === "custom_discovery" ? (
            <div className="settings-warning model-settings-error" role="alert">
              <span>{props.t(failure.kind === "custom_connection" ? "models.connectionFailed" : "models.discoveryFailed")}</span>
              {failure.kind === "custom_discovery" ? (
                <button
                  type="button"
                  className="settings-button"
                  disabled={props.busy || !baseUrl.trim() || !apiKey.trim()}
                  onClick={() => void saveProvider(true)}
                >
                  {props.t("models.retry")}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
        <p className="settings-disclosure">{props.t("models.customProbeDisclosure")}</p>
        <div className="settings-inline-actions model-settings-footer-actions">
          <button type="button" className="settings-button" onClick={() => navigate({ kind: "overview" })}>
            {props.t("models.cancel")}
          </button>
          <button
            type="button"
            className="settings-button primary"
            disabled={props.busy || !displayName.trim() || !baseUrl.trim() || !apiKey.trim() || (
              manualBootstrap !== null && !manualModelId.trim()
            )}
            onClick={() => void saveProvider().then((connected) => {
              if (connected) setView({ kind: "overview" });
            })}
          >
            {props.t(manualBootstrap
              ? "models.addCustomModel"
              : failure?.kind === "custom_connection"
                ? "models.retry"
                : "models.connectAndCheck")}
          </button>
        </div>
      </section>
    );
  }

  if (view.kind === "add_provider") {
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(props.t("models.addProvider"), props.t("models.chooseProviderDescription"), {
          label: props.t("models.backToModels"),
          target: { kind: "overview" }
        })}
        {summaryFailure}
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.reviewedProviders")}</h2>
          <div className="settings-card model-provider-picker">
            {summary?.presets.map((preset) => (
              <button
                type="button"
                className="settings-row model-provider-choice"
                key={preset.presetId}
                onClick={() => navigate({ kind: "preset", presetId: preset.presetId })}
              >
                <span className="settings-list-icon"><PigeIcon name="model" size={17} /></span>
                <span className="settings-row-copy">
                  <strong>{preset.displayName}</strong>
                  <span>{props.t(preset.authRequirement === "none" ? "models.noCredentialRequired" : "models.credentialOnly")}</span>
                </span>
                <PigeIcon name="expand" size={15} />
              </button>
            ))}
            <button type="button" className="settings-row model-provider-choice" onClick={() => navigate({ kind: "custom" })}>
              <span className="settings-list-icon"><PigeIcon name="wrench" size={17} /></span>
              <span className="settings-row-copy">
                <strong>{props.t("models.customProvider")}</strong>
                <span>{props.t("models.customProviderDescription")}</span>
              </span>
              <PigeIcon name="expand" size={15} />
            </button>
          </div>
        </section>
      </section>
    );
  }

  if (view.kind === "provider" && selectedProvider) {
    const providerModels = summary?.models.filter((model) => model.providerProfileId === selectedProvider.id) ?? [];
    return (
      <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
        {heading(selectedProvider.displayName, props.t("models.providerDetailsDescription"), {
          label: props.t("models.backToModels"),
          target: { kind: "overview" }
        })}
        {summaryFailure}
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.modelList")}</h2>
          <div className="settings-card provider-detail-card">
            <ProviderModelGroup
              providerId={selectedProvider.id}
              providerName={selectedProvider.displayName}
              models={providerModels}
              syncFailed={providerSyncFailures.has(selectedProvider.id)}
              manualModelFailed={failure?.kind === "manual_model" && failure.providerId === selectedProvider.id}
              busy={props.busy}
              onRefresh={() => refreshProviderModels(selectedProvider.id)}
              onAddCustom={(modelId, modelDisplayName) => addManualModel(selectedProvider.id, modelId, modelDisplayName)}
              onSetEnabled={setModelEnabled}
              onSetDisplayName={setModelDisplayName}
              t={props.t}
            />
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
      {heading(props.t("models.title"), props.t("models.subtitle"))}
      {summaryFailure}
      <section className="settings-section">
        <h2 className="settings-section-title">{props.t("models.globalDefault")}</h2>
        <div className="settings-card">
          <label className="settings-row" htmlFor="global-default-model">
            <span className="settings-row-copy">
              <strong>{props.t("models.defaultModel")}</strong>
              <span>{props.t("models.defaultDescription")}</span>
            </span>
            <select
              className="settings-select"
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
          </label>
        </div>
        {summary?.defaultBinding.state === "configured_unusable" ? (
          <div className="settings-warning model-settings-error" role="alert">{props.t(summary.defaultBinding.error.messageKey)}</div>
        ) : null}
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">{props.t("models.services")}</h2>
        {summary && summary.providers.length > 0 ? summary.providers.map((provider) => {
          const providerModels = summary.models.filter((model) => model.providerProfileId === provider.id);
          const enabledModels = providerModels.filter((model) => model.enabled);
          const syncFailed = providerSyncFailures.has(provider.id);
          return (
            <div className="settings-card model-provider-card" key={provider.id}>
              <div className="settings-row tall">
                <span className="settings-list-icon"><PigeIcon name="model" size={17} /></span>
                <span className="settings-row-copy">
                  <strong>{provider.displayName}</strong>
                  <span>
                    {providerModels.length} {props.t("models.modelsCountLabel")} · {enabledModels.length} {props.t("models.enabledCountLabel")}
                  </span>
                </span>
                <span className="settings-status">{props.t("models.connected")}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-copy">
                  <strong>{props.t("models.modelList")}</strong>
                  <span>{props.t("models.modelListDescription")}</span>
                </span>
                <span className="settings-row-control">
                  <button
                    type="button"
                    className="settings-button"
                    disabled={props.busy}
                    onClick={() => void refreshProviderModels(provider.id)}
                  >
                    {props.t(syncFailed ? "models.retry" : "library.refresh")}
                  </button>
                  <button type="button" className="settings-button" onClick={() => navigate({ kind: "provider", providerId: provider.id })}>
                    {props.t("models.addCustomModel")}
                  </button>
                </span>
              </div>
              <div className="settings-row">
                <span className="settings-row-copy">
                  <strong>{props.t("models.connectionDetails")}</strong>
                  <span>{props.t("models.connectionDetailsDescription")}</span>
                </span>
                <button type="button" className="settings-button" onClick={() => navigate({ kind: "provider", providerId: provider.id })}>
                  {props.t("models.manage")}
                </button>
              </div>
              {syncFailed ? (
                <div className="settings-warning model-settings-error" role="alert">{props.t("models.discoveryFailed")}</div>
              ) : null}
            </div>
          );
        }) : (
          <div className="settings-card model-empty-card">
            <div className="settings-row tall">
              <span className="settings-list-icon"><PigeIcon name="model" size={17} /></span>
              <span className="settings-row-copy">
                <strong>{props.t("models.noProvidersTitle")}</strong>
                <span>{props.t("models.noProvidersDescription")}</span>
              </span>
            </div>
          </div>
        )}
        <div className="settings-inline-actions">
          <button type="button" className="settings-button primary" onClick={() => navigate({ kind: "add_provider" })}>
            {props.t("models.addProvider")}
          </button>
        </div>
        <p className="settings-note">{props.t("models.routingNote")}</p>
      </section>
      {failure?.kind === "model_change" ? (
        <div className="settings-warning model-settings-error" role="alert">{props.t("models.modelChangeFailed")}</div>
      ) : null}
    </section>
  );
}

function ProviderModelGroup(props: {
  readonly providerId: string;
  readonly providerName: string;
  readonly models: readonly ModelProfileSummary[];
  readonly syncFailed: boolean;
  readonly manualModelFailed: boolean;
  readonly busy: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onAddCustom: (modelId: string, displayName: string) => Promise<boolean>;
  readonly onSetEnabled: (modelProfileId: string, enabled: boolean) => Promise<void>;
  readonly onSetDisplayName: (modelProfileId: string, displayName: string | null) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const addModel = async (): Promise<void> => {
    const added = await props.onAddCustom(modelId.trim(), displayName.trim());
    if (!added) return;
    setModelId("");
    setDisplayName("");
  };
  return (
    <section className="provider-model-group" aria-labelledby={`provider-models-${props.providerId}`}>
      <h3 className="visually-hidden" id={`provider-models-${props.providerId}`}>{props.providerName}</h3>
      <div className="settings-row">
        <span className="settings-row-copy">
          <strong>{props.t("models.automaticSync")}</strong>
          <span>{props.t("models.automaticSyncDescription")}</span>
        </span>
        <button type="button" className="settings-button" disabled={props.busy} onClick={() => void props.onRefresh()}>
          {props.t(props.syncFailed ? "models.retry" : "library.refresh")}
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
      ) : (
        <div className="settings-row">
          <span className="settings-row-copy">
            <strong>{props.t("models.noModelsTitle")}</strong>
            <span>{props.t("models.noModel")}</span>
          </span>
        </div>
      )}
      {props.syncFailed ? (
        <div className="settings-warning provider-model-error" role="alert">{props.t("models.discoveryFailed")}</div>
      ) : null}
      <details className="custom-model">
        <summary className="settings-row">
          <span className="settings-row-copy">
            <strong>{props.t("models.addCustomModel")}</strong>
            <span>{props.t("models.addCustomModelDescription")}</span>
          </span>
          <span className="settings-button" aria-hidden="true">{props.t("models.add")}</span>
        </summary>
        <div className="custom-provider-fields">
          <label className="settings-row" htmlFor={`custom-model-id-${props.providerId}`}>
            <span className="settings-row-copy">
              <strong>{props.t("models.modelId")}</strong>
              <span>{props.t("models.modelIdDescription")}</span>
            </span>
            <input
              className="settings-input"
              id={`custom-model-id-${props.providerId}`}
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          <label className="settings-row" htmlFor={`custom-model-name-${props.providerId}`}>
            <span className="settings-row-copy">
              <strong>{props.t("field.name")}</strong>
              <span>{props.t("models.optional")}</span>
            </span>
            <input
              className="settings-input"
              id={`custom-model-name-${props.providerId}`}
              value={displayName}
              placeholder={props.t("models.optional")}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          {props.manualModelFailed ? (
            <div className="settings-warning" role="alert">{props.t("models.manualModelFailed")}</div>
          ) : null}
          <div className="settings-inline-actions model-settings-footer-actions">
            <button className="settings-button primary" type="button" disabled={props.busy || !modelId.trim()} onClick={() => void addModel()}>
              {props.t(props.manualModelFailed ? "models.retry" : "models.addCustomModel")}
            </button>
          </div>
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
    <div className="settings-row model-row">
      <span className="settings-row-copy">
        <strong>{props.model.displayName ?? props.model.modelId}</strong>
        <span>{props.model.source === "manual" ? props.t("models.manual") : props.model.modelId}</span>
      </span>
      <div className="settings-row-control model-row-controls">
        <details className="model-name-editor">
          <summary className="settings-button">{props.t("models.editDisplayName")}</summary>
          <div className="model-name-fields">
            <label htmlFor={`model-display-name-${props.model.id}`}>{props.t("models.displayName")}</label>
            <input
              className="settings-input"
              id={`model-display-name-${props.model.id}`}
              value={displayName}
              placeholder={props.model.modelId}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button
              type="button"
              className="settings-button"
              disabled={props.busy}
              onClick={() => void props.onSetDisplayName(props.model.id, displayName.trim() || null)}
            >
              {props.t("models.saveDisplayName")}
            </button>
          </div>
        </details>
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={props.model.enabled}
          disabled={props.busy || props.model.isDefault}
          aria-label={`${props.t("models.enabled")}: ${props.model.displayName ?? props.model.modelId}`}
          title={props.model.isDefault ? props.t("models.default") : props.t("models.enabled")}
          onClick={() => void props.onSetEnabled(props.model.id, !props.model.enabled)}
        />
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
