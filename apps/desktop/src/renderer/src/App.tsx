import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
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
import { ConversationScrollRail } from "./components/ConversationScrollRail";
import { ConversationEarlierControl, projectCompletedConversation, useConversationPagination } from "./components/ConversationPagination";
import { HomeVoicePanel, type HomeVoicePanelState } from "./components/HomeVoicePanel";
import { HighRiskConfirmationDialog } from "./components/HighRiskConfirmationDialog";
import { TaskExecutionInteractionStatus } from "./components/TaskExecutionInteraction";
import { AgentMemorySettingsPanel } from "./components/AgentMemorySettingsPanel";
import { ManagedCollectionPanel } from "./components/ManagedCollectionPanel";
import {
  LocalSemanticRetrievalSettingsPanel,
  type LocalSemanticRetrievalApi
} from "./components/LocalSemanticRetrievalSettingsPanel";
import { SkillsSettingsPanel } from "./components/SkillsSettingsPanel";
import { MaintenanceSettingsPanel } from "./components/MaintenanceSettingsPanel";
import {
  homeConversationStateForJob,
  isTerminalConversationTurn,
  selectCurrentNoSourceTurn,
  terminalTurnOwnsComposerSubmission,
  useHomeAcceptedTurnProjection,
  type HomeComposerSubmissionBinding,
  type HomeConversationTurnState
} from "./components/HomeConversationTurnState";
import { WindowModeToggle } from "./components/WindowModeToggle";
import { useWindowControls } from "./components/useWindowControls";
import type { ReaderInlineReferenceActivation } from "./components/ReaderInlineReferenceSurface";
import { NoteReader, type NoteRelatedState } from "./components/NoteReader";
import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorLabels,
  type NoteMarkdownEditorReady
} from "./components/NoteMarkdownEditor";
import { RecentVaults, RestorePreviewPanel, VaultBackupSettingsPanel, useRestoreFlow } from "./components/VaultBackupSettingsPanel";
import pigeMarkUrl from "../../../../../resources/brand/pige-icon/master/pige-icon-1024.png";
import deMessages from "./locales/de/messages.json";
import enMessages from "./locales/en/messages.json";
import frMessages from "./locales/fr/messages.json";
import jaMessages from "./locales/ja/messages.json";
import koMessages from "./locales/ko/messages.json";
import zhHansMessages from "./locales/zh-Hans/messages.json";
import type {
  AgentConversationInitialTimeline,
  AppearanceSettingsSummary,
  AppearanceThemePreference,
  AgentTurnAnswer,
  AgentTurnDraftEvent,
  AgentSubmitTurnResult,
  AgentRuntimeStatus,
  CaptureFileRejection,
  CaptureFileRejectionReason,
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
  LocalDatabaseStatus,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteRenderResult,
  NoteResolveInlineReferenceRequest,
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
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SupportBundlePreview,
  ToolchainHealth,
  UpdateSummary,
  VaultSummary,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState
} from "@pige/contracts";
import {
  AGENT_AUTHORED_TEXT_MAX_CODE_POINTS,
  AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES,
  AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES,
  AGENT_STAGED_ITEM_MAX_COUNT,
  type AgentStagedItem,
  type AgentStagedItemRejectionReason,
  type AgentStagedLargePasteItem,
  type CollectionAddNullableColumnRequest,
  type CollectionAddNullableColumnResult,
  type CollectionAppendDefaultRowRequest,
  type CollectionAppendDefaultRowResult,
  type CollectionCellEditRequest,
  type CollectionCellEditResult,
  type CollectionRenameColumnRequest,
  type CollectionRenameColumnResult,
  type CollectionOpenRequest,
  type CollectionOpenResult,
  type CollectionSnapshot,
  type CollectionTrashRowRequest,
  type CollectionTrashRowResult,
  type JobState,
  type Locale,
  type ProviderEndpointProtocol,
} from "@pige/schemas";
export { AgentMemorySettingsPanel } from "./components/AgentMemorySettingsPanel";
export { LocalSemanticRetrievalSettingsPanel } from "./components/LocalSemanticRetrievalSettingsPanel";
export { SkillsSettingsPanel } from "./components/SkillsSettingsPanel";
export { MaintenanceSettingsPanel } from "./components/MaintenanceSettingsPanel";
type View = "home" | "library" | "knowledgeTree";
type ActiveCollection = {
  readonly vaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly returnView: View;
};
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
type HomeAgentUiState = HomeConversationTurnState;
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
  readonly attachmentNames: readonly string[];
  readonly conversationEventId?: string;
  readonly jobId?: string;
};
type ActiveSourceTurnBinding = {
  readonly clientTurnId: string;
  readonly jobId: string | null;
  readonly pending: boolean;
  readonly sourceDisplayName: string | null;
};
type StagedPastedTextItem = { readonly localId: string } & Omit<AgentStagedLargePasteItem, "kind" | "ordinal">;
type HomeLargePasteClassification =
  | { readonly kind: "ordinary" }
  | { readonly kind: "staged"; readonly item: StagedPastedTextItem }
  | { readonly kind: "rejected"; readonly item: StagedPastedTextItem; readonly reason: AgentStagedItemRejectionReason };
