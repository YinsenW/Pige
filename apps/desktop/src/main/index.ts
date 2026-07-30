import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PigeDomainError } from "@pige/domain";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentConversationRequest,
  AgentConversationHistoryListRequest,
  AgentSubmitTurnRequest,
  AppHealth,
  AppearanceThemeMutationResult,
  KnowledgeLanguageMutationResult,
  CreateVaultRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  DiagnosticsClearLocalRequest,
  DiagnosticsClearLocalResult,
  ExportSupportBundleRequest,
  HighRiskConfirmationResolveRequest,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  KnowledgeActivityListRequest,
  KnowledgeActivityUndoRequest,
  LibraryListRequest,
  LibraryTagsRequest,
  LibraryRelatedRequest,
  OpenRecentVaultRequest,
  ProviderConnectResult,
  RefreshProviderModelsRequest,
  UpdateProviderCredentialRequest,
  DeleteProviderRequest,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  UpdateModelRequest,
  SetLocaleRequest,
  SetKnowledgeLanguageRequest,
  SetStartupDestinationRequest,
  SetThemeRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  SpeechAvailabilityRequest,
  SpeechAssetInstallRequest,
  SpeechCancelRequest,
  SpeechSessionRequest,
  SpeechStartRequest,
  ToolchainRepairRequest,
  SupportBundlePreview,
  UpdateApplyRequest,
  UpdateCheckRequest,
  UpdateDownloadRequest,
  UpdateStatusEvent,
  UpdateSourceStoragePolicyRequest,
  VaultMigrationApplyRequest,
  ManagedCopyRootConfigureRequest,
  PermissionPolicySummaryRequest,
  PermissionRevokeGrantRequest,
  PermissionSetDefaultModeRequest,
  WindowLayoutRequest
} from "@pige/contracts";
import {
  AgentConversationRequestSchema,
  AgentConversationResultSchema,
  AgentConversationHistoryListRequestSchema,
  AgentConversationHistoryListResultSchema,
  KnowledgeActivityListRequestSchema,
  KnowledgeActivityListResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  KnowledgeLanguageMutationResultSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationResolveResultSchema,
  AddManualProviderRequestSchema,
  AddPresetProviderRequestSchema,
  AddManualModelRequestSchema,
  RefreshProviderModelsRequestSchema,
  AgentSubmitTurnIpcPayloadSchema,
  AgentSubmitTurnRequestSchema,
  AgentSubmitTurnResultSchema,
  AgentStagedSubmitTurnResultSchema,
  UpdateProviderCredentialRequestSchema,
  DeleteProviderRequestSchema,
  OpenRecentVaultRequestSchema,
  VAULT_APPLY_MIGRATION_CHANNEL,
  UpdateModelRequestSchema,
  SetDefaultModelRequestSchema,
  SpeechAvailabilityRequestSchema,
  SpeechAssetInstallEventSchema,
  SpeechAssetInstallRequestSchema,
  SpeechCancelRequestSchema,
  SpeechSessionEventSchema,
  SpeechSessionRequestSchema,
  SpeechStartRequestSchema,
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
  UpdateDownloadRequestSchema,
  UpdateDownloadResultSchema,
  UpdateApplyRequestSchema,
  UpdateApplyResultSchema,
  UpdateStatusEventSchema,
  UpdateSummarySchema,
  SetLocaleRequestSchema,
  SetKnowledgeLanguageRequestSchema,
  SetStartupDestinationRequestSchema,
  SetThemeRequestSchema,
  StartupDestinationMutationResultSchema,
  StartupDestinationSummarySchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema,
  VaultActionResultSchema,
  VaultMigrationApplyRequestSchema,
  VaultMigrationApplyResultSchema,
  MANAGED_COPY_ROOT_CONFIGURE_CHANNEL,
  ManagedCopyRootConfigureRequestSchema,
  ManagedCopyRootConfigureResultSchema,
  DIAGNOSTICS_CLEAR_LOCAL_CHANNEL,
  DiagnosticsClearLocalRequestSchema,
  DiagnosticsClearLocalResultSchema,
  LibraryTagsRequestSchema,
  LibraryTagsResultSchema,
  PERMISSIONS_CHANGED_CHANNEL,
  PERMISSIONS_REVOKE_GRANT_CHANNEL,
  PERMISSIONS_SET_DEFAULT_MODE_CHANNEL,
  PERMISSIONS_SUMMARY_CHANNEL,
  PermissionPolicyChangedEventSchema,
  PermissionPolicySummaryRequestSchema,
  PermissionPolicySummaryResultSchema,
  PermissionRevokeGrantRequestSchema,
  PermissionRevokeGrantResultSchema,
  PermissionSetDefaultModeRequestSchema,
  PermissionSetDefaultModeResultSchema
} from "@pige/schemas";
import { PRELOAD_ENTRY_FILENAME } from "../shared/preload-entry";
import { registerReaderIpc } from "./register-reader-ipc";
import { registerBackupRestoreIpc } from "./register-backup-restore-ipc";
import { registerProposalIpc } from "./register-proposal-ipc";
import { registerSourceReconnectIpc } from "./register-source-reconnect-ipc";
import { registerTaskExecutionIpc } from "./register-task-execution-ipc";
import { registerManagedCollectionIpc } from "./register-managed-collection-ipc";
import { registerLocalSemanticRetrievalIpc } from "./register-local-semantic-retrieval-ipc";
import { registerKnowledgeHealthIpc } from "./register-knowledge-health-ipc";
import { registerMemoryIpc } from "./register-memory-ipc";
import { registerSkillsIpc } from "./register-skills-ipc";
import { registerPiPackagesIpc } from "./register-pi-packages-ipc";
import { registerLocalCapabilitiesIpc } from "./register-local-capabilities-ipc";
import { registerCurrentNoteAppendIpc } from "./register-current-note-append-ipc";
import { registerCurrentNoteReplaceIpc } from "./register-current-note-replace-ipc";
import {
  AgentIngestService,
  type AgentIngestCapabilitySnapshot,
  type AgentIngestProposalPort,
  type AgentIngestRetrievalPort
} from "./services/agent-ingest-service";
import { AgentRuntimeService } from "./services/agent-runtime-service";
import {
  createUnavailablePaddleOcrLifecycleService,
  PaddleOcrLifecycleService
} from "./services/paddle-ocr-lifecycle-service";
import {
  createPaddleOcrRuntimeComposition,
  type PaddleOcrRuntimeComposition
} from "./services/paddle-ocr-runtime-composition";
import { AgentTurnDraftPublisher } from "./services/agent-turn-draft-publisher";
import { AppearanceService } from "./services/appearance-service";
import { StartupDestinationService } from "./services/startup-destination-service";
import { BackupCoordinatorService } from "./services/backup-coordinator-service";
import { BackupRestoreService } from "./services/backup-service";
import { CoalescedBatchDrainer } from "./services/background-job-drainer";
import { CaptureService } from "./services/capture-service";
import { ManagedCopyRootService } from "./services/managed-copy-root-service";
import { configureManagedCopyLocatorResolver } from "./services/source-file-access";
import { ReaderSourceRevealService } from "./services/reader-source-reveal-service";
import { type CaptureJobExecutor } from "./services/capture-job-executor";
import { HomeAgentAttachmentService } from "./services/home-agent-attachment-service";
import { HomeAuthoredTextCaptureService } from "./services/home-authored-text-capture-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { DatasetIngestWorkerService } from "./services/dataset-ingest-worker-service";
import { DatasetQueryService } from "./services/dataset-query-service";
import { DatasetService } from "./services/dataset-service";
import { DocumentParserService } from "./services/document-parser-service";
import {
  JobsService,
  type ProcessQueuedCapturesResult
} from "./services/jobs-service";
import { JobCompactionService } from "./services/job-compaction-service";
import {
  type DocumentParseJobExecutor,
  type ProcessQueuedParsesResult
} from "./services/document-parse-job-executor";
import {
  type OcrJobExecutor,
  type ProcessQueuedOcrResult
} from "./services/ocr-job-executor";
import {
  type DatasetImportJobExecutor,
  type ProcessQueuedDatasetImportsResult
} from "./services/dataset-import-job-executor";
import {
  type IndexRebuildJobExecutor,
  type ProcessQueuedIndexRebuildResult
} from "./services/index-rebuild-job-executor";
import type { LegacyAgentIngestJobExecutor } from "./services/legacy-agent-ingest-job-executor";
import {
  createJobClassExecutorRegistry,
  type JobClassExecutorRegistry
} from "./services/job-class-executor-registry";
import { LibraryService } from "./services/library-service";
import { LibraryTagsService } from "./services/library-tags-service";
import { NoteMarkdownImportService } from "./services/note-markdown-import-service";
import { KnowledgeActivityService, type KnowledgeActivityCollectionPort, type KnowledgeActivityPageLifecyclePort } from "./services/knowledge-activity-service";
import { KnowledgeHealthService } from "./services/knowledge-health-service";
import { ManagedCollectionService } from "./services/managed-collection-service";
import { ManagedCollectionViewService } from "./services/managed-collection-view-service";
import { ManagedCollectionCitationService } from "./services/managed-collection-citation-service";
import { AgentConversationHistory } from "./services/agent-conversation-history";
import {
  HomeAgentService,
  scheduleAcceptedAgentTurn,
  type HomeAgentDraftSnapshot
} from "./services/home-agent-service";
import { HomeAgentUrlService } from "./services/home-agent-url-service";
import { CurrentNoteAppendService } from "./services/current-note-append-service";
import { CurrentNoteReplaceService } from "./services/current-note-replace-service";
import { HighRiskConfirmationService } from "./services/high-risk-confirmation-service";
import { LocalDatabaseRebuildWorkerService } from "./services/local-database-rebuild-worker-service";
import { LocalDatabaseService } from "./services/local-database-service";
import { listMarkdownTagCatalog } from "./services/markdown-page-index";
import { LocalSettingsStore } from "./services/local-settings";
import { ModelProviderRegistry } from "./services/model-provider-registry";
import { PermissionBrokerService } from "./services/permission-broker-service";
import { PermissionFullAccessService } from "./services/permission-full-access-service";
import { PermissionPolicyStore } from "./services/permission-policy-store";
import { PermissionPolicyRecordLink } from "./services/permission-policy-record-link";
import {
  applyReaderSelectionPageUpdate,
  createAgentPageUpdateOperationId
} from "./services/agent-page-update-service";
import {
  readReaderSelectionLinkPublicationIntent,
  readReaderSelectionPageUpdateOperation
} from "./services/agent-turn-publication";
import { ReaderSelectionActionService } from "./services/reader-selection-action-service";
import {
  ReaderSelectionCreateNoteActionService,
  ReaderSelectionCreateNoteProposalService
} from "./services/reader-selection-create-note-service";
import {
  applyReaderSelectionLink,
  readReaderSelectionLinkOperation
} from "./services/reader-selection-link-service";
import {
  createReaderSelectionProposalId,
  ReaderSelectionProposalService
} from "./services/reader-selection-proposal-service";
import {
  readCurrentNotePageForMutation,
  readCurrentNoteSelectionEvidenceBinding
} from "./services/retrieval-evidence-boundary";
import {
  createPermissionedExternalCapabilityRegistry,
  PermissionedExternalCapabilityRegistry,
  registerPermissionedExternalCapabilityAdapter
} from "./services/permissioned-external-capability-service";
import { createFirstPartyReadonlyNodeOsCapabilityAdapters } from "./services/readonly-node-os/first-party-readonly-node-os-capability-adapters";
import { createFirstPartyCommandCapabilityAdapter } from "./services/command-capability-adapter";
import { createPiPackageInstallCapabilityAdapter } from "./services/pi-package-capability-adapter";
import { PiPackageCatalogService } from "./services/pi-package-catalog-service";
import { PiPackageManagerService } from "./services/pi-package-manager-service";
import { PiPackageUpdateService } from "./services/pi-package-update-service";
import { PiPackageInstallTaskService } from "./services/pi-package-install-task-service";
import { NotesService } from "./services/notes-service";
import { NoteTrashService } from "./services/note-trash-service";
import { NoteArchiveService } from "./services/note-archive-service";
import { NoteMergeService } from "./services/note-merge-service";
import { NoteRelateService } from "./services/note-relate-service";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService
} from "./services/note-markdown-editor-service";
import { OcrService } from "./services/ocr-service";
import {
  LocalSettingsOcrLanguagePreferenceStore,
  OcrLanguagePreferenceService
} from "./services/ocr-language-preference-service";
import { MacOSSpeechAdapter } from "./services/macos-speech-adapter";
import { ProposalService } from "./services/proposal-service";
import { SourceOriginalReconnectService } from "./services/source-original-reconnect-service";
import { ReaderSourceReconnectService } from "./services/reader-source-reconnect-service";
import { installRendererNavigationGuard } from "./services/renderer-navigation-guard";
import { RestoreCoordinatorService } from "./services/restore-coordinator-service";
import { writeBackupCreatedOperation } from "./services/restore-job-store";
import { handleRetrievalSearchIpc } from "./services/retrieval-search-ipc";
import { RetrievalService } from "./services/retrieval-service";
import { JsonSecretStore } from "./services/secret-store";
import { LocalRagEngineService } from "./services/local-rag-engine-service";
import {
  LocalSemanticEmbeddingRuntime,
  probePackagedLocalSemanticRuntime
} from "./services/local-semantic-embedding-runtime";
import { LocalSemanticRetrievalService } from "./services/local-semantic-retrieval-service";
import {
  createPackagedSqliteVectorIndexDriver,
  probePackagedSqliteVectorRuntime
} from "./services/sqlite-vector-index-driver";
import { guardSettingAction, type SettingActionConfirmation } from "./services/setting-action-guard";
import { getSettingsRegistry } from "./services/settings-registry";
import { ToolchainService } from "./services/toolchain-service";
import { ToolchainRepairService } from "./services/toolchain-repair-service";
import { SpeechService } from "./services/speech-service";
import { TaskProcessSessionService } from "./services/task-process-session-service";
import {
  createTaskExecutionPlanConfirmation,
  createNodeTaskExecutionPlanProgressStore,
  TaskExecutionPlanService,
} from "./services/task-execution-plan-service";
import { TaskExecutionPlanRunner } from "./services/task-execution-plan-runner";
import {
  createNodeTaskExecutionRecipeFileSystem,
  TaskExecutionRecipeService,
  type TaskExecutionRecipeToolRoots
} from "./services/task-execution-recipe-service";
import { NoNetworkUpdateCheckAdapter, UpdateService } from "./services/update-service";
import { SkillRegistryService } from "./services/skill-registry-service";
import { SkillUrlInstallService } from "./services/skill-url-install-service";
import { HomeSkillStagingToolService } from "./services/home-skill-staging-tool";
import { ExternalWebSkillRuntimeService } from "./services/external-web-skill-runtime-service";
import { AgentMemoryService } from "./services/agent-memory-service";
import { VaultService } from "./services/vault-service";
import { WindowModeService } from "./services/window-mode-service";
import { getWindowShellOptions } from "./window-shell-options";

