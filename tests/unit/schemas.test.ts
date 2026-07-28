import { describe, expect, it } from "vitest";
import {
  AgentConversationTurnSummarySchema,
  AgentSubmitTurnResultSchema,
  AppearanceSettingsSummarySchema,
  AppearanceThemeMutationResultSchema,
  BackupReconnectDependencyRequestSchema,
  BackupReconnectDependencyResultSchema,
  COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES,
  CollectionAddNullableColumnRequestSchema,
  CollectionAddNullableColumnResultSchema,
  ConfirmationProposalSchema,
  CollectionAppendDefaultRowRequestSchema,
  CollectionAppendDefaultRowResultSchema,
  CollectionCreateViewRequestSchema,
  CollectionCreateViewResultSchema,
  CollectionOpenRequestSchema,
  CollectionOpenResultSchema,
  CollectionRenameColumnRequestSchema,
  CollectionRenameColumnResultSchema,
  CollectionTrashColumnRequestSchema,
  CollectionTrashColumnResultSchema,
  CollectionTrashRowRequestSchema,
  CollectionTrashRowResultSchema,
  CurrentNoteAppendProposalDecisionResultSchema,
  ConversationEventSchema,
  FixtureManifestSchema,
  HighRiskConfirmationSummarySchema,
  JobRecordSchema,
  KnowledgeActivityListResultSchema,
  KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES,
  KnowledgeHealthRunRequestSchema,
  KnowledgeHealthRunResultSchema,
  KnowledgeHealthRepairRequestSchema,
  KnowledgeHealthRepairResultSchema,
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
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageRegistryQueryResultSchema,
  RequirementIdSchema,
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
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillUninstallRequestSchema,
  SourceRecordSchema,
  TaskExecutionPlanSchema,
  TaskExecutionPlanSummarySchema,
  TaskInteractionOpenRequestSchema,
  TaskInteractionOpenResultSchema,
  TaskInteractionPendingResultSchema,
  ToolchainManifestSchema,
  VaultConfigSchema,
  VaultManifestSchema,
  VaultRevealResultSchema,
  WindowLayoutRequestSchema,
  WindowLayoutStateSchema
} from "@pige/schemas";

describe("schemas", () => {
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
        { columnId: "column_abcdef123456", label: "Status", logicalType: "string", canRename: true, canTrash: true },
        { columnId: "column_bcdefa123456", label: "Updated", logicalType: "datetime", canRename: true, canTrash: true }
      ],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
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
      columns: [{ columnId: "column_abcdef123456", label: "Notes", logicalType: "string", canRename: true, canTrash: true }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
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
      columns: [{ columnId: "column_abcdef123456", label: "Title", logicalType: "string", canRename: true, canTrash: true }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
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
          { columnId: "column_bcdefa123456", label: "Notes", logicalType: "string" as const, canRename: true, canTrash: true }
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
      columns: [{ columnId: request.columnId, label: "Renamed notes", logicalType: "string", canRename: true, canTrash: true }],
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
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
      canTrash: true
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
      columns: [{ columnId: "column_abcdef123456", label: "Notes", logicalType: "string", canRename: true, canTrash: true }],
      rows: [currentRow],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      canAppendDefaultRow: true,
      canAddColumn: true,
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
        trust: "community"
      }]
    } as const;
    expect(PiPackageRegistryQueryResultSchema.parse({ status: "ready", registry }))
      .toEqual({ status: "ready", registry });

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
      expectedRegistryRevision: 4,
      enabled: true
    } as const;
    expect(SkillInstallStagedRequestSchema.parse(installRequest)).toEqual(installRequest);
    const registry = { apiVersion: 1, revision: 5, invalidManifestCount: 0, skills: [] } as const;
    expect(SkillInstallStagedResultSchema.parse({ status: "committed", requestId, registry }))
      .toEqual({ status: "committed", requestId, registry });

    const discardRequest = { apiVersion: 1, requestId, stagingId, manifestSha256 } as const;
    expect(SkillDiscardStagedRequestSchema.parse(discardRequest)).toEqual(discardRequest);
    expect(SkillDiscardStagedResultSchema.parse({ status: "discarded", requestId }))
      .toEqual({ status: "discarded", requestId });
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
    const registry = { apiVersion: 1, revision: 6, invalidManifestCount: 0, skills: [skill] } as const;
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
});
