import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsRecentErrorsResult } from "@pige/contracts";
import { DiagnosticsRecentErrorsCard } from "../../apps/desktop/src/renderer/src/components/DiagnosticsRecentErrorsCard";
import { DiagnosticsRecentErrorsPanel } from "../../apps/desktop/src/renderer/src/components/DiagnosticsRecentErrorsPanel";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("DiagnosticsRecentErrorsCard", () => {
  it("discloses only safe error facts and seeds the support workflow", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const onPrepareSupport = vi.fn();
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsCard, {
      result: recentErrors(), failed: false, onPrepareSupport, t: (key: string) => key
    })));
    const card = dom.window.document.querySelector("[data-diagnostics-recent-errors]");
    expect(card?.classList.contains("diagnostics-recent-errors-card")).toBe(true);
    expect(card?.getAttribute("aria-labelledby")).toBe("recent-errors-title");
    expect(card?.getAttribute("aria-describedby")).toBe("recent-errors-description");
    expect(dom.window.document.querySelectorAll("details")).toHaveLength(1);
    expect(dom.window.document.querySelector(".diagnostics-recent-error-heading strong")?.textContent).toBe("provider.failure");
    expect(dom.window.document.querySelector("time")?.getAttribute("dateTime")).toBe("2026-08-08T11:00:00.000Z");
    expect(dom.window.document.body.textContent).toContain("provider.failure");
    expect(dom.window.document.body.textContent).not.toContain("/Users/alice");
    const prepareButton = dom.window.document.querySelector("button.settings-button.primary") as HTMLButtonElement;
    expect(prepareButton.textContent).toContain("system.prepareSupportFromErrors");
    prepareButton.click();
    expect(onPrepareSupport).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("gives the empty state its own status surface without inventing an action", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsCard, {
      result: { ...recentErrors(), errors: [] }, failed: false, onPrepareSupport: vi.fn(), t: (key: string) => key
    })));
    expect(dom.window.document.querySelector(".diagnostics-recent-errors-empty")?.getAttribute("role")).toBe("status");
    expect(dom.window.document.querySelectorAll("details")).toHaveLength(0);
    expect(dom.window.document.querySelectorAll("button")).toHaveLength(0);
    expect(dom.window.document.body.textContent).toContain("system.noRecentErrors");
    await act(async () => root.unmount());
  });

  it("keeps query failure user-visible without exposing a path or retry authority", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsCard, {
      result: null, failed: true, onPrepareSupport: vi.fn(), t: (key: string) => key
    })));
    const failure = dom.window.document.querySelector("[role=alert]");
    expect(failure?.classList.contains("diagnostics-recent-errors-card-failed")).toBe(true);
    expect(failure?.querySelector("[role=status]")?.textContent).toContain("system.recentErrorsUnavailable");
    expect(failure?.textContent).toContain("system.recentErrorsUnavailable");
    await act(async () => root.unmount());
  });

  it("retains the last safe error projection when a refresh fails", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsCard, {
      result: recentErrors(), failed: true, onPrepareSupport: vi.fn(), t: (key: string) => key
    })));
    expect(dom.window.document.querySelectorAll("details")).toHaveLength(1);
    expect(dom.window.document.querySelector("[role=alert]")?.textContent)
      .toContain("system.recentErrorsUnavailable");
    expect(dom.window.document.body.textContent).toContain("provider.failure");
    await act(async () => root.unmount());
  });

  it("retains the last safe projection when the panel refresh interval fails", async () => {
    const dom = installDom();
    let calls = 0;
    const recentErrorsQuery = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return recentErrors();
      throw new Error("/Users/alice/private-diagnostics.json");
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { diagnostics: { recentErrors: recentErrorsQuery } }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(DiagnosticsRecentErrorsPanel, {
        onPrepareSupport: vi.fn(),
        t: (key: string) => key
      }));
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
    });
    expect(dom.window.document.body.textContent).toContain("provider.failure");
    await act(async () => {
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 650));
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(dom.window.document.body.textContent).toContain("provider.failure");
    expect(dom.window.document.body.textContent).not.toContain("/Users/alice/private-diagnostics.json");
    expect(dom.window.document.querySelector("[role=alert]")?.textContent)
      .toContain("system.recentErrorsUnavailable");
    await act(async () => root.unmount());
  });
});

function recentErrors(): DiagnosticsRecentErrorsResult {
  return {
    apiVersion: 1,
    requestId: "diagrecentreq_abcdefghijklmnop",
    checkedAt: "2026-08-08T12:00:00.000Z",
    localOnly: true,
    eventSelectionRevision: `diagevents_${"a".repeat(64)}`,
    errors: [{
      eventId: `diagevent_${"b".repeat(32)}`,
      recordedAt: "2026-08-08T11:00:00.000Z",
      level: "error",
      code: "provider.failure",
      message: "Provider request failed.",
      redactedDetailCount: 2,
      redactedDetails: { providerId: "provider_openai", redactedPrivateCount: 1 }
    }]
  };
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}
