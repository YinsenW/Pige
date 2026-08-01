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
    const purgeDataset = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_datasetpurge001" }));
    const onRestored = vi.fn();
    const { dom, container } = await mount(listDatasetTrash, restoreDataset, purgeDataset, onRestored);
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

  it("requires explicit confirmation, preserves evidence-free identity, and removes only after commit", async () => {
    const dataset = { datasetId: "dataset_20260801_abcdefghijkl", title: "Records",
      revisionId: "dataset_rev_20260801_abcdefghijkl", trashOperationId: "op_20260801_datasettrash01",
      trashedAt: "2026-08-01T00:00:00.000Z" };
    const revision = `datasettrashrev_${"a".repeat(64)}`;
    const listDatasetTrash = vi.fn(async (request) => ({ ...request, status: "ready" as const,
      revision, datasets: [dataset] }));
    const purgeDataset = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260801_datasetpurge001" }));
    const onRestored = vi.fn();
    const { dom, container } = await mount(listDatasetTrash, vi.fn(), purgeDataset, onRestored);
    button(container, "View trash").click(); await flush(dom);
    button(container, "Delete permanently").click(); await flush(dom);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(purgeDataset).not.toHaveBeenCalled();
    button(container.querySelector('[role="alertdialog"]') as HTMLElement, "Delete permanently").click(); await flush(dom); await flush(dom);
    expect(purgeDataset).toHaveBeenCalledWith({ apiVersion: 1,
      requestId: "collection_request_12345678123412341234123456789abc",
      activeVaultId: "vault_20260801_datasettrash", datasetId: dataset.datasetId,
      expectedRevisionId: dataset.revisionId, trashOperationId: dataset.trashOperationId,
      expectedTrashRevision: revision, confirmation: "delete_permanently" });
    expect(JSON.stringify(purgeDataset.mock.calls[0]?.[0])).not.toMatch(/path|title|checksum|digest|source/u);
    expect(container.textContent).not.toContain("Records");
    expect(container.textContent).toContain("Dataset permanently deleted");
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it("fences duplicate purge activation and retains the exact candidate and focus on stale", async () => {
    const dataset = { datasetId: "dataset_20260801_abcdefghijkl", title: "Records",
      revisionId: "dataset_rev_20260801_abcdefghijkl", trashOperationId: "op_20260801_datasettrash01",
      trashedAt: "2026-08-01T00:00:00.000Z" };
    const revision = `datasettrashrev_${"a".repeat(64)}`;
    const listDatasetTrash = vi.fn(async (request) => ({ ...request, status: "ready" as const,
      revision, datasets: [dataset] }));
    let settle!: (value: unknown) => void;
    const purgeDataset = vi.fn((request) => new Promise((resolve) => { settle = resolve; }).then(() => ({ ...request, status: "stale" as const })));
    const { dom, container } = await mount(listDatasetTrash, vi.fn(), purgeDataset, vi.fn());
    button(container, "View trash").click(); await flush(dom);
    const rowTrigger = button(container, "Delete permanently"); rowTrigger.click(); await flush(dom);
    const dialog = container.querySelector('[role="alertdialog"]') as HTMLElement;
    const confirm = button(dialog, "Delete permanently");
    await act(async () => { confirm.click(); confirm.click(); });
    expect(purgeDataset).toHaveBeenCalledOnce();
    await act(async () => { settle(undefined); await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Records");
    expect(container.textContent).toContain("collection.datasetDelete_stale");
    expect(dom.window.document.activeElement).toBe(confirm);
    await act(async () => { button(dialog, "Cancel").click(); }); await flush(dom);
    expect(dom.window.document.activeElement).toBe(rowTrigger);
  });
});

async function mount(listDatasetTrash: (...args: any[]) => any, restoreDataset: (...args: any[]) => any,
  purgeDataset: (...args: any[]) => any, onRestored: () => void) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: Object.assign(dom.window, { pige: { collections: { listDatasetTrash, restoreDataset, purgeDataset } } }) },
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
      "collection.datasetRestoring": "Restoring", "collection.datasetRestore_restored": "Restored",
      "collection.datasetDelete": "Delete permanently", "collection.datasetDeleteTitle": "Delete dataset?",
      "collection.datasetDeleteWarning": "Cannot undo", "collection.datasetDeleteCancel": "Cancel",
      "collection.datasetDeleteConfirm": "Delete permanently", "collection.datasetDeleting": "Deleting",
      "collection.datasetDelete_deleted": "Dataset permanently deleted" }[key] ?? key)
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