let vaultService: VaultService | undefined;
let localSettingsStore: LocalSettingsStore | undefined;
let diagnosticsService: DiagnosticsService | undefined;
let localDatabaseService: LocalDatabaseService | undefined;
let modelProviderRegistry: ModelProviderRegistry | undefined;
let highRiskConfirmationService: HighRiskConfirmationService | undefined;
let permissionPolicyStore: PermissionPolicyStore | undefined;
let permissionFullAccessService: PermissionFullAccessService | undefined;
let permissionBrokerService: PermissionBrokerService | undefined;
let permissionedExternalCapabilityRegistry: PermissionedExternalCapabilityRegistry | undefined;
let firstPartyReadonlyNodeOsCapabilitiesRegistered = false;
let firstPartyCommandCapabilityRegistered = false;
let firstPartyPiPackageCapabilityRegistered = false;
let piPackageCatalogService: PiPackageCatalogService | undefined;
let piPackageManagerService: PiPackageManagerService | undefined;
let piPackageUpdateService: PiPackageUpdateService | undefined;
let piPackageInstallTaskService: PiPackageInstallTaskService | undefined;
let windowModeService: WindowModeService | undefined;
let backupRestoreService: BackupRestoreService | undefined;
let backupCoordinatorService: BackupCoordinatorService | undefined;
let restoreCoordinatorService: RestoreCoordinatorService | undefined;
let agentRuntimeService: AgentRuntimeService | undefined;
let agentIngestService: AgentIngestService | undefined;
let homeAgentService: HomeAgentService | undefined;
let homeAgentUrlService: HomeAgentUrlService | undefined;
let currentNoteAppendService: CurrentNoteAppendService | undefined;
let currentNoteReplaceService: CurrentNoteReplaceService | undefined;
let appearanceService: AppearanceService | undefined;
let startupDestinationService: StartupDestinationService | undefined;
let appearanceServiceUnsubscribe: (() => void) | undefined;
let toolchainService: ToolchainService | undefined;
let toolchainRepairService: ToolchainRepairService | undefined;
let captureService: CaptureService | undefined;
let managedCopyRootService: ManagedCopyRootService | undefined;
let homeAgentAttachmentService: HomeAgentAttachmentService | undefined;
let jobsService: JobsService | undefined;
let jobCompactionService: JobCompactionService | undefined;
let jobClassExecutorRegistry: JobClassExecutorRegistry | undefined;
let knowledgeActivityService: KnowledgeActivityService | undefined;
let knowledgeHealthService: KnowledgeHealthService | undefined;
let managedCollectionService: ManagedCollectionService | undefined;
let managedCollectionViewService: ManagedCollectionViewService | undefined;
let managedCollectionCitationService: ManagedCollectionCitationService | undefined;
const collectionCitationConversationHistory = new AgentConversationHistory();
let libraryService: LibraryService | undefined;
let libraryTagsService: LibraryTagsService | undefined;
let notesService: NotesService | undefined;
let noteTrashService: NoteTrashService | undefined;
let noteArchiveService: NoteArchiveService | undefined;
let noteMergeService: NoteMergeService | undefined;
let noteRelateService: NoteRelateService | undefined;
let noteMarkdownImportService: NoteMarkdownImportService | undefined;
let noteMarkdownEditorActivityAdapter: NoteMarkdownEditorActivityAdapter | undefined;
let noteMarkdownEditorService: NoteMarkdownEditorService | undefined;
let readerSelectionActionService: ReaderSelectionActionService | undefined;
let readerSelectionProposalService: ReaderSelectionProposalService | undefined;
let readerSelectionCreateNoteProposalService: ReaderSelectionCreateNoteProposalService | undefined;
let readerSelectionCreateNoteActionService: ReaderSelectionCreateNoteActionService | undefined;
let proposalService: ProposalService | undefined;
let retrievalService: RetrievalService | undefined;
let localSemanticRetrievalService: LocalSemanticRetrievalService | undefined;
let localSemanticEmbeddingRuntime: LocalSemanticEmbeddingRuntime | undefined;
let localRagEngineService: LocalRagEngineService | undefined;
let documentParserService: DocumentParserService | undefined;
let datasetQueryService: DatasetQueryService | undefined;
let datasetService: DatasetService | undefined;
let ocrService: OcrService | undefined;
let ocrLanguagePreferenceService: OcrLanguagePreferenceService | undefined;
let speechService: SpeechService | undefined;
let updateService: UpdateService | undefined;
let skillRegistryService: SkillRegistryService | undefined;
let skillUrlInstallService: SkillUrlInstallService | undefined;
let externalWebSkillRuntimeService: ExternalWebSkillRuntimeService | undefined;
let agentMemoryService: AgentMemoryService | undefined;
let paddleOcrLifecycleService: PaddleOcrLifecycleService | undefined;
let paddleOcrRuntimeComposition: PaddleOcrRuntimeComposition | undefined;
let taskProcessSessionService: TaskProcessSessionService | undefined;
let taskExecutionPlanService: TaskExecutionPlanService | undefined;
let taskExecutionPlanRunner: TaskExecutionPlanRunner | undefined;
let taskExecutionRecipeService: TaskExecutionRecipeService | undefined;
let taskExecutionIpcUnsubscribe: (() => void) | undefined;
let latestSupportBundlePreview: SupportBundlePreview | undefined;
const activeSupportBundleExports = new Map<string, {
  readonly senderId: number;
  readonly controller: AbortController;
}>();
let diagnosticsClearInFlight = false;
const speechTrackedSenders = new Set<number>();
const PACKAGED_RUNTIME_SMOKE_ARGUMENT = "--pige-packaged-runtime-smoke-report=";


async function confirmSettingAction(
  sender: WebContents,
  settingKeys: readonly string[],
  confirmation: SettingActionConfirmation
): Promise<void> {
  const parentWindow = BrowserWindow.fromWebContents(sender);
  if (!parentWindow) throw new Error("No active window for setting confirmation.");
  const confirm = async (prompt: SettingActionConfirmation): Promise<boolean> => {
    const result = await dialog.showMessageBox(parentWindow, {
      type: "warning",
      buttons: ["Cancel", prompt.confirmLabel],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: prompt.title,
      message: prompt.message
    });
    return result.response === 1;
  };
  if (settingKeys.length === 0) {
    if (!await confirm(confirmation)) throw new PigeDomainError("permission.user_denied", "The user canceled the setting action.");
    return;
  }
  await guardSettingAction(settingKeys, confirmation, confirm);
}


const mainWindows = new Set<BrowserWindow>();
const ownsAppInstanceLock = app.requestSingleInstanceLock();
if (!ownsAppInstanceLock) app.quit();
app.on("second-instance", () => {
  const window = mainWindows.values().next().value;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
let captureDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let parseDrainer: CoalescedBatchDrainer<ProcessQueuedParsesResult> | undefined;
let datasetImportDrainer: CoalescedBatchDrainer<ProcessQueuedDatasetImportsResult> | undefined;
let ocrDrainer: CoalescedBatchDrainer<ProcessQueuedOcrResult> | undefined;
let agentIngestDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let agentTurnDrainer: CoalescedBatchDrainer<Awaited<ReturnType<HomeAgentService["resumeWaitingTurns"]>>> | undefined;
let indexRebuildDrainer: CoalescedBatchDrainer<ProcessQueuedIndexRebuildResult> | undefined;

type PackagedRuntimeSmokeStage =
  | "runtime_import"
  | "native_semantic_runtime"
  | "pi_runtime"
  | "home_runtime"
  | "renderer_window"
  | "renderer_load"
  | "renderer_probe"
  | "report_write";

interface PackagedRuntimeSmokeFailure {
  readonly stage: PackagedRuntimeSmokeStage;
  readonly checks?: {
    readonly titleReady: boolean;
    readonly rootReady: boolean;
    readonly preloadReady: boolean;
    readonly healthReady: boolean;
    readonly requiredRuntimeModulesReady: boolean;
    readonly missingRequiredRuntimeModuleIds: readonly string[];
  };
}

class PackagedRuntimeSmokeError extends Error {
  readonly failure: PackagedRuntimeSmokeFailure;

  constructor(failure: PackagedRuntimeSmokeFailure) {
    super(`Packaged runtime smoke failed at ${failure.stage}.`);
    this.failure = failure;
  }
}

const createMainWindow = (loadRenderer = true): BrowserWindow => {
  const browserWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 560,
    title: "Pige",
    backgroundColor: "#f8f8f5",
    ...getWindowShellOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, "../preload", PRELOAD_ENTRY_FILENAME),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  installRendererNavigationGuard(browserWindow.webContents);
  mainWindows.add(browserWindow);
  browserWindow.once("closed", () => mainWindows.delete(browserWindow));

  getWindowModeService().applyStoredState(browserWindow);
  const publishLayoutChange = (): void => {
    const state = getWindowModeService().handleNativeLayoutChanged(browserWindow);
    if (state && !browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send("window.layoutChanged", WindowLayoutStateSchema.parse(state));
    }
  };
  const publishDisplayLayoutChange = (): void => {
    const state = getWindowModeService().handleNativeLayoutChanged(browserWindow, "display");
    if (state && !browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send("window.layoutChanged", WindowLayoutStateSchema.parse(state));
    }
  };
  browserWindow.on("resize", publishLayoutChange);
  browserWindow.on("move", publishLayoutChange);
  browserWindow.on("maximize", publishLayoutChange);
  browserWindow.on("unmaximize", publishLayoutChange);
  browserWindow.on("enter-full-screen", publishLayoutChange);
  browserWindow.on("leave-full-screen", publishLayoutChange);
  screen.on("display-metrics-changed", publishDisplayLayoutChange);
  screen.on("display-removed", publishDisplayLayoutChange);
  browserWindow.once("closed", () => {
    screen.removeListener("display-metrics-changed", publishDisplayLayoutChange);
    screen.removeListener("display-removed", publishDisplayLayoutChange);
  });

  if (!loadRenderer) return browserWindow;

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return browserWindow;
  }

  void browserWindow.loadFile(join(__dirname, "../renderer/index.html"));
  return browserWindow;
};

async function runPackagedRendererSmoke(browserWindow: BrowserWindow): Promise<{
  readonly title: "Pige";
  readonly rootReady: true;
  readonly preloadReady: true;
  readonly healthReady: true;
  readonly toolchainManifest: {
    readonly requiredRuntimeModulesReady: true;
    readonly missingBundledToolIds: readonly string[];
  };
}> {
  try {
    await browserWindow.loadFile(join(__dirname, "../renderer/index.html"));
  } catch {
    throw new PackagedRuntimeSmokeError({ stage: "renderer_load" });
  }

  let value: {
    readonly title?: unknown;
    readonly rootReady?: unknown;
    readonly preloadReady?: unknown;
    readonly health?: { readonly status?: unknown };
    readonly toolchain?: {
      readonly requiredRuntimeModulesReady?: unknown;
      readonly missingBundledToolIds?: unknown;
      readonly missingRequiredRuntimeModuleIds?: unknown;
    };
  };
  try {
    value = await browserWindow.webContents.executeJavaScript(`
      (async () => {
        const toolchain = await window.pige?.system?.toolchainHealth?.();
        const requiredRuntimeModuleIds = [
          "pdf-parser", "pdf-parser-runtime", "office-docx-parser", "office-openxml-parser",
          "office-archive-runtime", "web-readability-parser", "web-dom-runtime", "web-fetch-runtime"
        ];
        const statuses = new Map((toolchain?.tools ?? []).map((tool) => [tool.id, tool.status]));
        return {
          title: document.title,
          rootReady: Boolean(document.querySelector("#root")),
          preloadReady: typeof window.pige?.getHealth === "function",
          health: await window.pige?.getHealth?.(),
          toolchain: {
            requiredRuntimeModulesReady: requiredRuntimeModuleIds.every((id) => statuses.get(id) === "ready"),
            missingRequiredRuntimeModuleIds: requiredRuntimeModuleIds.filter((id) => statuses.get(id) !== "ready"),
            missingBundledToolIds: ["git", "bun", "uv"].filter((id) => statuses.get(id) === "missing")
          }
        };
      })()
    `) as typeof value;
  } catch {
    throw new PackagedRuntimeSmokeError({ stage: "renderer_probe" });
  }
  const missingRequiredRuntimeModuleIds = Array.isArray(value.toolchain?.missingRequiredRuntimeModuleIds)
    ? value.toolchain.missingRequiredRuntimeModuleIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    value.title !== "Pige" ||
    value.rootReady !== true ||
    value.preloadReady !== true ||
    value.health?.status !== "ok" ||
    value.toolchain?.requiredRuntimeModulesReady !== true ||
    !Array.isArray(value.toolchain.missingBundledToolIds) ||
    !value.toolchain.missingBundledToolIds.every((id) => typeof id === "string")
  ) {
    throw new PackagedRuntimeSmokeError({
      stage: "renderer_probe",
      checks: {
        titleReady: value.title === "Pige",
        rootReady: value.rootReady === true,
        preloadReady: value.preloadReady === true,
        healthReady: value.health?.status === "ok",
        requiredRuntimeModulesReady: value.toolchain?.requiredRuntimeModulesReady === true,
        missingRequiredRuntimeModuleIds
      }
    });
  }
  return {
    title: "Pige",
    rootReady: true,
    preloadReady: true,
    healthReady: true,
    toolchainManifest: {
      requiredRuntimeModulesReady: true,
      missingBundledToolIds: value.toolchain.missingBundledToolIds
    }
  };
}

const getLocalSettingsStore = (): LocalSettingsStore => {
  if (!localSettingsStore) {
    localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  }
  return localSettingsStore;
};

const getPermissionPolicyStore = (): PermissionPolicyStore => {
  if (!permissionPolicyStore) {
    permissionPolicyStore = new PermissionPolicyStore(app.getPath("userData"), assertAppInstanceWriterLease);
    permissionPolicyStore.onChanged(() => {
      const activeVaultId = getVaultService().current()?.vaultId;
      if (!activeVaultId) return;
      const event = PermissionPolicyChangedEventSchema.parse(permissionPolicyStore!.summary(activeVaultId));
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(PERMISSIONS_CHANGED_CHANNEL, event);
      }
    });
  }
  return permissionPolicyStore;
};

const getHighRiskConfirmationService = (): HighRiskConfirmationService => {
  if (!highRiskConfirmationService) {
    highRiskConfirmationService = new HighRiskConfirmationService(
      getPermissionPolicyStore(),
      new PermissionPolicyRecordLink({
        activeVault: () => {
          const vault = getVaultService().current();
          const vaultPath = getVaultService().activeVaultPath();
          return vault && vaultPath ? { vaultId: vault.vaultId, vaultPath } : undefined;
        },
        assertWriterLease: (vaultPath) => getVaultService().assertWriterLease(vaultPath)
      })
    );
    highRiskConfirmationService.onChanged((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("confirmations.changed", event);
      }
    });
  }
  return highRiskConfirmationService;
};

const getPermissionFullAccessService = (): PermissionFullAccessService => {
  if (!permissionFullAccessService) {
    permissionFullAccessService = new PermissionFullAccessService({
      store: getPermissionPolicyStore(),
      confirmations: getHighRiskConfirmationService(),
      activeVaultId: () => getVaultService().current()?.vaultId
    });
    permissionFullAccessService.restore();
  }
  return permissionFullAccessService;
};

const getSkillRegistryService = (): SkillRegistryService => {
  if (!skillRegistryService) {
    skillRegistryService = new SkillRegistryService(app.getPath("userData"), {
      recoverOrphanedMutationLock: ownsAppInstanceLock
    });
  }
  return skillRegistryService;
};

const getSkillUrlInstallService = (): SkillUrlInstallService => {
  skillUrlInstallService ??= new SkillUrlInstallService({
    appDataRoot: app.getPath("userData"),
    registry: getSkillRegistryService()
  });
  return skillUrlInstallService;
};

const getExternalWebSkillRuntimeService = (): ExternalWebSkillRuntimeService => {
  externalWebSkillRuntimeService ??= new ExternalWebSkillRuntimeService({
    registry: getSkillRegistryService(),
    capabilities: {
      toolsForTurn: (adapter, turn) => new PermissionedExternalCapabilityRegistry(
        [adapter],
        getPermissionBrokerService()
      ).toolsForTurn(turn)
    }
  });
  return externalWebSkillRuntimeService;
};

const getAgentMemoryService = (): AgentMemoryService => {
  agentMemoryService ??= new AgentMemoryService();
  return agentMemoryService;
};

const getPaddleOcrLifecycleService = (): PaddleOcrLifecycleService => {
  if (!paddleOcrLifecycleService) {
    try {
      paddleOcrLifecycleService = getPaddleOcrRuntimeComposition().lifecycle;
    } catch {
      paddleOcrLifecycleService = createUnavailablePaddleOcrLifecycleService(
        resolvePaddleOcrManifestPath()
      );
    }
  }
  return paddleOcrLifecycleService;
};

const getPaddleOcrRuntimeComposition = (): PaddleOcrRuntimeComposition => {
  paddleOcrRuntimeComposition ??= createPaddleOcrRuntimeComposition({
    appDataRoot: app.getPath("userData"),
    manifestPath: resolvePaddleOcrManifestPath(),
    assertAppInstanceWriterLease
  });
  return paddleOcrRuntimeComposition;
};

const assertAppInstanceWriterLease = (): void => {
  if (!ownsAppInstanceLock) {
    throw new PigeDomainError(
      "job.writer_lease_invalid",
      "The app-instance writer lease is no longer current."
    );
  }
};

const getVaultService = (): VaultService => {
  if (!vaultService) {
    vaultService = new VaultService(
      getLocalSettingsStore(),
      () => getModelProviderRegistry().hasDefaultRuntimeBinding(),
      undefined,
      undefined,
      undefined,
      getManagedCopyRootService()
    );
  }
  return vaultService;
};

