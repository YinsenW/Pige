import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagnosticsHealth } from "@pige/contracts";
import { DiagnosticsHealthChecks } from "../../apps/desktop/src/renderer/src/components/DiagnosticsHealthChecks";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement"] as const;
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

describe("DiagnosticsHealthChecks", () => {
  it("reveals safe check status and messages without exposing unrelated detail", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://pige.test" });
    installDom(dom);
    const health: DiagnosticsHealth = {
      status: "degraded",
      checkedAt: "2026-08-08T00:00:00.000Z",
      localOnly: true,
      recentErrorCount: 1,
      checks: [
        { id: "diagnostics_store", status: "ok", message: "PRIVATE RAW STORE MESSAGE" },
        { id: "redaction", status: "error", message: "/Users/private/raw-redaction-detail" }
      ]
    };
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => root.render(createElement(DiagnosticsHealthChecks, { health, t: (key) => key })));

    const disclosure = container.querySelector<HTMLDetailsElement>("[data-diagnostics-health-checks]")!;
    expect(disclosure.textContent).toContain("system.healthChecksSummary 2");
    expect(disclosure.querySelectorAll("[data-health-check-status]")).toHaveLength(2);
    expect(disclosure.querySelector('[data-health-check-status="error"]')?.textContent)
      .toContain("system.healthCheckUnknown");
    expect(disclosure.textContent).toContain("system.healthCheck.diagnosticsStore.ok");
    expect(disclosure.textContent).not.toContain("PRIVATE RAW STORE MESSAGE");
    expect(disclosure.textContent).not.toContain("/Users/private/raw-redaction-detail");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not render a stale empty panel before health is loaded", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://pige.test" });
    installDom(dom);
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => root.render(createElement(DiagnosticsHealthChecks, { health: null, t: (key) => key })));
    expect(container.querySelector("[data-diagnostics-health-checks]")).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key], writable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
