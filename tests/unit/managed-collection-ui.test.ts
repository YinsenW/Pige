import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionSnapshot
} from "@pige/schemas";
import type { AgentTurnAnswer } from "@pige/contracts";
import { ManagedCollectionPanel } from "../../apps/desktop/src/renderer/src/components/ManagedCollectionPanel";
import {
  ActivityHistorySettingsPanel,
  DatasetAnswerResult
} from "../../apps/desktop/src/renderer/src/App";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "InputEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent"
] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("ManagedCollectionPanel", () => {
  it("commits one editable scalar against the immutable displayed revision and restores cell focus", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionCellEditRequest[] = [];
    let reloadCount = 0;
    await act(async () => {
      root.render(createElement(ManagedCollectionPanel, {
        activeVaultId: "vault_20260727_collection01",
        snapshot: collectionSnapshot("dataset_rev_20260727_revision0001", "Alpha"),
        onClose: () => undefined,
        onAppendDefaultRow: notFoundAppendResult,
        onAdoptSnapshot: () => false,
        onEditCell: async (request: CollectionCellEditRequest): Promise<CollectionCellEditResult> => {
          requests.push(request);
          return committedResult(request, "dataset_rev_20260727_revision0002");
        },
        onReload: async () => {
          reloadCount += 1;
          return collectionSnapshot("dataset_rev_20260727_revision0002", "Beta");
        },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Add row")).toBe(false);
    const editButton = buttonNamed(container, "Edit cell: Name, row 1");
    await click(dom, editButton);
    const input = requireElement(container.querySelector<HTMLInputElement>('input[aria-label="Edit value: Name, row 1"]'));
    await inputText(dom, input, "Beta");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      rowId: "row_customer0001",
      columnId: "column_name000001",
      expectedRevisionId: "dataset_rev_20260727_revision0001",
      value: "Beta"
    });
    expect(reloadCount).toBe(1);
    expect(container.textContent).toContain("Cell saved as a new revision.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Edit cell: Name, row 1"));
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit cell: Total, row 1"
    )).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves a stale attempted value, reloads the revision, and retries with the new CAS identity", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionCellEditRequest[] = [];
    await act(async () => {
      root.render(createElement(ManagedCollectionPanel, {
        activeVaultId: "vault_20260727_collection01",
        snapshot: collectionSnapshot("dataset_rev_20260727_revision0001", "Alpha"),
        onClose: () => undefined,
        onAppendDefaultRow: notFoundAppendResult,
        onAdoptSnapshot: () => false,
        onEditCell: async (request: CollectionCellEditRequest): Promise<CollectionCellEditResult> => {
          requests.push(request);
          return requests.length === 1
            ? { ...editIdentity(request), status: "stale", currentRevisionId: "dataset_rev_20260727_revision0002" }
            : committedResult(request, "dataset_rev_20260727_revision0003");
        },
        onReload: async () => collectionSnapshot(
          requests.length === 1 ? "dataset_rev_20260727_revision0002" : "dataset_rev_20260727_revision0003",
          "Server value"
        ),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Edit cell: Name, row 1"));
    const input = requireElement(container.querySelector<HTMLInputElement>('input[aria-label="Edit value: Name, row 1"]'));
    await inputText(dom, input, "Attempted value");
    await click(dom, buttonNamed(container, "Save"));

    expect(container.textContent).toContain("Your entered value is preserved");
    expect(input.value).toBe("Attempted value");
    await click(dom, buttonNamed(container, "Reload latest"));
    expect(input.value).toBe("Attempted value");
    expect(dom.window.document.activeElement).toBe(input);
    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260727_revision0001",
      "dataset_rev_20260727_revision0002"
    ]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts a stale append snapshot, retries its exact revision, and focuses the authoritative new row", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAppendDefaultRowRequest[] = [];
    const staleSnapshot = collectionSnapshot("dataset_rev_20260727_revision0002", "Alpha", true);
    const committedSnapshot: CollectionSnapshot = {
      ...collectionSnapshot("dataset_rev_20260727_revision0003", "Alpha", true),
      rows: [
        ...collectionSnapshot("dataset_rev_20260727_revision0003", "Alpha", true).rows,
        {
          rowId: "row_customer0002",
          cells: [
            { columnId: "column_name000001", value: "Server default", editable: true },
            { columnId: "column_total00001", value: 0, editable: false, readOnlyReason: "formula" }
          ]
        }
      ],
      totalRowCount: 2,
      returnedRowCount: 2
    };
    const append = async (
      request: CollectionAppendDefaultRowRequest
    ): Promise<CollectionAppendDefaultRowResult> => {
      requests.push(request);
      const identity = appendIdentity(request);
      return requests.length === 1
        ? { ...identity, status: "stale", snapshot: staleSnapshot }
        : {
          ...identity,
          status: "committed",
          rowId: "row_customer0002",
          operationId: "op_20260728_collectionappend01",
          snapshot: committedSnapshot
        };
    };
    await act(async () => {
      root.render(createElement(CollectionAppendHarness, { onAppend: append }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Add row")).toBe(true);

    await act(async () => {
      const add = buttonNamed(container, "Add row");
      add.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      add.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(requests).toEqual([{
      apiVersion: 1,
      requestId: expect.stringMatching(/^collection_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      expectedRevisionId: "dataset_rev_20260727_revision0001"
    }]);
    expect(container.textContent).toContain("The collection changed. Latest rows loaded; add the row again.");
    expect(container.querySelector(".managed-collection-panel")?.getAttribute("data-collection-revision-id"))
      .toBe("dataset_rev_20260727_revision0002");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Add row"));

    await click(dom, buttonNamed(container, "Add row"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260727_revision0001",
      "dataset_rev_20260727_revision0002"
    ]);
    expect(container.textContent).toContain("Row added as a new revision.");
    expect(container.textContent).toContain("Server default");
    expect(container.textContent).toContain("2/2");
    const appendedRow = requireElement(container.querySelector<HTMLTableRowElement>(
      '[data-collection-row-id="row_customer0002"]'
    ));
    expect(dom.window.document.activeElement).toBe(appendedRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("opens the exact collection identity from an existing Dataset result", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const opened: Array<{ datasetId: string; tableId: string }> = [];
    await act(async () => {
      root.render(createElement(DatasetAnswerResult, {
        answer: datasetAnswer(),
        modelUsage: "none",
        onOpenCollection: async (datasetId: string, tableId: string) => {
          opened.push({ datasetId, tableId });
          return true;
        },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Open collection"));
    expect(opened).toEqual([{
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01"
    }]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("exposes collection Activity through the existing Open and Undo actions", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const opened: string[] = [];
    const undone: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [{
          operationId: "op_20260727_collection01",
          kind: "update_collection_cell",
          createdAt: "2026-07-27T08:00:00.000Z",
          targetLabel: "Customers",
          target: {
            kind: "collection",
            datasetId: "dataset_20260727_collection01",
            tableId: "table_collection01",
            revisionId: "dataset_rev_20260727_revision0002"
          },
          status: "applied",
          canUndo: true
        }],
        undoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async (activity) => { opened.push(activity.operationId); },
        onUndo: async (operationId) => { undone.push(operationId); },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection cell updated: Customers");
    await click(dom, buttonNamed(container, "Open"));
    await click(dom, buttonNamed(container, "Undo"));
    expect(opened).toEqual(["op_20260727_collection01"]);
    expect(undone).toEqual(["op_20260727_collection01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function CollectionAppendHarness(props: {
  readonly onAppend: (
    request: CollectionAppendDefaultRowRequest
  ) => Promise<CollectionAppendDefaultRowResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(() => (
    collectionSnapshot("dataset_rev_20260727_revision0001", "Alpha", true)
  ));
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAppendDefaultRow: props.onAppend,
    onAdoptSnapshot: (next, expectedRevisionId) => {
      if (snapshot.revisionId !== expectedRevisionId) return false;
      setSnapshot(next);
      return true;
    },
    onEditCell: async (request) => ({ ...editIdentity(request), status: "failed" }),
    onReload: async () => snapshot,
    t
  });
}

function collectionSnapshot(revisionId: string, name: string, canAppendDefaultRow = false): CollectionSnapshot {
  return {
    datasetId: "dataset_20260727_collection01",
    revisionId,
    title: "Customers",
    tableId: "table_collection01",
    tableName: "Customers",
    columns: [
      { columnId: "column_name000001", label: "Name", logicalType: "string" },
      { columnId: "column_total00001", label: "Total", logicalType: "number" }
    ],
    rows: [{
      rowId: "row_customer0001",
      cells: [
        { columnId: "column_name000001", value: name, editable: true },
        { columnId: "column_total00001", value: 42, editable: false, readOnlyReason: "formula" }
      ]
    }],
    totalRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    canAppendDefaultRow
  };
}

function datasetAnswer(): AgentTurnAnswer {
  return {
    answer: "Customers loaded.",
    grounding: "local_knowledge",
    citations: [],
    datasetResult: {
      datasetId: "dataset_20260727_collection01",
      revisionId: "dataset_rev_20260727_revision0001",
      tableId: "table_collection01",
      tableName: "Customers",
      planHash: "a".repeat(64),
      resultHash: "b".repeat(64),
      columns: [{
        key: "name",
        label: "Name",
        logicalType: "string",
        sourceColumnId: "column_name000001"
      }],
      rows: [{ values: ["Alpha"] }],
      matchedRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      citationRefs: []
    }
  };
}

function editIdentity(request: CollectionCellEditRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId
  };
}

function appendIdentity(request: CollectionAppendDefaultRowRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId
  };
}

async function notFoundAppendResult(
  request: CollectionAppendDefaultRowRequest
): Promise<CollectionAppendDefaultRowResult> {
  return { ...appendIdentity(request), status: "not_found" };
}

function committedResult(
  request: CollectionCellEditRequest,
  revisionId: string
): CollectionCellEditResult {
  return {
    ...editIdentity(request),
    status: "committed",
    revisionId,
    operationId: "op_20260727_collection01"
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key as keyof Window]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0)
  });
  return dom;
}

async function click(dom: JSDOM, button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function inputText(dom: JSDOM, input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    const propertyChange = new dom.window.Event("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    input.dispatchEvent(propertyChange);
    input.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText"
    }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function buttonNamed(container: Element, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
