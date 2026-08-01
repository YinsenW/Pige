import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrSummaryPreferenceControl } from "../../apps/desktop/src/renderer/src/components/OcrSummaryPreferenceControl";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event"] as const;
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

describe("OcrSummaryPreferenceControl", () => {
  it("loads the safe default and commits one revision-bound change", async () => {
    const setOcrSummaryPreference = vi.fn(async (request) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      status: "committed" as const,
      summary: {
        apiVersion: 1 as const,
        revision: 1,
        excludeLowConfidenceOcr: request.excludeLowConfidenceOcr,
        appliesTo: "new_agent_jobs" as const
      }
    }));
    const { dom, container, root } = await mount(setOcrSummaryPreference);
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      checkbox.focus();
      checkbox.click();
      await settle(dom);
    });
    expect(setOcrSummaryPreference).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 0,
      excludeLowConfidenceOcr: false
    }));
    expect(checkbox.checked).toBe(false);
    expect(dom.window.document.activeElement).toBe(checkbox);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

async function mount(
  setOcrSummaryPreference: Parameters<typeof OcrSummaryPreferenceControl>[0]["api"]["setOcrSummaryPreference"]
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event
  };
  for (const key of globalKeys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: values[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    configurable: true,
    value: () => "01234567-89ab-cdef-0123-456789abcdef"
  });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(OcrSummaryPreferenceControl, {
      api: {
        ocrSummaryPreference: async (request) => ({
          apiVersion: 1,
          requestId: request.requestId,
          status: "ready",
          summary: {
            apiVersion: 1,
            revision: 0,
            excludeLowConfidenceOcr: true,
            appliesTo: "new_agent_jobs"
          }
        }),
        setOcrSummaryPreference
      },
      t: (key) => key
    }));
    await settle(dom);
  });
  return { dom, container, root };
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