const getWindowModeService = (): WindowModeService => {
  if (!windowModeService) {
    windowModeService = new WindowModeService(
      getLocalSettingsStore(),
      (bounds) => screen.getDisplayMatching(bounds).workArea
    );
  }
  return windowModeService;
};

const getBackupRestoreService = (): BackupRestoreService => {
  if (!backupRestoreService) {
    backupRestoreService = new BackupRestoreService({ userDataPath: app.getPath("userData") });
  }
  return backupRestoreService;
};

const getBackupCoordinatorService = (): BackupCoordinatorService => {
  if (!backupCoordinatorService) {
    backupCoordinatorService = new BackupCoordinatorService({
      vault: getVaultService(),
      backupService: getBackupRestoreService(),
      appVersion: app.getVersion(),
      writeBackupCreatedOperation: (input) => writeBackupCreatedOperation({
        job: input.job,
        vaultPath: input.vaultPath,
        vaultId: input.vaultId,
        backupId: input.backupId,
        archiveDigest: input.archiveDigest,
        ...(input.warningCodes ? { warningCodes: input.warningCodes } : {}),
        assertVaultWriterLease: input.assertVaultWriterLease
      })
    });
  }
  return backupCoordinatorService;
};

const getRestoreCoordinatorService = (): RestoreCoordinatorService => {
  if (!restoreCoordinatorService) {
    restoreCoordinatorService = new RestoreCoordinatorService({
      userDataPath: app.getPath("userData"),
      appVersion: app.getVersion(),
      pathSafety: {
        appDataPath: app.getPath("appData"),
        tempPath: app.getPath("temp")
      },
      backupService: getBackupRestoreService(),
      vaultService: getVaultService(),
      pauseMutableWork: pauseMutableWorkForRestore,
      rebuildIndexes: async (vaultPath) => {
        const rebuilt = await getLocalDatabaseService().rebuildInWorker(vaultPath);
        getLocalDatabaseService().initialize(vaultPath);
        return rebuilt;
      }
    });
  }
  return restoreCoordinatorService;
};

const getAgentRuntimeService = (): AgentRuntimeService => {
  if (!agentRuntimeService) {
    agentRuntimeService = new AgentRuntimeService(
      getVaultService(),
      getModelProviderRegistry(),
      getLocalDatabaseService(),
      { snapshot: getAgentCapabilitySnapshot }
    );
  }
  return agentRuntimeService;
};

const getAppearanceService = (): AppearanceService => {
  if (!appearanceService) {
    appearanceService = new AppearanceService(getLocalSettingsStore(), app.getLocale(), nativeTheme);
    appearanceServiceUnsubscribe = appearanceService.onChanged((summary) => {
      const parsed = AppearanceSettingsSummarySchema.parse(summary);
      for (const browserWindow of mainWindows) {
        if (!browserWindow.webContents.isDestroyed()) {
          browserWindow.webContents.send("settings.appearanceChanged", parsed);
        }
      }
    });
  }
  return appearanceService;
};

const getStartupDestinationService = (): StartupDestinationService => {
  startupDestinationService ??= new StartupDestinationService(getLocalSettingsStore());
  return startupDestinationService;
};

const getUpdateService = (): UpdateService => {
  if (!updateService) {
    updateService = new UpdateService({
      settings: getLocalSettingsStore(),
      adapter: new NoNetworkUpdateCheckAdapter(),
      currentVersion: app.getVersion(),
      publish: publishUpdateStatus,
      hasBlockingWork: hasUpdateBlockingWork,
      scheduleApply: (applyUpdate) => setImmediate(applyUpdate)
    });
  }
  return updateService;
};

const hasUpdateBlockingWork = (): boolean => {
  if (getHighRiskConfirmationService().pending().status === "pending") return true;
  if (!getVaultService().current()) return false;
  try {
    return getJobsService().list({
      states: [
        "queued",
        "running",
        "waiting_dependency",
        "awaiting_review",
        "cancel_requested",
        "failed_retryable"
      ],
      limit: 1
    }).jobs.length > 0;
  } catch {
    return true;
  }
};

const publishUpdateStatus = (event: UpdateStatusEvent): void => {
  const parsed = UpdateStatusEventSchema.parse(event);
  for (const browserWindow of mainWindows) {
    if (!browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send("updates.statusChanged", parsed);
    }
  }
};

const getToolchainService = (): ToolchainService => {
  if (!toolchainService) {
    toolchainService = new ToolchainService(resolveToolchainManifestPath());
  }
  return toolchainService;
};

const getToolchainRepairService = (): ToolchainRepairService => {
  toolchainRepairService ??= new ToolchainRepairService({
    health: () => getToolchainService().health(),
    openReleases: (url) => shell.openExternal(url)
  });
  return toolchainRepairService;
};

const getSpeechService = (): SpeechService => {
  if (!speechService) {
    speechService = new SpeechService({
      native: new MacOSSpeechAdapter(),
      permission: {
        canOpenSystemSettings: () => process.platform === "darwin",
        openSystemSettings: async () => {
          if (process.platform !== "darwin") return false;
          await shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
          );
          return true;
        }
      },
      platform: process.platform,
      systemVersion: process.getSystemVersion()
    });
  }
  return speechService;
};

const getCaptureService = (): CaptureService => {
  if (!captureService) {
    captureService = new CaptureService(getVaultService(), undefined, getManagedCopyRootService());
  }
  return captureService;
};

const getManagedCopyRootService = (): ManagedCopyRootService => {
  if (!managedCopyRootService) {
    managedCopyRootService = new ManagedCopyRootService(app.getPath("userData"));
    configureManagedCopyLocatorResolver({
      resolve: (vaultId, vaultPath, managedCopy) =>
        managedCopyRootService!.resolveManagedCopy(vaultId, vaultPath, managedCopy)
    });
  }
  return managedCopyRootService;
};

const getHomeAgentAttachmentService = (): HomeAgentAttachmentService => {
  if (!homeAgentAttachmentService) {
    homeAgentAttachmentService = new HomeAgentAttachmentService(getCaptureService());
  }
  return homeAgentAttachmentService;
};

const getPermissionBrokerService = (): PermissionBrokerService => {
  if (!permissionBrokerService) {
    permissionBrokerService = new PermissionBrokerService({
      rootPath: app.getPath("userData"),
      assertWriterLease: (vaultPath) => getVaultService().assertWriterLease(vaultPath),
      confirmations: getHighRiskConfirmationService()
    });
  }
  return permissionBrokerService;
};

const getTaskProcessSessionService = (): TaskProcessSessionService => {
  taskProcessSessionService ??= new TaskProcessSessionService({
    openBrowserOAuth: async ({ url }) => {
      await shell.openExternal(url);
    }
  });
  return taskProcessSessionService;
};

const getTaskExecutionPlanService = (): TaskExecutionPlanService => {
  taskExecutionPlanService ??= new TaskExecutionPlanService({
    confirmPlan: createTaskExecutionPlanConfirmation(getHighRiskConfirmationService()),
    progressStore: createNodeTaskExecutionPlanProgressStore(join(app.getPath("userData"), "task-execution", "progress"))
  });
  return taskExecutionPlanService;
};

const getTaskExecutionRecipeService = (): TaskExecutionRecipeService => {
  taskExecutionRecipeService ??= new TaskExecutionRecipeService({
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      return {
        status: response.status,
        url: response.url || url,
        headers: response.headers,
        arrayBuffer: () => response.arrayBuffer()
      };
    },
    fileSystem: createNodeTaskExecutionRecipeFileSystem()
  });
  return taskExecutionRecipeService;
};

const getTaskExecutionPlanRunner = (): TaskExecutionPlanRunner => {
  if (!taskExecutionPlanRunner) {
    const plans = getTaskExecutionPlanService();
    taskExecutionPlanRunner = new TaskExecutionPlanRunner({
      plans,
      sessions: getTaskProcessSessionService(),
      createCapabilityRegistry: (adapters) => new PermissionedExternalCapabilityRegistry(
        adapters,
        getPermissionBrokerService()
      ),
      resolve: async (input) => {
        const recipe = await getTaskExecutionRecipeService().resolveOfficialFeishuRecipe({
          ...input,
          actorId: "pige.reviewed-task-plan",
          actorVersion: "1.0.0",
          actorDigest: taskExecutionActorDigest(),
          roots: taskExecutionRecipeRoots(),
          signal: input.signal
        });
        const plan = plans.resolvePlan(recipe.planInput);
        return {
          plan,
          readCurrentPlanBinding: () => plans.binding(plan),
          steps: recipe.processes.map((process) => ({
            ordinal: process.ordinal,
            toolName: "pige_run_reviewed_task_step",
            toolLabel: "Run reviewed task step",
            capability: "install_local_tool" as const,
            dataBoundary: "filesystem" as const,
            resourceScope: "current_action" as const,
            readOnlyProbe: process.ordinal === recipe.processes.length,
            ...(process.proveCompleted ? { proveCompleted: process.proveCompleted } : {}),
            process: {
              revision: 1,
              command: process.command,
              environment: process.environment,
              ...(process.interaction ? { interaction: process.interaction } : {})
            }
          }))
        };
      }
    });
  }
  return taskExecutionPlanRunner;
};

function taskExecutionRecipeRoots(): TaskExecutionRecipeToolRoots {
  if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
    throw new PigeDomainError("task_execution.recipe_unavailable", "The reviewed task recipe is unavailable on this platform.");
  }
  if (process.arch !== "arm64" && process.arch !== "x64" && process.arch !== "riscv64") {
    throw new PigeDomainError("task_execution.recipe_unavailable", "The reviewed task recipe is unavailable on this architecture.");
  }
  const root = join(app.getPath("userData"), "task-execution");
  const roots = {
    controlledHomeRoot: join(root, "home"),
    configRoot: join(root, "config"),
    workingDirectory: join(root, "work"),
    artifactRoot: join(root, "artifacts"),
    managedToolRoot: join(root, "tools"),
    npmPrefix: join(root, "npm-prefix"),
    npmCache: join(root, "npm-cache"),
    targetAgentRoot: join(root, "agents", "pige")
  };
  for (const directory of Object.values(roots)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const npmrcPath = join(roots.configRoot, "npmrc");
  if (!existsSync(npmrcPath)) writeFileSync(npmrcPath, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
  return {
    ...roots,
    npmrcPath,
    targetAgentRoots: { pige: roots.targetAgentRoot },
    npmExecutable: process.execPath,
    nodeExecutable: process.execPath,
    archiveExtractorExecutable: process.execPath,
    platform: process.platform,
    arch: process.arch
  };
}

function taskExecutionActorDigest(): `sha256:${string}` {
  return `sha256:${createHash("sha256").update("pige.reviewed-task-plan@1.0.0", "utf8").digest("hex")}`;
}

const getJobsService = (): JobsService => {
  if (!jobsService) {
    jobsService = new JobsService(
      getVaultService(),
      getAgentIngestService(),
      getLocalDatabaseService(),
      getDocumentParserService(),
      getOcrService(),
      getDatasetService(),
      getJobClassExecutorRegistry(),
      undefined,
      undefined,
      getLocalRagEngineService(),
      getOcrLanguagePreferenceService()
    );
  }
  return jobsService;
};

const getJobCompactionService = (): JobCompactionService => {
  jobCompactionService ??= new JobCompactionService(getVaultService());
  return jobCompactionService;
};

const getJobClassExecutorRegistry = (): JobClassExecutorRegistry => {
  jobClassExecutorRegistry ??= createJobClassExecutorRegistry({
    capture: { schedule: scheduleCaptureProcessing },
    parse: { schedule: scheduleParseProcessing },
    ocr: { schedule: scheduleOcrProcessing },
    dataset_import: { schedule: scheduleDatasetImportProcessing },
    agent_ingest: { schedule: scheduleAgentIngestProcessing },
    agent_turn: {
      schedule: () => {
        scheduleAgentIngestProcessing();
        scheduleAgentTurnProcessing();
      }
    },
    index_rebuild: { schedule: scheduleIndexRebuildProcessing },
    backup: {
      cancel: async (request) => {
        const backup = await getBackupCoordinatorService().cancel(request);
        return backup
          ? projectBackupJobAction(
              backup.id,
              backup.state === "cancel_requested"
                ? "cancel_requested"
                : backup.state === "cancelled"
                  ? "cancelled"
                  : "not_allowed"
            )
          : { status: "not_found", reason: "Job record was not found." };
      },
      retry: async (request) => {
        const backup = await getBackupCoordinatorService().retry(request);
        return backup
          ? { status: backup.status, job: getJobsService().summarize(backup.job) }
          : { status: "not_found", reason: "Job record was not found." };
      }
    }
  });
  return jobClassExecutorRegistry;
};

const getPermissionedExternalCapabilityRegistry = (): PermissionedExternalCapabilityRegistry => {
  if (!permissionedExternalCapabilityRegistry) {
    if (!firstPartyReadonlyNodeOsCapabilitiesRegistered) {
      for (const adapter of createFirstPartyReadonlyNodeOsCapabilityAdapters({
        protectedRoots: getReadonlyNodeOsProtectedRoots()
      })) {
        registerPermissionedExternalCapabilityAdapter(adapter);
      }
      firstPartyReadonlyNodeOsCapabilitiesRegistered = true;
    }
    if (!firstPartyPiPackageCapabilityRegistered) {
      registerPermissionedExternalCapabilityAdapter(
        createPiPackageInstallCapabilityAdapter(getPiPackageManagerService())
      );
      firstPartyPiPackageCapabilityRegistered = true;
    }
    if (!firstPartyCommandCapabilityRegistered) {
      registerPermissionedExternalCapabilityAdapter(createFirstPartyCommandCapabilityAdapter());
      firstPartyCommandCapabilityRegistered = true;
    }
    permissionedExternalCapabilityRegistry = createPermissionedExternalCapabilityRegistry(
      getPermissionBrokerService()
    );
  }
  return permissionedExternalCapabilityRegistry;
};

const getPiPackageManagerService = (): PiPackageManagerService => {
  if (!piPackageManagerService) {
    piPackageManagerService = new PiPackageManagerService({ appDataRoot: app.getPath("userData") });
  }
  return piPackageManagerService;
};

const getPiPackageUpdateService = (): PiPackageUpdateService => {
  piPackageUpdateService ??= new PiPackageUpdateService({ manager: getPiPackageManagerService() });
  return piPackageUpdateService;
};

const getPiPackageCatalogService = (): PiPackageCatalogService => {
  piPackageCatalogService ??= new PiPackageCatalogService(resolvePiPackageCatalogManifestPath());
  return piPackageCatalogService;
};

const getPiPackageInstallTaskService = (): PiPackageInstallTaskService => {
  piPackageInstallTaskService ??= new PiPackageInstallTaskService({
    appDataRoot: app.getPath("userData"),
    capabilities: getPermissionedExternalCapabilityRegistry(),
    packageRegistry: getPiPackageManagerService(),
    confirmations: getHighRiskConfirmationService(),
    currentContext: () => {
      const vault = getVaultService().current();
      const vaultPath = getVaultService().activeVaultPath();
      const runtime = getAgentRuntimeService().runtimeStatus();
      const policy = runtime.policySnapshot;
      if (!vault || !vaultPath || !policy || policy.vaultId !== vault.vaultId) {
        throw new Error("The Pi package install task requires a current vault policy.");
      }
      const assertCurrent = (): void => {
        const currentVault = getVaultService().current();
        const currentPath = getVaultService().activeVaultPath();
        const currentRuntime = getAgentRuntimeService().runtimeStatus();
        const currentPolicy = currentRuntime.policySnapshot;
        if (
          currentVault?.vaultId !== vault.vaultId ||
          currentPath !== vaultPath ||
          currentPolicy?.policyContextId !== policy.policyContextId ||
          currentPolicy.policyHash !== policy.policyHash
        ) {
          throw new Error("The Pi package install task binding changed.");
        }
      };
      return {
        vaultPath,
        vaultId: vault.vaultId,
        policyContextId: policy.policyContextId,
        policyHash: policy.policyHash,
        runtimeKind: runtime.runtimeKind,
        clientCapabilityTier: runtime.clientCapabilityTier,
        assertCurrent
      };
    }
  });
  return piPackageInstallTaskService;
};

function getReadonlyNodeOsProtectedRoots(): readonly string[] {
  const home = app.getPath("home");
  return [
    app.getPath("userData"),
    app.getPath("sessionData"),
    app.getPath("logs"),
    app.getPath("crashDumps"),
    join(home, ".aws"),
    join(home, ".codex"),
    join(home, ".docker"),
    join(home, ".gnupg"),
    join(home, ".kube"),
    join(home, ".netrc"),
    join(home, ".npmrc"),
    join(home, ".ssh"),
    join(home, "Library", "Keychains")
  ];
}

const getDocumentParserService = (): DocumentParserService => {
  if (!documentParserService) documentParserService = new DocumentParserService();
  return documentParserService;
};

const getDatasetService = (): DatasetService => {
  if (!datasetService) datasetService = new DatasetService(new DatasetIngestWorkerService());
  return datasetService;
};

const getDatasetQueryService = (): DatasetQueryService => {
  if (!datasetQueryService) datasetQueryService = new DatasetQueryService();
  return datasetQueryService;
};

const getOcrService = (): OcrService => {
  if (!ocrService) ocrService = new OcrService(getPaddleOcrRuntimeComposition().adapter);
  return ocrService;
};

const getAgentIngestService = (): AgentIngestService => {
  if (!agentIngestService) {
    agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
      snapshot: getAgentCapabilitySnapshot
    }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort());
  }
  return agentIngestService;
};

