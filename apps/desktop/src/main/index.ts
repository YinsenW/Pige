import { app, BrowserWindow, dialog, ipcMain, safeStorage, type WebContents } from "electron";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
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
  BackupCreateResult,
  CreateVaultRequest,
  ExportSupportBundleRequest,
  HomeAgentAskRequest,
  JobActionRequest,
  JobsListRequest,
  KnowledgeActivityListRequest,
  KnowledgeActivityUndoRequest,
  LibraryListRequest,
  LibraryRelatedRequest,
  NoteGetRequest,
  NoteRenderRequest,
  ProposalDecisionRequest,
  ProposalGetRequest,
  ProposalsListRequest,
  ProviderConnectResult,
  RetrievalAskRequest,
  RetrievalSearchRequest,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestorePreviewResult,
  RefreshProviderModelsRequest,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  UpdateModelRequest,
  SetLocaleRequest,
  SetSidebarOpenRequest,
  SubmitFilesCaptureRequest,
  SubmitTextCaptureRequest,
  SubmitUrlCaptureRequest,
  SetWindowModeRequest,
  SupportBundlePreview,
  UpdateSourceStoragePolicyRequest
} from "@pige/contracts";
import {
  AddManualProviderRequestSchema,
  AddPresetProviderRequestSchema,
  AddManualModelRequestSchema,
  RefreshProviderModelsRequestSchema,
  UpdateModelRequestSchema,
  SetDefaultModelRequestSchema
} from "@pige/schemas";
import { PRELOAD_ENTRY_FILENAME } from "../shared/preload-entry";
import {
  AgentIngestService,
  type AgentIngestCapabilitySnapshot,
  type AgentIngestProposalPort,
  type AgentIngestRetrievalPort
} from "./services/agent-ingest-service";
import { AgentRuntimeService } from "./services/agent-runtime-service";
import { AgentTurnDraftPublisher } from "./services/agent-turn-draft-publisher";
import { AppearanceService } from "./services/appearance-service";
import { BackupRestoreService } from "./services/backup-service";
import { CoalescedBatchDrainer } from "./services/background-job-drainer";
import { CaptureService } from "./services/capture-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { DatasetIngestWorkerService } from "./services/dataset-ingest-worker-service";
import { DatasetService } from "./services/dataset-service";
import { DocumentParserService } from "./services/document-parser-service";
import {
  JobsService,
  type ProcessQueuedCapturesResult,
  type ProcessQueuedIndexRebuildResult,
  type ProcessQueuedOcrResult,
  type ProcessQueuedParsesResult
} from "./services/jobs-service";
import { LibraryService } from "./services/library-service";
import { KnowledgeActivityService } from "./services/knowledge-activity-service";
import {
  AgentSubmitTurnRequestSchema,
  HomeAgentService,
  type HomeAgentDraftSnapshot
} from "./services/home-agent-service";
import { HomeAgentUrlService } from "./services/home-agent-url-service";
import { LocalDatabaseRebuildWorkerService } from "./services/local-database-rebuild-worker-service";
import { LocalDatabaseService } from "./services/local-database-service";
import { listMarkdownTagCatalog } from "./services/markdown-page-index";
import { LocalSettingsStore } from "./services/local-settings";
import { ModelProviderRegistry } from "./services/model-provider-registry";
import { NotesService } from "./services/notes-service";
import { OcrService } from "./services/ocr-service";
import { ProposalService } from "./services/proposal-service";
import { installRendererNavigationGuard } from "./services/renderer-navigation-guard";
import { RestorePreviewRegistry } from "./services/restore-preview-registry";
import { RetrievalService } from "./services/retrieval-service";
import { JsonSecretStore } from "./services/secret-store";
import { guardSettingAction, type SettingActionConfirmation } from "./services/setting-action-guard";
import { getSettingsRegistry } from "./services/settings-registry";
import { ToolchainService } from "./services/toolchain-service";
import { VaultService } from "./services/vault-service";
import { WindowModeService } from "./services/window-mode-service";

