import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateManualDownloadRequest, UpdateManualDownloadResult } from "@pige/contracts";
import { ManualUpdateDownloadAction } from "../../apps/desktop/src/renderer/src/components/ManualUpdateDownloadAction";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent", "requestAnimationFrame", "crypto"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("manual update download action", () => {
  it("single-flights one exact request and restores its trigger after opening", async () => {
    let release!: (value: { apiVersion: 1; requestId: string; status: "opened" }) => void;
    const promise = new Promise<{ apiVersion: 1; requestId: string; status: "opened" }>((resolve) => { release = resolve; });
    const openManualDownload = vi.fn(async () => promise);
    const harness = await mount(openManualDownload);
    const trigger = harness.container.querySelector("button")!;
    trigger.focus();
    await act(async () => { trigger.click(); trigger.click(); await settle(harness.dom); });
    expect(openManualDownload).toHaveBeenCalledOnce();
    const request = openManualDownload.mock.calls[0]?.[0];
    expect(request).toMatchObject({ apiVersion: 1, requestId: expect.stringMatching(/^updatemanualreq_[a-z0-9]{16,64}$/u) });
    expect(trigger.disabled).toBe(true);
    await act(async () => { release({ ...request, status: "opened" }); await promise; await settle(harness.dom); await settle(harness.dom); });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("Opened");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("shows a body-free retryable failure and keeps the action available", async () => {
    const harness = await mount(vi.fn(async () => { throw new Error("private browser path"); }));
    const trigger = harness.container.querySelector("button")!;
    await act(async () => { trigger.click(); await settle(harness.dom); await settle(harness.dom); });
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe("Failed");
    expect(harness.container.textContent).not.toContain("private browser path");
    expect(trigger.disabled).toBe(false);
    await harness.unmount();
  });
});

async function mount(openManualDownload: (
  request: UpdateManualDownloadRequest
) => Promise<UpdateManualDownloadResult>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  installDom(dom); Object.defineProperty(dom.window, "pige", { configurable: true, value: { updates: { openManualDownload } } });
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => { root.render(createElement(ManualUpdateDownloadAction, { t: (key: string) => ({
    "system.manualDownload": "Manual updates", "system.manualDownloadDescription": "Description",
    "system.manualDownload.open": "Open downloads", "system.manualDownload.opening": "Opening",
    "system.manualDownload.opened": "Opened", "system.manualDownload.failed": "Failed"
  }[key] ?? key) })); await settle(dom); });
  return { dom, container: dom.window.document.querySelector("#root")!, unmount: async () => {
    await act(async () => root.unmount()); dom.window.close();
  } };
}

async function settle(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "requestAnimationFrame" ? (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
      : key === "crypto" ? { randomUUID: () => "12345678-1234-1234-1234-123456789abc" } : dom.window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
