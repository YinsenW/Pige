import { app, BrowserWindow, dialog, ipcMain, safeStorage, type WebContents } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AddManualProviderRequest,
  AppHealth,
  BackupCreateResult,
  CreateVaultRequest,
  ExportSupportBundleRequest,
  JobActionRequest,
  JobsListRequest,
  LibraryListRequest,
  LibraryRelatedRequest,
  NoteGetRequest,
  NoteRenderRequest,
  ProposalDecisionRequest,
  ProposalGetRequest,
  ProposalsListRequest,
  RetrievalAskRequest,
  RetrievalSearchRequest,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestorePreviewResult,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  SetLocaleRequest,
  SetSidebarOpenRequest,
  SubmitFilesCaptureRequest,
  SubmitTextCaptureRequest,
  SubmitUrlCaptureRequest,
  SetWindowModeRequest,
  SupportBundlePreview,
  UpdateSourceStoragePolicyRequest
} from "@pige/contracts";
import { PRELOAD_ENTRY_FILENAME } from "../shared/preload-entry";
import {
  AgentIngestService,
  type AgentIngestCapabilitySnapshot
} from "./services/agent-ingest-service";
import { AgentRuntimeService } from "./services/agent-runtime-service";
import { AppearanceService } from "./services/appearance-service";
import { BackupRestoreService } from "./services/backup-service";
import { CoalescedBatchDrainer } from "./services/background-job-drainer";
import { CaptureService } from "./services/capture-service";
import { DiagnosticsService } from "./services/diagnostics-service";
import { DocumentParserService } from "./services/document-parser-service";
import {
  JobsService,
  type ProcessQueuedCapturesResult,
  type ProcessQueuedIndexRebuildResult,
  type ProcessQueuedOcrResult,
  type ProcessQueuedParsesResult
} from "./services/jobs-service";
import { LibraryService } from "./services/library-service";
import { LocalDatabaseRebuildWorkerService } from "./services/local-database-rebuild-worker-service";
import { LocalDatabaseService } from "./services/local-database-service";
import { LocalSettingsStore } from "./services/local-settings";
import { ModelProviderRegistry } from "./services/model-provider-registry";
import { NotesService } from "./services/notes-service";
import { OcrService } from "./services/ocr-service";
import { ProposalService } from "./services/proposal-service";
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
let appearanceService: AppearanceService | undefined;
let toolchainService: ToolchainService | undefined;
let captureService: CaptureService | undefined;
let jobsService: JobsService | undefined;
let libraryService: LibraryService | undefined;
let notesService: NotesService | undefined;
let proposalService: ProposalService | undefined;
let retrievalService: RetrievalService | undefined;
let documentParserService: DocumentParserService | undefined;
let ocrService: OcrService | undefined;
let latestSupportBundlePreview: SupportBundlePreview | undefined;
let latestRestorePreviewPath: string | undefined;

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
let captureDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
let parseDrainer: CoalescedBatchDrainer<ProcessQueuedParsesResult> | undefined;
let ocrDrainer: CoalescedBatchDrainer<ProcessQueuedOcrResult> | undefined;
let agentIngestDrainer: CoalescedBatchDrainer<ProcessQueuedCapturesResult> | undefined;
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
  mainWindows.add(browserWindow);
  browserWindow.once("closed", () => mainWindows.delete(browserWindow));

  getWindowModeService().applyStoredState(browserWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
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
      getOcrService()
    );
  }
  return jobsService;
};

const getDocumentParserService = (): DocumentParserService => {
  if (!documentParserService) documentParserService = new DocumentParserService();
  return documentParserService;
};

const getOcrService = (): OcrService => {
  if (!ocrService) ocrService = new OcrService();
  return ocrService;
};

const getAgentIngestService = (): AgentIngestService => {
  if (!agentIngestService) {
    agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
      snapshot: getAgentCapabilitySnapshot
    });
  }
  return agentIngestService;
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

const recordBackgroundFailure = (code: string, fallback: string): void => {
  getDiagnosticsService().recordEvent({
    level: "warning",
    code,
    message: fallback
  });
};

