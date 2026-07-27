import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult
} from "@pige/contracts";
import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorCommitted,
  type NoteMarkdownEditorProps,
  type NoteMarkdownEditorReady
} from "../../apps/desktop/src/renderer/src/components/NoteMarkdownEditor";

const vaultId = "vault_editorfixture";
const pageId = "page_editorfixture";
const context1 = `notectx_${"a".repeat(32)}`;
const context2 = `notectx_${"b".repeat(32)}`;
const revision1 = `noteeditrev_${"1".repeat(32)}`;
const revision2 = `noteeditrev_${"2".repeat(32)}`;
const revision3 = `noteeditrev_${"3".repeat(32)}`;

const labels = {
  title: "Edit Markdown",
  field: "Markdown source",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  reload: "Reload latest",
  reloading: "Reloading…",
  stale: "The note changed. Your draft is preserved.",
  failed: "The note could not be saved.",
  notFound: "This note is no longer available.",
  reloaded: "Latest note loaded. Your draft is preserved.",
  invalid: {
    markdown_too_large: "This note is too large.",
    invalid_frontmatter: "The frontmatter is invalid.",
    page_id_changed: "The page identity cannot be changed.",
    unsupported_page_type: "This page type cannot be edited.",
    invalid_wiki_link: "A wiki link is invalid.",
    invalid_citation: "A citation is invalid."
  }
} as const;

const globalKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement",
  "HTMLTextAreaElement", "InputEvent", "Event", "MouseEvent", "KeyboardEvent", "CompositionEvent"
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
  it("saves exact Markdown against the immutable gesture-time identity and ignores IME shortcuts", async () => {
    const requests: NoteEditorSaveRequest[] = [];
    const committed: NoteMarkdownEditorCommitted[] = [];
    const harness = await renderEditor({
      onSave: async (request) => {
        requests.push(request);
        return committedResult(request, revision2, context2);
      },
      onCommitted: (result) => committed.push(result)
    });
    const textarea = harness.textarea();
    await inputText(harness.dom, textarea, "# 新标题 👋\n\n正文  ");
    await keydown(harness.dom, textarea, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(requests).toHaveLength(0);
    await keydown(harness.dom, textarea, { key: "Enter", ctrlKey: true });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: vaultId,
      pageId,
      renderContextId: context1,
      expectedRevision: revision1,
      markdown: "# 新标题 👋\n\n正文  "
    });
    expect(requests[0]?.requestId).toMatch(/^noteeditreq_[a-z0-9]{8,64}$/u);
    expect(committed).toHaveLength(1);
    expect(committed[0]?.render.renderContextId).toBe(context2);
    await harness.close();
  });

  it("preserves the exact stale draft, reloads only the base, and retries with the refreshed revision", async () => {
    const saveRequests: NoteEditorSaveRequest[] = [];
    const openRequests: NoteEditorOpenRequest[] = [];
    const harness = await renderEditor({
      onSave: async (request) => {
        saveRequests.push(request);
        return saveRequests.length === 1
          ? { apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, pageId, status: "stale", revision: revision2 }
          : committedResult(request, revision3, context2);
      },
      onReload: async (request) => {
        openRequests.push(request);
        return ready({ requestId: request.requestId, renderContextId: context2, revision: revision2, markdown: "# Authoritative\n" });
      }
    });
    await inputText(harness.dom, harness.textarea(), "exact attempted markdown\n");
    await click(harness.dom, harness.button("Save"));
    expect(harness.textarea().value).toBe("exact attempted markdown\n");
    expect(harness.container.textContent).toContain("Your draft is preserved");
    await click(harness.dom, harness.button("Reload latest"));
    expect(openRequests[0]).toMatchObject({ renderContextId: context1 });
    expect(harness.textarea().value).toBe("exact attempted markdown\n");
    expect(harness.dom.window.document.activeElement).toBe(harness.textarea());
    await click(harness.dom, harness.button("Save"));
    expect(saveRequests.map((request) => [request.renderContextId, request.expectedRevision]))
      .toEqual([[context1, revision1], [context2, revision2]]);
    await harness.close();
  });

  it("keeps invalid and failed results body-free while preserving the draft", async () => {
    let attempt = 0;
    const harness = await renderEditor({
      onSave: async (request) => {
        attempt += 1;
        return attempt === 1
          ? { apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, pageId, status: "invalid", reason: "invalid_frontmatter" }
          : { apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, pageId, status: "failed" };
      }
    });
    await inputText(harness.dom, harness.textarea(), "invalid but retained");
    await click(harness.dom, harness.button("Save"));
    expect(harness.container.textContent).toContain("frontmatter is invalid");
    await click(harness.dom, harness.button("Save"));
    expect(harness.container.textContent).toContain("could not be saved");
    expect(harness.textarea().value).toBe("invalid but retained");
    await harness.close();
  });

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
    let resolveSave: ((result: NoteEditorSaveResult) => void) | undefined;
    const committed: NoteMarkdownEditorCommitted[] = [];
    const harness = await renderEditor({
      onSave: () => new Promise((resolve) => { resolveSave = resolve; }),
      onCommitted: (result) => committed.push(result)
    });
    await inputText(harness.dom, harness.textarea(), "old owner draft");
    await clickWithoutSettling(harness.dom, harness.button("Save"));
    await harness.render({
      ready: ready({ activeVaultId: "vault_other", pageId: "page_other", markdown: "new owner markdown" })
    });
    expect(harness.textarea().value).toBe("new owner markdown");
    await act(async () => {
      resolveSave?.(committedResult({
        apiVersion: 1,
        requestId: "noteeditreq_oldowner1",
        activeVaultId: vaultId,
        pageId,
        renderContextId: context1,
        expectedRevision: revision1,
        markdown: "old owner draft"
      }, revision2, context2));
      await settle(harness.dom);
    });
    expect(committed).toEqual([]);
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
    ready: ready(), labels, returnFocusRef,
    onSave: async (request) => ({ apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, pageId: request.pageId, status: "failed" }),
    onReload: async (request) => ({ apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, pageId: request.pageId, status: "failed" }),
    onCommitted: () => undefined,
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
    dom, root, opener,
    container: dom.window.document.querySelector("#root")!, render,
    textarea: () => requireElement(dom.window.document.querySelector<HTMLTextAreaElement>("textarea")),
    button: (name: string) => buttonNamed(dom.window.document, name),
    close: async () => { await act(async () => root.unmount()); dom.window.close(); }
  };
}

