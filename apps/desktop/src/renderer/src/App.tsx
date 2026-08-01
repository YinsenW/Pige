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
import {
  LibraryTagsBrowser,
  type LibraryTagsApi,
} from "./components/LibraryTagsBrowser";
import { LibraryMarkdownImportAction } from "./components/LibraryMarkdownImportAction";
import {
  LIBRARY_FAMILIES,
  LIBRARY_RESULT_GROUPS,
  groupLibrarySearchItems,
  libraryBrowseItems,
  libraryFamilyPageTypes,
  libraryMatchReasonLabel,
  libraryResultIconLabel,
  type LibraryFamily,
  type LibrarySearchState,
} from "./components/library-panel-model";
import { useLibraryBrowse } from "./components/useLibraryBrowse";
export { filterLibraryPages } from "./components/library-panel-model";
import { CurrentNoteAgent } from "./components/CurrentNoteAgent";
import { ConversationMarkdown } from "./components/ConversationMarkdown";
import { ConversationCaptureReferences } from "./components/ConversationCaptureReferences";
import { ConversationMessageActions } from "./components/ConversationSaveAnswerAction";
import { ConversationHistoryPanel } from "./components/ConversationHistoryPanel";
import { ConversationCitations, RetrievalResults, toRetrievalAskResult } from "./components/HomeRetrievalResults";
import { ProposalReviewPanel } from "./components/ProposalReviewPanel";
import { ConversationScrollRail } from "./components/ConversationScrollRail";
import { ConversationEarlierControl, projectCompletedConversation, useConversationPagination } from "./components/ConversationPagination";
import { HomeVoicePanel, type HomeVoicePanelState } from "./components/HomeVoicePanel";
import { HomeJobAction } from "./components/HomeJobAction";
import { useHomeJobEvents } from "./components/useHomeJobEvents";
import {
  HomeCaptureDropZone,
  settleHomeCaptureBatch,
  type HomeCaptureBatchStatus
} from "./components/HomeCaptureDropZone";
import { HighRiskConfirmationDialog } from "./components/HighRiskConfirmationDialog";
import { useHomeSourceReconnect } from "./components/useHomeSourceReconnect";
import { PermissionsPrivacySettingsPanel } from "./components/PermissionsPrivacySettingsPanel";
import { VaultMigrationDialog } from "./components/VaultMigrationDialog";
import { TaskExecutionInteractionStatus } from "./components/TaskExecutionInteraction";
import {
  AgentMemorySettingsPanel,
  type AgentMemoryFocusRequest,
} from "./components/AgentMemorySettingsPanel";
import { ManagedCollectionCitationPanel, ManagedCollectionPanel } from "./components/ManagedCollectionPanel";
import { ManagedDatasetTrashAction } from "./components/ManagedDatasetTrashAction";
import { renameCollectionView, trashCollectionView, updateCollectionView } from "./collection-view-lifecycle";
import { LocalCapabilitiesSettingsPanel } from "./components/LocalCapabilitiesSettingsPanel";
import { SkillsSettingsPanel } from "./components/SkillsSettingsPanel";
import { PiPackagesSettingsPanel } from "./components/PiPackagesSettingsPanel";
import { PigePolicySettingsPanel } from "./components/PigePolicySettingsPanel";
import { MaintenanceSettingsPanel } from "./components/MaintenanceSettingsPanel";
import {
  DiagnosticsJobCard,
  SupportBundlePreviewCard,
  supportBundlePreviewIsFullyProjected
} from "./components/DiagnosticsWorkflowCards";
import { ActivityHistorySettingsPanel } from "./components/ActivityHistorySettingsPanel";
import { CrashRecoveryHistory } from "./components/CrashRecoveryHistory";
import { GeneralSettingsPanel, type StartupDestinationApi } from "./components/GeneralSettingsPanel";
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
import { ReaderFullscreenToggle } from "./components/ReaderFullscreenToggle";
import { useWindowControls } from "./components/useWindowControls";
import { ReaderDocumentActions, readerDocumentArchiveLabels, readerDocumentRestoreLabels, submitReaderNoteArchive, submitReaderNoteRestore, type ReaderNoteArchiveSubmit, type ReaderNoteRestoreSubmit } from "./components/ReaderDocumentActions"; import { readerNoteTagLabels, submitReaderNoteTag, submitReaderNoteTagRemoval, type ReaderNoteTagRemoveSubmit, type ReaderNoteTagSubmit } from "./components/ReaderNoteTagDialog";
import { ReaderGeneratedNoteRevealAction } from "./components/ReaderGeneratedNoteRevealAction";
import { NoteRevisionHistoryDialog } from "./components/NoteRevisionHistoryDialog";
import { readerNoteRenameLabels, submitReaderNoteRename, type ReaderNoteRenameSubmit } from "./components/ReaderNoteRenameDialog";
import { readerNoteAliasLabels, submitReaderNoteAliasChange, type ReaderNoteAliasSubmit } from "./components/ReaderNoteAliasDialog"; import { ReaderTopicRenameDialog } from "./components/ReaderTopicRenameDialog";
import type { ReaderNoteMergeOutcome, ReaderNoteMergeTarget } from "./components/ReaderNoteMergeDialog";
import { createReaderKnowledgePageTargetLoader } from "./reader-knowledge-page-targets";
import { readerNoteRelateLabels, submitReaderNoteRelation, type ReaderNoteRelateOutcome } from "./components/ReaderNoteRelateDialog";
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
  AppHealth,
  BackupRestoreStatus,
  DiagnosticsClearLocalResult,
  DictationLanguagePreference,
  DiagnosticsHealth,
  GeneratedKnowledgeLanguage,
  HomeAgentModelUsage,
  HighRiskConfirmationPendingResult,
  JobSummary,
  KnowledgeActivityListResult,
  KnowledgeActivitySummary,
  KnowledgeLanguageMutationResult,
  KnowledgeTreeResult,
  LibraryListResult,
  LibraryRelatedResult,
  LibraryPageSummary,
  LibraryRenameTopicRequest,
  LibraryRenameTopicResult,
  LocalDatabaseStatus,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteRenderResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteResolveInlineReferenceRequest,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
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
  RetrievalSearchRequest,
  RetrievalSearchResult,
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  StartupDestinationSummary,
  DiagnosticsWorkflowSummary,
  SupportBundlePreview,
  ToolchainHealth,
  ToolchainRepairResult,
  UpdateSummary,
  VaultSummary,
  VaultActionResult,
  VaultMigrationPreview,
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
  type CollectionCreateViewRequest,
  type CollectionCreateViewResult,
  type CollectionListResult,
  type CollectionRenameColumnRequest,
  type CollectionRenameColumnResult,
  type CollectionTrashColumnRequest,
  type CollectionTrashColumnResult,
  type CollectionOpenRequest,
  type CollectionOpenCitationRequest,
  type CollectionOpenCitationResult,
  type CollectionOpenResult,
  type CollectionSnapshot,
  type CollectionTrashRowRequest,
  type CollectionTrashRowResult,
  type CollectionTrashDatasetRequest, type CollectionTrashDatasetResult,
  type JobState,
  type Locale,
  type ProviderEndpointProtocol,
} from "@pige/schemas";
export { AgentMemorySettingsPanel } from "./components/AgentMemorySettingsPanel";
export { LocalCapabilitiesSettingsPanel } from "./components/LocalCapabilitiesSettingsPanel";
export { LocalSemanticRetrievalSettingsPanel } from "./components/LocalSemanticRetrievalSettingsPanel";
export { LocalRerankerSettingsPanel } from "./components/LocalRerankerSettingsPanel";
export { SkillsSettingsPanel } from "./components/SkillsSettingsPanel";
export { PiPackagesSettingsPanel } from "./components/PiPackagesSettingsPanel";
export { MaintenanceSettingsPanel } from "./components/MaintenanceSettingsPanel";
const startupDestinationApi: StartupDestinationApi = {
  load: () => window.pige.settings.startupDestination(),
  set: (request) => window.pige.settings.setStartupDestination(request)
};
const HOME_JOB_CLASSES = ["capture", "parse", "ocr", "dataset_import", "agent_ingest", "agent_turn", "index_rebuild"] as const;
type View = "home" | "library" | "knowledgeTree";
type EditableActiveCollection = {
  readonly mode: "editable";
  readonly vaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly nextRowCursor?: string;
  readonly returnView: View;
};
type CitationActiveCollection = {
  readonly mode: "citation_readonly";
  readonly vaultId: string;
  readonly result: Extract<CollectionOpenCitationResult, { readonly status: "ready" }>;
  readonly returnView: View;
};
type ActiveCollection = EditableActiveCollection | CitationActiveCollection;
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
  | "updates";
