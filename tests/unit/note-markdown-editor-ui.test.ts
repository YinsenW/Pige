import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorBaseIdentity,
  type NoteMarkdownEditorProps,
  type NoteMarkdownEditorSaveRequest,
  type NoteMarkdownEditorSaveResult
} from "../../apps/desktop/src/renderer/src/components/NoteMarkdownEditor";

const labels = {
  title: "Edit Markdown",
  field: "Markdown source",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  reload: "Reload latest",
  reloading: "Reloading…",
  stale: "The note changed. Your draft is preserved.",
  conflict: "This edit conflicts with a newer note. Your draft is preserved.",
  failed: "The note could not be saved.",
  reloaded: "Latest note loaded. Your draft is preserved."
} as const;

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "InputEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CompositionEvent"
] as const;
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

describe("NoteMarkdownEditor", () => {
  it("saves exact Markdown against the immutable gesture-time base and ignores IME shortcuts", async () => {
    const harness = await renderEditor({ initialMarkdown: "# 原文\n" });
    const requests: NoteMarkdownEditorSaveRequest[] = [];
    const saved: NoteMarkdownEditorBaseIdentity[] = [];
    await harness.render({
      initialMarkdown: "# 原文\n",
      onSave: async (request) => {
        requests.push(request);
        return { status: "saved", identity: identity("revision_2") };
      },
      onSaved: (next) => saved.push(next)
    });
    const textarea = harness.textarea();
    await inputText(harness.dom, textarea, "# 新标题 👋\n\n正文  ");
    await keydown(harness.dom, textarea, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(requests).toHaveLength(0);
    await keydown(harness.dom, textarea, { key: "Enter", ctrlKey: true });

    expect(requests).toEqual([{
      base: identity("revision_1"),
      markdown: "# 新标题 👋\n\n正文  "
    }]);
    expect(saved).toEqual([identity("revision_2")]);
    await harness.close();
  });

  it.each(["stale", "conflict"] as const)(
    "preserves the exact %s draft, reloads only the base, and retries with the new revision",
    async (status) => {
      const requests: NoteMarkdownEditorSaveRequest[] = [];
      const harness = await renderEditor({
        onSave: async (request) => {
          requests.push(request);
          return requests.length === 1
            ? { status }
            : { status: "saved", identity: identity("revision_3") };
        },
        onReload: async () => ({ status: "ready", identity: identity("revision_2") })
      });
      const textarea = harness.textarea();
      await inputText(harness.dom, textarea, "exact attempted markdown\n");
      await click(harness.dom, harness.button("Save"));
      expect(textarea.value).toBe("exact attempted markdown\n");
      expect(harness.container.textContent).toContain("Your draft is preserved");
      await click(harness.dom, harness.button("Reload latest"));
      expect(textarea.value).toBe("exact attempted markdown\n");
      expect(harness.dom.window.document.activeElement).toBe(textarea);
      await click(harness.dom, harness.button("Save"));
      expect(requests.map((request) => request.base.revisionId)).toEqual(["revision_1", "revision_2"]);
      await harness.close();
    }
  );

  it("keeps IME Escape local, then cancels and restores focus to the opening control", async () => {
    const cancelled: string[] = [];
    const harness = await renderEditor({ onCancel: () => cancelled.push("cancelled") });
    await keydown(harness.dom, harness.textarea(), { key: "Escape", isComposing: true });
    expect(cancelled).toEqual([]);
    await keydown(harness.dom, harness.textarea(), { key: "Escape" });
    expect(cancelled).toEqual(["cancelled"]);
    expect(harness.dom.window.document.activeElement).toBe(harness.opener);
    await harness.close();
  });

  it("resets on owner identity change and fences an older pending save", async () => {
    let resolveSave: ((result: NoteMarkdownEditorSaveResult) => void) | undefined;
    const saved: NoteMarkdownEditorBaseIdentity[] = [];
    const harness = await renderEditor({
      onSave: () => new Promise((resolve) => { resolveSave = resolve; }),
      onSaved: (next) => saved.push(next)
    });
    await inputText(harness.dom, harness.textarea(), "old owner draft");
    await clickWithoutSettling(harness.dom, harness.button("Save"));
    await harness.render({
      identity: {
        activeVaultId: "vault_2",
        pageId: "page_2",
        revisionId: "revision_other_1"
      },
      initialMarkdown: "new owner markdown",
      onSave: () => new Promise((resolve) => { resolveSave = resolve; }),
      onSaved: (next) => saved.push(next)
    });
    expect(harness.textarea().value).toBe("new owner markdown");
    await act(async () => {
      resolveSave?.({ status: "saved", identity: identity("revision_2") });
      await settle(harness.dom);
    });
    expect(saved).toEqual([]);
    expect(harness.textarea().value).toBe("new owner markdown");
    await harness.close();
  });
});

type EditorOverrides = Partial<Omit<NoteMarkdownEditorProps, "returnFocusRef" | "labels">>;

async function renderEditor(initial: EditorOverrides = {}) {
  const dom = createDom();
  const root = createRoot(dom.window.document.querySelector("#root")!);
  const opener = dom.window.document.querySelector<HTMLButtonElement>("#opener")!;
  const returnFocusRef = createRef<HTMLElement>();
  returnFocusRef.current = opener;
  let current: NoteMarkdownEditorProps = {
    identity: identity("revision_1"),
    initialMarkdown: "# Original\n",
    labels,
    returnFocusRef,
    onSave: async () => ({ status: "failed" }),
    onReload: async () => ({ status: "failed" }),
    onSaved: () => undefined,
    onCancel: () => undefined,
    ...initial
  };
  const render = async (overrides: EditorOverrides = {}): Promise<void> => {
    current = { ...current, ...overrides };
    await act(async () => {
      root.render(createElement(NoteMarkdownEditor, current));
      await settle(dom);
    });
  };
  await render();
  return {
    dom,
    root,
    opener,
    container: dom.window.document.querySelector("#root")!,
    render,
    textarea: () => requireElement(dom.window.document.querySelector<HTMLTextAreaElement>("textarea")),
    button: (name: string) => buttonNamed(dom.window.document, name),
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    }
  };
}

function identity(revisionId: string): NoteMarkdownEditorBaseIdentity {
  return {
    activeVaultId: "vault_1",
    pageId: "page_1",
    revisionId
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">Edit</button><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key as keyof Window]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  return dom;
}

async function inputText(dom: JSDOM, textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    textarea.dispatchEvent(propertyChange);
    textarea.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText"
    }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function keydown(
  dom: JSDOM,
  target: HTMLElement,
  init: KeyboardEventInit & { isComposing?: boolean }
): Promise<void> {
  await act(async () => {
    const event = new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    if (init.isComposing !== undefined) {
      Object.defineProperty(event, "isComposing", { configurable: true, value: init.isComposing });
    }
    target.dispatchEvent(event);
    await settle(dom);
  });
}

async function click(dom: JSDOM, target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function clickWithoutSettling(dom: JSDOM, target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
