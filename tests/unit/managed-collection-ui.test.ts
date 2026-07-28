import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionCitationHighlight,
  DatasetQueryPreview,
  CollectionRenameColumnRequest,
  CollectionRenameColumnResult,
  CollectionSnapshot,
  CollectionViewSummary,
  CollectionTrashColumnRequest,
  CollectionTrashColumnResult,
  CollectionTrashRowRequest,
  CollectionTrashRowResult
} from "@pige/schemas";
import type { AgentTurnAnswer } from "@pige/contracts";
import {
  ManagedCollectionCitationPanel,
  ManagedCollectionPanel
} from "../../apps/desktop/src/renderer/src/components/ManagedCollectionPanel";
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
  it("renders exact cited rows and columns in a focused read-only surface", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const preview = citationPreview();
    const highlights: readonly CollectionCitationHighlight[] = [
      { kind: "rows", rowIds: ["row_datasetcitation01"] },
      { kind: "columns", columnIds: ["column_datasetcount001"] }
    ];
    await act(async () => {
      root.render(createElement(ManagedCollectionCitationPanel, {
        mode: "citation_readonly",
        preview,
        highlights,
        onClose: () => undefined,
        t
      }));
      await settle(dom);
    });

    const panel = requireElement(dom.window.document.querySelector<HTMLElement>(".managed-collection-citation-panel"));
    expect(panel.dataset.collectionMode).toBe("citation_readonly");
    expect(panel.textContent).toContain("North");
    expect(panel.querySelectorAll("mark")).toHaveLength(3);
    expect(panel.querySelector('[data-citation-row-id="row_datasetcitation01"]')?.getAttribute(
      "data-citation-highlight"
    )).toBe("true");
    expect(dom.window.document.activeElement).toBe(
      panel.querySelector('[data-citation-primary="true"]')
    );
    expect(Array.from(panel.querySelectorAll("button")).map((button) => button.textContent?.trim())).toEqual(["Back"]);
    expect(panel.querySelector("input, select, textarea")).toBeNull();

    const aggregatePreview: DatasetQueryPreview = {
      ...preview,
      resultHash: `sha256:${"c".repeat(64)}`,
      rows: [...preview.rows, { rowId: "row_datasetcitation02", values: ["South", 2] }],
      matchedRowCount: 2,
      returnedRowCount: 2
    };
    const aggregateHighlights: readonly CollectionCitationHighlight[] = [
      { kind: "range", range: { startRow: 2, endRow: 5 } },
      { kind: "columns", columnIds: ["column_datasetcount001"] },
      { kind: "aggregate", aggregateKeys: ["record_count"], groupKeys: ["region"] }
    ];
    await act(async () => {
      root.render(createElement(ManagedCollectionCitationPanel, {
        mode: "citation_readonly",
        preview: aggregatePreview,
        highlights: aggregateHighlights,
        onClose: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(panel.querySelector('[data-citation-range="2:5"]')?.textContent).toBe("Rows: 2–5");
    expect(Array.from(panel.querySelectorAll("tbody tr")).every((row) =>
      row.getAttribute("data-citation-highlight") === null
    )).toBe(true);
    expect(panel.querySelectorAll("mark")).toHaveLength(6);
    expect(dom.window.document.activeElement).toBe(
      panel.querySelector('[data-citation-range="2:5"]')
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

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
        onAddNullableColumn: notFoundColumnResult,
        onRenameColumn: notFoundRenameResult,
        onTrashColumn: notFoundTrashColumnResult,
        onOpenView: async () => null,
        onCreateView: notFoundCreateViewResult,
        onAppendDefaultRow: notFoundAppendResult,
        onTrashRow: notFoundTrashResult,
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
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Add field")).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label")?.startsWith("Move row to trash")
    )).toBe(false);
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
        onAddNullableColumn: notFoundColumnResult,
        onRenameColumn: notFoundRenameResult,
        onTrashColumn: notFoundTrashColumnResult,
        onOpenView: async () => null,
        onCreateView: notFoundCreateViewResult,
        onAppendDefaultRow: notFoundAppendResult,
        onTrashRow: notFoundTrashResult,
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

  it("preserves a stale field draft, retries its authoritative revision, and focuses the committed column", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddNullableColumnRequest[] = [];
    const staleSnapshot = collectionSnapshot("dataset_rev_20260728_revision0002", "Alpha", false, true);
    const committedSnapshot = withNullableColumn(
      collectionSnapshot("dataset_rev_20260728_revision0003", "Alpha", false, true),
      "column_priority001",
      "Priority",
      "number"
    );
    const addColumn = async (
      request: CollectionAddNullableColumnRequest
    ): Promise<CollectionAddNullableColumnResult> => {
      requests.push(request);
      const identity = columnIdentity(request);
      if (requests.length === 1) return { ...identity, status: "stale", snapshot: staleSnapshot };
      if (requests.length === 2) return {
        ...identity,
        status: "committed",
        columnId: "column_priority001",
        operationId: "op_20260728_collectioncolumn01",
        snapshot: committedSnapshot
      };
      return { ...identity, status: "invalid", reason: "duplicate_label" };
    };
    await act(async () => {
      root.render(createElement(CollectionColumnHarness, { onAddColumn: addColumn }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add field"));
    const label = requireElement(container.querySelector<HTMLInputElement>("#collection-new-field-name"));
    const logicalType = requireElement(container.querySelector<HTMLSelectElement>("#collection-new-field-type"));
    expect(dom.window.document.activeElement).toBe(label);
    await inputText(dom, label, "Priority");
    await selectValue(dom, logicalType, "number");

    await act(async () => {
      const save = buttonNamed(container, "Save");
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(requests).toEqual([{
      apiVersion: 1,
      requestId: expect.stringMatching(/^collection_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      expectedRevisionId: "dataset_rev_20260728_revision0001",
      label: "Priority",
      logicalType: "number"
    }]);
    expect(container.textContent).toContain("The collection changed. Your field draft is preserved against the latest revision.");
    expect(label.value).toBe("Priority");
    expect(logicalType.value).toBe("number");
    expect(dom.window.document.activeElement).toBe(label);

    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    expect(container.textContent).toContain("Field added as a new revision.");
    const header = requireElement(container.querySelector<HTMLTableCellElement>(
      '[data-collection-column-id="column_priority001"]'
    ));
    expect(header.textContent).toBe("Priority");
    expect(dom.window.document.activeElement).toBe(header);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an invalid duplicate field draft actionable", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddNullableColumnRequest[] = [];
    await act(async () => {
      root.render(createElement(CollectionColumnHarness, {
        onAddColumn: async (request) => {
          requests.push(request);
          return { ...columnIdentity(request), status: "invalid", reason: "duplicate_label" };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add field"));
    const duplicate = requireElement(container.querySelector<HTMLInputElement>("#collection-new-field-name"));
    await inputText(dom, duplicate, "Priority");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(container.textContent).toContain("A field with this name already exists.");
    expect(duplicate.value).toBe("Priority");
    expect(dom.window.document.activeElement).toBe(duplicate);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves a stale rename draft, sends a trimmed label, and focuses the stable committed column", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionRenameColumnRequest[] = [];
    const staleSnapshot = renameColumnSnapshot(
      collectionSnapshot("dataset_rev_20260728_revision0002", "Alpha", false, false, false, true),
      "column_name000001",
      "Server name"
    );
    const committedSnapshot = renameColumnSnapshot(
      collectionSnapshot("dataset_rev_20260728_revision0003", "Alpha", false, false, false, true),
      "column_name000001",
      "Priority"
    );
    await act(async () => {
      root.render(createElement(CollectionRenameHarness, {
        onRename: async (request) => {
          requests.push(request);
          const identity = renameIdentity(request);
          return requests.length === 1
            ? { ...identity, status: "stale", snapshot: staleSnapshot }
            : {
              ...identity,
              status: "committed",
              operationId: "op_20260728_collectionrename01",
              snapshot: committedSnapshot
            };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Rename field: Name"));
    const input = requireElement(container.querySelector<HTMLInputElement>('input[aria-label="Field name: Name"]'));
    await inputText(dom, input, "  Priority  ");

    await act(async () => {
      const save = buttonNamed(container, "Save");
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(requests).toEqual([{
      apiVersion: 1,
      requestId: expect.stringMatching(/^collection_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      expectedRevisionId: "dataset_rev_20260728_revision0001",
      columnId: "column_name000001",
      label: "Priority"
    }]);
    expect(container.textContent).toContain("The collection changed. Your field name is preserved against the latest revision.");
    expect(input.value).toBe("  Priority  ");
    expect(dom.window.document.activeElement).toBe(input);

    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    expect(container.textContent).toContain("Field renamed as a new revision.");
    const header = requireElement(container.querySelector<HTMLTableCellElement>(
      '[data-collection-column-id="column_name000001"]'
    ));
    expect(header.textContent).toBe("Priority");
    expect(dom.window.document.activeElement).toBe(header);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps failed, duplicate, and ineligible rename drafts without widening authority", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionRenameColumnRequest[] = [];
    const duplicateSnapshot = collectionSnapshot(
      "dataset_rev_20260728_revision0002", "Alpha", false, false, false, true
    );
    const ineligibleSnapshot = collectionSnapshot(
      "dataset_rev_20260728_revision0003", "Alpha", false, false, false, false
    );
    await act(async () => {
      root.render(createElement(CollectionRenameHarness, {
        onRename: async (request) => {
          requests.push(request);
          const identity = renameIdentity(request);
          if (requests.length === 1) return { ...identity, status: "failed" };
          if (requests.length === 2) return { ...identity, status: "duplicate", snapshot: duplicateSnapshot };
          return { ...identity, status: "ineligible", snapshot: ineligibleSnapshot };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Rename field: Name"));
    const input = requireElement(container.querySelector<HTMLInputElement>('input[aria-label="Field name: Name"]'));
    await inputText(dom, input, "Priority");

    await click(dom, buttonNamed(container, "Save"));
    expect(container.textContent).toContain("Pige could not rename the field. Nothing was changed.");
    expect(input.value).toBe("Priority");
    expect(dom.window.document.activeElement).toBe(input);

    await click(dom, buttonNamed(container, "Save"));
    expect(container.textContent).toContain("A field with this name already exists.");
    expect(input.value).toBe("Priority");

    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    expect(container.textContent).toContain("This field can no longer be renamed.");
    expect(input.value).toBe("Priority");
    expect(buttonNamed(container, "Save").disabled).toBe(true);
    expect(dom.window.document.activeElement).toBe(input);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("trashes one eligible field with revision CAS, no optimistic removal, and stable fallback focus", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionTrashColumnRequest[] = [];
    const staleSnapshot = collectionSnapshot(
      "dataset_rev_20260728_revision0002", "Alpha", false, false, false, true, true
    );
    const committedSnapshot = withoutColumn(
      collectionSnapshot("dataset_rev_20260728_revision0003", "Alpha"),
      "column_name000001"
    );
    let resolveResult: ((result: CollectionTrashColumnResult) => void) | null = null;
    await act(async () => {
      root.render(createElement(CollectionTrashColumnHarness, {
        onTrashColumn: (request) => {
          requests.push(request);
          return new Promise((resolve) => { resolveResult = resolve; });
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonNamed(container, "Move field to trash: Name");
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      expectedRevisionId: "dataset_rev_20260728_revision0001",
      columnId: "column_name000001"
    });
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).not.toBeNull();

    await act(async () => {
      resolveResult?.({ ...trashColumnIdentity(requests[0]), status: "stale", snapshot: staleSnapshot });
      await settle(dom);
      await settle(dom);
    });
    expect(container.textContent).toContain("The collection changed. The field was not moved.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Move field to trash: Name"));

    await click(dom, buttonNamed(container, "Move field to trash: Name"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).not.toBeNull();
    await act(async () => {
      resolveResult?.({
        ...trashColumnIdentity(requests[1]),
        status: "committed",
        operationId: "op_20260728_collectiontrashcolumn01",
        snapshot: committedSnapshot
      });
      await settle(dom);
      await settle(dom);
    });
    expect(container.textContent).toContain("Field moved to trash. You can undo this from Activity.");
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).toBeNull();
    const fallback = requireElement(container.querySelector<HTMLTableCellElement>(
      '[data-collection-column-id="column_total00001"]'
    ));
    expect(dom.window.document.activeElement).toBe(fallback);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps failed and ineligible field trash attempts body-free without optimistic removal", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let callCount = 0;
    const ineligibleSnapshot = collectionSnapshot(
      "dataset_rev_20260728_revision0002", "Alpha", false, false, false, true, false
    );
    await act(async () => {
      root.render(createElement(CollectionTrashColumnHarness, {
        onTrashColumn: async (request) => {
          callCount += 1;
          return callCount === 1
            ? { ...trashColumnIdentity(request), status: "failed" }
            : { ...trashColumnIdentity(request), status: "ineligible", snapshot: ineligibleSnapshot };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Move field to trash: Name"));
    expect(container.textContent).toContain("Pige could not move the field to trash. Nothing was changed.");
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).not.toBeNull();

    await click(dom, buttonNamed(container, "Move field to trash: Name"));
    expect(container.textContent).toContain("This field can no longer be moved to trash.");
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Move field to trash: Name"
    )).toBe(false);
    expect(dom.window.document.activeElement).toBe(container.querySelector('[data-collection-column-id="column_name000001"]'));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences a late field-trash result after vault and revision identity change", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = collectionSnapshot(
      "dataset_rev_20260728_revision0001", "Alpha", false, false, false, true, true
    );
    const replacement = collectionSnapshot(
      "dataset_rev_20260728_revision0002", "Replacement", false, false, false, true, true
    );
    let adoptCount = 0;
    let request: CollectionTrashColumnRequest | null = null;
    let resolveResult: ((result: CollectionTrashColumnResult) => void) | null = null;
    const render = (activeVaultId: string, snapshot: CollectionSnapshot): React.JSX.Element =>
      createElement(ManagedCollectionPanel, {
        activeVaultId,
        snapshot,
        onClose: () => undefined,
        onAddNullableColumn: notFoundColumnResult,
        onRenameColumn: notFoundRenameResult,
        onTrashColumn: (nextRequest) => {
          request = nextRequest;
          return new Promise((resolve) => { resolveResult = resolve; });
        },
        onOpenView: async () => null,
        onCreateView: notFoundCreateViewResult,
        onAppendDefaultRow: notFoundAppendResult,
        onTrashRow: notFoundTrashResult,
        onAdoptSnapshot: () => { adoptCount += 1; return true; },
        onEditCell: async (nextRequest) => ({ ...editIdentity(nextRequest), status: "failed" }),
        onReload: async () => snapshot,
        t
      });
    await act(async () => {
      root.render(render("vault_20260727_collection01", initial));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Move field to trash: Name"));
    await act(async () => {
      root.render(render("vault_20260727_collection02", replacement));
      await settle(dom);
    });
    await act(async () => {
      if (!request) throw new Error("Expected a field-trash request.");
      resolveResult?.({
        ...trashColumnIdentity(request),
        status: "committed",
        operationId: "op_20260728_collectiontrashcolumn02",
        snapshot: withoutColumn(initial, "column_name000001")
      });
      await settle(dom);
      await settle(dom);
    });

    expect(adoptCount).toBe(0);
    expect(container.textContent).toContain("Replacement");
    expect(container.querySelector('[data-collection-column-id="column_name000001"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Field moved to trash.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("switches between All rows and one saved view through authoritative open results", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const view = savedView("view_20260728_priority01", "Priority items");
    const allRows = withViews(collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha"), [view]);
    const filtered = withViews(
      { ...collectionSnapshot("dataset_rev_20260728_revision0001", "Priority Alpha"), rows: collectionSnapshot("dataset_rev_20260728_revision0001", "Priority Alpha").rows },
      [view],
      view.viewId
    );
    const opened: Array<string | undefined> = [];
    await act(async () => {
      root.render(createElement(CollectionViewHarness, {
        initialSnapshot: allRows,
        onOpen: async (viewId) => {
          opened.push(viewId);
          return viewId ? filtered : allRows;
        },
        onCreate: notFoundCreateViewResult
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const selector = requireElement(container.querySelector<HTMLSelectElement>("#collection-view-select"));
    expect(Array.from(selector.options).map((option) => option.textContent)).toEqual(["All rows", "Priority items"]);
    await selectValue(dom, selector, view.viewId);
    expect(opened).toEqual([view.viewId]);
    expect(selector.value).toBe(view.viewId);
    expect(container.textContent).toContain("Priority Alpha");
    expect(dom.window.document.activeElement).toBe(selector);

    await selectValue(dom, selector, "");
    expect(opened).toEqual([view.viewId, undefined]);
    expect(selector.value).toBe("");
    expect(container.textContent).toContain("Alpha");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("creates one typed filtered and sorted view with CAS, preserves stale draft, and focuses the active view", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionCreateViewRequest[] = [];
    const staleSnapshot = collectionSnapshot("dataset_rev_20260728_revision0002", "Alpha");
    const view = savedView("view_20260728_highvalue1", "High value", {
      operator: "eq",
      columnId: "column_name000001",
      value: "Alpha"
    }, {
      columnId: "column_total00001",
      direction: "desc"
    });
    const committedSnapshot = withViews(
      collectionSnapshot("dataset_rev_20260728_revision0003", "Alpha"),
      [view],
      view.viewId
    );
    await act(async () => {
      root.render(createElement(CollectionViewHarness, {
        initialSnapshot: collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha"),
        onOpen: async () => null,
        onCreate: async (request) => {
          requests.push(request);
          return requests.length === 1
            ? { ...createViewIdentity(request), status: "stale", snapshot: staleSnapshot }
            : {
              ...createViewIdentity(request),
              status: "committed",
              viewId: view.viewId,
              operationId: "op_20260728_collectionview01",
              snapshot: committedSnapshot
            };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Create view"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-view-name"));
    await inputText(dom, name, "  High value  ");
    const filterValue = requireElement(container.querySelector<HTMLInputElement>("#collection-view-filter-value"));
    await act(async () => { filterValue.focus(); await settle(dom); });
    await inputText(dom, filterValue, "Alpha");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-view-sort-column")), "column_total00001");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-view-sort-direction")), "desc");

    expect(buttonNamed(container, "Save").disabled).toBe(false);
    await act(async () => {
      const save = buttonNamed(container, "Save");
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(requests).toEqual([expect.objectContaining({
      expectedRevisionId: "dataset_rev_20260728_revision0001",
      name: "High value",
      filter: { operator: "eq", columnId: "column_name000001", value: "Alpha" },
      sort: { columnId: "column_total00001", direction: "desc" }
    })]);
    expect(container.textContent).toContain("The collection changed. Your view draft is preserved.");
    expect(name.value).toBe("  High value  ");
    expect(dom.window.document.activeElement).toBe(name);

    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map(({ expectedRevisionId }) => expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    const selector = requireElement(container.querySelector<HTMLSelectElement>("#collection-view-select"));
    expect(selector.value).toBe(view.viewId);
    expect(container.textContent).toContain("View saved as a new revision.");
    expect(dom.window.document.activeElement).toBe(selector);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the view form and current view on duplicate, ineligible, and failed results", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const currentView = savedView("view_20260728_current001", "Current view");
    const snapshots = [
      withViews(collectionSnapshot("dataset_rev_20260728_revision0002", "Alpha"), [currentView], currentView.viewId),
      withViews(collectionSnapshot("dataset_rev_20260728_revision0003", "Alpha"), [currentView], currentView.viewId)
    ];
    let callCount = 0;
    await act(async () => {
      root.render(createElement(CollectionViewHarness, {
        initialSnapshot: withViews(
          collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha"), [currentView], currentView.viewId
        ),
        onOpen: async () => null,
        onCreate: async (request) => {
          callCount += 1;
          if (callCount === 1) return { ...createViewIdentity(request), status: "duplicate", snapshot: snapshots[0] };
          if (callCount === 2) return { ...createViewIdentity(request), status: "ineligible", snapshot: snapshots[1] };
          return { ...createViewIdentity(request), status: "failed" };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Create view"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-view-name"));
    await inputText(dom, name, "Kept draft");
    for (const expected of [
      "A view with this name already exists.",
      "This view can no longer be created.",
      "Pige could not create the view. Nothing was changed."
    ]) {
      await click(dom, buttonNamed(container, "Save"));
      expect(container.textContent).toContain(expected);
      expect(name.value).toBe("Kept draft");
      expect(requireElement(container.querySelector<HTMLSelectElement>("#collection-view-select")).value)
        .toBe(currentView.viewId);
    }

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
          canTrash: true,
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

  it("trashes one eligible row with revision CAS, adopts stale truth, and restores focus", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionTrashRowRequest[] = [];
    const staleSnapshot = collectionSnapshot("dataset_rev_20260728_revision0002", "Alpha", false, false, true);
    const committedSnapshot: CollectionSnapshot = {
      ...staleSnapshot,
      revisionId: "dataset_rev_20260728_revision0003",
      rows: [],
      totalRowCount: 0,
      returnedRowCount: 0
    };
    const trash = async (request: CollectionTrashRowRequest): Promise<CollectionTrashRowResult> => {
      requests.push(request);
      const identity = trashIdentity(request);
      return requests.length === 1
        ? { ...identity, status: "stale", snapshot: staleSnapshot }
        : {
          ...identity,
          status: "committed",
          operationId: "op_20260728_collectiontrash01",
          snapshot: committedSnapshot
        };
    };
    await act(async () => {
      root.render(createElement(CollectionTrashHarness, { onTrash: trash }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const action = buttonNamed(container, "Move row to trash: row 1");

    await act(async () => {
      action.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      action.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(requests).toEqual([{
      apiVersion: 1,
      requestId: expect.stringMatching(/^collection_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260727_collection01",
      datasetId: "dataset_20260727_collection01",
      tableId: "table_collection01",
      expectedRevisionId: "dataset_rev_20260728_revision0001",
      rowId: "row_customer0001"
    }]);
    expect(container.textContent).toContain("The collection changed. Latest rows loaded; move the row again.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Move row to trash: row 1"));

    await click(dom, buttonNamed(container, "Move row to trash: row 1"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      "dataset_rev_20260728_revision0001",
      "dataset_rev_20260728_revision0002"
    ]);
    expect(container.textContent).toContain("Row moved to trash. Undo is available in Activity.");
    expect(container.textContent).toContain("This collection has no rows.");
    expect(container.querySelector('[data-collection-row-id="row_customer0001"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(container.querySelector(".managed-collection-panel"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an ineligible row visible and actionable state body-free", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let callCount = 0;
    await act(async () => {
      root.render(createElement(CollectionTrashHarness, {
        onTrash: async (request) => {
          callCount += 1;
          return { ...trashIdentity(request), status: "ineligible" };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Move row to trash: row 1"));

    expect(callCount).toBe(1);
    expect(container.textContent).toContain("This row can no longer be moved to trash.");
    expect(container.querySelector('[data-collection-row-id="row_customer0001"]')).not.toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Move row to trash: row 1"));

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

  it("labels a trashed collection row and keeps forward Undo available through Activity", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const undone: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [{
          operationId: "op_20260728_collectiontrash01",
          kind: "trash_collection_row",
          createdAt: "2026-07-28T08:00:00.000Z",
          targetLabel: "Customers",
          target: {
            kind: "collection",
            datasetId: "dataset_20260727_collection01",
            tableId: "table_collection01",
            revisionId: "dataset_rev_20260728_revision0002"
          },
          status: "applied",
          canUndo: true
        }],
        undoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection row moved to trash: Customers");
    await click(dom, buttonNamed(container, "Undo"));
    expect(undone).toEqual(["op_20260728_collectiontrash01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("labels a trashed collection field and keeps forward Undo available through Activity", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const undone: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [{
          operationId: "op_20260728_collectiontrashcolumn01",
          kind: "trash_collection_column",
          createdAt: "2026-07-28T08:00:00.000Z",
          targetLabel: "Customers",
          target: {
            kind: "collection",
            datasetId: "dataset_20260727_collection01",
            tableId: "table_collection01",
            revisionId: "dataset_rev_20260728_revision0002"
          },
          status: "applied",
          canUndo: true
        }],
        undoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection field moved to trash: Customers");
    await click(dom, buttonNamed(container, "Undo"));
    expect(undone).toEqual(["op_20260728_collectiontrashcolumn01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("labels a created collection view and keeps forward Undo available through Activity", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const undone: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [{
          operationId: "op_20260728_collectionview01",
          kind: "create_collection_view",
          createdAt: "2026-07-28T08:00:00.000Z",
          targetLabel: "Priority items",
          target: {
            kind: "collection",
            datasetId: "dataset_20260727_collection01",
            tableId: "table_collection01",
            revisionId: "dataset_rev_20260728_revision0002"
          },
          status: "applied",
          canUndo: true
        }],
        undoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection view created: Priority items");
    await click(dom, buttonNamed(container, "Undo"));
    expect(undone).toEqual(["op_20260728_collectionview01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("loads bounded row pages without replacing existing row identities and preserves focus on failure", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = { ...collectionSnapshot("dataset_rev_20260729_page0001", "Alpha"), totalRowCount: 3, truncated: true };
    const calls: string[] = [];
    await act(async () => {
      root.render(createElement(ManagedCollectionPanel, {
        activeVaultId: "vault_20260727_collection01",
        snapshot: initial,
        nextRowCursor: "collection_row_cursor_page_2",
        onClose: () => undefined,
        onAddNullableColumn: notFoundColumnResult,
        onRenameColumn: notFoundRenameResult,
        onTrashColumn: notFoundTrashColumnResult,
        onOpenView: async () => null,
        onCreateView: notFoundCreateViewResult,
        onAppendDefaultRow: notFoundAppendResult,
        onTrashRow: notFoundTrashResult,
        onAdoptSnapshot: () => false,
        onEditCell: async (request) => ({ ...editIdentity(request), status: "failed" }),
        onReload: async () => initial,
        onLoadMoreRows: async (cursor) => {
          calls.push(cursor);
          if (calls.length > 1) return null;
          const duplicate = { ...initial.rows[0]!, cells: initial.rows[0]!.cells.map((cell) =>
            cell.columnId === "column_name000001" ? { ...cell, value: "Server replacement" } : cell) };
          const appended = { ...initial.rows[0]!, rowId: "row_customer0002", cells: initial.rows[0]!.cells.map((cell) =>
            cell.columnId === "column_name000001" ? { ...cell, value: "Beta" } : cell) };
          return {
            apiVersion: 1,
            requestId: "collection_request_page_2",
            activeVaultId: "vault_20260727_collection01",
            datasetId: initial.datasetId,
            tableId: initial.tableId,
            status: "ready",
            snapshot: { ...initial, rows: [duplicate, appended], returnedRowCount: 2 },
            nextRowCursor: "collection_row_cursor_page_3"
          };
        },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const trigger = buttonNamed(container, "Load more rows");
    await click(dom, trigger);
    expect(calls).toEqual(["collection_row_cursor_page_2"]);
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).not.toContain("Server replacement");
    expect(container.textContent).toContain("Beta");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Load more rows"));

    await click(dom, buttonNamed(container, "Load more rows"));
    expect(container.textContent).toContain("Current rows are unchanged");
    expect(container.textContent).toContain("Alpha");
    expect(container.textContent).toContain("Beta");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Load more rows"));

    const changedRevision = { ...collectionSnapshot("dataset_rev_20260729_page0002", "Gamma"), totalRowCount: 2, truncated: true };
    await act(async () => {
      root.render(createElement(ManagedCollectionPanel, {
        activeVaultId: "vault_20260727_collection01",
        snapshot: changedRevision,
        nextRowCursor: "collection_row_cursor_new_revision",
        onClose: () => undefined,
        onAddNullableColumn: notFoundColumnResult,
        onRenameColumn: notFoundRenameResult,
        onTrashColumn: notFoundTrashColumnResult,
        onOpenView: async () => null,
        onCreateView: notFoundCreateViewResult,
        onAppendDefaultRow: notFoundAppendResult,
        onTrashRow: notFoundTrashResult,
        onAdoptSnapshot: () => false,
        onEditCell: async (request) => ({ ...editIdentity(request), status: "failed" }),
        onReload: async () => changedRevision,
        onLoadMoreRows: async () => null,
        t
      }));
      await settle(dom);
    });
    expect(container.textContent).toContain("Gamma");
    expect(container.textContent).not.toContain("Beta");
    expect(container.textContent).not.toContain("Current rows are unchanged");

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
    onAddNullableColumn: notFoundColumnResult,
    onRenameColumn: notFoundRenameResult,
    onTrashColumn: notFoundTrashColumnResult,
    onOpenView: async () => null,
    onCreateView: notFoundCreateViewResult,
    onAppendDefaultRow: props.onAppend,
    onTrashRow: notFoundTrashResult,
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

function CollectionTrashHarness(props: {
  readonly onTrash: (request: CollectionTrashRowRequest) => Promise<CollectionTrashRowResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(() => (
    collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha", false, false, true)
  ));
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAddNullableColumn: notFoundColumnResult,
    onRenameColumn: notFoundRenameResult,
    onTrashColumn: notFoundTrashColumnResult,
    onOpenView: async () => null,
    onCreateView: notFoundCreateViewResult,
    onAppendDefaultRow: notFoundAppendResult,
    onTrashRow: props.onTrash,
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

function CollectionColumnHarness(props: {
  readonly onAddColumn: (
    request: CollectionAddNullableColumnRequest
  ) => Promise<CollectionAddNullableColumnResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(() => (
    collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha", false, true)
  ));
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAddNullableColumn: props.onAddColumn,
    onRenameColumn: notFoundRenameResult,
    onTrashColumn: notFoundTrashColumnResult,
    onOpenView: async () => null,
    onCreateView: notFoundCreateViewResult,
    onAppendDefaultRow: notFoundAppendResult,
    onTrashRow: notFoundTrashResult,
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

function CollectionRenameHarness(props: {
  readonly onRename: (
    request: CollectionRenameColumnRequest
  ) => Promise<CollectionRenameColumnResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(() => (
    collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha", false, false, false, true)
  ));
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAddNullableColumn: notFoundColumnResult,
    onRenameColumn: props.onRename,
    onTrashColumn: notFoundTrashColumnResult,
    onOpenView: async () => null,
    onCreateView: notFoundCreateViewResult,
    onAppendDefaultRow: notFoundAppendResult,
    onTrashRow: notFoundTrashResult,
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

function CollectionTrashColumnHarness(props: {
  readonly onTrashColumn: (
    request: CollectionTrashColumnRequest
  ) => Promise<CollectionTrashColumnResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(() => (
    collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha", false, false, false, true, true)
  ));
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAddNullableColumn: notFoundColumnResult,
    onRenameColumn: notFoundRenameResult,
    onTrashColumn: props.onTrashColumn,
    onOpenView: async () => null,
    onCreateView: notFoundCreateViewResult,
    onAppendDefaultRow: notFoundAppendResult,
    onTrashRow: notFoundTrashResult,
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

function CollectionViewHarness(props: {
  readonly initialSnapshot: CollectionSnapshot;
  readonly onOpen: (viewId?: string) => Promise<CollectionSnapshot | null>;
  readonly onCreate: (request: CollectionCreateViewRequest) => Promise<CollectionCreateViewResult>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  return createElement(ManagedCollectionPanel, {
    activeVaultId: "vault_20260727_collection01",
    snapshot,
    onClose: () => undefined,
    onAddNullableColumn: notFoundColumnResult,
    onRenameColumn: notFoundRenameResult,
    onTrashColumn: notFoundTrashColumnResult,
    onOpenView: async (viewId) => {
      const next = await props.onOpen(viewId);
      if (next) setSnapshot(next);
      return next;
    },
    onCreateView: props.onCreate,
    onAppendDefaultRow: notFoundAppendResult,
    onTrashRow: notFoundTrashResult,
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

function collectionSnapshot(
  revisionId: string,
  name: string,
  canAppendDefaultRow = false,
  canAddColumn = false,
  canTrash = false,
  canRename = false,
  canTrashColumn = false
): CollectionSnapshot {
  return {
    datasetId: "dataset_20260727_collection01",
    revisionId,
    title: "Customers",
    tableId: "table_collection01",
    tableName: "Customers",
    columns: [
      { columnId: "column_name000001", label: "Name", logicalType: "string", canRename, canTrash: canTrashColumn },
      { columnId: "column_total00001", label: "Total", logicalType: "number", canRename: false, canTrash: false }
    ],
    rows: [{
      rowId: "row_customer0001",
      canTrash,
      cells: [
        { columnId: "column_name000001", value: name, editable: true },
        { columnId: "column_total00001", value: 42, editable: false, readOnlyReason: "formula" }
      ]
    }],
    totalRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    canAppendDefaultRow,
    canAddColumn,
    views: []
  };
}

function savedView(
  viewId: string,
  name: string,
  filter: CollectionViewSummary["filter"] = { operator: "is_null", columnId: "column_name000001" },
  sort: CollectionViewSummary["sort"] = { columnId: "column_name000001", direction: "asc" }
): CollectionViewSummary {
  return { viewId, viewRevision: 1, name, filter, sort };
}

function withViews(
  snapshot: CollectionSnapshot,
  views: readonly CollectionViewSummary[],
  activeViewId?: string
): CollectionSnapshot {
  return { ...snapshot, views: [...views], activeViewId };
}

function withNullableColumn(
  snapshot: CollectionSnapshot,
  columnId: string,
  label: string,
  logicalType: "string" | "integer" | "number" | "boolean" | "date" | "datetime"
): CollectionSnapshot {
  return {
    ...snapshot,
    columns: [...snapshot.columns, { columnId, label, logicalType, canRename: false, canTrash: false }],
    rows: snapshot.rows.map((row) => ({
      ...row,
      cells: [...row.cells, { columnId, value: null, editable: true }]
    }))
  };
}

function renameColumnSnapshot(
  snapshot: CollectionSnapshot,
  columnId: string,
  label: string
): CollectionSnapshot {
  return {
    ...snapshot,
    columns: snapshot.columns.map((column) => column.columnId === columnId ? { ...column, label } : column)
  };
}

function withoutColumn(snapshot: CollectionSnapshot, columnId: string): CollectionSnapshot {
  return {
    ...snapshot,
    columns: snapshot.columns.filter((column) => column.columnId !== columnId),
    rows: snapshot.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((cell) => cell.columnId !== columnId)
    }))
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

function columnIdentity(request: CollectionAddNullableColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId
  };
}

function renameIdentity(request: CollectionRenameColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId
  };
}

function trashColumnIdentity(request: CollectionTrashColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId
  };
}

function createViewIdentity(request: CollectionCreateViewRequest) {
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

function trashIdentity(request: CollectionTrashRowRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId
  };
}

async function notFoundTrashResult(
  request: CollectionTrashRowRequest
): Promise<CollectionTrashRowResult> {
  return { ...trashIdentity(request), status: "not_found" };
}

async function notFoundColumnResult(
  request: CollectionAddNullableColumnRequest
): Promise<CollectionAddNullableColumnResult> {
  return { ...columnIdentity(request), status: "not_found" };
}

async function notFoundRenameResult(
  request: CollectionRenameColumnRequest
): Promise<CollectionRenameColumnResult> {
  return { ...renameIdentity(request), status: "not_found" };
}

async function notFoundTrashColumnResult(
  request: CollectionTrashColumnRequest
): Promise<CollectionTrashColumnResult> {
  return { ...trashColumnIdentity(request), status: "not_found" };
}

async function notFoundCreateViewResult(
  request: CollectionCreateViewRequest
): Promise<CollectionCreateViewResult> {
  return { ...createViewIdentity(request), status: "not_found" };
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

function citationPreview(): DatasetQueryPreview {
  return {
    datasetId: "dataset_20260729_datasetcitation",
    revisionId: "dataset_rev_20260729_datasetcitation",
    tableId: "table_datasetcitation01",
    tableName: "Regional totals",
    planHash: `sha256:${"a".repeat(64)}`,
    resultHash: `sha256:${"b".repeat(64)}`,
    columns: [
      { key: "region", label: "Region", logicalType: "string", sourceColumnId: "column_datasetregion01" },
      { key: "record_count", label: "Records", logicalType: "integer", sourceColumnId: "column_datasetcount001", aggregate: "count" }
    ],
    rows: [{ rowId: "row_datasetcitation01", values: ["North", 3] }],
    matchedRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    citationRefs: ["citation_1"]
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

async function selectValue(dom: JSDOM, select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
