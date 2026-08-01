import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  AgentConversationRequest,
  AgentConversationResult,
  AgentConversationHistoryListRequest,
  AgentConversationHistoryListResult,
  AgentConversationExportRequest,
  AgentConversationExportResult,
  ConversationRestoreRequest,
  ConversationRestoreResult,
  ConversationTrashListRequest,
  ConversationTrashListResult,
  ConversationTrashRequest,
  ConversationTrashResult,
  AgentConversationSetTitleRequest,
  AgentConversationSetTitleResult,
  AgentSaveAnswerAsNoteRequest,
  AgentSaveAnswerAsNoteResult,
  AgentSubmitTurnRequest,
  AgentSubmitTurnIpcResult,
  AgentTurnDraftEvent,
  AgentRuntimeStatus,
  CurrentNoteAppendProposalDecisionRequest,
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalGetRequest,
  CurrentNoteAppendProposalGetResult,
  CurrentNoteReplaceProposalDecisionRequest,
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalGetRequest,
  CurrentNoteReplaceProposalGetResult,
  AppHealth,
  BackupManifestSummary,
  BackupCreateResult,
  BackupContinueIncompleteRequest,
  BackupContinueIncompleteResult,
  BackupReconnectDestinationRequest,
  BackupReconnectDestinationResult,
  BackupReconnectDependencyRequest,
  BackupReconnectDependencyResult,
  AppearanceSettingsSummary,
  KnowledgeLanguageMutationResult,
  AppearanceThemeMutationResult,
  BackupRestoreStatus,
  CreateVaultRequest,
  DiagnosticsHealth,
  DiagnosticsClearLocalRequest,
  DiagnosticsClearLocalResult,
  DiagnosticsPreviewSupportBundleRequest,
  DiagnosticsSupportBundleMutationRequest,
  DiagnosticsSupportBundleMutationResult,
  DiagnosticsWorkflowSummary,
  ExportSupportBundleRequest,
  CancelSupportBundleExportRequest,
  CancelSupportBundleExportResult,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  PermissionPolicyChangedEvent,
  PermissionPolicySummaryRequest,
  PermissionPolicySummaryResult,
  PermissionRevokeGrantRequest,
  PermissionRevokeGrantResult,
  PermissionSetDefaultModeRequest,
  PermissionSetDefaultModeResult,
  JobActionRequest,
  JobActionResult,
  JobChangedEvent,
  JobsListRequest,
  JobsListResult,
  KnowledgeActivityListRequest,
  KnowledgeActivityListResult,
  KnowledgeActivityRedoRequest,
  KnowledgeActivityRedoResult,
  KnowledgeActivityUndoRequest,
  KnowledgeActivityUndoResult,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthDuplicateTopicRepairRequest,
  KnowledgeHealthDuplicateTopicRepairResult,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult,
  KnowledgeHealthOrphanParentSearchRequest,
  KnowledgeHealthOrphanParentSearchResult,
  KnowledgeHealthOrphanRepairRequest,
  KnowledgeHealthOrphanRepairResult,
  KnowledgeHealthClaimSourceSearchRequest,
  KnowledgeHealthClaimSourceSearchResult,
  KnowledgeHealthClaimSourceRepairRequest,
  KnowledgeHealthClaimSourceRepairResult,
  ManagedCopyRootConfigureRequest,
  ManagedCopyRootConfigureResult,
  ManagedCopyRootSummary,
  DictationLanguagePreferenceRequest,
  DictationLanguagePreferenceResult,
  SetDictationLanguagePreferenceRequest,
  SetDictationLanguagePreferenceResult,
  KnowledgeTreeResult,
  LibraryBrowseRequest,
  LibraryBrowseResult,
  LibraryListRequest,
  LibraryListResult,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  LibraryTagsRequest,
  LibraryTagsResult,
  LibraryRenameTagRequest,
  LibraryRenameTagResult,
  LibraryRenameTopicRequest,
  LibraryRenameTopicResult,
  LibraryMergeTagRequest,
  LibraryMergeTagResult,
  LibraryRemoveTagRequest,
  LibraryRemoveTagResult,
  LibraryRemovePageTagRequest,
  LibraryRemovePageTagResult,
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
  LocalRerankerDisableRequest,
  LocalRerankerDisableResult,
  LocalRerankerEnableRequest,
  LocalRerankerEnableResult,
  LocalRerankerInstallRequest,
  LocalRerankerInstallResult,
  LocalRerankerRemoveRequest,
  LocalRerankerRemoveResult,
  LocalRerankerStatus,
  LocalRerankerStatusRequest,
  OcrLanguagePreferenceRequest,
  OcrLanguagePreferenceResult,
  SetOcrLanguagePreferenceRequest,
  SetOcrLanguagePreferenceResult,
  OcrEnginePreferenceRequest,
  OcrEnginePreferenceResult,
  OcrSummaryPreferenceRequest,
  OcrSummaryPreferenceResult,
  SetOcrSummaryPreferenceRequest,
  SetOcrSummaryPreferenceResult,
  OcrImageTestRequest,
  OcrImageTestResult,
  SetOcrEnginePreferenceRequest,
  SetOcrEnginePreferenceResult,
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
  LocalDatabaseResetAndRebuildResult,
  ModelProviderSettingsSummary,
  ProviderConnectResult,
  ProviderApiKeyManagementRequest,
  ProviderApiKeyManagementResult,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteUnlinkRelationRequest,
  NoteUnlinkRelationResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteSetQuestionStateRequest,
  NoteSetQuestionStateResult,
  NoteSetClaimConfidenceRequest,
  NoteSetClaimConfidenceResult,
  NoteSetEntityTypeRequest,
  NoteSetEntityTypeResult,
  NoteSearchQuestionAnswersRequest,
  NoteSearchQuestionAnswersResult,
  NoteChangeQuestionAnswerRequest,
  NoteChangeQuestionAnswerResult,
  NoteSearchClaimContradictionsRequest,
  NoteSearchClaimContradictionsResult,
  NoteChangeClaimContradictionRequest,
  NoteChangeClaimContradictionResult,
  NoteSearchConceptParentsRequest,
  NoteSearchConceptParentsResult,
  NoteChangeConceptParentRequest,
  NoteChangeConceptParentResult,
  NoteSearchTopicParentsRequest,
  NoteSearchTopicParentsResult,
  NoteChangeTopicParentRequest,
  NoteChangeTopicParentResult,
  NoteAddTagRequest,
  NoteAddTagResult,
  NoteEditTaxonomyRequest,
  NoteEditTaxonomyResult,
  NoteRenameRequest,
  NoteRenameResult,
  NoteAliasChangeRequest,
  NoteAliasChangeResult,
  NoteRemoveTagRequest,
  NoteRemoveTagResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteTrashListRequest,
  NoteTrashListResult,
  NoteTrashRestoreRequest,
  NoteTrashRestoreResult,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryListResult,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryOpenResult,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistoryRestoreResult,
  NoteDocument,
  NoteGetRequest,
  NoteOpenSearchMatchRequest,
  NoteOpenSearchMatchResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  SourceReconnectListRequest,
  SourceReconnectListResult,
  SourceReconnectRequest,
  SourceReconnectResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult,
  NoteRevealGeneratedRequest,
  NoteRevealGeneratedResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  NoteRenderRequest,
  NoteRenderResult,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
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
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult,
  OnboardingStatus,
  OpenRecentVaultRequest,
  PigeDesktopApi,
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageCatalogQueryRequest,
  PiPackageCatalogQueryResult,
  PiPackageRegistryQueryResult,
  PiPackageRestoreRequest,
  PiPackageRestoreResult,
  PiPackageRollbackRequest,
  PiPackageRollbackResult,
  PiPackageSetPinnedRequest,
  PiPackageSetPinnedResult,
  PiPackageSetEnabledRequest,
  PiPackageSetEnabledResult,
  PiPackageUninstallRequest,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateResult,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  ProposalReviewRequest,
  ProposalReviewResult,
  ProposalReviewDecisionRequest,
  ProposalReviewDecisionResult,
  ProposalGetRequest,
  ProposalGetResult,
  ProposalsListRequest,
  ProposalsListResult,
  RecentVaultForgetRequest,
  RecentVaultForgetResult,
  RecentVaultReconnectRequest,
  RecentVaultReconnectResult,
  RecentVaultSummary,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestoreCancelRequest,
  RestoreCancelResult,
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
  SetKnowledgeLanguageRequest,
  SetStartupDestinationRequest,
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
  StartupDestinationMutationResult,
  StartupDestinationSummary,
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
  SkillPendingStagedReviewsRequest,
  SkillPendingStagedReviewsResult,
  SkillStageFromUrlRequest,
  SkillStageFromUrlResult,
  SkillStageFromMarkdownRequest,
  SkillStageFromMarkdownResult,
  SkillStageFromZipRequest,
  SkillStageFromZipResult,
  SkillStageUpdateRequest,
  SkillStageUpdateResult,
  SkillRestoreRequest,
  SkillRestoreResult,
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
  SkillRegistryQueryRequest,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SupportBundleExportResult,
  SupportBundlePreview,
  ToolchainHealth,
  ToolchainRepairRequest,
  ToolchainRepairResult,
  UpdateApplyRequest,
  UpdateApplyResult,
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateStatusEvent,
  UpdateSummary,
  UpdateSourceStoragePolicyRequest,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState,
  VaultActionResult,
  VaultMigrationApplyRequest,
  VaultMigrationApplyResult,
  VaultStorageRelocationRequest,
  VaultStorageRelocationResult,
  VaultStorageRelocationStatus,
  VaultRenameDisplayNameRequest,
  VaultRenameDisplayNameResult,
  VaultRevealResult,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import {
  AgentConversationRequestSchema,
  AgentConversationResultSchema,
  AgentConversationHistoryListRequestSchema,
  AgentConversationHistoryListResultSchema,
  AGENT_CONVERSATION_EXPORT_CHANNEL,
  AgentConversationExportRequestSchema,
  AgentConversationExportResultSchema,
  ConversationRestoreRequestSchema,
  ConversationRestoreResultSchema,
  ConversationTrashListRequestSchema,
  ConversationTrashListResultSchema,
  ConversationTrashRequestSchema,
  ConversationTrashResultSchema,
  AgentConversationSetTitleRequestSchema,
  AgentConversationSetTitleResultSchema,
  AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL,
  AgentSaveAnswerAsNoteRequestSchema,
  AgentSaveAnswerAsNoteResultSchema,
  AgentSubmitTurnIpcPayloadSchema,
  AgentSubmitTurnIpcResultSchema,
  CurrentNoteAppendProposalDecisionRequestSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  CurrentNoteAppendProposalGetRequestSchema,
  CurrentNoteAppendProposalGetResultSchema,
  CurrentNoteReplaceProposalDecisionRequestSchema,
  CurrentNoteReplaceProposalDecisionResultSchema,
  CurrentNoteReplaceProposalGetRequestSchema,
  CurrentNoteReplaceProposalGetResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  KnowledgeLanguageMutationResultSchema,
  DIAGNOSTICS_CLEAR_LOCAL_CHANNEL,
  DIAGNOSTICS_WORKFLOW_SUMMARY_CHANNEL,
  DIAGNOSTICS_PREVIEW_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_EXPORT_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL,
  DIAGNOSTICS_RETRY_SUPPORT_BUNDLE_CHANNEL,
  DiagnosticsClearLocalRequestSchema,
  DiagnosticsClearLocalResultSchema,
  DiagnosticsHealthSchema,
  DiagnosticsExportSupportBundleRequestSchema,
  DiagnosticsExportSupportBundleResultSchema,
  DiagnosticsPreviewSupportBundleRequestSchema,
  DiagnosticsSupportBundleMutationRequestSchema,
  DiagnosticsSupportBundleMutationResultSchema,
  DiagnosticsWorkflowSummarySchema,
  SupportBundlePreviewSchema,
  BACKUP_CONTINUE_INCOMPLETE_CHANNEL,
  BackupContinueIncompleteRequestSchema,
  BackupContinueIncompleteResultSchema,
  BACKUP_CONVERSATION_PREFERENCE_STATUS_CHANNEL,
  BACKUP_SET_CONVERSATION_PREFERENCE_CHANNEL,
  BackupConversationPreferenceSummarySchema,
  BackupConversationPreferenceUpdateRequestSchema,
  BackupConversationPreferenceUpdateResultSchema,
  type BackupConversationPreferenceSummary,
  type BackupConversationPreferenceUpdateRequest,
  type BackupConversationPreferenceUpdateResult,
  BACKUP_TRASH_PREFERENCE_STATUS_CHANNEL,
  BACKUP_SET_TRASH_PREFERENCE_CHANNEL,
  BackupTrashPreferenceSummarySchema,
  BackupTrashPreferenceUpdateRequestSchema,
  BackupTrashPreferenceUpdateResultSchema,
  type BackupTrashPreferenceSummary,
  type BackupTrashPreferenceUpdateRequest,
  type BackupTrashPreferenceUpdateResult,
  BACKUP_MEMORY_PREFERENCE_STATUS_CHANNEL,
  BACKUP_SET_MEMORY_PREFERENCE_CHANNEL,
  BackupMemoryPreferenceSummarySchema,
  BackupMemoryPreferenceUpdateRequestSchema,
  BackupMemoryPreferenceUpdateResultSchema,
  type BackupMemoryPreferenceSummary,
  type BackupMemoryPreferenceUpdateRequest,
  type BackupMemoryPreferenceUpdateResult,
  PIGE_POLICY_STATUS_CHANNEL,
  PIGE_POLICY_UPDATE_CHANNEL,
  PigePolicySummarySchema,
  PigePolicyUpdateRequestSchema,
  PigePolicyUpdateResultSchema,
  type PigePolicySummary,
  type PigePolicyUpdateRequest,
  type PigePolicyUpdateResult,
  BACKUP_RECONNECT_DESTINATION_CHANNEL,
  BackupReconnectDestinationRequestSchema,
  BackupReconnectDestinationResultSchema,
  RESTORE_CANCEL_CHANNEL,
  RestoreCancelRequestSchema,
  RestoreCancelResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  ReferencedOriginalReconnectRequestSchema,
  ReferencedOriginalReconnectResultSchema,
  COLLECTION_ADD_FORMULA_COLUMN_CHANNEL,
  COLLECTION_ADD_RELATION_COLUMN_CHANNEL,
  COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL,
  COLLECTION_EDIT_RELATION_CELL_CHANNEL,
  COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL,
  COLLECTION_UPDATE_VIEW_CHANNEL,
  COLLECTION_RENAME_VIEW_CHANNEL,
  COLLECTION_TRASH_VIEW_CHANNEL,
  COLLECTION_TRASH_DATASET_CHANNEL,
  COLLECTION_RENAME_DATASET_CHANNEL,
  COLLECTION_REVEAL_CHANNEL,
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionUpdateRelationColumnRequestSchema,
  CollectionUpdateRelationColumnResultSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionAddLookupColumnRequestSchema,
  CollectionAddLookupColumnResultSchema,
  CollectionUpdateLookupColumnRequestSchema,
  CollectionUpdateLookupColumnResultSchema,
  CollectionAddRollupColumnRequestSchema,
  CollectionAddRollupColumnResultSchema,
  CollectionUpdateRollupColumnRequestSchema,
  CollectionUpdateRollupColumnResultSchema,
  CollectionUpdateFormulaColumnRequestSchema,
  CollectionUpdateFormulaColumnResultSchema,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionCellEditRequestSchema,
  CollectionCellEditResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionUpdateViewRequestSchema,
  CollectionUpdateViewResultSchema,
  CollectionRenameViewRequestSchema,
  CollectionRenameViewResultSchema,
  CollectionTrashViewRequestSchema,
  CollectionTrashViewResultSchema,
  CollectionTrashDatasetRequestSchema,
  CollectionTrashDatasetResultSchema,
  CollectionRenameDatasetRequestSchema,
  CollectionRenameDatasetResultSchema,
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionRevealRequestSchema,
  CollectionRevealResultSchema,
  CollectionListRequestSchema,
  CollectionListResultSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  LIBRARY_TAGS_CHANNEL,
  LIBRARY_BROWSE_CHANNEL,
  LibraryBrowseRequestSchema,
  LibraryBrowseResultSchema,
  LIBRARY_RENAME_TAG_CHANNEL,
  LIBRARY_MERGE_TAG_CHANNEL,
  LIBRARY_REMOVE_TAG_CHANNEL,
  LIBRARY_REMOVE_PAGE_TAG_CHANNEL,
  LibraryTagsRequestSchema,
  LibraryTagsResultSchema,
  LibraryRenameTagRequestSchema,
  LibraryRenameTagResultSchema,
  LIBRARY_RENAME_TOPIC_CHANNEL,
  LibraryRenameTopicRequestSchema,
  LibraryRenameTopicResultSchema,
  LibraryMergeTagRequestSchema,
  LibraryMergeTagResultSchema,
  LibraryRemoveTagRequestSchema,
  LibraryRemoveTagResultSchema,
  LibraryRemovePageTagRequestSchema,
  LibraryRemovePageTagResultSchema,
  KnowledgeActivityListRequestSchema,
  KnowledgeActivityListResultSchema,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthDuplicateTopicRepairRequestSchema,
  KnowledgeHealthDuplicateTopicRepairResultSchema,
  KnowledgeHealthTargetSearchRequestSchema,
  KnowledgeHealthTargetSearchResultSchema,
  KnowledgeHealthOrphanParentSearchRequestSchema,
  KnowledgeHealthOrphanParentSearchResultSchema,
  KnowledgeHealthOrphanRepairRequestSchema,
  KnowledgeHealthOrphanRepairResultSchema,
  KnowledgeHealthClaimSourceSearchRequestSchema,
  KnowledgeHealthClaimSourceSearchResultSchema,
  KnowledgeHealthClaimSourceRepairRequestSchema,
  KnowledgeHealthClaimSourceRepairResultSchema,
  MODEL_OPEN_API_KEY_MANAGEMENT_CHANNEL,
  ProviderApiKeyManagementRequestSchema,
  ProviderApiKeyManagementResultSchema,
  MANAGED_COPY_ROOT_CONFIGURE_CHANNEL,
  ManagedCopyRootConfigureRequestSchema,
  ManagedCopyRootConfigureResultSchema,
  ManagedCopyRootSummarySchema,
  VAULT_STORAGE_RELOCATE_CHANNEL,
  VAULT_STORAGE_RELOCATION_STATUS_CHANNEL,
  VaultStorageRelocationRequestSchema,
  VaultStorageRelocationResultSchema,
  VaultStorageRelocationStatusSchema,
  HighRiskConfirmationChangedEventSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationResolveResultSchema,
  JOB_CHANGED_EVENT_CHANNEL,
  JobChangedEventSchema,
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
  PermissionSetDefaultModeResultSchema,
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageCatalogQueryRequestSchema,
  PiPackageCatalogQueryResultSchema,
  PiPackageRegistryQueryResultSchema,
  PiPackageRestoreRequestSchema,
  PiPackageRestoreResultSchema,
  PiPackageRollbackRequestSchema,
  PiPackageRollbackResultSchema,
  PiPackageSetPinnedRequestSchema,
  PiPackageSetPinnedResultSchema,
  PiPackageSetEnabledRequestSchema,
  PiPackageSetEnabledResultSchema,
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
  DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
  DictationLanguagePreferenceRequestSchema,
  DictationLanguagePreferenceResultSchema,
  SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
  SetDictationLanguagePreferenceRequestSchema,
  SetDictationLanguagePreferenceResultSchema,
  LocalRerankerDisableRequestSchema,
  LocalRerankerDisableResultSchema,
  LocalRerankerEnableRequestSchema,
  LocalRerankerEnableResultSchema,
  LocalRerankerInstallRequestSchema,
  LocalRerankerInstallResultSchema,
  LocalRerankerRemoveRequestSchema,
  LocalRerankerRemoveResultSchema,
  LocalRerankerStatusRequestSchema,
  LocalRerankerStatusSchema,
  OCR_LANGUAGE_PREFERENCE_CHANNEL,
  OcrLanguagePreferenceRequestSchema,
  OcrLanguagePreferenceResultSchema,
  OCR_ENGINE_PREFERENCE_CHANNEL,
  SET_OCR_ENGINE_PREFERENCE_CHANNEL,
  OCR_IMAGE_TEST_CHANNEL,
  OcrImageTestRequestSchema,
  OcrImageTestResultSchema,
  OcrEnginePreferenceRequestSchema,
  OcrEnginePreferenceResultSchema,
  OCR_SUMMARY_PREFERENCE_CHANNEL,
  SET_OCR_SUMMARY_PREFERENCE_CHANNEL,
  OcrSummaryPreferenceRequestSchema,
  OcrSummaryPreferenceResultSchema,
  SetOcrSummaryPreferenceRequestSchema,
  SetOcrSummaryPreferenceResultSchema,
  SetOcrEnginePreferenceRequestSchema,
  SetOcrEnginePreferenceResultSchema,
  SET_OCR_LANGUAGE_PREFERENCE_CHANNEL,
  SetOcrLanguagePreferenceRequestSchema,
  SetOcrLanguagePreferenceResultSchema,
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
  NOTE_OPEN_SEARCH_MATCH_CHANNEL,
  NoteOpenSearchMatchRequestSchema,
  NoteOpenSearchMatchResultSchema,
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NOTE_MERGE_CHANNEL,
  NoteMergeRequestSchema,
  NoteMergeResultSchema,
  NOTE_RELATE_CHANNEL,
  NoteRelateRequestSchema,
  NoteRelateResultSchema,
  NOTE_UNLINK_RELATION_CHANNEL,
  NoteUnlinkRelationRequestSchema,
  NoteUnlinkRelationResultSchema,
  NOTE_IMPORT_MARKDOWN_CHANNEL,
  NoteImportMarkdownRequestSchema,
  NoteImportMarkdownResultSchema,
  NOTE_ARCHIVE_CURRENT_CHANNEL,
  NoteArchiveCurrentRequestSchema,
  NoteArchiveCurrentResultSchema,
  NOTE_RESTORE_ARCHIVED_CHANNEL,
  NoteRestoreArchivedRequestSchema,
  NoteRestoreArchivedResultSchema,
  NOTE_SET_QUESTION_STATE_CHANNEL,
  NoteSetQuestionStateRequestSchema,
  NoteSetQuestionStateResultSchema,
  NOTE_SET_CLAIM_CONFIDENCE_CHANNEL,
  NoteSetClaimConfidenceRequestSchema,
  NoteSetClaimConfidenceResultSchema,
  NOTE_SET_ENTITY_TYPE_CHANNEL,
  NoteSetEntityTypeRequestSchema,
  NoteSetEntityTypeResultSchema,
  NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL,
  NOTE_CHANGE_QUESTION_ANSWER_CHANNEL,
  NoteSearchQuestionAnswersRequestSchema,
  NoteSearchQuestionAnswersResultSchema,
  NoteChangeQuestionAnswerRequestSchema,
  NoteChangeQuestionAnswerResultSchema,
  NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL,
  NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL,
  NoteSearchClaimContradictionsRequestSchema,
  NoteSearchClaimContradictionsResultSchema,
  NoteChangeClaimContradictionRequestSchema,
  NoteChangeClaimContradictionResultSchema,
  NOTE_SEARCH_CONCEPT_PARENTS_CHANNEL,
  NOTE_CHANGE_CONCEPT_PARENT_CHANNEL,
  NoteSearchConceptParentsRequestSchema,
  NoteSearchConceptParentsResultSchema,
  NoteChangeConceptParentRequestSchema,
  NoteChangeConceptParentResultSchema,
  NOTE_SEARCH_TOPIC_PARENTS_CHANNEL,
  NOTE_CHANGE_TOPIC_PARENT_CHANNEL,
  NoteSearchTopicParentsRequestSchema,
  NoteSearchTopicParentsResultSchema,
  NoteChangeTopicParentRequestSchema,
  NoteChangeTopicParentResultSchema,
  NOTE_ADD_TAG_CHANNEL,
  NoteAddTagRequestSchema,
  NoteAddTagResultSchema,
  NOTE_EDIT_TAXONOMY_CHANNEL,
  NoteEditTaxonomyRequestSchema,
  NoteEditTaxonomyResultSchema,
  NOTE_RENAME_CHANNEL,
  NoteRenameRequestSchema,
  NoteRenameResultSchema,
  NOTE_CHANGE_ALIAS_CHANNEL,
  NoteAliasChangeRequestSchema,
  NoteAliasChangeResultSchema,
  NOTE_REMOVE_TAG_CHANNEL,
  NoteRemoveTagRequestSchema,
  NoteRemoveTagResultSchema,
  NOTE_TRASH_CURRENT_CHANNEL,
  NoteTrashCurrentRequestSchema,
  NoteTrashCurrentResultSchema,
  NOTE_TRASH_LIST_CHANNEL,
  NOTE_TRASH_RESTORE_CHANNEL,
  NoteTrashListRequestSchema,
  NoteTrashListResultSchema,
  NoteTrashRestoreRequestSchema,
  NoteTrashRestoreResultSchema,
  NOTE_REVISION_HISTORY_LIST_CHANNEL,
  NOTE_REVISION_HISTORY_OPEN_CHANNEL,
  NOTE_REVISION_HISTORY_RESTORE_CHANNEL,
  NoteRevisionHistoryListRequestSchema,
  NoteRevisionHistoryListResultSchema,
  NoteRevisionHistoryOpenRequestSchema,
  NoteRevisionHistoryOpenResultSchema,
  NoteRevisionHistoryRestoreRequestSchema,
  NoteRevisionHistoryRestoreResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  NoteReconnectOriginalSourceRequestSchema,
  NoteReconnectOriginalSourceResultSchema,
  SOURCE_REFRESH_PREVIEW_CHANNEL,
  SOURCE_REFRESH_CONFIRM_CHANNEL,
  SourceRefreshPreviewRequestSchema,
  SourceRefreshPreviewResultSchema,
  SourceRefreshConfirmRequestSchema,
  SourceRefreshConfirmResultSchema,
  SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL,
  SOURCE_RECONNECT_ORIGINAL_CHANNEL,
  SourceReconnectListRequestSchema,
  SourceReconnectListResultSchema,
  SourceReconnectRequestSchema,
  SourceReconnectResultSchema,
  NOTE_REVEAL_SOURCE_CHANNEL,
  NoteRevealSourceRequestSchema,
  NoteRevealSourceResultSchema,
  NOTE_REVEAL_GENERATED_CHANNEL,
  NoteRevealGeneratedRequestSchema,
  NoteRevealGeneratedResultSchema,
  NoteResolveInlineReferenceRequestSchema,
  NoteResolveInlineReferenceResultSchema,
  ReaderSelectionActionRequestSchema,
  ReaderSelectionActionResultSchema,
  ReaderSelectionCreateNoteRequestSchema,
  ReaderSelectionCreateNoteResultSchema,
  ReaderSelectionLinkRequestSchema,
  ReaderSelectionLinkResultSchema,
  ReaderSelectionProposalDecisionRequestSchema,
  ReaderSelectionProposalDecisionResultSchema,
  ReaderSelectionProposalGetRequestSchema,
  ReaderSelectionProposalGetResultSchema,
  ProposalReviewRequestSchema,
  ProposalReviewResultSchema,
  ProposalReviewDecisionRequestSchema,
  ProposalReviewDecisionResultSchema,
  ReaderSelectionTransformRequestSchema,
  ReaderSelectionTransformResultSchema,
  ReaderSelectionResolveRequestSchema,
  ReaderSelectionResolveResultSchema,
  OpenRecentVaultRequestSchema,
  VAULT_FORGET_RECENT_CHANNEL,
  VAULT_RECONNECT_RECENT_CHANNEL,
  VAULT_APPLY_MIGRATION_CHANNEL,
  VAULT_RENAME_DISPLAY_NAME_CHANNEL,
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
  TOOLCHAIN_REPAIR_CHANNEL,
  ToolchainRepairRequestSchema,
  ToolchainRepairResultSchema,
  UpdateApplyRequestSchema,
  UpdateApplyResultSchema,
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
  UpdateDownloadRequestSchema,
  UpdateDownloadResultSchema,
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
  SkillPendingStagedReviewsRequestSchema,
  SkillPendingStagedReviewsResultSchema,
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
  SkillRegistryQueryRequestSchema,
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
  SkillRestoreRequestSchema,
  SkillRestoreResultSchema,
  SkillUninstallRequestSchema,
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
  VaultRenameDisplayNameRequestSchema,
  VaultRenameDisplayNameResultSchema,
  RecentVaultForgetRequestSchema,
  RecentVaultForgetResultSchema,
  RecentVaultReconnectRequestSchema,
  RecentVaultReconnectResultSchema,
  RecentVaultSummaryProjectionSchema
} from "@pige/schemas";
import type {
  CollectionAddFormulaColumnRequest,
  CollectionAddFormulaColumnResult,
  CollectionAddRelationColumnRequest,
  CollectionAddRelationColumnResult,
  CollectionUpdateRelationColumnRequest,
  CollectionUpdateRelationColumnResult,
  CollectionEditRelationCellRequest,
  CollectionEditRelationCellResult,
  CollectionAddLookupColumnRequest,
  CollectionAddLookupColumnResult,
  CollectionUpdateLookupColumnRequest,
  CollectionUpdateLookupColumnResult,
  CollectionAddRollupColumnRequest,
  CollectionAddRollupColumnResult,
  CollectionUpdateRollupColumnRequest,
  CollectionUpdateRollupColumnResult,
  CollectionUpdateFormulaColumnRequest,
  CollectionUpdateFormulaColumnResult,
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionUpdateViewRequest,
  CollectionUpdateViewResult,
  CollectionRenameViewRequest,
  CollectionRenameViewResult,
  CollectionTrashViewRequest,
  CollectionTrashViewResult,
  CollectionTrashDatasetRequest,
  CollectionTrashDatasetResult,
  CollectionRenameDatasetRequest,
  CollectionRenameDatasetResult,
  CollectionOpenCitationRequest,
  CollectionOpenCitationResult,
  CollectionOpenRequest,
  CollectionOpenResult,
  CollectionRevealRequest,
  CollectionRevealResult,
  CollectionListRequest,
  CollectionListResult,
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
    {
      ...(parsedRequest.limit === undefined ? {} : { limit: parsedRequest.limit }),
      ...(parsedRequest.cursor === undefined ? {} : { cursor: parsedRequest.cursor })
    }
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
    })),
    hasMore: parsed.hasMore,
    ...(parsed.nextCursor === undefined ? {} : { nextCursor: parsed.nextCursor })
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

