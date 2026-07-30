import type { PigeClientCapabilityTier, PigeRuntimeKind } from "@pige/domain";
import type {
  AgentAttachmentCandidate,
  AgentConversationHistoryCursor,
  AgentConversationHistoryQuery,
  AgentConversationHistoryListRequest,
  AgentConversationHistoryListResult,
  AgentConversationHistorySummary,
  AgentConversationExportRequest,
  AgentConversationExportResult,
  ConversationRestoreRequest,
  ConversationRestoreResult,
  ConversationTrashListRequest,
  ConversationTrashListResult,
  ConversationTrashRequest,
  ConversationTrashResult,
  ConversationTrashSummary,
  AgentConversationSetTitleRequest,
  AgentConversationSetTitleResult,
  AgentStagedItem,
  AgentStagedLargePasteItem,
  AgentStagedItemRejectionReason,
  AgentStagedItemAcceptedRef,
  AgentStagedItemRejectedRef,
  AgentSubmitTurnIpcPayload,
  AgentSubmitTurnAcceptedResult,
  AgentStagedSubmitTurnResult,
  AgentSubmitTurnIpcResult,
  AppearanceSettingsSummary,
  AppearanceThemeMutationResult,
  AppearanceThemePreference,
  GeneratedKnowledgeLanguage,
  KnowledgeLanguageMutationResult,
  BackupContinueIncompleteRequest,
  BackupContinueIncompleteResult,
  BackupMemoryPreferenceSummary,
  BackupMemoryPreferenceUpdateRequest,
  BackupMemoryPreferenceUpdateResult,
  BackupReconnectDestinationRequest,
  BackupReconnectDestinationResult,
  BackupReconnectDependencyRequest,
  BackupReconnectDependencyResult,
  RestoreCancelRequest,
  RestoreCancelResult,
  BoundaryVerification,
  CaptureFileRejection,
  CaptureFileRejectionReason,
  CloudBoundary,
  CloudSendPolicy,
  ChangeOperation,
  CollectionAddFormulaColumnRequest,
  CollectionAddFormulaColumnResult,
  CollectionAddRelationColumnRequest,
  CollectionAddRelationColumnResult,
  CollectionAddLookupColumnRequest,
  CollectionAddLookupColumnResult,
  CollectionEditRelationCellRequest,
  CollectionEditRelationCellResult,
  CollectionUpdateFormulaColumnRequest,
  CollectionUpdateFormulaColumnResult,
  ConversationLanguageContinuity,
  DurableLanguage,
  DurableLanguageFact,
  DiagnosticsClearLocalRequest,
  DiagnosticsClearLocalResult,
  DiagnosticsExportSupportBundleRequest,
  DiagnosticsExportSupportBundleResult,
  DiagnosticsPreviewSupportBundleRequest,
  DiagnosticsScopeContextId,
  DiagnosticsSupportBundleJobSummary,
  DiagnosticsSupportBundleMutationRequest,
  DiagnosticsSupportBundleMutationResult,
  DiagnosticsWorkflowSummary,
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionRenameViewRequest,
  CollectionRenameViewResult,
  CollectionTrashViewRequest,
  CollectionTrashViewResult,
  CollectionListRequest,
  CollectionListResult,
  CollectionOpenCitationRequest,
  CollectionOpenCitationResult,
  CollectionOpenRequest,
  CollectionOpenResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionRenameColumnRequest,
  CollectionRenameColumnResult,
  CollectionTrashColumnRequest,
  CollectionTrashColumnResult,
  CollectionTrashRowRequest,
  CollectionTrashRowResult,
  ConfirmationProposal,
  CurrentNoteAppendProposalDecisionRequest,
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalGetRequest,
  CurrentNoteAppendProposalGetResult,
  CurrentNoteAppendProposalPreview,
  CurrentNoteReplaceProposalDecisionRequest,
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalGetRequest,
  CurrentNoteReplaceProposalGetResult,
  CurrentNoteReplaceProposalPreview,
  DatasetLogicalType,
  EffectiveAppearanceTheme,
  ExternalWebSkillHttpsOrigin,
  ExternalWebSkillReadRequest,
  ExternalWebSkillReadResult,
  ExternalWebSkillRuntimeAdapter,
  ExternalWebSkillRuntimeCall,
  ExternalWebSkillRuntimeDeclaration,
  ExternalWebSkillRuntimeIdentity,
  ExternalWebSkillRuntimeToolName,
  ExternalWebSkillRuntimeTurnBinding,
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
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthDuplicateTopicRepairRequest,
  KnowledgeHealthDuplicateTopicRepairResult,
  KnowledgeHealthTargetCandidate,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult,
  KnowledgeHealthOrphanParentCandidate,
  KnowledgeHealthOrphanParentSearchRequest,
  KnowledgeHealthOrphanParentSearchResult,
  KnowledgeHealthOrphanRepairRequest,
  KnowledgeHealthOrphanRepairResult,
  Locale,
  ManagedCopyRootConfigureRequest,
  ManagedCopyRootConfigureResult,
  ManagedCopyRootSummary,
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
  OcrLanguagePreferenceRequest,
  OcrLanguagePreferenceResult,
  SetOcrLanguagePreferenceRequest,
  SetOcrLanguagePreferenceResult,
  PaddleOcrCatalogComponent,
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrLifecycleAction,
  PaddleOcrLifecycleState,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrRequestId,
  PaddleOcrSummary,
  PaddleOcrSummaryRequest,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  MemoryDeleteRequest,
  MemoryDisableRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryRecordId,
  MemoryRecordSummary,
  MemoryResetRequest,
  MemorySummary,
  JobClass,
  JobRecord,
  JobStage,
  JobState,
  LibraryTagFacet,
  LibraryTaggedPageSummary,
  LibraryTagsCursor,
  LibraryTagsRequest,
  LibraryTagsRequestId,
  LibraryTagsResult,
  LibraryTagsSnapshotId,
  LibraryRenameTagRequest,
  LibraryRenameTagRequestId,
  LibraryRenameTagResult,
  LibraryMergeTagRequest,
  LibraryMergeTagRequestId,
  LibraryMergeTagResult,
  LibraryRemoveTagRequest,
  LibraryRemoveTagRequestId,
  LibraryRemoveTagResult,
  LibraryRemovePageTagRequest,
  LibraryRemovePageTagRequestId,
  LibraryRemovePageTagResult,
  MarkdownPageStatus,
  MarkdownPageType,
  ModelListStrategy,
  NoteEditorInvalidReason,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorPortableMarkdown,
  NoteEditorRequestId,
  NoteEditorRevision,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteAddTagRequest,
  NoteAddTagResult,
  NoteEditTaxonomyRequest,
  NoteEditTaxonomyResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteTrashListRequest,
  NoteTrashListResult,
  NoteTrashRestoreRequest,
  NoteTrashRestoreResult,
  NoteTrashSummary,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryListResult,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryOpenResult,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistoryRestoreResult,
  NoteRevisionHistorySummary,
  NoteRenderContextId,
  NoteRenderResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
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
  PiPackageUninstallRequest,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateResult,
  SupportBundleCategory,
  SupportBundlePreview,
  PigeErrorSummary,
  ProposalState,
  ProposalTrustLevel,
  ProposalReviewRequest,
  ProposalReviewResult,
  ProposalReviewDecisionRequest,
  ProposalReviewDecisionResult,
  ProposalReviewPreview,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  ReaderSelectionCreatePageAction,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
  ReaderSelectionReadAction,
  ReaderSelectionProposalAction,
  ReaderSelectionTransformAction,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ProviderAuthRequirement,
  ProviderEndpointProtocol,
  ProviderKind,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RetrievalSearchScope,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallationId,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechAssetRequestId,
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
  ToolchainRepairEligibility,
  ToolchainRepairRequest,
  ToolchainRepairResult,
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
  SkillRegistryQueryResult,
  SkillRegistryMutationResult,
  SkillRegistrySummary,
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
  SettingApplyBehavior,
  SettingPermissionRequirement,
  SettingScope,
  SetLocaleRequest,
  SetKnowledgeLanguageRequest,
  SetStartupDestinationRequest,
  SetThemeRequest,
  SourceKind,
  SourceAssetRootKind,
  SourceStorageStrategy,
  StartupDestinationMutationResult,
  StartupDestinationSummary,
  VaultMigrationApplyRequest,
  VaultMigrationApplyResult,
  VaultMigrationPreview,
  VaultMetadataRevision,
  VaultRenameDisplayNameRequest,
  VaultRenameDisplayNameResult,
  VaultOpenInvalidReason,
  VaultStorageRelocationRequest,
  VaultStorageRelocationRevision,
  VaultStorageRelocationResult,
  VaultStorageRelocationStatus,
  VaultRevealResult,
  VaultRevealTarget,
  WindowLayoutMode,
  WindowLayoutRequest,
  WindowLayoutState
} from "@pige/schemas";

