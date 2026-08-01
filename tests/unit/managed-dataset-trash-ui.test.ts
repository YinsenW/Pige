import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedDatasetTrashAction } from "../../apps/desktop/src/renderer/src/components/ManagedDatasetTrashAction";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedDatasetTrashAction", () => {
  it("confirms once, retains stale state and focus, then adopts a committed removal", async () => {
    const outcomes = ["stale", "committed"] as const;
    const onTrash = vi.fn(async (request) => ({ ...request, status: outcomes.shift()!,
      ...(outcomes.length === 0 ? { operationId: "op_20260801_abcdefghijkl" } : {}) }) as never);
    const onCommitted = vi.fn();
    const harness = await mount(onTrash, onCommitted);
    const trigger = button(harness.container, "Move dataset to trash");
    trigger.click(); await flush(harness.dom);
    const confirm = button(harness.container, "Move dataset to trash", 1);
    await act(async () => { confirm.click(); confirm.click(); await flush(harness.dom); });
    expect(onTrash).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe("stale");
    expect(harness.dom.window.document.activeElement).toBe(confirm);
    await act(async () => { confirm.click(); await flush(harness.dom); });
    expect(onTrash).toHaveBeenCalledTimes(2);
    expect(onCommitted).toHaveBeenCalledWith("dataset_20260801_abcdefghijkl");
    expect(harness.container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("restores trigger focus after cancellation and renders nothing without authority", async () => {
    const harness = await mount(vi.fn(), vi.fn());
    const trigger = button(harness.container, "Move dataset to trash");
    trigger.focus(); trigger.click(); await flush(harness.dom);
    button(harness.container, "Cancel").click(); await flush(harness.dom);
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.render(false);
    expect(harness.container.querySelector("button")).toBeNull();
  });
});

async function mount(onTrash: (...args: any[]) => any, onCommitted: (...args: any[]) => any) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    crypto: { configurable: true, value: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1; } }
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  const render = async (canTrash = true) => act(async () => root.render(createElement(ManagedDatasetTrashAction, {
    activeVaultId: "vault_20260801_datasettrash", dataset: { datasetId: "dataset_20260801_abcdefghijkl",
      title: "Records", activeRevisionId: "dataset_rev_20260801_abcdefghijkl", canTrash,
      tableCount: 1, tables: [], tablesTruncated: true }, onTrash, onCommitted,
    t: (key) => ({ "common.cancel": "Cancel", "collection.trashDataset": "Move dataset to trash",
      "collection.trashDatasetTitle": "Move?", "collection.trashDatasetDescription": "Recoverable.",
      "collection.trashingDataset": "Moving", "collection.trashDataset_stale": "stale" }[key] ?? key)
  })));
  await render();
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container, root: root as Root, render };
}

function button(container: HTMLElement, text: string, index = 0): HTMLButtonElement {
  const matches = [...container.querySelectorAll("button")].filter((item) => item.textContent === text);
  if (!matches[index]) throw new Error(`Missing button: ${text}`);
  return matches[index] as HTMLButtonElement;
}
async function flush(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