async function invokeCollectionReveal(request: CollectionRevealRequest): Promise<CollectionRevealResult> {
  const parsedRequest = CollectionRevealRequestSchema.parse(request);
  const result = CollectionRevealResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_REVEAL_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.revisionId !== parsedRequest.revisionId ||
      result.tableId !== parsedRequest.tableId) {
    throw new Error("Invalid Managed Collection reveal response identity.");
  }
  return result;
}

async function invokeCollectionOpenCitation(
  request: CollectionOpenCitationRequest
): Promise<CollectionOpenCitationResult> {
  const parsedRequest = CollectionOpenCitationRequestSchema.parse(request);
  const result = CollectionOpenCitationResultSchema.parse(
    await ipcRenderer.invoke("collections.openCitation", parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.conversationId !== parsedRequest.conversationId ||
    result.assistantEventId !== parsedRequest.assistantEventId ||
    result.citationRef !== parsedRequest.citationRef
  ) {
    throw new Error("Invalid Managed Collection citation response identity.");
  }
  return result;
}

async function invokeCollectionList(request: CollectionListRequest): Promise<CollectionListResult> {
  const parsedRequest = CollectionListRequestSchema.parse(request);
  const result = CollectionListResultSchema.parse(
    await ipcRenderer.invoke("collections.list", parsedRequest)
  );
  if (result.activeVaultId !== parsedRequest.activeVaultId) {
    throw new Error("Invalid Managed Collection list response identity.");
  }
  return result;
}

async function invokeLibraryTags(request: LibraryTagsRequest): Promise<LibraryTagsResult> {
  const parsedRequest = LibraryTagsRequestSchema.parse(request);
  const result = LibraryTagsResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_TAGS_CHANNEL, parsedRequest)
  );
  if (
    result.apiVersion !== parsedRequest.apiVersion ||
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.mode !== parsedRequest.mode ||
    (parsedRequest.mode === "list_pages_for_tag" &&
      (result.mode !== "list_pages_for_tag" || result.tag !== parsedRequest.tag))
  ) {
    throw new Error("Invalid Library tags response identity.");
  }
  return result;
}