export type {
  AgentAttachmentCandidate,
  AgentConversationHistoryCursor,
  AgentConversationHistoryQuery,
  AgentConversationHistoryListRequest,
  AgentConversationHistoryListResult,
  AgentConversationHistorySummary,
  AgentConversationExportRequest,
  AgentConversationExportResult,
  ConversationRestoreRequest,
  ConversationRestoreResult,
  ConversationTrashListRequest,
  ConversationTrashListResult,
  ConversationTrashRequest,
  ConversationTrashResult,
  ConversationTrashSummary,
  AgentConversationSetTitleRequest,
  AgentConversationSetTitleResult,
  AgentStagedItem,
  AgentStagedLargePasteItem,
  AgentStagedItemRejectionReason,
  AgentStagedItemAcceptedRef,
  AgentStagedItemRejectedRef,
  AgentSubmitTurnIpcPayload,
  AgentSubmitTurnAcceptedResult,
  AgentStagedSubmitTurnResult,
  AgentSubmitTurnIpcResult,
  AppearanceSettingsSummary,
  AppearanceThemeMutationResult,
  AppearanceThemePreference,
  GeneratedKnowledgeLanguage,
  KnowledgeLanguageMutationResult,
  BackupContinueIncompleteRequest,
  BackupContinueIncompleteResult,
  BackupReconnectDestinationRequest,
  BackupReconnectDestinationResult,
  BackupReconnectDependencyRequest,
  BackupReconnectDependencyResult,
  RestoreCancelRequest,
  RestoreCancelResult,
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult,
  CaptureFileRejection,
  CaptureFileRejectionReason,
  CollectionCatalogCursor,
  CollectionDatasetSummary,
  CollectionDatasetTableSummary,
  CollectionListRequest,
  CollectionListResult,
  CollectionRowCursor,
  ConversationLanguageContinuity,
  DiagnosticError,
  DurableLanguage,
  DurableLanguageFact,
  DiagnosticsClearLocalRequest,
  DiagnosticsClearLocalResult,
  DiagnosticsExportSupportBundleRequest,
  DiagnosticsExportSupportBundleResult,
  DiagnosticsPreviewSupportBundleRequest,
  DiagnosticsScopeContextId,
  DiagnosticsSupportBundleJobSummary,
  DiagnosticsSupportBundleMutationRequest,
  DiagnosticsSupportBundleMutationResult,
  DiagnosticsWorkflowSummary,
  PigeError,
  PigeErrorAction,
  PigeErrorDomain,
  PigeErrorSeverity,
  PigeErrorSummary,
  PigeWarning,
  SupportBundleCategory,
  SupportBundlePreview,
  EffectiveAppearanceTheme,
  ExternalWebSkillHttpsOrigin,
  ExternalWebSkillReadRequest,
  ExternalWebSkillReadResult,
  ExternalWebSkillRuntimeAdapter,
  ExternalWebSkillRuntimeCall,
  ExternalWebSkillRuntimeDeclaration,
  ExternalWebSkillRuntimeIdentity,
  ExternalWebSkillRuntimeToolName,
  ExternalWebSkillRuntimeTurnBinding,
  HighRiskConfirmationAction,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationId,
  HighRiskConfirmationOwner,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  HighRiskConfirmationSummary,
  HighRiskConfirmationSubject,
  HighRiskConfirmationTarget,
  HighRiskEffect,
  PermissionDefaultMode,
  PermissionFullAccessSummary,
  PermissionGrantContextId,
  PermissionGrantId,
  PermissionGrantSummary,
  PermissionPolicyChangedEvent,
  PermissionPolicySummary,
  PermissionPolicySummaryRequest,
  PermissionPolicySummaryResult,
  PermissionRevokeGrantRequest,
  PermissionRevokeGrantResult,
  PermissionSetDefaultModeRequest,
  PermissionSetDefaultModeResult,
  PermissionYoloHardBoundary,
  CurrentNoteAppendProposalDecisionRequest,
  CurrentNoteAppendProposalDecisionResult,
  CurrentNoteAppendProposalGetRequest,
  CurrentNoteAppendProposalGetResult,
  CurrentNoteAppendProposalPreview,
  CurrentNoteReplaceProposalDecisionRequest,
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalGetRequest,
  CurrentNoteReplaceProposalGetResult,
  CurrentNoteReplaceProposalPreview,
  PiPackageInstallRequest,
  PiPackageInstallRequestId,
  PiPackageInstallResult,
  PiPackageInstallTaskId,
  PiPackageInstalledSummary,
  PiPackageId,
  PiPackageCatalogEntry,
  PiPackageCatalogId,
  PiPackageCatalogQueryRequest,
  PiPackageCatalogQueryRequestId,
  PiPackageCatalogQueryResult,
  PiPackageIntegrity,
  PiPackageName,
  PiPackageRegistryQueryResult,
  PiPackageRegistrySummary,
  PiPackageRestorableSummary,
  PiPackageRestoreContextId,
  PiPackageRestoreRequest,
  PiPackageRestoreRequestId,
  PiPackageRestoreResult,
  PiPackageRollbackId,
  PiPackageRollbackRequest,
  PiPackageRollbackRequestId,
  PiPackageRollbackResult,
  PiPackageSetPinnedRequest,
  PiPackageSetPinnedRequestId,
  PiPackageSetPinnedResult,
  PiPackageType,
  PiPackageVersion,
  PiPackageUninstallRequest,
  PiPackageUninstallRequestId,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateRequestId,
  PiPackageUpdateResult,
  KnowledgeHealthCounts,
  KnowledgeHealthDuplicateTopicRepairRequest,
  KnowledgeHealthDuplicateTopicRepairResult,
  KnowledgeHealthIndexGeneration,
  KnowledgeHealthIssueKind,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthPageRef,
  KnowledgeHealthRequestId,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult,
  KnowledgeHealthRepairAction,
  KnowledgeHealthRepairContextId,
  KnowledgeHealthRepairRequestId,
  KnowledgeHealthRepairRequest,
  KnowledgeHealthRepairResult,
  KnowledgeHealthTargetCandidate,
  KnowledgeHealthTargetSearchRequest,
  KnowledgeHealthTargetSearchResult,
  KnowledgeHealthOrphanParentCandidate,
  KnowledgeHealthOrphanParentSearchRequest,
  KnowledgeHealthOrphanParentSearchResult,
  KnowledgeHealthOrphanRepairRequest,
  KnowledgeHealthOrphanRepairResult,
  LibraryTagFacet,
  LibraryTaggedPageSummary,
  LibraryTagsCursor,
  LibraryTagsRequest,
  LibraryTagsRequestId,
  LibraryTagsResult,
  LibraryTagsSnapshotId,
  LibraryRenameTagRequest,
  LibraryRenameTagRequestId,
  LibraryRenameTagResult,
  LibraryMergeTagRequest,
  LibraryMergeTagRequestId,
  LibraryMergeTagResult,
  LibraryRemoveTagRequest,
  LibraryRemoveTagRequestId,
  LibraryRemoveTagResult,
  LibraryRemovePageTagRequest,
  LibraryRemovePageTagRequestId,
  LibraryRemovePageTagResult,
  ManagedCopyRootConfigureRequest,
  ManagedCopyRootConfigureResult,
  ManagedCopyRootSummary,
  RendererSafeSubjectLabel,
  SetLocaleRequest,
  SetKnowledgeLanguageRequest,
  SetStartupDestinationRequest,
  SetThemeRequest,
  StartupDestinationMutationResult,
  StartupDestinationSummary,
  VaultRevealResult,
  VaultRevealTarget,
  NoteInlineReferenceTarget,
  NoteInlineReferenceRequestId,
  NoteRenderContextId,
  NoteEditorInvalidReason,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorPortableMarkdown,
  NoteEditorRequestId,
  NoteEditorRevision,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteImportMarkdownRequest,
  NoteImportMarkdownResult,
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
  NoteAddTagRequest,
  NoteAddTagResult,
  NoteEditTaxonomyRequest,
  NoteEditTaxonomyResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteTrashListRequest,
  NoteTrashListResult,
  NoteTrashRestoreRequest,
  NoteTrashRestoreResult,
  NoteTrashSummary,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryListResult,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryOpenResult,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistoryRestoreResult,
  NoteRevisionHistorySummary,
  NoteRenderResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteSourceReferenceRequestId,
  NoteRevealSourceRequestId,
  NoteRevealSourceRequest,
  NoteRevealSourceResult,
  NoteReconnectOriginalSourceRequestId,
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  SourceRefreshRequestId,
  SourceRefreshPreviewId,
  SourceRefreshRevision,
  SourceRefreshPreviewRequest,
  SourceRefreshPreviewResult,
  SourceRefreshConfirmRequest,
  SourceRefreshConfirmResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  ReaderSelectionEndpoint,
  ReaderSelectionActionRequest,
  ReaderSelectionActionRequestId,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  ReaderSelectionCreatePageAction,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
  ReaderSelectionIdentity,
  ReaderSelectionReadAction,
  ReaderSelectionProposalAction,
  ReaderSelectionTransformAction,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ProposalReviewRequest,
  ProposalReviewResult,
  ProposalReviewDecisionRequest,
  ProposalReviewDecisionResult,
  ProposalReviewPreview,
  ReaderSelectionRequestId,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ReaderSelectionSegmentId,
  ReaderSelectionUtf8ByteSpan,
  LocalSemanticRetrievalAssetState,
  LocalSemanticRetrievalDisableRequest,
  LocalSemanticRetrievalDisableResult,
  LocalSemanticRetrievalEnableRequest,
  LocalSemanticRetrievalEnableResult,
  LocalSemanticRetrievalInstallRequest,
  LocalSemanticRetrievalInstallResult,
  LocalSemanticRetrievalMutationResult,
  LocalSemanticRetrievalRemoveRequest,
  LocalSemanticRetrievalRemoveResult,
  LocalSemanticRetrievalRequestId,
  LocalSemanticRetrievalStatus,
  LocalSemanticRetrievalStatusRequest,
  OcrLanguagePreference,
  OcrLanguagePreferenceMachineSettings,
  OcrLanguagePreferenceRequest,
  OcrLanguagePreferenceRequestId,
  OcrLanguagePreferenceResult,
  OcrLanguagePreferenceSummary,
  SetOcrLanguagePreferenceRequest,
  SetOcrLanguagePreferenceResult,
  PaddleOcrCatalogComponent,
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrLifecycleAction,
  PaddleOcrLifecycleState,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrRequestId,
  PaddleOcrSummary,
  PaddleOcrSummaryRequest,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RetrievalSearchScope,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallationId,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechAssetRequestId,
  SpeechCancelRequest,
  SpeechCancelResult,
  SpeechOpenSystemSettingsResult,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  TaskExecutionPlanSummary,
  TaskInteractionChangedEvent,
  TaskInteractionOpenRequest,
  TaskInteractionOpenResult,
  TaskInteractionPendingResult,
  ToolchainHealthId,
  ToolchainRepairEligibility,
  ToolchainRepairRequest,
  ToolchainRepairRequestId,
  ToolchainRepairResult,
  ToolchainToolId,
  MemoryDeleteRequest,
  MemoryDisableRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryRecordId,
  MemoryRecordSummary,
  MemoryResetRequest,
  MemorySummary,
  SkillCapability,
  SkillDataBoundary,
  SkillDiscardStagedRequest,
  SkillDiscardStagedResult,
  SkillDisableRequest,
  SkillEnableRequest,
  SkillExportRequest,
  SkillExportResult,
  SkillInstallRequestId,
  SkillInstallStagedRequest,
  SkillInstallStagedResult,
  SkillInstallUrl,
  SkillLifecycleMutationResult,
  SkillLifecycleRequestId,
  SkillPendingStagedReviewsRequest,
  SkillPendingStagedReviewsResult,
  SkillRegistryQueryResult,
  SkillKind,
  SkillRegistryMutationResult,
  SkillRegistrySummary,
  SkillScope,
  SkillStageFromUrlRequest,
  SkillStageFromUrlResult,
  SkillStageFromMarkdownRequest,
  SkillStageFromMarkdownResult,
  SkillStageFromZipRequest,
  SkillStageFromZipResult,
  SkillStageUpdateRequest,
  SkillStageUpdateResult,
  SkillRestoreContextId,
  SkillRestoreRequest,
  SkillRestoreResult,
  SkillRestorableSummary,
  SkillStageInvalidReason,
  SkillStagedFileSummary,
  SkillStagedSummary,
  SkillStageWarning,
  SkillStagingId,
  SkillSummary,
  SkillTrust,
  SkillUninstallRequest,
  VaultMigrationApplyRequest,
  VaultMigrationApplyResult,
  VaultMigrationPreview,
  VaultMetadataRevision,
  VaultRenameDisplayNameRequest,
  VaultRenameDisplayNameResult,
  VaultOpenInvalidReason,
  VaultStorageRelocationRequest,
  VaultStorageRelocationRevision,
  VaultStorageRelocationResult,
  VaultStorageRelocationStatus,
  WindowLayoutRequest,
  WindowLayoutState
} from "@pige/schemas";