function ready(overrides: Partial<NoteMarkdownEditorReady> = {}): NoteMarkdownEditorReady {
  return {
    apiVersion: 1,
    requestId: "noteeditreq_initial1",
    activeVaultId: vaultId,
    pageId,
    status: "ready",
    renderContextId: context1,
    revision: revision1,
    markdown: "# Original\n",
    ...overrides
  };
}

function committedResult(
  request: NoteEditorSaveRequest,
  revision: string,
  renderContextId: string
): Extract<NoteEditorSaveResult, { status: "committed" }> {
  return {
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    pageId: request.pageId,
    status: "committed",
    revision,
    operationId: "operation_editorfixture",
    render: {
      summary: {
        pageId: request.pageId,
        title: "Edited note",
        pageType: "note",
        status: "active",
        pagePath: "notes/editor.md",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:01:00.000Z",
        sourceIds: []
      },
      html: "<h1>Edited note</h1>",
      byteSize: 25,
      renderContextId
    }
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">Edit</button><div id="root"></div></body></html>', {
    url: "http://localhost/", pretendToBeVisual: true
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key as keyof Window] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.addEventListener(name.replace(/^on/u, ""), listener); } });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.removeEventListener(name.replace(/^on/u, ""), listener); } });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(Date.now()), 0);
  return dom;
}

async function inputText(dom: JSDOM, textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
    const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    textarea.dispatchEvent(propertyChange);
    textarea.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function keydown(dom: JSDOM, target: HTMLElement, init: KeyboardEventInit & { isComposing?: boolean }): Promise<void> {
  await act(async () => {
    const event = new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    if (init.isComposing !== undefined) Object.defineProperty(event, "isComposing", { configurable: true, value: init.isComposing });
    target.dispatchEvent(event);
    await settle(dom);
  });
}

async function click(dom: JSDOM, target: HTMLButtonElement): Promise<void> {
  await act(async () => { target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await settle(dom); });
}

async function clickWithoutSettling(dom: JSDOM, target: HTMLButtonElement): Promise<void> {
  await act(async () => { target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
}

async function settle(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
