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
  source: "Edit",
  preview: "Preview",
  previewLoading: "Preparing preview…",
  previewFailed: "The preview could not be rendered.",
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  review: "Review changes",
  reviewing: "Loading current file…",
  conflictTitle: "Review external changes",
  currentFile: "Current file (read only)",
  draft: "Your draft",
  useCurrent: "Use current file",
  continueDraft: "Continue editing draft",
  stale: "The note changed. Your draft is preserved.",
  failed: "The note could not be saved.",
  notFound: "This note is no longer available.",
  currentAccepted: "Current file loaded. Your previous draft was discarded.",
  mergeReady: "Latest revision loaded. Review your draft, then save.",
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
  it("renders the exact unsaved draft through the sanitized Reader pipeline without saving it", async () => {
    const saveRequests: NoteEditorSaveRequest[] = [];
    const harness = await renderEditor({
      onSave: async (request) => {
        saveRequests.push(request);
        return committedResult(request, revision2, context2);
      }
    });
    const markdown = [
      "---",
      'id: "page_20260709_abcd1234"',
      "schema_version: 1",
      "title: Hidden frontmatter title",
      "type: note",
      "created_at: 2026-07-27T00:00:00.000Z",
      "updated_at: 2026-07-27T00:00:00.000Z",
      "status: active",
      "---",
      "# Unsaved preview",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "[External](https://example.com/private)",
      "",
      "<script>window.previewWasUnsafe = true</script>"
    ].join("\n");
    const textarea = harness.textarea();
    Object.defineProperties(harness.dom.window.HTMLTextAreaElement.prototype, {
      scrollHeight: { configurable: true, get() { return 1000; } },
      clientHeight: { configurable: true, get() { return 200; } }
    });
    textarea.scrollTop = 400;
    Object.defineProperties(harness.dom.window.HTMLElement.prototype, {
      scrollHeight: { configurable: true, get() { return this.classList.contains("note-markdown-editor-preview-panel") ? 800 : 0; } },
      clientHeight: { configurable: true, get() { return this.classList.contains("note-markdown-editor-preview-panel") ? 200 : 0; } }
    });
    await inputText(harness.dom, textarea, markdown);
    await click(harness.dom, harness.button("Preview"));
    const preview = await waitForElement<HTMLElement>(
      harness.dom,
      () => harness.container.querySelector("[data-note-markdown-draft-preview]")
    );
    expect(preview.querySelector("h1")?.textContent).toBe("Unsaved preview");
    expect(preview.querySelectorAll("table")).toHaveLength(1);
    expect(preview.textContent).not.toContain("Hidden frontmatter title");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector("a")?.hasAttribute("href")).toBe(false);
    const previewPanel = requireElement(harness.container.querySelector<HTMLElement>(".note-markdown-editor-preview-panel"));
    await act(async () => settle(harness.dom));
    expect(previewPanel.scrollTop).toBe(300);
    previewPanel.scrollTop = 450;
    expect(saveRequests).toHaveLength(0);
    await click(harness.dom, harness.button("Edit"));
    expect(harness.textarea().value).toBe(markdown);
    expect(harness.textarea().scrollTop).toBe(600);
    expect(harness.dom.window.document.activeElement).toBe(harness.textarea());
    await harness.close();
  });

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

  it("requires an explicit current-file review before retrying a stale draft on the refreshed revision", async () => {
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
    await click(harness.dom, harness.button("Review changes"));
    expect(openRequests[0]).toMatchObject({ renderContextId: context1 });
    expect(harness.textarea().value).toBe("exact attempted markdown\n");
    const currentFile = requireElement(
      harness.container.querySelector<HTMLTextAreaElement>("#note-markdown-editor-current-file")
    );
    expect(currentFile.value).toBe("# Authoritative\n");
    expect(currentFile.readOnly).toBe(true);
    expect(harness.button("Save").disabled).toBe(true);
    expect(harness.dom.window.document.activeElement).toBe(currentFile);
    await keydown(harness.dom, currentFile, { key: "Enter", ctrlKey: true, isComposing: true });
    await keydown(harness.dom, currentFile, { key: "Enter", ctrlKey: true });
    expect(saveRequests).toHaveLength(1);
    await click(harness.dom, harness.button("Continue editing draft"));
    expect(harness.container.querySelector("#note-markdown-editor-current-file")).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(harness.textarea());
    await inputText(harness.dom, harness.textarea(), "# Authoritative\n\nMerged local paragraph\n");
    await click(harness.dom, harness.button("Save"));
    expect(saveRequests.map((request) => [request.renderContextId, request.expectedRevision]))
      .toEqual([[context1, revision1], [context2, revision2]]);
    expect(saveRequests[1]?.markdown).toBe("# Authoritative\n\nMerged local paragraph\n");
    await harness.close();
  });

  it("lets the user discard the local draft only through an explicit current-file choice", async () => {
    const saveRequests: NoteEditorSaveRequest[] = [];
    const harness = await renderEditor({
      onSave: async (request) => {
        saveRequests.push(request);
        return saveRequests.length === 1
          ? { apiVersion: 1, requestId: request.requestId, activeVaultId: vaultId, pageId, status: "stale", revision: revision2 }
          : committedResult(request, revision3, context2);
      },
      onReload: async (request) => ready({
        requestId: request.requestId,
        renderContextId: context2,
        revision: revision2,
        markdown: "# Current external body\n"
      })
    });
    await inputText(harness.dom, harness.textarea(), "local draft that must not disappear implicitly");
    await click(harness.dom, harness.button("Save"));
    await click(harness.dom, harness.button("Review changes"));
    expect(harness.textarea().value).toBe("local draft that must not disappear implicitly");
    await click(harness.dom, harness.button("Use current file"));
    expect(harness.textarea().value).toBe("# Current external body\n");
    expect(harness.container.textContent).toContain("previous draft was discarded");
    await click(harness.dom, harness.button("Save"));
    expect(saveRequests[1]).toMatchObject({
      renderContextId: context2,
      expectedRevision: revision2,
      markdown: "# Current external body\n"
    });
    await harness.close();
  });

  it("repeats the review fence after another external edit instead of reusing stale authority", async () => {
    const saveRequests: NoteEditorSaveRequest[] = [];
    let reloadCount = 0;
    const harness = await renderEditor({
      onSave: async (request) => {
        saveRequests.push(request);
        return {
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: vaultId,
          pageId,
          status: "stale",
          revision: saveRequests.length === 1 ? revision2 : revision3
        };
      },
      onReload: async (request) => {
        reloadCount += 1;
        return ready({
          requestId: request.requestId,
          renderContextId: reloadCount === 1 ? context2 : `notectx_${"c".repeat(32)}`,
          revision: reloadCount === 1 ? revision2 : revision3,
          markdown: reloadCount === 1 ? "# External one\n" : "# External two\n"
        });
      }
    });
    await inputText(harness.dom, harness.textarea(), "local draft");
    await click(harness.dom, harness.button("Save"));
    await click(harness.dom, harness.button("Review changes"));
    await click(harness.dom, harness.button("Continue editing draft"));
    await click(harness.dom, harness.button("Save"));
    expect(harness.container.textContent).toContain("Your draft is preserved");
    await click(harness.dom, harness.button("Review changes"));
    expect(requireElement(
      harness.container.querySelector<HTMLTextAreaElement>("#note-markdown-editor-current-file")
    ).value).toBe("# External two\n");
    expect(saveRequests.map(({ expectedRevision }) => expectedRevision)).toEqual([revision1, revision2]);
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

  it("serializes conflict loading and discards its result after a vault or page identity change", async () => {
    let resolveReload: ((result: NoteEditorOpenResult) => void) | undefined;
    const openRequests: NoteEditorOpenRequest[] = [];
    const harness = await renderEditor({
      onSave: async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        pageId: request.pageId,
        status: "stale",
        revision: revision2
      }),
      onReload: (request) => {
        openRequests.push(request);
        return new Promise((resolve) => { resolveReload = resolve; });
      }
    });
    await inputText(harness.dom, harness.textarea(), "old owner draft");
    await click(harness.dom, harness.button("Save"));
    await clickWithoutSettling(harness.dom, harness.button("Review changes"));
    expect(harness.button("Loading current file…").disabled).toBe(true);
    harness.button("Loading current file…").click();
    expect(openRequests).toHaveLength(1);
    await harness.render({
      ready: ready({ activeVaultId: "vault_other", pageId: "page_other", markdown: "new owner markdown" })
    });
    await act(async () => {
      resolveReload?.(ready({
        requestId: openRequests[0]!.requestId,
        renderContextId: context2,
        revision: revision2,
        markdown: "old owner current file"
      }));
      await settle(harness.dom);
    });
    expect(harness.textarea().value).toBe("new owner markdown");
    expect(harness.container.querySelector("#note-markdown-editor-current-file")).toBeNull();
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
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">Open editor</button><div id="root"></div></body></html>', {
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

async function settle(dom: JSDOM, delay = 0): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, delay));
}

async function waitForElement<T extends Element>(dom: JSDOM, read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value) return value;
    await act(async () => settle(dom, 10));
  }
  throw new Error("Timed out waiting for rendered preview.");
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
