import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentConversationRequest,
  AgentConversationResult,
  AgentSubmitTurnRequest,
  AgentSubmitTurnIpcResult,
  AgentTurnDraftEvent,
  AgentRuntimeStatus,
  CurrentNoteAppendProposalDecisionRequest,
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalGetRequest,
  CurrentNoteAppendProposalGetResult,
  AppHealth,
  BackupManifestSummary,
  BackupCreateResult,
  BackupReconnectDependencyRequest,
  BackupReconnectDependencyResult,
  AppearanceSettingsSummary,
  AppearanceThemeMutationResult,
  BackupRestoreStatus,
  CreateVaultRequest,
  DiagnosticsHealth,
  ExportSupportBundleRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  JobActionRequest,
  JobActionResult,
  JobsListRequest,
  JobsListResult,
  KnowledgeActivityListRequest,
  KnowledgeActivityListResult,
  KnowledgeActivityUndoRequest,
  KnowledgeActivityUndoResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeTreeResult,
  LibraryListRequest,
  LibraryListResult,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  LocalSemanticRetrievalDisableRequest,
  LocalSemanticRetrievalDisableResult,
  LocalSemanticRetrievalEnableRequest,
  LocalSemanticRetrievalEnableResult,
  LocalSemanticRetrievalInstallRequest,
  LocalSemanticRetrievalInstallResult,
  LocalSemanticRetrievalRemoveRequest,
  LocalSemanticRetrievalRemoveResult,
  LocalSemanticRetrievalStatus,
  LocalSemanticRetrievalStatusRequest,
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrSummary,
  PaddleOcrSummaryRequest,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  LocalDatabaseRebuildResult,
  LocalDatabaseStatus,
  LocalDatabaseResetResult,
  ModelProviderSettingsSummary,
  ProviderConnectResult,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteDocument,
  NoteGetRequest,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  NoteRenderRequest,
  NoteRenderResult,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  OnboardingStatus,
  OpenRecentVaultRequest,
  PigeDesktopApi,
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageCatalogQueryRequest,
  PiPackageCatalogQueryResult,
  PiPackageRegistryQueryResult,
  PiPackageRollbackRequest,
  PiPackageRollbackResult,
  PiPackageSetPinnedRequest,
  PiPackageSetPinnedResult,
  PiPackageUninstallRequest,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateResult,
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
  UpdateProviderCredentialRequest,
  DeleteProviderRequest,
  SetAlwaysOnTopRequest,
  SetDefaultModelRequest,
  UpdateModelRequest,
  SetLocaleRequest,
  SetThemeRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  SettingsRegistrySummary,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechCancelRequest,
  SpeechCancelResult,
  SpeechOpenSystemSettingsResult,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  TaskInteractionChangedEvent,
  TaskInteractionOpenRequest,
  TaskInteractionOpenResult,
  TaskInteractionPendingResult,
  SkillDiscardStagedRequest,
  SkillDiscardStagedResult,
  SkillDisableRequest,
  SkillEnableRequest,
  SkillExportRequest,
  SkillExportResult,
  SkillInstallStagedRequest,
  SkillInstallStagedResult,
  SkillLifecycleMutationResult,
  SkillStageFromUrlRequest,
  SkillStageFromUrlResult,
  SkillStageFromMarkdownRequest,
  SkillStageFromMarkdownResult,
  SkillStageFromZipRequest,
  SkillStageFromZipResult,
  SkillStageUpdateRequest,
  SkillStageUpdateResult,
  SkillUninstallRequest,
  MemoryDeleteRequest,
  MemoryDisableRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryResetRequest,
  MemorySummary,
  SkillRegistryMutationResult,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SupportBundleExportResult,
  SupportBundlePreview,
  ToolchainHealth,
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateStatusEvent,
  UpdateSummary,
  UpdateSourceStoragePolicyRequest,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState,
  VaultActionResult,
  VaultRevealResult,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import {
  AgentConversationRequestSchema,
  AgentConversationResultSchema,
  AgentSubmitTurnIpcPayloadSchema,
  AgentSubmitTurnIpcResultSchema,
  CurrentNoteAppendProposalDecisionRequestSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  CurrentNoteAppendProposalGetRequestSchema,
  CurrentNoteAppendProposalGetResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  KnowledgeActivityListRequestSchema,
  KnowledgeActivityListResultSchema,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
  HighRiskConfirmationChangedEventSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationResolveResultSchema,
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageCatalogQueryRequestSchema,
  PiPackageCatalogQueryResultSchema,
  PiPackageRegistryQueryResultSchema,
  PiPackageRollbackRequestSchema,
  PiPackageRollbackResultSchema,
  PiPackageSetPinnedRequestSchema,
  PiPackageSetPinnedResultSchema,
  PiPackageUninstallRequestSchema,
  PiPackageUninstallResultSchema,
  PiPackageUpdateRequestSchema,
  PiPackageUpdateResultSchema,
  LocalSemanticRetrievalDisableRequestSchema,
  LocalSemanticRetrievalDisableResultSchema,
  LocalSemanticRetrievalEnableRequestSchema,
  LocalSemanticRetrievalEnableResultSchema,
  LocalSemanticRetrievalInstallRequestSchema,
  LocalSemanticRetrievalInstallResultSchema,
  LocalSemanticRetrievalRemoveRequestSchema,
  LocalSemanticRetrievalRemoveResultSchema,
  LocalSemanticRetrievalStatusRequestSchema,
  LocalSemanticRetrievalStatusSchema,
  PaddleOcrDisableRequestSchema,
  PaddleOcrDisableResultSchema,
  PaddleOcrEnableRequestSchema,
  PaddleOcrEnableResultSchema,
  PaddleOcrInstallRequestSchema,
  PaddleOcrInstallResultSchema,
  PaddleOcrRemoveRequestSchema,
  PaddleOcrRemoveResultSchema,
  PaddleOcrSummaryRequestSchema,
  PaddleOcrSummarySchema,
  PaddleOcrTestRequestSchema,
  PaddleOcrTestResultSchema,
  RetrievalSearchRequestSchema,
  RetrievalSearchResultSchema,
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionLinkRequestSchema,
  ReaderSelectionLinkResultSchema,
  ReaderSelectionProposalDecisionRequestSchema,
  ReaderSelectionProposalDecisionResultSchema,
  ReaderSelectionProposalGetRequestSchema,
  ReaderSelectionProposalGetResultSchema,
  ReaderSelectionTransformRequestSchema,
  ReaderSelectionTransformResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  OpenRecentVaultRequestSchema,
  SpeechAvailabilityRequestSchema,
  SpeechAvailabilityResultSchema,
  SpeechAssetInstallEventSchema,
  SpeechAssetInstallRequestSchema,
  SpeechAssetInstallResultSchema,
  SpeechCancelRequestSchema,
  SpeechCancelResultSchema,
  SpeechOpenSystemSettingsResultSchema,
  SpeechSessionEventSchema,
  SpeechSessionRequestSchema,
  SpeechStartRequestSchema,
  SpeechStartResultSchema,
  SpeechStopResultSchema,
  TaskInteractionChangedEventSchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema,
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
  UpdateStatusEventSchema,
  UpdateSummarySchema,
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillDisableRequestSchema,
  SkillEnableRequestSchema,
  SkillExportRequestSchema,
  SkillExportResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillLifecycleMutationResultSchema,
  SkillRegistryMutationResultSchema,
  MemoryDeleteRequestSchema,
  MemoryDisableRequestSchema,
  MemoryEditRequestSchema,
  MemoryEnableRequestSchema,
  MemoryExportRequestSchema,
  MemoryExportResultSchema,
  MemoryLifecycleMutationResultSchema,
  MemoryListRequestSchema,
  MemoryMutationResultSchema,
  MemoryResetRequestSchema,
  MemorySummarySchema,
  SkillRegistryQueryResultSchema,
  SkillRegistrySummarySchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageFromZipRequestSchema,
  SkillStageFromZipResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillUninstallRequestSchema,
  SetLocaleRequestSchema,
  SetThemeRequestSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema,
  VaultActionResultSchema
} from "@pige/schemas";
import type {
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionOpenRequest,
  CollectionOpenResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionRenameColumnRequest,
  CollectionRenameColumnResult,
  CollectionTrashColumnRequest,
  CollectionTrashColumnResult,
  CollectionTrashRowRequest,
  CollectionTrashRowResult
} from "@pige/schemas";
function isRestoreMode(value: unknown): value is RestoreMode {
  return value === "clone_as_new" || value === "replace_existing";
}

