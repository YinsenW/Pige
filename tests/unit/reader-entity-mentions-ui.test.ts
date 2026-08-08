import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult } from "@pige/contracts";
import { ReaderEntityMentions } from "../../apps/desktop/src/renderer/src/components/ReaderEntityMentions";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent", "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of keys) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("ReaderEntityMentions", () => {
  it("searches and adds one exact current page while fencing duplicate activation", async () => {
    const search = vi.fn(async (request) => ({ ...request, status: "ready" as const, candidates: [mentionItem()] }));
    const change = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260802_entitymention1", render: entityRender([mentionItem()], "b") }));
    const committed = vi.fn();
    const harness = await mount(entityRender(), search, change, committed);
    const input = harness.container.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("note.entityMentions.searchPlaceholder");
    await act(async () => {
      Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "value")?.set?.call(input, "Related");
      input.dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true, data: "Related", inputType: "insertText" }));
      input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
      await settle(harness.dom);
    });
    const searchButton = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.entityMentions.search")!;
    await act(async () => { searchButton.click(); searchButton.click(); await settle(harness.dom); });
    expect(search).toHaveBeenCalledTimes(1);
    const addButton = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Related note"))!;
    await act(async () => { addButton.click(); addButton.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", targetPageId: mentionItem().pageId,
      expectedTargetUpdatedAt: mentionItem().updatedAt }));
    expect(committed).toHaveBeenCalledWith(entityRender([mentionItem()], "b"));
    await harness.unmount();
  });

  it("retains the Entity Reader and restores exact focus after stale removal", async () => {
    const change = vi.fn(async (request) => ({ ...request, status: "stale" as const }));
    const harness = await mount(entityRender([mentionItem()]), vi.fn(), change, vi.fn());
    const remove = [...harness.container.querySelectorAll("button")]
      .find((button) => button.textContent === "note.entityMentions.remove")!;
    remove.focus();
    await act(async () => { remove.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "remove", targetPageId: mentionItem().pageId }));
    expect(harness.container.textContent).toContain("Related note");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("note.entityMentions.notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove);
    await harness.unmount();
  });
});

async function mount(note: NoteRenderResult, search: Parameters<typeof ReaderEntityMentions>[0]["search"],
  change: Parameters<typeof ReaderEntityMentions>[0]["change"],
  onCommitted: Parameters<typeof ReaderEntityMentions>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame"
      ? (callback: FrameRequestCallback) => { callback(0); return 1; }
      : dom.window[key as keyof Window] });
  }
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderEntityMentions, { activeVaultId: "vault_20260802_entity",
    note, search, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}

function entityRender(items: readonly ReturnType<typeof mentionItem>[] = [], revision = "a"): NoteRenderResult {
  return { summary: { pageId: "page_20260802_entity001", title: "Entity", pageType: "entity", status: "active",
    pagePath: "wiki/entity.md", createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z",
    sourceIds: [] }, html: "<h1>Entity</h1>", byteSize: 64, renderContextId: `notectx_${revision.repeat(32)}`,
    entityMentions: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } };
}
function mentionItem() { return { pageId: "page_20260802_note0001", title: "Related note", pageType: "note" as const,
  updatedAt: "2026-08-02T11:00:00.000Z" }; }
async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
