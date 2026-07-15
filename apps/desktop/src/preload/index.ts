import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentConversationRequest,
  AgentConversationTimeline,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  AgentTurnDraftEvent,
  AgentRuntimeStatus,
  AppHealth,
  BackupManifestSummary,
  BackupCreateResult,
  AppearanceSettingsSummary,
  BackupRestoreStatus,
  CreateVaultRequest,
  DiagnosticsHealth,
  ExportSupportBundleRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  HomeAgentAskRequest,
  HomeAgentAskResult,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  JobsListResult,
  KnowledgeActivityListRequest,
  KnowledgeActivityListResult,
  KnowledgeActivityUndoRequest,
  KnowledgeActivityUndoResult,
  KnowledgeTreeResult,
  LibraryListRequest,
  LibraryListResult,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  LocalDatabaseRebuildResult,
  LocalDatabaseStatus,
  ModelEgressPendingRequest,
  ModelEgressPendingRequestQuery,
  ModelEgressResolveRequest,
  ModelEgressResolveResult,
  PermissionPendingRequest,
  PermissionPendingRequestQuery,
  PermissionResolveRequest,
  PermissionResolveResult,
  LocalDatabaseResetResult,
  ModelProviderSettingsSummary,
  ProviderConnectResult,
  NoteDocument,
  NoteGetRequest,
  NoteRenderRequest,
  NoteRenderResult,
  OnboardingStatus,
  PigeDesktopApi,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  ProposalGetRequest,
  ProposalGetResult,
  ProposalsListRequest,
  ProposalsListResult,
  RecentVaultSummary,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestoreMode,
  RestorePreviewWarning,
  RestorePreviewResult,
  RefreshProviderModelsRequest,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  UpdateModelRequest,
  SetLocaleRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  SettingsRegistrySummary,
  SupportBundleExportResult,
  SupportBundlePreview,
  ToolchainHealth,
  UpdateSourceStoragePolicyRequest,
  WindowState,
  VaultActionResult,
  VaultSummary
} from "@pige/contracts";

function isRestoreMode(value: unknown): value is RestoreMode {
  return value === "clone_as_new" || value === "replace_existing";
}

function projectBackupManifestSummary(manifest: BackupManifestSummary): BackupManifestSummary {
  return {
    formatVersion: manifest.formatVersion,
    format: manifest.format,
    appVersion: manifest.appVersion,
    vaultId: manifest.vaultId,
    vaultName: manifest.vaultName,
    vaultSchemaVersion: manifest.vaultSchemaVersion,
    createdAt: manifest.createdAt,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    noteCount: manifest.noteCount,
    sourceCount: manifest.sourceCount,
    conversationCount: manifest.conversationCount,
    memoryCount: manifest.memoryCount,
    includesSecrets: false,
    includes: {
      markdownKnowledge: manifest.includes.markdownKnowledge,
      sourceRecords: manifest.includes.sourceRecords,
      managedSourceCopies: manifest.includes.managedSourceCopies,
      conversations: manifest.includes.conversations,
      vaultMemory: manifest.includes.vaultMemory,
      trash: manifest.includes.trash,
      rebuildableDatabaseCache: manifest.includes.rebuildableDatabaseCache,
      secrets: false
    }
  };
}

function projectRestoreWarning(warning: RestorePreviewWarning): RestorePreviewWarning {
  if (
    !Number.isSafeInteger(warning.count) ||
    warning.count < 1 ||
    warning.count > 100_000 ||
    ![
      "invalid_archive_entries",
      "excluded_rebuildable_roots",
      "external_originals_not_included"
    ].includes(warning.code)
  ) {
    throw new Error("Invalid restore preview warning response.");
  }
  return { code: warning.code, count: warning.count };
}

function projectRestorePreviewResult(result: RestorePreviewResult): RestorePreviewResult {
  if (result.status === "canceled") return { status: "canceled" };
  const permittedModes = result.permittedModes.filter(isRestoreMode);
  if (!isRestoreMode(result.defaultMode) || !permittedModes.includes(result.defaultMode)) {
    throw new Error("Invalid restore preview response.");
  }
  return {
    status: "ready",
    previewId: result.previewId,
    manifest: projectBackupManifestSummary(result.manifest),
    invalidFileCount: result.invalidFileCount,
    warnings: result.warnings.map(projectRestoreWarning),
    permittedModes,
    defaultMode: result.defaultMode
  };
}

