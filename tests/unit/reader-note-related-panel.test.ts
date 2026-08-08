import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryRelatedResult, NoteRenderResult, NoteUnlinkRelationRequest } from "@pige/contracts";
import { ReaderNoteRelatedPanel } from "../../apps/desktop/src/renderer/src/components/ReaderNoteRelatedPanel";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent", "requestAnimationFrame"] as const;
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

describe("Reader knowledge-page relationships", () => {
  it("submits one exact unlink and adopts only an authoritative committed render", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const committed = { ...note, renderContextId: "notectx_fedcba9876543210fedcba9876543210" };
    const submit = vi.fn(async (request: NoteUnlinkRelationRequest) => ({
      ...request, status: "committed" as const, operationId: "op_20260731_unlinkrelation01", render: committed,
    }));
    const onCommitted = vi.fn();
    await act(async () => { root.render(createElement(ReaderNoteRelatedPanel, {
      note, activeVaultId: "vault_20260731_unlink", related, loadingPageId: null,
      onOpen: async () => undefined, onUnlink: submit, onCommitted, t,
    })); await settle(dom); });
    await click(dom, button(dom, "Unlink"));
    await click(dom, button(dom, "Remove relationship"));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: "vault_20260731_unlink", currentPageId: note.summary.pageId,
      renderContextId: note.renderContextId, expectedRevision: note.trashEligibility?.revision,
      targetPageId: related.outgoing[0]!.summary.pageId,
      expectedTargetUpdatedAt: related.outgoing[0]!.summary.updatedAt,
    }));
    expect(onCommitted).toHaveBeenCalledWith(committed);
    expect(dom.window.document.querySelector("[role=alertdialog]")).toBeNull();
    await act(async () => root.unmount()); dom.window.close();
  });

  it("retains the exact relationship and body-free retry state on stale", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const submit = vi.fn(async (request: NoteUnlinkRelationRequest) => ({ ...request, status: "stale" as const }));
    await act(async () => { root.render(createElement(ReaderNoteRelatedPanel, {
      note, activeVaultId: "vault_20260731_unlink", related, loadingPageId: null,
      onOpen: async () => undefined, onUnlink: submit, t,
    })); await settle(dom); });
    await click(dom, button(dom, "Unlink"));
    await click(dom, button(dom, "Remove relationship"));
    expect(dom.window.document.querySelector("[role=alert]")?.textContent).toBe("The relationship could not be removed.");
    expect(button(dom, "Open")).toBeTruthy();
    expect(button(dom, "Unlink")).toBeTruthy();
    await act(async () => root.unmount()); dom.window.close();
  });

  it("closes unlink confirmation with Escape and restores focus to its relationship trigger", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(ReaderNoteRelatedPanel, {
      note, activeVaultId: "vault_20260731_unlink", related, loadingPageId: null,
      onOpen: async () => undefined, onUnlink: vi.fn(), t,
    })); await settle(dom); });
    const unlink = button(dom, "Unlink");
    unlink.focus();
    await click(dom, unlink);
    const dialog = dom.window.document.querySelector<HTMLElement>("[role=alertdialog]")!;
    expect(dom.window.document.activeElement?.textContent).toBe("Cancel");
    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await settle(dom);
    });
    expect(dom.window.document.querySelector("[role=alertdialog]")).toBeNull();
    expect(dom.window.document.activeElement).toBe(unlink);
    await act(async () => root.unmount()); dom.window.close();
  });

  it("renders pathless labels without offering mutation authority for derived or typed knowledge edges", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const derived = {
      ...related,
      totalOutgoing: 4,
      outgoing: [
        { ...related.outgoing[0]!, relationType: "links_to" as const },
        { ...related.outgoing[0]!, relationType: "mentions_entity" as const },
        { ...related.outgoing[0]!, relationType: "contradicts" as const },
        { ...related.outgoing[0]!, relationType: "answers" as const }
      ]
    } satisfies LibraryRelatedResult;
    await act(async () => { root.render(createElement(ReaderNoteRelatedPanel, {
      note, activeVaultId: "vault_20260731_unlink", related: derived, loadingPageId: null,
      onOpen: async () => undefined, onUnlink: vi.fn(), t,
    })); await settle(dom); });
    expect([...dom.window.document.querySelectorAll("button")].some((entry) => entry.textContent === "Unlink")).toBe(false);
    expect(dom.window.document.body.textContent).toContain("Contradicts this claim");
    expect(dom.window.document.body.textContent).toContain("Answers this question");
    expect(dom.window.document.body.textContent).not.toContain("wiki/target.md");
    await act(async () => root.unmount()); dom.window.close();
  });
});

const note = {
  summary: { pageId: "page_20260731_unlinksource", title: "Source", pageType: "claim" as const, status: "active" as const,
    pagePath: "wiki/source.md", createdAt: "2026-07-31T09:00:00.000Z", updatedAt: "2026-07-31T10:00:00.000Z", sourceIds: [] },
  html: "<h1>Source</h1>", byteSize: 64,
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  trashEligibility: { canTrash: true, revision: `sha256:${"a".repeat(64)}` },
} satisfies NoteRenderResult;

const related = {
  queriedAt: "2026-07-31T10:00:00.000Z", activeVaultId: "vault_20260731_unlink", pageId: note.summary.pageId,
  totalOutgoing: 1, totalBacklinks: 0, invalidPageCount: 0, degraded: false,
  outgoing: [{ relation: "outgoing" as const, relationType: "related_to" as const, summary: {
    pageId: "page_20260731_unlinktarget", title: "Target", pageType: "note" as const, status: "active" as const,
    updatedAt: "2026-07-31T10:01:00.000Z",
  } }], backlinks: [],
} satisfies LibraryRelatedResult;

function t(key: string): string {
  return ({ "note.related": "Related", "note.outgoingLinks": "Links to", "note.backlinks": "Referenced by",
    "note.open": "Open", "note.opening": "Opening", "note.unlink.action": "Unlink",
    "note.unlink.title": "Remove this relationship?", "note.unlink.description": "Only this relationship is removed.",
    "note.unlink.cancel": "Cancel", "note.unlink.confirm": "Remove relationship", "note.unlink.pending": "Removing...",
    "note.unlink.failed": "The relationship could not be removed.", "note.relatedLoading": "Loading",
    "note.relatedUnavailable": "Unavailable", "note.relatedEmpty": "Empty",
    "note.relatedType.links_to": "Wiki link", "note.relatedType.related_to": "Related page",
    "note.relatedType.mentions_entity": "Entity mention", "note.relatedType.broader_than": "Broader concept",
    "note.relatedType.answers": "Answers this question",
    "note.relatedType.contradicts": "Contradicts this claim", "note.relatedType.supersedes": "Supersedes this claim" } as Record<string, string>)[key] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  const requestAnimationFrame = (callback: FrameRequestCallback): number => dom.window.setTimeout(() => callback(0), 0);
  Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: requestAnimationFrame });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true,
      value: key === "requestAnimationFrame" ? requestAnimationFrame : dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.crypto, "randomUUID", { configurable: true, value: () => "01234567-89ab-cdef-0123-456789abcdef" });
  return dom;
}

function button(dom: JSDOM, name: string): HTMLButtonElement {
  const match = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent === name);
  if (!match) throw new Error(`Missing button: ${name}`);
  return match;
}
async function click(dom: JSDOM, target: HTMLButtonElement): Promise<void> {
  await act(async () => { target.click(); await settle(dom); });
}
async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