type StagedComposerItem =
  | { readonly kind: "file"; readonly localId: string; readonly file: File }
  | ({ readonly kind: "pasted_text" } & StagedPastedTextItem)
  | ({ readonly kind: "rejected_pasted_text"; readonly reason: AgentStagedItemRejectionReason } & StagedPastedTextItem);
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
  const [appearanceSummary, setAppearanceSummary] = useState<AppearanceSettingsSummary | null>(null);
  const [appearanceThemeBusy, setAppearanceThemeBusy] = useState(false);
  const [appearanceThemeError, setAppearanceThemeError] = useState<string | null>(null);
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
  const [selectedCollection, setSelectedCollection] = useState<ActiveCollection | null>(null);
  const noteOpenSequence = useRef(0);
  const collectionOpenSequence = useRef(0);
  const inlineReferenceSequence = useRef(0);
  const activityOpenSequence = useRef(0);
  const activityOpenInFlightRef = useRef<string | null>(null);
  const readerSelectionProposalSequence = useRef(0);
  const readerSelectionProposalDecisionInFlight = useRef(false);
  const selectedNoteRef = useRef<NoteRenderResult | null>(selectedNote);
  const selectedNoteVaultIdRef = useRef<string | null>(selectedNoteVaultId);
  const selectedCollectionRef = useRef<ActiveCollection | null>(selectedCollection);
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
  const appearanceRevisionRef = useRef(-1);
  const deferredAppearanceRef = useRef<{
    readonly locale: Locale;
    readonly availableLocales: readonly Locale[];
  } | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(onboarding?.activeVault?.vaultId);
  activeVaultIdRef.current = onboarding?.activeVault?.vaultId;
  selectedNoteRef.current = selectedNote;
  selectedNoteVaultIdRef.current = selectedNoteVaultId;
  selectedCollectionRef.current = selectedCollection;

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
  const homeSurface = view === "home" && !selectedNote && !selectedCollection;
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

  const applyAppearanceSummary = (appearance: AppearanceSettingsSummary): boolean => {
    if (appearance.revision < appearanceRevisionRef.current) return false;
    appearanceRevisionRef.current = appearance.revision;
    setAppearanceSummary(appearance);
    if (voiceAssetInstallActiveRef.current) {
      deferredAppearanceRef.current = appearance;
      return true;
    }
    setLocale(appearance.locale);
    setAvailableLocales(appearance.availableLocales);
    return true;
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
      applyAppearanceSummary(appearance);
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
    const unsubscribeAppearance = window.pige.settings.onAppearanceChanged((appearance) => {
      if (!active) return;
      applyAppearanceSummary(appearance);
      setAppearanceLoadState("ready");
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
      unsubscribeAppearance();
    };
  }, []);

  useLayoutEffect(() => {
    if (!appearanceSummary) return;
    document.documentElement.dataset.theme = appearanceSummary.effectiveTheme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [appearanceSummary?.effectiveTheme]);

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

  const t = useCallback((key: string): string => messageCatalogs[locale][key] ?? messageCatalogs.en[key] ?? key, [locale]);
  const windowControls = useWindowControls(windowState, setWindowState, () => setCaptureToast({ kind: "error", message: t("error.generic") }));

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
      setSelectedCollection(null);
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

  const readCollection = async (
    datasetId: string,
    tableId: string,
    originVaultId: string,
    sequence: number
  ): Promise<CollectionSnapshot | null> => {
    const request: CollectionOpenRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: originVaultId,
      datasetId,
      tableId
    };
    try {
      const result = await window.pige.collections.open(request);
      if (
        sequence !== collectionOpenSequence.current ||
        activeVaultIdRef.current !== originVaultId ||
        !collectionOpenIdentityMatches(request, result) ||
        result.status !== "ready" ||
        result.snapshot.datasetId !== request.datasetId ||
        result.snapshot.tableId !== request.tableId
      ) return null;
      return result.snapshot;
    } catch {
      return null;
    }
  };

  const openCollection = async (
    datasetId: string,
    tableId: string,
    returnView: View
  ): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    const sequence = collectionOpenSequence.current + 1;
    collectionOpenSequence.current = sequence;
    setLibraryError(null);
    const snapshot = await readCollection(datasetId, tableId, vaultId, sequence);
    if (!snapshot) {
      if (sequence === collectionOpenSequence.current) setLibraryError(t("collection.failed"));
      return false;
    }
    const nextLayout = await requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: false
    });
    if (
      !nextLayout ||
      sequence !== collectionOpenSequence.current ||
      activeVaultIdRef.current !== vaultId
    ) return false;
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteAgentOpen(false);
    setSelectedCollection({ vaultId, snapshot, returnView });
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".managed-collection-panel")?.focus());
    return true;
  };

  const reloadSelectedCollection = async (): Promise<CollectionSnapshot | null> => {
    const current = selectedCollectionRef.current;
    if (!current || current.vaultId !== activeVaultIdRef.current) return null;
    const sequence = collectionOpenSequence.current + 1;
    collectionOpenSequence.current = sequence;
    const snapshot = await readCollection(
      current.snapshot.datasetId,
      current.snapshot.tableId,
      current.vaultId,
      sequence
    );
    if (!snapshot) return null;
    setSelectedCollection((active) => active?.vaultId === current.vaultId &&
      active.snapshot.datasetId === current.snapshot.datasetId &&
      active.snapshot.tableId === current.snapshot.tableId
      ? { ...active, snapshot }
      : active);
    return snapshot;
  };

  const editCollectionCell = async (
    request: CollectionCellEditRequest
  ): Promise<CollectionCellEditResult> => {
    const result = await window.pige.collections.editCell(request);
    if (result.status === "committed") void refreshVaultState();
    return result;
  };

  const appendCollectionDefaultRow = async (
    request: CollectionAppendDefaultRowRequest
  ): Promise<CollectionAppendDefaultRowResult> => {
    const result = await window.pige.collections.appendDefaultRow(request);
    if (collectionAppendIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const addCollectionNullableColumn = async (
    request: CollectionAddNullableColumnRequest
  ): Promise<CollectionAddNullableColumnResult> => {
    const result = await window.pige.collections.addNullableColumn(request);
    if (collectionColumnIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const renameCollectionColumn = async (
    request: CollectionRenameColumnRequest
  ): Promise<CollectionRenameColumnResult> => {
    const result = await window.pige.collections.renameColumn(request);
    if (collectionRenameIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const trashCollectionRow = async (
    request: CollectionTrashRowRequest
  ): Promise<CollectionTrashRowResult> => {
    const result = await window.pige.collections.trashRow(request);
    if (collectionTrashIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const adoptCollectionSnapshot = (snapshot: CollectionSnapshot, expectedRevisionId: string): boolean => {
    const active = selectedCollectionRef.current;
    if (
      !active ||
      active.vaultId !== activeVaultIdRef.current ||
      active.snapshot.datasetId !== snapshot.datasetId ||
      active.snapshot.tableId !== snapshot.tableId ||
      active.snapshot.revisionId !== expectedRevisionId
    ) return false;
    setSelectedCollection({ ...active, snapshot });
    return true;
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

  const reloadNoteEditor = async (request: NoteEditorOpenRequest): Promise<NoteEditorOpenResult> => {
    try {
      const render = await window.pige.notes.render({ pageId: request.pageId });
      if (
        activeVaultIdRef.current !== request.activeVaultId ||
        render.summary.pageId !== request.pageId ||
        !render.renderContextId
      ) return failedNoteEditorOpenResult(request);
      return await window.pige.notes.openEditor({ ...request, renderContextId: render.renderContextId });
    } catch {
      return failedNoteEditorOpenResult(request);
    }
  };

  const adoptCommittedNote = (result: Extract<NoteEditorSaveResult, { status: "committed" }>): void => {
    if (activeVaultIdRef.current !== result.activeVaultId) return;
    setSelectedNoteVaultId(result.activeVaultId);
    setSelectedNote(result.render);
    void refreshVaultState();
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
    collectionOpenSequence.current += 1;
    knowledgeTreeReturnFocusKey.current = null;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setSelectedCollection(null);
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
  const updateLocale = async (nextLocale: Locale): Promise<void> => {
    if (voiceAssetInstallActiveRef.current) return;
    const appearance = await window.pige.settings.setLocale({ locale: nextLocale });
    applyAppearanceSummary(appearance);
    setAppearanceLoadState("ready");
  };

  const updateTheme = async (themePreference: AppearanceThemePreference): Promise<boolean> => {
    if (!appearanceSummary || appearanceThemeBusy) return false;
    setAppearanceThemeBusy(true);
    setAppearanceThemeError(null);
    try {
      const result = await window.pige.settings.setTheme({
        themePreference,
        expectedRevision: appearanceSummary.revision
      });
      applyAppearanceSummary(result.settings);
      if (result.status !== "committed") {
        setAppearanceThemeError(t("appearance.themeUpdateFailed"));
        return false;
      }
      return true;
    } catch {
      setAppearanceThemeError(t("appearance.themeUpdateFailed"));
      return false;
    } finally {
      setAppearanceThemeBusy(false);
    }
  };

  const submitFiles = async (
    files: readonly File[],
    inputKind: "file_drop" | "file_picker",
    text?: string,
    clientTurnId = createAgentClientTurnId(),
    statusOwner: "home" | "shell" = "shell"
  ): Promise<AgentSubmitTurnResult | undefined> => {
    if (files.length === 0) return undefined;
    if (!onboarding?.activeVault) {
      if (statusOwner === "shell") setCaptureToast({ kind: "error", message: t("home.createVaultBeforeDrop") });
      return undefined;
    }

    try {
      const submission = window.pige.agent.submitTurn({
        schemaVersion: 1,
        clientTurnId,
        ...(text?.trim() ? { text } : {}),
        inputKind,
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
    const activity = activityList.activities.find((candidate) => candidate.operationId === operationId);
    setActivityUndoingId(operationId);
    try {
      const result = await window.pige.activity.undo({
        operationId,
        ...(activity?.target?.kind === "collection"
          ? { expectedRevisionId: activity.target.revisionId }
          : {})
      });
      if (result.status === "stale" || result.status === "not_found") {
        setCaptureToast({ kind: "error", message: t("activity.undoFailed") });
        return;
      }
      setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
      setCaptureToast({
        kind: "success",
        message: t(result.status === "already_undone" ? "activity.alreadyUndone" : "activity.undoCompleted")
      });
      await refreshVaultState();
      if (
        activity?.target?.kind === "collection" &&
        selectedCollectionRef.current?.snapshot.datasetId === activity.target.datasetId &&
        selectedCollectionRef.current.snapshot.tableId === activity.target.tableId
      ) void reloadSelectedCollection();
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
      !target ||
      target.kind === "memory"
    ) return;
    const requestId = activityOpenSequence.current + 1;
    activityOpenSequence.current = requestId;
    activityOpenInFlightRef.current = activity.operationId;
    setActivityOpeningId(activity.operationId);
    const opened = target.kind === "page"
      ? await openNoteTarget(target.pageId, false)
      : await openCollection(target.datasetId, target.tableId, "library");
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
      setHomeFileDropRequest({ clientTurnId, files });
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
    if (!selectedCollection || selectedCollection.vaultId === activeVault?.vaultId) return;
    collectionOpenSequence.current += 1;
    setSelectedCollection(null);
  }, [activeVault?.vaultId, selectedCollection?.vaultId]);

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
      className={`shell app-window mode-${windowState?.mode ?? "expanded"}${macosWindowShell ? " platform-macos" : ""}${homeSurface ? " home-surface" : ""}${sidebarOpen ? " sidebar-expanded" : ""}${selectedNote || selectedCollection ? " note-mode" : ""}${dropActive ? " drop-active" : ""}`}
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
          <WindowModeToggle state={windowState} compactLabel={t("topbar.compact")} expandedLabel={t("topbar.expanded")} tabIndex={sidebarModal ? -1 : undefined} busy={windowControls.busy} onToggle={() => void windowControls.toggleWindowMode()} />
          <button
            type="button"
            className={windowState?.alwaysOnTop ? "icon-button pin-button active" : "icon-button pin-button"}
            aria-label={t("topbar.pin")}
            title={t("topbar.pin")}
            aria-pressed={windowState?.alwaysOnTop ?? false}
            aria-busy={windowControls.busy || undefined}
            disabled={windowState === null || windowControls.busy}
            tabIndex={sidebarModal ? -1 : undefined}
            onClick={() => void windowControls.toggleAlwaysOnTop()}
          >
            <PigeIcon name="pin" />
          </button>
        </div>
      </header>

      <div
        className={`main-layout${sidebarOpen ? " sidebar-open" : ""}${selectedNote || selectedCollection ? " note-open" : ""}${selectedNote && noteAgentOpen ? " agent-open" : ""}`}
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
        ) : selectedCollection && activeVault && selectedCollection.vaultId === activeVault.vaultId ? (
          <ManagedCollectionPanel
            activeVaultId={activeVault.vaultId}
            snapshot={selectedCollection.snapshot}
            onClose={() => {
              collectionOpenSequence.current += 1;
              const returnView = selectedCollection.returnView;
              if (returnView === "home") navigateHome();
              else {
                setSelectedCollection(null);
                setView(returnView);
              }
            }}
            onAddNullableColumn={addCollectionNullableColumn}
            onRenameColumn={renameCollectionColumn}
            onAppendDefaultRow={appendCollectionDefaultRow}
            onTrashRow={trashCollectionRow}
            onAdoptSnapshot={adoptCollectionSnapshot}
            onEditCell={editCollectionCell}
            onReload={reloadSelectedCollection}
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
            onOpenSourceReference={(request) => window.pige.notes.openSourceReference(request)}
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
            onOpenNoteEditor={(request) => window.pige.notes.openEditor(request)}
            onSaveNoteEditor={(request) => window.pige.notes.saveEditor(request)}
            onReloadNoteEditor={reloadNoteEditor}
            onNoteEditorCommitted={adoptCommittedNote}
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
              onOpenSourceReference={(request) => window.pige.notes.openSourceReference(request)}
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
              onOpenNoteEditor={(request) => window.pige.notes.openEditor(request)}
              onSaveNoteEditor={(request) => window.pige.notes.saveEditor(request)}
              onReloadNoteEditor={reloadNoteEditor}
              onNoteEditorCommitted={adoptCommittedNote}
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
            onOpenNoteEditor={(request) => window.pige.notes.openEditor(request)}
            onSaveNoteEditor={(request) => window.pige.notes.saveEditor(request)}
            onReloadNoteEditor={reloadNoteEditor}
            onOpenCollection={(datasetId, tableId) => openCollection(datasetId, tableId, "home")}
            draftText={homeDraftText}
            onDraftChange={setHomeDraftText}
            showFirstHomeGuide={onboarding?.showFirstHomeGuide === true}
            fileDropRequest={homeFileDropRequest}
            onFileDropRequestConsumed={(clientTurnId) => {
              setHomeFileDropRequest((current) => current?.clientTurnId === clientTurnId ? null : current);
            }}
            onFilesSelected={(files, inputKind, text, clientTurnId) =>
              submitFiles(files, inputKind, text, clientTurnId, "home")}
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
          developmentNotice={developmentNotice?.surface === "settings" ? developmentNotice : null}
          onSectionChange={(section) => {
            setSettingsSection(section);
            setDevelopmentNotice(null);
          }}
          onClose={closeSettings}
          onLocaleChange={updateLocale}
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
          ) : settingsSection === "vault" ? (
            activeVault ? (
              <VaultBackupSettingsPanel
                locale={locale}
                busy={busy}
                error={error}
                vault={activeVault}
                backupStatus={backupStatus}
                backupJobs={backupJobs}
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
          ) : settingsSection === "maintenance" ? (
            activeVault ? (
              <MaintenanceSettingsPanel
                activeVaultId={activeVault.vaultId}
                locale={locale}
                error={error}
                localDatabaseStatus={localDatabaseStatus}
                onRefresh={refreshVaultState}
                onRefreshDiagnostics={refreshDiagnostics}
                onOpenPage={async (pageId) => {
                  const opened = await openNoteTarget(pageId);
                  if (!opened) return false;
                  setView("library");
                  setSettingsOpen(false);
                  setDevelopmentNotice(null);
                  settingsOpenerRef.current = null;
                  window.requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>(".note-reader")?.focus();
                  });
                  return true;
                }}
                onError={setError}
                t={t}
              />
            ) : null
          ) : settingsSection === "general" ? (
            <GeneralSettingsPanel
              alwaysOnTop={windowState?.alwaysOnTop ?? null}
              alwaysOnTopBusy={windowControls.busy}
              onAlwaysOnTopChange={windowControls.toggleAlwaysOnTop}
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
              themePreference={appearanceSummary?.themePreference ?? null}
              themeBusy={appearanceThemeBusy}
              themeError={appearanceThemeError}
              onLocaleChange={updateLocale}
              onThemeChange={updateTheme}
              onDevelopment={() => showDevelopmentCapability("settings", "appearance")}
              t={t}
            />
          ) : settingsSection === "capabilities" ? (
            <LocalCapabilitiesSettingsPanel
              semanticRetrievalApi={window.pige.retrieval}
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
              activeVaultId={activeVault?.vaultId ?? null}
              t={t}
            />
          ) : settingsSection === "privacy" ? (
            <PermissionsPrivacySettingsPanel
              t={t}
            />
          ) : settingsSection === "skills" ? (
            <SkillsSettingsPanel
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
      {dropActive ? (
        <div className="drop-overlay" role="status" aria-live="polite" aria-atomic="true">
          {t("home.dropToCapture")}
        </div>
      ) : null}
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
  readonly onOpenSourceReference?: (
    request: NoteOpenSourceReferenceRequest
  ) => Promise<NoteOpenSourceReferenceResult>;
  readonly searchFocusRequest: number;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly onCloseNote: () => void;
  readonly noteAgentOpen: boolean;
  readonly onToggleNoteAgent: () => void;
  readonly noteAgentToggleRef: RefObject<HTMLButtonElement | null>;
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onClearDevelopment: () => void;
  readonly onCopyNote: (pageId: string) => Promise<boolean>;
  readonly onOpenNoteEditor?: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onSaveNoteEditor?: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
  readonly onReloadNoteEditor?: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onNoteEditorCommitted?: (result: Extract<NoteEditorSaveResult, { status: "committed" }>) => void;
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
  const editorOpenSequence = useRef(0);
  const editorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [readerActionState, setReaderActionState] = useState<"idle" | "copying" | "copied" | "copy_failed">("idle");
  const [editorReady, setEditorReady] = useState<NoteMarkdownEditorReady | null>(null);
  const [editorOpenState, setEditorOpenState] = useState<"idle" | "opening" | "failed">("idle");
  const normalizedQuery = query.trim();
  const activeVaultId = props.libraryList?.activeVaultId;

  useEffect(() => {
    readerActionSequence.current += 1;
    editorOpenSequence.current += 1;
    setReaderActionState("idle");
    setEditorReady(null);
    setEditorOpenState("idle");
  }, [props.activeVaultId, props.selectedNote?.summary.pageId, props.selectedNote?.renderContextId]);

  const openEditor = async (): Promise<void> => {
    const note = props.selectedNote;
    const activeVaultId = props.activeVaultId;
    const renderContextId = note?.renderContextId;
    if (!note || !activeVaultId || !renderContextId || !props.onOpenNoteEditor || editorOpenState === "opening") return;
    const sequence = editorOpenSequence.current + 1;
    editorOpenSequence.current = sequence;
    const request: NoteEditorOpenRequest = {
      apiVersion: 1,
      requestId: createNoteEditorRequestId(),
      activeVaultId,
      pageId: note.summary.pageId,
      renderContextId
    };
    setEditorOpenState("opening");
    try {
      const result = await props.onOpenNoteEditor(request);
      if (
        sequence !== editorOpenSequence.current ||
        props.activeVaultId !== request.activeVaultId ||
        props.selectedNote?.summary.pageId !== request.pageId ||
        props.selectedNote.renderContextId !== request.renderContextId
      ) return;
      if (noteEditorOpenMatches(request, result) && result.status === "ready" && result.renderContextId === renderContextId) {
        setEditorReady(result);
        setEditorOpenState("idle");
      } else setEditorOpenState("failed");
    } catch {
      if (sequence === editorOpenSequence.current) setEditorOpenState("failed");
    }
  };

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
    if (editorReady && props.onSaveNoteEditor && props.onReloadNoteEditor && props.onNoteEditorCommitted) {
      const onNoteEditorCommitted = props.onNoteEditorCommitted;
      return (
        <NoteMarkdownEditor
          ready={editorReady}
          labels={noteMarkdownEditorLabels(props.t)}
          returnFocusRef={editorOpenerRef}
          onSave={props.onSaveNoteEditor}
          onReload={props.onReloadNoteEditor}
          onCommitted={(result) => {
            editorOpenSequence.current += 1;
            setEditorReady(null);
            onNoteEditorCommitted(result);
          }}
          onCancel={() => setEditorReady(null)}
        />
      );
    }
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
              ref={editorOpenerRef}
              type="button"
              data-reader-action="edit"
              className={`icon-button${props.onOpenNoteEditor ? "" : " prototype-action"}`}
              aria-label={props.t("note.edit")}
              title={props.t("note.edit")}
              aria-busy={editorOpenState === "opening"}
              disabled={editorOpenState === "opening" || !props.selectedNote.renderContextId}
              onClick={props.onOpenNoteEditor ? () => void openEditor() : () => showReaderDevelopment("document_actions")}
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
          editorOpenState === "failed" ? (
            <p className="reader-action-status copy_failed" role="status" aria-live="polite">
              {props.t("note.editor.failed")}
            </p>
          ) : <DevelopmentStatus notice={props.developmentNotice} t={props.t} />
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
          {...(props.onOpenSourceReference ? { onOpenSourceReference: props.onOpenSourceReference } : {})}
          onOpenSourcePage={props.onOpenNote}
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

function resolveReaderSelection(request: ReaderSelectionResolveRequest): Promise<ReaderSelectionResolveResult> {
  return window.pige.readerSelection.resolve(request);
}

function submitReaderSelectionAction(request: ReaderSelectionActionRequest): Promise<ReaderSelectionActionResult> {
  return window.pige.readerSelection.submitAction(request);
}

function submitReaderSelectionTransform(request: ReaderSelectionTransformRequest): Promise<ReaderSelectionTransformResult> {
  return window.pige.readerSelection.submitTransform(request);
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

function attachmentRejectionMessageKey(reason: CaptureFileRejectionReason): string {
  switch (reason) {
    case "empty_path": return "home.attachmentRejection.emptyPath";
    case "missing": return "home.attachmentRejection.missing";
    case "not_regular_file": return "home.attachmentRejection.notRegularFile";
    case "unsupported_type": return "home.attachmentRejection.unsupportedType";
    case "duplicate": return "home.attachmentRejection.duplicate";
    case "too_many_files": return "home.attachmentRejection.tooManyFiles";
    case "file_too_large": return "home.attachmentRejection.fileTooLarge";
    case "total_size_exceeded": return "home.attachmentRejection.totalSizeExceeded";
    case "copy_failed": return "home.attachmentRejection.copyFailed";
  }
}

function HomeComposer(props: {
  readonly activeVault: VaultSummary | undefined;
  readonly agentRuntimeStatus: AgentRuntimeStatus | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly recentJobs: readonly JobSummary[];
  readonly locale: Locale;
  readonly onReaderSelectionAction: (result: ReaderSelectionActionResult) => void;
  readonly onOpenNoteEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onSaveNoteEditor: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
  readonly onReloadNoteEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onOpenCollection: (datasetId: string, tableId: string) => Promise<boolean>;
  readonly draftText: string;
  readonly onDraftChange: (text: string) => void;
  readonly showFirstHomeGuide: boolean;
  readonly fileDropRequest: HomeFileDropRequest | null;
  readonly onFileDropRequestConsumed: (clientTurnId: string) => void;
  readonly onFilesSelected: (
    files: readonly File[],
    inputKind: "file_drop" | "file_picker",
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
  const [conversationTimeline, setConversationTimeline] = useState<AgentConversationInitialTimeline | undefined>();
  const [pickerConversationAuthority, setPickerConversationAuthority] = useState<{
    readonly items: readonly StagedComposerItem[];
    readonly timeline: AgentConversationInitialTimeline | undefined;
  } | null>(null);
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
  const [stagedComposerItems, setStagedComposerItems] = useState<readonly StagedComposerItem[]>([]);
  const [attachmentSubmissionNotice, setAttachmentSubmissionNotice] = useState<{
    readonly acceptedCount: number;
    readonly rejectedFiles: readonly CaptureFileRejection[];
  } | null>(null);
  const [composerSubmitActive, setComposerSubmitActive] = useState(false);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [editorReady, setEditorReady] = useState<NoteMarkdownEditorReady | null>(null);
  const [editorOpenState, setEditorOpenState] = useState<"idle" | "opening" | "failed">("idle");
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationTimelineRef = useRef<HTMLElement | null>(null);
  const homeSectionRef = useRef<HTMLElement | null>(null);
  const processingPanelRef = useRef<HTMLElement | null>(null);
  const followConversationRef = useRef(true);
  const conversationPagination = useConversationPagination({
    ownerKey: props.activeVault ? `${props.activeVault.vaultId}:home` : "home:none",
    initial: conversationTimeline,
    scrollRef: conversationTimelineRef
  });
  const conversationCopySequenceRef = useRef(0);
  const conversationCopyResetTimerRef = useRef<number | undefined>(undefined);
  const composerSubmissionRef = useRef<HomeComposerSubmissionBinding | null>(null);
  const composerCompositionActiveRef = useRef(false);
  const composerCompositionRaceRef = useRef(false);
  const composerCompositionTimerRef = useRef<number | undefined>(undefined);
  const draftRevisionRef = useRef(0);
  const stagedAttachmentRevisionRef = useRef(0);
  const stagedComposerAttemptRef = useRef<{
    readonly key: string;
    readonly clientTurnId: string;
  } | null>(null);
  const noteOpenSequence = useRef(0);
  const editorOpenSequence = useRef(0);
  const editorOpenerRef = useRef<HTMLButtonElement | null>(null);
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
  const pickerConversationLoadSequence = useRef(0);
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

  useEffect(() => {
    editorOpenSequence.current += 1;
    setEditorReady(null);
    setEditorOpenState("idle");
  }, [props.activeVault?.vaultId, selectedNote?.summary.pageId, selectedNote?.renderContextId]);

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
  const followableTailJobId = canFollowUpToConversation(conversationTimeline)
    ? conversationTimeline.messages.find((message) =>
        message.id === conversationTimeline.tailEventId && message.role === "assistant"
      )?.jobId
    : undefined;
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
  const noSourceCurrentTurn = selectCurrentNoSourceTurn({
    latestTurn,
    recentJobs: followableTailJobId
      ? props.recentJobs.filter((job) => job.id !== followableTailJobId)
      : props.recentJobs,
    ...(activeAgentDraftRef.current?.jobId
      ? { activeDraftJobId: activeAgentDraftRef.current.jobId }
      : {})
  });
  const noSourceCancellableLatestTurn = noSourceCurrentTurn &&
    (noSourceCurrentTurn.state === "running" || noSourceCurrentTurn.state === "cancel_requested")
    ? noSourceCurrentTurn
    : undefined;
  const effectiveAgentRunState = noSourceCurrentTurn
    ? homeConversationStateForJob(noSourceCurrentTurn.state) ?? agentRunState
    : followableTailJobId &&
        !composerSubmitActive &&
        (!agentDraft?.jobId || agentDraft.jobId === followableTailJobId)
      ? "completed"
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
    message: AgentConversationInitialTimeline["messages"][number]
  ): string => message.inputPresentation
    ? props.t(message.inputPresentation.kind === "reader_selection_action"
      ? `note.selection.${message.inputPresentation.action}`
      : `note.proposal.action.${message.inputPresentation.action}`)
    : message.text;
  const visibleConversationMessages = conversationPagination.messages.filter((message) => {
    if (agentAnswer && message.role === "assistant" && message.id === liveAnswerEventId) return false;
    return message.answer?.datasetResult !== undefined || conversationMessageMarkdown(message).trim().length > 0;
  });
  const visibleOptimisticConversationTurns = optimisticConversationTurns.filter((turn) =>
    !(conversationPagination.messages.some((message) =>
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
  const showConversationTimeline = selectedNote === null && (visibleConversationMessages.length > 0 ||
    visibleOptimisticConversationTurns.length > 0 ||
    agentDraft !== null ||
    showConversationRunMessage ||
    liveConversationAnswer !== null);
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

  const beginComposerSubmission = (clientTurnId: string): boolean => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId || composerSubmissionRef.current) return false;
    composerSubmissionRef.current = { vaultId, clientTurnId };
    setComposerSubmitActive(true);
    return true;
  };

  const finishComposerSubmission = (clientTurnId: string): void => {
    if (composerSubmissionRef.current?.clientTurnId !== clientTurnId) return;
    composerSubmissionRef.current = null;
    setComposerSubmitActive(false);
  };

  const refreshConversationResult = async (expectedConversationId?: string): Promise<
    | { readonly status: "adopted"; readonly timeline: AgentConversationInitialTimeline | undefined }
    | { readonly status: "ignored" | "failed" }
  > => {
    const vaultId = props.activeVault?.vaultId;
    if (!vaultId) {
      setConversationTimeline(undefined);
      return { status: "adopted", timeline: undefined };
    }
    const requestId = conversationLoadSequence.current + 1;
    conversationLoadSequence.current = requestId;
    try {
      const nextTimeline = await window.pige.agent.conversation({ limit: 100 });
      if (requestId === conversationLoadSequence.current && activeVaultIdRef.current === vaultId) {
        if (expectedConversationId && nextTimeline?.conversationId !== expectedConversationId) {
          return { status: "ignored" };
        }
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
          return { status: "adopted", timeline: nextTimeline };
        }
      }
      return { status: "ignored" };
    } catch {
      return { status: "failed" };
    }
  };

  const refreshConversation = async (): Promise<AgentConversationInitialTimeline | undefined> => {
    const result = await refreshConversationResult();
    return result.status === "adopted" ? result.timeline : undefined;
  };

  const acceptedTurnProjection = useHomeAcceptedTurnProjection({
    activeVaultId: props.activeVault?.vaultId,
    timeline: conversationTimeline,
    refreshConversation: (conversationId) => refreshConversationResult(conversationId),
    onExhausted: () => setCaptureError(props.t("error.generic"))
  });

  useEffect(() => {
    const items = stagedComposerItems;
    const vaultId = props.activeVault?.vaultId;
    const expectedConversationId = conversationTimeline?.conversationId;
    const sequence = pickerConversationLoadSequence.current + 1;
    pickerConversationLoadSequence.current = sequence;
    setPickerConversationAuthority(null);
    if (!vaultId || items.length === 0) return;
    let retryTimer: number | undefined;
    const adoptCurrentConversation = async (): Promise<void> => {
      const result = await refreshConversationResult(expectedConversationId);
      if (
        sequence !== pickerConversationLoadSequence.current ||
        activeVaultIdRef.current !== vaultId
      ) return;
      if (
        result.status === "adopted" &&
        (
          (result.timeline === undefined && expectedConversationId === undefined) ||
          canFollowUpToConversation(result.timeline)
        )
      ) {
        setPickerConversationAuthority({ items, timeline: result.timeline });
        return;
      }
      retryTimer = window.setTimeout(() => void adoptCurrentConversation(), 1_200);
    };
    void adoptCurrentConversation();
    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [props.activeVault?.vaultId, stagedComposerItems]);

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
    if (composerSubmissionRef.current?.vaultId !== props.activeVault?.vaultId) {
      composerSubmissionRef.current = null;
      setComposerSubmitActive(false);
    }
    conversationLoadSequence.current += 1;
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    setNoteLoadingPageId(null);
    setConversationTimeline(undefined);
    locallyCompletedConversationTailRef.current = null;
    setOptimisticConversationTurns([]);
    stagedAttachmentRevisionRef.current += 1;
    stagedComposerAttemptRef.current = null;
    setStagedComposerItems([]);
    setLiveAnswerEventId(null);
    setAgentAnswer(null);
    clearAgentDraft();
    setAgentError(null);
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
    acceptedTurnProjection.clear();
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
    const nextState = homeConversationStateForJob(latestTurn.state);
    if (nextState) setAgentRunState(nextState);
    setAgentError(latestTurn.error ?? null);
    if (
      latestTurn.state !== "queued" &&
      latestTurn.state !== "running" &&
      !composerSubmissionRef.current
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
    if (!latestTurn || !isTerminalConversationTurn(latestTurn.state)) return;
    const submission = composerSubmissionRef.current;
    if (submission && conversationTimeline && terminalTurnOwnsComposerSubmission({
      conversationId: conversationTimeline.conversationId,
      latestTurn,
      ...(activeAgentDraftRef.current ? { activeDraft: activeAgentDraftRef.current } : {}),
      submission,
      activeVaultId: activeVaultIdRef.current
    })) {
      finishComposerSubmission(submission.clientTurnId);
      clearAgentDraft();
    }
    void props.onHomeStateChanged().catch(() => undefined);
  }, [
    agentDraft?.conversationId,
    agentDraft?.jobId,
    composerSubmitActive,
    latestTurn?.jobId,
    latestTurn?.state
  ]);

  useEffect(() => {
    if (!props.activeVault?.vaultId || !isConversationPollingState(latestTurn?.state)) return;
    const timer = window.setInterval(() => void refreshConversation(), 1_200);
    return () => window.clearInterval(timer);
  }, [props.activeVault?.vaultId, latestTurn?.jobId, latestTurn?.state]);

  const submitHomeInput = async (): Promise<void> => {
    const hasText = text.trim().length > 0;
    const hasRejectedPaste = stagedComposerItems.some((item) => item.kind === "rejected_pasted_text");
    const hasAttachments = stagedComposerItems.length > 0;
    if (
      (!hasText && !hasAttachments) ||
      (!homeModelSendAvailable && !hasAttachments) ||
      (hasAttachments && pickerConversationAuthority?.items !== stagedComposerItems) ||
      modelSwitching ||
      composerSubmissionRef.current
    ) return;
    if (hasRejectedPaste) {
      setCaptureError(props.t("home.largePasteRejectedSubmissionBlocked"));
      return;
    }
    if (hasAttachments) {
      const submittedVaultId = activeVaultIdRef.current;
      if (!submittedVaultId) return;
      const submittedItems = stagedComposerItems;
      const submittedText = text;
      const submittedDraftRevision = draftRevisionRef.current;
      const submittedAttachmentRevision = stagedAttachmentRevisionRef.current;
      const stagedItems = toAgentStagedItems(submittedItems);
      const submittedFiles = submittedItems
        .filter((item): item is Extract<StagedComposerItem, { kind: "file" }> => item.kind === "file")
        .map((item) => item.file);
      const turnText = hasText ? submittedText : props.t("home.useAttachedFilesAsSourceIntent");
      const sourceDisplayName = submittedItems[0]?.kind === "file" ? submittedItems[0].file.name : props.t("home.pastedText");
      const attemptKey = composerAttemptKey(submittedText, submittedItems);
      const clientTurnId = stagedComposerAttemptRef.current?.key === attemptKey
        ? stagedComposerAttemptRef.current.clientTurnId : createAgentClientTurnId();
      const adoptedTimeline = pickerConversationAuthority?.items === submittedItems
        ? pickerConversationAuthority.timeline
        : undefined;
      const followUpConversation = canFollowUpToConversation(adoptedTimeline)
        ? adoptedTimeline
        : undefined;
      stagedComposerAttemptRef.current = { key: attemptKey, clientTurnId };
      followConversationRef.current = true;
      if (!beginComposerSubmission(clientTurnId)) return;
      setCaptureError(null);
      setAttachmentSubmissionNotice(null);
      setAgentError(null);
      setAgentAnswer(null);
      setLiveAnswerEventId(null);
      setAgentModelUsage("none");
      setAgentRunState("accepted");
      setActiveSourceTurn({ clientTurnId, jobId: null, pending: true, sourceDisplayName });
      noteOpenSequence.current += 1;
      inlineReferenceSequence.current += 1;
      setSelectedNote(null);
      setSelectedNoteRelated(null);
      setOptimisticConversationTurns((current) => [
        ...current,
        {
          clientTurnId,
          text: turnText,
          attachmentNames: submittedItems.map((item) => item.kind === "file"
            ? item.file.name
            : props.t("home.pastedText"))
        }
      ]);
      beginAgentDraft(clientTurnId);
      try {
        const outcome = await window.pige.agent.submitTurn({
          schemaVersion: 1,
          ...(hasText ? { text: submittedText } : {}),
          inputKind: "file_picker",
          locale: props.locale,
          stagedItems,
          clientTurnId,
          ...(followUpConversation ? {
            conversationId: followUpConversation.conversationId,
            expectedTailEventId: followUpConversation.tailEventId
          } : {})
        }, submittedFiles);
        if (outcome.state !== "accepted") {
          clearAgentDraft();
          setActiveSourceTurn(null);
          setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
          setAgentError(outcome.error);
          setAgentRunState("failed");
          void refreshConversation();
          return;
        }
        stagedComposerAttemptRef.current = null;
        if (draftRevisionRef.current === submittedDraftRevision) {
          draftRevisionRef.current += 1;
          props.onDraftChange("");
        }
        if (stagedAttachmentRevisionRef.current === submittedAttachmentRevision) {
          stagedAttachmentRevisionRef.current += 1;
          setStagedComposerItems([]);
        }
        if (outcome.rejectedItems?.length) {
          setAttachmentSubmissionNotice({
            acceptedCount: outcome.acceptedItems?.length ?? outcome.sourceIds.length,
            rejectedFiles: outcome.rejectedItems.map((item) => ({
              displayName: item.displayName,
              reason: item.reason
            }))
          });
        }
        setActiveSourceTurn({
          clientTurnId,
          jobId: outcome.jobId,
          pending: false,
          sourceDisplayName
        });
        if (activeVaultIdRef.current === submittedVaultId) {
          acceptedTurnProjection.bind({
            activeVaultId: submittedVaultId,
            clientTurnId,
            conversationId: outcome.conversationId,
            conversationEventId: outcome.conversationEventId,
            jobId: outcome.jobId
          });
        }
        setOptimisticConversationTurns((current) => current.map((turn) =>
          turn.clientTurnId === clientTurnId
            ? {
                ...turn,
                conversationEventId: outcome.conversationEventId,
                jobId: outcome.jobId
              }
            : turn
        ));
        setAgentRunState("running");
        await props.onHomeStateChanged().catch(() => undefined);
        void refreshConversation();
      } catch {
        clearAgentDraft();
        setActiveSourceTurn(null);
        setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
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
        finishComposerSubmission(clientTurnId);
      }
      return;
    }
    followConversationRef.current = true;
    setCaptureError(null);
    setAttachmentSubmissionNotice(null);
    setAgentError(null);
    setAgentRunState("idle");
    setAgentModelUsage("none");
    setActiveSourceTurn(null);
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    const submittedText = text;
    const turnText = submittedText;
    const submittedVaultId = activeVaultIdRef.current;
    const submittedDraftRevision = draftRevisionRef.current;
    const clearedDraftRevision = submittedDraftRevision + 1;
    const attemptKey = composerAttemptKey(submittedText, []);
    const clientTurnId = stagedComposerAttemptRef.current?.key === attemptKey
      ? stagedComposerAttemptRef.current.clientTurnId
      : createAgentClientTurnId();
    if (!beginComposerSubmission(clientTurnId)) return;
    stagedComposerAttemptRef.current = { key: attemptKey, clientTurnId };
    draftRevisionRef.current = clearedDraftRevision;
    props.onDraftChange("");
    setOptimisticConversationTurns((current) => [
      ...current,
      { clientTurnId, text: turnText, attachmentNames: [] }
    ]);
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
        stagedComposerAttemptRef.current = null;
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
        props.onDraftChange(submittedText);
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
          setConversationTimeline((current) => projectCompletedConversation(current, outcome, completedAt, turnText));
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
        stagedComposerAttemptRef.current = null;
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
          props.onDraftChange(submittedText);
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
      finishComposerSubmission(clientTurnId);
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
      composerSubmissionRef.current ||
      (stagedComposerItems.length > 0 && pickerConversationAuthority?.items !== stagedComposerItems) ||
      (!homeModelSendAvailable && stagedComposerItems.length === 0) ||
      modelSwitching ||
      agentRunState === "accepted" ||
      agentRunState === "running" ||
      (!text.trim() && stagedComposerItems.length === 0)
    ) {
      return;
    }
    void submitHomeInput();
  };

  const submitHomeFiles = async (
    files: readonly File[],
    inputKind: "file_drop" | "file_picker",
    submittedText: string | undefined,
    clientTurnId: string
  ): Promise<void> => {
    const sourceDisplayName = files[0]?.name ?? null;
    setCaptureError(null);
    setAttachmentSubmissionNotice(null);
    setAgentAnswer(null);
    setLiveAnswerEventId(null);
    setAgentError(null);
    setAgentModelUsage("none");
    setAgentRunState("running");
    setActiveSourceTurn({ clientTurnId, jobId: null, pending: true, sourceDisplayName });
    beginAgentDraft(clientTurnId);
    try {
      const result = await props.onFilesSelected(files, inputKind, submittedText, clientTurnId);
      clearAgentDraft();
      if (!result) {
        setActiveSourceTurn(null);
        setAgentRunState("failed");
        return;
      }
      if (result.rejectedFiles?.length) {
        setAttachmentSubmissionNotice({
          acceptedCount: result.sourceIds.length,
          rejectedFiles: result.rejectedFiles
        });
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
    if (
      !request ||
      composerSubmissionRef.current ||
      handledFileDropClientTurnIdRef.current === request.clientTurnId
    ) return;
    handledFileDropClientTurnIdRef.current = request.clientTurnId;
    if (!beginComposerSubmission(request.clientTurnId)) return;
    props.onFileDropRequestConsumed(request.clientTurnId);
    void submitHomeFiles(request.files, "file_drop", request.text, request.clientTurnId)
      .finally(() => {
        finishComposerSubmission(request.clientTurnId);
      });
  }, [props.fileDropRequest?.clientTurnId, composerSubmitActive]);

  const retryLatestConversationTurn = async (): Promise<void> => {
    if (!retryableLatestTurn) return;
    setAgentError(null);
    setAgentRunState("accepted");
    await props.onRetryJob(retryableLatestTurn.jobId);
    const nextTimeline = await refreshConversation();
    const nextState = homeConversationStateForJob(nextTimeline?.latestTurn?.state);
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

  const openEditor = async (): Promise<void> => {
    const note = selectedNoteRef.current;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    if (!note || !activeVaultId || !renderContextId || editorOpenState === "opening") return;
    const sequence = editorOpenSequence.current + 1;
    editorOpenSequence.current = sequence;
    const request: NoteEditorOpenRequest = {
      apiVersion: 1,
      requestId: createNoteEditorRequestId(),
      activeVaultId,
      pageId: note.summary.pageId,
      renderContextId
    };
    setEditorOpenState("opening");
    try {
      const result = await props.onOpenNoteEditor(request);
      if (
        sequence !== editorOpenSequence.current ||
        activeVaultIdRef.current !== request.activeVaultId ||
        selectedNoteRef.current?.summary.pageId !== request.pageId ||
        selectedNoteRef.current.renderContextId !== request.renderContextId
      ) return;
      if (noteEditorOpenMatches(request, result) && result.status === "ready" && result.renderContextId === renderContextId) {
        setEditorReady(result);
        setEditorOpenState("idle");
      } else setEditorOpenState("failed");
    } catch {
      if (sequence === editorOpenSequence.current) setEditorOpenState("failed");
    }
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
          tabIndex={-1}
          aria-label={props.t("home.conversation")}
          aria-busy={agentDraft !== null || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running"}
          onScroll={(event) => {
            const timeline = event.currentTarget;
            followConversationRef.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
          }}
        >
          <div className="conversation-timeline-content">
            <ConversationEarlierControl
              hasEarlier={conversationPagination.hasEarlier}
              loading={conversationPagination.loading}
              failed={conversationPagination.failed}
              onLoadEarlier={conversationPagination.loadEarlier}
              t={props.t}
            />
            <TaskExecutionInteractionStatus t={props.t} />
            {visibleConversationMessages.map((message) => {
            const markdown = conversationMessageMarkdown(message);
            return (
              <article
                className={`conversation-message role-${message.role}`}
                data-message-id={message.id}
                data-input-presentation={message.inputPresentation?.kind}
                key={message.id}
                tabIndex={-1}
              >
                <span className="conversation-message-role visually-hidden">
                  {props.t(message.role === "user" ? "home.userMessage" : "home.assistantMessage")}
                </span>
                {message.answer?.datasetResult ? (
                  <DatasetAnswerResult
                    answer={message.answer}
                    modelUsage="none"
                    onOpenCollection={props.onOpenCollection}
                    t={props.t}
                  />
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
              {turn.attachmentNames.length > 0 ? (
                <div className="conversation-attachment-list" aria-label={props.t("home.attachedFiles")}>
                  {turn.attachmentNames.map((name, index) => (
                    <span className="conversation-attachment" key={`${name}-${index}`}>{name}</span>
                  ))}
                </div>
              ) : null}
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
          </div>
          <ConversationScrollRail timelineRef={conversationTimelineRef} t={props.t} />
        </section>
      ) : null}
      {selectedNote ? (
        <section className="home-reader">
          {editorReady ? (
            <NoteMarkdownEditor
              ready={editorReady}
              labels={noteMarkdownEditorLabels(props.t)}
              returnFocusRef={editorOpenerRef}
              onSave={props.onSaveNoteEditor}
              onReload={props.onReloadNoteEditor}
              onCommitted={(result) => {
                editorOpenSequence.current += 1;
                setEditorReady(null);
                setSelectedNote(result.render);
                void props.onHomeStateChanged();
              }}
              onCancel={() => setEditorReady(null)}
            />
          ) : (
            <>
              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="ghost back-button"
                  onClick={() => {
                    noteOpenSequence.current += 1;
                    inlineReferenceSequence.current += 1;
                    editorOpenSequence.current += 1;
                    setSelectedNote(null);
                    setSelectedNoteRelated(null);
                  }}
                >
                  {props.t("retrieval.backToResults")}
                </button>
                <button
                  ref={editorOpenerRef}
                  type="button"
                  className="ghost"
                  aria-busy={editorOpenState === "opening"}
                  disabled={editorOpenState === "opening" || !selectedNote.renderContextId}
                  onClick={() => void openEditor()}
                >
                  {props.t("note.edit")}
                </button>
              </div>
              {editorOpenState === "failed" ? (
                <p className="reader-action-status copy_failed" role="status" aria-live="polite">
                  {props.t("note.editor.failed")}
                </p>
              ) : null}
              <NoteReader
                note={selectedNote}
                {...(props.activeVault && selectedNote.renderContextId ? {
                  activeVaultId: props.activeVault.vaultId,
                  onResolveSelection: resolveReaderSelection,
                  onSubmitSelectionAction: submitReaderSelectionAction,
                  onOpenSourceReference: (request) => window.pige.notes.openSourceReference(request),
                  onOpenSourcePage: openResult
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
            </>
          )}
        </section>
      ) : agentAnswer?.datasetResult ? (
        <DatasetAnswerResult
          answer={agentAnswer}
          modelUsage={agentModelUsage}
          onOpenCollection={props.onOpenCollection}
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
        {stagedComposerItems.length > 0 ? (
          <div className="attachment-strip visible" aria-label={props.t("home.messageItems")}>
            <div className="attachment-list">
              {stagedComposerItems.map((item) => {
                const label = item.kind === "file" ? item.file.name : props.t("home.pastedText");
                const isPastedText = item.kind !== "file";
                return (
                <div
                  className={`attachment-chip${isPastedText ? " pasted-text-chip" : ""}${item.kind === "rejected_pasted_text" ? " rejected-pasted-text-chip" : ""}`}
                  key={item.localId}
                >
                  <span className="attachment-chip-copy">
                    <strong>{label}</strong>
                    {isPastedText ? (
                      <small>{props.t("home.pastedTextMeta")
                        .replace("{characters}", new Intl.NumberFormat(props.locale).format(item.unicodeCodePointCount))
                        .replace("{size}", formatByteCount(item.utf8ByteSize, props.locale))}</small>
                    ) : null}
                    {item.kind === "rejected_pasted_text" ? (
                      <small className="attachment-chip-rejection" role="status">
                        {props.t(largePasteRejectionMessageKey(item.reason))}
                      </small>
                    ) : null}
                  </span>
                  <button
                    className="chip-remove"
                    type="button"
                    aria-label={`${props.t(item.kind === "file" ? "home.removeAttachment" : "home.removePastedText")} ${label}`}
                    onClick={() => {
                      stagedAttachmentRevisionRef.current += 1;
                      stagedComposerAttemptRef.current = null;
                      setAttachmentSubmissionNotice(null);
                      setCaptureError(null);
                      setStagedComposerItems((current) => current.filter((currentItem) => currentItem.localId !== item.localId));
                      window.requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }));
                    }}
                  >
                    <PigeIcon name="close" size={13} />
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {attachmentSubmissionNotice ? (
          <section
            className="attachment-submission-notice"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <strong>{props.t(attachmentSubmissionNotice.acceptedCount > 0
              ? "home.attachmentsPartiallyAccepted"
              : "home.attachmentsRejected")}</strong>
            <ul>
              {attachmentSubmissionNotice.rejectedFiles.map((rejection, index) => (
                <li key={`${rejection.displayName}-${rejection.reason}-${index}`}>
                  <span>{rejection.displayName}</span>
                  <small>{props.t(attachmentRejectionMessageKey(rejection.reason))}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <textarea
          ref={composerInputRef}
          data-home-composer="true"
          aria-label={props.t("home.composerAria")}
          placeholder={props.t("home.placeholder")}
          rows={4}
          value={text}
          onPaste={(event) => handleComposerPaste(event, text, stagedComposerItems, (classification) => {
            stagedAttachmentRevisionRef.current += 1;
            stagedComposerAttemptRef.current = null;
            setAttachmentSubmissionNotice(null);
            setCaptureError(null);
            setStagedComposerItems((current) => [...current, classification.kind === "staged"
              ? { kind: "pasted_text", ...classification.item }
              : { kind: "rejected_pasted_text", reason: classification.reason, ...classification.item }]);
          })}
          onChange={(event) => {
            draftRevisionRef.current += 1;
            stagedComposerAttemptRef.current = null;
            setAttachmentSubmissionNotice(null);
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
            multiple
            accept=".md,.markdown,.txt,.pdf,.docx,.pptx,.csv,.xlsx,.sqlite,.sqlite3,.db,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,text/plain,text/markdown,image/*"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length === 0) return;
              const acceptedItemCount = stagedComposerItems.filter((item) => item.kind !== "rejected_pasted_text").length;
              const availableItemCount = Math.max(0, AGENT_STAGED_ITEM_MAX_COUNT - acceptedItemCount);
              const acceptedFiles = files.slice(0, availableItemCount);
              if (acceptedFiles.length === 0) {
                setCaptureError(props.t("home.attachmentRejection.tooManyFiles"));
                return;
              }
              stagedAttachmentRevisionRef.current += 1;
              stagedComposerAttemptRef.current = null;
              setAttachmentSubmissionNotice(null);
              setStagedComposerItems((current) => [
                ...current,
                ...acceptedFiles.map((file) => ({
                  kind: "file" as const,
                  localId: createComposerItemId("file"),
                  file
                }))
              ]);
              setCaptureError(acceptedFiles.length < files.length
                ? props.t("home.attachmentRejection.tooManyFiles")
                : null);
              window.requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }));
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
            title={props.t("home.attachToMessage")}
            aria-label={props.t("home.attachToMessage")}
            onClick={() => fileInputRef.current?.click()}
          >
            <PigeIcon name="attach" size={17} />
          </button>
          <button
            type="button"
            className="composer-send"
            aria-label={props.t("home.send")}
            title={!homeModelSendAvailable && stagedComposerItems.length === 0 ? props.t("home.modelUnavailable") : undefined}
            disabled={
              (!text.trim() && stagedComposerItems.length === 0) ||
              (!homeModelSendAvailable && stagedComposerItems.length === 0) ||
              (stagedComposerItems.length > 0 && pickerConversationAuthority?.items !== stagedComposerItems) ||
              modelSwitching ||
              effectiveAgentRunState === "accepted" ||
              effectiveAgentRunState === "running"
            }
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
        {captureError ? <p className="error" role="alert">{captureError}</p> : null}
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

function isConversationPollingState(state: JobState | undefined): boolean {
  return state === "queued" ||
    state === "running" ||
    state === "waiting_dependency" ||
    state === "cancel_requested";
}

function canFollowUpToConversation(timeline: AgentConversationInitialTimeline | undefined): timeline is AgentConversationInitialTimeline {
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

function composerAttemptKey(text: string, items: readonly StagedComposerItem[]): string {
  return JSON.stringify([
    text,
    items.map((item) => item.kind === "file"
      ? [item.kind, item.localId, item.file.name, item.file.size, item.file.type, item.file.lastModified]
      : [item.kind, item.localId, item.unicodeCodePointCount, item.utf8ByteSize])
  ]);
}
function createComposerItemId(kind: "file" | "paste"): string {
  return `${kind}_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function handleComposerPaste(
  event: ReactClipboardEvent<HTMLTextAreaElement>,
  composerText: string,
  stagedItems: readonly StagedComposerItem[],
  onStage: (classification: Exclude<HomeLargePasteClassification, { readonly kind: "ordinary" }>) => void
): void {
  const pastedText = event.clipboardData.getData("text/plain");
  if (!pastedText) return;
  const selectionStart = event.currentTarget.selectionStart ?? composerText.length;
  const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
  const resultingText = `${composerText.slice(0, selectionStart)}${pastedText}${composerText.slice(selectionEnd)}`;
  if (Array.from(resultingText).length <= AGENT_AUTHORED_TEXT_MAX_CODE_POINTS) return;
  const utf8ByteSize = new TextEncoder().encode(pastedText).byteLength;
  const item: StagedPastedTextItem = {
    localId: createComposerItemId("paste"),
    text: pastedText,
    unicodeCodePointCount: Array.from(pastedText).length,
    utf8ByteSize
  };
  const acceptedItems = stagedItems.filter((stagedItem) => stagedItem.kind !== "rejected_pasted_text");
  const aggregatePasteBytes = acceptedItems.reduce((total, stagedItem) =>
    total + (stagedItem.kind === "pasted_text" ? stagedItem.utf8ByteSize : 0), 0);
  const classification: HomeLargePasteClassification = acceptedItems.length >= AGENT_STAGED_ITEM_MAX_COUNT
    ? { kind: "rejected", item, reason: "item_limit" }
    : utf8ByteSize > AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES
      ? { kind: "rejected", item, reason: "item_too_large" }
      : aggregatePasteBytes + utf8ByteSize > AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES
        ? { kind: "rejected", item, reason: "aggregate_too_large" }
        : { kind: "staged", item };
  event.preventDefault();
  onStage(classification);
}
function toAgentStagedItems(items: readonly StagedComposerItem[]): readonly AgentStagedItem[] {
  return items
    .filter((item) => item.kind !== "rejected_pasted_text")
    .map((item, ordinal) => item.kind === "file"
      ? { kind: "file", ordinal, displayName: item.file.name }
      : {
          kind: "large_paste",
          ordinal,
          text: item.text,
          unicodeCodePointCount: item.unicodeCodePointCount,
          utf8ByteSize: item.utf8ByteSize
        });
}

function largePasteRejectionMessageKey(reason: AgentStagedItemRejectionReason): string {
  return reason === "item_limit" ? "home.largePasteRejectedItemLimit"
    : reason === "aggregate_too_large" ? "home.largePasteRejectedAggregateLimit" : "home.largePasteRejectedItemTooLarge";
}

function formatByteCount(byteCount: number, locale: Locale): string {
  if (byteCount < 1_024) return `${new Intl.NumberFormat(locale).format(byteCount)} B`;
  const kibibytes = byteCount / 1_024;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: kibibytes < 10 ? 1 : 0 }).format(kibibytes)} KiB`;
}

function createNoteReferenceRequestId(): string {
  return `noteref_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createNoteEditorRequestId(): `noteeditreq_${string}` {
  return `noteeditreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function noteEditorOpenMatches(request: NoteEditorOpenRequest, result: NoteEditorOpenResult): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.pageId === request.pageId;
}

function failedNoteEditorOpenResult(request: NoteEditorOpenRequest): NoteEditorOpenResult {
  return {
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId,
    status: "failed"
  };
}

function noteMarkdownEditorLabels(t: (key: string) => string): NoteMarkdownEditorLabels {
  return {
    title: t("note.editor.title"),
    field: t("note.editor.field"),
    save: t("note.editor.save"),
    saving: t("note.editor.saving"),
    cancel: t("note.editor.cancel"),
    reload: t("note.editor.reload"),
    reloading: t("note.editor.reloading"),
    stale: t("note.editor.stale"),
    failed: t("note.editor.failed"),
    notFound: t("note.editor.notFound"),
    reloaded: t("note.editor.reloaded"),
    invalid: {
      markdown_too_large: t("note.editor.invalid.markdownTooLarge"),
      invalid_frontmatter: t("note.editor.invalid.frontmatter"),
      page_id_changed: t("note.editor.invalid.pageId"),
      unsupported_page_type: t("note.editor.invalid.pageType"),
      invalid_wiki_link: t("note.editor.invalid.wikiLink"),
      invalid_citation: t("note.editor.invalid.citation")
    }
  };
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function collectionOpenIdentityMatches(
  request: CollectionOpenRequest,
  result: CollectionOpenResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId;
}

function collectionAppendIdentityMatches(
  request: CollectionAppendDefaultRowRequest,
  result: CollectionAppendDefaultRowResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId;
}

function collectionColumnIdentityMatches(
  request: CollectionAddNullableColumnRequest,
  result: CollectionAddNullableColumnResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId;
}

function collectionRenameIdentityMatches(
  request: CollectionRenameColumnRequest,
  result: CollectionRenameColumnResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId &&
    result.columnId === request.columnId;
}

function collectionTrashIdentityMatches(
  request: CollectionTrashRowRequest,
  result: CollectionTrashRowResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId &&
    result.rowId === request.rowId;
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

export function DatasetAnswerResult(props: {
  readonly answer: AgentTurnAnswer;
  readonly modelUsage: HomeAgentModelUsage;
  readonly onOpenCollection?: (datasetId: string, tableId: string) => Promise<boolean>;
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
        {props.onOpenCollection ? (
          <button
            type="button"
            className="settings-button"
            onClick={() => void props.onOpenCollection?.(result.datasetId, result.tableId)}
          >
            {props.t("collection.open")}
          </button>
        ) : null}
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
  readonly developmentNotice: DevelopmentNotice | null;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly onClose: () => void;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onDevelopment: (capability: DevelopmentCapability) => void;
  readonly t: (key: string) => string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const compactCloseButtonRef = useRef<HTMLButtonElement>(null);
  const compactNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const compactSettings = useMediaQuery("(max-width: 520px)");
  const [compactNavigationOpen, setCompactNavigationOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const sectionMatches = (section: SettingsSection): boolean => normalizedQuery.length === 0 || props.t(`settings.section.${section}`).toLocaleLowerCase().includes(normalizedQuery);
  const matchingSectionCount = settingsSections.filter((item) => sectionMatches(item.id)).length;
  useEffect(() => {
    if (compactSettings) compactCloseButtonRef.current?.focus();
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
              <button ref={compactCloseButtonRef} type="button" className="icon-button settings-compact-return" title={props.t("settings.close")} aria-label={props.t("settings.close")} onClick={props.onClose}><PigeIcon name="arrowLeft" size={17} /></button>
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
  readonly alwaysOnTop: boolean | null;
  readonly alwaysOnTopBusy: boolean;
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
              aria-checked={props.alwaysOnTop ?? false}
              aria-busy={props.alwaysOnTopBusy || undefined}
              disabled={props.alwaysOnTop === null || props.alwaysOnTopBusy}
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
  readonly themePreference: AppearanceThemePreference | null;
  readonly themeBusy: boolean;
  readonly themeError: string | null;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onThemeChange: (themePreference: AppearanceThemePreference) => Promise<boolean>;
  readonly onDevelopment: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const themeChoices = ["system", "light", "dark"] as const;
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState(false);

  useEffect(() => {
    setLanguageError(false);
  }, [props.locale]);

  const changeLanguage = async (nextLocale: Locale): Promise<void> => {
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

  const moveThemeFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = themeChoices.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % themeChoices.length;
    else nextIndex = (index - 1 + themeChoices.length) % themeChoices.length;
    themeOptionRefs.current[nextIndex]?.focus();
    if (!props.themeBusy) void props.onThemeChange(themeChoices[nextIndex]!);
  };

  return (
    <section className="settings-page appearance-settings-page" aria-labelledby="settings-appearance-title">
      <header className="settings-panel-header">
        <h1 id="settings-appearance-title">{props.t("appearance.title")}</h1>
        <p>{props.t("appearance.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="appearance-theme-title">
        <h2 className="settings-section-title" id="appearance-theme-title">{props.t("appearance.theme")}</h2>
        <div
          className="theme-grid"
          role="radiogroup"
          aria-labelledby="appearance-theme-title"
          aria-describedby={props.themeError ? "appearance-theme-error" : undefined}
          aria-busy={props.themeBusy}
        >
          {themeChoices.map((choice, index) => (
            <button
              key={choice}
              ref={(element) => { themeOptionRefs.current[index] = element; }}
              className={`theme-option${props.themePreference === choice ? " active" : ""}`}
              type="button"
              role="radio"
              aria-checked={props.themePreference === choice}
              tabIndex={props.themePreference === choice || (props.themePreference === null && index === 0) ? 0 : -1}
              disabled={props.themePreference === null || props.themeBusy}
              onClick={() => void props.onThemeChange(choice)}
              onKeyDown={(event) => moveThemeFocus(event, index)}
            >
              <span className={`theme-preview ${choice}`} aria-hidden="true" />
              <span>{props.t(`appearance.theme.${choice}`)}</span>
            </button>
          ))}
        </div>
        {props.themeError ? (
          <p className="settings-inline-status error" id="appearance-theme-error" role="status">{props.themeError}</p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="appearance-language-title">
        <h2 className="settings-section-title" id="appearance-language-title">{props.t("appearance.language")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("appearance.appLanguage")}</strong>
              <span id="appearance-app-language-description">{props.t("appearance.appLanguageDescription")}</span>
            </div>
            <select
              className="settings-select"
              value={props.locale}
              disabled={languageBusy}
              aria-label={props.t("appearance.appLanguage")}
              aria-describedby={`appearance-app-language-description${languageError ? " appearance-language-error" : ""}`}
              onChange={(event) => void changeLanguage(event.target.value as Locale)}
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
        {languageError ? (
          <p className="settings-inline-status error" id="appearance-language-error" role="status">
            {props.t("appearance.languageUpdateFailed")}
          </p>
        ) : null}
      </section>

      <p className="settings-note" id="appearance-partial-note">{props.t("appearance.partialNote")}</p>
    </section>
  );
}

export function PermissionsPrivacySettingsPanel(props: {
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
              <span>{props.t("privacy.cloudPolicyDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.cloudPolicyStatus")}</span>
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
    </section>
  );
}

export function LocalCapabilitiesSettingsPanel(props: {
  readonly semanticRetrievalApi: LocalSemanticRetrievalApi;
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

      <LocalSemanticRetrievalSettingsPanel api={props.semanticRetrievalApi} t={props.t} />

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
              const activityMessageKey = activity.kind === "update_collection_cell"
                ? "activity.updatedCollection"
                : activity.kind === "trash_collection_row"
                  ? "activity.trashedCollectionRow"
                : activity.kind === "update_page"
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
                    {activity.status === "applied" && activity.target ? (
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
  }, []);

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