async function invokeLibraryRenameTag(request: LibraryRenameTagRequest): Promise<LibraryRenameTagResult> {
  const parsedRequest = LibraryRenameTagRequestSchema.parse(request);
  const result = LibraryRenameTagResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_RENAME_TAG_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
    result.tag !== parsedRequest.tag || result.replacementTag !== parsedRequest.replacementTag ||
    result.expectedSnapshotId !== parsedRequest.expectedSnapshotId ||
    result.expectedPageCount !== parsedRequest.expectedPageCount) {
    throw new Error("Invalid Library tag rename response identity.");
  }
  return result;
}

async function invokeLibraryRenameTopic(request: LibraryRenameTopicRequest): Promise<LibraryRenameTopicResult> {
  const parsedRequest = LibraryRenameTopicRequestSchema.parse(request);
  const result = LibraryRenameTopicResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_RENAME_TOPIC_CHANNEL, parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.pageId !== parsedRequest.pageId ||
    result.expectedUpdatedAt !== parsedRequest.expectedUpdatedAt ||
    result.expectedRevision !== parsedRequest.expectedRevision ||
    result.expectedTitle !== parsedRequest.expectedTitle ||
    result.title !== parsedRequest.title
  ) throw new Error("Invalid Library Topic rename response identity.");
  return result;
}

async function invokeLibraryMergeTag(request: LibraryMergeTagRequest): Promise<LibraryMergeTagResult> {
  const parsedRequest = LibraryMergeTagRequestSchema.parse(request);
  const result = LibraryMergeTagResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_MERGE_TAG_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
    result.sourceTag !== parsedRequest.sourceTag || result.targetTag !== parsedRequest.targetTag ||
    result.expectedSnapshotId !== parsedRequest.expectedSnapshotId ||
    result.expectedSourcePageCount !== parsedRequest.expectedSourcePageCount ||
    result.expectedTargetPageCount !== parsedRequest.expectedTargetPageCount) {
    throw new Error("Invalid Library tag merge response identity.");
  }
  return result;
}

async function invokeLibraryRemoveTag(request: LibraryRemoveTagRequest): Promise<LibraryRemoveTagResult> {
  const parsedRequest = LibraryRemoveTagRequestSchema.parse(request);
  const result = LibraryRemoveTagResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_REMOVE_TAG_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
    result.tag !== parsedRequest.tag || result.expectedSnapshotId !== parsedRequest.expectedSnapshotId ||
    result.expectedPageCount !== parsedRequest.expectedPageCount) {
    throw new Error("Invalid Library tag remove response identity.");
  }
  return result;
}

async function invokeLibraryRemovePageTag(request: LibraryRemovePageTagRequest): Promise<LibraryRemovePageTagResult> {
  const parsedRequest = LibraryRemovePageTagRequestSchema.parse(request);
  const result = LibraryRemovePageTagResultSchema.parse(
    await ipcRenderer.invoke(LIBRARY_REMOVE_PAGE_TAG_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
    result.tag !== parsedRequest.tag || result.pageId !== parsedRequest.pageId ||
    result.expectedSnapshotId !== parsedRequest.expectedSnapshotId ||
    result.expectedPageUpdatedAt !== parsedRequest.expectedPageUpdatedAt) {
    throw new Error("Invalid Library page tag removal response identity.");
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

async function invokeCollectionAddFormulaColumn(
  request: CollectionAddFormulaColumnRequest
): Promise<CollectionAddFormulaColumnResult> {
  const parsedRequest = CollectionAddFormulaColumnRequestSchema.parse(request);
  const result = CollectionAddFormulaColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_ADD_FORMULA_COLUMN_CHANNEL, parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId
  ) {
    throw new Error("Invalid Managed Collection formula-column response identity.");
  }
  return result;
}

async function invokeCollectionUpdateFormulaColumn(
  request: CollectionUpdateFormulaColumnRequest
): Promise<CollectionUpdateFormulaColumnResult> {
  const parsedRequest = CollectionUpdateFormulaColumnRequestSchema.parse(request);
  const result = CollectionUpdateFormulaColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.columnId !== parsedRequest.columnId) {
    throw new Error("Invalid Managed Collection formula-update response identity.");
  }
  return result;
}

async function invokeCollectionAddRelationColumn(
  request: CollectionAddRelationColumnRequest
): Promise<CollectionAddRelationColumnResult> {
  const parsedRequest = CollectionAddRelationColumnRequestSchema.parse(request);
  const result = CollectionAddRelationColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_ADD_RELATION_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId ||
      result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.targetTableId !== parsedRequest.targetTableId ||
      result.targetDisplayColumnId !== parsedRequest.targetDisplayColumnId) {
    throw new Error("Invalid Managed Collection relation-column response identity.");
  }
  return result;
}

