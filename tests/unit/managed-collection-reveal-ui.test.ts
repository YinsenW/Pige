import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedCollectionRevealAction } from
  "../../apps/desktop/src/renderer/src/components/ManagedCollectionRevealAction";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const owner = {
  activeVaultId: "vault_20260801_collectionreveal",
  datasetId: "dataset_20260801_collectionreveal",
  revisionId: "dataset_rev_20260801_collectionreveal",
  tableId: "table_collectionreveal01"
} as const;

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("ManagedCollectionRevealAction", () => {
  it("single-flights one exact reveal and restores the trigger after success", async () => {
    const pending = deferred<"revealed">();
    const onReveal = vi.fn(async (request) => ({ ...request, status: await pending.promise } as const));
    const harness = await mount(onReveal);
    const trigger = harness.container.querySelector("button")!;
    trigger.focus();
    await act(async () => {
      trigger.click();
      trigger.click();
      await settle(harness.dom);
    });
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith(expect.objectContaining(owner));
    expect(trigger.disabled).toBe(true);

    await act(async () => {
      pending.resolve("revealed");
      await settle(harness.dom);
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("collection.reveal.revealed");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("retains the action and fails closed for response identity drift", async () => {
    const onReveal = vi.fn(async (request) => ({
      ...request,
      datasetId: "dataset_20260801_wrongdataset01",
      status: "revealed" as const
    }));
    const harness = await mount(onReveal);
    const trigger = harness.container.querySelector("button")!;
    trigger.focus();
    await act(async () => {
      trigger.click();
      await settle(harness.dom);
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("collection.reveal.failed");
    expect(trigger.disabled).toBe(false);
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });
});

async function mount(onReveal: Parameters<typeof ManagedCollectionRevealAction>[0]["onReveal"]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => {
    root.render(createElement(ManagedCollectionRevealAction, { ...owner, onReveal, t: (key) => key }));
    await settle(dom);
  });
  return {
    dom,
    container: dom.window.document.querySelector("#root")!,
    unmount: async () => { await act(async () => root.unmount()); dom.window.close(); }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
