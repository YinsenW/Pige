import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReaderNoteMergeDialog,
  type ReaderNoteMergeLabels,
} from "../../apps/desktop/src/renderer/src/components/ReaderNoteMergeDialog";

const labels: ReaderNoteMergeLabels = {
  title: "Merge note", description: "Choose a note to absorb.", survivor: "Survivor:", target: "Target",
  loading: "Loading targets", empty: "No targets", cancel: "Cancel", confirm: "Merge",
  pending: "Merging", failed: "Merge failed"
};
const globalKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "HTMLSelectElement",
  "Event", "KeyboardEvent", "MouseEvent"
] as const;
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

describe("ReaderNoteMergeDialog", () => {
  it("reopens the target for a new owner after an in-flight merge becomes stale", async () => {
    const dom = installDom();
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    let owner = "A";
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const loadTargets = vi.fn(async () => [{
      pageId: `page-${owner}`, title: `Target ${owner}`, updatedAt: "2026-08-01T00:00:00.000Z"
    }]);
    const merge = vi.fn(async () => {
      if (merge.mock.calls.length === 1) await firstPending;
      return { status: "retained" as const };
    });
    const renderDialog = (ownerIdentity: string): void => {
      root.render(createElement(ReaderNoteMergeDialog, {
        ownerIdentity, currentTitle: `Current ${ownerIdentity}`, returnFocusRef: createRef<HTMLButtonElement>(), labels,
        onLoadTargets: loadTargets, onMerge: merge, onCancel: () => undefined, onCommitted: () => undefined
      }));
    };
    await act(async () => { renderDialog("A"); await settle(dom); });
    expect(container.querySelector("select")?.value).toBe("page-A");
    await act(async () => { button(container, labels.confirm).click(); await settle(dom); });
    expect(merge).toHaveBeenCalledTimes(1);

    owner = "B";
    await act(async () => { renderDialog("B"); await settle(dom); await settle(dom); });
    const select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("page-B");
    expect(button(container, labels.confirm).disabled).toBe(false);
    await act(async () => { button(container, labels.confirm).click(); await settle(dom); });
    expect(merge).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(labels.failed);
    releaseFirst();
    await act(async () => { await firstPending; await settle(dom); });
    expect(container.textContent).toContain(labels.failed);
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true, url: "http://pige.test"
  });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLSelectElement: dom.window.HTMLSelectElement, Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent, MouseEvent: dom.window.MouseEvent
  };
  for (const key of globalKeys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: values[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
  await Promise.resolve();
}