const resumeBackgroundJobs = (): void => {
  try {
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
    scheduleCaptureProcessing();
    scheduleParseProcessing();
    scheduleOcrProcessing();
    scheduleAgentIngestProcessing();
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
  } catch {
    getDiagnosticsService().recordEvent({
      level: "warning",
      code: "agent_ingest.requeue_failed",
      message: "Waiting Agent ingest requeue failed."
    });
  }
};

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
  if (result.status === "requeued" && result.job?.class === "index_rebuild") {
    scheduleIndexRebuildProcessing();
  }
  return result;
});
ipcMain.handle("library.list", (_event, request?: LibraryListRequest) => getLibraryService().list(request));
ipcMain.handle("library.related", (_event, request: LibraryRelatedRequest) => getLibraryService().related(request));
ipcMain.handle("notes.get", (_event, request: NoteGetRequest) => getNotesService().get(request));
ipcMain.handle("notes.render", (_event, request: NoteRenderRequest) => getNotesService().render(request));
ipcMain.handle("proposals.list", (_event, request?: ProposalsListRequest) => getProposalService().list(request));
ipcMain.handle("proposals.get", (_event, request: ProposalGetRequest) => getProposalService().get(request));
ipcMain.handle("proposals.approve", (_event, request: ProposalDecisionRequest) =>
  getProposalService().approve(request)
);
ipcMain.handle("proposals.reject", (_event, request: ProposalDecisionRequest) =>
  getProposalService().reject(request)
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
ipcMain.handle("models.addManualProvider", async (event, request: AddManualProviderRequest) => {
  await confirmSettingAction(event.sender, ["models.providerProfiles", "models.providerApiKeys"], {
    title: "Connect this model service?",
    message: "Pige will contact the configured model service to test the connection and store the API key in the protected local secret store.",
    confirmLabel: "Connect service"
  });
  return getModelProviderRegistry().addManualProvider(request).then((summary) => {
    scheduleWaitingAgentIngestAfterModelReady();
    return summary;
  });
});
ipcMain.handle("models.setDefaultModel", (_event, request: SetDefaultModelRequest) =>
  {
    const summary = getModelProviderRegistry().setDefaultModel(request);
    scheduleWaitingAgentIngestAfterModelReady();
    return summary;
  }
);
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
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for restore preview.");
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose Pige Backup",
    properties: ["openFile"],
    filters: [{ name: "Pige Backup", extensions: ["zip"] }]
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    latestRestorePreviewPath = undefined;
    return { status: "canceled" };
  }
  const preview = await getBackupRestoreService().previewRestore(selection.filePaths[0]);
  latestRestorePreviewPath = preview.status === "ready" ? preview.backupPath : undefined;
  return preview;
});
ipcMain.handle("restore.apply", async (event, request: RestoreApplyRequest): Promise<RestoreApplyResult> => {
  if (!latestRestorePreviewPath || request.backupPath !== latestRestorePreviewPath) {
    throw new Error("Create a current restore preview before applying restore.");
  }
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) throw new Error("No active window for restore.");
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose restore location",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  if (selection.canceled || selection.filePaths.length === 0 || !selection.filePaths[0]) {
    return { status: "canceled" };
  }
  const result = await getBackupRestoreService().applyRestore(request.backupPath, selection.filePaths[0]);
  if (result.status !== "restored" || !result.restoredVaultPath) return result;
  latestRestorePreviewPath = undefined;
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

app.whenReady().then(() => {
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
  agentIngestService = new AgentIngestService(getModelProviderRegistry(), undefined, {
    snapshot: getAgentCapabilitySnapshot
  });
  documentParserService = new DocumentParserService();
  ocrService = new OcrService();
  toolchainService = new ToolchainService(resolveToolchainManifestPath());
  captureService = new CaptureService(getVaultService());
  jobsService = new JobsService(
    getVaultService(),
    getAgentIngestService(),
    getLocalDatabaseService(),
    getDocumentParserService(),
    getOcrService()
  );
  proposalService = new ProposalService(getVaultService());
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
    fallback,
    join(app.getAppPath(), "resources/toolchain-manifest/toolchain.manifest.json"),
    join(app.getAppPath(), "../../resources/toolchain-manifest/toolchain.manifest.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}
