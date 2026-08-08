import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReaderNoteTagDialog,
  type ReaderNoteTagLabels,
} from "../../apps/desktop/src/renderer/src/components/ReaderNoteTagDialog";

const labels: ReaderNoteTagLabels = {
  title: "Edit tags", description: "Update tags", tagsField: "Tags", tagsPlaceholder: "Add tags",
  topicsField: "Topics", topicsPlaceholder: "Add topics", cancel: "Cancel", confirm: "Save",
  pending: "Saving", failed: "Save failed", remove: "Remove", removeTitle: "Remove tag",
  removeDescription: "Remove this tag from the note?", removeConfirm: "Remove tag",
  removePending: "Removing", removeFailed: "Remove failed"
};
const globalKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "HTMLInputElement",
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

describe("ReaderNoteTagDialog", () => {
  it("returns focus to the exact tag trigger when the nested remove dialog is cancelled", async () => {
    const dom = installDom();
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    const returnFocusRef = createRef<HTMLButtonElement>();
    await act(async () => {
      root.render(createElement(ReaderNoteTagDialog, {
        ownerIdentity: "vault:page:context:1",
        existingTags: ["research"], existingTopics: [], labels, returnFocusRef,
        onEdit: async () => ({ status: "retained" as const }),
        onRemove: async () => ({ status: "retained" as const }),
        onCancel: () => undefined, onCommitted: () => undefined
      }));
      await settle(dom);
    });
    const removeTrigger = button(container, labels.remove);
    removeTrigger.focus();
    await act(async () => { removeTrigger.click(); await settle(dom); });
    const nested = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(nested).not.toBeNull();
    const cancel = button(nested!, labels.cancel);
    await act(async () => { cancel.click(); await settle(dom); });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(removeTrigger);
    await act(async () => { removeTrigger.click(); await settle(dom); });
    const nestedAgain = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(nestedAgain).not.toBeNull();
    await act(async () => {
      nestedAgain!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await settle(dom);
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(removeTrigger);
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
    HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });
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
  await Promise.resolve();
}
