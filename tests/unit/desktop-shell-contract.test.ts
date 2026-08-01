import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRELOAD_ENTRY_FILENAME } from "../../apps/desktop/src/shared/preload-entry";
import {
  OFFICE_PARSER_WORKER_ENTRY_NAME,
  OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH
} from "../../apps/desktop/src/shared/office-parser-entry";
import {
  PDF_PARSER_WORKER_ENTRY_NAME,
  PDF_PARSER_WORKER_ENTRY_RELATIVE_PATH
} from "../../apps/desktop/src/shared/pdf-parser-entry";
import {
  WEB_EXTRACTOR_WORKER_ENTRY_NAME,
  WEB_EXTRACTOR_WORKER_ENTRY_RELATIVE_PATH
} from "../../apps/desktop/src/shared/web-extractor-entry";
import { getWindowShellOptions } from "../../apps/desktop/src/main/window-shell-options";

describe("desktop shell build contract", () => {
  it("pushes strict renderer-safe durable Job changes through one typed channel", () => {
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const eventServiceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/job-state-event-service.ts"), "utf8"
    );

    expect(schemasSource).toContain('JOB_CHANGED_EVENT_CHANNEL = "jobs.changed"');
    expect(schemasSource).toContain("JobChangedEventSchema");
    expect(contractsSource).toContain("readonly onChanged: (listener: (event: JobChangedEvent)");
    expect(preloadSource).toContain("JobChangedEventSchema.parse(value)");
    expect(preloadSource).toContain("ipcRenderer.on(JOB_CHANGED_EVENT_CHANNEL, wrapped)");
    expect(mainSource).toContain("new JobStateEventService(");
    expect(mainSource).toContain("window.webContents.send(JOB_CHANGED_EVENT_CHANNEL, event)");
    expect(eventServiceSource).toContain("subscribeJobRecordCommits");
    for (const privateField of ["path:", "body:", "providerId:", "modelId:", "toolPayload:", "secret:"]) {
      expect(schemasSource.slice(
        schemasSource.indexOf("export const JobChangedSummarySchema"),
        schemasSource.indexOf("const AgentIngestStatementSchema")
      )).not.toContain(privateField);
    }
  });

  it("starts and cleanly closes the machine-local crash recovery session", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).toContain("crashRecoveryService.beginSession()");
    expect(mainSource).toContain("crashRecoveryService?.markClean()");
    expect(mainSource).toContain("getCrashRecoveryService().observe({ jobsRecovered: recovery.requeued");
    expect(mainSource).toContain("getCrashRecoveryService().complete()");
    expect(mainSource).toContain("crashRecoverySummary: () => getCrashRecoveryService().summary()");
  });

  it("keeps related-page navigation stable-ID-only and operational-path-free", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const relatedContract = contractsSource.slice(
      contractsSource.indexOf("export interface LibraryRelatedPageSummary"),
      contractsSource.indexOf("export interface LibraryRelatedResult")
    );
    const databaseSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/local-database-service.ts"), "utf8"
    );
    const rendererSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/ReaderNoteRelatedPanel.tsx"), "utf8"
    );

    expect(relatedContract).toContain('readonly pageId: LibraryPageSummary["pageId"]');
    expect(relatedContract).toContain('readonly updatedAt: LibraryPageSummary["updatedAt"]');
    for (const privateField of ["pagePath", "sourceIds", "target", "body", "path:"]) {
      expect(relatedContract).not.toContain(privateField);
    }
    expect(databaseSource).toContain("const { pageId, title, pageType, status, updatedAt } = rowToSummary(row)");
    expect(rendererSource).toContain("props.t(`note.relatedType.${page.relationType}`)");
    expect(rendererSource).not.toContain("page.summary.pagePath");
    expect(rendererSource).not.toContain("page.target");
  });

  it("composes image source refresh with the local OCR owner", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const composition = mainSource.slice(
      mainSource.indexOf("const getSourceRefreshService"),
      mainSource.indexOf("const getDatasetService")
    );
    expect(composition).toContain("new SourceRefreshService(");
    expect(composition).toContain("getDocumentParserService()");
    expect(composition).toContain("getOcrService()");
  });

  it("freezes one strict pathless durable conversation title mutation", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-conversation-history-ipc.ts"), "utf8"
    );
    const titleSchemas = schemasSource.slice(
      schemasSource.indexOf("export const AgentConversationTitleSchema"),
      schemasSource.indexOf("export const AgentConversationMessageSchema")
    );
    expect(titleSchemas).toContain("expectedTailEventId: ConversationEventIdSchema");
    expect(titleSchemas).toContain("expectedTitleRevision:");
    expect(titleSchemas).toContain("title: AgentConversationTitleSchema.nullable()");
    expect(contractsSource).toContain("readonly setConversationTitle: (");
    expect(preloadSource).toContain("AgentConversationSetTitleRequestSchema.parse(request)");
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.setConversationTitle", parsedRequest)');
    expect(preloadSource).toContain("Invalid conversation title response identity.");
    expect(mainSource).toContain("registerConversationHistoryIpc({");
    expect(registrarSource).toContain('options.ipcMain.handle("agent.setConversationTitle"');
    expect(registrarSource).toContain("options.assertWriterLease(active.vaultPath)");
    for (const privateField of ["path:", "body:", "providerId:", "modelId:", "toolPayload:", "secret:"]) {
      expect(titleSchemas).not.toMatch(new RegExp(`\\n  ${privateField}`, "u"));
    }
  });

  it("loads Provider credentials from app data without invoking the OS keychain", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const storeSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/secret-store.ts"),
      "utf8"
    );

    expect(mainSource).not.toMatch(/\bsafeStorage\b/u);
    expect(mainSource).toContain('new JsonSecretStore(app.getPath("userData"))');
    expect(storeSource).toContain("const resolved = path.resolve(userDataPath)");
    expect(storeSource).toContain('path.join(resolved, "secrets.json")');
    expect(storeSource).toContain("schemaVersion: z.literal(2)");
    expect(storeSource).not.toContain(".encryptString(");
    expect(storeSource).not.toContain(".decryptString(");
  });

  it("freezes one pathless current-note replacement proposal surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const replaceSchemas = schemasSource.slice(
      schemasSource.indexOf("export const CurrentNoteReplaceProposalIdSchema"),
      schemasSource.indexOf("export const ReaderSelectionActionRequestIdSchema")
    );
    const agentApi = contractsSource.slice(
      contractsSource.indexOf("readonly agent: {"),
      contractsSource.indexOf("readonly jobs: {")
    );

    expect(replaceSchemas).toContain('kind: z.literal("replace_current_note")');
    expect(replaceSchemas).toContain('kind: z.enum(["context", "removed", "added"])');
    expect(replaceSchemas).toContain("text: z.string().min(1).max(160)");
    expect(replaceSchemas).toContain("lines: z.array(CurrentNoteReplaceProposalLineSchema).max(8)");
    expect(replaceSchemas).toContain('status: z.literal("not_found")');
    expect(agentApi).toContain("readonly currentNoteReplaceProposal: (");
    expect(agentApi).toContain("request: CurrentNoteReplaceProposalGetRequest");
    expect(agentApi).toContain("readonly decideCurrentNoteReplaceProposal: (");
    expect(agentApi).toContain("request: CurrentNoteReplaceProposalDecisionRequest");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n        "agent.currentNoteReplaceProposal"');
    expect(preloadSource).toContain('ipcRenderer.invoke(\n        "agent.decideCurrentNoteReplaceProposal"');
    expect(preloadSource).toContain("CurrentNoteReplaceProposalGetRequestSchema.parse(request)");
    expect(preloadSource).toContain("CurrentNoteReplaceProposalDecisionRequestSchema.parse(request)");
    for (const privateField of [
      "pageId",
      "renderContextId",
      "replacementMarkdown",
      "pagePath",
      "contentHash",
      "rawRefs"
    ]) {
      expect(replaceSchemas).not.toContain(privateField);
    }
  });

  it("freezes one Main-owned pathless bundled-toolchain repair action", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const systemApi = contractsSource.slice(
      contractsSource.indexOf("readonly system: {"),
      contractsSource.indexOf("readonly speech: {")
    );

    expect(schemasSource).toContain(
      'TOOLCHAIN_REPAIR_CHANNEL = "system.repairToolchain"'
    );
    expect(schemasSource).toContain("ToolchainRepairEligibilitySchema");
    expect(schemasSource).toContain("expectedHealthId: ToolchainHealthIdSchema");
    expect(schemasSource).toContain(
      "expectedMissingRequiredToolIds: ToolchainMissingRequiredToolIdsSchema"
    );
    expect(schemasSource).toContain('["opened", "stale", "not_needed", "failed"]');
    expect(contractsSource).toContain("readonly repair?: ToolchainRepairEligibility;");
    expect(systemApi).toContain("readonly repairToolchain: (");
    expect(systemApi).toContain("request: ToolchainRepairRequest");
    expect(systemApi).toContain(") => Promise<ToolchainRepairResult>;");
    expect(preloadSource).toContain("ToolchainRepairRequestSchema.parse(request)");
    expect(preloadSource).toContain(
      "await ipcRenderer.invoke(TOOLCHAIN_REPAIR_CHANNEL, parsedRequest)"
    );
    expect(preloadSource).toContain("ToolchainRepairResultSchema.parse(");
    expect(preloadSource).toContain("Invalid toolchain repair response identity.");
    for (const privateField of [
      "resolvedPath",
      "repairHint",
      "releaseUrl",
      "path",
      "body"
    ]) {
      expect(systemApi).not.toContain(privateField);
    }
  });

  it("freezes one strict pathless Library tag browsing channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const readerIpcSource = fs.readFileSync(path.resolve("apps/desktop/src/main/register-reader-ipc.ts"), "utf8");
    const libraryApi = contractsSource.slice(
      contractsSource.indexOf("readonly library: {"),
      contractsSource.indexOf("readonly notes: {")
    );

    expect(schemasSource).toContain('LIBRARY_TAGS_CHANNEL = "library.tags"');
    expect(schemasSource).toContain('LIBRARY_RENAME_TAG_CHANNEL = "library.renameTag"');
    expect(schemasSource).toContain('LIBRARY_MERGE_TAG_CHANNEL = "library.mergeTag"');
    expect(schemasSource).toContain('LIBRARY_REMOVE_TAG_CHANNEL = "library.removeTag"');
    expect(schemasSource).toContain('LIBRARY_REMOVE_PAGE_TAG_CHANNEL = "library.removePageTag"');
    expect(schemasSource).toContain('LIBRARY_RENAME_TOPIC_CHANNEL = "library.renameTopic"');
    expect(schemasSource).toContain("LibraryTagsRequestSchema");
    expect(schemasSource).toContain('mode: z.literal("list_tags")');
    expect(schemasSource).toContain('mode: z.literal("list_pages_for_tag")');
    expect(schemasSource).toContain("LibraryTagsSnapshotIdSchema");
    expect(schemasSource).toContain("LibraryTagsCursorSchema");
    expect(libraryApi).toContain(
      "readonly tags: (request: LibraryTagsRequest) => Promise<LibraryTagsResult>;"
    );
    expect(libraryApi).toContain(
      "readonly renameTag: (request: LibraryRenameTagRequest) => Promise<LibraryRenameTagResult>;"
    );
    expect(libraryApi).toContain(
      "readonly mergeTag: (request: LibraryMergeTagRequest) => Promise<LibraryMergeTagResult>;"
    );
    expect(libraryApi).toContain(
      "readonly removeTag: (request: LibraryRemoveTagRequest) => Promise<LibraryRemoveTagResult>;"
    );
    expect(libraryApi).toContain(
      "readonly removePageTag: (request: LibraryRemovePageTagRequest) => Promise<LibraryRemovePageTagResult>;"
    );
    expect(libraryApi).toContain(
      "readonly renameTopic: (request: LibraryRenameTopicRequest) => Promise<LibraryRenameTopicResult>;"
    );
    expect(preloadSource).toContain("LibraryTagsRequestSchema.parse(request)");
    expect(preloadSource).toContain(
      "await ipcRenderer.invoke(LIBRARY_TAGS_CHANNEL, parsedRequest)"
    );
    expect(preloadSource).toContain("LibraryTagsResultSchema.parse(");
    expect(preloadSource).toContain("LibraryRenameTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("LibraryRenameTagResultSchema.parse(");
    expect(preloadSource).toContain("LibraryMergeTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("LibraryMergeTagResultSchema.parse(");
    expect(preloadSource).toContain("LibraryRemoveTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("LibraryRemoveTagResultSchema.parse(");
    expect(preloadSource).toContain("LibraryRemovePageTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("LibraryRemovePageTagResultSchema.parse(");
    expect(preloadSource).toContain("LibraryRenameTopicRequestSchema.parse(request)");
    expect(preloadSource).toContain("LibraryRenameTopicResultSchema.parse(");
    const renameHandler = mainSource.slice(
      mainSource.indexOf("ipcMain.handle(LIBRARY_RENAME_TAG_CHANNEL"),
      mainSource.indexOf("registerReaderIpc({")
    );
    expect(renameHandler).toContain("LibraryRenameTagRequestSchema.parse(request)");
    expect(renameHandler).toContain("LibraryRenameTagResultSchema.parse(getLibraryTagRenameService().rename(parsed))");
    expect(readerIpcSource).toContain("options.ipcMain.handle(LIBRARY_RENAME_TOPIC_CHANNEL");
    expect(readerIpcSource).toContain("LibraryRenameTopicRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("getLibraryTopicRenameService().rename(ownerId, parsed)");
    expect(renameHandler.indexOf("LibraryRenameTagRequestSchema.parse(request)"))
      .toBeLessThan(renameHandler.indexOf("getLibraryTagRenameService().rename(parsed)"));
    expect(renameHandler).toContain("LibraryMergeTagRequestSchema.parse(request)");
    expect(renameHandler).toContain("LibraryMergeTagResultSchema.parse(getLibraryTagRenameService().merge(parsed))");
    expect(renameHandler.indexOf("LibraryMergeTagRequestSchema.parse(request)"))
      .toBeLessThan(renameHandler.indexOf("getLibraryTagRenameService().merge(parsed)"));
    expect(renameHandler).toContain("LibraryRemoveTagRequestSchema.parse(request)");
    expect(renameHandler).toContain("LibraryRemoveTagResultSchema.parse(getLibraryTagRenameService().remove(parsed))");
    expect(renameHandler).toContain("LibraryRemovePageTagRequestSchema.parse(request)");
    expect(renameHandler).toContain("LibraryRemovePageTagResultSchema.parse(getLibraryTagRenameService().removeFromPage(parsed))");
    expect(preloadSource).toContain("Invalid Library tags response identity.");
    for (const privateField of [
      "pagePath",
      "sourceIds",
      "checksum",
      "indexRowId",
      "sourceBody"
    ]) {
      expect(libraryApi).not.toContain(privateField);
    }
  });

  it("freezes one Main-owned pathless Markdown note import surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const notesApiStart = contractsSource.indexOf("readonly notes: {");
    const notesApi = contractsSource.slice(
      notesApiStart,
      contractsSource.indexOf("readonly localCapabilities: {", notesApiStart)
    );
    const importSchemas = schemasSource.slice(
      schemasSource.indexOf("export const NOTE_IMPORT_MARKDOWN_CHANNEL"),
      schemasSource.indexOf("export const NoteArchiveCurrentRequestSchema")
    );
    expect(importSchemas).toContain('NOTE_IMPORT_MARKDOWN_CHANNEL = "notes.importMarkdown"');
    expect(importSchemas).toContain("activeVaultId: VaultIdSchema");
    expect(importSchemas).toContain('["cancelled", "stale", "invalid", "failed"]');
    expect(importSchemas).toContain("operationId: OperationIdSchema");
    expect(importSchemas).toContain("render: NoteRenderResultSchema");
    expect(notesApi).toContain("readonly importMarkdown: (");
    expect(preloadSource).toContain("NoteImportMarkdownRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteImportMarkdownResultSchema.parse(");
    for (const privateField of ["path", "body", "markdown", "checksum", "sourceId"]) {
      expect(importSchemas).not.toContain(privateField);
      expect(notesApi.slice(notesApi.indexOf("readonly importMarkdown:"), notesApi.indexOf("readonly archiveCurrent:")))
        .not.toContain(privateField);
    }
  });

  it("freezes one current-Reader-bound whole-note relation surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const notesApiStart = contractsSource.indexOf("readonly notes: {");
    const notesApi = contractsSource.slice(notesApiStart, contractsSource.indexOf("readonly localCapabilities: {", notesApiStart));
    const relationSchemas = schemasSource.slice(
      schemasSource.indexOf("export const NOTE_RELATE_CHANNEL"),
      schemasSource.indexOf("export const KnowledgeHealthRepairRequestSchema"),
    );
    expect(relationSchemas).toContain('NOTE_RELATE_CHANNEL = "notes.relate"');
    expect(relationSchemas).toContain('NOTE_UNLINK_RELATION_CHANNEL = "notes.unlinkRelation"');
    expect(relationSchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(relationSchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(relationSchemas).toContain("expectedTargetUpdatedAt: z.string().datetime({ offset: true })");
    expect(notesApi).toContain("readonly relate: (request: NoteRelateRequest) => Promise<NoteRelateResult>;");
    expect(notesApi).toContain("readonly unlinkRelation: (request: NoteUnlinkRelationRequest) => Promise<NoteUnlinkRelationResult>;");
    expect(preloadSource).toContain("NoteRelateRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteRelateResultSchema.parse(");
    expect(preloadSource).toContain("NoteUnlinkRelationRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteUnlinkRelationResultSchema.parse(");
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "relationType"]) {
      expect(relationSchemas).not.toContain(privateField);
    }
  });

  it("freezes one pathless current-Reader question-state mutation", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const questionSchemas = schemasSource.slice(
      schemasSource.indexOf('NOTE_SET_QUESTION_STATE_CHANNEL = "notes.setQuestionState"'),
      schemasSource.indexOf("export const NoteAddTagRequestSchema")
    );
    expect(questionSchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(questionSchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(schemasSource).toContain('NoteQuestionStateSchema = z.enum(["open", "partially_answered", "answered", "stale"])');
    expect(schemasSource).toContain('NOTE_SET_CLAIM_CONFIDENCE_CHANNEL = "notes.setClaimConfidence"');
    expect(schemasSource).toContain('NoteClaimConfidenceSchema = z.enum(["low", "medium", "high"])');
    expect(contractsSource).toContain("readonly setQuestionState: (");
    expect(contractsSource).toContain("readonly setClaimConfidence: (");
    expect(preloadSource).toContain("NoteSetQuestionStateRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteSetQuestionStateResultSchema.parse(");
    expect(preloadSource).toContain("NoteSetClaimConfidenceRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteSetClaimConfidenceResultSchema.parse(");
    expect(appSource.match(/onSetQuestionState=\{\(request\) => window\.pige\.notes\.setQuestionState\(request\)\}/gu))
      .toHaveLength(2);
    expect(appSource.match(/onSetClaimConfidence=\{\(request\) => window\.pige\.notes\.setClaimConfidence\(request\)\}/gu))
      .toHaveLength(2);
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "rawError"]) {
      expect(questionSchemas).not.toContain(privateField);
    }
  });

  it("freezes one pathless current-Reader Entity type correction", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const entitySchemas = schemasSource.slice(
      schemasSource.indexOf('NOTE_SET_ENTITY_TYPE_CHANNEL = "notes.setEntityType"'),
      schemasSource.indexOf("const NoteQuestionAnswerOwnerSchema")
    );
    expect(entitySchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(entitySchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(schemasSource).toContain('"person", "organization", "product", "place", "project", "event", "other"');
    expect(contractsSource).toContain("readonly setEntityType: (");
    expect(preloadSource).toContain("NoteSetEntityTypeRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteSetEntityTypeResultSchema.parse(");
    expect(appSource.match(/onSetEntityType=\{\(request\) => window\.pige\.notes\.setEntityType\(request\)\}/gu))
      .toHaveLength(2);
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "rawError"]) {
      expect(entitySchemas).not.toContain(privateField);
    }
  });

  it("freezes pathless current-Reader question answer search and exact mutation", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const answerSchemas = schemasSource.slice(
      schemasSource.indexOf('NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL = "notes.searchQuestionAnswers"'),
      schemasSource.indexOf("export const NoteAddTagRequestSchema")
    );
    expect(answerSchemas).toContain('NOTE_CHANGE_QUESTION_ANSWER_CHANNEL = "notes.changeQuestionAnswer"');
    expect(answerSchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(answerSchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(answerSchemas).toContain("expectedTargetUpdatedAt: z.string().datetime({ offset: true })");
    expect(contractsSource).toContain("readonly searchQuestionAnswers:");
    expect(contractsSource).toContain("readonly changeQuestionAnswer:");
    expect(preloadSource).toContain("NoteSearchQuestionAnswersRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteChangeQuestionAnswerRequestSchema.parse(request)");
    expect(appSource.match(/onSearchQuestionAnswers=\{\(request\) => window\.pige\.notes\.searchQuestionAnswers\(request\)\}/gu))
      .toHaveLength(2);
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "rawError"]) {
      expect(answerSchemas).not.toContain(privateField);
    }
  });
  it("freezes pathless current-Reader Entity mention search and exact mutation", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const mentionSchemas = schemasSource.slice(
      schemasSource.indexOf("const NoteEntityMentionOwnerSchema"),
      schemasSource.indexOf("const NoteQuestionAnswerOwnerSchema")
    );
    expect(schemasSource).toContain('NOTE_SEARCH_ENTITY_MENTIONS_CHANNEL = "notes.searchEntityMentions"');
    expect(schemasSource).toContain('NOTE_CHANGE_ENTITY_MENTION_CHANNEL = "notes.changeEntityMention"');
    expect(mentionSchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(mentionSchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(mentionSchemas).toContain("expectedTargetUpdatedAt: z.string().datetime({ offset: true })");
    expect(contractsSource).toContain("readonly searchEntityMentions:");
    expect(contractsSource).toContain("readonly changeEntityMention:");
    expect(preloadSource).toContain("NoteSearchEntityMentionsRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteChangeEntityMentionRequestSchema.parse(request)");
    expect(appSource.match(/onSearchEntityMentions=\{\(request\) => window\.pige\.notes\.searchEntityMentions\(request\)\}/gu))
      .toHaveLength(2);
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "rawError"]) {
      expect(mentionSchemas).not.toContain(privateField);
    }
  });
  it("freezes pathless Claim contradiction search and mutation authority", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const claimSchemas = schemasSource.slice(
      schemasSource.indexOf('NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL = "notes.searchClaimContradictions"'),
      schemasSource.indexOf("export const NoteAddTagRequestSchema")
    );
    expect(claimSchemas).toContain('NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL = "notes.changeClaimContradiction"');
    expect(claimSchemas).toContain("renderContextId: NoteRenderContextIdSchema");
    expect(claimSchemas).toContain("expectedRevision: NoteEditorRevisionSchema");
    expect(claimSchemas).toContain("expectedTargetUpdatedAt");
    expect(contractsSource).toContain("readonly searchClaimContradictions: (");
    expect(contractsSource).toContain("readonly changeClaimContradiction: (");
    expect(preloadSource).toContain("NoteSearchClaimContradictionsRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteChangeClaimContradictionResultSchema.parse(");
    for (const privateField of ["absolutePath", "pagePath", "body", "markdown", "checksum", "rawError"]) {
      expect(claimSchemas).not.toContain(privateField);
    }
  });

  it("freezes one Main-owned machine-local diagnostics clear channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const diagnosticsIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-diagnostics-ipc.ts"),
      "utf8"
    );
    const diagnosticsApi = contractsSource.slice(
      contractsSource.indexOf("readonly diagnostics: {"),
      contractsSource.indexOf("readonly models: {")
    );

    expect(schemasSource).toContain(
      'DIAGNOSTICS_CLEAR_LOCAL_CHANNEL = "diagnostics.clearLocalDiagnostics"'
    );
    expect(schemasSource).toContain("DiagnosticsClearLocalRequestSchema");
    expect(schemasSource).toContain('status: z.literal("cleared")');
    expect(schemasSource).toContain('status: z.literal("busy")');
    expect(diagnosticsApi).toContain("readonly clearLocalDiagnostics: (");
    expect(diagnosticsApi).toContain("request: DiagnosticsClearLocalRequest");
    expect(diagnosticsApi).toContain(") => Promise<DiagnosticsClearLocalResult>;");
    expect(preloadSource).toContain("DiagnosticsClearLocalRequestSchema.parse(request)");
    expect(preloadSource).toContain("DiagnosticsClearLocalResultSchema.parse(");
    expect(preloadSource).toContain("DIAGNOSTICS_CLEAR_LOCAL_CHANNEL");
    expect(mainSource).toContain("registerDiagnosticsIpc({");
    expect(mainSource).toContain("const result = getDiagnosticsLifecycleService().clear(request)");
    expect(mainSource).toContain('if (result.status === "cleared") {');
    expect(mainSource).toContain("getCrashRecoveryService().clearSummary()");
    expect(mainSource).toContain("health: getDiagnosticsService().health()");
    expect(diagnosticsIpcSource).toContain("DiagnosticsClearLocalRequestSchema.parse(input)");
    expect(diagnosticsIpcSource).toContain("options.isTrustedSender(event.sender)");
    expect(diagnosticsIpcSource).toContain("await options.clear(request)");
    expect(diagnosticsIpcSource).not.toMatch(/sourceId|rootId|filePath/);
    for (const privateField of ["path", "body", "outputPath"]) {
      expect(diagnosticsApi).not.toContain(privateField);
    }
  });

  it("freezes one Main-owned pathless managed-copy root configuration channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const vaultApi = contractsSource.slice(
      contractsSource.indexOf("readonly vault: {"),
      contractsSource.indexOf("readonly maintenance: {")
    );

    expect(schemasSource).toContain(
      'MANAGED_COPY_ROOT_CONFIGURE_CHANNEL = "vault.configureManagedCopyRoot"'
    );
    expect(schemasSource).toContain("ManagedCopyRootConfigureRequestSchema");
    expect(schemasSource).toContain("expectedSourceStorageRevision: SourceStorageRevisionSchema");
    expect(schemasSource).toContain("An external managed-copy root must project a safe label, never its path.");
    expect(contractsSource).toContain("readonly managedCopyRoot: ManagedCopyRootSummary;");
    expect(vaultApi).toContain("readonly configureManagedCopyRoot: (");
    expect(vaultApi).toContain("request: ManagedCopyRootConfigureRequest");
    expect(vaultApi).toContain(") => Promise<ManagedCopyRootConfigureResult>;");
    expect(preloadSource).toContain("ManagedCopyRootConfigureRequestSchema.parse(request)");
    expect(preloadSource).toContain("MANAGED_COPY_ROOT_CONFIGURE_CHANNEL");
    expect(preloadSource).toContain("Invalid managed-copy root configuration response identity.");
    for (const privateField of ["absolutePath", "rootId", "sourcePath", "sourceBody", "rawError"]) {
      expect(vaultApi).not.toContain(privateField);
    }
  });

  it("freezes one explicit pathless incomplete Backup continuation channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const backupApi = contractsSource.slice(
      contractsSource.indexOf("readonly backup: {"),
      contractsSource.indexOf("readonly system: {")
    );

    expect(schemasSource).toContain(
      'BACKUP_CONTINUE_INCOMPLETE_CHANNEL = "backup.continueIncomplete"'
    );
    expect(schemasSource).toContain("BackupContinueIncompleteRequestSchema");
    expect(schemasSource).toContain("expectedJobUpdatedAt: z.string().datetime({ offset: true })");
    expect(schemasSource).toContain('"continued", "cancelled", "stale", "not_found", "ineligible", "failed"');
    expect(schemasSource).toContain('"root_binding"');
    expect(contractsSource).toContain("readonly canContinueIncomplete: boolean;");
    expect(contractsSource).toContain("readonly canCancel?: boolean;");
    expect(contractsSource).toContain("readonly canRetry?: boolean;");
    expect(backupApi).toContain("readonly continueIncomplete: (");
    expect(backupApi).toContain("request: BackupContinueIncompleteRequest");
    expect(backupApi).toContain(") => Promise<BackupContinueIncompleteResult>;");
    expect(preloadSource).toContain("BackupContinueIncompleteRequestSchema.parse(request)");
    expect(preloadSource).toContain("BACKUP_CONTINUE_INCOMPLETE_CHANNEL");
    expect(preloadSource).toContain("Invalid incomplete Backup response identity.");
    for (const privateField of ["sourcePath", "absolutePath", "rootId", "sourceBody", "rawError"]) {
      expect(backupApi).not.toContain(privateField);
    }
  });

  it("freezes one pathless currentness-bound Backup destination reconnect channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const backupApi = contractsSource.slice(
      contractsSource.indexOf("readonly backup: {"),
      contractsSource.indexOf("readonly system: {")
    );

    expect(schemasSource).toContain(
      'BACKUP_RECONNECT_DESTINATION_CHANNEL = "backup.reconnectDestination"'
    );
    expect(schemasSource).toContain("BackupReconnectDestinationRequestSchema");
    expect(schemasSource).toContain("expectedJobUpdatedAt: z.string().datetime({ offset: true })");
    expect(schemasSource).toContain('"reconnected", "cancelled", "stale", "not_found", "ineligible", "failed"');
    expect(contractsSource).toContain("readonly canReconnectBackupDestination: boolean;");
    expect(backupApi).toContain("readonly reconnectDestination: (");
    expect(backupApi).toContain("request: BackupReconnectDestinationRequest");
    expect(backupApi).toContain(") => Promise<BackupReconnectDestinationResult>;");
    expect(preloadSource).toContain("BackupReconnectDestinationRequestSchema.parse(request)");
    expect(preloadSource).toContain("BACKUP_RECONNECT_DESTINATION_CHANNEL");
    expect(preloadSource).toContain("Invalid Backup destination reconnect response identity.");
    for (const privateField of ["path", "absolutePath", "rootId", "sourceId", "body", "rawError"]) {
      expect(backupApi).not.toContain(privateField);
    }
  });

  it("freezes one pathless currentness-bound referenced-original reconnect channel", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const jobsApi = contractsSource.slice(
      contractsSource.indexOf("readonly jobs: {"),
      contractsSource.indexOf("readonly confirmations: {")
    );

    expect(schemasSource).toContain(
      'JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL = "jobs.reconnectOriginalSource"'
    );
    expect(schemasSource).toContain("ReferencedOriginalReconnectRequestSchema");
    expect(schemasSource).toContain("expectedJobUpdatedAt: z.string().datetime({ offset: true })");
    expect(schemasSource).toContain('status: z.literal("reconnected")');
    expect(jobsApi).toContain("readonly reconnectOriginalSource: (");
    expect(jobsApi).toContain("request: ReferencedOriginalReconnectRequest");
    expect(jobsApi).toContain(") => Promise<ReferencedOriginalReconnectResult>;");
    expect(preloadSource).toContain("ReferencedOriginalReconnectRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReferencedOriginalReconnectResultSchema.parse(await ipcRenderer.invoke(");
    expect(preloadSource).toContain("JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL");
    for (const privateField of ["sourcePath", "absolutePath", "rootId", "sourceBody", "rawError"]) {
      expect(jobsApi).not.toContain(privateField);
    }
  });

  it("freezes one explicit body-free Vault migration channel without a second open API", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly applyMigration: (");
    expect(contractsSource).toContain("request: VaultMigrationApplyRequest");
    expect(contractsSource).toContain(") => Promise<VaultMigrationApplyResult>;");
    expect(contractsSource).not.toContain("readonly openMigration:");
    expect(contractsSource).not.toContain("readonly migrationPreview:");
    expect(schemasSource).toContain('VAULT_APPLY_MIGRATION_CHANNEL = "vault.applyMigration"');
    expect(schemasSource).toContain("VaultManifestCompatibilityHeaderSchema");
    expect(schemasSource).toContain("VaultMigrationApplyRequestSchema");
    expect(schemasSource).toContain("VaultMigrationApplyResultSchema");
    for (const privateField of ["absolutePath", "manifestBody", "rawError", "backupPath"]) {
      expect(contractsSource.slice(
        contractsSource.indexOf("export type VaultActionResult"),
        contractsSource.indexOf("export interface PigeDesktopApi")
      )).not.toContain(privateField);
    }
  });

  it("bridges one strict managed PaddleOCR lifecycle without private catalog authority", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const apiStart = preloadSource.indexOf("localCapabilities: {");
    const paddleOcrApi = preloadSource.slice(
      apiStart,
      preloadSource.indexOf("retrieval: {", apiStart)
    );

    expect(contractsSource).toContain("readonly localCapabilities: {");
    expect(contractsSource).toContain("readonly paddleOcrSummary:");
    for (const action of ["install", "enable", "test", "disable", "remove"] as const) {
      expect(contractsSource).toContain(`readonly ${action}PaddleOcr:`);
      expect(paddleOcrApi).toContain(`"localCapabilities.${action}PaddleOcr"`);
      const schemaName = `${action[0]?.toUpperCase()}${action.slice(1)}`;
      expect(paddleOcrApi).toContain(`PaddleOcr${schemaName}RequestSchema.parse(request)`);
      expect(paddleOcrApi).toContain(`PaddleOcr${schemaName}ResultSchema.parse(`);
    }
    expect(paddleOcrApi).toContain('"localCapabilities.paddleOcrSummary"');
    expect(paddleOcrApi).toContain("PaddleOcrSummaryRequestSchema.parse(request)");
    expect(paddleOcrApi).toContain("PaddleOcrSummarySchema.parse(");
    for (const privateField of [
      "candidatePath",
      "downloadUrl",
      "sha256",
      "pythonArgs",
      "languagePacks",
      "authority",
      "rawError"
    ]) {
      expect(paddleOcrApi).not.toContain(privateField);
    }
  });

  it("bridges machine-local OCR language preference with strict CAS and body-free failures", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const apiStart = preloadSource.indexOf("localCapabilities: {");
    const localCapabilitiesApi = preloadSource.slice(
      apiStart,
      preloadSource.indexOf("retrieval: {", apiStart)
    );

    expect(contractsSource).toContain("readonly ocrLanguagePreference: (");
    expect(contractsSource).toContain("request: OcrLanguagePreferenceRequest");
    expect(contractsSource).toContain(") => Promise<OcrLanguagePreferenceResult>;");
    expect(contractsSource).toContain("readonly setOcrLanguagePreference: (");
    expect(contractsSource).toContain("request: SetOcrLanguagePreferenceRequest");
    expect(contractsSource).toContain(") => Promise<SetOcrLanguagePreferenceResult>;");
    expect(localCapabilitiesApi).toContain("OCR_LANGUAGE_PREFERENCE_CHANNEL");
    expect(localCapabilitiesApi).toContain("SET_OCR_LANGUAGE_PREFERENCE_CHANNEL");
    expect(localCapabilitiesApi).toContain("OcrLanguagePreferenceRequestSchema.parse(request)");
    expect(localCapabilitiesApi).toContain("OcrLanguagePreferenceResultSchema.parse(");
    expect(localCapabilitiesApi).toContain("SetOcrLanguagePreferenceRequestSchema.parse(request)");
    expect(localCapabilitiesApi).toContain("SetOcrLanguagePreferenceResultSchema.parse(");
    expect(schemasSource).toContain('"localCapabilities.ocrLanguagePreference" as const');
    expect(schemasSource).toContain('"localCapabilities.setOcrLanguagePreference" as const');
    expect(schemasSource).toContain('appliesTo: z.literal("new_ocr_jobs")');
    for (const privateField of ["path", "body", "rawError", "adapterId", "modelFamily"]) {
      expect(localCapabilitiesApi).not.toContain(privateField);
    }
  });

  it("bridges machine-local OCR engine preference into the actual local-capability owner", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const apiStart = preloadSource.indexOf("localCapabilities: {");
    const localCapabilitiesApi = preloadSource.slice(
      apiStart,
      preloadSource.indexOf("retrieval: {", apiStart)
    );

    expect(contractsSource).toContain("readonly ocrEnginePreference: (");
    expect(contractsSource).toContain("request: SetOcrEnginePreferenceRequest");
    expect(localCapabilitiesApi).toContain("OCR_ENGINE_PREFERENCE_CHANNEL");
    expect(localCapabilitiesApi).toContain("SET_OCR_ENGINE_PREFERENCE_CHANNEL");
    expect(localCapabilitiesApi).toContain("OcrEnginePreferenceResultSchema.parse(");
    expect(mainSource).toContain("enginePreference: () => getOcrEnginePreferenceService().preference()");
  });

  it("bridges a bounded Main-owned OCR image test without renderer path authority", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(contractsSource).toContain("readonly testOcrImage: (");
    expect(contractsSource).toContain("request: OcrImageTestRequest");
    expect(preloadSource).toContain("OCR_IMAGE_TEST_CHANNEL");
    expect(preloadSource).toContain("OcrImageTestRequestSchema.parse(request)");
    expect(mainSource).toContain("getOcrImageTestService().run(request, inputPath)");
    expect(preloadSource.slice(preloadSource.indexOf("testOcrImage: async"), preloadSource.indexOf("dictationLanguagePreference: async")))
      .not.toMatch(/path|body|file/u);
  });

  it("bridges Pi package lifecycle and freezes the local curated catalog contract", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const packagesStart = preloadSource.indexOf("piPackages: {");
    const packageApi = preloadSource.slice(
      packagesStart,
      preloadSource.indexOf("taskExecution: {", packagesStart)
    );

    expect(contractsSource).toContain("readonly piPackages: {");
    expect(contractsSource).toContain("readonly summary: () => Promise<PiPackageRegistryQueryResult>");
    expect(contractsSource).toContain("readonly catalogQuery: (");
    expect(contractsSource).toContain("request: PiPackageCatalogQueryRequest");
    expect(contractsSource).toContain("Promise<PiPackageCatalogQueryResult>");
    expect(contractsSource).toContain("request: PiPackageInstallRequest");
    expect(contractsSource).toContain("readonly uninstall: (");
    expect(contractsSource).toContain("request: PiPackageUninstallRequest");
    expect(contractsSource).toContain("Promise<PiPackageUninstallResult>");
    expect(contractsSource).toContain("readonly update: (");
    expect(contractsSource).toContain("request: PiPackageUpdateRequest");
    expect(contractsSource).toContain("Promise<PiPackageUpdateResult>");
    expect(contractsSource).toContain("readonly rollback: (");
    expect(contractsSource).toContain("request: PiPackageRollbackRequest");
    expect(contractsSource).toContain("Promise<PiPackageRollbackResult>");
    expect(contractsSource).toContain("readonly setPinned: (");
    expect(contractsSource).toContain("request: PiPackageSetPinnedRequest");
    expect(contractsSource).toContain("Promise<PiPackageSetPinnedResult>");
    expect(packageApi).toContain('ipcRenderer.invoke("piPackages.summary")');
    expect(packageApi).toContain('"piPackages.install"');
    expect(packageApi).toContain("PiPackageInstallRequestSchema.parse(request)");
    expect(packageApi).toContain("PiPackageInstallResultSchema.parse(await ipcRenderer.invoke");
    expect(packageApi).toContain('"piPackages.uninstall"');
    expect(packageApi).toContain("PiPackageUninstallRequestSchema.parse(request)");
    expect(packageApi).toContain("PiPackageUninstallResultSchema.parse(await ipcRenderer.invoke");
    expect(packageApi).toContain('"piPackages.update"');
    expect(packageApi).toContain("PiPackageUpdateRequestSchema.parse(request)");
    expect(packageApi).toContain("PiPackageUpdateResultSchema.parse(await ipcRenderer.invoke");
    expect(packageApi).toContain('"piPackages.rollback"');
    expect(packageApi).toContain("PiPackageRollbackRequestSchema.parse(request)");
    expect(packageApi).toContain("PiPackageRollbackResultSchema.parse(await ipcRenderer.invoke");
    expect(packageApi).toContain("PiPackageSetPinnedRequestSchema.parse(request)");
    expect(packageApi).toContain("PiPackageSetPinnedResultSchema.parse(await ipcRenderer.invoke");
    for (const privateField of ["path", "tarball", "integrity", "authority", "rawError"]) {
      expect(packageApi).not.toContain(privateField);
    }
  });

  it("strictly bridges the complete pathless Memory lifecycle surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(path.resolve("apps/desktop/src/main/register-memory-ipc.ts"), "utf8");

    for (const method of ["enable", "delete", "export", "reset"] as const) {
      expect(contractsSource).toContain(`readonly ${method}:`);
      expect(preloadSource).toContain(`"memory.${method}"`);
      expect(registrarSource).toContain(`"memory.${method}"`);
    }
    expect(preloadSource).toContain("MemoryEnableRequestSchema.parse(request)");
    expect(contractsSource).toContain("readonly edit:");
    expect(preloadSource).toContain('"memory.edit"');
    expect(preloadSource).toContain("MemoryEditRequestSchema.parse(request)");
    expect(preloadSource).toContain("MemoryDeleteRequestSchema.parse(request)");
    expect(preloadSource).toContain("MemoryExportRequestSchema.parse(request)");
    expect(preloadSource).toContain("MemoryResetRequestSchema.parse(request)");
    expect(preloadSource).toContain("MemoryLifecycleMutationResultSchema.parse(await ipcRenderer.invoke");
    expect(preloadSource).toContain("MemoryExportResultSchema.parse(await ipcRenderer.invoke");
    expect(registrarSource).not.toContain("outputPath:");
    expect(registrarSource).not.toContain("filePath: selection.filePath");
  });

  it("strictly parses durable conversation pagination on both IPC sides", () => {
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(preloadSource).toContain("AgentConversationRequestSchema.parse(normalizedRequest ?? {})");
    expect(preloadSource).toContain("AgentConversationResultSchema.optional().parse(result)");
    expect(mainSource).toContain("AgentConversationRequestSchema.parse(request ?? {})");
    expect(mainSource).toContain("AgentConversationResultSchema.optional().parse(");
  });

  it("freezes one bounded pathless conversation-history search beside the existing open path", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const historySchemas = schemasSource.slice(
      schemasSource.indexOf("export const AgentConversationCursorSchema"),
      schemasSource.indexOf("export const AgentConversationMessageSchema")
    );
    expect(contractsSource).toContain("readonly conversationHistory: (");
    expect(contractsSource).toContain("request: AgentConversationHistoryListRequest");
    expect(contractsSource).toContain(") => Promise<AgentConversationHistoryListResult>;");
    expect(contractsSource).toContain("readonly conversation: {");
    expect(contractsSource).not.toContain("readonly openConversation:");
    expect(historySchemas).toContain("AgentConversationHistoryQuerySchema");
    expect(historySchemas).toContain("query: AgentConversationHistoryQuerySchema.optional()");
    expect(preloadSource).toContain("AgentConversationHistoryListRequestSchema.parse(request)");
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.conversationHistory", parsedRequest)');
    expect(preloadSource).toContain("AgentConversationHistoryListResultSchema.parse(");
    expect(preloadSource).toContain("Invalid conversation history response identity.");
    expect(mainSource).toContain('ipcMain.handle("agent.conversationHistory"');
    expect(mainSource).toContain("AgentConversationHistoryListResultSchema.parse(");
    for (const privateField of ["queryPath", "queryBody", "providerId", "modelId", "toolPayload"]) {
      expect(historySchemas).not.toContain(privateField);
    }
  });

  it("bridges saved-answer note creation through one strict identity-only renderer request", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const schemaBlock = schemasSource.slice(
      schemasSource.indexOf("export const AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL"),
      schemasSource.indexOf("export const AgentConversationTitleSchema")
    );
    expect(contractsSource).toContain("readonly saveAnswerAsNote: (");
    expect(preloadSource).toContain("AgentSaveAnswerAsNoteRequestSchema.parse(request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL, parsedRequest)");
    expect(mainSource).toContain("ipcMain.handle(AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL");
    expect(mainSource).toContain("getAssistantAnswerNoteService().save(");
    for (const privateField of ["body:", "answer:", "title:", "path:", "contentHash:", "sourceRefs:"]) {
      expect(schemaBlock).not.toContain(privateField);
    }
  });

  it("keeps conversation trash and restore behind strict main/preload contracts", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    for (const method of ["trashConversation", "conversationTrash", "restoreConversation"]) {
      expect(contractsSource).toContain(`readonly ${method}: (`);
    }
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.trashConversation", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.conversationTrash", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.restoreConversation", parsedRequest)');
    expect(mainSource).toContain('ipcMain.handle("agent.trashConversation"');
    expect(mainSource).toContain('ipcMain.handle("agent.conversationTrash"');
    expect(mainSource).toContain('ipcMain.handle("agent.restoreConversation"');
    expect(preloadSource).not.toContain("originalPath:");
    expect(preloadSource).not.toContain("trashPath:");
  });

  it("strictly bridges one pathless Main-owned durable conversation export", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-conversation-export-ipc.ts"),
      "utf8"
    );
    expect(contractsSource).toContain("readonly exportConversation: (");
    expect(contractsSource).toContain("request: AgentConversationExportRequest");
    expect(contractsSource).toContain(") => Promise<AgentConversationExportResult>;");
    expect(preloadSource).toContain("AgentConversationExportRequestSchema.parse(request)");
    expect(preloadSource).toContain("ipcRenderer.invoke(AGENT_CONVERSATION_EXPORT_CHANNEL, parsedRequest)");
    expect(preloadSource).toContain("AgentConversationExportResultSchema.parse(");
    expect(mainSource).toContain("registerConversationExportIpc({");
    expect(mainSource).toContain("dialog.showSaveDialog(window, options)");
    expect(registrarSource).not.toContain("outputPath:");
    expect(registrarSource).not.toContain("filePath: selection.filePath");
  });

  it("uses a CommonJS preload entry compatible with Electron sandboxed preload execution", () => {
    expect(PRELOAD_ENTRY_FILENAME).toBe("index.cjs");

    const buildSource = fs.readFileSync(path.resolve("apps/desktop/electron.vite.config.ts"), "utf8");
    const preloadConfig = buildSource.slice(
      buildSource.indexOf("preload: {"),
      buildSource.indexOf("renderer: {")
    );
    expect(preloadConfig).toContain('exclude: ["@pige/domain", "@pige/schemas", "zod"]');
    expect(preloadConfig).toContain('"@pige/schemas": alias("../../packages/schemas/src/index.ts")');
    expect(preloadConfig).toContain('"@pige/domain": alias("../../packages/domain/src/index.ts")');
  });

  it("keeps the PDF parser worker build name aligned with its runtime URL", () => {
    expect(PDF_PARSER_WORKER_ENTRY_NAME).toBe("workers/pdf-parser-worker");
    expect(PDF_PARSER_WORKER_ENTRY_RELATIVE_PATH).toBe(`./${PDF_PARSER_WORKER_ENTRY_NAME}.js`);
  });

  it("keeps the Office parser worker build name aligned with its runtime URL", () => {
    expect(OFFICE_PARSER_WORKER_ENTRY_NAME).toBe("workers/office-parser-worker");
    expect(OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH).toBe(`./${OFFICE_PARSER_WORKER_ENTRY_NAME}.js`);
  });

  it("keeps the web extractor worker build name aligned with its runtime URL", () => {
    expect(WEB_EXTRACTOR_WORKER_ENTRY_NAME).toBe("workers/web-extractor-worker");
    expect(WEB_EXTRACTOR_WORKER_ENTRY_RELATIVE_PATH).toBe(`./${WEB_EXTRACTOR_WORKER_ENTRY_NAME}.js`);
  });

  it("retains main BrowserWindow instances until their closed event", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).toContain("const mainWindows = new Set<BrowserWindow>();");
    expect(mainSource).toContain("mainWindows.add(browserWindow);");
    expect(mainSource).toContain('browserWindow.once("closed", () => mainWindows.delete(browserWindow));');
  });

  it("keeps resident pane dimensions and presentation under one validated main-process owner", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly currentLayout: () => Promise<WindowLayoutState>");
    expect(contractsSource).toContain("readonly setLayout: (request: WindowLayoutRequest)");
    expect(contractsSource).toContain("readonly onLayoutChanged:");
    expect(mainSource).toContain('ipcMain.handle("window.currentLayout"');
    expect(mainSource).toContain('ipcMain.handle("window.setLayout"');
    expect(mainSource).toContain("WindowLayoutRequestSchema.parse(request)");
    expect(mainSource).toContain('browserWindow.webContents.send("window.layoutChanged"');
    expect(mainSource).toContain('(bounds) => screen.getDisplayMatching(bounds).workArea');
    expect(preloadSource).toContain("WindowLayoutRequestSchema.parse(request)");
    expect(preloadSource).toContain("WindowLayoutStateSchema.parse(await ipcRenderer.invoke");
    expect(preloadSource).toContain("WindowLayoutStateSchema.safeParse(value)");
    expect(preloadSource).not.toContain("workArea:");
    expect(preloadSource).not.toContain("targetContentWidth:");
  });

  it("keeps Reader inline-reference resolution main-owned, validated, and pathless", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const readerIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-reader-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly resolveInlineReference:");
    expect(contractsSource).toContain("readonly openSourceReference:");
    expect(contractsSource).toContain("readonly revealSource:");
    expect(contractsSource).toContain("readonly revealGenerated:");
    expect(contractsSource).toContain("readonly trashCurrent:");
    expect(contractsSource).toContain("readonly listTrash:");
    expect(contractsSource).toContain("readonly restoreTrash:");
    expect(contractsSource).toContain("readonly archiveCurrent:");
    expect(contractsSource).toContain("readonly openEditor:");
    expect(contractsSource).toContain("readonly saveEditor:");
    expect(mainSource).toContain("registerReaderIpc({");
    expect(mainSource).not.toContain('ipcMain.handle("notes.resolveInlineReference"');
    expect(readerIpcSource).toContain('ipcMain.handle("notes.resolveInlineReference"');
    expect(readerIpcSource).toContain("NoteResolveInlineReferenceRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("NoteResolveInlineReferenceResultSchema.parse(");
    expect(readerIpcSource).toContain('ipcMain.handle("notes.openSourceReference"');
    expect(readerIpcSource).toContain("NoteOpenSourceReferenceRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("NoteOpenSourceReferenceResultSchema.parse(");
    expect(readerIpcSource).toContain("NOTE_REVEAL_GENERATED_CHANNEL");
    expect(readerIpcSource).toContain("getReaderGeneratedNoteRevealService().reveal(ownerId, parsed)");
    expect(preloadSource).toContain("NoteRevealGeneratedRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteRevealGeneratedResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_REVEAL_GENERATED_CHANNEL,");
    expect(readerIpcSource).toContain('ipcMain.handle("notes.openEditor"');
    expect(readerIpcSource).toContain("NoteEditorOpenRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("NoteEditorOpenResultSchema.parse(rawResult)");
    expect(readerIpcSource).toContain('ipcMain.handle("notes.saveEditor"');
    expect(readerIpcSource).toContain("NoteEditorSaveRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("NoteEditorSaveResultSchema.parse(rawResult)");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n          "notes.resolveInlineReference"');
    expect(preloadSource).toContain("NoteResolveInlineReferenceRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteResolveInlineReferenceResultSchema.parse(");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n          "notes.openSourceReference"');
    expect(preloadSource).toContain("NoteOpenSourceReferenceRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteOpenSourceReferenceResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_REVEAL_SOURCE_CHANNEL");
    expect(preloadSource).toContain("NoteRevealSourceRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteRevealSourceResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_TRASH_CURRENT_CHANNEL");
    expect(preloadSource).toContain("NoteTrashCurrentRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteTrashCurrentResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_TRASH_LIST_CHANNEL");
    expect(preloadSource).toContain("NoteTrashListRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteTrashListResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_TRASH_RESTORE_CHANNEL");
    expect(preloadSource).toContain("NoteTrashRestoreRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteTrashRestoreResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_ARCHIVE_CURRENT_CHANNEL");
    expect(preloadSource).toContain("NoteArchiveCurrentRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteArchiveCurrentResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_RESTORE_ARCHIVED_CHANNEL");
    expect(preloadSource).toContain("NoteRestoreArchivedRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteRestoreArchivedResultSchema.parse(");
    expect(preloadSource).toContain("NOTE_ADD_TAG_CHANNEL");
    expect(preloadSource).toContain("NoteAddTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteAddTagResultSchema.parse(");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n          "notes.openEditor"');
    expect(preloadSource).toContain("NoteEditorOpenRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteEditorOpenResultSchema.parse(");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n          "notes.saveEditor"');
    expect(preloadSource).toContain("NoteEditorSaveRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteEditorSaveResultSchema.parse(");
    expect(contractsSource).not.toContain("InlineReferencePath");
    expect(contractsSource).not.toContain("candidatePageIds");
    const notesApiStart = contractsSource.indexOf("readonly notes: {");
    const notesApi = contractsSource.slice(
      notesApiStart,
      contractsSource.indexOf("readonly localCapabilities: {", notesApiStart)
    );
    expect(notesApi).toContain("request: NoteRevealSourceRequest");
    expect(notesApi).toContain(") => Promise<NoteRevealSourceResult>;");
    expect(notesApi).toContain("request: NoteTrashCurrentRequest");
    expect(notesApi).toContain(") => Promise<NoteTrashCurrentResult>;");
    expect(notesApi).toContain("readonly listTrash: (request: NoteTrashListRequest) => Promise<NoteTrashListResult>;");
    expect(notesApi).toContain("readonly restoreTrash: (request: NoteTrashRestoreRequest) => Promise<NoteTrashRestoreResult>;");
    expect(notesApi).toContain("request: NoteArchiveCurrentRequest");
    expect(notesApi).toContain(") => Promise<NoteArchiveCurrentResult>;");
    expect(notesApi).toContain("request: NoteRestoreArchivedRequest");
    expect(notesApi).toContain(") => Promise<NoteRestoreArchivedResult>;");
    expect(notesApi).toContain("readonly addTag: (request: NoteAddTagRequest) => Promise<NoteAddTagResult>;");
    expect(notesApi).toContain("readonly removeTag: (request: NoteRemoveTagRequest) => Promise<NoteRemoveTagResult>;");
    for (const privateField of ["sourcePath", "originalPath", "managedCopyPath", "sourceBody", "rawError"]) {
      expect(notesApi).not.toContain(privateField);
    }
  });

  it("wires exact note tag removal through Main, preload, Library Reader, and Home Reader", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const readerIpcSource = fs.readFileSync(path.resolve("apps/desktop/src/main/register-reader-ipc.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    expect(readerIpcSource).toContain("NOTE_REMOVE_TAG_CHANNEL");
    expect(readerIpcSource).toContain("NoteRemoveTagRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("NoteRemoveTagResultSchema.parse(rawResult)");
    expect(preloadSource).toContain("NOTE_REMOVE_TAG_CHANNEL");
    expect(preloadSource).toContain("NoteRemoveTagRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteRemoveTagResultSchema.parse(");
    expect(contractsSource).toContain("readonly removeTag: (request: NoteRemoveTagRequest) => Promise<NoteRemoveTagResult>;");
    expect(appSource).toContain("onRemoveNoteTag={(request) => window.pige.notes.removeTag(request)}");
    expect(appSource).toContain("onRemoveTag={removeTagFromSelectedNote}");
    expect(appSource).toContain("onRemoveTag={removeTagFromSelectedHomeNote}");
  });

  it("keeps Knowledge Health behind a strict registrar and body-free preload boundary", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-knowledge-health-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(mainSource).toContain("registerKnowledgeHealthIpc({");
    expect(mainSource).not.toContain('ipcMain.handle("maintenance.runKnowledgeHealth"');
    expect(mainSource).not.toContain('ipcMain.handle("maintenance.repairKnowledgeHealth"');
    expect(registrarSource).toContain('ipcMain.handle("maintenance.runKnowledgeHealth"');
    expect(registrarSource).toContain('ipcMain.handle("maintenance.repairKnowledgeHealth"');
    expect(registrarSource).toContain("KnowledgeHealthRunRequestSchema.parse(request)");
    expect(registrarSource).toContain("KnowledgeHealthRunResultSchema.parse(");
    expect(registrarSource).toContain("KnowledgeHealthRepairRequestSchema.parse(request)");
    expect(registrarSource).toContain("KnowledgeHealthRepairResultSchema.parse(");
    expect(registrarSource).toContain("getActiveVaultBinding");
    expect(preloadSource).toContain('ipcRenderer.invoke("maintenance.runKnowledgeHealth"');
    expect(preloadSource).toContain("KnowledgeHealthRunRequestSchema.parse(request)");
    expect(preloadSource).toContain("KnowledgeHealthRunResultSchema.parse(");
    expect(preloadSource).toContain('ipcRenderer.invoke("maintenance.repairKnowledgeHealth"');
    expect(preloadSource).toContain("KnowledgeHealthRepairRequestSchema.parse(request)");
    expect(preloadSource).toContain("KnowledgeHealthRepairResultSchema.parse(");
    for (const privateField of ["pagePath", "target", "sourceIds", "error", "body"]) {
      expect(registrarSource).not.toContain(`${privateField}:`);
    }
  });

  it("keeps Reader selection identity resolution main-owned and schema-validated", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const readerIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-reader-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly readerSelection: {");
    expect(contractsSource).toContain("readonly resolve: (");
    expect(contractsSource).toContain("readonly submitAction: (");
    expect(contractsSource).toContain("readonly submitLink: (");
    expect(contractsSource).toContain("readonly submitTransform: (");
    expect(contractsSource).toContain("readonly submitCreateNote: (");
    expect(contractsSource).toContain("request: ReaderSelectionCreateNoteRequest");
    expect(contractsSource).toContain("Promise<ReaderSelectionCreateNoteResult>");
    expect(contractsSource).toContain("readonly currentProposal: (");
    expect(contractsSource).toContain("readonly decideProposal: (");
    expect(mainSource).toContain("registerReaderIpc({");
    expect(mainSource).not.toContain('ipcMain.handle("readerSelection.resolve"');
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.resolve"');
    expect(readerIpcSource).toContain("ReaderSelectionResolveRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("ReaderSelectionResolveResultSchema.parse(");
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.submitAction"');
    expect(readerIpcSource).toContain("ReaderSelectionActionRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("ReaderSelectionActionResultSchema.parse(");
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.submitLink"');
    expect(readerIpcSource).toContain("ReaderSelectionLinkRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("ReaderSelectionLinkResultSchema.parse(");
    expect(readerIpcSource).toContain("notesTrackedSenders.get(event.sender.id)");
    expect(readerIpcSource).toContain("getNotesService().isRenderContextCurrent(ownerId, {");
    expect(readerIpcSource).toContain("submitLink(parsed, {");
    expect(readerIpcSource).toContain("renderContextCurrent,");
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.submitTransform"');
    expect(readerIpcSource).toContain("ReaderSelectionTransformRequestSchema.parse(request)");
    expect(readerIpcSource).toContain("ReaderSelectionTransformResultSchema.parse(");
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.currentProposal"');
    expect(readerIpcSource).toContain('ipcMain.handle("readerSelection.decideProposal"');
    expect(preloadSource).toContain('"readerSelection.resolve"');
    expect(preloadSource).toContain("ReaderSelectionResolveRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionResolveResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitAction"');
    expect(preloadSource).toContain("ReaderSelectionActionRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionActionResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitLink"');
    expect(preloadSource).toContain("ReaderSelectionLinkRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionLinkResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitTransform"');
    expect(preloadSource).toContain("ReaderSelectionTransformRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionTransformResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitCreateNote"');
    expect(preloadSource).toContain("ReaderSelectionCreateNoteRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionCreateNoteResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.currentProposal"');
    expect(preloadSource).toContain('"readerSelection.decideProposal"');
    expect(contractsSource).not.toContain("ReaderSelectionText");
    expect(contractsSource).not.toContain("ReaderSelectionPath");
  });

  it("keeps machine-local Appearance and knowledge language main-owned, revision-fenced, and strictly projected", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const backupSource = fs.readFileSync(path.resolve("apps/desktop/src/main/services/backup-service.ts"), "utf8");

    expect(contractsSource).toContain("readonly setTheme:");
    expect(contractsSource).toContain("readonly setKnowledgeLanguage:");
    expect(contractsSource).toContain("readonly onAppearanceChanged:");
    expect(mainSource).toContain('ipcMain.handle("settings.setTheme"');
    expect(mainSource).toContain("SetThemeRequestSchema.parse(request)");
    expect(mainSource).toContain('ipcMain.handle("settings.setKnowledgeLanguage"');
    expect(mainSource).toContain("registerPigePolicyIpc({");
    expect(mainSource).toContain('confirmSettingAction(sender, ["vault.pigePolicy"]');
    expect(preloadSource).toContain("PigePolicySummarySchema.parse(await ipcRenderer.invoke(PIGE_POLICY_STATUS_CHANNEL))");
    expect(preloadSource).toContain("PigePolicyUpdateResultSchema.parse(await ipcRenderer.invoke(PIGE_POLICY_UPDATE_CHANNEL, parsed))");
    expect(mainSource).toContain("SetKnowledgeLanguageRequestSchema.parse(request)");
    expect(mainSource).toContain('browserWindow.webContents.send("settings.appearanceChanged"');
    expect(mainSource.indexOf("getAppearanceService();")).toBeLessThan(mainSource.indexOf("createMainWindow(false)"));
    expect(mainSource).toContain("appearanceService?.dispose();");
    expect(preloadSource).toContain("AppearanceSettingsSummarySchema.parse(await ipcRenderer.invoke");
    expect(preloadSource).toContain("SetThemeRequestSchema.parse(request)");
    expect(preloadSource).toContain("SetKnowledgeLanguageRequestSchema.parse(request)");
    expect(preloadSource).toContain("KnowledgeLanguageMutationResultSchema.parse(");
    expect(preloadSource).toContain("AppearanceSettingsSummarySchema.safeParse(value)");
    expect(backupSource).not.toContain("settings.json");
    expect(backupSource).not.toContain("appearance");
  });

  it("freezes one pathless machine-local startup destination CAS interface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const settingsApi = contractsSource.slice(
      contractsSource.indexOf("readonly settings: {"),
      contractsSource.indexOf("readonly updates: {")
    );

    expect(schemasSource).toContain('StartupDestinationSchema = z.enum(["home", "library"])');
    expect(schemasSource).toContain("StartupDestinationSummarySchema");
    expect(schemasSource).toContain("SetStartupDestinationRequestSchema");
    expect(settingsApi).toContain("readonly startupDestination: () => Promise<StartupDestinationSummary>;");
    expect(settingsApi).toContain("readonly setStartupDestination: (");
    expect(settingsApi).toContain("request: SetStartupDestinationRequest");
    expect(settingsApi).toContain(") => Promise<StartupDestinationMutationResult>;");
    expect(preloadSource).toContain('ipcRenderer.invoke("settings.startupDestination")');
    expect(preloadSource).toContain('"settings.setStartupDestination"');
    expect(preloadSource).toContain("SetStartupDestinationRequestSchema.parse(request)");
    expect(preloadSource).toContain("StartupDestinationMutationResultSchema.parse(");
    expect(mainSource).toContain('ipcMain.handle("settings.startupDestination"');
    expect(mainSource).toContain('ipcMain.handle("settings.setStartupDestination"');
    expect(mainSource).toContain("SetStartupDestinationRequestSchema.parse(request)");
    expect(mainSource).toContain("StartupDestinationMutationResultSchema.parse(");
    for (const privateField of ["path", "vaultId", "activeVaultId", "openAtLogin"]) {
      expect(settingsApi).not.toContain(privateField);
    }
  });

  it("uses one integrated title bar while preserving native platform controls", () => {
    expect(getWindowShellOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 17, y: 17 }
    });
    expect(getWindowShellOptions("win32")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#6f6f6f",
        height: 58
      }
    });
    expect(getWindowShellOptions("linux")).toEqual({});

    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).toContain("...getWindowShellOptions(process.platform)");
    expect(mainSource).not.toContain("frame: false");
  });

  it("keeps local dictation main-owned, strictly projected, and permission-on-demand", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const builderConfig = fs.readFileSync(path.resolve("apps/desktop/electron-builder.yml"), "utf8");
    const helperSource = fs.readFileSync(path.resolve("apps/desktop/native/macos-speech/PigeSpeech.swift"), "utf8");
    const helperInfo = fs.readFileSync(path.resolve("apps/desktop/native/macos-speech/Info.plist"), "utf8");

    expect(contractsSource).toContain("readonly speech: {");
    expect(contractsSource).toContain("readonly dictationLanguagePreference: (");
    expect(contractsSource).toContain("readonly setDictationLanguagePreference: (");
    expect(contractsSource).not.toContain("audioBytes");
    expect(mainSource).not.toContain('systemPreferences.askForMediaAccess("microphone")');
    expect(mainSource).not.toContain('systemPreferences.getMediaAccessStatus("microphone")');
    expect(helperSource).toContain("AVCaptureDevice.requestAccess(for: .audio)");
    expect(helperSource).toContain("AVCaptureDevice.authorizationStatus(for: .audio)");
    expect(helperInfo).toContain("NSMicrophoneUsageDescription");
    expect(helperInfo).toContain("com.yinsenw.pige.speech");
    expect(mainSource).toContain('ipcMain.handle("speech.start"');
    expect(mainSource).toContain('ipcMain.handle("speech.installLanguageAsset"');
    expect(mainSource).toContain('"speech.assetInstallEvent", SpeechAssetInstallEventSchema.parse(installEvent)');
    expect(mainSource).toContain("const speechTrackedSenders = new Set<number>();");
    expect(mainSource).toContain("void getSpeechService().cancelOwner(sender.id);");
    expect(mainSource).toContain("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    expect(preloadSource).toContain("SpeechSessionEventSchema.safeParse(value)");
    expect(preloadSource).toContain("SpeechAssetInstallEventSchema.safeParse(value)");
    expect(preloadSource).toContain('ipcRenderer.invoke("speech.start", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("speech.installLanguageAsset", parsedRequest)');
    expect(preloadSource).toContain("DICTATION_LANGUAGE_PREFERENCE_CHANNEL");
    expect(preloadSource).toContain("SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL");
    expect(preloadSource).not.toContain("PIGE_PACKAGED_RESOURCES_PATH");
    expect(builderConfig).toContain("NSMicrophoneUsageDescription:");
  });

  it("keeps storage reveal main-owned, window-bound, strictly projected, and pathless", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const handlerStart = mainSource.indexOf('ipcMain.handle("vault.revealKnowledgeRoot"');
    const handlerEnd = mainSource.indexOf('ipcMain.handle("vault.updateSourceStoragePolicy"');
    const handlers = mainSource.slice(handlerStart, handlerEnd);

    expect(contractsSource).toContain("readonly revealKnowledgeRoot: () => Promise<VaultRevealResult>;");
    expect(contractsSource).toContain("readonly revealSourceAssetRoot: () => Promise<VaultRevealResult>;");
    expect(contractsSource).not.toContain("readonly revealKnowledgeRoot: () => Promise<void>;");
    expect(handlers).toContain("requireWindow(event.sender);");
    expect(handlers.indexOf("requireWindow(event.sender);")).toBeLessThan(
      handlers.indexOf("getVaultService().revealKnowledgeRoot()")
    );
    expect(preloadSource).toContain("expectedTarget: VaultRevealTarget");
    expect(preloadSource).toContain("record.target !== expectedTarget");
    expect(preloadSource).toContain("Object.keys(record).sort().join(\",\") === \"status,target\"");
    expect(preloadSource).toContain('ipcRenderer.invoke("vault.revealKnowledgeRoot")');
    expect(preloadSource).toContain(
      'projectVaultRevealResult(await ipcRenderer.invoke("vault.revealKnowledgeRoot"), "knowledge_root")'
    );
    expect(preloadSource).not.toContain(
      'ipcRenderer.invoke("vault.revealKnowledgeRoot") as Promise<VaultRevealResult>'
    );
  });

  it("assembles the background index worker and repository toolchain manifest in a development build", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const readyPath = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf('app.on("window-all-closed"')
    );

    expect(readyPath).toContain(
      "new LocalDatabaseService(undefined, new LocalDatabaseRebuildWorkerService())"
    );
    expect(mainSource).toContain(
      'join(process.cwd(), "../../resources/toolchain-manifest/toolchain.manifest.json")'
    );
  });

  it("never lets a packaged app replace its local renderer through a development URL", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const devRendererBranch = mainSource.slice(
      mainSource.indexOf("if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)"),
      mainSource.indexOf("const getLocalSettingsStore")
    );

    expect(devRendererBranch).toContain("browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL)");
    expect(devRendererBranch).toContain('browserWindow.loadFile(join(__dirname, "../renderer/index.html"))');
    expect(mainSource).not.toContain("if (process.env.ELECTRON_RENDERER_URL)");
  });

  it("guards sensitive settings in the main process before mutation", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const resetHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("maintenance.resetLocalDatabase"'),
      mainSource.indexOf('ipcMain.handle("maintenance.localDatabaseStatus"')
    );
    const providerHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.addManualProvider"'),
      mainSource.indexOf('ipcMain.handle("models.refreshProviderModels"')
    );
    const presetHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.addPresetProvider"'),
      mainSource.indexOf('ipcMain.handle("models.addManualProvider"')
    );
    const credentialHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.updateProviderCredential"'),
      mainSource.indexOf('ipcMain.handle("models.deleteProvider"')
    );
    const deleteProviderHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.deleteProvider"'),
      mainSource.indexOf('ipcMain.handle("models.addManualModel"')
    );
    expect(resetHandler.indexOf("const expectedBinding")).toBeLessThan(resetHandler.indexOf("confirmSettingAction"));
    expect(resetHandler.indexOf("confirmSettingAction"))
      .toBeLessThan(resetHandler.indexOf("getVaultService().resetLocalDatabase(expectedBinding)"));
    expect(resetHandler.indexOf("getVaultService().resetLocalDatabase(expectedBinding)"))
      .toBeLessThan(resetHandler.indexOf("getIndexRebuildJobExecutor().request()"));
    expect(providerHandler.indexOf("AddManualProviderRequestSchema.parse(request)"))
      .toBeLessThan(providerHandler.indexOf("getModelProviderRegistry().addManualProvider(validatedRequest)"));
    expect(presetHandler.indexOf("AddPresetProviderRequestSchema.parse(request)"))
      .toBeLessThan(presetHandler.indexOf("getModelProviderRegistry().addPresetProvider(validatedRequest)"));
    expect(providerHandler).not.toContain("confirmSettingAction");
    expect(presetHandler).not.toContain("confirmSettingAction");
    expect(providerHandler).not.toContain("Connect this model service?");
    expect(presetHandler).not.toContain("Connect this model service?");
    expect(credentialHandler.indexOf("UpdateProviderCredentialRequestSchema.parse(request)"))
      .toBeLessThan(credentialHandler.indexOf("confirmSettingAction"));
    expect(credentialHandler.indexOf("confirmSettingAction"))
      .toBeLessThan(credentialHandler.indexOf("getModelProviderRegistry().updateProviderCredential(validatedRequest)"));
    expect(deleteProviderHandler.indexOf("DeleteProviderRequestSchema.parse(request)"))
      .toBeLessThan(deleteProviderHandler.indexOf("confirmSettingAction"));
    expect(deleteProviderHandler.indexOf("confirmSettingAction"))
      .toBeLessThan(deleteProviderHandler.indexOf("getModelProviderRegistry().deleteProvider(validatedRequest)"));
    expect(mainSource).toContain('states: ["running", "cancel_requested"]');
    expect(mainSource).toContain('classes: ["agent_turn", "agent_ingest"]');
    expect(credentialHandler).not.toContain("oldApiKey");
    expect(deleteProviderHandler).not.toContain("authSecretRef");
    expect(mainSource).not.toContain('title: "Connect this model service?"');
    for (const channel of ["models.updateProviderCredential", "models.deleteProvider"]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke("${channel}"`);
    }
  });

  it("keeps provider API key help Main-owned and renderer URL-free", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const presetsSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/model-provider-presets.ts"),
      "utf8"
    );

    expect(mainSource).toContain("ipcMain.handle(MODEL_OPEN_API_KEY_MANAGEMENT_CHANNEL");
    expect(mainSource).toContain("ProviderApiKeyManagementRequestSchema.parse(request)");
    expect(mainSource).toContain("openReviewedProviderApiKeyManagement");
    expect(preloadSource).toContain("ProviderApiKeyManagementRequestSchema.parse(request)");
    expect(preloadSource).toContain("ProviderApiKeyManagementResultSchema.parse");
    expect(contractsSource).toContain("readonly openApiKeyManagement:");
    expect(contractsSource).not.toContain("readonly apiKeyManagementUrl?: string;");
    expect(presetsSource).toContain("readonly apiKeyManagementUrl?: string;");
  });

  it("binds support-bundle cancellation to one active renderer request", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = [
      "apps/desktop/src/renderer/src/App.tsx",
      "apps/desktop/src/renderer/src/components/DiagnosticsWorkflowCards.tsx"
    ].map((file) => fs.readFileSync(path.resolve(file), "utf8")).join("\n");
    const diagnosticsIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-diagnostics-ipc.ts"),
      "utf8"
    );

    expect(contractsSource).toContain("request: DiagnosticsSupportBundleMutationRequest");
    expect(contractsSource).toContain("cancelSupportBundleExport");
    expect(preloadSource).toContain("DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL");
    expect(diagnosticsIpcSource).toContain('mutation(options, event.sender, input, "cancel")');
    expect(diagnosticsIpcSource).toContain("DiagnosticsSupportBundleMutationRequestSchema.parse(input)");
    expect(diagnosticsIpcSource).toContain("assertMutationIdentity(request, result)");
    expect(mainSource).toContain("cancel: (request) => getDiagnosticsLifecycleService().cancel(request)");
    expect(rendererSource).toContain('props.t("maintenance.cancelSupportExport")');
    expect(rendererSource).toContain("workflow.job.jobId");
    expect(rendererSource).toContain("window.pige.diagnostics.cancelSupportBundleExport({");
  });

  it("binds restore apply to the exact preview token across renderer, preload, and main", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const backupRestoreIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-backup-restore-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = [
      "apps/desktop/src/renderer/src/App.tsx",
      "apps/desktop/src/renderer/src/components/VaultBackupSettingsPanel.tsx"
    ].map((file) => fs.readFileSync(path.resolve(file), "utf8")).join("\n");
    const previewContract = contractsSource.slice(
      contractsSource.indexOf("export type RestorePreviewResult"),
      contractsSource.indexOf("export interface RestoreApplyRequest")
    );
    const warningContract = contractsSource.slice(
      contractsSource.indexOf("export type RestorePreviewWarning"),
      contractsSource.indexOf("export type RestorePreviewResult")
    );
    const requestContract = contractsSource.slice(
      contractsSource.indexOf("export interface RestoreApplyRequest"),
      contractsSource.indexOf("export type RestoreApplyResult")
    );
    const resultContract = contractsSource.slice(
      contractsSource.indexOf("export type RestoreApplyResult"),
      contractsSource.indexOf("export interface CreateVaultRequest")
    );
    const applyProjector = preloadSource.slice(
      preloadSource.indexOf("function projectRestoreApplyResult"),
      preloadSource.indexOf("const api:")
    );
    const preloadRestoreApi = preloadSource.slice(
      preloadSource.indexOf("backup: {"),
      preloadSource.indexOf("system: {")
    );

    expect(contractsSource).toContain('export type RestoreMode = "clone_as_new" | "replace_existing";');
    expect(previewContract).toContain("readonly previewId: string;");
    expect(previewContract).toContain("readonly permittedModes: readonly RestoreMode[];");
    expect(previewContract).toContain("readonly defaultMode: RestoreMode;");
    expect(previewContract).not.toContain("backupPath");
    expect(previewContract).not.toContain("previewToken");
    expect(warningContract).toContain('readonly code: "invalid_archive_entries";');
    expect(warningContract).toContain('readonly code: "excluded_rebuildable_roots";');
    expect(warningContract).toContain('readonly code: "external_originals_not_included";');
    expect(warningContract).toContain("readonly count: number;");
    expect(requestContract).toContain("readonly previewId: string;");
    expect(requestContract).toContain("readonly mode: RestoreMode;");
    expect(requestContract).not.toContain("backupPath");
    expect(requestContract).not.toContain("previewToken");
    expect(resultContract).toContain("readonly jobId: string;");
    expect(resultContract).not.toContain("restoredVaultPath");
    expect(resultContract).not.toContain("VaultSummary");
    expect(resultContract).not.toContain("localDatabaseRebuild");
    expect(resultContract).not.toContain("manifest");
    expect(preloadRestoreApi).toContain('ipcRenderer.invoke("restore.preview")');
    expect(preloadRestoreApi).toContain('ipcRenderer.invoke("restore.apply", {');
    expect(preloadRestoreApi).toContain("previewId: request.previewId");
    expect(preloadRestoreApi).toContain("mode: request.mode");
    expect(preloadRestoreApi).toContain("projectRestorePreviewResult(result)");
    expect(preloadRestoreApi).toContain("projectRestoreApplyResult(result)");
    expect(preloadRestoreApi).toContain("RestoreCancelRequestSchema.parse(request)");
    expect(preloadRestoreApi).toContain("ipcRenderer.invoke(RESTORE_CANCEL_CHANNEL, parsedRequest)");
    expect(preloadRestoreApi).toContain("Invalid Restore cancellation response identity.");
    expect(preloadRestoreApi).not.toContain("backupPath");
    expect(preloadRestoreApi).not.toContain("previewToken");
    expect(applyProjector).toContain('return { status: "restored", jobId: result.jobId };');
    expect(applyProjector).not.toContain("activeVaultPathDisplay");
    expect(applyProjector).not.toContain("knowledgeRootDisplay");
    expect(applyProjector).not.toContain("sourceAssetRootDisplay");
    expect(applyProjector).not.toContain("result.vault");
    expect(applyProjector).not.toContain("result.manifest");
    expect(rendererSource).toContain("previewId: restorePreview.previewId");
    expect(rendererSource).toContain('idPrefix="first-run"');
    expect(rendererSource).toContain('idPrefix="vault-settings"');
    expect(rendererSource).not.toContain("restorePreview.backupPath");
    expect(rendererSource).not.toContain("restorePreview.previewToken");
    expect(rendererSource).not.toContain("restoredVaultPath");
    expect(mainSource).toContain("registerBackupRestoreIpc({");
    expect(mainSource).not.toContain('ipcMain.handle("restore.preview"');
    expect(mainSource).not.toContain('ipcMain.handle("restore.apply"');
    expect(backupRestoreIpcSource).toContain('options.ipcMain.handle("restore.preview"');
    expect(backupRestoreIpcSource).toContain('options.ipcMain.handle("restore.apply"');
    expect(backupRestoreIpcSource).toContain("options.ipcMain.handle(RESTORE_CANCEL_CHANNEL");
    expect(backupRestoreIpcSource).toContain("previews.isApplying(event.sender.id, parsed)");
    expect(backupRestoreIpcSource).toContain("options.getRestoreCoordinator().cancel(parsed.previewId, parsed.mode)");
    expect(backupRestoreIpcSource).toContain("options.getRestoreCoordinator().apply({");
    expect(mainSource).toContain("getRestoreCoordinatorService().recoverInterrupted()");
    expect(backupRestoreIpcSource).toContain("RESTORE_NATIVE_COPY[options.getLocale()]");
    for (const locale of ["de", "en", "fr", "ja", "ko", "zh-Hans"]) {
      expect(backupRestoreIpcSource).toContain(`${JSON.stringify(locale)}:`);
    }
    const nativeRestoreCopy = backupRestoreIpcSource.slice(
      backupRestoreIpcSource.indexOf("const RESTORE_NATIVE_COPY")
    );
    expect(nativeRestoreCopy.match(/destinationPickerTitle: "/gu)).toHaveLength(6);
    for (const phrase of [
      "nicht rückgängig",
      "cannot be undone",
      "ne peut pas être annulée",
      "取り消せません",
      "실행 취소할 수 없습니다",
      "无法在此流程中撤销"
    ]) {
      expect(nativeRestoreCopy).toContain(phrase);
    }
    expect(backupRestoreIpcSource).toContain("buttons: [copy.cancel, copy.confirm]");
    expect(backupRestoreIpcSource).toContain("defaultId: 0");
    expect(backupRestoreIpcSource).toContain("cancelId: 0");
    expect(backupRestoreIpcSource).toContain("title: copy.destinationPickerTitle");
    expect(backupRestoreIpcSource).not.toContain('title: "Choose where to create the restored vault"');
    const restoreApplyHandler = backupRestoreIpcSource.slice(
      backupRestoreIpcSource.indexOf('options.ipcMain.handle("restore.apply"')
    );
    expect(restoreApplyHandler).not.toContain("openPath(");
    expect(restoreApplyHandler).not.toContain("restoredVaultPath");
  });

  it("routes user backup creation and recovery through the durable Backup coordinator", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const backupRestoreIpcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-backup-restore-ipc.ts"),
      "utf8"
    );
    const createHandler = backupRestoreIpcSource.slice(
      backupRestoreIpcSource.indexOf('options.ipcMain.handle("backup.create"'),
      backupRestoreIpcSource.indexOf('options.ipcMain.handle("backup.reconnectDependency"')
    );
    const cancelHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("jobs.cancel"'),
      mainSource.indexOf('ipcMain.handle("jobs.retry"')
    );

    expect(mainSource).toContain("new BackupCoordinatorService({");
    expect(createHandler).toContain("options.getBackupCoordinator().create(selection.filePath)");
    expect(createHandler).not.toContain("options.getBackupService().createBackup(");
    expect(mainSource).toContain('job.backupKind === "user_backup"');
    expect(mainSource).toContain("?.updatedAt");
    expect(cancelHandler).toContain("getJobClassExecutorRegistry().require(jobClass)");
    expect(cancelHandler).not.toContain("getBackupCoordinatorService().cancel(request)");
    expect(mainSource).toContain("backup: {");
    expect(mainSource).toContain("getBackupCoordinatorService().cancel(request)");
    expect(mainSource).toContain("getBackupCoordinatorService().recoverInterrupted()");
    expect(mainSource.indexOf("getBackupCoordinatorService().recoverInterrupted()"))
      .toBeLessThan(mainSource.indexOf("recoverInterruptedJobs()"));
    const resumeBackgroundJobs = mainSource.slice(
      mainSource.indexOf("const resumeBackgroundJobs"),
      mainSource.indexOf("const scheduleWaitingAgentIngestAfterModelReady")
    );
    expect(resumeBackgroundJobs).toContain("getJobClassExecutorRegistry().scheduleAll()");
    expect(resumeBackgroundJobs).not.toContain("scheduleCaptureProcessing();");
    expect(resumeBackgroundJobs).not.toContain("scheduleDatasetImportProcessing();");
  });

  it("routes production Job classes through concrete class executors", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const jobsSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/jobs-service.ts"),
      "utf8"
    );

    expect(mainSource).toContain("getJobsService().indexRebuildExecutor()");
    expect(mainSource).toContain("getIndexRebuildJobExecutor().process({ limit: 1 })");
    expect(mainSource).toContain("getIndexRebuildJobExecutor().request()");
    expect(mainSource).not.toContain("getJobsService().requestIndexRebuild()");
    expect(mainSource).not.toContain("getJobsService().processQueuedIndexRebuild(");
    expect(jobsSource).not.toContain("requestIndexRebuild(");
    expect(jobsSource).not.toContain("processQueuedIndexRebuild(");
    expect(mainSource).toContain("getJobsService().captureExecutor()");
    expect(mainSource).toContain("getCaptureJobExecutor().process({ limit: 20 })");
    expect(mainSource).not.toContain("getJobsService().processQueuedCaptures({ limit: 20 })");
    expect(mainSource).toContain("getJobsService().documentParseExecutor()");
    expect(mainSource).toContain("getDocumentParseJobExecutor().process({ limit: 20 })");
    expect(jobsSource).not.toContain("processQueuedParses(");
    expect(mainSource).not.toContain("getJobsService().processQueuedParses({ limit: 20 })");
    expect(mainSource).toContain("getJobsService().ocrExecutor()");
    expect(mainSource).toContain("getOcrJobExecutor().process({ limit: 20 })");
    expect(mainSource).not.toContain("getJobsService().processQueuedOcr(");
    expect(jobsSource).not.toContain("processQueuedOcr(");
    expect(mainSource).toContain("getJobsService().datasetImportExecutor()");
    expect(mainSource).toContain("getDatasetImportJobExecutor().process({ limit: 20 })");
    expect(jobsSource).toContain("this.#datasetImportExecutor.process({");
    expect(mainSource).not.toContain("getJobsService().processQueuedDatasetImports(");
    expect(jobsSource).not.toContain("processQueuedDatasetImports(");
    expect(mainSource).toContain("getJobsService().legacyAgentIngestExecutor()");
    expect(mainSource).toContain("getLegacyAgentIngestJobExecutor().process({ limit: 20 })");
    expect(mainSource).not.toContain("getJobsService().processQueuedAgentIngest({ limit: 20 })");
    expect(jobsSource).toContain("return this.#legacyAgentIngestExecutor.process(request);");
    expect(jobsSource).not.toContain("createRetrievalQueryJob(");
    expect(jobsSource).not.toContain("writeRetrievalQueryJob(");
  });

  it("wires Home questions through Pi with visible typed outcomes and no raw provider error surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const retrievalResultsSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/HomeRetrievalResults.tsx"),
      "utf8"
    );
    const runtimeSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/pi-agent-runtime-adapter.ts"),
      "utf8"
    );
    const projectionSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/pi-agent-safe-projection.ts"),
      "utf8"
    );
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );

    expect(mainSource).toContain('ipcMain.handle("agent.submitTurn"');
    expect(mainSource).not.toContain('ipcMain.handle("capture.submitText"');
    expect(mainSource).not.toContain('ipcMain.handle("capture.submitUrl"');
    expect(mainSource).not.toContain('ipcMain.handle("capture.submitFiles"');
    expect(mainSource).toContain('event.sender.send("agent.turnDraft", draft)');
    expect(mainSource).toContain("AgentSubmitTurnResultSchema.parse(");
    expect(mainSource).toContain("preparedAttachments.entries.length === 0");
    expect(mainSource).toContain("rejectedFiles: preparedAttachments.rejectedFiles");
    expect(mainSource).toContain("home.failPreparedSourceTurn(prepared)");
    expect(mainSource).not.toContain("filePaths.length > 1");
    expect(mainSource).toContain("await getHomeAgentService().submitTurn(normalizedRequest, draftContext)");
    expect(mainSource).toContain("...(request.scope === undefined ? {} : { scope: request.scope })");
    expect(mainSource).toContain("draftPublisher.close()");
    expect(preloadSource).toContain('scope: { kind: "current_note" as const, pageId: request.scope.pageId }');
    expect(preloadSource).toContain("AgentSubmitTurnIpcPayloadSchema.parse({");
    expect(preloadSource).toContain("displayName: stagedFileItems?.[index]?.displayName ?? file.name");
    expect(preloadSource).toContain("request.stagedItems");
    expect(preloadSource).toContain("internalPath: webUtils.getPathForFile(file)");
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.submitTurn", payload)');
    expect(preloadSource).toContain("AgentSubmitTurnIpcResultSchema.parse(");
    expect(preloadSource).toContain("request: canonicalRequest");
    expect(preloadSource).toContain("inputKind: request.inputKind");
    expect(preloadSource).not.toContain("objective: request.objective");
    expect(preloadSource).toContain('ipcRenderer.on("agent.turnDraft", handleDraft)');
    expect(preloadSource).toContain('ipcRenderer.removeListener("agent.turnDraft", handleDraft)');
    expect(contractsSource).toContain("export interface AgentTurnDraftEvent");
    expect(contractsSource).toContain("export interface AgentTurnCurrentNoteScope");
    expect(contractsSource).toContain("readonly scope?: AgentTurnScope");
    expect(contractsSource).not.toContain("AgentTurnObjective");
    expect(contractsSource).not.toContain("readonly objective?:");
    expect(contractsSource).toContain("readonly onTurnDraft:");
    expect(runtimeSource).toContain("drafts.observe(event)");
    expect(preloadSource).not.toContain('ipcRenderer.invoke("capture.submit');
    expect(preloadSource).not.toContain('ipcRenderer.invoke("retrieval.ask"');
    expect(homeComposer).toContain("window.pige.agent.submitTurn");
    expect(homeComposer).toContain('setAgentRunState("accepted")');
    expect(homeComposer).toContain('setAgentRunState("running")');
    expect(homeComposer).toContain("outcome.error");
    expect(homeComposer).toContain("outcome.modelUsage");
    expect(homeComposer).not.toContain('className="agent-cloud-boundary"');
    expect(homeComposer).toContain('className="conversation-loading-dots"');
    expect(homeComposer).toContain("setAgentModelUsage(outcome.modelUsage)");
    expect(homeComposer).toContain('modelUsage={agentModelUsage}');
    expect(retrievalResultsSource).toContain('props.result.warnings.includes("insufficient_evidence")');
    expect(retrievalResultsSource).toContain('props.result.answerMode === "model_grounded" ? "retrieval.modelGrounded" : "retrieval.localOnly"');
    expect(retrievalResultsSource).toContain('props.t("retrieval.cloudSent")');
    expect(rendererSource).not.toContain("function isLikelyQuestion");
    expect(rendererSource).not.toContain("function extractSingleCaptureUrl");
    expect(homeComposer).not.toContain("window.pige.capture.submitText");
    expect(homeComposer).not.toContain("window.pige.capture.submitUrl");
    expect(rendererSource).toContain("classifyTextTransportKind(submittedText)");
    expect(rendererSource).toContain('if (view === "home")');
    expect(rendererSource).toContain("setHomeFileDropRequest({");
    expect(rendererSource).toContain('void submitFiles(files, "file_drop", undefined, clientTurnId, "shell")');
    expect(homeComposer).toContain("props.fileDropRequest");
    expect(homeComposer).toContain('void submitHomeFiles(request.files, "file_drop", request.text, request.clientTurnId)');
    expect(homeComposer).toContain('data-agent-draft="true"');
    expect(homeComposer).toContain('aria-busy={!viewingHistory && (agentDraft !== null || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running")}');
    expect(homeComposer).toContain("event.sequence <= active.sequence");
    expect(rendererSource).toContain('...(text?.trim() ? { text } : {})');
    expect(homeComposer).toContain("const text = props.draftText");
    expect(homeComposer).toContain("props.onDraftChange(event.target.value)");
    expect(homeComposer).toContain('job.class !== "retrieval_query"');
    expect(rendererSource).toContain("classes: HOME_JOB_CLASSES");
    const submitHomeInput = homeComposer.slice(
      homeComposer.indexOf("const submitHomeInput"),
      homeComposer.indexOf("const openResult")
    );
    expect(submitHomeInput).not.toContain("caught instanceof Error ? caught.message");
    const retryHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("jobs.retry"'),
      mainSource.indexOf('ipcMain.handle("library.list"')
    );
    expect(retryHandler).toContain("getJobClassExecutorRegistry().require(result.job.class).schedule?.(result.job.id)");
    expect(retryHandler).not.toContain('result.job?.class === "agent_turn"');
    expect(mainSource).toContain("agent_turn: {");
    expect(mainSource).toContain("scheduleAgentTurnProcessing();");
  });

  it("runtime-validates retrieval.search at preload and main boundaries", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const ipcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/retrieval-search-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(mainSource).toContain("handleRetrievalSearchIpc(request, {");
    expect(mainSource).toContain("search: (parsed) => getRetrievalService().searchCurrent(parsed)");
    expect(ipcSource).toContain("RetrievalSearchRequestSchema.safeParse(request)");
    expect(ipcSource).toContain("rawResult = await retrieval.search(parsedRequest.data)");
    expect(ipcSource).toContain('PigeDomainError("rag.search_unavailable"');
    expect(ipcSource).toContain("RetrievalSearchResultSchema.safeParse(rawResult)");
    expect(preloadSource).toContain("RetrievalSearchRequestSchema.safeParse(request)");
    expect(preloadSource).toContain('const response: unknown = await ipcRenderer.invoke("retrieval.search", parsedRequest.data)');
    expect(preloadSource).toContain("RetrievalSearchResultSchema.safeParse(response)");
    expect(preloadSource).not.toContain(
      'ipcRenderer.invoke("retrieval.search", request) as Promise<RetrievalSearchResult>'
    );
  });

  it("strictly exposes the local semantic asset lifecycle through one Main registrar", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-local-semantic-retrieval-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const channels = [
      "retrieval.localSemanticStatus",
      "retrieval.installLocalSemanticAsset",
      "retrieval.enableLocalSemanticAsset",
      "retrieval.disableLocalSemanticAsset",
      "retrieval.removeLocalSemanticAsset"
    ];

    expect(mainSource).toContain("registerLocalSemanticRetrievalIpc({");
    expect(mainSource).toContain("onEnabled: scheduleActivityIndexRebuild");
    expect(mainSource).toContain("await getLocalSemanticRetrievalService().recover()");
    expect(mainSource).toContain(
      "embeddingAssetEnabled: () => getLocalSemanticRetrievalService().embeddingModelInstalled()"
    );
    expect(registrarSource).toContain(
      'if (parsedResult.status === "committed" || parsedResult.status === "already_enabled")'
    );
    expect(registrarSource).toContain("options.onEnabled?.()");
    for (const channel of channels) {
      expect(registrarSource).toContain(`options.ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke(\n          "${channel}"`);
    }
    expect(registrarSource).toContain("LocalSemanticRetrievalStatusRequestSchema.parse(request)");
    expect(registrarSource).toContain("LocalSemanticRetrievalStatusSchema.parse(await options.status(parsed))");
    expect(registrarSource).not.toContain("path:");
    expect(registrarSource).not.toContain("sha256:");
    expect(registrarSource).not.toContain("url:");
  });

  it("strictly exposes the optional local reranker lifecycle without private asset authority", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-local-reranker-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const channels = [
      "retrieval.localRerankerStatus",
      "retrieval.installLocalReranker",
      "retrieval.enableLocalReranker",
      "retrieval.disableLocalReranker",
      "retrieval.removeLocalReranker"
    ];

    expect(mainSource).toContain("registerLocalRerankerIpc({");
    for (const channel of channels) {
      expect(registrarSource).toContain(`options.ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`"${channel}"`);
    }
    expect(registrarSource).toContain("LocalRerankerStatusRequestSchema.parse(request)");
    expect(registrarSource).toContain("LocalRerankerStatusSchema.parse(await options.status(parsed))");
    for (const privateField of ["path:", "sha256:", "url:"]) {
      expect(registrarSource).not.toContain(privateField);
    }
  });

  it("exposes one canonical high-risk confirmation with strict query, event, and resolve parsing", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const rendererStyles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const dialogSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/HighRiskConfirmationDialog.tsx"),
      "utf8"
    );
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/high-risk-confirmation-service.ts"),
      "utf8"
    );
    const confirmationsStart = preloadSource.indexOf("confirmations: {");
    const preloadApi = preloadSource.slice(
      confirmationsStart,
      preloadSource.indexOf("permissions: {", confirmationsStart)
    );

    expect(contractsSource).toContain("readonly confirmations: {");
    expect(contractsSource).toContain("readonly pending: () => Promise<HighRiskConfirmationPendingResult>");
    expect(mainSource).toContain('ipcMain.handle("confirmations.pending"');
    expect(mainSource).toContain("HighRiskConfirmationPendingResultSchema.parse(");
    expect(mainSource).toContain('ipcMain.handle("confirmations.resolve"');
    expect(mainSource).toContain("HighRiskConfirmationResolveRequestSchema.parse(request)");
    expect(mainSource).toContain('window.webContents.send("confirmations.changed", event)');
    expect(preloadApi).toContain('ipcRenderer.invoke("confirmations.pending")');
    expect(preloadApi).toContain("HighRiskConfirmationResolveRequestSchema.parse(request)");
    expect(preloadApi).toContain("HighRiskConfirmationResolveResultSchema.parse(");
    expect(preloadApi).toContain("HighRiskConfirmationChangedEventSchema.safeParse(value)");
    expect(preloadApi).toContain('ipcRenderer.on("confirmations.changed", handler)');
    expect(serviceSource).toContain("#inFlight");
    expect(serviceSource).toContain("withdraw(request: HighRiskConfirmationWithdrawal)");
    expect(rendererSource).toContain("window.pige.confirmations.onChanged");
    expect(rendererSource).toContain("window.pige.confirmations.pending()");
    expect(rendererSource).toContain("window.pige.confirmations.resolve({");
    expect(dialogSource).toContain('role="dialog"');
    expect(dialogSource).toContain('event.key !== "Escape"');
    expect(dialogSource).toContain('document.addEventListener("keydown", denyOnEscape, true)');
    expect(dialogSource).toContain('document.removeEventListener("keydown", denyOnEscape, true)');
    expect(dialogSource).toContain('props.onResolve("deny")');
    const confirmationStyles = rendererStyles.slice(
      rendererStyles.indexOf(".confirmation-backdrop"),
      rendererStyles.indexOf("@media (max-width: 420px)", rendererStyles.indexOf(".confirmation-backdrop"))
    );
    expect(confirmationStyles).toContain("var(--border-default)");
    expect(confirmationStyles).toContain("var(--surface-subtle)");
    expect(confirmationStyles).not.toContain("var(--border)");
    expect(confirmationStyles).not.toContain("var(--surface-soft)");
    for (const unsafeField of ["path", "command", "body", "hash", "credential", "provider", "rawError", "jobId"]) {
      expect(preloadApi).not.toContain(unsafeField);
    }
    expect(preloadApi).not.toContain("Permission");
  });

  it("exposes scoped permission policy settings without duplicating the confirmation effect gate", () => {
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const permissionsStart = preloadSource.indexOf("permissions: {");
    const preloadApi = preloadSource.slice(
      permissionsStart,
      preloadSource.indexOf("piPackages: {", permissionsStart)
    );

    expect(contractsSource).toContain("readonly permissions: {");
    expect(contractsSource).toContain("request: PermissionPolicySummaryRequest");
    expect(contractsSource).toContain("request: PermissionSetDefaultModeRequest");
    expect(contractsSource).toContain("request: PermissionRevokeGrantRequest");
    expect(preloadApi).toContain("PERMISSIONS_SUMMARY_CHANNEL");
    expect(preloadApi).toContain("PermissionPolicySummaryRequestSchema.parse(request)");
    expect(preloadApi).toContain("PERMISSIONS_SET_DEFAULT_MODE_CHANNEL");
    expect(preloadApi).toContain("PermissionSetDefaultModeRequestSchema.parse(request)");
    expect(preloadApi).toContain("PERMISSIONS_REVOKE_GRANT_CHANNEL");
    expect(preloadApi).toContain("PermissionRevokeGrantRequestSchema.parse(request)");
    expect(preloadApi).toContain("PermissionPolicyChangedEventSchema.safeParse(value)");
    expect(preloadApi).not.toContain("confirmations.resolve");
    for (const unsafeField of ["path", "body", "command", "bindingHash", "actorDigest", "resourceIdentityHash"]) {
      expect(preloadApi).not.toContain(unsafeField);
    }
    expect(schemasSource).toContain('"yolo_full_access"');
    expect(schemasSource).toContain("fullAccessAcknowledgement");
    expect(schemasSource).toContain('status: z.literal("confirmation_required")');
  });

  it("exposes strict renderer-safe reviewed-task interaction IPC without private OAuth state", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-task-execution-ipc.ts"),
      "utf8"
    );
    const taskExecutionStart = preloadSource.indexOf("taskExecution: {");
    const preloadApi = preloadSource.slice(
      taskExecutionStart,
      preloadSource.indexOf("skills: {", taskExecutionStart)
    );

    expect(contractsSource).toContain("readonly taskExecution: {");
    expect(contractsSource).toContain(
      "readonly interaction: () => Promise<TaskInteractionPendingResult>"
    );
    expect(contractsSource).toContain(
      "request: TaskInteractionOpenRequest"
    );
    expect(contractsSource).toContain(
      "listener: (event: TaskInteractionChangedEvent) => void"
    );
    expect(preloadApi).toContain('ipcRenderer.invoke("taskExecution.interaction")');
    expect(preloadApi).toContain("TaskInteractionPendingResultSchema.parse(");
    expect(preloadApi).toContain("TaskInteractionOpenRequestSchema.parse(request)");
    expect(preloadApi).toContain("TaskInteractionOpenResultSchema.parse(");
    expect(preloadApi).toContain("TaskInteractionChangedEventSchema.safeParse(value)");
    expect(preloadApi).toContain('ipcRenderer.on("taskExecution.interactionChanged", handler)');
    expect(registrarSource).toContain('options.ipcMain.handle("taskExecution.interaction"');
    expect(registrarSource).toContain("TaskInteractionPendingResultSchema.parse(");
    expect(registrarSource).toContain('options.ipcMain.handle("taskExecution.openInteraction"');
    expect(registrarSource).toContain("TaskInteractionOpenRequestSchema.parse(request)");
    expect(registrarSource).toContain("TaskInteractionOpenResultSchema.parse(");
    expect(registrarSource).toContain('"taskExecution.interactionChanged"');
    expect(registrarSource).toContain("TaskInteractionChangedEventSchema.parse(event)");
    for (const unsafeField of ["url", "deviceCode", "path", "body", "rawError", "argv", "command"]) {
      expect(preloadApi).not.toContain(unsafeField);
    }
  });

  it("projects Activity open authority as a parsed stable page identity without paths", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("interface KnowledgeActivityPageTarget");
    expect(contractsSource).toContain('readonly kind: "page"');
    expect(contractsSource).toContain("readonly pageId: string");
    expect(mainSource).toContain("KnowledgeActivityListResultSchema.parse(");
    expect(mainSource).toContain("KnowledgeActivityListRequestSchema.parse(request ?? {})");
    expect(preloadSource).toContain("async function invokeKnowledgeActivityList(");
    expect(preloadSource).toContain("const parsed = KnowledgeActivityListResultSchema.parse(await ipcRenderer.invoke(");
    const activityPreload = preloadSource.slice(
      preloadSource.indexOf("activity: {"),
      preloadSource.indexOf("proposals: {")
    );
    expect(activityPreload).not.toContain("path");
  });

  it("exposes pathless verified machine-local Skill lifecycle operations through strict IPC", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-skills-ipc.ts"),
      "utf8"
    );
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/skill-registry-service.ts"),
      "utf8"
    );
    const handlers = registrarSource;
    const preloadApi = preloadSource.slice(
      preloadSource.indexOf("skills: {"),
      preloadSource.indexOf("activity: {")
    );

    expect(contractsSource).toContain("readonly skills: {");
    expect(contractsSource).toContain("readonly summary: (request: SkillRegistryQueryRequest) => Promise<SkillRegistryQueryResult>;");
    expect(contractsSource).toContain("readonly pendingStagedReviews: (");
    expect(contractsSource).toContain("request: SkillPendingStagedReviewsRequest");
    expect(contractsSource).toContain("Promise<SkillPendingStagedReviewsResult>");
    expect(contractsSource).toContain("readonly stageFromUrl: (request: SkillStageFromUrlRequest)");
    expect(contractsSource).toContain("readonly stageFromMarkdown: (request: SkillStageFromMarkdownRequest)");
    expect(contractsSource).toContain("readonly stageFromZip: (request: SkillStageFromZipRequest)");
    expect(contractsSource).toContain("readonly stageUpdate: (request: SkillStageUpdateRequest)");
    expect(contractsSource).toContain("readonly installStaged: (request: SkillInstallStagedRequest)");
    expect(contractsSource).toContain("readonly discardStaged: (request: SkillDiscardStagedRequest)");
    expect(contractsSource).toContain("readonly disable: (request: SkillDisableRequest)");
    expect(contractsSource).toContain("readonly enable: (request: SkillEnableRequest)");
    expect(contractsSource).toContain("readonly uninstall: (request: SkillUninstallRequest)");
    expect(contractsSource).toContain("readonly restore: (request: SkillRestoreRequest)");
    expect(contractsSource).toContain("Promise<SkillRestoreResult>");
    expect(contractsSource).toContain("readonly export: (request: SkillExportRequest)");
    expect(contractsSource).toContain("readonly onChanged: (listener: (summary: SkillRegistrySummary)");
    expect(contractsSource).toContain("ExternalWebSkillRuntimeTurnBinding");
    expect(contractsSource).toContain("ExternalWebSkillRuntimeCall");
    expect(contractsSource).toContain("ExternalWebSkillRuntimeToolName");
    expect(contractsSource).toContain("ExternalWebSkillReadResult");
    expect(contractsSource).not.toContain("readonly readExternalWeb");
    expect(preloadApi).not.toContain("readExternalWeb");
    expect(mainSource).toContain("registerSkillsIpc({");
    expect(mainSource).toContain("restore: (request) => getScopedSkillRegistryService().restore(request)");
    expect(handlers).toContain('options.ipcMain.handle("skills.summary"');
    expect(handlers).toContain('options.ipcMain.handle("skills.pendingStagedReviews"');
    expect(handlers).toContain("SkillPendingStagedReviewsRequestSchema.parse(request)");
    expect(handlers).toContain("SkillPendingStagedReviewsResultSchema.parse(await options.pendingStagedReviews(parsed))");
    expect(handlers).toContain('options.ipcMain.handle("skills.stageFromUrl"');
    expect(handlers).toContain('options.ipcMain.handle("skills.installStaged"');
    expect(handlers).toContain('options.ipcMain.handle("skills.discardStaged"');
    expect(handlers).toContain("SkillDisableRequestSchema.parse(request)");
    expect(handlers).toContain("SkillRegistryMutationResultSchema.parse(await options.disable(parsed))");
    expect(handlers).toContain('registerInstalledMutation(options, "skills.enable"');
    expect(handlers).toContain('registerInstalledMutation(options, "skills.uninstall"');
    expect(handlers).toContain('options.ipcMain.handle("skills.export"');
    expect(handlers).toContain("await options.showSaveDialog(window");
    expect(handlers).toContain("options.getActiveVaultId() !== parsed.activeVaultId");
    expect(handlers).toContain("options.publishRegistryChanged(result)");
    expect(preloadApi).toContain('ipcRenderer.invoke("skills.summary",');
    expect(preloadApi).toContain("SkillRegistryQueryRequestSchema.parse(request)");
    expect(preloadApi).toContain('"skills.pendingStagedReviews"');
    expect(preloadApi).toContain("SkillPendingStagedReviewsRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillPendingStagedReviewsResultSchema.parse(");
    expect(preloadApi).toContain('"skills.stageFromUrl"');
    expect(preloadApi).toContain("SkillStageFromUrlRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillStageFromUrlResultSchema.parse(");
    expect(preloadApi).toContain('"skills.stageFromMarkdown"');
    expect(preloadApi).toContain("SkillStageFromMarkdownRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillStageFromMarkdownResultSchema.parse(");
    expect(preloadApi).toContain('"skills.stageFromZip"');
    expect(preloadApi).toContain("SkillStageFromZipRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillStageFromZipResultSchema.parse(");
    expect(preloadApi).toContain('"skills.stageUpdate"');
    expect(preloadApi).toContain("SkillStageUpdateRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillStageUpdateResultSchema.parse(");
    expect(preloadApi).toContain('"skills.installStaged"');
    expect(preloadApi).toContain("SkillInstallStagedRequestSchema.parse(request)");
    expect(preloadApi).toContain('"skills.discardStaged"');
    expect(preloadApi).toContain("SkillDiscardStagedRequestSchema.parse(request)");
    expect(preloadApi).toContain('ipcRenderer.invoke(\n        "skills.disable"');
    expect(preloadApi).toContain("SkillDisableRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillRegistryMutationResultSchema.parse(");
    expect(preloadApi).toContain('"skills.enable"');
    expect(preloadApi).toContain('"skills.uninstall"');
    expect(preloadApi).toContain('"skills.restore"');
    expect(preloadApi).toContain('"skills.export"');
    expect(preloadApi).toContain("SkillEnableRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillUninstallRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillRestoreRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillRestoreResultSchema.parse(");
    expect(preloadApi).toContain("SkillExportRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillExportResultSchema.parse(");
    expect(preloadApi).toContain('ipcRenderer.on("skills.changed", handler)');
    expect(preloadApi).toContain("SkillRegistrySummarySchema.safeParse(value)");
    expect(preloadApi).toContain('ipcRenderer.removeListener("skills.changed", handler)');
    for (const unsafeField of ["permissionSummary", "body", "secret"]) {
      expect(preloadApi).not.toContain(unsafeField);
    }
    expect(contractsSource).not.toContain("readonly installSkill:");
    expect(contractsSource).not.toContain("readonly enableSkill:");
    expect(contractsSource).not.toContain("readonly uninstallSkill:");
    expect(mainSource).toContain("app.requestSingleInstanceLock()");
    expect(mainSource).toContain("recoverOrphanedMutationLock: true");
    expect(serviceSource).toContain("acquireSkillRegistryMutationLock(this.#registryLockPath)");
    expect(serviceSource).toContain("fs.constants.O_EXCL");
    expect(serviceSource).toContain("parsed.ownerId !== ownerId");
    expect(serviceSource).toContain('status: "failed"');
    expect(serviceSource).toContain('messageKey: "error.generic"');
    expect(serviceSource).toContain("containsRestrictedModelContent(value)");
    for (const forbiddenRuntime of ["node:child_process", "node:http", "node:https", "fetch(", "spawn("]) {
      expect(serviceSource).not.toContain(forbiddenRuntime);
    }
  });

  it("registers first-party read-only Node OS capabilities only behind the main-owned permission registry", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");

    expect(mainSource).toContain("createFirstPartyReadonlyNodeOsCapabilityAdapters({");
    expect(mainSource).toContain("registerPermissionedExternalCapabilityAdapter(adapter)");
    expect(mainSource).toContain('join(home, ".ssh")');
    expect(mainSource).toContain('join(home, "Library", "Keychains")');
    expect(mainSource.indexOf("createFirstPartyReadonlyNodeOsCapabilityAdapters({"))
      .toBeLessThan(mainSource.indexOf("createPermissionedExternalCapabilityRegistry("));

    for (const toolName of [
      "pige_external_filesystem_list",
      "pige_external_filesystem_read_text",
      "pige_external_network_fetch_text"
    ]) {
      expect(preloadSource).not.toContain(toolName);
      expect(rendererSource).not.toContain(toolName);
    }
    for (const ambientNodeApi of ["node:fs", "node:child_process", "process.env"]) {
      expect(preloadSource).not.toContain(ambientNodeApi);
      expect(rendererSource).not.toContain(ambientNodeApi);
    }
  });

  it("registers exact Pi package install only behind main-owned permission authority", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const adapterSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/pi-package-capability-adapter.ts"),
      "utf8"
    );

    expect(mainSource).toContain("createPiPackageInstallCapabilityAdapter(getPiPackageManagerService())");
    expect(mainSource).toContain('new PiPackageManagerService({ appDataRoot: app.getPath("userData") })');
    expect(mainSource.indexOf("createPiPackageInstallCapabilityAdapter(getPiPackageManagerService())"))
      .toBeLessThan(mainSource.indexOf("createPermissionedExternalCapabilityRegistry("));
    expect(adapterSource).toContain('capability: "install_package"');
    expect(adapterSource).toContain('status: { const: "installed_disabled" }');
    expect(adapterSource).toContain('resourceScope: "none"');
    expect(preloadSource).not.toContain("pige_install_pi_package");
    expect(rendererSource).not.toContain("pige_install_pi_package");
  });

  it("registers the general OS command capability only in Main", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const adapterSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/command-capability-adapter.ts"),
      "utf8"
    );

    expect(mainSource).toContain("createFirstPartyCommandCapabilityAdapter()");
    expect(mainSource.indexOf("createFirstPartyCommandCapabilityAdapter()"))
      .toBeLessThan(mainSource.indexOf("createPermissionedExternalCapabilityRegistry("));
    expect(adapterSource).toContain('name: "pige_run_command"');
    expect(adapterSource).toContain('capability: "run_shell"');
    expect(adapterSource).toContain('shell such as zsh, bash, cmd, or PowerShell');
    expect(preloadSource).not.toContain("pige_run_command");
    expect(rendererSource).not.toContain("pige_run_command");
  });

  it("keeps durable proposal recovery internal while renderer decisions fail closed", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const approveHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("proposals.approve"'),
      mainSource.indexOf('ipcMain.handle("proposals.reject"')
    );
    const rejectHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("proposals.reject"'),
      mainSource.indexOf('ipcMain.handle("retrieval.search"')
    );

    expect(approveHandler).toContain("proposalRendererBoundaryUnavailable");
    expect(approveHandler).not.toContain("getJobsService().approveProposal");
    expect(approveHandler).not.toContain("getProposalService().approve");
    expect(rejectHandler).toContain("proposalRendererBoundaryUnavailable");
    expect(rejectHandler).not.toContain("getJobsService().rejectProposal");
    expect(rejectHandler).not.toContain("getProposalService().reject");
    expect(mainSource).toContain("recoverProposalDecisions(getProposalService())");
  });

  it("routes compact Activity and checksum-bound Undo through preload and main recovery", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const activityPanelSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/ActivityHistorySettingsPanel.tsx"),
      "utf8"
    );
    const undoHandler = rendererSource.slice(
      rendererSource.indexOf("const undoActivity"),
      rendererSource.indexOf("const handleDragEnter")
    );
    const mainUndoHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("activity.undo"'),
      mainSource.indexOf('ipcMain.handle("library.list"')
    );

    expect(mainSource).toContain('ipcMain.handle("activity.list"');
    expect(mainSource).toContain('ipcMain.handle("activity.undo"');
    expect(mainSource).toContain('ipcMain.handle("activity.redo"');
    expect(mainUndoHandler).toContain("getNoteTrashRedoService().redo(request)");
    expect(mainUndoHandler).toContain("getNoteRenameService().redo(request)");
    expect(mainUndoHandler).toContain("getLibraryTopicRenameService().redo(request)");
    expect(mainUndoHandler).toContain("getLibraryTagRenameService().redo(request)");
    expect(mainUndoHandler).toContain("getNoteMergeService().redo(request)");
    expect(mainUndoHandler).toContain("getKnowledgeHealthDuplicateTopicService().redo(request)");
    expect(mainUndoHandler).toContain("getKnowledgeActivityService().redo(request)");
    expect(mainSource).toContain("getAgentPageUpdateRedoService()");
    expect(mainUndoHandler).toContain("getAgentMemoryService().redo(request)");
    expect(mainUndoHandler).toContain('trashResult.status === "not_found"');
    expect(mainSource).toContain("recoverIncompleteUndos()");
    expect(mainSource).toContain("recoverIncompleteRedos()");
    expect(mainSource).toContain("scheduleActivityIndexRebuild()");
    expect(mainUndoHandler).toContain("scheduleActivityIndexRebuild()");
    expect(mainUndoHandler).not.toContain("getLocalDatabaseService().rebuild");
    expect(preloadSource).toContain('"activity.list",');
    expect(preloadSource).toContain("KnowledgeActivityListResultSchema.parse");
    expect(preloadSource).toContain('ipcRenderer.invoke("activity.undo", request)');
    expect(preloadSource).toContain('ipcRenderer.invoke("activity.redo", request)');
    expect(contractsSource).toContain('| "update_collection_cell"');
    expect(contractsSource).toContain('| "add_collection_row"');
    expect(contractsSource).toContain('| "add_collection_column"');
    expect(contractsSource).toContain('| "update_collection_formula"');
    expect(contractsSource).toContain('| "rename_collection_column"');
    expect(contractsSource).toContain('| "trash_collection_column"');
    expect(contractsSource).toContain('| "trash_collection_row"');
    expect(contractsSource).toContain('| "create_memory"');
    expect(contractsSource).toContain('| "update_memory"');
    expect(contractsSource).toContain('| "trash_memory"');
    expect(contractsSource).toContain('| "restore_memory"');
    expect(contractsSource).toContain("export interface KnowledgeActivityCollectionTarget");
    expect(contractsSource).toContain("readonly expectedRevisionId?: string;");
    expect(rendererSource).toContain('window.pige.activity.list({ limit: 20 })');
    expect(activityPanelSource).toContain('className="settings-page settings-history-page"');
    expect(activityPanelSource).toContain('activity.kind === "update_page"');
    expect(activityPanelSource).toContain('"activity.updatedPage"');
    expect(activityPanelSource).toContain('activity.kind === "rename_page"');
    expect(activityPanelSource).toContain('"activity.renamedPage"');
    expect(activityPanelSource).toContain('activity.kind === "create_memory"');
    expect(activityPanelSource).toContain('"activity.createdMemory"');
    expect(activityPanelSource).toContain('"activity.createdPage"');
    expect(rendererSource).toContain('onUndo={undoActivity}');
    expect(undoHandler).toContain('window.pige.activity.list({ limit: 20 })');
    expect(undoHandler).toContain('t("activity.undoStateUnknown")');
    expect(undoHandler).toContain("restoreActivityFocus(operationId)");
    expect(rendererSource).toContain('aria-live={captureToast.kind === "error" ? "assertive" : "polite"}');
    expect(undoHandler).not.toContain("caught instanceof Error ? caught.message");
  });

  it("keeps Knowledge Tree aggregation in main while exposing a body-free renderer bridge", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const knowledgeMapSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/KnowledgeTreeMap.tsx"),
      "utf8"
    );
    const librarySource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/library-service.ts"),
      "utf8"
    );

    expect(contractsSource).toContain("export interface KnowledgeTreeResult extends KnowledgeTreeSnapshot");
    expect(contractsSource).toContain("readonly tree: () => Promise<KnowledgeTreeResult>");
    expect(mainSource).toContain('ipcMain.handle("library.tree", () => getLibraryService().tree())');
    expect(preloadSource).toContain('ipcRenderer.invoke("library.tree")');
    expect(librarySource).toContain("this.#database?.knowledgeTree(vaultPath)");
    expect(rendererSource).toContain('type View = "home" | "library" | "knowledgeTree";');
    expect(rendererSource).toContain("export type SettingsSection =");
    expect(rendererSource).toContain("<KnowledgeTreeMap");
    expect(rendererSource).toContain('className="knowledge-tree-totals visually-hidden"');
    expect(knowledgeMapSource).toContain('role="tree"');
    expect(knowledgeMapSource).toContain('role="treeitem"');
    expect(knowledgeMapSource).toContain("<meter");
    expect(knowledgeMapSource).toContain("props.onOpenNote(active.pageId!, active.focusKey!)");
    expect(rendererSource).not.toContain("window.pige.filesystem");
    expect(knowledgeMapSource).not.toContain("window.pige.filesystem");
  });

  it("routes awaiting-review Jobs through the bounded renderer-safe proposal owner", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const proposalPanel = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/ProposalReviewPanel.tsx"),
      "utf8"
    );
    const proposalRegistrar = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-proposal-ipc.ts"),
      "utf8"
    );
    const styles = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/styles/app.css"), "utf8");
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );

    expect(rendererSource).toContain(
      'states: ["queued", "running", "waiting_dependency", "waiting_permission", "failed_retryable", "failed_final"]'
    );
    expect(rendererSource).toContain('homeJobStateFilter.states.push("awaiting_review")');
    expect(rendererSource).toContain("...homeJobStateFilter");
    expect(rendererSource).toContain("limit: 100");
    expect(homeComposer).toContain(".slice(0, 5)");
    expect(homeComposer).toContain("isActiveProcessingFileJob(job)");
    expect(rendererSource).toContain("if (!job.sourceDisplayName && !job.sourceId) return false;");
    expect(mainSource).toContain('ipcMain.handle("proposals.list", proposalRendererBoundaryUnavailable)');
    expect(mainSource).toContain('ipcMain.handle("proposals.get", proposalRendererBoundaryUnavailable)');
    expect(mainSource).toContain('ipcMain.handle("proposals.approve", proposalRendererBoundaryUnavailable)');
    expect(mainSource).toContain('ipcMain.handle("proposals.reject", proposalRendererBoundaryUnavailable)');
    expect(mainSource).toContain('"proposal.renderer_preview_unavailable"');
    expect(mainSource).not.toContain('getProposalService().get(request)');
    expect(mainSource).not.toContain('getJobsService().approveProposal(getProposalService(), request)');
    expect(mainSource).not.toContain('getJobsService().rejectProposal(getProposalService(), request)');
    expect(homeComposer).toContain('job.state === "awaiting_review"');
    expect(homeComposer).toContain("<ProposalReviewPanel");
    expect(proposalPanel).toContain("window.pige.proposals.review");
    expect(proposalPanel).toContain("window.pige.proposals.decide");
    expect(proposalRegistrar).toContain('handle("proposals.review"');
    expect(proposalRegistrar).toContain('handle("proposals.decide"');
    expect(proposalPanel).not.toContain("ConfirmationProposal");
    expect(proposalPanel).not.toMatch(/sourceRefs|targetRefs|baseHashes|proposedOperations/);
    const proposalStyles = styles.slice(
      styles.indexOf(".proposal-strip"),
      styles.indexOf(".retrieval-results")
    );
    expect(proposalStyles).toContain("min-width: 0;");
    expect(proposalStyles).toContain("overflow-wrap: anywhere;");
    expect(rendererSource).toContain('type View = "home" | "library" | "knowledgeTree";');
    expect(rendererSource).toContain("export type SettingsSection =");
    expect(rendererSource).not.toContain('type View = "review"');
  });

  it("keeps reviewed preset credentials scoped and the custom form discovery-first", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const styles = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/styles/app.css"), "utf8");
    const panel = rendererSource.slice(
      rendererSource.indexOf("function ModelSettingsPanel"),
      rendererSource.indexOf("function InfoGroup")
    );
    const presetSurface = panel.slice(
      panel.indexOf('if (view.kind === "preset" && selectedPreset)'),
      panel.indexOf('if (view.kind === "custom")')
    );

    expect(presetSurface).toContain('type="password"');
    expect(presetSurface).toContain('selectedPreset.authRequirement !== "none"');
    expect(presetSurface).toContain('selectedPreset.authRequirement === "api_key"');
    expect(panel).toContain("addPresetProvider");
    expect(presetSurface).not.toContain("manualModelId");
    expect(presetSurface).not.toContain("baseUrl");
    expect(panel).toContain('if (view.kind === "custom")');
    expect(panel).toContain('id="provider-protocol"');
    expect(panel).toContain('!retryDiscovery && manualBootstrap ? { manualModelId: manualModelId.trim() } : {}');
    expect(panel).toContain("setManualBootstrap(result)");
    expect(panel).toContain("result.discoveredModels");
    expect(panel).toContain('id="global-default-model"');
    expect(panel).toContain("refreshProviderModels");
    expect(panel).toContain("providerRuntimeStatusKey(provider)");
    expect(panel).toContain('props.t("models.manage")');
    expect(panel).toContain("providerSyncFailures.has(selectedProvider.id)");
    expect(panel).toContain("onRefresh={() => refreshProviderModels(selectedProvider.id)}");
    expect(panel).not.toContain("providerSyncFailures.has(provider.id)");
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('setFailure({ kind: "preset", presetId })');
    expect(panel).not.toContain("props.onError");
    expect(panel).not.toContain("props.onRefreshVaultState");
    expect(panel).toContain("props.onRefreshAgentRuntimeStatus");
    expect(panel).toContain("addManualModel");
    expect(panel).toContain("setModelEnabled");
    expect(panel).toContain("setModelDisplayName");
    expect(panel).not.toContain('id="cloud-boundary"');
    expect(panel).not.toContain('id="provider-kind"');
    for (const channel of ["models.refreshProviderModels", "models.addManualModel", "models.updateModel"]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke("${channel}"`);
    }
    expect(styles).toContain(".conversation-status-content p");
    expect(styles).toContain(".conversation-loading-dots");
    expect(styles).toContain("overflow-wrap: anywhere");
  });

  it("feeds runtime-owned parser, OCR, and search capabilities into Agent policy snapshots", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).toContain("const getAgentCapabilitySnapshot");
    expect(mainSource).toContain('parser.canParse("pdf_file")');
    expect(mainSource).toContain('getOcrService().canOcr("image_file")');
    expect(mainSource).toContain('lexicalSearchAvailable: localDatabaseStatus === "ready"');
    expect(mainSource).toContain("{ snapshot: getAgentCapabilitySnapshot }");
  });

  it("exposes structured sources through unified Agent ingress and the bundled Dataset capability", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const captureDropZoneSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/HomeCaptureDropZone.tsx"),
      "utf8"
    );
    const buildSource = fs.readFileSync(path.resolve("apps/desktop/electron.vite.config.ts"), "utf8");
    const queryServiceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/dataset-query-service.ts"),
      "utf8"
    );
    const queryWorkerSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/workers/dataset-query-worker.ts"),
      "utf8"
    );

    expect(captureDropZoneSource).toContain(".csv,.xlsx,.sqlite,.sqlite3,.db");
    expect(rendererSource).toContain("function DatasetAnswerResult");
    expect(mainSource).toContain("new DatasetService(new DatasetIngestWorkerService())");
    expect(mainSource).toContain("new DatasetQueryService()");
    expect(mainSource).toContain("getDatasetQueryService()");
    expect(mainSource).toContain('getDatasetService().canMaterialize("csv_file")');
    expect(mainSource).toMatch(/getDatasetService\(\),\s+getJobClassExecutorRegistry\(\)/u);
    expect(buildSource).toContain("DATASET_QUERY_WORKER_ENTRY_NAME");
    expect(buildSource).toContain('alias("./src/main/workers/dataset-query-worker.ts")');
    expect(buildSource).toContain('"services/permissioned-external-capability-service": alias(');
    expect(buildSource).toContain(
      '"./src/main/services/permissioned-external-capability-service.ts"'
    );
    expect(queryServiceSource).not.toContain("node:sqlite");
    expect(queryServiceSource).not.toContain('from "./dataset-query-core"');
    expect(queryWorkerSource).toContain('from "../services/dataset-query-core"');
  });

  it("strictly validates the Managed Collection IPC and preload boundaries", () => {
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const registrarSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/register-managed-collection-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly list: (request: CollectionListRequest)");
    expect(contractsSource).toContain("Promise<CollectionListResult>");
    expect(contractsSource).toContain("readonly openCitation:");
    expect(contractsSource).toContain("readonly reveal: (request: CollectionRevealRequest)");
    expect(contractsSource).toContain("request: CollectionOpenCitationRequest");
    expect(contractsSource).toContain("Promise<CollectionOpenCitationResult>");
    expect(registrarSource).toContain('ipcMain.handle("collections.list"');
    expect(registrarSource).toContain('ipcMain.handle("collections.open"');
    expect(registrarSource).toContain('ipcMain.handle("collections.openCitation"');
    expect(registrarSource).toContain("ipcMain.handle(COLLECTION_REVEAL_CHANNEL");
    expect(registrarSource).toContain('ipcMain.handle("collections.editCell"');
    expect(registrarSource).toContain("CollectionOpenRequestSchema.parse(request)");
    expect(registrarSource).toContain("CollectionListRequestSchema.parse(request)");
    expect(registrarSource).toContain("CollectionListResultSchema.parse(rawResult)");
    expect(registrarSource).toContain("CollectionOpenResultSchema.parse(rawResult)");
    expect(registrarSource).toContain("CollectionOpenCitationRequestSchema.parse(request)");
    expect(registrarSource).toContain("CollectionOpenCitationResultSchema.parse(rawResult)");
    expect(registrarSource).toContain("CollectionRevealRequestSchema.parse(request)");
    expect(registrarSource).toContain("CollectionRevealResultSchema.parse(await options.revealCollection(parsed))");
    expect(registrarSource).toContain("CollectionCellEditRequestSchema.parse(request)");
    expect(registrarSource).toContain("CollectionCellEditResultSchema.parse(rawResult)");
    expect(registrarSource).toContain(
      "CollectionAddFormulaColumnRequestSchema.parse(request)"
    );
    expect(registrarSource).toContain(
      "CollectionAddFormulaColumnResultSchema.parse(rawResult)"
    );
    expect(registrarSource).toContain(
      "ipcMain.handle(COLLECTION_ADD_FORMULA_COLUMN_CHANNEL"
    );
    expect(registrarSource).toContain(
      "ipcMain.handle(COLLECTION_ADD_RELATION_COLUMN_CHANNEL"
    );
    expect(registrarSource).toContain(
      "ipcMain.handle(COLLECTION_EDIT_RELATION_CELL_CHANNEL"
    );
    expect(registrarSource).toContain("options.getActiveVaultId() !== parsed.activeVaultId");
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.open", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.openCitation", parsedRequest)');
    expect(preloadSource).toContain("ipcRenderer.invoke(COLLECTION_REVEAL_CHANNEL, parsedRequest)");
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.list", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.editCell", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.appendDefaultRow", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.addNullableColumn", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.renameColumn", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.createView", parsedRequest)');
    expect(preloadSource).toContain("ipcRenderer.invoke(COLLECTION_UPDATE_VIEW_CHANNEL, parsedRequest)");
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.trashColumn", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("collections.trashRow", parsedRequest)');
    expect(preloadSource).toContain("CollectionOpenRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionListRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionListResultSchema.parse(");
    expect(preloadSource).toContain("CollectionOpenResultSchema.parse(");
    expect(preloadSource).toContain("CollectionCellEditRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionCellEditResultSchema.parse(");
    expect(preloadSource).toContain("CollectionAppendDefaultRowRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionAppendDefaultRowResultSchema.parse(");
    expect(preloadSource).toContain("CollectionAddNullableColumnRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionAddNullableColumnResultSchema.parse(");
    expect(preloadSource).toContain("CollectionAddFormulaColumnRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionAddFormulaColumnResultSchema.parse(");
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(COLLECTION_ADD_FORMULA_COLUMN_CHANNEL, parsedRequest)"
    );
    expect(preloadSource).toContain("CollectionRenameColumnRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionRenameColumnResultSchema.parse(");
    expect(preloadSource).toContain("CollectionCreateViewRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionCreateViewResultSchema.parse(");
    expect(preloadSource).toContain("CollectionUpdateViewRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionUpdateViewResultSchema.parse(");
    expect(preloadSource).toContain("CollectionTrashColumnRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionTrashColumnResultSchema.parse(");
    expect(preloadSource).toContain("CollectionTrashRowRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionTrashRowResultSchema.parse(");
    expect(contractsSource).toContain("readonly appendDefaultRow:");
    expect(contractsSource).toContain("CollectionAppendDefaultRowRequest");
    expect(contractsSource).toContain("readonly addNullableColumn:");
    expect(contractsSource).toContain("CollectionAddNullableColumnRequest");
    expect(schemasSource).toContain(
      'COLLECTION_ADD_FORMULA_COLUMN_CHANNEL = "collections.addFormulaColumn"'
    );
    expect(schemasSource).toContain(
      'COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL = "collections.updateFormulaColumn"'
    );
    expect(contractsSource).toContain("readonly addFormulaColumn:");
    expect(contractsSource).toContain("CollectionAddFormulaColumnRequest");
    expect(contractsSource).toContain("Promise<CollectionAddFormulaColumnResult>");
    expect(preloadSource).toContain("addFormulaColumn: invokeCollectionAddFormulaColumn");
    expect(preloadSource).toContain("CollectionAddRelationColumnRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionAddRelationColumnResultSchema.parse(");
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(COLLECTION_ADD_RELATION_COLUMN_CHANNEL, parsedRequest)"
    );
    expect(preloadSource).toContain("CollectionEditRelationCellRequestSchema.parse(request)");
    expect(preloadSource).toContain("CollectionEditRelationCellResultSchema.parse(");
    expect(preloadSource).toContain(
      "ipcRenderer.invoke(COLLECTION_EDIT_RELATION_CELL_CHANNEL, parsedRequest)"
    );
    expect(preloadSource).toContain("addRelationColumn: invokeCollectionAddRelationColumn");
    expect(preloadSource).toContain("editRelationCell: invokeCollectionEditRelationCell");
    expect(preloadSource).toContain("updateRelationColumn: invokeCollectionUpdateRelationColumn");
    expect(mainSource).toContain(
      "addRelationCollectionColumn: (request) => getManagedCollectionService().addRelationColumn(request)"
    );
    expect(mainSource).toContain(
      "editRelationCollectionCell: (request) => getManagedCollectionService().editRelationCell(request)"
    );
    expect(mainSource).toContain(
      "updateRelationCollectionColumn: (request) => getManagedCollectionService().updateRelationColumn(request)"
    );
    expect(contractsSource).toContain("readonly updateFormulaColumn:");
    expect(contractsSource).toContain("CollectionUpdateFormulaColumnRequest");
    expect(contractsSource).toContain("Promise<CollectionUpdateFormulaColumnResult>");
    expect(schemasSource).toContain(
      'COLLECTION_ADD_RELATION_COLUMN_CHANNEL = "collections.addRelationColumn"'
    );
    expect(schemasSource).toContain(
      'COLLECTION_EDIT_RELATION_CELL_CHANNEL = "collections.editRelationCell"'
    );
    expect(schemasSource).toContain(
      'COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL = "collections.updateRelationColumn"'
    );
    expect(contractsSource).toContain("readonly addRelationColumn:");
    expect(contractsSource).toContain("CollectionAddRelationColumnRequest");
    expect(contractsSource).toContain("Promise<CollectionAddRelationColumnResult>");
    expect(contractsSource).toContain("readonly editRelationCell:");
    expect(contractsSource).toContain("CollectionEditRelationCellRequest");
    expect(contractsSource).toContain("Promise<CollectionEditRelationCellResult>");
    expect(contractsSource).toContain("readonly updateRelationColumn:");
    expect(contractsSource).toContain("CollectionUpdateRelationColumnRequest");
    expect(contractsSource).toContain("Promise<CollectionUpdateRelationColumnResult>");
    expect(contractsSource).not.toContain("listRelationTargets");
    expect(contractsSource).toContain("readonly renameColumn:");
    expect(contractsSource).toContain("CollectionRenameColumnRequest");
    expect(contractsSource).toContain("readonly createView:");
    expect(contractsSource).toContain("CollectionCreateViewRequest");
    expect(contractsSource).toContain("readonly updateView:");
    expect(contractsSource).toContain("CollectionUpdateViewRequest");
    expect(contractsSource).toContain("readonly trashColumn:");
    expect(contractsSource).toContain("CollectionTrashColumnRequest");
    expect(contractsSource).toContain("readonly trashRow:");
    expect(contractsSource).toContain("CollectionTrashRowRequest");
  });

  it("wires onboarding readiness to the non-secret provider runtime binding check", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    expect(mainSource.match(/getModelProviderRegistry\(\)\.hasDefaultRuntimeBinding\(\)/gu)).toHaveLength(2);
    expect(mainSource).not.toContain("getModelProviderRegistry().hasDefaultModel()");
    expect(mainSource).toContain('ipcMain.handle("onboarding.dismissFirstHome"');
    expect(preloadSource).toContain('ipcRenderer.invoke("onboarding.dismissFirstHome")');
  });

  it("does not forward dynamic caught messages into persisted diagnostics", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).not.toContain("caught instanceof Error ? caught.message");
    expect(mainSource).not.toMatch(/recordEvent\([\s\S]{0,240}message:\s*caught\.message/);
  });

  it("keeps the typed update lifecycle unavailable without a trusted signing identity", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/update-service.ts"),
      "utf8"
    );
    const adapterSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/electron-updater-adapter.ts"),
      "utf8"
    );

    expect(contractsSource).toContain("readonly updates:");
    expect(contractsSource).toContain("readonly summary: () => Promise<UpdateSummary>");
    expect(contractsSource).toContain("readonly check: (request: UpdateCheckRequest) => Promise<UpdateCheckResult>");
    expect(contractsSource).toContain("readonly download: (request: UpdateDownloadRequest) => Promise<UpdateDownloadResult>");
    expect(contractsSource).toContain("readonly apply: (request: UpdateApplyRequest) => Promise<UpdateApplyResult>");
    expect(contractsSource).toContain("readonly onStatusChanged:");
    expect(schemasSource).toContain('export const UpdateCapabilitySchema = z.enum([');
    expect(mainSource).toContain('ipcMain.handle("updates.summary"');
    expect(mainSource).toContain('ipcMain.handle("updates.check"');
    expect(mainSource).toContain('ipcMain.handle("updates.download"');
    expect(mainSource).toContain('ipcMain.handle("updates.apply"');
    expect(mainSource).toContain('browserWindow.webContents.send("updates.statusChanged", parsed)');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.summary")');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.check", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.download", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.apply", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.on("updates.statusChanged", handler)');
    expect(serviceSource).toContain("class NoNetworkUpdateCheckAdapter");
    expect(mainSource.match(/new NoNetworkUpdateCheckAdapter\(\)/gu)).toHaveLength(2);
    expect(mainSource).not.toContain("new ElectronUpdaterAdapter");
    expect(serviceSource).not.toContain("electron-updater");
    expect(serviceSource).not.toContain("fetch(");
    expect(serviceSource).not.toContain("https://");
    expect(adapterSource).toContain('from "electron-updater"');
    expect(adapterSource).not.toContain("feedURL");
    expect(preloadSource).not.toContain("feedUrl");
    expect(contractsSource).not.toContain("feedUrl");
  });
});
