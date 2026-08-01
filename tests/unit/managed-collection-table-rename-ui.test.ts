import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionRenameTableRequest, CollectionSnapshot } from "@pige/schemas";
import { ManagedCollectionTableRenameAction } from "../../apps/desktop/src/renderer/src/components/ManagedCollectionTableRenameAction";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe("ManagedCollectionTableRenameAction", () => {
  it("keeps an exact draft across stale CAS and restores trigger focus after commit", async () => {
    const onRename = vi.fn(async (request: CollectionRenameTableRequest) => {
      if (onRename.mock.calls.length === 1) return { ...request, status: "stale", snapshot: snapshot("Records", "dataset_rev_20260802_stalerevision") } as const;
      return { ...request, status: "committed", operationId: "op_20260802_abcdefghijkl",
        snapshot: snapshot(request.name, "dataset_rev_20260802_committedrev") } as const;
    });
    const onBusyChange = vi.fn();
    const harness = await mount(onRename, onBusyChange);
    const trigger = button(harness.container, "Rename table");
    await click(trigger, harness.dom);
    let input = harness.container.querySelector("input")!;
    await act(async () => { setInputValue(harness.dom, input, "People"); await flush(harness.dom); });
    await click(button(harness.container, "Save"), harness.dom);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename.mock.calls[0]![0]).toMatchObject({ expectedRevisionId: "dataset_rev_20260802_initialrev", name: "People" });
    input = harness.container.querySelector("input")!;
    expect(input.value).toBe("People");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("stale");

    await click(button(harness.container, "Save"), harness.dom);
    await act(async () => { await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 20)); });
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(onRename.mock.calls[1]![0]).toMatchObject({ expectedRevisionId: "dataset_rev_20260802_stalerevision", name: "People" });
    expect(harness.container.querySelector("form")).toBeNull();
    expect(harness.container.querySelector(".muted")?.textContent).toBe("People");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    expect(onBusyChange.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
  });
});

async function mount(onRename: (request: CollectionRenameTableRequest) => Promise<unknown>, onBusyChange: (busy: boolean) => void) {
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
    const current = useRef(snapshot("Records", "dataset_rev_20260802_initialrev"));
    const [value, setValue] = useState(current.current);
    return createElement(ManagedCollectionTableRenameAction, { activeVaultId: "vault_20260802_tablerename", snapshot: value,
      blocked: false, onRename: onRename as never, onBusyChange,
      onAdoptSnapshot: (next: CollectionSnapshot, expectedRevisionId: string) => {
        if (current.current.revisionId !== expectedRevisionId) return false;
        current.current = next; setValue(next); return true;
      }, t: (key: string) => ({ "collection.renameTable": "Rename table", "collection.tableName": "Table name",
        "collection.save": "Save", "collection.cancel": "Cancel", "collection.renamingTable": "Renaming",
        "collection.renameTable_stale": "stale", "collection.renameTable_committed": "saved",
        "collection.renameTable_failed": "failed" }[key] ?? key) });
  }
  await act(async () => root.render(createElement(Harness)));
  cleanup = async () => { await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); };
  return { dom, container };
}

function snapshot(tableName: string, revisionId: string): CollectionSnapshot {
  return { datasetId: "dataset_20260802_abcdefghijkl", revisionId, title: "Contacts",
    tableId: "table_20260802_abcdefghijkl", tableName,
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
function setInputValue(dom: JSDOM, input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
  Object.defineProperty(propertyChange, "propertyName", { value: "value" });
  input.dispatchEvent(propertyChange);
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
async function click(element: HTMLElement, dom: JSDOM): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await flush(dom); });
}
async function flush(dom: JSDOM): Promise<void> { await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0)); }