async function invokeRetrievalSearch(request: RetrievalSearchRequest): Promise<RetrievalSearchResult> {
  const parsedRequest = RetrievalSearchRequestSchema.safeParse(request);
  if (!parsedRequest.success) throw new Error("Invalid local search request.");

  const response: unknown = await ipcRenderer.invoke("retrieval.search", parsedRequest.data);
  const parsedResponse = RetrievalSearchResultSchema.safeParse(response);
  if (
    !parsedResponse.success ||
    parsedResponse.data.activeVaultId !== parsedRequest.data.scope.vaultId ||
    parsedResponse.data.query !== parsedRequest.data.query
  ) {
    throw new Error("Invalid local search response.");
  }
  return parsedResponse.data;
}

async function invokeKnowledgeActivityList(
  request?: KnowledgeActivityListRequest
): Promise<KnowledgeActivityListResult> {
  const parsedRequest = KnowledgeActivityListRequestSchema.parse(request ?? {});
  const parsed = KnowledgeActivityListResultSchema.parse(await ipcRenderer.invoke(
    "activity.list",
    parsedRequest.limit === undefined ? {} : { limit: parsedRequest.limit }
  ));
  return {
    scannedAt: parsed.scannedAt,
    activeVaultId: parsed.activeVaultId,
    total: parsed.total,
    invalidOperationCount: parsed.invalidOperationCount,
    activities: parsed.activities.map((activity) => ({
      operationId: activity.operationId,
      kind: activity.kind,
      createdAt: activity.createdAt,
      ...(activity.targetLabel === undefined ? {} : { targetLabel: activity.targetLabel }),
      ...(activity.target === undefined ? {} : { target: activity.target }),
      status: activity.status,
      canUndo: activity.canUndo,
      ...(activity.undoUnavailableReason === undefined
        ? {}
        : { undoUnavailableReason: activity.undoUnavailableReason })
    }))
  };
}

