import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionSnapshot, CollectionTrashTableRequest } from "@pige/schemas";
import { ManagedCollectionTableTrashAction } from "../../apps/desktop/src/renderer/src/components/ManagedCollectionTableTrashAction";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedCollectionTableTrashAction", () => {
  it("does not steal initial focus, moves it into confirmation, and restores it on Escape", async () => {
    let priorFocus: HTMLButtonElement | undefined;
    const harness = await mount(async (request) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, status: "failed" as const
    }), vi.fn(), (dom) => {
      priorFocus = dom.window.document.createElement("button");
      priorFocus.textContent = "Prior focus";
      dom.window.document.body.append(priorFocus);
      priorFocus.focus();
    });
    expect(harness.dom.window.document.activeElement).toBe(priorFocus);

    const remove = button(harness.container, "Remove table");
    await click(remove, harness.dom);
    const cancel = button(harness.container, "Cancel");
    expect(harness.dom.window.document.activeElement).toBe(cancel);

    await act(async () => {
      cancel.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(harness.container.querySelector('[role="group"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(button(harness.container, "Remove table"));
  });

  it("submits an explicit table trash confirmation only once while pending", async () => {
    let resolveTrash: ((value: unknown) => void) | undefined;
    const onTrash = vi.fn((request: CollectionTrashTableRequest) => new Promise((resolve) => {
      resolveTrash = resolve;
    }));
    const harness = await mount(onTrash, vi.fn());

    await click(button(harness.container, "Remove table"), harness.dom);
    const confirm = button(harness.container, "Move to history");
    await act(async () => {
      confirm.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      confirm.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(onTrash).toHaveBeenCalledOnce();

    const request = onTrash.mock.calls[0]![0] as CollectionTrashTableRequest;
    resolveTrash?.({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, status: "failed" as const
    });
    await settle(harness.dom);
  });

  it("requires an explicit confirmation and closes only after the immutable revision commits", async () => {
    const onTrash = vi.fn(async (request: CollectionTrashTableRequest) => ({
      apiVersion: request.apiVersion, requestId: request.requestId, activeVaultId: request.activeVaultId,
      datasetId: request.datasetId, tableId: request.tableId, status: "committed" as const,
      operationId: "op_20260802_abcdefghijkl", revisionId: "dataset_rev_20260802_committedrev"
    }));
    const onTrashed = vi.fn();
    const harness = await mount(onTrash, onTrashed);
    await click(button(harness.container, "Remove table"), harness.dom);
    expect(onTrash).not.toHaveBeenCalled();
    expect(harness.container.querySelector('[role="group"]')?.textContent).toContain("Move this table out");

    await click(button(harness.container, "Move to history"), harness.dom);
    expect(onTrash).toHaveBeenCalledTimes(1);
    expect(onTrash.mock.calls[0]![0]).toMatchObject({
      datasetId: "dataset_20260802_abcdefghijkl", tableId: "table_20260802_abcdefghijkl",
      expectedRevisionId: "dataset_rev_20260802_initialrev"
    });
    expect(onTrashed).toHaveBeenCalledOnce();
  });
});

async function mount(
  onTrash: (request: CollectionTrashTableRequest) => Promise<unknown>,
  onTrashed: () => void,
  beforeRender?: (dom: JSDOM) => void
) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    crypto: { configurable: true, value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => undefined }, detachEvent: { configurable: true, value: () => undefined }
  });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  function Harness(): React.JSX.Element {
    const current = useRef(snapshot());
    const [value, setValue] = useState(current.current);
    return createElement(ManagedCollectionTableTrashAction, {
      activeVaultId: "vault_20260802_tabletrash", snapshot: value, blocked: false,
      onTrashed, onBusyChange: () => undefined,
      onAdoptSnapshot: (next: CollectionSnapshot, expectedRevisionId: string) => {
        if (current.current.revisionId !== expectedRevisionId) return false;
        current.current = next; setValue(next); return true;
      },
      t: (key: string) => ({ "collection.trashTable": "Remove table", "collection.trashTable_confirm": "Move this table out of the current revision?",
        "collection.trashTable_confirmAction": "Move to history", "collection.trashingTable": "Moving",
        "collection.cancel": "Cancel", "collection.trashTable_committed": "removed", "collection.trashTable_failed": "failed" }[key] ?? key)
    });
  }
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { collections: { trashTable: onTrash } } });
  beforeRender?.(dom);
  await act(async () => root.render(createElement(Harness)));
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container };
}

async function settle(dom: JSDOM): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); });
}

function snapshot(): CollectionSnapshot {
  return { datasetId: "dataset_20260802_abcdefghijkl", revisionId: "dataset_rev_20260802_initialrev", title: "Contacts",
    tableId: "table_20260802_abcdefghijkl", tableName: "Archive", canTrashTable: true,
    columns: [{ columnId: "column_20260802_abcdefgh", label: "Name", logicalType: "string", canRename: true,
      canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }], rows: [], totalRowCount: 0,
    returnedRowCount: 0, truncated: false, canAppendDefaultRow: true, canAddColumn: true,
    canAddFormulaColumn: true, canAddRelationColumn: true, canAddLookupColumn: true, canAddRollupColumn: true, views: [] };
}
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match as HTMLButtonElement;
}
async function click(element: HTMLElement, dom: JSDOM): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); });
}