let vaultService: VaultService | undefined;
let localSettingsStore: LocalSettingsStore | undefined;
let diagnosticsService: DiagnosticsService | undefined;
let localDatabaseService: LocalDatabaseService | undefined;
let modelProviderRegistry: ModelProviderRegistry | undefined;
let windowModeService: WindowModeService | undefined;
let backupRestoreService: BackupRestoreService | undefined;
let agentRuntimeService: AgentRuntimeService | undefined;
let agentIngestService: AgentIngestService | undefined;
let homeAgentService: HomeAgentService | undefined;
let homeAgentUrlService: HomeAgentUrlService | undefined;
let appearanceService: AppearanceService | undefined;
let toolchainService: ToolchainService | undefined;
let captureService: CaptureService | undefined;
let jobsService: JobsService | undefined;
let knowledgeActivityService: KnowledgeActivityService | undefined;
let libraryService: LibraryService | undefined;
let notesService: NotesService | undefined;
let proposalService: ProposalService | undefined;
let retrievalService: RetrievalService | undefined;
let documentParserService: DocumentParserService | undefined;
let datasetService: DatasetService | undefined;
let ocrService: OcrService | undefined;
let latestSupportBundlePreview: SupportBundlePreview | undefined;
const restorePreviewRegistry = new RestorePreviewRegistry();
const restorePreviewTrackedSenders = new Set<number>();
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

function trackRestorePreviewSender(sender: WebContents): void {
  const senderId = sender.id;
  if (restorePreviewTrackedSenders.has(senderId)) return;
  restorePreviewTrackedSenders.add(senderId);
  sender.once("destroyed", () => {
    restorePreviewRegistry.clear(senderId);
    restorePreviewTrackedSenders.delete(senderId);
  });
}

const mainWindows = new Set<BrowserWindow>();
let captureDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let parseDrainer: CoalescedBatchDrainer<ProcessQueuedParsesResult> | undefined;
let ocrDrainer: CoalescedBatchDrainer<ProcessQueuedOcrResult> | undefined;
let agentIngestDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let agentTurnDrainer: CoalescedBatchDrainer<Awaited<ReturnType<HomeAgentService["resumeWaitingTurns"]>>> | undefined;
let indexRebuildDrainer: CoalescedBatchDrainer<ProcessQueuedIndexRebuildResult> | undefined;

const createMainWindow = (): void => {
  const browserWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 560,
    title: "Pige",
    backgroundColor: "#f8f8f5",
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

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void browserWindow.loadFile(join(__dirname, "../renderer/index.html"));
};

const getLocalSettingsStore = (): LocalSettingsStore => {
  if (!localSettingsStore) {
    localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  }
  return localSettingsStore;
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
    windowModeService = new WindowModeService(getLocalSettingsStore());
  }
  return windowModeService;
};

const getBackupRestoreService = (): BackupRestoreService => {
  if (!backupRestoreService) {
    backupRestoreService = new BackupRestoreService();
  }
  return backupRestoreService;
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
    appearanceService = new AppearanceService(getLocalSettingsStore(), app.getLocale());
  }
  return appearanceService;
};

const getToolchainService = (): ToolchainService => {
  if (!toolchainService) {
    toolchainService = new ToolchainService(resolveToolchainManifestPath());
  }
  return toolchainService;
};

const getCaptureService = (): CaptureService => {
  if (!captureService) {
    captureService = new CaptureService(getVaultService());
  }
  return captureService;
};

const getJobsService = (): JobsService => {
  if (!jobsService) {
    jobsService = new JobsService(
      getVaultService(),
      getAgentIngestService(),
      getLocalDatabaseService(),
      getDocumentParserService(),
      getOcrService(),
      getDatasetService()
    );
  }
  return jobsService;
};

const getDocumentParserService = (): DocumentParserService => {
  if (!documentParserService) documentParserService = new DocumentParserService();
  return documentParserService;
};