async function invokeCollectionOpen(request: CollectionOpenRequest): Promise<CollectionOpenResult> {
  const parsedRequest = CollectionOpenRequestSchema.parse(request);
  const result = CollectionOpenResultSchema.parse(
    await ipcRenderer.invoke("collections.open", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId
  ) {
    throw new Error("Invalid Managed Collection open response identity.");
  }
  if (
    result.status === "ready" &&
    result.snapshot.activeViewId !== parsedRequest.viewId
  ) {
    throw new Error("Invalid Managed Collection open response view identity.");
  }
  return result;
}

async function invokeCollectionCellEdit(
  request: CollectionCellEditRequest
): Promise<CollectionCellEditResult> {
  const parsedRequest = CollectionCellEditRequestSchema.parse(request);
  const result = CollectionCellEditResultSchema.parse(
    await ipcRenderer.invoke("collections.editCell", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.rowId !== parsedRequest.rowId ||
    result.columnId !== parsedRequest.columnId
  ) {
    throw new Error("Invalid Managed Collection edit response identity.");
  }
  return result;
}

async function invokeCollectionAppendDefaultRow(
  request: CollectionAppendDefaultRowRequest
): Promise<CollectionAppendDefaultRowResult> {
  const parsedRequest = CollectionAppendDefaultRowRequestSchema.parse(request);
  const result = CollectionAppendDefaultRowResultSchema.parse(
    await ipcRenderer.invoke("collections.appendDefaultRow", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId
  ) {
    throw new Error("Invalid Managed Collection default-row append response identity.");
  }
  return result;
}

async function invokeCollectionAddNullableColumn(
  request: CollectionAddNullableColumnRequest
): Promise<CollectionAddNullableColumnResult> {
  const parsedRequest = CollectionAddNullableColumnRequestSchema.parse(request);
  const result = CollectionAddNullableColumnResultSchema.parse(
    await ipcRenderer.invoke("collections.addNullableColumn", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId
  ) {
    throw new Error("Invalid Managed Collection nullable-column response identity.");
  }
  return result;
}

async function invokeCollectionRenameColumn(
  request: CollectionRenameColumnRequest
): Promise<CollectionRenameColumnResult> {
  const parsedRequest = CollectionRenameColumnRequestSchema.parse(request);
  const result = CollectionRenameColumnResultSchema.parse(
    await ipcRenderer.invoke("collections.renameColumn", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.columnId !== parsedRequest.columnId
  ) {
    throw new Error("Invalid Managed Collection column-rename response identity.");
  }
  return result;
}

async function invokeCollectionTrashColumn(
  request: CollectionTrashColumnRequest
): Promise<CollectionTrashColumnResult> {
  const parsedRequest = CollectionTrashColumnRequestSchema.parse(request);
  const result = CollectionTrashColumnResultSchema.parse(
    await ipcRenderer.invoke("collections.trashColumn", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.columnId !== parsedRequest.columnId
  ) {
    throw new Error("Invalid Managed Collection column-trash response identity.");
  }
  return result;
}

async function invokeCollectionCreateView(
  request: CollectionCreateViewRequest
): Promise<CollectionCreateViewResult> {
  const parsedRequest = CollectionCreateViewRequestSchema.parse(request);
  const result = CollectionCreateViewResultSchema.parse(
    await ipcRenderer.invoke("collections.createView", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId
  ) {
    throw new Error("Invalid Managed Collection view-creation response identity.");
  }
  return result;
}

async function invokeCollectionTrashRow(
  request: CollectionTrashRowRequest
): Promise<CollectionTrashRowResult> {
  const parsedRequest = CollectionTrashRowRequestSchema.parse(request);
  const result = CollectionTrashRowResultSchema.parse(
    await ipcRenderer.invoke("collections.trashRow", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.rowId !== parsedRequest.rowId
  ) {
    throw new Error("Invalid Managed Collection row-trash response identity.");
  }
  return result;
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

function projectVaultActionResult(value: unknown): VaultActionResult {
  const parsed = VaultActionResultSchema.parse(value);
  if (parsed.status === "canceled") return { status: "canceled" };

  const projectSummary = (vault: typeof parsed.vault): VaultSummary => ({
    vaultId: vault.vaultId,
    name: vault.name,
    activeVaultPathDisplay: vault.activeVaultPathDisplay,
    knowledgeRootDisplay: vault.knowledgeRootDisplay,
    sourceAssetRootDisplay: vault.sourceAssetRootDisplay,
    sourceAssetRootKind: vault.sourceAssetRootKind,
    defaultSourceStorageStrategy: vault.defaultSourceStorageStrategy,
    schemaVersion: vault.schemaVersion,
    ...(vault.counts ? { counts: vault.counts } : {}),
    ...(vault.lastBackupAt ? { lastBackupAt: vault.lastBackupAt } : {})
  });

  return {
    status: "completed",
    vault: projectSummary(parsed.vault),
    onboarding: {
      state: parsed.onboarding.state,
      ...(parsed.onboarding.activeVault
        ? { activeVault: projectSummary(parsed.onboarding.activeVault) }
        : {}),
      hasDefaultModel: parsed.onboarding.hasDefaultModel,
      showFirstHomeGuide: parsed.onboarding.showFirstHomeGuide,
      ...(parsed.onboarding.waitingDependencyCounts
        ? { waitingDependencyCounts: parsed.onboarding.waitingDependencyCounts }
        : {})
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

function isVaultRevealTarget(value: unknown): value is VaultRevealTarget {
  return value === "knowledge_root" || value === "source_asset_root";
}

function projectVaultRevealResult(
  result: unknown,
  expectedTarget: VaultRevealTarget
): VaultRevealResult {
  if (!result || typeof result !== "object") throw new Error("Invalid vault reveal response.");
  const record = result as Record<string, unknown>;
  if (!isVaultRevealTarget(record.target) || record.target !== expectedTarget) {
    throw new Error("Invalid vault reveal response.");
  }
  if (record.status === "revealed" && Object.keys(record).sort().join(",") === "status,target") {
    return { status: "revealed", target: record.target };
  }
  if (record.status !== "failed" || Object.keys(record).sort().join(",") !== "error,status,target") {
    throw new Error("Invalid vault reveal response.");
  }
  const error = record.error;
  if (!error || typeof error !== "object") throw new Error("Invalid vault reveal response.");
  const safeError = error as Record<string, unknown>;
  if (
    Object.keys(safeError).sort().join(",") !== "code,domain,messageKey,retryable,severity,userAction" ||
    safeError.code !== "vault.reveal_failed" ||
    safeError.domain !== "vault" ||
    safeError.messageKey !== "errors.vault.reveal_failed" ||
    safeError.retryable !== true ||
    safeError.severity !== "warning" ||
    safeError.userAction !== "retry"
  ) {
    throw new Error("Invalid vault reveal response.");
  }
  return {
    status: "failed",
    target: record.target,
    error: {
      code: "vault.reveal_failed",
      domain: "vault",
      messageKey: "errors.vault.reveal_failed",
      retryable: true,
      severity: "warning",
      userAction: "retry"
    }
  };
}

const api: PigeDesktopApi = {
  getHealth: async (): Promise<AppHealth> => ipcRenderer.invoke("pige:getHealth") as Promise<AppHealth>,
  window: {
    current: async (): Promise<WindowState> => ipcRenderer.invoke("window.current") as Promise<WindowState>,
    currentLayout: async (): Promise<WindowLayoutState> =>
      WindowLayoutStateSchema.parse(await ipcRenderer.invoke("window.currentLayout")),
    setLayout: async (request: WindowLayoutRequest): Promise<WindowLayoutState> =>
      WindowLayoutStateSchema.parse(
        await ipcRenderer.invoke("window.setLayout", WindowLayoutRequestSchema.parse(request))
      ),
    onLayoutChanged: (listener: (state: WindowLayoutState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = WindowLayoutStateSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("window.layoutChanged", handler);
      return () => ipcRenderer.removeListener("window.layoutChanged", handler);
    },
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
    conversation: (async (
      request?: AgentConversationRequest
    ): Promise<AgentConversationResult | undefined> => {
      const normalizedRequest = request?.scope
        ? { ...request, scope: { kind: "current_note" as const, pageId: request.scope.pageId } }
        : request;
      const parsedRequest = AgentConversationRequestSchema.parse(normalizedRequest ?? {});
      const result = await ipcRenderer.invoke("agent.conversation", parsedRequest) as unknown;
      return AgentConversationResultSchema.optional().parse(result) as AgentConversationResult | undefined;
    }) as PigeDesktopApi["agent"]["conversation"],
    submitTurn: (async (
      request: AgentSubmitTurnRequest,
      files: readonly File[] = []
    ): Promise<AgentSubmitTurnIpcResult> => {
      const stagedFileItems = request.stagedItems?.filter((item) => item.kind === "file");
      if (stagedFileItems && stagedFileItems.length !== files.length) {
        throw new Error("The staged file identities do not match the selected files.");
      }
      const attachments = files.map((file, index) => ({
        ...(stagedFileItems === undefined ? {} : { ordinal: stagedFileItems[index]!.ordinal }),
        displayName: stagedFileItems?.[index]?.displayName ?? file.name,
        internalPath: webUtils.getPathForFile(file)
      }));
      const canonicalRequest = {
        schemaVersion: 1 as const,
        inputKind: request.inputKind,
        locale: request.locale,
        ...(request.stagedItems === undefined ? {} : { stagedItems: request.stagedItems }),
        ...(request.text === undefined ? {} : { text: request.text }),
        ...(request.scope ? { scope: { kind: "current_note" as const, pageId: request.scope.pageId } } : {}),
        ...(request.clientTurnId === undefined ? {} : { clientTurnId: request.clientTurnId }),
        ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
        ...(request.expectedTailEventId === undefined ? {} : { expectedTailEventId: request.expectedTailEventId })
      };
      const payload = AgentSubmitTurnIpcPayloadSchema.parse({
        request: canonicalRequest,
        attachments
      });
      return AgentSubmitTurnIpcResultSchema.parse(
        await ipcRenderer.invoke("agent.submitTurn", payload)
      ) as AgentSubmitTurnIpcResult;
    }) as PigeDesktopApi["agent"]["submitTurn"],
    onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void): (() => void) => {
      const handleDraft = (_event: IpcRendererEvent, draft: AgentTurnDraftEvent): void => listener(draft);
      ipcRenderer.on("agent.turnDraft", handleDraft);
      return () => ipcRenderer.removeListener("agent.turnDraft", handleDraft);
    },
    currentNoteAppendProposal: async (
      request: CurrentNoteAppendProposalGetRequest
    ): Promise<CurrentNoteAppendProposalGetResult> =>
      CurrentNoteAppendProposalGetResultSchema.parse(await ipcRenderer.invoke(
        "agent.currentNoteAppendProposal",
        CurrentNoteAppendProposalGetRequestSchema.parse(request)
      )),
    decideCurrentNoteAppendProposal: async (
      request: CurrentNoteAppendProposalDecisionRequest
    ): Promise<CurrentNoteAppendProposalDecisionResult> =>
      CurrentNoteAppendProposalDecisionResultSchema.parse(await ipcRenderer.invoke(
        "agent.decideCurrentNoteAppendProposal",
        CurrentNoteAppendProposalDecisionRequestSchema.parse(request)
      ))
  },
  jobs: {
    list: async (request?: JobsListRequest): Promise<JobsListResult> =>
      ipcRenderer.invoke("jobs.list", request) as Promise<JobsListResult>,
    cancel: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.cancel", request) as Promise<JobActionResult>,
    retry: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.retry", request) as Promise<JobActionResult>
  },
  confirmations: {
    pending: async (): Promise<HighRiskConfirmationPendingResult> =>
      HighRiskConfirmationPendingResultSchema.parse(await ipcRenderer.invoke("confirmations.pending")),
    resolve: async (
      request: HighRiskConfirmationResolveRequest
    ): Promise<HighRiskConfirmationResolveResult> =>
      HighRiskConfirmationResolveResultSchema.parse(await ipcRenderer.invoke(
        "confirmations.resolve",
        HighRiskConfirmationResolveRequestSchema.parse(request)
      )),
    onChanged: (listener: (event: HighRiskConfirmationChangedEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = HighRiskConfirmationChangedEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("confirmations.changed", handler);
      return () => ipcRenderer.removeListener("confirmations.changed", handler);
    }
  },
  piPackages: {
    summary: async (): Promise<PiPackageRegistryQueryResult> =>
      PiPackageRegistryQueryResultSchema.parse(await ipcRenderer.invoke("piPackages.summary")),
    catalogQuery: async (request: PiPackageCatalogQueryRequest): Promise<PiPackageCatalogQueryResult> =>
      PiPackageCatalogQueryResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.catalogQuery",
        PiPackageCatalogQueryRequestSchema.parse(request)
      )),
    install: async (request: PiPackageInstallRequest): Promise<PiPackageInstallResult> =>
      PiPackageInstallResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.install",
        PiPackageInstallRequestSchema.parse(request)
      )),
    uninstall: async (request: PiPackageUninstallRequest): Promise<PiPackageUninstallResult> =>
      PiPackageUninstallResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.uninstall",
        PiPackageUninstallRequestSchema.parse(request)
      )),
    update: async (request: PiPackageUpdateRequest): Promise<PiPackageUpdateResult> =>
      PiPackageUpdateResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.update",
        PiPackageUpdateRequestSchema.parse(request)
      )),
    rollback: async (request: PiPackageRollbackRequest): Promise<PiPackageRollbackResult> =>
      PiPackageRollbackResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.rollback",
        PiPackageRollbackRequestSchema.parse(request)
      )),
    setPinned: async (request: PiPackageSetPinnedRequest): Promise<PiPackageSetPinnedResult> =>
      PiPackageSetPinnedResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.setPinned",
        PiPackageSetPinnedRequestSchema.parse(request)
      ))
  },
  taskExecution: {
    interaction: async (): Promise<TaskInteractionPendingResult> =>
      TaskInteractionPendingResultSchema.parse(
        await ipcRenderer.invoke("taskExecution.interaction")
      ),
    openInteraction: async (
      request: TaskInteractionOpenRequest
    ): Promise<TaskInteractionOpenResult> =>
      TaskInteractionOpenResultSchema.parse(await ipcRenderer.invoke(
        "taskExecution.openInteraction",
        TaskInteractionOpenRequestSchema.parse(request)
      )),
    onInteractionChanged: (
      listener: (event: TaskInteractionChangedEvent) => void
    ): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = TaskInteractionChangedEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("taskExecution.interactionChanged", handler);
      return () => ipcRenderer.removeListener("taskExecution.interactionChanged", handler);
    }
  },
  skills: {
    summary: async (): Promise<SkillRegistryQueryResult> =>
      SkillRegistryQueryResultSchema.parse(await ipcRenderer.invoke("skills.summary")),
    stageFromUrl: async (request: SkillStageFromUrlRequest): Promise<SkillStageFromUrlResult> =>
      SkillStageFromUrlResultSchema.parse(await ipcRenderer.invoke(
        "skills.stageFromUrl",
        SkillStageFromUrlRequestSchema.parse(request)
      )),
    stageFromMarkdown: async (request: SkillStageFromMarkdownRequest): Promise<SkillStageFromMarkdownResult> =>
      SkillStageFromMarkdownResultSchema.parse(await ipcRenderer.invoke(
        "skills.stageFromMarkdown",
        SkillStageFromMarkdownRequestSchema.parse(request)
      )),
    stageFromZip: async (request: SkillStageFromZipRequest): Promise<SkillStageFromZipResult> =>
      SkillStageFromZipResultSchema.parse(await ipcRenderer.invoke(
        "skills.stageFromZip",
        SkillStageFromZipRequestSchema.parse(request)
      )),
    stageUpdate: async (request: SkillStageUpdateRequest): Promise<SkillStageUpdateResult> =>
      SkillStageUpdateResultSchema.parse(await ipcRenderer.invoke(
        "skills.stageUpdate",
        SkillStageUpdateRequestSchema.parse(request)
      )),
    installStaged: async (request: SkillInstallStagedRequest): Promise<SkillInstallStagedResult> =>
      SkillInstallStagedResultSchema.parse(await ipcRenderer.invoke(
        "skills.installStaged",
        SkillInstallStagedRequestSchema.parse(request)
      )),
    discardStaged: async (request: SkillDiscardStagedRequest): Promise<SkillDiscardStagedResult> =>
      SkillDiscardStagedResultSchema.parse(await ipcRenderer.invoke(
        "skills.discardStaged",
        SkillDiscardStagedRequestSchema.parse(request)
      )),
    disable: async (request: SkillDisableRequest): Promise<SkillRegistryMutationResult> =>
      SkillRegistryMutationResultSchema.parse(await ipcRenderer.invoke(
        "skills.disable",
        SkillDisableRequestSchema.parse(request)
      )),
    enable: async (request: SkillEnableRequest): Promise<SkillLifecycleMutationResult> =>
      SkillLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "skills.enable",
        SkillEnableRequestSchema.parse(request)
      )),
    uninstall: async (request: SkillUninstallRequest): Promise<SkillLifecycleMutationResult> =>
      SkillLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "skills.uninstall",
        SkillUninstallRequestSchema.parse(request)
      )),
    export: async (request: SkillExportRequest): Promise<SkillExportResult> =>
      SkillExportResultSchema.parse(await ipcRenderer.invoke(
        "skills.export",
        SkillExportRequestSchema.parse(request)
      )),
    onChanged: (listener: (summary: SkillRegistrySummary) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = SkillRegistrySummarySchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("skills.changed", handler);
      return () => ipcRenderer.removeListener("skills.changed", handler);
    }
  },
  memory: {
    list: async (request: MemoryListRequest): Promise<MemorySummary> =>
      MemorySummarySchema.parse(await ipcRenderer.invoke("memory.list", MemoryListRequestSchema.parse(request))),
    disable: async (request: MemoryDisableRequest): Promise<MemoryMutationResult> =>
      MemoryMutationResultSchema.parse(await ipcRenderer.invoke(
        "memory.disable",
        MemoryDisableRequestSchema.parse(request)
      )),
    edit: async (request: MemoryEditRequest): Promise<MemoryLifecycleMutationResult> =>
      MemoryLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "memory.edit",
        MemoryEditRequestSchema.parse(request)
      )),
    enable: async (request: MemoryEnableRequest): Promise<MemoryLifecycleMutationResult> =>
      MemoryLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "memory.enable",
        MemoryEnableRequestSchema.parse(request)
      )),
    delete: async (request: MemoryDeleteRequest): Promise<MemoryLifecycleMutationResult> =>
      MemoryLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "memory.delete",
        MemoryDeleteRequestSchema.parse(request)
      )),
    export: async (request: MemoryExportRequest): Promise<MemoryExportResult> =>
      MemoryExportResultSchema.parse(await ipcRenderer.invoke(
        "memory.export",
        MemoryExportRequestSchema.parse(request)
      )),
    reset: async (request: MemoryResetRequest): Promise<MemoryLifecycleMutationResult> =>
      MemoryLifecycleMutationResultSchema.parse(await ipcRenderer.invoke(
        "memory.reset",
        MemoryResetRequestSchema.parse(request)
      )),
    onChanged: (listener: (summary: MemorySummary) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = MemorySummarySchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("memory.changed", handler);
      return () => ipcRenderer.removeListener("memory.changed", handler);
    }
  },
  activity: {
    list: invokeKnowledgeActivityList,
    undo: async (request: KnowledgeActivityUndoRequest): Promise<KnowledgeActivityUndoResult> =>
      ipcRenderer.invoke("activity.undo", request) as Promise<KnowledgeActivityUndoResult>
  },
  collections: {
    open: invokeCollectionOpen,
    editCell: invokeCollectionCellEdit,
    appendDefaultRow: invokeCollectionAppendDefaultRow,
    addNullableColumn: invokeCollectionAddNullableColumn,
    renameColumn: invokeCollectionRenameColumn,
    createView: invokeCollectionCreateView,
    trashColumn: invokeCollectionTrashColumn,
    trashRow: invokeCollectionTrashRow
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
      ipcRenderer.invoke("notes.render", request) as Promise<NoteRenderResult>,
    openEditor: async (request: NoteEditorOpenRequest): Promise<NoteEditorOpenResult> =>
      NoteEditorOpenResultSchema.parse(
        await ipcRenderer.invoke(
          "notes.openEditor",
          NoteEditorOpenRequestSchema.parse(request)
        )
      ),
    saveEditor: async (request: NoteEditorSaveRequest): Promise<NoteEditorSaveResult> =>
      NoteEditorSaveResultSchema.parse(
        await ipcRenderer.invoke(
          "notes.saveEditor",
          NoteEditorSaveRequestSchema.parse(request)
        )
      ),
    resolveInlineReference: async (
      request: NoteResolveInlineReferenceRequest
    ): Promise<NoteResolveInlineReferenceResult> =>
      NoteResolveInlineReferenceResultSchema.parse(
        await ipcRenderer.invoke(
          "notes.resolveInlineReference",
          NoteResolveInlineReferenceRequestSchema.parse(request)
        )
      ),
    openSourceReference: async (
      request: NoteOpenSourceReferenceRequest
    ): Promise<NoteOpenSourceReferenceResult> =>
      NoteOpenSourceReferenceResultSchema.parse(
        await ipcRenderer.invoke(
          "notes.openSourceReference",
          NoteOpenSourceReferenceRequestSchema.parse(request)
        )
      )
  },
  readerSelection: {
    resolve: async (
      request: ReaderSelectionResolveRequest
    ): Promise<ReaderSelectionResolveResult> =>
      ReaderSelectionResolveResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.resolve",
          ReaderSelectionResolveRequestSchema.parse(request)
        )
        ),
    submitAction: async (
      request: ReaderSelectionActionRequest
    ): Promise<ReaderSelectionActionResult> =>
      ReaderSelectionActionResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.submitAction",
          ReaderSelectionActionRequestSchema.parse(request)
        )
      ),
    submitLink: async (
      request: ReaderSelectionLinkRequest
    ): Promise<ReaderSelectionLinkResult> =>
      ReaderSelectionLinkResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.submitLink",
          ReaderSelectionLinkRequestSchema.parse(request)
        )
      ),
    submitTransform: async (
      request: ReaderSelectionTransformRequest
    ): Promise<ReaderSelectionTransformResult> =>
      ReaderSelectionTransformResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.submitTransform",
          ReaderSelectionTransformRequestSchema.parse(request)
        )
      ),
    currentProposal: async (
      request: ReaderSelectionProposalGetRequest
    ): Promise<ReaderSelectionProposalGetResult> =>
      ReaderSelectionProposalGetResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.currentProposal",
          ReaderSelectionProposalGetRequestSchema.parse(request)
        )
      ),
    decideProposal: async (
      request: ReaderSelectionProposalDecisionRequest
    ): Promise<ReaderSelectionProposalDecisionResult> =>
      ReaderSelectionProposalDecisionResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.decideProposal",
          ReaderSelectionProposalDecisionRequestSchema.parse(request)
        )
      )
  },
  localCapabilities: {
    paddleOcrSummary: async (
      request: PaddleOcrSummaryRequest
    ): Promise<PaddleOcrSummary> =>
      PaddleOcrSummarySchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.paddleOcrSummary",
          PaddleOcrSummaryRequestSchema.parse(request)
        )
      ),
    installPaddleOcr: async (
      request: PaddleOcrInstallRequest
    ): Promise<PaddleOcrInstallResult> =>
      PaddleOcrInstallResultSchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.installPaddleOcr",
          PaddleOcrInstallRequestSchema.parse(request)
        )
      ),
    enablePaddleOcr: async (
      request: PaddleOcrEnableRequest
    ): Promise<PaddleOcrEnableResult> =>
      PaddleOcrEnableResultSchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.enablePaddleOcr",
          PaddleOcrEnableRequestSchema.parse(request)
        )
      ),
    testPaddleOcr: async (
      request: PaddleOcrTestRequest
    ): Promise<PaddleOcrTestResult> =>
      PaddleOcrTestResultSchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.testPaddleOcr",
          PaddleOcrTestRequestSchema.parse(request)
        )
      ),
    disablePaddleOcr: async (
      request: PaddleOcrDisableRequest
    ): Promise<PaddleOcrDisableResult> =>
      PaddleOcrDisableResultSchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.disablePaddleOcr",
          PaddleOcrDisableRequestSchema.parse(request)
        )
      ),
    removePaddleOcr: async (
      request: PaddleOcrRemoveRequest
    ): Promise<PaddleOcrRemoveResult> =>
      PaddleOcrRemoveResultSchema.parse(
        await ipcRenderer.invoke(
          "localCapabilities.removePaddleOcr",
          PaddleOcrRemoveRequestSchema.parse(request)
        )
      )
  },
  retrieval: {
    search: invokeRetrievalSearch,
    localSemanticStatus: async (
      request: LocalSemanticRetrievalStatusRequest
    ): Promise<LocalSemanticRetrievalStatus> =>
      LocalSemanticRetrievalStatusSchema.parse(
        await ipcRenderer.invoke(
          "retrieval.localSemanticStatus",
          LocalSemanticRetrievalStatusRequestSchema.parse(request)
        )
      ),
    installLocalSemanticAsset: async (
      request: LocalSemanticRetrievalInstallRequest
    ): Promise<LocalSemanticRetrievalInstallResult> =>
      LocalSemanticRetrievalInstallResultSchema.parse(
        await ipcRenderer.invoke(
          "retrieval.installLocalSemanticAsset",
          LocalSemanticRetrievalInstallRequestSchema.parse(request)
        )
      ),
    enableLocalSemanticAsset: async (
      request: LocalSemanticRetrievalEnableRequest
    ): Promise<LocalSemanticRetrievalEnableResult> =>
      LocalSemanticRetrievalEnableResultSchema.parse(
        await ipcRenderer.invoke(
          "retrieval.enableLocalSemanticAsset",
          LocalSemanticRetrievalEnableRequestSchema.parse(request)
        )
      ),
    disableLocalSemanticAsset: async (
      request: LocalSemanticRetrievalDisableRequest
    ): Promise<LocalSemanticRetrievalDisableResult> =>
      LocalSemanticRetrievalDisableResultSchema.parse(
        await ipcRenderer.invoke(
          "retrieval.disableLocalSemanticAsset",
          LocalSemanticRetrievalDisableRequestSchema.parse(request)
        )
      ),
    removeLocalSemanticAsset: async (
      request: LocalSemanticRetrievalRemoveRequest
    ): Promise<LocalSemanticRetrievalRemoveResult> =>
      LocalSemanticRetrievalRemoveResultSchema.parse(
        await ipcRenderer.invoke(
          "retrieval.removeLocalSemanticAsset",
          LocalSemanticRetrievalRemoveRequestSchema.parse(request)
        )
      )
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
    openRecent: async (request: OpenRecentVaultRequest): Promise<VaultActionResult> => {
      const parsedRequest = OpenRecentVaultRequestSchema.parse(request);
      const result: unknown = await ipcRenderer.invoke("vault.openRecent", parsedRequest);
      return projectVaultActionResult(result);
    },
    revealKnowledgeRoot: async (): Promise<VaultRevealResult> =>
      projectVaultRevealResult(await ipcRenderer.invoke("vault.revealKnowledgeRoot"), "knowledge_root"),
    revealSourceAssetRoot: async (): Promise<VaultRevealResult> =>
      projectVaultRevealResult(await ipcRenderer.invoke("vault.revealSourceAssetRoot"), "source_asset_root"),
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
      ipcRenderer.invoke("maintenance.localDatabaseStatus") as Promise<LocalDatabaseStatus>,
    runKnowledgeHealth: async (request: KnowledgeHealthRunRequest): Promise<KnowledgeHealthRunResult> => {
      const parsedRequest = KnowledgeHealthRunRequestSchema.parse(request);
      return KnowledgeHealthRunResultSchema.parse(
        await ipcRenderer.invoke("maintenance.runKnowledgeHealth", parsedRequest)
      );
    },
    repairKnowledgeHealth: async (
      request: KnowledgeHealthRepairRequest
    ): Promise<KnowledgeHealthRepairResult> => {
      const parsedRequest = KnowledgeHealthRepairRequestSchema.parse(request);
      return KnowledgeHealthRepairResultSchema.parse(
        await ipcRenderer.invoke("maintenance.repairKnowledgeHealth", parsedRequest)
      );
    }
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
    updateProviderCredential: async (
      request: UpdateProviderCredentialRequest
    ): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.updateProviderCredential", request) as Promise<ModelProviderSettingsSummary>,
    deleteProvider: async (request: DeleteProviderRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.deleteProvider", request) as Promise<ModelProviderSettingsSummary>,
    addManualModel: async (request: AddManualModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.addManualModel", request) as Promise<ModelProviderSettingsSummary>,
    updateModel: async (request: UpdateModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.updateModel", request) as Promise<ModelProviderSettingsSummary>,
    setDefaultModel: async (request: SetDefaultModelRequest): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.setDefaultModel", request) as Promise<ModelProviderSettingsSummary>
  },
  settings: {
    appearance: async (): Promise<AppearanceSettingsSummary> =>
      AppearanceSettingsSummarySchema.parse(await ipcRenderer.invoke("settings.appearance")),
    setLocale: async (request: SetLocaleRequest): Promise<AppearanceSettingsSummary> =>
      AppearanceSettingsSummarySchema.parse(
        await ipcRenderer.invoke("settings.setLocale", SetLocaleRequestSchema.parse(request))
      ),
    setTheme: async (request: SetThemeRequest): Promise<AppearanceThemeMutationResult> =>
      AppearanceThemeMutationResultSchema.parse(
        await ipcRenderer.invoke("settings.setTheme", SetThemeRequestSchema.parse(request))
      ),
    onAppearanceChanged: (listener: (settings: AppearanceSettingsSummary) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = AppearanceSettingsSummarySchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("settings.appearanceChanged", handler);
      return () => ipcRenderer.removeListener("settings.appearanceChanged", handler);
    },
    registry: async (): Promise<SettingsRegistrySummary> =>
      ipcRenderer.invoke("settings.registry") as Promise<SettingsRegistrySummary>
  },
  updates: {
    summary: async (): Promise<UpdateSummary> =>
      UpdateSummarySchema.parse(await ipcRenderer.invoke("updates.summary")),
    check: async (request: UpdateCheckRequest): Promise<UpdateCheckResult> => {
      const parsedRequest = UpdateCheckRequestSchema.parse(request);
      return UpdateCheckResultSchema.parse(await ipcRenderer.invoke("updates.check", parsedRequest));
    },
    onStatusChanged: (listener: (event: UpdateStatusEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = UpdateStatusEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("updates.statusChanged", handler);
      return () => ipcRenderer.removeListener("updates.statusChanged", handler);
    }
  },
  speech: {
    availability: async (request: SpeechAvailabilityRequest): Promise<SpeechAvailabilityResult> => {
      const parsedRequest = SpeechAvailabilityRequestSchema.parse(request);
      return SpeechAvailabilityResultSchema.parse(await ipcRenderer.invoke("speech.availability", parsedRequest));
    },
    installLanguageAsset: async (request: SpeechAssetInstallRequest): Promise<SpeechAssetInstallResult> => {
      const parsedRequest = SpeechAssetInstallRequestSchema.parse(request);
      return SpeechAssetInstallResultSchema.parse(
        await ipcRenderer.invoke("speech.installLanguageAsset", parsedRequest)
      );
    },
    start: async (request: SpeechStartRequest): Promise<SpeechStartResult> => {
      const parsedRequest = SpeechStartRequestSchema.parse(request);
      return SpeechStartResultSchema.parse(await ipcRenderer.invoke("speech.start", parsedRequest));
    },
    stop: async (request: SpeechSessionRequest): Promise<SpeechStopResult> => {
      const parsedRequest = SpeechSessionRequestSchema.parse(request);
      return SpeechStopResultSchema.parse(await ipcRenderer.invoke("speech.stop", parsedRequest));
    },
    cancel: async (request: SpeechCancelRequest): Promise<SpeechCancelResult> => {
      const parsedRequest = SpeechCancelRequestSchema.parse(request);
      return SpeechCancelResultSchema.parse(await ipcRenderer.invoke("speech.cancel", parsedRequest));
    },
    openSystemSettings: async (): Promise<SpeechOpenSystemSettingsResult> =>
      SpeechOpenSystemSettingsResultSchema.parse(await ipcRenderer.invoke("speech.openSystemSettings")),
    onAssetInstallEvent: (listener: (event: SpeechAssetInstallEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = SpeechAssetInstallEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("speech.assetInstallEvent", handler);
      return () => ipcRenderer.removeListener("speech.assetInstallEvent", handler);
    },
    onSessionEvent: (listener: (event: SpeechSessionEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = SpeechSessionEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on("speech.sessionEvent", handler);
      return () => ipcRenderer.removeListener("speech.sessionEvent", handler);
    }
  },
  backup: {
    status: async (): Promise<BackupRestoreStatus> =>
      ipcRenderer.invoke("backup.status") as Promise<BackupRestoreStatus>,
    create: async (): Promise<BackupCreateResult> =>
      ipcRenderer.invoke("backup.create") as Promise<BackupCreateResult>,
    reconnectDependency: async (
      request: BackupReconnectDependencyRequest
    ): Promise<BackupReconnectDependencyResult> => {
      const parsedRequest = BackupReconnectDependencyRequestSchema.parse(request);
      return BackupReconnectDependencyResultSchema.parse(
        await ipcRenderer.invoke("backup.reconnectDependency", parsedRequest)
      );
    },
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
