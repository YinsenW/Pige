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

describe("desktop shell build contract", () => {
  it("uses a CommonJS preload entry compatible with Electron sandboxed preload execution", () => {
    expect(PRELOAD_ENTRY_FILENAME).toBe("index.cjs");
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
    const resetHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("maintenance.resetLocalDatabase"'),
      mainSource.indexOf('ipcMain.handle("maintenance.localDatabaseStatus"')
    );
    const providerHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.addManualProvider"'),
      mainSource.indexOf('ipcMain.handle("models.setDefaultModel"')
    );
    const presetHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("models.addPresetProvider"'),
      mainSource.indexOf('ipcMain.handle("models.addManualProvider"')
    );
    expect(resetHandler.indexOf("confirmSettingAction")).toBeLessThan(resetHandler.indexOf("getVaultService().resetLocalDatabase()"));
    expect(providerHandler.indexOf("AddManualProviderRequestSchema.parse(request)")).toBeLessThan(providerHandler.indexOf("confirmSettingAction"));
    expect(providerHandler.indexOf("confirmSettingAction")).toBeLessThan(providerHandler.indexOf("getModelProviderRegistry().addManualProvider(validatedRequest)"));
    expect(presetHandler.indexOf("AddPresetProviderRequestSchema.parse(request)")).toBeLessThan(presetHandler.indexOf("confirmSettingAction"));
    expect(presetHandler.indexOf("confirmSettingAction")).toBeLessThan(presetHandler.indexOf("getModelProviderRegistry().addPresetProvider(validatedRequest)"));
    for (const handler of [presetHandler, providerHandler]) {
      expect(handler).toContain("ordinary, private, and bounded large content");
      expect(handler).toContain("Sensitive content still asks each time; restricted content is never sent.");
      expect(handler).toContain("endpoint or trust boundary changes or becomes unknown");
    }
  });

  it("binds restore apply to the exact preview token across renderer, preload, and main", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const registrySource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/restore-preview-registry.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");

    expect(contractsSource.match(/readonly previewToken: string;/gu)).toHaveLength(2);
    expect(mainSource).toContain("restorePreviewRegistry.claim(senderId, request)");
    expect(mainSource).toContain("restorePreviewRegistry.isCurrent(senderId, acceptedPreview)");
    expect(mainSource).toContain("acceptedPreview.archivePreviewToken");
    expect(mainSource).toContain("restorePreviewRegistry.release(senderId, acceptedPreview)");
    expect(mainSource).toContain("restorePreviewRegistry.consume(senderId, acceptedPreview)");
    expect(mainSource).toContain('new PigeDomainError("restore.backup_invalid"');
    expect(registrySource).toContain("readonly #states = new Map<number, RestorePreviewState>();");
    expect(registrySource).toContain("publicPreviewToken: createPublicPreviewToken()");
    expect(preloadSource).toContain('ipcRenderer.invoke("restore.apply", request)');
    expect(rendererSource.match(/previewToken: restorePreview\.previewToken!?/gu)).toHaveLength(2);
    expect(rendererSource.match(/setRestorePreview\(null\);/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("wires Home questions through Pi with visible typed outcomes and no raw provider error surface", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const runtimeSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/pi-agent-runtime-adapter.ts"),
      "utf8"
    );
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );

    expect(mainSource).toContain('ipcMain.handle("agent.submitTurn"');
    expect(mainSource).toContain('event.sender.send("agent.turnDraft", draft)');
    expect(mainSource).toContain("return await getHomeAgentService().submitTurn(normalizedRequest, draftContext)");
    expect(mainSource).toContain("draftPublisher.close()");
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.submitTurn", { request, filePaths })');
    expect(preloadSource).toContain('ipcRenderer.on("agent.turnDraft", handleDraft)');
    expect(preloadSource).toContain('ipcRenderer.removeListener("agent.turnDraft", handleDraft)');
    expect(contractsSource).toContain("export interface AgentTurnDraftEvent");
    expect(contractsSource).toContain("readonly onTurnDraft:");
    expect(runtimeSource).toContain("readSafeTerminalDraft(event, request.terminalDraft)");
    expect(runtimeSource).toContain('toolName: "pige_finish_home_turn"');
    expect(preloadSource).not.toContain('ipcRenderer.invoke("capture.submit');
    expect(preloadSource).not.toContain('ipcRenderer.invoke("retrieval.ask"');
    expect(homeComposer).toContain("window.pige.agent.submitTurn");
    expect(homeComposer).toContain('setAgentRunState("accepted")');
    expect(homeComposer).toContain('setAgentRunState("running")');
    expect(homeComposer).toContain("outcome.error");
    expect(homeComposer).toContain("outcome.modelUsage");
    expect(homeComposer).toContain('plannedModelUsage === "cloud" ? "home.cloudSend" : null');
    expect(homeComposer).toContain('agentModelUsage === "cloud" ? "home.cloudCallAttempted" : null');
    expect(homeComposer).toContain("setAgentModelUsage(outcome.modelUsage)");
    expect(rendererSource).toContain('status.policySnapshot?.cloudBoundary === "local" &&');
    expect(rendererSource).toContain('status.policySnapshot.boundaryVerification === "loopback_verified"');
    expect(rendererSource).toContain('props.result.warnings.includes("insufficient_evidence")');
    expect(rendererSource).toContain('props.result.answerMode === "model_grounded" ? "retrieval.modelGrounded" : "retrieval.localOnly"');
    expect(rendererSource).toContain('props.t("retrieval.cloudSent")');
    expect(rendererSource).not.toContain("function isLikelyQuestion");
    expect(rendererSource).not.toContain("function extractSingleCaptureUrl");
    expect(homeComposer).not.toContain("window.pige.capture.submitText");
    expect(homeComposer).not.toContain("window.pige.capture.submitUrl");
    expect(homeComposer).toContain("classifyTextTransportKind(turnText)");
    expect(rendererSource).toContain('if (view === "home")');
    expect(rendererSource).toContain("setHomeFileDropRequest({");
    expect(rendererSource).toContain('void submitFiles(files, "file_drop", undefined, clientTurnId, "shell")');
    expect(homeComposer).toContain("props.fileDropRequest");
    expect(homeComposer).toContain("void submitHomeFiles(request.files, request.text, request.clientTurnId)");
    expect(homeComposer).toContain('data-agent-draft="true"');
    expect(homeComposer).toContain("aria-busy={agentDraft !== null}");
    expect(homeComposer).toContain("event.sequence <= active.sequence");
    expect(rendererSource).toContain('...(homeDraftText.trim() ? { text: homeDraftText } : {})');
    expect(homeComposer).toContain("const text = props.draftText");
    expect(homeComposer).toContain("props.onDraftChange(event.target.value)");
    expect(homeComposer).toContain('job.class !== "retrieval_query"');
    expect(rendererSource).toContain('classes: ["capture", "parse", "ocr", "agent_ingest", "agent_turn", "index_rebuild"]');
    const submitHomeInput = homeComposer.slice(
      homeComposer.indexOf("const submitHomeInput"),
      homeComposer.indexOf("const openProposal")
    );
    expect(submitHomeInput).not.toContain("caught instanceof Error ? caught.message");
    const retryHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("jobs.retry"'),
      mainSource.indexOf('ipcMain.handle("library.list"')
    );
    expect(retryHandler).toContain('result.job?.class === "agent_turn"');
    expect(retryHandler).toContain("scheduleAgentIngestProcessing()");
    expect(retryHandler).toContain("scheduleAgentTurnProcessing()");
  });

  it("routes proposal decisions through durable Job apply and startup recovery", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const approveHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("proposals.approve"'),
      mainSource.indexOf('ipcMain.handle("proposals.reject"')
    );
    const rejectHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("proposals.reject"'),
      mainSource.indexOf('ipcMain.handle("retrieval.search"')
    );

    expect(approveHandler).toContain("getJobsService().approveProposal(getProposalService(), request)");
    expect(approveHandler).not.toContain("getProposalService().approve(request)");
    expect(rejectHandler).toContain("getJobsService().rejectProposal(getProposalService(), request)");
    expect(mainSource).toContain("recoverProposalDecisions(getProposalService())");
  });

  it("routes compact Activity and checksum-bound Undo through preload and main recovery", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
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
    expect(mainSource).toContain("recoverIncompleteUndos()");
    expect(mainSource).toContain("scheduleActivityIndexRebuild()");
    expect(mainUndoHandler).toContain("scheduleActivityIndexRebuild()");
    expect(mainUndoHandler).not.toContain("getLocalDatabaseService().rebuild");
    expect(preloadSource).toContain('ipcRenderer.invoke("activity.list", request)');
    expect(preloadSource).toContain('ipcRenderer.invoke("activity.undo", request)');
    expect(contractsSource).toContain('readonly kind: "create_page" | "update_page";');
    expect(rendererSource).toContain('window.pige.activity.list({ limit: 5 })');
    expect(rendererSource).toContain('className="activity-strip"');
    expect(rendererSource).toContain('activity.kind === "update_page"');
    expect(rendererSource).toContain('"activity.updatedPage"');
    expect(rendererSource).toContain('"activity.createdPage"');
    expect(rendererSource).toContain('props.onUndoActivity(activity.operationId)');
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
    const librarySource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/library-service.ts"),
      "utf8"
    );

    expect(contractsSource).toContain("export interface KnowledgeTreeResult extends KnowledgeTreeSnapshot");
    expect(contractsSource).toContain("readonly tree: () => Promise<KnowledgeTreeResult>");
    expect(mainSource).toContain('ipcMain.handle("library.tree", () => getLibraryService().tree())');
    expect(preloadSource).toContain('ipcRenderer.invoke("library.tree")');
    expect(librarySource).toContain("this.#database?.knowledgeTree(vaultPath)");
    expect(rendererSource).toContain('type View = "home" | "library" | "knowledgeTree" | "settings" | "models";');
    expect(rendererSource).toContain('className="knowledge-tree-roots"');
    expect(rendererSource).toContain("<meter");
    expect(rendererSource).not.toContain("window.pige.filesystem");
  });

  it("surfaces ready proposals in Home with a focused escaped preview before durable decisions", () => {
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const panelSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/ProposalReviewPanel.tsx"),
      "utf8"
    );
    const styles = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/styles/app.css"), "utf8");
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );
    const openProposal = homeComposer.slice(
      homeComposer.indexOf("const openProposal"),
      homeComposer.indexOf("const openResult")
    );

    expect(rendererSource).toContain(
      'states: ["queued", "running", "waiting_dependency", "failed_retryable", "failed_final"]'
    );
    expect(rendererSource).toContain('homeJobStateFilter.states.push("awaiting_review")');
    expect(rendererSource).toContain("...homeJobStateFilter");
    expect(rendererSource).toContain('window.pige.proposals.list({ limit: 100, states: ["ready"] })');
    expect(homeComposer).toContain("window.pige.proposals.get({ proposalId })");
    expect(homeComposer).toContain('window.pige.proposals[decision]({ proposalId })');
    expect(homeComposer).toContain("proposalOutcomeForDurableState(current.proposal.state)");
    expect(homeComposer).toContain("setProposalDecisionStateUnknown(true)");
    expect(homeComposer).toContain("proposalReviewTriggerRefs.current.get(proposalFocusReturnId.current)");
    expect(homeComposer).toContain("aria-expanded={proposalListExpanded}");
    expect(homeComposer).toContain('aria-controls="home-proposal-summary-list"');
    expect(homeComposer).toContain('aria-label={`${props.t("proposal.review")}: ${accessibleProposalLabel}`}');
    expect(homeComposer).toContain("<ProposalReviewPanel");
    expect(openProposal).not.toContain("caught instanceof Error ? caught.message");
    expect(panelSource).toContain("<pre aria-label={t(\"proposal.markdownPreview\")}>{operation.content}</pre>");
    expect(panelSource).not.toContain("dangerouslySetInnerHTML");
    const proposalStyles = styles.slice(
      styles.indexOf(".proposal-strip"),
      styles.indexOf(".retrieval-results")
    );
    expect(proposalStyles).toContain("min-width: 0;");
    expect(proposalStyles).toContain("overflow-wrap: anywhere;");
    expect(proposalStyles).toContain("max-height: min(46vh, 30rem);");
    expect(proposalStyles).toContain("position: sticky;");
    expect(rendererSource).toContain('type View = "home" | "library" | "knowledgeTree" | "settings" | "models";');
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
      panel.indexOf('className="preset-provider"'),
      panel.indexOf('className="custom-provider"')
    );

    expect(presetSurface).toContain('type="password"');
    expect(presetSurface).toContain('preset.authRequirement !== "none"');
    expect(presetSurface).toContain('preset.authRequirement === "api_key"');
    expect(panel).toContain("addPresetProvider");
    expect(presetSurface).not.toContain("manualModelId");
    expect(presetSurface).not.toContain("baseUrl");
    expect(panel).toContain('<details className="custom-provider">');
    expect(panel).toContain('id="provider-protocol"');
    expect(panel).toContain('manualBootstrap ? { manualModelId: manualModelId.trim() } : {}');
    expect(panel).toContain("setManualBootstrap(result)");
    expect(panel).toContain("result.discoveredModels");
    expect(panel).toContain('id="global-default-model"');
    expect(panel).toContain("refreshProviderModels");
    expect(panel).toContain("providerSyncFailures.has(provider.id)");
    expect(panel).toContain('role="alert"');
    expect(panel).toContain("addManualModel");
    expect(panel).toContain("setModelEnabled");
    expect(panel).toContain("setModelDisplayName");
    expect(panel).not.toContain('id="cloud-boundary"');
    expect(panel).not.toContain('id="provider-kind"');
    for (const channel of ["models.refreshProviderModels", "models.addManualModel", "models.updateModel"]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`);
      expect(preloadSource).toContain(`ipcRenderer.invoke("${channel}"`);
    }
    expect(styles).toContain(".agent-run-state > span:nth-child(2)");
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
    const buildSource = fs.readFileSync(path.resolve("apps/desktop/electron.vite.config.ts"), "utf8");
    const queryServiceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/dataset-query-service.ts"),
      "utf8"
    );
    const queryWorkerSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/workers/dataset-query-worker.ts"),
      "utf8"
    );

    expect(rendererSource).toContain(".csv,.xlsx,.sqlite,.sqlite3,.db");
    expect(rendererSource).toContain("function DatasetAnswerResult");
    expect(mainSource).toContain("new DatasetService(new DatasetIngestWorkerService())");
    expect(mainSource).toContain("new DatasetQueryService()");
    expect(mainSource).toContain("getDatasetQueryService()");
    expect(mainSource).toContain('getDatasetService().canMaterialize("csv_file")');
    expect(mainSource).toContain("getDatasetService()\n    );");
    expect(buildSource).toContain("DATASET_QUERY_WORKER_ENTRY_NAME");
    expect(buildSource).toContain('alias("./src/main/workers/dataset-query-worker.ts")');
    expect(queryServiceSource).not.toContain("node:sqlite");
    expect(queryServiceSource).not.toContain('from "./dataset-query-core"');
    expect(queryWorkerSource).toContain('from "../services/dataset-query-core"');
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
});
