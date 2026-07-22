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
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly resolveInlineReference:");
    expect(mainSource).toContain('ipcMain.handle("notes.resolveInlineReference"');
    expect(mainSource).toContain("NoteResolveInlineReferenceRequestSchema.parse(request)");
    expect(mainSource).toContain("NoteResolveInlineReferenceResultSchema.parse(");
    expect(preloadSource).toContain('ipcRenderer.invoke(\n          "notes.resolveInlineReference"');
    expect(preloadSource).toContain("NoteResolveInlineReferenceRequestSchema.parse(request)");
    expect(preloadSource).toContain("NoteResolveInlineReferenceResultSchema.parse(");
    expect(contractsSource).not.toContain("InlineReferencePath");
    expect(contractsSource).not.toContain("candidatePageIds");
  });

  it("keeps Reader selection identity resolution main-owned and schema-validated", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(contractsSource).toContain("readonly readerSelection: {");
    expect(contractsSource).toContain("readonly resolve: (");
    expect(contractsSource).toContain("readonly submitAction: (");
    expect(contractsSource).toContain("readonly submitTransform: (");
    expect(contractsSource).toContain("readonly currentProposal: (");
    expect(contractsSource).toContain("readonly decideProposal: (");
    expect(mainSource).toContain('ipcMain.handle("readerSelection.resolve"');
    expect(mainSource).toContain("ReaderSelectionResolveRequestSchema.parse(request)");
    expect(mainSource).toContain("ReaderSelectionResolveResultSchema.parse(");
    expect(mainSource).toContain('ipcMain.handle("readerSelection.submitAction"');
    expect(mainSource).toContain("ReaderSelectionActionRequestSchema.parse(request)");
    expect(mainSource).toContain("ReaderSelectionActionResultSchema.parse(");
    expect(mainSource).toContain('ipcMain.handle("readerSelection.submitTransform"');
    expect(mainSource).toContain("ReaderSelectionTransformRequestSchema.parse(request)");
    expect(mainSource).toContain("ReaderSelectionTransformResultSchema.parse(");
    expect(mainSource).toContain('ipcMain.handle("readerSelection.currentProposal"');
    expect(mainSource).toContain('ipcMain.handle("readerSelection.decideProposal"');
    expect(preloadSource).toContain('"readerSelection.resolve"');
    expect(preloadSource).toContain("ReaderSelectionResolveRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionResolveResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitAction"');
    expect(preloadSource).toContain("ReaderSelectionActionRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionActionResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.submitTransform"');
    expect(preloadSource).toContain("ReaderSelectionTransformRequestSchema.parse(request)");
    expect(preloadSource).toContain("ReaderSelectionTransformResultSchema.parse(");
    expect(preloadSource).toContain('"readerSelection.currentProposal"');
    expect(preloadSource).toContain('"readerSelection.decideProposal"');
    expect(contractsSource).not.toContain("ReaderSelectionText");
    expect(contractsSource).not.toContain("ReaderSelectionPath");
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
    expect(resetHandler.indexOf("confirmSettingAction")).toBeLessThan(resetHandler.indexOf("getVaultService().resetLocalDatabase()"));
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

  it("binds support-bundle cancellation to one active renderer request", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const handler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("diagnostics.exportSupportBundle"'),
      mainSource.indexOf('ipcMain.handle("models.summary"')
    );

    expect(contractsSource).toContain("readonly exportRequestId: string;");
    expect(contractsSource).toContain("cancelSupportBundleExport");
    expect(preloadSource).toContain('ipcRenderer.invoke("diagnostics.cancelSupportBundleExport", request)');
    expect(handler).toContain("active.senderId !== event.sender.id");
    expect(handler).toContain("active.senderId === event.sender.id");
    expect(handler).toContain("active.controller.abort()");
    expect(handler).toContain('event.sender.once("destroyed", abortOnSenderDestroyed)');
    expect(handler).toContain("{ signal: controller.signal }");
    expect(rendererSource).toContain('props.t("maintenance.cancelSupportExport")');
    expect(rendererSource).toContain("supportBundleCancelRequestRef");
    expect(rendererSource).toContain("void window.pige.diagnostics.cancelSupportBundleExport");
  });

  it("binds restore apply to the exact preview token across renderer, preload, and main", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
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
    expect(mainSource).toContain('ipcMain.handle("restore.preview"');
    expect(mainSource).toContain('ipcMain.handle("restore.apply"');
    expect(mainSource).toContain("getRestoreCoordinatorService().apply({");
    expect(mainSource).toContain("getRestoreCoordinatorService().recoverInterrupted()");
    expect(mainSource).toContain("RESTORE_NATIVE_COPY[getAppearanceService().summary().locale]");
    for (const locale of ["de", "en", "fr", "ja", "ko", "zh-Hans"]) {
      expect(mainSource).toContain(`${JSON.stringify(locale)}:`);
    }
    const nativeRestoreCopy = mainSource.slice(
      mainSource.indexOf("const RESTORE_NATIVE_COPY"),
      mainSource.indexOf("async function confirmSettingAction")
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
    expect(mainSource).toContain("buttons: [restoreNativeCopy.cancel, restoreNativeCopy.confirm]");
    expect(mainSource).toContain("defaultId: 0");
    expect(mainSource).toContain("cancelId: 0");
    expect(mainSource).toContain("title: restoreNativeCopy.destinationPickerTitle");
    expect(mainSource).not.toContain('title: "Choose where to create the restored vault"');
    const restoreApplyHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("restore.apply"'),
      mainSource.indexOf('ipcMain.handle("system.toolchainHealth"')
    );
    expect(restoreApplyHandler).not.toContain("openPath(");
    expect(restoreApplyHandler).not.toContain("restoredVaultPath");
  });

  it("routes user backup creation and recovery through the durable Backup coordinator", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const createHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("backup.create"'),
      mainSource.indexOf('ipcMain.handle("restore.preview"')
    );
    const cancelHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("jobs.cancel"'),
      mainSource.indexOf('ipcMain.handle("jobs.retry"')
    );

    expect(mainSource).toContain("new BackupCoordinatorService({");
    expect(createHandler).toContain("getBackupCoordinatorService().create(selection.filePath)");
    expect(createHandler).not.toContain("getBackupRestoreService().createBackup(");
    expect(mainSource).toContain('job.backupKind === "user_backup"');
    expect(mainSource).toContain("lastBackupAt: lastBackup.updatedAt");
    expect(cancelHandler).toContain("getBackupCoordinatorService().cancel(request)");
    expect(mainSource).toContain("getBackupCoordinatorService().recoverInterrupted()");
    expect(mainSource.indexOf("getBackupCoordinatorService().recoverInterrupted()"))
      .toBeLessThan(mainSource.indexOf("recoverInterruptedJobs()"));
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
    expect(mainSource).toContain("return await getHomeAgentService().submitTurn(normalizedRequest, draftContext)");
    expect(mainSource).toContain("...(request.scope === undefined ? {} : { scope: request.scope })");
    expect(mainSource).toContain("draftPublisher.close()");
    expect(preloadSource).toContain('scope: { kind: "current_note" as const, pageId: request.scope.pageId }');
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.submitTurn", {');
    expect(preloadSource).toContain("request: normalizedRequest");
    expect(preloadSource).toContain('ipcRenderer.on("agent.turnDraft", handleDraft)');
    expect(preloadSource).toContain('ipcRenderer.removeListener("agent.turnDraft", handleDraft)');
    expect(contractsSource).toContain("export interface AgentTurnDraftEvent");
    expect(contractsSource).toContain("export interface AgentTurnCurrentNoteScope");
    expect(contractsSource).toContain("readonly scope?: AgentTurnScope");
    expect(contractsSource).toContain("readonly onTurnDraft:");
    expect(runtimeSource).toContain("terminalDrafts.observe(event)");
    expect(runtimeSource).toContain("terminalDrafts.afterToolExecute(executedTool, args, result)");
    expect(projectionSource).toContain('toolName: "pige_finish_home_turn"');
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
    expect(homeComposer).toContain('aria-busy={agentDraft !== null || effectiveAgentRunState === "accepted" || effectiveAgentRunState === "running"}');
    expect(homeComposer).toContain("event.sequence <= active.sequence");
    expect(rendererSource).toContain('...(homeDraftText.trim() ? { text: homeDraftText } : {})');
    expect(homeComposer).toContain("const text = props.draftText");
    expect(homeComposer).toContain("props.onDraftChange(event.target.value)");
    expect(homeComposer).toContain('job.class !== "retrieval_query"');
    expect(rendererSource).toContain('classes: ["capture", "parse", "ocr", "agent_ingest", "agent_turn", "index_rebuild"]');
    const submitHomeInput = homeComposer.slice(
      homeComposer.indexOf("const submitHomeInput"),
      homeComposer.indexOf("const openResult")
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

  it("runtime-validates retrieval.search at preload and main boundaries", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const ipcSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/retrieval-search-ipc.ts"),
      "utf8"
    );
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");

    expect(mainSource).toContain("handleRetrievalSearchIpc(request, getRetrievalService())");
    expect(ipcSource).toContain("RetrievalSearchRequestSchema.safeParse(request)");
    expect(ipcSource).toContain("rawResult = retrieval.search(parsedRequest.data)");
    expect(ipcSource).toContain('PigeDomainError("rag.search_unavailable"');
    expect(ipcSource).toContain("RetrievalSearchResultSchema.safeParse(rawResult)");
    expect(preloadSource).toContain("RetrievalSearchRequestSchema.safeParse(request)");
    expect(preloadSource).toContain('const response: unknown = await ipcRenderer.invoke("retrieval.search", parsedRequest.data)');
    expect(preloadSource).toContain("RetrievalSearchResultSchema.safeParse(response)");
    expect(preloadSource).not.toContain(
      'ipcRenderer.invoke("retrieval.search", request) as Promise<RetrievalSearchResult>'
    );
  });

  it("keeps legacy Model Egress IPC out of the canonical renderer owner", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const pendingHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("modelEgress.pending"'),
      mainSource.indexOf('ipcMain.handle("modelEgress.resolve"')
    );
    const resolveHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("modelEgress.resolve"'),
      mainSource.indexOf('ipcMain.handle("activity.list"')
    );

    expect(contractsSource).toContain("readonly modelEgress:");
    expect(contractsSource).toContain("export interface ModelEgressResolveRequest");
    expect(pendingHandler).toContain("ModelEgressPendingRequestQuerySchema.safeParse(request)");
    expect(pendingHandler).toContain("getJobsService().pendingModelEgress(parsed.data.requestId)");
    expect(pendingHandler).toContain("ModelEgressPendingRequestSchema.safeParse(pending)");
    expect(resolveHandler).toContain("ModelEgressResolveRequestSchema.safeParse(request)");
    expect(resolveHandler).toContain("getJobsService().resolveModelEgress(parsed.data)");
    expect(resolveHandler).toContain("ModelEgressResolveResultSchema.safeParse(result)");
    expect(resolveHandler).toContain("scheduleAgentTurnProcessing()");
    expect(mainSource).toContain('rootPath: app.getPath("userData")');
    expect(mainSource).toContain("getVaultService().assertWriterLease(vaultPath)");
    expect(preloadSource).toContain('ipcRenderer.invoke("modelEgress.pending", request)');
    expect(preloadSource).toContain('ipcRenderer.invoke("modelEgress.resolve", request)');
    expect(rendererSource).not.toContain("window.pige.modelEgress");
    expect(rendererSource).not.toContain("decideModelEgress");
    expect(resolveHandler).not.toContain("permissionDecisionId");
  });

  it("keeps legacy Permission Broker prompts out of the canonical renderer owner", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const pendingHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("permissions.pending"'),
      mainSource.indexOf('ipcMain.handle("permissions.resolve"')
    );
    const resolveHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("permissions.resolve"'),
      mainSource.indexOf('ipcMain.handle("activity.list"')
    );

    expect(contractsSource).toContain("readonly permissions:");
    expect(pendingHandler).toContain("PermissionPendingRequestQuerySchema.safeParse(request)");
    expect(pendingHandler).toContain("getJobsService().pendingPermission(parsed.data.requestId)");
    expect(pendingHandler).toContain("PermissionPendingRequestSchema.safeParse(pending)");
    expect(resolveHandler).toContain("PermissionResolveRequestSchema.safeParse(request)");
    expect(resolveHandler).toContain("getJobsService().resolvePermission(parsed.data)");
    expect(resolveHandler).toContain("PermissionResolveResultSchema.safeParse(result)");
    expect(resolveHandler).toContain("scheduleAgentIngestProcessing()");
    expect(resolveHandler).toContain("scheduleAgentTurnProcessing()");
    expect(preloadSource).toContain('ipcRenderer.invoke("permissions.pending", request)');
    expect(preloadSource).toContain('ipcRenderer.invoke("permissions.resolve", request)');
    expect(rendererSource).not.toContain("window.pige.permissions");
    expect(rendererSource).not.toContain("decidePermission");
    for (const unsafeField of ["actionInputHash", "resourceIdentityHash", "policyHash", "bindingHash", "actorDigest"]) {
      expect(pendingHandler).not.toContain(unsafeField);
      expect(resolveHandler).not.toContain(unsafeField);
      expect(preloadSource.slice(preloadSource.indexOf("permissions: {"), preloadSource.indexOf("activity: {")))
        .not.toContain(unsafeField);
    }
    expect(mainSource).toContain("createPermissionedExternalCapabilityRegistry(");
    expect(mainSource.indexOf("reconcilePermissionActions()"))
      .toBeLessThan(mainSource.indexOf("recoverInterruptedJobs()"));
  });

  it("exposes one canonical high-risk confirmation with strict query, event, and resolve parsing", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const dialogSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/components/HighRiskConfirmationDialog.tsx"),
      "utf8"
    );
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/high-risk-confirmation-service.ts"),
      "utf8"
    );
    const confirmationsStart = preloadSource.indexOf("confirmations: {");
    const legacyBoundary = preloadSource.indexOf("modelEgress: {", confirmationsStart);
    const preloadApi = preloadSource.slice(
      confirmationsStart,
      legacyBoundary >= 0 ? legacyBoundary : preloadSource.indexOf("skills: {", confirmationsStart)
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
    expect(dialogSource).toContain('if (event.key === "Escape")');
    expect(dialogSource).toContain('props.onResolve("deny")');
    for (const unsafeField of ["path", "command", "body", "hash", "credential", "provider", "rawError", "jobId"]) {
      expect(preloadApi).not.toContain(unsafeField);
    }
    expect(preloadApi).not.toContain("Permission");
    expect(preloadApi).not.toContain("ModelEgress");
  });

  it("exposes machine-local permission settings through revision-fenced body-free IPC", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const settingsHandlers = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("permissions.settings.current"'),
      mainSource.indexOf('ipcMain.handle("activity.list"')
    );
    const settingsPreload = preloadSource.slice(
      preloadSource.indexOf("settings: {", preloadSource.indexOf("permissions: {")),
      preloadSource.indexOf("activity: {")
    );

    expect(contractsSource).toContain("readonly prepareYoloEnable:");
    expect(contractsSource).toContain("readonly revokeAllGrants:");
    expect(settingsHandlers).toContain("PermissionSetDefaultModeRequestSchema.parse(request)");
    expect(settingsHandlers).toContain("PermissionPrepareYoloEnableRequestSchema.parse(request)");
    expect(settingsHandlers).toContain("permissionYoloConfirmationRegistry.issue(event.sender.id");
    expect(settingsHandlers).toContain("permissionYoloConfirmationRegistry.consume(");
    expect(settingsHandlers).toContain("getPermissionSettingsService().revokeGrant(");
    expect(settingsHandlers).toContain("getPermissionSettingsService().revokeAllGrants(");
    expect(settingsPreload).toContain('ipcRenderer.invoke("permissions.settings.current")');
    expect(settingsPreload).toContain('"permissions.settings.prepareYoloEnable"');
    expect(settingsPreload).toContain('"permissions.settings.revokeAllGrants"');
    for (const unsafeField of ["actorId", "actorDigest", "resourceIdentityHash", "path", "secret"]) {
      expect(settingsPreload).not.toContain(unsafeField);
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

  it("exposes the machine-local Skill inventory and authority-reducing disable through strict IPC", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/skill-registry-service.ts"),
      "utf8"
    );
    const handlers = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("skills.summary"'),
      mainSource.indexOf('ipcMain.handle("activity.list"')
    );
    const preloadApi = preloadSource.slice(
      preloadSource.indexOf("skills: {"),
      preloadSource.indexOf("activity: {")
    );

    expect(contractsSource).toContain("readonly skills: {");
    expect(contractsSource).toContain("readonly summary: () => Promise<SkillRegistryQueryResult>;");
    expect(contractsSource).toContain("readonly disable: (request: SkillDisableRequest)");
    expect(contractsSource).toContain("readonly onChanged: (listener: (summary: SkillRegistrySummary)");
    expect(handlers).toContain("SkillRegistryQueryResultSchema.parse(getSkillRegistryService().summary())");
    expect(handlers).toContain("SkillDisableRequestSchema.parse(request)");
    expect(handlers).toContain("SkillRegistryMutationResultSchema.parse(getSkillRegistryService().disable(parsed))");
    expect(handlers).toContain('window.webContents.send("skills.changed", result.registry)');
    expect(preloadApi).toContain('ipcRenderer.invoke("skills.summary")');
    expect(preloadApi).toContain('ipcRenderer.invoke(\n        "skills.disable"');
    expect(preloadApi).toContain("SkillDisableRequestSchema.parse(request)");
    expect(preloadApi).toContain("SkillRegistryMutationResultSchema.parse(");
    expect(preloadApi).toContain('ipcRenderer.on("skills.changed", handler)');
    expect(preloadApi).toContain("SkillRegistrySummarySchema.safeParse(value)");
    expect(preloadApi).toContain('ipcRenderer.removeListener("skills.changed", handler)');
    for (const unsafeField of ["manifestSha256", "sourceUrl", "permissionSummary", "SKILL.md", "path", "body", "secret"]) {
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
    expect(preloadSource).toContain('"activity.list",');
    expect(preloadSource).toContain("KnowledgeActivityListResultSchema.parse");
    expect(preloadSource).toContain('ipcRenderer.invoke("activity.undo", request)');
    expect(contractsSource).toContain('readonly kind: "create_page" | "update_page";');
    expect(rendererSource).toContain('window.pige.activity.list({ limit: 20 })');
    expect(rendererSource).toContain('className="settings-page settings-history-page"');
    expect(rendererSource).toContain('activity.kind === "update_page"');
    expect(rendererSource).toContain('"activity.updatedPage"');
    expect(rendererSource).toContain('"activity.createdPage"');
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

  it("fails closed on awaiting-review Jobs until a bounded renderer-safe proposal preview exists", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const styles = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/styles/app.css"), "utf8");
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );

    expect(rendererSource).toContain(
      'states: ["queued", "running", "waiting_dependency", "failed_retryable", "failed_final"]'
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
    expect(rendererSource).not.toContain("window.pige.proposals");
    expect(homeComposer).toContain('job.state === "awaiting_review"');
    expect(homeComposer).toContain('props.t("proposal.safePreviewTitle")');
    expect(homeComposer).toContain('props.t("proposal.safePreviewDescription")');
    expect(homeComposer).toContain('aria-describedby="proposal-safe-preview-description"');
    expect(homeComposer).toContain('props.t("proposal.reviewUnavailable")');
    expect(homeComposer).toContain("disabled");
    expect(fs.existsSync(
      path.resolve("apps/desktop/src/renderer/src/components/ProposalReviewPanel.tsx")
    )).toBe(false);
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
    expect(buildSource).toContain('"services/permissioned-external-capability-service": alias(');
    expect(buildSource).toContain(
      '"./src/main/services/permissioned-external-capability-service.ts"'
    );
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

  it("exposes only the parsed body-free Update Service check foundation", () => {
    const contractsSource = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const schemasSource = fs.readFileSync(path.resolve("packages/schemas/src/index.ts"), "utf8");
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const serviceSource = fs.readFileSync(
      path.resolve("apps/desktop/src/main/services/update-service.ts"),
      "utf8"
    );

    expect(contractsSource).toContain("readonly updates:");
    expect(contractsSource).toContain("readonly summary: () => Promise<UpdateSummary>");
    expect(contractsSource).toContain("readonly check: (request: UpdateCheckRequest) => Promise<UpdateCheckResult>");
    expect(contractsSource).toContain("readonly onStatusChanged:");
    expect(schemasSource).toContain('export const UpdateCapabilitySchema = z.enum([');
    expect(mainSource).toContain('ipcMain.handle("updates.summary"');
    expect(mainSource).toContain('ipcMain.handle("updates.check"');
    expect(mainSource).toContain('browserWindow.webContents.send("updates.statusChanged", parsed)');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.summary")');
    expect(preloadSource).toContain('ipcRenderer.invoke("updates.check", parsedRequest)');
    expect(preloadSource).toContain('ipcRenderer.on("updates.statusChanged", handler)');
    expect(serviceSource).toContain("class NoNetworkUpdateCheckAdapter");
    expect(serviceSource).not.toContain("electron-updater");
    expect(serviceSource).not.toContain("fetch(");
    expect(serviceSource).not.toContain("https://");
    expect(preloadSource).not.toContain("feedUrl");
    expect(contractsSource).not.toContain("feedUrl");
  });
});
