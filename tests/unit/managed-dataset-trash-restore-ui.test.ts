import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedDatasetTrashRestorePanel } from "../../apps/desktop/src/renderer/src/components/ManagedDatasetTrashRestorePanel";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedDatasetTrashRestorePanel", () => {
  it("lists only safe trash facts and restores with exact opaque currentness", async () => {
    const listDatasetTrash = vi.fn(async (request) => ({ ...request, status: "ready" as const,
      revision: `datasettrashrev_${"a".repeat(64)}`, datasets: [{ datasetId: "dataset_20260801_abcdefghijkl",
        title: "Records", revisionId: "dataset_rev_20260801_abcdefghijkl",
        trashOperationId: "op_20260801_datasettrash01", trashedAt: "2026-08-01T00:00:00.000Z" }] }));
    const restoreDataset = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_datasetrestore01" }));
    const onRestored = vi.fn();
    const { dom, container } = await mount(listDatasetTrash, restoreDataset, onRestored);
    button(container, "View trash").click(); await flush(dom);
    expect(container.textContent).toContain("Records");
    button(container, "Restore").click(); await flush(dom); await flush(dom);
    expect(restoreDataset).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: "vault_20260801_datasettrash", datasetId: "dataset_20260801_abcdefghijkl",
      trashOperationId: "op_20260801_datasettrash01", expectedTrashRevision: `datasettrashrev_${"a".repeat(64)}`
    }));
    expect(JSON.stringify(restoreDataset.mock.calls[0]?.[0])).not.toMatch(/path|title|checksum|digest/u);
    expect(onRestored).toHaveBeenCalledOnce();
  });
});

async function mount(listDatasetTrash: (...args: any[]) => any, restoreDataset: (...args: any[]) => any, onRestored: () => void) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: Object.assign(dom.window, { pige: { collections: { listDatasetTrash, restoreDataset } } }) },
    document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    crypto: { configurable: true, value: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1; } }
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => root.render(createElement(ManagedDatasetTrashRestorePanel, {
    activeVaultId: "vault_20260801_datasettrash", onRestored,
    t: (key) => ({ "collection.datasetTrashOpen": "View trash", "collection.datasetTrashClose": "Close trash",
      "collection.datasetTrashTitle": "Dataset trash", "collection.datasetTrashLoading": "Loading",
      "collection.datasetTrashEmpty": "Empty", "collection.datasetRestore": "Restore",
      "collection.datasetRestoring": "Restoring", "collection.datasetRestore_restored": "Restored" }[key] ?? key)
  })));
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`); return found as HTMLButtonElement;
}
async function flush(dom: JSDOM): Promise<void> { await act(async () => new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0))); }