function projectRestoreApplyResult(result: RestoreApplyResult): RestoreApplyResult {
  if (result.status === "canceled") return { status: "canceled" };
  if (typeof result.jobId !== "string" || result.jobId.length < 1 || result.jobId.length > 160) {
    throw new Error("Invalid restore apply response.");
  }
  return { status: "restored", jobId: result.jobId };
}

const api: PigeDesktopApi = {
  getHealth: async (): Promise<AppHealth> => ipcRenderer.invoke("pige:getHealth") as Promise<AppHealth>,
  window: {
    current: async (): Promise<WindowState> => ipcRenderer.invoke("window.current") as Promise<WindowState>,
    setMode: async (request: SetWindowModeRequest): Promise<WindowState> =>
      ipcRenderer.invoke("window.setMode", request) as Promise<WindowState>,
    setAlwaysOnTop: async (request: SetAlwaysOnTopRequest): Promise<WindowState> =>
      ipcRenderer.invoke("window.setAlwaysOnTop", request) as Promise<WindowState>,
    setSidebarOpen: async (request: SetSidebarOpenRequest): Promise<WindowState> =>
      ipcRenderer.invoke("window.setSidebarOpen", request) as Promise<WindowState>
  },
  agent: {
    runtimeStatus: async (): Promise<AgentRuntimeStatus> =>
      ipcRenderer.invoke("agent.runtimeStatus") as Promise<AgentRuntimeStatus>,
    ask: async (request: HomeAgentAskRequest): Promise<HomeAgentAskResult> =>
      ipcRenderer.invoke("agent.ask", request) as Promise<HomeAgentAskResult>,
    conversation: async (
      request?: AgentConversationRequest
    ): Promise<AgentConversationTimeline | undefined> =>
      ipcRenderer.invoke("agent.conversation", request) as Promise<AgentConversationTimeline | undefined>,
    submitTurn: async (
      request: AgentSubmitTurnRequest,
      files: readonly File[] = []
    ): Promise<AgentSubmitTurnResult> => {
      const filePaths = files
        .map((file) => webUtils.getPathForFile(file))
        .filter((filePath): filePath is string => filePath.length > 0);
      return ipcRenderer.invoke("agent.submitTurn", { request, filePaths }) as Promise<AgentSubmitTurnResult>;
    },
    onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void): (() => void) => {
      const handleDraft = (_event: IpcRendererEvent, draft: AgentTurnDraftEvent): void => listener(draft);
      ipcRenderer.on("agent.turnDraft", handleDraft);
      return () => ipcRenderer.removeListener("agent.turnDraft", handleDraft);
    }
  },
  jobs: {
    list: async (request?: JobsListRequest): Promise<JobsListResult> =>
      ipcRenderer.invoke("jobs.list", request) as Promise<JobsListResult>,
    cancel: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.cancel", request) as Promise<JobActionResult>,
    retry: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.retry", request) as Promise<JobActionResult>
  },
  modelEgress: {
    pending: async (request: ModelEgressPendingRequestQuery): Promise<ModelEgressPendingRequest | undefined> =>
      ipcRenderer.invoke("modelEgress.pending", request) as Promise<ModelEgressPendingRequest | undefined>,
    resolve: async (request: ModelEgressResolveRequest): Promise<ModelEgressResolveResult> =>
      ipcRenderer.invoke("modelEgress.resolve", request) as Promise<ModelEgressResolveResult>
  },
  permissions: {
    pending: async (request: PermissionPendingRequestQuery): Promise<PermissionPendingRequest | undefined> =>
      ipcRenderer.invoke("permissions.pending", request) as Promise<PermissionPendingRequest | undefined>,
    resolve: async (request: PermissionResolveRequest): Promise<PermissionResolveResult> =>
      ipcRenderer.invoke("permissions.resolve", request) as Promise<PermissionResolveResult>
  },
  activity: {
    list: async (request?: KnowledgeActivityListRequest): Promise<KnowledgeActivityListResult> =>
      ipcRenderer.invoke("activity.list", request) as Promise<KnowledgeActivityListResult>,
    undo: async (request: KnowledgeActivityUndoRequest): Promise<KnowledgeActivityUndoResult> =>
      ipcRenderer.invoke("activity.undo", request) as Promise<KnowledgeActivityUndoResult>
  },
  proposals: {
    list: async (request?: ProposalsListRequest): Promise<ProposalsListResult> =>
      ipcRenderer.invoke("proposals.list", request) as Promise<ProposalsListResult>,
    get: async (request: ProposalGetRequest): Promise<ProposalGetResult> =>
      ipcRenderer.invoke("proposals.get", request) as Promise<ProposalGetResult>,
    approve: async (request: ProposalDecisionRequest): Promise<ProposalDecisionResult> =>
      ipcRenderer.invoke("proposals.approve", request) as Promise<ProposalDecisionResult>,
    reject: async (request: ProposalDecisionRequest): Promise<ProposalDecisionResult> =>
      ipcRenderer.invoke("proposals.reject", request) as Promise<ProposalDecisionResult>
  },
  library: {
    list: async (request?: LibraryListRequest): Promise<LibraryListResult> =>
      ipcRenderer.invoke("library.list", request) as Promise<LibraryListResult>,
    tree: async (): Promise<KnowledgeTreeResult> =>
      ipcRenderer.invoke("library.tree") as Promise<KnowledgeTreeResult>,
    related: async (request: LibraryRelatedRequest): Promise<LibraryRelatedResult> =>
      ipcRenderer.invoke("library.related", request) as Promise<LibraryRelatedResult>
  },
  notes: {
    get: async (request: NoteGetRequest): Promise<NoteDocument> =>
      ipcRenderer.invoke("notes.get", request) as Promise<NoteDocument>,
    render: async (request: NoteRenderRequest): Promise<NoteRenderResult> =>
      ipcRenderer.invoke("notes.render", request) as Promise<NoteRenderResult>
  },
  retrieval: {
    search: async (request: RetrievalSearchRequest): Promise<RetrievalSearchResult> =>
      ipcRenderer.invoke("retrieval.search", request) as Promise<RetrievalSearchResult>
  },
  vault: {
    current: async (): Promise<VaultSummary | undefined> =>
      ipcRenderer.invoke("vault.current") as Promise<VaultSummary | undefined>,
    recent: async (): Promise<readonly RecentVaultSummary[]> =>
      ipcRenderer.invoke("vault.recent") as Promise<readonly RecentVaultSummary[]>,
    onboardingStatus: async (): Promise<OnboardingStatus> =>
      ipcRenderer.invoke("onboarding.status") as Promise<OnboardingStatus>,
    dismissFirstHomeGuide: async (): Promise<OnboardingStatus> =>
      ipcRenderer.invoke("onboarding.dismissFirstHome") as Promise<OnboardingStatus>,
    create: async (request: CreateVaultRequest): Promise<VaultActionResult> =>
      ipcRenderer.invoke("vault.create", request) as Promise<VaultActionResult>,
    open: async (): Promise<VaultActionResult> => ipcRenderer.invoke("vault.open") as Promise<VaultActionResult>,
    revealKnowledgeRoot: async (): Promise<void> => ipcRenderer.invoke("vault.revealKnowledgeRoot") as Promise<void>,
    revealSourceAssetRoot: async (): Promise<void> =>
      ipcRenderer.invoke("vault.revealSourceAssetRoot") as Promise<void>,
    updateSourceStoragePolicy: async (request: UpdateSourceStoragePolicyRequest): Promise<VaultSummary> =>
      ipcRenderer.invoke("vault.updateSourceStoragePolicy", request) as Promise<VaultSummary>,
    removeRecent: async (vaultId: string): Promise<readonly RecentVaultSummary[]> =>
      ipcRenderer.invoke("vault.removeRecent", vaultId) as Promise<readonly RecentVaultSummary[]>
  },
  maintenance: {
    rebuildLocalDatabase: async (): Promise<LocalDatabaseRebuildResult> =>
      ipcRenderer.invoke("maintenance.rebuildLocalDatabase") as Promise<LocalDatabaseRebuildResult>,
    resetLocalDatabase: async (): Promise<LocalDatabaseResetResult> =>
      ipcRenderer.invoke("maintenance.resetLocalDatabase") as Promise<LocalDatabaseResetResult>,
    localDatabaseStatus: async (): Promise<LocalDatabaseStatus> =>
      ipcRenderer.invoke("maintenance.localDatabaseStatus") as Promise<LocalDatabaseStatus>
  },
  diagnostics: {
    health: async (): Promise<DiagnosticsHealth> =>
      ipcRenderer.invoke("diagnostics.health") as Promise<DiagnosticsHealth>,
    previewSupportBundle: async (): Promise<SupportBundlePreview> =>
      ipcRenderer.invoke("diagnostics.previewSupportBundle") as Promise<SupportBundlePreview>,
    exportSupportBundle: async (request: ExportSupportBundleRequest): Promise<SupportBundleExportResult> =>
      ipcRenderer.invoke("diagnostics.exportSupportBundle", request) as Promise<SupportBundleExportResult>,
    cancelSupportBundleExport: async (
      request: CancelSupportBundleExportRequest
    ): Promise<CancelSupportBundleExportResult> =>
      ipcRenderer.invoke("diagnostics.cancelSupportBundleExport", request) as Promise<CancelSupportBundleExportResult>
  },
  models: {
    summary: async (): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.summary") as Promise<ModelProviderSettingsSummary>,
    addPresetProvider: async (request: AddPresetProviderRequest): Promise<ProviderConnectResult> =>
      ipcRenderer.invoke("models.addPresetProvider", request) as Promise<ProviderConnectResult>,
    addManualProvider: async (request: AddManualProviderRequest): Promise<ProviderConnectResult> =>
      ipcRenderer.invoke("models.addManualProvider", request) as Promise<ProviderConnectResult>,
    refreshProviderModels: async (request: RefreshProviderModelsRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.refreshProviderModels", request) as Promise<ModelProviderSettingsSummary>,
    addManualModel: async (request: AddManualModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.addManualModel", request) as Promise<ModelProviderSettingsSummary>,
    updateModel: async (request: UpdateModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.updateModel", request) as Promise<ModelProviderSettingsSummary>,
    setDefaultModel: async (request: SetDefaultModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.setDefaultModel", request) as Promise<ModelProviderSettingsSummary>
  },
  settings: {
    appearance: async (): Promise<AppearanceSettingsSummary> =>
      ipcRenderer.invoke("settings.appearance") as Promise<AppearanceSettingsSummary>,
    setLocale: async (request: SetLocaleRequest): Promise<AppearanceSettingsSummary> =>
      ipcRenderer.invoke("settings.setLocale", request) as Promise<AppearanceSettingsSummary>,
    registry: async (): Promise<SettingsRegistrySummary> =>
      ipcRenderer.invoke("settings.registry") as Promise<SettingsRegistrySummary>
  },
  backup: {
    status: async (): Promise<BackupRestoreStatus> =>
      ipcRenderer.invoke("backup.status") as Promise<BackupRestoreStatus>,
    create: async (): Promise<BackupCreateResult> =>
      ipcRenderer.invoke("backup.create") as Promise<BackupCreateResult>,
    previewRestore: async (): Promise<RestorePreviewResult> => {
      const result = await ipcRenderer.invoke("restore.preview") as RestorePreviewResult;
      return projectRestorePreviewResult(result);
    },
    applyRestore: async (request: RestoreApplyRequest): Promise<RestoreApplyResult> => {
      if (!isRestoreMode(request.mode)) throw new Error("Invalid restore mode.");
      const result = await ipcRenderer.invoke("restore.apply", {
        previewId: request.previewId,
        mode: request.mode
      }) as RestoreApplyResult;
      return projectRestoreApplyResult(result);
    }
  },
  system: {
    toolchainHealth: async (): Promise<ToolchainHealth> =>
      ipcRenderer.invoke("system.toolchainHealth") as Promise<ToolchainHealth>
  }
};

contextBridge.exposeInMainWorld("pige", api);
