import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedDatasetRenameAction } from "../../apps/desktop/src/renderer/src/components/ManagedDatasetRenameAction";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedDatasetRenameAction", () => {
  it("retains the draft after stale CAS and commits one exact retry", async () => {
    const outcomes = ["stale", "committed"] as const;
    const onRename = vi.fn(async (request) => ({ ...request, status: outcomes.shift()!,
      ...(outcomes.length === 0 ? { operationId: "op_20260801_abcdefghijkl",
        revisionId: "dataset_rev_20260801_mnopqrstuvwx" } :
        { currentRevisionId: request.expectedRevisionId, title: "Records" }) }) as never);
    const onCommitted = vi.fn();
    const harness = await mount(onRename, onCommitted);
    button(harness.container, "Rename dataset").click(); await flush(harness.dom);
    const input = harness.container.querySelector("input")!;
    await act(async () => { input.value = "Research records"; input.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true })); });
    await act(async () => { button(harness.container, "Rename dataset", 1).click(); await flush(harness.dom); });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("Research records");
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe("stale");
    await act(async () => { button(harness.container, "Rename dataset", 1).click(); await flush(harness.dom); });
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('[role="dialog"]')).toBeNull();
  });
});

async function mount(onRename: (...args: any[]) => any, onCommitted: () => void) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    crypto: { configurable: true, value: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1; } } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => root.render(createElement(ManagedDatasetRenameAction, { activeVaultId: "vault_20260801_datasettitle",
    dataset: { datasetId: "dataset_20260801_abcdefghijkl", title: "Records",
      activeRevisionId: "dataset_rev_20260801_abcdefghijkl", canRename: true, canTrash: true,
      tableCount: 1, tables: [], tablesTruncated: true }, onRename, onCommitted,
    t: (key) => ({ "common.cancel": "Cancel", "collection.renameDataset": "Rename dataset",
      "collection.renameDatasetTitle": "Rename dataset", "collection.datasetTitle": "Dataset title",
      "collection.renamingDataset": "Renaming", "collection.renameDataset_stale": "stale" }[key] ?? key) })));
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container };
}

function button(container: HTMLElement, text: string, index = 0): HTMLButtonElement {
  const matches = [...container.querySelectorAll("button")].filter((item) => item.textContent === text);
  if (!matches[index]) throw new Error(`Missing button: ${text}`);
  return matches[index] as HTMLButtonElement;
}
async function flush(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
