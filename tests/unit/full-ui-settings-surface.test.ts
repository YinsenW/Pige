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
  LocalCapabilitiesSettingsPanel,
  PiPackagesSettingsPanel,
  PermissionsPrivacySettingsPanel,
  SettingsSurface,
  SkillsSettingsPanel,
  SystemSettingsPanel,
  type DevelopmentCapability,
  type SettingsSection
} from "../../apps/desktop/src/renderer/src/App";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import type {
  PermissionPrepareYoloEnableResult,
  PermissionSettingsSummary,
  SpeechAvailabilityResult
} from "@pige/contracts";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLSelectElement", "Event", "KeyboardEvent", "MouseEvent"] as const;
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
    const trigger = buttonNamed(dialog, "Settings sections");
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(content.hasAttribute("inert")).toBe(false);
    expect(dom.window.document.activeElement).toBe(trigger);

    const pageControl = buttonNamed(content, "Page control");
    await act(async () => {
      trigger.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(pageControl);
    await act(async () => {
      pageControl.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(trigger);

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

  it("renders the complete Skills shell without inventing installed Skills or service work", async () => {
    const dom = createDom();
    const onDevelopment = vi.fn();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("Skills development actions must not access IPC.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { onDevelopment, t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-skills")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-skills-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(page.textContent).toContain("Skill inventory unavailable");
    expect(page.textContent).toContain("Nothing has been read or changed yet");
    expect(page.textContent).toContain("Source, files, and warnings stay visible");
    expect(page.querySelector('[role="switch"]')).toBeNull();
    expect(page.querySelector("[data-skill-id]")).toBeNull();

    await act(async () => {
      buttonNamed(page, "Install from link").click();
      buttonNamed(page, "Choose Markdown or ZIP").click();
      await settle(dom);
    });
    expect(onDevelopment).toHaveBeenCalledTimes(2);
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders the complete Pi Packages shell without inventing registry data or service work", async () => {
    const dom = createDom();
    const onDevelopment = vi.fn();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("Pi Packages development actions must not access IPC.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { onDevelopment, t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-packages")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-packages-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(page.textContent).toContain("Package registry unavailable");
    expect(page.textContent).toContain("Identity and trust stay visible");
    expect(page.textContent).toContain("Capabilities and data boundary are reviewed");
    expect(page.textContent).toContain("Lifecycle remains reversible");
    expect(page.textContent).not.toContain("pi-obsidian-vault");
    expect(page.querySelector("[data-package-id]")).toBeNull();

    await act(async () => {
      buttonNamed(page, "Install from source...").click();
      buttonNamed(page, "Search Pi Catalog...").click();
      await settle(dom);
    });
    expect(onDevelopment).toHaveBeenCalledTimes(2);
    expect(ipcRead).toBe(false);

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

  it("keeps Updates separate and unavailable without reading diagnostics", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("Updates must stay local until Update Service exists.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "updates",
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
    expect(buttonNamed(panel, "Temporarily unavailable. Nothing was changed.").disabled).toBe(true);
    await act(async () => {
      buttonNamed(panel, "Check for updates").click();
      await settle(dom);
    });
    expect(panel.textContent).toContain("Update Service is in development");
    expect(ipcRead).toBe(false);
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

  it("binds permission mode and saved grants through revision-fenced settings IPC", async () => {
    const dom = createDom();
    const grantId = "permgrant_20260718_abcdefgh";
    const initial = permissionSettings(4, {
      savedGrants: [{
        grantId,
        actorType: "local_tool",
        actorDisplayName: "Local file reader",
        capability: "external_filesystem",
        resourceScope: "current_folder",
        resourceKind: "folder",
        decisionScope: "resource_scope",
        createdAt: "2026-07-18T01:00:00.000Z"
      }]
    });
    const changed = permissionSettings(5, {
      defaultMode: "remember_scoped_grants",
      savedGrants: initial.savedGrants
    });
    const revoked = permissionSettings(6, { defaultMode: "remember_scoped_grants" });
    const current = vi.fn(async () => initial);
    const setDefaultMode = vi.fn(async () => ({ status: "committed" as const, settings: changed }));
    const revokeGrant = vi.fn(async () => ({ status: "committed" as const, settings: revoked }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        permissions: { settings: {
          current,
          setDefaultMode,
          prepareYoloEnable: vi.fn(),
          enableYolo: vi.fn(),
          disableYolo: vi.fn(),
          revokeGrant,
          revokeAllGrants: vi.fn()
        } }
      }
    });
    const onDevelopment = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { onDevelopment, t }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Permissions & Privacy");
    expect(container.textContent).toContain("Ordinary selected context for connected services");
    expect(container.textContent).toContain("Protected");
    expect(container.textContent).toContain("Credential protection and permission settings are active");
    expect(container.textContent).not.toContain("Allowed");
    expect(container.textContent).toContain("YOLO full accessEligible local tools may proceed automatically");

    expect(container.querySelector('select[aria-label="Cloud-send policy"]')).toBeNull();
    const defaultMode = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="Default mode"]'));
    expect(defaultMode.value).toBe("ask_every_time");
    expect(defaultMode.disabled).toBe(false);
    expect(container.querySelector('button[role="switch"][aria-label="Hide obvious secrets before sending"]')).toBeNull();
    const controls = Array.from(container.querySelectorAll<HTMLElement>("[data-privacy-control]"));
    expect(controls.map((control) => control.dataset.privacyControl)).toEqual([
      "ordinary-policy",
      "cloud-policy",
      "redaction-policy",
      "default-mode",
      "saved-grants",
      "yolo"
    ]);

    await act(async () => {
      selectValue(dom, defaultMode, "remember_scoped_grants");
      await settle(dom);
    });
    expect(setDefaultMode).toHaveBeenCalledWith({
      apiVersion: 1,
      expectedRevision: 4,
      defaultMode: "remember_scoped_grants"
    });
    expect(defaultMode.value).toBe("remember_scoped_grants");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Permission settings updated.");

    await act(async () => {
      buttonNamed(container, "Review...").click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Local file reader");
    expect(container.textContent).toContain("Folder access");
    expect(container.textContent).not.toContain(grantId);

    await act(async () => {
      buttonNamed(container, "Revoke: Local file reader").click();
      await settle(dom);
    });
    expect(revokeGrant).toHaveBeenCalledWith({ apiVersion: 1, expectedRevision: 5, grantId });
    expect(container.textContent).toContain("No saved scoped grants");
    expect(current).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("serializes the explicit YOLO confirmation token flow and supports disable and revoke-all", async () => {
    const dom = createDom();
    const grants = ["abcdefgh", "ijklmnop"].map((suffix, index) => ({
      grantId: `permgrant_20260718_${suffix}`,
      actorType: "local_tool" as const,
      actorDisplayName: `Tool ${index + 1}`,
      capability: "external_network" as const,
      resourceScope: "current_domain" as const,
      resourceKind: "network" as const,
      decisionScope: "resource_scope" as const,
      createdAt: "2026-07-18T01:00:00.000Z"
    }));
    const initial = permissionSettings(8, { defaultMode: "remember_scoped_grants", savedGrants: grants });
    const enabled = permissionSettings(9, {
      defaultMode: "yolo_full_access",
      yoloEnabled: true,
      savedGrants: grants
    });
    const disabled = permissionSettings(10, { defaultMode: "remember_scoped_grants", savedGrants: grants });
    const cleared = permissionSettings(11, { defaultMode: "remember_scoped_grants" });
    let resolvePreparation!: (result: PermissionPrepareYoloEnableResult) => void;
    const preparation = new Promise<PermissionPrepareYoloEnableResult>((resolve) => {
      resolvePreparation = resolve;
    });
    const prepareYoloEnable = vi.fn(() => preparation);
    const enableYolo = vi.fn(async () => ({ status: "committed" as const, settings: enabled }));
    const disableYolo = vi.fn(async () => ({ status: "committed" as const, settings: disabled }));
    const revokeAllGrants = vi.fn(async () => ({ status: "committed" as const, settings: cleared }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        permissions: { settings: {
          current: vi.fn(async () => initial),
          setDefaultMode: vi.fn(),
          prepareYoloEnable,
          enableYolo,
          disableYolo,
          revokeGrant: vi.fn(),
          revokeAllGrants
        } }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { onDevelopment: vi.fn(), t }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const enable = buttonNamed(container, "Enable…");

    await act(async () => {
      enable.click();
      enable.click();
      await settle(dom);
    });
    expect(prepareYoloEnable).toHaveBeenCalledOnce();
    expect(prepareYoloEnable).toHaveBeenCalledWith({ apiVersion: 1, expectedRevision: 8 });

    await act(async () => {
      resolvePreparation({
        status: "confirmation_ready",
        revision: 8,
        confirmationToken: "permyolo_20260718_abcdefghijklmnop",
        expiresAt: "2026-07-18T01:05:00.000Z"
      });
      await settle(dom);
    });
    expect(enableYolo).toHaveBeenCalledWith({
      apiVersion: 1,
      expectedRevision: 8,
      confirmationToken: "permyolo_20260718_abcdefghijklmnop"
    });
    expect(buttonNamed(container, "Disable")).not.toBeNull();
    expect(requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="Default mode"]')).value)
      .toBe("yolo_full_access");

    await act(async () => {
      buttonNamed(container, "Disable").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Review...").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Revoke all").click();
      await settle(dom);
    });
    expect(disableYolo).toHaveBeenCalledWith({ apiVersion: 1, expectedRevision: 9 });
    expect(revokeAllGrants).toHaveBeenCalledWith({ apiVersion: 1, expectedRevision: 10 });
    expect(container.textContent).toContain("No saved scoped grants");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("refreshes stale permission revisions and keeps thrown error bodies out of Settings", async () => {
    const dom = createDom();
    const initial = permissionSettings(20, { defaultMode: "remember_scoped_grants" });
    const latest = permissionSettings(21);
    const setDefaultMode = vi.fn()
      .mockResolvedValueOnce({ status: "stale", settings: latest })
      .mockRejectedValueOnce(new Error("raw /Users/private/.ssh/id_ed25519 permission body"));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        permissions: { settings: {
          current: vi.fn(async () => initial),
          setDefaultMode,
          prepareYoloEnable: vi.fn(),
          enableYolo: vi.fn(),
          disableYolo: vi.fn(),
          revokeGrant: vi.fn(),
          revokeAllGrants: vi.fn()
        } }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { onDevelopment: vi.fn(), t }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const defaultMode = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="Default mode"]'));

    await act(async () => {
      selectValue(dom, defaultMode, "ask_every_time");
      await settle(dom);
    });
    expect(defaultMode.value).toBe("ask_every_time");
    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe("Permission settings changed elsewhere. The latest state is shown.");

    await act(async () => {
      selectValue(dom, defaultMode, "remember_scoped_grants");
      await settle(dom);
    });
    expect(setDefaultMode).toHaveBeenLastCalledWith({
      apiVersion: 1,
      expectedRevision: 21,
      defaultMode: "remember_scoped_grants"
    });
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Permission settings could not be updated.");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("id_ed25519");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds app language while keeping unfinished appearance choices honest and accessible", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The Appearance panel must use only its provided adapters.");
      }
    });
    const onLocaleChange = vi.fn(async () => undefined);
    const onDevelopment = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AppearanceSettingsPanel, {
        locale: "en",
        availableLocales: ["en", "fr", "de"],
        onLocaleChange,
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
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
    expect(themes.map((theme) => theme.tabIndex)).toEqual([0, -1, -1]);

    await act(async () => {
      themes[2]!.click();
      themes[0]!.focus();
      themes[0]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(themes[1]);
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);

    const appLanguage = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="App language"]'));
    const knowledgeLanguage = requireElement(container.querySelector<HTMLButtonElement>('[data-appearance-control="knowledge-language"]'));
    const ocrLanguage = requireElement(container.querySelector<HTMLButtonElement>('[data-appearance-control="ocr-language"]'));
    expect(knowledgeLanguage.textContent).toBe("In development");
    expect(ocrLanguage.textContent).toBe("In development");
    expect(container.querySelector('select[aria-label="Knowledge language"]')).toBeNull();
    expect(container.querySelector('select[aria-label="OCR language hint"]')).toBeNull();
    await act(async () => {
      selectValue(dom, appLanguage, "fr");
      knowledgeLanguage.click();
      ocrLanguage.click();
      await settle(dom);
    });
    expect(onLocaleChange).toHaveBeenCalledWith("fr");
    expect(onDevelopment).toHaveBeenCalledTimes(4);
    expect(knowledgeLanguage.textContent).toBe("In development");
    expect(ocrLanguage.textContent).toBe("In development");
    expect(ipcRead).toBe(false);

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
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
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
    expect(container.textContent).toContain("Not reported");

    const ocrEngine = requireElement(container.querySelector<HTMLButtonElement>('[data-capability-control="ocr-engine"]'));
    const imageOcr = requireElement(container.querySelector<HTMLButtonElement>('[data-capability-control="image-ocr"]'));
    const voice = requireElement(container.querySelector<HTMLElement>('[data-capability-status="voice-input"]'));
    expect(ocrEngine.textContent).toBe("In development");
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
      buttonNamed(container, "Manage").click();
      ocrEngine.click();
      imageOcr.click();
      await settle(dom);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onDevelopment).toHaveBeenCalledTimes(4);
    expect(ocrEngine.textContent).toBe("In development");
    expect(imageOcr.textContent).toBe("In development");
    expect(voice.textContent).toBe("Language resource needed");
    expect(ipcRead).toBe(false);

    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
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
    expect(onDevelopment).toHaveBeenCalledTimes(4);
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

  it("projects real speech availability without requesting permission and opens system settings only after denial", async () => {
    const dom = createDom();
    const onOpenSpeechSettings = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderPanel = async (speechAvailability: SpeechAvailabilityResult): Promise<void> => {
      await act(async () => {
        root.render(createElement(LocalCapabilitiesSettingsPanel, {
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

  it("renders the complete memory surface without fabricating records or accessing an absent service", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The development memory surface must not access IPC.");
      }
    });
    const onDevelopment = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, { onDevelopment, t }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Agent & Memory");
    expect(container.textContent).toContain("PIGE.md");
    expect(container.textContent).toContain("Memory management is in development");
    expect(container.textContent).toContain(
      "Existing vault-scoped memory stays local and is included in backups by default. Management controls remain unavailable until the Agent Memory owner is connected."
    );
    expect(container.textContent).not.toContain("12 active memories");
    expect(container.textContent).not.toContain("Prefers concise source summaries");

    expect(container.querySelector('select[aria-label="High-impact changes"]')).toBeNull();
    expect(container.querySelector('button[role="switch"][aria-label="Vault memory"]')).toBeNull();
    expect(container.querySelector('button[role="checkbox"]')).toBeNull();
    expect(container.textContent).not.toContain("Always confirm");
    const controls = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-memory-control]"));
    expect(controls.map((control) => control.dataset.memoryControl)).toEqual([
      "pige-policy",
      "high-impact-policy",
      "vault-memory"
    ]);
    expect(controls.every((control) => control.textContent === "In development")).toBe(true);
    const scopes = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-memory-scope]"));
    expect(scopes).toHaveLength(4);
    expect(scopes.every((scope) => scope.textContent?.includes("In development"))).toBe(true);

    const reset = buttonNamed(container, "Reset memory...");
    expect(reset.disabled).toBe(true);
    expect(reset.title).toContain("unavailable");

    await act(async () => {
      for (const control of controls) control.click();
      for (const scope of scopes) scope.click();
      buttonNamed(container, "Inspect memory").click();
      buttonNamed(container, "Export").click();
      await settle(dom);
    });
    expect(onDevelopment).toHaveBeenCalledTimes(9);
    expect(controls.every((control) => control.textContent === "In development")).toBe(true);
    expect(scopes.every((scope) => scope.textContent?.includes("In development"))).toBe(true);
    expect(ipcRead).toBe(false);

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

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function permissionSettings(
  revision: number,
  overrides: Partial<PermissionSettingsSummary> = {}
): PermissionSettingsSummary {
  return {
    apiVersion: 1,
    revision,
    defaultMode: "ask_every_time",
    yoloEnabled: false,
    savedGrants: [],
    ...overrides
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