const getDatasetService = (): DatasetService => {
  if (!datasetService) datasetService = new DatasetService(new DatasetIngestWorkerService());
  return datasetService;
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
  search: (vaultPath, request) => {
    if (getVaultService().activeVaultPath() !== vaultPath) {
      throw new PigeDomainError(
        "vault.binding_changed",
        "The active vault changed before Agent-selected retrieval."
      );
    }
    const result = getRetrievalService().search(request);
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
      getRetrievalService(),
      getJobsService(),
      undefined,
      { snapshot: getAgentCapabilitySnapshot },
      undefined,
      getHomeAgentUrlService()
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
    embeddingModelInstalled: false,
    lexicalSearchAvailable: localDatabaseStatus === "ready",
    vectorSearchAvailable: false,
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
    notesService = new NotesService(getVaultService());
  }
  return notesService;
};

const getProposalService = (): ProposalService => {
  if (!proposalService) {
    proposalService = new ProposalService(getVaultService());
  }
  return proposalService;
};

const getKnowledgeActivityService = (): KnowledgeActivityService => {
  if (!knowledgeActivityService) {
    knowledgeActivityService = new KnowledgeActivityService(getVaultService());
  }
  return knowledgeActivityService;
};

const getRetrievalService = (): RetrievalService => {
  if (!retrievalService) {
    retrievalService = new RetrievalService(getVaultService(), getLocalDatabaseService());
  }
  return retrievalService;
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

const getModelProviderRegistry = (): ModelProviderRegistry => {
  if (!modelProviderRegistry) {
    modelProviderRegistry = new ModelProviderRegistry(
      app.getPath("userData"),
      new JsonSecretStore(app.getPath("userData"), safeStorage)
    );
  }
  return modelProviderRegistry;
};

const initializeActiveDatabase = (): void => {
  const activeVaultPath = getVaultService().activeVaultPath();
  if (activeVaultPath) {
    getLocalDatabaseService().initialize(activeVaultPath);
  }
};

const scheduleCaptureProcessing = (): void => {
  captureDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedCaptures({ limit: 20 }),
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
    runBatch: () => getJobsService().processQueuedParses({ limit: 20 }),
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

const scheduleOcrProcessing = (): void => {
  ocrDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedOcr({ limit: 20 }),
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
    runBatch: () => getJobsService().processQueuedAgentIngest({ limit: 20 }),
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
    onError: () => recordBackgroundFailure(
      "agent_runtime.turn_resume_failed",
      "Waiting Agent turns could not be resumed."
    )
  });
  agentTurnDrainer.schedule();
};

const scheduleIndexRebuildProcessing = (): void => {
  indexRebuildDrainer ??= new CoalescedBatchDrainer({
    runBatch: () => getJobsService().processQueuedIndexRebuild({ limit: 1 }),
    onError: () => recordBackgroundFailure(
      "database.index_rebuild.background_failed",
      "Background local index rebuild failed."
    )
  });
  indexRebuildDrainer.schedule();
};

