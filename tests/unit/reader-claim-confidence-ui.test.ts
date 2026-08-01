import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult, NoteSetClaimConfidenceResult } from "@pige/contracts";
import { ReaderClaimConfidenceControl } from "../../apps/desktop/src/renderer/src/components/ReaderClaimConfidenceControl";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event"] as const;
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

describe("ReaderClaimConfidenceControl", () => {
  it("submits one immutable change and adopts only an authoritative Claim render", async () => {
    const pending = deferred<NoteSetClaimConfidenceResult>();
    const submit = vi.fn(async () => pending.promise);
    const committed = vi.fn();
    const harness = await mount(claimRender(), submit, committed);
    const select = harness.container.querySelector("select")!;
    await act(async () => {
      choose(harness.dom, select, "high");
      choose(harness.dom, select, "low");
      await settle(harness.dom);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    const request = submit.mock.calls[0]![0];
    expect(request).toMatchObject({
      activeVaultId: "vault_20260801_claim01", currentPageId: "page_20260801_claim0001",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`, confidence: "high"
    });
    await act(async () => {
      pending.resolve({ ...request, status: "committed", operationId: "op_20260801_claimconfidence1",
        render: claimRender("high", "b") });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(committed).toHaveBeenCalledWith(claimRender("high", "b"));
    expect(harness.dom.window.document.activeElement).toBe(select);
    await harness.unmount();
  });

  it("retains the attempted confidence and focus after stale or failed results", async () => {
    for (const status of ["stale", "failed"] as const) {
      const submit = vi.fn(async (request) => ({ ...request, status } as const));
      const harness = await mount(claimRender(), submit, vi.fn());
      const select = harness.container.querySelector("select")!;
      select.focus();
      await act(async () => { choose(harness.dom, select, "low"); await settle(harness.dom); });
      expect((select as HTMLSelectElement).value).toBe("low");
      expect(harness.container.querySelector(status === "failed" ? '[role="alert"]' : '[role="status"]')).not.toBeNull();
      expect(harness.dom.window.document.activeElement).toBe(select);
      await harness.unmount();
    }
  });

  it("fences a late result after the Reader owner changes", async () => {
    const pending = deferred<NoteSetClaimConfidenceResult>();
    const submit = vi.fn(async () => pending.promise);
    const committed = vi.fn();
    const harness = await mount(claimRender(), submit, committed);
    await act(async () => {
      choose(harness.dom, harness.container.querySelector("select")!, "high");
      await settle(harness.dom);
      harness.root.render(createElement(ReaderClaimConfidenceControl, props(
        claimRender("medium", "c", "page_20260801_claim0002"), submit, committed
      )));
      await settle(harness.dom);
    });
    const request = submit.mock.calls[0]![0];
    await act(async () => {
      pending.resolve({ ...request, status: "committed", operationId: "op_20260801_claimconfidence1",
        render: claimRender("high", "b") });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(committed).not.toHaveBeenCalled();
    expect((harness.container.querySelector("select") as HTMLSelectElement).value).toBe("medium");
    await harness.unmount();
  });
});

function props(note: NoteRenderResult, submit: Parameters<typeof ReaderClaimConfidenceControl>[0]["onSetConfidence"],
  committed: Parameters<typeof ReaderClaimConfidenceControl>[0]["onCommitted"]) {
  return { activeVaultId: "vault_20260801_claim01", note, onSetConfidence: submit,
    onCommitted: committed, t: (key: string) => key };
}

async function mount(note: NoteRenderResult, submit: Parameters<typeof ReaderClaimConfidenceControl>[0]["onSetConfidence"],
  committed: Parameters<typeof ReaderClaimConfidenceControl>[0]["onCommitted"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  Object.defineProperty(dom.window, "crypto", { value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => { root.render(createElement(ReaderClaimConfidenceControl, props(note, submit, committed))); });
  return { dom, root, container: dom.window.document.querySelector("#root")!,
    unmount: async () => act(async () => root.unmount()) };
}

function claimRender(confidence: "low" | "medium" | "high" = "medium", revision = "a",
  pageId = "page_20260801_claim0001"): NoteRenderResult {
  return {
    summary: { pageId, title: "Claim", pageType: "claim", status: "active", pagePath: "claims/claim.md",
      createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", sourceIds: [] },
    html: "<h1>Claim</h1>", byteSize: 64,
    renderContextId: revision === "a" ? "notectx_0123456789abcdef0123456789abcdef" : `notectx_${revision.repeat(32)}`,
    claimConfidence: { confidence, canChange: true, revision: `noteeditrev_${revision.repeat(64)}` }
  };
}

function choose(dom: JSDOM, select: Element, value: string): void {
  (select as HTMLSelectElement).value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
