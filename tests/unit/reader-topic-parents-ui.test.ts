import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult } from "@pige/contracts";
import { ReaderTopicParents } from "../../apps/desktop/src/renderer/src/components/ReaderTopicParents";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent",
  "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderTopicParents", () => {
  it("searches, adds, and fences duplicate activation", async () => {
    const search = vi.fn(async (value) => ({ ...value, status: "ready" as const, candidates: [parentItem()] }));
    const change = vi.fn(async (value) => ({ ...value, status: "committed" as const,
      operationId: "op_20260801_topicparent1", render: topicRender([parentItem()], "b") }));
    const committed = vi.fn(); const harness = await mount(topicRender(), search, change, committed);
    const input = harness.container.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "value")
      ?.set?.call(input, "Broader"); input.dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true,
        data: "Broader", inputType: "insertText" })); input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
      await settle(harness.dom); });
    const searchButton = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.topicParents.search")!;
    await act(async () => { searchButton.click(); searchButton.click(); await settle(harness.dom); });
    expect(search).toHaveBeenCalledTimes(1);
    const add = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Broader topic"))!;
    await act(async () => { add.click(); add.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", targetPageId: parentItem().pageId,
      expectedTargetUpdatedAt: parentItem().updatedAt }));
    expect(committed).toHaveBeenCalledWith(topicRender([parentItem()], "b"));
    await harness.unmount();
  });

  it("preserves the current Reader and exact trigger focus after stale removal", async () => {
    const change = vi.fn(async (value) => ({ ...value, status: "stale" as const }));
    const harness = await mount(topicRender([parentItem()]), vi.fn(), change, vi.fn());
    const remove = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.topicParents.remove")!;
    remove.focus(); await act(async () => { remove.click(); await settle(harness.dom); });
    expect(harness.container.textContent).toContain("Broader topic");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("note.topicParents.notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove);
    await harness.unmount();
  });
});

async function mount(note: NoteRenderResult, search: Parameters<typeof ReaderTopicParents>[0]["search"],
  change: Parameters<typeof ReaderTopicParents>[0]["change"], onCommitted: Parameters<typeof ReaderTopicParents>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame"
      ? (callback: FrameRequestCallback) => { callback(0); return 1; } : dom.window[key as keyof Window] }); }
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"); const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderTopicParents, { activeVaultId: "vault_20260801_topics",
    note, search, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}
function topicRender(items: readonly ReturnType<typeof parentItem>[] = [], revision = "a"): NoteRenderResult { return {
  summary: { pageId: "page_20260801_topic001", title: "Topic", pageType: "topic", status: "active",
    pagePath: "wiki/topic.md", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] },
  html: "<h1>Topic</h1>", byteSize: 64, renderContextId: `notectx_${revision.repeat(32)}`,
  topicParents: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } }; }
function parentItem() { return { pageId: "page_20260801_topic002", title: "Broader topic",
  updatedAt: "2026-08-01T11:00:00.000Z" }; }
async function settle(dom: JSDOM): Promise<void> { await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
