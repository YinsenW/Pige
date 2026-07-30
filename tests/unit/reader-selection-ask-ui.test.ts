import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { ReaderSelectionActionRequest, ReaderSelectionActionResult } from "@pige/contracts";
import { ReaderSelectionAskDialog } from "../../apps/desktop/src/renderer/src/components/ReaderSelectionAskDialog";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event"] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
const selection = {
  pageId: "page_20260730_readerask01",
  pageContentHash: `sha256:${"a".repeat(64)}`,
  span: { unit: "utf8_bytes" as const, start: 4, endExclusive: 18 },
  selectedContentHash: `sha256:${"b".repeat(64)}`
};

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Reader selection Ask dialog", () => {
  it("submits the exact immutable selection and retains the question and focus on a closed result", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const requests: ReaderSelectionActionRequest[] = [];
    let resolveAttempt: ((value: ReaderSelectionActionResult) => void) | undefined;
    let sent = 0;
    const render = (): void => root.render(createElement(ReaderSelectionAskDialog, {
      identityKey: "page_reader:selection_hash",
      open: true,
      selection,
      locale: "en",
      position: { left: 20, top: 30 },
      t,
      onSubmitAction: (request) => {
        requests.push(request);
        return new Promise((resolve) => { resolveAttempt = resolve; });
      },
      onActionResult: () => undefined,
      onSent: () => { sent += 1; },
      onCancel: () => undefined
    }));
    await act(async () => { render(); await settle(dom); });
    const input = requireElement(container.querySelector<HTMLInputElement>("input"));
    await waitFor(dom, () => dom.window.document.activeElement === input);
    expect(button(container, "Ask").disabled).toBe(true);

    await inputValue(dom, input, "  How does this relate?  ");
    const ask = button(container, "Ask");
    await act(async () => { ask.click(); ask.click(); await settle(dom); });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ action: "ask", question: "How does this relate?", selection });
    expect(JSON.stringify(requests[0])).not.toContain("selected passage");
    await act(async () => {
      resolveAttempt?.({ apiVersion: 1, requestId: requests[0]!.requestId, status: "invalid", reason: "selection_changed" });
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Could not ask about this selection.") === true);
    expect(input.value).toBe("  How does this relate?  ");
    expect(dom.window.document.activeElement).toBe(input);

    await act(async () => { ask.click(); await settle(dom); });
    await act(async () => {
      resolveAttempt?.({
        apiVersion: 1,
        requestId: requests[1]!.requestId,
        status: "completed",
        jobId: "job_20260730_readerask01",
        conversationEventId: "evt_20260730_readerask01",
        conversationId: "conv_20260730_readerask01",
        tailEventId: "evt_20260730_readerask02"
      });
      await settle(dom);
    });
    expect(sent).toBe(1);
    expect(input.value).toBe("");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves a cancelled draft and clears it only when the exact selection identity changes", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    let identityKey = "page_reader:selection_a";
    let open = true;
    const render = (): void => root.render(createElement(ReaderSelectionAskDialog, {
      identityKey,
      open,
      selection,
      locale: "en",
      position: {},
      t,
      onSubmitAction: async (request) => ({ apiVersion: 1, requestId: request.requestId, status: "invalid", reason: "selection_changed" }),
      onActionResult: () => undefined,
      onSent: () => undefined,
      onCancel: () => { open = false; render(); }
    }));
    await act(async () => { render(); await settle(dom); });
    await inputValue(dom, requireElement(container.querySelector<HTMLInputElement>("input")), "Keep this question");
    await act(async () => { button(container, "Cancel").click(); await settle(dom); });
    expect(container.querySelector("input")).toBeNull();

    open = true;
    await act(async () => { render(); await settle(dom); });
    expect(requireElement(container.querySelector<HTMLInputElement>("input")).value).toBe("Keep this question");
    identityKey = "page_reader:selection_b";
    await act(async () => { render(); await settle(dom); });
    expect(requireElement(container.querySelector<HTMLInputElement>("input")).value).toBe("");
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function t(key: string): string {
  return ({
    "note.selection.askTitle": "Ask about selection",
    "note.selection.askDescription": "The question will use the exact selected passage.",
    "note.selection.askQuestion": "Question",
    "note.selection.askPlaceholder": "What would you like to know?",
    "note.selection.askSubmit": "Ask",
    "note.selection.askCancel": "Cancel",
    "note.selection.askPending": "Asking…",
    "note.selection.actionFailed": "Could not ask about this selection."
  } as Record<string, string>)[key] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (handle: number): void => dom.window.clearTimeout(handle);
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function inputValue(dom: JSDOM, input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await settle(dom);
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await settle(dom); });
  }
  throw new Error("Timed out waiting for UI state.");
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
