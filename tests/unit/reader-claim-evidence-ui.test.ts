import { createElement } from "react";
import { JSDOM } from "jsdom";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteChangeClaimEvidenceResult } from "@pige/contracts";
import { ReaderClaimEvidence } from "../../apps/desktop/src/renderer/src/components/ReaderClaimEvidence";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "Event", "InputEvent",
  "requestAnimationFrame"] as const;
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalGlobals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalGlobals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("ReaderClaimEvidence", () => {
  it("adds one chosen Source once and adopts only the authoritative Claim render", async () => {
    const change = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260802_claimevidence1", render: note([candidate]) }));
    const harness = await mount(vi.fn(async (request) => ({ ...request, status: "ready" as const,
      candidates: [candidate] })), change);
    await act(async () => { setInput(harness.dom, input(harness, "searchPlaceholder"), "Evidence"); await settle(); });
    await act(async () => { button(harness, "search").click(); await settle(); });
    const add = [...harness.container.querySelectorAll("button")].find((node) => node.textContent?.includes("Evidence source"))!;
    add.focus();
    await act(async () => add.click());
    await act(async () => { button(harness, "confirm").click(); button(harness, "confirm").click(); await settle(); });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ action: "add", sourcePageId: candidate.sourcePageId,
      sourceId: candidate.sourceId, expectedSourceUpdatedAt: candidate.updatedAt }));
    expect(harness.committed).toHaveBeenCalledWith(expect.objectContaining({
      claimEvidence: expect.objectContaining({ items: [candidate] })
    }));
    await harness.unmount();
  });

  it("retains the evidence and restores focus after stale removal", async () => {
    const harness = await mount(vi.fn(), vi.fn(async (request) => ({ ...request, status: "stale" as const })), [candidate,
      { ...candidate, sourcePageId: "page_20260802_secondsource", sourceId: "src_20260802_secondsource", title: "Second source" }]);
    const remove = button(harness, "remove"); remove.focus();
    await act(async () => remove.click());
    await act(async () => { button(harness, "confirm").click(); await settle(); });
    expect(harness.container.textContent).toContain("notice.stale");
    expect(harness.dom.window.document.activeElement).toBe(remove);
    await harness.unmount();
  });

  it("restores section focus after a pending confirmation owner changes", async () => {
    const changeResult = deferred<NoteChangeClaimEvidenceResult>();
    const change = vi.fn(async () => changeResult.promise);
    const harness = await mount(vi.fn(), change, [candidate, { ...candidate,
      sourcePageId: "page_20260802_secondsource", sourceId: "src_20260802_secondsource", title: "Second source" }]);
    const oldRemove = button(harness, "remove");
    oldRemove.focus();
    await act(async () => { oldRemove.click(); await settle(); });
    await act(async () => { button(harness, "confirm").click(); await settle(); });
    expect(change).toHaveBeenCalledTimes(1);
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true,
      value: (callback: FrameRequestCallback) => { harness.dom.window.setTimeout(() => callback(0), 0); return 1; } });
    await act(async () => harness.root.render(createElement(ReaderClaimEvidence, { activeVaultId: "vault_20260802_claimevidence",
      note: note([{ ...candidate, sourcePageId: "page_20260802_newsource", sourceId: "src_20260802_newsource", title: "New source" }], "b"),
      search: vi.fn(), change, onCommitted: harness.committed, t: (key: string) => key.replace("note.claimEvidence.", "") })));
    for (let i = 0; i < 4; i += 1) await act(async () => { await settle(); });
    const section = harness.container.querySelector("section")!;
    expect(harness.container.textContent).toContain("New source");
    expect(harness.container.textContent).not.toContain("Evidence source");
    expect(harness.dom.window.document.activeElement).toBe(section);
    const request = change.mock.calls[0]![0];
    changeResult.resolve({ ...request, status: "stale" });
    await act(async () => { await changeResult.promise; await settle(); });
    expect(harness.dom.window.document.activeElement).toBe(section);
    await harness.unmount();
  });
});

const candidate = { sourcePageId: "page_20260802_evidencesource", sourceId: "src_20260802_evidencesource",
  title: "Evidence source", updatedAt: "2026-08-02T10:00:00.000Z" };
async function mount(search: Parameters<typeof ReaderClaimEvidence>[0]["search"],
  change: Parameters<typeof ReaderClaimEvidence>[0]["change"], items: readonly typeof candidate[] = []) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://pige.test" });
  for (const key of globalKeys) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "requestAnimationFrame"
      ? (callback: FrameRequestCallback) => { callback(0); return 1; } : dom.window[key as keyof Window] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!, committed = vi.fn(), root = createRoot(container);
  await act(async () => root.render(createElement(ReaderClaimEvidence, { activeVaultId: "vault_20260802_claimevidence",
    note: note(items), search, change, onCommitted: committed, t: (key: string) => key.replace("note.claimEvidence.", "") })));
  return { dom, root, container, committed, unmount: async () => act(async () => root.unmount()) };
}
function note(items: readonly typeof candidate[], revision = "a") { return { summary: { pageId: "page_20260802_claimevidence", title: "Claim",
  pageType: "claim" as const, status: "active" as const, pagePath: "wiki/claim.md",
  createdAt: "2026-08-02T09:00:00.000Z", updatedAt: "2026-08-02T09:00:00.000Z", sourceIds: items.map(({ sourceId }) => sourceId) },
  html: "<h1>Claim</h1>", byteSize: 80, renderContextId: `notectx_${revision.repeat(32)}`,
  claimEvidence: { canEdit: true, revision: `noteeditrev_${revision.repeat(64)}`, items } }; }
function button(harness: { container: HTMLElement }, text: string): HTMLButtonElement { return [...harness.container.querySelectorAll("button")]
  .find((node) => node.textContent === text) as HTMLButtonElement; }
function input(harness: { container: HTMLElement }, placeholder: string): HTMLInputElement {
  return harness.container.querySelector(`input[placeholder="${placeholder}"]`)!;
}
async function settle(): Promise<void> { await Promise.resolve(); await new Promise((resolve) => window.setTimeout(resolve, 0)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
function setInput(dom: JSDOM, input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
