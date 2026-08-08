import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteChangeConceptParentResult, NoteRenderResult } from "@pige/contracts";
import { ReaderConceptParents } from "../../apps/desktop/src/renderer/src/components/ReaderConceptParents";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent",
  "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderConceptParents", () => {
  it("searches, adds, and fences duplicate activation", async () => {
    const search = vi.fn(async (value) => ({ ...value, status: "ready" as const, candidates: [parentItem()] }));
    const change = vi.fn(async (value) => ({ ...value, status: "committed" as const,
      operationId: "op_20260801_conceptparent1", render: conceptRender([parentItem()], "b") }));
    const committed = vi.fn(); const harness = await mount(conceptRender(), search, change, committed);
    const input = harness.container.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "value")
      ?.set?.call(input, "Broader"); input.dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true,
        data: "Broader", inputType: "insertText" })); input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
      await settle(harness.dom); });
    const searchButton = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.conceptParents.search")!;
    await act(async () => { searchButton.click(); searchButton.click(); await settle(harness.dom); });
    expect(search).toHaveBeenCalledTimes(1);
    const add = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Broader idea"))!;
    await act(async () => { add.click(); add.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", targetPageId: parentItem().pageId,
      expectedTargetUpdatedAt: parentItem().updatedAt }));
    expect(committed).toHaveBeenCalledWith(conceptRender([parentItem()], "b"));
    await harness.unmount();
  });

  it("preserves Reader state and focus after stale removal", async () => {
    const change = vi.fn(async (value) => ({ ...value, status: "stale" as const }));
    const harness = await mount(conceptRender([parentItem()]), vi.fn(), change, vi.fn());
    const remove = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.conceptParents.remove")!;
    remove.focus(); await act(async () => { remove.click(); await settle(harness.dom); });
    expect(harness.container.textContent).toContain("Broader idea");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("note.conceptParents.notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove);
    await harness.unmount();
  });

  it("restores the current parent action focus after owner drift", async () => {
    const changeResult = deferred<NoteChangeConceptParentResult>();
    const change = vi.fn(async () => changeResult.promise);
    const harness = await mount(conceptRender([parentItem()]), vi.fn(), change, vi.fn());
    const oldRemove = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.conceptParents.remove")!;
    oldRemove.focus();
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true,
      value: (callback: FrameRequestCallback) => { harness.dom.window.setTimeout(() => callback(0), 0); return 1; } });
    await act(async () => {
      oldRemove.click();
      harness.root.render(createElement(ReaderConceptParents, { activeVaultId: "vault_20260801_concepts",
        note: conceptRender([parentItem("page_20260801_concept03", "New broader idea")], "b"),
        search: vi.fn(), change, onCommitted: vi.fn(), t: (key) => key }));
      await settle(harness.dom);
    });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await settle(harness.dom); });
    }
    const replacement = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.conceptParents.remove")!;
    expect(replacement).not.toBe(oldRemove);
    expect(harness.container.textContent).not.toContain("Broader idea");
    expect(harness.container.textContent).toContain("New broader idea");
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    const request = change.mock.calls[0]![0];
    changeResult.resolve({ ...request, status: "stale" });
    await act(async () => { await changeResult.promise; await settle(harness.dom); });
    expect(harness.container.textContent).toContain("New broader idea");
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    await harness.unmount();
  });
});

async function mount(note: NoteRenderResult, search: Parameters<typeof ReaderConceptParents>[0]["search"],
  change: Parameters<typeof ReaderConceptParents>[0]["change"], onCommitted: Parameters<typeof ReaderConceptParents>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame"
      ? (callback: FrameRequestCallback) => { callback(0); return 1; } : dom.window[key as keyof Window] }); }
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"); const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderConceptParents, { activeVaultId: "vault_20260801_concepts",
    note, search, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}
function conceptRender(items: readonly ReturnType<typeof parentItem>[] = [], revision = "a"): NoteRenderResult { return {
  summary: { pageId: "page_20260801_concept01", title: "Concept", pageType: "concept", status: "active",
    pagePath: "wiki/concept.md", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] },
  html: "<h1>Concept</h1>", byteSize: 64, renderContextId: `notectx_${revision.repeat(32)}`,
  conceptParents: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } }; }
function parentItem(pageId = "page_20260801_concept02", title = "Broader idea") { return { pageId, title,
  updatedAt: "2026-08-01T11:00:00.000Z" }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
async function settle(dom: JSDOM): Promise<void> { await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
