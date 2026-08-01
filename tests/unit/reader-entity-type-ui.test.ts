import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult, NoteSetEntityTypeResult } from "@pige/contracts";
import { ReaderEntityTypeControl } from "../../apps/desktop/src/renderer/src/components/ReaderEntityTypeControl";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of globals) { const descriptor = originals.get(key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderEntityTypeControl", () => {
  it("submits one immutable choice and adopts only the authoritative Entity render", async () => {
    const pending = deferred<NoteSetEntityTypeResult>(), submit = vi.fn(async () => pending.promise), committed = vi.fn();
    const harness = await mount(entityRender(), submit, committed), select = harness.container.querySelector("select")!;
    await act(async () => { choose(harness.dom, select, "person"); choose(harness.dom, select, "event"); await settle(harness.dom); });
    expect(submit).toHaveBeenCalledTimes(1); const request = submit.mock.calls[0]![0];
    expect(request).toMatchObject({ activeVaultId: "vault_20260801_entity", currentPageId: "page_20260801_entity01",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`, entityType: "person" });
    await act(async () => { pending.resolve({ ...request, status: "committed", operationId: "op_20260801_entitytype1",
      render: entityRender("person", "b") }); await pending.promise; await settle(harness.dom); });
    expect(committed).toHaveBeenCalledWith(entityRender("person", "b"));
    expect(harness.dom.window.document.activeElement).toBe(select); await harness.unmount();
  });

  it("retains the attempted choice and focus after stale or failed outcomes", async () => {
    for (const status of ["stale", "failed"] as const) {
      const harness = await mount(entityRender(), vi.fn(async (request) => ({ ...request, status } as const)), vi.fn());
      const select = harness.container.querySelector("select")!; select.focus();
      await act(async () => { choose(harness.dom, select, "organization"); await settle(harness.dom); });
      expect((select as HTMLSelectElement).value).toBe("organization");
      expect(harness.dom.window.document.activeElement).toBe(select); await harness.unmount();
    }
  });

  it("fences a late response after the Reader identity changes", async () => {
    const pending = deferred<NoteSetEntityTypeResult>(), submit = vi.fn(async () => pending.promise), committed = vi.fn();
    const harness = await mount(entityRender(), submit, committed);
    await act(async () => { choose(harness.dom, harness.container.querySelector("select")!, "place"); await settle(harness.dom);
      harness.root.render(createElement(ReaderEntityTypeControl, props(entityRender("other", "c", "page_20260801_entity02"), submit, committed)));
      await settle(harness.dom); });
    const request = submit.mock.calls[0]![0];
    await act(async () => { pending.resolve({ ...request, status: "committed", operationId: "op_20260801_entitytype1",
      render: entityRender("place", "b") }); await pending.promise; await settle(harness.dom); });
    expect(committed).not.toHaveBeenCalled(); expect((harness.container.querySelector("select") as HTMLSelectElement).value).toBe("other");
    await harness.unmount();
  });
});

function props(note: NoteRenderResult, onSetType: Parameters<typeof ReaderEntityTypeControl>[0]["onSetType"],
  onCommitted: Parameters<typeof ReaderEntityTypeControl>[0]["onCommitted"]) {
  return { activeVaultId: "vault_20260801_entity", note, onSetType, onCommitted, t: (key: string) => key };
}
async function mount(note: NoteRenderResult, onSetType: Parameters<typeof ReaderEntityTypeControl>[0]["onSetType"],
  onCommitted: Parameters<typeof ReaderEntityTypeControl>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" }); installDom(dom);
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderEntityTypeControl, props(note, onSetType, onCommitted))));
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}
function entityRender(entityType: "other" | "person" | "organization" | "place" = "other", revision = "a",
  pageId = "page_20260801_entity01"): NoteRenderResult { return { summary: { pageId, title: "Entity", pageType: "entity",
  status: "active", pagePath: "entities/entity.md", createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] }, html: "<h1>Entity</h1>", byteSize: 64,
  renderContextId: revision === "a" ? "notectx_0123456789abcdef0123456789abcdef" : `notectx_${revision.repeat(32)}`,
  entityType: { entityType, canChange: true, revision: `noteeditrev_${revision.repeat(64)}` } }; }
function choose(dom: JSDOM, select: Element, value: string) { (select as HTMLSelectElement).value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
async function settle(dom: JSDOM) { await Promise.resolve(); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
function installDom(dom: JSDOM) { for (const key of globals) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] }); }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true }); }
