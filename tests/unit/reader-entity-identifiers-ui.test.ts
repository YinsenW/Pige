import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteChangeEntityIdentifierResult, NoteReadEntityIdentifiersResult, NoteRenderResult } from "@pige/contracts";
import { ReaderEntityIdentifiers } from "../../apps/desktop/src/renderer/src/components/ReaderEntityIdentifiers";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent", "requestAnimationFrame", "crypto"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderEntityIdentifiers", () => {
  it("reads and adds one canonical identifier only through the current Entity render", async () => {
    const read = vi.fn(async (request) => ({ ...request, status: "ready" as const, identifiers: ["wikidata:Q42"], canEdit: true, revision: request.expectedRevision }));
    const change = vi.fn(async (request) => ({ ...request, status: "committed" as const, operationId: "op_20260801_entityidentifier1", render: entityRender("b") }));
    const committed = vi.fn(), harness = await mount(read, change, committed);
    await settle(harness.dom);
    const input = harness.container.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "value")?.set?.call(input, "orcid:0000-0002-1825-0097"); input.dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true, data: "orcid:0000-0002-1825-0097", inputType: "insertText" })); });
    const add = [...harness.container.querySelectorAll("button")].find((button) => button.textContent === "note.entityIdentifiers.add")!;
    await act(async () => { add.click(); add.click(); await settle(harness.dom); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", identifier: "orcid:0000-0002-1825-0097" }));
    expect(committed).toHaveBeenCalledWith(entityRender("b"));
    await harness.unmount();
  });

  it("preserves the visible identifiers after a stale removal", async () => {
    const read = vi.fn(async (request) => ({ ...request, status: "ready" as const, identifiers: ["wikidata:Q42"], canEdit: true, revision: request.expectedRevision }));
    const change = vi.fn(async (request) => ({ ...request, status: "stale" as const }));
    const harness = await mount(read, change, vi.fn()); await settle(harness.dom);
    const remove = [...harness.container.querySelectorAll("button")].find((button) => button.textContent === "note.entityIdentifiers.remove")!;
    await act(async () => { remove.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "remove", identifier: "wikidata:Q42" }));
    expect(harness.container.textContent).toContain("wikidata:Q42");
    await harness.unmount();
  });

  it("clears the old owner while loading and restores input focus after owner drift", async () => {
    const firstRead = deferred<NoteReadEntityIdentifiersResult>();
    const secondRead = deferred<NoteReadEntityIdentifiersResult>();
    const changeResult = deferred<NoteChangeEntityIdentifierResult>();
    let readCount = 0;
    const read = vi.fn((request) => {
      readCount += 1;
      return readCount === 1 ? firstRead.promise : secondRead.promise;
    });
    const change = vi.fn(async () => changeResult.promise);
    const harness = await mount(read, change, vi.fn());
    const firstRequest = read.mock.calls[0]![0];
    firstRead.resolve({ ...firstRequest, status: "ready", identifiers: ["wikidata:Q42"], canEdit: true,
      revision: firstRequest.expectedRevision });
    await act(async () => { await settle(harness.dom); });
    expect(harness.container.textContent).toContain("wikidata:Q42");
    const input = harness.container.querySelector("input")! as HTMLInputElement;
    const remove = [...harness.container.querySelectorAll("button")].find((button) =>
      button.textContent === "note.entityIdentifiers.remove")!;
    await act(async () => { remove.click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    await act(async () => {
      harness.root.render(createElement(ReaderEntityIdentifiers, {
        activeVaultId: "vault_20260801_entity", note: entityRender("b"), read, change,
        onCommitted: vi.fn(), t: (key) => key
      }));
      await settle(harness.dom);
    });
    expect(harness.container.textContent).not.toContain("wikidata:Q42");
    expect(read).toHaveBeenCalledTimes(2);
    const secondRequest = read.mock.calls[1]![0];
    secondRead.resolve({ ...secondRequest, status: "ready", identifiers: ["orcid:0000-0002-1825-0097"], canEdit: true,
      revision: secondRequest.expectedRevision });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { await settle(harness.dom); });
    }
    expect(harness.container.textContent).not.toContain("wikidata:Q42");
    expect(harness.container.textContent).toContain("orcid:0000-0002-1825-0097");
    expect(harness.dom.window.document.activeElement).toBe(input);
    const changeRequest = change.mock.calls[0]![0];
    changeResult.resolve({ ...changeRequest, status: "stale" });
    await act(async () => { await changeResult.promise; await settle(harness.dom); });
    expect(harness.container.textContent).toContain("orcid:0000-0002-1825-0097");
    expect(harness.dom.window.document.activeElement).toBe(input);
    await harness.unmount();
  });
});

async function mount(read: Parameters<typeof ReaderEntityIdentifiers>[0]["read"], change: Parameters<typeof ReaderEntityIdentifiers>[0]["change"], onCommitted: Parameters<typeof ReaderEntityIdentifiers>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame" ? (callback: FrameRequestCallback) => { callback(0); return 1; } : key === "crypto" ? { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } : dom.window[key as keyof Window] }); }
  Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1; } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"), root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderEntityIdentifiers, { activeVaultId: "vault_20260801_entity", note: entityRender(), read, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!, unmount: async () => act(async () => root.unmount()) };
}
function entityRender(revision = "a"): NoteRenderResult { return { summary: { pageId: "page_20260801_entity01", title: "Entity", pageType: "entity", status: "active", pagePath: "entities/entity.md", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] }, html: "<h1>Entity</h1>", byteSize: 64, renderContextId: `notectx_${revision.repeat(32)}`, entityType: { entityType: "other", canChange: true, revision: `noteeditrev_${revision.repeat(64)}` } }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
async function settle(dom: JSDOM): Promise<void> { await Promise.resolve(); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
