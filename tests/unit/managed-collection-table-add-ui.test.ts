import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionAddTableRequest, CollectionSnapshot } from "@pige/schemas";
import { ManagedCollectionTableAddAction } from "../../apps/desktop/src/renderer/src/components/ManagedCollectionTableAddAction";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedCollectionTableAddAction", () => {
  it("keeps its name draft through stale CAS and adopts the Main-created table", async () => {
    const addTable = vi.fn(async (request: CollectionAddTableRequest) => addTable.mock.calls.length === 1
      ? { ...request, status: "stale" } as const
      : { ...request, status: "committed", tableId: "table_created000001", operationId: "op_20260808_abcdefghijkl",
        snapshot: snapshot("Projects", "table_created000001", "dataset_rev_20260808_committed") } as const);
    const harness = await mount(addTable);
    await click(button(harness.container, "Add table"), harness.dom);
    const input = harness.container.querySelector("input")!;
    await act(async () => { setInputValue(harness.dom, input, "Projects"); await flush(harness.dom); });
    await click(harness.container.querySelector('button[type="submit"]') as HTMLButtonElement, harness.dom);
    expect(input.value).toBe("Projects");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("stale");
    await click(harness.container.querySelector('button[type="submit"]') as HTMLButtonElement, harness.dom);
    await act(async () => { await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20)); });
    expect(addTable.mock.calls[1]![0]).toMatchObject({ expectedRevisionId: "dataset_rev_20260808_initial", name: "Projects" });
    expect(harness.container.querySelector("form")).toBeNull();
    expect(harness.current.current.tableId).toBe("table_created000001");
  });
});

async function mount(addTable: (request: CollectionAddTableRequest) => Promise<unknown>) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "crypto", "requestAnimationFrame"])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document }, navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement }, crypto: { configurable: true, value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, { attachEvent: { configurable: true, value: () => undefined }, detachEvent: { configurable: true, value: () => undefined } });
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { collections: { addTable } } });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container); const current = { current: snapshot("Records", "table_20260808_abcdefghijkl", "dataset_rev_20260808_initial") };
  function Harness(): React.JSX.Element {
    const [value, setValue] = useState(current.current); const currentRef = useRef(current.current); currentRef.current = current.current;
    return createElement(ManagedCollectionTableAddAction, { activeVaultId: "vault_20260808_tableadd", snapshot: value, blocked: false,
      onBusyChange: () => undefined, onAdoptSnapshot: (next: CollectionSnapshot, expectedRevisionId: string, expectedTableId?: string) => {
        if (current.current.revisionId !== expectedRevisionId || current.current.tableId !== expectedTableId) return false;
        current.current = next; setValue(next); return true;
      }, t: (key: string) => ({ "collection.addTable": "Add table", "collection.addingTable": "Adding", "collection.tableName": "Table name",
        "collection.cancel": "Cancel", "collection.addTable_stale": "stale", "collection.addTable_committed": "saved", "collection.addTable_failed": "failed" }[key] ?? key) });
  }
  await act(async () => root.render(createElement(Harness)));
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container, current };
}

function snapshot(tableName: string, tableId: string, revisionId: string): CollectionSnapshot {
  return { datasetId: "dataset_20260808_abcdefghijkl", revisionId, title: "Contacts", tableId, tableName,
    columns: [{ columnId: "column_20260808_abcdefgh", label: "Name", logicalType: "string", canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
    rows: [], totalRowCount: 0, returnedRowCount: 0, truncated: false, canAppendDefaultRow: true, canAddColumn: true, canAddFormulaColumn: true, canAddRelationColumn: true, canAddLookupColumn: true, canAddRollupColumn: true, views: [] };
}
function button(container: HTMLElement, text: string): HTMLButtonElement { const match = [...container.querySelectorAll("button")].find((item) => item.textContent === text); if (!match) throw new Error(`Missing button: ${text}`); return match as HTMLButtonElement; }
function setInputValue(dom: JSDOM, input: HTMLInputElement, value: string): void { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value); const propertyChange = new dom.window.Event("propertychange", { bubbles: true }); Object.defineProperty(propertyChange, "propertyName", { value: "value" }); input.dispatchEvent(propertyChange); input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" })); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }
async function click(element: HTMLElement, dom: JSDOM): Promise<void> { await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await flush(dom); }); }
async function flush(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
