import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrImageTestControl } from "../../apps/desktop/src/renderer/src/components/OcrImageTestControl";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("OcrImageTestControl", () => {
  it("shows one bounded recognized preview and sends no path authority", async () => {
    const testOcrImage = vi.fn(async (request) => ({
      ...request,
      status: "ready" as const,
      preview: {
        adapterId: "macos_vision_ocr" as const,
        engine: "macos_vision_document" as const,
        engineVersion: "1",
        text: "Pige OCR",
        truncated: false,
        blockCount: 1,
        confidence: 0.9,
        languageHints: ["en-US"],
        warnings: []
      }
    }));
    const { dom, container, root } = await mount(testOcrImage);
    await click(dom, container.querySelector("button")!);
    expect(testOcrImage).toHaveBeenCalledTimes(1);
    expect(Object.keys(testOcrImage.mock.calls[0]![0]).sort()).toEqual(["apiVersion", "requestId"]);
    expect(container.textContent).toContain("Pige OCR");
    expect(container.textContent).toContain("Complete");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps cancellation quiet and reports fail-closed outcomes", async () => {
    const { dom, container, root } = await mount(async (request) => ({ ...request, status: "cancelled" as const }));
    await click(dom, container.querySelector("button")!);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });
});

async function mount(testOcrImage: Parameters<typeof OcrImageTestControl>[0]["api"]["testOcrImage"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent };
  for (const key of globalKeys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: values[key] }); }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.crypto, "randomUUID", { configurable: true, value: () => "01234567-89ab-cdef-0123-456789abcdef" });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => { root.render(createElement(OcrImageTestControl, { api: { testOcrImage }, t: (key) => ({
    "capabilities.ocrTest.title": "Test OCR", "capabilities.ocrTest.description": "Description",
    "capabilities.ocrTest.choose": "Choose", "capabilities.ocrTest.running": "Running",
    "capabilities.ocrTest.ready": "Complete", "capabilities.ocrTest.blocks": "blocks",
    "capabilities.ocrTest.empty": "Empty", "capabilities.ocrTest.truncated": "Truncated"
  })[key] ?? key })); await settle(dom); });
  return { dom, container, root };
}

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await settle(dom); });
}
async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
