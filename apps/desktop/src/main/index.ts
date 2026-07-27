import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, screen, shell, type WebContents } from "electron";
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
  AgentSubmitTurnRequest,
  AppHealth,
  AppearanceThemeMutationResult,
  CreateVaultRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  ExportSupportBundleRequest,
  HighRiskConfirmationResolveRequest,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  KnowledgeActivityListRequest,
  KnowledgeActivityUndoRequest,
  LibraryListRequest,
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
  SetThemeRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  SpeechAvailabilityRequest,
  SpeechAssetInstallRequest,
  SpeechCancelRequest,
  SpeechSessionRequest,
  SpeechStartRequest,
  SupportBundlePreview,
  UpdateCheckRequest,
  UpdateStatusEvent,
  UpdateSourceStoragePolicyRequest,
  WindowLayoutRequest
} from "@pige/contracts";
import {
  AgentConversationRequestSchema,
  AgentConversationResultSchema,
  KnowledgeActivityListRequestSchema,
  KnowledgeActivityListResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
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
  UpdateStatusEventSchema,
  UpdateSummarySchema,
  SetLocaleRequestSchema,
  SetThemeRequestSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema,
  VaultActionResultSchema
} from "@pige/schemas";
import { PRELOAD_ENTRY_FILENAME } from "../shared/preload-entry";
import { registerReaderIpc } from "./register-reader-ipc";
import { registerBackupRestoreIpc } from "./register-backup-restore-ipc";
import { registerTaskExecutionIpc } from "./register-task-execution-ipc";
import { registerManagedCollectionIpc } from "./register-managed-collection-ipc";
import { registerLocalSemanticRetrievalIpc } from "./register-local-semantic-retrieval-ipc";
import { registerKnowledgeHealthIpc } from "./register-knowledge-health-ipc";
import { registerMemoryIpc } from "./register-memory-ipc";
import { registerSkillsIpc } from "./register-skills-ipc";
import {
  AgentIngestService,
  type AgentIngestCapabilitySnapshot,
  type AgentIngestProposalPort,
  type AgentIngestRetrievalPort
} from "./services/agent-ingest-service";
import { AgentRuntimeService } from "./services/agent-runtime-service";
import { AgentTurnDraftPublisher } from "./services/agent-turn-draft-publisher";
import { AppearanceService } from "./services/appearance-service";
import { BackupCoordinatorService } from "./services/backup-coordinator-service";
import { BackupRestoreService } from "./services/backup-service";
import { CoalescedBatchDrainer } from "./services/background-job-drainer";
import { CaptureService } from "./services/capture-service";
import { type CaptureJobExecutor } from "./services/capture-job-executor";
import { HomeAgentAttachmentService } from "./services/home-agent-attachment-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { DatasetIngestWorkerService } from "./services/dataset-ingest-worker-service";
import { DatasetQueryService } from "./services/dataset-query-service";
import { DatasetService } from "./services/dataset-service";
import { DocumentParserService } from "./services/document-parser-service";
import {
  JobsService,
  type ProcessQueuedCapturesResult
} from "./services/jobs-service";
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
import { KnowledgeActivityService } from "./services/knowledge-activity-service";
import { KnowledgeHealthService } from "./services/knowledge-health-service";
import { ManagedCollectionService } from "./services/managed-collection-service";
import {
  HomeAgentService,
  scheduleAcceptedAgentTurn,
  type HomeAgentDraftSnapshot
} from "./services/home-agent-service";
import { HomeAgentUrlService } from "./services/home-agent-url-service";
import { HighRiskConfirmationService } from "./services/high-risk-confirmation-service";
import { LocalDatabaseRebuildWorkerService } from "./services/local-database-rebuild-worker-service";
import { LocalDatabaseService } from "./services/local-database-service";
import { listMarkdownTagCatalog } from "./services/markdown-page-index";
import { LocalSettingsStore } from "./services/local-settings";
import { ModelProviderRegistry } from "./services/model-provider-registry";
import { PermissionBrokerService } from "./services/permission-broker-service";
import {
  applyReaderSelectionPageUpdate,
  createAgentPageUpdateOperationId
} from "./services/agent-page-update-service";
import { readReaderSelectionPageUpdateOperation } from "./services/agent-turn-publication";
import { ReaderSelectionActionService } from "./services/reader-selection-action-service";
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
import { PiPackageManagerService } from "./services/pi-package-manager-service";
import { NotesService } from "./services/notes-service";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService
} from "./services/note-markdown-editor-service";
import { OcrService } from "./services/ocr-service";
import { MacOSSpeechAdapter } from "./services/macos-speech-adapter";
import { ProposalService } from "./services/proposal-service";
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
let permissionBrokerService: PermissionBrokerService | undefined;
let permissionedExternalCapabilityRegistry: PermissionedExternalCapabilityRegistry | undefined;
let firstPartyReadonlyNodeOsCapabilitiesRegistered = false;
let firstPartyCommandCapabilityRegistered = false;
let firstPartyPiPackageCapabilityRegistered = false;
let piPackageManagerService: PiPackageManagerService | undefined;
let windowModeService: WindowModeService | undefined;
let backupRestoreService: BackupRestoreService | undefined;
let backupCoordinatorService: BackupCoordinatorService | undefined;
let restoreCoordinatorService: RestoreCoordinatorService | undefined;
let agentRuntimeService: AgentRuntimeService | undefined;
let agentIngestService: AgentIngestService | undefined;
let homeAgentService: HomeAgentService | undefined;
let homeAgentUrlService: HomeAgentUrlService | undefined;
let appearanceService: AppearanceService | undefined;
let appearanceServiceUnsubscribe: (() => void) | undefined;
let toolchainService: ToolchainService | undefined;
let captureService: CaptureService | undefined;
let homeAgentAttachmentService: HomeAgentAttachmentService | undefined;
let jobsService: JobsService | undefined;
let jobClassExecutorRegistry: JobClassExecutorRegistry | undefined;
let knowledgeActivityService: KnowledgeActivityService | undefined;
let knowledgeHealthService: KnowledgeHealthService | undefined;
let managedCollectionService: ManagedCollectionService | undefined;
let libraryService: LibraryService | undefined;
let notesService: NotesService | undefined;
let noteMarkdownEditorActivityAdapter: NoteMarkdownEditorActivityAdapter | undefined;
let noteMarkdownEditorService: NoteMarkdownEditorService | undefined;
let readerSelectionActionService: ReaderSelectionActionService | undefined;
let readerSelectionProposalService: ReaderSelectionProposalService | undefined;
let proposalService: ProposalService | undefined;
let retrievalService: RetrievalService | undefined;
let localSemanticRetrievalService: LocalSemanticRetrievalService | undefined;
let localSemanticEmbeddingRuntime: LocalSemanticEmbeddingRuntime | undefined;
let localRagEngineService: LocalRagEngineService | undefined;
let documentParserService: DocumentParserService | undefined;
let datasetQueryService: DatasetQueryService | undefined;
let datasetService: DatasetService | undefined;
let ocrService: OcrService | undefined;
let speechService: SpeechService | undefined;
let updateService: UpdateService | undefined;
let skillRegistryService: SkillRegistryService | undefined;
let skillUrlInstallService: SkillUrlInstallService | undefined;
let agentMemoryService: AgentMemoryService | undefined;
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
const speechTrackedSenders = new Set<number>();
const PACKAGED_RUNTIME_SMOKE_ARGUMENT = "--pige-packaged-runtime-smoke-report=";


