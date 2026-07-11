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
  });

  it("wires Home questions through Pi with visible typed outcomes and no raw provider error surface", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preloadSource = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    const rendererSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const homeComposer = rendererSource.slice(
      rendererSource.indexOf("function HomeComposer"),
      rendererSource.indexOf("function jobStateMessageKey")
    );

    expect(mainSource).toContain('ipcMain.handle("agent.ask"');
    expect(preloadSource).toContain('ipcRenderer.invoke("agent.ask", request)');
    expect(homeComposer).toContain("window.pige.agent.ask");
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
    expect(rendererSource).toContain("do|does|did|can|could|would|should");
    expect(homeComposer).toContain('job.class !== "retrieval_query"');
    const submitAgentQuestion = homeComposer.slice(
      homeComposer.indexOf("const submitAgentQuestion"),
      homeComposer.indexOf("const openResult")
    );
    expect(submitAgentQuestion).not.toContain("caught instanceof Error ? caught.message");
  });

  it("keeps the reviewed Provider path API-key-only and the custom form progressively disclosed", () => {
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
    expect(panel).toContain("addPresetProvider");
    expect(presetSurface).not.toContain("manualModelId");
    expect(presetSurface).not.toContain("baseUrl");
    expect(panel).toContain('<details className="custom-provider">');
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

  it("wires onboarding readiness to the non-secret provider runtime binding check", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource.match(/getModelProviderRegistry\(\)\.hasDefaultRuntimeBinding\(\)/gu)).toHaveLength(2);
    expect(mainSource).not.toContain("getModelProviderRegistry().hasDefaultModel()");
  });

  it("does not forward dynamic caught messages into persisted diagnostics", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(mainSource).not.toContain("caught instanceof Error ? caught.message");
    expect(mainSource).not.toMatch(/recordEvent\([\s\S]{0,240}message:\s*caught\.message/);
  });
});