const createAgentIngestRetrievalPort = (): AgentIngestRetrievalPort => ({
  search: async (vaultPath, request) => {
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed before Agent-selected retrieval."
      );
    }
    const result = await getRetrievalService().searchCurrent(request);
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed during Agent-selected retrieval."
      );
    }
    return result;
  },
  listTags: (vaultPath) => {
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed before knowledge-tag catalog inspection."
      );
    }
    const tags = listMarkdownTagCatalog(vaultPath);
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed during knowledge-tag catalog inspection."
      );
    }
    return tags;
  }
});

const createAgentIngestProposalPort = (): AgentIngestProposalPort => ({
  findForJob: (vaultPath, jobId) => {
    assertAgentIngestVaultBinding(vaultPath, "before durable proposal recovery");
    const proposal = getProposalService().findForJob(jobId);
    assertAgentIngestVaultBinding(vaultPath, "during durable proposal recovery");
    return proposal;
  },
  stage: (vaultPath, request) => {
    assertAgentIngestVaultBinding(vaultPath, "before proposal staging");
    const result = getProposalService().stage(request);
    assertAgentIngestVaultBinding(vaultPath, "during proposal staging");
    return result;
  }
});

const assertAgentIngestVaultBinding = (vaultPath: string, boundary: string): void => {
  if (getVaultService().activeVaultPath() !== vaultPath) {
    throw new PigeDomainError(
      "vault.binding_changed",
      `The active vault changed ${boundary}.`
    );
  }
};

const getHomeAgentService = (): HomeAgentService => {
  if (!homeAgentService) {
    homeAgentService = new HomeAgentService(
      getVaultService(),
      getModelProviderRegistry(),
      {
        search: (request) => getRetrievalService().searchCurrent(request),
        readExactSelectedEvidence: (result) => getRetrievalService().readExactSelectedEvidence(result)
      },
      getJobsService(),
      undefined,
      { snapshot: getAgentCapabilitySnapshot },
      undefined,
      getHomeAgentUrlService(),
      getDatasetQueryService(),
      getPermissionedExternalCapabilityRegistry(),
      {
        publish: ({ vaultPath, job, selection, replacement, action }) => {
          const proposalService = getReaderSelectionProposalService();
          if (proposalService.shouldRequireReview(selection, replacement)) {
            const selected = readCurrentNoteSelectionEvidenceBinding(vaultPath, selection);
            const proposal = proposalService.stage({
              job,
              action,
              selection,
              selectedText: selected.modelText,
              replacement
            });
            return { status: "review_required" as const, proposalId: proposal.proposalId };
          }
          const result = applyReaderSelectionPageUpdate({
            vaultPath,
            job,
            target: readCurrentNotePageForMutation(vaultPath, selection.pageId),
            selection,
            replacement,
            action
          });
          return {
            status: "applied" as const,
            operationId: result.operation.id,
            pageContentHash: result.operation.after!.id
          };
        },
        readPublication: ({ vaultPath, job, selection, replacement, action }) => {
          const operationId = createAgentPageUpdateOperationId(job.id, selection.pageId);
          const operation = readReaderSelectionPageUpdateOperation({
            vaultPath,
            job,
            selection,
            replacement,
            action
          });
          if (operation?.after?.id) {
            return {
              status: "applied" as const,
              operationId,
              pageContentHash: operation.after.id
            };
          }
          if (job.operationIds?.includes(operationId)) {
            throw new PigeDomainError(
              "agent_runtime.turn_binding_invalid",
              "The durable Reader transform Operation is unavailable."
            );
          }
          const proposalId = createReaderSelectionProposalId(job.id);
          const proposal = getReaderSelectionProposalService().readPublication({
            job,
            action,
            selection,
            replacement
          });
          if (proposal) {
            return new Set(["ready", "resolving"]).has(proposal.state)
              ? { status: "review_required" as const, proposalId: proposal.proposalId }
              : { status: "resolved" as const, proposalId: proposal.proposalId };
          }
          if (job.proposalIds?.includes(proposalId)) {
            throw new PigeDomainError(
              "agent_runtime.turn_binding_invalid",
              "The durable Reader transform proposal is unavailable."
            );
          }
          return undefined;
        },
        publishLink: ({ vaultPath, job, selection, target }) => {
          const targetPage = readCurrentNotePageForMutation(vaultPath, target.pageId);
          if (
            targetPage.item.summary.pagePath !== target.pagePath ||
            targetPage.item.summary.title !== target.title ||
            targetPage.page.contentHash !== target.contentHash
          ) {
            throw new PigeDomainError("agent_runtime.link_target_changed", "The Reader link target changed.");
          }
          const result = applyReaderSelectionLink({
            vaultPath,
            job,
            selection,
            currentPage: readCurrentNotePageForMutation(vaultPath, selection.pageId),
            targetPage
          });
          getLocalDatabaseService().rebuild(vaultPath);
          return {
            status: "applied" as const,
            operationId: result.operation.id,
            pageContentHash: result.operation.after!.id,
            targetPageId: result.targetPageId
          };
        },
        readLinkPublication: ({ vaultPath, job, selection, target }) => {
          const targetPage = readCurrentNotePageForMutation(vaultPath, target.pageId);
          if (
            targetPage.item.summary.pagePath !== target.pagePath ||
            targetPage.item.summary.title !== target.title ||
            targetPage.page.contentHash !== target.contentHash
          ) return undefined;
          const result = readReaderSelectionLinkOperation({ vaultPath, job, selection, targetPage });
          return result ? {
            status: "applied" as const,
            operationId: result.operation.id,
            pageContentHash: result.operation.after!.id,
            targetPageId: result.targetPageId
          } : undefined;
        },
        publishCreateNote: ({ job, selection, selectedText, title, body, modelProfileId }) =>
          getReaderSelectionCreateNoteProposalService().stage({
            job,
            selection,
            selectedText,
            title,
            body,
            modelProfileId
          }),
        readCreateNotePublication: (input) =>
          getReaderSelectionCreateNoteProposalService().readPublication(input)
      },
      {
        toolsForTurn: (turn) => [getTaskExecutionPlanRunner().toolForExplicitHomeTurn({
          ...turn,
          readToolCatalogHash: turn.readToolCatalogHash
        })]
      },
      getAgentMemoryService(),
      {
        publish: (input) => ({ ...getCurrentNoteAppendService().publish(input), kind: "append" as const }),
        publishReplace: (input) => ({ ...getCurrentNoteReplaceService().publish(input), kind: "replace" as const }),
        readPublication: (input) => {
          const append = getCurrentNoteAppendService().readPublication(input);
          const replace = getCurrentNoteReplaceService().readPublication(input);
          if (append && replace) throw new Error("One Agent turn has conflicting current-note mutation publications.");
          return replace ? { ...replace, kind: "replace" as const } : append ? { ...append, kind: "append" as const } : undefined;
        }
      },
      new HomeSkillStagingToolService(getSkillUrlInstallService()),
      getExternalWebSkillRuntimeService(),
      undefined,
      new HomeAuthoredTextCaptureService(getCaptureService(), getJobsService())
    );
  }
  return homeAgentService;
};

const getCurrentNoteAppendService = (): CurrentNoteAppendService => {
  currentNoteAppendService ??= new CurrentNoteAppendService();
  return currentNoteAppendService;
};

const getCurrentNoteReplaceService = (): CurrentNoteReplaceService => {
  currentNoteReplaceService ??= new CurrentNoteReplaceService();
  return currentNoteReplaceService;
};

const getHomeAgentUrlService = (): HomeAgentUrlService => {
  if (!homeAgentUrlService) {
    homeAgentUrlService = new HomeAgentUrlService(getCaptureService(), getJobsService());
  }
  return homeAgentUrlService;
};

const getAgentCapabilitySnapshot = (): AgentIngestCapabilitySnapshot => {
  const vaultPath = getVaultService().activeVaultPath();
  const localDatabaseStatus = vaultPath
    ? getLocalDatabaseService().status(vaultPath).status
    : "not_initialized";
  const parser = getDocumentParserService();
  const imageOcrReady = getOcrService().canOcr("image_file");
  const appearance = getAppearanceService().summary();
  return {
    localDatabaseStatus,
    parserToolchainReady: parser.canParse("pdf_file") && parser.canParse("docx_file") && parser.canParse("pptx_file"),
    datasetToolchainReady: getDatasetService().canMaterialize("csv_file") &&
      getDatasetService().canMaterialize("xlsx_file") &&
      getDatasetService().canMaterialize("sqlite_file"),
    ocrEngines: imageOcrReady && process.platform === "darwin" ? ["apple_vision"] : [],
    ocrLanguageHints: getOcrLanguagePreferenceService().policyLanguageHints(),
    appLocale: appearance.locale,
    generatedKnowledgeLanguage: appearance.generatedKnowledgeLanguage,
    speechInputAvailable: false,
    embeddingModelInstalled: getLocalSemanticRetrievalService().embeddingModelInstalled(),
    lexicalSearchAvailable: localDatabaseStatus === "ready",
    vectorSearchAvailable: vaultPath ? getLocalRagEngineService().availableNow(vaultPath) : false,
    rerankerAvailable: false
  };
};

const getOcrLanguagePreferenceService = (): OcrLanguagePreferenceService => {
  ocrLanguagePreferenceService ??= new OcrLanguagePreferenceService(
    new LocalSettingsOcrLanguagePreferenceStore(getLocalSettingsStore())
  );
  return ocrLanguagePreferenceService;
};

const getLibraryService = (): LibraryService => {
  if (!libraryService) {
    libraryService = new LibraryService(getVaultService(), getLocalDatabaseService());
  }
  return libraryService;
};

const getLibraryTagsService = (): LibraryTagsService => {
  libraryTagsService ??= new LibraryTagsService(getVaultService());
  return libraryTagsService;
};

const getNotesService = (): NotesService => {
  if (!notesService) {
    notesService = new NotesService(
      getVaultService(),
      getLocalDatabaseService(),
      undefined,
      getNoteMarkdownEditorService()
    );
  }
  return notesService;
};

const getNoteTrashService = (): NoteTrashService => {
  noteTrashService ??= new NoteTrashService(getVaultService(), getNotesService());
  return noteTrashService;
};
const getNoteArchiveService = (): NoteArchiveService => {
  noteArchiveService ??= new NoteArchiveService(getNotesService(), getNoteMarkdownEditorService());
  return noteArchiveService;
};
const getNoteMergeService = (): NoteMergeService => {
  noteMergeService ??= new NoteMergeService(getVaultService(), getNotesService());
  return noteMergeService;
};
const getNoteRelateService = (): NoteRelateService => {
  noteRelateService ??= new NoteRelateService(
    getNotesService(),
    getNoteMarkdownEditorService(),
    () => getVaultService().activeVaultPath(),
  );
  return noteRelateService;
};
const getNoteMarkdownImportService = (): NoteMarkdownImportService => {
  noteMarkdownImportService ??= new NoteMarkdownImportService(getVaultService(), getNotesService());
  return noteMarkdownImportService;
};
const createNotePageLifecycleActivityPort = (): KnowledgeActivityPageLifecyclePort => {
  const trash = getNoteTrashService();
  const merge = getNoteMergeService();
  return {
    activitySummary: (operation, undo) => merge.activitySummary(operation, undo) ?? trash.activitySummary(operation, undo),
    findUndoOperation: (operation, operations) => merge.findUndoOperation(operation, operations) ?? trash.findUndoOperation(operation, operations),
    undo: (operation) => merge.activitySummary(operation) ? merge.undo(operation) : trash.undo(operation),
    recoverIncompleteOperations: () => {
      const mergeResult = merge.recoverIncompleteOperations();
      const trashResult = trash.recoverIncompleteOperations();
      return { recovered: mergeResult.recovered + trashResult.recovered, failed: mergeResult.failed + trashResult.failed };
    }
  };
};

const getReaderSourceRevealService = (): ReaderSourceRevealService =>
  new ReaderSourceRevealService(getNotesService(), {
    reveal: (absolutePath) => {
      shell.showItemInFolder(absolutePath);
      return "revealed";
    }
  });

const getReaderSourceReconnectService = (): ReaderSourceReconnectService =>
  new ReaderSourceReconnectService(
    getNotesService(),
    new SourceOriginalReconnectService(getVaultService())
  );

const getNoteMarkdownEditorActivityAdapter = (): NoteMarkdownEditorActivityAdapter => {
  if (!noteMarkdownEditorActivityAdapter) {
    noteMarkdownEditorActivityAdapter = new NoteMarkdownEditorActivityAdapter(getVaultService());
  }
  return noteMarkdownEditorActivityAdapter;
};

const getNoteMarkdownEditorService = (): NoteMarkdownEditorService => {
  if (!noteMarkdownEditorService) {
    noteMarkdownEditorService = new NoteMarkdownEditorService(
      getVaultService(),
      getNoteMarkdownEditorActivityAdapter()
    );
  }
  return noteMarkdownEditorService;
};

const getReaderSelectionActionService = (): ReaderSelectionActionService => {
  if (!readerSelectionActionService) {
    readerSelectionActionService = new ReaderSelectionActionService(
      getVaultService(),
      getHomeAgentService(),
      {
        readJob: (jobId) => getJobsService().readAgentTurnJob(jobId),
        readAppliedOperationId: ({ job, selection }) => {
          const operationId = createAgentPageUpdateOperationId(job.id, selection.pageId);
          return job.operationIds?.includes(operationId) ? operationId : undefined;
        },
        readAppliedLink: ({ job, selection }) => {
          const vaultPath = getVaultService().activeVaultPath();
          if (!vaultPath) return undefined;
          const intent = readReaderSelectionLinkPublicationIntent(vaultPath, job);
          if (!intent || JSON.stringify(intent.selection) !== JSON.stringify(selection)) return undefined;
          const targetPage = readCurrentNotePageForMutation(vaultPath, intent.target.pageId);
          const result = readReaderSelectionLinkOperation({ vaultPath, job, selection, targetPage });
          return result && job.operationIds?.includes(result.operation.id)
            ? { operationId: result.operation.id, targetPageId: result.targetPageId }
            : undefined;
        },
        readProposal: (proposalId) => {
          const result = getReaderSelectionProposalService().get({ apiVersion: 1, proposalId });
          return result.status === "available" ? result.proposal : undefined;
        }
      }
    );
  }
  return readerSelectionActionService;
};

const getReaderSelectionProposalService = (): ReaderSelectionProposalService => {
  if (!readerSelectionProposalService) {
    readerSelectionProposalService = new ReaderSelectionProposalService(
      getVaultService(),
      {
        readAgentTurnJob: (jobId) => getJobsService().readAgentTurnJob(jobId),
        resolveAgentTurnReview: (input) => getJobsService().resolveAgentTurnReview(input)
      },
      {
        apply: ({ vaultPath, job, selection, replacement, action }) => applyReaderSelectionPageUpdate({
          vaultPath,
          job,
          target: readCurrentNotePageForMutation(vaultPath, selection.pageId),
          selection,
          replacement,
          action
        }).operation
      },
      getReaderSelectionCreateNoteProposalService()
    );
  }
  return readerSelectionProposalService;
};

