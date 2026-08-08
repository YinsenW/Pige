import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsJobCard } from "../../apps/desktop/src/renderer/src/components/DiagnosticsWorkflowCards";

const globals = ["window", "document", "navigator", "Node", "HTMLElement"] as const;
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

describe("DiagnosticsJobCard", () => {
  it("exposes the existing job state and progress as an accessible action surface", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const noop = vi.fn();
    await act(async () => root.render(createElement(DiagnosticsJobCard, {
      job: {
        jobId: "diagjob_abcdefghijklmnopqrstuvwxyz123456",
        state: "running",
        progress: { completedUnits: 1, totalUnits: 3, percent: 37, messageKey: "bundle.running" },
        createdAt: "2026-08-08T12:00:00.000Z",
        updatedAt: "2026-08-08T12:01:00.000Z",
        canCancel: true,
        canRetry: false,
        canReveal: false,
        repairAction: "none"
      },
      busy: false,
      onCancel: noop,
      onRetry: noop,
      onReveal: noop,
      onChooseDestination: noop,
      t: (key: string) => key
    })));

    const card = dom.window.document.querySelector("[data-diagnostics-job-id]");
    expect(card?.querySelector("strong")?.textContent).toBe("system.supportJobState.running");
    const progress = card?.querySelector("[role=progressbar]");
    expect(progress?.getAttribute("aria-valuenow")).toBe("37");
    expect(progress?.getAttribute("aria-valuemin")).toBe("0");
    expect(progress?.getAttribute("aria-valuemax")).toBe("100");
    expect(card?.querySelector(".diagnostics-job-progress > span")?.getAttribute("style")).toContain("width: 37%");
    expect(card?.querySelector("code")?.textContent).toBe("diagjob_abcdefghijklmnopqrstuvwxyz123456");
    expect(card?.querySelector("button")?.textContent).toBe("maintenance.cancelSupportExport");
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}