async function confirmSettingAction(
  sender: WebContents,
  settingKeys: readonly string[],
  confirmation: SettingActionConfirmation
): Promise<void> {
  const parentWindow = BrowserWindow.fromWebContents(sender);
  if (!parentWindow) throw new Error("No active window for setting confirmation.");
  await guardSettingAction(settingKeys, confirmation, async (prompt) => {
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
  });
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

const getHighRiskConfirmationService = (): HighRiskConfirmationService => {
  if (!highRiskConfirmationService) {
    highRiskConfirmationService = new HighRiskConfirmationService();
    highRiskConfirmationService.onChanged((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("confirmations.changed", event);
      }
    });
  }
  return highRiskConfirmationService;
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

const getAgentMemoryService = (): AgentMemoryService => {
  agentMemoryService ??= new AgentMemoryService();
  return agentMemoryService;
};

const getVaultService = (): VaultService => {
  if (!vaultService) {
    vaultService = new VaultService(
      getLocalSettingsStore(),
      () => getModelProviderRegistry().hasDefaultRuntimeBinding()
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

const getUpdateService = (): UpdateService => {
  if (!updateService) {
    updateService = new UpdateService({
      settings: getLocalSettingsStore(),
      adapter: new NoNetworkUpdateCheckAdapter(),
      currentVersion: app.getVersion(),
      publish: publishUpdateStatus
    });
  }
  return updateService;
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
    captureService = new CaptureService(getVaultService());
  }
  return captureService;
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
      getLocalRagEngineService()
    );
  }
  return jobsService;
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
  if (!ocrService) ocrService = new OcrService();
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
        }
      },
      {
        toolsForTurn: (turn) => [getTaskExecutionPlanRunner().toolForExplicitHomeTurn({
          ...turn,
          readToolCatalogHash: turn.readToolCatalogHash
        })]
      },
      getAgentMemoryService()
    );
  }
  return homeAgentService;
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
  return {
    localDatabaseStatus,
    parserToolchainReady: parser.canParse("pdf_file") && parser.canParse("docx_file") && parser.canParse("pptx_file"),
    datasetToolchainReady: getDatasetService().canMaterialize("csv_file") &&
      getDatasetService().canMaterialize("xlsx_file") &&
      getDatasetService().canMaterialize("sqlite_file"),
    ocrEngines: imageOcrReady && process.platform === "darwin" ? ["apple_vision"] : [],
    speechInputAvailable: false,
    embeddingModelInstalled: getLocalSemanticRetrievalService().embeddingModelInstalled(),
    lexicalSearchAvailable: localDatabaseStatus === "ready",
    vectorSearchAvailable: vaultPath ? getLocalRagEngineService().availableNow(vaultPath) : false,
    rerankerAvailable: false
  };
};

