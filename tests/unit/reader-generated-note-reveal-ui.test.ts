import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult, NoteRevealGeneratedResult } from "@pige/contracts";
import { ReaderGeneratedNoteRevealAction } from "../../apps/desktop/src/renderer/src/components/ReaderGeneratedNoteRevealAction";

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

describe("ReaderGeneratedNoteRevealAction", () => {
  it("renders only with exact Main-projected eligibility", async () => {
    const harness = await mount(render(false), vi.fn());
    expect(harness.container.querySelector("button")).toBeNull();
    await harness.unmount();
  });

  it("single-flights the exact identity and restores focus", async () => {
    const pending = deferred<NoteRevealGeneratedResult>();
    const onReveal = vi.fn(async () => pending.promise);
    const harness = await mount(render(true), onReveal);
    const trigger = harness.container.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    await act(async () => {
      trigger.click();
      trigger.click();
      await settle(harness.dom);
    });
    expect(onReveal).toHaveBeenCalledOnce();
    const request = onReveal.mock.calls[0]![0];
    expect(request).toMatchObject({
      activeVaultId: "vault_20260801_abcdefgh",
      currentPageId: "page_20260801_generated1",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: `noteeditrev_${"b".repeat(64)}`
    });
    await act(async () => {
      pending.resolve({ ...request, status: "revealed" });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("revealed");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("fails closed on echoed identity drift and retains the action", async () => {
    const onReveal = vi.fn(async (request) => ({ ...request, activeVaultId: "vault_20260801_other000", status: "revealed" as const }));
    const harness = await mount(render(true), onReveal);
    const trigger = harness.container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { trigger.click(); await settle(harness.dom); });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("failed");
    expect(harness.container.querySelector("button")).toBe(trigger);
    await harness.unmount();
  });

  it("ignores an old result after the Reader owner changes", async () => {
    const pending = deferred<NoteRevealGeneratedResult>();
    const onReveal = vi.fn(async () => pending.promise);
    const harness = await mount(render(true), onReveal);
    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>("button")!.click();
      await settle(harness.dom);
      harness.root.render(createElement(ReaderGeneratedNoteRevealAction, {
        activeVaultId: "vault_20260801_abcdefgh", note: render(true, "page_20260801_generated2"),
        onReveal, t: (key: string) => key.split(".").at(-1)!
      }));
      await settle(harness.dom);
    });
    const replacement = harness.container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { await settle(harness.dom); });
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    const request = onReveal.mock.calls[0]![0];
    await act(async () => { pending.resolve({ ...request, status: "failed" }); await pending.promise; await settle(harness.dom); });
    expect(harness.container.querySelector('[role="status"]')).toBeNull();
    expect(harness.container.querySelector("button")?.hasAttribute("disabled")).toBe(false);
    expect(harness.dom.window.document.activeElement).toBe(replacement);
    await harness.unmount();
  });
});

function render(eligible: boolean, pageId = "page_20260801_generated1"): NoteRenderResult {
  return {
    summary: { pageId, title: "Generated", pageType: "note", status: "active", pagePath: "wiki/generated.md", sourceIds: [], updatedAt: "2026-08-01T00:00:00.000Z" },
    html: "<p>Generated</p>", byteSize: 9, renderContextId: `notectx_${"a".repeat(32)}`,
    ...(eligible ? { revealGeneratedEligibility: { canReveal: true, revision: `noteeditrev_${"b".repeat(64)}` } } : {})
  };
}

async function mount(note: NoteRenderResult, onReveal: Parameters<typeof ReaderGeneratedNoteRevealAction>[0]["onReveal"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => {
    root.render(createElement(ReaderGeneratedNoteRevealAction, { activeVaultId: "vault_20260801_abcdefgh", note, onReveal, t: (key) => key.split(".").at(-1)! }));
    await settle(dom);
  });
  return { dom, root, container: dom.window.document.querySelector("#root")!, unmount: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function settle(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
function installDom(dom: JSDOM): void {
  for (const key of globals) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] }); }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) });
}
