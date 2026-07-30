import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult } from "@pige/contracts";
import { ReaderTopicRenameDialog } from "../../apps/desktop/src/renderer/src/components/ReaderTopicRenameDialog";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
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

describe("ReaderTopicRenameDialog", () => {
  it("submits one exact Topic rename and adopts only the authoritative render", async () => {
    const note = topicRender();
    const onCommitted = vi.fn();
    const onRename = vi.fn(async (request) => ({
      ...request,
      status: "committed" as const,
      operationId: "op_20260731_topicrename",
      render: topicRender("New Topic", "2026-07-31T09:00:00.000Z")
    }));
    const harness = await mount(note, onRename, onCommitted);
    const trigger = harness.container.querySelector<HTMLButtonElement>('[data-reader-action="rename-topic"]')!;
    trigger.focus();
    await click(trigger, harness.dom);
    const input = harness.container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      setInputValue(input, "New Topic", harness.dom);
    });
    await click(button(harness.container, "Rename"), harness.dom);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename.mock.calls[0]?.[0]).toMatchObject({
      activeVaultId: "vault_20260731_topicrename",
      pageId: "page_20260731_topicrename",
      expectedTitle: "Old Topic",
      expectedUpdatedAt: "2026-07-31T08:00:00.000Z",
      expectedRevision: `noteeditrev_${"b".repeat(64)}`,
      title: "New Topic"
    });
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ title: "New Topic" }) }));
    await act(async () => {
      await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    });
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("keeps the draft and dialog on stale, and hides the action for non-Topic pages", async () => {
    const onRename = vi.fn(async (request) => ({ ...request, status: "stale" as const }));
    const harness = await mount(topicRender(), onRename, vi.fn());
    const trigger = harness.container.querySelector<HTMLButtonElement>('[data-reader-action="rename-topic"]')!;
    await click(trigger, harness.dom);
    const input = harness.container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      setInputValue(input, "Retained Topic", harness.dom);
    });
    await click(button(harness.container, "Rename"), harness.dom);
    expect(harness.container.querySelector<HTMLInputElement>("input")?.value).toBe("Retained Topic");
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toContain("changed");
    expect(harness.container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      input.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    });
    expect(harness.container.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await click(trigger, harness.dom);
    await click(button(harness.container, "Cancel"), harness.dom);
    await act(async () => {
      await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    });
    expect(harness.container.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();

    const hidden = await mount({ ...topicRender(), summary: { ...topicRender().summary, pageType: "note" } }, vi.fn(), vi.fn());
    expect(hidden.container.querySelector("button")).toBeNull();
    await hidden.unmount();
  });

  it("serializes submission and fails closed on a mismatched revision response", async () => {
    let resolveRename!: (result: any) => void;
    const onRename = vi.fn((request) => new Promise((resolve) => {
      resolveRename = resolve;
    }));
    const harness = await mount(topicRender(), onRename, vi.fn());
    await click(harness.container.querySelector<HTMLButtonElement>('[data-reader-action="rename-topic"]')!, harness.dom);
    const input = harness.container.querySelector<HTMLInputElement>("input")!;
    await act(async () => setInputValue(input, "New Topic", harness.dom));
    const confirm = button(harness.container, "Rename");
    await click(confirm, harness.dom);
    await click(confirm, harness.dom);
    expect(onRename).toHaveBeenCalledTimes(1);
    const request = onRename.mock.calls[0]?.[0];
    await act(async () => {
      resolveRename({
        ...request,
        expectedRevision: `noteeditrev_${"c".repeat(64)}`,
        status: "committed",
        operationId: "op_20260731_topicrename",
        render: topicRender("New Topic", "2026-07-31T09:00:00.000Z")
      });
      await Promise.resolve();
      await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20));
    });
    expect(harness.container.querySelector<HTMLInputElement>("input")?.value).toBe("New Topic");
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toContain("failed");
    expect(harness.container.querySelector('[role="dialog"]')).not.toBeNull();
    await harness.unmount();
  });
});

function topicRender(title = "Old Topic", updatedAt = "2026-07-31T08:00:00.000Z"): NoteRenderResult {
  return {
    summary: {
      pageId: "page_20260731_topicrename",
      title,
      pageType: "topic",
      status: "active",
      pagePath: "wiki/topics/old-topic.md",
      createdAt: "2026-07-31T07:00:00.000Z",
      updatedAt,
      language: "en",
      sourceIds: []
    },
    html: "<p>Topic body</p>",
    byteSize: 120,
    renderContextId: "notectx_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    topicRenameEligibility: { canRename: true, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}

async function mount(note: NoteRenderResult, onRename: any, onCommitted: any) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(dom.window, "crypto", { configurable: true, value: { randomUUID: () => "a".repeat(32) } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) { this.addEventListener(name.replace(/^on/u, ""), listener); }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) { this.removeEventListener(name.replace(/^on/u, ""), listener); }
  });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.querySelector<HTMLDivElement>("#root")!;
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(ReaderTopicRenameDialog, {
      activeVaultId: "vault_20260731_topicrename",
      note,
      onRename,
      onCommitted,
      t: (key: string) => ({
        "topic.rename.action": "Rename topic", "topic.rename.title": "Rename topic",
        "topic.rename.description": "Description", "topic.rename.field": "Topic title",
        "topic.rename.cancel": "Cancel", "topic.rename.confirm": "Rename",
        "topic.rename.saving": "Renaming", "topic.rename.stale": "This topic changed.",
        "topic.rename.failed": "Rename failed."
      }[key] ?? key)
    }));
  });
  return {
    container, dom,
    unmount: async () => act(async () => root.unmount())
  };
}

async function click(element: HTMLElement, dom: JSDOM): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function setInputValue(input: HTMLInputElement, value: string, dom: JSDOM): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
  Object.defineProperty(propertyChange, "propertyName", { value: "value" });
  input.dispatchEvent(propertyChange);
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