const getReaderSelectionCreateNoteProposalService = (): ReaderSelectionCreateNoteProposalService => {
  readerSelectionCreateNoteProposalService ??= new ReaderSelectionCreateNoteProposalService(
    getVaultService(),
    {
      readAgentTurnJob: (jobId) => getJobsService().readAgentTurnJob(jobId),
      resolveAgentTurnReview: (input) => getJobsService().resolveAgentTurnReview(input)
    },
    undefined,
    (vaultPath) => getLocalDatabaseService().rebuild(vaultPath)
  );
  return readerSelectionCreateNoteProposalService;
};

const getReaderSelectionCreateNoteActionService = (): ReaderSelectionCreateNoteActionService => {
  readerSelectionCreateNoteActionService ??= new ReaderSelectionCreateNoteActionService(
    getVaultService(),
    getHomeAgentService(),
    getReaderSelectionCreateNoteProposalService()
  );
  return readerSelectionCreateNoteActionService;
};

const getProposalService = (): ProposalService => {
  if (!proposalService) {
    proposalService = new ProposalService(getVaultService());
  }
  return proposalService;
};

const getKnowledgeActivityService = (): KnowledgeActivityService => {
  if (!knowledgeActivityService) {
    knowledgeActivityService = new KnowledgeActivityService(
      getVaultService(),
      createManagedCollectionActivityPort(),
      getNoteMarkdownEditorActivityAdapter(),
      getAgentMemoryService(),
      createNotePageLifecycleActivityPort()
    );
  }
  return knowledgeActivityService;
};

const getManagedCollectionService = (): ManagedCollectionService => {
  if (!managedCollectionService) {
    managedCollectionService = new ManagedCollectionService(getVaultService());
  }
  return managedCollectionService;
};

const getManagedCollectionViewService = (): ManagedCollectionViewService => {
  if (!managedCollectionViewService) {
    managedCollectionViewService = new ManagedCollectionViewService(getVaultService());
  }
  return managedCollectionViewService;
};

const getManagedCollectionCitationService = (): ManagedCollectionCitationService => {
  if (!managedCollectionCitationService) {
    managedCollectionCitationService = new ManagedCollectionCitationService(
      getVaultService(),
      collectionCitationConversationHistory
    );
  }
  return managedCollectionCitationService;
};

const createManagedCollectionActivityPort = (): KnowledgeActivityCollectionPort => {
  const collections = getManagedCollectionService();
  const views = getManagedCollectionViewService();
  const owner = (operation: Parameters<KnowledgeActivityCollectionPort["activitySummary"]>[0]) =>
    operation.kind === "create_collection_view" ? views : collections;
  return {
    activitySummary: (operation, undo) => owner(operation).activitySummary(operation, undo),
    findUndoOperation: (operation, operations) => owner(operation).findUndoOperation(operation, operations),
    undo: (operation, expectedRevisionId) => owner(operation).undo(operation, expectedRevisionId),
    recoverIncompleteOperations: () => {
      const collectionResult = collections.recoverIncompleteOperations();
      const viewResult = views.recoverIncompleteOperations();
      return {
        recovered: collectionResult.recovered + viewResult.recovered,
        failed: collectionResult.failed + viewResult.failed
      };
    }
  };
};

const getRetrievalService = (): RetrievalService => {
  if (!retrievalService) {
    retrievalService = new RetrievalService(
      getVaultService(),
      getLocalDatabaseService(),
      getLocalRagEngineService()
    );
  }
  return retrievalService;
};

const getLocalSemanticEmbeddingRuntime = (): LocalSemanticEmbeddingRuntime => {
  if (!localSemanticEmbeddingRuntime) {
    localSemanticEmbeddingRuntime = new LocalSemanticEmbeddingRuntime({
      createAssetLease: () => getLocalSemanticRetrievalService().createEmbeddingAssetLease()
    });
  }
  return localSemanticEmbeddingRuntime;
};

const getLocalRagEngineService = (): LocalRagEngineService => {
  if (!localRagEngineService) {
    localRagEngineService = new LocalRagEngineService({
      database: getLocalDatabaseService(),
      embeddings: getLocalSemanticEmbeddingRuntime(),
      createVectorPort: (vaultPath) => createPackagedSqliteVectorIndexDriver({
        rootPath: join(vaultPath, ".pige", "indexes", "vectors")
      })
    });
  }
  return localRagEngineService;
};

const getLocalSemanticRetrievalService = (): LocalSemanticRetrievalService => {
  if (!localSemanticRetrievalService) {
    localSemanticRetrievalService = new LocalSemanticRetrievalService({
      appDataRoot: app.getPath("userData"),
      onAssetRevoked: () => localSemanticEmbeddingRuntime?.dispose()
    });
    void localSemanticRetrievalService.recover();
  }
  return localSemanticRetrievalService;
};

const getDiagnosticsService = (): DiagnosticsService => {
  if (!diagnosticsService) {
    diagnosticsService = new DiagnosticsService(app.getPath("userData"));
  }
  return diagnosticsService;
};

const getLocalDatabaseService = (): LocalDatabaseService => {
  if (!localDatabaseService) {
    localDatabaseService = new LocalDatabaseService(undefined, new LocalDatabaseRebuildWorkerService());
  }
  return localDatabaseService;
};

const getKnowledgeHealthService = (): KnowledgeHealthService => {
  if (!knowledgeHealthService) {
    knowledgeHealthService = new KnowledgeHealthService(
      getLocalDatabaseService(),
      undefined,
      getNoteMarkdownEditorService()
    );
  }
  return knowledgeHealthService;
};

const getIndexRebuildJobExecutor = (): IndexRebuildJobExecutor =>
  getJobsService().indexRebuildExecutor();

const getCaptureJobExecutor = (): CaptureJobExecutor =>
  getJobsService().captureExecutor();

const getDatasetImportJobExecutor = (): DatasetImportJobExecutor =>
  getJobsService().datasetImportExecutor();

const getDocumentParseJobExecutor = (): DocumentParseJobExecutor =>
  getJobsService().documentParseExecutor();

const getOcrJobExecutor = (): OcrJobExecutor =>
  getJobsService().ocrExecutor();

const getLegacyAgentIngestJobExecutor = (): LegacyAgentIngestJobExecutor =>
  getJobsService().legacyAgentIngestExecutor();

const databaseInitializationRebuilds = new Set<string>();

const getModelProviderRegistry = (): ModelProviderRegistry => {
  if (!modelProviderRegistry) {
    modelProviderRegistry = new ModelProviderRegistry(
      app.getPath("userData"),
      new JsonSecretStore(app.getPath("userData")),
      undefined,
      undefined,
      {
        assertProviderInactive: (providerProfileId) => {
          const activeVaultPath = getVaultService().activeVaultPath();
          if (!activeVaultPath) return;
          const activeAgentJob = getJobsService().list({
            states: ["running", "cancel_requested"],
            classes: ["agent_turn", "agent_ingest"],
            limit: 1
          }).jobs[0];
          if (activeAgentJob) {
            throw new PigeDomainError(
              "model_provider.active_reference",
              "A running Agent Job still owns an active model runtime reference."
            );
          }
        }
      }
    );
  }
  return modelProviderRegistry;
};

const initializeActiveDatabase = (): void => {
  const activeVaultPath = getVaultService().activeVaultPath();
  if (activeVaultPath) {
    const status = getLocalDatabaseService().initialize(activeVaultPath);
    if (status.status !== "ready" && !databaseInitializationRebuilds.has(activeVaultPath)) {
      databaseInitializationRebuilds.add(activeVaultPath);
      void getIndexRebuildJobExecutor().request().catch(() => {
        getDiagnosticsService().recordEvent({
          level: "warning",
          code: "database.index_rebuild.initialization_failed",
          message: "The local index still requires a rebuild after initialization."
        });
      }).finally(() => {
        databaseInitializationRebuilds.delete(activeVaultPath);
      });
    }
  }
};

const scheduleCaptureProcessing = (): void => {
  captureDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getCaptureJobExecutor().process({ limit: 20 }),
    onBatch: () => {
      scheduleParseProcessing();
      scheduleOcrProcessing();
      scheduleAgentIngestProcessing();
    },
    onError: () => recordBackgroundFailure(
      "capture.background_failed",
      "Background capture processing failed."
    )
  });
  captureDrainer.schedule();
};

const scheduleParseProcessing = (): void => {
  parseDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getDocumentParseJobExecutor().process({ limit: 20 }),
    onBatch: (result) => {
      if (result.agentReadySourceIds.length > 0) scheduleAgentIngestProcessing();
      if (result.ocrWaitingSourceIds.length > 0) scheduleOcrProcessing();
    },
    onError: () => recordBackgroundFailure(
      "parser.document.background_failed",
      "Background document parsing failed."
    )
  });
  parseDrainer.schedule();
};

const scheduleDatasetImportProcessing = (): void => {
  datasetImportDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getDatasetImportJobExecutor().process({ limit: 20 }),
    onError: () => recordBackgroundFailure(
      "dataset.import.background_failed",
      "Background Dataset materialization failed."
    )
  });
  datasetImportDrainer.schedule();
};

const scheduleOcrProcessing = (): void => {
  ocrDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getOcrJobExecutor().process({ limit: 20 }),
    onBatch: (result) => {
      if (result.agentReadySourceIds.length > 0) scheduleAgentIngestProcessing();
    },
    onError: () => recordBackgroundFailure(
      "ocr.image.background_failed",
      "Background image OCR failed."
    )
  });
  ocrDrainer.schedule();
};

const scheduleAgentIngestProcessing = (): void => {
  agentIngestDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getLegacyAgentIngestJobExecutor().process({ limit: 20 }),
    onError: () => recordBackgroundFailure(
      "agent_ingest.background_failed",
      "Background Agent ingest failed."
    )
  });
  agentIngestDrainer.schedule();
};

const scheduleAgentTurnProcessing = (): void => {
  agentTurnDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getHomeAgentService().resumeWaitingTurns(20),
    onBatch: () => {
      void getJobsService().reapIngressSnapshots().catch(() => recordBackgroundFailure(
        "ingress_snapshot.reap_incomplete",
        "Completed private ingress snapshots could not be reconciled safely."
      ));
    },
    onError: () => recordBackgroundFailure(
      "agent_runtime.turn_resume_failed",
      "Waiting Agent turns could not be resumed."
    )
  });
  agentTurnDrainer.schedule();
};

const scheduleIndexRebuildProcessing = (): void => {
  indexRebuildDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getIndexRebuildJobExecutor().process({ limit: 1 }),
    onError: () => recordBackgroundFailure(
      "database.index_rebuild.background_failed",
      "Background local index rebuild failed."
    )
  });
  indexRebuildDrainer.schedule();
};

const pauseMutableWorkForRestore = async (): Promise<() => void> => {
  const resumptions: (() => void)[] = [];
  try {
    for (const drainer of [
      captureDrainer,
      parseDrainer,
      datasetImportDrainer,
      ocrDrainer,
      agentIngestDrainer,
      agentTurnDrainer,
      indexRebuildDrainer
    ]) {
      if (drainer) resumptions.push(await drainer.pause());
    }
  } catch (caught) {
    for (const resume of resumptions.reverse()) resume();
    throw caught;
  }
  return () => {
    for (const resume of resumptions.reverse()) resume();
  };
};

const scheduleActivityIndexRebuild = (): void => {
  void getIndexRebuildJobExecutor().request().catch(() => {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "activity.index_rebuild_failed",
      message: "Local search needs a rebuild after knowledge Undo."
    });
  });
};

const recordBackgroundFailure = (code: string, fallback: string): void => {
  getDiagnosticsService().recordEvent({
    level: "warning",
    code,
    message: fallback
  });
};

const resumeBackgroundJobs = (): void => {
  void getBackupCoordinatorService().recoverInterrupted().then((backupRecovery) => {
    if (backupRecovery.recovered > 0 || backupRecovery.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: backupRecovery.failed > 0 ? "warning" : "info",
        code: backupRecovery.failed > 0
          ? "backup.recovery_incomplete"
          : "backup.recovery_completed",
        message: backupRecovery.failed > 0
          ? "Some interrupted Backup Jobs still require repair."
          : "Interrupted Backup Jobs were reconciled from durable checkpoints."
      });
    }
  }).catch(() => {
    recordBackgroundFailure(
      "backup.recovery_incomplete",
      "Interrupted Backup Jobs could not be reconciled safely."
    );
  });
  try {
    const urlSourceHandoffs = getJobsService().reconcilePendingAgentTurnUrlSources();
    if (urlSourceHandoffs.linked > 0 || urlSourceHandoffs.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: urlSourceHandoffs.failed > 0 ? "warning" : "info",
        code: urlSourceHandoffs.failed > 0
          ? "agent_runtime.url_source_handoff_conflict"
          : "agent_runtime.url_source_handoff_recovered",
        message: urlSourceHandoffs.failed > 0
          ? "An Agent-selected URL source handoff could not be reconciled safely."
          : "Agent-selected URL source handoffs were reconciled after startup."
      });
    }
    const sourceHandoffs = getJobsService().reconcilePendingAgentTurnSources();
    if (sourceHandoffs.linked > 0 || sourceHandoffs.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: sourceHandoffs.failed > 0 ? "warning" : "info",
        code: sourceHandoffs.failed > 0
          ? "agent_runtime.source_handoff_conflict"
          : "agent_runtime.source_handoff_recovered",
        message: sourceHandoffs.failed > 0
          ? "A preserved Agent source handoff could not be reconciled safely."
          : "Preserved Agent source handoffs were reconciled after startup."
      });
    }
    const recovery = getJobsService().recoverInterruptedJobs();
    if (recovery.requeued > 0 || recovery.failedRetryable > 0) {
      getDiagnosticsService().recordEvent({
        level: "info",
        code: "jobs.interrupted_reconciled",
        message: `Recovered ${recovery.requeued} idempotent job(s); ${recovery.failedRetryable} job(s) require explicit retry.`
      });
    }
    const compaction = getJobCompactionService().compactEligible();
    if (compaction.compacted > 0 || compaction.failed > 0) {
      getDiagnosticsService().recordEvent({
        level: compaction.failed > 0 ? "warning" : "info",
        code: compaction.failed > 0 ? "jobs.compaction_incomplete" : "jobs.compaction_completed",
        message: compaction.failed > 0
          ? "Some retained successful Job details could not be compacted safely."
          : `Compacted ${compaction.compacted} retained successful Job record(s).`
      });
    }
    getJobsService().requeueWaitingParses();
    getJobsService().requeueWaitingOcr();
    getJobsService().requeueWaitingAgentIngest();
    try {
      const noteImportRecovery = getNoteMarkdownImportService().recoverIncompleteImports();
      if (noteImportRecovery.recovered > 0) scheduleActivityIndexRebuild();
      if (noteImportRecovery.failed > 0) {
        recordBackgroundFailure(
          "note.import_recovery_incomplete",
          "Some interrupted Markdown note imports still require repair."
        );
      }
    } catch {
      recordBackgroundFailure(
        "note.import_recovery_failed",
        "Interrupted Markdown note imports could not be inspected safely."
      );
    }
    try {
      const activityRecovery = getKnowledgeActivityService().recoverIncompleteUndos();
      if (activityRecovery.recovered > 0) scheduleActivityIndexRebuild();
      if (activityRecovery.recovered > 0 || activityRecovery.failed > 0) {
        getDiagnosticsService().recordEvent({
          level: activityRecovery.failed > 0 ? "warning" : "info",
          code: activityRecovery.failed > 0 ? "activity.recovery_incomplete" : "activity.recovery_completed",
          message: activityRecovery.failed > 0
            ? "Some interrupted knowledge Undo work still requires repair."
            : "Interrupted knowledge Undo work was reconciled after startup."
        });
      }
    } catch {
      getDiagnosticsService().recordEvent({
        level: "warning",
        code: "activity.recovery_failed",
        message: "Knowledge Undo recovery could not inspect its durable records."
      });
    }
    void getJobsService().recoverProposalDecisions(getProposalService()).then((result) => {
      if (result.applied > 0 || result.rejected > 0 || result.conflicted > 0 || result.failed > 0) {
        getDiagnosticsService().recordEvent({
          level: result.failed > 0 ? "warning" : "info",
          code: result.failed > 0 ? "proposal.recovery_incomplete" : "proposal.recovery_completed",
          message: result.failed > 0
            ? "Some durable proposal decisions still require recovery."
            : "Durable proposal decisions were reconciled after startup."
        });
      }
    }).catch(() => {
      getDiagnosticsService().recordEvent({
        level: "warning",
        code: "proposal.recovery_failed",
        message: "Durable proposal decision recovery failed."
      });
    });
    getJobClassExecutorRegistry().scheduleAll();
    void getJobsService().reapIngressSnapshots().catch(() => recordBackgroundFailure(
      "ingress_snapshot.reap_incomplete",
      "Private ingress snapshot startup reconciliation could not complete safely."
    ));
  } catch {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "jobs.resume_failed",
      message: "Durable background job recovery failed."
    });
  }
};

