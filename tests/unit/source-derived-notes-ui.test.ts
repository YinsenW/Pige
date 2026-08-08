import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDerivedNotesPanel } from "../../apps/desktop/src/renderer/src/components/SourceDerivedNotesPanel";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
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

describe("Source-derived note locator", () => {
  it("opens only the Main-projected derived page and never renders source bodies", async () => {
    const listSourceDerived = vi.fn(async (request: { readonly requestId: string; readonly sourceId: string }) => ({
      apiVersion: 1 as const, requestId: request.requestId, status: "ready" as const, sourceId: request.sourceId,
      pages: [{ pageId: "page_20260808_derived001", title: "Derived note", pageType: "note" as const, updatedAt: "2026-08-08T00:00:00.000Z" }]
    }));
    const onOpen = vi.fn(async () => undefined);
    const harness = await mount({ listSourceDerived, onOpen });
    expect(harness.container.textContent).toContain("Referenced by");
    await act(async () => { await settle(harness.dom); });
    expect(listSourceDerived).toHaveBeenCalledWith(expect.objectContaining({
      currentPageId: "page_20260808_source001", sourceId: "src_20260808_source001"
    }));
    expect(harness.container.textContent).toContain("Derived note");
    expect(harness.container.textContent).not.toContain("private source body");
    await act(async () => { harness.container.querySelector<HTMLButtonElement>("button")!.click(); await settle(harness.dom); });
    expect(onOpen).toHaveBeenCalledWith("page_20260808_derived001");
    await harness.unmount();
  });

  it("retains a body-free unavailable state when Main rejects the current source identity", async () => {
    const harness = await mount({
      listSourceDerived: vi.fn(async (request: { readonly requestId: string }) => ({
        apiVersion: 1 as const, requestId: request.requestId, status: "changed" as const
      })),
      onOpen: vi.fn(async () => undefined)
    });
    await act(async () => { await settle(harness.dom); });
    expect(harness.container.textContent).toContain("Related notes are unavailable.");
    expect(harness.container.querySelector("button")).toBeNull();
    await harness.unmount();
  });
});

async function mount(input: {
  readonly listSourceDerived: ReturnType<typeof vi.fn>;
  readonly onOpen: ReturnType<typeof vi.fn>;
}): Promise<{ readonly dom: JSDOM; readonly root: Root; readonly container: HTMLElement; unmount(): Promise<void> }> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  Object.assign(dom.window, { pige: { notes: { listSourceDerived: input.listSourceDerived } } });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!, root = createRoot(container);
  await act(async () => {
    root.render(createElement(SourceDerivedNotesPanel, {
      activeVaultId: "vault_20260808_abcdefgh", sourceId: "src_20260808_source001", onOpen: input.onOpen,
      t: (key: string) => ({ "note.backlinks": "Referenced by", "note.relatedLoading": "Reading related notes…",
        "note.relatedUnavailable": "Related notes are unavailable.", "note.relatedEmpty": "No related notes yet.",
        "note.open": "Open", "note.opening": "Opening…", "library.type.note": "Note" }[key] ?? key),
      note: {
        summary: { pageId: "page_20260808_source001", title: "Source", pageType: "source", status: "active", pagePath: "sources/source.md",
          sourceIds: ["src_20260808_source001"], tags: [], aliases: [], createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" },
        html: "<p>private source body</p>", byteSize: 32, renderContextId: `notectx_${"a".repeat(32)}`
      } as never
    }));
    await settle(dom);
  });
  return { dom, root, container, async unmount() { await act(async () => root.unmount()); dom.window.close(); } };
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve(); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); await Promise.resolve();
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true, value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}
