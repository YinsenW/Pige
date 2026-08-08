import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationCaptureReferences } from "../../apps/desktop/src/renderer/src/components/ConversationCaptureReferences";

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

describe("ConversationCaptureReferences", () => {
  it("shows safe durable evidence and opens only a reference with a page identity", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    for (const key of globalKeys) {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
    }
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(0), 0)
    });
    const open = vi.fn();
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root.render(createElement(ConversationCaptureReferences, {
      references: [
        { eventId: "evt_20260801_captureref01", sourceId: "src_20260801_captureref01",
          captureId: "cap_20260801_captureref01", jobId: "job_20260801_captureref01",
          displayName: "Evidence.md", sourceKind: "markdown_file", pageId: "page_20260801_captureref01" },
        { eventId: "evt_20260801_captureref02", sourceId: "src_20260801_captureref02",
          captureId: "cap_20260801_captureref02", jobId: "job_20260801_captureref01",
          displayName: "Pasted text", sourceKind: "text" }
      ],
      onOpen: open,
      t: (key: string) => key
    })));
    expect(dom.window.document.body.textContent).toContain("Evidence.md");
    expect(dom.window.document.body.textContent).toContain("Pasted text");
    const buttons = dom.window.document.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    await act(async () => { buttons[0]!.click(); await settle(dom); });
    expect(open).toHaveBeenCalledWith("page_20260801_captureref01");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps captured evidence and blocks duplicate opens while a page request fails, then restores focus for retry", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    for (const key of globalKeys) {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
    }
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(0), 0)
    });
    const open = vi.fn()
      .mockRejectedValueOnce(new Error("reader unavailable"))
      .mockResolvedValueOnce(undefined);
    const root = createRoot(dom.window.document.getElementById("root")!);
    const references = [{
      eventId: "evt_20260801_captureref01", sourceId: "src_20260801_captureref01",
      captureId: "cap_20260801_captureref01", jobId: "job_20260801_captureref01",
      displayName: "Evidence.md", sourceKind: "markdown_file" as const, pageId: "page_20260801_captureref01"
    }];
    await act(async () => root.render(createElement(ConversationCaptureReferences, {
      references,
      onOpen: open,
      t: (key: string) => ({
        "home.attachedFiles": "Attached files", "activity.open": "Open", "note.opening": "Opening",
        "error.generic": "Could not open this note."
      }[key] ?? key)
    })));
    const button = dom.window.document.querySelector<HTMLButtonElement>("button")!;
    button.focus();
    await act(async () => {
      button.click();
      button.click();
      await settle(dom);
      await settle(dom);
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(dom.window.document.body.textContent).toContain("Could not open this note.");
    expect(dom.window.document.activeElement).toBe(button);
    await act(async () => { button.click(); await settle(dom); await settle(dom); });
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("ignores a late open completion after the captured evidence owner changes", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
    for (const key of globalKeys) {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
    }
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(0), 0)
    });
    let resolveOpen!: () => void;
    const open = vi.fn(() => new Promise<void>((resolve) => { resolveOpen = resolve; }));
    const root = createRoot(dom.window.document.getElementById("root")!);
    const oldReferences = [{
      eventId: "evt_20260801_captureref01", sourceId: "src_20260801_captureref01",
      captureId: "cap_20260801_captureref01", jobId: "job_20260801_captureref01",
      displayName: "Old evidence.md", sourceKind: "markdown_file" as const, pageId: "page_20260801_old"
    }];
    const newReferences = [{
      eventId: "evt_20260801_captureref02", sourceId: "src_20260801_captureref02",
      captureId: "cap_20260801_captureref02", jobId: "job_20260801_captureref01",
      displayName: "New evidence.md", sourceKind: "markdown_file" as const, pageId: "page_20260801_new"
    }];
    const t = (key: string) => ({
      "home.attachedFiles": "Attached files", "activity.open": "Open", "note.opening": "Opening",
      "error.generic": "Could not open this note."
    }[key] ?? key);
    await act(async () => root.render(createElement(ConversationCaptureReferences, { references: oldReferences, onOpen: open, t })));
    const oldButton = dom.window.document.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { oldButton.click(); await Promise.resolve(); });
    expect(oldButton.disabled).toBe(true);
    await act(async () => { root.render(createElement(ConversationCaptureReferences, { references: newReferences, onOpen: open, t })); await settle(dom); });
    const newButton = dom.window.document.querySelector<HTMLButtonElement>("button")!;
    expect(dom.window.document.body.textContent).toContain("New evidence.md");
    expect(newButton.disabled).toBe(false);
    resolveOpen();
    await act(async () => { await settle(dom); });
    expect(dom.window.document.body.textContent).not.toContain("Could not open this note.");
    expect(newButton.disabled).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    dom.window.close();
  });
});

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await Promise.resolve();
}