const scheduleActivityIndexRebuild = (): void => {
  void getJobsService().requestIndexRebuild().catch(() => {
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
    scheduleCaptureProcessing();
    scheduleParseProcessing();
    scheduleOcrProcessing();
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
    scheduleIndexRebuildProcessing();
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
ipcMain.handle("window.setMode", (event, request: SetWindowModeRequest) =>
  getWindowModeService().setMode(requireWindow(event.sender), request)
);
ipcMain.handle("window.setAlwaysOnTop", (event, request: SetAlwaysOnTopRequest) =>
  getWindowModeService().setAlwaysOnTop(requireWindow(event.sender), request)
);
ipcMain.handle("window.setSidebarOpen", (event, request: SetSidebarOpenRequest) =>
  getWindowModeService().setSidebarOpen(requireWindow(event.sender), request)
);
ipcMain.handle("agent.runtimeStatus", () => getAgentRuntimeService().runtimeStatus());
ipcMain.handle("agent.ask", (_event, request: HomeAgentAskRequest) => getHomeAgentService().ask(request));
ipcMain.handle("agent.conversation", (_event, request?: AgentConversationRequest) =>
  getHomeAgentService().conversation(request)
);
ipcMain.handle("agent.submitTurn", async (event, payload: {
  readonly request: AgentSubmitTurnRequest;
  readonly filePaths?: readonly string[];
}) => {
  const filePaths = payload.filePaths ?? [];
  if (filePaths.length > 1) {
    throw new PigeDomainError(
      "agent_runtime.multiple_sources_not_ready",
      "Submit one attachment per Agent turn in this runtime build."
    );
  }
  const request = AgentSubmitTurnRequestSchema.parse(payload.request);
  const normalizedRequest: AgentSubmitTurnRequest = {
    schemaVersion: 1,
    inputKind: request.inputKind,
    locale: request.locale,
    ...(request.text === undefined ? {} : { text: request.text }),
    ...(request.objective === undefined ? {} : { objective: request.objective }),
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
  try {
    if (filePaths.length === 0) {
      return await getHomeAgentService().submitTurn(normalizedRequest, draftContext);
    }
    if (request.inputKind !== "file_drop" && request.inputKind !== "file_picker") {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "An attached source requires a file-drop or file-picker Agent input kind."
      );
    }
    const home = getHomeAgentService();
    const prepared = home.prepareSourceTurn(normalizedRequest);
    try {
      const preserved = await getCaptureService().preserveFilesForAgentTurn({
        filePaths,
        inputKind: request.inputKind === "file_drop" ? "file_drop" : "file_picker",
        userIntent: request.objective === "capture" ? "capture" : "unknown",
        locale: request.locale
      }, {
        jobId: prepared.jobId,
        sourceId: prepared.sourceId
      });
      if (
        preserved.status === "rejected" ||
        preserved.sourceIds.length !== 1 ||
        preserved.sourceIds[0] !== prepared.sourceId
      ) {
        home.failPreparedSourceTurn(prepared);
        throw new PigeDomainError("capture.file_rejected", "The selected attachment could not be preserved safely.");
      }
      return await home.submitPreparedSourceTurn(prepared, draftContext);
    } catch (caught) {
      home.failPreparedSourceTurn(prepared);
      throw caught;
    }
  } finally {
    draftPublisher.close();
  }
});
ipcMain.handle("capture.submitText", (_event, request: SubmitTextCaptureRequest) => {
  const result = getCaptureService().submitText(request);
  scheduleCaptureProcessing();
  return result;
});
ipcMain.handle("capture.submitUrl", async (_event, request: SubmitUrlCaptureRequest) => {
  const result = await getCaptureService().submitUrl(request);
  scheduleCaptureProcessing();
  return result;
});
ipcMain.handle("capture.submitFiles", async (_event, request: SubmitFilesCaptureRequest) => {
  const result = await getCaptureService().submitFiles(request);
  scheduleCaptureProcessing();
  return result;
});
ipcMain.handle("jobs.list", (_event, request?: JobsListRequest) => getJobsService().list(request));
ipcMain.handle("jobs.cancel", (_event, request: JobActionRequest) => getJobsService().cancel(request));
ipcMain.handle("jobs.retry", async (_event, request: JobActionRequest) => {
  const result = getJobsService().retry(request);
  if (result.status === "requeued" && result.job?.class === "capture") {
    scheduleCaptureProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "parse") {
    scheduleParseProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "ocr") {
    scheduleOcrProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "agent_ingest") {
    scheduleAgentIngestProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "agent_turn") {
    scheduleAgentIngestProcessing();
    scheduleAgentTurnProcessing();
  }
  if (result.status === "requeued" && result.job?.class === "index_rebuild") {
    scheduleIndexRebuildProcessing();
  }
  return result;
});
ipcMain.handle("activity.list", (_event, request?: KnowledgeActivityListRequest) =>
  getKnowledgeActivityService().list(request)
);
ipcMain.handle("activity.undo", (_event, request: KnowledgeActivityUndoRequest) => {
  const result = getKnowledgeActivityService().undo(request);
  scheduleActivityIndexRebuild();
  return result;
});
ipcMain.handle("library.list", (_event, request?: LibraryListRequest) => getLibraryService().list(request));
ipcMain.handle("library.related", (_event, request: LibraryRelatedRequest) => getLibraryService().related(request));
ipcMain.handle("notes.get", (_event, request: NoteGetRequest) => getNotesService().get(request));
ipcMain.handle("notes.render", (_event, request: NoteRenderRequest) => getNotesService().render(request));
ipcMain.handle("proposals.list", (_event, request?: ProposalsListRequest) => getProposalService().list(request));
ipcMain.handle("proposals.get", (_event, request: ProposalGetRequest) => getProposalService().get(request));
ipcMain.handle("proposals.approve", (_event, request: ProposalDecisionRequest) =>
  getJobsService().approveProposal(getProposalService(), request)
);
ipcMain.handle("proposals.reject", (_event, request: ProposalDecisionRequest) =>
  getJobsService().rejectProposal(getProposalService(), request)
);
ipcMain.handle("retrieval.search", (_event, request: RetrievalSearchRequest) => getRetrievalService().search(request));
ipcMain.handle("retrieval.ask", (_event, request: RetrievalAskRequest) => getRetrievalService().ask(request));
ipcMain.handle("vault.current", () => getVaultService().current());
ipcMain.handle("vault.recent", () => getVaultService().recent());
ipcMain.handle("onboarding.status", () => getVaultService().onboardingStatus());
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
ipcMain.handle("vault.revealKnowledgeRoot", () => getVaultService().revealKnowledgeRoot());
ipcMain.handle("vault.revealSourceAssetRoot", () => getVaultService().revealSourceAssetRoot());
ipcMain.handle("vault.updateSourceStoragePolicy", (_event, request: UpdateSourceStoragePolicyRequest) =>
  getVaultService().updateSourceStoragePolicy(request)
);
ipcMain.handle("vault.removeRecent", (_event, vaultId: string) => getVaultService().removeRecent(vaultId));
ipcMain.handle("maintenance.rebuildLocalDatabase", () => getJobsService().requestIndexRebuild());
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
  if (!latestSupportBundlePreview || latestSupportBundlePreview.previewId !== request.previewId) {
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
  return getDiagnosticsService().exportSupportBundle(selection.filePath, latestSupportBundlePreview);
});
ipcMain.handle("models.summary", () => getModelProviderRegistry().summary());
ipcMain.handle("models.addPresetProvider", async (event, request: AddPresetProviderRequest) => {
  const parsedRequest = AddPresetProviderRequestSchema.parse(request);
  const validatedRequest: AddPresetProviderRequest = {
    presetId: parsedRequest.presetId,
    ...(parsedRequest.apiKey ? { apiKey: parsedRequest.apiKey } : {})
  };
  await confirmSettingAction(
    event.sender,
    validatedRequest.apiKey
      ? ["models.providerProfiles", "models.providerApiKeys"]
      : ["models.providerProfiles"],
    {
    title: "Connect this model service?",
    message: "Pige will test this exact reviewed service and may send selected context, including ordinary, private, and bounded large content, to this Provider Profile and endpoint for ongoing model calls. Sensitive content still asks each time; restricted content is never sent. If the endpoint or trust boundary changes or becomes unknown, Pige asks again. Credentials, when required, stay in protected local storage.",
    confirmLabel: "Connect service"
    }
  );
  return getModelProviderRegistry().addPresetProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.addManualProvider", async (event, request: AddManualProviderRequest) => {
  const validatedRequest = AddManualProviderRequestSchema.parse(request) as AddManualProviderRequest;
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Connect this model service?",
    message: "Pige will test this exact configured service and may send selected context, including ordinary, private, and bounded large content, to this Provider Profile and endpoint for ongoing model calls. Sensitive content still asks each time; restricted content is never sent. If the endpoint or trust boundary changes or becomes unknown, Pige asks again. The API key stays in protected local storage.",
    confirmLabel: "Connect service"
  });
  return getModelProviderRegistry().addManualProvider(validatedRequest).then((result) => {
    if (!isNeedsManualModelResult(result)) scheduleWaitingAgentIngestAfterModelReady();
    return result;
  });
});
ipcMain.handle("models.refreshProviderModels", async (_event, request: RefreshProviderModelsRequest) =>
  getModelProviderRegistry().refreshProviderModels(RefreshProviderModelsRequestSchema.parse(request))
);
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
ipcMain.handle("settings.appearance", () => getAppearanceService().summary());
ipcMain.handle("settings.setLocale", (_event, request: SetLocaleRequest) => getAppearanceService().setLocale(request));
ipcMain.handle("settings.registry", () => getSettingsRegistry());
ipcMain.handle("backup.status", () => getBackupRestoreService().status(getVaultService().current()));
ipcMain.handle("backup.create", async (event): Promise<BackupCreateResult> => {
  const activeVault = getVaultService().current();
  const activeVaultPath = getVaultService().activeVaultPath();
  if (!activeVault || !activeVaultPath) throw new Error("No active vault for backup creation.");
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for backup creation.");
  const selection = await dialog.showSaveDialog(parentWindow, {
    title: "Create Pige Backup",
    defaultPath: `${activeVault.name}-${new Date().toISOString().slice(0, 10)}.pige-backup.zip`,
    filters: [{ name: "Pige Backup", extensions: ["zip"] }]
  });
  if (selection.canceled || !selection.filePath) {
    return { status: "canceled" };
  }
  return getBackupRestoreService().createBackup(activeVaultPath, selection.filePath, app.getVersion());
});
ipcMain.handle("restore.preview", async (event): Promise<RestorePreviewResult> => {
  const senderId = event.sender.id;
  trackRestorePreviewSender(event.sender);
  const generation = restorePreviewRegistry.begin(senderId);
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    restorePreviewRegistry.cancel(senderId, generation);
    throw new Error("No active window for restore preview.");
  }
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose Pige Backup",
    properties: ["openFile"],
    filters: [{ name: "Pige Backup", extensions: ["zip"] }]
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    restorePreviewRegistry.cancel(senderId, generation);
    return { status: "canceled" };
  }
  try {
    const preview = await getBackupRestoreService().previewRestore(selection.filePaths[0]);
    if (preview.status !== "ready") {
      restorePreviewRegistry.cancel(senderId, generation);
      return preview;
    }
    const accepted = restorePreviewRegistry.complete(senderId, generation, {
      backupPath: preview.backupPath,
      archivePreviewToken: preview.previewToken
    });
    return { ...preview, previewToken: accepted.publicPreviewToken };
  } catch (caught) {
    restorePreviewRegistry.cancel(senderId, generation);
    throw caught;
  }
});
ipcMain.handle("restore.apply", async (event, request: RestoreApplyRequest): Promise<RestoreApplyResult> => {
  if (!request || typeof request.backupPath !== "string" || typeof request.previewToken !== "string") {
    throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
  }
  const senderId = event.sender.id;
  const acceptedPreview = restorePreviewRegistry.claim(senderId, request);
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    throw new Error("No active window for restore.");
  }
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose restore location",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  }).catch((caught) => {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    throw caught;
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    return { status: "canceled" };
  }
  if (!restorePreviewRegistry.isCurrent(senderId, acceptedPreview)) {
    throw new PigeDomainError("restore.backup_invalid", "The restore preview was superseded before apply.");
  }
  let result: RestoreApplyResult;
  try {
    result = await getBackupRestoreService().applyRestore(
      acceptedPreview.backupPath,
      selection.filePaths[0],
      acceptedPreview.archivePreviewToken
    );
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "restore.backup_invalid") {
      restorePreviewRegistry.consume(senderId, acceptedPreview);
    } else {
      restorePreviewRegistry.release(senderId, acceptedPreview);
    }
    throw caught;
  }
  if (result.status !== "restored" || !result.restoredVaultPath) {
    restorePreviewRegistry.release(senderId, acceptedPreview);
    return result;
  }
  restorePreviewRegistry.consume(senderId, acceptedPreview);
  const activated = getVaultService().openPath(result.restoredVaultPath);
  initializeActiveDatabase();
  const localDatabaseRebuild = getLocalDatabaseService().rebuild(result.restoredVaultPath);
  resumeBackgroundJobs();
  return {
    ...result,
    ...(activated.status === "completed" ? { vault: activated.vault } : {}),
    ...(localDatabaseRebuild ? { localDatabaseRebuild } : {})
  };
});
ipcMain.handle("system.toolchainHealth", () => getToolchainService().health());

