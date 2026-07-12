import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  AgentRuntimeStatus,
  AppHealth,
  BackupCreateResult,
  AppearanceSettingsSummary,
  BackupRestoreStatus,
  CreateVaultRequest,
  DiagnosticsHealth,
  ExportSupportBundleRequest,
  HomeAgentAskRequest,
  HomeAgentAskResult,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  JobsListResult,
  LibraryListRequest,
  LibraryListResult,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  LocalDatabaseRebuildResult,
  LocalDatabaseStatus,
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
    submitTurn: async (
      request: AgentSubmitTurnRequest,
      files: readonly File[] = []
    ): Promise<AgentSubmitTurnResult> => {
      const filePaths = files
        .map((file) => webUtils.getPathForFile(file))
        .filter((filePath): filePath is string => filePath.length > 0);
      return ipcRenderer.invoke("agent.submitTurn", { request, filePaths }) as Promise<AgentSubmitTurnResult>;
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
      ipcRenderer.invoke("diagnostics.exportSupportBundle", request) as Promise<SupportBundleExportResult>
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
    previewRestore: async (): Promise<RestorePreviewResult> =>
      ipcRenderer.invoke("restore.preview") as Promise<RestorePreviewResult>,
    applyRestore: async (request: RestoreApplyRequest): Promise<RestoreApplyResult> =>
      ipcRenderer.invoke("restore.apply", request) as Promise<RestoreApplyResult>
  },
  system: {
    toolchainHealth: async (): Promise<ToolchainHealth> =>
      ipcRenderer.invoke("system.toolchainHealth") as Promise<ToolchainHealth>
  }
};

contextBridge.exposeInMainWorld("pige", api);