async function invokeCollectionUpdateRelationColumn(
  request: CollectionUpdateRelationColumnRequest
): Promise<CollectionUpdateRelationColumnResult> {
  const parsedRequest = CollectionUpdateRelationColumnRequestSchema.parse(request);
  const result = CollectionUpdateRelationColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.columnId !== parsedRequest.columnId || result.targetTableId !== parsedRequest.targetTableId ||
      result.targetDisplayColumnId !== parsedRequest.targetDisplayColumnId) {
    throw new Error("Invalid Managed Collection relation-update response identity.");
  }
  return result;
}

async function invokeCollectionEditRelationCell(
  request: CollectionEditRelationCellRequest
): Promise<CollectionEditRelationCellResult> {
  const parsedRequest = CollectionEditRelationCellRequestSchema.parse(request);
  const result = CollectionEditRelationCellResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_EDIT_RELATION_CELL_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId ||
      result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.rowId !== parsedRequest.rowId || result.columnId !== parsedRequest.columnId ||
      result.targetRowId !== parsedRequest.targetRowId) {
    throw new Error("Invalid Managed Collection relation-cell response identity.");
  }
  return result;
}

async function invokeCollectionAddLookupColumn(
  request: CollectionAddLookupColumnRequest
): Promise<CollectionAddLookupColumnResult> {
  const parsedRequest = CollectionAddLookupColumnRequestSchema.parse(request);
  const result = CollectionAddLookupColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId ||
      result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.relationColumnId !== parsedRequest.relationColumnId ||
      result.targetColumnId !== parsedRequest.targetColumnId) {
    throw new Error("Invalid Managed Collection lookup-column response identity.");
  }
  return result;
}

async function invokeCollectionUpdateLookupColumn(
  request: CollectionUpdateLookupColumnRequest
): Promise<CollectionUpdateLookupColumnResult> {
  const parsedRequest = CollectionUpdateLookupColumnRequestSchema.parse(request);
  const result = CollectionUpdateLookupColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.columnId !== parsedRequest.columnId || result.relationColumnId !== parsedRequest.relationColumnId ||
      result.targetColumnId !== parsedRequest.targetColumnId) {
    throw new Error("Invalid Managed Collection lookup-update response identity.");
  }
  return result;
}

async function invokeCollectionAddRollupColumn(
  request: CollectionAddRollupColumnRequest
): Promise<CollectionAddRollupColumnResult> {
  const parsedRequest = CollectionAddRollupColumnRequestSchema.parse(request);
  const result = CollectionAddRollupColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.relationColumnId !== parsedRequest.relationColumnId ||
      result.aggregation !== parsedRequest.aggregation || result.targetColumnId !== parsedRequest.targetColumnId) {
    throw new Error("Invalid Managed Collection rollup-column response identity.");
  }
  return result;
}

async function invokeCollectionUpdateRollupColumn(
  request: CollectionUpdateRollupColumnRequest
): Promise<CollectionUpdateRollupColumnResult> {
  const parsedRequest = CollectionUpdateRollupColumnRequestSchema.parse(request);
  const result = CollectionUpdateRollupColumnResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.tableId !== parsedRequest.tableId ||
      result.columnId !== parsedRequest.columnId || result.relationColumnId !== parsedRequest.relationColumnId ||
      result.aggregation !== parsedRequest.aggregation || result.targetColumnId !== parsedRequest.targetColumnId) {
    throw new Error("Invalid Managed Collection rollup-update response identity.");
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

async function invokeCollectionRenameView(
  request: CollectionRenameViewRequest
): Promise<CollectionRenameViewResult> {
  const parsedRequest = CollectionRenameViewRequestSchema.parse(request);
  const result = CollectionRenameViewResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_RENAME_VIEW_CHANNEL, parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.viewId !== parsedRequest.viewId
  ) throw new Error("Invalid Managed Collection view-rename response identity.");
  return result;
}

async function invokeCollectionUpdateView(
  request: CollectionUpdateViewRequest
): Promise<CollectionUpdateViewResult> {
  const parsedRequest = CollectionUpdateViewRequestSchema.parse(request);
  const result = CollectionUpdateViewResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_UPDATE_VIEW_CHANNEL, parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.viewId !== parsedRequest.viewId
  ) throw new Error("Invalid Managed Collection view-update response identity.");
  return result;
}

async function invokeCollectionTrashView(
  request: CollectionTrashViewRequest
): Promise<CollectionTrashViewResult> {
  const parsedRequest = CollectionTrashViewRequestSchema.parse(request);
  const result = CollectionTrashViewResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_TRASH_VIEW_CHANNEL, parsedRequest)
  );
  if (
    result.requestId !== parsedRequest.requestId ||
    result.activeVaultId !== parsedRequest.activeVaultId ||
    result.datasetId !== parsedRequest.datasetId ||
    result.tableId !== parsedRequest.tableId ||
    result.viewId !== parsedRequest.viewId
  ) throw new Error("Invalid Managed Collection view-trash response identity.");
  return result;
}

async function invokeCollectionTrashDataset(
  request: CollectionTrashDatasetRequest
): Promise<CollectionTrashDatasetResult> {
  const parsedRequest = CollectionTrashDatasetRequestSchema.parse(request);
  const result = CollectionTrashDatasetResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_TRASH_DATASET_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.expectedRevisionId !== parsedRequest.expectedRevisionId) {
    throw new Error("Invalid Managed Dataset trash response identity.");
  }
  return result;
}

async function invokeCollectionRenameDataset(
  request: CollectionRenameDatasetRequest
): Promise<CollectionRenameDatasetResult> {
  const parsedRequest = CollectionRenameDatasetRequestSchema.parse(request);
  const result = CollectionRenameDatasetResultSchema.parse(
    await ipcRenderer.invoke(COLLECTION_RENAME_DATASET_CHANNEL, parsedRequest)
  );
  if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
      result.datasetId !== parsedRequest.datasetId || result.expectedRevisionId !== parsedRequest.expectedRevisionId) {
    throw new Error("Invalid Managed Dataset rename response identity.");
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
  const completenessCounts = [
    manifest.externalDependencyCount,
    manifest.includedExternalDependencyCount,
    manifest.missingRequiredExternalDependencyCount
  ];
  if (
    completenessCounts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    manifest.includedExternalDependencyCount > manifest.externalDependencyCount ||
    manifest.missingRequiredExternalDependencyCount > manifest.externalDependencyCount ||
    manifest.externalDependenciesComplete !== (manifest.missingRequiredExternalDependencyCount === 0)
  ) throw new Error("Invalid backup completeness response.");
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
    externalDependencyCount: manifest.externalDependencyCount,
    includedExternalDependencyCount: manifest.includedExternalDependencyCount,
    missingRequiredExternalDependencyCount: manifest.missingRequiredExternalDependencyCount,
    externalDependenciesComplete: manifest.externalDependenciesComplete,
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
  if (parsed.status !== "completed") return parsed;

  return {
    status: "completed",
    compatibility: "current",
    vault: projectVaultSummary(parsed.vault),
    onboarding: projectOnboarding(parsed.onboarding)
  };
}

function projectVaultSummary(vault: {
  readonly vaultId: string;
  readonly name: string;
  readonly metadataRevision?: VaultSummary["metadataRevision"];
  readonly activeVaultPathDisplay: string;
  readonly knowledgeRootDisplay: string;
  readonly sourceAssetRootDisplay: string;
  readonly sourceAssetRootKind: VaultSummary["sourceAssetRootKind"];
  readonly managedCopyRoot: ManagedCopyRootSummary;
  readonly defaultSourceStorageStrategy: VaultSummary["defaultSourceStorageStrategy"];
  readonly schemaVersion: number;
  readonly counts?: VaultSummary["counts"] | undefined;
  readonly lastBackupAt?: string | undefined;
}): VaultSummary {
  return {
    vaultId: vault.vaultId,
    name: vault.name,
    ...(vault.metadataRevision ? { metadataRevision: vault.metadataRevision } : {}),
    activeVaultPathDisplay: vault.activeVaultPathDisplay,
    knowledgeRootDisplay: vault.knowledgeRootDisplay,
    sourceAssetRootDisplay: vault.sourceAssetRootDisplay,
    sourceAssetRootKind: vault.sourceAssetRootKind,
    managedCopyRoot: ManagedCopyRootSummarySchema.parse(vault.managedCopyRoot),
    defaultSourceStorageStrategy: vault.defaultSourceStorageStrategy,
    schemaVersion: vault.schemaVersion,
    ...(vault.counts ? { counts: vault.counts } : {}),
    ...(vault.lastBackupAt ? { lastBackupAt: vault.lastBackupAt } : {})
  };
}

function sameRecentMutationIdentity(
  request: RecentVaultForgetRequest | RecentVaultReconnectRequest,
  result: RecentVaultForgetResult | RecentVaultReconnectResult
): boolean {
  return result.apiVersion === request.apiVersion &&
    result.requestId === request.requestId &&
    result.vaultId === request.vaultId &&
    result.expectedRevision === request.expectedRevision;
}

function projectOnboarding(onboarding: {
  readonly state: OnboardingStatus["state"];
  readonly activeVault?: Parameters<typeof projectVaultSummary>[0] | undefined;
  readonly hasDefaultModel: boolean;
  readonly showFirstHomeGuide: boolean;
  readonly waitingDependencyCounts?: OnboardingStatus["waitingDependencyCounts"] | undefined;
}): OnboardingStatus {
  return {
    state: onboarding.state,
    ...(onboarding.activeVault ? { activeVault: projectVaultSummary(onboarding.activeVault) } : {}),
    hasDefaultModel: onboarding.hasDefaultModel,
    showFirstHomeGuide: onboarding.showFirstHomeGuide,
    ...(onboarding.waitingDependencyCounts ? { waitingDependencyCounts: onboarding.waitingDependencyCounts } : {})
  };
}

