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
    expect(dom.window.document.querySelectorAll("details")).toHaveLength(1);
    expect(dom.window.document.body.textContent).toContain("provider.failure");
    expect(dom.window.document.body.textContent).not.toContain("/Users/alice");
    (dom.window.document.querySelector("button") as HTMLButtonElement).click();
    expect(onPrepareSupport).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("keeps query failure user-visible without exposing a path or retry authority", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsCard, {
      result: null, failed: true, onPrepareSupport: vi.fn(), t: (key: string) => key
    })));
    expect(dom.window.document.querySelector("[role=alert]")?.textContent).toContain("system.recentErrorsUnavailable");
    await act(async () => root.unmount());
  });

  it("keeps periodic refresh one-flight and ignores an echoed request mismatch", async () => {
    const dom = installDom();
    const pending = new Promise<DiagnosticsRecentErrorsResult>((resolve) => {
      resolveFirst = resolve;
    });
    const recentErrorsApi = vi.fn((request: { readonly requestId: string }) =>
      Promise.resolve(recentErrorsResult(request.requestId))
    );
    recentErrorsApi.mockImplementationOnce(() => pending);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { diagnostics: { recentErrors: recentErrorsApi } }
    });
    const intervalCallbacks: Array<() => void> = [];
    vi.stubGlobal("setInterval", (callback: () => void) => {
      intervalCallbacks.push(callback);
      return 1;
    });
    vi.stubGlobal("clearInterval", vi.fn());
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => root.render(createElement(DiagnosticsRecentErrorsPanel, {
      onPrepareSupport: vi.fn(), t: (key: string) => key
    })));
    expect(recentErrorsApi).toHaveBeenCalledOnce();
    intervalCallbacks[0]?.();
    intervalCallbacks[0]?.();
    expect(recentErrorsApi).toHaveBeenCalledOnce();

    resolveFirst(recentErrorsResult("diagrecentreq_wrongrequestid"));
    await act(async () => await pending);
    expect(dom.window.document.body.textContent).toContain("system.noRecentErrors");
    intervalCallbacks[0]?.();
    await act(async () => await Promise.resolve());
    expect(recentErrorsApi).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

let resolveFirst: (result: DiagnosticsRecentErrorsResult) => void = () => undefined;

function recentErrors(): DiagnosticsRecentErrorsResult {
  return recentErrorsResult("diagrecentreq_abcdefghijklmnop");
}

function recentErrorsResult(requestId: string): DiagnosticsRecentErrorsResult {
  return {
    apiVersion: 1,
    requestId,
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
