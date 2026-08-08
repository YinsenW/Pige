import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteChangeClaimContradictionResult, NoteRenderResult } from "@pige/contracts";
import { ReaderClaimContradictions } from "../../apps/desktop/src/renderer/src/components/ReaderClaimContradictions";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent", "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("ReaderClaimContradictions", () => {
  it("requires explicit confirmation and submits one exact sourced candidate", async () => {
    const search = vi.fn(async (request) => ({ ...request, status: "ready" as const, candidates: [item()] }));
    const change = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_claimrelation1", render: render([item()], "b") }));
    const committed = vi.fn(), harness = await mount(render(), search, change, committed);
    const input = harness.container.querySelector("input")!;
    await act(async () => { setInput(harness.dom, input, "Conflict"); await settle(harness.dom); });
    const searchButton = button(harness.container, "note.claimContradictions.search");
    await act(async () => { searchButton.click(); searchButton.click(); await settle(harness.dom); });
    expect(search).toHaveBeenCalledTimes(1);
    const add = [...harness.container.querySelectorAll("button")].find((node) => node.textContent?.includes("Conflicting claim"))!;
    await act(async () => { add.click(); await settle(harness.dom); });
    expect(change).not.toHaveBeenCalled();
    await act(async () => { button(harness.container, "note.claimContradictions.confirm").click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", targetPageId: item().pageId,
      expectedTargetUpdatedAt: item().updatedAt }));
    expect(committed).toHaveBeenCalledWith(render([item()], "b"));
    await harness.unmount();
  });

  it("retains the current claim and restores trigger focus after stale removal", async () => {
    const change = vi.fn(async (request) => ({ ...request, status: "stale" as const }));
    const harness = await mount(render([item()]), vi.fn(), change, vi.fn());
    const remove = button(harness.container, "note.claimContradictions.remove"); remove.focus();
    await act(async () => { remove.click(); await settle(harness.dom); });
    await act(async () => { button(harness.container, "note.claimContradictions.confirm").click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "remove", targetPageId: item().pageId }));
    expect(harness.container.textContent).toContain("Conflicting claim");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("note.claimContradictions.notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove);
    await harness.unmount();
  });

  it("restores the current contradiction action focus after owner drift", async () => {
    const changeResult = deferred<NoteChangeClaimContradictionResult>();
    const change = vi.fn(async () => changeResult.promise);
    const harness = await mount(render([item()]), vi.fn(), change, vi.fn());
    const oldRemove = button(harness.container, "note.claimContradictions.remove");
    oldRemove.focus();
    await act(async () => { oldRemove.click(); await settle(harness.dom); });
    await act(async () => { button(harness.container, "note.claimContradictions.confirm").click(); await settle(harness.dom); });
    expect(change).toHaveBeenCalledTimes(1);
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true,
      value: (callback: FrameRequestCallback) => { harness.dom.window.setTimeout(() => callback(0), 0); return 1; } });
    await act(async () => { harness.root.render(createElement(ReaderClaimContradictions, { activeVaultId: "vault_20260801_claims",
      note: render([{ ...item(), pageId: "page_20260801_claim0003", title: "New conflicting claim" }], "b"), search: vi.fn(), change,
      onCommitted: vi.fn(), t: (key) => key })); await settle(harness.dom); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await settle(harness.dom); });
    const replacement = button(harness.container, "note.claimContradictions.remove");
    expect(harness.container.textContent).not.toContain("Conflicting claim");
    expect(harness.container.textContent).toContain("New conflicting claim");
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    const request = change.mock.calls[0]![0];
    changeResult.resolve({ ...request, status: "stale" });
    await act(async () => { await changeResult.promise; await settle(harness.dom); });
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    await harness.unmount();
  });
});

async function mount(note: NoteRenderResult, search: Parameters<typeof ReaderClaimContradictions>[0]["search"],
  change: Parameters<typeof ReaderClaimContradictions>[0]["change"], onCommitted: Parameters<typeof ReaderClaimContradictions>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame"
      ? (callback: FrameRequestCallback) => { callback(0); return 1; } : dom.window[key as keyof Window] }); }
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"), root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => root.render(createElement(ReaderClaimContradictions, { activeVaultId: "vault_20260801_claims",
    note, search, change, onCommitted, t: (key) => key })));
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}
function render(items: readonly ReturnType<typeof item>[] = [], revision = "a"): NoteRenderResult {
  return { summary: { pageId: "page_20260801_claim0001", title: "Claim", pageType: "claim", status: "active",
    pagePath: "wiki/claim.md", createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z",
    sourceIds: ["src_20260801_claimbase"] }, html: "<h1>Claim</h1>", byteSize: 64,
    renderContextId: `notectx_${revision.repeat(32)}`,
    claimContradictions: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } };
}
function item() { return { pageId: "page_20260801_claim0002", title: "Conflicting claim",
  updatedAt: "2026-08-01T11:00:00.000Z" }; }
function button(root: Element, label: string): HTMLButtonElement { return [...root.querySelectorAll("button")]
  .find((node) => node.textContent === label) as HTMLButtonElement; }
function setInput(dom: JSDOM, input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
async function settle(dom: JSDOM): Promise<void> { await Promise.resolve(); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