function projectVaultMigrationApplyResult(value: unknown): VaultMigrationApplyResult {
  const parsed = VaultMigrationApplyResultSchema.parse(value);
  if (parsed.status !== "completed") return parsed;
  return {
    apiVersion: 1,
    requestId: parsed.requestId,
    vaultId: parsed.vaultId,
    previewId: parsed.previewId,
    status: "completed",
    jobId: parsed.jobId,
    operationId: parsed.operationId,
    vault: projectVaultSummary(parsed.vault),
    onboarding: projectOnboarding(parsed.onboarding)
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
    conversationHistory: async (
      request: AgentConversationHistoryListRequest
    ): Promise<AgentConversationHistoryListResult> => {
      const parsedRequest = AgentConversationHistoryListRequestSchema.parse(request);
      const result = AgentConversationHistoryListResultSchema.parse(
        await ipcRenderer.invoke("agent.conversationHistory", parsedRequest) as unknown
      );
      if (result.activeVaultId !== parsedRequest.activeVaultId || result.query !== parsedRequest.query) {
        throw new Error("Invalid conversation history response identity.");
      }
      return result;
    },
    exportConversation: async (
      request: AgentConversationExportRequest
    ): Promise<AgentConversationExportResult> => {
      const parsedRequest = AgentConversationExportRequestSchema.parse(request);
      const result = AgentConversationExportResultSchema.parse(
        await ipcRenderer.invoke(AGENT_CONVERSATION_EXPORT_CHANNEL, parsedRequest)
      );
      if (result.requestId !== parsedRequest.requestId ||
          result.activeVaultId !== parsedRequest.activeVaultId ||
          result.conversationId !== parsedRequest.conversationId ||
          ((result.status === "exported" || result.status === "cancelled") &&
            result.tailEventId !== parsedRequest.expectedTailEventId)) {
        throw new Error("Invalid conversation export response identity.");
      }
      return result;
    },
    trashConversation: async (request: ConversationTrashRequest): Promise<ConversationTrashResult> => {
      const parsedRequest = ConversationTrashRequestSchema.parse(request);
      return ConversationTrashResultSchema.parse(await ipcRenderer.invoke("agent.trashConversation", parsedRequest));
    },
    conversationTrash: async (request: ConversationTrashListRequest): Promise<ConversationTrashListResult> => {
      const parsedRequest = ConversationTrashListRequestSchema.parse(request);
      return ConversationTrashListResultSchema.parse(await ipcRenderer.invoke("agent.conversationTrash", parsedRequest));
    },
    restoreConversation: async (request: ConversationRestoreRequest): Promise<ConversationRestoreResult> => {
      const parsedRequest = ConversationRestoreRequestSchema.parse(request);
      return ConversationRestoreResultSchema.parse(await ipcRenderer.invoke("agent.restoreConversation", parsedRequest));
    },
    setConversationTitle: async (
      request: AgentConversationSetTitleRequest
    ): Promise<AgentConversationSetTitleResult> => {
      const parsedRequest = AgentConversationSetTitleRequestSchema.parse(request);
      const result = AgentConversationSetTitleResultSchema.parse(
        await ipcRenderer.invoke("agent.setConversationTitle", parsedRequest) as unknown
      );
      if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId ||
        result.conversationId !== parsedRequest.conversationId) {
        throw new Error("Invalid conversation title response identity.");
      }
      return result;
    },
    saveAnswerAsNote: async (
      request: AgentSaveAnswerAsNoteRequest
    ): Promise<AgentSaveAnswerAsNoteResult> => {
      const parsedRequest = AgentSaveAnswerAsNoteRequestSchema.parse(request);
      const result = AgentSaveAnswerAsNoteResultSchema.parse(
        await ipcRenderer.invoke(AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL, parsedRequest) as unknown
      );
      if (
        result.requestId !== parsedRequest.requestId ||
        result.activeVaultId !== parsedRequest.activeVaultId ||
        result.conversationId !== parsedRequest.conversationId ||
        result.assistantEventId !== parsedRequest.assistantEventId
      ) {
        throw new Error("Invalid saved-answer response identity.");
      }
      return result;
    },
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
      )),
    currentNoteReplaceProposal: async (
      request: CurrentNoteReplaceProposalGetRequest
    ): Promise<CurrentNoteReplaceProposalGetResult> =>
      CurrentNoteReplaceProposalGetResultSchema.parse(await ipcRenderer.invoke(
        "agent.currentNoteReplaceProposal",
        CurrentNoteReplaceProposalGetRequestSchema.parse(request)
      )),
    decideCurrentNoteReplaceProposal: async (
      request: CurrentNoteReplaceProposalDecisionRequest
    ): Promise<CurrentNoteReplaceProposalDecisionResult> =>
      CurrentNoteReplaceProposalDecisionResultSchema.parse(await ipcRenderer.invoke(
        "agent.decideCurrentNoteReplaceProposal",
        CurrentNoteReplaceProposalDecisionRequestSchema.parse(request)
      ))
  },
  jobs: {
    list: async (request?: JobsListRequest): Promise<JobsListResult> =>
      ipcRenderer.invoke("jobs.list", request) as Promise<JobsListResult>,
    cancel: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.cancel", request) as Promise<JobActionResult>,
    retry: async (request: JobActionRequest): Promise<JobActionResult> =>
      ipcRenderer.invoke("jobs.retry", request) as Promise<JobActionResult>,
    onChanged: (listener: (event: JobChangedEvent) => void): (() => void) => {
      const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
        listener(JobChangedEventSchema.parse(value));
      };
      ipcRenderer.on(JOB_CHANGED_EVENT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(JOB_CHANGED_EVENT_CHANNEL, wrapped);
    },
    reconnectOriginalSource: async (
      request: ReferencedOriginalReconnectRequest
    ): Promise<ReferencedOriginalReconnectResult> =>
      ReferencedOriginalReconnectResultSchema.parse(await ipcRenderer.invoke(
        JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
        ReferencedOriginalReconnectRequestSchema.parse(request)
      ))
  },
  sources: {
    reconnectableOriginals: async (
      request: SourceReconnectListRequest
    ): Promise<SourceReconnectListResult> =>
      SourceReconnectListResultSchema.parse(await ipcRenderer.invoke(
        SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL,
        SourceReconnectListRequestSchema.parse(request)
      )),
    reconnectOriginal: async (
      request: SourceReconnectRequest
    ): Promise<SourceReconnectResult> =>
      SourceReconnectResultSchema.parse(await ipcRenderer.invoke(
        SOURCE_RECONNECT_ORIGINAL_CHANNEL,
        SourceReconnectRequestSchema.parse(request)
      ))
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
  permissions: {
    summary: async (
      request: PermissionPolicySummaryRequest
    ): Promise<PermissionPolicySummaryResult> =>
      PermissionPolicySummaryResultSchema.parse(await ipcRenderer.invoke(
        PERMISSIONS_SUMMARY_CHANNEL,
        PermissionPolicySummaryRequestSchema.parse(request)
      )),
    setDefaultMode: async (
      request: PermissionSetDefaultModeRequest
    ): Promise<PermissionSetDefaultModeResult> =>
      PermissionSetDefaultModeResultSchema.parse(await ipcRenderer.invoke(
        PERMISSIONS_SET_DEFAULT_MODE_CHANNEL,
        PermissionSetDefaultModeRequestSchema.parse(request)
      )),
    revokeGrant: async (
      request: PermissionRevokeGrantRequest
    ): Promise<PermissionRevokeGrantResult> =>
      PermissionRevokeGrantResultSchema.parse(await ipcRenderer.invoke(
        PERMISSIONS_REVOKE_GRANT_CHANNEL,
        PermissionRevokeGrantRequestSchema.parse(request)
      )),
    onChanged: (listener: (event: PermissionPolicyChangedEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = PermissionPolicyChangedEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(PERMISSIONS_CHANGED_CHANNEL, handler);
      return () => ipcRenderer.removeListener(PERMISSIONS_CHANGED_CHANNEL, handler);
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
    restore: async (request: PiPackageRestoreRequest): Promise<PiPackageRestoreResult> =>
      PiPackageRestoreResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.restore",
        PiPackageRestoreRequestSchema.parse(request)
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
      )),
    setEnabled: async (request: PiPackageSetEnabledRequest): Promise<PiPackageSetEnabledResult> =>
      PiPackageSetEnabledResultSchema.parse(await ipcRenderer.invoke(
        "piPackages.setEnabled",
        PiPackageSetEnabledRequestSchema.parse(request)
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
    summary: async (request: SkillRegistryQueryRequest): Promise<SkillRegistryQueryResult> =>
      SkillRegistryQueryResultSchema.parse(await ipcRenderer.invoke("skills.summary",
        SkillRegistryQueryRequestSchema.parse(request))),
    pendingStagedReviews: async (
      request: SkillPendingStagedReviewsRequest
    ): Promise<SkillPendingStagedReviewsResult> =>
      SkillPendingStagedReviewsResultSchema.parse(await ipcRenderer.invoke(
        "skills.pendingStagedReviews",
        SkillPendingStagedReviewsRequestSchema.parse(request)
      )),
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
    restore: async (request: SkillRestoreRequest): Promise<SkillRestoreResult> =>
      SkillRestoreResultSchema.parse(await ipcRenderer.invoke(
        "skills.restore",
        SkillRestoreRequestSchema.parse(request)
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
      ipcRenderer.invoke("activity.undo", request) as Promise<KnowledgeActivityUndoResult>,
    redo: async (request: KnowledgeActivityRedoRequest): Promise<KnowledgeActivityRedoResult> =>
      ipcRenderer.invoke("activity.redo", request) as Promise<KnowledgeActivityRedoResult>
  },
  collections: {
    list: invokeCollectionList,
    open: invokeCollectionOpen,
    reveal: invokeCollectionReveal,
    openCitation: invokeCollectionOpenCitation,
    editCell: invokeCollectionCellEdit,
    appendDefaultRow: invokeCollectionAppendDefaultRow,
    addNullableColumn: invokeCollectionAddNullableColumn,
    addFormulaColumn: invokeCollectionAddFormulaColumn,
    updateFormulaColumn: invokeCollectionUpdateFormulaColumn,
    addRelationColumn: invokeCollectionAddRelationColumn,
    updateRelationColumn: invokeCollectionUpdateRelationColumn,
    editRelationCell: invokeCollectionEditRelationCell,
    addLookupColumn: invokeCollectionAddLookupColumn,
    updateLookupColumn: invokeCollectionUpdateLookupColumn,
    addRollupColumn: invokeCollectionAddRollupColumn,
    updateRollupColumn: invokeCollectionUpdateRollupColumn,
    renameColumn: invokeCollectionRenameColumn,
    createView: invokeCollectionCreateView,
    updateView: invokeCollectionUpdateView,
    renameView: invokeCollectionRenameView,
    trashView: invokeCollectionTrashView,
    trashDataset: invokeCollectionTrashDataset,
    renameDataset: invokeCollectionRenameDataset,
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
      ipcRenderer.invoke("proposals.reject", request) as Promise<ProposalDecisionResult>,
    review: async (request: ProposalReviewRequest): Promise<ProposalReviewResult> =>
      ProposalReviewResultSchema.parse(await ipcRenderer.invoke(
        "proposals.review",
        ProposalReviewRequestSchema.parse(request)
      )),
    decide: async (request: ProposalReviewDecisionRequest): Promise<ProposalReviewDecisionResult> =>
      ProposalReviewDecisionResultSchema.parse(await ipcRenderer.invoke(
        "proposals.decide",
        ProposalReviewDecisionRequestSchema.parse(request)
      ))
  },
  library: {
    list: async (request?: LibraryListRequest): Promise<LibraryListResult> =>
      ipcRenderer.invoke("library.list", request) as Promise<LibraryListResult>,
    browse: async (request: LibraryBrowseRequest): Promise<LibraryBrowseResult> => {
      const parsed = LibraryBrowseRequestSchema.parse(request);
      const result = LibraryBrowseResultSchema.parse(
        await ipcRenderer.invoke(LIBRARY_BROWSE_CHANNEL, parsed)
      );
      if (result.requestId !== parsed.requestId || result.activeVaultId !== parsed.activeVaultId) {
        throw new Error("Library browse response identity mismatch.");
      }
      return result;
    },
    tree: async (): Promise<KnowledgeTreeResult> =>
      ipcRenderer.invoke("library.tree") as Promise<KnowledgeTreeResult>,
    related: async (request: LibraryRelatedRequest): Promise<LibraryRelatedResult> =>
      ipcRenderer.invoke("library.related", request) as Promise<LibraryRelatedResult>,
    tags: invokeLibraryTags,
    renameTag: invokeLibraryRenameTag,
    renameTopic: invokeLibraryRenameTopic,
    mergeTag: invokeLibraryMergeTag,
    removeTag: invokeLibraryRemoveTag,
    removePageTag: invokeLibraryRemovePageTag
  },
  notes: {
    get: async (request: NoteGetRequest): Promise<NoteDocument> =>
      ipcRenderer.invoke("notes.get", request) as Promise<NoteDocument>,
    render: async (request: NoteRenderRequest): Promise<NoteRenderResult> =>
      ipcRenderer.invoke("notes.render", request) as Promise<NoteRenderResult>,
    openSearchMatch: async (
      request: NoteOpenSearchMatchRequest
    ): Promise<NoteOpenSearchMatchResult> => {
      const parsed = NoteOpenSearchMatchRequestSchema.parse(request);
      const result = NoteOpenSearchMatchResultSchema.parse(
        await ipcRenderer.invoke(NOTE_OPEN_SEARCH_MATCH_CHANNEL, parsed)
      );
      if (
        result.requestId !== parsed.requestId ||
        result.activeVaultId !== parsed.activeVaultId ||
        result.pageId !== parsed.pageId
      ) {
        throw new Error("Search focus response identity mismatch.");
      }
      return result;
    },
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
    merge: async (request: NoteMergeRequest): Promise<NoteMergeResult> =>
      NoteMergeResultSchema.parse(
        await ipcRenderer.invoke(NOTE_MERGE_CHANNEL, NoteMergeRequestSchema.parse(request))
      ),
    relate: async (request: NoteRelateRequest): Promise<NoteRelateResult> =>
      NoteRelateResultSchema.parse(
        await ipcRenderer.invoke(NOTE_RELATE_CHANNEL, NoteRelateRequestSchema.parse(request))
      ),
    unlinkRelation: async (request: NoteUnlinkRelationRequest): Promise<NoteUnlinkRelationResult> =>
      NoteUnlinkRelationResultSchema.parse(
        await ipcRenderer.invoke(NOTE_UNLINK_RELATION_CHANNEL, NoteUnlinkRelationRequestSchema.parse(request))
      ),
    importMarkdown: async (request: NoteImportMarkdownRequest): Promise<NoteImportMarkdownResult> =>
      NoteImportMarkdownResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_IMPORT_MARKDOWN_CHANNEL,
          NoteImportMarkdownRequestSchema.parse(request)
        )
      ),
    archiveCurrent: async (request: NoteArchiveCurrentRequest): Promise<NoteArchiveCurrentResult> =>
      NoteArchiveCurrentResultSchema.parse(
        await ipcRenderer.invoke(NOTE_ARCHIVE_CURRENT_CHANNEL, NoteArchiveCurrentRequestSchema.parse(request))
      ),
    restoreArchived: async (request: NoteRestoreArchivedRequest): Promise<NoteRestoreArchivedResult> =>
      NoteRestoreArchivedResultSchema.parse(
        await ipcRenderer.invoke(NOTE_RESTORE_ARCHIVED_CHANNEL, NoteRestoreArchivedRequestSchema.parse(request))
      ),
    setQuestionState: async (request: NoteSetQuestionStateRequest): Promise<NoteSetQuestionStateResult> =>
      NoteSetQuestionStateResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_SET_QUESTION_STATE_CHANNEL,
          NoteSetQuestionStateRequestSchema.parse(request)
        )
      ),
    setClaimConfidence: async (request: NoteSetClaimConfidenceRequest): Promise<NoteSetClaimConfidenceResult> =>
      NoteSetClaimConfidenceResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_SET_CLAIM_CONFIDENCE_CHANNEL,
          NoteSetClaimConfidenceRequestSchema.parse(request)
        )
      ),
    setEntityType: async (request: NoteSetEntityTypeRequest): Promise<NoteSetEntityTypeResult> =>
      NoteSetEntityTypeResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_SET_ENTITY_TYPE_CHANNEL,
          NoteSetEntityTypeRequestSchema.parse(request)
        )
      ),
    searchQuestionAnswers: async (request: NoteSearchQuestionAnswersRequest): Promise<NoteSearchQuestionAnswersResult> =>
      NoteSearchQuestionAnswersResultSchema.parse(await ipcRenderer.invoke(
        NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL, NoteSearchQuestionAnswersRequestSchema.parse(request))),
    changeQuestionAnswer: async (request: NoteChangeQuestionAnswerRequest): Promise<NoteChangeQuestionAnswerResult> =>
      NoteChangeQuestionAnswerResultSchema.parse(await ipcRenderer.invoke(
        NOTE_CHANGE_QUESTION_ANSWER_CHANNEL, NoteChangeQuestionAnswerRequestSchema.parse(request))),
    searchClaimContradictions: async (
      request: NoteSearchClaimContradictionsRequest
    ): Promise<NoteSearchClaimContradictionsResult> =>
      NoteSearchClaimContradictionsResultSchema.parse(await ipcRenderer.invoke(
        NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL,
        NoteSearchClaimContradictionsRequestSchema.parse(request)
      )),
    changeClaimContradiction: async (
      request: NoteChangeClaimContradictionRequest
    ): Promise<NoteChangeClaimContradictionResult> =>
      NoteChangeClaimContradictionResultSchema.parse(await ipcRenderer.invoke(
        NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL,
        NoteChangeClaimContradictionRequestSchema.parse(request)
      )),
    searchConceptParents: async (
      request: NoteSearchConceptParentsRequest
    ): Promise<NoteSearchConceptParentsResult> =>
      NoteSearchConceptParentsResultSchema.parse(await ipcRenderer.invoke(
        NOTE_SEARCH_CONCEPT_PARENTS_CHANNEL,
        NoteSearchConceptParentsRequestSchema.parse(request)
      )),
    changeConceptParent: async (
      request: NoteChangeConceptParentRequest
    ): Promise<NoteChangeConceptParentResult> =>
      NoteChangeConceptParentResultSchema.parse(await ipcRenderer.invoke(
        NOTE_CHANGE_CONCEPT_PARENT_CHANNEL,
        NoteChangeConceptParentRequestSchema.parse(request)
      )),
    searchTopicParents: async (
      request: NoteSearchTopicParentsRequest
    ): Promise<NoteSearchTopicParentsResult> =>
      NoteSearchTopicParentsResultSchema.parse(await ipcRenderer.invoke(
        NOTE_SEARCH_TOPIC_PARENTS_CHANNEL,
        NoteSearchTopicParentsRequestSchema.parse(request)
      )),
    changeTopicParent: async (
      request: NoteChangeTopicParentRequest
    ): Promise<NoteChangeTopicParentResult> =>
      NoteChangeTopicParentResultSchema.parse(await ipcRenderer.invoke(
        NOTE_CHANGE_TOPIC_PARENT_CHANNEL,
        NoteChangeTopicParentRequestSchema.parse(request)
      )),
    addTag: async (request: NoteAddTagRequest): Promise<NoteAddTagResult> =>
      NoteAddTagResultSchema.parse(
        await ipcRenderer.invoke(NOTE_ADD_TAG_CHANNEL, NoteAddTagRequestSchema.parse(request))
      ),
    editTaxonomy: async (request: NoteEditTaxonomyRequest): Promise<NoteEditTaxonomyResult> =>
      NoteEditTaxonomyResultSchema.parse(
        await ipcRenderer.invoke(NOTE_EDIT_TAXONOMY_CHANNEL, NoteEditTaxonomyRequestSchema.parse(request))
      ),
    rename: async (request: NoteRenameRequest): Promise<NoteRenameResult> =>
      NoteRenameResultSchema.parse(
        await ipcRenderer.invoke(NOTE_RENAME_CHANNEL, NoteRenameRequestSchema.parse(request))
      ),
    changeAlias: async (request: NoteAliasChangeRequest): Promise<NoteAliasChangeResult> =>
      NoteAliasChangeResultSchema.parse(
        await ipcRenderer.invoke(NOTE_CHANGE_ALIAS_CHANNEL, NoteAliasChangeRequestSchema.parse(request))
      ),
    removeTag: async (request: NoteRemoveTagRequest): Promise<NoteRemoveTagResult> =>
      NoteRemoveTagResultSchema.parse(
        await ipcRenderer.invoke(NOTE_REMOVE_TAG_CHANNEL, NoteRemoveTagRequestSchema.parse(request))
      ),
    trashCurrent: async (request: NoteTrashCurrentRequest): Promise<NoteTrashCurrentResult> =>
      NoteTrashCurrentResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_TRASH_CURRENT_CHANNEL,
          NoteTrashCurrentRequestSchema.parse(request)
        )
      ),
    listTrash: async (request: NoteTrashListRequest): Promise<NoteTrashListResult> =>
      NoteTrashListResultSchema.parse(
        await ipcRenderer.invoke(NOTE_TRASH_LIST_CHANNEL, NoteTrashListRequestSchema.parse(request))
      ),
    restoreTrash: async (request: NoteTrashRestoreRequest): Promise<NoteTrashRestoreResult> =>
      NoteTrashRestoreResultSchema.parse(
        await ipcRenderer.invoke(NOTE_TRASH_RESTORE_CHANNEL, NoteTrashRestoreRequestSchema.parse(request))
      ),
    listRevisionHistory: async (
      request: NoteRevisionHistoryListRequest
    ): Promise<NoteRevisionHistoryListResult> => NoteRevisionHistoryListResultSchema.parse(
      await ipcRenderer.invoke(
        NOTE_REVISION_HISTORY_LIST_CHANNEL,
        NoteRevisionHistoryListRequestSchema.parse(request)
      )
    ),
    openRevisionHistory: async (
      request: NoteRevisionHistoryOpenRequest
    ): Promise<NoteRevisionHistoryOpenResult> => NoteRevisionHistoryOpenResultSchema.parse(
      await ipcRenderer.invoke(
        NOTE_REVISION_HISTORY_OPEN_CHANNEL,
        NoteRevisionHistoryOpenRequestSchema.parse(request)
      )
    ),
    restoreRevisionHistory: async (
      request: NoteRevisionHistoryRestoreRequest
    ): Promise<NoteRevisionHistoryRestoreResult> => NoteRevisionHistoryRestoreResultSchema.parse(
      await ipcRenderer.invoke(
        NOTE_REVISION_HISTORY_RESTORE_CHANNEL,
        NoteRevisionHistoryRestoreRequestSchema.parse(request)
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
      ),
    revealSource: async (
      request: NoteRevealSourceRequest
    ): Promise<NoteRevealSourceResult> =>
      NoteRevealSourceResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_REVEAL_SOURCE_CHANNEL,
          NoteRevealSourceRequestSchema.parse(request)
        )
      ),
    revealGenerated: async (
      request: NoteRevealGeneratedRequest
    ): Promise<NoteRevealGeneratedResult> =>
      NoteRevealGeneratedResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_REVEAL_GENERATED_CHANNEL,
          NoteRevealGeneratedRequestSchema.parse(request)
        )
      ),
    reconnectOriginalSource: async (
      request: NoteReconnectOriginalSourceRequest
    ): Promise<NoteReconnectOriginalSourceResult> =>
      NoteReconnectOriginalSourceResultSchema.parse(
        await ipcRenderer.invoke(
          NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
          NoteReconnectOriginalSourceRequestSchema.parse(request)
        )
      )
  },
  sourceRefresh: {
    preview: async (request: SourceRefreshPreviewRequest): Promise<SourceRefreshPreviewResult> =>
      SourceRefreshPreviewResultSchema.parse(await ipcRenderer.invoke(
        SOURCE_REFRESH_PREVIEW_CHANNEL,
        SourceRefreshPreviewRequestSchema.parse(request)
      )),
    confirm: async (request: SourceRefreshConfirmRequest): Promise<SourceRefreshConfirmResult> =>
      SourceRefreshConfirmResultSchema.parse(await ipcRenderer.invoke(
        SOURCE_REFRESH_CONFIRM_CHANNEL,
        SourceRefreshConfirmRequestSchema.parse(request)
      ))
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
    submitCreateNote: async (
      request: ReaderSelectionCreateNoteRequest
    ): Promise<ReaderSelectionCreateNoteResult> =>
      ReaderSelectionCreateNoteResultSchema.parse(
        await ipcRenderer.invoke(
          "readerSelection.submitCreateNote",
          ReaderSelectionCreateNoteRequestSchema.parse(request)
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
    ocrEnginePreference: async (
      request: OcrEnginePreferenceRequest
    ): Promise<OcrEnginePreferenceResult> =>
      OcrEnginePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          OCR_ENGINE_PREFERENCE_CHANNEL,
          OcrEnginePreferenceRequestSchema.parse(request)
        )
      ),
    setOcrEnginePreference: async (
      request: SetOcrEnginePreferenceRequest
    ): Promise<SetOcrEnginePreferenceResult> =>
      SetOcrEnginePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          SET_OCR_ENGINE_PREFERENCE_CHANNEL,
          SetOcrEnginePreferenceRequestSchema.parse(request)
        )
      ),
    ocrSummaryPreference: async (
      request: OcrSummaryPreferenceRequest
    ): Promise<OcrSummaryPreferenceResult> =>
      OcrSummaryPreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          OCR_SUMMARY_PREFERENCE_CHANNEL,
          OcrSummaryPreferenceRequestSchema.parse(request)
        )
      ),
    setOcrSummaryPreference: async (
      request: SetOcrSummaryPreferenceRequest
    ): Promise<SetOcrSummaryPreferenceResult> =>
      SetOcrSummaryPreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          SET_OCR_SUMMARY_PREFERENCE_CHANNEL,
          SetOcrSummaryPreferenceRequestSchema.parse(request)
        )
      ),
    testOcrImage: async (
      request: OcrImageTestRequest
    ): Promise<OcrImageTestResult> =>
      OcrImageTestResultSchema.parse(
        await ipcRenderer.invoke(
          OCR_IMAGE_TEST_CHANNEL,
          OcrImageTestRequestSchema.parse(request)
        )
      ),
    dictationLanguagePreference: async (
      request: DictationLanguagePreferenceRequest
    ): Promise<DictationLanguagePreferenceResult> =>
      DictationLanguagePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
          DictationLanguagePreferenceRequestSchema.parse(request)
        )
      ),
    setDictationLanguagePreference: async (
      request: SetDictationLanguagePreferenceRequest
    ): Promise<SetDictationLanguagePreferenceResult> =>
      SetDictationLanguagePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL,
          SetDictationLanguagePreferenceRequestSchema.parse(request)
        )
      ),
    ocrLanguagePreference: async (
      request: OcrLanguagePreferenceRequest
    ): Promise<OcrLanguagePreferenceResult> =>
      OcrLanguagePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          OCR_LANGUAGE_PREFERENCE_CHANNEL,
          OcrLanguagePreferenceRequestSchema.parse(request)
        )
      ),
    setOcrLanguagePreference: async (
      request: SetOcrLanguagePreferenceRequest
    ): Promise<SetOcrLanguagePreferenceResult> =>
      SetOcrLanguagePreferenceResultSchema.parse(
        await ipcRenderer.invoke(
          SET_OCR_LANGUAGE_PREFERENCE_CHANNEL,
          SetOcrLanguagePreferenceRequestSchema.parse(request)
        )
      ),
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
      ),
    localRerankerStatus: async (request: LocalRerankerStatusRequest): Promise<LocalRerankerStatus> =>
      LocalRerankerStatusSchema.parse(await ipcRenderer.invoke(
        "retrieval.localRerankerStatus", LocalRerankerStatusRequestSchema.parse(request)
      )),
    installLocalReranker: async (request: LocalRerankerInstallRequest): Promise<LocalRerankerInstallResult> =>
      LocalRerankerInstallResultSchema.parse(await ipcRenderer.invoke(
        "retrieval.installLocalReranker", LocalRerankerInstallRequestSchema.parse(request)
      )),
    enableLocalReranker: async (request: LocalRerankerEnableRequest): Promise<LocalRerankerEnableResult> =>
      LocalRerankerEnableResultSchema.parse(await ipcRenderer.invoke(
        "retrieval.enableLocalReranker", LocalRerankerEnableRequestSchema.parse(request)
      )),
    disableLocalReranker: async (request: LocalRerankerDisableRequest): Promise<LocalRerankerDisableResult> =>
      LocalRerankerDisableResultSchema.parse(await ipcRenderer.invoke(
        "retrieval.disableLocalReranker", LocalRerankerDisableRequestSchema.parse(request)
      )),
    removeLocalReranker: async (request: LocalRerankerRemoveRequest): Promise<LocalRerankerRemoveResult> =>
      LocalRerankerRemoveResultSchema.parse(await ipcRenderer.invoke(
        "retrieval.removeLocalReranker", LocalRerankerRemoveRequestSchema.parse(request)
      ))
  },
  vault: {
    current: async (): Promise<VaultSummary | undefined> =>
      ipcRenderer.invoke("vault.current") as Promise<VaultSummary | undefined>,
    recent: async (): Promise<readonly RecentVaultSummary[]> =>
      RecentVaultSummaryProjectionSchema.array().max(8).parse(await ipcRenderer.invoke("vault.recent")),
    onboardingStatus: async (): Promise<OnboardingStatus> =>
      ipcRenderer.invoke("onboarding.status") as Promise<OnboardingStatus>,
    dismissFirstHomeGuide: async (): Promise<OnboardingStatus> =>
      ipcRenderer.invoke("onboarding.dismissFirstHome") as Promise<OnboardingStatus>,
    create: async (request: CreateVaultRequest): Promise<VaultActionResult> =>
      projectVaultActionResult(await ipcRenderer.invoke("vault.create", request)),
    open: async (): Promise<VaultActionResult> => projectVaultActionResult(await ipcRenderer.invoke("vault.open")),
    openRecent: async (request: OpenRecentVaultRequest): Promise<VaultActionResult> => {
      const parsedRequest = OpenRecentVaultRequestSchema.parse(request);
      const result: unknown = await ipcRenderer.invoke("vault.openRecent", parsedRequest);
      return projectVaultActionResult(result);
    },
    applyMigration: async (request: VaultMigrationApplyRequest): Promise<VaultMigrationApplyResult> =>
      projectVaultMigrationApplyResult(await ipcRenderer.invoke(
        VAULT_APPLY_MIGRATION_CHANNEL,
        VaultMigrationApplyRequestSchema.parse(request)
      )),
    renameDisplayName: async (
      request: VaultRenameDisplayNameRequest
    ): Promise<VaultRenameDisplayNameResult> => {
      const parsed = VaultRenameDisplayNameRequestSchema.parse(request);
      const result = VaultRenameDisplayNameResultSchema.parse(
        await ipcRenderer.invoke(VAULT_RENAME_DISPLAY_NAME_CHANNEL, parsed)
      );
      if (
        result.requestId !== parsed.requestId ||
        result.activeVaultId !== parsed.activeVaultId ||
        result.expectedMetadataRevision !== parsed.expectedMetadataRevision ||
        result.displayName !== parsed.displayName ||
        ("metadata" in result && result.metadata.activeVaultId !== parsed.activeVaultId)
      ) throw new Error("Invalid Vault display-name response identity.");
      return result;
    },
    revealKnowledgeRoot: async (): Promise<VaultRevealResult> =>
      projectVaultRevealResult(await ipcRenderer.invoke("vault.revealKnowledgeRoot"), "knowledge_root"),
    revealSourceAssetRoot: async (): Promise<VaultRevealResult> =>
      projectVaultRevealResult(await ipcRenderer.invoke("vault.revealSourceAssetRoot"), "source_asset_root"),
    updateSourceStoragePolicy: async (request: UpdateSourceStoragePolicyRequest): Promise<VaultSummary> =>
      ipcRenderer.invoke("vault.updateSourceStoragePolicy", request) as Promise<VaultSummary>,
    configureManagedCopyRoot: async (
      request: ManagedCopyRootConfigureRequest
    ): Promise<ManagedCopyRootConfigureResult> => {
      const parsedRequest = ManagedCopyRootConfigureRequestSchema.parse(request);
      const result = ManagedCopyRootConfigureResultSchema.parse(await ipcRenderer.invoke(
        MANAGED_COPY_ROOT_CONFIGURE_CHANNEL,
        parsedRequest
      ));
      if (
        result.requestId !== parsedRequest.requestId ||
        result.activeVaultId !== parsedRequest.activeVaultId ||
        result.expectedSourceStorageRevision !== parsedRequest.expectedSourceStorageRevision ||
        ("summary" in result && result.summary.activeVaultId !== parsedRequest.activeVaultId)
      ) {
        throw new Error("Invalid managed-copy root configuration response identity.");
      }
      return result;
    },
    storageRelocationStatus: async (): Promise<VaultStorageRelocationStatus> =>
      VaultStorageRelocationStatusSchema.parse(
        await ipcRenderer.invoke(VAULT_STORAGE_RELOCATION_STATUS_CHANNEL)
      ),
    relocateStorage: async (
      request: VaultStorageRelocationRequest
    ): Promise<VaultStorageRelocationResult> => {
      const parsedRequest = VaultStorageRelocationRequestSchema.parse(request);
      const result = VaultStorageRelocationResultSchema.parse(
        await ipcRenderer.invoke(VAULT_STORAGE_RELOCATE_CHANNEL, parsedRequest)
      );
      if (result.requestId !== parsedRequest.requestId ||
          result.activeVaultId !== parsedRequest.activeVaultId ||
          result.expectedRevision !== parsedRequest.expectedRevision) {
        throw new Error("Invalid Vault storage relocation response identity.");
      }
      return result;
    },
    forgetRecent: async (request: RecentVaultForgetRequest): Promise<RecentVaultForgetResult> => {
      const parsed = RecentVaultForgetRequestSchema.parse(request);
      const result = RecentVaultForgetResultSchema.parse(await ipcRenderer.invoke(VAULT_FORGET_RECENT_CHANNEL, parsed));
      if (!sameRecentMutationIdentity(parsed, result)) throw new Error("Invalid recent-Vault forget response identity.");
      return result;
    },
    reconnectRecent: async (request: RecentVaultReconnectRequest): Promise<RecentVaultReconnectResult> => {
      const parsed = RecentVaultReconnectRequestSchema.parse(request);
      const result = RecentVaultReconnectResultSchema.parse(await ipcRenderer.invoke(VAULT_RECONNECT_RECENT_CHANNEL, parsed));
      if (!sameRecentMutationIdentity(parsed, result)) throw new Error("Invalid recent-Vault reconnect response identity.");
      return result;
    }
  },
  maintenance: {
    rebuildLocalDatabase: async (): Promise<LocalDatabaseRebuildResult> =>
      ipcRenderer.invoke("maintenance.rebuildLocalDatabase") as Promise<LocalDatabaseRebuildResult>,
    resetLocalDatabase: async (): Promise<LocalDatabaseResetAndRebuildResult> =>
      ipcRenderer.invoke("maintenance.resetLocalDatabase") as Promise<LocalDatabaseResetAndRebuildResult>,
    localDatabaseStatus: async (): Promise<LocalDatabaseStatus> =>
      ipcRenderer.invoke("maintenance.localDatabaseStatus") as Promise<LocalDatabaseStatus>,
    runKnowledgeHealth: async (request: KnowledgeHealthRunRequest): Promise<KnowledgeHealthRunResult> => {
      const parsedRequest = KnowledgeHealthRunRequestSchema.parse(request);
      return KnowledgeHealthRunResultSchema.parse(
        await ipcRenderer.invoke("maintenance.runKnowledgeHealth", parsedRequest)
      );
    },
    searchKnowledgeHealthTargets: async (
      request: KnowledgeHealthTargetSearchRequest
    ): Promise<KnowledgeHealthTargetSearchResult> => {
      const parsedRequest = KnowledgeHealthTargetSearchRequestSchema.parse(request);
      return KnowledgeHealthTargetSearchResultSchema.parse(
        await ipcRenderer.invoke("maintenance.searchKnowledgeHealthTargets", parsedRequest)
      );
    },
    searchKnowledgeHealthOrphanParents: async (
      request: KnowledgeHealthOrphanParentSearchRequest
    ): Promise<KnowledgeHealthOrphanParentSearchResult> => {
      const parsedRequest = KnowledgeHealthOrphanParentSearchRequestSchema.parse(request);
      return KnowledgeHealthOrphanParentSearchResultSchema.parse(
        await ipcRenderer.invoke("maintenance.searchKnowledgeHealthOrphanParents", parsedRequest)
      );
    },
    repairKnowledgeHealthOrphan: async (
      request: KnowledgeHealthOrphanRepairRequest
    ): Promise<KnowledgeHealthOrphanRepairResult> => {
      const parsedRequest = KnowledgeHealthOrphanRepairRequestSchema.parse(request);
      return KnowledgeHealthOrphanRepairResultSchema.parse(
        await ipcRenderer.invoke("maintenance.repairKnowledgeHealthOrphan", parsedRequest)
      );
    },
    repairKnowledgeHealth: async (
      request: KnowledgeHealthRepairRequest
    ): Promise<KnowledgeHealthRepairResult> => {
      const parsedRequest = KnowledgeHealthRepairRequestSchema.parse(request);
      return KnowledgeHealthRepairResultSchema.parse(
        await ipcRenderer.invoke("maintenance.repairKnowledgeHealth", parsedRequest)
      );
    },
    repairKnowledgeHealthDuplicateTopic: async (
      request: KnowledgeHealthDuplicateTopicRepairRequest
    ): Promise<KnowledgeHealthDuplicateTopicRepairResult> => {
      const parsedRequest = KnowledgeHealthDuplicateTopicRepairRequestSchema.parse(request);
      return KnowledgeHealthDuplicateTopicRepairResultSchema.parse(
        await ipcRenderer.invoke("maintenance.repairKnowledgeHealthDuplicateTopic", parsedRequest)
      );
    },
    searchKnowledgeHealthClaimSources: async (
      request: KnowledgeHealthClaimSourceSearchRequest
    ): Promise<KnowledgeHealthClaimSourceSearchResult> => {
      const parsedRequest = KnowledgeHealthClaimSourceSearchRequestSchema.parse(request);
      return KnowledgeHealthClaimSourceSearchResultSchema.parse(
        await ipcRenderer.invoke("maintenance.searchKnowledgeHealthClaimSources", parsedRequest)
      );
    },
    repairKnowledgeHealthUnsourcedClaim: async (
      request: KnowledgeHealthClaimSourceRepairRequest
    ): Promise<KnowledgeHealthClaimSourceRepairResult> => {
      const parsedRequest = KnowledgeHealthClaimSourceRepairRequestSchema.parse(request);
      return KnowledgeHealthClaimSourceRepairResultSchema.parse(
        await ipcRenderer.invoke("maintenance.repairKnowledgeHealthUnsourcedClaim", parsedRequest)
      );
    }
  },
  diagnostics: {
    health: async (): Promise<DiagnosticsHealth> =>
      DiagnosticsHealthSchema.parse(await ipcRenderer.invoke("diagnostics.health")),
    workflowSummary: async (): Promise<DiagnosticsWorkflowSummary> =>
      DiagnosticsWorkflowSummarySchema.parse(await ipcRenderer.invoke(DIAGNOSTICS_WORKFLOW_SUMMARY_CHANNEL)),
    clearLocalDiagnostics: async (
      request: DiagnosticsClearLocalRequest
    ): Promise<DiagnosticsClearLocalResult> => {
      const parsedRequest = DiagnosticsClearLocalRequestSchema.parse(request);
      return DiagnosticsClearLocalResultSchema.parse(
        await ipcRenderer.invoke(DIAGNOSTICS_CLEAR_LOCAL_CHANNEL, parsedRequest)
      );
    },
    previewSupportBundle: async (request: DiagnosticsPreviewSupportBundleRequest): Promise<SupportBundlePreview> =>
      SupportBundlePreviewSchema.parse(await ipcRenderer.invoke(
        DIAGNOSTICS_PREVIEW_SUPPORT_BUNDLE_CHANNEL,
        DiagnosticsPreviewSupportBundleRequestSchema.parse(request)
      )),
    exportSupportBundle: async (request: ExportSupportBundleRequest): Promise<SupportBundleExportResult> =>
      DiagnosticsExportSupportBundleResultSchema.parse(await ipcRenderer.invoke(
        DIAGNOSTICS_EXPORT_SUPPORT_BUNDLE_CHANNEL,
        DiagnosticsExportSupportBundleRequestSchema.parse(request)
      )),
    cancelSupportBundleExport: async (
      request: CancelSupportBundleExportRequest
    ): Promise<CancelSupportBundleExportResult> =>
      DiagnosticsSupportBundleMutationResultSchema.parse(await ipcRenderer.invoke(
        DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL,
        DiagnosticsSupportBundleMutationRequestSchema.parse(request)
      )),
    retrySupportBundleExport: async (
      request: DiagnosticsSupportBundleMutationRequest
    ): Promise<DiagnosticsSupportBundleMutationResult> =>
      DiagnosticsSupportBundleMutationResultSchema.parse(await ipcRenderer.invoke(
        DIAGNOSTICS_RETRY_SUPPORT_BUNDLE_CHANNEL,
        DiagnosticsSupportBundleMutationRequestSchema.parse(request)
      ))
  },
  models: {
    summary: async (): Promise<ModelProviderSettingsSummary> =>
      ipcRenderer.invoke("models.summary") as Promise<ModelProviderSettingsSummary>,
    openApiKeyManagement: async (
      request: ProviderApiKeyManagementRequest
    ): Promise<ProviderApiKeyManagementResult> => ProviderApiKeyManagementResultSchema.parse(await ipcRenderer.invoke(
      MODEL_OPEN_API_KEY_MANAGEMENT_CHANNEL,
      ProviderApiKeyManagementRequestSchema.parse(request)
    )),
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
    setKnowledgeLanguage: async (
      request: SetKnowledgeLanguageRequest
    ): Promise<KnowledgeLanguageMutationResult> =>
      KnowledgeLanguageMutationResultSchema.parse(
        await ipcRenderer.invoke(
          "settings.setKnowledgeLanguage",
          SetKnowledgeLanguageRequestSchema.parse(request)
        )
      ),
    startupDestination: async (): Promise<StartupDestinationSummary> =>
      StartupDestinationSummarySchema.parse(await ipcRenderer.invoke("settings.startupDestination")),
    setStartupDestination: async (
      request: SetStartupDestinationRequest
    ): Promise<StartupDestinationMutationResult> =>
      StartupDestinationMutationResultSchema.parse(
        await ipcRenderer.invoke(
          "settings.setStartupDestination",
          SetStartupDestinationRequestSchema.parse(request)
        )
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
      ipcRenderer.invoke("settings.registry") as Promise<SettingsRegistrySummary>,
    pigePolicy: async (): Promise<PigePolicySummary> =>
      PigePolicySummarySchema.parse(await ipcRenderer.invoke(PIGE_POLICY_STATUS_CHANNEL)),
    updatePigePolicy: async (request: PigePolicyUpdateRequest): Promise<PigePolicyUpdateResult> => {
      const parsed = PigePolicyUpdateRequestSchema.parse(request);
      return PigePolicyUpdateResultSchema.parse(await ipcRenderer.invoke(PIGE_POLICY_UPDATE_CHANNEL, parsed));
    }
  },
  updates: {
    summary: async (): Promise<UpdateSummary> =>
      UpdateSummarySchema.parse(await ipcRenderer.invoke("updates.summary")),
    check: async (request: UpdateCheckRequest): Promise<UpdateCheckResult> => {
      const parsedRequest = UpdateCheckRequestSchema.parse(request);
      return UpdateCheckResultSchema.parse(await ipcRenderer.invoke("updates.check", parsedRequest));
    },
    download: async (request: UpdateDownloadRequest): Promise<UpdateDownloadResult> => {
      const parsedRequest = UpdateDownloadRequestSchema.parse(request);
      return UpdateDownloadResultSchema.parse(await ipcRenderer.invoke("updates.download", parsedRequest));
    },
    apply: async (request: UpdateApplyRequest): Promise<UpdateApplyResult> => {
      const parsedRequest = UpdateApplyRequestSchema.parse(request);
      return UpdateApplyResultSchema.parse(await ipcRenderer.invoke("updates.apply", parsedRequest));
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
    conversationPreferenceStatus: async (): Promise<BackupConversationPreferenceSummary> =>
      BackupConversationPreferenceSummarySchema.parse(
        await ipcRenderer.invoke(BACKUP_CONVERSATION_PREFERENCE_STATUS_CHANNEL)
      ),
    setConversationPreference: async (
      request: BackupConversationPreferenceUpdateRequest
    ): Promise<BackupConversationPreferenceUpdateResult> => {
      const parsedRequest = BackupConversationPreferenceUpdateRequestSchema.parse(request);
      const result = BackupConversationPreferenceUpdateResultSchema.parse(
        await ipcRenderer.invoke(BACKUP_SET_CONVERSATION_PREFERENCE_CHANNEL, parsedRequest)
      );
      if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId) {
        throw new Error("Invalid conversation backup preference response identity.");
      }
      return result;
    },
    trashPreferenceStatus: async (): Promise<BackupTrashPreferenceSummary> =>
      BackupTrashPreferenceSummarySchema.parse(
        await ipcRenderer.invoke(BACKUP_TRASH_PREFERENCE_STATUS_CHANNEL)
      ),
    setTrashPreference: async (
      request: BackupTrashPreferenceUpdateRequest
    ): Promise<BackupTrashPreferenceUpdateResult> => {
      const parsedRequest = BackupTrashPreferenceUpdateRequestSchema.parse(request);
      const result = BackupTrashPreferenceUpdateResultSchema.parse(
        await ipcRenderer.invoke(BACKUP_SET_TRASH_PREFERENCE_CHANNEL, parsedRequest)
      );
      if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId) {
        throw new Error("Invalid trash backup preference response identity.");
      }
      return result;
    },
    memoryPreferenceStatus: async (): Promise<BackupMemoryPreferenceSummary> =>
      BackupMemoryPreferenceSummarySchema.parse(
        await ipcRenderer.invoke(BACKUP_MEMORY_PREFERENCE_STATUS_CHANNEL)
      ),
    setMemoryPreference: async (
      request: BackupMemoryPreferenceUpdateRequest
    ): Promise<BackupMemoryPreferenceUpdateResult> => {
      const parsedRequest = BackupMemoryPreferenceUpdateRequestSchema.parse(request);
      const result = BackupMemoryPreferenceUpdateResultSchema.parse(
        await ipcRenderer.invoke(BACKUP_SET_MEMORY_PREFERENCE_CHANNEL, parsedRequest)
      );
      if (result.requestId !== parsedRequest.requestId || result.activeVaultId !== parsedRequest.activeVaultId) {
        throw new Error("Invalid Agent memory backup preference response identity.");
      }
      return result;
    },
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
    reconnectDestination: async (
      request: BackupReconnectDestinationRequest
    ): Promise<BackupReconnectDestinationResult> => {
      const parsedRequest = BackupReconnectDestinationRequestSchema.parse(request);
      const result = BackupReconnectDestinationResultSchema.parse(
        await ipcRenderer.invoke(BACKUP_RECONNECT_DESTINATION_CHANNEL, parsedRequest)
      );
      if (
        result.requestId !== parsedRequest.requestId ||
        result.activeVaultId !== parsedRequest.activeVaultId ||
        result.waitingJobId !== parsedRequest.waitingJobId ||
        result.expectedJobUpdatedAt !== parsedRequest.expectedJobUpdatedAt
      ) {
        throw new Error("Invalid Backup destination reconnect response identity.");
      }
      return result;
    },
    continueIncomplete: async (
      request: BackupContinueIncompleteRequest
    ): Promise<BackupContinueIncompleteResult> => {
      const parsedRequest = BackupContinueIncompleteRequestSchema.parse(request);
      const result = BackupContinueIncompleteResultSchema.parse(
        await ipcRenderer.invoke(BACKUP_CONTINUE_INCOMPLETE_CHANNEL, parsedRequest)
      );
      if (
        result.requestId !== parsedRequest.requestId ||
        result.activeVaultId !== parsedRequest.activeVaultId ||
        result.waitingJobId !== parsedRequest.waitingJobId ||
        result.expectedJobUpdatedAt !== parsedRequest.expectedJobUpdatedAt
      ) {
        throw new Error("Invalid incomplete Backup response identity.");
      }
      return result;
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
    },
    cancelRestore: async (request: RestoreCancelRequest): Promise<RestoreCancelResult> => {
      const parsedRequest = RestoreCancelRequestSchema.parse(request);
      const result = RestoreCancelResultSchema.parse(
        await ipcRenderer.invoke(RESTORE_CANCEL_CHANNEL, parsedRequest)
      );
      if (
        result.requestId !== parsedRequest.requestId ||
        result.previewId !== parsedRequest.previewId ||
        result.mode !== parsedRequest.mode
      ) throw new Error("Invalid Restore cancellation response identity.");
      return result;
    }
  },
  system: {
    toolchainHealth: async (): Promise<ToolchainHealth> =>
      ipcRenderer.invoke("system.toolchainHealth") as Promise<ToolchainHealth>,
    repairToolchain: async (
      request: ToolchainRepairRequest
    ): Promise<ToolchainRepairResult> => {
      const parsedRequest = ToolchainRepairRequestSchema.parse(request);
      const result = ToolchainRepairResultSchema.parse(
        await ipcRenderer.invoke(TOOLCHAIN_REPAIR_CHANNEL, parsedRequest)
      );
      if (
        result.requestId !== parsedRequest.requestId ||
        result.expectedHealthId !== parsedRequest.expectedHealthId ||
        result.expectedMissingRequiredToolIds.length !==
          parsedRequest.expectedMissingRequiredToolIds.length ||
        result.expectedMissingRequiredToolIds.some(
          (toolId, index) => toolId !== parsedRequest.expectedMissingRequiredToolIds[index]
        )
      ) {
        throw new Error("Invalid toolchain repair response identity.");
      }
      return result;
    }
  }
};

contextBridge.exposeInMainWorld("pige", api);
