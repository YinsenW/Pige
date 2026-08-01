import { describe, expect, it } from "vitest";
import {
  AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX,
  AGENT_CONVERSATION_HISTORY_PREVIEW_MAX_CODE_POINTS,
  AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS,
  AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS,
  AgentConversationHistoryListRequestSchema,
  AgentConversationHistoryListResultSchema,
  AgentSaveAnswerAsNoteRequestSchema,
  AgentSaveAnswerAsNoteResultSchema,
  ConversationRestoreRequestSchema,
  ConversationRestoreResultSchema,
  ConversationTrashListResultSchema,
  ConversationTrashRequestSchema,
  ConversationTrashResultSchema,
  AgentConversationHistoryQuerySchema,
  AgentConversationSetTitleRequestSchema,
  AgentConversationSetTitleResultSchema,
  AgentConversationTitleSchema,
  AgentConversationTurnSummarySchema,
  AgentSubmitTurnResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  KnowledgeLanguageMutationResultSchema,
  BackupContinueIncompleteRequestSchema,
  BackupContinueIncompleteResultSchema,
  BackupReconnectDestinationRequestSchema,
  BackupReconnectDestinationResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  RESTORE_CANCEL_CHANNEL,
  RestoreCancelRequestSchema,
  RestoreCancelResultSchema,
  ReferencedOriginalReconnectRequestSchema,
  ReferencedOriginalReconnectResultSchema,
  COLLECTION_ADD_FORMULA_COLUMN_CHANNEL,
  COLLECTION_ADD_RELATION_COLUMN_CHANNEL,
  COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL,
  COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL,
  COLLECTION_EDIT_RELATION_CELL_CHANNEL,
  COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL,
  COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL,
  COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES,
  COLLECTION_LIST_CHANNEL,
  COLLECTION_OPEN_CITATION_CHANNEL,
  COLLECTION_REVEAL_CHANNEL,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionAddLookupColumnRequestSchema,
  CollectionUpdateLookupColumnRequestSchema,
  CollectionAddRollupColumnRequestSchema,
  CollectionUpdateRollupColumnRequestSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionUpdateRelationColumnRequestSchema,
  CollectionUpdateRelationColumnResultSchema,
  CollectionRelationCellValueSchema,
  CollectionUpdateFormulaColumnRequestSchema,
  CollectionUpdateFormulaColumnResultSchema,
  ConfirmationProposalSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionUpdateViewRequestSchema,
  CollectionUpdateViewResultSchema,
  CollectionRenameViewRequestSchema,
  CollectionRenameViewResultSchema,
  CollectionTrashViewRequestSchema,
  CollectionTrashViewResultSchema,
  CollectionListRequestSchema,
  CollectionListResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  CollectionRevealRequestSchema,
  CollectionRevealResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  CurrentNoteAppendProposalDecisionRequestSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  CurrentNoteReplaceProposalDecisionRequestSchema,
  CurrentNoteReplaceProposalDecisionResultSchema,
  CurrentNoteReplaceProposalGetRequestSchema,
  CurrentNoteReplaceProposalGetResultSchema,
  ConversationEventSchema,
  DATASET_PIGE_FORMULA_MAX_DEPTH,
  DATASET_PIGE_FORMULA_MAX_NODES,
  DatasetPigeCalculationSchema,
  DatasetPigeFormulaExpressionSchema,
  DatasetPigeRelationCellSchema,
  DatasetPigeRelationSchema,
  DatasetPigeLookupSchema,
  DatasetPigeRollupSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  DatasetTableSchema,
  DiagnosticsClearLocalRequestSchema,
  DiagnosticsClearLocalResultSchema,
  ExternalWebSkillHttpsOriginSchema,
  ExternalWebSkillReadRequestSchema,
  ExternalWebSkillReadResultSchema,
  ExternalWebSkillRuntimeDeclarationSchema,
  FixtureManifestSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationSummarySchema,
  JobChangedEventSchema,
  JobRecordSchema,
  KnowledgeActivityListResultSchema,
  KnowledgeActivitySummarySchema,
  KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
  KnowledgeHealthTargetSearchRequestSchema,
  KnowledgeHealthTargetSearchResultSchema,
  KnowledgeHealthOrphanParentSearchRequestSchema,
  KnowledgeHealthOrphanParentSearchResultSchema,
  KnowledgeHealthOrphanRepairRequestSchema,
  KnowledgeHealthOrphanRepairResultSchema,
  LIBRARY_TAGS_CHANNEL,
  LIBRARY_RENAME_TAG_CHANNEL,
  LIBRARY_MERGE_TAG_CHANNEL,
  LIBRARY_REMOVE_TAG_CHANNEL,
  LIBRARY_REMOVE_PAGE_TAG_CHANNEL,
  LIBRARY_TAGS_PAGE_SIZE_MAX,
  LibraryTagsRequestSchema,
  LibraryTagsResultSchema,
  LibraryRenameTagRequestSchema,
  LibraryRenameTagResultSchema,
  LibraryMergeTagRequestSchema,
  LibraryMergeTagResultSchema,
  LibraryRemoveTagRequestSchema,
  LibraryRemoveTagResultSchema,
  LibraryRemovePageTagRequestSchema,
  LibraryRemovePageTagResultSchema,
  ManagedCopyRootConfigureRequestSchema,
  ManagedCopyRootConfigureResultSchema,
  ManagedCopyRootSummarySchema,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  LocalSemanticRetrievalDisableRequestSchema,
  LocalSemanticRetrievalEnableRequestSchema,
  LocalSemanticRetrievalEnableResultSchema,
  LocalSemanticRetrievalInstallRequestSchema,
  LocalSemanticRetrievalInstallResultSchema,
  LocalSemanticRetrievalRemoveRequestSchema,
  LocalSemanticRetrievalStatusRequestSchema,
  LocalSemanticRetrievalStatusSchema,
  MachineLocalSettingsSchema,
  MarkdownPageStatusSchema,
  MarkdownPageTypeSchema,
  MemoryDeleteRequestSchema,
  MemoryEditRequestSchema,
  MemoryEnableRequestSchema,
  MemoryExportRequestSchema,
  MemoryExportResultSchema,
  MemoryLifecycleMutationResultSchema,
  MemoryResetRequestSchema,
  MemorySummarySchema,
  NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES,
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorPortableMarkdownSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NoteMergeRequestSchema,
  NoteMergeResultSchema,
  NoteRevealGeneratedRequestSchema,
  NoteRevealGeneratedResultSchema,
  NoteRenderResultSchema,
  NoteSearchConceptParentsRequestSchema,
  NoteSearchConceptParentsResultSchema,
  NoteChangeConceptParentRequestSchema,
  NoteChangeConceptParentResultSchema,
  NoteOpenSearchMatchRequestSchema,
  NoteOpenSearchMatchResultSchema,
  NoteArchiveCurrentRequestSchema,
  NoteArchiveCurrentResultSchema,
  NoteRestoreArchivedRequestSchema,
  NoteRestoreArchivedResultSchema,
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
  NoteTrashCurrentRequestSchema,
  NoteTrashCurrentResultSchema,
  NoteTrashListRequestSchema,
  NoteTrashListResultSchema,
  NoteTrashRestoreRequestSchema,
  NoteTrashRestoreResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  NoteReconnectOriginalSourceRequestSchema,
  NoteReconnectOriginalSourceResultSchema,
  SourceReconnectListRequestSchema,
  SourceReconnectListResultSchema,
  SourceReconnectRequestSchema,
  SourceReconnectResultSchema,
  NoteRevealSourceRequestSchema,
  NoteRevealSourceResultSchema,
  OperationRecordSchema,
  DictationLanguagePreferenceRequestSchema,
  DictationLanguagePreferenceResultSchema,
  DictationLanguagePreferenceSummarySchema,
  OcrLanguagePreferenceRequestSchema,
  OcrLanguagePreferenceResultSchema,
  OcrLanguagePreferenceSummarySchema,
  OcrImageTestRequestSchema,
  OcrImageTestResultSchema,
  PADDLE_OCR_ENGINE_ID,
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
  PermissionDecisionRecordSchema,
  PermissionPolicySummaryRequestSchema,
  PermissionPolicySummaryResultSchema,
  PermissionRevokeGrantRequestSchema,
  PermissionRevokeGrantResultSchema,
  PermissionSetDefaultModeRequestSchema,
  PermissionSetDefaultModeResultSchema,
  SetOcrLanguagePreferenceRequestSchema,
  SetOcrLanguagePreferenceResultSchema,
  SetDictationLanguagePreferenceRequestSchema,
  SetDictationLanguagePreferenceResultSchema,
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
  RequirementIdSchema,
  ReaderSelectionCreateNoteRequestSchema,
  ReaderSelectionCreateNoteResultSchema,
  ReaderSelectionProposalDecisionResultSchema,
  RetrievalSearchResultSchema,
  SetStartupDestinationRequestSchema,
  SetThemeRequestSchema,
  SetKnowledgeLanguageRequestSchema,
  StartupDestinationMutationResultSchema,
  StartupDestinationSummarySchema,
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillEnableRequestSchema,
  SkillExportRequestSchema,
  SkillExportResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillLifecycleMutationResultSchema,
  SkillManifestSchema,
  SkillPendingStagedReviewsRequestSchema,
  SkillPendingStagedReviewsResultSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageFromZipRequestSchema,
  SkillStageFromZipResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillStagedSummarySchema,
  SkillRestoreRequestSchema,
  SkillRestoreResultSchema,
  SkillRegistrySummarySchema,
  SkillSummarySchema,
  SkillUninstallRequestSchema,
  SourceRefreshConfirmResultSchema,
  SourceRefreshPreviewResultSchema,
  SourceRecordSchema,
  TaskExecutionPlanSchema,
  TaskExecutionPlanSummarySchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema,
  ToolchainManifestSchema,
  TOOLCHAIN_REPAIR_CHANNEL,
  TOOLCHAIN_REPAIR_MAX_MISSING_TOOLS,
  ToolchainRepairEligibilitySchema,
  ToolchainRepairRequestSchema,
  ToolchainRepairResultSchema,
  Bcp47LanguageTagSchema,
  ConversationLanguageContinuitySchema,
  CurrentVaultManifestSchema,
  DurableLanguageFactSchema,
  DurableLanguageSchema,
  VAULT_APPLY_MIGRATION_CHANNEL,
  VaultActionResultSchema,
  VaultSummaryProjectionSchema,
  VaultConfigSchema,
  VaultManifestCompatibilityHeaderSchema,
  VaultManifestSchema,
  VaultMigrationApplyRequestSchema,
  VaultMigrationApplyResultSchema,
  VaultMigrationCheckpointSchema,
  VaultMigrationPreviewSchema,
  VaultRevealResultSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema,
  deriveSkillDataBoundaries
} from "@pige/schemas";