export interface AppHealth {
  readonly status: "ok";
  readonly appVersion: string;
  readonly checkedAt: string;
}

export interface VaultCounts {
  readonly notes: number;
  readonly sources: number;
  readonly managedSourceCopies: number;
  readonly referencedOriginals: number;
}

export interface VaultSummary {
  readonly vaultId: string;
  readonly name: string;
  readonly metadataRevision?: VaultMetadataRevision;
  readonly activeVaultPathDisplay: string;
  readonly knowledgeRootDisplay: string;
  readonly sourceAssetRootDisplay: string;
  readonly sourceAssetRootKind: SourceAssetRootKind;
  readonly managedCopyRoot: ManagedCopyRootSummary;
  readonly defaultSourceStorageStrategy: SourceStorageStrategy;
  readonly schemaVersion: number;
  readonly counts?: VaultCounts;
  readonly lastBackupAt?: string;
}

export interface RecentVaultSummary {
  readonly vaultId: string;
  readonly name: string;
  readonly pathDisplay: string;
  readonly schemaVersion: number;
  readonly lastOpenedAt: string;
}

export interface OnboardingStatus {
  readonly state: "blocked_no_vault" | "ready";
  readonly activeVault?: VaultSummary;
  readonly hasDefaultModel: boolean;
  readonly showFirstHomeGuide: boolean;
  readonly waitingDependencyCounts?: {
    readonly modelProvider: number;
    readonly localTool: number;
    readonly localModel: number;
    readonly runtimeCapability: number;
    readonly vaultBinding: number;
    readonly externalSource: number;
  };
}

export interface AgentRuntimePolicyContext {
  readonly schemaVersion: 1;
  readonly policyContextId: string;
  readonly builtAt: string;
  readonly jobId: string;
  readonly policyHash: string;
  readonly vaultId: string;
  readonly sourceStorage: {
    readonly defaultStrategy: SourceStorageStrategy;
    readonly sourceAssetRootKind: SourceAssetRootKind;
    readonly allowPerCaptureOverride: boolean;
    readonly linkStrategyEnabled: false;
  };
  readonly model: {
    readonly defaultModelProfileId?: string;
    readonly modelConfigured: boolean;
    readonly cloudBoundary: "cloud" | "self_hosted" | "local" | "unknown";
    readonly boundaryVerification: BoundaryVerification;
    readonly cloudSendPolicy: CloudSendPolicy;
    readonly modelRoutingMode: "default_model_only" | "pi_upstream_model_slots" | "pige_model_routing_service";
  };
  readonly language: {
    readonly appLocale: Locale;
    readonly generatedKnowledgeLanguage: "preserve_source" | "follow_query" | "app_locale";
    readonly preserveSourceLanguage: boolean;
    readonly ocrLanguageHints: readonly string[];
    readonly voiceInputLanguage?: string;
  };
  readonly confirmation: {
    readonly safeAutoApplyThreshold: number;
    readonly mutatingReviewThreshold: number;
    readonly riskyChangeRequiresConfirmation: boolean;
  };
  readonly memory: {
    readonly vaultMemoryEnabled: boolean;
    readonly allowedMemoryScopes: readonly ("preference" | "correction" | "workflow_lesson" | "profile")[];
    readonly includeMemoryInBackup: boolean;
  };
  readonly retrieval: {
    readonly lexicalSearchAvailable: boolean;
    readonly vectorSearchAvailable: boolean;
    readonly rerankerAvailable: boolean;
    readonly maxSnippetsForCloudSynthesis: number;
  };
  readonly localCapabilities: {
    readonly localDatabase: "not_initialized" | "ready" | "needs_rebuild" | "error";
    readonly parserToolchainReady: boolean;
    readonly ocrEngines: readonly ("apple_vision" | "windows_ai" | "paddleocr_local")[];
    readonly speechInputAvailable: boolean;
    readonly embeddingModelInstalled: boolean;
    readonly hiddenDownloadsAllowed: false;
  };
}

export interface AgentRuntimeStatus {
  readonly runtimeKind: PigeRuntimeKind;
  readonly clientCapabilityTier: PigeClientCapabilityTier;
  readonly adapterMode: "phase_1_stub" | "embedded_pi_sdk" | "rpc_json" | "development_cli";
  readonly state: "blocked_no_vault" | "waiting_for_model" | "ready";
  readonly canRunModelJobs: boolean;
  readonly missingDependencies: readonly ("vault" | "default_model")[];
  readonly defaultModelProfileId?: string;
  readonly policySnapshot?: {
    readonly policyContextId: string;
    readonly policyHash: string;
    readonly builtAt: string;
    readonly vaultId: string;
    readonly cloudBoundary: AgentRuntimePolicyContext["model"]["cloudBoundary"];
    readonly boundaryVerification: AgentRuntimePolicyContext["model"]["boundaryVerification"];
    readonly localDatabase: AgentRuntimePolicyContext["localCapabilities"]["localDatabase"];
  };
}

export interface DiagnosticsHealth {
  readonly status: "ok" | "degraded";
  readonly checkedAt: string;
  readonly localOnly: true;
  readonly recentErrorCount: number;
  readonly checks: readonly {
    readonly id: string;
    readonly status: "ok" | "warning" | "error";
    readonly message: string;
  }[];
}

export type SupportBundleExportResult = DiagnosticsExportSupportBundleResult;
export type ExportSupportBundleRequest = DiagnosticsExportSupportBundleRequest;
export type CancelSupportBundleExportRequest = DiagnosticsSupportBundleMutationRequest;
export type CancelSupportBundleExportResult = DiagnosticsSupportBundleMutationResult;

export interface LocalDatabaseResetResult {
  readonly resetAt: string;
  readonly removedRoots: readonly string[];
  readonly recreatedRoots: readonly string[];
}

export interface LocalDatabaseRebuildResult {
  readonly rebuiltAt: string;
  readonly pageCount: number;
  readonly invalidPageCount: number;
  readonly jobId?: string;
  readonly state?: JobState;
}

export interface LocalDatabaseStatus {
  readonly driver: "pending_sqlite_driver" | "better_sqlite3" | "node_sqlite";
  readonly appSchemaVersion: number;
  readonly appliedMigrationCount: number;
  readonly status: "not_initialized" | "ready" | "needs_rebuild" | "error";
  readonly updatedAt: string;
}