const scheduleWaitingAgentIngestAfterModelReady = (): void => {
  try {
    const result = getJobsService().requeueWaitingAgentIngest();
    if (result.requeued > 0) {
      scheduleAgentIngestProcessing();
    }
    scheduleAgentTurnProcessing();
  } catch {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "agent_ingest.requeue_failed",
      message: "Waiting Agent ingest requeue failed."
    });
  }
};

const isNeedsManualModelResult = (result: ProviderConnectResult): boolean =>
  "status" in result && result.status === "needs_manual_model";

ipcMain.handle("pige:getHealth", (): AppHealth => ({
  status: "ok",
  appVersion: app.getVersion(),
  checkedAt: new Date().toISOString()
}));

ipcMain.handle("window.current", (event) => getWindowModeService().current(requireWindow(event.sender)));
ipcMain.handle("window.currentLayout", (event) =>
  WindowLayoutStateSchema.parse(getWindowModeService().currentLayout(requireWindow(event.sender)))
);
ipcMain.handle("window.setLayout", (event, request: WindowLayoutRequest) => {
  const browserWindow = requireWindow(event.sender);
  const state = WindowLayoutStateSchema.parse(
    getWindowModeService().setLayout(browserWindow, WindowLayoutRequestSchema.parse(request))
  );
  if (!event.sender.isDestroyed()) event.sender.send("window.layoutChanged", state);
  return state;
});
ipcMain.handle("window.setMode", (event, request: SetWindowModeRequest) =>
  getWindowModeService().setMode(requireWindow(event.sender), request)
);
ipcMain.handle("window.setAlwaysOnTop", (event, request: SetAlwaysOnTopRequest) =>
  getWindowModeService().setAlwaysOnTop(requireWindow(event.sender), request)
);
ipcMain.handle("window.setSidebarOpen", (event, request: SetSidebarOpenRequest) =>
  getWindowModeService().setSidebarOpen(requireWindow(event.sender), request)
);
ipcMain.handle("speech.availability", (_event, request: SpeechAvailabilityRequest) =>
  getSpeechService().availability(SpeechAvailabilityRequestSchema.parse(request))
);
ipcMain.handle("speech.installLanguageAsset", async (event, request: SpeechAssetInstallRequest) => {
  const sender = event.sender;
  if (!speechTrackedSenders.has(sender.id)) {
    speechTrackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      speechTrackedSenders.delete(sender.id);
      void getSpeechService().cancelOwner(sender.id);
    });
  }
  const parsed = SpeechAssetInstallRequestSchema.parse(request);
  const result = await getSpeechService().installLanguageAsset(sender.id, parsed, (installEvent) => {
    if (!sender.isDestroyed()) {
      sender.send("speech.assetInstallEvent", SpeechAssetInstallEventSchema.parse(installEvent));
    }
  });
  if (sender.isDestroyed()) await getSpeechService().cancelOwner(sender.id);
  return result;
});
ipcMain.handle("speech.start", async (event, request: SpeechStartRequest) => {
  const sender = event.sender;
  if (!speechTrackedSenders.has(sender.id)) {
    speechTrackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      speechTrackedSenders.delete(sender.id);
      void getSpeechService().cancelOwner(sender.id);
    });
  }
  const parsed = SpeechStartRequestSchema.parse(request);
  const result = await getSpeechService().start(sender.id, parsed, (sessionEvent) => {
    if (!sender.isDestroyed()) {
      sender.send("speech.sessionEvent", SpeechSessionEventSchema.parse(sessionEvent));
    }
  });
  if (result.status === "started" && sender.isDestroyed()) {
    await getSpeechService().cancelOwner(sender.id);
  }
  return result;
});
ipcMain.handle("speech.stop", (event, request: SpeechSessionRequest) =>
  getSpeechService().stop(event.sender.id, SpeechSessionRequestSchema.parse(request))
);
ipcMain.handle("speech.cancel", (event, request: SpeechCancelRequest) =>
  getSpeechService().cancel(event.sender.id, SpeechCancelRequestSchema.parse(request))
);
ipcMain.handle("speech.openSystemSettings", () => getSpeechService().openSystemSettings());
ipcMain.handle("agent.runtimeStatus", () => getAgentRuntimeService().runtimeStatus());
ipcMain.handle("agent.conversation", (_event, request?: AgentConversationRequest) => {
  const parsedRequest = AgentConversationRequestSchema.parse(request ?? {});
  return AgentConversationResultSchema.optional().parse(
    getHomeAgentService().conversation(parsedRequest as AgentConversationRequest)
  );
});
ipcMain.handle("agent.conversationHistory", (_event, request: AgentConversationHistoryListRequest) => {
  const parsedRequest = AgentConversationHistoryListRequestSchema.parse(request);
  return AgentConversationHistoryListResultSchema.parse(
    getHomeAgentService().conversationHistory(parsedRequest)
  );
});
ipcMain.handle("agent.submitTurn", async (event, payload: unknown) => {
  const parsedPayload = AgentSubmitTurnIpcPayloadSchema.parse(payload);
  const attachments = parsedPayload.attachments;
  const request = AgentSubmitTurnRequestSchema.parse(parsedPayload.request);
  const normalizedRequest: AgentSubmitTurnRequest = {
    schemaVersion: 1,
    inputKind: request.inputKind,
    locale: request.locale,
    ...(request.stagedItems === undefined ? {} : { stagedItems: request.stagedItems }),
    ...(request.text === undefined ? {} : { text: request.text }),
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
    ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
    ...(request.expectedTailEventId === undefined ? {} : { expectedTailEventId: request.expectedTailEventId })
  };
  const draftPublisher = new AgentTurnDraftPublisher({
    clientTurnId: normalizedRequest.clientTurnId,
    send: (draft) => {
      if (!event.sender.isDestroyed()) event.sender.send("agent.turnDraft", draft);
    }
  });
  const draftContext = { onDraft: (draft: HomeAgentDraftSnapshot) => draftPublisher.publish(draft) };
  let backgroundOwnsDraftPublisher = false;
  try {
    if (attachments.length === 0 && (normalizedRequest.stagedItems?.length ?? 0) === 0) {
      return AgentSubmitTurnResultSchema.parse(
        await getHomeAgentService().submitTurn(normalizedRequest, draftContext)
      );
    }
    if (request.inputKind !== "file_drop" && request.inputKind !== "file_picker") {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "An attached source requires a file-drop or file-picker Agent input kind."
      );
    }
    const attachmentService = getHomeAgentAttachmentService();
    const preparedAttachments = await attachmentService.prepare(attachments, normalizedRequest.stagedItems);
    if (preparedAttachments.entries.length === 0) {
      const failed = {
        requestId: normalizedRequest.clientTurnId ?? `turn_${randomUUID().replaceAll("-", "")}`,
        state: "failed",
        modelUsage: "none",
        sourceIds: [],
        rejectedFiles: preparedAttachments.rejectedFiles,
        rejectedItems: preparedAttachments.rejectedItems,
        error: {
          code: "capture.file_rejected",
          domain: "capture",
          messageKey: "errors.agent_runtime.source_turn_failed",
          retryable: true,
          severity: "warning",
          userAction: "retry"
        }
      };
      return normalizedRequest.stagedItems === undefined
        ? AgentSubmitTurnResultSchema.parse(failed)
        : AgentStagedSubmitTurnResultSchema.parse(failed);
    }
    const home = getHomeAgentService();
    const prepared = home.prepareSourceTurn(normalizedRequest, {
      count: preparedAttachments.entries.length,
      attachmentSetHash: preparedAttachments.attachmentSetHash,
      inputChecksums: preparedAttachments.entries.map((entry) => entry.inputChecksum)
    });
    try {
      const preserved = await attachmentService.preserve({
        prepared: preparedAttachments,
        turn: normalizedRequest,
        jobId: prepared.jobId,
        firstSourceId: prepared.sourceIds[0]!
      });
      if (
        preserved.status !== "preserved" ||
        preserved.sourceIds.length !== prepared.sourceIds.length ||
        preserved.sourceIds.some((sourceId, index) => sourceId !== prepared.sourceIds[index])
      ) {
        home.failPreparedSourceTurn(prepared);
        const failed = {
          requestId: normalizedRequest.clientTurnId ?? `turn_${randomUUID().replaceAll("-", "")}`,
          jobId: prepared.jobId,
          conversationEventId: prepared.preservedTurn.event.id,
          conversationId: prepared.preservedTurn.event.conversationId,
          tailEventId: prepared.preservedTurn.event.id,
          state: "failed",
          modelUsage: "none",
          sourceIds: preserved.sourceIds,
          rejectedFiles: [
            ...preparedAttachments.rejectedFiles,
            ...preserved.rejectedFiles
          ],
          rejectedItems: [
            ...preparedAttachments.rejectedItems,
            ...(preserved.rejectedItems ?? [])
          ],
          error: {
            code: "capture.file_rejected",
            domain: "capture",
            messageKey: "errors.agent_runtime.source_turn_failed",
            retryable: true,
            severity: "warning",
            userAction: "retry"
          }
        };
        return normalizedRequest.stagedItems === undefined
          ? AgentSubmitTurnResultSchema.parse(failed)
          : AgentStagedSubmitTurnResultSchema.parse(failed);
      }
      if (normalizedRequest.stagedItems === undefined) {
        const result = await home.submitPreparedSourceTurn(prepared, draftContext);
        return AgentSubmitTurnResultSchema.parse({
          ...result,
          ...(preparedAttachments.rejectedFiles.length > 0
            ? { rejectedFiles: preparedAttachments.rejectedFiles }
            : {})
        });
      }
      const receipt = home.acceptPreparedSourceTurn(prepared);
      backgroundOwnsDraftPublisher = true;
      scheduleAcceptedAgentTurn(() =>
        home.runAcceptedPreparedSourceTurn(prepared, draftContext).finally(() => draftPublisher.close())
      );
      return AgentStagedSubmitTurnResultSchema.parse({
        ...receipt,
        acceptedItems: preparedAttachments.entries.map((entry, index) => ({
          ordinal: entry.ordinal,
          kind: entry.kind,
          sourceId: prepared.sourceIds[index]!
        })),
        ...(preparedAttachments.rejectedFiles.length > 0
          ? {
              rejectedFiles: preparedAttachments.rejectedFiles,
              rejectedItems: preparedAttachments.rejectedItems
            }
          : {})
      });
    } catch (caught) {
      home.failPreparedSourceTurn(prepared);
      throw caught;
    }
  } finally {
    if (!backgroundOwnsDraftPublisher) draftPublisher.close();
  }
});
ipcMain.handle("jobs.list", (_event, request?: JobsListRequest) => getJobsService().list(request));
ipcMain.handle("jobs.cancel", async (_event, request: JobActionRequest): Promise<JobActionResult> => {
  getTaskProcessSessionService().cancelJob(request.jobId);
  const jobs = getJobsService();
  const jobClass = jobs.readJobClass(request.jobId);
  const executor = jobClass ? getJobClassExecutorRegistry().require(jobClass) : undefined;
  return executor?.cancel ? await executor.cancel(request) : jobs.cancel(request);
});
ipcMain.handle("jobs.retry", async (_event, request: JobActionRequest) => {
  const jobs = getJobsService();
  const jobClass = jobs.readJobClass(request.jobId);
  const executor = jobClass ? getJobClassExecutorRegistry().require(jobClass) : undefined;
  const result = executor?.retry ? await executor.retry(request) : jobs.retry(request);
  if (result.status === "requeued" && result.job) {
    getJobClassExecutorRegistry().require(result.job.class).schedule?.(result.job.id);
  }
  return result;
});
registerSourceReconnectIpc({
  ipcMain,
  getWindow: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
  showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
  getJobs: getJobsService,
  getReconnectService: () => new SourceOriginalReconnectService(getVaultService()),
  resumeBackgroundJobs
});
ipcMain.handle("confirmations.pending", () => {
  getPermissionFullAccessService();
  return HighRiskConfirmationPendingResultSchema.parse(getHighRiskConfirmationService().pending());
});
ipcMain.handle("confirmations.resolve", async (_event, request: HighRiskConfirmationResolveRequest) => {
  const parsed = HighRiskConfirmationResolveRequestSchema.parse(request);
  getPermissionFullAccessService();
  return HighRiskConfirmationResolveResultSchema.parse(
    await getHighRiskConfirmationService().resolve(parsed)
  );
});
ipcMain.handle(PERMISSIONS_SUMMARY_CHANNEL, (_event, request: PermissionPolicySummaryRequest) => {
  const parsed = PermissionPolicySummaryRequestSchema.parse(request);
  try {
    if (getVaultService().current()?.vaultId !== parsed.activeVaultId) throw new Error("stale vault");
    return PermissionPolicySummaryResultSchema.parse({
      ...parsed,
      status: "ready",
      summary: getPermissionPolicyStore().summary(parsed.activeVaultId)
    });
  } catch {
    return PermissionPolicySummaryResultSchema.parse({ ...parsed, status: "failed" });
  }
});
ipcMain.handle(PERMISSIONS_SET_DEFAULT_MODE_CHANNEL, (_event, request: PermissionSetDefaultModeRequest) => {
  const parsed = PermissionSetDefaultModeRequestSchema.parse(request);
  try {
    if (getVaultService().current()?.vaultId !== parsed.activeVaultId) throw new Error("stale vault");
    const outcome = parsed.mode === "yolo_full_access"
      ? getPermissionFullAccessService().request(parsed)
      : { status: getPermissionPolicyStore().setDefaultMode(parsed.expectedRevision, parsed.mode) } as const;
    return PermissionSetDefaultModeResultSchema.parse({
      ...parsed,
      ...outcome,
      summary: getPermissionPolicyStore().summary(parsed.activeVaultId)
    });
  } catch {
    return PermissionSetDefaultModeResultSchema.parse({ ...parsed, status: "failed" });
  }
});
ipcMain.handle(PERMISSIONS_REVOKE_GRANT_CHANNEL, (_event, request: PermissionRevokeGrantRequest) => {
  const parsed = PermissionRevokeGrantRequestSchema.parse(request);
  try {
    if (getVaultService().current()?.vaultId !== parsed.activeVaultId) throw new Error("stale vault");
    const status = getPermissionPolicyStore().revokeGrant(parsed.expectedRevision, parsed.grantId);
    return PermissionRevokeGrantResultSchema.parse({
      ...parsed,
      status,
      summary: getPermissionPolicyStore().summary(parsed.activeVaultId)
    });
  } catch {
    return PermissionRevokeGrantResultSchema.parse({ ...parsed, status: "failed" });
  }
});
taskExecutionIpcUnsubscribe = registerTaskExecutionIpc({
  ipcMain,
  readInteraction: () => getTaskProcessSessionService().interaction(),
  openInteraction: (request) => getTaskProcessSessionService().openInteraction(request),
  subscribeInteractionChanged: (listener) => getTaskProcessSessionService().onInteractionChanged(listener)
});
registerManagedCollectionIpc({
  ipcMain,
  isTrustedSender: (sender) => {
    const window = BrowserWindow.fromWebContents(sender);
    return !!window && mainWindows.has(window);
  },
  getActiveVaultId: () => getVaultService().current()?.vaultId,
  listCollections: (request) => getManagedCollectionViewService().list(request),
  openCollection: (request) => getManagedCollectionViewService().open(request),
  openCollectionCitation: (request) => getManagedCollectionCitationService().open(request),
  editCollectionCell: (request) => getManagedCollectionService().editCell(request),
  appendDefaultCollectionRow: (request) => getManagedCollectionService().appendDefaultRow(request),
  addNullableCollectionColumn: (request) => getManagedCollectionService().addNullableColumn(request),
  addFormulaCollectionColumn: (request) => getManagedCollectionService().addFormulaColumn(request),
  updateFormulaCollectionColumn: (request) => getManagedCollectionService().updateFormulaColumn(request),
  addRelationCollectionColumn: (request) => getManagedCollectionService().addRelationColumn(request),
  editRelationCollectionCell: (request) => getManagedCollectionService().editRelationCell(request),
  renameCollectionColumn: (request) => getManagedCollectionService().renameColumn(request),
  createCollectionView: (request) => getManagedCollectionViewService().createView(request),
  trashCollectionColumn: (request) => getManagedCollectionService().trashColumn(request),
  trashCollectionRow: (request) => getManagedCollectionService().trashRow(request)
});
registerKnowledgeHealthIpc({
  ipcMain,
  getActiveVaultBinding: () => {
    const vault = getVaultService().current();
    const vaultPath = getVaultService().activeVaultPath();
    return vault && vaultPath ? { vaultId: vault.vaultId, vaultPath } : undefined;
  },
  runKnowledgeHealth: (vaultPath, request) => getKnowledgeHealthService().run(vaultPath, request),
  repairKnowledgeHealth: (vaultPath, request) => getKnowledgeHealthService().repair(vaultPath, request)
});
registerLocalSemanticRetrievalIpc({
  ipcMain,
  status: (request) => getLocalSemanticRetrievalService().status(request),
  install: (request) => getLocalSemanticRetrievalService().install(request),
  enable: (request) => getLocalSemanticRetrievalService().enable(request),
  disable: (request) => getLocalSemanticRetrievalService().disable(request),
  remove: (request) => getLocalSemanticRetrievalService().remove(request)
});
registerSkillsIpc({
  ipcMain,
  getActiveVaultId: () => getVaultService().current()?.vaultId,
  getWindow: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
  showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
  showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
  summary: () => getSkillRegistryService().summary(),
  pendingStagedReviews: (request) => getSkillUrlInstallService().pendingStagedReviews(request),
  stageFromUrl: (request) => getSkillUrlInstallService().stageFromUrl(request),
  stageFromMarkdown: (request, sourcePath) => getSkillUrlInstallService().stageFromMarkdown(request, sourcePath),
  stageFromZip: (request, sourcePath) => getSkillUrlInstallService().stageFromZip(request, sourcePath),
  stageUpdate: (request) => getSkillUrlInstallService().stageUpdate(request),
  installStaged: (request) => getSkillUrlInstallService().installStaged(request),
  discardStaged: (request) => getSkillUrlInstallService().discardStaged(request),
  disable: (request) => getSkillRegistryService().disable(request),
  enable: (request) => getSkillRegistryService().enable(request),
  uninstall: (request) => getSkillRegistryService().uninstall(request),
  restore: (request) => getSkillRegistryService().restore(request),
  exportSkill: (request, destinationPath) => getSkillRegistryService().export(request, destinationPath),
  publishRegistryChanged: (result) => {
    if (!("registry" in result)) return;
    for (const window of mainWindows) {
      if (!window.isDestroyed()) window.webContents.send("skills.changed", result.registry);
    }
  }
});
const piPackageUpdates = getPiPackageUpdateService();
registerPiPackagesIpc({
  ipcMain,
  isTrustedSender: (sender) => {
    const window = BrowserWindow.fromWebContents(sender);
    return !!window && mainWindows.has(window);
  },
  getActiveVaultId: () => getVaultService().current()?.vaultId,
  summary: async () => ({ status: "ready", registry: await piPackageUpdates.summary() }),
  catalogQuery: (request) => getPiPackageCatalogService().query(request),
  install: (request) => getPiPackageInstallTaskService().install(request),
  confirmUninstall: async (sender, request) => {
    try {
      await confirmSettingAction(sender, [], {
        title: "Remove this Pi package?",
        message: `Pige will remove the disabled package ${request.packageId} from this device and retain its private recovery trash.`,
        confirmLabel: "Remove package"
      });
      return true;
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "permission.user_denied") return false;
      throw caught;
    }
  },
  uninstall: (request) => getPiPackageManagerService().uninstall(request),
  confirmUpdate: async (sender, binding) => {
    try {
      await confirmSettingAction(sender, [], {
        title: "Update this Pi package?",
        message: `Pige will update ${binding.packageName} from ${binding.currentVersion} to ${binding.request.targetVersion} at Package Registry revision ${binding.request.expectedRegistryRevision}. The installed package remains disabled.`,
        confirmLabel: "Update package"
      });
      return true;
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "permission.user_denied") return false;
      throw caught;
    }
  },
  update: (request) => piPackageUpdates.update(request),
  confirmRollback: async (sender, binding) => {
    try {
      await confirmSettingAction(sender, [], {
        title: "Roll back this Pi package?",
        message: `Pige will roll back ${binding.packageName} from ${binding.currentVersion} to ${binding.request.targetVersion} at Package Registry revision ${binding.request.expectedRegistryRevision}. The package remains disabled.`,
        confirmLabel: "Roll back package"
      });
      return true;
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "permission.user_denied") return false;
      throw caught;
    }
  },
  rollback: (request) => piPackageUpdates.rollback(request),
  setPinned: (request) => piPackageUpdates.setPinned(request)
});
registerMemoryIpc({
  ipcMain,
  getWindow: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
  showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
  getActiveVaultBinding: () => {
    const vault = getVaultService().current();
    const vaultPath = getVaultService().activeVaultPath();
    return vault && vaultPath ? { vaultId: vault.vaultId, vaultPath } : undefined;
  },
  listMemory: (binding) => getAgentMemoryService().list(binding.vaultPath, binding.vaultId),
  disableMemory: (binding, request) => getAgentMemoryService().disable(binding.vaultPath, request),
  editMemory: (binding, request) => getAgentMemoryService().edit(binding.vaultPath, request),
  enableMemory: (binding, request) => getAgentMemoryService().enable(binding.vaultPath, request),
  deleteMemory: (binding, request) => getAgentMemoryService().delete(binding.vaultPath, request),
  exportMemory: (binding, request, destinationPath) =>
    getAgentMemoryService().export(binding.vaultPath, request, destinationPath),
  resetMemory: (binding, request) => getAgentMemoryService().reset(binding.vaultPath, request),
  publishMemoryChanged: (summary) => {
    for (const window of mainWindows) {
      if (!window.isDestroyed()) window.webContents.send("memory.changed", summary);
    }
  }
});
registerLocalCapabilitiesIpc({
  ipcMain,
  ocrLanguagePreference: (request) => getOcrLanguagePreferenceService().read(request),
  setOcrLanguagePreference: (request) => getOcrLanguagePreferenceService().set(request),
  paddleOcrSummary: (request) => getPaddleOcrLifecycleService().summary(request),
  installPaddleOcr: (request) => getPaddleOcrLifecycleService().install(request),
  enablePaddleOcr: (request) => getPaddleOcrLifecycleService().enable(request),
  testPaddleOcr: (request) => getPaddleOcrLifecycleService().test(request),
  disablePaddleOcr: (request) => getPaddleOcrLifecycleService().disable(request),
  removePaddleOcr: (request) => getPaddleOcrLifecycleService().remove(request),
  repairToolchain: (request: ToolchainRepairRequest) => getToolchainRepairService().repair(request)
});
ipcMain.handle("activity.list", (_event, request?: KnowledgeActivityListRequest) =>
  (() => {
    const parsed = KnowledgeActivityListRequestSchema.parse(request ?? {});
    return KnowledgeActivityListResultSchema.parse(
      getKnowledgeActivityService().list(parsed.limit === undefined ? {} : { limit: parsed.limit })
    );
  })()
);
ipcMain.handle("activity.undo", async (_event, request: KnowledgeActivityUndoRequest) => {
  const result = await getKnowledgeActivityService().undo(request);
  scheduleActivityIndexRebuild();
  return result;
});
ipcMain.handle("library.list", (_event, request?: LibraryListRequest) => getLibraryService().list(request));
ipcMain.handle("library.tree", () => getLibraryService().tree());
ipcMain.handle("library.related", (_event, request: LibraryRelatedRequest) => getLibraryService().related(request));
ipcMain.handle("library.tags", (_event, request: LibraryTagsRequest) => {
  const parsed = LibraryTagsRequestSchema.parse(request);
  return LibraryTagsResultSchema.parse(getLibraryTagsService().browse(parsed));
});
registerReaderIpc({
  ipcMain,
  getWindow: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
  showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
  getNotesService,
  getReaderSelectionActionService,
  getReaderSelectionProposalService,
  getReaderSelectionCreateNoteService: getReaderSelectionCreateNoteActionService,
  getReaderSourceRevealService,
  getReaderSourceReconnectService,
  getNoteTrashService,
  getNoteArchiveService,
  getNoteMergeService,
  getNoteRelateService,
  getNoteMarkdownImportService,
  onNoteTrashCommitted: scheduleActivityIndexRebuild,
  onNoteArchiveCommitted: scheduleActivityIndexRebuild,
  onNoteRelated: scheduleActivityIndexRebuild,
  onNoteImported: scheduleActivityIndexRebuild
});
registerCurrentNoteAppendIpc({
  ipcMain,
  currentVault: () => getVaultService().current(),
  activeVaultPath: () => getVaultService().activeVaultPath(),
  getService: getCurrentNoteAppendService,
  getJobsService
});
registerCurrentNoteReplaceIpc({
  ipcMain,
  currentVault: () => getVaultService().current(),
  activeVaultPath: () => getVaultService().activeVaultPath(),
  getService: getCurrentNoteReplaceService,
  getJobsService
});
registerBackupRestoreIpc({
  ipcMain,
  getWindow: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
  showSaveDialog: (window, options) => dialog.showSaveDialog(window, options),
  showOpenDialog: (window, options) => dialog.showOpenDialog(window, options),
  showMessageBox: (window, options) => dialog.showMessageBox(window, options),
  getActiveVault: () => getVaultService().current(),
  getLastBackupAt: () => getJobsService().list({
    classes: ["backup"],
    states: ["completed", "completed_with_warnings"],
    limit: 100
  }).jobs.find((job) => job.backupKind === "user_backup")?.updatedAt,
  getLocale: () => getAppearanceService().summary().locale,
  getDocumentsPath: () => app.getPath("documents"),
  getBackupService: getBackupRestoreService,
  getBackupCoordinator: getBackupCoordinatorService,
  getRestoreCoordinator: getRestoreCoordinatorService,
  resumeBackgroundJobs
});

