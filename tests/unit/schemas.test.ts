import { describe, expect, it } from "vitest";
import {
  AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX,
  AGENT_CONVERSATION_HISTORY_PREVIEW_MAX_CODE_POINTS,
  AgentConversationHistoryListRequestSchema,
  AgentConversationHistoryListResultSchema,
  AgentConversationTurnSummarySchema,
  AgentSubmitTurnResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  BackupContinueIncompleteRequestSchema,
  BackupContinueIncompleteResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  ReferencedOriginalReconnectRequestSchema,
  ReferencedOriginalReconnectResultSchema,
  COLLECTION_ADD_FORMULA_COLUMN_CHANNEL,
  COLLECTION_ADD_RELATION_COLUMN_CHANNEL,
  COLLECTION_EDIT_RELATION_CELL_CHANNEL,
  COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL,
  COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES,
  COLLECTION_LIST_CHANNEL,
  COLLECTION_OPEN_CITATION_CHANNEL,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  CollectionAddFormulaColumnRequestSchema,
  CollectionAddFormulaColumnResultSchema,
  CollectionAddRelationColumnRequestSchema,
  CollectionAddRelationColumnResultSchema,
  CollectionEditRelationCellRequestSchema,
  CollectionEditRelationCellResultSchema,
  CollectionRelationCellValueSchema,
  CollectionUpdateFormulaColumnRequestSchema,
  CollectionUpdateFormulaColumnResultSchema,
  ConfirmationProposalSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionListRequestSchema,
  CollectionListResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  ConversationEventSchema,
  DATASET_PIGE_FORMULA_MAX_DEPTH,
  DATASET_PIGE_FORMULA_MAX_NODES,
  DatasetPigeCalculationSchema,
  DatasetPigeFormulaExpressionSchema,
  DatasetPigeRelationCellSchema,
  DatasetPigeRelationSchema,
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
  JobRecordSchema,
  KnowledgeActivityListResultSchema,
  KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
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
  NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES,
  NoteEditorOpenRequestSchema,
  NoteEditorOpenResultSchema,
  NoteEditorPortableMarkdownSchema,
  NoteEditorSaveRequestSchema,
  NoteEditorSaveResultSchema,
  NoteOpenSourceReferenceRequestSchema,
  NoteOpenSourceReferenceResultSchema,
  OperationRecordSchema,
  OcrLanguagePreferenceRequestSchema,
  OcrLanguagePreferenceResultSchema,
  OcrLanguagePreferenceSummarySchema,
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
  RequirementIdSchema,
  ReaderSelectionCreateNoteRequestSchema,
  ReaderSelectionCreateNoteResultSchema,
  ReaderSelectionProposalDecisionResultSchema,
  RetrievalSearchResultSchema,
  SetThemeRequestSchema,
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
  SourceRecordSchema,
  TaskExecutionPlanSchema,
  TaskExecutionPlanSummarySchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema,
  ToolchainManifestSchema,
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
  it("keeps machine-local diagnostics clear pathless, bounded, and all-or-current", () => {
    const request = {
      apiVersion: 1,
      requestId: "diagclearreq_abcdefghijklmnop"
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
    for (const privateField of ["activeVaultId", "path", "body", "expectedRevision"] as const) {
      expect(() => DiagnosticsClearLocalRequestSchema.parse({ ...request, [privateField]: "private" }))
        .toThrow();
    }
    for (const status of ["cleared", "busy"] as const) {
      expect(DiagnosticsClearLocalResultSchema.parse({ ...request, status, health }))
        .toEqual({ ...request, status, health });
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
    for (const invalidInput of [
      { ...inputColumn, logicalType: "string" as const },
      { ...inputColumn, sourceType: "xlsx.formula.number" },
      { ...inputColumn, calculation }
    ]) {
      expect(() => DatasetTableSchema.parse({ ...table, columns: [invalidInput, formulaColumn] }))
        .toThrow("editable non-formula numeric columns");
    }
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
    })).toThrow("editable non-formula numeric columns");

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
    })).toThrow("editable non-formula numeric columns");

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
    for (const kind of ["add_collection_relation", "update_collection_relation_cell"] as const) {
      expect(OperationRecordSchema.parse({
        id: kind === "add_collection_relation" ? "op_20260729_relationadd01" : "op_20260729_relationedit1",
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
        repairContextId
      }],
      truncated: false
    } as const;
    expect(KnowledgeHealthRunResultSchema.parse(eligibleReport)).toEqual(eligibleReport);
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      coverage: "partial",
      invalidPageCount: 1
    })).toThrow();
    expect(() => KnowledgeHealthRunResultSchema.parse({
      ...eligibleReport,
      counts: { ...eligibleReport.counts, unresolvedLinkCount: 2 },
      issues: [{ ...eligibleReport.issues[0], unresolvedLinkCount: 2 }]
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
      indexGeneration,
      issueKind: "broken_link",
      pageId: eligibleReport.issues[0].page.pageId,
      action: "unlink_broken_reference",
      repairContextId
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
    expect(ReferencedOriginalReconnectResultSchema.parse({ ...request, status: "reconnected", job }))
      .toEqual({ ...request, status: "reconnected", job });
    for (const status of ["cancelled", "stale", "not_found", "failed"] as const) {
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
        action: "translate"
      }
    };

    expect(ConversationEventSchema.parse(event).inputPresentation).toEqual({
      kind: "reader_selection_transform",
      action: "translate"
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

  it("validates pathless Activity page and Memory target projections", () => {
    const result = KnowledgeActivityListResultSchema.parse({
      scannedAt: "2026-07-18T00:00:00.000Z",
      activeVaultId: "vault_20260718_activitysafe",
      total: 1,
      invalidOperationCount: 0,
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
      revision: 4
    });
    expect(SetThemeRequestSchema.parse({ themePreference: "light", expectedRevision: 4 })).toEqual({
      themePreference: "light",
      expectedRevision: 4
    });
    expect(AppearanceThemeMutationResultSchema.parse({ status: "stale", settings: summary }).status).toBe("stale");
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
    const stageRequest = { apiVersion: 1, requestId, sourceUrl } as const;
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
    const stageResult = { status: "ready", requestId, staged } as const;
    expect(SkillStageFromUrlResultSchema.parse(stageResult)).toEqual(stageResult);
    for (const unsafe of [{ body: "private" }, { path: "/tmp/staged" }, { sourceBytes: "private" }]) {
      expect(() => SkillStageFromUrlResultSchema.parse({ ...stageResult, ...unsafe })).toThrow();
    }

    const installRequest = {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      bundleSha256: manifestSha256,
      expectedRegistryRevision: 4,
      enabled: true
    } as const;
    expect(SkillInstallStagedRequestSchema.parse(installRequest)).toEqual(installRequest);
    const registry = { apiVersion: 1, revision: 5, invalidManifestCount: 0, skills: [], restorableSkills: [] } as const;
    expect(SkillInstallStagedResultSchema.parse({ status: "committed", requestId, registry }))
      .toEqual({ status: "committed", requestId, registry });

    const discardRequest = { apiVersion: 1, requestId, stagingId, manifestSha256, bundleSha256: manifestSha256 } as const;
    expect(SkillDiscardStagedRequestSchema.parse(discardRequest)).toEqual(discardRequest);
    expect(SkillDiscardStagedResultSchema.parse({ status: "discarded", requestId }))
      .toEqual({ status: "discarded", requestId });
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
      canUpdate: false,
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
      { ...installed, canExport: true },
      { ...installed, canUpdate: true }
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
      restoreContextId: restorable.restoreContextId,
      skillId: restorable.skillId,
      expectedRegistryRevision: registry.revision
    } as const;
    expect(SkillRestoreRequestSchema.parse(request)).toEqual(request);
    const identity = {
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
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