export type DevelopmentNotice = {
  readonly surface: DevelopmentSurface;
  readonly capability: DevelopmentCapability;
  readonly state: "development" | "unavailable";
};
type HomeAgentUiState = HomeConversationTurnState;
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
type FailedFileDropRecovery = {
  readonly activeVaultId: string;
  readonly clientTurnId: string;
  readonly files: readonly File[];
};
type ActiveReaderSelectionProposal = {
  readonly vaultId: string;
  readonly pageId: string;
  readonly preview: ReaderSelectionProposalPreview;
  readonly errorMessageKey?: string;
};
type HomeReaderSelectionContext = {
  readonly vaultId: string;
  readonly pageId: string;
  readonly title: string;
};
type HomeReaderDurableRefresh = {
  readonly vaultId: string;
  readonly pageId: string;
  readonly jobId: string;
  readonly sequence: number;
};
function readerSelectionProposalOwnerMatches(
  vaultId: string,
  pageId: string,
  selectedNote: NoteRenderResult | null,
  selectedNoteVaultId: string | null,
  homeContext: HomeReaderSelectionContext | null
): boolean {
  return (selectedNoteVaultId === vaultId && selectedNote?.summary.pageId === pageId) ||
    (homeContext?.vaultId === vaultId && homeContext.pageId === pageId);
}
function readerSelectionCreatedPageType(
  action: ReaderSelectionProposalPreview["action"]
): NoteRenderResult["summary"]["pageType"] | undefined {
  switch (action) {
    case "create_note": return "note";
    case "create_claim": return "claim";
    case "create_question": return "question";
    case "create_concept": return "concept";
    case "create_entity": return "entity";
    case "create_topic": return "topic";
    default: return undefined;
  }
}
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
  const [bootStartupDestination, setBootStartupDestination] = useState<
    StartupDestinationSummary["destination"] | "loading" | "failed"
  >("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [developmentNotice, setDevelopmentNotice] = useState<DevelopmentNotice | null>(null);
  const [noteAgentOpen, setNoteAgentOpen] = useState(false);
  const [noteAgentExternalRevision, setNoteAgentExternalRevision] = useState(0);
  const [readerSelectionProposal, setReaderSelectionProposal] = useState<ActiveReaderSelectionProposal | null>(null);
  const [homeReaderSelectionContext, setHomeReaderSelectionContext] = useState<HomeReaderSelectionContext | null>(null);
  const [homeReaderSelectionAgentActive, setHomeReaderSelectionAgentActive] = useState(false);
  const [homeReaderDurableRefresh, setHomeReaderDurableRefresh] = useState<HomeReaderDurableRefresh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingRecentVaultId, setOpeningRecentVaultId] = useState<string | null>(null);
  const [recentVaultErrorId, setRecentVaultErrorId] = useState<string | null>(null);
  const [vaultMigration, setVaultMigration] = useState<VaultMigrationPreview | null>(null);
  const [vaultMigrationApplying, setVaultMigrationApplying] = useState(false);
  const [vaultMigrationFailed, setVaultMigrationFailed] = useState(false);
  const vaultMigrationTriggerRef = useRef<HTMLElement | null>(null);
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
  const toolchainHealthRef = useRef<ToolchainHealth | null>(null);
  toolchainHealthRef.current = toolchainHealth;
  const [speechAvailability, setSpeechAvailability] = useState<SpeechAvailabilityResult | null>(null);
  const [speechAvailabilityLoading, setSpeechAvailabilityLoading] = useState(false);
  const [speechAvailabilityFailed, setSpeechAvailabilityFailed] = useState(false);
  const [dictationLanguagePreference, setDictationLanguagePreference] =
    useState<DictationLanguagePreference>({ mode: "automatic" });
  const [dropActive, setDropActive] = useState(false);
  const [homeDraftText, setHomeDraftText] = useState("");
  const [voiceAssetInstallActive, setVoiceAssetInstallActive] = useState(false);
  const [homeFileDropRequest, setHomeFileDropRequest] = useState<HomeFileDropRequest | null>(null);
  const [captureToast, setCaptureToast] = useState<CaptureToast | null>(null);
  const [highRiskConfirmation, setHighRiskConfirmation] = useState<HighRiskConfirmationPendingResult | null>(null);
  const [highRiskConfirmationDecision, setHighRiskConfirmationDecision] = useState<"allow" | "deny" | null>(null);
  const highRiskConfirmationDecisionRef = useRef<"allow" | "deny" | null>(null);
  const [highRiskConfirmationFailed, setHighRiskConfirmationFailed] = useState(false);
  const [highRiskConfirmationReading, setHighRiskConfirmationReading] = useState(false);
  const [recentJobs, setRecentJobs] = useState<readonly JobSummary[]>([]);
  const [activityJobs, setActivityJobs] = useState<readonly JobSummary[]>([]);
  const [activityList, setActivityList] = useState<KnowledgeActivityListResult | null>(null);
  const [activityHistoryLoadingMore, setActivityHistoryLoadingMore] = useState(false);
  const [activityHistoryLoadFailed, setActivityHistoryLoadFailed] = useState(false);
  const [activityUndoingId, setActivityUndoingId] = useState<string | null>(null);
  const [activityRedoingId, setActivityRedoingId] = useState<string | null>(null);
  const activityMutationInFlightRef = useRef<string | null>(null);
  const [activityOpeningId, setActivityOpeningId] = useState<string | null>(null);
  const [memoryActivityFocusRequest, setMemoryActivityFocusRequest] =
    useState<AgentMemoryFocusRequest | null>(null);
  const [activityBlockedIds, setActivityBlockedIds] = useState<readonly string[]>([]);
  const [collectionCatalog, setCollectionCatalog] = useState<CollectionListResult | null>(null);
  const [collectionCatalogLoading, setCollectionCatalogLoading] = useState(false);
  const [librarySearchFocusRequest, setLibrarySearchFocusRequest] = useState(0);
  const [librarySidebarExpandedGroups, setLibrarySidebarExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(["family:knowledge", "family:sources"])
  );
  const [knowledgeTree, setKnowledgeTree] = useState<KnowledgeTreeResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteSearchFocus, setSelectedNoteSearchFocus] = useState<{
    readonly pageId: string;
    readonly renderContextId: string;
    readonly segmentId: string;
  } | null>(null);
  const [selectedNoteVaultId, setSelectedNoteVaultId] = useState<string | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<ActiveCollection | null>(null);
  const noteOpenSequence = useRef(0);
  const collectionOpenSequence = useRef(0);
  const collectionCatalogSequence = useRef(0);
  const inlineReferenceSequence = useRef(0);
  const activityOpenSequence = useRef(0);
  const activityOpenInFlightRef = useRef<string | null>(null);
  const activityHistoryLoadInFlightRef = useRef(false);
  const activityJobsRefreshSequence = useRef(0);
  const activityListRef = useRef<KnowledgeActivityListResult | null>(activityList);
  const readerSelectionProposalSequence = useRef(0);
  const readerSelectionProposalDecisionInFlight = useRef(false);
  const homeReaderSelectionContextRef = useRef<HomeReaderSelectionContext | null>(null);
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
  const bootStartupDestinationAppliedRef = useRef(false);
  const recentVaultOpenRequestRef = useRef<string | null>(null);
  const voiceAssetInstallActiveRef = useRef(false);
  const appearanceRevisionRef = useRef(-1);
  const deferredAppearanceRef = useRef<{
    readonly locale: Locale;
    readonly availableLocales: readonly Locale[];
  } | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(onboarding?.activeVault?.vaultId);
  activeVaultIdRef.current = onboarding?.activeVault?.vaultId;
  activityListRef.current = activityList;
  selectedNoteRef.current = selectedNote;
  selectedNoteVaultIdRef.current = selectedNoteVaultId;
  useEffect(() => {
    if (!selectedNoteSearchFocus) return;
    if (
      selectedNote?.summary.pageId !== selectedNoteSearchFocus.pageId ||
      selectedNote.renderContextId !== selectedNoteSearchFocus.renderContextId
    ) {
      setSelectedNoteSearchFocus(null);
    }
  }, [selectedNote, selectedNoteSearchFocus]);
  selectedCollectionRef.current = selectedCollection;
  homeReaderSelectionContextRef.current = homeReaderSelectionContext;

  useEffect(() => {
    setReaderSelectionProposal((current) => {
      if (!current) return null;
      return current.vaultId === onboarding?.activeVault?.vaultId &&
        (current.pageId === selectedNote?.summary.pageId || current.pageId === homeReaderSelectionContext?.pageId)
        ? current
        : null;
    });
  }, [homeReaderSelectionContext?.pageId, onboarding?.activeVault?.vaultId, selectedNote?.summary.pageId]);

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
          !readerSelectionProposalOwnerMatches(
            vaultId,
            pageId,
            selectedNoteRef.current,
            selectedNoteVaultIdRef.current,
            homeReaderSelectionContextRef.current
          )
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
  const homeReaderAgentOwnerActive = homeReaderSelectionAgentActive &&
    homeReaderSelectionContext?.vaultId === onboarding?.activeVault?.vaultId;
  const windowLayoutSurface = homeSurface && !homeReaderAgentOwnerActive ? "home" : "reader";
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
    setWindowState((current) => {
      if (!current) return current;
      const mode = nextState.isFullScreen
        ? "fullscreen"
        : current.mode === "fullscreen"
          ? "expanded"
          : current.mode;
      if (current.mode === mode && current.isFullScreen === nextState.isFullScreen) return current;
      return { ...current, mode, isFullScreen: nextState.isFullScreen };
    });
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
    highRiskConfirmationDecisionRef.current = null;
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
    void window.pige.settings.startupDestination()
      .then((summary) => { if (active) setBootStartupDestination(summary.destination); })
      .catch(() => { if (active) setBootStartupDestination("failed"); });
    void window.pige.system.toolchainHealth().then(setToolchainHealth);
    void refreshVaultState();
    void refreshModels().catch(() => undefined);
    return () => {
      active = false;
      unsubscribeLayout();
      unsubscribeAppearance();
    };
  }, []);

  useEffect(() => {
    if (
      bootStartupDestinationAppliedRef.current ||
      bootStartupDestination === "loading" ||
      onboarding === null
    ) return;
    bootStartupDestinationAppliedRef.current = true;
    if (bootStartupDestination === "library" && onboarding.activeVault) setView("library");
  }, [bootStartupDestination, onboarding]);

  useLayoutEffect(() => {
    if (!appearanceSummary) return;
    document.documentElement.dataset.theme = appearanceSummary.effectiveTheme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [appearanceSummary?.effectiveTheme]);

  useEffect(() => {
    const homeWorkActive = recentJobs.some((job) => job.state === "queued" || job.state === "running" || job.state === "cancel_requested");
    const backupWorkActive = backupJobs.some((job) =>
      job.state === "queued" || job.state === "running" || job.state === "cancel_requested"
    );
    if (!homeWorkActive && !backupWorkActive) return;
    const timer = window.setTimeout(() => void refreshVaultState(), 1_200);
    return () => window.clearTimeout(timer);
  }, [recentJobs, backupJobs]);

  useEffect(() => {
    const requestId = `dictlangreq_${crypto.randomUUID().replaceAll("-", "")}`;
    void window.pige.localCapabilities.dictationLanguagePreference({
      apiVersion: 1,
      requestId
    }).then((result) => {
      if (result.requestId === requestId && result.status === "ready") {
        setDictationLanguagePreference(result.summary.preference);
      }
    }).catch(() => undefined);
  }, []);

  const dictationLanguageTag = dictationLanguagePreference.mode === "automatic"
    ? locale
    : dictationLanguagePreference.language;

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "capabilities") return;
    void refreshSpeechAvailability();
  }, [dictationLanguageTag, settingsOpen, settingsSection]);

  const t = useCallback((key: string): string => messageCatalogs[locale][key] ?? messageCatalogs.en[key] ?? key, [locale]);
  const { libraryList, refresh: refreshLibrary, loadMore: loadMoreLibrary,
    canLoadMore: libraryCanLoadMore, loadingMore: libraryLoadingMore,
    loadMoreFailed: libraryLoadMoreFailed } = useLibraryBrowse(onboarding?.activeVault?.vaultId, setLibraryError, t("error.generic"));
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
        states: ["queued", "running", "waiting_dependency", "waiting_permission", "failed_retryable", "failed_final"] as JobState[]
      };
      homeJobStateFilter.states.push("awaiting_review");
      homeJobStateFilter.states.push("cancel_requested");
      const [nextJobs, nextBackupJobs, nextActivities] = nextOnboarding.activeVault
        ? await Promise.all([
          window.pige.jobs.list({
            limit: 100,
            classes: HOME_JOB_CLASSES,
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
        activityJobsRefreshSequence.current += 1;
        setActivityJobs([]);
        setActivityHistoryLoadingMore(false);
        setActivityHistoryLoadFailed(false);
        activityHistoryLoadInFlightRef.current = false;
        setActivityOpeningId(null);
        setMemoryActivityFocusRequest(null);
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
      const nextActivityList = nextActivities?.activeVaultId === nextOnboarding.activeVault?.vaultId
        ? nextActivities ?? null
        : null;
      setActivityList(nextActivityList);
      setActivityHistoryLoadFailed(false);
    } catch (caught) {
      if (refreshId === vaultRefreshSequence.current) throw caught;
    }
  };
  useHomeJobEvents(onboarding?.activeVault?.vaultId, HOME_JOB_CLASSES, refreshVaultState, setRecentJobs, setBackupJobs, setActivityJobs);
  const refreshActivityJobs = async (): Promise<boolean> => {
    const activeVaultId = activeVaultIdRef.current;
    const sequence = ++activityJobsRefreshSequence.current;
    if (!activeVaultId) {
      setActivityJobs([]);
      return false;
    }
    try {
      const result = await window.pige.jobs.list({ limit: 100 });
      if (
        sequence !== activityJobsRefreshSequence.current ||
        activeVaultIdRef.current !== activeVaultId ||
        result.activeVaultId !== activeVaultId
      ) return false;
      setActivityJobs(result.jobs);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "history" || !onboarding?.activeVault?.vaultId) return;
    void refreshActivityJobs();
  }, [settingsOpen, settingsSection, onboarding?.activeVault?.vaultId]);

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
      handleVaultOpenResult(result);
    });

  const handleVaultOpenResult = (result: VaultActionResult): void => {
    if (result.status === "completed") {
      setVaultMigration(null);
      const migratedActiveVault = result.onboarding.activeVault;
      setOnboarding({
        state: result.onboarding.state,
        ...(migratedActiveVault ? { activeVault: {
          vaultId: migratedActiveVault.vaultId,
          name: migratedActiveVault.name,
          activeVaultPathDisplay: migratedActiveVault.activeVaultPathDisplay,
          knowledgeRootDisplay: migratedActiveVault.knowledgeRootDisplay,
          sourceAssetRootDisplay: migratedActiveVault.sourceAssetRootDisplay,
          sourceAssetRootKind: migratedActiveVault.sourceAssetRootKind,
          managedCopyRoot: migratedActiveVault.managedCopyRoot,
          defaultSourceStorageStrategy: migratedActiveVault.defaultSourceStorageStrategy,
          schemaVersion: migratedActiveVault.schemaVersion,
          ...(migratedActiveVault.counts ? { counts: migratedActiveVault.counts } : {}),
          ...(migratedActiveVault.lastBackupAt ? { lastBackupAt: migratedActiveVault.lastBackupAt } : {})
        } } : {}),
        hasDefaultModel: result.onboarding.hasDefaultModel,
        showFirstHomeGuide: result.onboarding.showFirstHomeGuide,
        ...(result.onboarding.waitingDependencyCounts
          ? { waitingDependencyCounts: result.onboarding.waitingDependencyCounts }
          : {})
      });
      setView("home");
    } else if (result.status === "needs_migration") {
      vaultMigrationTriggerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setVaultMigrationFailed(false);
      setVaultMigration(result.preview);
    } else if (result.status !== "canceled") {
      setError(t("vaultMigration.openFailed"));
    }
  };

  const applyVaultMigration = async (): Promise<void> => {
    const preview = vaultMigration;
    if (!preview || vaultMigrationApplying) return;
    setVaultMigrationApplying(true);
    setVaultMigrationFailed(false);
    try {
      const result = await window.pige.vault.applyMigration({
        apiVersion: 1,
        requestId: `vaultmigrationreq_${crypto.randomUUID().replaceAll("-", "")}`,
        vaultId: preview.vaultId,
        previewId: preview.previewId
      });
      if (result.status !== "completed") {
        setVaultMigrationFailed(true);
        return;
      }
      setVaultMigration(null);
      const migratedActiveVault = result.onboarding.activeVault;
      setOnboarding({
        state: result.onboarding.state,
        ...(migratedActiveVault ? { activeVault: {
          vaultId: migratedActiveVault.vaultId,
          name: migratedActiveVault.name,
          activeVaultPathDisplay: migratedActiveVault.activeVaultPathDisplay,
          knowledgeRootDisplay: migratedActiveVault.knowledgeRootDisplay,
          sourceAssetRootDisplay: migratedActiveVault.sourceAssetRootDisplay,
          sourceAssetRootKind: migratedActiveVault.sourceAssetRootKind,
          managedCopyRoot: migratedActiveVault.managedCopyRoot,
          defaultSourceStorageStrategy: migratedActiveVault.defaultSourceStorageStrategy,
          schemaVersion: migratedActiveVault.schemaVersion,
          ...(migratedActiveVault.counts ? { counts: migratedActiveVault.counts } : {}),
          ...(migratedActiveVault.lastBackupAt ? { lastBackupAt: migratedActiveVault.lastBackupAt } : {})
        } } : {}),
        hasDefaultModel: result.onboarding.hasDefaultModel,
        showFirstHomeGuide: result.onboarding.showFirstHomeGuide,
        ...(result.onboarding.waitingDependencyCounts
          ? { waitingDependencyCounts: result.onboarding.waitingDependencyCounts }
          : {})
      });
      setView("home");
      await refreshVaultState();
    } catch {
      setVaultMigrationFailed(true);
    } finally {
      setVaultMigrationApplying(false);
    }
  };

  const openRecentVault = async (vaultId: string): Promise<void> => {
    if (recentVaultOpenRequestRef.current) return;
    recentVaultOpenRequestRef.current = vaultId;
    setOpeningRecentVaultId(vaultId);
    setRecentVaultErrorId(null);
    setBusy(true);
    setError(null);
    try {
      const result = await window.pige.vault.openRecent({ vaultId });
      if (result.status === "needs_migration") {
        vaultMigrationTriggerRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        setVaultMigrationFailed(false);
        setVaultMigration(result.preview);
        return;
      }
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

  const acceptRecentVaults = (nextRecentVaults: readonly RecentVaultSummary[]): void => {
    setRecentVaults(nextRecentVaults);
    setRecentVaultErrorId(null);
  };

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

  const clearLocalDiagnostics = async (): Promise<DiagnosticsClearLocalResult> => {
    const requestId = `diagclearreq_${crypto.randomUUID().replaceAll("-", "")}`;
    const workflow = await window.pige.diagnostics.workflowSummary();
    const result = await window.pige.diagnostics.clearLocalDiagnostics({
      apiVersion: 1,
      requestId,
      scopeContextId: workflow.scopeContextId,
      expectedRevision: workflow.revision
    });
    if (result.requestId !== requestId) throw new Error("diagnostics_clear_identity_mismatch");
    if (result.status === "cleared" || result.status === "busy" || result.status === "stale") {
      setDiagnosticsHealth(result.health);
    }
    return result;
  };

  const refreshSpeechAvailability = async (): Promise<void> => {
    const requestId = ++speechAvailabilitySequence.current;
    setSpeechAvailabilityLoading(true);
    setSpeechAvailabilityFailed(false);
    try {
      const nextAvailability = await window.pige.speech.availability({ languageTag: dictationLanguageTag });
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

  const openToolchainReinstall = async (): Promise<ToolchainRepairResult["status"]> => {
    const repair = toolchainHealthRef.current?.repair;
    if (!repair) return "not_needed";
    const expectedMissingRequiredToolIds = Object.freeze([...repair.missingRequiredToolIds]);
    const requestId = `toolchain_repair_request_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    try {
      const result = await window.pige.system.repairToolchain({
        apiVersion: 1,
        requestId,
        expectedHealthId: repair.healthId,
        expectedMissingRequiredToolIds
      });
      if (
        result.requestId !== requestId ||
        result.expectedHealthId !== repair.healthId ||
        result.expectedMissingRequiredToolIds.length !== expectedMissingRequiredToolIds.length ||
        result.expectedMissingRequiredToolIds.some(
          (toolId, index) => toolId !== expectedMissingRequiredToolIds[index]
        )
      ) return "failed";
      const currentRepair = toolchainHealthRef.current?.repair;
      if (
        !currentRepair ||
        currentRepair.healthId !== repair.healthId ||
        currentRepair.missingRequiredToolIds.length !== expectedMissingRequiredToolIds.length ||
        currentRepair.missingRequiredToolIds.some(
          (toolId, index) => toolId !== expectedMissingRequiredToolIds[index]
        )
      ) return "stale";
      return result.status;
    } catch {
      return "failed";
    }
  };

  const setHomeDefaultModel = async (modelProfileId: string): Promise<boolean> => {
    const expectedRevision = modelSummary?.revision;
    if (!expectedRevision) return false;
    const modelRequestId = ++modelRefreshSequence.current;
    try {
      await window.pige.models.setDefaultModel({ modelProfileId, expectedRevision });
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
    if (memoryActivityFocusRequest) {
      activityOpenSequence.current += 1;
      activityOpenInFlightRef.current = null;
      setActivityOpeningId(null);
      setMemoryActivityFocusRequest(null);
    }
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
  const loadKnowledgePageTargets = createReaderKnowledgePageTargetLoader(() => activeVaultIdRef.current);
  const loadNoteMergeTargets = (currentPageId: string): Promise<readonly ReaderNoteMergeTarget[]> =>
    loadKnowledgePageTargets(currentPageId, ["note"]);
  const loadNoteRelateTargets = (currentPageId: string): Promise<readonly ReaderNoteMergeTarget[]> =>
    loadKnowledgePageTargets(currentPageId, ["note", "claim", "question", "concept", "entity"]);

  const adoptMergedNote = (render: NoteRenderResult): void => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId || !isRelatableKnowledgePage(render)) return;
    const requestId = ++noteOpenSequence.current;
    inlineReferenceSequence.current += 1;
    setSelectedNoteVaultId(vaultId);
    setSelectedNote(render);
    setSelectedNoteRelated("loading");
    void loadNoteRelated(render.summary.pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    void Promise.allSettled([refreshLibrary(), refreshVaultState()]);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".note-reader")?.focus({ preventScroll: true }));
  };

  const adoptReconnectedNote = (render: NoteRenderResult): void => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId || selectedNoteRef.current?.summary.pageId !== render.summary.pageId) return;
    const requestId = ++noteOpenSequence.current;
    inlineReferenceSequence.current += 1;
    setSelectedNoteVaultId(vaultId);
    setSelectedNote(render);
    setSelectedNoteRelated("loading");
    void loadNoteRelated(render.summary.pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    void refreshLibrary();
  };

  const refreshCollectionCatalog = async (append = false): Promise<void> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return;
    const current = collectionCatalog?.status === "ready" && collectionCatalog.activeVaultId === vaultId
      ? collectionCatalog
      : null;
    const cursor = append ? current?.nextCursor : undefined;
    if (append && !cursor) return;
    const sequence = collectionCatalogSequence.current + 1;
    collectionCatalogSequence.current = sequence;
    setCollectionCatalogLoading(true);
    try {
      const result = await window.pige.collections.list({
        apiVersion: 1,
        activeVaultId: vaultId,
        limit: 50,
        ...(cursor ? { cursor } : {})
      });
      if (sequence !== collectionCatalogSequence.current || activeVaultIdRef.current !== vaultId) return;
      if (result.status !== "ready") {
        if (!append) setCollectionCatalog(result);
        return;
      }
      if (!append || !current) {
        setCollectionCatalog(result);
        return;
      }
      const known = new Set(current.datasets.map(({ datasetId }) => datasetId));
      setCollectionCatalog({
        ...result,
        datasets: [...current.datasets, ...result.datasets.filter(({ datasetId }) => !known.has(datasetId))]
      });
    } catch {
      if (sequence === collectionCatalogSequence.current && !append) {
        setCollectionCatalog({ apiVersion: 1, activeVaultId: vaultId, status: "failed" });
      }
    } finally {
      if (sequence === collectionCatalogSequence.current) setCollectionCatalogLoading(false);
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

  const openNoteTarget = async (
    pageId: string,
    reportError = true,
    requiredPageType?: NoteRenderResult["summary"]["pageType"],
    searchQuery?: string
  ): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    const previousRelated = selectedNoteRelated;
    inlineReferenceSequence.current += 1;
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setDevelopmentNotice(null);
    setLibraryError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const searchResult = searchQuery
        ? await window.pige.notes.openSearchMatch({
            apiVersion: 1,
            requestId: `notesearch_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
            activeVaultId: vaultId,
            pageId,
            query: searchQuery
          })
        : null;
      if (searchResult && searchResult.status !== "ready") throw new Error("Search result is no longer available.");
      const note = searchResult?.render ?? await window.pige.notes.render({ pageId });
      if (
        requestId !== noteOpenSequence.current ||
        activeVaultIdRef.current !== vaultId ||
        note.summary.pageId !== pageId ||
        (requiredPageType !== undefined && note.summary.pageType !== requiredPageType)
      ) {
        if (requestId === noteOpenSequence.current) setSelectedNoteRelated(previousRelated);
        return false;
      }
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
      setSelectedNoteSearchFocus(
        searchResult?.focusSegmentId && note.renderContextId
          ? { pageId, renderContextId: note.renderContextId, segmentId: searchResult.focusSegmentId }
          : null
      );
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

  const openNoteSearchMatch = async (pageId: string, query: string): Promise<void> => {
    await openNoteTarget(pageId, true, undefined, query);
  };

  const refreshCurrentNoteAfterDurableTurn = async (identity: {
    readonly vaultId: string;
    readonly pageId: string;
    readonly jobId: string;
  }): Promise<void> => {
    const selected = selectedNoteRef.current;
    if (activeVaultIdRef.current !== identity.vaultId || !identity.jobId) return;
    const selectedOwner = selectedNoteVaultIdRef.current === identity.vaultId &&
      selected?.summary.pageId === identity.pageId;
    const homeOwner = homeReaderSelectionContextRef.current?.vaultId === identity.vaultId &&
      homeReaderSelectionContextRef.current.pageId === identity.pageId;
    if (!selectedOwner && !homeOwner) return;
    if (homeOwner) {
      setHomeReaderDurableRefresh((current) => ({
        ...identity,
        sequence: (current?.sequence ?? 0) + 1
      }));
    }
    await Promise.allSettled([
      ...(selectedOwner ? [openNoteTarget(identity.pageId, false)] : []),
      refreshVaultState()
    ]);
  };

  const readCollection = async (
    datasetId: string,
    tableId: string,
    originVaultId: string,
    sequence: number,
    viewId?: string,
    rowCursor?: string
  ): Promise<{ readonly snapshot: CollectionSnapshot; readonly nextRowCursor?: string } | null> => {
    const request: CollectionOpenRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: originVaultId,
      datasetId,
      tableId,
      limit: 50,
      ...(viewId ? { viewId } : {}),
      ...(rowCursor ? { rowCursor } : {})
    };
    try {
      const result = await window.pige.collections.open(request);
      if (
        sequence !== collectionOpenSequence.current ||
        activeVaultIdRef.current !== originVaultId ||
        !collectionOpenIdentityMatches(request, result) ||
        result.status !== "ready" ||
        result.snapshot.datasetId !== request.datasetId ||
        result.snapshot.tableId !== request.tableId ||
        result.snapshot.activeViewId !== request.viewId
      ) return null;
      return {
        snapshot: result.snapshot,
        ...(result.nextRowCursor ? { nextRowCursor: result.nextRowCursor } : {})
      };
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
    const opened = await readCollection(datasetId, tableId, vaultId, sequence);
    if (!opened) {
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
    setSelectedCollection({ mode: "editable", vaultId, snapshot: opened.snapshot, returnView, ...(opened.nextRowCursor ? { nextRowCursor: opened.nextRowCursor } : {}) });
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".managed-collection-panel")?.focus());
    return true;
  };

  const openCollectionCitation = async (
    conversationId: string,
    assistantEventId: string,
    citationRef: string
  ): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    const sequence = collectionOpenSequence.current + 1;
    collectionOpenSequence.current = sequence;
    const request: CollectionOpenCitationRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: vaultId,
      conversationId,
      assistantEventId,
      citationRef
    };
    let result: CollectionOpenCitationResult;
    try {
      result = await window.pige.collections.openCitation(request);
    } catch {
      return false;
    }
    if (
      sequence !== collectionOpenSequence.current ||
      activeVaultIdRef.current !== vaultId ||
      !collectionCitationIdentityMatches(request, result) ||
      result.status !== "ready" ||
      result.mode !== "citation_readonly"
    ) return false;
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
    setSelectedCollection({ mode: "citation_readonly", vaultId, result, returnView: "home" });
    return true;
  };

  const reloadSelectedCollection = async (): Promise<CollectionSnapshot | null> => {
    const current = selectedCollectionRef.current;
    if (!current || current.mode !== "editable" || current.vaultId !== activeVaultIdRef.current) return null;
    const sequence = collectionOpenSequence.current + 1;
    collectionOpenSequence.current = sequence;
    const opened = await readCollection(
      current.snapshot.datasetId,
      current.snapshot.tableId,
      current.vaultId,
      sequence,
      current.snapshot.activeViewId
    );
    if (!opened) return null;
    setSelectedCollection((active) => {
      if (active?.mode !== "editable" || active.vaultId !== current.vaultId || active.snapshot.datasetId !== current.snapshot.datasetId ||
          active.snapshot.tableId !== current.snapshot.tableId) return active;
      const { nextRowCursor: _discardedCursor, ...identity } = active;
      return { ...identity, snapshot: opened.snapshot, ...(opened.nextRowCursor ? { nextRowCursor: opened.nextRowCursor } : {}) };
    });
    return opened.snapshot;
  };

  const editCollectionCell = async (
    request: CollectionCellEditRequest
  ): Promise<CollectionCellEditResult> => {
    const result = await window.pige.collections.editCell(request);
    if (result.status === "committed") void refreshVaultState();
    return result;
  };

  const openCollectionView = async (viewId?: string): Promise<CollectionSnapshot | null> => {
    const current = selectedCollectionRef.current;
    if (!current || current.mode !== "editable" || current.vaultId !== activeVaultIdRef.current) return null;
    const sequence = collectionOpenSequence.current + 1;
    collectionOpenSequence.current = sequence;
    const opened = await readCollection(
      current.snapshot.datasetId,
      current.snapshot.tableId,
      current.vaultId,
      sequence,
      viewId
    );
    if (!opened) return null;
    setSelectedCollection((active) => {
      if (active?.mode !== "editable" || active.vaultId !== current.vaultId || active.snapshot.datasetId !== current.snapshot.datasetId ||
          active.snapshot.tableId !== current.snapshot.tableId) return active;
      const { nextRowCursor: _discardedCursor, ...identity } = active;
      return { ...identity, snapshot: opened.snapshot, ...(opened.nextRowCursor ? { nextRowCursor: opened.nextRowCursor } : {}) };
    });
    return opened.snapshot;
  };

  const loadMoreCollectionRows = async (rowCursor: string): Promise<CollectionOpenResult | null> => {
    const current = selectedCollectionRef.current;
    if (!current || current.mode !== "editable" || current.vaultId !== activeVaultIdRef.current || current.nextRowCursor !== rowCursor) return null;
    const request: CollectionOpenRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: current.vaultId,
      datasetId: current.snapshot.datasetId,
      tableId: current.snapshot.tableId,
      limit: 50,
      rowCursor,
      ...(current.snapshot.activeViewId ? { viewId: current.snapshot.activeViewId } : {})
    };
    try {
      const result = await window.pige.collections.open(request);
      const active = selectedCollectionRef.current;
      if (
        !active || active.mode !== "editable" || active.vaultId !== current.vaultId || active.snapshot.datasetId !== request.datasetId ||
        active.snapshot.tableId !== request.tableId || active.snapshot.revisionId !== current.snapshot.revisionId ||
        active.snapshot.activeViewId !== request.viewId || active.nextRowCursor !== rowCursor ||
        !collectionOpenIdentityMatches(request, result)
      ) return null;
      if (result.status === "ready") {
        if (
          result.snapshot.datasetId !== current.snapshot.datasetId ||
          result.snapshot.tableId !== current.snapshot.tableId ||
          result.snapshot.revisionId !== current.snapshot.revisionId ||
          result.snapshot.activeViewId !== current.snapshot.activeViewId
        ) return null;
        setSelectedCollection((selected) => {
          if (selected !== active || selected.mode !== "editable") return selected;
          const { nextRowCursor: _discardedCursor, ...identity } = selected;
          return { ...identity, ...(result.nextRowCursor ? { nextRowCursor: result.nextRowCursor } : {}) };
        });
      }
      return result;
    } catch {
      return null;
    }
  };

  const createCollectionView = async (request: CollectionCreateViewRequest): Promise<CollectionCreateViewResult> => {
    const result = await window.pige.collections.createView(request);
    if (collectionCreateViewIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
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

  const trashCollectionColumn = async (
    request: CollectionTrashColumnRequest
  ): Promise<CollectionTrashColumnResult> => {
    const result = await window.pige.collections.trashColumn(request);
    if (collectionTrashColumnIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const trashCollectionRow = async (
    request: CollectionTrashRowRequest
  ): Promise<CollectionTrashRowResult> => {
    const result = await window.pige.collections.trashRow(request);
    if (collectionTrashIdentityMatches(request, result) && result.status === "committed") void refreshVaultState();
    return result;
  };

  const trashDataset = async (request: CollectionTrashDatasetRequest): Promise<CollectionTrashDatasetResult> => {
    const result = await window.pige.collections.trashDataset(request);
    if (result.status === "committed") await Promise.allSettled([refreshCollectionCatalog(false), refreshVaultState()]);
    return result;
  };

  const adoptCollectionSnapshot = (snapshot: CollectionSnapshot, expectedRevisionId: string): boolean => {
    const active = selectedCollectionRef.current;
    if (
      !active ||
      active.mode !== "editable" ||
      active.vaultId !== activeVaultIdRef.current ||
      active.snapshot.datasetId !== snapshot.datasetId ||
      active.snapshot.tableId !== snapshot.tableId ||
      active.snapshot.revisionId !== expectedRevisionId
    ) return false;
    const { nextRowCursor: _discardedCursor, ...identity } = active;
    setSelectedCollection({ ...identity, snapshot });
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

  const updateKnowledgeLanguage = async (
    generatedKnowledgeLanguage: GeneratedKnowledgeLanguage
  ): Promise<KnowledgeLanguageMutationResult["status"]> => {
    const current = appearanceSummary;
    if (!current) return "failed";
    try {
      const result = await window.pige.settings.setKnowledgeLanguage({
        generatedKnowledgeLanguage,
        expectedRevision: current.revision
      });
      if (result.settings.revision < current.revision) return "failed";
      const adopted = applyAppearanceSummary(result.settings);
      if (!adopted) return "stale";
      if (
        result.status === "committed" &&
        result.settings.generatedKnowledgeLanguage !== generatedKnowledgeLanguage
      ) return "failed";
      return result.status;
    } catch {
      return "failed";
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

  const cancelJob = async (jobId: string): Promise<boolean> => {
    const result = await window.pige.jobs.cancel({ jobId });
    if (result.status === "cancelled" || result.status === "cancel_requested") {
      setCaptureToast({
        kind: "success",
        message: t(result.status === "cancel_requested" ? "home.jobCancelRequested" : "home.jobCancelled")
      });
      await refreshVaultState();
      return true;
    }
    setCaptureToast({ kind: "error", message: t("error.generic") });
    return false;
  };

  const retryJob = async (jobId: string): Promise<boolean> => {
    const result = await window.pige.jobs.retry({ jobId });
    if (result.status === "requeued") {
      setCaptureToast({ kind: "success", message: t("home.jobRequeued"), queuedJobId: jobId });
      await refreshVaultState();
      return true;
    }
    setCaptureToast({ kind: "error", message: t("error.generic") });
    return false;
  };

  const loadMoreActivityHistory = async (): Promise<boolean> => {
    const current = activityListRef.current;
    const vaultId = activeVaultIdRef.current;
    const cursor = current?.nextCursor;
    if (!current || !vaultId || current.activeVaultId !== vaultId || !cursor || activityHistoryLoadInFlightRef.current) return false;
    activityHistoryLoadInFlightRef.current = true;
    setActivityHistoryLoadingMore(true);
    setActivityHistoryLoadFailed(false);
    try {
      const result = await window.pige.activity.list({ limit: 20, cursor });
      const latest = activityListRef.current;
      if (activeVaultIdRef.current !== vaultId || latest?.activeVaultId !== vaultId || latest.nextCursor !== cursor || result.activeVaultId !== vaultId) return false;
      const known = new Set(latest.activities.map(({ operationId }) => operationId));
      if (result.total !== latest.total || result.activities.some(({ operationId }) => known.has(operationId))) throw new Error("activity_history_stale");
      setActivityList({ ...result, activities: [...latest.activities, ...result.activities] });
      return true;
    } catch {
      if (activeVaultIdRef.current === vaultId && activityListRef.current?.nextCursor === cursor) setActivityHistoryLoadFailed(true);
      return false;
    } finally {
      activityHistoryLoadInFlightRef.current = false;
      setActivityHistoryLoadingMore(false);
    }
  };

  const undoActivity = async (operationId: string): Promise<void> => {
    if (
      activityMutationInFlightRef.current ||
      !activityList ||
      activityList.activeVaultId !== activeVaultIdRef.current
    ) return;
    const activity = activityList?.activities.find((candidate) => candidate.operationId === operationId);
    activityMutationInFlightRef.current = operationId;
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
        activity?.target?.kind === "page" &&
        selectedNoteVaultIdRef.current === activeVaultIdRef.current &&
        selectedNoteRef.current?.summary.pageId === activity.target.pageId
      ) await openNoteTarget(activity.target.pageId, false);
      if (
        activity?.target?.kind === "collection" &&
        selectedCollectionRef.current?.mode === "editable" &&
        selectedCollectionRef.current?.snapshot.datasetId === activity.target.datasetId &&
        selectedCollectionRef.current.snapshot.tableId === activity.target.tableId
      ) void reloadSelectedCollection();
    } catch {
      try {
        const current = await window.pige.activity.list({ limit: 20 });
        if (current.activeVaultId !== activeVaultIdRef.current) return;
        const exact = current.activities.find((activity) => activity.operationId === operationId);
        if (exact?.status === "undone") {
          setActivityList(current);
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "success", message: t("activity.undoCompleted") });
        } else if (exact?.status === "applied" && exact.canUndo) {
          setActivityList(current);
          setActivityBlockedIds((blocked) => blocked.filter((id) => id !== operationId));
          setCaptureToast({ kind: "error", message: t("activity.undoFailed") });
        } else {
          if (exact) setActivityList(current);
          setActivityBlockedIds((blocked) => Array.from(new Set([...blocked, operationId])));
          setCaptureToast({ kind: "error", message: t("activity.undoStateUnknown") });
        }
      } catch {
        setActivityBlockedIds((blocked) => Array.from(new Set([...blocked, operationId])));
        setCaptureToast({ kind: "error", message: t("activity.undoStateUnknown") });
      }
    } finally {
      if (activityMutationInFlightRef.current === operationId) activityMutationInFlightRef.current = null;
      setActivityUndoingId(null);
      restoreActivityFocus(operationId);
    }
  };

  const redoActivity = async (operationId: string): Promise<void> => {
    if (activityMutationInFlightRef.current || activityList?.activeVaultId !== activeVaultIdRef.current) return;
    const activity = activityList?.activities.find((candidate) => candidate.operationId === operationId);
    if (!activity?.canRedo || activityBlockedIds.includes(operationId)) return;
    activityMutationInFlightRef.current = operationId;
    setActivityRedoingId(operationId);
    try {
      const result = await window.pige.activity.redo({ operationId });
      if (result.status === "stale" || result.status === "not_found") {
        setCaptureToast({ kind: "error", message: t("activity.redoFailed") }); return;
      }
      setCaptureToast({ kind: "success", message: t(result.status === "already_redone"
        ? "activity.alreadyRedone" : "activity.redoCompleted") });
      await refreshVaultState();
      if (activity.target?.kind === "page" && selectedNoteVaultIdRef.current === activeVaultIdRef.current &&
        selectedNoteRef.current?.summary.pageId === activity.target.pageId) await openNoteTarget(activity.target.pageId, false);
    } catch { setCaptureToast({ kind: "error", message: t("activity.redoFailed") });
    } finally {
      if (activityMutationInFlightRef.current === operationId) activityMutationInFlightRef.current = null;
      setActivityRedoingId(null); restoreActivityFocus(operationId);
    }
  };

  const openActivityTarget = async (activity: KnowledgeActivitySummary): Promise<void> => {
    const originVaultId = activityList?.activeVaultId;
    const target = activity.target;
    if (
      activityOpenInFlightRef.current ||
      !originVaultId ||
      originVaultId !== activeVaultIdRef.current ||
      !target
    ) return;
    const requestId = activityOpenSequence.current + 1;
    activityOpenSequence.current = requestId;
    activityOpenInFlightRef.current = activity.operationId;
    setActivityOpeningId(activity.operationId);
    if (target.kind === "memory") {
      setMemoryActivityFocusRequest({
        activeVaultId: originVaultId,
        operationId: activity.operationId,
        ...(target.memoryId ? { memoryId: target.memoryId } : {}),
      });
      setSettingsSection("memory");
      setDevelopmentNotice(null);
      return;
    }
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

  const settleMemoryActivityFocus = (
    operationId: string,
    outcome: "focused" | "missing" | "failed",
  ): void => {
    const request = memoryActivityFocusRequest;
    if (
      !request ||
      request.operationId !== operationId ||
      request.activeVaultId !== activeVaultIdRef.current ||
      activityOpenInFlightRef.current !== operationId
    ) return;
    const currentActivity = activityList?.activities.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (
      activityList?.activeVaultId !== request.activeVaultId ||
      currentActivity?.target?.kind !== "memory" ||
      currentActivity.target.memoryId !== request.memoryId
    ) {
      activityOpenInFlightRef.current = null;
      setActivityOpeningId(null);
      setMemoryActivityFocusRequest(null);
      setSettingsSection("history");
      if (currentActivity) restoreActivityOpenFocus(operationId);
      return;
    }
    activityOpenInFlightRef.current = null;
    setActivityOpeningId(null);
    setMemoryActivityFocusRequest(null);
    if (outcome !== "failed") return;
    setSettingsSection("history");
    restoreActivityOpenFocus(operationId);
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
    if (view !== "library" || !activeVault) return;
    const currentVaultId = collectionCatalog?.activeVaultId;
    if (currentVaultId === activeVault.vaultId) return;
    setCollectionCatalog(null);
    void refreshCollectionCatalog();
  }, [activeVault?.vaultId, collectionCatalog?.activeVaultId, view]);

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
    const desiredNoteAgentOpen = windowLayoutSurface === "reader" &&
      Boolean(selectedNote || homeReaderAgentOwnerActive) && noteAgentOpen;
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
  }, [
    windowLayoutState?.revision,
    windowLayoutSurface,
    sidebarOpen,
    selectedNote?.summary.pageId,
    homeReaderAgentOwnerActive,
    noteAgentOpen
  ]);

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
    if ((!selectedNote && !homeReaderSelectionContextRef.current) || !noteAgentOpen) return;
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
    if (!vaultId) return;
    const selected = selectedNoteRef.current;
    const homeContext = homeReaderSelectionContextRef.current;
    const selectedOwner = selected && selectedNoteVaultIdRef.current === vaultId;
    const owner = selectedOwner
      ? { vaultId, pageId: selected.summary.pageId }
      : homeContext?.vaultId === vaultId
        ? homeContext
        : null;
    if (!owner) return;
    if (result.status === "applied") {
      setReaderSelectionProposal(null);
      if (selectedOwner) void openNoteTarget(owner.pageId);
      return;
    }
    if (result.status === "review_required") {
      setReaderSelectionProposal({ vaultId, pageId: owner.pageId, preview: result.proposal });
    } else if (result.status !== "waiting" && !(result.status === "failed" && result.conversationId)) {
      return;
    }
    if (!selectedOwner) setHomeReaderSelectionAgentActive(true);
    setNoteAgentExternalRevision((current) => current + 1);
    void requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: true
    });
  };

  const revealReaderSelectionCreateNote = (result: ReaderSelectionCreateNoteResult): void => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return;
    const selected = selectedNoteRef.current;
    const homeContext = homeReaderSelectionContextRef.current;
    const owner = selected && selectedNoteVaultIdRef.current === vaultId
      ? { vaultId, pageId: selected.summary.pageId }
      : homeContext?.vaultId === vaultId
        ? homeContext
        : null;
    if (!owner) return;
    if (result.status === "review_required" && readerSelectionCreatedPageType(result.proposal.action)) {
      setReaderSelectionProposal({ vaultId, pageId: owner.pageId, preview: result.proposal });
    } else if (result.status !== "waiting" && !(result.status === "failed" && result.conversationId)) {
      return;
    }
    if (!selected) setHomeReaderSelectionAgentActive(true);
    setNoteAgentExternalRevision((current) => current + 1);
    void requestWindowLayout({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen,
      noteAgentOpen: true
    });
  };

  const refreshReaderSelectionLink = async (
    result: Extract<ReaderSelectionLinkResult, { status: "applied" }>
  ): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    const note = selectedNoteRef.current;
    if (
      !vaultId ||
      selectedNoteVaultIdRef.current !== vaultId ||
      !note ||
      note.summary.pageId !== result.currentPageId
    ) return false;
    return openNoteTarget(result.currentPageId);
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
      !readerSelectionProposalOwnerMatches(
        current.vaultId,
        current.pageId,
        selectedNoteRef.current,
        selectedNoteVaultIdRef.current,
        homeReaderSelectionContextRef.current
      )
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
      !readerSelectionProposalOwnerMatches(
        current.vaultId,
        current.pageId,
        selectedNoteRef.current,
        selectedNoteVaultIdRef.current,
        homeReaderSelectionContextRef.current
      )
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
    if (result.status === "applied") {
      const createdPageType = readerSelectionCreatedPageType(result.proposal.action); const opened = createdPageType && result.createdPageId
        ? await openNoteTarget(result.createdPageId, false, createdPageType)
        : createdPageType === undefined
          ? await openNoteTarget(current.pageId)
          : false;
      if (!opened && createdPageType) {
        setReaderSelectionProposal({
          vaultId: current.vaultId,
          pageId: current.pageId,
          preview: result.proposal,
          errorMessageKey: "note.selection.actionFailed"
        });
      }
    }
  };

  const resolveHighRiskConfirmation = async (
    decision: "allow" | "deny",
    grantContextId?: string
  ): Promise<void> => {
    if (highRiskConfirmation?.status !== "pending" || highRiskConfirmationDecisionRef.current) return;
    const current = highRiskConfirmation;
    highRiskConfirmationDecisionRef.current = decision;
    setHighRiskConfirmationDecision(decision);
    setHighRiskConfirmationFailed(false);
    try {
      const result = await window.pige.confirmations.resolve({
        apiVersion: 1,
        confirmationId: current.confirmation.confirmationId,
        expectedRevision: current.revision,
        decision,
        ...(grantContextId ? {
          rememberScopedGrant: { decision: "allow_scoped" as const, grantContextId }
        } : {})
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
      highRiskConfirmationDecisionRef.current = null;
      setHighRiskConfirmationDecision(null);
    }
  };
  const highRiskConfirmationOpen = highRiskConfirmation?.status === "pending";
  const noteAgentContext = selectedNote && selectedNoteVaultId === activeVault?.vaultId
    ? { vaultId: selectedNoteVaultId, pageId: selectedNote.summary.pageId, title: selectedNote.summary.title }
    : homeReaderSelectionAgentActive && homeReaderSelectionContext?.vaultId === activeVault?.vaultId
      ? homeReaderSelectionContext
      : null;

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
          <ReaderFullscreenToggle
            state={windowState}
            visible={Boolean(selectedNote) || Boolean(windowState?.isFullScreen)}
            enterLabel={t("topbar.fullscreen")}
            exitLabel={t("topbar.exitFullscreen")}
            tabIndex={sidebarModal ? -1 : undefined}
            busy={windowControls.busy}
            onToggle={() => void windowControls.toggleFullScreen()}
          />
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
        className={`main-layout${sidebarOpen ? " sidebar-open" : ""}${selectedNote || selectedCollection ? " note-open" : ""}${noteAgentContext && noteAgentOpen ? " agent-open" : ""}`}
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
            onRecentVaultsChanged={acceptRecentVaults}
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
        ) : selectedCollection && activeVault && selectedCollection.vaultId === activeVault.vaultId && selectedCollection.mode === "citation_readonly" ? (
          <ManagedCollectionCitationPanel
            mode={selectedCollection.result.mode}
            preview={selectedCollection.result.preview}
            highlights={selectedCollection.result.highlights}
            onClose={() => {
              collectionOpenSequence.current += 1;
              navigateHome();
            }}
            t={t}
          />
        ) : selectedCollection && activeVault && selectedCollection.vaultId === activeVault.vaultId && selectedCollection.mode === "editable" ? (
          <ManagedCollectionPanel
            activeVaultId={activeVault.vaultId}
            snapshot={selectedCollection.snapshot}
            {...(selectedCollection.nextRowCursor ? { nextRowCursor: selectedCollection.nextRowCursor } : {})}
            onClose={() => {
              collectionOpenSequence.current += 1;
              const returnView = selectedCollection.returnView;
              if (returnView === "home") navigateHome();
              else {
                setSelectedCollection(null);
                setView(returnView);
              }
            }}
            onReveal={window.pige.collections.reveal}
            onAddNullableColumn={addCollectionNullableColumn}
            onRenameColumn={renameCollectionColumn}
            onTrashColumn={trashCollectionColumn}
            onOpenView={openCollectionView}
            onCreateView={createCollectionView}
            onUpdateView={(request) => updateCollectionView(request, () => void refreshVaultState())}
            onRenameView={(request) => renameCollectionView(request, () => void refreshVaultState())}
            onTrashView={(request) => trashCollectionView(request, () => void refreshVaultState())}
            onAppendDefaultRow={appendCollectionDefaultRow}
            onTrashRow={trashCollectionRow}
            onAdoptSnapshot={adoptCollectionSnapshot}
            onEditCell={editCollectionCell}
            onReload={reloadSelectedCollection}
            onLoadMoreRows={loadMoreCollectionRows}
            t={t}
          />
        ) : view === "library" && activeVault ? (
          <LibraryPanel
            libraryList={libraryList}
            tagsApi={window.pige.library}
            collectionCatalog={collectionCatalog}
            collectionCatalogLoading={collectionCatalogLoading}
            onRefreshCollectionCatalog={() => refreshCollectionCatalog(false)}
            onLoadMoreCollections={() => refreshCollectionCatalog(true)}
            onOpenCollection={(datasetId, tableId) => openCollection(datasetId, tableId, "library")}
            onTrashDataset={trashDataset}
            activeVaultId={activeVault.vaultId}
            onResolveReaderSelection={resolveReaderSelection}
            onSubmitReaderSelectionAction={submitReaderSelectionAction}
            onSubmitReaderSelectionLink={submitReaderSelectionLink}
            onSubmitReaderSelectionTransform={submitReaderSelectionTransform}
            onSubmitReaderSelectionCreateNote={submitReaderSelectionCreateNote}
            locale={locale}
            onReaderSelectionAction={revealReaderSelectionAction}
            onReaderSelectionLinkApplied={refreshReaderSelectionLink}
            onReaderSelectionTransform={revealReaderSelectionTransform}
            onReaderSelectionCreateNote={revealReaderSelectionCreateNote}
            selectedNote={selectedNote}
            {...(selectedNoteSearchFocus?.segmentId
              ? { searchFocusSegmentId: selectedNoteSearchFocus.segmentId }
              : {})}
            selectedNoteRelated={selectedNoteRelated}
            noteLoadingPageId={noteLoadingPageId}
            error={libraryError}
            canLoadMore={libraryCanLoadMore}
            loadingMore={libraryLoadingMore}
            loadMoreFailed={libraryLoadMoreFailed}
            onLoadMore={loadMoreLibrary}
            onGoHome={navigateHome}
            onImportMarkdown={(request) => window.pige.notes.importMarkdown(request)}
            onNoteImported={adoptMergedNote}
            onRefresh={async () => {
              await Promise.all([refreshLibrary(), refreshCollectionCatalog(false)]);
            }}
            onSearch={(request) => window.pige.retrieval.search(request)}
            onOpenSourceReference={(request) => window.pige.notes.openSourceReference(request)}
            onRevealSource={(request) => window.pige.notes.revealSource(request)}
            onReconnectOriginalSource={(request) => window.pige.notes.reconnectOriginalSource(request)}
            onCurrentNoteSourceReconnected={adoptReconnectedNote} onArchiveCurrentNote={(request) => window.pige.notes.archiveCurrent(request)} onCurrentNoteArchived={adoptMergedNote} onRestoreArchivedNote={(request) => window.pige.notes.restoreArchived(request)} onCurrentNoteRestored={adoptMergedNote} onRenameCurrentNote={(request) => window.pige.notes.rename(request)} onCurrentNoteRenamed={adoptMergedNote} onChangeNoteAlias={(request) => window.pige.notes.changeAlias(request)} onCurrentNoteAliasChanged={adoptMergedNote} onAddNoteTag={(request) => window.pige.notes.editTaxonomy(request)} onRemoveNoteTag={(request) => window.pige.notes.removeTag(request)} onCurrentNoteTagged={adoptMergedNote}
            onTrashCurrentNote={(request) => window.pige.notes.trashCurrent(request)}
            onLoadNoteMergeTargets={loadNoteMergeTargets}
            onLoadNoteRelateTargets={loadNoteRelateTargets}
            onMergeCurrentNote={(request) => window.pige.notes.merge(request)}
            onCurrentNoteMerged={adoptMergedNote}
            onRelateCurrentNote={submitNoteRelation}
            onRenameTopic={(request) => window.pige.library.renameTopic(request)}
            onCurrentNoteRelated={adoptMergedNote}
            searchFocusRequest={librarySearchFocusRequest}
            onOpenNote={openNote}
            onOpenSearchMatch={openNoteSearchMatch}
            onCloseNote={() => {
              noteOpenSequence.current += 1;
              inlineReferenceSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
            onCurrentNoteTrashed={() => {
              noteOpenSequence.current += 1;
              inlineReferenceSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
              void Promise.allSettled([refreshLibrary(), refreshVaultState()]);
              setLibrarySearchFocusRequest((current) => current + 1);
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
              onSubmitReaderSelectionLink={submitReaderSelectionLink}
              onSubmitReaderSelectionTransform={submitReaderSelectionTransform}
              onSubmitReaderSelectionCreateNote={submitReaderSelectionCreateNote}
              locale={locale}
              onReaderSelectionAction={revealReaderSelectionAction}
              onReaderSelectionLinkApplied={refreshReaderSelectionLink}
              onReaderSelectionTransform={revealReaderSelectionTransform}
              onReaderSelectionCreateNote={revealReaderSelectionCreateNote}
              selectedNote={selectedNote}
              {...(selectedNoteSearchFocus?.segmentId
                ? { searchFocusSegmentId: selectedNoteSearchFocus.segmentId }
                : {})}
              selectedNoteRelated={selectedNoteRelated}
              noteLoadingPageId={noteLoadingPageId}
              error={libraryError}
              readerBackLabel={t("knowledgeTree.back")}
              onGoHome={navigateHome}
              onRefresh={refreshLibrary}
              onSearch={(request) => window.pige.retrieval.search(request)}
              onOpenSearchMatch={openNoteSearchMatch}
              onOpenSourceReference={(request) => window.pige.notes.openSourceReference(request)}
              onRevealSource={(request) => window.pige.notes.revealSource(request)}
              onReconnectOriginalSource={(request) => window.pige.notes.reconnectOriginalSource(request)}
              onCurrentNoteSourceReconnected={adoptReconnectedNote} onArchiveCurrentNote={(request) => window.pige.notes.archiveCurrent(request)} onCurrentNoteArchived={adoptMergedNote} onRestoreArchivedNote={(request) => window.pige.notes.restoreArchived(request)} onCurrentNoteRestored={adoptMergedNote} onRenameCurrentNote={(request) => window.pige.notes.rename(request)} onCurrentNoteRenamed={adoptMergedNote} onChangeNoteAlias={(request) => window.pige.notes.changeAlias(request)} onCurrentNoteAliasChanged={adoptMergedNote} onAddNoteTag={(request) => window.pige.notes.editTaxonomy(request)} onRemoveNoteTag={(request) => window.pige.notes.removeTag(request)} onCurrentNoteTagged={adoptMergedNote}
              onTrashCurrentNote={(request) => window.pige.notes.trashCurrent(request)}
              onLoadNoteMergeTargets={loadNoteMergeTargets}
              onLoadNoteRelateTargets={loadNoteRelateTargets}
              onMergeCurrentNote={(request) => window.pige.notes.merge(request)}
              onCurrentNoteMerged={adoptMergedNote}
              onRelateCurrentNote={submitNoteRelation}
              onRenameTopic={(request) => window.pige.library.renameTopic(request)}
              onCurrentNoteRelated={adoptMergedNote}
              searchFocusRequest={librarySearchFocusRequest}
              onOpenNote={openNote}
              onCloseNote={() => {
                noteOpenSequence.current += 1;
                inlineReferenceSequence.current += 1;
                setSelectedNote(null);
                setSelectedNoteRelated(null);
                restoreKnowledgeTreeFocus(knowledgeTreeReturnFocusKey.current);
              }}
              onCurrentNoteTrashed={() => {
                noteOpenSequence.current += 1;
                inlineReferenceSequence.current += 1;
                setSelectedNote(null);
                setSelectedNoteRelated(null);
                void Promise.allSettled([refreshLibrary(), refreshVaultState()]);
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
              onLoadRelated={(pageId) => window.pige.library.related({ pageId, limit: 8 })}
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
            dictationLanguageTag={dictationLanguageTag}
            onReaderSelectionAction={revealReaderSelectionAction}
            onSubmitReaderSelectionTransform={submitReaderSelectionTransform}
            onReaderSelectionTransform={revealReaderSelectionTransform}
            onReaderSelectionCreateNote={revealReaderSelectionCreateNote}
            onReaderSelectionContextChange={(context) => {
              setHomeReaderSelectionContext(context);
              if (!context) {
                setHomeReaderSelectionAgentActive(false);
                setHomeReaderDurableRefresh(null);
              }
            }}
            readerDurableRefresh={homeReaderDurableRefresh}
            onOpenNoteEditor={(request) => window.pige.notes.openEditor(request)}
            onSaveNoteEditor={(request) => window.pige.notes.saveEditor(request)}
            onReloadNoteEditor={reloadNoteEditor}
            onLoadNoteMergeTargets={loadNoteMergeTargets}
            onLoadNoteRelateTargets={loadNoteRelateTargets}
            onMergeCurrentNote={(request) => window.pige.notes.merge(request)}
            onRelateCurrentNote={submitNoteRelation}
            onOpenCollection={(datasetId, tableId) => openCollection(datasetId, tableId, "home")}
            onOpenCollectionCitation={openCollectionCitation}
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
        {noteAgentContext && noteAgentOpen && activeVault ? (
          <CurrentNoteAgent
            key={`${activeVault.vaultId}:${noteAgentContext.pageId}:${noteAgentExternalRevision}`}
            modal={agentModal}
            vaultId={activeVault.vaultId}
            pageId={noteAgentContext.pageId}
            noteTitle={noteAgentContext.title}
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
            onDurableTurnCompleted={(identity) => void refreshCurrentNoteAfterDurableTurn(identity)}
            proposal={readerSelectionProposal?.vaultId === activeVault.vaultId &&
              readerSelectionProposal.pageId === noteAgentContext.pageId
              ? readerSelectionProposal.preview
              : null}
            {...(readerSelectionProposal?.vaultId === activeVault.vaultId &&
              readerSelectionProposal.pageId === noteAgentContext.pageId &&
              readerSelectionProposal.errorMessageKey
              ? { proposalErrorMessageKey: readerSelectionProposal.errorMessageKey }
              : {})}
            onProposalAction={(proposalId, action) => void decideReaderSelectionProposal(proposalId, action)}
            onOpenCitation={(pageId) => {
              if (pageId !== noteAgentContext.pageId) return;
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
            if (memoryActivityFocusRequest) {
              activityOpenSequence.current += 1;
              activityOpenInFlightRef.current = null;
              setActivityOpeningId(null);
              setMemoryActivityFocusRequest(null);
            }
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
                onRecentVaultsChanged={acceptRecentVaults}
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
              startupDestinationApi={startupDestinationApi}
              onOpenAppearance={() => {
                setSettingsSection("appearance");
                setDevelopmentNotice(null);
              }}
              t={t}
            />
          ) : settingsSection === "appearance" ? (
            <AppearanceSettingsPanel
              locale={locale}
              availableLocales={availableLocales}
              themePreference={appearanceSummary?.themePreference ?? null}
              generatedKnowledgeLanguage={appearanceSummary?.generatedKnowledgeLanguage ?? null}
              themeBusy={appearanceThemeBusy}
              themeError={appearanceThemeError}
              onLocaleChange={updateLocale}
              onThemeChange={updateTheme}
              onKnowledgeLanguageChange={updateKnowledgeLanguage}
              t={t}
            />
          ) : settingsSection === "capabilities" ? (
            <LocalCapabilitiesSettingsPanel
              dictationLanguagePreferenceApi={window.pige.localCapabilities}
              onDictationLanguagePreferenceChanged={setDictationLanguagePreference}
              ocrLanguagePreferenceApi={window.pige.localCapabilities}
              ocrImageTestApi={window.pige.localCapabilities}
              ocrSummaryPreferenceApi={window.pige.localCapabilities}
              paddleOcrApi={window.pige.localCapabilities}
              semanticRetrievalApi={window.pige.retrieval}
              rerankerApi={window.pige.retrieval}
              toolchainHealth={toolchainHealth}
              speechAvailability={speechAvailability}
              speechAvailabilityLoading={speechAvailabilityLoading}
              speechAvailabilityFailed={speechAvailabilityFailed}
              speechAssetApi={window.pige.speech}
              speechLanguageTag={dictationLanguageTag}
              onRefreshSpeechAvailability={refreshSpeechAvailability}
              onRefresh={refreshLocalCapabilities}
              onOpenToolchainReinstall={openToolchainReinstall}
              onOpenSpeechSettings={() => window.pige.speech.openSystemSettings()
                .then(() => undefined)
                .catch(() => setSpeechAvailabilityFailed(true))}
              onDevelopment={() => showDevelopmentCapability("settings", "local_capabilities")}
              t={t}
            />
          ) : settingsSection === "memory" ? (
            <><PigePolicySettingsPanel activeVaultId={activeVault?.vaultId ?? null} t={t} />
              <AgentMemorySettingsPanel
                activeVaultId={activeVault?.vaultId ?? null}
                focusRequest={memoryActivityFocusRequest}
                onFocusRequestSettled={settleMemoryActivityFocus}
                t={t} />
            </>
          ) : settingsSection === "privacy" ? (
            <PermissionsPrivacySettingsPanel
              activeVaultId={activeVault?.vaultId ?? null}
              api={window.pige.permissions}
              t={t}
            />
          ) : settingsSection === "skills" ? (
            <SkillsSettingsPanel
              t={t}
            />
          ) : settingsSection === "packages" ? (
            <PiPackagesSettingsPanel
              api={window.pige.piPackages}
              t={t}
            />
          ) : settingsSection === "history" ? (
            <ActivityHistorySettingsPanel
              activeVaultId={activeVault?.vaultId ?? null}
              activities={activityList?.activities ?? []}
              jobs={activityJobs}
              hasMore={activityList?.hasMore === true}
              loadingMore={activityHistoryLoadingMore}
              loadMoreFailed={activityHistoryLoadFailed}
              undoingId={activityUndoingId} redoingId={activityRedoingId} openingId={activityOpeningId}
              blockedIds={activityBlockedIds} locale={locale}
              onOpen={openActivityTarget}
              onRestored={async (pageId) => { const opened = await openNoteTarget(pageId, false); void refreshLibrary(); if (opened) { setView("library"); setSettingsOpen(false); } return opened; }}
              onUndo={undoActivity}
              onLoadMore={loadMoreActivityHistory}
              onCancelJob={cancelJob}
              onRetryJob={retryJob}
              onRefreshJobs={refreshActivityJobs}
              onRedo={redoActivity}
              t={t}
            />
          ) : settingsSection === "updates" || settingsSection === "diagnostics" ? (
            <SystemSettingsPanel
              surface={settingsSection}
              locale={locale}
              diagnosticsHealth={diagnosticsHealth}
              supportBundlePreview={supportBundlePreview}
              onRefreshDiagnostics={refreshDiagnostics}
              onClearDiagnostics={clearLocalDiagnostics}
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
          rememberScopedGrant={highRiskConfirmation.rememberScopedGrant}
          resolving={highRiskConfirmationDecision !== null}
          error={highRiskConfirmationFailed}
          onResolve={(decision, grantContextId) => void resolveHighRiskConfirmation(decision, grantContextId)}
          t={t}
        />
      ) : null}
      {vaultMigration ? (
        <VaultMigrationDialog
          preview={vaultMigration}
          applying={vaultMigrationApplying}
          failed={vaultMigrationFailed}
          returnFocusTarget={vaultMigrationTriggerRef.current}
          onApply={() => void applyVaultMigration()}
          onCancel={() => {
            if (vaultMigrationApplying) return;
            setVaultMigration(null);
            setVaultMigrationFailed(false);
          }}
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
    const redoButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-redo-id]")).find((element) => element.dataset.activityRedoId === operationId && !element.disabled);
    const undoButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-activity-undo-id]"))
      .find((element) => element.dataset.activityUndoId === operationId && !element.disabled);
    const activityRow = Array.from(document.querySelectorAll<HTMLElement>("[data-activity-row-id]"))
      .find((element) => element.dataset.activityRowId === operationId);
    const activityTitle = document.querySelector<HTMLElement>("#settings-history-title");
    const composer = document.querySelector<HTMLTextAreaElement>('[data-home-composer="true"]');
    (redoButton ?? undoButton ?? activityRow ?? activityTitle ?? composer)?.focus();
  }, 0);
}

function restoreActivityOpenFocus(operationId: string): void {
  window.setTimeout(() => {
    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-activity-open-id]"),
    ).find(
      (element) =>
        element.dataset.activityOpenId === operationId && !element.disabled,
    );
    const activityRow = Array.from(
      document.querySelectorAll<HTMLElement>("[data-activity-row-id]"),
    ).find((element) => element.dataset.activityRowId === operationId);
    (openButton ?? activityRow)?.focus();
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
  readonly tagsApi?: LibraryTagsApi;
  readonly collectionCatalog?: CollectionListResult | null;
  readonly collectionCatalogLoading?: boolean;
  readonly onRefreshCollectionCatalog?: () => Promise<void>;
  readonly onLoadMoreCollections?: () => Promise<void>;
  readonly onOpenCollection?: (datasetId: string, tableId: string) => Promise<boolean>;
  readonly onTrashDataset?: (request: CollectionTrashDatasetRequest) => Promise<CollectionTrashDatasetResult>;
  readonly selectedNote: NoteRenderResult | null;
  readonly searchFocusSegmentId?: string;
  readonly selectedNoteRelated: NoteRelatedState;
  readonly noteLoadingPageId: string | null;
  readonly error: string | null;
  readonly canLoadMore?: boolean;
  readonly loadingMore?: boolean;
  readonly loadMoreFailed?: boolean;
  readonly onLoadMore?: () => Promise<void>;
  readonly readerBackLabel?: string;
  readonly onGoHome: () => void;
  readonly onImportMarkdown?: (request: NoteImportMarkdownRequest) => Promise<NoteImportMarkdownResult>;
  readonly onNoteImported?: (render: NoteRenderResult) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSearch: (request: RetrievalSearchRequest) => Promise<RetrievalSearchResult>;
  readonly onOpenSourceReference?: (
    request: NoteOpenSourceReferenceRequest
  ) => Promise<NoteOpenSourceReferenceResult>;
  readonly onRevealSource?: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  readonly onReconnectOriginalSource?: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onArchiveCurrentNote?: ReaderNoteArchiveSubmit; readonly onCurrentNoteArchived?: (render: NoteRenderResult) => void; readonly onRestoreArchivedNote?: ReaderNoteRestoreSubmit; readonly onCurrentNoteRestored?: (render: NoteRenderResult) => void; readonly onRenameCurrentNote?: ReaderNoteRenameSubmit; readonly onCurrentNoteRenamed?: (render: NoteRenderResult) => void; readonly onChangeNoteAlias?: ReaderNoteAliasSubmit; readonly onCurrentNoteAliasChanged?: (render: NoteRenderResult) => void; readonly onAddNoteTag?: ReaderNoteTagSubmit; readonly onRemoveNoteTag?: ReaderNoteTagRemoveSubmit; readonly onCurrentNoteTagged?: (render: NoteRenderResult) => void;
  readonly onTrashCurrentNote?: (request: NoteTrashCurrentRequest) => Promise<NoteTrashCurrentResult>;
  readonly onLoadNoteMergeTargets: (currentPageId: string) => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onLoadNoteRelateTargets?: (currentPageId: string) => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onMergeCurrentNote: (request: NoteMergeRequest) => Promise<NoteMergeResult>;
  readonly onCurrentNoteMerged: (render: NoteRenderResult) => void;
  readonly onRelateCurrentNote?: (request: NoteRelateRequest) => Promise<NoteRelateResult>;
  readonly onRenameTopic?: (request: LibraryRenameTopicRequest) => Promise<LibraryRenameTopicResult>;
  readonly onCurrentNoteRelated?: (render: NoteRenderResult) => void;
  readonly onCurrentNoteSourceReconnected?: (render: NoteRenderResult) => void;
  readonly searchFocusRequest: number;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly onOpenSearchMatch?: (pageId: string, query: string) => Promise<void>;
  readonly onCloseNote: () => void;
  readonly onCurrentNoteTrashed?: () => void;
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
  readonly onSubmitReaderSelectionLink?: (request: ReaderSelectionLinkRequest) => Promise<ReaderSelectionLinkResult>;
  readonly onSubmitReaderSelectionTransform?: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly onSubmitReaderSelectionCreateNote?: (
    request: ReaderSelectionCreateNoteRequest
  ) => Promise<ReaderSelectionCreateNoteResult>;
  readonly locale?: Locale;
  readonly onReaderSelectionAction?: (result: ReaderSelectionActionResult) => void;
  readonly onReaderSelectionLinkApplied?: (
    result: Extract<ReaderSelectionLinkResult, { status: "applied" }>
  ) => Promise<boolean>;
  readonly onReaderSelectionTransform?: (result: ReaderSelectionTransformResult) => void;
  readonly onReaderSelectionCreateNote?: (result: ReaderSelectionCreateNoteResult) => void;
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
    if (
      !note ||
      !isNoteEditorEligible(note) ||
      !activeVaultId ||
      !renderContextId ||
      !props.onOpenNoteEditor ||
      editorOpenState === "opening"
    ) return;
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

  const trashSelectedNote = async (): Promise<"committed" | "retained"> => {
    const note = props.selectedNote;
    const eligibility = note?.trashEligibility;
    const activeVaultId = props.activeVaultId;
    const renderContextId = note?.renderContextId;
    if (!note || !eligibility?.canTrash || !activeVaultId || !renderContextId || !props.onTrashCurrentNote) {
      return "retained";
    }
    const request: NoteTrashCurrentRequest = {
      apiVersion: 1,
      requestId: createNoteTrashRequestId(),
      activeVaultId,
      currentPageId: note.summary.pageId,
      renderContextId,
      expectedRevision: eligibility.revision
    };
    try {
      const result = await props.onTrashCurrentNote(request);
      if (!noteTrashCurrentIdentityMatches(request, result)) return "retained";
      return result.status === "committed" ? "committed" : "retained";
    } catch {
      return "retained";
    }
  };
  const archiveSelectedNote = () => submitReaderNoteArchive({ note: props.selectedNote, activeVaultId: props.activeVaultId, submit: props.onArchiveCurrentNote }); const restoreSelectedNote = () => submitReaderNoteRestore({ note: props.selectedNote, activeVaultId: props.activeVaultId, submit: props.onRestoreArchivedNote }); const renameSelectedNote = (title: string) => submitReaderNoteRename({ note: props.selectedNote, activeVaultId: props.activeVaultId, title, submit: props.onRenameCurrentNote }); const changeSelectedNoteAlias = (action: "add" | "remove", alias: string) => submitReaderNoteAliasChange({ note: props.selectedNote, activeVaultId: props.activeVaultId, action, alias, submit: props.onChangeNoteAlias }); const addTagToSelectedNote = (tags: readonly string[], topics: readonly string[]) => submitReaderNoteTag({ note: props.selectedNote, activeVaultId: props.activeVaultId, tags, topics, submit: props.onAddNoteTag }); const removeTagFromSelectedNote = (tag: string) => submitReaderNoteTagRemoval({ note: props.selectedNote, activeVaultId: props.activeVaultId, tag, submit: props.onRemoveNoteTag });

  const mergeSelectedNote = async (target: ReaderNoteMergeTarget): Promise<ReaderNoteMergeOutcome> => {
    const note = props.selectedNote;
    const revision = note?.trashEligibility?.revision;
    const activeVaultId = props.activeVaultId;
    const renderContextId = note?.renderContextId;
    if (!note || note.summary.pageType !== "note" || !revision || !activeVaultId || !renderContextId) {
      return { status: "retained" };
    }
    const request: NoteMergeRequest = {
      apiVersion: 1,
      requestId: createNoteMergeRequestId(),
      activeVaultId,
      currentPageId: note.summary.pageId,
      renderContextId,
      expectedRevision: revision,
      targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt
    };
    try {
      const result = await props.onMergeCurrentNote(request);
      if (!noteMergeIdentityMatches(request, result) || result.status !== "committed" ||
        result.render.summary.pageId !== request.currentPageId || result.render.summary.pageType !== "note") {
        return { status: "retained" };
      }
      return { status: "committed", render: result.render };
    } catch {
      return { status: "retained" };
    }
  };

  const relateSelectedNote = async (target: ReaderNoteMergeTarget): Promise<ReaderNoteRelateOutcome> => {
    const note = props.selectedNote;
    const revision = note?.trashEligibility?.revision;
    const activeVaultId = props.activeVaultId;
    const renderContextId = note?.renderContextId;
    if (!note || !isRelatableKnowledgePage(note) || !revision || !activeVaultId || !renderContextId || !props.onRelateCurrentNote) return { status: "retained" };
    return submitReaderNoteRelation({
      activeVaultId, currentPageId: note.summary.pageId, renderContextId, expectedRevision: revision,
      expectedPageType: note.summary.pageType,
      execute: props.onRelateCurrentNote,
    }, target);
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
    if (
      isNoteEditorEligible(props.selectedNote) &&
      editorReady &&
      props.onSaveNoteEditor &&
      props.onReloadNoteEditor &&
      props.onNoteEditorCommitted
    ) {
      const onNoteEditorCommitted = props.onNoteEditorCommitted;
      return (
        <NoteMarkdownEditor
          ready={editorReady}
          labels={noteMarkdownEditorLabels(props.t)}
          returnFocusRef={editorOpenerRef}
          onSave={props.onSaveNoteEditor}
          onReload={props.onReloadNoteEditor}
          onCommitted={(result) => { if (result.render.summary.pageId !== props.selectedNote?.summary.pageId || result.render.summary.pageType !== props.selectedNote.summary.pageType) return;
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
            {isNoteEditorEligible(props.selectedNote) ? (
              <button
                ref={editorOpenerRef}
                type="button"
                data-reader-action="edit"
                className={`icon-button${props.onOpenNoteEditor ? "" : " prototype-action"}`}
                aria-label={props.t(summary.pageType === "source" ? "note.editor.title" : "note.edit")}
                title={props.t(summary.pageType === "source" ? "note.editor.title" : "note.edit")}
                aria-busy={editorOpenState === "opening"}
                disabled={editorOpenState === "opening" || !props.selectedNote.renderContextId}
                onClick={props.onOpenNoteEditor ? () => void openEditor() : () => showReaderDevelopment("document_actions")}
              >
                <PigeIcon name="edit" size={16} />
              </button>
            ) : null}
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
            <NoteRevisionHistoryDialog
              note={props.selectedNote}
              activeVaultId={props.activeVaultId}
              t={props.t}
              onCommitted={props.onCurrentNoteMerged}
            />
            <ReaderGeneratedNoteRevealAction activeVaultId={props.activeVaultId} note={props.selectedNote}
              onReveal={(request) => window.pige.notes.revealGenerated(request)} t={props.t} />
            <ReaderTopicRenameDialog
              note={props.selectedNote}
              {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
              {...(props.onRenameTopic ? { onRename: props.onRenameTopic } : {})}
              onCommitted={props.onCurrentNoteMerged}
              t={props.t}
            />
            <ReaderDocumentActions
              ownerIdentity={`${props.activeVaultId ?? ""}:${summary.pageId}:${props.selectedNote.renderContextId ?? ""}:${props.selectedNote.trashEligibility?.revision ?? ""}:${props.selectedNote.archiveEligibility?.revision ?? ""}:${props.selectedNote.restoreEligibility?.revision ?? ""}:${props.selectedNote.renameEligibility?.revision ?? ""}:${props.selectedNote.aliasing?.revision ?? ""}:${props.selectedNote.tagging?.revision ?? ""}`}
              canMoveToTrash={props.selectedNote.trashEligibility?.canTrash === true && Boolean(props.onTrashCurrentNote)}
              canMerge={isNoteEditorEligible(props.selectedNote) && Boolean(props.activeVaultId && props.selectedNote.renderContextId && props.selectedNote.trashEligibility?.revision)}
              canRelate={isRelatableKnowledgePage(props.selectedNote) && Boolean(props.activeVaultId && props.selectedNote.renderContextId && props.selectedNote.trashEligibility?.revision && props.onRelateCurrentNote)}
              canArchive={props.selectedNote.archiveEligibility?.canArchive === true && Boolean(props.onArchiveCurrentNote)} archiveLabels={readerDocumentArchiveLabels(props.t)} canRestore={props.selectedNote.restoreEligibility?.canRestore === true && Boolean(props.onRestoreArchivedNote)} restoreLabels={readerDocumentRestoreLabels(props.t)} canRename={props.selectedNote.renameEligibility?.canRename === true && Boolean(props.onRenameCurrentNote)} renameLabels={readerNoteRenameLabels(props.t)} canManageAliases={Boolean(props.onChangeNoteAlias && (props.selectedNote.aliasing?.canAdd || props.selectedNote.aliasing?.canRemove))} canAddAlias={props.selectedNote.aliasing?.canAdd === true} aliases={props.selectedNote.aliasing?.aliases ?? []} aliasLabels={readerNoteAliasLabels(props.t)} canAddTag={summary.status === "active" && props.selectedNote.tagging?.canEdit === true && Boolean(props.onAddNoteTag)} existingTags={props.selectedNote.tagging?.tags ?? []} existingTopics={props.selectedNote.tagging?.topics ?? []} tagLabels={readerNoteTagLabels(props.t)}
              currentTitle={summary.title}
              labels={readerDocumentActionLabels(props.t)}
              mergeLabels={readerNoteMergeLabels(props.t)}
              relateLabels={readerNoteRelateLabels(props.t)}
              onMoveToTrash={trashSelectedNote}
              onArchive={archiveSelectedNote} onArchiveCommitted={props.onCurrentNoteArchived ?? props.onCurrentNoteMerged} onRestore={restoreSelectedNote} onRestoreCommitted={props.onCurrentNoteRestored ?? props.onCurrentNoteMerged} onRename={renameSelectedNote} onRenameCommitted={props.onCurrentNoteRenamed ?? props.onCurrentNoteMerged} onAliasChange={changeSelectedNoteAlias} onAliasCommitted={props.onCurrentNoteAliasChanged ?? props.onCurrentNoteMerged} onAddTag={addTagToSelectedNote} onRemoveTag={removeTagFromSelectedNote} onTagCommitted={props.onCurrentNoteTagged ?? props.onCurrentNoteMerged}
              onLoadMergeTargets={() => props.onLoadNoteMergeTargets(summary.pageId)}
              onMerge={mergeSelectedNote}
              onLoadRelateTargets={() => (props.onLoadNoteRelateTargets ?? props.onLoadNoteMergeTargets)(summary.pageId)}
              onRelate={relateSelectedNote}
              onCommitted={() => props.onCurrentNoteTrashed?.()}
              onMergeCommitted={props.onCurrentNoteMerged}
              onRelateCommitted={props.onCurrentNoteRelated ?? props.onCurrentNoteMerged}
            />
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
          {...(props.searchFocusSegmentId ? { focusSegmentId: props.searchFocusSegmentId } : {})}
          {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
          {...(props.onResolveReaderSelection ? { onResolveSelection: props.onResolveReaderSelection } : {})}
          {...(props.onSubmitReaderSelectionAction ? { onSubmitSelectionAction: props.onSubmitReaderSelectionAction } : {})}
          {...(props.onSubmitReaderSelectionLink ? { onSubmitSelectionLink: props.onSubmitReaderSelectionLink } : {})}
          {...(props.onSubmitReaderSelectionTransform ? { onSubmitSelectionTransform: props.onSubmitReaderSelectionTransform } : {})}
          {...(props.onSubmitReaderSelectionCreateNote ? { onSubmitSelectionCreateNote: props.onSubmitReaderSelectionCreateNote } : {})}
          {...(props.locale ? { locale: props.locale } : {})}
          {...(props.onReaderSelectionAction ? { onSelectionActionResult: props.onReaderSelectionAction } : {})}
          {...(props.onReaderSelectionLinkApplied ? { onSelectionLinkApplied: props.onReaderSelectionLinkApplied } : {})}
          {...(props.onReaderSelectionTransform ? { onSelectionTransformResult: props.onReaderSelectionTransform } : {})}
          {...(props.onReaderSelectionCreateNote ? { onSelectionCreateNoteResult: props.onReaderSelectionCreateNote } : {})}
          related={props.selectedNoteRelated}
          relatedLoadingPageId={props.noteLoadingPageId}
          onOpenRelated={props.onOpenNote} onUnlinkRelated={window.pige.notes.unlinkRelation} onRelatedUnlinked={props.onCurrentNoteRelated ?? props.onCurrentNoteMerged}
          {...(props.onOpenSourceReference ? { onOpenSourceReference: props.onOpenSourceReference } : {})}
          {...(props.onRevealSource ? { onRevealSource: props.onRevealSource } : {})}
          {...(props.onReconnectOriginalSource ? {
            onReconnectOriginalSource: props.onReconnectOriginalSource
          } : {})}
          {...(props.onCurrentNoteSourceReconnected ? {
            onSourceReconnected: props.onCurrentNoteSourceReconnected
          } : {})}
          onOpenSourcePage={props.onOpenNote}
          onSetQuestionState={(request) => window.pige.notes.setQuestionState(request)} onSetClaimConfidence={(request) => window.pige.notes.setClaimConfidence(request)} onSearchQuestionAnswers={(request) => window.pige.notes.searchQuestionAnswers(request)} onChangeQuestionAnswer={(request) => window.pige.notes.changeQuestionAnswer(request)} onSearchClaimContradictions={(request) => window.pige.notes.searchClaimContradictions(request)} onChangeClaimContradiction={(request) => window.pige.notes.changeClaimContradiction(request)} onSearchConceptParents={(request) => window.pige.notes.searchConceptParents(request)} onChangeConceptParent={(request) => window.pige.notes.changeConceptParent(request)}
          onQuestionStateChanged={props.onCurrentNoteMerged}
          onClaimConfidenceChanged={props.onCurrentNoteMerged}
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
        {activeVaultId && props.onImportMarkdown && props.onNoteImported ? (
          <LibraryMarkdownImportAction
            activeVaultId={activeVaultId}
            t={props.t}
            onImport={props.onImportMarkdown}
            onImported={props.onNoteImported}
          />
        ) : null}
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
        {props.collectionCatalog !== undefined ? (
          <section className="search-group" aria-labelledby="library-datasets-heading">
            <h2 id="library-datasets-heading">{props.t("collection.datasets")}</h2>
            {props.collectionCatalog?.status === "failed" ? (
              <div className="library-state inline-unavailable" role="alert">
                <div className="state-copy">
                  <p>{props.t("collection.datasetsFailed")}</p>
                  <button type="button" className="primary-button" onClick={() => void props.onRefreshCollectionCatalog?.()}>
                    {props.t("library.refresh")}
                  </button>
                </div>
              </div>
            ) : !props.collectionCatalog || props.collectionCatalogLoading && props.collectionCatalog.status !== "ready" ? (
              <p role="status" aria-busy="true">{props.t("collection.datasetsLoading")}</p>
            ) : props.collectionCatalog.datasets.length === 0 ? (
              <p className="search-empty visible">{props.t("collection.datasetsEmpty")}</p>
            ) : (
              <>
                {props.collectionCatalog.datasets.map((dataset) => (
                  <section key={dataset.datasetId} aria-label={dataset.title}>
                    <h3>{dataset.title}</h3>
                    {dataset.tables.map((table) => (
                      <button
                        type="button"
                        className="search-result"
                        key={table.tableId}
                        disabled={!table.canOpen}
                        aria-label={`${props.t("collection.open")}: ${table.tableName}`}
                        onClick={() => void props.onOpenCollection?.(dataset.datasetId, table.tableId)}
                      >
                        <span className="search-result-copy">
                          <strong>{table.tableName}</strong>
                          <span>{props.t("dataset.rows")}: {table.rowCount}</span>
                        </span>
                        <small>{props.t("collection.open")}</small>
                      </button>
                    ))}
                    {props.onTrashDataset && props.activeVaultId ? <ManagedDatasetTrashAction activeVaultId={props.activeVaultId}
                      dataset={dataset} onTrash={props.onTrashDataset} onCommitted={() => undefined} t={props.t} /> : null}
                  </section>
                ))}
                {props.collectionCatalog.hasMore ? (
                  <button
                    type="button"
                    className="settings-button"
                    disabled={props.collectionCatalogLoading}
                    onClick={() => void props.onLoadMoreCollections?.()}
                  >
                    {props.t(props.collectionCatalogLoading ? "collection.datasetsLoading" : "collection.loadMoreDatasets")}
                  </button>
                ) : null}
              </>
            )}
          </section>
        ) : null}
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
      ) : family === "tags" && activeVaultId && props.tagsApi ? (
        <LibraryTagsBrowser
          activeVaultId={activeVaultId}
          api={props.tagsApi}
          labels={{
            title: props.t("library.tagsTitle"), loading: props.t("library.tagsLoading"),
            empty: props.t("library.tagsEmpty"), failed: props.t("library.tagsFailed"),
            retry: props.t("library.tagsRetry"), notesLoading: props.t("library.tagNotesLoading"),
            notesEmpty: props.t("library.tagNotesEmpty"), notesFailed: props.t("library.tagNotesFailed"),
            loadMore: props.t("library.tagsLoadMore"), loadingMore: props.t("library.tagsLoadingMore"),
            open: props.t("library.tagsOpen"), rename: props.t("library.tagRename"), renameTitle: props.t("library.tagRenameTitle"), renameDescription: props.t("library.tagRenameDescription"),
            renameCurrent: props.t("library.tagRenameCurrent"), renameReplacement: props.t("library.tagRenameReplacement"), renameCancel: props.t("library.tagRenameCancel"), renameConfirm: props.t("library.tagRenameConfirm"), renamePending: props.t("library.tagRenamePending"), renameFailed: props.t("library.tagRenameFailed"),
            merge: props.t("library.tagMerge"), mergeTitle: props.t("library.tagMergeTitle"), mergeDescription: props.t("library.tagMergeDescription"), mergeSource: props.t("library.tagMergeSource"),
            mergeTarget: props.t("library.tagMergeTarget"), mergeCancel: props.t("library.tagMergeCancel"), mergeConfirm: props.t("library.tagMergeConfirm"), mergePending: props.t("library.tagMergePending"), mergeFailed: props.t("library.tagMergeFailed"),
            remove: props.t("library.tagRemove"), removeTitle: props.t("library.tagRemoveTitle"), removeDescription: props.t("library.tagRemoveDescription"), removeCurrent: props.t("library.tagRemoveCurrent"),
            removePageCount: props.t("library.tagRemovePageCount"), removeCancel: props.t("library.tagRemoveCancel"), removeConfirm: props.t("library.tagRemoveConfirm"), removePending: props.t("library.tagRemovePending"), removeFailed: props.t("library.tagRemoveFailed"),
            removePage: props.t("library.pageTagRemove"), removePageTitle: props.t("library.pageTagRemoveTitle"), removePageDescription: props.t("library.pageTagRemoveDescription"), removePageCurrentTag: props.t("library.pageTagRemoveCurrentTag"), removePageCurrentPage: props.t("library.pageTagRemoveCurrentPage"), removePageConfirm: props.t("library.pageTagRemoveConfirm"), removePagePending: props.t("library.pageTagRemovePending"), removePageFailed: props.t("library.pageTagRemoveFailed"), noteCount: (count) => `${count} ${props.t("library.tagsPages")}`,
          }}
          onOpenNote={props.onOpenNote}
        />
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
                      onClick={() => void (
                        resultMatchesCurrentQuery && props.onOpenSearchMatch
                          ? props.onOpenSearchMatch(item.summary.pageId, normalizedQuery)
                          : props.onOpenNote(item.summary.pageId)
                      )}
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
          {normalizedQuery.length === 0 && props.canLoadMore && props.onLoadMore ? (
            <div className="library-load-more">
              {props.loadMoreFailed ? (
                <p role="alert">{props.t("library.loadMoreFailed")}</p>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                disabled={props.loadingMore}
                aria-busy={props.loadingMore}
                onClick={() => void props.onLoadMore?.()}
              >
                {props.loadingMore ? props.t("library.loadingMore") : props.t("library.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
        </div>
      </div>
    </section>
  );
}


export function KnowledgeTreePanel(props: {
  readonly tree: KnowledgeTreeResult | null;
  readonly error: string | null;
  readonly noteLoadingPageId: string | null;
  readonly onGoHome: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onLoadRelated: (pageId: string) => Promise<LibraryRelatedResult>;
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
            activeVaultId={props.tree.activeVaultId}
            noteLoadingPageId={props.noteLoadingPageId}
            onLoadRelated={props.onLoadRelated}
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

function submitReaderSelectionLink(request: ReaderSelectionLinkRequest): Promise<ReaderSelectionLinkResult> {
  return window.pige.readerSelection.submitLink(request);
}

function submitReaderSelectionTransform(request: ReaderSelectionTransformRequest): Promise<ReaderSelectionTransformResult> {
  return window.pige.readerSelection.submitTransform(request);
}

function submitReaderSelectionCreateNote(
  request: ReaderSelectionCreateNoteRequest
): Promise<ReaderSelectionCreateNoteResult> {
  return window.pige.readerSelection.submitCreateNote(request);
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
  readonly onRecentVaultsChanged: (recentVaults: readonly RecentVaultSummary[]) => void;
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
              onRecentVaultsChanged={props.onRecentVaultsChanged}
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
  readonly dictationLanguageTag: Locale;
  readonly onReaderSelectionAction: (result: ReaderSelectionActionResult) => void;
  readonly onSubmitReaderSelectionTransform: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly onReaderSelectionTransform: (result: ReaderSelectionTransformResult) => void;
  readonly onReaderSelectionCreateNote: (result: ReaderSelectionCreateNoteResult) => void;
  readonly onReaderSelectionContextChange: (context: HomeReaderSelectionContext | null) => void;
  readonly readerDurableRefresh: HomeReaderDurableRefresh | null;
  readonly onOpenNoteEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onSaveNoteEditor: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
  readonly onReloadNoteEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  readonly onLoadNoteMergeTargets: (currentPageId: string) => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onLoadNoteRelateTargets: (currentPageId: string) => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onMergeCurrentNote: (request: NoteMergeRequest) => Promise<NoteMergeResult>;
  readonly onRelateCurrentNote: (request: NoteRelateRequest) => Promise<NoteRelateResult>;
  readonly onOpenCollection: (datasetId: string, tableId: string) => Promise<boolean>;
  readonly onOpenCollectionCitation: (
    conversationId: string,
    assistantEventId: string,
    citationRef: string
  ) => Promise<boolean>;
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
  readonly onCancelJob: (jobId: string) => Promise<unknown>;
  readonly onRetryJob: (jobId: string) => Promise<unknown>;
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
  const [selectedHistoryConversationId, setSelectedHistoryConversationId] = useState<string | null>(null);
  const [pickerConversationAuthority, setPickerConversationAuthority] = useState<{
    readonly items: readonly StagedComposerItem[];
    readonly timeline: AgentConversationInitialTimeline | undefined;
  } | null>(null);
  const [optimisticConversationTurns, setOptimisticConversationTurns] = useState<readonly OptimisticConversationTurn[]>([]);
  const [liveAnswerEventId, setLiveAnswerEventId] = useState<string | null>(null);
  const [processingListExpanded, setProcessingListExpanded] = useState(false);
  const sourceReconnect = useHomeSourceReconnect({ activeVaultId: props.activeVault?.vaultId,
    recentJobs: props.recentJobs, onHomeStateChanged: props.onHomeStateChanged, t: props.t });
  const [proposalReview, setProposalReview] = useState<{
    readonly activeVaultId: string;
    readonly jobId: string;
    readonly proposalId: string;
    readonly returnFocus: HTMLButtonElement;
  } | null>(null);
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
  const [failedFileDropRecovery, setFailedFileDropRecovery] = useState<FailedFileDropRecovery | null>(null);
  const [captureBatchStatus, setCaptureBatchStatus] = useState<HomeCaptureBatchStatus | null>(null);
  const [composerSubmitActive, setComposerSubmitActive] = useState(false);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteFocusSegmentId, setSelectedNoteFocusSegmentId] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState<NoteMarkdownEditorReady | null>(null);
  const [editorOpenState, setEditorOpenState] = useState<"idle" | "opening" | "failed">("idle");
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  useEffect(() => {
    const context = props.activeVault && selectedNote
      ? {
          vaultId: props.activeVault.vaultId,
          pageId: selectedNote.summary.pageId,
          title: selectedNote.summary.title
        }
      : null;
    props.onReaderSelectionContextChange(context);
    return () => props.onReaderSelectionContextChange(null);
  }, [props.activeVault?.vaultId, selectedNote?.summary.pageId, selectedNote?.summary.title]);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationTimelineRef = useRef<HTMLElement | null>(null);
  const homeSectionRef = useRef<HTMLElement | null>(null);
  const processingPanelRef = useRef<HTMLElement | null>(null);
  const followConversationRef = useRef(true);
  const conversationPagination = useConversationPagination({
    ownerKey: props.activeVault
      ? `${props.activeVault.vaultId}:home:${selectedHistoryConversationId ?? "current"}`
      : "home:none",
    initial: conversationTimeline,
    scrollRef: conversationTimelineRef
  });
  const composerSubmissionRef = useRef<HomeComposerSubmissionBinding | null>(null);
  const composerCompositionActiveRef = useRef(false);
  const composerCompositionRaceRef = useRef(false);
  const composerCompositionTimerRef = useRef<number | undefined>(undefined);
  const draftRevisionRef = useRef(0);
  const stagedAttachmentRevisionRef = useRef(0);
  const pastedUrlRef = useRef<string | null>(null);
  const stagedComposerAttemptRef = useRef<{
    readonly key: string;
    readonly clientTurnId: string;
  } | null>(null);
  const noteOpenSequence = useRef(0);
  const editorOpenSequence = useRef(0);
  const editorOpenerRef = useRef<HTMLButtonElement | null>(null);
  const inlineReferenceSequence = useRef(0);
  const selectedNoteRef = useRef<NoteRenderResult | null>(selectedNote);
  const readerSelectionTransformOwnerRef = useRef<{
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly pageId: string;
    readonly renderContextId: string;
    readonly inFlight: boolean;
  } | null>(null);
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
  const voiceLanguageTagRef = useRef(props.dictationLanguageTag);
  const draftTextRef = useRef(text);
  const conversationLoadSequence = useRef(0);
  const pickerConversationLoadSequence = useRef(0);
  const locallyCompletedConversationTailRef = useRef<{
    readonly vaultId: string;
    readonly conversationId: string;
    readonly tailEventId: string;
  } | null>(null);
  const handledFileDropClientTurnIdRef = useRef<string | null>(null);
  const failedFileDropRecoveryRef = useRef<FailedFileDropRecovery | null>(null);
  const activeVaultIdRef = useRef<string | undefined>(props.activeVault?.vaultId);
  const selectedHistoryConversationIdRef = useRef<string | null>(selectedHistoryConversationId);
  const activeAgentDraftRef = useRef<ActiveAgentDraftBinding | null>(null);
  activeVaultIdRef.current = props.activeVault?.vaultId;
  failedFileDropRecoveryRef.current = failedFileDropRecovery;
  selectedHistoryConversationIdRef.current = selectedHistoryConversationId;
  selectedNoteRef.current = selectedNote;
  voiceLanguageTagRef.current = props.dictationLanguageTag;
  draftTextRef.current = text;

  useEffect(() => {
    editorOpenSequence.current += 1;
    setEditorReady(null);
    setEditorOpenState("idle");
  }, [props.activeVault?.vaultId, selectedNote?.summary.pageId, selectedNote?.renderContextId]);

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
    const languageTag = props.dictationLanguageTag;
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
      const availability = await window.pige.speech.availability({
        languageTag: props.dictationLanguageTag
      });
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
        languageTag: props.dictationLanguageTag
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

  const viewingHistory = selectedHistoryConversationId !== null;
  const latestTurn = viewingHistory ? undefined : conversationTimeline?.latestTurn;
  const followableTailJobId = !viewingHistory && canFollowUpToConversation(conversationTimeline)
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
  const proposalReviewJobs = props.recentJobs.flatMap((job) =>
    job.state === "awaiting_review" &&
    conversationTimeline?.latestTurn?.state === "awaiting_review" &&
    conversationTimeline.latestTurn.jobId === job.id &&
    conversationTimeline.latestTurn.proposalId
      ? [{ jobId: job.id, proposalId: conversationTimeline.latestTurn.proposalId }]
      : []
  );
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
  const effectiveAgentRunState = viewingHistory
    ? "idle"
    : noSourceCurrentTurn
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
  const showConversationRunMessage = !viewingHistory && !sourceWaitOwnsAgentState &&
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
    return message.answer?.datasetResult !== undefined || message.captureReferences?.length || conversationMessageMarkdown(message).trim().length > 0;
  });
  const visibleOptimisticConversationTurns = (viewingHistory ? [] : optimisticConversationTurns).filter((turn) =>
    !(conversationPagination.messages.some((message) =>
      message.role === "user" && (
        (turn.conversationEventId !== undefined && message.id === turn.conversationEventId) ||
        (turn.jobId !== undefined && message.jobId === turn.jobId)
      )
    ) ?? false)
  );
  const liveConversationAnswer = !viewingHistory && agentAnswer && !agentAnswer.datasetResult && !agentAnswer.retrieval
    ? agentAnswer
    : null;
  const conversationFollowKey = [
    visibleConversationMessages.at(-1)?.id ?? "none",
    visibleOptimisticConversationTurns.at(-1)?.clientTurnId ?? "none",
    viewingHistory ? 0 : agentDraft?.sequence ?? 0,
    viewingHistory ? 0 : agentDraft?.text.length ?? 0,
    liveConversationAnswer?.answer.length ?? 0,
    effectiveAgentRunState
  ].join(":");

  const sourceRepairAction = (job: JobSummary) => job.class === "agent_turn" && job.canReconnectDependency === true ? {
    label: props.t("home.reconnectOriginalSource"),
    pendingLabel: props.t("home.reconnectOriginalSourceChecking"),
    pending: sourceReconnect.pendingJobId === job.id,
    onActivate: () => sourceReconnect.reconnect(job),
    returnFocusRef: processingPanelRef
  } : undefined;

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
    (viewingHistory || agentDraft === null) &&
    (viewingHistory || agentAnswer === null) &&
    selectedNote === null;
  const showConversationTimeline = selectedNote === null && (visibleConversationMessages.length > 0 ||
    visibleOptimisticConversationTurns.length > 0 ||
    (!viewingHistory && agentDraft !== null) ||
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

  const refreshConversationResult = async (
    expectedConversationId?: string,
    options?: { readonly conversationId?: string; readonly ignoreLocalTail?: boolean }
  ): Promise<
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
    const requestedConversationId = options?.conversationId ?? selectedHistoryConversationIdRef.current;
    try {
      const nextTimeline = await window.pige.agent.conversation({
        limit: 100,
        ...(requestedConversationId ? { conversationId: requestedConversationId } : {})
      });
      if (requestId === conversationLoadSequence.current && activeVaultIdRef.current === vaultId) {
        if (expectedConversationId && nextTimeline?.conversationId !== expectedConversationId) {
          return { status: "ignored" };
        }
        const localTail = locallyCompletedConversationTailRef.current;
        const acknowledgesLocalTail = options?.ignoreLocalTail || !localTail || (
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

  useEffect(() => {
    if (proposalReview && proposalReview.activeVaultId !== props.activeVault?.vaultId) {
      setProposalReview(null);
    }
  }, [proposalReview, props.activeVault?.vaultId]);

  const openConversationView = async (
    conversationId: string, view: "current" | "history", expectedTailEventId: string, searchMatchEventId?: string
  ): Promise<boolean> => {
    const result = await refreshConversationResult(conversationId, {
      conversationId,
      ignoreLocalTail: true
    });
    if (result.status !== "adopted" || result.timeline?.conversationId !== conversationId ||
      result.timeline.tailEventId !== expectedTailEventId) return false;
    selectedHistoryConversationIdRef.current = view === "history" ? conversationId : null;
    setSelectedHistoryConversationId(view === "history" ? conversationId : null);
    followConversationRef.current = true;
    noteOpenSequence.current += 1;
    inlineReferenceSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    if (searchMatchEventId) window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => void conversationPagination.revealEvent(searchMatchEventId)));
    return true;
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
    if (!vaultId || items.length === 0 || selectedHistoryConversationIdRef.current) return;
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
  }, [props.activeVault?.vaultId, selectedHistoryConversationId, stagedComposerItems]);

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
    selectedHistoryConversationIdRef.current = null;
    setSelectedHistoryConversationId(null);
    setConversationTimeline(undefined);
    locallyCompletedConversationTailRef.current = null;
    setOptimisticConversationTurns([]);
    stagedAttachmentRevisionRef.current += 1;
    stagedComposerAttemptRef.current = null;
    pastedUrlRef.current = null;
    setStagedComposerItems([]);
    setFailedFileDropRecovery(null);
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

  const restoreComposerFocus = (): void => {
    const input = composerInputRef.current;
    const activeElement = document.activeElement;
    if (!input || (activeElement !== document.body && !input.closest(".composer")?.contains(activeElement))) return;
    input.focus({ preventScroll: true });
  };

  const submitHomeInput = async (): Promise<void> => {
    const hasText = text.trim().length > 0;
    const hasRejectedPaste = stagedComposerItems.some((item) => item.kind === "rejected_pasted_text");
    const hasAttachments = stagedComposerItems.length > 0;
    if (
      viewingHistory ||
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
      if (submittedFiles.length > 0) {
        setCaptureBatchStatus({ status: "submitting", queuedCount: 0, rejectedFiles: [] });
      }
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
        if (activeVaultIdRef.current !== submittedVaultId) {
          clearAgentDraft();
          setActiveSourceTurn(null);
          setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
          return;
        }
        if (outcome.state !== "accepted") {
          clearAgentDraft();
          setActiveSourceTurn(null);
          setOptimisticConversationTurns((current) => current.filter((turn) => turn.clientTurnId !== clientTurnId));
          setAgentError(outcome.error);
          setAgentRunState("failed");
          if (submittedFiles.length > 0) {
            setCaptureBatchStatus(settleHomeCaptureBatch(
              outcome.sourceIds.length,
              outcome.rejectedItems?.map((item) => ({ displayName: item.displayName, reason: item.reason })) ?? outcome.rejectedFiles ?? [],
              true
            ));
          }
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
        if (submittedFiles.length > 0) {
          setCaptureBatchStatus(settleHomeCaptureBatch(
            outcome.acceptedItems?.filter((item) => item.kind === "file").length ?? outcome.sourceIds.length,
            outcome.rejectedItems?.filter((item) => item.kind === "file")
              .map((item) => ({ displayName: item.displayName, reason: item.reason })) ?? [],
            false
          ));
        }
        setActiveSourceTurn({
          clientTurnId,
          jobId: outcome.jobId,
          pending: false,
          sourceDisplayName
        });
        if (submittedFiles.length > 0 && activeVaultIdRef.current === submittedVaultId) {
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
        if (activeVaultIdRef.current === submittedVaultId) {
          setCaptureBatchStatus({ status: "failed", queuedCount: 0, rejectedFiles: [] });
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
        restoreComposerFocus();
      }
      return;
    }
    followConversationRef.current = true;
    setCaptureError(null);
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
    const submittedInputKind = pastedUrlRef.current === submittedText
      ? "pasted_url" as const
      : classifyTextTransportKind(submittedText);
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
    const followUpConversation = !viewingHistory && canFollowUpToConversation(conversationTimeline)
      ? conversationTimeline
      : undefined;
    beginAgentDraft(clientTurnId);
    try {
      const submission = window.pige.agent.submitTurn({
        schemaVersion: 1,
        text: turnText,
        inputKind: followUpConversation ? "follow_up" : submittedInputKind,
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
        if (pastedUrlRef.current === submittedText) pastedUrlRef.current = null;
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
        if (pastedUrlRef.current === submittedText) pastedUrlRef.current = null;
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
      viewingHistory ||
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
    const submittedVaultId = activeVaultIdRef.current;
    const sourceDisplayName = files[0]?.name ?? null;
    setCaptureError(null);
    setCaptureBatchStatus({ status: "submitting", queuedCount: 0, rejectedFiles: [] });
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
        if (activeVaultIdRef.current === submittedVaultId) {
          setCaptureBatchStatus({ status: "failed", queuedCount: 0, rejectedFiles: [] });
        }
        if (inputKind === "file_drop" && submittedVaultId && activeVaultIdRef.current === submittedVaultId) {
          setFailedFileDropRecovery({ activeVaultId: submittedVaultId, clientTurnId, files });
        }
        return;
      }
      if (activeVaultIdRef.current !== submittedVaultId) return;
      setCaptureBatchStatus(settleHomeCaptureBatch(
        result.sourceIds.length,
        result.rejectedFiles ?? [],
        result.state === "failed"
      ));
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
        if (result.state === "failed" && inputKind === "file_drop" && submittedVaultId && activeVaultIdRef.current === submittedVaultId) {
          setFailedFileDropRecovery({ activeVaultId: submittedVaultId, clientTurnId, files });
        }
      }
      if (
        result.state !== "failed" &&
        failedFileDropRecoveryRef.current?.clientTurnId === clientTurnId
      ) setFailedFileDropRecovery(null);
      await refreshConversation();
    } catch {
      clearAgentDraft();
      setActiveSourceTurn(null);
      setAgentRunState("failed");
      if (activeVaultIdRef.current === submittedVaultId) {
        setCaptureBatchStatus({ status: "failed", queuedCount: 0, rejectedFiles: [] });
      }
      if (inputKind === "file_drop" && submittedVaultId && activeVaultIdRef.current === submittedVaultId) {
        setFailedFileDropRecovery({ activeVaultId: submittedVaultId, clientTurnId, files });
      }
    }
  };

  const retryFailedFileDrop = async (): Promise<void> => {
    const recovery = failedFileDropRecoveryRef.current;
    if (
      !recovery ||
      recovery.activeVaultId !== activeVaultIdRef.current ||
      recovery.files.length === 0 ||
      !beginComposerSubmission(recovery.clientTurnId)
    ) return;
    void submitHomeFiles(recovery.files, "file_drop", undefined, recovery.clientTurnId)
      .finally(() => {
        finishComposerSubmission(recovery.clientTurnId);
        restoreComposerFocus();
      });
  };

  const stagePickedFiles = (files: readonly File[]): void => {
    const acceptedItemCount = stagedComposerItems.filter((item) => item.kind !== "rejected_pasted_text").length;
    const availableItemCount = Math.max(0, AGENT_STAGED_ITEM_MAX_COUNT - acceptedItemCount);
    const acceptedFiles = files.slice(0, availableItemCount);
    if (acceptedFiles.length === 0) {
      setCaptureError(props.t("home.attachmentRejection.tooManyFiles"));
      return;
    }
    stagedAttachmentRevisionRef.current += 1;
    stagedComposerAttemptRef.current = null;
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
  };

  const submitImmediateDrop = (files: readonly File[]): void => {
    const activeVaultId = activeVaultIdRef.current;
    if (!activeVaultId || files.length === 0) return;
    const clientTurnId = createAgentClientTurnId();
    if (!beginComposerSubmission(clientTurnId)) return;
    selectedHistoryConversationIdRef.current = null;
    setSelectedHistoryConversationId(null);
    void submitHomeFiles(files, "file_drop", undefined, clientTurnId)
      .finally(() => {
        finishComposerSubmission(clientTurnId);
        restoreComposerFocus();
      });
  };

  useEffect(() => {
    setCaptureBatchStatus(null);
  }, [props.activeVault?.vaultId]);

  useEffect(() => {
    const request = props.fileDropRequest;
    if (
      !request ||
      composerSubmissionRef.current ||
      handledFileDropClientTurnIdRef.current === request.clientTurnId
    ) return;
    handledFileDropClientTurnIdRef.current = request.clientTurnId;
    if (!beginComposerSubmission(request.clientTurnId)) return;
    selectedHistoryConversationIdRef.current = null;
    setSelectedHistoryConversationId(null);
    props.onFileDropRequestConsumed(request.clientTurnId);
    void submitHomeFiles(request.files, "file_drop", request.text, request.clientTurnId)
      .finally(() => {
        finishComposerSubmission(request.clientTurnId);
        restoreComposerFocus();
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

  const openResultTarget = async (
    pageId: string,
    reportError = true,
    searchQuery?: string
  ): Promise<boolean> => {
    const vaultId = activeVaultIdRef.current;
    if (!vaultId) return false;
    inlineReferenceSequence.current += 1;
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setCaptureError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const searchResult = searchQuery
        ? await window.pige.notes.openSearchMatch({
            apiVersion: 1,
            requestId: `notesearch_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
            activeVaultId: vaultId,
            pageId,
            query: searchQuery
          })
        : null;
      if (searchResult && searchResult.status !== "ready") throw new Error("Search result is no longer available.");
      const note = searchResult?.render ?? await window.pige.notes.render({ pageId });
      if (
        requestId !== noteOpenSequence.current ||
        activeVaultIdRef.current !== vaultId ||
        note.summary.pageId !== pageId
      ) return false;
      setSelectedNote(note);
      setSelectedNoteFocusSegmentId(searchResult?.focusSegmentId ?? null);
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

  const openSearchResult = async (pageId: string, query?: string): Promise<void> => {
    await openResultTarget(pageId, true, query);
  };

  useEffect(() => {
    const refresh = props.readerDurableRefresh;
    const note = selectedNoteRef.current;
    if (
      !refresh ||
      activeVaultIdRef.current !== refresh.vaultId ||
      note?.summary.pageId !== refresh.pageId
    ) return;
    void openResultTarget(refresh.pageId, false);
  }, [props.readerDurableRefresh?.sequence]);

  const submitHomeReaderSelectionTransform = async (
    request: ReaderSelectionTransformRequest
  ): Promise<ReaderSelectionTransformResult> => {
    const note = selectedNoteRef.current;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    if (
      readerSelectionTransformOwnerRef.current?.inFlight ||
      !note ||
      !activeVaultId ||
      !renderContextId ||
      request.selection.pageId !== note.summary.pageId
    ) throw new Error("Reader selection transform owner is unavailable.");
    const owner = {
      requestId: request.requestId,
      activeVaultId,
      pageId: note.summary.pageId,
      renderContextId,
      inFlight: true
    };
    readerSelectionTransformOwnerRef.current = owner;
    try {
      const result = await props.onSubmitReaderSelectionTransform(request);
      if (readerSelectionTransformOwnerRef.current === owner) {
        readerSelectionTransformOwnerRef.current = { ...owner, inFlight: false };
      }
      return result;
    } catch (error) {
      if (readerSelectionTransformOwnerRef.current === owner) readerSelectionTransformOwnerRef.current = null;
      throw error;
    }
  };

  const revealHomeReaderSelectionTransform = (result: ReaderSelectionTransformResult): void => {
    const owner = readerSelectionTransformOwnerRef.current;
    readerSelectionTransformOwnerRef.current = null;
    if (
      !owner ||
      result.requestId !== owner.requestId ||
      activeVaultIdRef.current !== owner.activeVaultId ||
      selectedNoteRef.current?.summary.pageId !== owner.pageId ||
      selectedNoteRef.current.renderContextId !== owner.renderContextId
    ) return;
    props.onReaderSelectionTransform(result);
    if (result.status === "applied") void openResultTarget(owner.pageId);
  };

  const openEditor = async (): Promise<void> => {
    const note = selectedNoteRef.current;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    if (!note || !isNoteEditorEligible(note) || !activeVaultId || !renderContextId || editorOpenState === "opening") return;
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

  const trashSelectedHomeNote = async (): Promise<"committed" | "retained"> => {
    const note = selectedNoteRef.current;
    const eligibility = note?.trashEligibility;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    if (!note || !eligibility?.canTrash || !activeVaultId || !renderContextId) return "retained";
    const request: NoteTrashCurrentRequest = {
      apiVersion: 1,
      requestId: createNoteTrashRequestId(),
      activeVaultId,
      currentPageId: note.summary.pageId,
      renderContextId,
      expectedRevision: eligibility.revision
    };
    try {
      const result = await window.pige.notes.trashCurrent(request);
      if (
        !noteTrashCurrentIdentityMatches(request, result) ||
        activeVaultIdRef.current !== activeVaultId ||
        selectedNoteRef.current?.summary.pageId !== request.currentPageId ||
        selectedNoteRef.current.renderContextId !== request.renderContextId ||
        selectedNoteRef.current.trashEligibility?.revision !== request.expectedRevision
      ) return "retained";
      return result.status === "committed" ? "committed" : "retained";
    } catch {
      return "retained";
    }
  };

  const archiveSelectedHomeNote = () => submitReaderNoteArchive({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, submit: (request) => window.pige.notes.archiveCurrent(request), currentNote: () => selectedNoteRef.current }); const restoreSelectedHomeNote = () => submitReaderNoteRestore({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, submit: (request) => window.pige.notes.restoreArchived(request), currentNote: () => selectedNoteRef.current }); const renameSelectedHomeNote = (title: string) => submitReaderNoteRename({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, title, submit: (request) => window.pige.notes.rename(request), currentNote: () => selectedNoteRef.current }); const changeSelectedHomeNoteAlias = (action: "add" | "remove", alias: string) => submitReaderNoteAliasChange({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, action, alias, submit: (request) => window.pige.notes.changeAlias(request), currentNote: () => selectedNoteRef.current }); const addTagToSelectedHomeNote = (tags: readonly string[], topics: readonly string[]) => submitReaderNoteTag({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, tags, topics, submit: (request) => window.pige.notes.editTaxonomy(request), currentNote: () => selectedNoteRef.current }); const removeTagFromSelectedHomeNote = (tag: string) => submitReaderNoteTagRemoval({ note: selectedNoteRef.current, activeVaultId: activeVaultIdRef.current, tag, submit: (request) => window.pige.notes.removeTag(request), currentNote: () => selectedNoteRef.current });

  const mergeSelectedHomeNote = async (target: ReaderNoteMergeTarget): Promise<ReaderNoteMergeOutcome> => {
    const note = selectedNoteRef.current;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    const revision = note?.trashEligibility?.revision;
    if (!note || note.summary.pageType !== "note" || !activeVaultId || !renderContextId || !revision) return { status: "retained" };
    const request: NoteMergeRequest = {
      apiVersion: 1,
      requestId: createNoteMergeRequestId(),
      activeVaultId,
      currentPageId: note.summary.pageId,
      renderContextId,
      expectedRevision: revision,
      targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt
    };
    try {
      const result = await props.onMergeCurrentNote(request);
      if (
        !noteMergeIdentityMatches(request, result) ||
        activeVaultIdRef.current !== request.activeVaultId ||
        selectedNoteRef.current?.summary.pageId !== request.currentPageId ||
        selectedNoteRef.current.renderContextId !== request.renderContextId ||
        selectedNoteRef.current.trashEligibility?.revision !== request.expectedRevision ||
        result.status !== "committed" ||
        result.render.summary.pageId !== request.currentPageId ||
        result.render.summary.pageType !== "note"
      ) return { status: "retained" };
      return { status: "committed", render: result.render };
    } catch {
      return { status: "retained" };
    }
  };

  const relateSelectedHomeNote = async (target: ReaderNoteMergeTarget): Promise<ReaderNoteRelateOutcome> => {
    const note = selectedNoteRef.current;
    const activeVaultId = activeVaultIdRef.current;
    const renderContextId = note?.renderContextId;
    const revision = note?.trashEligibility?.revision;
    if (!note || !isRelatableKnowledgePage(note) || !activeVaultId || !renderContextId || !revision) {
      return { status: "retained" };
    }
    return submitReaderNoteRelation({
      activeVaultId, currentPageId: note.summary.pageId, renderContextId, expectedRevision: revision,
      expectedPageType: note.summary.pageType,
      execute: props.onRelateCurrentNote,
      isCurrent: () => activeVaultIdRef.current === activeVaultId &&
        selectedNoteRef.current?.summary.pageId === note.summary.pageId &&
        selectedNoteRef.current.renderContextId === renderContextId &&
        selectedNoteRef.current.trashEligibility?.revision === revision,
    }, target);
  };

  const adoptMergedHomeNote = (render: NoteRenderResult): void => {
    const requestId = ++noteOpenSequence.current;
    inlineReferenceSequence.current += 1;
    editorOpenSequence.current += 1;
    setSelectedNote(render);
    setSelectedNoteRelated("loading");
    void loadNoteRelated(render.summary.pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    void props.onHomeStateChanged();
    window.requestAnimationFrame(() => homeSectionRef.current?.querySelector<HTMLElement>(".note-reader")?.focus({ preventScroll: true }));
  };

  const adoptReconnectedHomeSource = (render: NoteRenderResult): void => {
    if (selectedNoteRef.current?.summary.pageId !== render.summary.pageId) return;
    const requestId = ++noteOpenSequence.current;
    inlineReferenceSequence.current += 1;
    editorOpenSequence.current += 1;
    setSelectedNote(render);
    setSelectedNoteRelated("loading");
    void loadNoteRelated(render.summary.pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    void props.onHomeStateChanged();
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
              const repair = sourceRepairAction(currentJob);
              return <HomeJobAction
                compact
                job={currentJob}
                sourceWaitingForModel={sourceWaitingForModel}
                ownsSourceModelAction={ownsSourceModelAction}
                retryEligible={currentJob.state === "failed_retryable" && currentJob.class !== "retrieval_query"}
                {...(repair ? { repair } : {})}
                onOpenModels={props.onOpenModels}
                onCancelJob={props.onCancelJob}
                onRetryJob={props.onRetryJob}
                t={props.t}
              />;
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
              const repair = sourceRepairAction(job);
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
                <HomeJobAction
                  job={job}
                  sourceWaitingForModel={sourceWaitingForModel}
                  ownsSourceModelAction={ownsSourceModelAction}
                  retryEligible={job.state === "failed_retryable" && job.class !== "retrieval_query"}
                  {...(repair ? { repair } : {})}
                  onOpenModels={props.onOpenModels}
                  onCancelJob={props.onCancelJob}
                  onRetryJob={props.onRetryJob}
                  t={props.t}
                />
                </span>
              </div>
            );
            })}
            </div>
          ) : null}
          {sourceReconnect.notice ? <p
            className={sourceReconnect.notice.kind === "error" ? "error" : "muted"}
            role={sourceReconnect.notice.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >{props.t(sourceReconnect.notice.key)}</p> : null}
          {sourceReconnect.dialog}
        </section>
      ) : null}
      {props.activeVault && selectedNote === null ? (
        <ConversationHistoryPanel
          activeVaultId={props.activeVault.vaultId}
          locale={props.locale}
          selectedConversationId={selectedHistoryConversationId}
          disabled={composerSubmitActive || agentRunState === "accepted" || agentRunState === "running"}
          onOpenConversation={openConversationView}
          onConversationTrashed={(conversationId) => { if (conversationTimeline?.conversationId === conversationId) { selectedHistoryConversationIdRef.current = null; setSelectedHistoryConversationId(null); setConversationTimeline(undefined); } }} t={props.t}
        />
      ) : null}
      {proposalReviewJobs.length > 0 ? (
        <section className="proposal-strip" aria-label={props.t("proposal.queueTitle")}>
          <header className="proposal-strip-header">
            <h2>{props.t("proposal.queueTitle")}</h2>
          </header>
          <div className="proposal-summary-list">
            {proposalReviewJobs.map((job) => (
              <article className="proposal-summary-card" key={job.jobId}>
                <strong>{props.t("proposal.reviewTitle")}</strong>
                <button
                  type="button"
                  className="secondary"
                  onClick={(event) => setProposalReview({
                    activeVaultId: props.activeVault!.vaultId,
                    jobId: job.jobId,
                    proposalId: job.proposalId,
                    returnFocus: event.currentTarget
                  })}
                >
                  {props.t("proposal.review")}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {proposalReview ? (
        <ProposalReviewPanel
          activeVaultId={proposalReview.activeVaultId}
          jobId={proposalReview.jobId}
          proposalId={proposalReview.proposalId}
          returnFocus={proposalReview.returnFocus}
          onClose={() => setProposalReview(null)}
          onResolved={async () => {
            await Promise.allSettled([props.onHomeStateChanged(), refreshConversation()]);
          }}
          t={props.t}
        />
      ) : null}
      {showConversationTimeline ? (
        <section
          ref={conversationTimelineRef}
          className="conversation-timeline"
          tabIndex={-1}
          aria-label={props.t("home.conversation")}
          aria-busy={!viewingHistory && (agentDraft !== null || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running")}
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
            {!viewingHistory ? <TaskExecutionInteractionStatus t={props.t} /> : null}
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
                    {...(message.role === "assistant" && conversationTimeline ? {
                      onOpenCitation: (citationRef: string) => props.onOpenCollectionCitation(
                        conversationTimeline.conversationId,
                        message.id,
                        citationRef
                      )
                    } : {})}
                    t={props.t}
                  />
                ) : (
                  <>
                    <ConversationMarkdown markdown={markdown} t={props.t} />
                    <ConversationCitations
                      answer={message.answer}
                      noteLoadingPageId={noteLoadingPageId}
                      onOpen={openSearchResult}
                      t={props.t}
                    />
                  </>
                )}
                {message.captureReferences?.length ? <ConversationCaptureReferences references={message.captureReferences} onOpen={(pageId) => void openSearchResult(pageId)} t={props.t} /> : null}
                {message.role === "assistant" ? <ConversationMessageActions messageId={message.id} markdown={markdown}
                  {...props.activeVault && conversationTimeline ? { save: { activeVaultId: props.activeVault.vaultId,
                    conversationId: conversationTimeline.conversationId, assistantEventId: message.id,
                    onSaved: () => void props.onHomeStateChanged() } } : {}} t={props.t} /> : null}
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
          {!viewingHistory && agentDraft ? (
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
                onOpen={openSearchResult}
                t={props.t}
              />
              <ConversationMessageActions messageId={liveAnswerEventId ?? "live-conversation-answer"}
                markdown={liveConversationAnswer.answer} t={props.t} />
            </article>
            ) : null}
          </div>
          <ConversationScrollRail timelineRef={conversationTimelineRef} t={props.t} />
        </section>
      ) : null}
      {selectedNote ? (
        <section className="home-reader">
          {editorReady && isNoteEditorEligible(selectedNote) ? (
            <NoteMarkdownEditor
              ready={editorReady}
              labels={noteMarkdownEditorLabels(props.t)}
              returnFocusRef={editorOpenerRef}
              onSave={props.onSaveNoteEditor}
              onReload={props.onReloadNoteEditor}
              onCommitted={(result) => { if (result.render.summary.pageId !== selectedNote.summary.pageId || result.render.summary.pageType !== selectedNote.summary.pageType) return;
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
                {isNoteEditorEligible(selectedNote) ? (
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
                ) : null}
                <NoteRevisionHistoryDialog
                  note={selectedNote}
                  activeVaultId={props.activeVault?.vaultId}
                  t={props.t}
                  onCommitted={adoptMergedHomeNote}
                />
                <ReaderGeneratedNoteRevealAction activeVaultId={props.activeVault?.vaultId} note={selectedNote}
                  onReveal={(request) => window.pige.notes.revealGenerated(request)} t={props.t} />
                <ReaderDocumentActions
                  ownerIdentity={`${props.activeVault?.vaultId ?? ""}:${selectedNote.summary.pageId}:${selectedNote.renderContextId ?? ""}:${selectedNote.trashEligibility?.revision ?? ""}:${selectedNote.archiveEligibility?.revision ?? ""}:${selectedNote.restoreEligibility?.revision ?? ""}:${selectedNote.renameEligibility?.revision ?? ""}:${selectedNote.aliasing?.revision ?? ""}:${selectedNote.tagging?.revision ?? ""}`}
                  canMoveToTrash={selectedNote.trashEligibility?.canTrash === true && Boolean(props.activeVault && selectedNote.renderContextId)}
                  canMerge={isNoteEditorEligible(selectedNote) && Boolean(props.activeVault && selectedNote.renderContextId && selectedNote.trashEligibility?.revision)}
                  canRelate={isRelatableKnowledgePage(selectedNote) && Boolean(props.activeVault && selectedNote.renderContextId && selectedNote.trashEligibility?.revision)}
                  canArchive={selectedNote.archiveEligibility?.canArchive === true && Boolean(props.activeVault && selectedNote.renderContextId)} archiveLabels={readerDocumentArchiveLabels(props.t)} canRestore={selectedNote.restoreEligibility?.canRestore === true && Boolean(props.activeVault && selectedNote.renderContextId)} restoreLabels={readerDocumentRestoreLabels(props.t)} canRename={selectedNote.renameEligibility?.canRename === true && Boolean(props.activeVault && selectedNote.renderContextId)} renameLabels={readerNoteRenameLabels(props.t)} canManageAliases={Boolean(props.activeVault && selectedNote.renderContextId && (selectedNote.aliasing?.canAdd || selectedNote.aliasing?.canRemove))} canAddAlias={selectedNote.aliasing?.canAdd === true} aliases={selectedNote.aliasing?.aliases ?? []} aliasLabels={readerNoteAliasLabels(props.t)} canAddTag={selectedNote.summary.status === "active" && selectedNote.tagging?.canEdit === true && Boolean(props.activeVault && selectedNote.renderContextId)} existingTags={selectedNote.tagging?.tags ?? []} existingTopics={selectedNote.tagging?.topics ?? []} tagLabels={readerNoteTagLabels(props.t)}
                  currentTitle={selectedNote.summary.title}
                  labels={readerDocumentActionLabels(props.t)}
                  mergeLabels={readerNoteMergeLabels(props.t)}
                  relateLabels={readerNoteRelateLabels(props.t)}
                  onMoveToTrash={trashSelectedHomeNote}
                  onArchive={archiveSelectedHomeNote} onArchiveCommitted={adoptMergedHomeNote} onRestore={restoreSelectedHomeNote} onRestoreCommitted={adoptMergedHomeNote} onRename={renameSelectedHomeNote} onRenameCommitted={adoptMergedHomeNote} onAliasChange={changeSelectedHomeNoteAlias} onAliasCommitted={adoptMergedHomeNote} onAddTag={addTagToSelectedHomeNote} onRemoveTag={removeTagFromSelectedHomeNote} onTagCommitted={adoptMergedHomeNote}
                  onLoadMergeTargets={() => props.onLoadNoteMergeTargets(selectedNote.summary.pageId)}
                  onMerge={mergeSelectedHomeNote}
                  onLoadRelateTargets={() => props.onLoadNoteRelateTargets(selectedNote.summary.pageId)}
                  onRelate={relateSelectedHomeNote}
                  onCommitted={() => {
                    noteOpenSequence.current += 1;
                    inlineReferenceSequence.current += 1;
                    editorOpenSequence.current += 1;
                    setSelectedNote(null);
                    setSelectedNoteRelated(null);
                    void props.onHomeStateChanged();
                    window.requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }));
                  }}
                  onMergeCommitted={adoptMergedHomeNote}
                  onRelateCommitted={adoptMergedHomeNote}
                />
              </div>
              {editorOpenState === "failed" ? (
                <p className="reader-action-status copy_failed" role="status" aria-live="polite">
                  {props.t("note.editor.failed")}
                </p>
              ) : null}
              <NoteReader
                note={selectedNote}
                {...(selectedNoteFocusSegmentId ? { focusSegmentId: selectedNoteFocusSegmentId } : {})}
                {...(props.activeVault && selectedNote.renderContextId ? {
                  activeVaultId: props.activeVault.vaultId,
                  onResolveSelection: resolveReaderSelection,
                  onSubmitSelectionAction: submitReaderSelectionAction,
                  onSubmitSelectionLink: submitReaderSelectionLink,
                  onSubmitSelectionTransform: submitHomeReaderSelectionTransform,
                  onSubmitSelectionCreateNote: submitReaderSelectionCreateNote,
                  onSelectionLinkApplied: async (result: Extract<ReaderSelectionLinkResult, { status: "applied" }>) =>
                    openResultTarget(result.currentPageId),
                  onOpenSourceReference: (request) => window.pige.notes.openSourceReference(request),
                  onRevealSource: (request) => window.pige.notes.revealSource(request),
                  onReconnectOriginalSource: (request) => window.pige.notes.reconnectOriginalSource(request),
                  onSourceReconnected: adoptReconnectedHomeSource,
                  onOpenSourcePage: openResult
                } : {})}
                locale={props.locale}
                onSelectionActionResult={props.onReaderSelectionAction}
                onSelectionTransformResult={revealHomeReaderSelectionTransform}
                onSelectionCreateNoteResult={props.onReaderSelectionCreateNote}
                onSetQuestionState={(request) => window.pige.notes.setQuestionState(request)} onSetClaimConfidence={(request) => window.pige.notes.setClaimConfidence(request)} onSearchQuestionAnswers={(request) => window.pige.notes.searchQuestionAnswers(request)} onChangeQuestionAnswer={(request) => window.pige.notes.changeQuestionAnswer(request)} onSearchClaimContradictions={(request) => window.pige.notes.searchClaimContradictions(request)} onChangeClaimContradiction={(request) => window.pige.notes.changeClaimContradiction(request)} onSearchConceptParents={(request) => window.pige.notes.searchConceptParents(request)} onChangeConceptParent={(request) => window.pige.notes.changeConceptParent(request)}
                onQuestionStateChanged={adoptMergedHomeNote}
                onClaimConfidenceChanged={adoptMergedHomeNote}
                related={selectedNoteRelated}
                relatedLoadingPageId={noteLoadingPageId}
                onOpenRelated={openResult} onUnlinkRelated={window.pige.notes.unlinkRelation} onRelatedUnlinked={adoptMergedHomeNote}
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
          {...(conversationTimeline && liveAnswerEventId ? {
            onOpenCitation: (citationRef: string) => props.onOpenCollectionCitation(
              conversationTimeline.conversationId,
              liveAnswerEventId,
              citationRef
            )
          } : {})}
          t={props.t}
        />
      ) : agentAnswer?.retrieval ? (
        <RetrievalResults
          result={toRetrievalAskResult(agentAnswer)}
          modelUsage={agentModelUsage}
          noteLoadingPageId={noteLoadingPageId}
          onOpen={openSearchResult}
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
        {failedFileDropRecovery ? (
          <section
            className="attachment-strip visible"
            aria-label={props.t("home.messageItems")}
            aria-busy={composerSubmitActive || undefined}
          >
            <div className="attachment-list">
              {failedFileDropRecovery.files.map((file, index) => (
                <div className="attachment-chip" key={`${failedFileDropRecovery.clientTurnId}-${index}`}>
                  <span className="attachment-chip-copy">
                    <strong>{file.name}</strong>
                    <small role="status">{props.t("error.generic")}</small>
                  </span>
                  <button
                    className="chip-remove"
                    type="button"
                    disabled={composerSubmitActive}
                    aria-label={`${props.t("home.removeAttachment")} ${file.name}`}
                    onClick={() => {
                      const files = failedFileDropRecovery.files.filter((_, fileIndex) => fileIndex !== index);
                      setFailedFileDropRecovery(files.length > 0
                        ? {
                            ...failedFileDropRecovery,
                            clientTurnId: createAgentClientTurnId(),
                            files
                          }
                        : null);
                      window.requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }));
                    }}
                  >
                    <PigeIcon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              disabled={composerSubmitActive}
              onClick={() => void retryFailedFileDrop()}
            >
              {props.t("confirmation.retry")}
            </button>
          </section>
        ) : null}
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
        <HomeCaptureDropZone
          disabled={!props.activeVault || composerSubmitActive}
          status={captureBatchStatus}
          onPick={stagePickedFiles}
          onDrop={submitImmediateDrop}
          t={props.t}
        />
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
            setCaptureError(null);
            setStagedComposerItems((current) => [...current, classification.kind === "staged"
              ? { kind: "pasted_text", ...classification.item }
              : { kind: "rejected_pasted_text", reason: classification.reason, ...classification.item }]);
          }, (preparedUrl) => { pastedUrlRef.current = preparedUrl; })}
          onChange={(event) => {
            draftRevisionRef.current += 1;
            stagedComposerAttemptRef.current = null;
            if (pastedUrlRef.current !== event.target.value) pastedUrlRef.current = null;
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
        {pastedUrlRef.current === text ? (
          <p className="composer-status" role="status" aria-live="polite">{props.t("home.urlQueued")}</p>
        ) : null}
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
            type="button"
            className="composer-send"
            aria-label={props.t("home.send")}
            title={!homeModelSendAvailable && stagedComposerItems.length === 0 ? props.t("home.modelUnavailable") : undefined}
            disabled={
              viewingHistory ||
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
    job.state === "waiting_permission" ||
    job.state === "awaiting_review" ||
    job.state === "cancel_requested" ||
    job.state === "failed_retryable";
}

function jobStateMessageKey(job: JobSummary): string {
  if (isSourceWaitingForModel(job)) return "home.sourceSavedWaitingModel";
  if (job.state === "queued") return "home.jobQueued";
  if (job.state === "running") return "home.jobRunning";
  if (job.state === "cancel_requested") return "home.jobCancelRequested";
  if (job.state === "waiting_dependency" || job.state === "waiting_permission") return "home.jobWaiting";
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
  onStage: (classification: Exclude<HomeLargePasteClassification, { readonly kind: "ordinary" }>) => void,
  onPreparedUrl: (url: string | null) => void
): void {
  const pastedText = event.clipboardData.getData("text/plain");
  if (!pastedText) return;
  const selectionStart = event.currentTarget.selectionStart ?? composerText.length;
  const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
  const resultingText = `${composerText.slice(0, selectionStart)}${pastedText}${composerText.slice(selectionEnd)}`;
  if (Array.from(resultingText).length <= AGENT_AUTHORED_TEXT_MAX_CODE_POINTS) {
    onPreparedUrl(classifyTextTransportKind(resultingText.trim()) === "typed_url" ? resultingText : null);
    return;
  }
  onPreparedUrl(null);
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

function createNoteTrashRequestId(): `notetrashreq_${string}` {
  return `notetrashreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createNoteMergeRequestId(): `notemergereq_${string}` {
  return `notemergereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function submitNoteRelation(request: NoteRelateRequest): Promise<NoteRelateResult> {
  return window.pige.notes.relate(request);
}

function noteMergeIdentityMatches(request: NoteMergeRequest, result: NoteMergeResult): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision &&
    result.targetPageId === request.targetPageId &&
    result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}

function noteTrashCurrentIdentityMatches(
  request: NoteTrashCurrentRequest,
  result: NoteTrashCurrentResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision;
}

function readerDocumentActionLabels(t: (key: string) => string) {
  return {
    more: t("note.moreActions"),
    menu: t("note.document.actions"),
    moveToTrash: t("note.document.moveToTrash"),
    title: t("note.document.trashTitle"),
    description: t("note.document.trashDescription"),
    cancel: t("note.document.trashCancel"),
    confirm: t("note.document.trashConfirm"),
    pending: t("note.document.trashing"),
    failed: t("note.document.trashFailed")
  };
}

function readerNoteMergeLabels(t: (key: string) => string) {
  return {
    title: t("note.merge.title"),
    description: t("note.merge.description"),
    survivor: t("note.merge.survivor"),
    target: t("note.merge.target"),
    loading: t("note.merge.loading"),
    empty: t("note.merge.empty"),
    cancel: t("note.merge.cancel"),
    confirm: t("note.merge.confirm"),
    pending: t("note.merge.pending"),
    failed: t("note.merge.failed")
  };
}

function isNoteEditorEligible(note: NoteRenderResult): boolean {
  return note.summary.status !== "archived" && ["note", "source", "claim", "question", "concept", "entity"].includes(note.summary.pageType);
}

function isRelatableKnowledgePage(note: NoteRenderResult): boolean {
  return note.summary.status === "active" && ["note", "claim", "question", "concept", "entity"].includes(note.summary.pageType);
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
    review: t("note.editor.review"),
    reviewing: t("note.editor.reviewing"),
    conflictTitle: t("note.editor.conflict.title"),
    currentFile: t("note.editor.conflict.currentFile"),
    draft: t("note.editor.conflict.draft"),
    useCurrent: t("note.editor.conflict.useCurrent"),
    continueDraft: t("note.editor.conflict.continueDraft"),
    stale: t("note.editor.stale"),
    failed: t("note.editor.failed"),
    notFound: t("note.editor.notFound"),
    currentAccepted: t("note.editor.conflict.currentAccepted"),
    mergeReady: t("note.editor.conflict.mergeReady"),
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

function collectionCitationIdentityMatches(
  request: CollectionOpenCitationRequest,
  result: CollectionOpenCitationResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.conversationId === request.conversationId &&
    result.assistantEventId === request.assistantEventId &&
    result.citationRef === request.citationRef;
}

function collectionCreateViewIdentityMatches(
  request: CollectionCreateViewRequest,
  result: CollectionCreateViewResult
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

function collectionTrashColumnIdentityMatches(
  request: CollectionTrashColumnRequest,
  result: CollectionTrashColumnResult
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
  readonly onOpenCitation?: (citationRef: string) => Promise<boolean>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const openingCitationRef = useRef<string | null>(null);
  const [openingCitationRefId, setOpeningCitationRefId] = useState<string | null>(null);
  const [citationOpenFailed, setCitationOpenFailed] = useState(false);
  const result = props.answer.datasetResult;
  if (!result) throw new Error("Dataset result metadata is unavailable.");
  const citations = props.answer.citations.filter((citation) =>
    "kind" in citation && citation.kind === "dataset"
  );
  const openCitation = async (citationRef: string, trigger: HTMLButtonElement): Promise<void> => {
    if (!props.onOpenCitation || openingCitationRef.current !== null) return;
    openingCitationRef.current = citationRef;
    setOpeningCitationRefId(citationRef);
    setCitationOpenFailed(false);
    let opened = false;
    try {
      opened = await props.onOpenCitation(citationRef);
    } catch {
      opened = false;
    } finally {
      if (openingCitationRef.current === citationRef) {
        openingCitationRef.current = null;
        setOpeningCitationRefId(null);
      }
    }
    if (!opened) {
      setCitationOpenFailed(true);
      window.requestAnimationFrame(() => trigger.focus());
    }
  };
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
          {citations.map((citation) => props.onOpenCitation ? (
            <button
              type="button"
              className="ghost"
              key={citation.refId}
              disabled={openingCitationRefId !== null}
              onClick={(event) => void openCitation(citation.refId, event.currentTarget)}
            >
              {citation.label} {citation.title}
            </button>
          ) : <span key={citation.refId}>{citation.label} {citation.title}</span>)}
        </div>
      ) : null}
      {citationOpenFailed ? <p className="muted retrieval-warning" role="status">{props.t("collection.failed")}</p> : null}
    </section>
  );
}

function formatDatasetScalar(value: string | number | boolean | null): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
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
  { id: "packages", icon: "package", status: "partial" },
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

export function AppearanceSettingsPanel(props: {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
  readonly themePreference: AppearanceThemePreference | null;
  readonly generatedKnowledgeLanguage: GeneratedKnowledgeLanguage | null;
  readonly themeBusy: boolean;
  readonly themeError: string | null;
  readonly onLocaleChange: (locale: Locale) => Promise<void>;
  readonly onThemeChange: (themePreference: AppearanceThemePreference) => Promise<boolean>;
  readonly onKnowledgeLanguageChange: (
    generatedKnowledgeLanguage: GeneratedKnowledgeLanguage
  ) => Promise<KnowledgeLanguageMutationResult["status"]>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const themeChoices = ["system", "light", "dark"] as const;
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const [knowledgeLanguageDraft, setKnowledgeLanguageDraft] =
    useState<GeneratedKnowledgeLanguage | null>(props.generatedKnowledgeLanguage);
  const [knowledgeLanguageBusy, setKnowledgeLanguageBusy] = useState(false);
  const [knowledgeLanguageNotice, setKnowledgeLanguageNotice] =
    useState<"stale" | "failed" | null>(null);
  const knowledgeLanguageActiveRef = useRef(false);
  const knowledgeLanguageRetainDraftRef = useRef(false);
  const knowledgeLanguageSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    setLanguageError(false);
  }, [props.locale]);

  useEffect(() => {
    if (!knowledgeLanguageRetainDraftRef.current) {
      setKnowledgeLanguageDraft(props.generatedKnowledgeLanguage);
    }
  }, [props.generatedKnowledgeLanguage]);

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

  const changeKnowledgeLanguage = async (
    nextLanguage: GeneratedKnowledgeLanguage
  ): Promise<void> => {
    if (
      props.generatedKnowledgeLanguage === null ||
      knowledgeLanguageActiveRef.current ||
      knowledgeLanguageBusy
    ) return;
    if (
      nextLanguage === props.generatedKnowledgeLanguage &&
      !knowledgeLanguageRetainDraftRef.current
    ) return;
    knowledgeLanguageActiveRef.current = true;
    knowledgeLanguageRetainDraftRef.current = true;
    setKnowledgeLanguageDraft(nextLanguage);
    setKnowledgeLanguageBusy(true);
    setKnowledgeLanguageNotice(null);
    try {
      const status = await props.onKnowledgeLanguageChange(nextLanguage);
      if (status === "committed") {
        knowledgeLanguageRetainDraftRef.current = false;
        setKnowledgeLanguageNotice(null);
      } else {
        setKnowledgeLanguageNotice(status);
      }
    } catch {
      setKnowledgeLanguageNotice("failed");
    } finally {
      knowledgeLanguageActiveRef.current = false;
      setKnowledgeLanguageBusy(false);
      window.setTimeout(() => knowledgeLanguageSelectRef.current?.focus(), 0);
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
            <select
              ref={knowledgeLanguageSelectRef}
              className="settings-select"
              value={knowledgeLanguageDraft ?? "preserve_source"}
              disabled={props.generatedKnowledgeLanguage === null || knowledgeLanguageBusy}
              aria-label={props.t("appearance.knowledgeLanguage")}
              aria-describedby={`appearance-knowledge-language-description${knowledgeLanguageNotice
                ? " appearance-knowledge-language-notice"
                : ""}`}
              onChange={(event) => void changeKnowledgeLanguage(
                event.target.value as GeneratedKnowledgeLanguage
              )}
            >
              <option value="preserve_source">{props.t("appearance.knowledgeLanguage.preserve")}</option>
              <option value="follow_query">{props.t("appearance.knowledgeLanguage.followQuery")}</option>
              <option value="app_locale">{props.t("appearance.knowledgeLanguage.appLocale")}</option>
            </select>
          </div>
        </div>
        {knowledgeLanguageNotice ? (
          <p
            className={knowledgeLanguageNotice === "failed"
              ? "settings-inline-status error"
              : "settings-inline-status"}
            id="appearance-knowledge-language-notice"
            role={knowledgeLanguageNotice === "failed" ? "alert" : "status"}
            aria-live="polite"
          >
            {props.t(`appearance.knowledgeLanguage.notice.${knowledgeLanguageNotice}`)}
          </p>
        ) : null}
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

function updateSummaryDescription(
  summary: UpdateSummary,
  locale: Locale,
  t: (key: string) => string
): string {
  if (summary.capability === "development") return t("system.updateCapabilityDevelopment");
  if (summary.capability === "unsupported_platform") return t("system.updateCapabilityUnsupported");
  if (summary.phase === "idle") return t("system.updateNotChecked");
  if (summary.phase === "checking") return t("system.checkingUpdates");
  if (summary.phase === "downloading") return `${t("system.updateDownloading")} · ${Math.round(summary.progressPercent)}%`;
  if (summary.phase === "ready_to_restart") return t("system.updateReadyToRestart");
  if (summary.phase === "applying") return t("system.updateApplying");
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

export function SystemSettingsPanel(props: {
  readonly surface: "updates" | "diagnostics";
  readonly locale: Locale;
  readonly diagnosticsHealth: DiagnosticsHealth | null;
  readonly supportBundlePreview: SupportBundlePreview | null;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onClearDiagnostics?: () => Promise<DiagnosticsClearLocalResult>;
  readonly onSupportBundlePreviewChange: (preview: SupportBundlePreview | null) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<"refresh" | "preview" | "export" | "cancel" | "clear" | null>(null);
  const [diagnosticsWorkflow, setDiagnosticsWorkflow] = useState<DiagnosticsWorkflowSummary | null>(null);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "success" | "error"; readonly key: string } | null>(null);
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateLoadState, setUpdateLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [updateBusy, setUpdateBusy] = useState<"check" | "download" | "apply" | null>(null);
  const clearInFlightRef = useRef(false);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);
  const clearCancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreClearFocusRef = useRef(false);
  const updateSummaryRevisionRef = useRef(-1);
  const updateEventSequenceRef = useRef(0);
  const updateOperationRef = useRef<{
    readonly kind: "check" | "download" | "apply";
    readonly requestId: string;
  } | null>(null);

  useEffect(() => {
    if (props.surface !== "updates") return;
    let active = true;
    updateSummaryRevisionRef.current = -1;
    updateEventSequenceRef.current = 0;
    updateOperationRef.current = null;
    setUpdateSummary(null);
    setUpdateLoadState("loading");
    setUpdateBusy(null);
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
      updateOperationRef.current = null;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (props.surface !== "diagnostics") return;
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const summary = await window.pige.diagnostics.workflowSummary();
        if (!active) return;
        setDiagnosticsWorkflow((current) => !current || summary.revision >= current.revision ? summary : current);
      } catch {
        if (active) setDiagnosticsWorkflow(null);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 500);
    return () => { active = false; clearInterval(interval); };
  }, [props.surface]);

  useEffect(() => {
    if (clearConfirming) {
      clearCancelRef.current?.focus();
      return;
    }
    if (!restoreClearFocusRef.current) return;
    restoreClearFocusRef.current = false;
    clearTriggerRef.current?.focus();
  }, [clearConfirming]);

  const restoreClearFocus = (): void => {
    restoreClearFocusRef.current = true;
  };

  const cancelClearDiagnostics = (): void => {
    if (clearInFlightRef.current) return;
    setClearConfirming(false);
    restoreClearFocus();
  };

  const clearDiagnostics = async (): Promise<void> => {
    if (!props.onClearDiagnostics || diagnosticsBusy || clearInFlightRef.current) return;
    clearInFlightRef.current = true;
    setDiagnosticsBusy("clear");
    setNotice(null);
    try {
      const result = await props.onClearDiagnostics();
      if (result.status !== "failed") setDiagnosticsWorkflow(result.workflow);
      if (result.status === "cleared") {
        setNotice({ kind: "success", key: "system.clearDiagnosticsCompleted" });
      } else if (result.status === "busy") {
        setNotice({ kind: "error", key: "system.clearDiagnosticsBusy" });
      } else {
        setNotice({ kind: "error", key: "system.clearDiagnosticsFailed" });
      }
    } catch {
      setNotice({ kind: "error", key: "system.clearDiagnosticsFailed" });
    } finally {
      clearInFlightRef.current = false;
      setDiagnosticsBusy(null);
      setClearConfirming(false);
      restoreClearFocus();
    }
  };

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
      const requestId = `diagpreviewreq_${crypto.randomUUID().replaceAll("-", "")}`;
      const preview = await window.pige.diagnostics.previewSupportBundle({ apiVersion: 1, requestId });
      if (preview.requestId !== requestId) throw new Error("diagnostics_preview_identity_mismatch");
      props.onSupportBundlePreviewChange(preview);
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
      diagnosticsBusy
    ) return;
    const requestId = `diagexportreq_${crypto.randomUUID().replaceAll("-", "")}`;
    setDiagnosticsBusy("export");
    setNotice(null);
    try {
      const result = await window.pige.diagnostics.exportSupportBundle({
        apiVersion: 1,
        requestId,
        previewId: props.supportBundlePreview.previewId,
        scopeContextId: props.supportBundlePreview.scopeContextId,
        expectedRevision: props.supportBundlePreview.expectedRevision
      });
      if (result.requestId !== requestId) throw new Error("diagnostics_export_identity_mismatch");
      if (result.status === "started" || result.status === "stale" || result.status === "busy" || result.status === "canceled") {
        setDiagnosticsWorkflow(result.workflow);
      }
      if (result.status === "started") {
        props.onSupportBundlePreviewChange(null);
        setNotice({ kind: "success", key: "system.exportStarted" });
      } else if (result.status === "stale") {
        setNotice({ kind: "error", key: "system.diagnosticsStale" });
      } else if (result.status === "busy") {
        setNotice({ kind: "error", key: "system.exportBusy" });
      }
    } catch {
      setNotice({ kind: "error", key: "support.exportFailed" });
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const cancelSupportBundleExport = async (): Promise<void> => {
    const workflow = diagnosticsWorkflow;
    if (!workflow?.job?.canCancel || diagnosticsBusy) return;
    const requestId = `diagcancelreq_${crypto.randomUUID().replaceAll("-", "")}`;
    setDiagnosticsBusy("cancel");
    try {
      const result = await window.pige.diagnostics.cancelSupportBundleExport({
        apiVersion: 1,
        requestId,
        jobId: workflow.job.jobId,
        scopeContextId: workflow.scopeContextId,
        expectedRevision: workflow.revision
      });
      if (result.requestId !== requestId) throw new Error("diagnostics_cancel_identity_mismatch");
      if (result.status !== "failed") setDiagnosticsWorkflow(result.workflow);
      setNotice({ kind: result.status === "accepted" || result.status === "completed" ? "success" : "error",
        key: result.status === "accepted" || result.status === "completed" ? "system.exportCanceled" : "system.diagnosticsStale" });
    } catch {
      setNotice({ kind: "error", key: "support.exportFailed" });
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const retrySupportBundleExport = async (): Promise<void> => {
    const workflow = diagnosticsWorkflow;
    if (!workflow?.job?.canRetry || diagnosticsBusy) return;
    const requestId = `diagretryreq_${crypto.randomUUID().replaceAll("-", "")}`;
    setDiagnosticsBusy("export");
    setNotice(null);
    try {
      const result = await window.pige.diagnostics.retrySupportBundleExport({
        apiVersion: 1,
        requestId,
        jobId: workflow.job.jobId,
        scopeContextId: workflow.scopeContextId,
        expectedRevision: workflow.revision
      });
      if (result.requestId !== requestId) throw new Error("diagnostics_retry_identity_mismatch");
      if (result.status !== "failed") setDiagnosticsWorkflow(result.workflow);
      const retryAccepted = result.status === "accepted" || result.status === "completed";
      setNotice({ kind: retryAccepted ? "success" : "error",
        key: retryAccepted ? "system.exportRetryStarted" : "system.diagnosticsStale" });
    } catch {
      setNotice({ kind: "error", key: "support.exportFailed" });
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const healthStatusKey = props.diagnosticsHealth?.status === "ok"
    ? "system.healthOk"
    : props.diagnosticsHealth?.status === "degraded"
      ? "system.healthDegraded"
      : "system.healthLoading";
  const checkForUpdates = async (): Promise<void> => {
    if (
      updateOperationRef.current ||
      updateSummary?.capability !== "packaged_ready" ||
      updateSummary.phase === "checking"
    ) return;
    const requestId = `updatereq_${crypto.randomUUID().replaceAll("-", "")}`;
    updateOperationRef.current = { kind: "check", requestId };
    setUpdateBusy("check");
    setNotice(null);
    try {
      const result = await window.pige.updates.check({ apiVersion: 1, requestId });
      if (updateOperationRef.current?.requestId !== requestId || result.requestId !== requestId) return;
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
      if (updateOperationRef.current?.requestId === requestId) {
        setNotice({ kind: "error", key: "system.updateCheckFailed" });
      }
    } finally {
      if (updateOperationRef.current?.requestId === requestId) {
        updateOperationRef.current = null;
        setUpdateBusy(null);
      }
    }
  };
  const downloadUpdate = async (): Promise<void> => {
    const snapshot = updateSummary;
    if (updateOperationRef.current || snapshot?.capability !== "packaged_ready" || snapshot.phase !== "available") return;
    const requestId = `updatedownloadreq_${crypto.randomUUID().replaceAll("-", "")}`;
    const version = snapshot.availableVersion;
    updateOperationRef.current = { kind: "download", requestId };
    setUpdateBusy("download");
    setNotice(null);
    try {
      const result = await window.pige.updates.download({
        apiVersion: 1,
        requestId,
        expectedRevision: snapshot.revision,
        version
      });
      if (
        updateOperationRef.current?.requestId !== requestId ||
        result.requestId !== requestId ||
        result.version !== version
      ) return;
      if (result.summary.revision >= updateSummaryRevisionRef.current) {
        updateSummaryRevisionRef.current = result.summary.revision;
        setUpdateSummary(result.summary);
        setUpdateLoadState("ready");
      }
      if (result.status === "blocked") {
        setNotice({ kind: "error", key: "system.updateDownloadBlocked" });
      } else if (result.status === "busy") {
        setNotice({ kind: "success", key: "system.updateActionBusy" });
      } else if (result.status === "stale") {
        setNotice({ kind: "error", key: "system.updateStale" });
      } else if (result.status === "unavailable" || result.status === "failed") {
        setNotice({ kind: "error", key: "system.updateDownloadFailed" });
      }
    } catch {
      if (updateOperationRef.current?.requestId === requestId) {
        setNotice({ kind: "error", key: "system.updateDownloadFailed" });
      }
    } finally {
      if (updateOperationRef.current?.requestId === requestId) {
        updateOperationRef.current = null;
        setUpdateBusy(null);
      }
    }
  };
  const applyUpdate = async (): Promise<void> => {
    const snapshot = updateSummary;
    if (updateOperationRef.current || snapshot?.capability !== "packaged_ready" || snapshot.phase !== "ready_to_restart") return;
    const requestId = `updateapplyreq_${crypto.randomUUID().replaceAll("-", "")}`;
    const version = snapshot.availableVersion;
    updateOperationRef.current = { kind: "apply", requestId };
    setUpdateBusy("apply");
    setNotice(null);
    try {
      const result = await window.pige.updates.apply({
        apiVersion: 1,
        requestId,
        expectedRevision: snapshot.revision,
        version
      });
      if (
        updateOperationRef.current?.requestId !== requestId ||
        result.requestId !== requestId ||
        result.version !== version
      ) return;
      if (result.summary.revision >= updateSummaryRevisionRef.current) {
        updateSummaryRevisionRef.current = result.summary.revision;
        setUpdateSummary(result.summary);
        setUpdateLoadState("ready");
      }
      if (result.status === "blocked") {
        setNotice({ kind: "error", key: "system.updateApplyBlocked" });
      } else if (result.status === "busy") {
        setNotice({ kind: "success", key: "system.updateActionBusy" });
      } else if (result.status === "stale") {
        setNotice({ kind: "error", key: "system.updateStale" });
      } else if (result.status === "unavailable" || result.status === "failed") {
        setNotice({ kind: "error", key: "system.updateApplyFailed" });
      }
    } catch {
      if (updateOperationRef.current?.requestId === requestId) {
        setNotice({ kind: "error", key: "system.updateApplyFailed" });
      }
    } finally {
      if (updateOperationRef.current?.requestId === requestId) {
        updateOperationRef.current = null;
        setUpdateBusy(null);
      }
    }
  };
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
        <div className="settings-card settings-update-summary" aria-live="polite" aria-busy={updateLoadState === "loading" || updateSummary?.phase === "checking" || updateSummary?.phase === "downloading" || updateSummary?.phase === "applying"}>
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
              disabled={updateLoadState !== "ready" || updateSummary?.capability !== "packaged_ready" || updateBusy !== null || updateSummary?.phase === "checking" || updateSummary?.phase === "downloading" || updateSummary?.phase === "ready_to_restart" || updateSummary?.phase === "applying"}
              onClick={() => void checkForUpdates()}
            >
              {props.t(updateBusy === "check" || updateSummary?.phase === "checking" ? "system.checkingUpdates" : "system.checkUpdates")}
            </button>
          </div>
          {updateSummary?.phase === "available" ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("system.updateAvailable")}</strong>
                <span>{updateSummary.availableVersion}</span>
              </div>
              <button className="settings-button" type="button" disabled={updateBusy !== null} onClick={() => void downloadUpdate()}>
                {props.t(updateBusy === "download" ? "system.downloadingUpdate" : "system.downloadUpdate")}
              </button>
            </div>
          ) : null}
          {updateSummary?.phase === "downloading" ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("system.updateDownloading")}</strong>
                <span>{updateSummary.availableVersion} · {Math.round(updateSummary.progressPercent)}%</span>
              </div>
              <button className="settings-button" type="button" disabled>
                {props.t("system.downloadingUpdate")}
              </button>
            </div>
          ) : null}
          {updateSummary?.phase === "ready_to_restart" || updateSummary?.phase === "applying" ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t(updateSummary.phase === "applying" ? "system.updateApplying" : "system.updateReadyToRestart")}</strong>
                <span>{updateSummary.availableVersion}</span>
              </div>
              <button
                className="settings-button"
                type="button"
                disabled={updateBusy !== null || updateSummary.phase === "applying"}
                onClick={() => void applyUpdate()}
              >
                {props.t(updateBusy === "apply" || updateSummary.phase === "applying" ? "system.restartingToUpdate" : "system.restartAndUpdate")}
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
          {props.diagnosticsHealth?.crashRecovery ? (
            <div className="settings-row tall" data-crash-recovery-status={props.diagnosticsHealth.crashRecovery.status}>
              <div className="settings-row-copy">
                <strong>{props.t("system.crashRecovery")}</strong>
                <span>{props.t(`system.crashRecovery.${props.diagnosticsHealth.crashRecovery.status}`)}</span>
                <small>
                  {props.t("system.crashRecovery.captures")} {props.diagnosticsHealth.crashRecovery.capturesPreserved}
                  {" · "}{props.t("system.crashRecovery.jobs")} {props.diagnosticsHealth.crashRecovery.jobsRecovered}
                  {" · "}{props.t("system.crashRecovery.retry")} {props.diagnosticsHealth.crashRecovery.jobsNeedRetry}
                  {" · "}{props.t("system.crashRecovery.proposals")} {props.diagnosticsHealth.crashRecovery.proposalsRecovered}
                  {" · "}{props.t("system.crashRecovery.awaitingReview")} {props.diagnosticsHealth.crashRecovery.proposalsAwaitingReview}
                  {" · "}{props.t("system.crashRecovery.sources")} {props.diagnosticsHealth.crashRecovery.sourcesNeedRepair}
                </small>
              </div>
              <span className={`settings-status ${props.diagnosticsHealth.crashRecovery.status === "needs_attention" ? "degraded" : ""}`}>
                {props.t(`system.crashRecovery.status.${props.diagnosticsHealth.crashRecovery.status}`)}
              </span>
            </div>
          ) : null}
          <CrashRecoveryHistory history={props.diagnosticsHealth?.crashRecoveryHistory} t={props.t} />
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
            <button
              ref={clearTriggerRef}
              className="settings-button"
              type="button"
              disabled={!props.onClearDiagnostics || Boolean(diagnosticsBusy) || diagnosticsWorkflow?.job?.canCancel === true}
              title={props.onClearDiagnostics ? undefined : props.t("development.state.unavailable")}
              aria-expanded={clearConfirming}
              onClick={() => {
                setNotice(null);
                setClearConfirming(true);
              }}
            >
              {props.t("system.clear")}
            </button>
          </div>
          {clearConfirming ? (
            <div className="settings-row tall" role="group" aria-labelledby="system-clear-diagnostics-confirm-title">
              <div className="settings-row-copy">
                <strong id="system-clear-diagnostics-confirm-title">{props.t("system.clearDiagnosticsConfirm")}</strong>
                <span>{props.t("system.clearDiagnosticsConfirmDescription")}</span>
              </div>
              <div className="settings-row-control">
                <button
                  ref={clearCancelRef}
                  className="settings-button"
                  type="button"
                  disabled={diagnosticsBusy === "clear"}
                  onClick={cancelClearDiagnostics}
                >
                  {props.t("system.clearDiagnosticsCancel")}
                </button>
                <button
                  className="settings-button primary"
                  type="button"
                  disabled={diagnosticsBusy === "clear"}
                  onClick={() => void clearDiagnostics()}
                >
                  {props.t(diagnosticsBusy === "clear" ? "system.clearDiagnosticsClearing" : "system.clearDiagnosticsAction")}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {diagnosticsWorkflow?.job ? (
          <DiagnosticsJobCard
            job={diagnosticsWorkflow.job}
            busy={Boolean(diagnosticsBusy)}
            onCancel={() => void cancelSupportBundleExport()}
            onRetry={() => void retrySupportBundleExport()}
            onChooseDestination={() => void previewSupportBundle()}
            t={props.t}
          />
        ) : null}

        {props.supportBundlePreview ? (
          <SupportBundlePreviewCard
            preview={props.supportBundlePreview}
            busy={Boolean(diagnosticsBusy)}
            exportBlocked={diagnosticsWorkflow?.job?.canCancel === true}
            onExport={() => void exportSupportBundle()}
            t={props.t}
          />
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

type ProviderHelpStatus = {
  readonly presetId: string;
  readonly status: "opened" | "unavailable" | "failed";
};

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
  const [providerHelpInFlight, setProviderHelpInFlight] = useState(false);
  const [providerHelpStatus, setProviderHelpStatus] = useState<ProviderHelpStatus | null>(null);
  const refreshRequestSequence = useRef(0);
  const providerMutationSequence = useRef(0);
  const providerHelpSequence = useRef(0);
  const providerHelpInFlightRef = useRef(false);
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

  const openApiKeyManagement = async (presetId: string): Promise<void> => {
    if (providerHelpInFlightRef.current) return;
    providerHelpInFlightRef.current = true;
    setProviderHelpInFlight(true);
    setProviderHelpStatus(null);
    const sequence = ++providerHelpSequence.current;
    const request = {
      apiVersion: 1 as const,
      requestId: `providerhelp_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      presetId
    };
    try {
      const result = await window.pige.models.openApiKeyManagement(request);
      if (sequence !== providerHelpSequence.current || result.apiVersion !== request.apiVersion ||
        result.requestId !== request.requestId || result.presetId !== request.presetId) return;
      setProviderHelpStatus({ presetId, status: result.status });
    } catch {
      if (sequence === providerHelpSequence.current) setProviderHelpStatus({ presetId, status: "failed" });
    } finally {
      if (sequence === providerHelpSequence.current) {
        providerHelpInFlightRef.current = false;
        setProviderHelpInFlight(false);
      }
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
      if (!summary?.revision) throw new Error("The current model settings revision is unavailable.");
      await window.pige.models.setDefaultModel({ modelProfileId, expectedRevision: summary.revision });
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
    providerHelpSequence.current += 1;
    providerHelpInFlightRef.current = false;
    setFailure(null);
    setManualBootstrap(null);
    setProviderCredentialDraft("");
    setProviderMutationStatus(null);
    setDeleteConfirmationProviderId(null);
    setProviderMutationInFlight(false);
    setProviderHelpInFlight(false);
    setProviderHelpStatus(null);
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
            {selectedPreset.canOpenApiKeyManagement ? (
              <div className="settings-row">
                <span className="settings-row-copy">
                  <strong>{props.t("models.apiKeyHelpTitle")}</strong>
                  <span>{props.t("models.apiKeyHelpDescription")}</span>
                </span>
                <button type="button" className="settings-button" disabled={props.busy || providerHelpInFlight}
                  onClick={() => void openApiKeyManagement(selectedPreset.presetId)}>
                  {props.t(providerHelpInFlight ? "models.openingApiKeyPage" : "models.getApiKey")}
                </button>
              </div>
            ) : null}
          </div>
          {providerHelpStatus?.presetId === selectedPreset.presetId ? (
            <div className={`settings-warning${providerHelpStatus.status === "opened" ? "" : " model-settings-error"}`}
              role={providerHelpStatus.status === "opened" ? "status" : "alert"}>
              {props.t(`models.apiKeyPage.${providerHelpStatus.status}`)}
            </div>
          ) : null}
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
