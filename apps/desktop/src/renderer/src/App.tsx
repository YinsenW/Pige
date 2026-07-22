import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject
} from "react";
import { PigeIcon, type PigeIconName } from "./components/PigeIcon";
import { KnowledgeTreeMap } from "./components/KnowledgeTreeMap";
import { CurrentNoteAgent } from "./components/CurrentNoteAgent";
import { ConversationMarkdown } from "./components/ConversationMarkdown";
import { HomeVoicePanel, type HomeVoicePanelState } from "./components/HomeVoicePanel";
import { HighRiskConfirmationDialog } from "./components/HighRiskConfirmationDialog";
import {
  ReaderInlineReferenceSurface,
  type ReaderInlineReferenceActivation
} from "./components/ReaderInlineReferenceSurface";
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
  HighRiskConfirmationPendingResult,
  JobSummary,
  KnowledgeActivityListResult,
  KnowledgeActivitySummary,
  KnowledgeTreeResult,
  LibraryListResult,
  LibraryPageSummary,
  LibraryRelatedPage,
  LibraryRelatedResult,
  LocalDatabaseStatus,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  NoteRenderResult,
  NoteResolveInlineReferenceRequest,
  ReaderSelectionEndpoint,
  ReaderSelectionIdentity,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  OnboardingStatus,
  PigeErrorSummary,
  ProviderConnectNeedsManualModel,
  RecentVaultSummary,
  RetrievalAnswerCitation,
  RetrievalAskResult,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RestoreMode,
  RestorePreviewWarning,
  RestorePreviewResult,
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SkillSummary,
  SupportBundlePreview,
  ToolchainHealth,
  UpdateSummary,
  VaultRevealTarget,
  VaultSummary,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState
} from "@pige/contracts";
import type {
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
  | "history"
  | "updates"
  | "diagnostics";
type CaptureToast = {
  readonly kind: "success" | "error";
  readonly message: string;
  readonly queuedJobId?: string;
};
type DevelopmentSurface = "home" | "reader" | "knowledge" | "settings";
export type DevelopmentCapability =
  | "activity_open"
  | "voice_input"
  | "knowledge_search"
  | "knowledge_filter"
  | "knowledge_view"
  | "note_agent"
  | "document_actions"
  | "selection_actions"
  | "reader_link"
  | "source_reference"
  | "window_preferences"
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
type ConversationCopyState = {
  readonly messageId: string;
  readonly state: "copying" | "copied" | "failed";
};
type ActiveAgentDraftBinding = {
  readonly clientTurnId: string;
  requestId?: string;
  jobId?: string;
  conversationId?: string;
  conversationEventId?: string;
  sequence: number;
};
type OptimisticConversationTurn = {
  readonly clientTurnId: string;
  readonly text: string;
  readonly conversationEventId?: string;
  readonly jobId?: string;
};
type ActiveSourceTurnBinding = {
  readonly clientTurnId: string;
  readonly jobId: string | null;
  readonly pending: boolean;
  readonly sourceDisplayName: string | null;
};
type ActiveReaderSelectionProposal = {
  readonly vaultId: string;
  readonly pageId: string;
  readonly preview: ReaderSelectionProposalPreview;
  readonly errorMessageKey?: string;
};
type HomeFileDropRequest = {
  readonly clientTurnId: string;
  readonly files: readonly File[];
  readonly text?: string;
};
type AppearanceLoadState = "loading" | "ready" | "failed";

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
  const sidebarHomeOverlayViewport = useMediaQuery("(max-width: 719px)");
  const sidebarReaderOverlayViewport = useMediaQuery("(max-width: 839px)");
  const agentSoloOverlayViewport = useMediaQuery("(max-width: 959px)");
  const agentThreePaneOverlayViewport = useMediaQuery("(max-width: 1239px)");
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<readonly RecentVaultSummary[]>([]);
  const [vaultName, setVaultName] = useState(initialVaultName);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [windowLayoutState, setWindowLayoutState] = useState<WindowLayoutState | null>(null);
  const [view, setView] = useState<View>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [developmentNotice, setDevelopmentNotice] = useState<DevelopmentNotice | null>(null);
  const [noteAgentOpen, setNoteAgentOpen] = useState(false);
  const [noteAgentExternalRevision, setNoteAgentExternalRevision] = useState(0);
  const [readerSelectionProposal, setReaderSelectionProposal] = useState<ActiveReaderSelectionProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingRecentVaultId, setOpeningRecentVaultId] = useState<string | null>(null);
  const [recentVaultErrorId, setRecentVaultErrorId] = useState<string | null>(null);
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<DiagnosticsHealth | null>(null);
  const [localDatabaseStatus, setLocalDatabaseStatus] = useState<LocalDatabaseStatus | null>(null);
  const [supportBundlePreview, setSupportBundlePreview] = useState<SupportBundlePreview | null>(null);
  const [modelSummary, setModelSummary] = useState<ModelProviderSettingsSummary | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupRestoreStatus | null>(null);
  const [backupJobs, setBackupJobs] = useState<readonly JobSummary[]>([]);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [availableLocales, setAvailableLocales] = useState<readonly Locale[]>(["zh-Hans", "en", "ja", "ko", "fr", "de"]);
  const [appearanceLoadState, setAppearanceLoadState] = useState<AppearanceLoadState>("loading");
  const [toolchainHealth, setToolchainHealth] = useState<ToolchainHealth | null>(null);
  const [speechAvailability, setSpeechAvailability] = useState<SpeechAvailabilityResult | null>(null);
  const [speechAvailabilityLoading, setSpeechAvailabilityLoading] = useState(false);
  const [speechAvailabilityFailed, setSpeechAvailabilityFailed] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [homeDraftText, setHomeDraftText] = useState("");
  const [voiceAssetInstallActive, setVoiceAssetInstallActive] = useState(false);
  const [homeFileDropRequest, setHomeFileDropRequest] = useState<HomeFileDropRequest | null>(null);
  const [captureToast, setCaptureToast] = useState<CaptureToast | null>(null);
  const [highRiskConfirmation, setHighRiskConfirmation] = useState<HighRiskConfirmationPendingResult | null>(null);
  const [highRiskConfirmationDecision, setHighRiskConfirmationDecision] = useState<"allow" | "deny" | null>(null);
  const [highRiskConfirmationFailed, setHighRiskConfirmationFailed] = useState(false);
  const [highRiskConfirmationReading, setHighRiskConfirmationReading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<readonly JobSummary[]>([]);
  const [activityList, setActivityList] = useState<KnowledgeActivityListResult | null>(null);
  const [activityUndoingId, setActivityUndoingId] = useState<string | null>(null);
  const [activityOpeningId, setActivityOpeningId] = useState<string | null>(null);
  const [activityBlockedIds, setActivityBlockedIds] = useState<readonly string[]>([]);
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
  const inlineReferenceSequence = useRef(0);
  const activityOpenSequence = useRef(0);
  const activityOpenInFlightRef = useRef<string | null>(null);
  const readerSelectionProposalSequence = useRef(0);
  const readerSelectionProposalDecisionInFlight = useRef(false);
  const selectedNoteRef = useRef<NoteRenderResult | null>(selectedNote);
  const selectedNoteVaultIdRef = useRef<string | null>(selectedNoteVaultId);
  const noteAgentDisclosureInitialized = useRef(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null);
  const noteAgentToggleRef = useRef<HTMLButtonElement | null>(null);
  const windowLayoutRevisionRef = useRef(-1);
  const highRiskConfirmationRevisionRef = useRef(-1);
  const highRiskConfirmationReadSequence = useRef(0);
  const knowledgeTreeReturnFocusKey = useRef<string | null>(null);
  const modelRefreshSequence = useRef(0);
  const agentRuntimeRefreshSequence = useRef(0);
  const speechAvailabilitySequence = useRef(0);
  const vaultRefreshSequence = useRef(0);
  const recentVaultOpenRequestRef = useRef<string | null>(null);
  const voiceAssetInstallActiveRef = useRef(false);
  const deferredAppearanceRef = useRef<{
    readonly locale: Locale;
    readonly availableLocales: readonly Locale[];
  } | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(onboarding?.activeVault?.vaultId);
  activeVaultIdRef.current = onboarding?.activeVault?.vaultId;
  selectedNoteRef.current = selectedNote;
  selectedNoteVaultIdRef.current = selectedNoteVaultId;

  useEffect(() => {
    setReaderSelectionProposal((current) => {
      if (!current) return null;
      return current.vaultId === onboarding?.activeVault?.vaultId &&
        current.pageId === selectedNote?.summary.pageId
        ? current
        : null;
    });
  }, [onboarding?.activeVault?.vaultId, selectedNote?.summary.pageId]);

  useEffect(() => {
    if (
      readerSelectionProposal?.preview.state !== "resolving" ||
      readerSelectionProposalDecisionInFlight.current
    ) return;
    const proposalId = readerSelectionProposal.preview.proposalId;
    const vaultId = readerSelectionProposal.vaultId;
    const pageId = readerSelectionProposal.pageId;
    const sequence = readerSelectionProposalSequence.current + 1;
    readerSelectionProposalSequence.current = sequence;
    const refresh = async (): Promise<void> => {
      try {
        const result = await window.pige.readerSelection.currentProposal({ apiVersion: 1, proposalId });
        if (
          sequence !== readerSelectionProposalSequence.current ||
          activeVaultIdRef.current !== vaultId ||
          selectedNoteRef.current?.summary.pageId !== pageId
        ) return;
        if (result.status === "available") {
          setReaderSelectionProposal({ vaultId, pageId, preview: result.proposal });
        } else {
          setReaderSelectionProposal((current) => current?.preview.proposalId === proposalId
            ? {
                ...current,
                preview: { ...current.preview, state: "conflicted" },
                errorMessageKey: "note.proposal.unavailable"
              }
            : current);
        }
      } catch {
        if (sequence !== readerSelectionProposalSequence.current) return;
        setReaderSelectionProposal((current) => current?.preview.proposalId === proposalId
          ? { ...current, errorMessageKey: "note.proposal.decisionFailed" }
          : current);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_200);
    return () => {
      window.clearInterval(timer);
      readerSelectionProposalSequence.current += 1;
    };
  }, [readerSelectionProposal?.preview.proposalId, readerSelectionProposal?.preview.state]);
  const sidebarOpen = windowLayoutState?.sidebarOpen ?? windowState?.sidebarOpen ?? false;
  const homeSurface = view === "home" && !selectedNote;
  const windowLayoutSurface = homeSurface ? "home" : "reader";
  const layoutSurfaceCurrent = windowLayoutState?.surface === windowLayoutSurface;
  const sidebarOverlayLayout = layoutSurfaceCurrent && windowLayoutState?.sidebarOpen
    ? windowLayoutState.sidebarPresentation === "overlay"
    : homeSurface
      ? sidebarHomeOverlayViewport
      : sidebarReaderOverlayViewport;
  const agentOverlayLayout = layoutSurfaceCurrent && windowLayoutState?.noteAgentOpen
    ? windowLayoutState.noteAgentPresentation === "overlay"
    : agentSoloOverlayViewport || (sidebarOpen && agentThreePaneOverlayViewport);

  const applyWindowLayoutState = (nextState: WindowLayoutState): boolean => {
    if (nextState.revision < windowLayoutRevisionRef.current) return false;
    windowLayoutRevisionRef.current = nextState.revision;
    setWindowLayoutState(nextState);
    setNoteAgentOpen(nextState.noteAgentOpen);
    return true;
  };

  const requestWindowLayout = async (request: WindowLayoutRequest): Promise<WindowLayoutState | null> => {
    try {
      const nextState = await window.pige.window.setLayout(request);
      applyWindowLayoutState(nextState);
      return nextState;
    } catch {
      setCaptureToast({ kind: "error", message: t("error.generic") });
      return null;
    }
  };

  const updateVoiceAssetInstallOwnership = (active: boolean): void => {
    voiceAssetInstallActiveRef.current = active;
    setVoiceAssetInstallActive(active);
    if (active || !deferredAppearanceRef.current) return;
    const appearance = deferredAppearanceRef.current;
    deferredAppearanceRef.current = null;
    setLocale(appearance.locale);
    setAvailableLocales(appearance.availableLocales);
  };

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

  const refreshAppearance = async (): Promise<boolean> => {
    setAppearanceLoadState("loading");
    try {
      const appearance = await window.pige.settings.appearance();
      if (voiceAssetInstallActiveRef.current) {
        deferredAppearanceRef.current = appearance;
        setAppearanceLoadState("ready");
        return true;
      }
      setLocale(appearance.locale);
      setAvailableLocales(appearance.availableLocales);
      setAppearanceLoadState("ready");
      return true;
    } catch {
      setAppearanceLoadState("failed");
      return false;
    }
  };

  const applyHighRiskConfirmation = (next: HighRiskConfirmationPendingResult): void => {
    if (next.revision < highRiskConfirmationRevisionRef.current) return;
    highRiskConfirmationRevisionRef.current = next.revision;
    setHighRiskConfirmation(next);
    setHighRiskConfirmationDecision(null);
    setHighRiskConfirmationFailed(false);
  };

  const refreshHighRiskConfirmation = async (): Promise<void> => {
    const sequence = highRiskConfirmationReadSequence.current + 1;
    highRiskConfirmationReadSequence.current = sequence;
    setHighRiskConfirmationReading(true);
    try {
      const next = await window.pige.confirmations.pending();
      if (sequence === highRiskConfirmationReadSequence.current) applyHighRiskConfirmation(next);
    } catch {
      if (sequence === highRiskConfirmationReadSequence.current) setHighRiskConfirmationFailed(true);
    } finally {
      if (sequence === highRiskConfirmationReadSequence.current) setHighRiskConfirmationReading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const unsubscribe = window.pige.confirmations.onChanged((next) => {
      if (!active) return;
      highRiskConfirmationReadSequence.current += 1;
      setHighRiskConfirmationReading(false);
      applyHighRiskConfirmation(next);
    });
    void refreshHighRiskConfirmation();
    return () => {
      active = false;
      highRiskConfirmationReadSequence.current += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribeLayout = window.pige.window.onLayoutChanged((nextState) => {
      if (active) applyWindowLayoutState(nextState);
    });
    void window.pige.getHealth().then(setHealth);
    void window.pige.window.current().then(setWindowState);
    void window.pige.window.currentLayout().then((nextState) => {
      if (active) applyWindowLayoutState(nextState);
    });
    void refreshAppearance();
    void window.pige.system.toolchainHealth().then(setToolchainHealth);
    void refreshVaultState();
    void refreshModels().catch(() => undefined);
    return () => {
      active = false;
      unsubscribeLayout();
    };
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

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "capabilities") return;
    void refreshSpeechAvailability();
  }, [locale, settingsOpen, settingsSection]);

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
      const [nextJobs, nextBackupJobs, nextActivities] = nextOnboarding.activeVault
        ? await Promise.all([
          window.pige.jobs.list({
            limit: 100,
            classes: ["capture", "parse", "ocr", "agent_ingest", "agent_turn", "index_rebuild"],
            ...homeJobStateFilter
          }).catch(() => undefined),
          window.pige.jobs.list({
            limit: 20,
            classes: ["backup"],
            states: ["queued", "running", "cancel_requested", "waiting_dependency", "failed_retryable", "failed_final"]
          }).catch(() => undefined),
          window.pige.activity.list({ limit: 20 }).catch(() => undefined)
        ])
        : [undefined, undefined, undefined];
      if (refreshId !== vaultRefreshSequence.current) return;
      if (activeVaultIdRef.current !== nextOnboarding.activeVault?.vaultId) {
        noteOpenSequence.current += 1;
        inlineReferenceSequence.current += 1;
        activityOpenSequence.current += 1;
        setSelectedNote(null);
        setSelectedNoteRelated(null);
        setSelectedNoteVaultId(null);
        setNoteLoadingPageId(null);
        setNoteAgentOpen(false);
        setActivityList(null);
        setActivityOpeningId(null);
        activityOpenInFlightRef.current = null;
      }
      setOnboarding(nextOnboarding);
      setRecentVaults(nextRecentVaults);
      setBackupStatus(nextBackupStatus);
      if (runtimeRefreshId === agentRuntimeRefreshSequence.current) {
        setAgentRuntimeStatus(nextAgentRuntimeStatus);
      }
      setRecentJobs(nextJobs?.jobs ?? []);
      if (nextJobs) {
        setCaptureToast((current) => {
          if (!current?.queuedJobId) return current;
          const exactJob = nextJobs.jobs.find((job) => job.id === current.queuedJobId);
          return exactJob?.state === "queued" ? current : null;
        });
      }
      setBackupJobs(nextBackupJobs?.jobs.filter((job) => job.backupKind === "user_backup") ?? []);
      const nextActivityList = nextActivities &&
        nextActivities.activeVaultId === nextOnboarding.activeVault?.vaultId
        ? { ...nextActivities, activities: nextActivities.activities.slice(0, 5) }
        : null;
      setActivityList(nextActivityList);
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
    } catch {
      setError(t("error.generic"));
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

  const openRecentVault = async (vaultId: string): Promise<void> => {
    if (recentVaultOpenRequestRef.current) return;
    recentVaultOpenRequestRef.current = vaultId;
    setOpeningRecentVaultId(vaultId);
    setRecentVaultErrorId(null);
    setBusy(true);
    setError(null);
    try {
      const result = await window.pige.vault.openRecent({ vaultId });
      if (result.status !== "completed") {
        setRecentVaultErrorId(vaultId);
        return;
      }
      setOnboarding(result.onboarding);
      setView("home");
      void refreshVaultState().catch(() => {
        setCaptureToast({ kind: "error", message: t("error.generic") });
      });
    } catch {
      setRecentVaultErrorId(vaultId);
    } finally {
      recentVaultOpenRequestRef.current = null;
      setOpeningRecentVaultId(null);
      setBusy(false);
    }
  };

  const removeRecent = (vaultId: string): Promise<void> =>
    runVaultAction(async () => {
      setRecentVaultErrorId((current) => current === vaultId ? null : current);
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

  const refreshSpeechAvailability = async (): Promise<void> => {
    const requestId = ++speechAvailabilitySequence.current;
    setSpeechAvailabilityLoading(true);
    setSpeechAvailabilityFailed(false);
    try {
      const nextAvailability = await window.pige.speech.availability({ languageTag: locale });
      if (requestId !== speechAvailabilitySequence.current) return;
      setSpeechAvailability(nextAvailability);
    } catch {
      if (requestId !== speechAvailabilitySequence.current) return;
      setSpeechAvailability(null);
      setSpeechAvailabilityFailed(true);
    } finally {
      if (requestId === speechAvailabilitySequence.current) setSpeechAvailabilityLoading(false);
    }
  };

  const refreshLocalCapabilities = async (): Promise<void> => {
    const results = await Promise.allSettled([
      refreshDiagnostics(),
      refreshSpeechAvailability()
    ]);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("One or more local capability checks failed.");
    }
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
    if (voiceAssetInstallActiveRef.current) return;
    settingsOpenerRef.current = opener;
    await dismissFirstHomeGuide();
    setSettingsSection("models");
    setDevelopmentNotice(null);
    setSettingsOpen(true);
  };

  const openSettings = (section: SettingsSection, opener: HTMLButtonElement): void => {
    if (voiceAssetInstallActiveRef.current) return;
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
    } catch {
      setLibraryError(t("error.generic"));
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

  const openNoteTarget = async (pageId: string, reportError = true): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    inlineReferenceSequence.current += 1;
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setDevelopmentNotice(null);
    setLibraryError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (
        requestId !== noteOpenSequence.current ||
        activeVaultIdRef.current !== vaultId ||
        note.summary.pageId !== pageId
      ) return false;
      let requestedNoteAgentOpen = noteAgentOpen;
      if (!noteAgentDisclosureInitialized.current) {
        noteAgentDisclosureInitialized.current = true;
        requestedNoteAgentOpen = !agentOverlayLayout;
      }
      const nextLayout = await requestWindowLayout({
        apiVersion: 1,
        surface: "reader",
        sidebarOpen,
        noteAgentOpen: requestedNoteAgentOpen
      });
      if (
        !nextLayout ||
        requestId !== noteOpenSequence.current ||
        activeVaultIdRef.current !== vaultId
      ) return false;
      setSelectedNoteVaultId(vaultId);
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
      return true;
    } catch {
      if (requestId !== noteOpenSequence.current) return false;
      if (reportError) setLibraryError(t("error.generic"));
      return false;
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  const openNote = async (pageId: string): Promise<void> => {
    await openNoteTarget(pageId);
  };

  const activateInlineReference = async (href: string): Promise<ReaderInlineReferenceActivation> => {
    const vaultId = activeVaultIdRef.current;
    const note = selectedNoteRef.current;
    const renderContextId = note?.renderContextId;
    if (!vaultId || selectedNoteVaultIdRef.current !== vaultId || !note || !renderContextId) return "failed";
    const pageId = note.summary.pageId;
    const sequence = inlineReferenceSequence.current + 1;
    inlineReferenceSequence.current = sequence;
    const request: NoteResolveInlineReferenceRequest = {
      apiVersion: 1,
      requestId: createNoteReferenceRequestId(),
      activeVaultId: vaultId,
      currentPageId: pageId,
      renderContextId,
      href
    };
    return resolveAndOpenInlineReference(
      request,
      () => (
        inlineReferenceSequence.current === sequence &&
        activeVaultIdRef.current === vaultId &&
        selectedNoteVaultIdRef.current === vaultId &&
        selectedNoteRef.current?.summary.pageId === pageId &&
        selectedNoteRef.current?.renderContextId === renderContextId
      ),
      (targetPageId) => openNoteTarget(targetPageId, false)
    );
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
    const nextSidebarOpen = !sidebarOpen;
    const wasOverlay = sidebarOpen && sidebarOverlayLayout;
    const nextLayout = await requestWindowLayout({
      apiVersion: 1,
      surface: windowLayoutSurface,
      sidebarOpen: nextSidebarOpen,
      noteAgentOpen: windowLayoutSurface === "reader" && Boolean(selectedNote) && noteAgentOpen
    });
    if (!nextLayout) return;
    if (nextSidebarOpen && activeVault) void refreshLibrary();
    if (!nextSidebarOpen && wasOverlay) {
      window.requestAnimationFrame(() => sidebarToggleRef.current?.focus());
    }
  };

  const navigateHome = (): void => {
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    knowledgeTreeReturnFocusKey.current = null;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteAgentOpen(false);
    setView("home");
    void requestWindowLayout({
      apiVersion: 1,
      surface: "home",
      sidebarOpen,
      noteAgentOpen: false
    });
    void refreshVaultState().catch(() => {
      setCaptureToast({ kind: "error", message: t("error.generic") });
    });
  };

  const navigateLibrarySearch = async (): Promise<void> => {
    if (voiceAssetInstallActiveRef.current) return;
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    knowledgeTreeReturnFocusKey.current = null;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteAgentOpen(false);
    setDevelopmentNotice(null);
    setView("library");
    void refreshLibrary();
    await requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: sidebarOverlayLayout ? false : sidebarOpen,
      noteAgentOpen: false
    });
    setLibrarySearchFocusRequest((current) => current + 1);
  };

  const toggleAlwaysOnTop = async (): Promise<void> => {
    setWindowState(await window.pige.window.setAlwaysOnTop({ alwaysOnTop: !(windowState?.alwaysOnTop ?? false) }));
  };

  const updateLocale = async (nextLocale: Locale): Promise<void> => {
    if (voiceAssetInstallActiveRef.current) return;
    const appearance = await window.pige.settings.setLocale({ locale: nextLocale });
    setLocale(appearance.locale);
    setAvailableLocales(appearance.availableLocales);
    setAppearanceLoadState("ready");
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
      setCaptureToast({ kind: "success", message: t("home.jobRequeued"), queuedJobId: jobId });
      await refreshVaultState();
      return;
    }
    setCaptureToast({ kind: "error", message: t("error.generic") });
  };

  const undoActivity = async (operationId: string): Promise<void> => {
    if (
      activityUndoingId ||
      !activityList ||
      activityList.activeVaultId !== activeVaultIdRef.current
    ) return;
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
        if (current.activeVaultId !== activeVaultIdRef.current) return;
        const exact = current.activities.find((activity) => activity.operationId === operationId);
        if (exact?.status === "undone") {
          setActivityList({ ...current, activities: current.activities.slice(0, 5) });
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "success", message: t("activity.undoCompleted") });
        } else if (exact?.status === "applied" && exact.canUndo) {
          setActivityList({ ...current, activities: current.activities.slice(0, 5) });
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "error", message: t("activity.undoFailed") });
        } else {
          if (exact) setActivityList({ ...current, activities: current.activities.slice(0, 5) });
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

  const openActivityTarget = async (activity: KnowledgeActivitySummary): Promise<void> => {
    const originVaultId = activityList?.activeVaultId;
    const target = activity.target;
    if (
      activityOpenInFlightRef.current ||
      !originVaultId ||
      originVaultId !== activeVaultIdRef.current ||
      target?.kind !== "page"
    ) return;
    const requestId = activityOpenSequence.current + 1;
    activityOpenSequence.current = requestId;
    activityOpenInFlightRef.current = activity.operationId;
    setActivityOpeningId(activity.operationId);
    const opened = await openNoteTarget(target.pageId, false);
    if (
      !opened ||
      requestId !== activityOpenSequence.current ||
      originVaultId !== activeVaultIdRef.current
    ) {
      if (requestId === activityOpenSequence.current) {
        setCaptureToast({ kind: "error", message: t("error.generic") });
        activityOpenInFlightRef.current = null;
        setActivityOpeningId(null);
      }
      return;
    }
    setView("library");
    setSettingsOpen(false);
    activityOpenInFlightRef.current = null;
    setActivityOpeningId(null);
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
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteLoadingPageId(null);
    setNoteAgentOpen(false);
  }, [activeVault?.vaultId, selectedNote?.summary.pageId, selectedNoteVaultId]);

  useEffect(() => {
    if (!windowLayoutState) return;
    const desiredNoteAgentOpen = windowLayoutSurface === "reader" && Boolean(selectedNote) && noteAgentOpen;
    if (
      windowLayoutState.surface === windowLayoutSurface &&
      windowLayoutState.sidebarOpen === sidebarOpen &&
      windowLayoutState.noteAgentOpen === desiredNoteAgentOpen
    ) return;
    void requestWindowLayout({
      apiVersion: 1,
      surface: windowLayoutSurface,
      sidebarOpen,
      noteAgentOpen: desiredNoteAgentOpen
    });
  }, [windowLayoutState?.revision, windowLayoutSurface, sidebarOpen, selectedNote?.summary.pageId, noteAgentOpen]);

  useEffect(() => {
    if (!sidebarModal) return;
    const frame = window.requestAnimationFrame(() => {
      focusFirstOverlayControl(sidebarRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sidebarModal]);

  const toggleNoteAgent = async (): Promise<void> => {
    if (!selectedNote) return;
    const nextOpen = !noteAgentOpen;
    await requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: nextOpen
    });
  };

  const closeNoteAgent = async (): Promise<void> => {
    if (!selectedNote || !noteAgentOpen) return;
    const nextLayout = await requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: false
    });
    if (!nextLayout) return;
    window.requestAnimationFrame(() => noteAgentToggleRef.current?.focus());
  };

  const revealReaderSelectionAction = (result: ReaderSelectionActionResult): void => {
    const hasConversation = result.status === "completed" || result.status === "waiting" ||
      (result.status === "failed" && Boolean(result.conversationId));
    if (!selectedNote || !hasConversation) return;
    setNoteAgentExternalRevision((current) => current + 1);
    void requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: true
    });
  };

  const revealReaderSelectionTransform = (result: ReaderSelectionTransformResult): void => {
    const vaultId = activeVaultIdRef.current;
    const pageId = selectedNoteRef.current?.summary.pageId;
    if (!vaultId || !pageId || selectedNoteVaultIdRef.current !== vaultId) return;
    if (result.status === "applied") {
      setReaderSelectionProposal(null);
      void openNoteTarget(pageId);
      return;
    }
    if (result.status === "review_required") {
      setReaderSelectionProposal({ vaultId, pageId, preview: result.proposal });
    } else if (result.status !== "waiting" && !(result.status === "failed" && result.conversationId)) {
      return;
    }
    setNoteAgentExternalRevision((current) => current + 1);
    void requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: true
    });
  };

  const decideReaderSelectionProposal = async (
    proposalId: string,
    action: "reject" | "later" | "apply"
  ): Promise<void> => {
    const current = readerSelectionProposal;
    if (!current || current.preview.proposalId !== proposalId) return;
    if (action === "later") {
      readerSelectionProposalSequence.current += 1;
      setReaderSelectionProposal(null);
      return;
    }
    if (readerSelectionProposalDecisionInFlight.current || current.preview.state !== "ready") return;
    if (
      activeVaultIdRef.current !== current.vaultId ||
      selectedNoteRef.current?.summary.pageId !== current.pageId ||
      selectedNoteVaultIdRef.current !== current.vaultId
    ) {
      setReaderSelectionProposal(null);
      return;
    }
    readerSelectionProposalDecisionInFlight.current = true;
    const sequence = readerSelectionProposalSequence.current + 1;
    readerSelectionProposalSequence.current = sequence;
    setReaderSelectionProposal({
      vaultId: current.vaultId,
      pageId: current.pageId,
      preview: { ...current.preview, state: "resolving" }
    });
    let result: ReaderSelectionProposalDecisionResult;
    try {
      result = await window.pige.readerSelection.decideProposal({
        apiVersion: 1,
        proposalId,
        expectedRevision: current.preview.revision,
        decision: action === "apply" ? "approve" : "reject"
      });
    } catch {
      if (sequence === readerSelectionProposalSequence.current) {
        setReaderSelectionProposal({
          ...current,
          errorMessageKey: "note.proposal.decisionFailed"
        });
      }
      readerSelectionProposalDecisionInFlight.current = false;
      return;
    }
    readerSelectionProposalDecisionInFlight.current = false;
    if (
      sequence !== readerSelectionProposalSequence.current ||
      activeVaultIdRef.current !== current.vaultId ||
      selectedNoteRef.current?.summary.pageId !== current.pageId
    ) return;
    if (result.status === "failed") {
      setReaderSelectionProposal({
        ...current,
        errorMessageKey: result.error.messageKey || "note.proposal.decisionFailed"
      });
      return;
    }
    if (result.status === "stale") {
      setReaderSelectionProposal({
        ...current,
        preview: result.proposal ?? { ...current.preview, state: "conflicted" },
        errorMessageKey: "note.proposal.stale"
      });
      return;
    }
    setReaderSelectionProposal({ vaultId: current.vaultId, pageId: current.pageId, preview: result.proposal });
    if (result.status === "applied") await openNoteTarget(current.pageId);
  };

  const resolveHighRiskConfirmation = async (decision: "allow" | "deny"): Promise<void> => {
    if (highRiskConfirmation?.status !== "pending" || highRiskConfirmationDecision) return;
    const current = highRiskConfirmation;
    setHighRiskConfirmationDecision(decision);
    setHighRiskConfirmationFailed(false);
    try {
      const result = await window.pige.confirmations.resolve({
        apiVersion: 1,
        confirmationId: current.confirmation.confirmationId,
        expectedRevision: current.revision,
        decision
      });
      if (result.status === "stale") {
        applyHighRiskConfirmation(result.current);
        return;
      }
      if (result.status === "committed" || result.status === "already_resolved") {
        applyHighRiskConfirmation({ apiVersion: 1, status: "none", revision: result.revision });
        return;
      }
      if (result.status === "not_found") {
        applyHighRiskConfirmation(await window.pige.confirmations.pending());
        return;
      }
      setHighRiskConfirmationFailed(true);
    } catch {
      try {
        applyHighRiskConfirmation(await window.pige.confirmations.pending());
      } catch {
        setHighRiskConfirmationFailed(true);
      }
    } finally {
      setHighRiskConfirmationDecision(null);
    }
  };
  const highRiskConfirmationOpen = highRiskConfirmation?.status === "pending";

  return (
    <div
      className={`shell app-window mode-${windowState?.mode ?? "compact"}${macosWindowShell ? " platform-macos" : ""}${homeSurface ? " home-surface" : ""}${sidebarOpen ? " sidebar-expanded" : ""}${selectedNote ? " note-mode" : ""}${dropActive ? " drop-active" : ""}`}
      aria-label="Pige"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="topbar titlebar" inert={settingsOpen || agentModal || highRiskConfirmationOpen}>
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

      <div
        className={`main-layout${sidebarOpen ? " sidebar-open" : ""}${selectedNote ? " note-open" : ""}${selectedNote && noteAgentOpen ? " agent-open" : ""}`}
        inert={highRiskConfirmationOpen}
      >
        {sidebarOpen ? (
          <aside
            ref={sidebarRef}
            className="sidebar"
            id="pige-library-sidebar"
            role={sidebarModal ? "dialog" : undefined}
            aria-modal={sidebarModal ? "true" : undefined}
            aria-label={sidebarModal ? t("nav.library") : undefined}
            inert={settingsOpen || agentModal}
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
              disabled={voiceAssetInstallActive}
              aria-current={view === "knowledgeTree" ? "page" : undefined}
              onClick={() => {
                if (voiceAssetInstallActive) return;
                noteOpenSequence.current += 1;
                inlineReferenceSequence.current += 1;
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
                  if (voiceAssetInstallActive) return;
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
              disabled={voiceAssetInstallActive}
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
        <main className="workspace" inert={settingsOpen || sidebarModal || agentModal}>
        {blocked ? (
          <FirstRunPanel
            appearanceLoadState={appearanceLoadState}
            locale={locale}
            availableLocales={availableLocales}
            busy={busy}
            error={error}
            modelSummary={modelSummary}
            recentVaults={recentVaults}
            vaultName={vaultName}
            onLocaleChange={updateLocale}
            onRetryAppearance={refreshAppearance}
            onRefreshModels={refreshModels}
            onRefreshAgentRuntimeStatus={refreshAgentRuntimeStatus}
            onBusy={setBusy}
            onCreate={createVault}
            onOpen={openVault}
            onOpenRecent={openRecentVault}
            onRemoveRecent={removeRecent}
            openingRecentVaultId={openingRecentVaultId}
            recentVaultErrorId={recentVaultErrorId}
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
            activeVaultId={activeVault.vaultId}
            onResolveReaderSelection={resolveReaderSelection}
            onSubmitReaderSelectionAction={submitReaderSelectionAction}
            onSubmitReaderSelectionTransform={submitReaderSelectionTransform}
            locale={locale}
            onReaderSelectionAction={revealReaderSelectionAction}
            onReaderSelectionTransform={revealReaderSelectionTransform}
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
              inlineReferenceSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
            noteAgentOpen={noteAgentOpen}
            onToggleNoteAgent={toggleNoteAgent}
            noteAgentToggleRef={noteAgentToggleRef}
            developmentNotice={developmentNotice?.surface === "reader" ? developmentNotice : null}
            onClearDevelopment={() => setDevelopmentNotice(null)}
            onCopyNote={copyNoteMarkdown}
            {...(selectedNote?.renderContextId && selectedNoteVaultId === activeVault.vaultId
              ? { onActivateInlineReference: activateInlineReference }
              : {})}
            onDevelopment={(capability) => showDevelopmentCapability("reader", capability)}
            t={t}
          />
        ) : view === "knowledgeTree" && activeVault ? (
          selectedNote ? (
            <LibraryPanel
              libraryList={libraryList}
              activeVaultId={activeVault.vaultId}
              onResolveReaderSelection={resolveReaderSelection}
              onSubmitReaderSelectionAction={submitReaderSelectionAction}
              onSubmitReaderSelectionTransform={submitReaderSelectionTransform}
              locale={locale}
              onReaderSelectionAction={revealReaderSelectionAction}
              onReaderSelectionTransform={revealReaderSelectionTransform}
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
                inlineReferenceSequence.current += 1;
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
              {...(selectedNote?.renderContextId && selectedNoteVaultId === activeVault.vaultId
                ? { onActivateInlineReference: activateInlineReference }
                : {})}
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
            agentRuntimeStatus={agentRuntimeStatus}
            modelSummary={modelSummary}
            recentJobs={recentJobs}
            locale={locale}
            onReaderSelectionAction={revealReaderSelectionAction}
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
            onHomeStateChanged={refreshVaultState}
            onSetDefaultModel={setHomeDefaultModel}
            onVoiceAssetInstallActiveChange={updateVoiceAssetInstallOwnership}
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
            key={`${activeVault.vaultId}:${selectedNote.summary.pageId}:${noteAgentExternalRevision}`}
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
            onClose={() => void closeNoteAgent()}
            onOpenModels={(opener) => openSettings("models", opener)}
            onSelectModel={setHomeDefaultModel}
            proposal={readerSelectionProposal?.vaultId === activeVault.vaultId &&
              readerSelectionProposal.pageId === selectedNote.summary.pageId
              ? readerSelectionProposal.preview
              : null}
            {...(readerSelectionProposal?.vaultId === activeVault.vaultId &&
              readerSelectionProposal.pageId === selectedNote.summary.pageId &&
              readerSelectionProposal.errorMessageKey
              ? { proposalErrorMessageKey: readerSelectionProposal.errorMessageKey }
              : {})}
            onProposalAction={(proposalId, action) => void decideReaderSelectionProposal(proposalId, action)}
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
          backgroundInert={highRiskConfirmationOpen}
          macosWindowShell={macosWindowShell}
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
                locale={locale}
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
                onOpenMemory={() => {
                  setSettingsSection("memory");
                  setDevelopmentNotice(null);
                }}
                onError={setError}
                t={t}
              />
            ) : null
          ) : settingsSection === "general" ? (
            <GeneralSettingsPanel
              alwaysOnTop={windowState?.alwaysOnTop ?? false}
              onAlwaysOnTopChange={toggleAlwaysOnTop}
              onOpenAppearance={() => {
                setSettingsSection("appearance");
                setDevelopmentNotice(null);
              }}
              onDevelopment={() => showDevelopmentCapability("settings", "window_preferences")}
              t={t}
            />
          ) : settingsSection === "appearance" ? (
            <AppearanceSettingsPanel
              locale={locale}
              availableLocales={availableLocales}
              onLocaleChange={updateLocale}
              onDevelopment={() => showDevelopmentCapability("settings", "appearance")}
              t={t}
            />
          ) : settingsSection === "capabilities" ? (
            <LocalCapabilitiesSettingsPanel
              toolchainHealth={toolchainHealth}
              speechAvailability={speechAvailability}
              speechAvailabilityLoading={speechAvailabilityLoading}
              speechAvailabilityFailed={speechAvailabilityFailed}
              onRefresh={refreshLocalCapabilities}
              onOpenSpeechSettings={() => window.pige.speech.openSystemSettings()
                .then(() => undefined)
                .catch(() => setSpeechAvailabilityFailed(true))}
              onDevelopment={() => showDevelopmentCapability("settings", "local_capabilities")}
              t={t}
            />
          ) : settingsSection === "memory" ? (
            <AgentMemorySettingsPanel
              onDevelopment={() => showDevelopmentCapability("settings", "agent_memory")}
              t={t}
            />
          ) : settingsSection === "privacy" ? (
            <PermissionsPrivacySettingsPanel
              onDevelopment={() => showDevelopmentCapability("settings", "permissions_privacy")}
              t={t}
            />
          ) : settingsSection === "skills" ? (
            <SkillsSettingsPanel
              onDevelopment={() => showDevelopmentCapability("settings", "skills")}
              t={t}
            />
          ) : settingsSection === "packages" ? (
            <PiPackagesSettingsPanel
              onDevelopment={() => showDevelopmentCapability("settings", "packages")}
              t={t}
            />
          ) : settingsSection === "history" ? (
            <ActivityHistorySettingsPanel
              activities={activityList?.activities ?? []}
              undoingId={activityUndoingId}
              openingId={activityOpeningId}
              blockedIds={activityBlockedIds}
              locale={locale}
              onOpen={openActivityTarget}
              onUndo={undoActivity}
              t={t}
            />
          ) : settingsSection === "updates" || settingsSection === "diagnostics" ? (
            <SystemSettingsPanel
              surface={settingsSection}
              locale={locale}
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
      {highRiskConfirmation?.status === "pending" ? (
        <HighRiskConfirmationDialog
          key={highRiskConfirmation.confirmation.confirmationId}
          confirmation={highRiskConfirmation.confirmation}
          resolving={highRiskConfirmationDecision !== null}
          error={highRiskConfirmationFailed}
          onResolve={(decision) => void resolveHighRiskConfirmation(decision)}
          t={t}
        />
      ) : null}
      {highRiskConfirmationFailed && highRiskConfirmation?.status !== "pending" ? (
        <div
          className="confirmation-recovery-notice"
          role="alert"
          aria-busy={highRiskConfirmationReading}
        >
          <span>{t("confirmation.statusUnavailable")}</span>
          <button
            type="button"
            className="ghost"
            disabled={highRiskConfirmationReading}
            onClick={() => void refreshHighRiskConfirmation()}
          >
            {highRiskConfirmationReading
              ? t("confirmation.checking")
              : t("confirmation.retry")}
          </button>
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
  readonly activeVaultId?: string;
  readonly onResolveReaderSelection?: (request: ReaderSelectionResolveRequest) => Promise<ReaderSelectionResolveResult>;
  readonly onSubmitReaderSelectionAction?: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
  readonly onSubmitReaderSelectionTransform?: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly locale?: Locale;
  readonly onReaderSelectionAction?: (result: ReaderSelectionActionResult) => void;
  readonly onReaderSelectionTransform?: (result: ReaderSelectionTransformResult) => void;
  readonly onActivateInlineReference?: (href: string) => Promise<ReaderInlineReferenceActivation>;
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
          {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
          {...(props.onResolveReaderSelection ? { onResolveSelection: props.onResolveReaderSelection } : {})}
          {...(props.onSubmitReaderSelectionAction ? { onSubmitSelectionAction: props.onSubmitReaderSelectionAction } : {})}
          {...(props.onSubmitReaderSelectionTransform ? { onSubmitSelectionTransform: props.onSubmitReaderSelectionTransform } : {})}
          {...(props.locale ? { locale: props.locale } : {})}
          {...(props.onReaderSelectionAction ? { onSelectionActionResult: props.onReaderSelectionAction } : {})}
          {...(props.onReaderSelectionTransform ? { onSelectionTransformResult: props.onReaderSelectionTransform } : {})}
          related={props.selectedNoteRelated}
          relatedLoadingPageId={props.noteLoadingPageId}
          onOpenRelated={props.onOpenNote}
          {...(props.onActivateInlineReference ? { onActivateInlineReference: props.onActivateInlineReference } : {})}
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

function readerSelectionEndpoint(
  reader: HTMLElement | null,
  node: Node | null,
  offset: number
): ReaderSelectionEndpoint | null {
  if (!reader || !node || !Number.isInteger(offset) || offset < 0) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const segment = element?.closest<HTMLElement>("[data-pige-selection-segment]");
  if (!segment || !reader.contains(segment)) return null;
  const segmentId = segment.dataset.pigeSelectionSegment;
  if (!segmentId || !/^readerseg_[a-f0-9]{16}$/u.test(segmentId)) return null;
  try {
    const range = reader.ownerDocument.createRange();
    range.selectNodeContents(segment);
    range.setEnd(node, offset);
    return { segmentId, utf16Offset: range.toString().length };
  } catch {
    return null;
  }
}

function createReaderSelectionRequestId(): string {
  return `readerselreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function resolveReaderSelection(request: ReaderSelectionResolveRequest): Promise<ReaderSelectionResolveResult> {
  return window.pige.readerSelection.resolve(request);
}

function submitReaderSelectionAction(request: ReaderSelectionActionRequest): Promise<ReaderSelectionActionResult> {
  return window.pige.readerSelection.submitAction(request);
}

function submitReaderSelectionTransform(request: ReaderSelectionTransformRequest): Promise<ReaderSelectionTransformResult> {
  return window.pige.readerSelection.submitTransform(request);
}

function createReaderSelectionActionRequestId(): string {
  return `readerselaction_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function NoteReader(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly onResolveSelection?: (request: ReaderSelectionResolveRequest) => Promise<ReaderSelectionResolveResult>;
  readonly onSubmitSelectionAction?: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
  readonly onSubmitSelectionTransform?: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly locale?: Locale;
  readonly onSelectionActionResult?: (result: ReaderSelectionActionResult) => void;
  readonly onSelectionTransformResult?: (result: ReaderSelectionTransformResult) => void;
  readonly related: NoteRelatedState;
  readonly relatedLoadingPageId: string | null;
  readonly onOpenRelated: (pageId: string) => Promise<void>;
  readonly onActivateInlineReference?: (href: string) => Promise<ReaderInlineReferenceActivation>;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const summary = props.note.summary;
  const readerRef = useRef<HTMLElement | null>(null);
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const selectionActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectionMoreActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectionFocusTransition = useRef(false);
  const selectionMoreOpenRef = useRef(false);
  const selectionFocusOwnerRef = useRef<HTMLElement | null>(null);
  const selectionTextRef = useRef("");
  const selectionResolveSequence = useRef(0);
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
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false);
  const [selectionMoreActionIndex, setSelectionMoreActionIndex] = useState(0);
  const [selectionMorePlacement, setSelectionMorePlacement] = useState<"above" | "below">("below");
  const [selectionFeedback, setSelectionFeedback] = useState<string | null>(null);
  const [selectionActionPending, setSelectionActionPending] = useState(false);
  const [selectionResolution, setSelectionResolution] = useState<
    | { readonly kind: "copy_only" }
    | { readonly kind: "checking" }
    | { readonly kind: "resolved"; readonly selection: ReaderSelectionIdentity }
  >({ kind: "copy_only" });

  useLayoutEffect(() => {
    const firstBlock = markdownBodyRef.current?.firstElementChild;
    if (!firstBlock || firstBlock.tagName !== "H1") return;
    const normalizeTitle = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    firstBlock.classList.toggle(
      "reader-duplicate-title",
      normalizeTitle(firstBlock.textContent ?? "") === normalizeTitle(summary.title)
    );
  });

  const closeSelectionToolbar = (restoreFocus: boolean): void => {
    selectionFocusTransition.current = false;
    selectionMoreOpenRef.current = false;
    dismissedSelectionRef.current = currentSelectionRef.current;
    setSelectionMoreOpen(false);
    setSelectionAnchor(null);
    setSelectionPosition(null);
    if (!restoreFocus) return;
    const priorOwner = selectionFocusOwnerRef.current;
    const focusTarget = priorOwner?.isConnected ? priorOwner : readerRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    let selectionFrame: number | null = null;
    const updateSelection = (): void => {
      if (selectionFocusTransition.current || selectionMoreOpenRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        selectionResolveSequence.current += 1;
        currentSelectionRef.current = null;
        selectionTextRef.current = "";
        dismissedSelectionRef.current = null;
        if (selectionToolbarRef.current?.contains(document.activeElement)) return;
        setSelectionAnchor(null);
        setSelectionPosition(null);
        setSelectionResolution({ kind: "copy_only" });
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
      const nextSelectionText = selection.toString();
      const previousSelection = currentSelectionRef.current;
      const selectionChanged = !previousSelection ||
        previousSelection.left !== rect.left ||
        previousSelection.top !== rect.top ||
        previousSelection.right !== rect.right ||
        previousSelection.bottom !== rect.bottom ||
        selectionTextRef.current !== nextSelectionText;
      const nextSelection = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
      currentSelectionRef.current = nextSelection;
      selectionTextRef.current = nextSelectionText;
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
      if (selectionChanged) {
        selectionMoreOpenRef.current = false;
        setSelectionMoreOpen(false);
        setSelectionFeedback(null);
      }
      setSelectionPosition({ left: Math.max(12, anchor.left), top: Math.max(12, anchor.top) });
      if (!selectionChanged) return;

      const resolveSequence = ++selectionResolveSequence.current;
      const renderContextId = props.note.renderContextId;
      const activeVaultId = props.activeVaultId;
      const resolveSelection = props.onResolveSelection;
      const reader = readerRef.current;
      const anchorEndpoint = readerSelectionEndpoint(reader, selection.anchorNode, selection.anchorOffset);
      const focusEndpoint = readerSelectionEndpoint(reader, selection.focusNode, selection.focusOffset);
      if (!renderContextId || !activeVaultId || !resolveSelection || !anchorEndpoint || !focusEndpoint) {
        setSelectionResolution({ kind: "copy_only" });
        return;
      }
      setSelectionResolution({ kind: "checking" });
      const request: ReaderSelectionResolveRequest = {
        apiVersion: 1,
        requestId: createReaderSelectionRequestId(),
        activeVaultId,
        currentPageId: summary.pageId,
        renderContextId,
        anchor: anchorEndpoint,
        focus: focusEndpoint
      };
      void resolveSelection(request).then((result) => {
        if (resolveSequence !== selectionResolveSequence.current || result.requestId !== request.requestId) return;
        if (props.note.renderContextId !== renderContextId || props.activeVaultId !== activeVaultId) return;
        setSelectionResolution(result.status === "resolved"
          ? { kind: "resolved", selection: result.selection }
          : { kind: "copy_only" });
      }).catch(() => {
        if (resolveSequence === selectionResolveSequence.current) setSelectionResolution({ kind: "copy_only" });
      });
    };
    const scheduleSelectionUpdate = (): void => {
      if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = null;
        updateSelection();
      });
    };
    const dismissOnScroll = (event: Event): void => {
      if (event.target instanceof Node && selectionToolbarRef.current?.contains(event.target)) return;
      selectionMoreOpenRef.current = false;
      dismissedSelectionRef.current = currentSelectionRef.current;
      setSelectionMoreOpen(false);
      setSelectionAnchor(null);
      setSelectionPosition(null);
    };
    const dismissMenuOutside = (event: PointerEvent): void => {
      if (!selectionMoreOpenRef.current) return;
      if (event.target instanceof Node && selectionToolbarRef.current?.contains(event.target)) return;
      closeSelectionToolbar(false);
    };
    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("pointerdown", dismissMenuOutside, true);
    window.addEventListener("resize", scheduleSelectionUpdate);
    window.addEventListener("scroll", dismissOnScroll, true);
    const reader = readerRef.current;
    const readerResizeObserver = reader && typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(scheduleSelectionUpdate)
      : null;
    if (reader) readerResizeObserver?.observe(reader);
    return () => {
      selectionResolveSequence.current += 1;
      if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("pointerdown", dismissMenuOutside, true);
      window.removeEventListener("resize", scheduleSelectionUpdate);
      window.removeEventListener("scroll", dismissOnScroll, true);
      readerResizeObserver?.disconnect();
    };
  }, [props.activeVaultId, props.note.renderContextId, props.onResolveSelection, summary.pageId]);

  useEffect(() => {
    if (!selectionAnchor) return;
    const ownerWindow = readerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    let frame: number | null = null;
    const positionToolbar = (): void => {
      frame = null;
      const toolbar = selectionToolbarRef.current;
      if (!toolbar) return;
      const toolbarRect = toolbar.getBoundingClientRect();
      const width = Math.max(toolbarRect.width, toolbar.offsetWidth, toolbar.scrollWidth);
      const height = Math.max(toolbarRect.height, toolbar.offsetHeight, toolbar.scrollHeight);
      if (width <= 0 || height <= 0) return;
      const maxLeft = Math.max(12, ownerWindow.innerWidth - width - 12);
      const maxTop = Math.max(12, ownerWindow.innerHeight - height - 12);
      const preferredLeft = selectionAnchor.left + (selectionAnchor.width / 2) - (width / 2);
      const above = selectionAnchor.top - height - 8;
      const preferredTop = above >= 12 ? above : selectionAnchor.bottom + 8;
      const next = {
        left: Math.max(12, Math.min(maxLeft, preferredLeft)),
        top: Math.max(12, Math.min(maxTop, preferredTop))
      };
      setSelectionPosition((current) => current?.left === next.left && current.top === next.top ? current : next);
    };
    const schedulePosition = (): void => {
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      frame = ownerWindow.requestAnimationFrame(positionToolbar);
    };
    schedulePosition();
    const toolbar = selectionToolbarRef.current;
    const resizeObserver = toolbar && typeof ownerWindow.ResizeObserver === "function"
      ? new ownerWindow.ResizeObserver(schedulePosition)
      : null;
    if (toolbar) resizeObserver?.observe(toolbar);
    return () => {
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [selectionAnchor]);

  useLayoutEffect(() => {
    if (!selectionMoreOpen) return;
    const menu = selectionToolbarRef.current?.querySelector<HTMLElement>(".selection-more-menu");
    const toolbar = selectionToolbarRef.current;
    if (!menu || !toolbar) return;
    const toolbarRect = toolbar.getBoundingClientRect();
    const menuHeight = Math.max(menu.getBoundingClientRect().height, menu.offsetHeight, menu.scrollHeight);
    const ownerWindow = toolbar.ownerDocument.defaultView;
    if (!ownerWindow) return;
    setSelectionMorePlacement(toolbarRect.bottom + menuHeight + 6 <= ownerWindow.innerHeight - 12 ? "below" : "above");
  }, [selectionMoreOpen, selectionPosition]);

  const moveSelectionActionFocus = (index: number): void => {
    selectionFocusTransition.current = true;
    setSelectionActionIndex(index);
    window.requestAnimationFrame(() => {
      selectionActionRefs.current.get(index)?.focus();
      window.requestAnimationFrame(() => { selectionFocusTransition.current = false; });
    });
  };

  const moveSelectionMoreActionFocus = (index: number): void => {
    setSelectionMoreActionIndex(index);
    readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
      selectionMoreActionRefs.current.get(index)?.focus({ preventScroll: true });
    });
  };

  const toggleSelectionMore = (): void => {
    const next = !selectionMoreOpen;
    selectionMoreOpenRef.current = next;
    if (next) selectionFocusTransition.current = true;
    setSelectionMoreOpen(next);
    if (next) {
      setSelectionMoreActionIndex(0);
      readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
        selectionMoreActionRefs.current.get(0)?.focus({ preventScroll: true });
        readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
          selectionFocusTransition.current = false;
        });
      });
    } else {
      selectionFocusTransition.current = false;
    }
  };

  const copySelection = async (asQuote: boolean): Promise<void> => {
    const selectedText = selectionTextRef.current;
    const clipboard = readerRef.current?.ownerDocument.defaultView?.navigator.clipboard;
    if (!selectedText || !clipboard?.writeText) {
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.copyFailed"));
      return;
    }
    const clipboardText = asQuote
      ? selectedText.split(/\r?\n/u).map((line) => `> ${line}`).join("\n")
      : selectedText;
    try {
      await clipboard.writeText(clipboardText);
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t(asQuote ? "note.selection.quoteCopied" : "note.selection.copied"));
    } catch {
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.copyFailed"));
    }
  };

  const submitSelectionAction = async (
    action: "explain" | "summarize",
    selection: ReaderSelectionIdentity
  ): Promise<void> => {
    if (selectionActionPending) return;
    const resolveSequence = selectionResolveSequence.current;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      if (!props.onSubmitSelectionAction) throw new Error("Reader selection actions are unavailable.");
      const result = await props.onSubmitSelectionAction({
        apiVersion: 1,
        requestId: createReaderSelectionActionRequestId(),
        action,
        selection,
        locale: props.locale ?? "en",
        clientTurnId: createAgentClientTurnId()
      });
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      props.onSelectionActionResult?.(result);
      setSelectionFeedback(props.t(
        result.status === "completed" || result.status === "waiting"
          ? "note.selection.sentToAgent"
          : "note.selection.actionFailed"
      ));
    } catch {
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.actionFailed"));
    } finally {
      if (resolveSequence === selectionResolveSequence.current) setSelectionActionPending(false);
    }
  };

  const submitSelectionTransform = async (
    action: "translate" | "polish" | "expand",
    selection: ReaderSelectionIdentity
  ): Promise<void> => {
    if (selectionActionPending) return;
    const resolveSequence = selectionResolveSequence.current;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      if (!props.onSubmitSelectionTransform) throw new Error("Reader selection transforms are unavailable.");
      const result = await props.onSubmitSelectionTransform({
        apiVersion: 1,
        requestId: createReaderSelectionActionRequestId(),
        action,
        selection,
        locale: props.locale ?? "en",
        clientTurnId: createAgentClientTurnId()
      });
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      props.onSelectionTransformResult?.(result);
      setSelectionFeedback(props.t(
        result.status === "applied"
          ? "note.selection.applied"
          : result.status === "review_required"
            ? "note.selection.reviewReady"
            : result.status === "waiting"
              ? "note.selection.sentToAgent"
              : "note.selection.actionFailed"
      ));
    } catch {
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.actionFailed"));
    } finally {
      if (resolveSequence === selectionResolveSequence.current) setSelectionActionPending(false);
    }
  };

  const selectionActions = selectionResolution.kind === "resolved"
    ? (["explain", "summarize", "link", "more"] as const)
    : (["copy", "copyAsQuote"] as const);

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
            if (event.key === "ArrowRight") nextIndex = (selectionActionIndex + 1) % selectionActions.length;
            else if (event.key === "ArrowLeft") nextIndex = (selectionActionIndex - 1 + selectionActions.length) % selectionActions.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = selectionActions.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            moveSelectionActionFocus(nextIndex);
          }}
        >
          {selectionActions.map((action, index) => (
            <button
              key={action}
              ref={(element) => {
                if (element) selectionActionRefs.current.set(index, element);
                else selectionActionRefs.current.delete(index);
              }}
              type="button"
              disabled={selectionActionPending}
              tabIndex={selectionActionIndex === index ? 0 : -1}
              data-selection-action={action}
              aria-expanded={action === "more" ? selectionMoreOpen : undefined}
              aria-controls={action === "more" ? "reader-selection-more-menu" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (action === "copy" || action === "copyAsQuote") {
                  void copySelection(action === "copyAsQuote");
                  return;
                }
                if (action === "more") {
                  toggleSelectionMore();
                  return;
                }
                if ((action === "explain" || action === "summarize") && selectionResolution.kind === "resolved") {
                  void submitSelectionAction(action, selectionResolution.selection);
                  return;
                }
                closeSelectionToolbar(true);
                props.onDevelopment("selection_actions");
              }}
            >
              {props.t(`note.selection.${action}`)}
            </button>
          ))}
          {selectionMoreOpen ? (
            <div
              id="reader-selection-more-menu"
              className={`selection-more-menu ${selectionMorePlacement}`}
              role="menu"
              aria-label={props.t("note.selection.moreActions")}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  selectionMoreOpenRef.current = false;
                  setSelectionMoreOpen(false);
                  readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => selectionActionRefs.current.get(selectionActions.length - 1)?.focus());
                  return;
                }
                let nextIndex: number | null = null;
                if (event.key === "ArrowDown") nextIndex = (selectionMoreActionIndex + 1) % 5;
                else if (event.key === "ArrowUp") nextIndex = (selectionMoreActionIndex + 4) % 5;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = 4;
                if (nextIndex === null) return;
                event.preventDefault();
                moveSelectionMoreActionFocus(nextIndex);
              }}
            >
              {(["copy", "copyAsQuote", "translate", "polish", "expand"] as const).map((action, index) => (
                <button
                  key={action}
                  ref={(element) => {
                    if (element) selectionMoreActionRefs.current.set(index, element);
                    else selectionMoreActionRefs.current.delete(index);
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={selectionMoreActionIndex === index ? 0 : -1}
                  data-selection-more-action={action}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (action === "copy" || action === "copyAsQuote") {
                      void copySelection(action === "copyAsQuote");
                      return;
                    }
                    if (selectionResolution.kind === "resolved" && props.onSubmitSelectionTransform) {
                      void submitSelectionTransform(action, selectionResolution.selection);
                      return;
                    }
                    closeSelectionToolbar(true);
                    props.onDevelopment("selection_actions");
                  }}
                >
                  {props.t(`note.selection.${action}`)}
                  {(action === "translate" || action === "polish" || action === "expand") &&
                  !props.onSubmitSelectionTransform ? (
                    <span>{props.t("note.selection.unavailable")}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {selectionFeedback ? (
        <p className="reader-selection-feedback" role="status" aria-live="polite" aria-atomic="true">
          {selectionFeedback}
        </p>
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
      <ReaderInlineReferenceSurface
        ref={markdownBodyRef}
        pageIdentity={`${summary.pageId}:${props.note.renderContextId ?? "unavailable"}`}
        html={props.note.html}
        onUnavailable={() => props.onDevelopment("reader_link")}
        t={props.t}
        {...(props.onActivateInlineReference ? { onActivate: props.onActivateInlineReference } : {})}
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
  readonly appearanceLoadState: AppearanceLoadState;
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly vaultName: string;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onRetryAppearance: () => Promise<boolean>;
  readonly onRefreshModels: () => Promise<ModelProviderSettingsSummary | null>;
  readonly onRefreshAgentRuntimeStatus: () => Promise<void>;
  readonly onBusy: (busy: boolean) => void;
  readonly onCreate: () => Promise<void>;
  readonly onOpen: () => Promise<void>;
  readonly onOpenRecent: (vaultId: string) => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly openingRecentVaultId: string | null;
  readonly recentVaultErrorId: string | null;
  readonly onRestoreCompleted: () => Promise<void>;
  readonly onVaultNameChange: (value: string) => void;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

type FirstRunStep = "language" | "models" | "vault";

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
  readonly variant?: "first-run" | "settings";
  readonly locale?: Locale;
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
  const settingsVariant = props.variant === "settings";
  const applyDisabled =
    props.phase !== "idle" ||
    props.mode === null ||
    props.preview.invalidFileCount > 0 ||
    !props.preview.permittedModes.includes(props.mode);
  const locale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  const createdAt = (() => {
    if (!settingsVariant || !locale) return props.preview.manifest.createdAt;
    const parsed = new Date(props.preview.manifest.createdAt);
    return Number.isNaN(parsed.getTime())
      ? props.preview.manifest.createdAt
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  })();
  const formatCount = (value: number): string => settingsVariant && locale
    ? value.toLocaleString(locale)
    : String(value);
  const warningCategoryCount = props.preview.warnings.length + (props.preview.invalidFileCount > 0 ? 1 : 0);

  const summary = (
    <dl className={settingsVariant ? "restore-settings-summary" : "restore-summary"}>
      {settingsVariant ? (
        <>
          <div className="settings-row">
            <div className="settings-row-copy">
              <dt>{props.t("backup.createdAt")}</dt>
              <dd>{createdAt}</dd>
            </div>
            <span className="settings-badge">{props.preview.manifest.appVersion}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <dt>{props.t("backup.vaultSchema")}</dt>
              <dd>
                {props.t("backup.vaultSchemaSummary")
                  .replace("{version}", String(props.preview.manifest.vaultSchemaVersion))
                  .replace("{notes}", formatCount(props.preview.manifest.noteCount))
                  .replace("{sources}", formatCount(props.preview.manifest.sourceCount))
                  .replace("{memories}", formatCount(props.preview.manifest.memoryCount))}
              </dd>
            </div>
            <span className={`settings-status${props.preview.invalidFileCount > 0 ? " warning" : ""}`}>
              {props.t(props.preview.invalidFileCount > 0 ? "backup.restoreBlocked" : "backup.restoreReady")}
            </span>
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <dt>{props.t("backup.warnings")}</dt>
              <dd>
                {warningCategoryCount === 0 ? props.t("backup.noWarnings") : (
                  <ul className="restore-warning-list">
                    {props.preview.invalidFileCount > 0 ? (
                      <li>
                        <span>{props.t("backup.invalidFiles")}</span>
                        <strong>{formatCount(props.preview.invalidFileCount)}</strong>
                      </li>
                    ) : null}
                    {props.preview.warnings.map((warning) => (
                      <li key={warning.code}>
                        <span>{props.t(restoreWarningMessageKey(warning.code))}</span>
                        <strong>{formatCount(warning.count)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <span className="settings-badge">
              {props.t("backup.warningCategoryCount").replace("{count}", formatCount(warningCategoryCount))}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="info-row">
            <dt>{props.t("backup.vault")}</dt>
            <dd>{props.preview.manifest.vaultName}</dd>
          </div>
          <div className="info-row">
            <dt>{props.t("backup.createdAt")}</dt>
            <dd>{createdAt}</dd>
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
        </>
      )}
    </dl>
  );

  const modeOptions = (
    <fieldset className={settingsVariant ? "restore-mode-options settings-restore-modes" : "restore-mode-options"}>
      <legend className={settingsVariant ? "visually-hidden" : undefined}>{props.t("backup.restoreMode")}</legend>
      {props.preview.permittedModes.includes("clone_as_new") ? (
        <label
          className={settingsVariant ? `settings-radio${props.mode === "clone_as_new" ? " active" : ""}` : undefined}
          htmlFor={`${props.idPrefix}-restore-clone`}
        >
          <input
            id={`${props.idPrefix}-restore-clone`}
            type="radio"
            name={`${props.idPrefix}-restore-mode`}
            value="clone_as_new"
            checked={props.mode === "clone_as_new"}
            disabled={props.phase !== "idle"}
            onChange={() => props.onModeChange("clone_as_new")}
          />
          {settingsVariant ? <span className="settings-radio-mark" aria-hidden="true" /> : null}
          <span className={settingsVariant ? "settings-radio-copy" : undefined}>
            <strong>{props.t("backup.modeClone")}</strong>
            <small>{props.t("backup.modeCloneDescription")}</small>
          </span>
        </label>
      ) : null}
      {props.preview.permittedModes.includes("replace_existing") ? (
        <label
          className={settingsVariant ? `settings-radio${props.mode === "replace_existing" ? " active" : ""}` : undefined}
          htmlFor={`${props.idPrefix}-restore-replace`}
        >
          <input
            id={`${props.idPrefix}-restore-replace`}
            type="radio"
            name={`${props.idPrefix}-restore-mode`}
            value="replace_existing"
            checked={props.mode === "replace_existing"}
            disabled={props.phase !== "idle"}
            onChange={() => props.onModeChange("replace_existing")}
          />
          {settingsVariant ? <span className="settings-radio-mark" aria-hidden="true" /> : null}
          <span className={settingsVariant ? "settings-radio-copy" : undefined}>
            <strong>{props.t("backup.modeReplace")}</strong>
            <small>{props.t("backup.modeReplaceDescription")}</small>
          </span>
        </label>
      ) : null}
    </fieldset>
  );

  const feedback = (
    <>
      {props.mode === "replace_existing" ? (
        <p className={settingsVariant ? "settings-warning" : "restore-warning"} role="note">
          {props.t("backup.replaceWarning")}
        </p>
      ) : settingsVariant ? <p className="settings-warning" role="note">{props.t("backup.restorePrivacyWarning")}</p> : null}
      {props.preview.invalidFileCount > 0 ? (
        <p className="error" role="alert">{props.t("backup.restoreInvalid")}</p>
      ) : null}
      {props.errorKey ? <p className="error" role="alert">{props.t(props.errorKey)}</p> : null}
      {applying ? <p className="muted" role="status">{props.t("backup.restoreProgress")}</p> : null}
    </>
  );

  const actions = (
    <div className={settingsVariant ? "settings-inline-actions restore-settings-actions" : "settings-actions"}>
      {settingsVariant ? (
        <button
          type="button"
          className="settings-button"
          disabled={props.phase !== "idle"}
          onClick={props.onCancel}
        >
          {props.t("backup.restoreCancel")}
        </button>
      ) : null}
      <button
        ref={props.applyButtonRef}
        type="button"
        className={settingsVariant ? "settings-button primary" : undefined}
        disabled={applyDisabled}
        onClick={() => void props.onApply()}
      >
        {applying
          ? props.t("backup.restoring")
          : props.t(props.mode === "replace_existing" ? "backup.applyReplace" : "backup.applyClone")}
      </button>
      {!settingsVariant ? (
        <button
          type="button"
          className="secondary"
          disabled={props.phase !== "idle"}
          onClick={props.onCancel}
        >
          {props.t("backup.restoreCancel")}
        </button>
      ) : null}
    </div>
  );

  if (settingsVariant) {
    return (
      <section className="settings-page settings-restore-page restore-preview" aria-labelledby={`${props.idPrefix}-restore-title`}>
        <header className="settings-panel-header">
          <button className="settings-button restore-back-button" type="button" disabled={props.phase !== "idle"} onClick={props.onCancel}>
            {props.t("backup.backToVault")}
          </button>
          <h1 id={`${props.idPrefix}-restore-title`}>{props.t("backup.restorePageTitle")}</h1>
          <p>{props.t("backup.restorePageSubtitle")}</p>
        </header>
        <section className="settings-section" aria-labelledby={`${props.idPrefix}-preview-title`}>
          <h2 className="settings-section-title" id={`${props.idPrefix}-preview-title`}>{props.t("backup.restorePreview")}</h2>
          <div className="settings-card">{summary}</div>
        </section>
        <section className="settings-section" aria-labelledby={`${props.idPrefix}-identity-title`}>
          <h2 className="settings-section-title" id={`${props.idPrefix}-identity-title`}>{props.t("backup.identityMode")}</h2>
          {modeOptions}
          {feedback}
        </section>
        {actions}
      </section>
    );
  }

  return (
    <section className="restore-preview" aria-label={props.t("backup.restorePreview")}>
      <strong>{props.t("backup.restorePreview")}</strong>
      {summary}
      {modeOptions}
      {feedback}
      {actions}
    </section>
  );
}

function FirstRunPanel(props: FirstRunPanelProps): React.JSX.Element {
  const [step, setStep] = useState<FirstRunStep>("language");
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const stepRef = useRef<HTMLDivElement | null>(null);
  const restore = useRestoreFlow(props.onRestoreCompleted, () => props.onError(null));
  const showingRestore = Boolean(restore.restorePreview);
  const hasUsableDefaultModel = Boolean(
    props.modelSummary?.defaultModelProfileId &&
    props.modelSummary.models.some((model) =>
      model.id === props.modelSummary?.defaultModelProfileId && model.enabled
    )
  );

  const moveTo = (nextStep: FirstRunStep): void => {
    props.onError(null);
    setStep(nextStep);
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => stepRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const selectLocale = async (nextLocale: Locale): Promise<void> => {
    if (languageBusy || nextLocale === props.locale) return;
    setLanguageBusy(true);
    setLanguageError(false);
    try {
      await props.onLocaleChange(nextLocale);
    } catch {
      setLanguageError(true);
    } finally {
      setLanguageBusy(false);
    }
  };

  const retryAppearance = async (): Promise<void> => {
    if (languageBusy) return;
    setLanguageBusy(true);
    setLanguageError(false);
    try {
      if (!(await props.onRetryAppearance())) setLanguageError(true);
    } finally {
      setLanguageBusy(false);
    }
  };

  return (
    <section className="first-run" aria-label={props.t("firstRun.setupAria")}>
      <div className={`first-run-card step-${step}`}>
        <div className="first-run-brand">
          <img src={pigeMarkUrl} alt="" />
          <strong>Pige</strong>
        </div>

        {step === "language" ? (
          <div className="first-run-step language" ref={stepRef} tabIndex={-1}>
            <span className="first-run-progress">{props.t("firstRun.progressLanguage")}</span>
            <h1>{props.t("firstRun.welcomeTitle")}</h1>
            <p>{props.t("firstRun.welcomeSubtitle")}</p>
            {props.appearanceLoadState === "loading" ? (
              <div className="first-run-language-loading" role="status">
                <PigeIcon name="loading" size={16} />
                <span>{props.t("firstRun.languageLoading")}</span>
              </div>
            ) : (
              <label className="first-run-language" htmlFor="first-run-language">
                <span>{props.t("appearance.appLanguage")}</span>
                <select
                  id="first-run-language"
                  value={props.locale}
                  disabled={languageBusy}
                  aria-describedby="first-run-language-description"
                  onChange={(event) => void selectLocale(event.target.value as Locale)}
                >
                  {props.availableLocales.map((availableLocale) => (
                    <option key={availableLocale} value={availableLocale}>{localeLabels[availableLocale]}</option>
                  ))}
                </select>
                <small id="first-run-language-description">
                  {props.t(props.appearanceLoadState === "failed"
                    ? "firstRun.languageFallbackDescription"
                    : "firstRun.languageDescription")}
                </small>
              </label>
            )}
            {props.appearanceLoadState === "failed" || languageError ? (
              <div className="first-run-inline-error" role="alert">
                <span>{props.t("firstRun.languageLoadFailed")}</span>
                <button type="button" className="secondary" disabled={languageBusy} onClick={() => void retryAppearance()}>
                  {props.t("models.retry")}
                </button>
              </div>
            ) : null}
            <div className="first-run-local-note">
              <PigeIcon name="folder" size={18} />
              <span>
                <strong>{props.t("firstRun.localFirstTitle")}</strong>
                <small>{props.t("firstRun.localFirstDescription")}</small>
              </span>
            </div>
            <div className="first-run-actions">
              <button
                type="button"
                className="primary first-run-next"
                disabled={languageBusy || props.appearanceLoadState === "loading"}
                onClick={() => moveTo("models")}
              >
                {props.t("firstRun.continue")}
              </button>
            </div>
          </div>
        ) : step === "models" ? (
          <div className="first-run-step models" ref={stepRef} tabIndex={-1}>
            <span className="first-run-progress">{props.t("firstRun.progressModels")}</span>
            <div className="first-run-model-note" role="note">
              <strong>{props.t("firstRun.modelOptionalTitle")}</strong>
              <span>{props.t("firstRun.modelOptionalDescription")}</span>
            </div>
            <div className="first-run-model-panel">
              <ModelSettingsPanel
                busy={props.busy}
                modelSummary={props.modelSummary}
                onRefreshModels={props.onRefreshModels}
                onRefreshAgentRuntimeStatus={props.onRefreshAgentRuntimeStatus}
                onBusy={props.onBusy}
                t={props.t}
              />
            </div>
            <div className="first-run-actions split">
              <button type="button" className="secondary first-run-back" disabled={props.busy} onClick={() => moveTo("language")}>
                {props.t("firstRun.back")}
              </button>
              <button type="button" className="primary first-run-next" disabled={props.busy} onClick={() => moveTo("vault")}>
                {props.t(hasUsableDefaultModel ? "firstRun.continueWithModel" : "firstRun.skipModel")}
              </button>
            </div>
          </div>
        ) : !showingRestore ? (
          <div className="first-run-step vault" ref={stepRef} tabIndex={-1}>
            <span className="first-run-progress">{props.t("firstRun.progressVault")}</span>
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
            <RecentVaults
              recentVaults={props.recentVaults}
              onOpenRecent={props.onOpenRecent}
              onRemoveRecent={props.onRemoveRecent}
              openingVaultId={props.openingRecentVaultId}
              errorVaultId={props.recentVaultErrorId}
              disabled={props.busy}
              t={props.t}
            />
            <div className="first-run-actions">
              <button type="button" className="secondary first-run-back" disabled={props.busy} onClick={() => moveTo("models")}>
                {props.t("firstRun.back")}
              </button>
            </div>
          </div>
        ) : (
          <div className="first-run-step restore" ref={stepRef} tabIndex={-1}>
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
  readonly agentRuntimeStatus: AgentRuntimeStatus | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly recentJobs: readonly JobSummary[];
  readonly locale: Locale;
  readonly onReaderSelectionAction: (result: ReaderSelectionActionResult) => void;
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
  readonly onHomeStateChanged: () => Promise<void>;
  readonly onSetDefaultModel: (modelProfileId: string) => Promise<boolean>;
  readonly onVoiceAssetInstallActiveChange: (active: boolean) => void;
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
  const [agentModelUsage, setAgentModelUsage] = useState<HomeAgentModelUsage>("none");
  const [activeSourceTurn, setActiveSourceTurn] = useState<ActiveSourceTurnBinding | null>(null);
  const [conversationTimeline, setConversationTimeline] = useState<AgentConversationTimeline | undefined>();
  const [optimisticConversationTurns, setOptimisticConversationTurns] = useState<readonly OptimisticConversationTurn[]>([]);
  const [liveAnswerEventId, setLiveAnswerEventId] = useState<string | null>(null);
  const [conversationCopyState, setConversationCopyState] = useState<ConversationCopyState | null>(null);
  const [processingListExpanded, setProcessingListExpanded] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [modelSwitchFailed, setModelSwitchFailed] = useState(false);
  const [voiceState, setVoiceState] = useState<HomeVoicePanelState | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceElapsedMs, setVoiceElapsedMs] = useState<number | undefined>(undefined);
  const [voiceLevels, setVoiceLevels] = useState<readonly number[]>([]);
  const [voiceCanOpenSystemSettings, setVoiceCanOpenSystemSettings] = useState(false);
  const [voiceAssetInstallProgress, setVoiceAssetInstallProgress] = useState<number | undefined>(undefined);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationTimelineRef = useRef<HTMLElement | null>(null);
  const homeSectionRef = useRef<HTMLElement | null>(null);
  const processingPanelRef = useRef<HTMLElement | null>(null);
  const followConversationRef = useRef(true);
  const conversationCopySequenceRef = useRef(0);
  const conversationCopyResetTimerRef = useRef<number | undefined>(undefined);
  const composerSubmitInFlightRef = useRef(false);
  const composerCompositionActiveRef = useRef(false);
  const composerCompositionRaceRef = useRef(false);
  const composerCompositionTimerRef = useRef<number | undefined>(undefined);
  const draftRevisionRef = useRef(0);
  const noteOpenSequence = useRef(0);
  const inlineReferenceSequence = useRef(0);
  const selectedNoteRef = useRef<NoteRenderResult | null>(selectedNote);
  const modelSwitcherRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const modelOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const voiceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const voicePendingRequestIdRef = useRef<string | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const voiceEventSequenceRef = useRef(0);
  const voiceAssetPendingRequestIdRef = useRef<string | null>(null);
  const voiceAssetInstallationIdRef = useRef<string | null>(null);
  const voiceAssetEventSequenceRef = useRef(0);
  const voiceAssetBufferedEventsRef = useRef<SpeechAssetInstallEvent[]>([]);
  const voiceRequestSequenceRef = useRef(0);
  const voiceMeteringAvailableRef = useRef(false);
  const voiceLanguageTagRef = useRef(props.locale);
  const draftTextRef = useRef(text);
  const conversationLoadSequence = useRef(0);
  const locallyCompletedConversationTailRef = useRef<{
    readonly vaultId: string;
    readonly conversationId: string;
    readonly tailEventId: string;
  } | null>(null);
  const handledFileDropClientTurnIdRef = useRef<string | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(props.activeVault?.vaultId);
  const activeAgentDraftRef = useRef<ActiveAgentDraftBinding | null>(null);
  activeVaultIdRef.current = props.activeVault?.vaultId;
  selectedNoteRef.current = selectedNote;
  voiceLanguageTagRef.current = props.locale;
  draftTextRef.current = text;

  useEffect(() => () => {
    if (conversationCopyResetTimerRef.current !== undefined) {
      window.clearTimeout(conversationCopyResetTimerRef.current);
    }
  }, []);

  const copyConversationMessage = async (messageId: string, markdown: string): Promise<void> => {
    const sequence = conversationCopySequenceRef.current + 1;
    conversationCopySequenceRef.current = sequence;
    if (conversationCopyResetTimerRef.current !== undefined) {
      window.clearTimeout(conversationCopyResetTimerRef.current);
      conversationCopyResetTimerRef.current = undefined;
    }
    setConversationCopyState({ messageId, state: "copying" });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(markdown);
      if (sequence !== conversationCopySequenceRef.current) return;
      setConversationCopyState({ messageId, state: "copied" });
      conversationCopyResetTimerRef.current = window.setTimeout(() => {
        if (sequence === conversationCopySequenceRef.current) setConversationCopyState(null);
      }, 1_800);
    } catch {
      if (sequence !== conversationCopySequenceRef.current) return;
      setConversationCopyState({ messageId, state: "failed" });
    }
  };

  const conversationCopyAction = (messageId: string, markdown: string): React.JSX.Element => {
    const state = conversationCopyState?.messageId === messageId ? conversationCopyState.state : null;
    const label = state === "copied"
      ? props.t("home.messageCopied")
      : state === "failed"
        ? props.t("home.messageCopyFailed")
        : props.t("home.copyMessage");
    return (
      <div className="conversation-message-actions">
        <button
          type="button"
          data-conversation-action="copy"
          title={label}
          aria-label={label}
          aria-busy={state === "copying"}
          disabled={state === "copying"}
          onClick={() => void copyConversationMessage(messageId, markdown)}
        >
          <PigeIcon
            name={state === "copied" ? "check" : state === "copying" ? "loading" : "copy"}
            size={15}
            className={state === "copying" ? "spinning" : undefined}
          />
        </button>
        {state === "copied" || state === "failed" ? (
          <span className="visually-hidden" role="status" aria-live="polite">{label}</span>
        ) : null}
      </div>
    );
  };
  const agentStatusLabel = props.agentRuntimeStatus?.state === "ready" ? props.t("home.agentReady") : props.t("home.modelUnavailable");
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
  const homeModelSendAvailable = selectedHomeModelReady;
  const selectedHomeModelName = selectedHomeModel?.displayName ?? selectedHomeModel?.modelId ?? agentStatusLabel;
  const homeModelProviders = new Map(
    (props.modelSummary?.providers ?? []).map((provider) => [provider.id, provider.displayName] as const)
  );
  const speechAssetApi = window.pige.speech;

  const voiceAssetInstallActive = (): boolean =>
    voiceAssetPendingRequestIdRef.current !== null || voiceAssetInstallationIdRef.current !== null;

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

  const clearVoiceState = (restoreFocus: boolean): void => {
    voicePendingRequestIdRef.current = null;
    voiceSessionIdRef.current = null;
    voiceEventSequenceRef.current = 0;
    voiceAssetPendingRequestIdRef.current = null;
    voiceAssetInstallationIdRef.current = null;
    voiceAssetEventSequenceRef.current = 0;
    voiceAssetBufferedEventsRef.current = [];
    voiceMeteringAvailableRef.current = false;
    setVoiceState(null);
    setVoiceTranscript("");
    setVoiceElapsedMs(undefined);
    setVoiceLevels([]);
    setVoiceCanOpenSystemSettings(false);
    setVoiceAssetInstallProgress(undefined);
    if (restoreFocus) {
      window.requestAnimationFrame(() => voiceTriggerRef.current?.focus());
    }
  };

  const cancelVoice = (restoreFocus = true): void => {
    if (voiceAssetInstallActive()) return;
    voiceRequestSequenceRef.current += 1;
    const requestId = voicePendingRequestIdRef.current;
    const sessionId = voiceSessionIdRef.current;
    clearVoiceState(restoreFocus);
    if (sessionId) void window.pige.speech.cancel({ sessionId }).catch(() => undefined);
    else if (requestId) void window.pige.speech.cancel({ requestId }).catch(() => undefined);
  };

  const applyVoiceAssetInstallEvent = (event: SpeechAssetInstallEvent): void => {
    if (
      event.installationId !== voiceAssetInstallationIdRef.current ||
      event.sequence <= voiceAssetEventSequenceRef.current
    ) return;
    voiceAssetEventSequenceRef.current = event.sequence;
    if (event.kind === "progress") {
      setVoiceAssetInstallProgress(Math.round(event.completedFraction * 100));
      return;
    }
    voiceAssetInstallationIdRef.current = null;
    if (event.kind === "failed") {
      setVoiceAssetInstallProgress(undefined);
      setVoiceState("asset_install_failed");
      props.onVoiceAssetInstallActiveChange(false);
      return;
    }
    setVoiceAssetInstallProgress(100);
    const requestSequence = voiceRequestSequenceRef.current;
    const languageTag = voiceLanguageTagRef.current;
    void window.pige.speech.availability({ languageTag }).then((availability) => {
      if (
        voiceRequestSequenceRef.current !== requestSequence ||
        voiceLanguageTagRef.current !== languageTag
      ) return;
      if (availability.status === "supported" && availability.languageTag === languageTag) {
        setVoiceCanOpenSystemSettings(availability.canOpenSystemSettings);
        setVoiceState("asset_ready");
      } else {
        setVoiceAssetInstallProgress(undefined);
        setVoiceState("asset_install_failed");
      }
      props.onVoiceAssetInstallActiveChange(false);
    }).catch(() => {
      if (
        voiceRequestSequenceRef.current === requestSequence &&
        voiceLanguageTagRef.current === languageTag
      ) {
        setVoiceAssetInstallProgress(undefined);
        setVoiceState("asset_install_failed");
        props.onVoiceAssetInstallActiveChange(false);
      }
    });
  };

  const beginVoiceAssetInstall = async (): Promise<void> => {
    if (voiceAssetPendingRequestIdRef.current || voiceAssetInstallationIdRef.current) return;
    const requestSequence = voiceRequestSequenceRef.current + 1;
    voiceRequestSequenceRef.current = requestSequence;
    const requestId = createSpeechAssetRequestId();
    const languageTag = props.locale;
    voiceAssetPendingRequestIdRef.current = requestId;
    voiceAssetEventSequenceRef.current = 0;
    voiceAssetBufferedEventsRef.current = [];
    setVoiceAssetInstallProgress(undefined);
    setVoiceState("installing_asset");
    props.onVoiceAssetInstallActiveChange(true);
    try {
      const request: SpeechAssetInstallRequest = { requestId, languageTag };
      const result: SpeechAssetInstallResult = await speechAssetApi.installLanguageAsset(request);
      if (voiceAssetPendingRequestIdRef.current === requestId) {
        voiceAssetPendingRequestIdRef.current = null;
      }
      if (
        voiceRequestSequenceRef.current !== requestSequence ||
        voiceLanguageTagRef.current !== languageTag
      ) {
        return;
      }
      if (result.status === "blocked") {
        setVoiceState("asset_install_failed");
        props.onVoiceAssetInstallActiveChange(false);
        return;
      }
      voiceAssetInstallationIdRef.current = result.installationId;
      for (const event of voiceAssetBufferedEventsRef.current) applyVoiceAssetInstallEvent(event);
      voiceAssetBufferedEventsRef.current = [];
    } catch {
      if (
        voiceRequestSequenceRef.current === requestSequence &&
        voiceLanguageTagRef.current === languageTag
      ) {
        voiceAssetPendingRequestIdRef.current = null;
        setVoiceState("asset_install_failed");
        props.onVoiceAssetInstallActiveChange(false);
      }
    }
  };

  const beginVoice = async (): Promise<void> => {
    const requestSequence = voiceRequestSequenceRef.current + 1;
    voiceRequestSequenceRef.current = requestSequence;
    const previousSessionId = voiceSessionIdRef.current;
    if (previousSessionId) {
      voiceSessionIdRef.current = null;
      await window.pige.speech.cancel({ sessionId: previousSessionId }).catch(() => undefined);
      if (voiceRequestSequenceRef.current !== requestSequence) return;
    }
    setVoiceState("requesting_permission");
    setVoiceTranscript("");
    setVoiceElapsedMs(undefined);
    setVoiceLevels([]);
    setVoiceCanOpenSystemSettings(false);
    voiceEventSequenceRef.current = 0;
    voiceMeteringAvailableRef.current = false;
    try {
      const availability = await window.pige.speech.availability({ languageTag: props.locale });
      if (voiceRequestSequenceRef.current !== requestSequence) return;
      if (availability.status === "failed") {
        setVoiceState("failed");
        return;
      }
      if (availability.status === "unsupported") {
        setVoiceState(availability.reason === "assets_unavailable" ? "assets_unavailable" : "unsupported");
        return;
      }
      setVoiceCanOpenSystemSettings(availability.canOpenSystemSettings);
      const requestId = createSpeechRequestId();
      voicePendingRequestIdRef.current = requestId;
      const result = await window.pige.speech.start({
        requestId,
        languageTag: props.locale
      });
      if (voicePendingRequestIdRef.current === requestId) voicePendingRequestIdRef.current = null;
      if (voiceRequestSequenceRef.current !== requestSequence) {
        if (result.status === "started") {
          void window.pige.speech.cancel({ sessionId: result.sessionId }).catch(() => undefined);
        }
        return;
      }
      if (result.status === "blocked") {
        setVoiceState(voiceStateForError(result.error.code));
        setVoiceCanOpenSystemSettings(result.error.userAction === "open_settings");
        return;
      }
      voiceSessionIdRef.current = result.sessionId;
      voiceMeteringAvailableRef.current = result.metering === "available";
      setVoiceState("recording");
    } catch {
      if (voiceRequestSequenceRef.current === requestSequence) setVoiceState("failed");
    }
  };

  const useVoiceTranscript = (transcript: string): void => {
    const normalized = transcript.trim();
    if (!normalized) return;
    const currentDraft = draftTextRef.current;
    draftRevisionRef.current += 1;
    props.onDraftChange(joinVoiceTranscript(currentDraft, normalized));
    clearVoiceState(false);
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const stopVoice = async (useTranscriptAfterStop: boolean): Promise<void> => {
    const sessionId = voiceSessionIdRef.current;
    if (!sessionId) return;
    const requestSequence = voiceRequestSequenceRef.current;
    setVoiceState("transcribing");
    try {
      const result = await window.pige.speech.stop({ sessionId });
      if (
        voiceRequestSequenceRef.current !== requestSequence ||
        voiceSessionIdRef.current !== sessionId
      ) return;
      voiceSessionIdRef.current = null;
      voiceMeteringAvailableRef.current = false;
      setVoiceElapsedMs(undefined);
      setVoiceLevels([]);
      if (result.status !== "stopped") {
        setVoiceState("failed");
        return;
      }
      setVoiceTranscript(result.transcript);
      if (useTranscriptAfterStop && result.transcript.trim()) {
        useVoiceTranscript(result.transcript);
      } else {
        setVoiceState(result.transcript.trim() ? "ready" : "stopped");
      }
    } catch {
      if (
        voiceRequestSequenceRef.current === requestSequence &&
        voiceSessionIdRef.current === sessionId
      ) {
        voiceSessionIdRef.current = null;
        setVoiceState("failed");
      }
    }
  };

  useEffect(() => window.pige.speech?.onSessionEvent?.((event) => {
    if (
      event.sessionId !== voiceSessionIdRef.current ||
      event.sequence <= voiceEventSequenceRef.current
    ) return;
    voiceEventSequenceRef.current = event.sequence;
    if (event.kind === "transcript_replace") {
      setVoiceTranscript(event.transcript);
      return;
    }
    if (event.kind === "meter") {
      if (!voiceMeteringAvailableRef.current) return;
      setVoiceElapsedMs(event.elapsedMs);
      setVoiceLevels((current) => [...current.slice(-63), event.level]);
      return;
    }
    voiceSessionIdRef.current = null;
    voiceMeteringAvailableRef.current = false;
    setVoiceState("failed");
    setVoiceElapsedMs(undefined);
    setVoiceLevels([]);
  }) ?? (() => undefined), []);

  useEffect(() => speechAssetApi.onAssetInstallEvent((event) => {
    if (!voiceAssetInstallationIdRef.current && voiceAssetPendingRequestIdRef.current) {
      voiceAssetBufferedEventsRef.current.push(event);
      return;
    }
    applyVoiceAssetInstallEvent(event);
  }) ?? (() => undefined), []);

  useEffect(() => {
    clearVoiceState(false);
    return () => {
      voiceRequestSequenceRef.current += 1;
      const requestId = voicePendingRequestIdRef.current;
      const sessionId = voiceSessionIdRef.current;
      voicePendingRequestIdRef.current = null;
      voiceSessionIdRef.current = null;
      voiceAssetPendingRequestIdRef.current = null;
      voiceAssetInstallationIdRef.current = null;
      if (sessionId) void window.pige.speech.cancel({ sessionId }).catch(() => undefined);
      else if (requestId) void window.pige.speech.cancel({ requestId }).catch(() => undefined);
    };
  }, [props.activeVault?.vaultId, props.locale]);

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

  const latestTurn = conversationTimeline?.latestTurn;
  const visibleRecentJobs = props.recentJobs
    .filter((job) =>
      isActiveProcessingFileJob(job) &&
      !(
        job.class === "agent_turn" &&
        job.sourceId === undefined &&
        job.state === "waiting_dependency" &&
        job.stage === "waiting_for_model"
      )
    )
    .slice(0, 5);
  const proposalReviewPending = props.recentJobs.some((job) => job.state === "awaiting_review");
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
  const showConversationRunMessage = !sourceWaitOwnsAgentState &&
    agentAnswer === null &&
    effectiveAgentRunState !== "idle" &&
    effectiveAgentRunState !== "completed";
  const conversationMessageMarkdown = (
    message: AgentConversationTimeline["messages"][number]
  ): string => message.inputPresentation
    ? props.t(message.inputPresentation.kind === "reader_selection_action"
      ? `note.selection.${message.inputPresentation.action}`
      : `note.proposal.action.${message.inputPresentation.action}`)
    : message.text;
  const visibleConversationMessages = (conversationTimeline?.messages ?? []).filter((message) => {
    if (agentAnswer && message.role === "assistant" && message.id === liveAnswerEventId) return false;
    return message.answer?.datasetResult !== undefined || conversationMessageMarkdown(message).trim().length > 0;
  });
  const visibleOptimisticConversationTurns = optimisticConversationTurns.filter((turn) =>
    !(conversationTimeline?.messages.some((message) =>
      message.role === "user" && (
        (turn.conversationEventId !== undefined && message.id === turn.conversationEventId) ||
        (turn.jobId !== undefined && message.jobId === turn.jobId)
      )
    ) ?? false)
  );
  const liveConversationAnswer = agentAnswer && !agentAnswer.datasetResult && !agentAnswer.retrieval
    ? agentAnswer
    : null;
  const conversationFollowKey = [
    visibleConversationMessages.at(-1)?.id ?? "none",
    visibleOptimisticConversationTurns.at(-1)?.clientTurnId ?? "none",
    agentDraft?.sequence ?? 0,
    agentDraft?.text.length ?? 0,
    liveConversationAnswer?.answer.length ?? 0,
    effectiveAgentRunState
  ].join(":");

  useLayoutEffect(() => {
    const timeline = conversationTimelineRef.current;
    if (!timeline || !followConversationRef.current) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [conversationFollowKey]);

  useLayoutEffect(() => {
    const home = homeSectionRef.current;
    const panel = processingPanelRef.current;
    if (!home || !panel) {
      home?.style.removeProperty("--home-processing-panel-height");
      return;
    }
    const updateHeight = (): void => {
      home.style.setProperty(
        "--home-processing-panel-height",
        `${Math.ceil(panel.getBoundingClientRect().height)}px`
      );
    };
    updateHeight();
    if (typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver(updateHeight);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      home.style.removeProperty("--home-processing-panel-height");
    };
  }, [processingListExpanded, visibleRecentJobs.length]);

  useEffect(() => {
    const timeline = conversationTimelineRef.current;
    if (!timeline) return;
    const observer = new window.MutationObserver(() => {
      if (followConversationRef.current) timeline.scrollTop = timeline.scrollHeight;
    });
    observer.observe(timeline, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [visibleConversationMessages.length > 0 || visibleOptimisticConversationTurns.length > 0 || agentDraft !== null || showConversationRunMessage || liveConversationAnswer !== null]);
  const showHomeHero = visibleConversationMessages.length === 0 &&
    visibleOptimisticConversationTurns.length === 0 &&
    agentDraft === null &&
    agentAnswer === null &&
    selectedNote === null;
  const showConversationTimeline = visibleConversationMessages.length > 0 ||
    visibleOptimisticConversationTurns.length > 0 ||
    agentDraft !== null ||
    showConversationRunMessage ||
    liveConversationAnswer !== null;
  const conversationOwnsFlexibleSpace = showConversationTimeline &&
    selectedNote === null &&
    agentAnswer?.datasetResult === undefined &&
    agentAnswer?.retrieval === undefined;

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
        const localTail = locallyCompletedConversationTailRef.current;
        const acknowledgesLocalTail = !localTail || (
          localTail.vaultId === vaultId &&
          nextTimeline?.conversationId === localTail.conversationId &&
          (
            nextTimeline.tailEventId === localTail.tailEventId ||
            nextTimeline.messages.some((message) => message.id === localTail.tailEventId)
          )
        );
        if (acknowledgesLocalTail) {
          locallyCompletedConversationTailRef.current = null;
          setConversationTimeline(nextTimeline);
        }
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
    setOptimisticConversationTurns((current) => current.map((turn) =>
      turn.clientTurnId === event.clientTurnId
        ? { ...turn, conversationEventId: event.conversationEventId, jobId: event.jobId }
        : turn
    ));
    setAgentDraft(event);
  }), []);

  useEffect(() => () => {
    if (composerCompositionTimerRef.current !== undefined) {
      window.clearTimeout(composerCompositionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    conversationLoadSequence.current += 1;
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteLoadingPageId(null);
    setConversationTimeline(undefined);
    locallyCompletedConversationTailRef.current = null;
    setOptimisticConversationTurns([]);
    setLiveAnswerEventId(null);
    setAgentAnswer(null);
    clearAgentDraft();
    setAgentError(null);
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
    setAgentRunState("idle");
    if (props.activeVault?.vaultId) void refreshConversation();
    return () => {
      conversationLoadSequence.current += 1;
    };
  }, [props.activeVault?.vaultId]);

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
    if (
      latestTurn.state !== "queued" &&
      latestTurn.state !== "running" &&
      !composerSubmitInFlightRef.current
    ) {
      clearAgentDraft();
    }
  }, [
    agentRunState,
    latestTurn?.jobId,
    latestTurn?.state,
    latestTurn?.error?.code
  ]);

  useEffect(() => {
    if (!props.activeVault?.vaultId || !isConversationPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshConversation(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.activeVault?.vaultId, latestTurn?.jobId, latestTurn?.state]);

  const submitHomeInput = async (): Promise<void> => {
    if (!text.trim() || !homeModelSendAvailable || modelSwitching || composerSubmitInFlightRef.current) return;
    followConversationRef.current = true;
    composerSubmitInFlightRef.current = true;
    setCaptureError(null);
    setAgentError(null);
    setAgentRunState("idle");
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    const turnText = text.trim();
    const submittedVaultId = activeVaultIdRef.current;
    const submittedDraftRevision = draftRevisionRef.current;
    const clearedDraftRevision = submittedDraftRevision + 1;
    const clientTurnId = createAgentClientTurnId();
    draftRevisionRef.current = clearedDraftRevision;
    props.onDraftChange("");
    setOptimisticConversationTurns((current) => [...current, { clientTurnId, text: turnText }]);
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
      const durableUserTurnExists = outcome.state !== "failed" || Boolean(outcome.conversationEventId);
      if (durableUserTurnExists) {
        setOptimisticConversationTurns((current) => current.map((turn) =>
          turn.clientTurnId === clientTurnId
            ? {
                ...turn,
                ...(outcome.conversationEventId ? { conversationEventId: outcome.conversationEventId } : {}),
                ...(outcome.jobId ? { jobId: outcome.jobId } : {})
              }
            : turn
        ));
      } else {
        setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
      }
      if (!durableUserTurnExists && draftRevisionRef.current === clearedDraftRevision) {
        draftRevisionRef.current += 1;
        props.onDraftChange(turnText);
      }
      if (outcome.state === "completed") {
        const completedAt = new Date().toISOString();
        const completedVaultId = activeVaultIdRef.current;
        if (completedVaultId && completedVaultId === submittedVaultId) {
          locallyCompletedConversationTailRef.current = {
            vaultId: completedVaultId,
            conversationId: outcome.conversationId,
            tailEventId: outcome.tailEventId
          };
          setConversationTimeline((current) => {
            const currentMessages = current?.conversationId === outcome.conversationId
              ? current.messages
              : [];
            return {
              conversationId: outcome.conversationId,
              tailEventId: outcome.tailEventId,
              canFollowUp: true,
              messages: [
                ...currentMessages.filter((message) =>
                  message.id !== outcome.conversationEventId && message.id !== outcome.tailEventId
                ),
                {
                  id: outcome.conversationEventId,
                  role: "user",
                  createdAt: completedAt,
                  text: turnText,
                  jobId: outcome.jobId
                },
                {
                  id: outcome.tailEventId,
                  role: "assistant",
                  createdAt: completedAt,
                  text: outcome.answer.answer,
                  jobId: outcome.jobId,
                  answer: outcome.answer
                }
              ],
              latestTurn: {
                jobId: outcome.jobId,
                userEventId: outcome.conversationEventId,
                state: "completed"
              }
            };
          });
        }
        clearAgentDraft();
        setAgentAnswer(outcome.answer);
        setLiveAnswerEventId(outcome.tailEventId);
        setAgentModelUsage(outcome.modelUsage);
        setAgentRunState("completed");
        void refreshConversation();
        return;
      }
      clearAgentDraft();
      setAgentModelUsage(outcome.modelUsage);
      setAgentError(outcome.error);
      setAgentRunState(outcome.state);
      void refreshConversation();
    } catch {
      const activeDraft = activeAgentDraftRef.current;
      const durableConversationEventId = activeDraft?.clientTurnId === clientTurnId
        ? activeDraft.conversationEventId
        : undefined;
      const durableJobId = activeDraft?.clientTurnId === clientTurnId
        ? activeDraft.jobId
        : undefined;
      const durableUserTurnExists = durableConversationEventId !== undefined;
      clearAgentDraft();
      if (durableUserTurnExists) {
        setOptimisticConversationTurns((current) => current.map((turn) =>
          turn.clientTurnId === clientTurnId
            ? {
                ...turn,
                conversationEventId: durableConversationEventId,
                ...(durableJobId ? { jobId: durableJobId } : {})
              }
            : turn
        ));
      } else {
        setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
        if (draftRevisionRef.current === clearedDraftRevision) {
          draftRevisionRef.current += 1;
          props.onDraftChange(turnText);
        }
      }
      setAgentError({
        code: "model_provider.call_failed",
        domain: "model_provider",
        messageKey: "errors.model_provider.call_failed",
        retryable: true,
        severity: "error",
        userAction: "retry"
      });
      setAgentRunState("failed");
      void refreshConversation();
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

  const openResultTarget = async (pageId: string, reportError = true): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    inlineReferenceSequence.current += 1;
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setCaptureError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (
        requestId !== noteOpenSequence.current ||
        activeVaultIdRef.current !== vaultId ||
        note.summary.pageId !== pageId
      ) return false;
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
      return true;
    } catch {
      if (requestId !== noteOpenSequence.current) return false;
      if (reportError) setCaptureError(props.t("error.generic"));
      return false;
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  const openResult = async (pageId: string): Promise<void> => {
    await openResultTarget(pageId);
  };

  const activateInlineReference = async (href: string): Promise<ReaderInlineReferenceActivation> => {
    const vaultId = activeVaultIdRef.current;
    const note = selectedNoteRef.current;
    const renderContextId = note?.renderContextId;
    if (!vaultId || !note || !renderContextId) return "failed";
    const pageId = note.summary.pageId;
    const sequence = inlineReferenceSequence.current + 1;
    inlineReferenceSequence.current = sequence;
    const request: NoteResolveInlineReferenceRequest = {
      apiVersion: 1,
      requestId: createNoteReferenceRequestId(),
      activeVaultId: vaultId,
      currentPageId: pageId,
      renderContextId,
      href
    };
    return resolveAndOpenInlineReference(
      request,
      () => (
        inlineReferenceSequence.current === sequence &&
        activeVaultIdRef.current === vaultId &&
        selectedNoteRef.current?.summary.pageId === pageId &&
        selectedNoteRef.current?.renderContextId === renderContextId
      ),
      (targetPageId) => openResultTarget(targetPageId, false)
    );
  };

  return (
    <section
      ref={homeSectionRef}
      className={`home${showHomeHero ? " home-empty" : " home-active"}${conversationOwnsFlexibleSpace ? " home-conversation-active" : ""}`}
      aria-label={props.t("nav.home")}
    >
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
              {props.t("home.notNow")}
            </button>
          </div>
        </section>
      ) : null}
      {visibleRecentJobs.length > 0 ? (
        <section
          ref={processingPanelRef}
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
      {proposalReviewPending ? (
        <section className="proposal-strip" aria-label={props.t("proposal.queueTitle")}>
          <header className="proposal-strip-header">
            <h2>{props.t("proposal.queueTitle")}</h2>
          </header>
          <div className="proposal-summary-list">
            <article className="proposal-summary-card">
              <div>
                <strong>{props.t("proposal.safePreviewTitle")}</strong>
                <p id="proposal-safe-preview-description">{props.t("proposal.safePreviewDescription")}</p>
              </div>
              <button
                type="button"
                className="secondary"
                aria-describedby="proposal-safe-preview-description"
                disabled
              >
                {props.t("proposal.reviewUnavailable")}
              </button>
            </article>
          </div>
        </section>
      ) : null}
      {showConversationTimeline ? (
        <section
          ref={conversationTimelineRef}
          className="conversation-timeline"
          aria-label={props.t("home.conversation")}
          aria-busy={agentDraft !== null || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running"}
          onScroll={(event) => {
            const timeline = event.currentTarget;
            followConversationRef.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
          }}
        >
          {visibleConversationMessages.map((message) => {
            const markdown = conversationMessageMarkdown(message);
            return (
              <article
                className={`conversation-message role-${message.role}`}
                data-message-id={message.id}
                data-input-presentation={message.inputPresentation?.kind}
                key={message.id}
              >
                <span className="conversation-message-role visually-hidden">
                  {props.t(message.role === "user" ? "home.userMessage" : "home.assistantMessage")}
                </span>
                {message.answer?.datasetResult ? (
                  <DatasetAnswerResult answer={message.answer} modelUsage="none" t={props.t} />
                ) : (
                  <>
                    <ConversationMarkdown markdown={markdown} t={props.t} />
                    <ConversationCitations
                      answer={message.answer}
                      noteLoadingPageId={noteLoadingPageId}
                      onOpen={openResult}
                      t={props.t}
                    />
                  </>
                )}
                {message.role === "assistant" ? conversationCopyAction(message.id, markdown) : null}
              </article>
            );
          })}
          {visibleOptimisticConversationTurns.map((turn) => (
            <article
              className="conversation-message role-user optimistic"
              data-optimistic-user-message="true"
              data-client-turn-id={turn.clientTurnId}
              key={turn.clientTurnId}
            >
              <span className="conversation-message-role visually-hidden">{props.t("home.userMessage")}</span>
              <ConversationMarkdown markdown={turn.text} t={props.t} />
            </article>
          ))}
          {agentDraft ? (
            <article
              className="conversation-message role-assistant provisional"
              data-agent-draft="true"
              data-draft-sequence={agentDraft.sequence}
            >
              <span className="conversation-message-role visually-hidden">
                {props.t("home.assistantMessage")}
              </span>
              <ConversationMarkdown markdown={agentDraft.text} provisional t={props.t} />
            </article>
          ) : showConversationRunMessage ? (
            <article
              className={`conversation-message role-assistant conversation-status-message state-${effectiveAgentRunState}`}
              data-agent-conversation-state={effectiveAgentRunState}
              role="status"
              aria-live="polite"
            >
              <span className="conversation-message-role visually-hidden">{props.t("home.assistantMessage")}</span>
              <div className="conversation-status-content">
                {effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running" ? (
                  <>
                    <span className="conversation-loading-dots" aria-hidden="true"><i /><i /><i /></span>
                    <span className="visually-hidden">{props.t("home.agentState.running")}</span>
                  </>
                ) : (
                  <p>
                    {effectiveAgentError
                      ? props.t(effectiveAgentError.messageKey)
                      : noSourceCurrentTurn
                        ? props.t(jobStateMessageKey(noSourceCurrentTurn))
                        : props.t(`home.agentState.${effectiveAgentRunState}`)}
                  </p>
                )}
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
            </article>
          ) : liveConversationAnswer ? (
            <article
              className="conversation-message role-assistant"
              data-live-agent-answer="true"
              aria-live="polite"
            >
              <span className="conversation-message-role visually-hidden">
                {props.t("home.assistantMessage")}
              </span>
              <ConversationMarkdown markdown={liveConversationAnswer.answer} t={props.t} />
              <ConversationCitations
                answer={liveConversationAnswer}
                noteLoadingPageId={noteLoadingPageId}
                onOpen={openResult}
                t={props.t}
              />
              {conversationCopyAction(
                liveAnswerEventId ?? "live-conversation-answer",
                liveConversationAnswer.answer
              )}
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
              inlineReferenceSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
          >
            {props.t("retrieval.backToResults")}
          </button>
          <NoteReader
            note={selectedNote}
            {...(props.activeVault && selectedNote.renderContextId ? {
              activeVaultId: props.activeVault.vaultId,
              onResolveSelection: resolveReaderSelection,
              onSubmitSelectionAction: submitReaderSelectionAction
            } : {})}
            locale={props.locale}
            onSelectionActionResult={props.onReaderSelectionAction}
            related={selectedNoteRelated}
            relatedLoadingPageId={noteLoadingPageId}
            onOpenRelated={openResult}
            {...(selectedNote.renderContextId ? { onActivateInlineReference: activateInlineReference } : {})}
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
      ) : null}
      <section className="composer">
        {voiceState ? (
          <HomeVoicePanel
            state={voiceState}
            transcript={voiceTranscript}
            levels={voiceLevels}
            {...(voiceAssetInstallProgress === undefined ? {} : { assetInstallProgress: voiceAssetInstallProgress })}
            onDismiss={() => cancelVoice(true)}
            {...(voiceElapsedMs === undefined ? {} : { elapsedMs: voiceElapsedMs })}
            {...(voiceState === "stopped" || voiceState === "ready"
              ? { onTranscriptChange: setVoiceTranscript }
              : {})}
            {...(voiceState === "recording" ? { onStop: () => void stopVoice(false) } : {})}
            {...(voiceState === "recording"
              ? { onComplete: () => void stopVoice(true) }
              : voiceState === "stopped" || voiceState === "ready"
                ? { onComplete: () => useVoiceTranscript(voiceTranscript) }
                : {})}
            {...(voiceState === "failed" ? { onRetry: () => void beginVoice() } : {})}
            {...(voiceState === "assets_unavailable" || voiceState === "asset_install_failed"
              ? { onInstallLanguageAsset: () => void beginVoiceAssetInstall() }
              : {})}
            {...(voiceState === "asset_ready" ? { onStartAfterAssetInstall: () => void beginVoice() } : {})}
            {...(voiceCanOpenSystemSettings
              ? { onOpenSystemSettings: () => void window.pige.speech.openSystemSettings() }
              : {})}
            t={props.t}
          />
        ) : (
          <>
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
          <button
            ref={voiceTriggerRef}
            className="round-button"
            type="button"
            title={props.t("home.voice.start")}
            aria-label={props.t("home.voice.start")}
            onClick={() => void beginVoice()}
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
            title={!homeModelSendAvailable ? props.t("home.modelUnavailable") : undefined}
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
          </>
        )}
        <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
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
    state === "awaiting_review"
  ) return "waiting";
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
    timeline.latestTurn === undefined ||
    timeline.latestTurn.state === "completed" ||
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

function createNoteReferenceRequestId(): string {
  return `noteref_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

async function resolveAndOpenInlineReference(
  request: NoteResolveInlineReferenceRequest,
  isCurrent: () => boolean,
  openPage: (pageId: string) => Promise<boolean>
): Promise<ReaderInlineReferenceActivation> {
  try {
    const result = await window.pige.notes.resolveInlineReference(request);
    if (!isCurrent()) return "stale";
    if (result.requestId !== request.requestId) return "failed";
    if (result.status !== "resolved") return result.status;
    if (!await openPage(result.target.pageId)) return "failed";
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".note-reader")?.focus({ preventScroll: true });
    });
    return result.target.kind === "source" ? "opened_source" : "opened_page";
  } catch {
    return isCurrent() ? "failed" : "stale";
  }
}

function createSpeechRequestId(): string {
  return `speechreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createSpeechAssetRequestId(): string {
  return `speechasset_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function voiceStateForError(code: string): HomeVoicePanelState {
  if (code === "speech.permission_denied" || code === "speech.permission_restricted") {
    return "permission_denied";
  }
  if (code === "speech.assets_unavailable") return "assets_unavailable";
  if (code === "speech.unsupported_platform" || code === "speech.unsupported_os_version") {
    return "unsupported";
  }
  return "failed";
}

function joinVoiceTranscript(draft: string, transcript: string): string {
  if (!draft || /\s$/u.test(draft) || /^\s/u.test(transcript)) return `${draft}${transcript}`;
  const leftCharacters = Array.from(draft);
  const rightCharacters = Array.from(transcript);
  const left = leftCharacters.at(-1) ?? "";
  const right = rightCharacters[0] ?? "";
  const compactScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const punctuationOrSeparator = /[\p{P}\p{Z}]/u;
  const opensWithoutSpace = /[\p{Ps}\p{Pi}]/u;
  const closesWithoutSpace = /[\p{Pe}\p{Pf}\p{Po}]/u;
  const leftContent = leftCharacters.findLast((character) => !punctuationOrSeparator.test(character)) ?? left;
  const rightContent = rightCharacters.find((character) => !punctuationOrSeparator.test(character)) ?? right;
  const compactBoundary =
    (compactScript.test(leftContent) && compactScript.test(rightContent)) ||
    opensWithoutSpace.test(left) ||
    closesWithoutSpace.test(right);
  return compactBoundary
    ? `${draft}${transcript}`
    : `${draft} ${transcript}`;
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

function ConversationCitations(props: {
  readonly answer: AgentTurnAnswer | undefined;
  readonly noteLoadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const citations = props.answer?.citations.filter(
    (citation): citation is RetrievalAnswerCitation => !("kind" in citation)
  ) ?? [];
  if (citations.length === 0) return null;
  return (
    <div className="citation-list conversation-citations" aria-label={props.t("retrieval.citations")}>
      {citations.map((citation) => (
        <button
          type="button"
          className="citation-row"
          key={citation.refId}
          disabled={props.noteLoadingPageId === citation.pageId}
          onClick={() => void props.onOpen(citation.pageId)}
        >
          <span className="citation-index" aria-hidden="true">{citation.label}</span>
          <span className="citation-copy">
            <strong>{citation.title}</strong>
            <span>{props.t(`library.type.${citation.pageType}`)}</span>
          </span>
          <PigeIcon name="expand" size={13} />
        </button>
      ))}
    </div>
  );
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
  if (job.state === "waiting_dependency") {
    return "backup.waitingManagedSourceReconnect";
  }
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
  { id: "general", icon: "settings", status: "partial" },
  { id: "appearance", icon: "palette", status: "partial" },
  { id: "vault", icon: "folder", status: "real" },
  { id: "maintenance", icon: "database", status: "real" },
  { id: "models", icon: "model", status: "real" },
  { id: "capabilities", icon: "wrench", status: "partial" },
  { id: "memory", icon: "memory", status: "development" },
  { id: "privacy", icon: "shield", status: "partial" },
  { id: "skills", icon: "skill", status: "partial" },
  { id: "packages", icon: "package", status: "development", capability: "packages" },
  { id: "history", icon: "activity", status: "real" },
  { id: "updates", icon: "package", status: "partial" },
  { id: "diagnostics", icon: "wrench", status: "real" }
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
  { id: "system", sections: ["history", "updates", "diagnostics"] }
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
  readonly backgroundInert?: boolean;
  readonly macosWindowShell?: boolean;
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
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const compactNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const compactSettings = useMediaQuery("(max-width: 520px)");
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const sectionMatches = (section: SettingsSection): boolean =>
    normalizedQuery.length === 0 || props.t(`settings.section.${section}`).toLocaleLowerCase().includes(normalizedQuery);
  const matchingSectionCount = settingsSections.filter((item) => sectionMatches(item.id)).length;

  useEffect(() => {
    if (compactSettings) compactNavigationButtonRef.current?.focus();
    else closeButtonRef.current?.focus();
  }, [compactSettings]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [props.section]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (compactSettings && compactNavigationOpen) {
        setCompactNavigationOpen(false);
        window.requestAnimationFrame(() => compactNavigationButtonRef.current?.focus());
        return;
      }
      props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) =>
      !element.hidden &&
      element.tabIndex >= 0 &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.closest('[inert], [aria-hidden="true"]') === null
    );
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
    <div
      className={`settings-overlay${props.macosWindowShell ? " platform-macos" : ""}`}
      data-settings-overlay="true"
      inert={props.backgroundInert}
    >
      <div
        ref={dialogRef}
        className="settings-surface"
        data-compact-navigation-open={compactSettings && compactNavigationOpen ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-surface-title"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="settings-surface-body">
          <aside
            className="settings-sidebar"
            aria-label={props.t("settings.navigation")}
            aria-hidden={compactSettings && !compactNavigationOpen ? "true" : undefined}
            inert={compactSettings && !compactNavigationOpen}
          >
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
                            if (compactSettings) {
                              setCompactNavigationOpen(false);
                              window.requestAnimationFrame(() => compactNavigationButtonRef.current?.focus());
                            }
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
          {compactSettings && compactNavigationOpen ? (
            <button
              type="button"
              className="settings-compact-backdrop"
              tabIndex={-1}
              aria-label={props.t("settings.navigation")}
              onClick={() => {
                setCompactNavigationOpen(false);
                window.requestAnimationFrame(() => compactNavigationButtonRef.current?.focus());
              }}
            />
          ) : null}
          <div ref={contentRef} className="settings-content" inert={compactSettings && compactNavigationOpen}>
            <h1 id="settings-surface-title" className="visually-hidden">{props.t("settings.title")}</h1>
            <header className="settings-compact-header">
              <button
                ref={compactNavigationButtonRef}
                type="button"
                className="icon-button"
                aria-label={props.t("settings.navigation")}
                aria-expanded={compactNavigationOpen}
                onClick={() => {
                  setCompactNavigationOpen(true);
                  window.requestAnimationFrame(() => closeButtonRef.current?.focus());
                }}
              >
                <PigeIcon name="panel" size={17} />
              </button>
              <strong>{props.t(`settings.section.${props.section}`)}</strong>
            </header>
            <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GeneralSettingsPanel(props: {
  readonly alwaysOnTop: boolean;
  readonly onAlwaysOnTopChange: () => Promise<void>;
  readonly onOpenAppearance: () => void;
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page settings-general" aria-labelledby="settings-general-title">
      <header className="settings-panel-header">
        <h1 id="settings-general-title">{props.t("settings.general.title")}</h1>
        <p>{props.t("settings.general.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="settings-general-window-title">
        <h2 className="settings-section-title" id="settings-general-window-title">
          {props.t("settings.general.windowSection")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.startupTitle")}</strong>
              <span id="settings-general-startup-description">{props.t("settings.general.startupDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              aria-describedby="settings-general-startup-description"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.defaultWindowTitle")}</strong>
              <span>{props.t("settings.general.defaultWindowDescription")}</span>
            </div>
            <span className="settings-status">{props.t("settings.general.adaptive")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.rememberWindowTitle")}</strong>
              <span>{props.t("settings.general.rememberWindowDescription")}</span>
            </div>
            <span className="settings-status">{props.t("settings.general.automatic")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.alwaysOnTop")}</strong>
              <span id="settings-general-always-on-top-description">
                {props.t("settings.general.alwaysOnTopDescription")}
              </span>
            </div>
            <button
              type="button"
              className="settings-switch"
              role="switch"
              aria-label={props.t("settings.general.alwaysOnTop")}
              aria-describedby="settings-general-always-on-top-description"
              aria-checked={props.alwaysOnTop}
              onClick={() => void props.onAlwaysOnTopChange()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.sidebarOnLaunchTitle")}</strong>
              <span id="settings-general-sidebar-on-launch-description">
                {props.t("settings.general.sidebarOnLaunchDescription")}
              </span>
            </div>
            <span className="settings-status">{props.t("settings.general.lastState")}</span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-general-pige-title">
        <h2 className="settings-section-title" id="settings-general-pige-title">
          {props.t("settings.general.pigeSection")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.productTitle")}</strong>
              <span>{props.t("settings.general.productDescription")}</span>
            </div>
            <span className="settings-badge">{props.t("settings.general.preAlpha")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.appearanceTitle")}</strong>
              <span>{props.t("settings.general.appearanceDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={props.onOpenAppearance}>
              {props.t("settings.general.openAppearance")}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

export function AppearanceSettingsPanel(props: {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const themeChoices = ["system", "light", "dark"] as const;

  const moveThemeFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = themeChoices.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % themeChoices.length;
    else nextIndex = (index - 1 + themeChoices.length) % themeChoices.length;
    themeOptionRefs.current[nextIndex]?.focus();
    props.onDevelopment();
  };

  return (
    <section className="settings-page appearance-settings-page" aria-labelledby="settings-appearance-title">
      <header className="settings-panel-header">
        <h1 id="settings-appearance-title">{props.t("appearance.title")}</h1>
        <p>{props.t("appearance.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="appearance-theme-title">
        <h2 className="settings-section-title" id="appearance-theme-title">{props.t("appearance.theme")}</h2>
        <div className="theme-grid" role="radiogroup" aria-labelledby="appearance-theme-title" aria-describedby="appearance-partial-note">
          {themeChoices.map((choice, index) => (
            <button
              key={choice}
              ref={(element) => { themeOptionRefs.current[index] = element; }}
              className="theme-option"
              type="button"
              role="radio"
              aria-checked={false}
              tabIndex={index === 0 ? 0 : -1}
              onClick={props.onDevelopment}
              onKeyDown={(event) => moveThemeFocus(event, index)}
            >
              <span className={`theme-preview ${choice}`} aria-hidden="true" />
              <span>{props.t(`appearance.theme.${choice}`)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="appearance-language-title">
        <h2 className="settings-section-title" id="appearance-language-title">{props.t("appearance.language")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("appearance.appLanguage")}</strong>
              <span>{props.t("appearance.appLanguageDescription")}</span>
            </div>
            <select
              className="settings-select"
              value={props.locale}
              aria-label={props.t("appearance.appLanguage")}
              onChange={(event) => void props.onLocaleChange(event.target.value as Locale)}
            >
              {props.availableLocales.map((availableLocale) => (
                <option key={availableLocale} value={availableLocale}>{localeLabels[availableLocale]}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("appearance.knowledgeLanguage")}</strong>
              <span id="appearance-knowledge-language-description">{props.t("appearance.knowledgeLanguageDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-appearance-control="knowledge-language"
              aria-label={`${props.t("appearance.knowledgeLanguage")}: ${props.t("settings.status.development")}`}
              aria-describedby="appearance-knowledge-language-description appearance-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("appearance.ocrLanguage")}</strong>
              <span id="appearance-ocr-language-description">{props.t("appearance.ocrLanguageDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-appearance-control="ocr-language"
              aria-label={`${props.t("appearance.ocrLanguage")}: ${props.t("settings.status.development")}`}
              aria-describedby="appearance-ocr-language-description appearance-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
        </div>
      </section>

      <p className="settings-note" id="appearance-partial-note">{props.t("appearance.partialNote")}</p>
    </section>
  );
}

export function PermissionsPrivacySettingsPanel(props: {
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page privacy-settings-page" aria-labelledby="settings-privacy-title">
      <header className="settings-panel-header">
        <h1 id="settings-privacy-title">{props.t("privacy.title")}</h1>
        <p>{props.t("privacy.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="privacy-model-boundary-title">
        <h2 className="settings-section-title" id="privacy-model-boundary-title">
          {props.t("privacy.modelBoundary")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.ordinaryTitle")}</strong>
              <span>{props.t("privacy.ordinaryDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.connectedDefault")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.cloudPolicyTitle")}</strong>
              <span id="privacy-cloud-policy-description">{props.t("privacy.cloudPolicyDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-privacy-control="cloud-policy"
              aria-label={props.t("privacy.cloudPolicyTitle")}
              aria-describedby="privacy-cloud-policy-description privacy-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="privacy-high-risk-title">
        <h2 className="settings-section-title" id="privacy-high-risk-title">
          {props.t("privacy.highRiskTitle")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.highRiskEffectsTitle")}</strong>
              <span>{props.t("privacy.highRiskEffectsDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.confirmEachEffect")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.noSavedAuthorityTitle")}</strong>
              <span>{props.t("privacy.noSavedAuthorityDescription")}</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.redactionTitle")}</strong>
              <span>{props.t("privacy.redactionDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.protected")}</span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="privacy-api-keys-title">
        <h2 className="settings-section-title" id="privacy-api-keys-title">
          {props.t("privacy.apiKeys")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.apiKeyStorageTitle")}</strong>
              <span>{props.t("privacy.apiKeyStorageDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.protected")}</span>
          </div>
        </div>
      </section>

      <p className="settings-note" id="privacy-partial-note">{props.t("privacy.partialNote")}</p>
    </section>
  );
}

export function LocalCapabilitiesSettingsPanel(props: {
  readonly toolchainHealth: ToolchainHealth | null;
  readonly speechAvailability: SpeechAvailabilityResult | null;
  readonly speechAvailabilityLoading: boolean;
  readonly speechAvailabilityFailed: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenSpeechSettings: () => Promise<void>;
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const missingRequiredTools =
    props.toolchainHealth?.tools.filter((tool) => tool.required && tool.status === "missing") ?? [];
  const toolchainState = props.toolchainHealth?.status ?? "checking";
  const speechCapabilityState = props.speechAvailabilityLoading
    ? "checking"
    : props.speechAvailabilityFailed || props.speechAvailability?.status === "failed"
      ? "failed"
      : props.speechAvailability?.status === "supported"
        ? props.speechAvailability.permission === "denied" || props.speechAvailability.permission === "restricted"
          ? "permission_needed"
          : "available"
        : props.speechAvailability?.status === "unsupported"
          ? props.speechAvailability.reason === "assets_unavailable"
            ? "asset_needed"
            : "unavailable"
          : "checking";
  const speechSettingsAvailable = props.speechAvailability?.status === "supported" &&
    props.speechAvailability.canOpenSystemSettings &&
    (props.speechAvailability.permission === "denied" || props.speechAvailability.permission === "restricted");

  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await props.onRefresh();
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="settings-page capabilities-settings-page" aria-labelledby="settings-capabilities-title">
      <header className="settings-panel-header">
        <h1 id="settings-capabilities-title">{props.t("capabilities.title")}</h1>
        <p>{props.t("capabilities.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="capabilities-toolchain-title">
        <h2 className="settings-section-title" id="capabilities-toolchain-title">
          {props.t("capabilities.coreTools")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.toolchainTitle")}</strong>
              <span>{props.t("capabilities.toolchainDescription")}</span>
            </div>
            <span className={`settings-status ${toolchainState === "needs_repair" ? "warning" : ""}`}>
              {props.t(`capabilities.toolchain.${toolchainState}`)}
            </span>
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.detectedTools")}</strong>
              {props.toolchainHealth ? (
                <ul className="capability-tool-list" aria-label={props.t("capabilities.detectedTools")}>
                  {props.toolchainHealth.tools.map((tool) => {
                    const statusKey =
                      tool.status === "ready"
                        ? "capabilities.tool.ready"
                        : tool.required
                          ? "capabilities.tool.missing"
                          : "capabilities.tool.optional_missing";
                    const statusLabel = props.t(statusKey);
                    return (
                      <li
                        key={tool.id}
                        aria-label={`${tool.name}: ${statusLabel}`}
                        data-tool-required={tool.required ? "true" : "false"}
                        data-tool-status={tool.status}
                      >
                        <span>{tool.name}</span>
                        <small
                          className={
                            tool.status === "ready" ? "ready" : tool.required ? "missing" : "optional-missing"
                          }
                        >
                          {statusLabel}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span>{props.t("capabilities.checkingDescription")}</span>
              )}
            </div>
            <button
              className="settings-button"
              type="button"
              disabled={refreshing}
              aria-describedby="capabilities-refresh-status"
              onClick={() => void refresh()}
            >
              {props.t(refreshing ? "capabilities.checking" : "capabilities.checkAgain")}
            </button>
          </div>
          {missingRequiredTools.length > 0 ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("capabilities.repairTitle")}</strong>
                <span>{props.t("capabilities.repairDescription")}</span>
              </div>
              <button className="settings-button" type="button" onClick={props.onDevelopment}>
                {props.t("capabilities.repair")}
              </button>
            </div>
          ) : null}
        </div>
        <p
          className={refreshFailed ? "settings-inline-status error" : "settings-inline-status"}
          id="capabilities-refresh-status"
          role={refreshFailed ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {refreshFailed ? props.t("capabilities.refreshFailed") : ""}
        </p>
      </section>

      <section className="settings-section" aria-labelledby="capabilities-retrieval-title">
        <h2 className="settings-section-title" id="capabilities-retrieval-title">
          {props.t("capabilities.localRetrieval")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.embeddingTitle")}</strong>
              <span>{props.t("capabilities.embeddingDescription")}</span>
            </div>
            <span className="settings-status neutral">{props.t("capabilities.notReported")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.rerankerTitle")}</strong>
              <span>{props.t("capabilities.rerankerDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={props.onDevelopment}>
              {props.t("capabilities.manage")}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="capabilities-input-title">
        <h2 className="settings-section-title" id="capabilities-input-title">
          {props.t("capabilities.ocrAndVoice")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.ocrEngineTitle")}</strong>
              <span id="capabilities-ocr-description">{props.t("capabilities.ocrEngineDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-capability-control="ocr-engine"
              aria-label={`${props.t("capabilities.ocrEngineTitle")}: ${props.t("settings.status.development")}`}
              aria-describedby="capabilities-ocr-description capabilities-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.imageOcrTitle")}</strong>
              <span>{props.t("capabilities.imageOcrDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-capability-control="image-ocr"
              aria-label={`${props.t("capabilities.imageOcrTitle")}: ${props.t("settings.status.development")}`}
              aria-describedby="capabilities-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.voiceTitle")}</strong>
              <span>{props.t("capabilities.voiceDescription")}</span>
            </div>
            <div className="settings-row-control">
              <span
                className={`settings-status${speechCapabilityState === "available" ? "" : " warning"}`}
                data-capability-status="voice-input"
                role={speechCapabilityState === "failed" ? "alert" : "status"}
                aria-live="polite"
              >
                {props.t(`capabilities.voice.${speechCapabilityState}`)}
              </span>
              {speechSettingsAvailable ? (
                <button
                  className="settings-button"
                  type="button"
                  data-capability-control="voice-open-settings"
                  onClick={() => void props.onOpenSpeechSettings()}
                >
                  {props.t("capabilities.voice.openSettings")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <p className="settings-note" id="capabilities-partial-note">{props.t("capabilities.partialNote")}</p>
    </section>
  );
}

export function AgentMemorySettingsPanel(props: {
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const memoryScopes = [
    "summaries",
    "naming",
    "organization",
    "mistakes"
  ] as const;

  return (
    <section className="settings-page memory-settings-page" aria-labelledby="settings-memory-title">
      <header className="settings-panel-header">
        <h1 id="settings-memory-title">{props.t("memory.title")}</h1>
        <p>{props.t("memory.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="memory-policy-title">
        <h2 className="settings-section-title" id="memory-policy-title">{props.t("memory.agentPolicy")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>PIGE.md</strong>
              <span>{props.t("memory.pigeDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-memory-control="pige-policy"
              aria-describedby="memory-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("memory.highImpactTitle")}</strong>
              <span id="memory-high-impact-description">{props.t("memory.highImpactDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-memory-control="high-impact-policy"
              aria-label={props.t("memory.highImpactTitle")}
              aria-describedby="memory-high-impact-description memory-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="memory-vault-title">
        <h2 className="settings-section-title" id="memory-vault-title">{props.t("memory.memorySection")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("memory.vaultMemoryTitle")}</strong>
              <span>{props.t("memory.vaultMemoryDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-memory-control="vault-memory"
              aria-label={props.t("memory.vaultMemoryTitle")}
              aria-describedby="memory-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("memory.useMemoryFor")}</strong>
              <span>{props.t("memory.useMemoryDescription")}</span>
              <div className="memory-scope-list" role="group" aria-label={props.t("memory.useMemoryFor") }>
                {memoryScopes.map((scope) => (
                  <button
                    className="memory-scope-option"
                    type="button"
                    data-memory-scope={scope}
                    aria-describedby="memory-partial-note"
                    key={scope}
                    onClick={props.onDevelopment}
                  >
                    <PigeIcon name="memory" size={14} aria-hidden="true" />
                    {props.t(`memory.scope.${scope}`)}
                    <small>{props.t("settings.status.development")}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="memory-records-title">
        <h2 className="settings-section-title" id="memory-records-title">{props.t("memory.savedMemories")}</h2>
        <div className="memory-empty-card">
          <PigeIcon name="memory" size={22} />
          <div>
            <strong>{props.t("memory.emptyTitle")}</strong>
            <span>{props.t("memory.emptyDescription")}</span>
          </div>
        </div>
        <div className="settings-inline-actions">
          <button className="settings-button" type="button" onClick={props.onDevelopment}>
            {props.t("memory.inspect")}
          </button>
          <button className="settings-button" type="button" onClick={props.onDevelopment}>
            {props.t("memory.export")}
          </button>
          <button
            className="settings-button danger"
            type="button"
            disabled
            title={props.t("memory.resetUnavailable")}
          >
            {props.t("memory.reset")}
          </button>
        </div>
      </section>

      <p className="settings-note" id="memory-partial-note">{props.t("memory.partialNote")}</p>
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
  const [registry, setRegistry] = useState<SkillRegistrySummary | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [disablingSkillId, setDisablingSkillId] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const latestRevisionRef = useRef(-1);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let requestCurrent = true;
    const adoptRegistry = (next: SkillRegistrySummary): void => {
      if (!active || next.revision < latestRevisionRef.current) return;
      latestRevisionRef.current = next.revision;
      setRegistry(next);
      setReadState("ready");
    };
    const unsubscribe = window.pige.skills.onChanged(adoptRegistry);
    if (registry === null) setReadState("loading");
    void window.pige.skills.summary().then((result: SkillRegistryQueryResult) => {
      if (!requestCurrent) return;
      if (result.status === "failed") {
        if (active && latestRevisionRef.current < 0) setReadState("failed");
        return;
      }
      adoptRegistry(result.registry);
    }).catch(() => {
      if (active && requestCurrent && latestRevisionRef.current < 0) setReadState("failed");
    });
    return () => {
      active = false;
      requestCurrent = false;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [reloadSequence]);

  const disableSkill = async (skill: SkillSummary): Promise<void> => {
    if (!registry || disablingSkillId || !skill.enabled) return;
    setDisablingSkillId(skill.id);
    setStatusKey(null);
    try {
      const result = await window.pige.skills.disable({
        apiVersion: 1,
        skillId: skill.id,
        expectedRevision: registry.revision
      });
      if (!mountedRef.current) return;
      if (result.status === "failed") {
        setStatusKey(result.error.code === "skill.registry_busy"
          ? "skills.registryBusy"
          : "skills.registryUnavailable");
        return;
      }
      if (result.registry.revision >= latestRevisionRef.current) {
        latestRevisionRef.current = result.registry.revision;
        setRegistry(result.registry);
        setReadState("ready");
      }
      setStatusKey(result.status === "committed"
        ? "skills.disableCompleted"
        : result.status === "stale"
          ? "skills.registryChanged"
          : "skills.skillUnavailable");
    } catch {
      if (mountedRef.current) setStatusKey("skills.disableFailed");
    } finally {
      if (mountedRef.current) setDisablingSkillId(null);
    }
  };

  return (
    <section className="settings-page settings-skills" aria-labelledby="settings-skills-title">
      <header className="settings-panel-header">
        <h1 id="settings-skills-title">{props.t("skills.title")}</h1>
        <p>{props.t("skills.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="skills-installed-title">
        <h2 className="settings-section-title" id="skills-installed-title">{props.t("skills.installedTitle")}</h2>
        {readState === "loading" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="loading" size={19} className="spinning" /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.loadingTitle")}</strong>
              <span>{props.t("skills.loadingDescription")}</span>
            </div>
          </div>
        ) : readState === "failed" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="shield" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.loadFailedTitle")}</strong>
              <span>{props.t("skills.loadFailedDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={() => setReloadSequence((current) => current + 1)}>
              {props.t("skills.retryLoad")}
            </button>
          </div>
        ) : registry && registry.skills.length > 0 ? (
          <div className="settings-card skills-registry-list" data-skill-registry-revision={registry.revision}>
            {registry.skills.map((skill) => (
              <div className="settings-row tall skill-registry-row" data-skill-id={skill.id} key={skill.id}>
                <span className={`skills-empty-icon${skill.enabled ? " is-enabled" : ""}`} aria-hidden="true">
                  <PigeIcon name="skill" size={18} />
                </span>
                <div className="settings-row-copy skill-registry-copy">
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                  <div className="skill-registry-meta" aria-label={props.t("skills.skillDetails")}>
                    <span>{`v${skill.version}`}</span>
                    <span>{props.t(`skills.kind.${skill.kind}`)}</span>
                    <span>{props.t(`skills.scope.${skill.scope}`)}</span>
                    {skill.dataBoundaries.map((boundary) => (
                      <span key={boundary}>{props.t(`skills.boundary.${boundary}`)}</span>
                    ))}
                  </div>
                </div>
                <div className="settings-row-control skill-registry-control">
                  <span className={`settings-status ${skill.enabled ? "is-enabled" : "neutral"}`}>
                    {props.t(skill.enabled ? "skills.statusEnabled" : "skills.statusDisabled")}
                  </span>
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t(skill.enabled ? "skills.disable" : "skills.enableUnavailable")}: ${skill.name}`}
                    disabled={!skill.enabled || disablingSkillId !== null}
                    title={skill.enabled ? props.t("skills.disableDescription") : props.t("skills.enableUnavailableDescription")}
                    onClick={() => void disableSkill(skill)}
                  >
                    {disablingSkillId === skill.id
                      ? props.t("skills.disabling")
                      : props.t(skill.enabled ? "skills.disable" : "skills.enableUnavailable")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-card skills-empty-card">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="skill" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.emptyTitle")}</strong>
              <span>{props.t("skills.emptyDescription")}</span>
            </div>
          </div>
        )}
        {registry && registry.invalidManifestCount > 0 ? (
          <p className="settings-note skill-registry-warning" role="status" data-invalid-skill-count={registry.invalidManifestCount}>
            {props.t("skills.invalidManifestWarning")}
          </p>
        ) : null}
        {statusKey ? <p className="settings-note" role="status" aria-live="polite">{props.t(statusKey)}</p> : null}
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

export function PiPackagesSettingsPanel(props: {
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="settings-page settings-packages" aria-labelledby="settings-packages-title">
      <header className="settings-panel-header">
        <h1 id="settings-packages-title">{props.t("packages.title")}</h1>
        <p>{props.t("packages.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="packages-registry-title">
        <h2 className="settings-section-title" id="packages-registry-title">{props.t("packages.registryTitle")}</h2>
        <div className="settings-card skills-empty-card">
          <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
          <div className="settings-row-copy">
            <strong>{props.t("packages.unavailableTitle")}</strong>
            <span>{props.t("packages.unavailableDescription")}</span>
          </div>
        </div>
        <div className="settings-inline-actions">
          <button className="settings-button primary settings-action" type="button" onClick={props.onDevelopment}>
            <PigeIcon name="link" size={15} aria-hidden="true" />
            {props.t("packages.installFromSource")}
          </button>
          <button className="settings-button settings-action" type="button" onClick={props.onDevelopment}>
            <PigeIcon name="search" size={15} aria-hidden="true" />
            {props.t("packages.searchCatalog")}
          </button>
        </div>
      </section>

      <section className="settings-section" role="group" aria-labelledby="packages-review-title">
        <h2 className="settings-section-title" id="packages-review-title">{props.t("packages.reviewTitle")}</h2>
        <div className="settings-card">
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="shield" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.reviewIdentity")}</strong>
              <span>{props.t("packages.reviewIdentityDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="shield" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.reviewPermissions")}</strong>
              <span>{props.t("packages.reviewPermissionsDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="activity" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.lifecycleTitle")}</strong>
              <span>{props.t("packages.lifecycleDescription")}</span>
            </div>
          </div>
        </div>
      </section>

      <p className="settings-note">{props.t("packages.partialNote")}</p>
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

function updateSummaryDescription(
  summary: UpdateSummary,
  locale: Locale,
  t: (key: string) => string
): string {
  if (summary.capability === "development") return t("system.updateCapabilityDevelopment");
  if (summary.capability === "unsupported_platform") return t("system.updateCapabilityUnsupported");
  if (summary.phase === "idle") return t("system.updateNotChecked");
  if (summary.phase === "checking") return t("system.checkingUpdates");
  const status = summary.phase === "up_to_date"
    ? t("system.updateUpToDate")
    : summary.phase === "available"
      ? t("system.updateAvailable")
      : t("system.updateCheckFailed");
  if (!("checkedAt" in summary)) return status;
  const date = new Date(summary.checkedAt);
  if (Number.isNaN(date.getTime())) return status;
  const dateLocale = locale === "zh-Hans" ? "zh-CN" : locale;
  return `${status} · ${t("system.lastChecked")} ${new Intl.DateTimeFormat(dateLocale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

export function ActivityHistorySettingsPanel(props: {
  readonly activities: readonly KnowledgeActivitySummary[];
  readonly undoingId: string | null;
  readonly openingId: string | null;
  readonly blockedIds: readonly string[];
  readonly locale: Locale;
  readonly onOpen: (activity: KnowledgeActivitySummary) => Promise<void>;
  readonly onUndo: (operationId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const locale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  return (
    <section className="settings-page settings-history-page" aria-labelledby="settings-history-title">
      <header className="settings-panel-header">
        <h1 id="settings-history-title">{props.t("activity.historyTitle")}</h1>
        <p>{props.t("activity.historySubtitle")}</p>
      </header>
      <section className="settings-section" aria-labelledby="activity-recent-title">
        <h2 className="settings-section-title" id="activity-recent-title">{props.t("activity.recent")}</h2>
        {props.activities.length === 0 ? (
          <div className="settings-state-copy">
            <strong>{props.t("activity.empty")}</strong>
            <span>{props.t("activity.emptyDescription")}</span>
          </div>
        ) : (
          <div className="settings-card activity-history-list">
            {props.activities.map((activity, index) => {
              const activityMessageKey = activity.kind === "update_page"
                ? "activity.updatedPage"
                : "activity.createdPage";
              const activityLabel = `${props.t(activityMessageKey)}${activity.targetLabel ? `: ${activity.targetLabel}` : ""} (${index + 1})`;
              const createdAt = new Date(activity.createdAt);
              const createdAtLabel = Number.isNaN(createdAt.getTime())
                ? props.t("activity.timeUnavailable")
                : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(createdAt);
              return (
                <article
                  className="settings-row tall activity-history-row"
                  key={activity.operationId}
                  aria-label={activityLabel}
                  data-activity-row-id={activity.operationId}
                  tabIndex={-1}
                >
                  <span className={`activity-row-dot${activity.status === "undone" ? " is-undone" : ""}`} aria-hidden="true" />
                  <div className="settings-row-copy">
                    <strong>{props.t(activityMessageKey)}{activity.targetLabel ? `: ${activity.targetLabel}` : ""}</strong>
                    <span>{createdAtLabel} · {props.t(activity.status === "undone" ? "activity.statusUndone" : "activity.statusApplied")}</span>
                  </div>
                  <div className="settings-row-control">
                    {activity.status === "applied" && activity.target?.kind === "page" ? (
                      <button
                        type="button"
                        className="settings-button"
                        aria-label={`${props.t("activity.open")}: ${activityLabel}`}
                        data-activity-open-id={activity.operationId}
                        disabled={props.openingId !== null}
                        onClick={() => void props.onOpen(activity)}
                      >
                        {props.t("activity.open")}
                      </button>
                    ) : null}
                    {activity.canUndo ? (
                      <button
                        type="button"
                        className="settings-button"
                        aria-label={`${props.t("activity.undo")}: ${activityLabel}`}
                        data-activity-undo-id={activity.operationId}
                        disabled={props.undoingId !== null || props.blockedIds.includes(activity.operationId)}
                        onClick={() => void props.onUndo(activity.operationId)}
                      >
                        {props.t(props.undoingId === activity.operationId ? "activity.undoing" : "activity.undo")}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="settings-note">{props.t("activity.historyNote")}</p>
      </section>
    </section>
  );
}

export function SystemSettingsPanel(props: {
  readonly surface: "updates" | "diagnostics";
  readonly locale: Locale;
  readonly diagnosticsHealth: DiagnosticsHealth | null;
  readonly supportBundlePreview: SupportBundlePreview | null;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onSupportBundlePreviewChange: (preview: SupportBundlePreview | null) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<"refresh" | "preview" | "export" | "cancel" | null>(null);
  const [notice, setNotice] = useState<{ readonly kind: "success" | "error"; readonly key: string } | null>(null);
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateLoadState, setUpdateLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [updateBusy, setUpdateBusy] = useState(false);
  const supportBundleExportRequestRef = useRef<string | null>(null);
  const supportBundleCancelRequestRef = useRef<string | null>(null);
  const updateSummaryRevisionRef = useRef(-1);
  const updateEventSequenceRef = useRef(0);
  const updateCheckBusyRef = useRef(false);

  useEffect(() => {
    if (props.surface !== "updates") return;
    let active = true;
    updateSummaryRevisionRef.current = -1;
    updateEventSequenceRef.current = 0;
    updateCheckBusyRef.current = false;
    setUpdateSummary(null);
    setUpdateLoadState("loading");
    setUpdateBusy(false);
    setNotice(null);

    const applySummary = (summary: UpdateSummary): void => {
      if (!active || summary.revision < updateSummaryRevisionRef.current) return;
      updateSummaryRevisionRef.current = summary.revision;
      setUpdateSummary(summary);
      setUpdateLoadState("ready");
    };
    const unsubscribe = window.pige.updates.onStatusChanged((event) => {
      if (!active || event.sequence <= updateEventSequenceRef.current) return;
      updateEventSequenceRef.current = event.sequence;
      applySummary(event.summary);
    });
    void window.pige.updates.summary()
      .then((summary) => {
        if (updateEventSequenceRef.current === 0) applySummary(summary);
      })
      .catch(() => {
        if (!active || updateEventSequenceRef.current > 0) return;
        setUpdateLoadState("failed");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [props.surface]);

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
  const checkForUpdates = async (): Promise<void> => {
    if (
      updateCheckBusyRef.current ||
      updateSummary?.capability !== "packaged_ready" ||
      updateSummary.phase === "checking"
    ) return;
    updateCheckBusyRef.current = true;
    setUpdateBusy(true);
    setNotice(null);
    const requestId = `updatereq_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      const result = await window.pige.updates.check({ apiVersion: 1, requestId });
      if (result.summary.revision >= updateSummaryRevisionRef.current) {
        updateSummaryRevisionRef.current = result.summary.revision;
        setUpdateSummary(result.summary);
        setUpdateLoadState("ready");
      }
      if (result.status === "unavailable") {
        setNotice({ kind: "error", key: "system.updateCheckUnavailable" });
      } else if (result.status === "busy") {
        setNotice({ kind: "success", key: "system.updateCheckAlreadyRunning" });
      }
    } catch {
      setNotice({ kind: "error", key: "system.updateCheckFailed" });
    } finally {
      updateCheckBusyRef.current = false;
      setUpdateBusy(false);
    }
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
    <section className={`settings-page settings-system-page settings-${props.surface}-page`} aria-labelledby={`settings-${props.surface}-title`}>
      <header className="settings-panel-header">
        <h1 id={`settings-${props.surface}-title`}>
          {props.t(props.surface === "updates" ? "system.updatesTitle" : "system.diagnosticsTitle")}
        </h1>
        <p>{props.t(props.surface === "updates" ? "system.updatesSubtitle" : "system.diagnosticsSubtitle")}</p>
      </header>

      {props.surface === "updates" ? (
      <section className="settings-section" aria-labelledby="system-update-title">
        <h2 className="settings-section-title" id="system-update-title">{props.t("system.updateSection")}</h2>
        <div className="settings-card settings-update-summary" aria-live="polite" aria-busy={updateLoadState === "loading" || updateSummary?.phase === "checking"}>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("system.currentVersion")}</strong>
              <span>{updateSummary?.currentVersion ?? props.t(updateLoadState === "failed" ? "system.updateSummaryFailed" : "system.updateSummaryLoading")}</span>
            </div>
            <span className="settings-status">{props.t("system.publicAlpha")}</span>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("system.updateChannel")}</strong>
              <span>{props.t("system.updateChannelDescription")}</span>
            </div>
            <span className="settings-status">{props.t("system.publicAlpha")}</span>
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
              <span>{updateSummary ? updateSummaryDescription(updateSummary, props.locale, props.t) : props.t(updateLoadState === "failed" ? "system.updateSummaryFailed" : "system.updateSummaryLoading")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              disabled={updateLoadState !== "ready" || updateSummary?.capability !== "packaged_ready" || updateBusy || updateSummary?.phase === "checking"}
              onClick={() => void checkForUpdates()}
            >
              {props.t(updateBusy || updateSummary?.phase === "checking" ? "system.checkingUpdates" : "system.checkUpdates")}
            </button>
          </div>
          {updateSummary?.phase === "available" ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("system.updateAvailable")}</strong>
                <span>{updateSummary.availableVersion}</span>
              </div>
              <button className="settings-button" type="button" disabled title={props.t("system.updateDownloadUnavailable")}>
                {props.t("system.downloadUpdate")}
              </button>
            </div>
          ) : null}
        </div>
        {notice ? (
          <p className={notice.kind === "error" ? "error" : "muted"} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
            {props.t(notice.key)}
          </p>
        ) : null}
        <p className="settings-note">{props.t(updateSummary?.capability === "unsupported_platform" ? "system.updateUnsupportedNote" : updateSummary?.capability === "packaged_ready" ? "system.updatesPrivacyNote" : "system.updatesUnavailableNote")}</p>
      </section>
      ) : (

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
      )}
    </section>
  );
}

interface VaultSettingsPanelProps {
  readonly surface: "vault" | "maintenance";
  readonly locale: Locale;
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
  readonly onOpenMemory: () => void;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function VaultSettingsPanel(props: VaultSettingsPanelProps): React.JSX.Element {
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState<"check" | "rebuild" | "reset" | null>(null);
  const [maintenanceNotice, setMaintenanceNotice] = useState<{ readonly kind: "success" | "error"; readonly key: string } | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [revealTarget, setRevealTarget] = useState<VaultRevealTarget | null>(null);
  const [revealNotice, setRevealNotice] = useState<{ readonly kind: "success" | "error"; readonly message: string } | null>(null);
  const revealRequestSequence = useRef(0);
  const revealRequestActiveRef = useRef(false);
  const knowledgeRootButtonRef = useRef<HTMLButtonElement>(null);
  const sourceAssetRootButtonRef = useRef<HTMLButtonElement>(null);
  const resetDatabaseButtonRef = useRef<HTMLButtonElement>(null);
  const cancelResetButtonRef = useRef<HTMLButtonElement>(null);
  const activeBackupJob = props.backupJobs[0];
  const lastBackupDisplay = props.backupStatus?.lastBackupAt
    ? new Intl.DateTimeFormat(props.locale === "zh-Hans" ? "zh-CN" : props.locale, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(props.backupStatus.lastBackupAt))
    : props.t("backup.never");
  const restore = useRestoreFlow(async () => {
    setBackupNotice(props.t("backup.restored"));
    await props.onRefresh();
    await props.onRefreshDiagnostics();
  }, () => props.onError(null));

  useEffect(() => () => {
    revealRequestSequence.current += 1;
    revealRequestActiveRef.current = false;
  }, []);

  useEffect(() => {
    if (props.surface !== "maintenance") return;
    let active = true;
    void props.onRefreshDiagnostics().catch(() => {
      if (active) setMaintenanceNotice({ kind: "error", key: "error.generic" });
    });
    return () => { active = false; };
  }, [props.surface]);

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
    } catch {
      props.onError(props.t("error.generic"));
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

  if (props.surface === "vault" && restore.restorePreview) {
    return (
      <RestorePreviewPanel
        idPrefix="vault-settings"
        variant="settings"
        locale={props.locale}
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
    );
  }

  return (
    <section
      className={`settings-page ${props.surface === "vault" ? "settings-vault-page" : "maintenance-settings-page"}`}
      aria-labelledby={props.surface === "maintenance" ? "settings-maintenance-title" : "settings-vault-title"}
    >
      <header className="settings-panel-header">
        <h1 id={props.surface === "maintenance" ? "settings-maintenance-title" : "settings-vault-title"}>
          {props.t(props.surface === "maintenance" ? "maintenance.title" : "vaultSettings.title")}
        </h1>
        <p>{props.t(
          props.surface === "maintenance" ? "maintenance.subtitle" : "vaultSettings.subtitle"
        )}</p>
      </header>

      {props.surface === "vault" ? <>
      <div className="settings-summary-grid" aria-label={props.t("counts.title")}>
        {([
          [props.t("counts.notes"), props.vault.counts?.notes ?? 0],
          [props.t("counts.sources"), props.vault.counts?.sources ?? 0],
          [props.t("counts.managedCopies"), props.vault.counts?.managedSourceCopies ?? 0],
          [props.t("counts.referencedOriginals"), props.vault.counts?.referencedOriginals ?? 0]
        ] as const).map(([label, value]) => (
          <div className="settings-summary" key={label}>
            <strong>{value.toLocaleString(props.locale === "zh-Hans" ? "zh-CN" : props.locale)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <section className="settings-section" aria-labelledby="vault-current-title">
        <h2 className="settings-section-title" id="vault-current-title">{props.t("vaultSettings.currentVault")}</h2>
        <div className="settings-card" aria-busy={revealTarget ? "true" : undefined}>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.vault.name}</strong>
              <span>{props.vault.activeVaultPathDisplay}</span>
            </div>
            <span className="settings-status">{props.t("vaultSettings.connected")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("field.noteStorage")}</strong>
              <span>{props.vault.knowledgeRootDisplay}</span>
            </div>
            <button
              ref={knowledgeRootButtonRef}
              className="settings-button settings-action"
              type="button"
              disabled={props.busy || Boolean(revealTarget)}
              onClick={() => void revealStorageRoot("knowledge_root")}
            >
              {props.t("vaultSettings.openInFinder")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("field.sourceAssets")}</strong>
              <span>{props.vault.sourceAssetRootKind === "external_binding"
                ? props.t("vaultSettings.externalRootUnavailable")
                : props.vault.sourceAssetRootDisplay}</span>
            </div>
            <button
              ref={sourceAssetRootButtonRef}
              className="settings-button settings-action"
              type="button"
              disabled={props.busy || Boolean(revealTarget)}
              onClick={() => void revealStorageRoot("source_asset_root")}
            >
              {props.t("vaultSettings.openSourceAssets")}
            </button>
          </div>
          <label className="settings-row" htmlFor="vault-source-storage-strategy">
            <span className="settings-row-copy">
              <strong>{props.t("sourceStorage.title")}</strong>
              <span>{props.t("sourceStorage.description")}</span>
            </span>
            <select
              className="settings-select"
              id="vault-source-storage-strategy"
              value={props.vault.defaultSourceStorageStrategy}
              disabled={props.busy || Boolean(revealTarget)}
              onChange={(event) => void updatePolicy(event.target.value as SourceStorageStrategy)}
            >
              <option value="copy_to_source_library">{props.t("sourceStorage.copy")}</option>
              <option value="reference_original">{props.t("sourceStorage.reference")}</option>
            </select>
          </label>
        </div>
        <div className="settings-inline-actions">
          <button type="button" className="settings-button" onClick={props.onOpen} disabled={props.busy || Boolean(revealTarget)}>
            {props.t("vaultSettings.openAnother")}
          </button>
          <button type="button" className="settings-button" onClick={props.onCreate} disabled={props.busy || Boolean(revealTarget)}>
            {props.t("vaultSettings.createNew")}
          </button>
        </div>
        {revealNotice ? (
          <p className={revealNotice.kind === "error" ? "error" : "settings-note"} role="status" aria-live="polite">
            {revealNotice.message}
          </p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="vault-backup-title">
        <h2 className="settings-section-title" id="vault-backup-title">{props.t("backup.title")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("backup.lastBackup")}</strong>
              <span>{lastBackupDisplay} · {props.t("backup.excludesSecrets")}</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("backup.contents")}</strong>
              <span>{props.backupStatus?.messageKey ? props.t(props.backupStatus.messageKey) : props.t("backup.loading")}</span>
            </div>
            <button className="settings-button" type="button" onClick={props.onOpenMemory}>
              {props.t("backup.viewMemory")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("backup.protectKnowledge")}</strong>
              <span>{props.t("backup.protectKnowledgeDescription")}</span>
            </div>
            <div className="settings-row-control">
              <button
                className="settings-button primary"
                type="button"
                disabled={backupBusy || !props.backupStatus?.createAvailable}
                onClick={() => void createBackup()}
              >
                {props.t("backup.create")}
              </button>
              <button
                ref={restore.previewButtonRef}
                className="settings-button"
                type="button"
                disabled={backupBusy || restore.restorePhase !== "idle" || !props.backupStatus?.restoreAvailable}
                onClick={() => void restore.previewRestore()}
              >
                {props.t(restore.restorePhase === "previewing" ? "backup.opening" : "backup.restore")}
              </button>
            </div>
          </div>
        {activeBackupJob ? (
          <div className="settings-row tall backup-job-status" role="status" aria-live="polite">
            <div className="settings-row-copy">
              <strong>{props.t("backup.currentJob")}</strong>
              <span>{props.t(backupJobMessageKey(activeBackupJob))}</span>
              {activeBackupJob.state === "waiting_dependency" ? (
                <span id="backup-reconnect-managed-source-unavailable">
                  {props.t("backup.reconnectManagedSourceUnavailable")}
                </span>
              ) : null}
            </div>
            <div className="settings-row-control">
              {activeBackupJob.state === "queued" || activeBackupJob.state === "running" ? (
                <button type="button" className="settings-button" disabled={backupBusy} onClick={() => void cancelBackup()}>
                  {props.t("home.cancelJob")}
                </button>
              ) : activeBackupJob.state === "failed_retryable" && activeBackupJob.error?.userAction === "retry" ? (
                <button type="button" className="settings-button" disabled={backupBusy} onClick={() => void retryBackup()}>
                  {props.t("home.retryJob")}
                </button>
              ) : activeBackupJob.state === "waiting_dependency" ? (
                <button
                  type="button"
                  className="settings-button"
                  disabled
                  aria-describedby="backup-reconnect-managed-source-unavailable"
                >
                  {props.t("backup.reconnectManagedSource")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        </div>
        {backupNotice ? <p className="muted">{backupNotice}</p> : null}
        {!restore.restorePreview && restore.restoreErrorKey ? (
          <p className="error" role="alert">{props.t(restore.restoreErrorKey)}</p>
        ) : null}
        <p className="settings-note">{props.t("backup.recentVaultNote")}</p>
      </section>
      </> : null}

      {props.surface === "maintenance" ? <>
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
      </> : null}

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

type ProviderMutationStatus =
  | { readonly kind: "credential_updated"; readonly providerId: string }
  | { readonly kind: "credential_update_failed"; readonly providerId: string }
  | { readonly kind: "provider_deleted" }
  | { readonly kind: "provider_delete_failed"; readonly providerId: string };

function providerRuntimeStatusKey(
  provider: ModelProviderSettingsSummary["providers"][number]
): string {
  if (provider.runtimeStatus?.generation === "failed") return "models.statusGenerationFailed";
  if (provider.runtimeStatus?.generation === "verified") return "models.statusGenerationVerified";
  if (provider.runtimeStatus?.discovery === "verified") return "models.statusDiscoveryVerified";
  return "models.statusConfigured";
}

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
  const [providerCredentialDraft, setProviderCredentialDraft] = useState("");
  const [providerMutationStatus, setProviderMutationStatus] = useState<ProviderMutationStatus | null>(null);
  const [deleteConfirmationProviderId, setDeleteConfirmationProviderId] = useState<string | null>(null);
  const [providerMutationInFlight, setProviderMutationInFlight] = useState(false);
  const refreshRequestSequence = useRef(0);
  const providerMutationSequence = useRef(0);
  const deleteProviderButtonRef = useRef<HTMLButtonElement | null>(null);
  const keepProviderButtonRef = useRef<HTMLButtonElement | null>(null);
  const providerDeletedStatusRef = useRef<HTMLDivElement | null>(null);
  const pendingDeleteFocusRef = useRef<"keep" | "delete" | "status" | null>(null);

  useEffect(() => {
    const pendingFocus = pendingDeleteFocusRef.current;
    const target = pendingFocus === "keep"
      ? keepProviderButtonRef.current
      : pendingFocus === "delete"
        ? deleteProviderButtonRef.current
        : pendingFocus === "status"
          ? providerDeletedStatusRef.current
          : null;
    if (!target) return;
    pendingDeleteFocusRef.current = null;
    target.focus();
  }, [deleteConfirmationProviderId, providerMutationStatus, view.kind]);

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

  const updateProviderCredential = async (providerProfileId: string): Promise<void> => {
    const expectedRevision = props.modelSummary?.revision;
    const nextApiKey = providerCredentialDraft;
    if (!expectedRevision || !nextApiKey.trim() || providerMutationInFlight) return;

    const requestSequence = ++providerMutationSequence.current;
    setProviderMutationInFlight(true);
    setProviderMutationStatus(null);
    setFailure(null);
    props.onBusy(true);
    try {
      await window.pige.models.updateProviderCredential({
        providerProfileId,
        expectedRevision,
        apiKey: nextApiKey
      });
      if (requestSequence !== providerMutationSequence.current) return;
      setProviderCredentialDraft("");
      setProviderMutationStatus({ kind: "credential_updated", providerId: providerProfileId });
      await refreshCommittedSettings();
    } catch {
      if (requestSequence === providerMutationSequence.current) {
        setProviderMutationStatus({ kind: "credential_update_failed", providerId: providerProfileId });
      }
    } finally {
      if (requestSequence === providerMutationSequence.current) setProviderMutationInFlight(false);
      props.onBusy(false);
    }
  };

  const deleteProvider = async (providerProfileId: string): Promise<void> => {
    const expectedRevision = props.modelSummary?.revision;
    if (!expectedRevision || providerMutationInFlight) return;

    const requestSequence = ++providerMutationSequence.current;
    setProviderMutationInFlight(true);
    setProviderMutationStatus(null);
    setFailure(null);
    props.onBusy(true);
    try {
      await window.pige.models.deleteProvider({ providerProfileId, expectedRevision });
      if (requestSequence !== providerMutationSequence.current) return;
      setProviderCredentialDraft("");
      setDeleteConfirmationProviderId(null);
      setView({ kind: "overview" });
      pendingDeleteFocusRef.current = "status";
      setProviderMutationStatus({ kind: "provider_deleted" });
      await refreshCommittedSettings();
    } catch {
      if (requestSequence === providerMutationSequence.current) {
        setProviderMutationStatus({ kind: "provider_delete_failed", providerId: providerProfileId });
      }
    } finally {
      if (requestSequence === providerMutationSequence.current) setProviderMutationInFlight(false);
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
    providerMutationSequence.current += 1;
    setFailure(null);
    setManualBootstrap(null);
    setProviderCredentialDraft("");
    setProviderMutationStatus(null);
    setDeleteConfirmationProviderId(null);
    setProviderMutationInFlight(false);
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
          disabled={props.busy || providerMutationInFlight}
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
    const revisionUnavailable = !summary?.revision;
    const credentialStatus = providerMutationStatus?.kind === "credential_updated"
      && providerMutationStatus.providerId === selectedProvider.id;
    const credentialFailure = providerMutationStatus?.kind === "credential_update_failed"
      && providerMutationStatus.providerId === selectedProvider.id;
    const deleteFailure = providerMutationStatus?.kind === "provider_delete_failed"
      && providerMutationStatus.providerId === selectedProvider.id;
    const confirmingDelete = deleteConfirmationProviderId === selectedProvider.id;
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
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.credentials")}</h2>
          <div className="settings-card">
            {selectedProvider.authRequirement === "none" ? (
              <div className="settings-row">
                <span className="settings-row-copy">
                  <strong>{props.t("models.noCredentialRequired")}</strong>
                  <span>{props.t("models.noCredentialDescription")}</span>
                </span>
              </div>
            ) : (
              <label className="settings-row" htmlFor={`provider-credential-${selectedProvider.id}`}>
                <span className="settings-row-copy">
                  <strong>{props.t("models.replaceCredential")}</strong>
                  <span>{props.t("models.replaceCredentialDescription")}</span>
                </span>
                <span className="settings-row-control">
                  <input
                    className="settings-input"
                    id={`provider-credential-${selectedProvider.id}`}
                    type="password"
                    autoComplete="new-password"
                    value={providerCredentialDraft}
                    placeholder={props.t("models.newApiKey")}
                    disabled={props.busy || providerMutationInFlight}
                    onChange={(event) => {
                      setProviderCredentialDraft(event.target.value);
                      setProviderMutationStatus(null);
                    }}
                  />
                  <button
                    type="button"
                    className="settings-button"
                    disabled={props.busy || providerMutationInFlight || revisionUnavailable || !providerCredentialDraft.trim()}
                    onClick={() => void updateProviderCredential(selectedProvider.id)}
                  >
                    {props.t("models.updateCredential")}
                  </button>
                </span>
              </label>
            )}
          </div>
          {revisionUnavailable ? (
            <div className="settings-warning model-settings-error" role="status">{props.t("models.revisionUnavailable")}</div>
          ) : credentialStatus ? (
            <div className="settings-warning" role="status">{props.t("models.credentialUpdated")}</div>
          ) : credentialFailure ? (
            <div className="settings-warning model-settings-error" role="alert">{props.t("models.credentialUpdateFailed")}</div>
          ) : null}
        </section>
        <section className="settings-section">
          <h2 className="settings-section-title">{props.t("models.removeProvider")}</h2>
          <div className="settings-card">
            <div className="settings-row">
              <span className="settings-row-copy">
                <strong>{props.t("models.removeProvider")}</strong>
                <span>{props.t("models.removeProviderDescription")}</span>
              </span>
              {!confirmingDelete ? (
                <button
                  ref={deleteProviderButtonRef}
                  type="button"
                  className="settings-button"
                  disabled={props.busy || providerMutationInFlight || revisionUnavailable}
                  onClick={() => {
                    setProviderMutationStatus(null);
                    pendingDeleteFocusRef.current = "keep";
                    setDeleteConfirmationProviderId(selectedProvider.id);
                  }}
                >
                  {props.t("models.deleteProvider")}
                </button>
              ) : null}
            </div>
            {confirmingDelete ? (
              <div className="settings-row" role="group" aria-label={props.t("models.confirmDeleteProvider")}>
                <span className="settings-row-copy">
                  <strong>{props.t("models.confirmDeleteProvider")}</strong>
                  <span>{props.t("models.confirmDeleteProviderDescription")}</span>
                </span>
                <span className="settings-row-control">
                  <button
                    ref={keepProviderButtonRef}
                    type="button"
                    className="settings-button"
                    disabled={props.busy || providerMutationInFlight}
                    onClick={() => {
                      pendingDeleteFocusRef.current = "delete";
                      setDeleteConfirmationProviderId(null);
                    }}
                  >
                    {props.t("models.keepProvider")}
                  </button>
                  <button
                    type="button"
                    className="settings-button"
                    disabled={props.busy || providerMutationInFlight || revisionUnavailable}
                    onClick={() => void deleteProvider(selectedProvider.id)}
                  >
                    {props.t("models.confirmDelete")}
                  </button>
                </span>
              </div>
            ) : null}
          </div>
          {deleteFailure ? (
            <div className="settings-warning model-settings-error" role="alert">{props.t("models.providerDeleteFailed")}</div>
          ) : null}
        </section>
      </section>
    );
  }

  return (
    <section className="settings-page model-settings-page" aria-label={props.t("nav.models")}>
      {heading(props.t("models.title"), props.t("models.subtitle"))}
      {summaryFailure}
      {providerMutationStatus?.kind === "provider_deleted" ? (
        <div
          ref={providerDeletedStatusRef}
          className="settings-warning"
          role="status"
          tabIndex={-1}
        >
          {props.t("models.providerDeleted")}
        </div>
      ) : null}
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
                <span className="settings-status">{props.t(providerRuntimeStatusKey(provider))}</span>
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
  readonly onOpenRecent?: (vaultId: string) => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly openingVaultId?: string | null;
  readonly errorVaultId?: string | null;
  readonly disabled?: boolean;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.recentVaults.length === 0) return null;

  return (
    <section className="settings-section recent-list" aria-labelledby="recent-vaults-title">
      <h2 className="settings-section-title" id="recent-vaults-title">{props.t("recent.title")}</h2>
      <div className="settings-card">
        {props.recentVaults.map((recent) => (
          <div className="settings-row recent-vault-row" key={recent.vaultId}>
            <div className="settings-row-copy">
              <strong>{recent.name}</strong>
              <span>{recent.pathDisplay}</span>
              {props.errorVaultId === recent.vaultId ? (
                <span className="recent-vault-error" role="alert">{props.t("recent.openFailed")}</span>
              ) : null}
            </div>
            <div className="settings-row-control" role="group" aria-label={recent.name}>
              {props.onOpenRecent ? (
                <button
                  className="settings-button primary"
                  type="button"
                  aria-busy={props.openingVaultId === recent.vaultId}
                  aria-label={`${props.t("recent.open")}: ${recent.name}`}
                  disabled={props.disabled}
                  onClick={(event) => {
                    const button = event.currentTarget;
                    void props.onOpenRecent?.(recent.vaultId).finally(() => {
                      window.requestAnimationFrame(() => {
                        if (button.isConnected) button.focus();
                      });
                    });
                  }}
                >
                  {props.t(props.openingVaultId === recent.vaultId ? "recent.opening" : "recent.open")}
                </button>
              ) : null}
              <button
                className="settings-button"
                type="button"
                aria-label={`${props.t("recent.remove")}: ${recent.name}`}
                disabled={props.disabled}
                onClick={() => void props.onRemoveRecent(recent.vaultId)}
              >
                {props.t("recent.remove")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