describe("schemas", () => {
  it("keeps source refresh previews renderer-safe and confirmation identity revision-bound", () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: "sourcerefreshreq_abcdefghijklmnop",
      activeVaultId: "vault_20260731_abcdefgh",
      currentPageId: "page_20260731_current1234",
      renderContextId: `notectx_${"a".repeat(32)}`,
      sourceId: "src_20260731_source1234"
    };
    const preview = {
      ...identity,
      status: "changed" as const,
      preview: {
        previewId: `sourcerefreshpreview_${"b".repeat(32)}`,
        expectedSourceRevision: `sourcerefreshrev_${"c".repeat(64)}`,
        displayName: "source.txt",
        sourceKind: "plain_text_file" as const,
        previousSize: 10,
        currentSize: 12,
        sizeDelta: 2,
        affectedArtifactCount: 1,
        refreshesSourcePage: true
      }
    };
    expect(SourceRefreshPreviewResultSchema.parse(preview)).toEqual(preview);
    expect(SourceRefreshPreviewResultSchema.parse({
      ...preview,
      preview: { ...preview.preview, displayName: "source.png", sourceKind: "image_file" }
    })).toMatchObject({ status: "changed", preview: { sourceKind: "image_file" } });
    expect(SourceRefreshPreviewResultSchema.parse({
      ...preview,
      preview: { ...preview.preview, displayName: "Saved article", sourceKind: "url" }
    })).toMatchObject({ status: "changed", preview: { sourceKind: "url" } });
    expect(() => SourceRefreshPreviewResultSchema.parse({ ...preview, path: "/private/source.txt" })).toThrow();
    expect(() => SourceRefreshPreviewResultSchema.parse({
      ...preview,
      preview: { ...preview.preview, checksum: `sha256:${"d".repeat(64)}` }
    })).toThrow();
    expect(SourceRefreshConfirmResultSchema.parse({
      ...identity,
      requestId: "sourcerefreshreq_qrstuvwxyzabcdef",
      previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision,
      status: "stale"
    })).toMatchObject({ status: "stale", expectedSourceRevision: preview.preview.expectedSourceRevision });
  });

  it("keeps machine-local diagnostics clear pathless, bounded, and all-or-current", () => {
    const request = {
      apiVersion: 1,
      requestId: "diagclearreq_abcdefghijklmnop",
      scopeContextId: `diagctx_${"a".repeat(48)}`,
      expectedRevision: 4
    } as const;
    const health = {
      status: "ok",
      checkedAt: "2026-07-29T12:00:00.000Z",
      localOnly: true,
      recentErrorCount: 0,
      checks: [{
        id: "diagnostics_store",
        status: "ok",
        message: "Local diagnostics store is writable."
      }]
    } as const;

    expect(DiagnosticsClearLocalRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["activeVaultId", "path", "body", "outputPath"] as const) {
      expect(() => DiagnosticsClearLocalRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }
    const workflow = {
      apiVersion: 1 as const,
      revision: 5,
      scopeContextId: request.scopeContextId,
      activeVaultId: "vault_20260729_diagnostics",
      localOnly: true as const,
      ownedArtifactCount: 0
    };
    expect(DiagnosticsClearLocalResultSchema.parse({ ...request, status: "cleared", health, workflow, clearedArtifactCount: 3 }))
      .toEqual({ ...request, status: "cleared", health, workflow, clearedArtifactCount: 3 });
    for (const status of ["busy", "stale"] as const) {
      expect(DiagnosticsClearLocalResultSchema.parse({ ...request, status, health, workflow }))
        .toEqual({ ...request, status, health, workflow });
    }
    expect(DiagnosticsClearLocalResultSchema.parse({ ...request, status: "failed" }))
      .toEqual({ ...request, status: "failed" });
    expect(() => DiagnosticsClearLocalResultSchema.parse({ ...request, status: "busy" })).toThrow();
    expect(() => DiagnosticsClearLocalResultSchema.parse({
      ...request,
      status: "failed",
      health
    })).toThrow();
    expect(() => DiagnosticsClearLocalResultSchema.parse({ ...request, status: "stale", health }))
      .toThrow();
  });

  it("strictly bounds renderer-safe conversation history without follow-up authority", () => {
    const activeVaultId = "vault_20260729_history01";
    const cursor = `conversation_history_${"a".repeat(64)}`;
    expect(AgentConversationHistoryListRequestSchema.parse({
      apiVersion: 1,
      activeVaultId,
      limit: AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX,
      cursor
    })).toEqual({ apiVersion: 1, activeVaultId, limit: 50, cursor });
    expect(() => AgentConversationHistoryListRequestSchema.parse({
      apiVersion: 1,
      activeVaultId,
      limit: AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX + 1
    })).toThrow();
    expect(() => AgentConversationHistoryListRequestSchema.parse({
      apiVersion: 1,
      activeVaultId,
      cursor: "conversation_history_unsigned"
    })).toThrow();

    const conversations = [
      {
        conversationId: "conv_20260729_history01",
        updatedAt: "2026-07-29T12:00:00.000Z",
        safePreview: "Summarize the selected note",
        tailEventId: "evt_20260729_historytail01",
        scope: { kind: "current_note", pageId: "page_20260729_history01" },
        inputPresentation: { kind: "reader_selection_action", action: "summarize" },
        latestTurnState: "completed"
      },
      {
        conversationId: "conv_20260729_history02",
        updatedAt: "2026-07-29T11:00:00.000Z",
        safePreview: "Compare the two sources",
        tailEventId: "evt_20260729_historytail02"
      }
    ] as const;
    const ready = {
      apiVersion: 1,
      activeVaultId,
      status: "ready",
      currentConversationId: conversations[0].conversationId,
      conversations,
      hasMore: true,
      nextCursor: cursor
    } as const;
    expect(AgentConversationHistoryListResultSchema.parse(ready)).toEqual(ready);
    expect(() => AgentConversationHistoryListResultSchema.parse({
      ...ready,
      conversations: [...conversations].reverse()
    })).toThrow();
    expect(() => AgentConversationHistoryListResultSchema.parse({
      ...ready,
      conversations: [
        { ...conversations[1], updatedAt: conversations[0].updatedAt },
        conversations[0]
      ]
    })).toThrow();
    expect(() => AgentConversationHistoryListResultSchema.parse({
      ...ready,
      hasMore: false
    })).toThrow();
    expect(() => AgentConversationHistoryListResultSchema.parse({
      ...ready,
      currentConversationId: undefined
    })).toThrow();
    for (const privateField of ["canFollowUp", "jobId", "text", "path", "providerId"] as const) {
      expect(() => AgentConversationHistoryListResultSchema.parse({
        ...ready,
        conversations: [{ ...conversations[0], [privateField]: "private" }]
      })).toThrow();
    }
    expect(() => AgentConversationHistoryListResultSchema.parse({
      ...ready,
      conversations: [{ ...conversations[0], safePreview: "x".repeat(AGENT_CONVERSATION_HISTORY_PREVIEW_MAX_CODE_POINTS + 1) }]
    })).toThrow();
    expect(AgentConversationHistoryListResultSchema.parse({
      apiVersion: 1,
      activeVaultId,
      status: "failed"
    })).toEqual({ apiVersion: 1, activeVaultId, status: "failed" });
    expect(() => AgentConversationHistoryListResultSchema.parse({
      apiVersion: 1,
      activeVaultId,
      status: "failed",
      error: "private"
    })).toThrow();
  });

  it("keeps conversation trash and restore contracts pathless, body-free, and revision-bound", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "conversationtrashreq_abcdefghijklmnop",
      activeVaultId: "vault_20260729_history01",
      conversationId: "conv_20260729_history01",
      expectedRevision: `conversationrev_${"a".repeat(64)}`
    };
    expect(ConversationTrashRequestSchema.parse(request)).toEqual(request);
    expect(ConversationTrashResultSchema.parse({
      ...request,
      status: "committed",
      trashEntryId: `conversationtrash_${"b".repeat(32)}`,
      operationId: "op_20260731_conversationtrash"
    })).toMatchObject({ status: "committed" });
    expect(ConversationTrashListResultSchema.parse({
      apiVersion: 1,
      activeVaultId: request.activeVaultId,
      status: "ready",
      conversations: [{
        trashEntryId: `conversationtrash_${"b".repeat(32)}`,
        conversationId: request.conversationId,
        safePreview: "Bounded preview",
        updatedAt: "2026-07-29T12:00:00.000Z",
        trashedAt: "2026-07-31T12:00:00.000Z",
        revision: request.expectedRevision
      }]
    })).toMatchObject({ status: "ready" });
    const restore = {
      ...request,
      requestId: "conversationtrashreq_restoreabcdefghij",
      trashEntryId: `conversationtrash_${"b".repeat(32)}`
    };
    expect(ConversationRestoreRequestSchema.parse(restore)).toEqual(restore);
    expect(ConversationRestoreResultSchema.parse({ ...restore, status: "restored", operationId: "op_20260731_conversationrestore" }))
      .toMatchObject({ status: "restored" });
    for (const privateField of ["path", "body", "providerResponse"] as const) {
      expect(() => ConversationTrashRequestSchema.parse({ ...request, [privateField]: "private" })).toThrow();
      expect(() => ConversationRestoreRequestSchema.parse({ ...restore, [privateField]: "private" })).toThrow();
    }
  });

  it("strictly binds bounded pathless conversation title mutations to the exact tail and revision", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "conversation_title_request_1234567890abcdef",
      activeVaultId: "vault_20260731_rename01",
      conversationId: "conv_20260731_rename01",
      expectedTailEventId: "evt_20260731_renametail01",
      expectedTitleRevision: 4,
      title: "A calm title"
    };
    expect(AgentConversationSetTitleRequestSchema.parse(request)).toEqual(request);
    expect(AgentConversationTitleSchema.parse("😀".repeat(AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS)))
      .toBe("😀".repeat(AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS));
    expect(() => AgentConversationTitleSchema.parse("😀".repeat(AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS + 1)))
      .toThrow();
    for (const title of [" title", "title ", "title\nbody", "title\u202e"]) {
      expect(() => AgentConversationTitleSchema.parse(title)).toThrow();
    }
    for (const privateField of ["path", "body", "providerId", "modelId", "toolPayload", "secret"]) {
      expect(() => AgentConversationSetTitleRequestSchema.parse({ ...request, [privateField]: "private" })).toThrow();
    }
    expect(AgentConversationSetTitleRequestSchema.parse({ ...request, title: null }).title).toBeNull();

    const summary = {
      conversationId: request.conversationId,
      updatedAt: "2026-07-31T01:02:03.000Z",
      safePreview: "Original preview",
      tailEventId: request.expectedTailEventId,
      title: request.title,
      titleRevision: 5
    };
    expect(AgentConversationSetTitleResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "committed",
      summary
    })).toMatchObject({ status: "committed", summary });
    expect(() => AgentConversationSetTitleResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      conversationId: request.conversationId,
      status: "stale",
      summary: { ...summary, titleRevision: undefined }
    })).toThrow();
  });

  it("strictly bounds renderer-safe conversation history queries and echoes their identity", () => {
    const query = "Launch project";
    const request = {
      apiVersion: 1 as const,
      activeVaultId: "vault_20260731_search01",
      limit: 50,
      query
    };
    expect(AgentConversationHistoryListRequestSchema.parse(request)).toEqual(request);
    expect(AgentConversationHistoryQuerySchema.parse("😀".repeat(
      AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS
    ))).toBe("😀".repeat(AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS));
    expect(() => AgentConversationHistoryQuerySchema.parse("😀".repeat(
      AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS + 1
    ))).toThrow();
    for (const unsafe of [" search", "search ", "search\nbody", "search\u202e", ""]) {
      expect(() => AgentConversationHistoryQuerySchema.parse(unsafe)).toThrow();
    }
    for (const privateField of ["path", "body", "providerId", "modelId", "jobId", "toolPayload", "secret"]) {
      expect(() => AgentConversationHistoryListRequestSchema.parse({ ...request, [privateField]: "private" })).toThrow();
    }
    const match = {
      eventId: "evt_20260731_searchmatch01",
      role: "assistant" as const,
      createdAt: "2026-07-31T12:00:00.000Z",
      safeExcerpt: "The earlier durable message contains Launch project."
    };
    expect(AgentConversationHistoryListResultSchema.parse({
      apiVersion: 1,
      activeVaultId: request.activeVaultId,
      query,
      status: "ready",
      currentConversationId: "conv_20260731_current01",
      conversations: [{
        conversationId: "conv_20260731_current01",
        updatedAt: "2026-07-31T12:00:00.000Z",
        safePreview: "Latest preview does not contain the query",
        tailEventId: "evt_20260731_searchtail001",
        searchMatch: match
      }],
      hasMore: false
    })).toMatchObject({ query, status: "ready", conversations: [{ searchMatch: match }] });
    expect(() => AgentConversationHistoryListResultSchema.parse({
      apiVersion: 1,
      activeVaultId: request.activeVaultId,
      status: "ready",
      currentConversationId: "conv_20260731_current01",
      conversations: [{
        conversationId: "conv_20260731_current01",
        updatedAt: "2026-07-31T12:00:00.000Z",
        safePreview: "Latest preview",
        tailEventId: "evt_20260731_searchtail001",
        searchMatch: match
      }],
      hasMore: false
    })).toThrow("exact query binding");
    expect(AgentConversationHistoryListResultSchema.parse({
      apiVersion: 1,
      activeVaultId: request.activeVaultId,
      query,
      status: "failed"
    })).toEqual({ apiVersion: 1, activeVaultId: request.activeVaultId, query, status: "failed" });
  });

  it("keeps saved-answer note authority bound to one durable assistant event identity", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "answersavereq_20260801schema0001",
      activeVaultId: "vault_20260801_savedanswer01",
      conversationId: "conv_20260801_savedanswer01",
      assistantEventId: "evt_20260801_savedanswer01"
    };
    expect(AgentSaveAnswerAsNoteRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["body", "answer", "title", "path", "contentHash", "sourceRefs"]) {
      expect(() => AgentSaveAnswerAsNoteRequestSchema.parse({ ...request, [privateField]: "private" })).toThrow();
    }
    expect(AgentSaveAnswerAsNoteResultSchema.parse({
      ...request,
      status: "saved",
      pageId: "page_20260801_savedanswer01",
      operationId: "op_20260801_savedanswer01",
      title: "Saved answer"
    })).toMatchObject({ status: "saved", title: "Saved answer" });
    for (const status of ["stale", "not_found", "failed"] as const) {
      expect(AgentSaveAnswerAsNoteResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
      expect(() => AgentSaveAnswerAsNoteResultSchema.parse({
        ...request,
        status,
        pageId: "page_20260801_privateanswer01"
      })).toThrow();
    }
  });

  it("fences current-note append review and completion projections to exact states", () => {
    const turn = {
      jobId: "job_20260728_schemaappend01",
      userEventId: "evt_20260728_schemaappend01",
      state: "completed"
    } as const;
    expect(AgentConversationTurnSummarySchema.parse({ ...turn, currentNoteAppendApplied: true }))
      .toEqual({ ...turn, currentNoteAppendApplied: true });
    expect(() => AgentConversationTurnSummarySchema.parse({ ...turn, proposalId: "proposal_20260728_schemaappend01" })).toThrow();
    expect(() => AgentConversationTurnSummarySchema.parse({ ...turn, state: "awaiting_review" })).toThrow();
    expect(() => AgentConversationTurnSummarySchema.parse({ ...turn, state: "running", currentNoteAppendApplied: true })).toThrow();

    const waiting = {
      requestId: "schema-current-note-append",
      jobId: turn.jobId,
      conversationEventId: turn.userEventId,
      conversationId: "conv_20260728_schemaappend01",
      tailEventId: "evt_20260728_schemaappend02",
      state: "waiting",
      modelUsage: "none",
      sourceIds: [],
      error: {
        code: "agent_runtime.review_required",
        domain: "agent_runtime",
        messageKey: "errors.agent_runtime.review_required",
        retryable: false,
        severity: "info",
        userAction: "review_proposal"
      }
    } as const;
    expect(() => AgentSubmitTurnResultSchema.parse(waiting)).toThrow();
    expect(AgentSubmitTurnResultSchema.parse({ ...waiting, proposalId: "proposal_20260728_schemaappend01" }))
      .toMatchObject({ state: "waiting", proposalId: "proposal_20260728_schemaappend01" });
    expect(() => AgentSubmitTurnResultSchema.parse({
      ...waiting,
      proposalId: "proposal_20260728_schemaappend01",
      error: { ...waiting.error, code: "agent_runtime.turn_in_progress", messageKey: "errors.agent_runtime.turn_in_progress" }
    })).toThrow();

    const proposal = {
      proposalId: "proposal_20260728_schemaappend01",
      kind: "append_current_note",
      state: "ready",
      revision: 1,
      activeVaultId: "vault_20260728_schemaappend",
      pageId: "page_20260728_schemaappend",
      jobId: turn.jobId,
      lines: [{ kind: "added", text: "Safe appended text" }]
    } as const;
    expect(() => CurrentNoteAppendProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "applied",
      proposal,
      operationId: "op_20260728_schemaappend01"
    })).toThrow();
    expect(CurrentNoteAppendProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "applied",
      proposal: { ...proposal, state: "applied" },
      operationId: "op_20260728_schemaappend01"
    })).toMatchObject({ status: "applied", proposal: { state: "applied" } });
    const conflictRevision = `noteeditrev_${"a".repeat(64)}`;
    expect(CurrentNoteAppendProposalDecisionRequestSchema.parse({
      apiVersion: 1,
      activeVaultId: proposal.activeVaultId,
      pageId: proposal.pageId,
      jobId: proposal.jobId,
      proposalId: proposal.proposalId,
      expectedRevision: 3,
      decision: "keep_current",
      expectedCurrentRevision: conflictRevision
    })).toMatchObject({ decision: "keep_current", expectedCurrentRevision: conflictRevision });
    expect(CurrentNoteAppendProposalDecisionRequestSchema.parse({
      apiVersion: 1,
      activeVaultId: proposal.activeVaultId,
      pageId: proposal.pageId,
      jobId: proposal.jobId,
      proposalId: proposal.proposalId,
      expectedRevision: 3,
      decision: "apply_proposed",
      expectedCurrentRevision: conflictRevision
    })).toMatchObject({ decision: "apply_proposed", expectedCurrentRevision: conflictRevision });
    expect(() => CurrentNoteAppendProposalDecisionRequestSchema.parse({
      apiVersion: 1,
      activeVaultId: proposal.activeVaultId,
      pageId: proposal.pageId,
      jobId: proposal.jobId,
      proposalId: proposal.proposalId,
      expectedRevision: 3,
      decision: "keep_current"
    })).toThrow();
  });

  it("keeps current-note replacement review pathless and proposal-bound", () => {
    const request = {
      apiVersion: 1,
      activeVaultId: "vault_20260730_schemareplace",
      jobId: "job_20260730_schemareplace01",
      proposalId: "proposal_20260730_schemareplace01"
    } as const;
    expect(CurrentNoteReplaceProposalGetRequestSchema.parse(request)).toEqual(request);
    expect(() => CurrentNoteReplaceProposalGetRequestSchema.parse({
      ...request,
      pageId: "page_20260730_schemareplace01"
    })).toThrow();

    const proposal = {
      proposalId: request.proposalId,
      kind: "replace_current_note",
      state: "ready",
      revision: 1,
      activeVaultId: request.activeVaultId,
      jobId: request.jobId,
      lines: [
        { kind: "removed", text: "Old safe line" },
        { kind: "added", text: "New safe line" }
      ]
    } as const;
    expect(CurrentNoteReplaceProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal
    })).toMatchObject({ status: "available", proposal: { kind: "replace_current_note" } });
    expect(() => CurrentNoteReplaceProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal: { ...proposal, body: "private replacement" }
    })).toThrow();
    expect(() => CurrentNoteReplaceProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal: { ...proposal, lines: Array.from({ length: 9 }, () => proposal.lines[0]) }
    })).toThrow();
    expect(() => CurrentNoteReplaceProposalGetResultSchema.parse({
      apiVersion: 1,
      status: "available",
      proposal: { ...proposal, lines: [{ kind: "added", text: "x".repeat(161) }] }
    })).toThrow();

    const decision = { ...request, expectedRevision: 1, decision: "approve" } as const;
    expect(CurrentNoteReplaceProposalDecisionRequestSchema.parse(decision)).toEqual(decision);
    const keepCurrent = {
      ...request,
      expectedRevision: 3,
      decision: "keep_current",
      expectedCurrentRevision: `noteeditrev_${"b".repeat(64)}`
    } as const;
    expect(CurrentNoteReplaceProposalDecisionRequestSchema.parse(keepCurrent)).toEqual(keepCurrent);
    expect(CurrentNoteReplaceProposalDecisionRequestSchema.parse({
      ...request,
      expectedRevision: 3,
      decision: "apply_proposed",
      expectedCurrentRevision: keepCurrent.expectedCurrentRevision
    })).toMatchObject({ decision: "apply_proposed", expectedCurrentRevision: keepCurrent.expectedCurrentRevision });
    expect(() => CurrentNoteReplaceProposalDecisionRequestSchema.parse({ ...keepCurrent, expectedCurrentRevision: undefined })).toThrow();
    expect(() => CurrentNoteReplaceProposalDecisionRequestSchema.parse({
      ...decision,
      replacementMarkdown: "renderer-authored body"
    })).toThrow();
    expect(() => CurrentNoteReplaceProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "applied",
      proposal,
      operationId: "op_20260730_schemareplace01"
    })).toThrow();
    expect(CurrentNoteReplaceProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "applied",
      proposal: { ...proposal, state: "applied" },
      operationId: "op_20260730_schemareplace01"
    })).toMatchObject({ status: "applied", proposal: { state: "applied" } });
    expect(CurrentNoteReplaceProposalDecisionResultSchema.parse({
      apiVersion: 1,
      status: "not_found"
    })).toEqual({ apiVersion: 1, status: "not_found" });
  });

  it("binds Reader selection create-note review to one created page identity", () => {
    const selection = {
      pageId: "page_20260729_createnote01",
      pageContentHash: `sha256:${"a".repeat(64)}`,
      span: { unit: "utf8_bytes", start: 0, endExclusive: 32 },
      selectedContentHash: `sha256:${"b".repeat(64)}`
    } as const;
    const request = {
      apiVersion: 1,
      requestId: "readerselaction_createnote01",
      action: "create_note",
      activeVaultId: "vault_20260729_createnote",
      renderContextId: `notectx_${"c".repeat(32)}`,
      selection,
      locale: "en",
      clientTurnId: "turn_20260729_createnote01"
    } as const;
    expect(ReaderSelectionCreateNoteRequestSchema.parse(request)).toEqual(request);
    for (const action of ["create_concept", "create_entity", "create_topic"] as const) {
      expect(ReaderSelectionCreateNoteRequestSchema.parse({ ...request, action }).action).toBe(action);
    }
    expect(() => ReaderSelectionCreateNoteRequestSchema.parse({ ...request, path: "/private/note.md" })).toThrow();

    const createNoteProposal = {
      proposalId: "proposal_20260729_createnote01",
      action: "create_note",
      state: "ready",
      revision: 1,
      lines: [{ kind: "added", text: "Create a note from the resolved selection." }]
    } as const;
    const reviewRequired = {
      apiVersion: 1,
      requestId: request.requestId,
      status: "review_required",
      jobId: "job_20260729_createnote01",
      conversationEventId: "evt_20260729_createnote01",
      conversationId: "conv_20260729_createnote01",
      tailEventId: "evt_20260729_createnote02",
      proposal: createNoteProposal
    } as const;
    expect(ReaderSelectionCreateNoteResultSchema.parse(reviewRequired)).toEqual(reviewRequired);
    expect(() => ReaderSelectionCreateNoteResultSchema.parse({
      ...reviewRequired,
      proposal: { ...createNoteProposal, action: "polish" }
    })).toThrow();
    expect(() => ReaderSelectionCreateNoteResultSchema.parse({ ...reviewRequired, body: "private" })).toThrow();

    const appliedCreateNote = {
      apiVersion: 1,
      status: "applied",
      proposal: { ...createNoteProposal, state: "applied" },
      operationId: "op_20260729_createnote01",
      createdPageId: "page_20260729_creatednote01"
    } as const;
    expect(ReaderSelectionProposalDecisionResultSchema.parse(appliedCreateNote)).toEqual(appliedCreateNote);
    expect(() => ReaderSelectionProposalDecisionResultSchema.parse({
      ...appliedCreateNote,
      createdPageId: undefined
    })).toThrow();

    const appliedTransform = {
      apiVersion: 1,
      status: "applied",
      proposal: { ...createNoteProposal, action: "polish", state: "applied" },
      operationId: "op_20260729_transform01"
    } as const;
    expect(ReaderSelectionProposalDecisionResultSchema.parse(appliedTransform)).toEqual(appliedTransform);
    expect(() => ReaderSelectionProposalDecisionResultSchema.parse({
      ...appliedTransform,
      createdPageId: "page_20260729_creatednote01"
    })).toThrow();
  });

  it("keeps Dataset discovery and Collection row paging bounded, ordered, and body-free", () => {
    expect(COLLECTION_LIST_CHANNEL).toBe("collections.list");
    const activeVaultId = "vault_20260729_datasetbrowse01";
    const listRequest = {
      apiVersion: 1,
      activeVaultId,
      limit: 20,
      cursor: `collection_catalog_${"a".repeat(64)}`
    } as const;
    expect(CollectionListRequestSchema.parse(listRequest)).toEqual(listRequest);

    const datasets = [
      {
        datasetId: "dataset_20260729_alphabrowse01",
        title: " Alpha ",
        activeRevisionId: "dataset_rev_20260729_alphabrowse01",
        tableCount: 1,
        tables: [{
          tableId: "table_alphabrowse01",
          tableName: "Items",
          columnCount: 2,
          rowCount: 75,
          canOpen: true
        }],
        tablesTruncated: false
      },
      {
        datasetId: "dataset_20260729_betabrowse001",
        title: "beta",
        activeRevisionId: "dataset_rev_20260729_betabrowse001",
        tableCount: 2,
        tables: [{
          tableId: "table_betabrowse001",
          tableName: "Sheet 1",
          columnCount: 1,
          rowCount: 3,
          canOpen: true
        }],
        tablesTruncated: true
      }
    ] as const;
    const ready = {
      apiVersion: 1,
      activeVaultId,
      status: "ready",
      datasets,
      totalDatasetCount: 3,
      hasMore: true,
      nextCursor: `collection_catalog_${"b".repeat(64)}`
    } as const;
    const parsedReady = CollectionListResultSchema.parse(ready);
    expect(parsedReady).toMatchObject({ status: "ready", hasMore: true });
    expect(parsedReady.status === "ready" ? parsedReady.datasets[0]?.title : undefined).toBe("Alpha");
    expect(CollectionListResultSchema.parse({
      apiVersion: 1,
      activeVaultId,
      status: "failed"
    })).toEqual({ apiVersion: 1, activeVaultId, status: "failed" });
    expect(() => CollectionListResultSchema.parse({ ...ready, datasets: [...datasets].reverse() }))
      .toThrow("normalized title then Dataset ID order");
    expect(() => CollectionListResultSchema.parse({ ...ready, datasets: [datasets[0], datasets[0]] }))
      .toThrow("unique stable Dataset IDs");
    expect(() => CollectionListResultSchema.parse({ ...ready, nextCursor: undefined }))
      .toThrow("agree with hasMore");
    for (const unsafe of [
      { sourceId: "source_private" },
      { path: "/private/datasets/alpha/dataset.json" },
      { checksum: `sha256:${"e".repeat(64)}` },
      { query: "SELECT * FROM private" },
      { storage: "sqlite" }
    ]) {
      expect(() => CollectionListResultSchema.parse({
        ...ready,
        datasets: [{ ...datasets[0], ...unsafe }]
      })).toThrow();
    }
    expect(() => CollectionListRequestSchema.parse({ ...listRequest, limit: 51 })).toThrow();
    expect(() => CollectionListRequestSchema.parse({ ...listRequest, cursor: "collection_catalog_tampered" }))
      .toThrow();

    const openRequest = {
      apiVersion: 1,
      requestId: "collection_request_pageabcdefghijkl",
      activeVaultId,
      datasetId: datasets[0].datasetId,
      tableId: datasets[0].tables[0].tableId,
      viewId: "view_alphabrowse01",
      limit: 25,
      rowCursor: `collection_rows_${"c".repeat(64)}`
    } as const;
    expect(CollectionOpenRequestSchema.parse(openRequest)).toEqual(openRequest);
    const firstPageRequest = {
      apiVersion: openRequest.apiVersion,
      requestId: openRequest.requestId,
      activeVaultId: openRequest.activeVaultId,
      datasetId: openRequest.datasetId,
      tableId: openRequest.tableId,
      viewId: openRequest.viewId,
      limit: openRequest.limit
    } as const;
    expect(CollectionOpenRequestSchema.parse(firstPageRequest)).toEqual(firstPageRequest);
    const snapshot = {
      datasetId: openRequest.datasetId,
      revisionId: datasets[0].activeRevisionId,
      title: "Alpha",
      tableId: openRequest.tableId,
      tableName: "Items",
      columns: [{
        columnId: "column_alphabrowse01",
        label: "Name",
        logicalType: "string",
        canRename: true,
        canTrash: true,
        canUseAsFormulaOperand: false,
        canEditFormula: false
      }],
      rows: [{
        rowId: "row_alphabrowse0001",
        cells: [{ columnId: "column_alphabrowse01", value: "one", editable: true }],
        canTrash: true
      }],
      totalRowCount: 75,
      returnedRowCount: 1,
      truncated: true,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: [{ viewId: openRequest.viewId, viewRevision: 1, name: "Current" }],
      activeViewId: openRequest.viewId
    } as const;
    const openIdentity = {
      apiVersion: 1,
      requestId: openRequest.requestId,
      activeVaultId,
      datasetId: openRequest.datasetId,
      tableId: openRequest.tableId
    } as const;
    const continuationCursor = `collection_rows_${"d".repeat(64)}`;
    expect(CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "ready",
      snapshot,
      nextRowCursor: continuationCursor
    })).toMatchObject({ status: "ready", snapshot: { returnedRowCount: 1 } });

    const middlePage = {
      ...snapshot,
      rows: [{
        rowId: "row_alphabrowse0026",
        cells: [{ columnId: "column_alphabrowse01", value: "twenty-six", editable: true }],
        canTrash: true
      }]
    } as const;
    expect(CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "ready",
      snapshot: middlePage,
      nextRowCursor: continuationCursor
    })).toMatchObject({ status: "ready", snapshot: { truncated: true } });

    const finalRows = Array.from({ length: 10 }, (_, index) => ({
      rowId: `row_alphabrowse${String(index + 51).padStart(4, "0")}`,
      cells: [{ columnId: "column_alphabrowse01", value: `row-${index + 51}`, editable: true }],
      canTrash: true
    }));
    const finalLaterPage = {
      ...snapshot,
      rows: finalRows,
      totalRowCount: 60,
      returnedRowCount: 10,
      truncated: false
    };
    expect(CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "ready",
      snapshot: finalLaterPage
    })).toMatchObject({
      status: "ready",
      snapshot: { totalRowCount: 60, returnedRowCount: 10, truncated: false }
    });

    const emptyPage = {
      ...snapshot,
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false
    } as const;
    expect(CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "ready",
      snapshot: emptyPage
    })).toMatchObject({ status: "ready", snapshot: { returnedRowCount: 0, truncated: false } });

    expect(() => CollectionOpenResultSchema.parse({ ...openIdentity, status: "ready", snapshot }))
      .toThrow("agree with snapshot truncation");
    expect(() => CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "ready",
      snapshot: finalLaterPage,
      nextRowCursor: continuationCursor
    })).toThrow("agree with snapshot truncation");
    expect(() => CollectionOpenRequestSchema.parse({ ...openRequest, rowCursor: "collection_rows_tampered" }))
      .toThrow();
    expect(() => CollectionOpenResultSchema.parse({
      ...openIdentity,
      status: "stale",
      rows: snapshot.rows
    })).toThrow();
  });

  it("keeps generated Dataset reveal exact, bounded, and pathless", () => {
    expect(COLLECTION_REVEAL_CHANNEL).toBe("collections.reveal");
    const request = {
      apiVersion: 1,
      requestId: "collection_reveal_abcdefghijklmnop",
      activeVaultId: "vault_20260801_collectionreveal",
      datasetId: "dataset_20260801_collectionreveal",
      revisionId: "dataset_rev_20260801_collectionreveal",
      tableId: "table_collectionreveal01"
    } as const;
    expect(CollectionRevealRequestSchema.parse(request)).toEqual(request);
    for (const status of ["revealed", "stale", "not_found", "failed"] as const) {
      expect(CollectionRevealResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => CollectionRevealResultSchema.parse({
      ...request,
      status: "revealed",
      path: "/private/vault/data/datasets/private"
    })).toThrow();
    expect(() => CollectionRevealRequestSchema.parse({ ...request, requestId: "collection_reveal_short" }))
      .toThrow();
  });

  it("keeps Library tag browsing snapshot-bound, ordered, and renderer-safe", () => {
    expect(LIBRARY_TAGS_CHANNEL).toBe("library.tags");
    const activeVaultId = "vault_20260730_librarytags01";
    const requestId = "library_tags_request_abcdefghijklmnop";
    const snapshotId = `library_tags_snapshot_${"a".repeat(64)}`;
    const cursor = `library_tags_cursor_${"b".repeat(64)}`;
    const listRequest = {
      apiVersion: 1,
      requestId,
      activeVaultId,
      mode: "list_tags",
      limit: LIBRARY_TAGS_PAGE_SIZE_MAX
    } as const;
    expect(LibraryTagsRequestSchema.parse(listRequest)).toEqual(listRequest);
    expect(LibraryTagsRequestSchema.parse({ ...listRequest, snapshotId, cursor }))
      .toEqual({ ...listRequest, snapshotId, cursor });
    expect(() => LibraryTagsRequestSchema.parse({ ...listRequest, snapshotId })).toThrow(
      "requires both"
    );
    expect(() => LibraryTagsRequestSchema.parse({ ...listRequest, cursor })).toThrow(
      "requires both"
    );
    expect(() => LibraryTagsRequestSchema.parse({
      ...listRequest,
      limit: LIBRARY_TAGS_PAGE_SIZE_MAX + 1
    })).toThrow();
    expect(() => LibraryTagsRequestSchema.parse({
      ...listRequest,
      cursor: "library_tags_cursor_tampered",
      snapshotId
    })).toThrow();

    const pagesRequest = {
      ...listRequest,
      mode: "list_pages_for_tag",
      tag: "Research Notes"
    } as const;
    expect(LibraryTagsRequestSchema.parse(pagesRequest)).toEqual(pagesRequest);
    expect(() => LibraryTagsRequestSchema.parse({ ...pagesRequest, tag: " Research  Notes " }))
      .toThrow("canonical Markdown tag");
    expect(() => LibraryTagsRequestSchema.parse({
      ...listRequest,
      mode: "list_pages_for_tag"
    })).toThrow();

    const listReady = {
      apiVersion: 1,
      requestId,
      activeVaultId,
      mode: "list_tags",
      status: "ready",
      snapshotId,
      tags: [
        { tag: "alpha", pageCount: 3 },
        { tag: "Research Notes", pageCount: 2 }
      ],
      total: 3,
      nextCursor: cursor
    } as const;
    expect(LibraryTagsResultSchema.parse(listReady)).toEqual(listReady);
    expect(() => LibraryTagsResultSchema.parse({
      ...listReady,
      tags: [...listReady.tags].reverse()
    })).toThrow("canonical tag-key order");
    expect(() => LibraryTagsResultSchema.parse({
      ...listReady,
      tags: [{ tag: "Research", pageCount: 2 }, { tag: "research", pageCount: 2 }]
    })).toThrow("unique canonical keys");
    expect(() => LibraryTagsResultSchema.parse({ ...listReady, total: 1 })).toThrow(
      "include every projected item"
    );

    const pagesReady = {
      apiVersion: 1,
      requestId,
      activeVaultId,
      mode: "list_pages_for_tag",
      tag: pagesRequest.tag,
      status: "ready",
      snapshotId,
      pages: [
        {
          pageId: "page_20260730_tagbrowse02",
          title: "Recent note",
          pageType: "note",
          status: "active",
          updatedAt: "2026-07-30T12:00:00.000Z"
        },
        {
          pageId: "page_20260730_tagbrowse01",
          title: "Earlier source",
          pageType: "source",
          status: "needs_review",
          updatedAt: "2026-07-29T12:00:00.000Z"
        }
      ],
      total: 2
    } as const;
    expect(LibraryTagsResultSchema.parse(pagesReady)).toEqual(pagesReady);
    expect(() => LibraryTagsResultSchema.parse({
      ...pagesReady,
      pages: [...pagesReady.pages].reverse()
    })).toThrow("updatedAt-descending");
    for (const privateField of ["pagePath", "body", "sourceIds", "checksum", "indexRowId"] as const) {
      expect(() => LibraryTagsResultSchema.parse({
        ...pagesReady,
        pages: [{ ...pagesReady.pages[0], [privateField]: "private" }]
      })).toThrow();
    }
    for (const status of ["stale", "failed"] as const) {
      expect(LibraryTagsResultSchema.parse({
        apiVersion: 1,
        requestId,
        activeVaultId,
        mode: "list_pages_for_tag",
        tag: pagesRequest.tag,
        status
      })).toEqual({
        apiVersion: 1,
        requestId,
        activeVaultId,
        mode: "list_pages_for_tag",
        tag: pagesRequest.tag,
        status
      });
    }
    expect(() => LibraryTagsResultSchema.parse({
      apiVersion: 1,
      requestId,
      activeVaultId,
      mode: "list_tags",
      status: "failed",
      tags: []
    })).toThrow();
  });

  it("keeps Library tag rename identity-bound with closed body-free outcomes", () => {
    expect(LIBRARY_RENAME_TAG_CHANNEL).toBe("library.renameTag");
    const request = {
      apiVersion: 1 as const,
      requestId: "library_tag_rename_request_abcdefghijklmnop",
      activeVaultId: "vault_20260710_rename01",
      tag: "Research",
      replacementTag: "Reading",
      expectedSnapshotId: `library_tags_snapshot_${"a".repeat(64)}`,
      expectedPageCount: 3
    };
    expect(LibraryRenameTagRequestSchema.parse(request)).toEqual(request);
    expect(() => LibraryRenameTagRequestSchema.parse({ ...request, replacementTag: "research" })).toThrow();
    expect(LibraryRenameTagResultSchema.parse({
      ...request,
      status: "committed",
      operationId: "op_20260710_tagrename01",
      renamedPageCount: 3
    })).toMatchObject({ status: "committed", renamedPageCount: 3 });
    expect(() => LibraryRenameTagResultSchema.parse({ ...request, status: "committed", renamedPageCount: 3 })).toThrow();
    expect(LibraryRenameTagResultSchema.parse({ ...request, status: "stale" })).toMatchObject({ status: "stale" });
  });

  it("keeps Library tag merge identity-bound with exact source and target counts", () => {
    expect(LIBRARY_MERGE_TAG_CHANNEL).toBe("library.mergeTag");
    const request = {
      apiVersion: 1 as const,
      requestId: "library_tag_merge_request_abcdefghijklmnop",
      activeVaultId: "vault_20260730_merge01",
      sourceTag: "Research",
      targetTag: "Reading",
      expectedSnapshotId: `library_tags_snapshot_${"b".repeat(64)}`,
      expectedSourcePageCount: 3,
      expectedTargetPageCount: 2
    };
    expect(LibraryMergeTagRequestSchema.parse(request)).toEqual(request);
    expect(() => LibraryMergeTagRequestSchema.parse({ ...request, targetTag: "research" })).toThrow();
    expect(LibraryMergeTagResultSchema.parse({
      ...request,
      status: "committed",
      operationId: "op_20260730_tagmerge01",
      mergedPageCount: 3
    })).toMatchObject({ status: "committed", mergedPageCount: 3 });
    expect(() => LibraryMergeTagResultSchema.parse({ ...request, status: "committed", mergedPageCount: 3 })).toThrow();
    expect(LibraryMergeTagResultSchema.parse({ ...request, status: "ineligible" })).toMatchObject({ status: "ineligible" });
  });

  it("keeps Library tag removal identity-bound with a closed result", () => {
    expect(LIBRARY_REMOVE_TAG_CHANNEL).toBe("library.removeTag");
    const request = {
      apiVersion: 1 as const,
      requestId: "library_tag_remove_request_abcdefghijklmnop",
      activeVaultId: "vault_20260730_remove01",
      tag: "Deprecated",
      expectedSnapshotId: `library_tags_snapshot_${"c".repeat(64)}`,
      expectedPageCount: 3
    };
    expect(LibraryRemoveTagRequestSchema.parse(request)).toEqual(request);
    expect(LibraryRemoveTagResultSchema.parse({
      ...request,
      status: "committed",
      operationId: "op_20260730_tagremove01",
      removedPageCount: 3
    })).toMatchObject({ status: "committed", removedPageCount: 3 });
    expect(() => LibraryRemoveTagResultSchema.parse({ ...request, status: "committed", removedPageCount: 3 })).toThrow();
    expect(LibraryRemoveTagResultSchema.parse({ ...request, status: "stale" })).toMatchObject({ status: "stale" });
  });

  it("binds one page tag removal to its exact tag-page snapshot", () => {
    expect(LIBRARY_REMOVE_PAGE_TAG_CHANNEL).toBe("library.removePageTag");
    const request = {
      apiVersion: 1 as const,
      requestId: "library_page_tag_remove_request_abcdefghijklmnop",
      activeVaultId: "vault_20260730_pageremove",
      tag: "Research",
      pageId: "page_20260730_pageremove01",
      expectedSnapshotId: `library_tags_snapshot_${"d".repeat(64)}`,
      expectedPageUpdatedAt: "2026-07-30T12:00:00.000Z"
    };
    expect(LibraryRemovePageTagRequestSchema.parse(request)).toEqual(request);
    expect(LibraryRemovePageTagResultSchema.parse({
      ...request,
      status: "committed",
      operationId: "op_20260730_pageremove01"
    })).toMatchObject({ status: "committed" });
    expect(() => LibraryRemovePageTagResultSchema.parse({ ...request, status: "committed" })).toThrow();
  });

  it("opens one durable Dataset citation as an exact read-only preview with typed highlights", () => {
    expect(COLLECTION_OPEN_CITATION_CHANNEL).toBe("collections.openCitation");
    const request = {
      apiVersion: 1,
      requestId: "collection_request_citationopen0001",
      activeVaultId: "vault_20260729_datasetcitation",
      conversationId: "conv_20260729_datasetcitation",
      assistantEventId: "evt_20260729_datasetcitation01",
      citationRef: "dataset_citation_1"
    } as const;
    expect(CollectionOpenCitationRequestSchema.parse(request)).toEqual(request);

    const preview = {
      datasetId: "dataset_20260729_datasetcitation",
      revisionId: "dataset_rev_20260729_datasetcitation",
      tableId: "table_datasetcitation01",
      tableName: "Regional totals",
      planHash: `sha256:${"a".repeat(64)}`,
      resultHash: `sha256:${"b".repeat(64)}`,
      columns: [
        {
          key: "region",
          label: "Region",
          logicalType: "string",
          sourceColumnId: "column_datasetregion01"
        },
        {
          key: "record_count",
          label: "Records",
          logicalType: "integer",
          sourceColumnId: "column_datasetcount001",
          aggregate: "count"
        }
      ],
      rows: [{ rowId: "row_datasetcitation01", values: ["North", 3] }],
      matchedRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      citationRefs: [request.citationRef]
    } as const;
    const ready = {
      ...request,
      status: "ready",
      mode: "citation_readonly",
      preview,
      highlights: [
        { kind: "rows", rowIds: ["row_datasetcitation01"] },
        { kind: "range", range: { startRow: 1, endRow: 1 } },
        {
          kind: "columns",
          columnIds: ["column_datasetregion01", "column_datasetcount001"]
        },
        { kind: "aggregate", aggregateKeys: ["record_count"], groupKeys: ["region"] }
      ]
    } as const;
    expect(CollectionOpenCitationResultSchema.parse(ready)).toMatchObject({
      status: "ready",
      mode: "citation_readonly",
      preview: { revisionId: preview.revisionId, resultHash: preview.resultHash }
    });

    for (const status of ["stale", "not_found", "failed"] as const) {
      expect(CollectionOpenCitationResultSchema.parse({ ...request, status })).toEqual({
        ...request,
        status
      });
    }
    for (const unsafe of [
      { datasetId: preview.datasetId },
      { revisionId: preview.revisionId },
      { queryPlanHash: preview.planHash },
      { path: "/private/datasets/citation/dataset.json" },
      { body: "private Dataset body" }
    ]) {
      expect(() => CollectionOpenCitationRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionOpenCitationResultSchema.parse({
      ...ready,
      citationRef: "dataset_citation_missing"
    })).toThrow("requested durable citation ref");
    expect(() => CollectionOpenCitationResultSchema.parse({
      ...ready,
      highlights: [
        ...ready.highlights,
        { kind: "columns", columnIds: ["column_datasetregion01"] }
      ]
    })).toThrow();
    expect(() => CollectionOpenCitationResultSchema.parse({
      ...ready,
      highlights: ready.highlights.filter(({ kind }) => kind !== "columns")
    })).toThrow("durable column identities");
    expect(() => CollectionOpenCitationResultSchema.parse({
      ...ready,
      sourceId: "src_private",
      checksum: `sha256:${"c".repeat(64)}`,
      sql: "SELECT * FROM private"
    })).toThrow();
  });

  it("keeps one saved Collection view stable, bounded, reversible, and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_viewabcdefghijkl",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456",
      name: " Unread notes ",
      filter: {
        operator: "eq",
        columnId: "column_abcdef123456",
        value: "unread"
      },
      sort: {
        columnId: "column_bcdefa123456",
        direction: "desc"
      }
    } as const;
    const parsedRequest = CollectionCreateViewRequestSchema.parse(request);
    expect(parsedRequest.name).toBe("Unread notes");
    expect(CollectionCreateViewRequestSchema.parse({
      ...request,
      filter: { operator: "is_null", columnId: "column_abcdef123456" },
      sort: undefined
    }).filter).toEqual({ operator: "is_null", columnId: "column_abcdef123456" });

    const view = {
      viewId: "view_abcdef123456",
      viewRevision: 1,
      name: "Unread notes",
      filter: parsedRequest.filter,
      sort: parsedRequest.sort
    } as const;
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: request.expectedRevisionId,
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [
        { columnId: "column_abcdef123456", label: "Status", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false },
        { columnId: "column_bcdefa123456", label: "Updated", logicalType: "datetime", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }
      ],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: [view],
      activeViewId: view.viewId
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId
    } as const;

    expect(CollectionCreateViewResultSchema.parse({
      ...identity,
      status: "committed",
      viewId: view.viewId,
      operationId: "op_20260728_viewabcd1",
      snapshot
    })).toMatchObject({ status: "committed", viewId: view.viewId });
    for (const status of ["stale", "duplicate", "ineligible"] as const) {
      expect(CollectionCreateViewResultSchema.parse({ ...identity, status, snapshot }).status)
        .toBe(status);
    }
    for (const status of ["not_found", "failed"] as const) {
      expect(CollectionCreateViewResultSchema.parse({ ...identity, status }).status).toBe(status);
    }

    const openRequest = CollectionOpenRequestSchema.parse({
      apiVersion: 1,
      requestId: "collection_request_openviewabcdefgh",
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      viewId: view.viewId
    });
    expect(CollectionOpenResultSchema.parse({
      ...identity,
      requestId: openRequest.requestId,
      status: "ready",
      snapshot
    }).status).toBe("ready");

    const mutationIdentity = { ...identity, requestId: "collection_request_viewrenameabcdef", viewId: view.viewId };
    const renameRequest = CollectionRenameViewRequestSchema.parse({
      ...mutationIdentity,
      expectedRevisionId: request.expectedRevisionId,
      expectedViewRevision: 1,
      name: " Renamed view "
    });
    expect(renameRequest.name).toBe("Renamed view");
    const renamedSnapshot = {
      ...snapshot,
      views: [{ ...view, viewRevision: 2, name: renameRequest.name, canRename: true, canTrash: true }]
    };
    expect(CollectionRenameViewResultSchema.parse({
      ...mutationIdentity,
      status: "committed",
      operationId: "op_20260728_viewrename1",
      snapshot: renamedSnapshot
    }).status).toBe("committed");
    const updateIdentity = { ...mutationIdentity, requestId: "collection_request_viewupdateabcdef" };
    const updateRequest = CollectionUpdateViewRequestSchema.parse({
      ...updateIdentity,
      expectedRevisionId: request.expectedRevisionId,
      expectedViewRevision: 1,
      filter: { operator: "is_null", columnId: "column_abcdef123456" },
      sort: { columnId: "column_bcdefa123456", direction: "asc" }
    });
    expect(updateRequest).not.toHaveProperty("name");
    const updatedSnapshot = { ...snapshot, views: [{ ...view, viewRevision: 2,
      canEdit: true, canRename: true, canTrash: true,
      filter: updateRequest.filter, sort: updateRequest.sort }] };
    expect(CollectionUpdateViewResultSchema.parse({
      ...updateIdentity,
      status: "committed",
      operationId: "op_20260728_viewupdate1",
      snapshot: updatedSnapshot
    })).toMatchObject({ status: "committed", snapshot: { revisionId: request.expectedRevisionId } });
    expect(CollectionUpdateViewResultSchema.parse({
      ...updateIdentity,
      status: "stale",
      currentViewRevision: 2,
      snapshot: updatedSnapshot
    }).status).toBe("stale");
    expect(() => CollectionUpdateViewRequestSchema.parse({ ...updateRequest, rawSql: "select private" })).toThrow();
    expect(() => CollectionUpdateViewResultSchema.parse({
      ...updateIdentity,
      status: "stale",
      currentViewRevision: 1,
      snapshot: updatedSnapshot
    })).toThrow("current immutable view identity");
    expect(CollectionTrashViewRequestSchema.parse({
      ...mutationIdentity,
      requestId: "collection_request_viewtrashabcdefg",
      expectedRevisionId: request.expectedRevisionId,
      expectedViewRevision: 2
    }).expectedViewRevision).toBe(2);
    expect(CollectionTrashViewResultSchema.parse({
      ...mutationIdentity,
      requestId: "collection_request_viewtrashabcdefg",
      status: "committed",
      operationId: "op_20260728_viewtrash12",
      snapshot: { ...snapshot, views: [], activeViewId: undefined }
    }).status).toBe("committed");
    expect(() => CollectionRenameViewRequestSchema.parse({ ...renameRequest, rawSql: "select 1" })).toThrow();
    expect(() => CollectionRenameViewResultSchema.parse({
      ...mutationIdentity,
      status: "stale",
      currentViewRevision: 1,
      snapshot: renamedSnapshot
    })).toThrow("current immutable view identity");

    for (const unsafe of [
      { path: "/private/datasets/views/view.json" },
      { body: "private" },
      { sql: "ORDER BY private" },
      { viewId: "view_renderer_owned" },
      { filter: { operator: "eq", columnId: "column_abcdef123456", value: null } },
      { filter: { operator: "contains", columnId: "column_abcdef123456", value: "x" } },
      { sort: { columnId: "column_abcdef123456", direction: "random" } }
    ]) {
      expect(() => CollectionCreateViewRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionCreateViewRequestSchema.parse({
      ...request,
      filter: { operator: "eq", columnId: "column_abcdef123456", value: "x".repeat(4097) }
    })).toThrow("4096 UTF-8 bytes");
    expect(() => CollectionCreateViewResultSchema.parse({
      ...identity,
      status: "committed",
      viewId: view.viewId,
      operationId: "op_20260728_viewabcd1",
      snapshot: { ...snapshot, activeViewId: undefined }
    })).toThrow("present and active");
    expect(() => CollectionCreateViewResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: {
        ...snapshot,
        views: [{
          ...view,
          filter: { operator: "eq", columnId: "column_cdefab123456", value: "unread" }
        }]
      }
    })).toThrow("current stable columns");

    expect(OperationRecordSchema.parse({
      id: "op_20260728_viewabcd1",
      schemaVersion: 1,
      createdAt: "2026-07-28T00:00:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "create_collection_view",
      targetRefs: [
        { kind: "dataset", id: request.datasetId },
        { kind: "table", id: request.tableId },
        { kind: "view", id: view.viewId }
      ],
      sourceRefs: [{ kind: "dataset", id: request.datasetId }],
      summary: "Created one Managed Collection saved view.",
      reversible: "yes",
      warnings: []
    }).kind).toBe("create_collection_view");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: request.activeVaultId,
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_viewabcd1",
        kind: "create_collection_view",
        createdAt: "2026-07-28T00:00:00.000Z",
        targetLabel: view.name,
        target: {
          kind: "collection",
          datasetId: request.datasetId,
          tableId: request.tableId,
          revisionId: request.expectedRevisionId
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("create_collection_view");
  });

  it("keeps default-row append Main-owned, CAS-bound, and renderer-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_abcdefghijklmnop",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456"
    } as const;
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260728_bcdefa123456",
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [{ columnId: "column_abcdef123456", label: "Notes", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: []
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId
    } as const;

    expect(CollectionAppendDefaultRowRequestSchema.parse(request)).toEqual(request);
    expect(CollectionAppendDefaultRowResultSchema.parse({
      ...identity,
      status: "committed",
      rowId: "row_abcdef123456",
      operationId: "op_20260728_abcdef12",
      snapshot: { ...snapshot, totalRowCount: 1, truncated: true }
    })).toMatchObject({ status: "committed", rowId: "row_abcdef123456" });
    expect(CollectionAppendDefaultRowResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, canAppendDefaultRow: false }
    })).toMatchObject({ status: "stale", snapshot: { canAppendDefaultRow: false } });
    expect(CollectionAppendDefaultRowResultSchema.parse({ ...identity, status: "not_found" }))
      .toEqual({ ...identity, status: "not_found" });
    const missingEligibility: Record<string, unknown> = { ...snapshot };
    delete missingEligibility.canAppendDefaultRow;
    expect(() => CollectionAppendDefaultRowResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: missingEligibility
    })).toThrow();

    for (const unsafe of [
      { values: { column_abcdef123456: "renderer guessed" } },
      { rowId: "row_abcdef123456" },
      { path: "/private/collection.sqlite" },
      { sql: "INSERT INTO rows" }
    ]) {
      expect(() => CollectionAppendDefaultRowRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionAppendDefaultRowResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, datasetId: "dataset_20260728_bcdefa123456" }
    })).toThrow();
    for (const unsafe of [{ path: "/private" }, { body: "private" }, { rawError: "SQLITE_BUSY" }]) {
      expect(() => CollectionAppendDefaultRowResultSchema.parse({
        ...identity,
        status: "not_found",
        ...unsafe
      })).toThrow();
    }
  });

  it("keeps nullable-column creation Main-owned, revision-bound, and schema-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_bcdefghijklmnopq",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456",
      label: " Notes ",
      logicalType: "string"
    } as const;
    const parsedRequest = CollectionAddNullableColumnRequestSchema.parse(request);
    expect(parsedRequest.label).toBe("Notes");
    expect(COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES).toBe(256);
    for (const logicalType of ["string", "integer", "number", "boolean", "date", "datetime"] as const) {
      expect(CollectionAddNullableColumnRequestSchema.parse({ ...request, logicalType }).logicalType)
        .toBe(logicalType);
    }
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260728_bcdefa123456",
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [{ columnId: "column_abcdef123456", label: "Title", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: []
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId
    } as const;
    expect(CollectionAddNullableColumnResultSchema.parse({
      ...identity,
      status: "committed",
      columnId: "column_bcdefa123456",
      operationId: "op_20260728_bcdefa12",
      snapshot: {
        ...snapshot,
        columns: [
          ...snapshot.columns,
          { columnId: "column_bcdefa123456", label: "Notes", logicalType: "string" as const, canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }
        ],
        canAddColumn: false
      }
    })).toMatchObject({ status: "committed", columnId: "column_bcdefa123456" });
    expect(CollectionAddNullableColumnResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, canAddColumn: false }
    })).toMatchObject({ status: "stale", snapshot: { canAddColumn: false } });
    for (const reason of ["duplicate_label", "column_limit", "type_mismatch"] as const) {
      expect(CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "invalid", reason }).reason)
        .toBe(reason);
    }
    expect(CollectionAddNullableColumnResultSchema.parse({ ...identity, status: "not_found" }))
      .toEqual({ ...identity, status: "not_found" });

    for (const unsafe of [
      { label: "   " },
      { label: "界".repeat(86) },
      { logicalType: "binary" },
      { columnId: "column_renderer_owned" },
      { formula: "=A1" },
      { default: null },
      { path: "/private/collection.sqlite" }
    ]) {
      expect(() => CollectionAddNullableColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    for (const unsafe of [{ body: "private" }, { sql: "ALTER TABLE" }, { rawError: "SQLITE_BUSY" }]) {
      expect(() => CollectionAddNullableColumnResultSchema.parse({
        ...identity,
        status: "not_found",
        ...unsafe
      })).toThrow();
    }
  });

  it("freezes bounded schema-level Pige numeric formulas and safe creation authority", () => {
    const columnExpression = { kind: "column", columnId: "column_input0000001" } as const;
    const expression = {
      kind: "binary",
      operator: "divide",
      left: {
        kind: "binary",
        operator: "add",
        left: columnExpression,
        right: { kind: "literal", value: 2 }
      },
      right: { kind: "literal", value: 4 }
    } as const;
    const calculation = {
      kind: "pige_numeric_formula",
      schemaVersion: 1,
      expression
    } as const;
    expect(COLLECTION_ADD_FORMULA_COLUMN_CHANNEL).toBe("collections.addFormulaColumn");
    expect(DATASET_PIGE_FORMULA_MAX_DEPTH).toBe(8);
    expect(DATASET_PIGE_FORMULA_MAX_NODES).toBe(31);
    expect(DatasetPigeFormulaExpressionSchema.parse(expression)).toEqual(expression);
    expect(DatasetPigeCalculationSchema.parse(calculation)).toEqual(calculation);

    const nested = (depth: number): Record<string, unknown> => depth === 1
      ? { kind: "literal", value: 1 }
      : {
          kind: "binary",
          operator: "add",
          left: nested(depth - 1),
          right: { kind: "literal", value: 1 }
        };
    const full = (depth: number): Record<string, unknown> => depth === 1
      ? { kind: "literal", value: 1 }
      : { kind: "binary", operator: "add", left: full(depth - 1), right: full(depth - 1) };
    expect(DatasetPigeFormulaExpressionSchema.parse(nested(8))).toBeTruthy();
    expect(() => DatasetPigeFormulaExpressionSchema.parse(nested(9))).toThrow();
    expect(DatasetPigeFormulaExpressionSchema.parse(full(5))).toBeTruthy();
    expect(() => DatasetPigeFormulaExpressionSchema.parse(full(6))).toThrow("31 nodes");
    for (const unsafe of [
      { kind: "literal", value: Number.NaN },
      { kind: "binary", operator: "power", left: columnExpression, right: { kind: "literal", value: 2 } },
      { kind: "raw", expression: "column_input0000001 / 4" },
      { kind: "sql", sql: "SELECT secret" }
    ]) {
      expect(() => DatasetPigeFormulaExpressionSchema.parse(unsafe)).toThrow();
    }

    const inputColumn = {
      id: "column_input0000001",
      name: "Amount",
      ordinal: 0,
      sourceType: "sqlite.integer",
      logicalType: "integer",
      nullable: true
    } as const;
    const formulaColumn = {
      id: "column_formula00001",
      name: "Adjusted",
      ordinal: 1,
      sourceType: "pige.formula.number",
      logicalType: "number",
      nullable: true,
      calculation
    } as const;
    const table = {
      id: "table_formula000001",
      name: "Items",
      sourceLocator: "table:items",
      ordinal: 0,
      rowCount: 0,
      columnCount: 2,
      columns: [inputColumn, formulaColumn]
    } as const;
    expect(DatasetTableSchema.parse(table).columns[1]?.calculation).toEqual(calculation);
    const downstreamFormula = {
      ...formulaColumn,
      id: "column_formula00002",
      name: "Further adjusted",
      ordinal: 2,
      calculation: {
        kind: "pige_numeric_formula" as const,
        schemaVersion: 1 as const,
        expression: {
          kind: "binary" as const,
          operator: "add" as const,
          left: { kind: "column" as const, columnId: formulaColumn.id },
          right: { kind: "literal" as const, value: 1 }
        }
      }
    };
    expect(DatasetTableSchema.parse({
      ...table,
      columnCount: 3,
      columns: [inputColumn, formulaColumn, downstreamFormula]
    }).columns[2]?.calculation).toEqual(downstreamFormula.calculation);
    expect(() => DatasetTableSchema.parse({
      ...table,
      columnCount: 3,
      columns: [inputColumn, {
        ...formulaColumn,
        calculation: {
          ...calculation,
          expression: { kind: "column" as const, columnId: downstreamFormula.id }
        }
      }, downstreamFormula]
    })).toThrow("acyclic graph");
    for (const invalidInput of [
      { ...inputColumn, logicalType: "string" as const },
      { ...inputColumn, sourceType: "xlsx.formula.number" }
    ]) {
      expect(() => DatasetTableSchema.parse({ ...table, columns: [invalidInput, formulaColumn] }))
        .toThrow("numeric scalar or acyclic Pige formula columns");
    }
    expect(() => DatasetTableSchema.parse({
      ...table,
      columns: [{ ...inputColumn, calculation }, formulaColumn]
    })).toThrow("acyclic graph");
    expect(() => DatasetTableSchema.parse({
      ...table,
      columns: [inputColumn, { ...formulaColumn, logicalType: "integer" }]
    })).toThrow("nullable numbers");
    expect(() => DatasetTableSchema.parse({
      ...table,
      columns: [inputColumn, {
        ...formulaColumn,
        calculation: {
          ...calculation,
          expression: { kind: "column", columnId: formulaColumn.id }
        }
      }]
    })).toThrow("acyclic graph");

    const request = {
      apiVersion: 1,
      requestId: "collection_request_formulaabcdefghi",
      activeVaultId: "vault_20260729_abcdefgh",
      datasetId: "dataset_20260729_abcdef123456",
      tableId: table.id,
      expectedRevisionId: "dataset_rev_20260729_abcdef123456",
      label: " Adjusted ",
      expression
    } as const;
    expect(CollectionAddFormulaColumnRequestSchema.parse(request).label).toBe("Adjusted");
    for (const unsafe of [
      { formula: "Amount / 4" },
      { sql: "Amount / 4" },
      { columnId: "column_renderer_owned" },
      { expression: { kind: "column", columnId: "invented" } },
      { path: "/private/collection.sqlite" }
    ]) {
      expect(() => CollectionAddFormulaColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }

    const formulaSummary = {
      columnId: formulaColumn.id,
      label: formulaColumn.name,
      logicalType: "number",
      canRename: true,
      canTrash: true,
      canUseAsFormulaOperand: false,
      canEditFormula: false,
      calculation
    } as const;
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260729_bcdefa123456",
      title: "Formula table",
      tableId: request.tableId,
      tableName: table.name,
      columns: [{
        columnId: inputColumn.id,
        label: inputColumn.name,
        logicalType: inputColumn.logicalType,
        canRename: true,
        canTrash: false,
        canUseAsFormulaOperand: true,
        canEditFormula: false
      }, formulaSummary],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: true,
      views: []
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId
    } as const;
    expect(CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "committed",
      columnId: formulaColumn.id,
      operationId: "op_20260729_formula01",
      snapshot
    })).toMatchObject({ status: "committed", columnId: formulaColumn.id });
    expect(CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, canAddFormulaColumn: false }
    })).toMatchObject({ status: "stale" });
    for (const reason of ["duplicate_label", "column_limit", "ineligible_operand"] as const) {
      expect(CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "invalid", reason }).reason)
        .toBe(reason);
    }
    expect(CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "not_found" }).status)
      .toBe("not_found");
    expect(CollectionAddFormulaColumnResultSchema.parse({ ...identity, status: "failed" }).status)
      .toBe("failed");
    expect(() => CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "committed",
      columnId: formulaColumn.id,
      operationId: "op_20260729_formula01",
      snapshot: {
        ...snapshot,
        columns: [{ ...snapshot.columns[0], canTrash: true }, formulaSummary]
      }
    })).toThrow("fail closed for trash");
    expect(() => CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "committed",
      columnId: formulaColumn.id,
      operationId: "op_20260729_formula01",
      snapshot: {
        ...snapshot,
        columns: [{ ...snapshot.columns[0], canUseAsFormulaOperand: false }, formulaSummary]
      }
    })).toThrow("eligible current columns");
    expect(() => CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "not_found",
      rawError: "SQLITE_BUSY"
    })).toThrow();

    const updatedExpression = {
      kind: "binary",
      operator: "multiply",
      left: columnExpression,
      right: { kind: "literal", value: 3 }
    } as const;
    const updateRequest = {
      apiVersion: 1,
      requestId: "collection_request_updateformulaabc",
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      columnId: formulaColumn.id,
      expectedRevisionId: snapshot.revisionId,
      expression: updatedExpression
    } as const;
    expect(COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL).toBe("collections.updateFormulaColumn");
    expect(CollectionUpdateFormulaColumnRequestSchema.parse(updateRequest)).toEqual(updateRequest);
    expect(CollectionUpdateFormulaColumnRequestSchema.parse({
      ...updateRequest,
      expression
    }).expression).toEqual(expression);
    for (const unsafe of [
      { label: "Renderer-owned rename" },
      { formula: "Amount * 3" },
      { sql: "UPDATE private" },
      { path: "/private/collection.sqlite" }
    ]) {
      expect(() => CollectionUpdateFormulaColumnRequestSchema.parse({ ...updateRequest, ...unsafe })).toThrow();
    }

    const updatedCalculation = {
      kind: "pige_numeric_formula",
      schemaVersion: 1,
      expression: updatedExpression
    } as const;
    const updateSnapshot = {
      ...snapshot,
      revisionId: "dataset_rev_20260729_cdefab123456",
      columns: [snapshot.columns[0], {
        ...formulaSummary,
        canEditFormula: true,
        calculation: updatedCalculation
      }]
    } as const;
    const updateIdentity = {
      apiVersion: updateRequest.apiVersion,
      requestId: updateRequest.requestId,
      activeVaultId: updateRequest.activeVaultId,
      datasetId: updateRequest.datasetId,
      tableId: updateRequest.tableId,
      columnId: updateRequest.columnId
    } as const;
    expect(CollectionUpdateFormulaColumnResultSchema.parse({
      ...updateIdentity,
      status: "committed",
      operationId: "op_20260729_formulaupdate",
      snapshot: updateSnapshot
    })).toMatchObject({ status: "committed", columnId: formulaColumn.id });
    expect(CollectionUpdateFormulaColumnResultSchema.parse({
      ...updateIdentity,
      status: "stale",
      snapshot
    }).status).toBe("stale");
    for (const reason of [
      "not_pige_formula",
      "imported_formula",
      "ineligible_operand",
      "no_change"
    ] as const) {
      expect(CollectionUpdateFormulaColumnResultSchema.parse({
        ...updateIdentity,
        status: "invalid",
        reason
      }).reason).toBe(reason);
    }
    for (const status of ["not_found", "failed"] as const) {
      expect(CollectionUpdateFormulaColumnResultSchema.parse({ ...updateIdentity, status }).status)
        .toBe(status);
    }
    expect(() => CollectionUpdateFormulaColumnResultSchema.parse({
      ...updateIdentity,
      status: "stale",
      snapshot: { ...snapshot, tableId: "table_other0000001" }
    })).toThrow("request identity");
    expect(() => CollectionUpdateFormulaColumnResultSchema.parse({
      ...updateIdentity,
      status: "committed",
      operationId: "op_20260729_formulaupdate",
      snapshot: { ...updateSnapshot, columns: [updateSnapshot.columns[0]] }
    })).toThrow("current Pige formula column");
    expect(() => CollectionUpdateFormulaColumnResultSchema.parse({
      ...updateIdentity,
      status: "failed",
      rawError: "SQLITE_BUSY"
    })).toThrow();
    expect(() => CollectionAddFormulaColumnResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: {
        ...snapshot,
        columns: [{ ...snapshot.columns[0], canEditFormula: true }, formulaSummary]
      }
    })).toThrow("Pige formula");

    const revisionBase = {
      schemaVersion: 1,
      id: updateSnapshot.revisionId,
      datasetId: request.datasetId,
      parentRevisionId: snapshot.revisionId,
      source: {
        sourceId: "src_20260729_abcdef123456",
        sourceKind: "csv_file",
        sourceRecordHash: `sha256:${"a".repeat(64)}`,
        sourceAssetChecksum: `sha256:${"b".repeat(64)}`,
        sourceAssetSize: 128
      },
      schema: {
        path: `schemas/${updateSnapshot.revisionId}.json`,
        checksum: `sha256:${"c".repeat(64)}`,
        size: 256
      },
      payload: {
        path: `data/revisions/${updateSnapshot.revisionId}.sqlite`,
        checksum: `sha256:${"d".repeat(64)}`,
        size: 512,
        format: "sqlite"
      },
      adapter: { id: "managed_collection", version: "1" },
      writer: { id: "managed_collection_formula", version: "1" },
      stats: {
        tableCount: 1,
        rowCount: 0,
        columnCount: 2,
        cellCount: 0,
        retainedValueBytes: 0
      },
      warnings: [],
      operationId: "op_20260729_formulaupdate",
      createdAt: "2026-07-29T00:00:00.000Z"
    } as const;
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      change: {
        kind: "collection_formula_update",
        tableId: request.tableId,
        columnId: formulaColumn.id
      }
    }).change?.kind).toBe("collection_formula_update");
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      id: "dataset_rev_20260729_defabc123456",
      parentRevisionId: updateSnapshot.revisionId,
      payload: {
        ...revisionBase.payload,
        path: "data/revisions/dataset_rev_20260729_defabc123456.sqlite"
      },
      change: {
        kind: "collection_formula_update_undo",
        tableId: request.tableId,
        columnId: formulaColumn.id,
        undoOfOperationId: "op_20260729_formulaupdate"
      }
    }).change?.kind).toBe("collection_formula_update_undo");
    expect(OperationRecordSchema.parse({
      id: "op_20260729_formulaupdate",
      schemaVersion: 1,
      createdAt: "2026-07-29T00:00:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "update_collection_formula",
      targetRefs: [
        { kind: "dataset", id: request.datasetId },
        { kind: "table", id: request.tableId },
        { kind: "column", id: formulaColumn.id }
      ],
      sourceRefs: [{ kind: "dataset", id: request.datasetId }],
      summary: "Updated one Managed Collection formula.",
      reversible: "yes",
      warnings: []
    }).kind).toBe("update_collection_formula");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-29T00:00:00.000Z",
      activeVaultId: request.activeVaultId,
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260729_formulaupdate",
        kind: "update_collection_formula",
        createdAt: "2026-07-29T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: request.datasetId,
          tableId: request.tableId,
          revisionId: updateSnapshot.revisionId
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("update_collection_formula");
  });

  it("freezes one same-Dataset row relation with bounded projection and exact Undo vocabulary", () => {
    const datasetId = "dataset_20260729_relation000001";
    const revisionId = "dataset_rev_20260729_relation000001";
    const sourceTableId = "table_relationsrc001";
    const targetTableId = "table_relationdst001";
    const sourceColumnId = "column_relationsrc01";
    const relationColumnId = "column_relationlink01";
    const targetDisplayColumnId = "column_relationname01";
    const targetRowId = "row_relationtarget01";
    const relation = {
      kind: "pige_single_relation",
      schemaVersion: 1,
      targetTableId,
      targetDisplayColumnId
    } as const;

    expect(COLLECTION_ADD_RELATION_COLUMN_CHANNEL).toBe("collections.addRelationColumn");
    expect(COLLECTION_EDIT_RELATION_CELL_CHANNEL).toBe("collections.editRelationCell");
    expect(COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL).toBe("collections.updateRelationColumn");
    expect(DatasetPigeRelationSchema.parse(relation)).toEqual(relation);
    expect(DatasetPigeRelationCellSchema.parse({
      kind: "pige_relation_target",
      schemaVersion: 1,
      targetRowId
    })).toMatchObject({ targetRowId });
    expect(DatasetPigeRelationCellSchema.parse(null)).toBeNull();
    expect(() => DatasetPigeRelationCellSchema.parse({
      kind: "pige_relation_target",
      schemaVersion: 1,
      targetRowId,
      displayLabel: "must not be durable"
    })).toThrow();

    const sourceColumn = {
      id: sourceColumnId,
      name: "Name",
      ordinal: 0,
      sourceType: "sqlite.text",
      logicalType: "string",
      nullable: true
    } as const;
    const relationColumn = {
      id: relationColumnId,
      name: "Company",
      ordinal: 1,
      sourceType: "pige.relation.single",
      logicalType: "string",
      nullable: true,
      relation
    } as const;
    const displayColumn = {
      id: targetDisplayColumnId,
      name: "Company name",
      ordinal: 0,
      sourceType: "sqlite.text",
      logicalType: "string",
      nullable: true
    } as const;
    const schemaRecord = {
      schemaVersion: 1,
      datasetId,
      revisionId,
      tables: [{
        id: sourceTableId,
        name: "People",
        sourceLocator: "table:people",
        ordinal: 0,
        rowCount: 1,
        columnCount: 2,
        columns: [sourceColumn, relationColumn]
      }, {
        id: targetTableId,
        name: "Companies",
        sourceLocator: "table:companies",
        ordinal: 1,
        rowCount: 1,
        columnCount: 1,
        columns: [displayColumn]
      }],
      createdAt: "2026-07-29T00:00:00.000Z"
    } as const;
    expect(DatasetSchemaRecordSchema.parse(schemaRecord).tables[0]?.columns[1]?.relation)
      .toEqual(relation);
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schemaRecord,
      tables: [{
        ...schemaRecord.tables[0],
        columns: [sourceColumn, {
          ...relationColumn,
          relation: { ...relation, targetTableId: "table_outside000001" }
        }]
      }, schemaRecord.tables[1]]
    })).toThrow("same-Dataset scalar display column");
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schemaRecord,
      tables: [schemaRecord.tables[0], {
        ...schemaRecord.tables[1],
        columns: [{ ...displayColumn, sourceType: "xlsx.formula.string" }]
      }]
    })).toThrow("same-Dataset scalar display column");
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schemaRecord,
      tables: [{
        ...schemaRecord.tables[0],
        columns: [sourceColumn, { ...relationColumn, sourceType: "xlsx.relation" }]
      }, schemaRecord.tables[1]]
    })).toThrow("nullable string-backed Pige columns");
    expect(() => DatasetTableSchema.parse({
      ...schemaRecord.tables[0],
      columnCount: 3,
      columns: [sourceColumn, relationColumn, {
        id: "column_relationformula1",
        name: "Invalid formula",
        ordinal: 2,
        sourceType: "pige.formula.number",
        logicalType: "number",
        nullable: true,
        calculation: {
          kind: "pige_numeric_formula",
          schemaVersion: 1,
          expression: { kind: "column", columnId: relationColumnId }
        }
      }]
    })).toThrow("numeric scalar or acyclic Pige formula columns");

    const addRequest = {
      apiVersion: 1,
      requestId: "collection_request_relationadd00001",
      activeVaultId: "vault_20260729_relation01",
      datasetId,
      tableId: sourceTableId,
      expectedRevisionId: revisionId,
      label: " Company ",
      targetTableId,
      targetDisplayColumnId
    } as const;
    expect(CollectionAddRelationColumnRequestSchema.parse(addRequest).label).toBe("Company");
    const descriptorColumnSummary = {
      columnId: relationColumnId,
      label: "Company",
      logicalType: "string",
      canRename: true,
      canTrash: true,
      canUseAsFormulaOperand: false,
      canEditFormula: false,
      canUseAsRelationDisplay: false,
      canEditRelation: true,
      canEditRelationDefinition: true,
      hasInboundRelationDescriptors: false,
      relation
    } as const;
    const sourceSnapshot = {
      datasetId,
      revisionId: "dataset_rev_20260729_relation000002",
      title: "Contacts",
      tableId: sourceTableId,
      tableName: "People",
      columns: [{
        columnId: sourceColumnId,
        label: "Name",
        logicalType: "string",
        canRename: true,
        canTrash: true,
        canUseAsFormulaOperand: false,
        canEditFormula: false,
        canUseAsRelationDisplay: true,
        canEditRelation: false,
        hasInboundRelationDescriptors: false
      }, descriptorColumnSummary],
      rows: [{
        rowId: "row_relationsource01",
        canTrash: true,
        hasInboundRelationReferences: false,
        cells: [{ columnId: sourceColumnId, value: "Ada", editable: true }, {
          columnId: relationColumnId,
          value: { kind: "relation", targetRowId: null, displayLabel: null },
          editable: true
        }]
      }],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: true,
      canAddRelationColumn: true,
      views: []
    } as const;
    const addIdentity = {
      apiVersion: addRequest.apiVersion,
      requestId: addRequest.requestId,
      activeVaultId: addRequest.activeVaultId,
      datasetId,
      tableId: sourceTableId,
      targetTableId,
      targetDisplayColumnId
    } as const;
    expect(CollectionAddRelationColumnResultSchema.parse({
      ...addIdentity,
      status: "committed",
      columnId: relationColumnId,
      operationId: "op_20260729_relationadd01",
      snapshot: sourceSnapshot
    })).toMatchObject({ status: "committed", columnId: relationColumnId });
    expect(CollectionAddRelationColumnResultSchema.parse({
      ...addIdentity,
      status: "stale",
      snapshot: { ...sourceSnapshot, canAddRelationColumn: false }
    }).status).toBe("stale");
    for (const status of ["not_found", "ineligible", "failed"] as const) {
      expect(CollectionAddRelationColumnResultSchema.parse({ ...addIdentity, status }).status)
        .toBe(status);
    }
    for (const unsafe of [
      { targetDatasetId: "dataset_20260729_outside000001" },
      { multiple: true },
      { reciprocal: true },
      { query: "SELECT *" },
      { path: "/private/relation.sqlite" }
    ]) {
      expect(() => CollectionAddRelationColumnRequestSchema.parse({ ...addRequest, ...unsafe })).toThrow();
    }

    const editRequest = {
      apiVersion: 1,
      requestId: "collection_request_relationedit0001",
      activeVaultId: addRequest.activeVaultId,
      datasetId,
      tableId: sourceTableId,
      expectedRevisionId: sourceSnapshot.revisionId,
      rowId: sourceSnapshot.rows[0].rowId,
      columnId: relationColumnId,
      targetRowId
    } as const;
    expect(CollectionEditRelationCellRequestSchema.parse(editRequest)).toEqual(editRequest);
    expect(CollectionEditRelationCellRequestSchema.parse({ ...editRequest, targetRowId: null }).targetRowId)
      .toBeNull();
    const editIdentity = {
      apiVersion: editRequest.apiVersion,
      requestId: editRequest.requestId,
      activeVaultId: editRequest.activeVaultId,
      datasetId,
      tableId: sourceTableId,
      rowId: editRequest.rowId,
      columnId: relationColumnId,
      targetRowId
    } as const;
    expect(CollectionEditRelationCellResultSchema.parse({
      ...editIdentity,
      status: "committed",
      operationId: "op_20260729_relationedit1",
      snapshot: {
        ...sourceSnapshot,
        rows: [{
          ...sourceSnapshot.rows[0],
          cells: [sourceSnapshot.rows[0].cells[0], {
            columnId: relationColumnId,
            value: { kind: "relation", targetRowId, displayLabel: "Acme" },
            editable: true
          }]
        }]
      }
    }).status).toBe("committed");
    expect(CollectionEditRelationCellResultSchema.parse({
      ...editIdentity,
      status: "stale",
      snapshot: sourceSnapshot
    }).status).toBe("stale");
    for (const status of ["not_found", "ineligible", "failed"] as const) {
      expect(CollectionEditRelationCellResultSchema.parse({ ...editIdentity, status }).status)
        .toBe(status);
    }
    const updateRequest = {
      apiVersion: 1, requestId: "collection_request_relationupdate01",
      activeVaultId: addRequest.activeVaultId, datasetId, tableId: sourceTableId,
      expectedRevisionId: sourceSnapshot.revisionId, columnId: relationColumnId,
      targetTableId, targetDisplayColumnId
    } as const;
    expect(CollectionUpdateRelationColumnRequestSchema.parse(updateRequest)).toEqual(updateRequest);
    expect(CollectionUpdateRelationColumnResultSchema.parse({
      apiVersion: 1, requestId: updateRequest.requestId, activeVaultId: updateRequest.activeVaultId,
      datasetId, tableId: sourceTableId, columnId: relationColumnId, targetTableId,
      targetDisplayColumnId, status: "committed", operationId: "op_20260729_relationupdate1",
      snapshot: sourceSnapshot
    }).status).toBe("committed");
    expect(() => CollectionUpdateRelationColumnRequestSchema.parse({ ...updateRequest, rawSql: "select 1" })).toThrow();
    expect(() => CollectionEditRelationCellRequestSchema.parse({
      ...editRequest,
      targetTableId,
      displayLabel: "renderer authority"
    })).toThrow();
    expect(CollectionRelationCellValueSchema.parse({
      kind: "relation",
      targetRowId,
      displayLabel: "42"
    }).displayLabel).toBe("42");
    expect(() => CollectionRelationCellValueSchema.parse({
      kind: "relation",
      targetRowId: null,
      displayLabel: "stale label"
    })).toThrow("cannot project a display label");

    const targetSnapshot = {
      ...sourceSnapshot,
      tableId: targetTableId,
      tableName: "Companies",
      columns: [{
        columnId: targetDisplayColumnId,
        label: "Company name",
        logicalType: "string",
        canRename: true,
        canTrash: false,
        canUseAsFormulaOperand: false,
        canEditFormula: false,
        canUseAsRelationDisplay: true,
        canEditRelation: false,
        hasInboundRelationDescriptors: true
      }],
      rows: [{
        rowId: targetRowId,
        canTrash: false,
        hasInboundRelationReferences: true,
        cells: [{ columnId: targetDisplayColumnId, value: "Acme", editable: true }]
      }]
    } as const;
    expect(CollectionOpenResultSchema.parse({
      apiVersion: 1,
      requestId: "collection_request_relationopen0001",
      activeVaultId: addRequest.activeVaultId,
      datasetId,
      tableId: targetTableId,
      status: "ready",
      snapshot: targetSnapshot
    }).status).toBe("ready");
    expect(() => CollectionOpenResultSchema.parse({
      apiVersion: 1,
      requestId: "collection_request_relationopen0001",
      activeVaultId: addRequest.activeVaultId,
      datasetId,
      tableId: targetTableId,
      status: "ready",
      snapshot: {
        ...targetSnapshot,
        rows: [{ ...targetSnapshot.rows[0], canTrash: true }]
      }
    })).toThrow("inbound relation references");
    expect(() => CollectionOpenResultSchema.parse({
      apiVersion: 1,
      requestId: "collection_request_relationopen0001",
      activeVaultId: addRequest.activeVaultId,
      datasetId,
      tableId: targetTableId,
      status: "ready",
      snapshot: {
        ...targetSnapshot,
        columns: [{ ...targetSnapshot.columns[0], canTrash: true }]
      }
    })).toThrow("inbound descriptors");

    const revisionBase = {
      schemaVersion: 1,
      id: sourceSnapshot.revisionId,
      datasetId,
      parentRevisionId: revisionId,
      source: {
        sourceId: "src_20260729_relation000001",
        sourceKind: "csv_file",
        sourceRecordHash: `sha256:${"a".repeat(64)}`,
        sourceAssetChecksum: `sha256:${"b".repeat(64)}`,
        sourceAssetSize: 128
      },
      schema: { path: `schemas/${sourceSnapshot.revisionId}.json`, checksum: `sha256:${"c".repeat(64)}`, size: 256 },
      payload: { path: `data/revisions/${sourceSnapshot.revisionId}.sqlite`, checksum: `sha256:${"d".repeat(64)}`, size: 512, format: "sqlite" },
      adapter: { id: "managed_collection", version: "1" },
      writer: { id: "managed_collection_relation", version: "1" },
      stats: { tableCount: 2, rowCount: 2, columnCount: 3, cellCount: 3, retainedValueBytes: 64 },
      warnings: [],
      operationId: "op_20260729_relationadd01",
      createdAt: "2026-07-29T00:00:00.000Z"
    } as const;
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      change: { kind: "collection_relation_add", tableId: sourceTableId, columnId: relationColumnId, targetTableId, targetDisplayColumnId }
    }).change?.kind).toBe("collection_relation_add");
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      id: "dataset_rev_20260729_relation000005",
      parentRevisionId: sourceSnapshot.revisionId,
      payload: { ...revisionBase.payload, path: "data/revisions/dataset_rev_20260729_relation000005.sqlite" },
      operationId: "op_20260729_relationundo2",
      change: { kind: "collection_relation_add_undo", tableId: sourceTableId, columnId: relationColumnId, targetTableId, targetDisplayColumnId, undoOfOperationId: "op_20260729_relationadd01" }
    }).change?.kind).toBe("collection_relation_add_undo");
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      id: "dataset_rev_20260729_relation000003",
      parentRevisionId: sourceSnapshot.revisionId,
      payload: { ...revisionBase.payload, path: "data/revisions/dataset_rev_20260729_relation000003.sqlite" },
      operationId: "op_20260729_relationedit1",
      change: { kind: "collection_relation_cell_edit", tableId: sourceTableId, rowId: editRequest.rowId, columnId: relationColumnId, targetTableId, targetRowId }
    }).change?.kind).toBe("collection_relation_cell_edit");
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      id: "dataset_rev_20260729_relation000004",
      parentRevisionId: "dataset_rev_20260729_relation000003",
      payload: { ...revisionBase.payload, path: "data/revisions/dataset_rev_20260729_relation000004.sqlite" },
      operationId: "op_20260729_relationundo1",
      change: { kind: "collection_relation_cell_edit_undo", tableId: sourceTableId, rowId: editRequest.rowId, columnId: relationColumnId, targetTableId, targetRowId: null, undoOfOperationId: "op_20260729_relationedit1" }
    }).change?.kind).toBe("collection_relation_cell_edit_undo");
    expect(DatasetRevisionSchema.parse({
      ...revisionBase,
      id: "dataset_rev_20260729_relation000006",
      parentRevisionId: sourceSnapshot.revisionId,
      payload: { ...revisionBase.payload, path: "data/revisions/dataset_rev_20260729_relation000006.sqlite" },
      operationId: "op_20260729_relationupdate1",
      change: { kind: "collection_relation_update", tableId: sourceTableId, columnId: relationColumnId,
        targetTableId, targetDisplayColumnId }
    }).change?.kind).toBe("collection_relation_update");
    for (const kind of ["add_collection_relation", "update_collection_relation_cell", "update_collection_relation"] as const) {
      expect(OperationRecordSchema.parse({
        id: kind === "add_collection_relation" ? "op_20260729_relationadd01" :
          kind === "update_collection_relation" ? "op_20260729_relationupdate1" : "op_20260729_relationedit1",
        schemaVersion: 1,
        createdAt: "2026-07-29T00:00:00.000Z",
        actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
        kind,
        targetRefs: [
          { kind: "dataset", id: datasetId },
          { kind: "table", id: sourceTableId },
          { kind: "column", id: relationColumnId }
        ],
        sourceRefs: [{ kind: "dataset", id: datasetId }],
        summary: "Changed one Managed Collection relation.",
        reversible: "yes",
        warnings: []
      }).kind).toBe(kind);
    }
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-29T00:00:00.000Z",
      activeVaultId: addRequest.activeVaultId,
      total: 2,
      invalidOperationCount: 0,
      hasMore: false,
      activities: ["add_collection_relation", "update_collection_relation_cell"].map((kind, index) => ({
        operationId: index === 0 ? "op_20260729_relationadd01" : "op_20260729_relationedit1",
        kind,
        createdAt: "2026-07-29T00:00:00.000Z",
        target: { kind: "collection", datasetId, tableId: sourceTableId, revisionId: sourceSnapshot.revisionId },
        status: "applied",
        canUndo: true
      }))
    }).activities).toHaveLength(2);
  });

  it("freezes a same-Dataset single-relation scalar lookup and rejects broader authority", () => {
    const relation = {
      kind: "pige_single_relation", schemaVersion: 1,
      targetTableId: "table_lookuptarget01", targetDisplayColumnId: "column_lookupname001"
    } as const;
    const lookup = {
      kind: "pige_single_lookup", schemaVersion: 1,
      relationColumnId: "column_lookuprelation01", targetColumnId: "column_lookupcount001"
    } as const;
    expect(COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL).toBe("collections.addLookupColumn");
    expect(COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL).toBe("collections.updateLookupColumn");
    expect(DatasetPigeLookupSchema.parse(lookup)).toEqual(lookup);
    expect(() => DatasetPigeLookupSchema.parse({ ...lookup, aggregate: "sum" })).toThrow();

    const sourceColumn = {
      id: "column_lookupsource01", name: "Person", ordinal: 0,
      sourceType: "sqlite.text", logicalType: "string", nullable: true
    } as const;
    const relationColumn = {
      id: lookup.relationColumnId, name: "Company", ordinal: 1,
      sourceType: "pige.relation.single", logicalType: "string", nullable: true, relation
    } as const;
    const lookupColumn = {
      id: "column_lookupvalue001", name: "Company count", ordinal: 2,
      sourceType: "pige.lookup.single", logicalType: "integer", nullable: true, lookup
    } as const;
    const targetName = {
      id: relation.targetDisplayColumnId, name: "Name", ordinal: 0,
      sourceType: "sqlite.text", logicalType: "string", nullable: true
    } as const;
    const targetCount = {
      id: lookup.targetColumnId, name: "Count", ordinal: 1,
      sourceType: "sqlite.integer", logicalType: "integer", nullable: true
    } as const;
    const schema = {
      schemaVersion: 1,
      datasetId: "dataset_20260729_lookup000001",
      revisionId: "dataset_rev_20260729_lookup000001",
      tables: [{
        id: "table_lookupsource01", name: "People", sourceLocator: "table:people",
        ordinal: 0, rowCount: 1, columnCount: 3,
        columns: [sourceColumn, relationColumn, lookupColumn]
      }, {
        id: relation.targetTableId, name: "Companies", sourceLocator: "table:companies",
        ordinal: 1, rowCount: 1, columnCount: 2, columns: [targetName, targetCount]
      }],
      createdAt: "2026-07-29T00:00:00.000Z"
    } as const;
    expect(DatasetSchemaRecordSchema.parse(schema).tables[0]?.columns[2]?.lookup).toEqual(lookup);
    const rollupColumn = {
      id: "column_lookuprollup01", name: "Company total", ordinal: 3,
      sourceType: "pige.rollup.single", logicalType: "number", nullable: true,
      rollup: {
        kind: "pige_single_rollup", schemaVersion: 1, relationColumnId: lookup.relationColumnId,
        aggregation: "sum", targetColumnId: lookup.targetColumnId
      }
    } as const;
    const formulaColumn = {
      id: "column_lookupformula1", name: "Derived total", ordinal: 4,
      sourceType: "pige.formula.number", logicalType: "number", nullable: true,
      calculation: {
        kind: "pige_numeric_formula", schemaVersion: 1,
        expression: {
          kind: "binary", operator: "add",
          left: { kind: "column", columnId: lookupColumn.id },
          right: { kind: "column", columnId: rollupColumn.id }
        }
      }
    } as const;
    const derivedSchema = {
      ...schema,
      tables: [{
        ...schema.tables[0], columnCount: 5,
        columns: [sourceColumn, relationColumn, lookupColumn, rollupColumn, formulaColumn]
      }, schema.tables[1]]
    } as const;
    expect(DatasetSchemaRecordSchema.parse(derivedSchema).tables[0]?.columns[4]?.calculation)
      .toEqual(formulaColumn.calculation);
    expect(() => DatasetSchemaRecordSchema.parse({
      ...derivedSchema,
      tables: [{
        ...derivedSchema.tables[0],
        columns: [sourceColumn, relationColumn, {
          ...lookupColumn,
          logicalType: "string" as const,
          lookup: { ...lookup, targetColumnId: targetName.id }
        }, rollupColumn, formulaColumn]
      }, schema.tables[1]]
    })).toThrow("numeric scalar or acyclic Pige formula columns");
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schema,
      tables: [{ ...schema.tables[0], columns: [sourceColumn, relationColumn, {
        ...lookupColumn, lookup: { ...lookup, relationColumnId: "column_lookupmissing01" }
      }] }, schema.tables[1]]
    })).toThrow("same-table single relation");
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schema,
      tables: [schema.tables[0], { ...schema.tables[1], columns: [targetName, {
        ...targetCount, sourceType: "pige.lookup.single", lookup
      }] }]
    })).toThrow("same-table single relation");

    const request = {
      apiVersion: 1, requestId: "collection_request_lookupschema0001",
      activeVaultId: "vault_20260729_lookup001", datasetId: schema.datasetId,
      tableId: schema.tables[0].id, expectedRevisionId: schema.revisionId,
      label: " Company count ", relationColumnId: lookup.relationColumnId,
      targetColumnId: lookup.targetColumnId
    } as const;
    expect(CollectionAddLookupColumnRequestSchema.parse(request).label).toBe("Company count");
    const { label: _label, ...updateBase } = request;
    expect(CollectionUpdateLookupColumnRequestSchema.parse({ ...updateBase, columnId: lookupColumn.id }))
      .toMatchObject({ columnId: lookupColumn.id, relationColumnId: lookup.relationColumnId, targetColumnId: lookup.targetColumnId });
    for (const unsafe of [
      { targetDatasetId: "dataset_20260729_outside000001" },
      { aggregate: "sum" },
      { multiple: true },
      { query: "SELECT *" },
      { path: "/private/lookup.sqlite" }
    ]) expect(() => CollectionAddLookupColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    expect(KnowledgeActivitySummarySchema.parse({ operationId: "op_20260729_lookupedit01", kind: "update_collection_lookup",
      createdAt: "2026-07-29T00:00:00.000Z", target: { kind: "collection", datasetId: request.datasetId,
        tableId: request.tableId, revisionId: request.expectedRevisionId }, status: "applied", canUndo: true }).kind
    ).toBe("update_collection_lookup");
  });

  it("freezes same-Dataset relation rollups to count or numeric sum without renderer query authority", () => {
    const count = { kind: "pige_single_rollup", schemaVersion: 1, relationColumnId: "column_rolluprelation01", aggregation: "count" } as const;
    const sum = { ...count, aggregation: "sum", targetColumnId: "column_rolluptarget001" } as const;
    expect(COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL).toBe("collections.addRollupColumn");
    expect(COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL).toBe("collections.updateRollupColumn");
    expect(DatasetPigeRollupSchema.parse(count)).toEqual(count);
    expect(DatasetPigeRollupSchema.parse(sum)).toEqual(sum);
    expect(() => DatasetPigeRollupSchema.parse({ ...count, targetColumnId: sum.targetColumnId })).toThrow();
    expect(() => DatasetPigeRollupSchema.parse({ ...sum, targetColumnId: undefined })).toThrow();
    const request = {
      apiVersion: 1, requestId: "collection_request_rollupschema0001", activeVaultId: "vault_20260729_rollup001",
      datasetId: "dataset_20260729_rollup000001", tableId: "table_rollupsource01",
      expectedRevisionId: "dataset_rev_20260729_rollup000001", label: " Total ",
      relationColumnId: count.relationColumnId, aggregation: "sum", targetColumnId: sum.targetColumnId
    } as const;
    expect(CollectionAddRollupColumnRequestSchema.parse(request).label).toBe("Total");
    const { label: _label, ...updateBase } = request;
    expect(CollectionUpdateRollupColumnRequestSchema.parse({ ...updateBase, columnId: "column_rollupresult01" }))
      .toMatchObject({ columnId: "column_rollupresult01", aggregation: "sum", targetColumnId: sum.targetColumnId });
    for (const unsafe of [{ rawSql: "sum(value)" }, { targetDatasetId: "dataset_other" }, { expression: "value * 2" },
      { aggregation: "average" }]) expect(() => CollectionAddRollupColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    expect(KnowledgeActivitySummarySchema.parse({ operationId: "op_20260729_rollupadd01", kind: "add_collection_rollup",
      createdAt: "2026-07-29T00:00:00.000Z", target: { kind: "collection", datasetId: request.datasetId,
        tableId: request.tableId, revisionId: request.expectedRevisionId }, status: "applied", canUndo: true }).kind
    ).toBe("add_collection_rollup");
    expect(KnowledgeActivitySummarySchema.parse({ operationId: "op_20260729_rollupedit1", kind: "update_collection_rollup",
      createdAt: "2026-07-29T00:00:00.000Z", target: { kind: "collection", datasetId: request.datasetId,
        tableId: request.tableId, revisionId: request.expectedRevisionId }, status: "applied", canUndo: true }).kind
    ).toBe("update_collection_rollup");
  });

  it("keeps Collection column rename stable, reversible, CAS-bound, and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_cdefghijklmnopqr",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456",
      columnId: "column_abcdef123456",
      label: " Renamed notes "
    } as const;
    const parsedRequest = CollectionRenameColumnRequestSchema.parse(request);
    expect(parsedRequest.label).toBe("Renamed notes");
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      columnId: request.columnId
    } as const;
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260728_bcdefa123456",
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [{ columnId: request.columnId, label: "Renamed notes", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: []
    } as const;
    expect(CollectionRenameColumnResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260728_cdefab12",
      snapshot
    })).toMatchObject({ status: "committed", columnId: request.columnId });
    for (const status of ["stale", "duplicate"] as const) {
      expect(CollectionRenameColumnResultSchema.parse({ ...identity, status, snapshot }).status).toBe(status);
    }
    expect(CollectionRenameColumnResultSchema.parse({
      ...identity,
      status: "ineligible",
      snapshot: { ...snapshot, columns: [{ ...snapshot.columns[0], canRename: false }] }
    }).status).toBe("ineligible");
    for (const status of ["not_found", "failed"] as const) {
      expect(CollectionRenameColumnResultSchema.parse({ ...identity, status }).status).toBe(status);
    }
    for (const unsafe of [
      { label: "   " },
      { label: "界".repeat(86) },
      { path: "/private/collection.sqlite" },
      { body: "private" },
      { formula: "=A1" }
    ]) {
      expect(() => CollectionRenameColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionRenameColumnResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, columns: [] }
    })).toThrow("stable column identity");
    expect(() => CollectionRenameColumnResultSchema.parse({
      ...identity,
      status: "duplicate",
      snapshot: { ...snapshot, tableId: "table_bcdefa123456" }
    })).toThrow("request identity");
    expect(OperationRecordSchema.parse({
      id: "op_20260728_cdefab12",
      schemaVersion: 1,
      createdAt: "2026-07-28T00:00:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "rename_collection_column",
      targetRefs: [
        { kind: "dataset", id: request.datasetId },
        { kind: "table", id: request.tableId },
        { kind: "column", id: request.columnId }
      ],
      sourceRefs: [{ kind: "dataset", id: request.datasetId }],
      summary: "Renamed one Managed Collection column.",
      reversible: "yes",
      warnings: []
    }).kind).toBe("rename_collection_column");
  });

  it("keeps Collection column trash explicit, reversible, CAS-bound, and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_defghijklmnopqrs",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456",
      columnId: "column_abcdef123456"
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      columnId: request.columnId
    } as const;
    const column = {
      columnId: request.columnId,
      label: "Notes",
      logicalType: "string" as const,
      canRename: true,
      canTrash: true,
      canUseAsFormulaOperand: false,
      canEditFormula: false
    };
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260728_bcdefa123456",
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [column],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: []
    } as const;
    expect(CollectionTrashColumnRequestSchema.parse(request)).toEqual(request);
    expect(CollectionTrashColumnResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260728_defabc12",
      snapshot: {
        ...snapshot,
        columns: [{ ...column, columnId: "column_bcdefa123456" }]
      }
    }).status).toBe("committed");
    expect(CollectionTrashColumnResultSchema.parse({ ...identity, status: "stale", snapshot }).status)
      .toBe("stale");
    expect(CollectionTrashColumnResultSchema.parse({
      ...identity,
      status: "ineligible",
      snapshot: { ...snapshot, columns: [{ ...column, canTrash: false }] }
    }).status).toBe("ineligible");
    for (const status of ["not_found", "failed"] as const) {
      expect(CollectionTrashColumnResultSchema.parse({ ...identity, status }).status).toBe(status);
    }
    for (const unsafe of [
      { path: "/private/collection.sqlite" },
      { body: "private" },
      { values: ["private"] },
      { permanent: true }
    ]) {
      expect(() => CollectionTrashColumnRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionTrashColumnResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260728_defabc12",
      snapshot
    })).toThrow("remove the column");
    expect(OperationRecordSchema.parse({
      id: "op_20260728_defabc12",
      schemaVersion: 1,
      createdAt: "2026-07-28T00:00:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "trash_collection_column",
      targetRefs: [
        { kind: "dataset", id: request.datasetId },
        { kind: "table", id: request.tableId },
        { kind: "column", id: request.columnId }
      ],
      sourceRefs: [{ kind: "dataset", id: request.datasetId }],
      summary: "Moved one Managed Collection column out of the current revision.",
      reversible: "yes",
      warnings: []
    }).kind).toBe("trash_collection_column");
  });

  it("keeps Collection row trash explicit, reversible, revision-bound, and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "collection_request_bcdefghijklmnopq",
      activeVaultId: "vault_20260728_abcdefgh",
      datasetId: "dataset_20260728_abcdef123456",
      tableId: "table_abcdef123456",
      expectedRevisionId: "dataset_rev_20260728_abcdef123456",
      rowId: "row_abcdef123456"
    } as const;
    const identity = {
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      datasetId: request.datasetId,
      tableId: request.tableId,
      rowId: request.rowId
    } as const;
    const currentRow = {
      rowId: request.rowId,
      canTrash: true,
      cells: [{ columnId: "column_abcdef123456", value: "Keep prior bytes", editable: true }]
    } as const;
    const snapshot = {
      datasetId: request.datasetId,
      revisionId: "dataset_rev_20260728_bcdefa123456",
      title: "Reading list",
      tableId: request.tableId,
      tableName: "Items",
      columns: [{ columnId: "column_abcdef123456", label: "Notes", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [currentRow],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
      canAddFormulaColumn: false,
      views: []
    } as const;

    expect(CollectionTrashRowRequestSchema.parse(request)).toEqual(request);
    expect(CollectionTrashRowResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260728_bcdefa12",
      snapshot: { ...snapshot, rows: [], totalRowCount: 0, returnedRowCount: 0 }
    })).toMatchObject({ status: "committed", operationId: "op_20260728_bcdefa12" });
    expect(CollectionTrashRowResultSchema.parse({ ...identity, status: "stale", snapshot }))
      .toMatchObject({ status: "stale", snapshot: { rows: [{ canTrash: true }] } });
    for (const status of ["not_found", "ineligible", "failed"] as const) {
      expect(CollectionTrashRowResultSchema.parse({ ...identity, status }).status).toBe(status);
    }

    for (const unsafe of [
      { row: currentRow },
      { values: ["private"] },
      { path: "/private/collection.sqlite" },
      { body: "private" },
      { sql: "DELETE FROM rows" }
    ]) {
      expect(() => CollectionTrashRowRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => CollectionTrashRowResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260728_bcdefa12",
      snapshot
    })).toThrow("remove the row");
    expect(() => CollectionTrashRowResultSchema.parse({
      ...identity,
      status: "stale",
      snapshot: { ...snapshot, datasetId: "dataset_20260728_bcdefa123456" }
    })).toThrow("request identity");
  });

  it("keeps Knowledge Health report-only, generation-bound, bounded, ordered, and renderer-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "knowledge_health_request_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh"
    } as const;
    expect(KnowledgeHealthRunRequestSchema.parse(request)).toEqual(request);

    const ready = {
      ...request,
      status: "ready",
      checkedAt: "2026-07-27T12:00:00.000Z",
      indexGeneration: "2026-07-27T11:59:00.000Z#0123456789abcdef0123456789abcdef",
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 4,
        brokenLinkPageCount: 1,
        unresolvedLinkCount: 2,
        orphanPageCount: 1,
        duplicateTopicGroupCount: 1,
        unsourcedClaimCount: 1
      },
      issues: [
        {
          kind: "broken_link",
          page: { pageId: "page_20260727_broken01", title: "Broken links" },
          unresolvedLinkCount: 2
        },
        {
          kind: "orphan_page",
          page: { pageId: "page_20260727_orphan01", title: "Orphan note" }
        },
        {
          kind: "duplicate_topic",
          candidatePageCount: 2,
          pages: [
            { pageId: "page_20260727_topic001", title: "Local RAG" },
            { pageId: "page_20260727_topic002", title: "Local Rag" }
          ]
        },
        {
          kind: "unsourced_claim",
          page: { pageId: "page_20260727_claim001", title: "A claim" }
        }
      ],
      truncated: false
    } as const;
    expect(KnowledgeHealthRunResultSchema.parse(ready)).toEqual(ready);
    expect(KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES).toBe(100);
    expect(KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" }))
      .toEqual({ ...request, status: "unavailable" });
    expect(KnowledgeHealthRunResultSchema.parse({
      ...ready,
      coverage: "partial",
      invalidPageCount: 2
    })).toMatchObject({ coverage: "partial", invalidPageCount: 2 });

    for (const unsafe of [
      { path: "/private/vault/wiki/note.md" },
      { body: "private note body" },
      { sql: "SELECT * FROM pages" },
      { rawLinkTarget: "../secret.md" },
      { hash: "sha256:private" }
    ]) {
      expect(() => KnowledgeHealthRunResultSchema.parse({ ...ready, ...unsafe })).toThrow();
    }
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...ready,
      issues: [...ready.issues].reverse()
    })).toThrow();
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...ready,
      counts: { ...ready.counts, totalIssueCount: 5 },
      truncated: true
    })).toThrow();
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...ready,
      issues: [{
        kind: "duplicate_topic",
        candidatePageCount: 2,
        pages: [
          { pageId: "page_20260727_topic002", title: "Local Rag" },
          { pageId: "page_20260727_topic001", title: "Local RAG" }
        ]
      }]
    })).toThrow();
  });

  it("binds only one deterministic broken-reference unlink repair without exposing content authority", () => {
    const repairContextId = `knowledge_health_repair_context_${"a".repeat(32)}`;
    const sourceRevision = `noteeditrev_${"1".repeat(64)}`;
    const sourceRenderProof = `knowledge_health_render_${"2".repeat(64)}`;
    const occurrenceId = `knowledge_health_occurrence_${"3".repeat(64)}`;
    const indexGeneration = "2026-07-27T11:59:00.000Z#0123456789abcdef0123456789abcdef";
    const reportRequest = {
      apiVersion: 1,
      requestId: "knowledge_health_request_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh"
    } as const;
    const eligibleReport = {
      ...reportRequest,
      status: "ready",
      checkedAt: "2026-07-27T12:00:00.000Z",
      indexGeneration,
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 1,
        brokenLinkPageCount: 1,
        unresolvedLinkCount: 1,
        orphanPageCount: 0,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues: [{
        kind: "broken_link",
        page: { pageId: "page_20260727_broken01", title: "Broken link" },
        unresolvedLinkCount: 1,
        repairableOccurrences: [{
          ordinal: 1,
          displayLabel: "Missing page",
          repairContextId,
          sourceRevision,
          sourceRenderProof,
          occurrenceId
        }]
      }],
      truncated: false
    } as const;
    expect(KnowledgeHealthRunResultSchema.parse(eligibleReport)).toEqual(eligibleReport);
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      coverage: "partial",
      invalidPageCount: 1
    })).toThrow();
    expect(KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      counts: { ...eligibleReport.counts, unresolvedLinkCount: 2 },
      issues: [{ ...eligibleReport.issues[0], unresolvedLinkCount: 2 }]
    })).toMatchObject({ issues: [{ unresolvedLinkCount: 2 }] });
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      issues: [{ ...eligibleReport.issues[0], repairableOccurrences: [
        eligibleReport.issues[0].repairableOccurrences[0],
        { ...eligibleReport.issues[0].repairableOccurrences[0], ordinal: 1 }
      ] }]
    })).toThrow();
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      counts: {
        ...eligibleReport.counts,
        brokenLinkPageCount: 0,
        unresolvedLinkCount: 0,
        orphanPageCount: 1
      },
      issues: [{
        kind: "orphan_page",
        page: eligibleReport.issues[0].page,
        repairContextId
      }]
    })).toThrow();

    const request = {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_abcdefghijklmnop",
      activeVaultId: reportRequest.activeVaultId,
      reportRequestId: reportRequest.requestId,
      indexGeneration,
      issueKind: "broken_link",
      pageId: eligibleReport.issues[0].page.pageId,
      action: "unlink_broken_reference",
      repairContextId,
      sourceRevision,
      sourceRenderProof,
      occurrenceId
    } as const;
    expect(KnowledgeHealthRepairRequestSchema.parse(request)).toEqual(request);
    const committed = {
      ...request,
      status: "committed",
      revision: `noteeditrev_${"b".repeat(32)}`,
      operationId: "op_20260727_abcdefghijklmnop"
    } as const;
    expect(KnowledgeHealthRepairResultSchema.parse(committed)).toEqual(committed);
    expect(KnowledgeHealthRepairResultSchema.parse({
      ...request,
      status: "stale",
      revision: committed.revision
    })).toMatchObject({ status: "stale", revision: committed.revision });
    for (const status of ["not_found", "ineligible", "failed"] as const) {
      expect(KnowledgeHealthRepairResultSchema.parse({ ...request, status }).status).toBe(status);
    }
    for (const unsafe of [
      { body: "[[secret]]" },
      { path: "/private/vault/wiki/note.md" },
      { rawTarget: "../secret.md" },
      { replacement: "secret" }
    ]) {
      expect(() => KnowledgeHealthRepairRequestSchema.parse({ ...request, ...unsafe })).toThrow();
      expect(() => KnowledgeHealthRepairResultSchema.parse({ ...committed, ...unsafe })).toThrow();
    }
    expect(() => KnowledgeHealthRepairRequestSchema.parse({
      ...request,
      action: "repair_all"
    })).toThrow();
    expect(() => KnowledgeHealthRepairRequestSchema.parse({
      ...request,
      issueKind: "orphan_page"
    })).toThrow();

    const { action: _unlinkAction, ...searchProof } = request;
    const targetSearch = {
      ...searchProof,
      requestId: "knowledge_health_target_search_abcdefghijklmnop",
      query: "current page"
    } as const;
    expect(KnowledgeHealthTargetSearchRequestSchema.parse(targetSearch)).toEqual(targetSearch);
    const target = {
      page: { pageId: "page_20260727_current01", title: "Current page" },
      pageType: "note",
      targetContextId: `knowledge_health_target_context_${"4".repeat(32)}`,
      targetRevision: `noteeditrev_${"5".repeat(64)}`,
      targetRenderProof: `knowledge_health_render_${"6".repeat(64)}`
    } as const;
    expect(KnowledgeHealthTargetSearchResultSchema.parse({
      ...targetSearch,
      status: "ready",
      targets: [target],
      truncated: false
    })).toMatchObject({ status: "ready", targets: [target] });
    const retarget = {
      ...request,
      action: "retarget_broken_reference",
      targetPageId: target.page.pageId,
      targetContextId: target.targetContextId,
      targetRevision: target.targetRevision,
      targetRenderProof: target.targetRenderProof
    } as const;
    expect(KnowledgeHealthRepairRequestSchema.parse(retarget)).toEqual(retarget);
    expect(() => KnowledgeHealthRepairRequestSchema.parse({ ...retarget, targetRevision: undefined })).toThrow();
    expect(() => KnowledgeHealthRepairRequestSchema.parse({ ...retarget, targetPageId: request.pageId })).toThrow();
    for (const unsafe of [{ path: "/private/page.md" }, { body: "Target body" }]) {
      expect(() => KnowledgeHealthTargetSearchResultSchema.parse({
        ...targetSearch,
        status: "ready",
        targets: [{ ...target, ...unsafe }],
        truncated: false
      })).toThrow();
    }
  });

  it("binds one orphan target to one explicitly selected current parent without body or path authority", () => {
    const targetProof = {
      apiVersion: 1,
      activeVaultId: "vault_20260731_orphan",
      reportRequestId: "knowledge_health_request_orphanabcdefghijkl",
      indexGeneration: "2026-07-31T12:00:00.000Z#orphanindexabcd",
      issueKind: "orphan_page",
      pageId: "page_20260731_orphantarget",
      repairContextId: `knowledge_health_repair_context_${"a".repeat(32)}`,
      targetRevision: `noteeditrev_${"b".repeat(64)}`,
      targetRenderProof: `knowledge_health_render_${"c".repeat(64)}`
    } as const;
    const reportIssue = {
      kind: "orphan_page",
      page: { pageId: targetProof.pageId, title: "Orphan target" },
      repairContextId: targetProof.repairContextId,
      targetRevision: targetProof.targetRevision,
      targetRenderProof: targetProof.targetRenderProof
    } as const;
    expect(KnowledgeHealthRunResultSchema.parse({
      apiVersion: 1,
      requestId: targetProof.reportRequestId,
      activeVaultId: targetProof.activeVaultId,
      status: "ready",
      checkedAt: "2026-07-31T12:01:00.000Z",
      indexGeneration: targetProof.indexGeneration,
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 1, brokenLinkPageCount: 0, unresolvedLinkCount: 0,
        orphanPageCount: 1, duplicateTopicGroupCount: 0, unsourcedClaimCount: 0
      },
      issues: [reportIssue],
      truncated: false
    })).toMatchObject({ issues: [reportIssue] });
    expect(() => KnowledgeHealthRunResultSchema.parse({
      apiVersion: 1,
      requestId: targetProof.reportRequestId,
      activeVaultId: targetProof.activeVaultId,
      status: "ready",
      checkedAt: "2026-07-31T12:01:00.000Z",
      indexGeneration: targetProof.indexGeneration,
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 1, brokenLinkPageCount: 0, unresolvedLinkCount: 0,
        orphanPageCount: 1, duplicateTopicGroupCount: 0, unsourcedClaimCount: 0
      },
      issues: [{ ...reportIssue, targetRevision: undefined }],
      truncated: false
    })).toThrow();

    const search = {
      ...targetProof,
      requestId: "knowledge_health_orphan_parent_search_abcdefghijklmnop",
      query: "entry"
    } as const;
    expect(KnowledgeHealthOrphanParentSearchRequestSchema.parse(search)).toEqual(search);
    const parent = {
      page: { pageId: "page_20260731_entryparent", title: "Entry note" },
      pageType: "note",
      sourceContextId: `knowledge_health_orphan_parent_context_${"d".repeat(32)}`,
      sourceRevision: `noteeditrev_${"e".repeat(64)}`,
      sourceRenderProof: `knowledge_health_render_${"f".repeat(64)}`
    } as const;
    expect(KnowledgeHealthOrphanParentSearchResultSchema.parse({
      ...search,
      status: "ready",
      parents: [parent],
      truncated: false
    })).toMatchObject({ status: "ready", parents: [parent] });
    const repair = {
      ...targetProof,
      requestId: "knowledge_health_orphan_repair_request_abcdefghijklmnop",
      action: "connect_orphan_to_parent",
      sourcePageId: parent.page.pageId,
      sourceContextId: parent.sourceContextId,
      sourceRevision: parent.sourceRevision,
      sourceRenderProof: parent.sourceRenderProof
    } as const;
    expect(KnowledgeHealthOrphanRepairRequestSchema.parse(repair)).toEqual(repair);
    expect(KnowledgeHealthOrphanRepairResultSchema.parse({
      ...repair,
      status: "committed",
      revision: `noteeditrev_${"1".repeat(64)}`,
      operationId: "op_20260731_orphanrepair123"
    })).toMatchObject({ status: "committed" });
    expect(() => KnowledgeHealthOrphanRepairRequestSchema.parse({
      ...repair,
      sourcePageId: repair.pageId
    })).toThrow();
    for (const unsafe of [{ path: "/private/vault/wiki/entry.md" }, { body: "Parent body" }]) {
      expect(() => KnowledgeHealthOrphanParentSearchResultSchema.parse({
        ...search,
        status: "ready",
        parents: [{ ...parent, ...unsafe }],
        truncated: false
      })).toThrow();
      expect(() => KnowledgeHealthOrphanRepairRequestSchema.parse({ ...repair, ...unsafe })).toThrow();
    }
  });

  it("keeps the single local semantic asset lifecycle strict, revision-fenced, and renderer-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "ragasset_abcdefghijklmnop",
      expectedRevision: 4
    } as const;
    expect(LocalSemanticRetrievalStatusRequestSchema.parse({ apiVersion: 1 }))
      .toEqual({ apiVersion: 1 });
    expect(LocalSemanticRetrievalInstallRequestSchema.parse(request)).toEqual(request);
    expect(LocalSemanticRetrievalEnableRequestSchema.parse(request)).toEqual(request);
    expect(LocalSemanticRetrievalDisableRequestSchema.parse(request)).toEqual(request);
    expect(LocalSemanticRetrievalRemoveRequestSchema.parse(request)).toEqual(request);

    const ready = {
      apiVersion: 1,
      revision: 5,
      assetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
      assetState: "ready",
      downloadSizeBytes: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
      lexicalSearchRemainsAvailable: true
    } as const;
    expect(LocalSemanticRetrievalStatusSchema.parse(ready)).toEqual(ready);
    expect(LocalSemanticRetrievalInstallResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      revision: 5,
      status: "accepted",
      jobId: "job_20260727_abcdefgh"
    })).toMatchObject({ status: "accepted" });
    expect(LocalSemanticRetrievalEnableResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      revision: 6,
      status: "already_enabled"
    })).toMatchObject({ status: "already_enabled", revision: 6 });

    expect(LocalSemanticRetrievalStatusSchema.parse({
      ...ready,
      assetState: "disabled"
    })).toMatchObject({ assetState: "disabled", lexicalSearchRemainsAvailable: true });
    expect(() => LocalSemanticRetrievalStatusSchema.parse({
      ...ready,
      activeJobId: "job_20260727_abcdefgh"
    })).toThrow();
    for (const unsafe of [
      { path: "/private/model.gguf" },
      { downloadUrl: "https://example.invalid/model.gguf" },
      { sha256: "secret-or-internal" },
      { providerId: "custom-provider" }
    ]) {
      expect(() => LocalSemanticRetrievalStatusSchema.parse({ ...ready, ...unsafe })).toThrow();
    }
    expect(() => LocalSemanticRetrievalInstallRequestSchema.parse({
      ...request,
      assetId: "another-model"
    })).toThrow();
  });

  it("keeps the managed PaddleOCR lifecycle catalog-bound, explicit, and renderer-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "paddleocr_abcdefghijklmnop",
      expectedRevision: 4
    } as const;
    const catalog = {
      apiVersion: 1,
      revision: 4,
      engineId: PADDLE_OCR_ENGINE_ID,
      state: "not_installed",
      catalogVersion: "paddleocr-v1",
      components: [{
        componentId: "paddleocr-engine",
        kind: "engine",
        label: "PaddleOCR local engine",
        version: "1.0.0",
        sizeBytes: 1024
      }],
      downloadSizeBytes: 1024,
      nativeOcrPreferred: true,
      hiddenDownloadsAllowed: false,
      canInstall: true,
      canEnable: false,
      canTest: false,
      canDisable: false,
      canRemove: false
    } as const;

    expect(PaddleOcrSummaryRequestSchema.parse({ apiVersion: 1 })).toEqual({ apiVersion: 1 });
    for (const schema of [
      PaddleOcrInstallRequestSchema,
      PaddleOcrEnableRequestSchema,
      PaddleOcrTestRequestSchema,
      PaddleOcrDisableRequestSchema,
      PaddleOcrRemoveRequestSchema
    ]) {
      expect(schema.parse(request)).toEqual(request);
    }
    expect(PaddleOcrSummarySchema.parse(catalog)).toEqual(catalog);

    const installing = {
      ...catalog,
      activeAction: "install",
      activeJobId: "job_20260728_abcdefgh",
      canInstall: false
    } as const;
    expect(PaddleOcrInstallResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "accepted",
      jobId: installing.activeJobId,
      summary: installing
    })).toMatchObject({ status: "accepted", summary: { nativeOcrPreferred: true } });

    const ready = {
      ...catalog,
      revision: 5,
      state: "ready",
      canInstall: false,
      canTest: true,
      canDisable: true,
      canRemove: true
    } as const;
    expect(PaddleOcrEnableResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "committed",
      summary: ready
    })).toMatchObject({ status: "committed", summary: { state: "ready" } });
    expect(PaddleOcrTestResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "accepted",
      jobId: "job_20260728_ijklmnop",
      summary: { ...ready, activeAction: "test", activeJobId: "job_20260728_ijklmnop",
        canTest: false, canDisable: false, canRemove: false }
    })).toMatchObject({ status: "accepted" });
    expect(PaddleOcrDisableResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "already_current",
      summary: { ...ready, state: "disabled", canEnable: true, canTest: true,
        canDisable: false, canRemove: true }
    })).toMatchObject({ status: "already_current" });
    expect(PaddleOcrRemoveResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "committed",
      summary: { ...catalog, revision: 6 }
    })).toMatchObject({ status: "committed" });

    expect(() => PaddleOcrSummarySchema.parse({ ...catalog, engineId: "paddleocr" })).toThrow();
    expect(() => PaddleOcrSummarySchema.parse({ ...catalog, canInstall: false })).toThrow();
    expect(() => PaddleOcrSummarySchema.parse({
      ...catalog,
      activeAction: "install",
      canInstall: false
    })).toThrow();
    for (const unsafe of [
      { path: "/private/paddleocr" },
      { url: "https://example.invalid/paddleocr" },
      { sha256: "private-checksum" },
      { pythonArgs: ["-m", "paddleocr"] },
      { rawError: "private failure" }
    ]) {
      expect(() => PaddleOcrSummarySchema.parse({ ...catalog, ...unsafe })).toThrow();
      expect(() => PaddleOcrInstallRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => PaddleOcrInstallResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "failed",
      summary: catalog
    })).toThrow();
  });

  it("admits only the frozen local semantic hybrid retrieval mode", () => {
    const result = {
      searchedAt: "2026-07-27T00:00:00.000Z",
      activeVaultId: "vault_20260727_abcdefgh",
      query: "local evidence",
      mode: "semantic_hybrid",
      total: 0,
      invalidPageCount: 0,
      degraded: false,
      results: []
    } as const;
    expect(RetrievalSearchResultSchema.parse(result)).toEqual(result);
    expect(() => RetrievalSearchResultSchema.parse({ ...result, mode: "semantic_only" })).toThrow();
  });

  it("keeps Pi package inventory and exact install results strict, pathless, and revision-fenced", () => {
    const registry = {
      apiVersion: 1,
      revision: 4,
      packages: [{
        packageId: "pkg_0123456789abcdef01234567",
        packageName: "@larksuite/cli",
        version: "1.0.77",
        state: "installed_disabled",
        packageTypes: ["extension"],
        dependencyCount: 0,
        enabled: false,
        canEnable: false,
        trust: "community",
        canUpdate: true,
        canRollback: false,
        rollbackTarget: null
      }]
    } as const;
    const parsedRegistry = PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry });
    expect(parsedRegistry).toMatchObject({ status: "ready", registry });
    expect(parsedRegistry.status === "ready" && parsedRegistry.registry.packages[0]?.pinned).toBe(false);

    const request = {
      apiVersion: 1,
      requestId: "pi_package_request_abcdefghijklmnop",
      expectedRegistryRevision: 4,
      packageName: "@larksuite/cli",
      version: "1.0.77"
    } as const;
    expect(PiPackageInstallRequestSchema.parse(request)).toEqual(request);
    for (const status of ["installed_disabled", "denied", "stale"] as const) {
      expect(PiPackageInstallResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status,
        registry
      })).toMatchObject({ status, registry });
    }
    expect(PiPackageInstallResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      status: "failed"
    })).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      status: "failed"
    });
    expect(() => PiPackageInstallResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      status: "failed",
      registry
    })).toThrow();
    for (const unsafe of [
      { path: "/private/pi-packages/package" },
      { tarballUrl: "https://registry.npmjs.org/private.tgz" },
      { integrity: "sha512-private" },
      { rawError: "private failure" }
    ]) {
      expect(() => PiPackageInstallRequestSchema.parse({ ...request, ...unsafe })).toThrow();
      expect(() => PiPackageInstallResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status: "failed",
        ...unsafe
      })).toThrow();
    }
    expect(() => PiPackageInstallRequestSchema.parse({ ...request, version: "latest" })).toThrow();
  });

  it("keeps Pi package uninstall identity exact and failed results registry-free", () => {
    const registry = {
      apiVersion: 1,
      revision: 5,
      packages: []
    } as const;
    const request = {
      apiVersion: 1,
      requestId: "pi_package_uninstall_request_abcdefghijklmnop",
      expectedRegistryRevision: 4,
      packageId: "pkg_0123456789abcdef01234567"
    } as const;
    expect(PiPackageUninstallRequestSchema.parse(request)).toEqual(request);
    for (const status of ["removed", "stale", "not_found", "denied"] as const) {
      expect(PiPackageUninstallResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        status,
        registry
      })).toMatchObject({ status, registry });
    }
    const failed = {
      apiVersion: 1,
      requestId: request.requestId,
      packageId: request.packageId,
      status: "failed"
    } as const;
    expect(PiPackageUninstallResultSchema.parse(failed)).toEqual(failed);
    expect(() => PiPackageUninstallResultSchema.parse({ ...failed, registry })).toThrow();
    expect(() => PiPackageUninstallResultSchema.parse({ ...failed, path: "/private/package" })).toThrow();
    expect(() => PiPackageUninstallResultSchema.parse({ ...failed, packageId: "pkg_wrong" })).toThrow();
    expect(() => PiPackageUninstallResultSchema.parse({ ...failed, status: "removed" })).toThrow();
    expect(() => PiPackageUninstallRequestSchema.parse({
      ...request,
      requestId: "pi_package_request_abcdefghijklmnop"
    })).toThrow();
  });

  it("binds Pi package restore to one exact pathless trash projection", () => {
    const packageId = "pkg_0123456789abcdef01234567";
    const integrity = `sha512-${"A".repeat(86)}==`;
    const rollbackTarget = {
      rollbackId: "pi_package_rollback_abcdefghijklmnop",
      targetVersion: "1.0.0"
    } as const;
    const restorable = {
      restoreContextId: `pi_package_restore_context_v1_${"a".repeat(48)}`,
      packageId,
      packageName: "restorable-package",
      version: "1.2.3",
      integrity,
      packageTypes: ["extension"],
      dependencyCount: 0,
      pinned: true,
      rollbackTarget,
      uninstalledAt: "2026-07-30T00:00:00.000Z",
      canRestore: true
    } as const;
    const registry = { apiVersion: 1, revision: 7, packages: [], restorablePackages: [restorable] } as const;
    expect(PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry })).toEqual({ status: "ready", registry });
    const request = {
      apiVersion: 1,
      requestId: "pi_package_restore_request_abcdefghijklmnop",
      expectedRegistryRevision: 7,
      restoreContextId: restorable.restoreContextId,
      packageId,
      version: restorable.version,
      integrity,
      pinned: true,
      rollbackTarget
    } as const;
    expect(PiPackageRestoreRequestSchema.parse(request)).toEqual(request);
    for (const status of ["committed", "stale", "not_found", "ineligible"] as const) {
      expect(PiPackageRestoreResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        restoreContextId: request.restoreContextId,
        packageId,
        version: request.version,
        integrity,
        pinned: true,
        rollbackTarget,
        status,
        registry
      })).toMatchObject({ status, registry });
    }
    const { expectedRegistryRevision: _expectedRegistryRevision, ...identity } = request;
    const failed = { ...identity, status: "failed" as const };
    expect(PiPackageRestoreResultSchema.parse(failed)).toEqual(failed);
    expect(() => PiPackageRestoreResultSchema.parse({ ...failed, registry })).toThrow();
    expect(() => PiPackageRegistryQueryResultSchema.parse({
      status: "ready",
      registry: { ...registry, packages: [{
        packageId, packageName: restorable.packageName, version: restorable.version,
        state: "installed_disabled", packageTypes: ["extension"], dependencyCount: 0,
        enabled: false, canEnable: false, trust: "community", pinned: false, canUpdate: true,
        canRollback: false, rollbackTarget: null
      }] }
    })).toThrow();
    for (const unsafe of [{ path: "/private/trash" }, { body: "package code" }, { receipt: { private: true } }]) {
      expect(() => PiPackageRestoreRequestSchema.parse({ ...request, ...unsafe })).toThrow();
      expect(() => PiPackageRestoreResultSchema.parse({ ...failed, ...unsafe })).toThrow();
    }
  });

  it("freezes exact-version Pi package update and one-step rollback without runtime authority", () => {
    const packageId = "pkg_0123456789abcdef01234567";
    const targetIntegrity = `sha512-${"A".repeat(86)}==`;
    const rollbackId = "pi_package_rollback_abcdefghijklmnop";
    const registry = {
      apiVersion: 1,
      revision: 9,
      packages: [{
        packageId,
        packageName: "@narumitw/pi-btw",
        version: "0.35.0",
        state: "installed_disabled",
        packageTypes: ["extension"],
        dependencyCount: 0,
        enabled: false,
        canEnable: false,
        trust: "community",
        pinned: false,
        canUpdate: true,
        canRollback: true,
        rollbackTarget: { rollbackId, targetVersion: "0.34.0" }
      }]
    } as const;
    expect(PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry }))
      .toEqual({ status: "ready", registry });

    const updateRequest = {
      apiVersion: 1,
      requestId: "pi_package_update_request_abcdefghijklmnop",
      packageId,
      expectedRegistryRevision: 8,
      targetVersion: "0.35.0",
      targetIntegrity
    } as const;
    expect(PiPackageUpdateRequestSchema.parse(updateRequest)).toEqual(updateRequest);
    for (const status of ["committed", "denied", "stale", "not_found"] as const) {
      expect(PiPackageUpdateResultSchema.parse({
        apiVersion: 1,
        requestId: updateRequest.requestId,
        packageId,
        targetVersion: updateRequest.targetVersion,
        targetIntegrity,
        status,
        registry
      })).toMatchObject({ status, registry });
    }
    const updateFailed = {
      apiVersion: 1,
      requestId: updateRequest.requestId,
      packageId,
      targetVersion: updateRequest.targetVersion,
      targetIntegrity,
      status: "failed"
    } as const;
    expect(PiPackageUpdateResultSchema.parse(updateFailed)).toEqual(updateFailed);
    expect(() => PiPackageUpdateResultSchema.parse({ ...updateFailed, registry })).toThrow();

    const rollbackRequest = {
      apiVersion: 1,
      requestId: "pi_package_rollback_request_abcdefghijklmnop",
      packageId,
      expectedRegistryRevision: 9,
      rollbackId,
      targetVersion: "0.34.0"
    } as const;
    expect(PiPackageRollbackRequestSchema.parse(rollbackRequest)).toEqual(rollbackRequest);
    for (const status of ["committed", "denied", "stale", "not_found"] as const) {
      expect(PiPackageRollbackResultSchema.parse({
        apiVersion: 1,
        requestId: rollbackRequest.requestId,
        packageId,
        rollbackId,
        targetVersion: rollbackRequest.targetVersion,
        status,
        registry
      })).toMatchObject({ status, registry });
    }
    const rollbackFailed = {
      apiVersion: 1,
      requestId: rollbackRequest.requestId,
      packageId,
      rollbackId,
      targetVersion: rollbackRequest.targetVersion,
      status: "failed"
    } as const;
    expect(PiPackageRollbackResultSchema.parse(rollbackFailed)).toEqual(rollbackFailed);
    expect(() => PiPackageRollbackResultSchema.parse({ ...rollbackFailed, registry })).toThrow();

    expect(() => PiPackageRegistryQueryResultSchema.parse({
      status: "ready",
      registry: {
        ...registry,
        packages: [{ ...registry.packages[0], canRollback: false }]
      }
    })).toThrow();
    expect(() => PiPackageRegistryQueryResultSchema.parse({
      status: "ready",
      registry: {
        ...registry,
        packages: [{ ...registry.packages[0], canRollback: true, rollbackTarget: null }]
      }
    })).toThrow();
    expect(() => PiPackageUpdateRequestSchema.parse({ ...updateRequest, targetVersion: "latest" })).toThrow();
    expect(() => PiPackageUpdateRequestSchema.parse({ ...updateRequest, targetIntegrity: "sha512-private" })).toThrow();
    expect(() => PiPackageRollbackRequestSchema.parse({
      ...rollbackRequest,
      requestId: "pi_package_update_request_abcdefghijklmnop"
    })).toThrow();

    for (const unsafe of [
      { path: "/private/pi-packages/package" },
      { treeHash: "private-tree" },
      { receipt: { private: true } },
      { packageBody: "export default malicious" },
      { rawError: "private failure" },
      { enabled: true },
      { pin: true },
      { providerCredential: "secret" }
    ]) {
      expect(() => PiPackageUpdateRequestSchema.parse({ ...updateRequest, ...unsafe })).toThrow();
      expect(() => PiPackageRollbackRequestSchema.parse({ ...rollbackRequest, ...unsafe })).toThrow();
      expect(() => PiPackageUpdateResultSchema.parse({ ...updateFailed, ...unsafe })).toThrow();
      expect(() => PiPackageRollbackResultSchema.parse({ ...rollbackFailed, ...unsafe })).toThrow();
    }
  });

  it("freezes metadata-only Pi package pinning and fail-closed maintenance eligibility", () => {
    const packageId = "pkg_0123456789abcdef01234567";
    const pinnedRegistry = {
      apiVersion: 1,
      revision: 10,
      packages: [{
        packageId,
        packageName: "@narumitw/pi-btw",
        version: "0.35.0",
        state: "installed_disabled",
        packageTypes: ["extension"],
        dependencyCount: 0,
        enabled: false,
        canEnable: false,
        trust: "community",
        pinned: true,
        canUpdate: false,
        canRollback: false,
        rollbackTarget: null
      }]
    } as const;
    expect(PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry: pinnedRegistry }))
      .toEqual({ status: "ready", registry: pinnedRegistry });

    const request = {
      apiVersion: 1,
      requestId: "pi_package_pin_request_abcdefghijklmnop",
      packageId,
      expectedRegistryRevision: 9,
      pinned: true
    } as const;
    expect(PiPackageSetPinnedRequestSchema.parse(request)).toEqual(request);
    for (const status of ["committed", "stale", "not_found"] as const) {
      expect(PiPackageSetPinnedResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        packageId,
        pinned: request.pinned,
        status,
        registry: pinnedRegistry
      })).toMatchObject({ status, registry: pinnedRegistry });
    }
    const failed = {
      apiVersion: 1,
      requestId: request.requestId,
      packageId,
      pinned: request.pinned,
      status: "failed"
    } as const;
    expect(PiPackageSetPinnedResultSchema.parse(failed)).toEqual(failed);
    expect(() => PiPackageSetPinnedResultSchema.parse({ ...failed, registry: pinnedRegistry })).toThrow();
    expect(() => PiPackageSetPinnedResultSchema.parse({ ...failed, status: "denied" })).toThrow();

    expect(() => PiPackageRegistryQueryResultSchema.parse({
      status: "ready",
      registry: {
        ...pinnedRegistry,
        packages: [{ ...pinnedRegistry.packages[0], canUpdate: true }]
      }
    })).toThrow();
    expect(() => PiPackageRegistryQueryResultSchema.parse({
      status: "ready",
      registry: {
        ...pinnedRegistry,
        packages: [{
          ...pinnedRegistry.packages[0],
          canRollback: true,
          rollbackTarget: {
            rollbackId: "pi_package_rollback_abcdefghijklmnop",
            targetVersion: "0.34.0"
          }
        }]
      }
    })).toThrow();
    expect(() => PiPackageSetPinnedRequestSchema.parse({
      ...request,
      requestId: "pi_package_update_request_abcdefghijklmnop"
    })).toThrow();

    for (const unsafe of [
      { path: "/private/pi-packages/package" },
      { treeHash: "private-tree" },
      { packageBody: "export default malicious" },
      { rawError: "private failure" },
      { enabled: true },
      { runtime: "node" },
      { restorePath: "/private/trash" }
    ]) {
      expect(() => PiPackageSetPinnedRequestSchema.parse({ ...request, ...unsafe })).toThrow();
      expect(() => PiPackageSetPinnedResultSchema.parse({ ...failed, ...unsafe })).toThrow();
    }
  });

  it("freezes reviewed Pi package runtime enablement as an exact pathless CAS", () => {
    const request = { apiVersion: 1, requestId: "pi_package_enable_request_abcdefghijklmnop",
      packageId: "pkg_0123456789abcdef01234567", expectedRegistryRevision: 9, enabled: true } as const;
    const registry = { apiVersion: 1, revision: 10, packages: [{
      packageId: request.packageId, packageName: "@narumitw/pi-btw", version: "0.34.0",
      state: "installed_enabled", packageTypes: ["extension"], dependencyCount: 0,
      enabled: true, canEnable: true, trust: "community", pinned: false,
      canUpdate: false, canRollback: false, rollbackTarget: null
    }] } as const;
    expect(PiPackageSetEnabledRequestSchema.parse(request)).toEqual(request);
    const { expectedRegistryRevision: _revision, ...identity } = request;
    for (const status of ["committed", "stale", "not_found", "ineligible"] as const) {
      expect(PiPackageSetEnabledResultSchema.parse({ ...identity, status, registry })).toMatchObject({ status, registry });
    }
    expect(PiPackageSetEnabledResultSchema.parse({ ...identity, status: "failed" })).toEqual({ ...identity, status: "failed" });
    expect(() => PiPackageSetEnabledRequestSchema.parse({ ...request, path: "/private/package" })).toThrow();
    expect(() => PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry: {
      ...registry, packages: [{ ...registry.packages[0], canEnable: false }]
    } })).toThrow();
  });

  it("keeps the curated Pi package catalog deterministic, bounded, and renderer-safe", () => {
    const request = {
      apiVersion: 1,
      requestId: "pi_package_catalog_request_abcdefghijklmnop",
      query: "knowledge"
    } as const;
    const integrity = `sha512-${"A".repeat(86)}==`;
    const entries = ["alpha", "beta"].map((suffix, index) => ({
      catalogId: `pi_catalog_${suffix}`,
      packageName: `pi-${suffix}`,
      version: `1.0.${index}`,
      integrity,
      displayName: `Pi ${suffix}`,
      purpose: `Reviewed ${suffix} knowledge capability`,
      license: "MIT",
      packageTypes: ["skill"],
      capabilities: ["read_vault"],
      dataBoundaries: ["local"],
      trust: "curated",
      source: "npm"
    })) as const;
    expect(PiPackageCatalogQueryRequestSchema.parse(request)).toEqual(request);
    expect(PiPackageCatalogQueryRequestSchema.parse({ ...request, query: "" })).toMatchObject({ query: "" });
    expect(PiPackageCatalogQueryResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "ready",
      entries,
      total: entries.length
    })).toMatchObject({ status: "ready", entries, total: 2 });
    const failed = { apiVersion: 1, requestId: request.requestId, status: "failed" } as const;
    expect(PiPackageCatalogQueryResultSchema.parse(failed)).toEqual(failed);
    expect(() => PiPackageCatalogQueryResultSchema.parse({ ...failed, entries, total: 2 })).toThrow();
    expect(() => PiPackageCatalogQueryResultSchema.parse({
      apiVersion: 1, requestId: request.requestId, status: "ready", entries, total: 1
    })).toThrow();
    expect(() => PiPackageCatalogQueryResultSchema.parse({
      apiVersion: 1, requestId: request.requestId, status: "ready", entries: [...entries].reverse(), total: 2
    })).toThrow();
    for (const forbidden of [
      { url: "https://registry.npmjs.org/pi-alpha" }, { icon: "private" }, { rating: 5 },
      { rank: 1 }, { path: "/private/package" }, { body: "private" }
    ]) {
      expect(() => PiPackageCatalogQueryResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        entries: [{ ...entries[0], ...forbidden }],
        total: 1
      })).toThrow();
    }
    expect(() => PiPackageCatalogQueryRequestSchema.parse({ ...request, query: " knowledge " })).toThrow();
    expect(() => PiPackageCatalogQueryRequestSchema.parse({ ...request, query: "x".repeat(121) })).toThrow();
  });

  it("keeps reviewed task plans private and browser interactions renderer-safe", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const planId = "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const jobId = "job_20260727_abcdefgh";
    const summary = {
      planId,
      toolLabel: "Feishu CLI",
      resolvedVersion: "1.0.77",
      sourceOrigin: "https://registry.npmjs.org",
      integrities: [digest],
      stepCount: 6,
      destinationRoots: ["Pige managed tools", "Private Feishu config"],
      skillCount: 27,
      targetAgents: ["Codex", "Claude Code"],
      requiresBrowserOAuth: true
    } as const;
    expect(TaskExecutionPlanSummarySchema.parse(summary)).toEqual(summary);
    for (const unsafe of [
      { url: "https://accounts.feishu.cn/device" },
      { deviceCode: "PRIVATE-CODE" },
      { path: "/Users/private/.config" },
      { body: "PRIVATE OUTPUT" }
    ]) {
      expect(() => TaskExecutionPlanSummarySchema.parse({ ...summary, ...unsafe })).toThrow();
    }
    expect(() => TaskExecutionPlanSummarySchema.parse({
      ...summary,
      sourceOrigin: "https://registry.npmjs.org/package/path"
    })).toThrow();

    const confirmation = {
      apiVersion: 1,
      confirmationId: "confirm_20260727_abcdefghijklmnop",
      effect: "reviewed_execution_plan",
      presentation: {
        action: "execute_reviewed_plan",
        target: "local_toolchain",
        subject: { kind: "reviewed_execution_plan", value: "Feishu CLI", plan: summary }
      },
      owner: { kind: "agent_turn", clientTurnId: "turn_20260727_abcdefghijkl" }
    } as const;
    expect(HighRiskConfirmationSummarySchema.parse(confirmation)).toEqual(confirmation);
    expect(() => HighRiskConfirmationSummarySchema.parse({
      ...confirmation,
      presentation: {
        ...confirmation.presentation,
        subject: { ...confirmation.presentation.subject, argv: ["install", "secret"] }
      }
    })).toThrow();

    const permissionRequestId = "permreq_20260729_abcdefghijklmnop";
    const permissionDecisionId = "permdec_20260729_abcdefghijklmnop";
    const decision = {
      id: permissionDecisionId,
      schemaVersion: 1,
      permissionRequestId,
      confirmationId: confirmation.confirmationId,
      confirmationRevision: 7,
      bindingHash: digest,
      decision: "allow_once",
      scope: "once",
      decidedBy: "user",
      autoAllowedBy: "none",
      jobId,
      decidedAt: "2026-07-29T00:00:00.000Z"
    } as const;
    expect(PermissionDecisionRecordSchema.parse(decision)).toEqual(decision);
    expect(() => PermissionDecisionRecordSchema.parse({
      ...decision,
      decision: "allow_scoped",
      scope: "once"
    })).toThrow("scoped allow");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...decision,
      decidedBy: "system",
      autoAllowedBy: "none"
    })).toThrow("system allow");

    const permissionJob = JobRecordSchema.parse({
      id: jobId,
      class: "agent_turn",
      state: "waiting_permission",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
      permissionRequestIds: [permissionRequestId],
      permissionDecisionIds: [permissionDecisionId],
      message: "Waiting for one exact permission decision."
    });
    expect(permissionJob.permissionRequestIds).toEqual([permissionRequestId]);
    expect(permissionJob.permissionDecisionIds).toEqual([permissionDecisionId]);
    expect(() => JobRecordSchema.parse({
      ...permissionJob,
      permissionRequestIds: [permissionRequestId, permissionRequestId]
    })).toThrow("unique");

    const permissionOperation = OperationRecordSchema.parse({
      id: "op_20260729_permission1",
      schemaVersion: 1,
      jobId,
      createdAt: "2026-07-29T00:00:00.000Z",
      actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      permissionDecisionIds: [permissionDecisionId],
      kind: "repair_record",
      targetRefs: [],
      sourceRefs: [],
      summary: "Applied the exact authorized effect.",
      reversible: "no",
      warnings: []
    });
    expect(permissionOperation.permissionDecisionIds).toEqual([permissionDecisionId]);

    const plan = {
      planId,
      vaultId: "vault_20260709_abcdefgh",
      jobId,
      clientTurnId: "turn_20260727_abcdefghijkl",
      authoredTaskIntent: "explicit_user_task",
      policyHash: digest,
      toolCatalogHash: digest,
      recipeId: "official.feishu-cli.install-config-auth-status",
      recipeVersion: "1",
      recipeDigest: digest,
      actorId: "pige.task-execution",
      actorVersion: "1",
      actorDigest: digest,
      environment: {
        controlledHomeRoot: "/private/pige/home",
        configRoot: "/private/pige/config",
        sanitizedPathEntries: ["/private/pige/tools/bin"],
        descendantExecutableIdentities: ["/private/pige/tools/lark-cli"],
        canonicalWorkingDirectory: "/private/pige/task",
        temporaryDirectoryPolicy: "task_scoped",
        localeProfile: "en-US",
        npmRegistry: "https://registry.npmjs.org",
        npmPrefix: "/private/pige/npm-prefix",
        npmCache: "/private/pige/npm-cache",
        npmConfigProvenance: "/private/pige/npmrc",
        targetAgentRoots: ["/private/pige/agents/codex"],
        networkOrigins: ["https://registry.npmjs.org"],
        destinations: ["/private/pige/tools"],
        secretHandleVersions: { "feishu.oauth": "1" }
      },
      planDigest: digest,
      summary: { ...summary, stepCount: 1 },
      steps: [{
        ordinal: 1,
        adapterId: "pige.package-install",
        adapterVersion: "1",
        adapterDigest: digest,
        actionId: "install_cli_package",
        normalizedExecutableIdentity: "/private/pige/npm",
        argv: ["install", "@larksuite/cli@1.0.77"],
        canonicalWorkingDirectory: "/private/pige/task",
        environmentProfileHash: digest,
        networkOrigins: ["https://registry.npmjs.org"],
        destinations: ["/private/pige/tools"],
        interactionProtocol: "none",
        timeoutMs: 600_000,
        inputHash: digest,
        postconditionProbeId: "installed-cli-version",
        recoveryMode: "probe_then_adopt"
      }]
    } as const;
    expect(TaskExecutionPlanSchema.parse(plan)).toEqual(plan);
    expect(() => TaskExecutionPlanSchema.parse({
      ...plan,
      steps: [{ ...plan.steps[0], ordinal: 2 }]
    })).toThrow();

    const pending = {
      status: "browser_oauth",
      interactionId: "interaction_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      planId,
      jobId,
      stepOrdinal: 5,
      origin: "https://accounts.feishu.cn",
      revision: 3
    } as const;
    expect(TaskInteractionPendingResultSchema.parse(pending)).toEqual(pending);
    expect(TaskInteractionPendingResultSchema.parse({ status: "none" }))
      .toEqual({ status: "none" });
    for (const unsafe of [
      { url: "https://accounts.feishu.cn/device" },
      { deviceCode: "PRIVATE-CODE" },
      { path: "/private/config" },
      { body: "PRIVATE OUTPUT" }
    ]) {
      expect(() => TaskInteractionPendingResultSchema.parse({ ...pending, ...unsafe })).toThrow();
    }

    const openRequest = {
      interactionId: pending.interactionId,
      planId,
      jobId,
      stepOrdinal: 5,
      expectedRevision: 3
    } as const;
    expect(TaskInteractionOpenRequestSchema.parse(openRequest)).toEqual(openRequest);
    for (const status of ["opened", "stale", "not_found", "failed"] as const) {
      const result = status === "not_found" ? { status } : { status, revision: 3 };
      expect(TaskInteractionOpenResultSchema.parse(result)).toEqual(result);
    }
    expect(() => TaskInteractionOpenRequestSchema.parse({
      ...openRequest,
      url: "https://accounts.feishu.cn/device"
    })).toThrow();
  });

  it("keeps Backup reconnect identity strict and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "backupreconnectreq_abcdefgh",
      activeVaultId: "vault_20260709_abcdefgh",
      waitingJobId: "job_20260709_abcdefgh"
    } as const;
    expect(BackupReconnectDependencyRequestSchema.parse(request)).toEqual(request);
    expect(() => BackupReconnectDependencyRequestSchema.parse({ ...request, dependencyId: "root_private" }))
      .toThrow();
    for (const status of ["resolved", "cancelled", "stale", "not_found", "failed"] as const) {
      expect(BackupReconnectDependencyResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => BackupReconnectDependencyResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/source-root",
      error: { code: "raw" }
    })).toThrow();
  });

  it("keeps Backup destination reconnect currentness-bound and pathless", () => {
    const request = {
      apiVersion: 1,
      requestId: "backupdestinationreconnectreq_abcdefgh",
      activeVaultId: "vault_20260709_abcdefgh",
      waitingJobId: "job_20260709_abcdefgh",
      expectedJobUpdatedAt: "2026-07-30T01:02:03.000Z"
    } as const;
    expect(BackupReconnectDestinationRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["path", "absolutePath", "rootId", "sourceId", "body", "rawError"] as const) {
      expect(() => BackupReconnectDestinationRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }
    for (const status of [
      "reconnected",
      "cancelled",
      "stale",
      "not_found",
      "ineligible",
      "failed"
    ] as const) {
      expect(BackupReconnectDestinationResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    expect(() => BackupReconnectDestinationResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/backup-root",
      error: { code: "raw" }
    })).toThrow();
  });

  it("keeps explicit incomplete Backup continuation currentness-bound and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "backupcontinuereq_abcdefgh",
      activeVaultId: "vault_20260709_abcdefgh",
      waitingJobId: "job_20260709_abcdefgh",
      expectedJobUpdatedAt: "2026-07-29T01:02:03.000Z"
    } as const;
    expect(BackupContinueIncompleteRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["rootId", "sourceId", "sourcePath", "sourceBody", "rawError"] as const) {
      expect(() => BackupContinueIncompleteRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }
    for (const status of [
      "continued", "cancelled", "stale", "not_found", "ineligible", "failed"
    ] as const) {
      expect(BackupContinueIncompleteResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    expect(() => BackupContinueIncompleteResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/source-root",
      error: { code: "raw" }
    })).toThrow();
  });

  it("keeps in-flight Restore cancellation preview-bound and pathless", () => {
    expect(RESTORE_CANCEL_CHANNEL).toBe("restore.cancel");
    const request = {
      apiVersion: 1,
      requestId: "restorecancelreq_abcdefgh",
      previewId: `sha256:${"a".repeat(64)}`,
      mode: "clone_as_new"
    } as const;
    expect(RestoreCancelRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["path", "backupPath", "destinationPath", "jobId", "rawError"] as const) {
      expect(() => RestoreCancelRequestSchema.parse({ ...request, [privateField]: "private" })).toThrow();
    }
    for (const status of [
      "cancel_requested", "cancelled", "too_late", "stale", "not_found", "failed"
    ] as const) {
      expect(RestoreCancelResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => RestoreCancelResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/restore",
      error: { code: "raw" }
    })).toThrow();
  });

  it("keeps managed-copy root configuration pathless, currentness-bound, and fail-closed", () => {
    const summary = {
      activeVaultId: "vault_20260709_abcdefgh",
      sourceStorageRevision: `ssrev_${"a".repeat(64)}`,
      mode: "external_binding",
      availability: "available",
      canConfigure: true
    } as const;
    expect(ManagedCopyRootSummarySchema.parse(summary)).toEqual(summary);
    const request = {
      apiVersion: 1,
      requestId: "rootconfigreq_abcdefgh",
      activeVaultId: summary.activeVaultId,
      expectedSourceStorageRevision: summary.sourceStorageRevision
    } as const;
    expect(ManagedCopyRootConfigureRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["path", "absolutePath", "rootId", "sourceBody"] as const) {
      expect(() => ManagedCopyRootConfigureRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }
    for (const status of ["configured", "stale", "ineligible"] as const) {
      expect(ManagedCopyRootConfigureResultSchema.parse({ ...request, status, summary }))
        .toEqual({ ...request, status, summary });
    }
    for (const status of ["cancelled", "not_found", "failed"] as const) {
      expect(ManagedCopyRootConfigureResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    expect(() => ManagedCopyRootConfigureResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/managed-root"
    })).toThrow();
  });

  it("allows external managed-copy roots to project only safe non-path labels", () => {
    const summary = {
      vaultId: "vault_20260709_abcdefgh",
      name: "Knowledge",
      activeVaultPathDisplay: "/Users/example/Knowledge",
      knowledgeRootDisplay: "/Users/example/Knowledge",
      sourceAssetRootDisplay: "External managed-copy location",
      sourceAssetRootKind: "external_binding",
      managedCopyRoot: {
        activeVaultId: "vault_20260709_abcdefgh",
        sourceStorageRevision: `ssrev_${"b".repeat(64)}`,
        mode: "external_binding",
        availability: "available",
        canConfigure: true
      },
      defaultSourceStorageStrategy: "copy_to_source_library",
      schemaVersion: 2
    } as const;
    expect(VaultSummaryProjectionSchema.parse(summary)).toEqual(summary);
    expect(() => VaultSummaryProjectionSchema.parse({
      ...summary,
      sourceAssetRootDisplay: "/Volumes/Private/Sources"
    })).toThrow("safe label");
    expect(() => VaultSummaryProjectionSchema.parse({
      ...summary,
      managedCopyRoot: { ...summary.managedCopyRoot, activeVaultId: "vault_20260709_otherabc" }
    })).toThrow("identity");
  });

  it("keeps referenced-original reconnect currentness-bound, pathless, and authoritative", () => {
    const request = {
      apiVersion: 1,
      requestId: "sourcereconnectreq_abcdefgh",
      activeVaultId: "vault_20260709_abcdefgh",
      waitingJobId: "job_20260709_abcdefgh",
      expectedJobUpdatedAt: "2026-07-29T01:02:03.000Z"
    } as const;
    expect(ReferencedOriginalReconnectRequestSchema.parse(request)).toEqual(request);
    for (const privateField of ["path", "sourcePath", "rootId", "sourceBody", "sourceId"] as const) {
      expect(() => ReferencedOriginalReconnectRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }

    const job = {
      id: request.waitingJobId,
      class: "parse",
      state: "queued",
      stage: "parsing",
      sourceId: "src_20260709_abcdefgh",
      sourceDisplayName: "notes.txt",
      sourceKind: "plain_text_file",
      canReconnectDependency: false,
      message: "Source reconnected; processing is queued.",
      createdAt: "2026-07-29T01:00:00.000Z",
      updatedAt: "2026-07-29T01:03:00.000Z"
    } as const;
    const operationId = "op_20260729_sourcereconnect";
    expect(ReferencedOriginalReconnectResultSchema.parse({
      ...request, status: "reconnected", job, operationId, contentState: "current"
    })).toEqual({ ...request, status: "reconnected", job, operationId, contentState: "current" });
    for (const status of ["cancelled", "stale", "not_found", "mismatch", "failed"] as const) {
      expect(ReferencedOriginalReconnectResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    expect(() => ReferencedOriginalReconnectResultSchema.parse({
      ...request,
      status: "reconnected",
      job: { ...job, canReconnectDependency: true }
    })).toThrow();
    expect(() => ReferencedOriginalReconnectResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/original.txt",
      rawError: "private"
    })).toThrow();
  });

  it("keeps saved-source Reader navigation strict and body-free", () => {
    const request = {
      apiVersion: 1,
      requestId: "noteref_abcdefghijklmnop",
      activeVaultId: "vault_20260709_abcdefgh",
      currentPageId: "page_20260709_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260709_source1234"
    } as const;

    expect(NoteOpenSourceReferenceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteOpenSourceReferenceRequestSchema.parse({ ...request, path: "/private/note.md" })).toThrow();
    expect(NoteOpenSourceReferenceResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { pageId: "page_20260709_source1234" }
    })).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { pageId: "page_20260709_source1234" }
    });
    for (const status of ["unresolved", "not_found", "stale", "mismatch", "changed"] as const) {
      expect(NoteOpenSourceReferenceResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        status
      })).toEqual({ apiVersion: 1, requestId: request.requestId, status });
    }
    expect(() => NoteOpenSourceReferenceResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      status: "not_found",
      sourceRecord: { path: "/private/source.json" }
    })).toThrow();
  });

  it("keeps single-source Reader reveal currentness-bound and pathless", () => {
    const request = {
      apiVersion: 1,
      requestId: "notesourcereveal_abcdefghijklmnop",
      activeVaultId: "vault_20260729_abcdefgh",
      currentPageId: "page_20260729_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260729_source1234"
    } as const;

    expect(NoteRevealSourceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteRevealSourceRequestSchema.parse({
      ...request,
      path: "/private/original.pdf"
    })).toThrow();
    for (const status of [
      "revealed",
      "cancelled",
      "stale",
      "not_found",
      "unavailable",
      "failed"
    ] as const) {
      expect(NoteRevealSourceResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    expect(() => NoteRevealSourceResultSchema.parse({
      ...request,
      status: "failed",
      sourcePath: "/private/original.pdf",
      sourceBody: "private",
      rawError: "private"
    })).toThrow();
    expect(() => NoteRevealSourceResultSchema.parse({
      ...request,
      requestId: "noteref_abcdefghijklmnop",
      status: "revealed"
    })).toThrow();
  });

  it("keeps Reader original reconnect pathless and returns only an authoritative refreshed render", () => {
    const request = {
      apiVersion: 1,
      requestId: "notesourcereconnect_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      sourceId: "src_20260730_source1234",
      sourceKind: "pdf_file",
      sourceRevision: `sourcerev_${"a".repeat(64)}`,
      expectedAvailability: "unavailable",
      expectedChecksum: `sha256:${"b".repeat(64)}`,
      expectedSize: 123,
      formatIdentity: `sourcefmt_${"c".repeat(64)}`
    } as const;
    expect(NoteReconnectOriginalSourceRequestSchema.parse(request)).toEqual(request);
    expect(() => NoteReconnectOriginalSourceRequestSchema.parse({
      ...request,
      path: "/private/replacement.pdf"
    })).toThrow();
    for (const status of ["cancelled", "stale", "not_found", "ineligible", "mismatch", "failed"] as const) {
      expect(NoteReconnectOriginalSourceResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    const render = {
      summary: {
        pageId: request.currentPageId,
        title: "Current",
        pageType: "note",
        status: "active",
        pagePath: "wiki/current.md",
        createdAt: "2026-07-30T08:00:00.000Z",
        updatedAt: "2026-07-30T08:00:00.000Z",
        sourceIds: [request.sourceId]
      },
      html: "<p>Current</p>",
      byteSize: 7,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      reconnectOriginalSourceIds: []
    } as const;
    expect(NoteReconnectOriginalSourceResultSchema.parse({
      ...request,
      status: "reconnected",
      render,
      operationId: "op_20260730_readerreconnect",
      contentState: "current",
      resumedJobCount: 1
    })).toMatchObject({ status: "reconnected", contentState: "current", render: { reconnectOriginalSourceIds: [] } });
    expect(() => NoteReconnectOriginalSourceResultSchema.parse({
      ...request,
      status: "failed",
      path: "/private/replacement.pdf"
    })).toThrow();

    const listRequest = {
      apiVersion: 1,
      requestId: "sourcereconnectlist_abcdefghijklmnop",
      activeVaultId: request.activeVaultId
    } as const;
    const safeCandidate = {
      sourceId: request.sourceId,
      sourceKind: request.sourceKind,
      sourceRevision: request.sourceRevision,
      expectedAvailability: request.expectedAvailability,
      expectedChecksum: request.expectedChecksum,
      expectedSize: request.expectedSize,
      formatIdentity: request.formatIdentity,
      displayName: "Missing PDF"
    };
    expect(SourceReconnectListRequestSchema.parse(listRequest)).toEqual(listRequest);
    expect(SourceReconnectListResultSchema.parse({
      ...listRequest, status: "ready", sources: [safeCandidate], truncated: false
    })).toMatchObject({ status: "ready", sources: [{ sourceId: request.sourceId }] });
    const direct = {
      apiVersion: 1,
      requestId: "sourcereconnectdirect_abcdefghijklmnop",
      activeVaultId: request.activeVaultId,
      sourceId: request.sourceId,
      sourceKind: request.sourceKind,
      sourceRevision: request.sourceRevision,
      expectedAvailability: request.expectedAvailability,
      expectedChecksum: request.expectedChecksum,
      expectedSize: request.expectedSize,
      formatIdentity: request.formatIdentity
    } as const;
    expect(SourceReconnectRequestSchema.parse(direct)).toEqual(direct);
    expect(SourceReconnectResultSchema.parse({
      ...direct, status: "reconnected", operationId: "op_20260730_directreconnect",
      contentState: "current", resumedJobCount: 2
    })).toMatchObject({ status: "reconnected", contentState: "current", resumedJobCount: 2 });
    for (const privateField of ["path", "body", "rawError"] as const) {
      expect(() => SourceReconnectRequestSchema.parse({ ...direct, [privateField]: "private" })).toThrow();
      expect(() => SourceReconnectResultSchema.parse({ ...direct, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps note merge identity-bound and renderer path/body free", () => {
    const request = {
      apiVersion: 1,
      requestId: "notemergereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`,
      targetPageId: "page_20260730_target12345",
      expectedTargetUpdatedAt: "2026-07-30T08:00:00.000Z"
    } as const;
    expect(NoteMergeRequestSchema.parse(request)).toEqual(request);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteMergeResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => NoteMergeRequestSchema.parse({ ...request, targetPageId: request.currentPageId })).toThrow();
    expect(() => NoteMergeResultSchema.parse({ ...request, status: "failed", path: "/private/note.md" })).toThrow();
    expect(() => NoteMergeResultSchema.parse({ ...request, status: "failed", markdown: "private body" })).toThrow();
  });

  it("keeps current-note archive revision-bound and path/body-free", () => {
    const identity = {
      apiVersion: 1,
      requestId: "notearchivereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    } as const;
    expect(NoteArchiveCurrentRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteArchiveCurrentResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    for (const privateField of ["pagePath", "markdown", "contentHash", "sourceId", "rawError"] as const) {
      expect(() => NoteArchiveCurrentRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteArchiveCurrentResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps archived-note restore revision-bound and path/body-free", () => {
    const identity = {
      apiVersion: 1,
      requestId: "noterestorereq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    } as const;
    expect(NoteRestoreArchivedRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteRestoreArchivedResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    for (const privateField of ["pagePath", "markdown", "contentHash", "sourceId", "rawError"] as const) {
      expect(() => NoteRestoreArchivedRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteRestoreArchivedResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps note tag addition revision-bound and path/body-free", () => {
    expect(NOTE_ADD_TAG_CHANNEL).toBe("notes.addTag");
    const identity = {
      apiVersion: 1,
      requestId: "noteaddtagreq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      tag: "Research note"
    } as const;
    expect(NoteAddTagRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteAddTagResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    expect(() => NoteAddTagRequestSchema.parse({ ...identity, tag: " Research note " })).toThrow();
    for (const privateField of ["pagePath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteAddTagResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps bounded note tag/topic correction revision-bound and path/body-free", () => {
    expect(NOTE_EDIT_TAXONOMY_CHANNEL).toBe("notes.editTaxonomy");
    const identity = { apiVersion: 1, requestId: "notetaxonomyreq_abcdefghijklmnop",
      activeVaultId: "vault_20260731_abcdefgh", currentPageId: "page_20260731_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef", expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      tags: ["Research", "Reading"], topics: ["Knowledge management"] } as const;
    expect(NoteEditTaxonomyRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteEditTaxonomyResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    expect(() => NoteEditTaxonomyRequestSchema.parse({ ...identity, tags: ["Research", "research"] })).toThrow();
    expect(() => NoteEditTaxonomyRequestSchema.parse({ ...identity, topics: Array.from({ length: 9 }, (_, index) => `Topic ${index}`) })).toThrow();
    for (const privateField of ["pagePath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteEditTaxonomyRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
    }
  });

  it("keeps exact Reader tag removal revision-bound and path/body-free", () => {
    expect(NOTE_REMOVE_TAG_CHANNEL).toBe("notes.removeTag");
    const identity = { apiVersion: 1, requestId: "noteremovetagreq_abcdefghijklmnop",
      activeVaultId: "vault_20260731_abcdefgh", currentPageId: "page_20260731_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef", expectedRevision: `noteeditrev_${"a".repeat(32)}`,
      tag: "Research note" } as const;
    expect(NoteRemoveTagRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteRemoveTagResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    expect(() => NoteRemoveTagRequestSchema.parse({ ...identity, tag: " Research note " })).toThrow();
    for (const privateField of ["pagePath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteRemoveTagRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteRemoveTagResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps note rename revision-bound, canonical, and renderer-path-free", () => {
    expect(NOTE_RENAME_CHANNEL).toBe("notes.rename");
    const identity = { apiVersion: 1, requestId: "noterenamereq_abcdefghijklmnop",
      activeVaultId: "vault_20260731_rename01", currentPageId: "page_20260731_rename123456",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`, title: "Renamed Note" } as const;
    expect(NoteRenameRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["stale", "not_found", "ineligible", "conflict", "failed"] as const) {
      expect(NoteRenameResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    for (const title of [" Renamed Note ", "", "bad\nname", "x".repeat(121)]) {
      expect(() => NoteRenameRequestSchema.parse({ ...identity, title })).toThrow();
    }
    for (const privateField of ["pagePath", "oldPath", "newPath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteRenameRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteRenameResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps one note alias change canonical, revision-bound, and renderer-path-free", () => {
    expect(NOTE_CHANGE_ALIAS_CHANNEL).toBe("notes.changeAlias");
    const identity = { apiVersion: 1, requestId: "notealiasreq_abcdefghijklmnop",
      activeVaultId: "vault_20260731_aliases01", currentPageId: "page_20260731_aliases1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`, action: "add", alias: "Second Name" } as const;
    expect(NoteAliasChangeRequestSchema.parse(identity)).toEqual(identity);
    for (const action of ["add", "remove"] as const) for (const status of ["stale", "not_found", "ineligible", "conflict", "failed"] as const) {
      expect(NoteAliasChangeResultSchema.parse({ ...identity, action, status })).toEqual({ ...identity, action, status });
    }
    for (const alias of [" Second Name ", "", "bad\nname", "x".repeat(121), "bad\u202ename"]) {
      expect(() => NoteAliasChangeRequestSchema.parse({ ...identity, alias })).toThrow();
    }
    for (const privateField of ["pagePath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteAliasChangeRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteAliasChangeResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps generated-note reveal revision-bound and renderer-path-free", () => {
    const identity = {
      apiVersion: 1 as const,
      requestId: "notegeneratedreveal_abcdefghijklmnop",
      activeVaultId: "vault_20260801_abcdefgh",
      currentPageId: "page_20260801_generated1",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: `noteeditrev_${"b".repeat(64)}`
    };
    expect(NoteRevealGeneratedRequestSchema.parse(identity)).toEqual(identity);
    for (const status of ["revealed", "stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteRevealGeneratedResultSchema.parse({ ...identity, status })).toEqual({ ...identity, status });
    }
    for (const privateField of ["path", "pagePath", "markdown", "contentHash", "rawError"] as const) {
      expect(() => NoteRevealGeneratedRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
      expect(() => NoteRevealGeneratedResultSchema.parse({ ...identity, status: "failed", [privateField]: "private" })).toThrow();
    }
  });

  it("keeps current-note trash revision-bound, pathless, and Activity-restorable", () => {
    const identity = {
      apiVersion: 1,
      requestId: "notetrashreq_abcdefghijklmnop",
      activeVaultId: "vault_20260730_abcdefgh",
      currentPageId: "page_20260730_current1234",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(32)}`
    } as const;
    expect(NoteTrashCurrentRequestSchema.parse(identity)).toEqual(identity);
    for (const privateField of ["pagePath", "trashPath", "markdown", "contentHash", "sourceId"] as const) {
      expect(() => NoteTrashCurrentRequestSchema.parse({ ...identity, [privateField]: "private" })).toThrow();
    }

    const committed = {
      ...identity,
      status: "committed",
      operationId: "op_20260730_notetrash1",
      authority: {
        pageId: identity.currentPageId,
        pageState: "trashed",
        readerState: "closed",
        libraryPresence: "absent",
        canTrash: false
      }
    } as const;
    expect(NoteTrashCurrentResultSchema.parse(committed)).toEqual(committed);
    expect(NoteTrashCurrentResultSchema.parse({
      ...identity,
      status: "stale",
      authority: {
        pageId: identity.currentPageId,
        pageState: "present",
        readerState: "refresh_required",
        libraryPresence: "present",
        canTrash: false
      }
    })).toMatchObject({ status: "stale", authority: { readerState: "refresh_required" } });
    expect(NoteTrashCurrentResultSchema.parse({
      ...identity,
      status: "not_found",
      authority: {
        pageId: identity.currentPageId,
        pageState: "missing",
        readerState: "closed",
        libraryPresence: "absent",
        canTrash: false
      }
    })).toMatchObject({ status: "not_found", authority: { pageState: "missing" } });
    expect(NoteTrashCurrentResultSchema.parse({
      ...identity,
      status: "ineligible",
      authority: {
        pageId: identity.currentPageId,
        pageState: "present",
        readerState: "preserved",
        libraryPresence: "present",
        canTrash: false
      }
    })).toMatchObject({ status: "ineligible", authority: { readerState: "preserved" } });
    expect(NoteTrashCurrentResultSchema.parse({ ...identity, status: "failed" }))
      .toEqual({ ...identity, status: "failed" });
    expect(() => NoteTrashCurrentResultSchema.parse({
      ...committed,
      authority: { ...committed.authority, pageId: "page_20260730_other12345" }
    })).toThrow();
    expect(() => NoteTrashCurrentResultSchema.parse({
      ...identity,
      status: "failed",
      path: "/private/trash/page.md",
      body: "private",
      rawError: "private"
    })).toThrow();

    const render = {
      summary: {
        pageId: identity.currentPageId,
        title: "Current note",
        pageType: "note",
        status: "active",
        pagePath: "notes/current-note.md",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:01:00.000Z",
        sourceIds: []
      },
      html: "<p>Current note</p>",
      byteSize: 12,
      renderContextId: identity.renderContextId,
      trashEligibility: { canTrash: true, revision: identity.expectedRevision }
    } as const;
    expect(NoteRenderResultSchema.parse(render).trashEligibility)
      .toEqual({ canTrash: true, revision: identity.expectedRevision });
    const searchMatchRequest = {
      apiVersion: 1 as const,
      requestId: "notesearch_20260801contract",
      activeVaultId: identity.activeVaultId,
      pageId: identity.currentPageId,
      query: "current note"
    };
    expect(NoteOpenSearchMatchRequestSchema.parse(searchMatchRequest)).toEqual(searchMatchRequest);
    expect(NoteOpenSearchMatchResultSchema.parse({
      apiVersion: 1,
      requestId: searchMatchRequest.requestId,
      activeVaultId: searchMatchRequest.activeVaultId,
      pageId: searchMatchRequest.pageId,
      status: "ready",
      render,
      focusSegmentId: "readerseg_0000000000000001"
    })).toMatchObject({ status: "ready", focusSegmentId: "readerseg_0000000000000001" });
    expect(() => NoteOpenSearchMatchRequestSchema.parse({
      ...searchMatchRequest,
      query: "x",
      path: "/private/note.md"
    })).toThrow();
    expect(NoteRenderResultSchema.parse({
      ...render,
      refreshableSourceIds: ["src_20260730_note1234"],
      sourceMetadata: {
        items: [{ sourceId: "src_20260730_note1234", status: "current", displayName: "receipt.png",
          category: "image", storage: "managed_copy", extraction: "ocr" }],
        remainingCount: 0
      }
    })).toMatchObject({
      refreshableSourceIds: ["src_20260730_note1234"],
      sourceMetadata: { items: [{ displayName: "receipt.png", category: "image" }] }
    });
    for (const displayName of [
      "/private/receipt.png",
      "postgres:alice:hunter2@db.internal",
      "safe-name\u202eexe.txt"
    ]) {
      expect(() => NoteRenderResultSchema.parse({
        ...render,
        sourceMetadata: {
          items: [{ sourceId: "src_20260730_note1234", status: "current", displayName,
            category: "image", storage: "managed_copy", extraction: "ocr" }],
          remainingCount: 0
        }
      })).toThrow();
    }
    expect(() => NoteRenderResultSchema.parse({
      ...render,
      trashEligibility: { ...render.trashEligibility, path: "/private/note.md" }
    })).toThrow();
    const trashListRequest = { apiVersion: 1 as const, requestId: "notetrashlistreq_abcdefghijklmnop",
      activeVaultId: identity.activeVaultId };
    const trashSummary = { trashOperationId: committed.operationId,
      expectedTrashRevision: `notetrashrev_${"b".repeat(64)}` as const, pageId: identity.currentPageId,
      title: "Current note", trashedAt: "2026-07-30T10:02:00.000Z", canRestore: true as const };
    expect(NoteTrashListRequestSchema.parse(trashListRequest)).toEqual(trashListRequest);
    expect(NoteTrashListResultSchema.parse({ ...trashListRequest, status: "ready", notes: [trashSummary] }))
      .toMatchObject({ status: "ready", notes: [{ pageId: identity.currentPageId }] });
    const restoreRequest = { apiVersion: 1 as const, requestId: "notetrashrestorereq_abcdefghijklmnop",
      activeVaultId: identity.activeVaultId, pageId: identity.currentPageId,
      trashOperationId: trashSummary.trashOperationId, expectedTrashRevision: trashSummary.expectedTrashRevision };
    expect(NoteTrashRestoreRequestSchema.parse(restoreRequest)).toEqual(restoreRequest);
    expect(NoteTrashRestoreResultSchema.parse({ ...restoreRequest, status: "committed",
      operationId: "op_20260730_restorenote1234", render })).toMatchObject({ status: "committed" });
    expect(() => NoteTrashRestoreRequestSchema.parse({ ...restoreRequest, trashPath: "/private/trash.md" })).toThrow();
    expect(KnowledgeActivitySummarySchema.parse({
      operationId: committed.operationId,
      kind: "trash_page",
      createdAt: "2026-07-30T10:02:00.000Z",
      targetLabel: "Current note",
      target: { kind: "page", pageId: identity.currentPageId },
      status: "applied",
      canUndo: true
    })).toMatchObject({ kind: "trash_page", canUndo: true });
  });

  it("keeps concept hierarchy search and mutation renderer-safe and revision-fenced", () => {
    const identity = { apiVersion: 1 as const, requestId: "conceptparentreq_abcdefghijklmnop",
      activeVaultId: "vault_20260801_concepts", currentPageId: "page_20260801_concept01",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}` };
    const item = { pageId: "page_20260801_concept02", title: "Broader concept",
      updatedAt: "2026-08-01T11:00:00.000Z" };
    const search = { ...identity, query: "broader" };
    expect(NoteSearchConceptParentsRequestSchema.parse(search)).toEqual(search);
    expect(NoteSearchConceptParentsResultSchema.parse({ ...search, status: "ready", candidates: [item] }))
      .toMatchObject({ status: "ready", candidates: [item] });
    const add = { ...identity, action: "add" as const, targetPageId: item.pageId,
      expectedTargetUpdatedAt: item.updatedAt };
    expect(NoteChangeConceptParentRequestSchema.parse(add)).toEqual(add);
    expect(() => NoteChangeConceptParentRequestSchema.parse({ ...add, localPath: "/private/concept.md" })).toThrow();
    expect(() => NoteChangeConceptParentRequestSchema.parse({ ...add, expectedTargetUpdatedAt: undefined })).toThrow();
    expect(() => NoteChangeConceptParentRequestSchema.parse({ ...add, action: "remove" })).toThrow();
    expect(NoteChangeConceptParentResultSchema.parse({ ...add, status: "stale" })).toMatchObject({ status: "stale" });
  });

  it("keeps Markdown editor identity revision-fenced and drafts exact", () => {
    const identity = {
      apiVersion: 1,
      requestId: "noteeditreq_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh",
      pageId: "page_20260727_editor1234"
    } as const;
    const renderContextId = "notectx_0123456789abcdef0123456789abcdef";
    const revision = `noteeditrev_${"a".repeat(32)}`;
    const markdown = "---\nid: page_20260727_editor1234\ntitle: Exact draft\ntype: note\n---\n\n  First line  \nSecond line\n";
    const openRequest = { ...identity, renderContextId } as const;
    const ready = {
      ...identity,
      status: "ready",
      renderContextId,
      revision,
      markdown
    } as const;

    expect(NoteEditorOpenRequestSchema.parse(openRequest)).toEqual(openRequest);
    expect(NoteEditorOpenResultSchema.parse(ready)).toEqual(ready);
    expect(NoteEditorPortableMarkdownSchema.parse(markdown)).toBe(markdown);
    expect(() => NoteEditorOpenRequestSchema.parse({ ...openRequest, path: "/private/note.md" })).toThrow();

    const saveRequest = {
      ...identity,
      renderContextId,
      expectedRevision: revision,
      markdown
    } as const;
    expect(NoteEditorSaveRequestSchema.parse(saveRequest)).toEqual(saveRequest);
    expect(NoteEditorSaveResultSchema.parse({
      ...identity,
      status: "committed",
      revision: `noteeditrev_${"b".repeat(32)}`,
      operationId: "op_20260727_editor1234",
      render: {
        summary: {
          pageId: identity.pageId,
          title: "Exact draft",
          pageType: "note",
          status: "active",
          pagePath: "notes/exact-draft.md",
          createdAt: "2026-07-27T10:00:00.000Z",
          updatedAt: "2026-07-27T10:01:00.000Z",
          language: "en",
          sourceIds: []
        },
        renderContextId: "notectx_fedcba9876543210fedcba9876543210",
        html: "<h1>Exact draft</h1>",
        byteSize: 20
      }
    })).toMatchObject({ status: "committed", operationId: "op_20260727_editor1234" });
    expect(NoteEditorSaveResultSchema.parse({
      ...identity,
      status: "stale",
      revision: `noteeditrev_${"c".repeat(32)}`
    })).toEqual({ ...identity, status: "stale", revision: `noteeditrev_${"c".repeat(32)}` });
    for (const reason of [
      "markdown_too_large",
      "invalid_frontmatter",
      "page_id_changed",
      "unsupported_page_type",
      "invalid_wiki_link",
      "invalid_citation"
    ] as const) {
      expect(NoteEditorSaveResultSchema.parse({ ...identity, status: "invalid", reason }))
        .toEqual({ ...identity, status: "invalid", reason });
    }
    for (const unsafe of [
      { path: "/private/note.md" },
      { hash: `sha256:${"d".repeat(64)}` },
      { error: { code: "raw_fs_error" } }
    ]) {
      expect(() => NoteEditorSaveResultSchema.parse({ ...identity, status: "failed", ...unsafe })).toThrow();
    }
    expect(() => NoteEditorPortableMarkdownSchema.parse(
      "😀".repeat(Math.floor(NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES / 4) + 1)
    )).toThrow();
  });

  it("keeps vault Memory lifecycle CAS-bound, reversible, and pathless", () => {
    const identity = {
      apiVersion: 1,
      requestId: "memory_request_abcdefghijklmnop",
      activeVaultId: "vault_20260727_abcdefgh"
    } as const;
    const recordRequest = {
      ...identity,
      memoryId: "memory_20260727_abcdefghijkl",
      expectedRevision: 7
    } as const;
    const summary = {
      apiVersion: 1,
      activeVaultId: identity.activeVaultId,
      revision: 8,
      records: [{
        id: recordRequest.memoryId,
        kind: "preference",
        title: "Concise replies",
        body: "Prefer concise replies.",
        status: "active",
        provenance: { kind: "explicit_user_request", occurredAt: "2026-07-27T10:00:00.000Z" },
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:01:00.000Z"
      }]
    } as const;
    expect(MemorySummarySchema.parse({
      ...summary,
      records: summary.records.map((record) => ({
        ...record,
        kind: "correction" as const,
        provenance: { ...record.provenance, kind: "authored_user_statement" as const }
      }))
    })).toMatchObject({ records: [{ kind: "correction", provenance: { kind: "authored_user_statement" } }] });
    expect(KnowledgeActivitySummarySchema.parse({
      operationId: "op_20260727_memorycreate01",
      kind: "create_memory",
      createdAt: "2026-07-27T10:00:00.000Z",
      target: { kind: "memory", memoryId: recordRequest.memoryId },
      status: "applied",
      canUndo: true
    })).toMatchObject({ kind: "create_memory", canUndo: true });

    expect(MemoryEnableRequestSchema.parse(recordRequest)).toEqual(recordRequest);
    expect(MemoryDeleteRequestSchema.parse(recordRequest)).toEqual(recordRequest);
    const editRequest = {
      ...recordRequest,
      title: "Concise answers",
      body: "Prefer concise, direct answers."
    } as const;
    expect(MemoryEditRequestSchema.parse(editRequest)).toEqual(editRequest);
    expect(() => MemoryEditRequestSchema.parse({ ...editRequest, body: "" })).toThrow();
    expect(() => MemoryEditRequestSchema.parse({ ...editRequest, path: "/private/memory.json" })).toThrow();
    const resetRequest = { ...identity, expectedRevision: 7 } as const;
    expect(MemoryResetRequestSchema.parse(resetRequest)).toEqual(resetRequest);
    expect(MemoryLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260727_memory01",
      summary
    })).toMatchObject({ status: "committed", operationId: "op_20260727_memory01" });
    for (const status of ["stale", "not_found"] as const) {
      expect(MemoryLifecycleMutationResultSchema.parse({ ...identity, status, summary }))
        .toEqual({ ...identity, status, summary });
    }
    expect(() => MemoryDeleteRequestSchema.parse({ ...recordRequest, path: "/private/memory.json" })).toThrow();
    expect(() => MemoryLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      operationId: "op_20260727_memory01",
      summary,
      sourceEventId: "evt_private"
    })).toThrow();

    expect(MemoryExportRequestSchema.parse(resetRequest)).toEqual(resetRequest);
    for (const status of ["exported", "cancelled", "stale", "failed"] as const) {
      const result = { ...identity, revision: 7, status } as const;
      expect(MemoryExportResultSchema.parse(result)).toEqual(result);
    }
    expect(() => MemoryExportResultSchema.parse({
      ...identity,
      revision: 7,
      status: "exported",
      path: "/private/export.json",
      conversationId: "conversation_private",
      records: summary.records
    })).toThrow();
  });

  it("accepts only the bounded Reader transform input presentation", () => {
    const event = {
      schemaVersion: 1,
      id: "evt_20260718_transformpresentation",
      conversationId: "conv_20260718_transform",
      type: "user_message",
      createdAt: "2026-07-18T12:00:00.000Z",
      text: "HOST_EXECUTION_INSTRUCTION",
      inputPresentation: {
        kind: "reader_selection_transform",
        action: "shorten"
      }
    };

    expect(ConversationEventSchema.parse(event).inputPresentation).toEqual({
      kind: "reader_selection_transform",
      action: "shorten"
    });
    expect(() => ConversationEventSchema.parse({
      ...event,
      inputPresentation: {
        ...event.inputPresentation,
        selectedText: "PRIVATE_SELECTION"
      }
    })).toThrow();
    expect(() => ConversationEventSchema.parse({
      ...event,
      inputPresentation: {
        kind: "reader_selection_transform",
        action: "rewrite"
      }
    })).toThrow();
  });

  it("validates the renderer-safe resident pane layout boundary", () => {
    expect(
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true
      })
    ).toEqual({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: true,
      noteAgentOpen: true
    });
    expect(() =>
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "home",
        sidebarOpen: false,
        noteAgentOpen: true
      })
    ).toThrow();
    expect(() =>
      WindowLayoutRequestSchema.parse({
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: false,
        width: 1240
      })
    ).toThrow();

    expect(
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 4,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true,
        sidebarPresentation: "resident",
        noteAgentPresentation: "overlay",
        autoExpanded: true,
        isMaximized: false,
        isFullScreen: false
      })
    ).toMatchObject({ revision: 4, sidebarPresentation: "resident", noteAgentPresentation: "overlay" });
    expect(() =>
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 4,
        surface: "reader",
        sidebarOpen: false,
        noteAgentOpen: false,
        sidebarPresentation: "resident",
        noteAgentPresentation: "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      })
    ).toThrow();
    expect(() =>
      WindowLayoutStateSchema.parse({
        apiVersion: 1,
        revision: 5,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true,
        sidebarPresentation: "overlay",
        noteAgentPresentation: "resident",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      })
    ).toThrow();
  });

  it("validates requirement IDs", () => {
    expect(RequirementIdSchema.parse("PIGE-REPO-004")).toBe("PIGE-REPO-004");
  });

  it("validates Markdown page type and status values", () => {
    expect(MarkdownPageTypeSchema.parse("source")).toBe("source");
    expect(MarkdownPageStatusSchema.parse("needs_review")).toBe("needs_review");
  });

  it("validates empty fixture manifests", () => {
    expect(FixtureManifestSchema.parse({ schemaVersion: 1, fixtures: [] })).toEqual({
      schemaVersion: 1,
      fixtures: []
    });
  });

  it("validates vault manifest and config files", () => {
    expect(
      VaultManifestSchema.parse({
        vault_id: "vault_20260709_ab12cd",
        vault_schema_version: 1,
        created_at: "2026-07-09T00:00:00.000Z",
        updated_at: "2026-07-09T00:00:00.000Z",
        app_min_version: "0.1.0",
        default_locale: "zh-Hans",
        durable_roots: ["raw", ".pige/conversations"],
        rebuildable_roots: [".pige/db"]
      }).vault_id
    ).toBe("vault_20260709_ab12cd");

    expect(
      VaultConfigSchema.parse({
        schemaVersion: 1,
        sourceStorage: {
          defaultStrategy: "copy_to_source_library",
          sourceAssetRootKind: "inside_vault",
          inVaultSourceAssetRoot: "raw"
        },
        backup: {
          includeConversations: true,
          includeVaultMemory: true,
          includeTrash: true
        },
        memory: {
          vaultMemoryEnabled: true
        }
      }).sourceStorage.defaultStrategy
    ).toBe("copy_to_source_library");
  });

  it("freezes canonical BCP-47-or-unknown durable language truth", () => {
    expect(Bcp47LanguageTagSchema.parse("zh-Hans")).toBe("zh-Hans");
    expect(DurableLanguageSchema.parse("unknown")).toBe("unknown");
    expect(DurableLanguageFactSchema.parse({
      domain: "source_record",
      language: "en-US",
      basis: "explicit_source"
    })).toEqual({ domain: "source_record", language: "en-US", basis: "explicit_source" });
    expect(DurableLanguageFactSchema.parse({
      domain: "chunk",
      language: "unknown",
      basis: "legacy_missing"
    }).language).toBe("unknown");
    for (const invalid of ["EN", "en_us", "not a language"]) {
      expect(() => Bcp47LanguageTagSchema.parse(invalid)).toThrow();
    }
    expect(() => DurableLanguageFactSchema.parse({
      domain: "memory",
      language: "unknown",
      basis: "memory_derived"
    })).toThrow();
    expect(() => DurableLanguageFactSchema.parse({
      domain: "response",
      language: "de",
      basis: "unavailable"
    })).toThrow();
    expect(ConversationLanguageContinuitySchema.parse({
      queryLanguage: { domain: "query", language: "ja", basis: "query_detected" },
      responseLanguage: { domain: "response", language: "ja", basis: "response_policy" }
    }).responseLanguage.language).toBe("ja");
  });

  it("distinguishes legacy, current, newer, and invalid vault manifests", () => {
    const base = {
      vault_id: "vault_20260709_ab12cd",
      created_at: "2026-07-09T00:00:00.000Z",
      updated_at: "2026-07-09T00:00:00.000Z",
      app_min_version: "0.1.0",
      default_locale: "zh-Hans" as const,
      durable_roots: ["raw", ".pige/conversations"],
      rebuildable_roots: [".pige/db"],
      future_owner_field: { retained: true }
    };
    const domainVersions = {
      markdownPages: 2,
      sourceRecords: 2,
      ocrArtifacts: 2,
      conversationEvents: 2,
      memory: 2,
      datasets: 1,
      jobs: 1,
      proposals: 1,
      operations: 1,
      skills: 1,
      vaultConfig: 1
    } as const;
    expect(VaultManifestSchema.parse({ ...base, vault_schema_version: 1 }).future_owner_field)
      .toEqual({ retained: true });
    expect(() => CurrentVaultManifestSchema.parse({ ...base, vault_schema_version: 1 })).toThrow();
    expect(CurrentVaultManifestSchema.parse({
      ...base,
      vault_schema_version: 2,
      durable_domain_versions: domainVersions
    }).future_owner_field).toEqual({ retained: true });
    expect(VaultManifestCompatibilityHeaderSchema.parse({
      vault_id: base.vault_id,
      vault_schema_version: 3,
      unknown_future_field: true
    }).vault_schema_version).toBe(3);
    expect(() => VaultManifestSchema.parse({ ...base, vault_schema_version: 3 })).toThrow();
  });

  it("freezes one body-free v1-to-v2 migration preview and apply lifecycle", () => {
    const affectedDomains = [
      "vault_manifest",
      "source_records",
      "markdown_pages",
      "ocr_artifacts",
      "conversation_events",
      "memory",
      "rebuildable_chunks"
    ].map((domain, count) => ({ domain, count }));
    const preview = {
      apiVersion: 1 as const,
      previewId: `vaultmigration_${"a".repeat(32)}`,
      vaultId: "vault_20260709_ab12cd",
      fromVersion: 1 as const,
      toVersion: 2 as const,
      migrationClass: "transform" as const,
      requiresBackup: true as const,
      languagePolicy: "preserve_or_unknown" as const,
      affectedDomains,
      warnings: [
        "pre_migration_backup_required",
        "unknown_language_preserved",
        "rebuildable_indexes_after_commit"
      ]
    };
    expect(VAULT_APPLY_MIGRATION_CHANNEL).toBe("vault.applyMigration");
    expect(VaultMigrationPreviewSchema.parse(preview).affectedDomains).toHaveLength(7);
    expect(() => VaultMigrationPreviewSchema.parse({ ...preview, affectedDomains: [...affectedDomains].reverse() }))
      .toThrow();
    expect(() => VaultMigrationPreviewSchema.parse({ ...preview, path: "/private/vault" })).toThrow();

    const summary = {
      vaultId: preview.vaultId,
      name: "Alpha",
      activeVaultPathDisplay: "Alpha",
      knowledgeRootDisplay: "Knowledge",
      sourceAssetRootDisplay: "Sources",
      sourceAssetRootKind: "inside_vault" as const,
      managedCopyRoot: {
        activeVaultId: preview.vaultId,
        sourceStorageRevision: `ssrev_${"c".repeat(64)}`,
        mode: "inside_vault" as const,
        availability: "available" as const,
        canConfigure: true
      },
      defaultSourceStorageStrategy: "copy_to_source_library" as const,
      schemaVersion: 2
    };
    const onboarding = {
      state: "ready" as const,
      activeVault: summary,
      hasDefaultModel: false,
      showFirstHomeGuide: false
    };
    expect(VaultActionResultSchema.parse({ status: "needs_migration", preview }).status)
      .toBe("needs_migration");
    expect(VaultActionResultSchema.parse({
      status: "completed",
      vault: summary,
      onboarding
    })).toMatchObject({ status: "completed", compatibility: "current" });
    expect(VaultActionResultSchema.parse({
      status: "unsupported_newer",
      vaultId: preview.vaultId,
      foundVersion: 3,
      supportedVersion: 2
    }).status).toBe("unsupported_newer");
    expect(VaultActionResultSchema.parse({ status: "invalid", reason: "manifest_malformed" }).status)
      .toBe("invalid");

    const request = {
      apiVersion: 1 as const,
      requestId: `vaultmigrationreq_${"b".repeat(16)}`,
      vaultId: preview.vaultId,
      previewId: preview.previewId
    };
    expect(VaultMigrationApplyRequestSchema.parse(request)).toEqual(request);
    expect(VaultMigrationApplyResultSchema.parse({
      ...request,
      status: "completed",
      jobId: "job_20260729_migration1",
      operationId: "op_20260729_migration1",
      vault: summary,
      onboarding
    }).status).toBe("completed");
    expect(VaultMigrationApplyResultSchema.parse({
      ...request,
      status: "stale",
      current: "current"
    }).status).toBe("stale");
    expect(VaultMigrationApplyResultSchema.parse({
      ...request,
      status: "failed",
      repair: "restore_pre_migration_backup"
    }).status).toBe("failed");
    expect(() => VaultMigrationApplyResultSchema.parse({
      ...request,
      status: "failed",
      repair: "retry",
      rawError: "secret path"
    })).toThrow();
    expect(VaultMigrationCheckpointSchema.options).toEqual([
      "compatibility_revalidated",
      "pre_backup_completed",
      "durable_domains_staged",
      "staged_validation_completed",
      "durable_domains_committed",
      "manifest_committed",
      "operation_recorded",
      "indexes_rebuilt"
    ]);
  });

  it("accepts only canonical portable in-vault source roots", () => {
    const baseConfig = {
      schemaVersion: 1 as const,
      sourceStorage: {
        defaultStrategy: "copy_to_source_library" as const,
        sourceAssetRootKind: "inside_vault" as const,
        inVaultSourceAssetRoot: "raw/files"
      },
      backup: {
        includeConversations: true,
        includeVaultMemory: true,
        includeTrash: true
      },
      memory: { vaultMemoryEnabled: true }
    };

    expect(VaultConfigSchema.parse(baseConfig).sourceStorage.inVaultSourceAssetRoot).toBe("raw/files");
    for (const unsafeRoot of [
      "",
      ".",
      "..",
      "../raw",
      "raw/../outside",
      "raw/./files",
      "raw//files",
      "raw/",
      "/tmp/raw",
      "C:/raw",
      "raw\\files",
      " raw"
    ]) {
      expect(() => VaultConfigSchema.parse({
        ...baseConfig,
        sourceStorage: { ...baseConfig.sourceStorage, inVaultSourceAssetRoot: unsafeRoot }
      })).toThrow();
    }
  });

  it("keeps vault reveal results strict and pathless", () => {
    expect(VaultRevealResultSchema.parse({
      status: "revealed",
      target: "knowledge_root"
    })).toEqual({ status: "revealed", target: "knowledge_root" });
    expect(VaultRevealResultSchema.parse({
      status: "failed",
      target: "source_asset_root",
      error: {
        code: "vault.reveal_failed",
        domain: "vault",
        messageKey: "errors.vault.reveal_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry"
      }
    })).toMatchObject({ status: "failed", target: "source_asset_root" });
    expect(() => VaultRevealResultSchema.parse({
      status: "revealed",
      target: "knowledge_root",
      path: "/redacted-test/vault"
    })).toThrow();
    expect(() => VaultRevealResultSchema.parse({
      status: "failed",
      target: "source_asset_root",
      error: {
        code: "vault.reveal_failed",
        domain: "vault",
        messageKey: "errors.vault.reveal_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry",
        redactedDetails: { path: "/redacted-test/vault" }
      }
    })).toThrow();
  });

  it("validates machine-local window preferences", () => {
    const settings = MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      appLocale: "en",
      window: {
        mode: "compact",
        alwaysOnTop: false,
        sidebarOpen: true,
        compactSize: { width: 420, height: 760 }
      },
      dismissedFirstHomeVaultIds: ["vault_20260709_ab12cd"],
      updates: {
        revision: 2,
        channel: "alpha",
        lastCheck: {
          phase: "failed",
          checkedAt: "2026-07-18T08:00:00.000Z"
        }
      },
      recentVaults: []
    });

    expect(settings.window?.mode).toBe("compact");
    expect(settings.appLocale).toBe("en");
    expect(settings.window?.sidebarOpen).toBe(true);
    expect(settings.dismissedFirstHomeVaultIds).toEqual(["vault_20260709_ab12cd"]);
    expect(settings.updates).toMatchObject({ revision: 2, channel: "alpha", lastCheck: { phase: "failed" } });
  });

  it("freezes machine-local OCR language preference CAS and body-free failures", () => {
    const requestId = "ocrlangreq_20260729abcdef01";
    const automatic = OcrLanguagePreferenceSummarySchema.parse({
      apiVersion: 1,
      revision: 0,
      preference: { mode: "automatic" },
      appliesTo: "new_ocr_jobs"
    });

    expect(OcrLanguagePreferenceRequestSchema.parse({ apiVersion: 1, requestId })).toEqual({
      apiVersion: 1,
      requestId
    });
    expect(OcrLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "ready",
      summary: automatic
    }).status).toBe("ready");

    for (const language of ["zh-Hans", "en", "ja", "ko", "fr", "de"] as const) {
      const request = SetOcrLanguagePreferenceRequestSchema.parse({
        apiVersion: 1,
        requestId,
        expectedRevision: 4,
        preference: { mode: "preferred", language }
      });
      expect(request.preference).toEqual({ mode: "preferred", language });
    }

    const preferred = OcrLanguagePreferenceSummarySchema.parse({
      apiVersion: 1,
      revision: 4,
      preference: { mode: "preferred", language: "ja" },
      appliesTo: "new_ocr_jobs"
    });
    expect(SetOcrLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "committed",
      summary: preferred
    })).toMatchObject({ status: "committed", summary: { revision: 4 } });
    expect(SetOcrLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "stale",
      summary: preferred
    }).status).toBe("stale");

    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      ocrLanguagePreference: {
        revision: 4,
        preference: { mode: "preferred", language: "ja" }
      },
      recentVaults: []
    }).ocrLanguagePreference).toEqual({
      revision: 4,
      preference: { mode: "preferred", language: "ja" }
    });
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      recentVaults: []
    }).ocrLanguagePreference).toBeUndefined();

    expect(() => SetOcrLanguagePreferenceRequestSchema.parse({
      apiVersion: 1,
      requestId,
      expectedRevision: 4,
      preference: { mode: "preferred", language: "es" }
    })).toThrow();
    expect(() => OcrLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "failed",
      summary: automatic
    })).toThrow();
    expect(() => SetOcrLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "failed",
      rawError: "private"
    })).toThrow();
  });

  it("bounds local OCR image test previews without renderer path authority", () => {
    const request = OcrImageTestRequestSchema.parse({
      apiVersion: 1,
      requestId: "ocrimagetest_20260801abcdef01"
    });
    const ready = OcrImageTestResultSchema.parse({
      ...request,
      status: "ready",
      preview: {
        adapterId: "macos_vision_ocr",
        engine: "macos_vision_document",
        engineVersion: "1",
        text: "Pige OCR",
        truncated: false,
        blockCount: 1,
        confidence: 0.95,
        languageHints: ["en-US"],
        warnings: []
      }
    });
    expect(ready).toMatchObject({ status: "ready", preview: { text: "Pige OCR" } });
    expect(() => OcrImageTestRequestSchema.parse({ ...request, path: "/private/image.png" })).toThrow();
    expect(() => OcrImageTestResultSchema.parse({ ...request, status: "failed", error: "/private" })).toThrow();
    expect(() => OcrImageTestResultSchema.parse({
      ...ready,
      preview: { ...(ready.status === "ready" ? ready.preview : {}), text: "x".repeat(4_097) }
    })).toThrow();
  });

  it("freezes machine-local dictation language preference CAS and strict locale scope", () => {
    const requestId = "dictlangreq_20260801abcdef01";
    const summary = DictationLanguagePreferenceSummarySchema.parse({
      apiVersion: 1,
      revision: 2,
      preference: { mode: "preferred", language: "ko" },
      appliesTo: "new_speech_sessions"
    });
    expect(DictationLanguagePreferenceRequestSchema.parse({ apiVersion: 1, requestId }))
      .toEqual({ apiVersion: 1, requestId });
    expect(DictationLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "ready",
      summary
    }).status).toBe("ready");
    expect(SetDictationLanguagePreferenceRequestSchema.parse({
      apiVersion: 1,
      requestId,
      expectedRevision: 2,
      preference: { mode: "automatic" }
    }).preference).toEqual({ mode: "automatic" });
    expect(SetDictationLanguagePreferenceResultSchema.parse({
      apiVersion: 1,
      requestId,
      status: "stale",
      summary
    })).toMatchObject({ status: "stale", summary: { revision: 2 } });
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      dictationLanguagePreference: {
        revision: 2,
        preference: { mode: "preferred", language: "ko" }
      },
      recentVaults: []
    }).dictationLanguagePreference).toEqual({
      revision: 2,
      preference: { mode: "preferred", language: "ko" }
    });
    expect(() => SetDictationLanguagePreferenceRequestSchema.parse({
      apiVersion: 1,
      requestId,
      expectedRevision: 2,
      preference: { mode: "preferred", language: "es" }
    })).toThrow();
  });

  it("validates pathless Activity page and Memory target projections", () => {
    const result = KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-18T00:00:00.000Z",
      activeVaultId: "vault_20260718_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260718_activitysafe",
        kind: "create_page",
        createdAt: "2026-07-18T00:00:00.000Z",
        targetLabel: "Activity page",
        target: { kind: "page", pageId: "page_20260718_activitysafe" },
        status: "applied",
        canUndo: true
      }]
    });
    expect(result.activities[0]?.target).toEqual({
      kind: "page",
      pageId: "page_20260718_activitysafe"
    });
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: "vault_20260728_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_rowappend",
        kind: "add_collection_row",
        createdAt: "2026-07-28T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_abcdef123456",
          tableId: "table_abcdef123456",
          revisionId: "dataset_rev_20260728_bcdefa123456"
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("add_collection_row");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: "vault_20260728_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_columnadd",
        kind: "add_collection_column",
        createdAt: "2026-07-28T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_abcdef123456",
          tableId: "table_abcdef123456",
          revisionId: "dataset_rev_20260728_cdefab123456"
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("add_collection_column");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: "vault_20260728_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_columnrename",
        kind: "rename_collection_column",
        createdAt: "2026-07-28T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_abcdef123456",
          tableId: "table_abcdef123456",
          revisionId: "dataset_rev_20260728_cdefab123456"
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("rename_collection_column");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: "vault_20260728_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_columntrash",
        kind: "trash_collection_column",
        createdAt: "2026-07-28T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_abcdef123456",
          tableId: "table_abcdef123456",
          revisionId: "dataset_rev_20260728_defabc123456"
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("trash_collection_column");
    expect(KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-28T00:00:00.000Z",
      activeVaultId: "vault_20260728_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260728_rowtrash",
        kind: "trash_collection_row",
        createdAt: "2026-07-28T00:00:00.000Z",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_abcdef123456",
          tableId: "table_abcdef123456",
          revisionId: "dataset_rev_20260728_defabc123456"
        },
        status: "applied",
        canUndo: true
      }]
    }).activities[0]?.kind).toBe("trash_collection_row");
    expect(() => KnowledgeActivityListResultSchema.parse({
      ...result,
      activities: [{ ...result.activities[0], path: "/private/vault/page.md" }]
    })).toThrow();

    for (const activity of [
      {
        operationId: "op_20260727_memoryupdate",
        kind: "update_memory",
        target: { kind: "memory", memoryId: "memory_20260727_abcdefghijkl" }
      },
      {
        operationId: "op_20260727_memorytrash",
        kind: "trash_memory",
        target: { kind: "memory", memoryId: "memory_20260727_abcdefghijkl" }
      },
      {
        operationId: "op_20260727_memoryreset",
        kind: "restore_memory",
        target: { kind: "memory" }
      }
    ] as const) {
      expect(KnowledgeActivityListResultSchema.parse({
        scannedAt: "2026-07-27T00:00:00.000Z",
        activeVaultId: "vault_20260727_activitysafe",
        total: 1,
        invalidOperationCount: 0,
        hasMore: false,
        activities: [{
          ...activity,
          createdAt: "2026-07-27T00:00:00.000Z",
          status: "applied",
          canUndo: true
        }]
      }).activities[0]?.target).toEqual(activity.target);
    }
    expect(() => KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-27T00:00:00.000Z",
      activeVaultId: "vault_20260727_activitysafe",
      total: 1,
      invalidOperationCount: 0,
      hasMore: false,
      activities: [{
        operationId: "op_20260727_memorytrash",
        kind: "trash_memory",
        createdAt: "2026-07-27T00:00:00.000Z",
        target: { kind: "memory", memoryId: "memory_20260727_abcdefghijkl", path: "/private/atom.md" },
        status: "applied",
        canUndo: true
      }]
    })).toThrow();
  });

  it("strictly validates appearance summaries, CAS requests, and machine-local persistence", () => {
    const summary = AppearanceSettingsSummarySchema.parse({
      apiVersion: 1,
      locale: "en",
      availableLocales: ["en", "zh-Hans"],
      themePreference: "system",
      effectiveTheme: "dark",
      generatedKnowledgeLanguage: "preserve_source",
      revision: 4
    });
    expect(SetThemeRequestSchema.parse({ themePreference: "light", expectedRevision: 4 })).toEqual({
      themePreference: "light",
      expectedRevision: 4
    });
    expect(AppearanceThemeMutationResultSchema.parse({ status: "stale", settings: summary }).status).toBe("stale");
    expect(SetKnowledgeLanguageRequestSchema.parse({
      generatedKnowledgeLanguage: "follow_query",
      expectedRevision: 4
    })).toEqual({ generatedKnowledgeLanguage: "follow_query", expectedRevision: 4 });
    expect(KnowledgeLanguageMutationResultSchema.parse({
      status: "committed",
      settings: { ...summary, generatedKnowledgeLanguage: "follow_query", revision: 5 }
    }).status).toBe("committed");
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      appearance: { revision: 4, themePreference: "system" },
      recentVaults: []
    }).appearance).toEqual({ revision: 4, themePreference: "system" });

    expect(() => SetThemeRequestSchema.parse({ themePreference: "sepia", expectedRevision: 4 })).toThrow();
    expect(() => SetThemeRequestSchema.parse({
      themePreference: "dark",
      expectedRevision: 4,
      rawCss: "body{}"
    })).toThrow();
    expect(() => SetKnowledgeLanguageRequestSchema.parse({
      generatedKnowledgeLanguage: "model_choice",
      expectedRevision: 4
    })).toThrow();
  });

  it("strictly validates pathless startup destination summaries and CAS results", () => {
    const summary = StartupDestinationSummarySchema.parse({
      apiVersion: 1,
      destination: "library",
      revision: 7
    });
    expect(SetStartupDestinationRequestSchema.parse({
      destination: "home",
      expectedRevision: 7
    })).toEqual({ destination: "home", expectedRevision: 7 });
    expect(StartupDestinationMutationResultSchema.parse({ status: "committed", summary }))
      .toEqual({ status: "committed", summary });
    expect(StartupDestinationMutationResultSchema.parse({ status: "stale", summary }))
      .toEqual({ status: "stale", summary });
    expect(StartupDestinationMutationResultSchema.parse({ status: "failed" }))
      .toEqual({ status: "failed" });
    expect(StartupDestinationMutationResultSchema.parse({ status: "failed", summary }))
      .toEqual({ status: "failed", summary });
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      startupDestination: { revision: 7, destination: "library" },
      recentVaults: []
    }).startupDestination).toEqual({ revision: 7, destination: "library" });
    expect(MachineLocalSettingsSchema.parse({
      schemaVersion: 1,
      recentVaults: []
    }).startupDestination).toBeUndefined();
    expect(() => SetStartupDestinationRequestSchema.parse({
      destination: "reader",
      expectedRevision: 7
    })).toThrow();
    for (const privateField of ["path", "vaultId", "activeVaultId", "openAtLogin"] as const) {
      expect(() => StartupDestinationSummarySchema.parse({ ...summary, [privateField]: "private" }))
        .toThrow();
      expect(() => SetStartupDestinationRequestSchema.parse({
        destination: "home",
        expectedRevision: 7,
        [privateField]: "private"
      })).toThrow();
    }
  });

  it("validates toolchain manifests", () => {
    const manifest = ToolchainManifestSchema.parse({
      schemaVersion: 1,
      tools: [
        {
          id: "git",
          name: "Git",
          required: true,
          bundledPath: "../../vendor/toolchain/git/bin/git",
          repairHint: "Install bundled Git."
        },
        {
          id: "pdf-parser",
          name: "PDF parser",
          required: true,
          bundledModule: "pdfjs-dist/package.json"
        }
      ]
    });

    expect(manifest.tools[0]?.id).toBe("git");
    expect(manifest.tools[1]?.bundledModule).toBe("pdfjs-dist/package.json");
    expect(() => ToolchainManifestSchema.parse({
      schemaVersion: 1,
      tools: [{ id: "invalid", name: "Invalid", required: true }]
    })).toThrow();
  });

  it("keeps bundled-toolchain repair currentness-bound, sorted, and body-free", () => {
    expect(TOOLCHAIN_REPAIR_CHANNEL).toBe("system.repairToolchain");
    const healthId = `toolchain_health_${"a".repeat(64)}`;
    const missingRequiredToolIds = ["office-parser", "pdf-parser"] as const;
    const request = {
      apiVersion: 1,
      requestId: "toolchain_repair_request_abcdefghijklmnop",
      expectedHealthId: healthId,
      expectedMissingRequiredToolIds: missingRequiredToolIds
    } as const;
    expect(ToolchainRepairEligibilitySchema.parse({
      healthId,
      missingRequiredToolIds
    })).toEqual({ healthId, missingRequiredToolIds });
    expect(ToolchainRepairRequestSchema.parse(request)).toEqual(request);
    expect(() => ToolchainRepairRequestSchema.parse({
      ...request,
      expectedMissingRequiredToolIds: [...missingRequiredToolIds].reverse()
    })).toThrow("unique and sorted");
    expect(() => ToolchainRepairRequestSchema.parse({
      ...request,
      expectedMissingRequiredToolIds: ["pdf-parser", "pdf-parser"]
    })).toThrow("unique and sorted");
    expect(() => ToolchainRepairRequestSchema.parse({
      ...request,
      expectedMissingRequiredToolIds: []
    })).toThrow();
    expect(() => ToolchainRepairRequestSchema.parse({
      ...request,
      expectedMissingRequiredToolIds: Array.from(
        { length: TOOLCHAIN_REPAIR_MAX_MISSING_TOOLS + 1 },
        (_, index) => `tool-${String(index).padStart(2, "0")}`
      )
    })).toThrow();

    for (const status of ["opened", "stale", "not_needed", "failed"] as const) {
      expect(ToolchainRepairResultSchema.parse({ ...request, status })).toEqual({
        ...request,
        status
      });
    }
    for (const privateField of [
      "resolvedPath",
      "repairHint",
      "releaseUrl",
      "body",
      "rawError"
    ] as const) {
      expect(() => ToolchainRepairResultSchema.parse({
        ...request,
        status: "opened",
        [privateField]: "private"
      })).toThrow();
    }
  });

  it("validates file source records and canonical job states", () => {
    const sourceRecord = SourceRecordSchema.parse({
      id: "src_20260709_abcdef123456",
      kind: "markdown_file",
      storageStrategy: "copy_to_source_library",
      original: {
        uri: "file:///tmp/source.md",
        path: "/tmp/source.md",
        displayName: "source.md",
        lastKnownMtime: "2026-07-09T00:00:00.000Z",
        lastKnownSize: 12,
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      managedCopy: {
        path: "raw/files/2026/07/src_20260709_abcdef123456.md",
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        size: 12
      },
      artifacts: [{
        id: "art_20260709_abcdef123456_text",
        kind: "extracted_text",
        path: "artifacts/extracted-text/2026/07/src_20260709_abcdef123456.txt",
        checksum: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        size: 42
      }],
      metadata: {},
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    });
    const jobRecord = JobRecordSchema.parse({
      id: "job_20260709_abcdef123456",
      class: "capture",
      state: "failed_retryable",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      sourceId: sourceRecord.id,
      message: "Retryable capture failure."
    });

    expect(sourceRecord.original?.displayName).toBe("source.md");
    expect(sourceRecord.artifacts[0]?.size).toBe(42);
    expect(jobRecord.state).toBe("failed_retryable");
  });

  it("keeps pushed Job changes strict and renderer-safe", () => {
    const event = JobChangedEventSchema.parse({
      apiVersion: 1,
      sequence: 7,
      activeVaultId: "vault_20260709_jobchanged",
      job: {
        id: "job_20260709_jobchanged",
        class: "dataset_import",
        state: "running",
        stage: "importing",
        progress: { completedUnits: 12, totalUnits: 20, unit: "row" },
        sourceId: "src_20260709_jobchanged",
        sourceDisplayName: "accounts.csv",
        sourceKind: "csv_file",
        canReconnectDependency: false,
        canReconnectBackupDestination: false,
        canContinueIncomplete: false,
        canCancel: true,
        canRetry: false,
        message: "Dataset import running.",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z"
      }
    });

    expect(event.job.progress).toEqual({ completedUnits: 12, totalUnits: 20, unit: "row" });
    expect(() => JobChangedEventSchema.parse({
      ...event,
      job: { ...event.job, path: "/private/vault/.pige/jobs/job.json" }
    })).toThrow();
    expect(() => JobChangedEventSchema.parse({ ...event, sequence: 0 })).toThrow();
  });

  it("validates durable confirmation proposals and preserves future extension fields", () => {
    const proposal = ConfirmationProposalSchema.parse({
      id: "proposal_20260709_abcdef123456",
      schemaVersion: 1,
      jobId: "job_20260709_abcdef123456",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
      state: "ready",
      trustLevel: "review_required",
      summary: "Review a proposed note edit.",
      reason: "The change touches an existing wiki page.",
      sourceRefs: [{ kind: "job", id: "job_20260709_abcdef123456" }],
      targetRefs: [{ kind: "page", id: "page_20260709_abcdef123456", path: "wiki/note.md" }],
      proposedOperations: [
        {
          kind: "update",
          path: "wiki/note.md",
          beforeSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          content: "# Updated note\n"
        }
      ],
      diffRefs: [],
      warnings: [],
      baseHashes: {
        "wiki/note.md": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      futureRemoteAgentField: "preserved"
    });

    expect(proposal.state).toBe("ready");
    expect(proposal.futureRemoteAgentField).toBe("preserved");
  });

  it("keeps URL Skill staging explicit, immutable, and renderer-safe", () => {
    const requestId = "skillreq_abcdefghijklmnop";
    const stagingId = `skillstage_${"a".repeat(32)}`;
    const manifestSha256 = `sha256:${"b".repeat(64)}`;
    const sourceUrl = "https://example.com/skills/paper-reading/SKILL.md";
    const activeVaultId = "vault_20260728_skillstaging";
    const stageRequest = { apiVersion: 1, requestId, activeVaultId, sourceUrl } as const;
    expect(SkillStageFromUrlRequestSchema.parse(stageRequest)).toEqual(stageRequest);
    for (const unsafeUrl of [
      "http://example.com/SKILL.md",
      "https://user:secret@example.com/SKILL.md",
      "https://example.com/SKILL.md?token=secret",
      "https://example.com/SKILL.md#private"
    ]) {
      expect(() => SkillStageFromUrlRequestSchema.parse({ ...stageRequest, sourceUrl: unsafeUrl })).toThrow();
    }

    const staged = {
      stagingId,
      manifestSha256,
      bundleSha256: manifestSha256,
      registryRevision: 4,
      expiresAt: "2026-07-27T12:00:00.000Z",
      sourceUrl,
      id: "paper-reading",
      name: "Paper Reading",
      version: "1.0.0",
      description: "Review papers with source-aware prompts.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: manifestSha256 }],
      warnings: ["untrusted_remote_source"]
    } as const;
    const stageResult = { status: "ready", requestId, activeVaultId, staged } as const;
    expect(SkillStageFromUrlResultSchema.parse(stageResult)).toEqual(stageResult);
    for (const unsafe of [{ body: "private" }, { path: "/tmp/staged" }, { sourceBytes: "private" }]) {
      expect(() => SkillStageFromUrlResultSchema.parse({ ...stageResult, ...unsafe })).toThrow();
    }

    const installRequest = {
      apiVersion: 1,
      requestId,
      activeVaultId,
      scope: "machine_local",
      stagingId,
      manifestSha256,
      bundleSha256: manifestSha256,
      expectedRegistryRevision: 4,
      enabled: true
    } as const;
    expect(SkillInstallStagedRequestSchema.parse(installRequest)).toEqual(installRequest);
    const registry = { apiVersion: 1, revision: 5, invalidManifestCount: 0, skills: [], restorableSkills: [] } as const;
    expect(SkillInstallStagedResultSchema.parse({ status: "committed", requestId, activeVaultId, registry }))
      .toEqual({ status: "committed", requestId, activeVaultId, registry });

    const discardRequest = {
      apiVersion: 1, requestId, activeVaultId, scope: "machine_local", stagingId,
      manifestSha256, bundleSha256: manifestSha256
    } as const;
    expect(SkillDiscardStagedRequestSchema.parse(discardRequest)).toEqual(discardRequest);
    expect(SkillDiscardStagedResultSchema.parse({ status: "discarded", requestId, activeVaultId }))
      .toEqual({ status: "discarded", requestId, activeVaultId });
  });

  it("freezes External/Web Skill review disclosure without implicit runtime or secret authority", () => {
    const capabilities = ["read_current_source", "external_network", "use_brokered_credential"] as const;
    const dataBoundaries = ["local", "network", "brokered_credential"] as const;
    expect(deriveSkillDataBoundaries(capabilities)).toEqual(dataBoundaries);
    expect(deriveSkillDataBoundaries(["run_shell"]))
      .toEqual(["filesystem", "network", "destructive"]);
    expect(deriveSkillDataBoundaries(["install_local_tool"]))
      .toEqual(["filesystem", "network"]);

    const manifest = {
      id: "external-research",
      name: "External Research",
      version: "1.0.0",
      description: "Request reviewed network research through Pige.",
      scope: "machine_local",
      kind: "external_web",
      capabilities,
      dataBoundary: dataBoundaries
    } as const;
    expect(SkillManifestSchema.parse(manifest)).toEqual(manifest);
    for (const invalid of [
      { ...manifest, dataBoundary: undefined },
      { ...manifest, dataBoundary: ["network", "local", "brokered_credential"] },
      { ...manifest, dataBoundary: ["local", "network"] },
      { ...manifest, sourceUrl: "https://user:secret@example.com/SKILL.md" },
      { ...manifest, capabilities: [...capabilities, "read_raw_secret"] },
      { ...manifest, capabilities: [...capabilities, "unknown_capability"] }
    ]) {
      expect(() => SkillManifestSchema.parse(invalid)).toThrow();
    }

    const manifestSha256 = `sha256:${"a".repeat(64)}`;
    const bundleSha256 = `sha256:${"b".repeat(64)}`;
    const sourceUrl = "https://example.com/external-research/SKILL.md";
    const staged = {
      stagingId: `skillstage_${"c".repeat(32)}`,
      manifestSha256,
      bundleSha256,
      registryRevision: 8,
      expiresAt: "2026-07-30T12:00:00.000Z",
      sourceUrl,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: "external_web",
      capabilities,
      dataBoundaries,
      source: "https",
      files: [
        { relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: manifestSha256 },
        { relativePath: "references/policy.json", utf8ByteSize: 256, sha256: bundleSha256 }
      ],
      warnings: ["untrusted_remote_source"]
    } as const;
    expect(SkillStagedSummarySchema.parse(staged)).toEqual(staged);
    for (const source of ["local_markdown", "local_zip"] as const) {
      const local = { ...staged, source, sourceUrl: undefined, warnings: [] } as const;
      expect(SkillStagedSummarySchema.parse(local)).toEqual(local);
    }
    for (const invalid of [
      { ...staged, source: undefined },
      { ...staged, source: "local_markdown" },
      { ...staged, dataBoundaries: ["local", "network"] },
      { ...staged, files: [{ ...staged.files[0], relativePath: "run.js" }] },
      { ...staged, path: "/private/stage" },
      { ...staged, body: "private Skill body" },
      { ...staged, credential: "secret" }
    ]) {
      expect(() => SkillStagedSummarySchema.parse(invalid)).toThrow();
    }

    const installed = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: "external_web",
      enabled: false,
      trust: "user_confirmed",
      capabilities,
      dataBoundaries,
      canEnable: false,
      canUninstall: false,
      canExport: false,
      canUpdate: true,
      source: "https",
      sourceUrl,
      manifestSha256,
      bundleSha256,
      files: staged.files,
      warnings: staged.warnings
    } as const;
    expect(SkillSummarySchema.parse(installed)).toEqual(installed);
    expect(SkillSummarySchema.parse({
      ...installed,
      source: "local_zip",
      sourceUrl: undefined,
      canUpdate: false,
      warnings: []
    })).toMatchObject({ source: "local_zip", enabled: false, canEnable: false });
    for (const invalid of [
      { ...installed, enabled: true },
      { ...installed, canEnable: true },
      { ...installed, files: undefined },
      { ...installed, dataBoundaries: ["local", "network"] },
      { ...installed, path: "/private/installed" },
      { ...installed, body: "private Skill body" },
      { ...installed, rawCredential: "secret" }
    ]) {
      expect(() => SkillSummarySchema.parse(invalid)).toThrow();
    }
  });

  it("enables only the exact Pige-owned reviewed HTTPS External/Web runtime", () => {
    const runtime = {
      adapter: "pige_readonly_https_v1",
      origin: "https://api.example.com"
    } as const;
    expect(ExternalWebSkillRuntimeDeclarationSchema.parse(runtime)).toEqual(runtime);
    expect(ExternalWebSkillHttpsOriginSchema.parse(runtime.origin)).toBe(runtime.origin);
    for (const origin of [
      "http://api.example.com",
      "https://user:secret@api.example.com",
      "https://api.example.com/path",
      "https://api.example.com?token=secret",
      "https://api.example.com/#fragment",
      "https://API.example.com"
    ]) {
      expect(() => ExternalWebSkillHttpsOriginSchema.parse(origin)).toThrow();
    }

    const capabilities = ["read_current_source", "external_network"] as const;
    const dataBoundaries = ["local", "network"] as const;
    const manifest = {
      id: "external-research",
      name: "External Research",
      version: "1.0.0",
      description: "Read one reviewed HTTPS origin through Pige.",
      scope: "machine_local",
      kind: "external_web",
      capabilities,
      dataBoundary: dataBoundaries,
      runtime
    } as const;
    expect(SkillManifestSchema.parse(manifest)).toEqual(manifest);
    for (const invalid of [
      { ...manifest, runtime: { ...runtime, adapter: "third_party_js" } },
      { ...manifest, runtime: { ...runtime, origin: "https://api.example.com/path" } },
      { ...manifest, capabilities: [...capabilities, "use_brokered_credential"], dataBoundary: [...dataBoundaries, "brokered_credential"] },
      { ...manifest, kind: "pure", capabilities: ["read_current_source"], dataBoundary: undefined }
    ]) {
      expect(() => SkillManifestSchema.parse(invalid)).toThrow();
    }

    const manifestSha256 = `sha256:${"a".repeat(64)}`;
    const bundleSha256 = `sha256:${"b".repeat(64)}`;
    const files = [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: manifestSha256 }] as const;
    const staged = {
      stagingId: `skillstage_${"c".repeat(32)}`,
      manifestSha256,
      bundleSha256,
      registryRevision: 9,
      expiresAt: "2026-07-30T12:00:00.000Z",
      sourceUrl: "https://example.com/external-research/SKILL.md",
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: "external_web",
      capabilities,
      dataBoundaries,
      source: "https",
      runtime,
      files,
      warnings: ["untrusted_remote_source"]
    } as const;
    expect(SkillStagedSummarySchema.parse(staged)).toEqual(staged);

    const installed = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: "external_web",
      enabled: false,
      trust: "user_confirmed",
      capabilities,
      dataBoundaries,
      canEnable: true,
      canUninstall: false,
      canExport: false,
      canUpdate: false,
      source: "https",
      sourceUrl: staged.sourceUrl,
      runtime,
      manifestSha256,
      bundleSha256,
      files,
      warnings: staged.warnings
    } as const;
    expect(SkillSummarySchema.parse(installed)).toEqual(installed);
    expect(SkillSummarySchema.parse({ ...installed, enabled: true, canEnable: false }))
      .toMatchObject({ enabled: true, canEnable: false, runtime });
    for (const invalid of [
      { ...installed, runtime: undefined },
      { ...installed, enabled: true },
      { ...installed, canUninstall: true },
      { ...installed, canExport: true }
    ]) {
      expect(() => SkillSummarySchema.parse(invalid)).toThrow();
    }

    const request = { url: "https://api.example.com/research" } as const;
    expect(ExternalWebSkillReadRequestSchema.parse(request)).toEqual(request);
    for (const unsafe of [
      { url: "http://api.example.com/research" },
      { url: "https://user:secret@api.example.com/research" },
      { url: "https://api.example.com/research?token=secret" },
      { ...request, headers: { authorization: "secret" } },
      { ...request, body: "private" }
    ]) {
      expect(() => ExternalWebSkillReadRequestSchema.parse(unsafe)).toThrow();
    }
    const ready = {
      status: "ready",
      origin: runtime.origin,
      contentType: "application/json",
      byteLength: 4096,
      truncated: false,
      warningCount: 0
    } as const;
    expect(ExternalWebSkillReadResultSchema.parse(ready)).toEqual(ready);
    for (const unsafe of [
      { ...ready, body: "private" },
      { ...ready, url: request.url },
      { ...ready, path: "/private/cache" },
      { ...ready, credential: "secret" },
      { status: "failed", rawError: "private" }
    ]) {
      expect(() => ExternalWebSkillReadResultSchema.parse(unsafe)).toThrow();
    }
  });

  it("projects bounded vault-bound chat Skill reviews without renderer URL authority", () => {
    const request = {
      apiVersion: 1,
      requestId: "skill_lifecycle_request_chatreviewabcdefghijkl",
      activeVaultId: "vault_20260729_chatskillreview"
    } as const;
    expect(SkillPendingStagedReviewsRequestSchema.parse(request)).toEqual(request);
    for (const unsafe of [
      { candidateIndex: 1 },
      { sourceUrl: "https://example.com/SKILL.md" },
      { path: "/private/staging" },
      { body: "private" }
    ]) {
      expect(() => SkillPendingStagedReviewsRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }

    const staged = (suffix: string, sourceUrl = "https://example.com/SKILL.md") => ({
      stagingId: `skillstage_${suffix.repeat(32)}`,
      manifestSha256: `sha256:${suffix.repeat(64)}`,
      bundleSha256: `sha256:${suffix.repeat(64)}`,
      registryRevision: 4,
      expiresAt: "2026-07-30T12:00:00.000Z",
      sourceUrl,
      id: `chat-skill-${suffix}`,
      name: `Chat Skill ${suffix}`,
      version: "1.0.0",
      description: "A staged chat Skill awaiting explicit review.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [{
        relativePath: "SKILL.md",
        utf8ByteSize: 1024,
        sha256: `sha256:${suffix.repeat(64)}`
      }],
      warnings: ["untrusted_remote_source"]
    } as const);
    const ready = { ...request, status: "ready", staged: [staged("a"), staged("b")] } as const;
    expect(SkillPendingStagedReviewsResultSchema.parse(ready)).toEqual(ready);
    expect(SkillPendingStagedReviewsResultSchema.parse({ ...request, status: "failed" }))
      .toEqual({ ...request, status: "failed" });
    expect(() => SkillPendingStagedReviewsResultSchema.parse({
      ...request,
      status: "failed",
      error: { code: "private" }
    })).toThrow();
    expect(() => SkillPendingStagedReviewsResultSchema.parse({
      ...ready,
      staged: [staged("b"), staged("a")]
    })).toThrow();
    const localStage = { ...staged("c") } as { sourceUrl?: string };
    delete localStage.sourceUrl;
    expect(() => SkillPendingStagedReviewsResultSchema.parse({ ...ready, staged: [localStage] })).toThrow();
    expect(() => SkillPendingStagedReviewsResultSchema.parse({
      ...ready,
      staged: Array.from({ length: 33 }, (_, index) => ({
        ...staged("d"),
        stagingId: `skillstage_${(index + 1).toString(16).padStart(32, "0")}`,
        id: `chat-skill-cap-${index + 1}`
      }))
    })).toThrow();
  });

  it("keeps local Markdown Skill picking Main-owned, bounded, and pathless", () => {
    const request = {
      apiVersion: 1,
      requestId: "skillreq_markdownabcdefghijkl",
      activeVaultId: "vault_20260728_markdownskill"
    } as const;
    expect(SkillStageFromMarkdownRequestSchema.parse(request)).toEqual(request);
    for (const unsafe of [{ path: "/private/SKILL.md" }, { body: "private" }, { sourceUrl: "file:///private/SKILL.md" }]) {
      expect(() => SkillStageFromMarkdownRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }

    const staged = {
      stagingId: `skillstage_${"d".repeat(32)}`,
      manifestSha256: `sha256:${"e".repeat(64)}`,
      bundleSha256: `sha256:${"e".repeat(64)}`,
      registryRevision: 4,
      expiresAt: "2026-07-28T12:00:00.000Z",
      id: "local-review",
      name: "Local Review",
      version: "1.0.0",
      description: "Review one local Markdown Skill before install.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: `sha256:${"e".repeat(64)}` }],
      warnings: []
    } as const;
    const identity = { ...request, status: "ready" as const };
    expect(SkillStageFromMarkdownResultSchema.parse({ ...identity, staged }))
      .toEqual({ ...identity, staged });
    for (const status of ["cancelled", "failed"] as const) {
      expect(SkillStageFromMarkdownResultSchema.parse({ ...request, status }))
        .toEqual({ ...request, status });
    }
    for (const unsafe of [
      { path: "/private/SKILL.md" },
      { body: "private" },
      { error: { code: "raw_fs_error" } }
    ]) {
      expect(() => SkillStageFromMarkdownResultSchema.parse({ ...request, status: "failed", ...unsafe })).toThrow();
    }
    expect(() => SkillStageFromMarkdownResultSchema.parse({
      ...identity,
      staged: { ...staged, sourceUrl: "https://example.com/SKILL.md", warnings: ["untrusted_remote_source"] }
    })).toThrow();
  });

  it("keeps local ZIP Skill staging bounded, pathless, and bundle-bound", () => {
    const request = {
      apiVersion: 1,
      requestId: "skillreq_zipabcdefghijklmnop",
      activeVaultId: "vault_20260728_zipskill"
    } as const;
    expect(SkillStageFromZipRequestSchema.parse(request)).toEqual(request);
    for (const unsafe of [{ path: "/private/skill.zip" }, { body: "private" }, { archiveBytes: "private" }]) {
      expect(() => SkillStageFromZipRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }

    const staged = {
      stagingId: `skillstage_${"f".repeat(32)}`,
      manifestSha256: `sha256:${"a".repeat(64)}`,
      bundleSha256: `sha256:${"b".repeat(64)}`,
      registryRevision: 4,
      expiresAt: "2026-07-28T12:00:00.000Z",
      id: "zip-review",
      name: "ZIP Review",
      version: "1.0.0",
      description: "Review one local ZIP Skill before install.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [
        { relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: `sha256:${"a".repeat(64)}` },
        { relativePath: "references/style.md", utf8ByteSize: 512, sha256: `sha256:${"c".repeat(64)}` },
        { relativePath: "references/rules.json", utf8ByteSize: 256, sha256: `sha256:${"d".repeat(64)}` }
      ],
      warnings: []
    } as const;
    expect(SkillStageFromZipResultSchema.parse({ ...request, status: "ready", staged }))
      .toEqual({ ...request, status: "ready", staged });
    for (const reason of [
      "archive_too_large", "archive_invalid", "archive_unsafe", "skill_root_invalid",
      "manifest_invalid", "unsupported_content"
    ] as const) {
      expect(SkillStageFromZipResultSchema.parse({ ...request, status: "invalid", reason }))
        .toEqual({ ...request, status: "invalid", reason });
    }
    expect(SkillStageFromZipResultSchema.parse({ ...request, status: "cancelled" }))
      .toEqual({ ...request, status: "cancelled" });
    expect(SkillStageFromZipResultSchema.parse({ ...request, status: "failed" }))
      .toEqual({ ...request, status: "failed" });
    expect(() => SkillStageFromZipResultSchema.parse({
      ...request,
      status: "ready",
      staged: { ...staged, files: [...staged.files, { ...staged.files[1], relativePath: "REFERENCES/STYLE.MD" }] }
    })).toThrow();
    expect(() => SkillStageFromZipResultSchema.parse({
      ...request,
      status: "ready",
      staged: { ...staged, files: staged.files.filter((file) => file.relativePath !== "SKILL.md") }
    })).toThrow();
    expect(() => SkillStageFromZipResultSchema.parse({ ...request, status: "failed", path: "/private/skill.zip" })).toThrow();
  });

  it("keeps installed Skill lifecycle vault-bound, CAS-fenced, and pathless", () => {
    const request = {
      apiVersion: 1,
      requestId: "skill_lifecycle_request_abcdefghijklmnop",
      activeVaultId: "vault_20260728_abcdefgh",
      scope: "machine_local",
      skillId: "paper-reading",
      expectedRegistryRevision: 5
    } as const;
    expect(SkillEnableRequestSchema.parse(request)).toEqual(request);
    expect(SkillUninstallRequestSchema.parse(request)).toEqual(request);
    expect(SkillExportRequestSchema.parse(request)).toEqual(request);
    expect(SkillStageUpdateRequestSchema.parse(request)).toEqual(request);

    const identity = {
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      scope: request.scope,
      skillId: request.skillId
    } as const;
    const skill = {
      id: request.skillId,
      name: "Paper Reading",
      version: "1.0.0",
      description: "Review papers with source-aware prompts.",
      scope: "machine_local",
      kind: "pure",
      enabled: false,
      trust: "user_confirmed",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      canEnable: true,
      canUninstall: true,
      canExport: true,
      canUpdate: true
    } as const;
    const registry = {
      apiVersion: 1,
      revision: 6,
      invalidManifestCount: 0,
      skills: [skill],
      restorableSkills: []
    } as const;
    for (const status of ["committed", "stale", "not_found"] as const) {
      expect(SkillLifecycleMutationResultSchema.parse({ ...identity, status, registry }))
        .toEqual({ ...identity, status, registry });
    }
    expect(SkillLifecycleMutationResultSchema.parse({ ...identity, status: "failed" }))
      .toEqual({ ...identity, status: "failed" });

    for (const status of ["exported", "cancelled", "stale", "not_found", "failed"] as const) {
      const result = { ...identity, registryRevision: 6, status } as const;
      expect(SkillExportResultSchema.parse(result)).toEqual(result);
    }
    const stagedUpdate = {
      stagingId: `skillstage_${"a".repeat(32)}`,
      manifestSha256: `sha256:${"b".repeat(64)}`,
      bundleSha256: `sha256:${"b".repeat(64)}`,
      registryRevision: request.expectedRegistryRevision,
      expiresAt: "2026-07-28T12:00:00.000Z",
      sourceUrl: "https://example.com/skills/paper-reading/SKILL.md",
      id: request.skillId,
      name: "Paper Reading",
      version: "2.0.0",
      description: "Review papers with current source-aware prompts.",
      scope: "machine_local",
      kind: "pure",
      capabilities: ["read_current_source"],
      dataBoundaries: ["local"],
      files: [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: `sha256:${"b".repeat(64)}` }],
      warnings: ["untrusted_remote_source"]
    } as const;
    expect(SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: stagedUpdate }))
      .toEqual({ ...identity, status: "ready", staged: stagedUpdate });
    for (const status of ["current", "stale", "not_found"] as const) {
      expect(SkillStageUpdateResultSchema.parse({ ...identity, status, registry }))
        .toEqual({ ...identity, status, registry });
    }
    expect(SkillStageUpdateResultSchema.parse({ ...identity, status: "failed" }))
      .toEqual({ ...identity, status: "failed" });
    for (const unsafe of [
      { path: "/private/export/SKILL.md" },
      { body: "private Skill body" },
      { sourceUrl: "https://example.com/private" },
      { error: { code: "raw_fs_error" } }
    ]) {
      expect(() => SkillExportResultSchema.parse({
        ...identity,
        registryRevision: 6,
        status: "failed",
        ...unsafe
      })).toThrow();
    }
    expect(() => SkillEnableRequestSchema.parse({ ...request, path: "/private/skill" })).toThrow();
    for (const unsafe of [
      { sourceUrl: "https://example.com/private/SKILL.md" },
      { path: "/private/skill" },
      { manifestSha256: `sha256:${"c".repeat(64)}` }
    ]) {
      expect(() => SkillStageUpdateRequestSchema.parse({ ...request, ...unsafe })).toThrow();
    }
    expect(() => SkillStageUpdateResultSchema.parse({
      ...identity,
      status: "failed",
      error: { code: "raw_fs_error" }
    })).toThrow();
    for (const unsafe of [
      { ...skill, scope: "built_in", trust: "built_in", canEnable: true },
      { ...skill, kind: "package_provided", trust: "package_managed", canUninstall: true },
      { ...skill, scope: "built_in", trust: "built_in", canUpdate: true },
      { ...skill, enabled: true, canEnable: true }
    ]) {
      expect(() => SkillLifecycleMutationResultSchema.parse({
        ...identity,
        status: "committed",
        registry: { ...registry, skills: [unsafe] }
      })).toThrow();
    }
    const missingEligibility: Record<string, unknown> = { ...skill };
    delete missingEligibility.canExport;
    expect(() => SkillLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      registry: { ...registry, skills: [missingEligibility] }
    })).toThrow();
    const missingUpdateEligibility: Record<string, unknown> = { ...skill };
    delete missingUpdateEligibility.canUpdate;
    expect(() => SkillLifecycleMutationResultSchema.parse({
      ...identity,
      status: "committed",
      registry: { ...registry, skills: [missingUpdateEligibility] }
    })).toThrow();
  });

  it("projects only v2 restorable Skill contexts and restores through authoritative registry CAS", () => {
    const restorable = {
      restoreContextId: `skill_restore_context_v2_${"a".repeat(32)}`,
      skillId: "paper-reading",
      name: "Paper Reading",
      version: "1.0.0",
      kind: "pure",
      scope: "machine_local",
      uninstalledAt: "2026-07-29T12:00:00.000Z",
      canRestore: true
    } as const;
    const registry = {
      apiVersion: 1,
      revision: 8,
      invalidManifestCount: 1,
      skills: [],
      restorableSkills: [restorable]
    } as const;
    expect(SkillRegistrySummarySchema.parse(registry)).toEqual(registry);
    for (const unsafe of [
      { ...restorable, path: "/private/skills-trash/paper-reading" },
      { ...restorable, manifestSha256: `sha256:${"b".repeat(64)}` },
      { ...restorable, body: "private Skill body" },
      { ...restorable, restoreContextId: `skill_restore_context_v1_${"a".repeat(32)}` }
    ]) {
      expect(() => SkillRegistrySummarySchema.parse({ ...registry, restorableSkills: [unsafe] })).toThrow();
    }

    const request = {
      apiVersion: 1,
      requestId: "skill_lifecycle_request_restore123456789",
      activeVaultId: "vault_20260729_restore01",
      scope: "machine_local",
      restoreContextId: restorable.restoreContextId,
      skillId: restorable.skillId,
      expectedRegistryRevision: registry.revision
    } as const;
    expect(SkillRestoreRequestSchema.parse(request)).toEqual(request);
    const identity = {
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      scope: request.scope,
      restoreContextId: request.restoreContextId,
      skillId: request.skillId
    } as const;
    for (const status of ["committed", "stale", "not_found", "ineligible"] as const) {
      expect(SkillRestoreResultSchema.parse({ ...identity, status, registry }))
        .toEqual({ ...identity, status, registry });
    }
    expect(SkillRestoreResultSchema.parse({ ...identity, status: "failed" }))
      .toEqual({ ...identity, status: "failed" });
    expect(() => SkillRestoreResultSchema.parse({ ...identity, status: "failed", registry })).toThrow();
    expect(() => SkillRestoreRequestSchema.parse({ ...request, path: "/private/trash" })).toThrow();
  });

  it("freezes renderer-safe remembered permission grants without widening effect authority", () => {
    const activeVaultId = "vault_20260729_permissions";
    const confirmation = {
      apiVersion: 1,
      confirmationId: "confirm_20260729_abcdefghijklmnop",
      effect: "arbitrary_shell",
      presentation: {
        action: "run_shell_command",
        target: "local_system",
        subject: { kind: "executable_name", value: "git" }
      },
      owner: { kind: "agent_turn", clientTurnId: "turn_20260729_abcdefghijkl" }
    } as const;
    const grantContextId = "grantctx_abcdefghijklmnop";
    expect(HighRiskConfirmationPendingResultSchema.parse({
      apiVersion: 1,
      status: "pending",
      revision: 4,
      confirmation,
      rememberScopedGrant: {
        grantContextId,
        scope: "resource_scope",
        safeScopeLabel: "Current workspace actions",
        expiresAt: "2026-08-28T00:00:00.000Z"
      }
    }).status).toBe("pending");
    expect(HighRiskConfirmationResolveRequestSchema.parse({
      apiVersion: 1,
      confirmationId: confirmation.confirmationId,
      expectedRevision: 4,
      decision: "allow",
      rememberScopedGrant: { decision: "allow_scoped", grantContextId }
    }).rememberScopedGrant?.grantContextId).toBe(grantContextId);
    expect(() => HighRiskConfirmationResolveRequestSchema.parse({
      apiVersion: 1,
      confirmationId: confirmation.confirmationId,
      expectedRevision: 4,
      decision: "deny",
      rememberScopedGrant: { decision: "allow_scoped", grantContextId }
    })).toThrow("denial");

    const request = {
      apiVersion: 1,
      requestId: "permissionpolicyreq_abcdefghijklmnop",
      activeVaultId
    } as const;
    const summary = {
      apiVersion: 1,
      activeVaultId,
      revision: 9,
      defaultMode: "remember_scoped_grants",
      fullAccess: {
        enabled: false,
        canEnable: true,
        hardBoundaries: [
          "permanent_delete",
          "overwrite_user_original",
          "raw_credential_export",
          "risky_agent_edit",
          "protected_authority_change",
          "os_permission",
          "ssrf_private_network",
          "signature_verification",
          "filesystem_safety"
        ]
      },
      grants: [{
        grantId: "grant_20260729_abcdefghijklmnop",
        actorType: "local_tool",
        actorLabel: "Pige command runner",
        actorVersion: "1",
        capability: "run_shell",
        dataBoundary: "local",
        scope: "resource_scope",
        resourceScope: "current_vault",
        resourceLabel: "Current workspace actions",
        createdAt: "2026-07-29T00:00:00.000Z",
        expiresAt: "2026-08-28T00:00:00.000Z",
        canRevoke: true
      }],
      invalidGrantCount: 0
    } as const;
    expect(PermissionPolicySummaryRequestSchema.parse(request)).toEqual(request);
    expect(PermissionPolicySummaryResultSchema.parse({ ...request, status: "ready", summary }).summary)
      .toEqual(summary);
    expect(() => PermissionPolicySummaryResultSchema.parse({
      ...request,
      status: "ready",
      summary: { ...summary, path: "/private/permission-policy.json" }
    })).toThrow();
    expect(PermissionSetDefaultModeResultSchema.parse({
      ...request,
      status: "committed",
      summary
    }).status).toBe("committed");
    expect(PermissionSetDefaultModeRequestSchema.parse({
      ...request,
      expectedRevision: 9,
      mode: "ask_every_time"
    }).mode).toBe("ask_every_time");
    expect(PermissionRevokeGrantRequestSchema.parse({
      ...request,
      grantId: summary.grants[0].grantId,
      expectedRevision: 9
    }).grantId).toBe(summary.grants[0].grantId);
    expect(PermissionRevokeGrantResultSchema.parse({
      ...request,
      status: "stale",
      summary
    }).status).toBe("stale");
    expect(() => PermissionPolicySummaryResultSchema.parse({
      ...request,
      status: "failed",
      summary
    })).toThrow();

    const yoloRequest = {
      ...request,
      expectedRevision: 9,
      mode: "yolo_full_access",
      fullAccessAcknowledgement: {
        kind: "yolo_full_access",
        explicitUserAction: true,
        hardBoundariesAcknowledged: true
      }
    } as const;
    expect(PermissionSetDefaultModeRequestSchema.parse(yoloRequest)).toEqual(yoloRequest);
    expect(() => PermissionSetDefaultModeRequestSchema.parse({
      ...yoloRequest,
      fullAccessAcknowledgement: undefined
    })).toThrow("explicit user acknowledgement");
    expect(() => PermissionSetDefaultModeRequestSchema.parse({
      ...yoloRequest,
      mode: "ask_every_time"
    })).toThrow("explicit user acknowledgement");
    expect(PermissionSetDefaultModeResultSchema.parse({
      ...request,
      status: "confirmation_required",
      confirmationId: "confirm_20260729_yolofullaccess1234",
      confirmationRevision: 10,
      summary
    }).status).toBe("confirmation_required");
    const fullAccessSummary = {
      ...summary,
      revision: 10,
      defaultMode: "yolo_full_access",
      fullAccess: {
        enabled: true,
        enabledAt: "2026-07-29T00:01:00.000Z",
        canDisable: true,
        hardBoundaries: summary.fullAccess.hardBoundaries
      }
    } as const;
    expect(PermissionPolicySummaryResultSchema.parse({
      ...request,
      status: "ready",
      summary: fullAccessSummary
    }).summary.defaultMode).toBe("yolo_full_access");
    expect(() => PermissionPolicySummaryResultSchema.parse({
      ...request,
      status: "ready",
      summary: { ...fullAccessSummary, defaultMode: "ask_every_time" }
    })).toThrow("exactly match");
  });
});
