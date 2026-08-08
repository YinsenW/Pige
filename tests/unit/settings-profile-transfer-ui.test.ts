import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { SettingsProfileTransferPanel } from "../../apps/desktop/src/renderer/src/components/SettingsProfileTransferPanel";

describe("SettingsProfileTransferPanel", () => {
  it("exposes only the bounded export and reviewed import workflow", () => {
    const markup = renderToStaticMarkup(createElement(SettingsProfileTransferPanel, {
      api: {
        exportProfile: vi.fn(),
        previewImport: vi.fn(),
        applyImport: vi.fn()
      },
      t: (key: string) => ({
        "settings.general.profileTransferTitle": "Preferences backup",
        "settings.general.profileTransferExportTitle": "Export preferences",
        "settings.general.profileTransferDescription": "Portable preferences",
        "settings.general.profileTransferExport": "Export",
        "settings.general.profileTransferImportTitle": "Import preferences",
        "settings.general.profileTransferExclusions": "No vaults, credentials, permissions, recent items, or window state",
        "settings.general.profileTransferImport": "Choose file"
      })[key] ?? key
    }));
    expect(markup).toContain("Preferences backup");
    expect(markup).toContain("Export preferences");
    expect(markup).toContain("Choose file");
    expect(markup).toContain("No vaults, credentials, permissions");
    expect(markup).not.toContain("input type=\"file\"");
    expect(markup).not.toContain("provider");
  });

  it("shows exact safe before/after values, handles current profiles, and restores focus after cancel", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
      pretendToBeVisual: true,
      url: "http://pige.test"
    });
    const originals = installDom(dom);
    const api = {
      exportProfile: vi.fn(),
      previewImport: vi.fn(async () => ({
        apiVersion: 1 as const,
        requestId: "settingsprofilereq_0123456789abcdef0123456789abcdef",
        status: "ready" as const,
        previewId: "settingspreview_0123456789abcdef0123456789abcdef",
        changes: [
          { key: "app_locale" as const, before: "en" as const, after: "fr" as const },
          {
            key: "appearance" as const,
            before: { themePreference: "dark" as const, generatedKnowledgeLanguage: "follow_query" as const },
            after: { themePreference: "light" as const, generatedKnowledgeLanguage: "app_locale" as const }
          }
        ]
      })),
      applyImport: vi.fn()
    };
    const labels: Record<string, string> = {
      "settings.general.profileTransferTitle": "Preferences backup",
      "settings.general.profileTransferExportTitle": "Export preferences",
      "settings.general.profileTransferDescription": "Portable preferences",
      "settings.general.profileTransferExport": "Export",
      "settings.general.profileTransferImportTitle": "Import preferences",
      "settings.general.profileTransferExclusions": "Safe preferences only",
      "settings.general.profileTransferImport": "Choose file",
      "settings.general.profileTransferApply": "Import",
      "settings.general.profileTransferCancel": "Cancel",
      "settings.general.profileTransferPreviewReady": "Review changes",
      "settings.general.profileTransferChanges": "Preference changes",
      "settings.general.profileTransferKey.app_locale": "App language",
      "settings.general.profileTransferKey.appearance": "Appearance",
      "appearance.theme.dark": "Dark",
      "appearance.theme.light": "Light",
      "appearance.knowledgeLanguage.followQuery": "Follow question",
      "appearance.knowledgeLanguage.appLocale": "App language"
    };
    const container = dom.window.document.querySelector("#root")!;
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(SettingsProfileTransferPanel, {
        api,
        t: (key: string) => labels[key] ?? key
      })));
      const choose = findButton(container, "Choose file");
      await act(async () => { choose.click(); await Promise.resolve(); });
      expect(container.querySelector("dl")?.textContent).toContain("App languageen → fr");
      expect(container.querySelector("dl")?.textContent).toContain("Dark · Follow question → Light · App language");
      await act(async () => {
        findButton(container, "Cancel").click();
        await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
      });
      expect(dom.window.document.activeElement).toBe(choose);

      api.previewImport.mockResolvedValueOnce({
        apiVersion: 1,
        requestId: "settingsprofilereq_0123456789abcdef0123456789abcdef",
        status: "ready",
        previewId: "settingspreview_0123456789abcdef0123456789abcdef",
        changes: [{ key: "app_locale", before: "en", after: "fr" }]
      });
      api.applyImport.mockResolvedValueOnce({
        apiVersion: 1,
        requestId: "settingsprofilereq_0123456789abcdef0123456789abcdef",
        previewId: "settingspreview_0123456789abcdef0123456789abcdef",
        status: "committed",
        keys: ["app_locale"]
      });
      await act(async () => { choose.click(); await Promise.resolve(); });
      const apply = findButton(container, "Import");
      expect(container.querySelector(".settings-card")?.getAttribute("aria-busy")).toBe("false");
      await act(async () => {
        apply.click();
        await Promise.resolve();
        await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
      });
      const restoredChoose = findButton(container, "Choose file");
      expect(dom.window.document.activeElement).toBe(restoredChoose);

      api.previewImport.mockResolvedValueOnce({
        apiVersion: 1,
        requestId: "settingsprofilereq_0123456789abcdef0123456789abcdef",
        status: "current"
      });
      await act(async () => { choose.click(); await Promise.resolve(); });
      expect(container.textContent).toContain("settings.general.profileTransferCurrent");
      expect(container.querySelector("dl")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      restoreDom(originals);
      dom.window.close();
    }
  });
});

const domKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"
] as const;

function installDom(dom: JSDOM): Map<PropertyKey, PropertyDescriptor | undefined> {
  const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const source = dom.window as unknown as Record<string, unknown>;
  for (const key of domKeys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return originals;
}

function restoreDom(originals: Map<PropertyKey, PropertyDescriptor | undefined>): void {
  for (const key of domKeys) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
}

function findButton(container: Element, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}