app.whenReady().then(async () => {
  const packagedRuntimeSmokeReportPath = resolvePackagedRuntimeSmokeReportPath();
  if (packagedRuntimeSmokeReportPath) {
    try {
      const smoke = await import(pathToFileURL(join(__dirname, "pi-agent-runtime-smoke.js")).href);
      const pi = await smoke.runPiAgentRuntimeSmoke();
      const home = await smoke.runHomeAgentRuntimeSmoke();
      const runtimeIdentity = {
        appName: app.getName(),
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged
      };
      writeFileSync(packagedRuntimeSmokeReportPath, `${JSON.stringify({ runtimeIdentity, pi, home })}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      app.exit(0);
    } catch {
      app.exit(1);
    }
    return;
  }

  localSettingsStore = new LocalSettingsStore(app.getPath("userData"));
  appearanceService = new AppearanceService(getLocalSettingsStore(), app.getLocale());
  modelProviderRegistry = new ModelProviderRegistry(
    app.getPath("userData"),
    new JsonSecretStore(app.getPath("userData"), safeStorage)
  );
  vaultService = new VaultService(
    getLocalSettingsStore(),
    () => getModelProviderRegistry().hasDefaultRuntimeBinding()
  );
  windowModeService = new WindowModeService(getLocalSettingsStore());
  localDatabaseService = new LocalDatabaseService();
  backupRestoreService = new BackupRestoreService();
  agentRuntimeService = new AgentRuntimeService(
    getVaultService(),
    getModelProviderRegistry(),
    getLocalDatabaseService(),
    { snapshot: getAgentCapabilitySnapshot }
  );
  proposalService = new ProposalService(getVaultService());
  knowledgeActivityService = new KnowledgeActivityService(getVaultService());
  agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
    snapshot: getAgentCapabilitySnapshot
  }, undefined, undefined, createAgentIngestRetrievalPort(), createAgentIngestProposalPort());
  documentParserService = new DocumentParserService();
  datasetService = new DatasetService(new DatasetIngestWorkerService());
  ocrService = new OcrService();
  toolchainService = new ToolchainService(resolveToolchainManifestPath());
  captureService = new CaptureService(getVaultService());
  jobsService = new JobsService(
    getVaultService(),
    getAgentIngestService(),
    getLocalDatabaseService(),
    getDocumentParserService(),
    getOcrService(),
    getDatasetService()
  );
  initializeActiveDatabase();
  diagnosticsService = new DiagnosticsService(app.getPath("userData"));
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

function requireWindow(webContents: WebContents): BrowserWindow {
  const parentWindow = BrowserWindow.fromWebContents(webContents);
  if (!parentWindow) throw new Error("No active Pige window.");
  return parentWindow;
}

function resolveToolchainManifestPath(): string {
  const fallback = join(process.cwd(), "resources/toolchain-manifest/toolchain.manifest.json");
  const candidates = [
    join(process.resourcesPath, "toolchain-manifest/toolchain.manifest.json"),
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