registerProposalIpc({
  ipcMain,
  review: {
    activeVaultId: () => getVaultService().current()?.vaultId,
    read: (proposalId) => {
      try {
        return getProposalService().get({ proposalId }).proposal;
      } catch (caught) {
        if (caught instanceof PigeDomainError && caught.code === "proposal.not_found") return undefined;
        throw caught;
      }
    },
    approve: (proposalId) => getJobsService().approveProposal(getProposalService(), { proposalId }),
    reject: (proposalId) => getJobsService().rejectProposal(getProposalService(), { proposalId })
  }
});

function proposalRendererBoundaryUnavailable(): never {
  throw new PigeDomainError(
    "proposal.renderer_preview_unavailable",
    "Proposal review is unavailable until a bounded renderer preview can be verified."
  );
}

ipcMain.handle("proposals.list", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.get", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.approve", proposalRendererBoundaryUnavailable);
ipcMain.handle("proposals.reject", proposalRendererBoundaryUnavailable);
ipcMain.handle("retrieval.search", (_event, request: unknown) =>
  handleRetrievalSearchIpc(request, {
    search: (parsed) => getRetrievalService().searchCurrent(parsed)
  })
);
ipcMain.handle("vault.current", () => getVaultService().current());
ipcMain.handle("vault.recent", () => getVaultService().recent());
ipcMain.handle("onboarding.status", () => getVaultService().onboardingStatus());
ipcMain.handle("onboarding.dismissFirstHome", () => getVaultService().dismissFirstHomeGuide());
ipcMain.handle("vault.create", async (event, request: CreateVaultRequest) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for vault creation.");
  const result = await getVaultService().create(parentWindow, request);
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return result;
});
ipcMain.handle("vault.open", async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for vault opening.");
  const result = await getVaultService().open(parentWindow);
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return result;
});
ipcMain.handle("vault.openRecent", (_event, request: OpenRecentVaultRequest) => {
  const parsedRequest = OpenRecentVaultRequestSchema.parse(request);
  const result = getVaultService().openRecent(parsedRequest);
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return VaultActionResultSchema.parse(result);
});
ipcMain.handle(VAULT_APPLY_MIGRATION_CHANNEL, async (_event, request: VaultMigrationApplyRequest) => {
  const result = await getVaultService().applyMigration(VaultMigrationApplyRequestSchema.parse(request));
  if (result.status === "completed") {
    initializeActiveDatabase();
    resumeBackgroundJobs();
  }
  return VaultMigrationApplyResultSchema.parse(result);
});
ipcMain.handle("vault.revealKnowledgeRoot", (event) => {
  requireWindow(event.sender);
  return getVaultService().revealKnowledgeRoot();
});
ipcMain.handle("vault.revealSourceAssetRoot", (event) => {
  requireWindow(event.sender);
  return getVaultService().revealSourceAssetRoot();
});
ipcMain.handle("vault.updateSourceStoragePolicy", (_event, request: UpdateSourceStoragePolicyRequest) =>
  getVaultService().updateSourceStoragePolicy(request)
);
ipcMain.handle(MANAGED_COPY_ROOT_CONFIGURE_CHANNEL, async (event, request: ManagedCopyRootConfigureRequest) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for managed-copy root selection.");
  return ManagedCopyRootConfigureResultSchema.parse(
    await getVaultService().configureManagedCopyRoot(
      parentWindow,
      ManagedCopyRootConfigureRequestSchema.parse(request)
    )
  );
});
ipcMain.handle("vault.removeRecent", (_event, vaultId: string) => getVaultService().removeRecent(vaultId));
ipcMain.handle("maintenance.rebuildLocalDatabase", () => getIndexRebuildJobExecutor().request());
ipcMain.handle("maintenance.resetLocalDatabase", async (event) => {
  await confirmSettingAction(event.sender, ["maintenance.localDatabaseReset"], {
    title: "Reset local index data?",
    message: "Pige will delete and rebuild only local indexes, caches, and database state. Your notes and source evidence stay intact.",
    confirmLabel: "Reset local data"
  });
  const result = getVaultService().resetLocalDatabase();
  initializeActiveDatabase();
  return result;
});
ipcMain.handle("maintenance.localDatabaseStatus", () => {
  const activeVaultPath = getVaultService().activeVaultPath();
  if (!activeVaultPath) throw new Error("No active vault for local database status.");
  return getLocalDatabaseService().status(activeVaultPath);
});
ipcMain.handle("diagnostics.health", () => getDiagnosticsService().health());
ipcMain.handle("diagnostics.previewSupportBundle", () => {
  latestSupportBundlePreview = getDiagnosticsService().previewSupportBundle();
  return latestSupportBundlePreview;
});
ipcMain.handle("diagnostics.exportSupportBundle", async (event, request: ExportSupportBundleRequest) => {
  if (!request || !isDiagnosticsExportRequestId(request.exportRequestId)) {
    throw new Error("Support bundle export request is invalid.");
  }
  const preview = latestSupportBundlePreview;
  if (!preview || preview.previewId !== request.previewId) {
    throw new Error("Create a current support bundle preview before exporting.");
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for support bundle export.");
  const selection = await dialog.showSaveDialog(parentWindow, {
    title: "Export Pige Support Bundle",
    defaultPath: `pige-support-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { status: "canceled" };
  }
  if (activeSupportBundleExports.has(request.exportRequestId) ||
    [...activeSupportBundleExports.values()].some((active) => active.senderId === event.sender.id)) {
    throw new Error("Support bundle export request is already active.");
  }
  const controller = new AbortController();
  const abortOnSenderDestroyed = (): void => controller.abort();
  event.sender.once("destroyed", abortOnSenderDestroyed);
  activeSupportBundleExports.set(request.exportRequestId, {
    senderId: event.sender.id,
    controller
  });
  try {
    return await getDiagnosticsService().exportSupportBundle(
      selection.filePath,
      preview,
      { signal: controller.signal }
    );
  } finally {
    event.sender.removeListener("destroyed", abortOnSenderDestroyed);
    const active = activeSupportBundleExports.get(request.exportRequestId);
    if (active?.controller === controller) activeSupportBundleExports.delete(request.exportRequestId);
  }
});
ipcMain.handle(
  "diagnostics.cancelSupportBundleExport",
  (event, request: CancelSupportBundleExportRequest): CancelSupportBundleExportResult => {
    if (!request || !isDiagnosticsExportRequestId(request.exportRequestId)) return { status: "not_found" };
    const active = activeSupportBundleExports.get(request.exportRequestId);
    if (!active || active.senderId !== event.sender.id) return { status: "not_found" };
    active.controller.abort();
    return { status: "cancel_requested" };
  }
);
ipcMain.handle(
  DIAGNOSTICS_CLEAR_LOCAL_CHANNEL,
  (_event, request: DiagnosticsClearLocalRequest): DiagnosticsClearLocalResult => {
    const parsed = DiagnosticsClearLocalRequestSchema.parse(request);
    if (diagnosticsClearInFlight || activeSupportBundleExports.size > 0) {
      return DiagnosticsClearLocalResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        status: "busy",
        health: getDiagnosticsService().health()
      });
    }
    diagnosticsClearInFlight = true;
    try {
      const health = getDiagnosticsService().clearOwnedEvents({
        assertClearAllowed: () => {
          if (!diagnosticsClearInFlight || activeSupportBundleExports.size > 0) {
            throw new Error("Diagnostics clear ownership changed.");
          }
        }
      });
      latestSupportBundlePreview = undefined;
      return DiagnosticsClearLocalResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        status: "cleared",
        health
      });
    } catch {
      if (activeSupportBundleExports.size > 0) {
        return DiagnosticsClearLocalResultSchema.parse({
          apiVersion: 1,
          requestId: parsed.requestId,
          status: "busy",
          health: getDiagnosticsService().health()
        });
      }
      return DiagnosticsClearLocalResultSchema.parse({
        apiVersion: 1,
        requestId: parsed.requestId,
        status: "failed"
      });
    } finally {
      diagnosticsClearInFlight = false;
    }
  }
);

function isDiagnosticsExportRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{16,64}$/u.test(value);
}
ipcMain.handle("models.summary", () => getModelProviderRegistry().summary());
ipcMain.handle("models.addPresetProvider", async (_event, request: AddPresetProviderRequest) => {
  const parsedRequest = AddPresetProviderRequestSchema.parse(request);
  const validatedRequest: AddPresetProviderRequest = {
    presetId: parsedRequest.presetId,
    ...(parsedRequest.apiKey ? { apiKey: parsedRequest.apiKey } : {})
  };
  return getModelProviderRegistry().addPresetProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.addManualProvider", async (_event, request: AddManualProviderRequest) => {
  const validatedRequest = AddManualProviderRequestSchema.parse(request) as AddManualProviderRequest;
  return getModelProviderRegistry().addManualProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.refreshProviderModels", async (_event, request: RefreshProviderModelsRequest) =>
  getModelProviderRegistry().refreshProviderModels(RefreshProviderModelsRequestSchema.parse(request))
);
ipcMain.handle("models.updateProviderCredential", async (event, request: UpdateProviderCredentialRequest) => {
  const validatedRequest = UpdateProviderCredentialRequestSchema.parse(request);
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Replace this model service credential?",
    message: "Pige will test the replacement credential without displaying the existing credential. The current credential remains active unless the replacement is verified and saved successfully.",
    confirmLabel: "Replace credential"
  });
  return getModelProviderRegistry().updateProviderCredential(validatedRequest);
});
ipcMain.handle("models.deleteProvider", async (event, request: DeleteProviderRequest) => {
  const validatedRequest = DeleteProviderRequestSchema.parse(request);
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Delete this model service?",
    message: "Pige will remove this Provider Profile, its protected credential reference, and its owned model profiles. If it owns the default model, Pige will select a usable remaining model or clear the default.",
    confirmLabel: "Delete service"
  });
  return getModelProviderRegistry().deleteProvider(validatedRequest);
});
ipcMain.handle("models.addManualModel", async (_event, request: AddManualModelRequest) =>
  {
    const parsed = AddManualModelRequestSchema.parse(request);
    return getModelProviderRegistry().addManualModel({
      providerProfileId: parsed.providerProfileId,
      modelId: parsed.modelId,
      ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName })
    });
  }
);
ipcMain.handle("models.updateModel", async (_event, request: UpdateModelRequest) => {
  const parsed = UpdateModelRequestSchema.parse(request);
  return getModelProviderRegistry().updateModel({
    modelProfileId: parsed.modelProfileId,
    ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName })
  });
}
);
ipcMain.handle("models.setDefaultModel", async (_event, request: SetDefaultModelRequest) => {
    const summary = await getModelProviderRegistry().setDefaultModel(SetDefaultModelRequestSchema.parse(request));
    scheduleWaitingAgentIngestAfterModelReady();
    return summary;
});
ipcMain.handle("settings.appearance", () =>
  AppearanceSettingsSummarySchema.parse(getAppearanceService().summary())
);
ipcMain.handle("settings.setLocale", (_event, request: SetLocaleRequest) =>
  AppearanceSettingsSummarySchema.parse(
    getAppearanceService().setLocale(SetLocaleRequestSchema.parse(request))
  )
);
ipcMain.handle("settings.setTheme", (_event, request: SetThemeRequest): AppearanceThemeMutationResult =>
  AppearanceThemeMutationResultSchema.parse(
    getAppearanceService().setTheme(SetThemeRequestSchema.parse(request))
  )
);
ipcMain.handle("settings.setKnowledgeLanguage", (
  _event,
  request: SetKnowledgeLanguageRequest
): KnowledgeLanguageMutationResult =>
  KnowledgeLanguageMutationResultSchema.parse(
    getAppearanceService().setKnowledgeLanguage(SetKnowledgeLanguageRequestSchema.parse(request))
  )
);
ipcMain.handle("settings.startupDestination", () =>
  StartupDestinationSummarySchema.parse(getStartupDestinationService().summary())
);
ipcMain.handle("settings.setStartupDestination", (_event, request: SetStartupDestinationRequest) =>
  StartupDestinationMutationResultSchema.parse(
    getStartupDestinationService().set(SetStartupDestinationRequestSchema.parse(request))
  )
);
ipcMain.handle("settings.registry", () => getSettingsRegistry());
ipcMain.handle("updates.summary", () => UpdateSummarySchema.parse(getUpdateService().summary()));
ipcMain.handle("updates.check", async (_event, request: UpdateCheckRequest) =>
  UpdateCheckResultSchema.parse(
    await getUpdateService().check(UpdateCheckRequestSchema.parse(request))
  )
);
ipcMain.handle("updates.download", (_event, request: UpdateDownloadRequest) =>
  UpdateDownloadResultSchema.parse(
    getUpdateService().download(UpdateDownloadRequestSchema.parse(request))
  )
);
ipcMain.handle("updates.apply", async (_event, request: UpdateApplyRequest) =>
  UpdateApplyResultSchema.parse(
    await getUpdateService().apply(UpdateApplyRequestSchema.parse(request))
  )
);
ipcMain.handle("system.toolchainHealth", () => getToolchainService().health());

app.whenReady().then(async () => {
  if (!ownsAppInstanceLock) return;
  localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  getAppearanceService();
  const packagedRuntimeSmokeReportPath = resolvePackagedRuntimeSmokeReportPath();
  if (packagedRuntimeSmokeReportPath) {
    let smokeWindow: BrowserWindow | undefined;
    let smokeStage: PackagedRuntimeSmokeStage = "runtime_import";
    try {
      smokeStage = "native_semantic_runtime";
      const semanticRuntime = {
        embedding: await probePackagedLocalSemanticRuntime(),
        sqliteVec: await probePackagedSqliteVectorRuntime()
      };
      if (!semanticRuntime.sqliteVec) throw new Error("The packaged sqlite-vec runtime is unavailable.");
      smokeStage = "runtime_import";
      const smoke = await import(pathToFileURL(join(__dirname, "pi-agent-runtime-smoke.js")).href);
      smokeStage = "pi_runtime";
      const pi = await smoke.runPiAgentRuntimeSmoke();
      smokeStage = "home_runtime";
      const home = await smoke.runHomeAgentRuntimeSmoke();
      smokeStage = "renderer_window";
      smokeWindow = createMainWindow(false);
      smokeStage = "renderer_load";
      const renderer = await runPackagedRendererSmoke(smokeWindow);
      const screenshot = (await smokeWindow.webContents.capturePage()).toPNG();
      const screenshotPath = `${packagedRuntimeSmokeReportPath}.png`;
      writeFileSync(screenshotPath, screenshot, { mode: 0o600, flag: "wx" });
      const runtimeIdentity = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged
      };
      smokeStage = "report_write";
      writeFileSync(packagedRuntimeSmokeReportPath, `${JSON.stringify({
        schemaVersion: 1,
        status: "passed",
        runtimeIdentity,
        semanticRuntime,
        pi,
        home,
        renderer: {
          ...renderer,
          uiEvidence: {
            fileName: "packaged-ui.png",
            bytes: screenshot.byteLength,
            sha256: `sha256:${createHash("sha256").update(screenshot).digest("hex")}`
          }
        }
      })}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      smokeWindow.destroy();
      app.exit(0);
    } catch (caught) {
      const failure = caught instanceof PackagedRuntimeSmokeError
        ? caught.failure
        : { stage: smokeStage };
      try {
        writeFileSync(packagedRuntimeSmokeReportPath, `${JSON.stringify({
          schemaVersion: 1,
          status: "failed",
          failure
        })}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx"
        });
      } catch {
        // A report write failure must preserve the original fail-closed exit.
      }
      smokeWindow?.destroy();
      app.exit(1);
    }
    return;
  }

  skillRegistryService = new SkillRegistryService(app.getPath("userData"), {
    recoverOrphanedMutationLock: true
  });
  updateService = new UpdateService({
    settings: getLocalSettingsStore(),
    adapter: new NoNetworkUpdateCheckAdapter(),
    currentVersion: app.getVersion(),
    publish: publishUpdateStatus,
    hasBlockingWork: hasUpdateBlockingWork,
    scheduleApply: (applyUpdate) => setImmediate(applyUpdate)
  });
  modelProviderRegistry = new ModelProviderRegistry(
    app.getPath("userData"),
    new JsonSecretStore(app.getPath("userData"))
  );
  vaultService = new VaultService(
    getLocalSettingsStore(),
    () => getModelProviderRegistry().hasDefaultRuntimeBinding(),
    undefined,
    undefined,
    undefined,
    getManagedCopyRootService()
  );
  windowModeService = new WindowModeService(
    getLocalSettingsStore(),
    (bounds) => screen.getDisplayMatching(bounds).workArea
  );
  localDatabaseService = new LocalDatabaseService(undefined, new LocalDatabaseRebuildWorkerService());
  backupRestoreService = new BackupRestoreService({ userDataPath: app.getPath("userData") });
  agentRuntimeService = new AgentRuntimeService(
    getVaultService(),
    getModelProviderRegistry(),
    getLocalDatabaseService(),
    { snapshot: getAgentCapabilitySnapshot }
  );
  proposalService = new ProposalService(getVaultService());
  managedCollectionService = new ManagedCollectionService(getVaultService());
  managedCollectionViewService = new ManagedCollectionViewService(getVaultService());
  managedCollectionCitationService = new ManagedCollectionCitationService(
    getVaultService(),
    collectionCitationConversationHistory
  );
  noteMarkdownEditorActivityAdapter = new NoteMarkdownEditorActivityAdapter(getVaultService());
  noteMarkdownEditorService = new NoteMarkdownEditorService(
    getVaultService(),
    noteMarkdownEditorActivityAdapter
  );
  noteTrashService = new NoteTrashService(getVaultService(), getNotesService());
  noteArchiveService = new NoteArchiveService(getNotesService(), noteMarkdownEditorService);
  noteMergeService = new NoteMergeService(getVaultService(), getNotesService());
  noteRelateService = new NoteRelateService(
    getNotesService(),
    noteMarkdownEditorService,
    () => getVaultService().activeVaultPath(),
  );
  noteMarkdownImportService = new NoteMarkdownImportService(getVaultService(), getNotesService());
  knowledgeActivityService = new KnowledgeActivityService(
    getVaultService(),
    createManagedCollectionActivityPort(),
    noteMarkdownEditorActivityAdapter,
    getAgentMemoryService(),
    createNotePageLifecycleActivityPort()
  );
  agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
    snapshot: getAgentCapabilitySnapshot
  }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort());
  documentParserService = new DocumentParserService();
  datasetService = new DatasetService(new DatasetIngestWorkerService());
  const paddleRuntime = getPaddleOcrRuntimeComposition();
  paddleRuntime.recoverStaging();
  ocrService = new OcrService(paddleRuntime.adapter);
  toolchainService = new ToolchainService(resolveToolchainManifestPath());
  captureService = new CaptureService(getVaultService(), undefined, getManagedCopyRootService());
  homeAgentAttachmentService = new HomeAgentAttachmentService(captureService);
  jobsService = new JobsService(
    getVaultService(),
    getAgentIngestService(),
    getLocalDatabaseService(),
    getDocumentParserService(),
    getOcrService(),
    getDatasetService(),
    getJobClassExecutorRegistry(),
    undefined,
    undefined,
    getLocalRagEngineService(),
    getOcrLanguagePreferenceService()
  );
  diagnosticsService = new DiagnosticsService(app.getPath("userData"));
  const restoreRecovery = await getRestoreCoordinatorService().recoverInterrupted();
  if (restoreRecovery.recovered > 0 || restoreRecovery.failed > 0) {
    diagnosticsService.recordEvent({
      level: restoreRecovery.failed > 0 ? "warning" : "info",
      code: restoreRecovery.failed > 0 ? "restore.recovery_incomplete" : "restore.recovery_completed",
      message: restoreRecovery.failed > 0
        ? "Some interrupted Restore Jobs still require repair."
        : "Interrupted Restore Jobs were reconciled from durable checkpoints."
    });
  }
  initializeActiveDatabase();
  diagnosticsService.recordEvent({ level: "info", code: "app.ready", message: "App ready." });
  createMainWindow();
  resumeBackgroundJobs();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  taskExecutionIpcUnsubscribe?.();
  taskExecutionIpcUnsubscribe = undefined;
  appearanceServiceUnsubscribe?.();
  appearanceServiceUnsubscribe = undefined;
  appearanceService?.dispose();
  restoreCoordinatorService?.close();
  vaultService?.close();
});

function projectBackupJobAction(
  jobId: string,
  status: "cancel_requested" | "cancelled" | "requeued" | "not_allowed"
): JobActionResult {
  const job = getJobsService().list({ classes: ["backup"], limit: 100 }).jobs.find(
    (candidate) => candidate.id === jobId
  );
  return { status, ...(job ? { job } : {}) };
}

function requireWindow(webContents: WebContents): BrowserWindow {
  const parentWindow = BrowserWindow.fromWebContents(webContents);
  if (!parentWindow) throw new Error("No active Pige window.");
  return parentWindow;
}

function resolveToolchainManifestPath(): string {
  const fallback = join(process.cwd(), "resources/toolchain-manifest/toolchain.manifest.json");
  const candidates = [
    join(process.resourcesPath, "toolchain-manifest/toolchain.manifest.json"),
    join(process.cwd(), "../../resources/toolchain-manifest/toolchain.manifest.json"),
    fallback,
    join(app.getAppPath(), "resources/toolchain-manifest/toolchain.manifest.json"),
    join(app.getAppPath(), "../../resources/toolchain-manifest/toolchain.manifest.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function resolvePiPackageCatalogManifestPath(): string {
  const relativePath = "curated-packages/pi-package-catalog.manifest.json";
  if (app.isPackaged) return join(process.resourcesPath, relativePath);
  const fallback = join(process.cwd(), "resources", relativePath);
  const candidates = [
    fallback,
    join(process.cwd(), "../../resources", relativePath),
    join(app.getAppPath(), "resources", relativePath),
    join(app.getAppPath(), "../../resources", relativePath)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function resolvePaddleOcrManifestPath(): string {
  const relativePath = "parser-manifests/paddleocr-local.parser.manifest.json";
  const fallback = join(process.cwd(), "resources", relativePath);
  const candidates = [
    join(process.resourcesPath, relativePath),
    join(process.cwd(), "../../resources", relativePath),
    fallback,
    join(app.getAppPath(), "resources", relativePath),
    join(app.getAppPath(), "../../resources", relativePath)
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function resolvePackagedRuntimeSmokeReportPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  const argument = process.argv.find((value) => value.startsWith(PACKAGED_RUNTIME_SMOKE_ARGUMENT));
  const requestedPath = argument?.slice(PACKAGED_RUNTIME_SMOKE_ARGUMENT.length);
  if (!requestedPath || !isAbsolute(requestedPath)) return undefined;
  const reportPath = resolve(requestedPath);
  const tempRoot = realpathSync(app.getPath("temp"));
  const reportParent = realpathSync(dirname(reportPath));
  const relativeParent = relative(tempRoot, reportParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativeParent)) {
    return undefined;
  }
  return reportPath;
}
