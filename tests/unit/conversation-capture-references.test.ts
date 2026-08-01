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
    buttons[0]!.click();
    expect(open).toHaveBeenCalledWith("page_20260801_captureref01");
    await act(async () => root.unmount());
    dom.window.close();
  });
});