const getLibraryService = (): LibraryService => {
  if (!libraryService) {
    libraryService = new LibraryService(getVaultService(), getLocalDatabaseService());
  }
  return libraryService;
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
      }
    );
  }
  return readerSelectionProposalService;
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
      getManagedCollectionService(),
      getNoteMarkdownEditorActivityAdapter(),
      getAgentMemoryService()
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
      new JsonSecretStore(app.getPath("userData"), safeStorage),
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
    getJobsService().requeueWaitingParses();
    getJobsService().requeueWaitingOcr();
    getJobsService().requeueWaitingAgentIngest();
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
ipcMain.handle("confirmations.pending", () =>
  HighRiskConfirmationPendingResultSchema.parse(getHighRiskConfirmationService().pending())
);
ipcMain.handle("confirmations.resolve", async (_event, request: HighRiskConfirmationResolveRequest) => {
  const parsed = HighRiskConfirmationResolveRequestSchema.parse(request);
  return HighRiskConfirmationResolveResultSchema.parse(
    await getHighRiskConfirmationService().resolve(parsed)
  );
});
taskExecutionIpcUnsubscribe = registerTaskExecutionIpc({
  ipcMain,
  readInteraction: () => getTaskProcessSessionService().interaction(),
  openInteraction: (request) => getTaskProcessSessionService().openInteraction(request),
  subscribeInteractionChanged: (listener) => getTaskProcessSessionService().onInteractionChanged(listener)
});
registerManagedCollectionIpc({
  ipcMain,
  getActiveVaultId: () => getVaultService().current()?.vaultId,
  openCollection: (request) => getManagedCollectionService().open(request),
  editCollectionCell: (request) => getManagedCollectionService().editCell(request),
  appendDefaultCollectionRow: (request) => getManagedCollectionService().appendDefaultRow(request),
  addNullableCollectionColumn: (request) => getManagedCollectionService().addNullableColumn(request)
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
  stageFromUrl: (request) => getSkillUrlInstallService().stageFromUrl(request),
  stageFromMarkdown: (request, sourcePath) => getSkillUrlInstallService().stageFromMarkdown(request, sourcePath),
  stageUpdate: (request) => getSkillUrlInstallService().stageUpdate(request),
  installStaged: (request) => getSkillUrlInstallService().installStaged(request),
  discardStaged: (request) => getSkillUrlInstallService().discardStaged(request),
  disable: (request) => getSkillRegistryService().disable(request),
  enable: (request) => getSkillRegistryService().enable(request),
  uninstall: (request) => getSkillRegistryService().uninstall(request),
  exportSkill: (request, destinationPath) => getSkillRegistryService().export(request, destinationPath),
  publishRegistryChanged: (result) => {
    if (!("registry" in result)) return;
    for (const window of mainWindows) {
      if (!window.isDestroyed()) window.webContents.send("skills.changed", result.registry);
    }
  }
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
registerReaderIpc({
  ipcMain,
  getNotesService,
  getReaderSelectionActionService,
  getReaderSelectionProposalService
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
  initializeActiveDatabase();
  resumeBackgroundJobs();
  return VaultActionResultSchema.parse(result);
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
ipcMain.handle("settings.registry", () => getSettingsRegistry());
ipcMain.handle("updates.summary", () => UpdateSummarySchema.parse(getUpdateService().summary()));
ipcMain.handle("updates.check", async (_event, request: UpdateCheckRequest) =>
  UpdateCheckResultSchema.parse(
    await getUpdateService().check(UpdateCheckRequestSchema.parse(request))
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
        renderer
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
    publish: publishUpdateStatus
  });
  modelProviderRegistry = new ModelProviderRegistry(
    app.getPath("userData"),
    new JsonSecretStore(app.getPath("userData"), safeStorage)
  );
  vaultService = new VaultService(
    getLocalSettingsStore(),
    () => getModelProviderRegistry().hasDefaultRuntimeBinding()
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
  noteMarkdownEditorActivityAdapter = new NoteMarkdownEditorActivityAdapter(getVaultService());
  noteMarkdownEditorService = new NoteMarkdownEditorService(
    getVaultService(),
    noteMarkdownEditorActivityAdapter
  );
  knowledgeActivityService = new KnowledgeActivityService(
    getVaultService(),
    managedCollectionService,
    noteMarkdownEditorActivityAdapter,
    getAgentMemoryService()
  );
  agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
    snapshot: getAgentCapabilitySnapshot
  }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort());
  documentParserService = new DocumentParserService();
  datasetService = new DatasetService(new DatasetIngestWorkerService());
  ocrService = new OcrService();
  toolchainService = new ToolchainService(resolveToolchainManifestPath());
  captureService = new CaptureService(getVaultService());
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
    getLocalRagEngineService()
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
