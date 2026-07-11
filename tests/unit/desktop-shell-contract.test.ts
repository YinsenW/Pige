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
    expect(resetHandler.indexOf("confirmSettingAction")).toBeLessThan(resetHandler.indexOf("getVaultService().resetLocalDatabase()"));
    expect(providerHandler.indexOf("confirmSettingAction")).toBeLessThan(providerHandler.indexOf("getModelProviderRegistry().addManualProvider(request)"));
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
