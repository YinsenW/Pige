import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult } from "@pige/contracts";
import { ReaderClaimSupports } from "../../apps/desktop/src/renderer/src/components/ReaderClaimSupports";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent", "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderClaimSupports", () => {
  it("requires confirmation and adopts only the authoritative directed support render", async () => {
    const search = vi.fn(async (request) => ({ ...request, status: "ready" as const, candidates: [item()] }));
    const change = vi.fn(async (request) => ({ ...request, status: "committed" as const, operationId: "op_20260808_claimsupport1", render: render([item()], "b") }));
    const committed = vi.fn(), harness = await mount(render(), search, change, committed), input = harness.container.querySelector("input")!;
    await act(async () => { setInput(harness.dom, input, "Support"); await settle(harness.dom); });
    await act(async () => { const searchButton = button(harness.container, "note.claimSupports.search"); searchButton.click(); searchButton.click(); await settle(harness.dom); });
    expect(search).toHaveBeenCalledTimes(1);
    const add = [...harness.container.querySelectorAll("button")].find((node) => node.textContent?.includes("Supporting claim"))!;
    await act(async () => { add.click(); await settle(harness.dom); }); expect(change).not.toHaveBeenCalled();
    await act(async () => { button(harness.container, "note.claimSupports.confirm").click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", targetPageId: item().pageId, expectedTargetUpdatedAt: item().updatedAt }));
    expect(committed).toHaveBeenCalledWith(render([item()], "b")); await harness.unmount();
  });

  it("retains the current Claim and restores focus after stale removal", async () => {
    const change = vi.fn(async (request) => ({ ...request, status: "stale" as const })), harness = await mount(render([item()]), vi.fn(), change, vi.fn());
    const remove = button(harness.container, "note.claimSupports.remove"); remove.focus();
    await act(async () => { remove.click(); await settle(harness.dom); });
    await act(async () => { button(harness.container, "note.claimSupports.confirm").click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "remove", targetPageId: item().pageId }));
    expect(harness.container.textContent).toContain("Supporting claim");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("note.claimSupports.notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove); await harness.unmount();
  });
});

async function mount(note: NoteRenderResult, search: Parameters<typeof ReaderClaimSupports>[0]["search"], change: Parameters<typeof ReaderClaimSupports>[0]["change"], onCommitted: Parameters<typeof ReaderClaimSupports>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame" ? (callback: FrameRequestCallback) => { callback(0); return 1; } : dom.window[key as keyof Window] }); }
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } }); Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"), root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderClaimSupports, { activeVaultId: "vault_20260808_claims", note, search, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!, unmount: async () => act(async () => root.unmount()) };
}
function render(items: readonly ReturnType<typeof item>[] = [], revision = "a"): NoteRenderResult { return { summary: { pageId: "page_20260808_claim0001", title: "Claim", pageType: "claim", status: "active", pagePath: "wiki/claim.md", createdAt: "2026-08-08T10:00:00.000Z", updatedAt: "2026-08-08T10:00:00.000Z", sourceIds: ["src_20260808_claimbase"] }, html: "<h1>Claim</h1>", byteSize: 64, renderContextId: `notectx_${revision.repeat(32)}`, claimSupports: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } }; }
function item() { return { pageId: "page_20260808_claim0002", title: "Supporting claim", updatedAt: "2026-08-08T11:00:00.000Z" }; }
function button(root: Element, label: string): HTMLButtonElement { return [...root.querySelectorAll("button")].find((node) => node.textContent === label) as HTMLButtonElement; }
function setInput(dom: JSDOM, input: HTMLInputElement, value: string): void { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" })); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }
async function settle(dom: JSDOM): Promise<void> { await Promise.resolve(); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