export interface ProviderProfileSummary {
  readonly id: string;
  readonly presetId?: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly authRequirement: ProviderAuthRequirement;
  readonly baseUrl?: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly cloudBoundary: CloudBoundary;
  readonly boundaryVerification?: BoundaryVerification;
  readonly runtimeStatus?: ProviderRuntimeStatusSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderRuntimeStatusSummary {
  readonly discovery: "not_checked" | "verified";
  readonly generation: "not_checked" | "verified" | "failed";
  readonly updatedAt?: string;
}

export interface ProviderPresetSummary {
  readonly presetId: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly authRequirement: ProviderAuthRequirement;
  readonly fixedBaseUrl: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly cloudBoundary: CloudBoundary;
  readonly apiKeyManagementUrl?: string;
}

export interface ModelProfileSummary {
  readonly id: string;
  readonly providerProfileId: string;
  readonly modelId: string;
  readonly displayName?: string;
  readonly source: "provider_list" | "manual";
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelProviderSettingsSummary {
  readonly revision?: string;
  readonly presets: readonly ProviderPresetSummary[];
  readonly providers: readonly ProviderProfileSummary[];
  readonly models: readonly ModelProfileSummary[];
  readonly defaultModelProfileId?: string;
  readonly hasDefaultModel: boolean;
  readonly defaultBinding: DefaultModelBindingSummary;
}

export interface ProviderConnectNeedsManualModel {
  readonly status: "needs_manual_model";
  readonly reason: "select_bootstrap_model" | "discovery_unavailable" | "discovery_failed";
  readonly discoveredModels: readonly {
    readonly modelId: string;
    readonly displayName?: string;
  }[];
  readonly error?: PigeErrorSummary;
}

export type ProviderConnectResult = ModelProviderSettingsSummary | ProviderConnectNeedsManualModel;

export type DefaultModelBindingSummary =
  | { readonly state: "not_configured" }
  | {
      readonly state: "ready";
      readonly providerProfileId: string;
      readonly modelProfileId: string;
    }
  | {
      readonly state: "configured_unusable";
      readonly providerProfileId?: string;
      readonly modelProfileId?: string;
      readonly error: PigeErrorSummary;
    };

export interface AddPresetProviderRequest {
  readonly presetId: string;
  readonly apiKey?: string;
}

export interface AddManualProviderRequest {
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly manualModelId?: string;
  readonly cloudBoundary: CloudBoundary;
}

export interface SetDefaultModelRequest {
  readonly modelProfileId: string;
}

export interface RefreshProviderModelsRequest {
  readonly providerProfileId: string;
}

export interface UpdateProviderCredentialRequest {
  readonly providerProfileId: string;
  readonly expectedRevision: string;
  readonly apiKey: string;
}

export interface DeleteProviderRequest {
  readonly providerProfileId: string;
  readonly expectedRevision: string;
}

export interface AddManualModelRequest {
  readonly providerProfileId: string;
  readonly modelId: string;
  readonly displayName?: string;
}

export interface UpdateModelRequest {
  readonly modelProfileId: string;
  readonly enabled?: boolean;
  readonly displayName?: string | null;
}

export interface SettingRegistryEntry {
  readonly key: string;
  readonly page: string;
  readonly scope: SettingScope;
  readonly owner: string;
  readonly storage: string;
  readonly backedUpByDefault: boolean;
  readonly applyBehavior: SettingApplyBehavior;
  readonly permissionRequirement: SettingPermissionRequirement;
  readonly agentPolicyEffect?: string;
}

export interface SettingsRegistrySummary {
  readonly entries: readonly SettingRegistryEntry[];
}

export type UpdateChannel = "alpha";
export type UpdateCapability = "development" | "unsupported_platform" | "packaged_ready";
export type UpdatePhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "ready_to_restart"
  | "applying"
  | "failed";

export type UpdateSummary = {
  readonly apiVersion: 1;
  readonly revision: number;
  readonly channel: UpdateChannel;
  readonly capability: UpdateCapability;
  readonly currentVersion: string;
} & (
  | { readonly phase: "idle" | "checking" }
  | { readonly phase: "up_to_date" | "failed"; readonly checkedAt: string }
  | { readonly phase: "available"; readonly availableVersion: string; readonly checkedAt: string }
  | {
      readonly phase: "downloading";
      readonly availableVersion: string;
      readonly checkedAt: string;
      readonly progressPercent: number;
    }
  | {
      readonly phase: "ready_to_restart" | "applying";
      readonly availableVersion: string;
      readonly checkedAt: string;
      readonly readyAt: string;
    }
);

export interface UpdateCheckRequest {
  readonly apiVersion: 1;
  readonly requestId: string;
}

export interface UpdateCheckResult {
  readonly status: "checked" | "unavailable" | "busy" | "stale";
  readonly requestId: string;
  readonly summary: UpdateSummary;
}

export interface UpdateDownloadRequest {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly version: string;
}

export interface UpdateDownloadResult {
  readonly status: "started" | "already_ready" | "blocked" | "busy" | "stale" | "unavailable" | "failed";
  readonly requestId: string;
  readonly version: string;
  readonly summary: UpdateSummary;
}

export interface UpdateApplyRequest {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly version: string;
}

export interface UpdateApplyResult {
  readonly status: "restarting" | "blocked" | "busy" | "stale" | "unavailable" | "failed";
  readonly requestId: string;
  readonly version: string;
  readonly summary: UpdateSummary;
}

export interface UpdateStatusEvent {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly sequence: number;
  readonly summary: UpdateSummary;
}

export type CaptureUserIntent = "capture" | "ask" | "unknown";

export interface SubmitFilesCaptureRequest {
  readonly filePaths: readonly string[];
  readonly inputKind: "file_drop" | "file_picker";
  readonly userIntent: CaptureUserIntent;
  readonly locale: Locale;
}

export interface CaptureFilesSubmitResult {
  readonly status: "queued" | "partially_queued" | "rejected";
  readonly captureId: string;
  readonly sourceIds: readonly string[];
  readonly jobIds: readonly string[];
  readonly conversationEventIds: readonly string[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
  readonly preservedAt: string;
}

export interface JobsListRequest {
  readonly limit?: number;
  readonly states?: readonly JobState[];
  readonly classes?: readonly JobClass[];
}

export interface JobSummary {
  readonly id: string;
  readonly class: JobClass;
  readonly state: JobState;
  readonly stage?: JobStage;
  readonly progress?: JobRecord["progress"];
  readonly sourceId?: string;
  readonly captureId?: string;
  readonly conversationEventId?: string;
  readonly sourceDisplayName?: string;
  readonly sourceKind?: SourceKind;
  readonly backupKind?: "user_backup" | "restore_rollback";
  readonly canReconnectDependency: boolean;
  readonly canReconnectBackupDestination: boolean;
  readonly canContinueIncomplete: boolean;
  readonly error?: PigeErrorSummary;
  readonly message: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobsListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidJobCount: number;
  readonly jobs: readonly JobSummary[];
}

export interface JobActionRequest {
  readonly jobId: string;
}

export interface JobActionResult {
  readonly status: "cancel_requested" | "cancelled" | "requeued" | "not_found" | "not_allowed";
  readonly reason?: string;
  readonly job?: JobSummary;
}

export interface KnowledgeActivityListRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export type KnowledgeActivityUndoUnavailableReason =
  | "already_undone"
  | "content_changed"
  | "revision_changed"
  | "legacy_record"
  | "target_missing";

export interface KnowledgeActivityPageTarget {
  readonly kind: "page";
  readonly pageId: string;
}

export interface KnowledgeActivityCollectionTarget {
  readonly kind: "collection";
  readonly datasetId: string;
  readonly tableId: string;
  readonly revisionId: string;
}

export interface KnowledgeActivityMemoryTarget {
  readonly kind: "memory";
  readonly memoryId?: MemoryRecordId | undefined;
}
export type KnowledgeActivityTarget =
  | KnowledgeActivityPageTarget
  | KnowledgeActivityCollectionTarget
  | KnowledgeActivityMemoryTarget;

export interface KnowledgeActivitySummary {
  readonly operationId: string;
  readonly kind:
    | "create_page"
    | "update_page"
    | "archive_page"
    | "restore_page"
    | "trash_page"
    | "update_collection_cell"
    | "add_collection_row"
    | "add_collection_column"
    | "update_collection_formula"
    | "add_collection_relation"
    | "update_collection_relation_cell"
    | "add_collection_lookup"
    | "rename_collection_column"
    | "create_collection_view"
    | "rename_collection_view"
    | "trash_collection_view"
    | "restore_collection_view"
    | "trash_collection_column"
    | "trash_collection_row"
    | "update_memory"
    | "trash_memory"
    | "restore_memory"
    | "update_source_record";
  readonly createdAt: string;
  readonly targetLabel?: string;
  readonly target?: KnowledgeActivityTarget;
  readonly status: "applied" | "undone";
  readonly canUndo: boolean;
  readonly undoUnavailableReason?: KnowledgeActivityUndoUnavailableReason;
}

export interface KnowledgeActivityListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidOperationCount: number;
  readonly activities: readonly KnowledgeActivitySummary[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export interface KnowledgeActivityUndoRequest {
  readonly operationId: string;
  readonly expectedRevisionId?: string;
}

export interface KnowledgeActivityUndoResult {
  readonly status: "undone" | "already_undone" | "stale" | "not_found";
  readonly operationId: string;
  readonly undoOperationId?: string;
  readonly revisionId?: string;
  readonly currentRevisionId?: string;
}

export interface ProposalsListRequest {
  readonly limit?: number;
  readonly states?: readonly ProposalState[];
}

export interface ProposalSummary {
  readonly id: string;
  readonly state: ProposalState;
  readonly trustLevel: ProposalTrustLevel;
  readonly jobId?: string;
  readonly summary: string;
  readonly reason: string;
  readonly operationCount: number;
  readonly warningCount: number;
  readonly targetCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProposalsListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidProposalCount: number;
  readonly proposals: readonly ProposalSummary[];
}

export interface ProposalGetRequest {
  readonly proposalId: string;
}

export interface ProposalGetResult {
  readonly proposal: ConfirmationProposal;
}

export interface StageProposalRequest {
  readonly jobId?: string;
  readonly trustLevel: ProposalTrustLevel;
  readonly summary: string;
  readonly reason: string;
  readonly sourceRefs?: ConfirmationProposal["sourceRefs"];
  readonly targetRefs?: ConfirmationProposal["targetRefs"];
  readonly proposedOperations: readonly ChangeOperation[];
  readonly diffRefs?: ConfirmationProposal["diffRefs"];
  readonly warnings?: readonly string[];
  readonly baseHashes?: Record<string, string>;
}

export interface StageProposalResult {
  readonly proposal: ConfirmationProposal;
}

export interface ProposalDecisionRequest {
  readonly proposalId: string;
  readonly reason?: string;
}

export interface ProposalDecisionResult {
  readonly status: "approved" | "applied" | "rejected" | "conflicted" | "not_found" | "not_allowed";
  readonly reason?: string;
  readonly proposal?: ConfirmationProposal;
}

export interface LibraryListRequest {
  readonly limit?: number;
  readonly pageTypes?: readonly MarkdownPageType[];
}

export interface LibraryPageSummary {
  readonly pageId: string;
  readonly title: string;
  readonly pageType: MarkdownPageType;
  readonly status: MarkdownPageStatus;
  readonly pagePath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly language?: string;
  readonly sourceIds: readonly string[];
}

export interface LibraryListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidPageCount: number;
  readonly pages: readonly LibraryPageSummary[];
}

export type KnowledgeTreeNodeKind = "domain" | "topic" | "concept" | "source";

export interface KnowledgeTreeNavigation {
  readonly pageId: string;
  readonly pagePath: string;
}

export interface KnowledgeTreePageRef extends KnowledgeTreeNavigation {
  readonly title: string;
  readonly pageType: LibraryPageSummary["pageType"];
  readonly status: LibraryPageSummary["status"];
  readonly sourceIds: readonly string[];
}

export interface KnowledgeTreeMetrics {
  readonly structuralPageCount: number;
  readonly fragmentPageCount: number;
  readonly sourceCount: number;
  readonly leafCount: number;
  readonly weight: number;
}

export interface KnowledgeTreeNode {
  readonly id: string;
  readonly kind: KnowledgeTreeNodeKind;
  readonly title: string;
  readonly synthetic?: true;
  readonly pageType?: LibraryPageSummary["pageType"];
  readonly status?: LibraryPageSummary["status"];
  readonly navigation?: KnowledgeTreeNavigation;
  readonly sourceId?: string;
  readonly relatedParentPageIds: readonly string[];
  readonly pageRefs: readonly KnowledgeTreePageRef[];
  readonly sourceRefs: readonly string[];
  readonly metrics: KnowledgeTreeMetrics;
  readonly children: readonly KnowledgeTreeNode[];
}

export interface KnowledgeTreeSnapshot {
  readonly schemaVersion: 1;
  readonly state: "empty" | "ready";
  readonly invalidPageCount: number;
  readonly totals: {
    readonly pageCount: number;
    readonly topicCount: number;
    readonly conceptCount: number;
    readonly fragmentPageCount: number;
    readonly sourceCount: number;
    readonly leafCount: number;
  };
  readonly roots: readonly KnowledgeTreeNode[];
}

export interface KnowledgeTreeResult extends KnowledgeTreeSnapshot {
  readonly queriedAt: string;
  readonly activeVaultId: string;
  readonly degraded: boolean;
  readonly degradedReason?: "local_database_not_ready";
}

export interface LibraryRelatedRequest {
  readonly pageId: string;
  readonly limit?: number;
}

export interface LibraryRelatedPage {
  readonly summary: LibraryPageSummary;
  readonly relation: "outgoing" | "backlink";
  readonly target: string;
}

export interface LibraryRelatedResult {
  readonly queriedAt: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly totalOutgoing: number;
  readonly totalBacklinks: number;
  readonly invalidPageCount: number;
  readonly outgoing: readonly LibraryRelatedPage[];
  readonly backlinks: readonly LibraryRelatedPage[];
  readonly degraded: boolean;
  readonly degradedReason?: "local_database_not_ready";
}

export interface NoteGetRequest {
  readonly pageId: string;
}

export type NoteRenderRequest = NoteGetRequest;

export interface NoteDocument {
  readonly summary: LibraryPageSummary;
  readonly markdownBody: string;
  readonly byteSize: number;
}

export type RetrievalAnswerWarning =
  | "insufficient_evidence"
  | "limited_evidence"
  | "local_extractive_only"
  | "search_degraded";

export interface RetrievalAnswerCitation {
  readonly refId: string;
  readonly label: string;
  readonly pageId: string;
  readonly title: string;
  readonly pageType: MarkdownPageType;
  readonly locator: string;
}

export type DatasetQueryScalar = string | number | boolean | null;

export interface DatasetEvidenceRef {
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly schemaId: string;
  readonly columnIds: readonly string[];
  readonly rowIds?: readonly string[] | undefined;
  readonly range?: {
    readonly startRow: number;
    readonly endRow: number;
  } | undefined;
  readonly queryPlanHash: string;
  readonly resultHash: string;
  readonly sourceId: string;
  readonly sourceRevisionHash: string;
}

export interface DatasetAnswerCitation {
  readonly kind: "dataset";
  readonly refId: string;
  readonly label: string;
  readonly title: string;
  readonly locator: string;
  readonly evidence: DatasetEvidenceRef;
}

export type AgentAnswerCitation = RetrievalAnswerCitation | DatasetAnswerCitation;

export interface DatasetQueryPreviewColumn {
  readonly key: string;
  readonly label: string;
  readonly logicalType: DatasetLogicalType;
  readonly sourceColumnId?: string | undefined;
  readonly aggregate?: string | undefined;
}

export interface DatasetQueryPreviewRow {
  readonly rowId?: string | undefined;
  readonly values: readonly DatasetQueryScalar[];
}

export interface DatasetQueryPreview {
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly planHash: string;
  readonly resultHash: string;
  readonly columns: readonly DatasetQueryPreviewColumn[];
  readonly rows: readonly DatasetQueryPreviewRow[];
  readonly matchedRowCount: number;
  readonly returnedRowCount: number;
  readonly truncated: boolean;
  readonly citationRefs: readonly string[];
}

export interface RetrievalAskResult extends RetrievalSearchResult {
  readonly answeredAt: string;
  readonly answer: string;
  readonly answerMode: "local_extractive" | "model_grounded";
  readonly confidence: "grounded" | "limited" | "insufficient";
  readonly citations: readonly RetrievalAnswerCitation[];
  readonly warnings: readonly RetrievalAnswerWarning[];
}

export type HomeAgentModelUsage = "none" | "local" | "cloud";

export type AgentTurnInputKind =
  | "typed_text"
  | "pasted_text"
  | "typed_url"
  | "pasted_url"
  | "file_drop"
  | "file_picker"
  | "follow_up";

export interface AgentTurnCurrentNoteScope {
  readonly kind: "current_note";
  readonly pageId: string;
}

export type AgentTurnScope = AgentTurnCurrentNoteScope;

export interface AgentSubmitTurnRequest {
  readonly schemaVersion?: 1;
  readonly text?: string;
  readonly inputKind: AgentTurnInputKind;
  readonly scope?: AgentTurnScope;
  readonly locale: Locale;
  readonly stagedItems?: readonly AgentStagedItem[];
  readonly clientTurnId?: string;
  readonly conversationId?: string;
  readonly expectedTailEventId?: string;
}

export interface AgentTurnAnswer {
  readonly answer: string;
  readonly grounding: "general" | "local_knowledge" | "source" | "insufficient_evidence";
  readonly citations: readonly AgentAnswerCitation[];
  readonly retrieval?: RetrievalSearchResult;
  readonly datasetResult?: DatasetQueryPreview | undefined;
}

export type AgentSubmitTurnResult =
  | {
      readonly requestId: string;
      readonly jobId: string;
      readonly conversationEventId: string;
      readonly conversationId: string;
      readonly tailEventId: string;
      readonly state: "completed";
      readonly currentNoteAppendApplied?: true;
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly answer: AgentTurnAnswer;
    }
  | {
      readonly requestId: string;
      readonly jobId: string;
      readonly conversationEventId: string;
      readonly conversationId: string;
      readonly tailEventId: string;
      readonly state: "waiting";
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly proposalId?: string | undefined;
      readonly error: PigeErrorSummary;
    }
  | {
      readonly requestId: string;
      readonly jobId?: string;
      readonly conversationEventId?: string;
      readonly conversationId?: string;
      readonly tailEventId?: string;
      readonly state: "failed";
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly error: PigeErrorSummary;
    };

export interface AgentConversationInitialRequest {
  readonly conversationId?: string;
  readonly scope?: AgentTurnScope;
  readonly limit?: number;
}

export interface AgentConversationEarlierRequest {
  readonly conversationId: string;
  readonly scope?: AgentTurnScope;
  readonly limit?: number;
  readonly snapshotTailEventId: string;
  readonly earlierCursor: string;
}

export type AgentConversationRequest = AgentConversationInitialRequest | AgentConversationEarlierRequest;

export interface AgentConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly createdAt: string;
  readonly text: string;
  readonly jobId?: string;
  readonly answer?: AgentTurnAnswer;
  readonly inputPresentation?: AgentConversationInputPresentation;
}

export type AgentConversationInputPresentation =
  | {
      readonly kind: "reader_selection_action";
      readonly action: ReaderSelectionReadAction | "link";
    }
  | {
      readonly kind: "reader_selection_transform";
      readonly action: ReaderSelectionTransformAction;
    };

export interface AgentConversationTurnSummary {
  readonly jobId: string;
  readonly userEventId: string;
  readonly state: JobState;
  readonly proposalId?: string | undefined;
  readonly currentNoteAppendApplied?: true;
  readonly error?: PigeErrorSummary;
}

export interface AgentConversationInitialTimeline {
  readonly kind: "initial";
  readonly conversationId: string;
  readonly snapshotTailEventId: string;
  readonly tailEventId: string;
  readonly canFollowUp: boolean;
  readonly messages: readonly AgentConversationMessage[];
  readonly hasEarlier: boolean;
  readonly nextEarlierCursor?: string | undefined;
  readonly latestTurn?: AgentConversationTurnSummary | undefined;
}

export interface AgentConversationEarlierPage {
  readonly kind: "earlier";
  readonly conversationId: string;
  readonly snapshotTailEventId: string;
  readonly messages: readonly AgentConversationMessage[];
  readonly hasEarlier: boolean;
  readonly nextEarlierCursor?: string | undefined;
}

export type AgentConversationResult = AgentConversationInitialTimeline | AgentConversationEarlierPage;

export interface AgentConversationTimeline {
  readonly kind?: "initial";
  readonly conversationId: string;
  readonly snapshotTailEventId?: string;
  readonly tailEventId: string;
  readonly canFollowUp: boolean;
  readonly messages: readonly AgentConversationMessage[];
  readonly hasEarlier?: boolean;
  readonly nextEarlierCursor?: string | undefined;
  readonly latestTurn?: AgentConversationTurnSummary | undefined;
}

export interface AgentTurnDraftEvent {
  readonly apiVersion: 1;
  readonly kind: "draft_replace";
  readonly requestId: string;
  readonly clientTurnId: string;
  readonly jobId: string;
  readonly conversationId: string;
  readonly conversationEventId: string;
  readonly sequence: number;
  readonly text: string;
}

export interface ToolchainToolStatus {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly status: "ready" | "missing";
  readonly resolvedPath?: string;
  readonly repairHint?: string;
}

export interface ToolchainHealth {
  readonly status: "ready" | "needs_repair";
  readonly checkedAt: string;
  readonly tools: readonly ToolchainToolStatus[];
  readonly repair?: ToolchainRepairEligibility;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  readonly mode: WindowLayoutMode;
  readonly alwaysOnTop: boolean;
  readonly sidebarOpen: boolean;
  readonly isFullScreen: boolean;
  readonly size: WindowSize;
}

export interface SetWindowModeRequest {
  readonly mode: WindowLayoutMode;
}

export interface SetAlwaysOnTopRequest {
  readonly alwaysOnTop: boolean;
}

export interface SetSidebarOpenRequest {
  readonly sidebarOpen: boolean;
}

export interface BackupRestoreStatus {
  readonly phase: "entry_point_only" | "available";
  readonly createAvailable: boolean;
  readonly restoreAvailable: boolean;
  readonly lastBackupAt?: string;
  readonly messageKey: "backup.statusEntryOnly" | "backup.statusReady" | "backup.statusNoVault";
  readonly defaultIncludes: {
    readonly markdownKnowledge: boolean;
    readonly sourceRecords: boolean;
    readonly managedSourceCopies: boolean;
    readonly conversations: boolean;
    readonly vaultMemory: boolean;
    readonly trash: boolean;
    readonly rebuildableDatabaseCache: boolean;
    readonly secrets: boolean;
  };
}

export interface BackupManifestSummary {
  readonly formatVersion: 1;
  readonly format: "pige-backup";
  readonly appVersion: string;
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultSchemaVersion: number;
  readonly createdAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly noteCount: number;
  readonly sourceCount: number;
  readonly conversationCount: number;
  readonly memoryCount: number;
  readonly includesSecrets: false;
  readonly includes: BackupRestoreStatus["defaultIncludes"];
}

export interface BackupCreateResult {
  readonly status: "created" | "canceled";
  readonly backupPath?: string;
  readonly manifest?: BackupManifestSummary;
}

export type RestoreMode = "clone_as_new" | "replace_existing";

export type RestorePreviewWarning =
  | {
      readonly code: "invalid_archive_entries";
      readonly count: number;
    }
  | {
      readonly code: "excluded_rebuildable_roots";
      readonly count: number;
    }
  | {
      readonly code: "external_originals_not_included";
      readonly count: number;
    };

export type RestorePreviewResult =
  | {
      readonly status: "ready";
      readonly previewId: string;
      readonly manifest: BackupManifestSummary;
      readonly invalidFileCount: number;
      readonly warnings: readonly RestorePreviewWarning[];
      readonly permittedModes: readonly RestoreMode[];
      readonly defaultMode: RestoreMode;
    }
  | {
      readonly status: "canceled";
      readonly previewId?: never;
      readonly manifest?: never;
      readonly invalidFileCount?: never;
      readonly warnings?: never;
      readonly permittedModes?: never;
      readonly defaultMode?: never;
    };

export interface RestoreApplyRequest {
  readonly previewId: string;
  readonly mode: RestoreMode;
}

export type RestoreApplyResult =
  | {
      readonly status: "restored";
      readonly jobId: string;
    }
  | {
      readonly status: "canceled";
      readonly jobId?: never;
    };

export interface CreateVaultRequest {
  readonly vaultName: string;
}

export interface OpenRecentVaultRequest {
  readonly vaultId: string;
}

export interface UpdateSourceStoragePolicyRequest {
  readonly defaultStrategy: SourceStorageStrategy;
}

export type VaultActionResult =
  | {
      readonly status: "completed";
      readonly compatibility: "current";
      readonly vault: VaultSummary;
      readonly onboarding: OnboardingStatus;
    }
  | {
      readonly status: "canceled";
    }
  | {
      readonly status: "needs_migration";
      readonly preview: VaultMigrationPreview;
    }
  | {
      readonly status: "unsupported_newer";
      readonly vaultId: string;
      readonly foundVersion: number;
      readonly supportedVersion: 2;
    }
  | {
      readonly status: "invalid";
      readonly reason: VaultOpenInvalidReason;
    };

export interface PigeDesktopApi {
  readonly getHealth: () => Promise<AppHealth>;
  readonly window: {
    readonly current: () => Promise<WindowState>;
    readonly currentLayout: () => Promise<WindowLayoutState>;
    readonly setLayout: (request: WindowLayoutRequest) => Promise<WindowLayoutState>;
    readonly onLayoutChanged: (listener: (state: WindowLayoutState) => void) => () => void;
    readonly setMode: (request: SetWindowModeRequest) => Promise<WindowState>;
    readonly setAlwaysOnTop: (request: SetAlwaysOnTopRequest) => Promise<WindowState>;
    readonly setSidebarOpen: (request: SetSidebarOpenRequest) => Promise<WindowState>;
  };
  readonly agent: {
    readonly runtimeStatus: () => Promise<AgentRuntimeStatus>;
    readonly submitTurn: {
      (
        request: AgentSubmitTurnRequest & { readonly stagedItems: readonly AgentStagedItem[] },
        files?: readonly File[]
      ): Promise<AgentStagedSubmitTurnResult>;
      (
        request: AgentSubmitTurnRequest & { readonly stagedItems?: undefined },
        files?: readonly File[]
      ): Promise<AgentSubmitTurnResult>;
    };
    readonly conversation: {
      (request: AgentConversationEarlierRequest): Promise<AgentConversationEarlierPage>;
      (request?: AgentConversationInitialRequest): Promise<AgentConversationInitialTimeline | undefined>;
    };
    readonly conversationHistory: (
      request: AgentConversationHistoryListRequest
    ) => Promise<AgentConversationHistoryListResult>;
    readonly exportConversation: (
      request: AgentConversationExportRequest
    ) => Promise<AgentConversationExportResult>;
    readonly trashConversation: (
      request: ConversationTrashRequest
    ) => Promise<ConversationTrashResult>;
    readonly conversationTrash: (
      request: ConversationTrashListRequest
    ) => Promise<ConversationTrashListResult>;
    readonly restoreConversation: (
      request: ConversationRestoreRequest
    ) => Promise<ConversationRestoreResult>;
    readonly setConversationTitle: (
      request: AgentConversationSetTitleRequest
    ) => Promise<AgentConversationSetTitleResult>;
    readonly currentNoteAppendProposal: (
      request: CurrentNoteAppendProposalGetRequest
    ) => Promise<CurrentNoteAppendProposalGetResult>;
    readonly decideCurrentNoteAppendProposal: (
      request: CurrentNoteAppendProposalDecisionRequest
    ) => Promise<CurrentNoteAppendProposalDecisionResult>;
    readonly currentNoteReplaceProposal: (
      request: CurrentNoteReplaceProposalGetRequest
    ) => Promise<CurrentNoteReplaceProposalGetResult>;
    readonly decideCurrentNoteReplaceProposal: (
      request: CurrentNoteReplaceProposalDecisionRequest
    ) => Promise<CurrentNoteReplaceProposalDecisionResult>;
    readonly onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void) => () => void;
  };
  readonly jobs: {
    readonly list: (request?: JobsListRequest) => Promise<JobsListResult>;
    readonly cancel: (request: JobActionRequest) => Promise<JobActionResult>;
    readonly retry: (request: JobActionRequest) => Promise<JobActionResult>;
    readonly reconnectOriginalSource: (
      request: ReferencedOriginalReconnectRequest
    ) => Promise<ReferencedOriginalReconnectResult>;
  };
  readonly confirmations: {
    readonly pending: () => Promise<HighRiskConfirmationPendingResult>;
    readonly resolve: (
      request: HighRiskConfirmationResolveRequest
    ) => Promise<HighRiskConfirmationResolveResult>;
    readonly onChanged: (
      listener: (event: HighRiskConfirmationChangedEvent) => void
    ) => () => void;
  };
  readonly permissions: {
    readonly summary: (
      request: PermissionPolicySummaryRequest
    ) => Promise<PermissionPolicySummaryResult>;
    readonly setDefaultMode: (
      request: PermissionSetDefaultModeRequest
    ) => Promise<PermissionSetDefaultModeResult>;
    readonly revokeGrant: (
      request: PermissionRevokeGrantRequest
    ) => Promise<PermissionRevokeGrantResult>;
    readonly onChanged: (
      listener: (event: PermissionPolicyChangedEvent) => void
    ) => () => void;
  };
  readonly piPackages: {
    readonly summary: () => Promise<PiPackageRegistryQueryResult>;
    readonly catalogQuery: (
      request: PiPackageCatalogQueryRequest
    ) => Promise<PiPackageCatalogQueryResult>;
    readonly install: (
      request: PiPackageInstallRequest
    ) => Promise<PiPackageInstallResult>;
    readonly uninstall: (
      request: PiPackageUninstallRequest
    ) => Promise<PiPackageUninstallResult>;
    readonly restore: (
      request: PiPackageRestoreRequest
    ) => Promise<PiPackageRestoreResult>;
    readonly update: (
      request: PiPackageUpdateRequest
    ) => Promise<PiPackageUpdateResult>;
    readonly rollback: (
      request: PiPackageRollbackRequest
    ) => Promise<PiPackageRollbackResult>;
    readonly setPinned: (
      request: PiPackageSetPinnedRequest
    ) => Promise<PiPackageSetPinnedResult>;
  };
  readonly taskExecution: {
    readonly interaction: () => Promise<TaskInteractionPendingResult>;
    readonly openInteraction: (
      request: TaskInteractionOpenRequest
    ) => Promise<TaskInteractionOpenResult>;
    readonly onInteractionChanged: (
      listener: (event: TaskInteractionChangedEvent) => void
    ) => () => void;
  };
  readonly skills: {
    readonly summary: () => Promise<SkillRegistryQueryResult>;
    readonly pendingStagedReviews: (
      request: SkillPendingStagedReviewsRequest
    ) => Promise<SkillPendingStagedReviewsResult>;
    readonly stageFromUrl: (request: SkillStageFromUrlRequest) => Promise<SkillStageFromUrlResult>;
    readonly stageFromMarkdown: (request: SkillStageFromMarkdownRequest) => Promise<SkillStageFromMarkdownResult>;
    readonly stageFromZip: (request: SkillStageFromZipRequest) => Promise<SkillStageFromZipResult>;
    readonly stageUpdate: (request: SkillStageUpdateRequest) => Promise<SkillStageUpdateResult>;
    readonly installStaged: (request: SkillInstallStagedRequest) => Promise<SkillInstallStagedResult>;
    readonly discardStaged: (request: SkillDiscardStagedRequest) => Promise<SkillDiscardStagedResult>;
    readonly disable: (request: SkillDisableRequest) => Promise<SkillRegistryMutationResult>;
    readonly enable: (request: SkillEnableRequest) => Promise<SkillLifecycleMutationResult>;
    readonly uninstall: (request: SkillUninstallRequest) => Promise<SkillLifecycleMutationResult>;
    readonly restore: (request: SkillRestoreRequest) => Promise<SkillRestoreResult>;
    readonly export: (request: SkillExportRequest) => Promise<SkillExportResult>;
    readonly onChanged: (listener: (summary: SkillRegistrySummary) => void) => () => void;
  };
  readonly memory: {
    readonly list: (request: MemoryListRequest) => Promise<MemorySummary>;
    readonly disable: (request: MemoryDisableRequest) => Promise<MemoryMutationResult>;
    readonly edit: (request: MemoryEditRequest) => Promise<MemoryLifecycleMutationResult>;
    readonly enable: (request: MemoryEnableRequest) => Promise<MemoryLifecycleMutationResult>;
    readonly delete: (request: MemoryDeleteRequest) => Promise<MemoryLifecycleMutationResult>;
    readonly export: (request: MemoryExportRequest) => Promise<MemoryExportResult>;
    readonly reset: (request: MemoryResetRequest) => Promise<MemoryLifecycleMutationResult>;
    readonly onChanged: (listener: (summary: MemorySummary) => void) => () => void;
  };
  readonly collections: {
    readonly list: (request: CollectionListRequest) => Promise<CollectionListResult>;
    readonly open: (request: CollectionOpenRequest) => Promise<CollectionOpenResult>;
    readonly openCitation: (
      request: CollectionOpenCitationRequest
    ) => Promise<CollectionOpenCitationResult>;
    readonly editCell: (request: CollectionCellEditRequest) => Promise<CollectionCellEditResult>;
    readonly appendDefaultRow: (
      request: CollectionAppendDefaultRowRequest
    ) => Promise<CollectionAppendDefaultRowResult>;
    readonly addNullableColumn: (
      request: CollectionAddNullableColumnRequest
    ) => Promise<CollectionAddNullableColumnResult>;
    readonly addFormulaColumn: (
      request: CollectionAddFormulaColumnRequest
    ) => Promise<CollectionAddFormulaColumnResult>;
    readonly updateFormulaColumn: (
      request: CollectionUpdateFormulaColumnRequest
    ) => Promise<CollectionUpdateFormulaColumnResult>;
    readonly addRelationColumn: (
      request: CollectionAddRelationColumnRequest
    ) => Promise<CollectionAddRelationColumnResult>;
    readonly editRelationCell: (
      request: CollectionEditRelationCellRequest
    ) => Promise<CollectionEditRelationCellResult>;
    readonly addLookupColumn: (
      request: CollectionAddLookupColumnRequest
    ) => Promise<CollectionAddLookupColumnResult>;
    readonly renameColumn: (
      request: CollectionRenameColumnRequest
    ) => Promise<CollectionRenameColumnResult>;
    readonly createView: (
      request: CollectionCreateViewRequest
    ) => Promise<CollectionCreateViewResult>;
    readonly renameView: (
      request: CollectionRenameViewRequest
    ) => Promise<CollectionRenameViewResult>;
    readonly trashView: (
      request: CollectionTrashViewRequest
    ) => Promise<CollectionTrashViewResult>;
    readonly trashColumn: (
      request: CollectionTrashColumnRequest
    ) => Promise<CollectionTrashColumnResult>;
    readonly trashRow: (request: CollectionTrashRowRequest) => Promise<CollectionTrashRowResult>;
  };
  readonly activity: {
    readonly list: (request?: KnowledgeActivityListRequest) => Promise<KnowledgeActivityListResult>;
    readonly undo: (request: KnowledgeActivityUndoRequest) => Promise<KnowledgeActivityUndoResult>;
  };
  readonly proposals: {
    readonly list: (request?: ProposalsListRequest) => Promise<ProposalsListResult>;
    readonly get: (request: ProposalGetRequest) => Promise<ProposalGetResult>;
    readonly approve: (request: ProposalDecisionRequest) => Promise<ProposalDecisionResult>;
    readonly reject: (request: ProposalDecisionRequest) => Promise<ProposalDecisionResult>;
    readonly review: (request: ProposalReviewRequest) => Promise<ProposalReviewResult>;
    readonly decide: (request: ProposalReviewDecisionRequest) => Promise<ProposalReviewDecisionResult>;
  };
  readonly readerSelection: {
    readonly resolve: (
      request: ReaderSelectionResolveRequest
    ) => Promise<ReaderSelectionResolveResult>;
    readonly submitAction: (
      request: ReaderSelectionActionRequest
    ) => Promise<ReaderSelectionActionResult>;
    readonly submitLink: (
      request: ReaderSelectionLinkRequest
    ) => Promise<ReaderSelectionLinkResult>;
    readonly submitTransform: (
      request: ReaderSelectionTransformRequest
    ) => Promise<ReaderSelectionTransformResult>;
    readonly submitCreateNote: (
      request: ReaderSelectionCreateNoteRequest
    ) => Promise<ReaderSelectionCreateNoteResult>;
    readonly currentProposal: (
      request: ReaderSelectionProposalGetRequest
    ) => Promise<ReaderSelectionProposalGetResult>;
    readonly decideProposal: (
      request: ReaderSelectionProposalDecisionRequest
    ) => Promise<ReaderSelectionProposalDecisionResult>;
  };
  readonly library: {
    readonly list: (request?: LibraryListRequest) => Promise<LibraryListResult>;
    readonly tree: () => Promise<KnowledgeTreeResult>;
    readonly related: (request: LibraryRelatedRequest) => Promise<LibraryRelatedResult>;
    readonly tags: (request: LibraryTagsRequest) => Promise<LibraryTagsResult>;
    readonly renameTag: (request: LibraryRenameTagRequest) => Promise<LibraryRenameTagResult>;
    readonly mergeTag: (request: LibraryMergeTagRequest) => Promise<LibraryMergeTagResult>;
    readonly removeTag: (request: LibraryRemoveTagRequest) => Promise<LibraryRemoveTagResult>;
    readonly removePageTag: (request: LibraryRemovePageTagRequest) => Promise<LibraryRemovePageTagResult>;
  };
  readonly notes: {
    readonly get: (request: NoteGetRequest) => Promise<NoteDocument>;
    readonly render: (request: NoteRenderRequest) => Promise<NoteRenderResult>;
    readonly openEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
    readonly saveEditor: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
    readonly merge: (request: NoteMergeRequest) => Promise<NoteMergeResult>;
    readonly relate: (request: NoteRelateRequest) => Promise<NoteRelateResult>;
    readonly importMarkdown: (
      request: NoteImportMarkdownRequest
    ) => Promise<NoteImportMarkdownResult>;
    readonly archiveCurrent: (
      request: NoteArchiveCurrentRequest
    ) => Promise<NoteArchiveCurrentResult>;
    readonly restoreArchived: (
      request: NoteRestoreArchivedRequest
    ) => Promise<NoteRestoreArchivedResult>;
    readonly addTag: (request: NoteAddTagRequest) => Promise<NoteAddTagResult>;
    readonly editTaxonomy: (request: NoteEditTaxonomyRequest) => Promise<NoteEditTaxonomyResult>;
    readonly trashCurrent: (
      request: NoteTrashCurrentRequest
    ) => Promise<NoteTrashCurrentResult>;
    readonly listTrash: (request: NoteTrashListRequest) => Promise<NoteTrashListResult>;
    readonly restoreTrash: (request: NoteTrashRestoreRequest) => Promise<NoteTrashRestoreResult>;
    readonly listRevisionHistory: (
      request: NoteRevisionHistoryListRequest
    ) => Promise<NoteRevisionHistoryListResult>;
    readonly openRevisionHistory: (
      request: NoteRevisionHistoryOpenRequest
    ) => Promise<NoteRevisionHistoryOpenResult>;
    readonly restoreRevisionHistory: (
      request: NoteRevisionHistoryRestoreRequest
    ) => Promise<NoteRevisionHistoryRestoreResult>;
    readonly resolveInlineReference: (
      request: NoteResolveInlineReferenceRequest
    ) => Promise<NoteResolveInlineReferenceResult>;
    readonly openSourceReference: (
      request: NoteOpenSourceReferenceRequest
    ) => Promise<NoteOpenSourceReferenceResult>;
    readonly revealSource: (
      request: NoteRevealSourceRequest
    ) => Promise<NoteRevealSourceResult>;
    readonly reconnectOriginalSource: (
      request: NoteReconnectOriginalSourceRequest
    ) => Promise<NoteReconnectOriginalSourceResult>;
  };
  readonly sourceRefresh: {
    readonly preview: (request: SourceRefreshPreviewRequest) => Promise<SourceRefreshPreviewResult>;
    readonly confirm: (request: SourceRefreshConfirmRequest) => Promise<SourceRefreshConfirmResult>;
  };
  readonly localCapabilities: {
    readonly ocrLanguagePreference: (
      request: OcrLanguagePreferenceRequest
    ) => Promise<OcrLanguagePreferenceResult>;
    readonly setOcrLanguagePreference: (
      request: SetOcrLanguagePreferenceRequest
    ) => Promise<SetOcrLanguagePreferenceResult>;
    readonly paddleOcrSummary: (
      request: PaddleOcrSummaryRequest
    ) => Promise<PaddleOcrSummary>;
    readonly installPaddleOcr: (
      request: PaddleOcrInstallRequest
    ) => Promise<PaddleOcrInstallResult>;
    readonly enablePaddleOcr: (
      request: PaddleOcrEnableRequest
    ) => Promise<PaddleOcrEnableResult>;
    readonly testPaddleOcr: (
      request: PaddleOcrTestRequest
    ) => Promise<PaddleOcrTestResult>;
    readonly disablePaddleOcr: (
      request: PaddleOcrDisableRequest
    ) => Promise<PaddleOcrDisableResult>;
    readonly removePaddleOcr: (
      request: PaddleOcrRemoveRequest
    ) => Promise<PaddleOcrRemoveResult>;
  };
  readonly retrieval: {
    readonly search: (request: RetrievalSearchRequest) => Promise<RetrievalSearchResult>;
    readonly localSemanticStatus: (
      request: LocalSemanticRetrievalStatusRequest
    ) => Promise<LocalSemanticRetrievalStatus>;
    readonly installLocalSemanticAsset: (
      request: LocalSemanticRetrievalInstallRequest
    ) => Promise<LocalSemanticRetrievalInstallResult>;
    readonly enableLocalSemanticAsset: (
      request: LocalSemanticRetrievalEnableRequest
    ) => Promise<LocalSemanticRetrievalEnableResult>;
    readonly disableLocalSemanticAsset: (
      request: LocalSemanticRetrievalDisableRequest
    ) => Promise<LocalSemanticRetrievalDisableResult>;
    readonly removeLocalSemanticAsset: (
      request: LocalSemanticRetrievalRemoveRequest
    ) => Promise<LocalSemanticRetrievalRemoveResult>;
  };
  readonly vault: {
    readonly current: () => Promise<VaultSummary | undefined>;
    readonly recent: () => Promise<readonly RecentVaultSummary[]>;
    readonly onboardingStatus: () => Promise<OnboardingStatus>;
    readonly dismissFirstHomeGuide: () => Promise<OnboardingStatus>;
    readonly create: (request: CreateVaultRequest) => Promise<VaultActionResult>;
    readonly open: () => Promise<VaultActionResult>;
    readonly openRecent: (request: OpenRecentVaultRequest) => Promise<VaultActionResult>;
    readonly applyMigration: (
      request: VaultMigrationApplyRequest
    ) => Promise<VaultMigrationApplyResult>;
    readonly renameDisplayName: (
      request: VaultRenameDisplayNameRequest
    ) => Promise<VaultRenameDisplayNameResult>;
    readonly revealKnowledgeRoot: () => Promise<VaultRevealResult>;
    readonly revealSourceAssetRoot: () => Promise<VaultRevealResult>;
    readonly updateSourceStoragePolicy: (request: UpdateSourceStoragePolicyRequest) => Promise<VaultSummary>;
    readonly configureManagedCopyRoot: (
      request: ManagedCopyRootConfigureRequest
    ) => Promise<ManagedCopyRootConfigureResult>;
    readonly storageRelocationStatus: () => Promise<VaultStorageRelocationStatus>;
    readonly relocateStorage: (
      request: VaultStorageRelocationRequest
    ) => Promise<VaultStorageRelocationResult>;
    readonly removeRecent: (vaultId: string) => Promise<readonly RecentVaultSummary[]>;
  };
  readonly maintenance: {
    readonly rebuildLocalDatabase: () => Promise<LocalDatabaseRebuildResult>;
    readonly resetLocalDatabase: () => Promise<LocalDatabaseResetResult>;
    readonly localDatabaseStatus: () => Promise<LocalDatabaseStatus>;
    readonly runKnowledgeHealth: (
      request: KnowledgeHealthRunRequest
    ) => Promise<KnowledgeHealthRunResult>;
    readonly searchKnowledgeHealthTargets: (
      request: KnowledgeHealthTargetSearchRequest
    ) => Promise<KnowledgeHealthTargetSearchResult>;
    readonly searchKnowledgeHealthOrphanParents: (
      request: KnowledgeHealthOrphanParentSearchRequest
    ) => Promise<KnowledgeHealthOrphanParentSearchResult>;
    readonly repairKnowledgeHealthOrphan: (
      request: KnowledgeHealthOrphanRepairRequest
    ) => Promise<KnowledgeHealthOrphanRepairResult>;
    readonly repairKnowledgeHealth: (
      request: KnowledgeHealthRepairRequest
    ) => Promise<KnowledgeHealthRepairResult>;
    readonly repairKnowledgeHealthDuplicateTopic: (
      request: KnowledgeHealthDuplicateTopicRepairRequest
    ) => Promise<KnowledgeHealthDuplicateTopicRepairResult>;
  };
  readonly diagnostics: {
    readonly health: () => Promise<DiagnosticsHealth>;
    readonly workflowSummary: () => Promise<DiagnosticsWorkflowSummary>;
    readonly clearLocalDiagnostics: (
      request: DiagnosticsClearLocalRequest
    ) => Promise<DiagnosticsClearLocalResult>;
    readonly previewSupportBundle: (
      request: DiagnosticsPreviewSupportBundleRequest
    ) => Promise<SupportBundlePreview>;
    readonly exportSupportBundle: (request: ExportSupportBundleRequest) => Promise<SupportBundleExportResult>;
    readonly cancelSupportBundleExport: (
      request: CancelSupportBundleExportRequest
    ) => Promise<CancelSupportBundleExportResult>;
    readonly retrySupportBundleExport: (
      request: DiagnosticsSupportBundleMutationRequest
    ) => Promise<DiagnosticsSupportBundleMutationResult>;
  };
  readonly models: {
    readonly summary: () => Promise<ModelProviderSettingsSummary>;
    readonly addPresetProvider: (request: AddPresetProviderRequest) => Promise<ProviderConnectResult>;
    readonly addManualProvider: (request: AddManualProviderRequest) => Promise<ProviderConnectResult>;
    readonly refreshProviderModels: (request: RefreshProviderModelsRequest) => Promise<ModelProviderSettingsSummary>;
    readonly updateProviderCredential: (
      request: UpdateProviderCredentialRequest
    ) => Promise<ModelProviderSettingsSummary>;
    readonly deleteProvider: (request: DeleteProviderRequest) => Promise<ModelProviderSettingsSummary>;
    readonly addManualModel: (request: AddManualModelRequest) => Promise<ModelProviderSettingsSummary>;
    readonly updateModel: (request: UpdateModelRequest) => Promise<ModelProviderSettingsSummary>;
    readonly setDefaultModel: (request: SetDefaultModelRequest) => Promise<ModelProviderSettingsSummary>;
  };
  readonly settings: {
    readonly appearance: () => Promise<AppearanceSettingsSummary>;
    readonly setLocale: (request: SetLocaleRequest) => Promise<AppearanceSettingsSummary>;
    readonly setTheme: (request: SetThemeRequest) => Promise<AppearanceThemeMutationResult>;
    readonly setKnowledgeLanguage: (
      request: SetKnowledgeLanguageRequest
    ) => Promise<KnowledgeLanguageMutationResult>;
    readonly startupDestination: () => Promise<StartupDestinationSummary>;
    readonly setStartupDestination: (
      request: SetStartupDestinationRequest
    ) => Promise<StartupDestinationMutationResult>;
    readonly onAppearanceChanged: (listener: (settings: AppearanceSettingsSummary) => void) => () => void;
    readonly registry: () => Promise<SettingsRegistrySummary>;
  };
  readonly updates: {
    readonly summary: () => Promise<UpdateSummary>;
    readonly check: (request: UpdateCheckRequest) => Promise<UpdateCheckResult>;
    readonly download: (request: UpdateDownloadRequest) => Promise<UpdateDownloadResult>;
    readonly apply: (request: UpdateApplyRequest) => Promise<UpdateApplyResult>;
    readonly onStatusChanged: (listener: (event: UpdateStatusEvent) => void) => () => void;
  };
  readonly backup: {
    readonly status: () => Promise<BackupRestoreStatus>;
    readonly memoryPreferenceStatus: () => Promise<BackupMemoryPreferenceSummary>;
    readonly setMemoryPreference: (
      request: BackupMemoryPreferenceUpdateRequest
    ) => Promise<BackupMemoryPreferenceUpdateResult>;
    readonly create: () => Promise<BackupCreateResult>;
    readonly reconnectDependency: (
      request: BackupReconnectDependencyRequest
    ) => Promise<BackupReconnectDependencyResult>;
    readonly reconnectDestination: (
      request: BackupReconnectDestinationRequest
    ) => Promise<BackupReconnectDestinationResult>;
    readonly continueIncomplete: (
      request: BackupContinueIncompleteRequest
    ) => Promise<BackupContinueIncompleteResult>;
    readonly previewRestore: () => Promise<RestorePreviewResult>;
    readonly applyRestore: (request: RestoreApplyRequest) => Promise<RestoreApplyResult>;
    readonly cancelRestore: (request: RestoreCancelRequest) => Promise<RestoreCancelResult>;
  };
  readonly system: {
    readonly toolchainHealth: () => Promise<ToolchainHealth>;
    readonly repairToolchain: (
      request: ToolchainRepairRequest
    ) => Promise<ToolchainRepairResult>;
  };
  readonly speech: {
    readonly availability: (request: SpeechAvailabilityRequest) => Promise<SpeechAvailabilityResult>;
    readonly installLanguageAsset: (request: SpeechAssetInstallRequest) => Promise<SpeechAssetInstallResult>;
    readonly start: (request: SpeechStartRequest) => Promise<SpeechStartResult>;
    readonly stop: (request: SpeechSessionRequest) => Promise<SpeechStopResult>;
    readonly cancel: (request: SpeechCancelRequest) => Promise<SpeechCancelResult>;
    readonly openSystemSettings: () => Promise<SpeechOpenSystemSettingsResult>;
    readonly onAssetInstallEvent: (listener: (event: SpeechAssetInstallEvent) => void) => () => void;
    readonly onSessionEvent: (listener: (event: SpeechSessionEvent) => void) => () => void;
  };
}

export interface RuntimeCapabilities {
  readonly runtimeKind: PigeRuntimeKind;
  readonly clientCapabilityTier: PigeClientCapabilityTier;
}
