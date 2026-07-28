import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentMemorySettingsPanel,
  AppearanceSettingsPanel,
  GeneralSettingsPanel,
  MaintenanceSettingsPanel,
  PiPackagesSettingsPanel,
  PermissionsPrivacySettingsPanel,
  SettingsSurface,
  SkillsSettingsPanel,
  SystemSettingsPanel,
  type DevelopmentCapability,
  type SettingsSection
} from "../../apps/desktop/src/renderer/src/App";
import {
  LocalCapabilitiesSettingsPanel,
  type PaddleOcrApi
} from "../../apps/desktop/src/renderer/src/components/LocalCapabilitiesSettingsPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import type {
  LocalSemanticRetrievalDisableRequest,
  LocalSemanticRetrievalDisableResult,
  LocalSemanticRetrievalEnableRequest,
  LocalSemanticRetrievalEnableResult,
  LocalSemanticRetrievalInstallRequest,
  LocalSemanticRetrievalInstallResult,
  LocalSemanticRetrievalRemoveRequest,
  LocalSemanticRetrievalRemoveResult,
  LocalSemanticRetrievalStatus,
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrLifecycleState,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrSummary,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageRegistrySummary,
  SkillEnableRequest,
  SkillExportRequest,
  SkillLifecycleMutationResult,
  SkillRegistryMutationResult,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SkillUninstallRequest,
  SpeechAvailabilityResult
} from "@pige/contracts";
import {
  LocalSemanticRetrievalSettingsPanel,
  type LocalSemanticRetrievalApi
} from "../../apps/desktop/src/renderer/src/components/LocalSemanticRetrievalSettingsPanel";
import type { PiPackagesApi } from "../../apps/desktop/src/renderer/src/components/PiPackagesSettingsPanel";
import {
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  type LocalSemanticRetrievalAssetState,
  MemoryDeleteRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryResetRequest,
  MemorySummary
} from "@pige/schemas";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "Event",
  "InputEvent",
  "CompositionEvent",
  "KeyboardEvent",
  "MouseEvent",
] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("full UI Settings surface", () => {
  it("keeps the always-on-top control inert until window truth is known", async () => {
    const dom = createDom();
    const onAlwaysOnTopChange = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: null,
        alwaysOnTopBusy: false,
        onAlwaysOnTopChange,
        onOpenAppearance: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const alwaysOnTop = requireElement(dom.window.document.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Keep Pige on top"]'
    ));
    expect(alwaysOnTop.disabled).toBe(true);
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("false");
    alwaysOnTop.click();
    expect(onAlwaysOnTopChange).not.toHaveBeenCalled();

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: true,
        alwaysOnTopBusy: true,
        onAlwaysOnTopChange,
        onOpenAppearance: vi.fn(),
        t
      }));
      await settle(dom);
    });
    expect(alwaysOnTop.disabled).toBe(true);
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("true");
    expect(alwaysOnTop.getAttribute("aria-busy")).toBe("true");
    alwaysOnTop.click();
    expect(onAlwaysOnTopChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reflects WindowLayout persistence without inventing a startup preference", async () => {
    const dom = createDom();
    const onAlwaysOnTopChange = vi.fn(async () => undefined);
    const onDevelopment = vi.fn();
    const onOpenAppearance = vi.fn();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("General must use only its provided adapters.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: false,
        alwaysOnTopBusy: false,
        onAlwaysOnTopChange,
        onOpenAppearance,
        onDevelopment,
        t
      }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-general")!;
    expect(page.querySelectorAll(".settings-section")).toHaveLength(2);
    expect(page.querySelectorAll(".settings-row")).toHaveLength(7);
    expect(page.textContent).toContain("Startup & Window");
    expect(page.textContent).toContain("Pige");
    expect(page.textContent).toContain("Adaptive");
    expect(page.textContent).toContain("Automatic");
    expect(page.textContent).toContain("Last state");
    expect(page.textContent).toContain("Temporary pane expansion is never saved as the base size.");
    expect(page.textContent).toContain("A constrained display may present Note Agent as an overlay.");
    expect(page.querySelector("select")).toBeNull();
    const alwaysOnTop = requireElement(page.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Keep Pige on top"]'
    ));
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      for (const button of Array.from(page.querySelectorAll<HTMLButtonElement>(".settings-button"))) {
        button.click();
      }
      alwaysOnTop.click();
      await settle(dom);
    });

    expect(onDevelopment).toHaveBeenCalledOnce();
    expect(onOpenAppearance).toHaveBeenCalledOnce();
    expect(onAlwaysOnTopChange).toHaveBeenCalledOnce();
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps compact localized Settings navigation labels readable", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const compactSettings = styles.slice(
      styles.indexOf("@media (max-width: 520px)"),
      styles.indexOf("@media (min-width: 761px)")
    );
    const residentCompactSettings = styles.slice(
      styles.indexOf("@media (max-width: 679px)"),
      styles.indexOf("@media (min-width: 680px)")
    );

    expect(styles).toContain(".settings-nav-scroll {\n  min-height: 0;\n  flex: 1 1 auto;");
    expect(appSource).toContain("macosWindowShell={macosWindowShell}");
    expect(appSource).toContain('settings-overlay${props.macosWindowShell ? " platform-macos" : ""}');
    expect(styles).toContain(".settings-overlay.platform-macos .settings-return");
    expect(styles).toContain("margin-left: 84px;");
    expect(residentCompactSettings).toContain(".settings-navigation {");
    expect(residentCompactSettings).toContain("display: block;");
    expect(residentCompactSettings).toContain("max-height: none;");
    expect(residentCompactSettings).toContain("overflow: visible;");
    expect(compactSettings).toContain(".settings-nav-item > span");
    expect(compactSettings).toContain("white-space: normal;");
    expect(compactSettings).toContain("overflow-wrap: anywhere;");
    expect(compactSettings).toContain("text-overflow: clip;");
    expect(compactSettings).toContain(".settings-skills .skill-registry-row");
    expect(compactSettings).toContain("grid-template-columns: 32px minmax(0, 1fr);");
    expect(compactSettings).toContain(".settings-skills .skill-registry-control");
    expect(compactSettings).toContain("grid-column: 1 / -1;");
    expect(styles).toContain(".skill-registry-control .settings-status.is-enabled {\n  color: var(--accent);");
    expect(styles).not.toContain("--accent-strong");
    expect(styles).toContain("--border-strong: var(--border-heavy);");
    expect(styles).toContain("--danger-soft: var(--danger-surface);");
    expect(styles).toContain("--shadow-float: var(--shadow-floating);");
    expect(styles).toContain("--shadow-lg: var(--shadow-floating);");
    expect(styles).toContain("--shadow-xl: var(--shadow-floating);");
    expect(styles).toContain("--ease-basic: var(--ease-standard);");
    expect(styles).toContain("--settings-text: var(--text-primary);");
    expect(styles).toContain("--settings-secondary: var(--text-secondary);");
    expect(styles).toContain("--settings-border: var(--border-default);");
    expect(styles).toContain("--settings-elevated: var(--surface-elevated);");
    expect(styles).toContain("--titlebar-height: 58px;");
    const reducedTransparency = styles.slice(
      styles.indexOf("@media (prefers-reduced-transparency: reduce)"),
      styles.indexOf("\n* {\n  box-sizing: border-box;")
    );
    expect(reducedTransparency).toContain("*::before,\n  *::after {");
    expect(reducedTransparency).toContain("-webkit-backdrop-filter: none !important;");
    expect(reducedTransparency).toContain("backdrop-filter: none !important;");
    const customPropertyDefinitions = new Set(
      Array.from(styles.matchAll(/(--[a-z0-9-]+)\s*:/gi), (match) => match[1]!)
    );
    const undefinedCustomPropertyUses = Array.from(
      new Set(Array.from(styles.matchAll(/var\((--[a-z0-9-]+)/gi), (match) => match[1]!))
    ).filter((property) => !customPropertyDefinitions.has(property)).sort();
    expect(undefinedCustomPropertyUses).toEqual([
      "--branch-opacity",
      "--branch-width",
      "--conversation-anchor-opacity",
      "--conversation-anchor-position",
      "--conversation-rail-height",
      "--conversation-rail-right",
      "--conversation-rail-top",
      "--home-processing-panel-height",
      "--minimap-opacity",
      "--minimap-width",
      "--progress"
    ]);
    expect(styles).toContain("--knowledge-node-root: #d9e2ef;");
    expect(styles).toContain("stroke: var(--knowledge-branch-strong);");
    expect(styles).toContain("color: var(--knowledge-node-root);");
    expect(styles).toContain(".diff-line.removed { background: var(--danger-surface); color: var(--danger); }");
    expect(styles).toContain("--success-text: #13733a;");
    expect(styles).toContain(".diff-line.added { background: var(--success-surface); color: var(--success-text); }");
    expect(styles).toContain("background: color-mix(in oklab, var(--surface-elevated) 97%, transparent);");
    expect(compactSettings).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(compactSettings).toContain("width: min(320px, calc(100% - 48px));");
    expect(compactSettings).toContain('.settings-surface[data-compact-navigation-open="true"] .settings-sidebar');
    expect(compactSettings).toContain(".settings-overlay.platform-macos .settings-compact-header");
    expect(compactSettings).toContain("padding-left: 100px;");
    expect(styles).toContain("width: calc(100% - 84px);");
    expect(styles).toContain("margin-left: 84px;");
    expect(styles).toContain(".settings-summary-grid {");
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(styles).toContain("@media (max-width: 560px) {");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain(".settings-vault-page .settings-row-control .settings-button");
    expect(styles).toContain(".settings-restore-page.restore-preview");
    expect(styles).toContain(".restore-settings-summary .settings-row");
    expect(styles).toContain(".restore-settings-actions .settings-button");
    expect(styles).toContain("width: 100%;");
  });

  it("uses a focus-owned navigation drawer instead of squeezing compact Settings content", async () => {
    const dom = createDom();
    installMatchMedia(dom, true);
    const close = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [section, setSection] = useState<SettingsSection>("general");
      return createElement(SettingsSurface, {
        section,
        locale: "en",
        availableLocales: ["en"],
        alwaysOnTop: false,
        developmentNotice: null,
        onSectionChange: setSection,
        onClose: close,
        onLocaleChange: async () => undefined,
        onAlwaysOnTopChange: async () => undefined,
        onDevelopment: vi.fn(),
        t
      }, createElement("button", { type: "button" }, "Page control"));
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });

    const dialog = requireElement(dom.window.document.querySelector<HTMLElement>('[role="dialog"]'));
    const drawer = requireElement(dialog.querySelector<HTMLElement>(".settings-sidebar"));
    const content = requireElement(dialog.querySelector<HTMLElement>(".settings-content"));
    const compactReturn = requireElement(dialog.querySelector<HTMLButtonElement>(".settings-compact-return"));
    const trigger = buttonNamed(dialog, "Settings sections");
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(content.hasAttribute("inert")).toBe(false);
    expect(dom.window.document.activeElement).toBe(compactReturn);

    const pageControl = buttonNamed(content, "Page control");
    await act(async () => {
      compactReturn.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(pageControl);
    await act(async () => {
      pageControl.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(compactReturn);

    await act(async () => {
      trigger.click();
      await settle(dom);
      await settle(dom);
    });
    expect(dialog.dataset.compactNavigationOpen).toBe("true");
    expect(drawer.getAttribute("aria-hidden")).toBeNull();
    expect(drawer.hasAttribute("inert")).toBe(false);
    expect(content.hasAttribute("inert")).toBe(true);
    const closeButton = buttonNamed(drawer, "Close Settings");
    expect(dom.window.document.activeElement).toBe(closeButton);
    const lastDrawerControl = buttonNamed(drawer, "DiagnosticsAvailable");
    content.scrollTop = 128;
    await act(async () => {
      buttonNamed(drawer, "AppearancePartially available").click();
      await settle(dom);
    });
    expect(content.scrollTop).toBe(0);
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(dom.window.document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.click();
      await settle(dom);
      await settle(dom);
    });
    await act(async () => {
      closeButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(lastDrawerControl);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(close).not.toHaveBeenCalled();
    expect(dom.window.document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("traps focus, closes with Escape, and keeps development activation local", async () => {
    const dom = createDom();
    const close = vi.fn();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("Development navigation must not access IPC.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [section, setSection] = useState<SettingsSection>("general");
      const [capability, setCapability] = useState<DevelopmentCapability | null>(null);
      return createElement(SettingsSurface, {
        section,
        locale: "en",
        availableLocales: ["en"],
        alwaysOnTop: false,
        developmentNotice: capability ? { surface: "settings", capability, state: "development" } : null,
        onSectionChange: setSection,
        onClose: close,
        onLocaleChange: async () => undefined,
        onAlwaysOnTopChange: async () => undefined,
        onDevelopment: setCapability,
        t
      }, createElement("button", { type: "button", id: "last-control" }, "Last control"));
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });

    const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeButton = buttonNamed(dialog, "Close Settings");
    expect(dom.window.document.activeElement).toBe(closeButton);
    const groups = Array.from(dialog.querySelectorAll<HTMLElement>('.settings-nav-group[role="group"]'));
    expect(groups).toHaveLength(6);
    for (const group of groups) {
      const labelId = group.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(group.querySelector(`#${labelId}`)?.textContent?.trim().length).toBeGreaterThan(0);
    }

    await act(async () => {
      buttonNamed(dialog, "Index & MaintenanceAvailable").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Agent & MemoryIn development").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Local CapabilitiesPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "SkillsPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Pi PackagesPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "AppearancePartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    const last = dom.window.document.querySelector<HTMLButtonElement>("#last-control")!;
    last.focus();
    await act(async () => {
      last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(last);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(close).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("runs Knowledge Health from Maintenance, groups safe results, and preserves Run Check focus", async () => {
    const dom = createDom();
    let resolveFirst!: (result: unknown) => void;
    let resolveSecond!: (result: unknown) => void;
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "ready",
        checkedAt: "2026-07-27T10:02:00.000Z",
        indexGeneration: "index:8",
        coverage: "complete",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [],
        truncated: false
      }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const onOpenPage = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId: "vault_20260727_healthfixture",
        locale: "en",
        error: null,
        localDatabaseStatus: {
          driver: "node_sqlite",
          appSchemaVersion: 1,
          appliedMigrationCount: 2,
          status: "ready",
          updatedAt: "2026-07-27T10:00:00.000Z"
        },
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage,
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("/Users/private");
    const runButton = buttonNamed(page, "Run Check");
    runButton.focus();
    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(runButton.disabled).toBe(true);
    expect(page.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(page.textContent).not.toContain("Latest check");
    const firstRequest = runKnowledgeHealth.mock.calls[0]![0];
    expect(firstRequest).toMatchObject({ apiVersion: 1, activeVaultId: "vault_20260727_healthfixture" });
    expect(firstRequest.requestId).toMatch(/^knowledge_health_request_[a-z0-9]{16,64}$/);

    await act(async () => {
      resolveFirst({
        ...firstRequest,
        status: "ready",
        checkedAt: "2026-07-27T10:01:00.000Z",
        indexGeneration: "index:7",
        coverage: "partial",
        invalidPageCount: 2,
        counts: {
          totalIssueCount: 7,
          brokenLinkPageCount: 1,
          unresolvedLinkCount: 3,
          orphanPageCount: 1,
          duplicateTopicGroupCount: 1,
          unsourcedClaimCount: 4
        },
        issues: [
          { kind: "broken_link", page: { pageId: "page_health_broken", title: "Broken page" }, unresolvedLinkCount: 3 },
          { kind: "orphan_page", page: { pageId: "page_health_orphan", title: "Orphan page" } },
          {
            kind: "duplicate_topic",
            candidatePageCount: 3,
            pages: [
              { pageId: "page_health_topic_a", title: "Topic A" },
              { pageId: "page_health_topic_b", title: "Topic B" }
            ]
          },
          { kind: "unsourced_claim", page: { pageId: "page_health_claim", title: "Unsupported claim" } }
        ],
        truncated: true
      });
      await settle(dom);
    });

    expect(dom.window.document.activeElement).toBe(runButton);
    expect(page.textContent).toContain("7 issues found");
    expect(page.textContent).toContain("Partial");
    expect(page.textContent).toContain("2 pages could not be checked");
    expect(page.textContent).toContain("More results are available");
    const groupText = ["Broken links", "Orphan pages", "Duplicate topics", "Claims without sources"];
    expect(groupText.map((label) => page.textContent!.indexOf(label))).toEqual(
      [...groupText].map((label) => page.textContent!.indexOf(label)).sort((a, b) => a - b)
    );
    expect(page.textContent).not.toContain("sourceId");
    expect(page.textContent).not.toContain("checksum");

    await act(async () => {
      buttonNamed(page, "Broken page").click();
      await settle(dom);
    });
    expect(onOpenPage).toHaveBeenCalledWith("page_health_broken");

    await act(async () => {
      buttonNamed(page, "Orphan page").click();
      await settle(dom);
    });
    expect(onOpenPage).toHaveBeenCalledWith("page_health_orphan");
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("The current Reader was not changed");

    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(page.textContent).not.toContain("Broken page");
    const secondRequest = runKnowledgeHealth.mock.calls[1]![0];
    await act(async () => {
      resolveSecond({ ...secondRequest, status: "unavailable" });
      await settle(dom);
    });
    expect(page.textContent).toContain("Knowledge Health is unavailable until the local index is ready.");

    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(page.textContent).toContain("No issues found.");
    expect(page.textContent).toContain("Complete");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences stale Knowledge Health responses by vault and reports current failures body-free", async () => {
    const dom = createDom();
    let resolveStale!: (result: unknown) => void;
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockRejectedValueOnce(new Error("/Users/private/health.sqlite"));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderPanel = async (activeVaultId: string): Promise<void> => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId,
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage: vi.fn(async () => false),
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    };

    await act(async () => renderPanel("vault_20260727_healthfirst"));
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    await act(async () => {
      buttonNamed(page, "Run Check").click();
      await settle(dom);
    });
    const staleRequest = runKnowledgeHealth.mock.calls[0]![0];
    await act(async () => renderPanel("vault_20260727_healthsecond"));
    expect(page.textContent).toContain("No check has been run yet.");
    await act(async () => {
      resolveStale({
        ...staleRequest,
        status: "ready",
        checkedAt: "2026-07-27T11:00:00.000Z",
        indexGeneration: "index:8",
        coverage: "complete",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [],
        truncated: false
      });
      await settle(dom);
    });
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("No issues found.");

    await act(async () => {
      buttonNamed(page, "Run Check").click();
      await settle(dom);
    });
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Knowledge Health could not complete");
    expect(page.textContent).not.toContain("/Users/private");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("repairs only eligible broken references and refreshes the authoritative report", async () => {
    const dom = createDom();
    const repairContextId = `knowledge_health_repair_context_${"a".repeat(32)}`;
    const readyReport = (request: { readonly requestId: string; readonly activeVaultId: string }, issues: unknown[]) => ({
      ...request,
      apiVersion: 1,
      status: "ready",
      checkedAt: "2026-07-27T12:00:00.000Z",
      indexGeneration: "index:repair:4",
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: issues.length,
        brokenLinkPageCount: 2,
        unresolvedLinkCount: 3,
        orphanPageCount: 1,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues,
      truncated: false
    });
    const issues = [
      {
        kind: "broken_link",
        page: { pageId: "page_health_repairable", title: "Repairable page" },
        unresolvedLinkCount: 1,
        repairContextId
      },
      {
        kind: "broken_link",
        page: { pageId: "page_health_manual", title: "Manual page" },
        unresolvedLinkCount: 2
      },
      { kind: "orphan_page", page: { pageId: "page_health_orphan_repair", title: "Orphan page" } }
    ];
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(async (request) => readyReport(request, issues))
      .mockImplementationOnce(async (request) => ({
        ...readyReport(request, []),
        indexGeneration: "index:repair:5",
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        }
      }));
    const repairKnowledgeHealth = vi.fn()
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "stale",
        revision: `noteeditrev_${"b".repeat(32)}`
      }))
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "committed",
        revision: `noteeditrev_${"c".repeat(32)}`,
        operationId: `operation_${"d".repeat(32)}`
      }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          repairKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const onOpenPage = vi.fn(async () => true);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId: "vault_20260727_healthrepair",
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage,
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect([...page.querySelectorAll("button")].filter((button) => button.textContent === "Repair")).toHaveLength(1);
    expect(page.textContent).toContain("Manual page");
    expect(page.textContent).toContain("Orphan page");

    await act(async () => {
      const repairButton = buttonNamed(page, "Repair");
      repairButton.click();
      repairButton.click();
      await settle(dom);
    });
    expect(repairKnowledgeHealth).toHaveBeenCalledOnce();
    const firstRepair = repairKnowledgeHealth.mock.calls[0]![0];
    expect(firstRepair).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260727_healthrepair",
      indexGeneration: "index:repair:4",
      issueKind: "broken_link",
      pageId: "page_health_repairable",
      action: "unlink_broken_reference",
      repairContextId
    });
    expect(firstRepair.requestId).toMatch(/^knowledge_health_repair_request_[a-z0-9]{16,64}$/);
    expect(page.textContent).toContain("That issue changed or is no longer available");
    expect(page.textContent).toContain("Repairable page");
    expect(onOpenPage).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed(page, "Repair").click();
      await settle(dom);
    });
    expect(repairKnowledgeHealth).toHaveBeenCalledTimes(2);
    expect(runKnowledgeHealth).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("Broken reference removed");
    expect(page.textContent).toContain("No issues found.");
    expect(page.textContent).not.toContain("Repairable page");
    expect(page.textContent).not.toContain("operation_");
    expect(page.textContent).not.toContain("repair_context");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("ignores a Knowledge Health repair result after the vault identity changes", async () => {
    const dom = createDom();
    let resolveRepair!: (result: unknown) => void;
    const repairContextId = `knowledge_health_repair_context_${"e".repeat(32)}`;
    const runKnowledgeHealth = vi.fn(async (request) => ({
      ...request,
      status: "ready",
      checkedAt: "2026-07-27T12:30:00.000Z",
      indexGeneration: "index:fenced:1",
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
        page: { pageId: "page_health_fenced", title: "Fenced page" },
        unresolvedLinkCount: 1,
        repairContextId
      }],
      truncated: false
    }));
    const repairKnowledgeHealth = vi.fn(() => new Promise((resolve) => { resolveRepair = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          repairKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderPanel = async (activeVaultId: string): Promise<void> => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId,
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage: vi.fn(async () => true),
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    };

    await act(async () => {
      await renderPanel("vault_20260727_repairfirst");
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Repair").click();
      await settle(dom);
    });
    const repairRequest = repairKnowledgeHealth.mock.calls[0]![0];
    await act(async () => renderPanel("vault_20260727_repairsecond"));
    await act(async () => {
      resolveRepair({
        ...repairRequest,
        status: "committed",
        revision: `noteeditrev_${"f".repeat(32)}`,
        operationId: `operation_${"g".repeat(32)}`
      });
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("Broken reference removed");
    expect(runKnowledgeHealth).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders verified Skills, disables and re-enables with exact CAS, and ignores stale registry events", async () => {
    const dom = createDom();
    let resolveSummary!: (result: SkillRegistryQueryResult) => void;
    let registryListener: ((summary: SkillRegistrySummary) => void) | undefined;
    const unsubscribe = vi.fn();
    const enabledRegistry = skillRegistry(7, true, 1);
    const disabledRegistry = skillRegistry(8, false, 1);
    const reenabledRegistry = skillRegistry(9, true, 1);
    const summary = vi.fn(() => new Promise<SkillRegistryQueryResult>((resolve) => {
      resolveSummary = resolve;
    }));
    const disable = vi.fn(async () => ({ status: "committed" as const, registry: disabledRegistry }));
    const enable = vi.fn(async (request: SkillEnableRequest): Promise<SkillLifecycleMutationResult> => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      skillId: request.skillId,
      status: "committed" as const,
      registry: reenabledRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary,
          disable,
          enable,
          onChanged: (listener: (next: SkillRegistrySummary) => void) => {
            registryListener = listener;
            return unsubscribe;
          }
        },
        vault: { current: async () => ({ vaultId: "vault_20260728_skilllifecycle" }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-skills")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-skills-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(page.textContent).toContain("Loading Skills");
    expect(page.textContent).not.toContain("No Skills installed");
    expect(summary).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSummary({ status: "ready", registry: enabledRegistry });
      await settle(dom);
    });

    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));
    expect(page.dataset.skillRegistryRevision).toBeUndefined();
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("7");
    expect(row.textContent).toContain("Review notes");
    expect(row.textContent).toContain("Summarizes the current source for review.");
    expect(row.textContent).toContain("v1.2.0");
    expect(row.textContent).toContain("Local workflow");
    expect(row.textContent).toContain("This Mac");
    expect(row.textContent).toContain("Local only");
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Some registry entries could not be verified and are hidden.");
    expect(page.textContent).not.toContain("/Users/private");
    expect(page.textContent).toContain("Source, files, and warnings stay visible");

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith({ apiVersion: 1, skillId: "review-notes", expectedRevision: 7 });
    expect(row.textContent).toContain("Disabled");
    expect(row.textContent).toContain("Enable");
    const disabledStatus = requireElement(row.querySelector<HTMLElement>(".settings-status"));
    expect(disabledStatus.classList.contains("neutral")).toBe(true);
    expect(disabledStatus.classList.contains("is-enabled")).toBe(false);
    expect(buttonNamed(row, "Enable: Review notes").disabled).toBe(false);
    expect(page.textContent).toContain("The Skill is disabled for new Agent runs.");

    await act(async () => {
      buttonNamed(row, "Enable: Review notes").click();
      await settle(dom);
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260728_skilllifecycle",
      skillId: "review-notes",
      expectedRegistryRevision: 8
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("The Skill is enabled for new Agent runs.");

    await act(async () => {
      registryListener?.(enabledRegistry);
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");

    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    expect(buttonNamed(page, "Import Markdown Skill").disabled).toBe(true);
    expect(requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"))).toBe(dom.window.document.activeElement);

    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it("exports without paths and confirms one trash-first uninstall with focus and identity fences", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skilllifecycle";
    const first = skillRegistry(12, true).skills[0]!;
    const second = {
      ...first,
      id: "organize-notes",
      name: "Organize notes",
      description: "Organizes selected notes."
    };
    const initialRegistry = skillRegistry(12, true, 0, [first, second]);
    const afterUninstall = skillRegistry(13, true, 0, [second]);
    let resolveUninstall!: (result: SkillLifecycleMutationResult) => void;
    const exportSkill = vi.fn(async (request: SkillExportRequest) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      skillId: request.skillId,
      registryRevision: request.expectedRegistryRevision,
      status: "cancelled" as const
    }));
    const uninstall = vi.fn((_request: SkillUninstallRequest) =>
      new Promise<SkillLifecycleMutationResult>((resolve) => { resolveUninstall = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          disable: vi.fn(),
          enable: vi.fn(),
          export: exportSkill,
          uninstall,
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const firstRow = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));

    await act(async () => {
      buttonNamed(firstRow, "Export: Review notes").click();
      await settle(dom);
      await settle(dom);
    });
    expect(exportSkill).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      skillId: "review-notes",
      expectedRegistryRevision: 12
    });
    expect(page.querySelector('.settings-note[role="status"]')).toBeNull();
    expect(page.textContent).not.toContain("/Users/");

    const uninstallTrigger = buttonNamed(firstRow, "Uninstall: Review notes");
    await act(async () => {
      uninstallTrigger.click();
      await settle(dom);
    });
    let confirmation = requireElement(page.querySelector<HTMLElement>('[role="alertdialog"]'));
    expect(confirmation.textContent).toContain("move its installed files to Trash");
    expect(dom.window.document.activeElement).toBe(buttonNamed(confirmation, "Cancel"));
    await act(async () => {
      confirmation.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(uninstallTrigger);

    await act(async () => {
      uninstallTrigger.click();
      await settle(dom);
    });
    confirmation = requireElement(page.querySelector<HTMLElement>('[role="alertdialog"]'));
    const confirm = buttonNamed(confirmation, "Move to Trash");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(uninstall).toHaveBeenCalledOnce();
    const request = uninstall.mock.calls[0]![0];
    expect(request).toEqual({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      skillId: "review-notes",
      expectedRegistryRevision: 12
    });
    await act(async () => {
      resolveUninstall({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: vaultId,
        skillId: "review-notes",
        status: "committed",
        registry: afterUninstall
      });
      await settle(dom);
      await settle(dom);
    });
    expect(page.querySelector('[data-skill-id="review-notes"]')).toBeNull();
    expect(page.textContent).toContain("The Skill was uninstalled and moved to Trash.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Disable: Organize notes"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one eligible source update for review and installs it without changing enabled state", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skillupdate";
    const updateable = {
      ...skillRegistry(20, false).skills[0]!,
      version: "1.2.0",
      canUpdate: true
    };
    const fixed = {
      ...updateable,
      id: "built-in-review",
      name: "Built-in review",
      scope: "built_in" as const,
      trust: "built_in" as const,
      canEnable: false,
      canUninstall: false,
      canExport: false,
      canUpdate: false
    };
    const initialRegistry = skillRegistry(20, false, 0, [updateable, fixed]);
    const updatedRegistry = skillRegistry(21, false, 0, [{
      ...updateable,
      version: "1.3.0"
    }, fixed]);
    const staged = {
      stagingId: "skillstage_abcdef0123456789abcdef0123456789" as const,
      manifestSha256: `sha256:${"c".repeat(64)}` as const,
      registryRevision: 20,
      expiresAt: "2026-07-28T12:00:00.000Z",
      sourceUrl: "https://example.com/SKILL.md" as const,
      id: "review-notes",
      name: "Review notes",
      version: "1.3.0",
      description: "Summarizes the current source with the reviewed update.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      author: "Pige Labs",
      license: "MIT",
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 2304, sha256: `sha256:${"d".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    };
    const stageUpdate = vi.fn(async (request: {
      requestId: `skill_lifecycle_request_${string}`;
      activeVaultId: string;
      skillId: string;
    }) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      skillId: request.skillId,
      status: "ready" as const,
      staged
    }));
    const installStaged = vi.fn(async (request: { requestId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      registry: updatedRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageUpdate,
          installStaged,
          discardStaged: vi.fn(),
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));
    expect(buttonNamed(row, "Update: Review notes").disabled).toBe(false);
    expect(page.querySelector('[aria-label="Update: Built-in review"]')).toBeNull();

    await act(async () => {
      const update = buttonNamed(row, "Update: Review notes");
      update.click();
      update.click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageUpdate).toHaveBeenCalledOnce();
    expect(stageUpdate).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      skillId: "review-notes",
      expectedRegistryRevision: 20
    });
    expect(page.textContent).toContain("v1.3.0");
    expect(page.textContent).toContain("This Skill comes from a remote source you must review.");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);
    const confirmUpdate = buttonNamed(page, "Update Skill");
    expect(dom.window.document.activeElement).toBe(confirmUpdate);

    await act(async () => {
      confirmUpdate.click();
      await settle(dom);
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      expectedRegistryRevision: 20,
      enabled: false
    });
    expect(row.textContent).toContain("v1.3.0");
    expect(row.textContent).toContain("Disabled");
    expect(page.textContent).toContain("The reviewed Skill update was installed.");
    expect(page.querySelector("#skill-url-install")).toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(row, "Update: Review notes"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts authoritative Skill state for current, stale, and missing update checks", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skillupdateclosed";
    const registries = [
      skillRegistry(31, true),
      skillRegistry(32, true),
      skillRegistry(33, true, 0, [])
    ];
    let resultIndex = 0;
    const stageUpdate = vi.fn(async (request: {
      requestId: `skill_lifecycle_request_${string}`;
      activeVaultId: string;
      skillId: string;
    }) => {
      const status = (["current", "stale", "not_found"] as const)[resultIndex]!;
      const registry = registries[resultIndex++]!;
      return {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        skillId: request.skillId,
        status,
        registry
      };
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: skillRegistry(30, true) }),
          stageUpdate,
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const update = (): HTMLButtonElement => buttonNamed(page, "Update: Review notes");

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("This Skill is already current.");
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("31");
    expect(dom.window.document.activeElement).toBe(update());

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("The Skill Registry changed");
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("32");

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("This Skill is no longer available for update.");
    expect(page.textContent).toContain("No Skills installed");
    expect(stageUpdate).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one Main-picked Markdown Skill for the existing safe review and install flow", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_markdownskill";
    const initialRegistry = skillRegistry(40, false, 0, []);
    const installedRegistry = skillRegistry(41, true);
    const staged = {
      stagingId: "skillstage_89abcdef0123456789abcdef01234567" as const,
      manifestSha256: `sha256:${"e".repeat(64)}` as const,
      registryRevision: 40,
      expiresAt: "2026-07-28T14:00:00.000Z",
      id: "local-review",
      name: "Local review",
      version: "1.0.0",
      description: "Reviews the current source from one local Markdown Skill.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1536, sha256: `sha256:${"f".repeat(64)}` as const }],
      warnings: []
    };
    let stageAttempt = 0;
    const stageFromMarkdown = vi.fn(async (request: {
      requestId: `skillreq_${string}`;
      activeVaultId: string;
    }) => {
      const identity = {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId
      };
      if (stageAttempt++ === 0) return { ...identity, status: "cancelled" as const };
      if (stageAttempt === 2) return { ...identity, status: "ready" as const, staged };
      return { ...identity, status: "failed" as const };
    });
    const installStaged = vi.fn(async (request: { requestId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      registry: installedRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageFromMarkdown,
          installStaged,
          discardStaged: vi.fn(),
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const importMarkdown = (): HTMLButtonElement => buttonNamed(page, "Import Markdown Skill");

    await act(async () => {
      const action = importMarkdown();
      action.click();
      action.click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledOnce();
    expect(stageFromMarkdown).toHaveBeenLastCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId
    });
    expect(page.textContent).not.toContain("Pige could not review this Markdown Skill safely.");
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => {
      importMarkdown().click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("Local review");
    expect(page.textContent).toContain("SKILL.md · 2 KB");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);
    expect(page.textContent).not.toContain("file://");
    const install = buttonNamed(page, "Install Skill");
    expect(dom.window.document.activeElement).toBe(install);

    await act(async () => {
      install.click();
      await settle(dom);
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      expectedRegistryRevision: 40,
      enabled: true
    });
    expect(page.textContent).toContain("The reviewed Skill is installed and enabled.");
    expect(page.querySelector("#skill-url-install")).toBeNull();
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => {
      importMarkdown().click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledTimes(3);
    expect(page.textContent).toContain("Pige could not review this Markdown Skill safely.");
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one exact Skill URL for review, installs with the frozen identity, and discards without installing", async () => {
    const dom = createDom();
    const initialRegistry = skillRegistry(3, false, 0, []);
    const installedRegistry = skillRegistry(4, true, 0);
    const staged = {
      stagingId: "skillstage_0123456789abcdef0123456789abcdef" as const,
      manifestSha256: `sha256:${"a".repeat(64)}` as const,
      registryRevision: 3,
      expiresAt: "2026-07-27T12:00:00.000Z",
      sourceUrl: "https://example.com/SKILL.md" as const,
      id: "review-notes",
      name: "Review notes",
      version: "1.2.0",
      description: "Summarizes the current source for review.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      author: "Pige Labs",
      license: "MIT",
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 2048, sha256: `sha256:${"b".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    };
    let stageCall = 0;
    const stageFromUrl = vi.fn(async (request: { requestId: string }) => ({
      status: "ready" as const,
      requestId: request.requestId,
      staged: { ...staged, registryRevision: stageCall++ === 0 ? 3 : 4 }
    }));
    const installStaged = vi.fn(async (request: { requestId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      registry: installedRegistry
    }));
    const discardStaged = vi.fn(async (request: { requestId: string }) => ({
      status: "discarded" as const,
      requestId: request.requestId
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageFromUrl,
          installStaged,
          discardStaged,
          disable: vi.fn(),
          onChanged: () => () => undefined
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    const input = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    await act(async () => {
      input.blur();
      inputValue(dom, input, staged.sourceUrl);
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Review Skill").click();
      await settle(dom);
    });
    expect(stageFromUrl).toHaveBeenCalledOnce();
    expect(stageFromUrl.mock.calls[0]?.[0]).toMatchObject({ apiVersion: 1, sourceUrl: staged.sourceUrl });
    expect(stageFromUrl.mock.calls[0]?.[0].requestId).toMatch(/^skillreq_[a-z0-9]{16,64}$/u);
    expect(page.textContent).toContain("Review notes");
    expect(page.textContent).toContain("Read the current source");
    expect(page.textContent).toContain("This Skill comes from a remote source you must review.");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);

    await act(async () => {
      buttonNamed(page, "Install Skill").click();
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      expectedRegistryRevision: 3,
      enabled: true
    });
    expect(page.textContent).toContain("The reviewed Skill is installed and enabled.");
    expect(page.querySelector("#skill-install-url")).toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Install from link"));

    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    const secondInput = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    await act(async () => {
      secondInput.blur();
      inputValue(dom, secondInput, staged.sourceUrl);
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Review Skill").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Discard").click();
      await settle(dom);
    });
    expect(discardStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256
    });
    expect(Array.from(page.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Discard")).toBe(false);
    const restoredInput = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    expect(restoredInput.value).toBe(staged.sourceUrl);
    expect(dom.window.document.activeElement).toBe(restoredInput);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed on the body-free Skill Registry failed result and retries to a verified empty state", async () => {
    const dom = createDom();
    const failedQuery: SkillRegistryQueryResult = {
      status: "failed",
      error: {
        code: "skill.registry_unavailable",
        domain: "skill",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      }
    };
    const summary = vi.fn()
      .mockResolvedValueOnce(failedQuery)
      .mockResolvedValueOnce({ status: "ready" as const, registry: skillRegistry(0, false, 0, []) });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary,
          disable: vi.fn(),
          onChanged: () => () => undefined
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    expect(page.textContent).toContain("Skill Registry unavailable");
    expect(page.textContent).toContain("No inventory state is being inferred.");
    expect(page.textContent).not.toContain("skill.registry_unavailable");

    await act(async () => {
      buttonNamed(page, "Try again").click();
      await settle(dom);
      await settle(dom);
    });
    expect(summary).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("No Skills installed");
    expect(page.textContent).toContain("verified machine-local registry contains no installed Skills");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps verified Skill state unchanged for body-free busy and unavailable disable results", async () => {
    const dom = createDom();
    const registry = skillRegistry(11, true, 0);
    const failedResult = (code: "skill.registry_busy" | "skill.registry_unavailable"): SkillRegistryMutationResult => ({
      status: "failed",
      error: {
        code,
        domain: "skill",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      }
    });
    const disable = vi.fn()
      .mockResolvedValueOnce(failedResult("skill.registry_busy"))
      .mockResolvedValueOnce(failedResult("skill.registry_unavailable"));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry }),
          disable,
          onChanged: () => () => undefined
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Another Skill Registry change is in progress. Try again.");

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Skill Registry could not save this change. Nothing was changed.");
    expect(page.textContent).not.toContain("registry.json");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("installs one exact Pi package through the typed API and adopts the authoritative disabled inventory", async () => {
    const dom = createDom();
    let settleInstall!: (result: PiPackageInstallResult) => void;
    const summary = vi.fn(async () => ({ status: "ready", registry: piPackageRegistry(2) } as const));
    const install = vi.fn((request: PiPackageInstallRequest) => new Promise<PiPackageInstallResult>((resolve) => {
      settleInstall = resolve;
    }));
    const api: PiPackagesApi = { summary, install };
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-packages")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-packages-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(page.textContent).toContain("No Pi packages installed");
    expect(page.querySelector("[data-package-id]")).toBeNull();
    const packageName = requireElement(page.querySelector<HTMLInputElement>("#pi-package-name"));
    const version = requireElement(page.querySelector<HTMLInputElement>("#pi-package-version"));

    await act(async () => {
      inputValue(dom, packageName, "@larksuite/cli");
      inputValue(dom, version, "1.0.77");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Install").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledTimes(1);
    const request = install.mock.calls[0]![0];
    expect(request).toMatchObject({
      apiVersion: 1,
      expectedRegistryRevision: 2,
      packageName: "@larksuite/cli",
      version: "1.0.77"
    });
    expect(request.requestId).toMatch(/^pi_package_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(page, "Waiting for confirmation…").disabled).toBe(true);

    await act(async () => {
      buttonNamed(page, "Waiting for confirmation…").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledTimes(1);

    const installed = piPackageRegistry(3, [{
      packageId: "pkg_0123456789abcdef01234567",
      packageName: "@larksuite/cli",
      version: "1.0.77",
      state: "installed_disabled",
      packageTypes: ["extension"],
      dependencyCount: 0,
      enabled: false,
      trust: "community"
    }]);
    await act(async () => {
      settleInstall({
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status: "installed_disabled",
        registry: installed
      });
      await settle(dom);
    });

    const packageRow = requireElement(page.querySelector<HTMLElement>('[data-package-id="pkg_0123456789abcdef01234567"]'));
    expect(packageRow.textContent).toContain("@larksuite/cli");
    expect(packageRow.textContent).toContain("v1.0.77");
    expect(packageRow.textContent).toContain("Installed · Disabled");
    expect(dom.window.document.activeElement).toBe(packageRow);
    expect(packageName.value).toBe("");
    expect(version.value).toBe("");
    expect(page.textContent).not.toMatch(/Enable|Update|Uninstall|Catalog/u);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains the exact Pi package draft and existing inventory across stale, denied, and failed results", async () => {
    const dom = createDom();
    const originalPackage = {
      packageId: "pkg_aaaaaaaaaaaaaaaaaaaaaaaa",
      packageName: "existing-package",
      version: "2.0.0",
      state: "installed_disabled" as const,
      packageTypes: ["skill" as const],
      dependencyCount: 0,
      enabled: false as const,
      trust: "community" as const
    };
    const results: Array<"stale" | "denied" | "failed"> = ["stale", "denied", "failed"];
    const install = vi.fn(async (request: PiPackageInstallRequest): Promise<PiPackageInstallResult> => {
      const status = results.shift()!;
      return {
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status,
        registry: status === "failed"
          ? piPackageRegistry(6, [{ ...originalPackage, packageName: "must-not-replace-existing" }])
          : piPackageRegistry(5, [originalPackage])
      };
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(4, [originalPackage]) }),
      install
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const packageName = requireElement(page.querySelector<HTMLInputElement>("#pi-package-name"));
    const version = requireElement(page.querySelector<HTMLInputElement>("#pi-package-version"));
    await act(async () => {
      inputValue(dom, packageName, "new-package");
      inputValue(dom, version, "1.2.3");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Install").click();
      await settle(dom);
    });
    expect(page.querySelector('[data-package-registry-revision="5"]')).not.toBeNull();
    expect(page.textContent).toContain("The package registry changed");

    for (const message of [
      "Installation was not approved",
      "Pige could not install this package"
    ]) {
      await act(async () => {
        buttonNamed(page, "Install").click();
        await settle(dom);
      });
      expect(page.textContent).toContain(message);
      expect(packageName.value).toBe("new-package");
      expect(version.value).toBe("1.2.3");
      expect(page.textContent).toContain("existing-package");
      expect(page.textContent).not.toContain("must-not-replace-existing");
    }
    expect(install.mock.calls.map(([request]) => request.expectedRegistryRevision)).toEqual([4, 5, 5]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds real redacted diagnostics and support preview on its own page", async () => {
    const dom = createDom();
    const refreshDiagnostics = vi.fn(async () => undefined);
    const previewSupportBundle = vi.fn(async () => ({
      previewId: "support_preview",
      generatedAt: "2026-07-16T00:00:00.000Z",
      localOnly: true as const,
      estimatedBytes: 2048,
      includedCategories: [{ id: "app_runtime", label: "/private/raw-label", included: true, reason: "private body" }],
      excludedCategories: [{ id: "content", label: "RAW CONTENT", included: false, reason: "excluded" }],
      privacyWarnings: [
        "The bundle is created locally and is not uploaded automatically.",
        "Paths, emails, and common secret patterns are redacted by default.",
        "Review the preview before exporting."
      ]
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          previewSupportBundle,
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewSupportBundle>> | null>(null);
      return createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: {
          status: "ok",
          checkedAt: "2026-07-16T00:00:00.000Z",
          localOnly: true,
          recentErrorCount: 0,
          checks: []
        },
        supportBundlePreview: preview,
        onRefreshDiagnostics: refreshDiagnostics,
        onSupportBundlePreviewChange: setPreview,
        t
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-system-page")!;
    expect(panel.querySelector("h1")?.textContent).toBe("Diagnostics");
    expect(panel.textContent).not.toContain("Check for updates");
    expect(buttonNamed(panel, "Clear…").disabled).toBe(true);

    await act(async () => {
      buttonNamed(panel, "Refresh").click();
      await settle(dom);
    });
    expect(refreshDiagnostics).toHaveBeenCalledOnce();

    await act(async () => {
      buttonNamed(panel, "Preview and export…").click();
      await settle(dom);
    });
    expect(previewSupportBundle).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Preview ready");
    expect(panel.textContent).toContain("App and platform");
    expect(panel.textContent).toContain("Private knowledge content");
    expect(panel.textContent).toContain("The bundle is created locally and is never uploaded automatically.");
    expect(buttonNamed(panel, "Export Support Bundle").disabled).toBe(false);
    expect(panel.textContent).not.toContain("/private/raw-label");
    expect(panel.textContent).not.toContain("private body");
    expect(panel.textContent).not.toContain("RAW CONTENT");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds explicit update checks with stale-event and synchronous busy fences", async () => {
    const dom = createDom();
    let statusListener: ((event: {
      apiVersion: 1;
      requestId: string;
      sequence: number;
      summary: import("@pige/contracts").UpdateSummary;
    }) => void) | undefined;
    const unsubscribe = vi.fn();
    let resolveCheck: ((result: import("@pige/contracts").UpdateCheckResult) => void) | undefined;
    const check = vi.fn((request: import("@pige/contracts").UpdateCheckRequest) =>
      new Promise<import("@pige/contracts").UpdateCheckResult>((resolve) => {
        resolveCheck = resolve;
      })
    );
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        updates: {
          summary: vi.fn(async () => ({
            apiVersion: 1 as const,
            revision: 2,
            channel: "alpha" as const,
            capability: "packaged_ready" as const,
            currentVersion: "0.1.0",
            phase: "idle" as const
          })),
          check,
          onStatusChanged: vi.fn((listener: typeof statusListener) => {
            statusListener = listener;
            return unsubscribe;
          })
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "updates",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: null,
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-updates-page")!;
    expect(panel.querySelector("h1")?.textContent).toBe("Updates");
    expect(panel.textContent).not.toContain("Support bundle");
    expect(panel.textContent).toContain("0.1.0");
    expect(panel.textContent).toContain("Not checked yet");
    expect(buttonNamed(panel, "Temporarily unavailable. Nothing was changed.").disabled).toBe(true);

    await act(async () => {
      buttonNamed(panel, "Check for updates").click();
      buttonNamed(panel, "Check for updates").click();
    });
    expect(check).toHaveBeenCalledOnce();
    const request = check.mock.calls[0]?.[0];
    expect(request?.requestId).toMatch(/^updatereq_[a-z0-9]{32}$/);

    await act(async () => {
      statusListener?.({
        apiVersion: 1,
        requestId: request!.requestId,
        sequence: 1,
        summary: {
          apiVersion: 1,
          revision: 2,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "checking"
        }
      });
      await settle(dom);
    });
    expect(buttonNamed(panel, "Checking…").disabled).toBe(true);

    await act(async () => {
      resolveCheck?.({
        status: "checked",
        requestId: request!.requestId,
        summary: {
          apiVersion: 1,
          revision: 3,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "available",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:00:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(panel.textContent).toContain("0.2.0");
    expect(buttonNamed(panel, "Download update").disabled).toBe(true);

    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it("shows the real development capability without offering a fake update action", async () => {
    const dom = createDom();
    const check = vi.fn();
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        updates: {
          summary: vi.fn(async () => ({
            apiVersion: 1 as const,
            revision: 0,
            channel: "alpha" as const,
            capability: "development" as const,
            currentVersion: "0.1.0-alpha.1",
            phase: "idle" as const
          })),
          check,
          onStatusChanged: vi.fn(() => () => undefined)
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "updates",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: null,
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-updates-page")!;
    expect(panel.textContent).toContain("Update checking is still in development for this build.");
    expect(buttonNamed(panel, "Check for updates").disabled).toBe(true);
    expect(check).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed when a support preview contains an unreviewed projection", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          previewSupportBundle: vi.fn(),
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn()
        }
      }
    });

    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: {
          previewId: "support_unknown",
          generatedAt: "2026-07-16T00:00:00.000Z",
          localOnly: true,
          estimatedBytes: 1024,
          includedCategories: [{ id: "future_private_category", label: "/raw/path", included: true, reason: "raw reason" }],
          excludedCategories: [],
          privacyWarnings: ["raw warning"]
        },
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const panel = dom.window.document.querySelector<HTMLElement>(".settings-system-page")!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain("cannot safely describe every preview item");
    expect(buttonNamed(panel, "Export Support Bundle").disabled).toBe(true);
    expect(panel.textContent).not.toContain("/raw/path");
    expect(panel.textContent).not.toContain("raw reason");
    expect(panel.textContent).not.toContain("raw warning");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("presents connected services and exact high-risk confirmation without standing permission modes", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The Privacy panel must remain a truthful static projection.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { t }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Permissions & Privacy");
    expect(container.textContent).toContain("Connected model services");
    expect(container.querySelector(".settings-status")?.textContent).toBe("Default policy");
    expect(container.textContent).toContain("Model service");
    expect(container.textContent).toContain(
      "Sending a message sends exactly what you wrote and the selected context to the connected model service."
    );
    expect(container.textContent).toContain(
      "Pige does not classify, redact, or block message content."
    );
    expect(container.textContent).toContain("Uses your connected provider");
    expect(container.textContent).toContain("without a second confirmation dialog");
    expect(container.textContent).toContain("Exact high-risk effects");
    expect(container.textContent).toContain("Confirm each effect");
    expect(container.textContent).toContain("No standing authority");
    expect(container.textContent).toContain("Protected");
    expect(container.textContent).not.toContain("Default mode");
    expect(container.textContent).not.toContain("Saved scoped grants");
    expect(container.textContent).not.toContain("YOLO");
    expect(container.textContent).not.toContain("Sensitive content confirms once");
    expect(container.textContent).not.toContain("restricted content never sends");
    expect(container.textContent).not.toContain("Hide obvious secrets before sending");
    expect(container.textContent).not.toContain("Cloud-send controls");
    expect(container.textContent).not.toContain("redaction preference");
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[data-privacy-control="cloud-policy"]')).toBeNull();
    expect(container.querySelector(".model-egress-prompt")).toBeNull();
    expect(Object.hasOwn(enMessages, "errors.model_provider.output_invalid")).toBe(false);
    expect(Object.hasOwn(enMessages, "errors.agent_runtime.completion_invalid")).toBe(false);
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds the real theme and app language while keeping unfinished language choices honest", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The Appearance panel must use only its provided adapters.");
      }
    });
    let finishLocaleChange: (() => void) | undefined;
    const onLocaleChange = vi.fn(async (locale: string) => {
      if (locale === "fr") await new Promise<void>((resolve) => { finishLocaleChange = resolve; });
      if (locale === "de") throw new Error("raw locale persistence failure /Users/private");
    });
    const onThemeChange = vi.fn(async () => true);
    const onDevelopment = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AppearanceSettingsPanel, {
        locale: "en",
        availableLocales: ["en", "fr", "de"],
        themePreference: "system",
        themeBusy: false,
        themeError: null,
        onLocaleChange,
        onThemeChange,
        onDevelopment,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Appearance & Language");
    const themeGroup = requireElement(container.querySelector<HTMLElement>('[role="radiogroup"]'));
    const themes = Array.from(themeGroup.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(themes).toHaveLength(3);
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(themes.map((theme) => theme.tabIndex)).toEqual([0, -1, -1]);

    await act(async () => {
      themes[2]!.click();
      themes[0]!.focus();
      themes[0]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(themes[1]);
    expect(onThemeChange.mock.calls.map(([theme]) => theme)).toEqual(["dark", "light"]);
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    const appLanguage = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="App language"]'));
    const knowledgeLanguage = requireElement(container.querySelector<HTMLButtonElement>('[data-appearance-control="knowledge-language"]'));
    const ocrLanguage = requireElement(container.querySelector<HTMLButtonElement>('[data-appearance-control="ocr-language"]'));
    expect(knowledgeLanguage.textContent).toBe("In development");
    expect(ocrLanguage.textContent).toBe("In development");
    expect(container.querySelector('select[aria-label="Knowledge language"]')).toBeNull();
    expect(container.querySelector('select[aria-label="OCR language hint"]')).toBeNull();
    await act(async () => {
      selectValue(dom, appLanguage, "fr");
      await settle(dom);
    });
    expect(appLanguage.disabled).toBe(true);
    await act(async () => {
      selectValue(dom, appLanguage, "de");
      await settle(dom);
    });
    expect(onLocaleChange.mock.calls.map(([locale]) => locale)).toEqual(["fr"]);
    await act(async () => {
      finishLocaleChange?.();
      await settle(dom);
    });
    expect(appLanguage.disabled).toBe(false);
    await act(async () => {
      knowledgeLanguage.click();
      ocrLanguage.click();
      await settle(dom);
    });
    expect(onLocaleChange).toHaveBeenCalledWith("fr");
    expect(onDevelopment).toHaveBeenCalledTimes(2);
    expect(knowledgeLanguage.textContent).toBe("In development");
    expect(ocrLanguage.textContent).toBe("In development");
    expect(ipcRead).toBe(false);

    await act(async () => {
      selectValue(dom, appLanguage, "de");
      await settle(dom);
    });
    expect(onLocaleChange).toHaveBeenLastCalledWith("de");
    expect(container.querySelector("#appearance-language-error")?.textContent)
      .toBe("Language could not be changed. The current language was kept.");
    expect(appLanguage.getAttribute("aria-describedby"))
      .toBe("appearance-app-language-description appearance-language-error");
    expect(container.querySelector("#appearance-language-error")?.getAttribute("role")).toBe("status");
    expect(appLanguage.disabled).toBe(false);
    expect(container.textContent).not.toContain("raw locale persistence failure");
    expect(container.textContent).not.toContain("/Users/private");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows real toolchain health without exposing paths and keeps unfinished capability controls local", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The capabilities panel must use only its provided adapters.");
      }
    });
    const onRefresh = vi.fn(async () => undefined);
    const onDevelopment = vi.fn();
    const semanticRetrievalApi = semanticAssetApi("ready");
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi,
        toolchainHealth: {
          status: "needs_repair",
          checkedAt: "2026-07-16T01:00:00.000Z",
          tools: [
            {
              id: "git",
              name: "Git",
              required: true,
              status: "ready",
              resolvedPath: "/private/hidden/bin/git"
            },
            {
              id: "pdf-tools",
              name: "PDF tools",
              required: true,
              status: "missing",
              repairHint: "Install a private dependency from a private path."
            },
            {
              id: "bun",
              name: "Bun",
              required: false,
              status: "missing"
            }
          ]
        },
        speechAvailability: {
          status: "unsupported",
          reason: "assets_unavailable",
          canOpenSystemSettings: false
        },
        speechAvailabilityLoading: false,
        speechAvailabilityFailed: false,
        onRefresh,
        onOpenSpeechSettings: vi.fn(async () => undefined),
        onDevelopment,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Local Capabilities");
    expect(container.textContent).toContain("Needs repair");
    expect(container.textContent).toContain("Git");
    expect(container.textContent).toContain("PDF tools");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Missing");
    expect(container.textContent).toContain("Not installed");
    expect(container.querySelector('[aria-label="Bun: Not installed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="PDF tools: Missing"]')).not.toBeNull();
    expect(container.textContent).not.toContain("/private/hidden/bin/git");
    expect(container.textContent).not.toContain("Install a private dependency");
    expect(container.textContent).toContain("Enabled");
    expect(container.textContent).toContain("Lexical search always remains available.");

    const paddleOcr = requireElement(container.querySelector<HTMLElement>('[data-paddle-ocr-state="not_installed"]'));
    const imageOcr = requireElement(container.querySelector<HTMLButtonElement>('[data-capability-control="image-ocr"]'));
    const voice = requireElement(container.querySelector<HTMLElement>('[data-capability-status="voice-input"]'));
    expect(paddleOcr.textContent).toContain("PaddleOCR fallback");
    expect(paddleOcr.textContent).toContain("Not installed");
    expect(paddleOcr.textContent).toContain("Install");
    expect(imageOcr.textContent).toBe("In development");
    expect(voice.textContent).toBe("Language resource needed");
    expect(container.querySelector('[data-capability-control="voice-input"]')).toBeNull();
    expect(container.querySelector('[data-capability-control="voice-open-settings"]')).toBeNull();
    expect(container.querySelector('select[aria-label="OCR engine"]')).toBeNull();
    expect(container.querySelector('button[role="switch"][aria-label="Image and scanned-page OCR"]')).toBeNull();
    expect(container.querySelector('button[role="switch"][aria-label="Voice input"]')).toBeNull();

    await act(async () => {
      buttonNamed(container, "Check again").click();
      buttonNamed(container, "Repair...").click();
      imageOcr.click();
      await settle(dom);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onDevelopment).toHaveBeenCalledTimes(2);
    expect(imageOcr.textContent).toBe("In development");
    expect(voice.textContent).toBe("Language resource needed");
    expect(ipcRead).toBe(false);

    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi,
        toolchainHealth: {
          status: "ready",
          checkedAt: "2026-07-16T01:01:00.000Z",
          tools: [
            {
              id: "git",
              name: "Git",
              required: true,
              status: "ready"
            },
            {
              id: "bun",
              name: "Bun",
              required: false,
              status: "missing"
            }
          ]
        },
        onRefresh,
        onDevelopment,
        t
      }));
      await settle(dom);
    });
    expect(container.textContent).toContain("Ready");
    expect(container.querySelector('[aria-label="Bun: Not installed"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Missing required tools");
    expect(
      Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Repair...")
    ).toBe(false);
    expect(onDevelopment).toHaveBeenCalledTimes(2);
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps Speech Service availability App-owned, locale-scoped, and stale-result fenced", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    expect(appSource).toContain('if (!settingsOpen || settingsSection !== "capabilities") return;');
    expect(appSource).toContain("window.pige.speech.availability({ languageTag: locale })");
    expect(appSource).toContain("requestId !== speechAvailabilitySequence.current");
    expect(appSource).toContain("window.pige.speech.openSystemSettings()");
    expect(appSource).not.toContain("navigator.mediaDevices");
  });

  it("runs the managed PaddleOCR lifecycle from authoritative actions without exposing package internals", async () => {
    const dom = createDom();
    let current = paddleOcrSummary(1, "not_installed");
    let resolveInstall!: (result: PaddleOcrInstallResult) => void;
    const installResult = new Promise<PaddleOcrInstallResult>((resolve) => {
      resolveInstall = resolve;
    });
    const summary = vi.fn(async () => current);
    const install = vi.fn(async (_request: PaddleOcrInstallRequest) => installResult);
    const enable = vi.fn(async (request: PaddleOcrEnableRequest): Promise<PaddleOcrEnableResult> => {
      current = paddleOcrSummary(3, "ready");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "committed",
        summary: current
      };
    });
    const test = vi.fn(async (request: PaddleOcrTestRequest): Promise<PaddleOcrTestResult> => {
      current = paddleOcrSummary(4, "ready");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "accepted",
        jobId: "job_20260728_paddleocrtest",
        summary: current
      };
    });
    const disable = vi.fn()
      .mockImplementationOnce(async (request: PaddleOcrDisableRequest): Promise<PaddleOcrDisableResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "failed"
      }))
      .mockImplementationOnce(async (request: PaddleOcrDisableRequest): Promise<PaddleOcrDisableResult> => {
        current = paddleOcrSummary(5, "disabled");
        return {
          apiVersion: 1,
          requestId: request.requestId,
          engineId: "paddleocr_local",
          status: "committed",
          summary: current
        };
      });
    const remove = vi.fn(async (request: PaddleOcrRemoveRequest): Promise<PaddleOcrRemoveResult> => {
      current = paddleOcrSummary(6, "not_installed");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "committed",
        summary: current
      };
    });
    const api: PaddleOcrApi = {
      paddleOcrSummary: summary,
      installPaddleOcr: install,
      enablePaddleOcr: enable,
      testPaddleOcr: test,
      disablePaddleOcr: disable,
      removePaddleOcr: remove
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: api,
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: null,
        speechAvailability: null,
        speechAvailabilityLoading: false,
        speechAvailabilityFailed: false,
        onRefresh: vi.fn(async () => undefined),
        onOpenSpeechSettings: vi.fn(async () => undefined),
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("PaddleOCR fallback");
    expect(container.textContent).toContain("24 MB");
    expect(container.textContent).toContain("Downloads occur only after you choose Install.");
    expect(container.textContent).not.toContain("Private Python");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("sha256:");
    expect(container.querySelector('[data-paddle-ocr-action="update"]')).toBeNull();
    expect(container.querySelector('[data-paddle-ocr-action="repair"]')).toBeNull();
    const paddleButton = (action: string): HTMLButtonElement => requireElement(
      container.querySelector<HTMLButtonElement>(`[data-paddle-ocr-action="${action}"]`)
    );

    const installButton = paddleButton("install");
    await act(async () => {
      installButton.click();
      installButton.click();
    });
    expect(install).toHaveBeenCalledOnce();
    const installRequest = install.mock.calls[0]?.[0];
    expect(installRequest).toEqual({
      apiVersion: 1,
      requestId: expect.stringMatching(/^paddleocr_[a-z0-9]{16,64}$/u),
      expectedRevision: 1
    });
    current = paddleOcrSummary(2, "disabled");
    await act(async () => {
      resolveInstall({
        apiVersion: 1,
        requestId: installRequest!.requestId,
        engineId: "paddleocr_local",
        status: "accepted",
        jobId: "job_20260728_paddleocrinstall",
        summary: current
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Disabled");

    await act(async () => {
      paddleButton("enable").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("test").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("disable").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(test).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(container.textContent).toContain("PaddleOCR could not be changed");
    expect(container.textContent).toContain("Ready");

    await act(async () => {
      paddleButton("disable").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("remove").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }));
    expect(container.textContent).toContain("Not installed");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("projects real speech availability without requesting permission and opens system settings only after denial", async () => {
    const dom = createDom();
    const onOpenSpeechSettings = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const semanticRetrievalApi = semanticAssetApi("ready");
    const renderPanel = async (speechAvailability: SpeechAvailabilityResult): Promise<void> => {
      await act(async () => {
        root.render(createElement(LocalCapabilitiesSettingsPanel, {
          paddleOcrApi: paddleOcrApi("not_installed"),
          semanticRetrievalApi,
          toolchainHealth: null,
          speechAvailability,
          speechAvailabilityLoading: false,
          speechAvailabilityFailed: false,
          onRefresh: vi.fn(async () => undefined),
          onOpenSpeechSettings,
          onDevelopment: vi.fn(),
          t
        }));
        await settle(dom);
      });
    };

    await renderPanel({
      status: "supported",
      languageTag: "en",
      permission: "not-determined",
      canOpenSystemSettings: true
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector('[data-capability-status="voice-input"]')?.textContent).toBe("Available");
    expect(container.querySelector('[data-capability-control="voice-open-settings"]')).toBeNull();
    expect(onOpenSpeechSettings).not.toHaveBeenCalled();

    await renderPanel({
      status: "supported",
      languageTag: "en",
      permission: "denied",
      canOpenSystemSettings: true
    });
    expect(container.querySelector('[data-capability-status="voice-input"]')?.textContent).toBe("Permission needed");
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-capability-control="voice-open-settings"]')).click();
      await settle(dom);
    });
    expect(onOpenSpeechSettings).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps install, enable, disable, and remove as distinct revision-fenced semantic asset actions", async () => {
    const dom = createDom();
    let current = semanticAssetStatus(1, "not_installed");
    const status = vi.fn(async () => current);
    const install = vi.fn(async (request: LocalSemanticRetrievalInstallRequest): Promise<LocalSemanticRetrievalInstallResult> => {
      current = semanticAssetStatus(3, "disabled");
      return { apiVersion: 1, requestId: request.requestId, revision: 2, status: "accepted", jobId: "job_20260727_semanticasset" };
    });
    const enable = vi.fn(async (request: LocalSemanticRetrievalEnableRequest): Promise<LocalSemanticRetrievalEnableResult> => {
      current = semanticAssetStatus(4, "ready");
      return { apiVersion: 1, requestId: request.requestId, revision: 4, status: "committed" };
    });
    const disable = vi.fn(async (request: LocalSemanticRetrievalDisableRequest): Promise<LocalSemanticRetrievalDisableResult> => {
      current = semanticAssetStatus(5, "disabled");
      return { apiVersion: 1, requestId: request.requestId, revision: 5, status: "committed" };
    });
    const remove = vi.fn(async (request: LocalSemanticRetrievalRemoveRequest): Promise<LocalSemanticRetrievalRemoveResult> => {
      current = semanticAssetStatus(6, "not_installed");
      return { apiVersion: 1, requestId: request.requestId, revision: 6, status: "committed" };
    });
    const api: LocalSemanticRetrievalApi = {
      localSemanticStatus: status,
      installLocalSemanticAsset: install,
      enableLocalSemanticAsset: enable,
      disableLocalSemanticAsset: disable,
      removeLocalSemanticAsset: remove
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalSemanticRetrievalSettingsPanel, { api, t }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Not installed");
    expect(container.textContent).toContain("Lexical search always remains available.");

    await act(async () => {
      buttonNamed(container, "Install").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: 1, expectedRevision: 1 }));
    expect(install.mock.calls[0]?.[0].requestId).toMatch(/^ragasset_[a-z0-9]{16,64}$/u);
    expect(enable).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Disabled");
    expect(buttonNamed(container, "Enable")).not.toBeNull();

    await act(async () => {
      buttonNamed(container, "Enable").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(container.textContent).toContain("Enabled");

    await act(async () => {
      buttonNamed(container, "Disable").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(container.textContent).toContain("Disabled");

    await act(async () => {
      buttonNamed(container, "Remove").click();
      await settle(dom);
    });
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }));
    expect(container.textContent).toContain("Not installed");
    expect(container.textContent).not.toContain("qwen3_embedding_0_6b_q8_0");
    expect(container.textContent).not.toContain("provider");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("manages the reversible vault memory lifecycle with exact CAS and quiet cancellation", async () => {
    const dom = createDom();
    const activeSummary = memorySummary(4, "active");
    const disabledSummary = memorySummary(5, "disabled");
    const enabledSummary = memorySummary(6, "active");
    const staleSummary = memorySummary(7, "active");
    const emptySummary = memoryEmptySummary(8);
    const resetSummary = memoryEmptySummary(9);
    let resolveList!: (summary: MemorySummary) => void;
    const list = vi.fn(() => new Promise<MemorySummary>((resolve) => {
      resolveList = resolve;
    }));
    const disable = vi.fn(async (): Promise<MemoryMutationResult> => ({
      status: "committed",
      summary: disabledSummary
    }));
    const enable = vi.fn(async (request: MemoryEnableRequest): Promise<MemoryLifecycleMutationResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "committed",
      operationId: "op_20260727_memoryenable",
      summary: enabledSummary
    }));
    let deleteAttempt = 0;
    const deleteMemory = vi.fn(async (request: MemoryDeleteRequest): Promise<MemoryLifecycleMutationResult> => {
      deleteAttempt += 1;
      return deleteAttempt === 1
        ? { apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "stale", summary: staleSummary }
        : { apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "committed", operationId: "op_20260727_memorydelete", summary: emptySummary };
    });
    let exportAttempt = 0;
    const exportMemory = vi.fn(async (request: MemoryExportRequest): Promise<MemoryExportResult> => {
      exportAttempt += 1;
      return {
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        revision: request.expectedRevision,
        status: exportAttempt === 1 ? "cancelled" : "exported"
      };
    });
    const reset = vi.fn(async (request: MemoryResetRequest): Promise<MemoryLifecycleMutationResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "committed",
      operationId: "op_20260727_memoryreset",
      summary: resetSummary
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { memory: { list, disable, edit: vi.fn(), enable, delete: deleteMemory, export: exportMemory, reset } }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memoryfixture",
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Agent & Memory");
    expect(container.textContent).toContain("Loading memories");
    expect(list).toHaveBeenCalledWith({ apiVersion: 1, activeVaultId: "vault_20260727_memoryfixture" });

    await act(async () => {
      resolveList(activeSummary);
      await settle(dom);
    });

    const row = requireElement(container.querySelector<HTMLElement>('[data-memory-id="memory_20260727_concisestyle"]'));
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("4");
    expect(row.textContent).toContain("Concise source summaries");
    expect(row.textContent).toContain("Keep source summaries concise and preserve citations.");
    expect(row.textContent).toContain("Preference");
    expect(row.textContent).toContain("Active");
    expect(row.textContent).toContain("Explicit request");
    expect(row.textContent).not.toContain("conv_20260727_memorysource");
    expect(row.textContent).not.toContain("evt_20260727_memorysourceevent");
    expect(container.textContent).toContain("Export");
    expect(container.textContent).toContain("Reset memory");

    await act(async () => {
      buttonNamed(row, "Disable: Concise source summaries").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 4
    }));
    expect(disable.mock.calls[0]?.[0].requestId).toMatch(/^memory_request_[a-z0-9]{16,64}$/u);
    expect(row.textContent).toContain("Disabled");
    expect(buttonNamed(row, "Enable: Concise source summaries").disabled).toBe(false);
    expect(container.textContent).toContain("The memory is disabled for future Agent turns.");

    await act(async () => {
      buttonNamed(row, "Enable: Concise source summaries").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 5
    }));
    expect(enable.mock.calls[0]?.[0].requestId).toMatch(/^memory_request_[a-z0-9]{16,64}$/u);
    expect(container.textContent).toContain("The memory is enabled for future Agent turns.");

    await act(async () => {
      buttonNamed(container, "Export").click();
      await settle(dom);
    });
    expect(exportMemory).toHaveBeenLastCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      expectedRevision: 6
    }));
    expect(container.querySelector('.settings-note[role="status"]')).toBeNull();

    await act(async () => {
      buttonNamed(container, "Export").click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Memory was exported safely.");

    await act(async () => {
      buttonNamed(container, "Delete: Concise source summaries").click();
      await settle(dom);
    });
    expect(deleteMemory).toHaveBeenLastCalledWith(expect.objectContaining({
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 6
    }));
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("7");
    expect(container.textContent).toContain("Memory changed. The latest list is shown.");

    await act(async () => {
      buttonNamed(container, "Delete: Concise source summaries").click();
      await settle(dom);
    });
    expect(deleteMemory).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 7 }));
    expect(container.textContent).toContain("No saved memories");
    expect(container.textContent).toContain("The memory was removed. You can undo this from Activity.");

    const resetTrigger = buttonNamed(container, "Reset memory...");
    await act(async () => {
      resetTrigger.click();
      await settle(dom);
    });
    let dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    expect(dialog.textContent).toContain("Reset vault memory?");
    expect(dom.window.document.activeElement).toBe(buttonNamed(dialog, "Reset memory"));
    await act(async () => {
      buttonNamed(dialog, "Cancel").click();
      await settle(dom);
    });
    expect(reset).not.toHaveBeenCalled();
    expect(dom.window.document.activeElement).toBe(resetTrigger);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    await act(async () => {
      resetTrigger.click();
      await settle(dom);
    });
    dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    await act(async () => {
      buttonNamed(dialog, "Reset memory").click();
      await settle(dom);
    });
    expect(reset).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      expectedRevision: 8
    }));
    expect(container.textContent).toContain("Memory was reset. You can undo this from Activity.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("edits one memory with exact CAS while preserving the draft across stale, missing, and failed results", async () => {
    const dom = createDom();
    const originalSummary = memorySummary(4, "active");
    const staleSummary = memorySummaryWithText(
      5,
      "Server title",
      "The server changed this memory.",
    );
    const notFoundSummary = memoryEmptySummary(6);
    const committedSummary = memorySummaryWithText(
      7,
      "Local title",
      "Local body with exact wording.",
    );
    let attempt = 0;
    const edit = vi.fn(async (request: MemoryEditRequest): Promise<MemoryLifecycleMutationResult> => {
      attempt += 1;
      if (attempt === 1) {
        return {
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          status: "stale",
          summary: staleSummary,
        };
      }
      if (attempt === 2) {
        return {
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          status: "not_found",
          summary: notFoundSummary,
        };
      }
      if (attempt === 3) throw new Error("synthetic edit failure");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        status: "committed",
        operationId: "op_20260728_memoryedit",
        summary: committedSummary,
      };
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list: vi.fn(async () => originalSummary),
          disable: vi.fn(),
          edit,
          enable: vi.fn(),
          delete: vi.fn(),
          export: vi.fn(),
          reset: vi.fn(),
        },
      },
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(
        createElement(AgentMemorySettingsPanel, {
          activeVaultId: "vault_20260727_memoryfixture",
          t,
        }),
      );
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "Edit: Concise source summaries").click();
      await settle(dom);
    });
    const title = requireElement(
      container.querySelector<HTMLInputElement>("#memory-edit-title-memory_20260727_concisestyle"),
    );
    const body = requireElement(
      container.querySelector<HTMLTextAreaElement>("#memory-edit-body-memory_20260727_concisestyle"),
    );
    await act(async () => {
      inputValue(dom, title, "Local title");
      textareaValue(dom, body, "Local body with exact wording.");
      await settle(dom);
    });
    const composingEnter = new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Enter",
    });
    await act(async () => {
      title.dispatchEvent(composingEnter);
      await settle(dom);
    });
    expect(composingEnter.defaultPrevented).toBe(true);
    expect(edit).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 4,
      title: "Local title",
      body: "Local body with exact wording.",
    }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("5");
    expect(container.textContent).toContain("Memory changed. The latest list is shown and your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 5 }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("6");
    expect(container.textContent).toContain("That memory is no longer available. Your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 6 }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.textContent).toContain("The edit could not be saved. Your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[3]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 6 }));
    expect(container.querySelector("#memory-edit-title-memory_20260727_concisestyle")).toBeNull();
    expect(container.textContent).toContain("Local title");
    expect(container.textContent).toContain("Local body with exact wording.");
    expect(container.textContent).toContain("The memory was updated.");

    await act(async () => {
      buttonNamed(container, "Edit: Local title").click();
      await settle(dom);
      buttonNamed(container, "Cancel").click();
      await settle(dom);
    });
    expect(container.querySelector("#memory-edit-title-memory_20260727_concisestyle")).toBeNull();
    expect(container.textContent).toContain("Local title");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences an in-flight memory edit when the active vault changes", async () => {
    const dom = createDom();
    let resolveEdit!: (result: MemoryLifecycleMutationResult) => void;
    const list = vi.fn(async (request: MemoryListRequest): Promise<MemorySummary> => memorySummary(
      request.activeVaultId === "vault_20260727_memoryfixture" ? 4 : 20,
      "active",
      request.activeVaultId
    ));
    const edit = vi.fn((_request: MemoryEditRequest) => new Promise<MemoryLifecycleMutationResult>((resolve) => {
      resolveEdit = resolve;
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list,
          disable: vi.fn(),
          edit,
          enable: vi.fn(),
          delete: vi.fn(),
          export: vi.fn(),
          reset: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memoryfixture",
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "Edit: Concise source summaries").click();
      await settle(dom);
    });
    await act(async () => {
      const title = requireElement(container.querySelector<HTMLInputElement>("#memory-edit-title-memory_20260727_concisestyle"));
      inputValue(dom, title, "A fenced local title");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });

    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memorysecond",
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("20");

    await act(async () => {
      resolveEdit({
        apiVersion: 1,
        requestId: edit.mock.calls[0]?.[0].requestId,
        activeVaultId: "vault_20260727_memoryfixture",
        status: "committed",
        operationId: "op_20260727_memoryfenced",
        summary: memorySummaryWithText(10, "A fenced local title", "Old vault body")
      });
      await settle(dom);
    });
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("20");
    expect(container.textContent).not.toContain("A fenced local title");
    expect(container.textContent).not.toContain("The memory was updated.");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  return dom;
}

function installMatchMedia(dom: JSDOM, matches: boolean): void {
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches,
      media: "(max-width: 520px)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true
    })
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "")
      .replace(/\s+/g, "").trim() === name.replace(/\s+/g, ""));
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Required element not found.");
  return value;
}

function selectValue(dom: JSDOM, select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function inputValue(dom: JSDOM, input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function textareaValue(dom: JSDOM, input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function piPackageRegistry(
  revision: number,
  packages: PiPackageRegistrySummary["packages"] = []
): PiPackageRegistrySummary {
  return { apiVersion: 1, revision, packages };
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function skillRegistry(
  revision: number,
  enabled: boolean,
  invalidManifestCount = 0,
  skills: SkillRegistrySummary["skills"] = [{
    id: "review-notes",
    name: "Review notes",
    version: "1.2.0",
    description: "Summarizes the current source for review.",
    scope: "machine_local",
    kind: "pure",
    enabled,
    trust: "user_confirmed",
    capabilities: ["read_current_source"],
    dataBoundaries: ["local"],
    canEnable: !enabled,
    canUninstall: true,
    canExport: true,
    canUpdate: true
  }]
): SkillRegistrySummary {
  return { apiVersion: 1, revision, invalidManifestCount, skills };
}

function memorySummary(
  revision: number,
  status: "active" | "disabled",
  activeVaultId = "vault_20260727_memoryfixture"
): MemorySummary {
  return {
    apiVersion: 1,
    activeVaultId,
    revision,
    records: [{
      id: "memory_20260727_concisestyle",
      kind: "preference",
      title: "Concise source summaries",
      body: "Keep source summaries concise and preserve citations.",
      status,
      provenance: { kind: "explicit_user_request", occurredAt: "2026-07-27T08:00:00.000Z" },
      createdAt: "2026-07-27T08:00:00.000Z",
      updatedAt: status === "active" ? "2026-07-27T08:00:00.000Z" : "2026-07-27T09:00:00.000Z"
    }]
  };
}

function memoryEmptySummary(revision: number): MemorySummary {
  return {
    apiVersion: 1,
    activeVaultId: "vault_20260727_memoryfixture",
    revision,
    records: []
  };
}

function memorySummaryWithText(
  revision: number,
  title: string,
  body: string,
): MemorySummary {
  const current = memorySummary(revision, "active");
  return {
    ...current,
    records: current.records.map((record) => ({ ...record, title, body })),
  };
}

function semanticAssetStatus(
  revision: number,
  assetState: LocalSemanticRetrievalAssetState
): LocalSemanticRetrievalStatus {
  return {
    apiVersion: 1,
    revision,
    assetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
    assetState,
    downloadSizeBytes: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
    lexicalSearchRemainsAvailable: true,
    ...(assetState === "installing" || assetState === "verifying"
      ? { activeJobId: "job_20260727_semanticasset" }
      : {})
  };
}

function semanticAssetApi(assetState: LocalSemanticRetrievalAssetState): LocalSemanticRetrievalApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("Mutation is not used by this fixture.");
  };
  return {
    localSemanticStatus: async () => semanticAssetStatus(1, assetState),
    installLocalSemanticAsset: unavailable,
    enableLocalSemanticAsset: unavailable,
    disableLocalSemanticAsset: unavailable,
    removeLocalSemanticAsset: unavailable
  };
}

function paddleOcrSummary(revision: number, state: PaddleOcrLifecycleState): PaddleOcrSummary {
  const [canInstall, canEnable, canTest, canDisable, canRemove] = state === "not_installed"
    ? [true, false, false, false, false]
    : state === "ready"
      ? [false, false, true, true, true]
      : state === "disabled"
        ? [false, true, true, false, true]
        : state === "needs_repair"
          ? [false, false, false, false, true]
          : [false, false, false, false, false];
  return {
    apiVersion: 1,
    revision,
    engineId: "paddleocr_local",
    state,
    catalogVersion: "2026.07",
    components: [{
      componentId: "runtime",
      kind: "python_runtime",
      label: "Private Python /Users/private",
      version: "sha256:private",
      sizeBytes: 8 * 1024 * 1024
    }],
    downloadSizeBytes: 24 * 1024 * 1024,
    nativeOcrPreferred: true,
    hiddenDownloadsAllowed: false,
    canInstall,
    canEnable,
    canTest,
    canDisable,
    canRemove
  };
}

function paddleOcrApi(state: PaddleOcrLifecycleState): PaddleOcrApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("Mutation is not used by this fixture.");
  };
  return {
    paddleOcrSummary: async () => paddleOcrSummary(1, state),
    installPaddleOcr: unavailable,
    enablePaddleOcr: unavailable,
    testPaddleOcr: unavailable,
    disablePaddleOcr: unavailable,
    removePaddleOcr: unavailable
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
