import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult, NoteRemoveTagRequest } from "@pige/contracts";
import { ReaderNoteTagDialog, submitReaderNoteTagRemoval } from "../../apps/desktop/src/renderer/src/components/ReaderNoteTagDialog";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("Reader note tag removal", () => {
  it("binds the exact Reader revision and adopts only an authoritative tag-free render", async () => {
    const dom = createDom();
    const requests: NoteRemoveTagRequest[] = [];
    const result = await submitReaderNoteTagRemoval({ note, activeVaultId: "vault_20260731_tags", tag: "Research note",
      submit: async (request) => { requests.push(request); return { ...request, status: "committed", operationId: "op_20260731_removetagui01", render: untaggedNote }; },
      currentNote: () => note });
    expect(result).toEqual({ status: "committed", render: untaggedNote });
    expect(requests[0]).toMatchObject({ activeVaultId: "vault_20260731_tags", currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId, expectedRevision: note.tagging?.revision, tag: "Research note" });
    expect(requests[0]?.requestId).toMatch(/^noteremovetagreq_[a-z0-9]{16,64}$/u);
    const retained = await submitReaderNoteTagRemoval({ note, activeVaultId: "vault_20260731_tags", tag: "Research note",
      submit: async (request) => ({ ...request, status: "stale" }), currentNote: () => note });
    expect(retained).toEqual({ status: "retained" });
    dom.window.close();
  });

  it("requires confirmation and submits one removal before adopting the returned render", async () => {
    const dom = createDom(); const root = createRoot(dom.window.document.querySelector("#root")!);
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    const onRemove = vi.fn(async () => { await pending; return { status: "committed" as const, render: untaggedNote }; });
    const onCommitted = vi.fn();
    await act(async () => { root.render(createElement(ReaderNoteTagDialog, { ownerIdentity: "owner:tag", existingTags: ["Research note"], existingTopics: [],
      labels, returnFocusRef: createRef<HTMLButtonElement>(), onEdit: async () => ({ status: "retained" }),
      onRemove, onCancel: vi.fn(), onCommitted })); await settle(dom); });
    await click(dom, button(dom, "Remove tag"));
    const confirm = button(dom, "Confirm remove");
    await act(async () => { confirm.click(); confirm.click(); await settle(dom); });
    expect(onRemove).toHaveBeenCalledOnce();
    await act(async () => { release(); await pending; await settle(dom); });
    expect(onCommitted).toHaveBeenCalledWith(untaggedNote);
    await act(async () => root.unmount()); dom.window.close();
  });
});

const note = {
  summary: { pageId: "page_20260731_tagremove", title: "Tagged", pageType: "note" as const, status: "active" as const,
    pagePath: "wiki/tagged.md", createdAt: "2026-07-31T09:00:00.000Z", updatedAt: "2026-07-31T10:00:00.000Z", sourceIds: [] },
  html: "<h1>Tagged</h1>", byteSize: 64, renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  tagging: { tags: ["Research note"], topics: [], canAdd: true, canEdit: true, revision: `noteeditrev_${"a".repeat(64)}` },
} satisfies NoteRenderResult;
const untaggedNote = { ...note, renderContextId: "notectx_fedcba9876543210fedcba9876543210",
  tagging: { tags: [], topics: [], canAdd: true, canEdit: true, revision: `noteeditrev_${"b".repeat(64)}` } } satisfies NoteRenderResult;
const labels = { title: "Tags and topics", description: "Manage taxonomy", tagsField: "Tags", tagsPlaceholder: "Tags",
  topicsField: "Topics", topicsPlaceholder: "Topics", cancel: "Cancel", confirm: "Save",
  pending: "Saving", failed: "Save failed", remove: "Remove tag", removeTitle: "Remove tag?", removeDescription: "Undo in Activity.",
  removeConfirm: "Confirm remove", removePending: "Removing", removeFailed: "Remove failed" };

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  const raf = (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(0), 0);
  Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: raf });
  Object.defineProperty(dom.window.crypto, "randomUUID", { configurable: true, value: () => "01234567-89ab-cdef-0123-456789abcdef" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "requestAnimationFrame" ? raf : dom.window[key] }); }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true }); return dom;
}
function button(dom: JSDOM, name: string): HTMLButtonElement { const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name); if (!found) throw new Error(`Missing ${name}`); return found; }
async function click(dom: JSDOM, target: HTMLButtonElement): Promise<void> { await act(async () => { target.click(); await settle(dom); }); }
async function settle(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
