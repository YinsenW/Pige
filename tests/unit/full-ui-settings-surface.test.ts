import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsSurface,
  SkillsSettingsPanel,
  SystemSettingsPanel,
  type DevelopmentCapability,
  type SettingsSection
} from "../../apps/desktop/src/renderer/src/App";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "KeyboardEvent", "MouseEvent"] as const;
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
      buttonNamed(dialog, "AppearanceIn development").click();
      await settle(dom);
    });
    const status = dialog.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toContain("In development");
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
    expect(page.textContent).toContain("No Skills installed");
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

  it("keeps Updates local while binding real redacted diagnostics and support preview", async () => {
    const dom = createDom();
    const refreshDiagnostics = vi.fn(async () => undefined);
    const previewSupportBundle = vi.fn(async () => ({
      previewId: "support_preview",
      generatedAt: "2026-07-16T00:00:00.000Z",
      localOnly: true as const,
      estimatedBytes: 2048,
      includedCategories: [{ id: "health", label: "/private/raw-label", included: true, reason: "private body" }],
      excludedCategories: [{ id: "content", label: "RAW CONTENT", included: false, reason: "excluded" }],
      privacyWarnings: ["review before export"]
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
    expect(panel.querySelector<HTMLSelectElement>('select[aria-label="Update channel"]')?.disabled).toBe(true);
    expect(buttonNamed(panel, "Clear…").disabled).toBe(true);

    await act(async () => {
      buttonNamed(panel, "Check for updates").click();
      await settle(dom);
    });
    expect(panel.textContent).toContain("Update Service is in development");
    expect(previewSupportBundle).not.toHaveBeenCalled();

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
    expect(panel.textContent).toContain("Included: 1");
    expect(panel.textContent).not.toContain("/private/raw-label");
    expect(panel.textContent).not.toContain("RAW CONTENT");

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

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "")
      .replace(/\s+/g, "").trim() === name.replace(/\s+/g, ""));
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
