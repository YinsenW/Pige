import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionAddFormulaColumnRequest,
  CollectionAddFormulaColumnResult,
  CollectionAddRelationColumnRequest,
  CollectionAddRelationColumnResult,
  CollectionAddLookupColumnRequest,
  CollectionAddLookupColumnResult,
  CollectionAddRollupColumnRequest,
  CollectionAddRollupColumnResult,
  CollectionEditRelationCellRequest,
  CollectionEditRelationCellResult,
  CollectionListResult,
  CollectionOpenRequest,
  CollectionOpenResult,
  CollectionUpdateFormulaColumnRequest,
  CollectionUpdateFormulaColumnResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionUpdateViewRequest,
  CollectionUpdateViewResult,
  CollectionRenameViewRequest,
  CollectionRenameViewResult,
  CollectionTrashViewRequest,
  CollectionTrashViewResult,
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
import { DatasetAnswerResult } from "../../apps/desktop/src/renderer/src/App";
import { ActivityHistorySettingsPanel } from "../../apps/desktop/src/renderer/src/components/ActivityHistorySettingsPanel";
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

  it("creates a typed numeric formula from projected operands and keeps formula cells read-only", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddFormulaColumnRequest[] = [];
    const initial = collectionSnapshot(
      "dataset_rev_20260729_formula0001",
      "Alpha",
      false,
      false,
      false,
      false,
      false,
      true
    );
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        collections: {
          addFormulaColumn: async (request: CollectionAddFormulaColumnRequest): Promise<CollectionAddFormulaColumnResult> => {
            requests.push(request);
            return {
              ...formulaIdentity(request),
              status: "committed",
              columnId: "column_formula00001",
              operationId: "op_20260729_formula01",
              snapshot: withFormulaColumn(initial, request)
            };
          }
        }
      }
    });
    await act(async () => {
      root.render(createElement(FormulaCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await click(dom, buttonNamed(container, "Add formula field"));
    await inputText(dom, requireElement(container.querySelector<HTMLInputElement>("#collection-formula-name")), "Adjusted total");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-formula-operator")), "divide");
    await inputText(dom, requireElement(container.querySelector<HTMLInputElement>("#collection-formula-literal")), "4");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: initial.datasetId,
      tableId: initial.tableId,
      expectedRevisionId: initial.revisionId,
      label: "Adjusted total",
      expression: {
        kind: "binary",
        operator: "divide",
        left: { kind: "column", columnId: "column_total00001" },
        right: { kind: "literal", value: 4 }
      }
    });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "datasetId", "expectedRevisionId", "expression", "label", "requestId", "tableId"
    ]);
    expect(container.textContent).toContain("Formula field added as a new revision.");
    const formulaHeader = container.querySelector<HTMLElement>('[data-collection-column-id="column_formula00001"]');
    expect(dom.window.document.activeElement).toBe(formulaHeader);
    expect(container.textContent).toContain("10.5");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit cell: Adjusted total, row 1"
    )).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves a formula draft across stale and failed results with one request per gesture", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddFormulaColumnRequest[] = [];
    const initial = collectionSnapshot("dataset_rev_20260729_formula0001", "Alpha", false, false, false, false, false, true);
    const stale = { ...initial, revisionId: "dataset_rev_20260729_formula0002" };
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        collections: {
          addFormulaColumn: async (request: CollectionAddFormulaColumnRequest): Promise<CollectionAddFormulaColumnResult> => {
            requests.push(request);
            return requests.length === 1
              ? { ...formulaIdentity(request), status: "stale", snapshot: stale }
              : { ...formulaIdentity(request), status: "failed" };
          }
        }
      }
    });
    await act(async () => {
      root.render(createElement(FormulaCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add formula field"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-formula-name"));
    const literal = requireElement(container.querySelector<HTMLInputElement>("#collection-formula-literal"));
    await inputText(dom, name, "Preserved formula");
    await inputText(dom, literal, "2.5");
    await click(dom, buttonNamed(container, "Save"));

    expect(name.value).toBe("Preserved formula");
    expect(literal.value).toBe("2.5");
    expect(container.textContent).toContain("formula draft is preserved");
    expect(dom.window.document.activeElement).toBe(name);
    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([initial.revisionId, stale.revisionId]);
    expect(name.value).toBe("Preserved formula");
    expect(literal.value).toBe("2.5");
    expect(container.textContent).toContain("could not add the formula field");
    expect(dom.window.document.activeElement).toBe(name);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("losslessly prefills and commits an editable formula without taking label authority", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionUpdateFormulaColumnRequest[] = [];
    const initial = editableFormulaSnapshot("dataset_rev_20260729_formula0002");
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: { updateFormulaColumn: async (request: CollectionUpdateFormulaColumnRequest): Promise<CollectionUpdateFormulaColumnResult> => {
        requests.push(request);
        return {
          ...formulaUpdateIdentity(request),
          status: "committed",
          operationId: "op_20260729_formula02",
          snapshot: withUpdatedFormula(initial, request, "dataset_rev_20260729_formula0003")
        };
      } } }
    });
    await act(async () => {
      root.render(createElement(FormulaCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await click(dom, buttonNamed(container, "Edit formula: Adjusted total"));
    const left = requireElement(container.querySelector<HTMLSelectElement>("#collection-formula-left"));
    const operator = requireElement(container.querySelector<HTMLSelectElement>("#collection-formula-operator"));
    const literal = requireElement(container.querySelector<HTMLInputElement>("#collection-formula-literal"));
    expect(container.querySelector("#collection-formula-name")).toBeNull();
    expect(left.value).toBe("column_total00001");
    expect(operator.value).toBe("divide");
    expect(literal.value).toBe("4");
    expect(dom.window.document.activeElement).toBe(left);
    await selectValue(dom, operator, "multiply");
    await inputText(dom, literal, "3");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: initial.datasetId,
      tableId: initial.tableId,
      columnId: "column_formula00001",
      expectedRevisionId: initial.revisionId,
      expression: {
        kind: "binary",
        operator: "multiply",
        left: { kind: "column", columnId: "column_total00001" },
        right: { kind: "literal", value: 3 }
      }
    });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "columnId", "datasetId", "expectedRevisionId", "expression", "requestId", "tableId"
    ]);
    expect(container.textContent).toContain("Formula updated as a new revision.");
    expect(container.textContent).toContain("Adjusted total");
    expect(dom.window.document.activeElement).toBe(
      container.querySelector('[data-collection-column-id="column_formula00001"]')
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves an update draft across stale and failed results while adopting the authoritative revision", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionUpdateFormulaColumnRequest[] = [];
    const initial = editableFormulaSnapshot("dataset_rev_20260729_formula0002");
    const stale = { ...initial, revisionId: "dataset_rev_20260729_formula0003" };
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: { updateFormulaColumn: async (request: CollectionUpdateFormulaColumnRequest): Promise<CollectionUpdateFormulaColumnResult> => {
        requests.push(request);
        return requests.length === 1
          ? { ...formulaUpdateIdentity(request), status: "stale", snapshot: stale }
          : { ...formulaUpdateIdentity(request), status: "failed" };
      } } }
    });
    await act(async () => {
      root.render(createElement(FormulaCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Edit formula: Adjusted total"));
    const left = requireElement(container.querySelector<HTMLSelectElement>("#collection-formula-left"));
    const operator = requireElement(container.querySelector<HTMLSelectElement>("#collection-formula-operator"));
    const literal = requireElement(container.querySelector<HTMLInputElement>("#collection-formula-literal"));
    await selectValue(dom, operator, "subtract");
    await inputText(dom, literal, "2.5");
    await click(dom, buttonNamed(container, "Save"));

    expect(operator.value).toBe("subtract");
    expect(literal.value).toBe("2.5");
    expect(container.textContent).toContain("formula draft is preserved");
    expect(dom.window.document.activeElement).toBe(left);
    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([initial.revisionId, stale.revisionId]);
    expect(operator.value).toBe("subtract");
    expect(literal.value).toBe("2.5");
    expect(container.textContent).toContain("could not update the formula");
    expect(dom.window.document.activeElement).toBe(left);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not expose formula editing for a nested expression projected as unsupported", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = editableFormulaSnapshot("dataset_rev_20260729_formula0002");
    const unsupported: CollectionSnapshot = {
      ...initial,
      columns: initial.columns.map((column) => column.columnId === "column_formula00001" ? {
        ...column,
        canEditFormula: false,
        calculation: {
          kind: "pige_numeric_formula",
          schemaVersion: 1,
          expression: {
            kind: "binary",
            operator: "add",
            left: {
              kind: "binary",
              operator: "multiply",
              left: { kind: "column", columnId: "column_total00001" },
              right: { kind: "literal", value: 2 }
            },
            right: { kind: "literal", value: 1 }
          }
        }
      } : column)
    };
    await act(async () => {
      root.render(createElement(FormulaCollectionHarness, { initialSnapshot: unsupported }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit formula: Adjusted total"
    )).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adds one same-Dataset relation column from exact table and display-field projections", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddRelationColumnRequest[] = [];
    const initial = relationSourceSnapshot("dataset_rev_20260729_relation0001", true);
    const target = relationTargetSnapshot("dataset_rev_20260729_relation0001", [
      relationTargetRow("row_relationtarget01", "Acme")
    ]);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        list: async (): Promise<CollectionListResult> => relationCatalog(initial),
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => ({
          ...openIdentity(request), status: "ready", snapshot: target
        }),
        addRelationColumn: async (request: CollectionAddRelationColumnRequest): Promise<CollectionAddRelationColumnResult> => {
          requests.push(request);
          return {
            ...relationColumnIdentity(request),
            status: "committed",
            columnId: "column_relationlink01",
            operationId: "op_20260729_relation01",
            snapshot: withRelationColumn(initial, request, null, null, "dataset_rev_20260729_relation0002")
          };
        }
      } }
    });
    await act(async () => {
      root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await click(dom, buttonNamed(container, "Add relation field"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-relation-name"));
    const table = requireElement(container.querySelector<HTMLSelectElement>("#collection-relation-table"));
    await inputText(dom, name, "Company");
    await selectValue(dom, table, target.tableId);
    expect(requireElement(container.querySelector<HTMLSelectElement>("#collection-relation-display")).value)
      .toBe("column_relationname01");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: initial.datasetId,
      tableId: initial.tableId,
      expectedRevisionId: initial.revisionId,
      label: "Company",
      targetTableId: target.tableId,
      targetDisplayColumnId: "column_relationname01"
    });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "datasetId", "expectedRevisionId", "label", "requestId",
      "tableId", "targetDisplayColumnId", "targetTableId"
    ]);
    expect(container.textContent).toContain("Relation field added as a new revision.");
    expect(container.textContent).toContain("Not linked");
    expect(dom.window.document.activeElement).toBe(
      container.querySelector('[data-collection-column-id="column_relationlink01"]')
    );
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit cell: Company, row 1"
    )).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adds one relation-backed scalar lookup and renders its projected value read-only", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddLookupColumnRequest[] = [];
    const base = relationSourceSnapshot("dataset_rev_20260729_lookup00001", false);
    const relationRequest = relationAddRequest(base);
    const initial: CollectionSnapshot = {
      ...withRelationColumn(base, relationRequest, "row_relationtarget01", "Acme", base.revisionId),
      canAddLookupColumn: true
    };
    const targetBase = relationTargetSnapshot(initial.revisionId, [relationTargetRow("row_relationtarget01", "Acme")]);
    const target: CollectionSnapshot = {
      ...targetBase,
      columns: targetBase.columns.map((column) => ({ ...column, canUseAsLookupTarget: true }))
    };
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => ({
          ...openIdentity(request), status: "ready", snapshot: target
        }),
        addLookupColumn: async (request: CollectionAddLookupColumnRequest): Promise<CollectionAddLookupColumnResult> => {
          requests.push(request);
          return {
            apiVersion: request.apiVersion,
            requestId: request.requestId,
            activeVaultId: request.activeVaultId,
            datasetId: request.datasetId,
            tableId: request.tableId,
            relationColumnId: request.relationColumnId,
            targetColumnId: request.targetColumnId,
            status: "committed",
            columnId: "column_lookupname001",
            operationId: "op_20260729_lookup0001",
            snapshot: {
              ...initial,
              revisionId: "dataset_rev_20260729_lookup00002",
              canAddLookupColumn: false,
              columns: [...initial.columns.map((column) => column.columnId === request.relationColumnId
                ? { ...column, canTrash: false }
                : column), {
                columnId: "column_lookupname001",
                label: request.label,
                logicalType: "string",
                canRename: true,
                canTrash: true,
                canUseAsFormulaOperand: false,
                canEditFormula: false,
                canUseAsRelationDisplay: false,
                canUseAsLookupTarget: false,
                canEditRelation: false,
                hasInboundRelationDescriptors: false,
                lookup: {
                  kind: "pige_single_lookup",
                  schemaVersion: 1,
                  relationColumnId: request.relationColumnId,
                  targetColumnId: request.targetColumnId
                }
              }],
              rows: initial.rows.map((row) => ({
                ...row,
                cells: [...row.cells, {
                  columnId: "column_lookupname001",
                  value: "Acme",
                  editable: false,
                  readOnlyReason: "lookup" as const
                }]
              }))
            }
          };
        }
      } }
    });
    await act(async () => {
      root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await click(dom, buttonNamed(container, "Add lookup field"));
    await settle(dom);
    await inputText(dom, requireElement(container.querySelector<HTMLInputElement>("#collection-lookup-name")), "Company name");
    expect(requireElement(container.querySelector<HTMLSelectElement>("#collection-lookup-relation")).value)
      .toBe("column_relationlink01");
    expect(requireElement(container.querySelector<HTMLSelectElement>("#collection-lookup-target")).value)
      .toBe("column_relationname01");
    await click(dom, buttonNamed(container, "Save"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      activeVaultId: "vault_20260727_collection01",
      datasetId: initial.datasetId,
      tableId: initial.tableId,
      expectedRevisionId: initial.revisionId,
      label: "Company name",
      relationColumnId: "column_relationlink01",
      targetColumnId: "column_relationname01"
    });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "datasetId", "expectedRevisionId", "label", "relationColumnId",
      "requestId", "tableId", "targetColumnId"
    ]);
    expect(container.textContent).toContain("Lookup field added as a new revision.");
    expect(container.textContent).toContain("Acme");
    expect(dom.window.document.activeElement).toBe(
      container.querySelector('[data-collection-column-id="column_lookupname001"]')
    );
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit cell: Company name, row 1"
    )).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adds one relation-backed count rollup and renders the derived value read-only", async () => {
    const dom = createDom(); const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: CollectionAddRollupColumnRequest[] = [];
    const base = relationSourceSnapshot("dataset_rev_20260729_rollup00001", false);
    const relationRequest = relationAddRequest(base);
    const initial: CollectionSnapshot = {
      ...withRelationColumn(base, relationRequest, "row_relationtarget01", "Acme", base.revisionId), canAddRollupColumn: true
    };
    const target = relationTargetSnapshot(initial.revisionId, [relationTargetRow("row_relationtarget01", "Acme")]);
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { collections: {
      open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => ({ ...openIdentity(request), status: "ready", snapshot: target }),
      addRollupColumn: async (request: CollectionAddRollupColumnRequest): Promise<CollectionAddRollupColumnResult> => {
        requests.push(request); return { apiVersion: request.apiVersion, requestId: request.requestId,
          activeVaultId: request.activeVaultId, datasetId: request.datasetId, tableId: request.tableId,
          relationColumnId: request.relationColumnId, aggregation: request.aggregation, status: "committed",
          columnId: "column_rollupcount001", operationId: "op_20260729_rollup0001", snapshot: {
            ...initial, revisionId: "dataset_rev_20260729_rollup00002", canAddRollupColumn: false,
            columns: [...initial.columns, { columnId: "column_rollupcount001", label: request.label, logicalType: "number",
              canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false,
              canUseAsRelationDisplay: false, canEditRelation: false, canUseAsLookupTarget: false,
              canUseAsRollupTarget: false, hasInboundRelationDescriptors: false,
              rollup: { kind: "pige_single_rollup", schemaVersion: 1, relationColumnId: request.relationColumnId,
                aggregation: "count" } }],
            rows: initial.rows.map((row) => ({ ...row, cells: [...row.cells, { columnId: "column_rollupcount001",
              value: 1, editable: false, readOnlyReason: "rollup" as const }] }))
          } };
      }
    } } });
    await act(async () => { root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial })); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add rollup field")); await settle(dom);
    await inputText(dom, requireElement(container.querySelector<HTMLInputElement>("#collection-rollup-name")), "Related count");
    await click(dom, buttonNamed(container, "Save"));
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ label: "Related count",
      relationColumnId: "column_relationlink01", aggregation: "count" });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual(["activeVaultId", "aggregation", "apiVersion", "datasetId",
      "expectedRevisionId", "label", "relationColumnId", "requestId", "tableId"]);
    expect(container.textContent).toContain("Rollup field added as a new revision.");
    expect(dom.window.document.activeElement).toBe(container.querySelector('[data-collection-column-id="column_rollupcount001"]'));
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.getAttribute("aria-label") === "Edit cell: Related count, row 1")).toBe(false);
    await act(async () => root.unmount()); dom.window.close();
  });

  it("keeps an add-relation draft but removes submit authority when stale revokes the capability", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = relationSourceSnapshot("dataset_rev_20260729_relation0001", true);
    const target = relationTargetSnapshot(initial.revisionId, [relationTargetRow("row_relationtarget01", "Acme")]);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        list: async (): Promise<CollectionListResult> => relationCatalog(initial),
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => ({ ...openIdentity(request), status: "ready", snapshot: target }),
        addRelationColumn: async (request: CollectionAddRelationColumnRequest): Promise<CollectionAddRelationColumnResult> => ({
          ...relationColumnIdentity(request),
          status: "stale",
          snapshot: { ...initial, revisionId: "dataset_rev_20260729_relation0002", canAddRelationColumn: false }
        })
      } }
    });
    await act(async () => { root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial })); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add relation field"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-relation-name"));
    await inputText(dom, name, "Company");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-relation-table")), target.tableId);
    await click(dom, buttonNamed(container, "Save"));

    expect(name.value).toBe("Company");
    expect(requireElement(container.querySelector<HTMLSelectElement>("#collection-relation-table")).value).toBe(target.tableId);
    expect(buttonNamed(container, "Save").disabled).toBe(true);
    expect(container.textContent).toContain("relation selection is preserved against the latest revision");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("pages exact relation targets, preserves selection across stale and failure, then sets and clears with focus recovery", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initialBase = relationSourceSnapshot("dataset_rev_20260729_relation0002", false);
    const initial = withRelationColumn(initialBase, relationAddRequest(initialBase), "row_relationtarget01", "Acme", initialBase.revisionId);
    const stale = { ...initial, revisionId: "dataset_rev_20260729_relation0003" };
    const requests: CollectionEditRelationCellRequest[] = [];
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => request.rowCursor
          ? {
              ...openIdentity(request),
              status: "ready",
              snapshot: relationTargetSnapshot(stale.revisionId, [
                relationTargetRow("row_relationtarget01", "Acme"),
                relationTargetRow("row_relationtarget02", "Beta")
              ])
            }
          : {
              ...openIdentity(request),
              status: "ready",
              snapshot: relationTargetSnapshot(stale.revisionId, [relationTargetRow("row_relationtarget01", "Acme")], true),
              nextRowCursor: "collection_rows_relation_page02"
            },
        editRelationCell: async (request: CollectionEditRelationCellRequest): Promise<CollectionEditRelationCellResult> => {
          requests.push(request);
          if (requests.length === 1) return { ...relationCellIdentity(request), status: "stale", snapshot: stale };
          if (requests.length === 2) return { ...relationCellIdentity(request), status: "failed" };
          const label = request.targetRowId === "row_relationtarget02" ? "Beta" : null;
          return {
            ...relationCellIdentity(request),
            status: "committed",
            operationId: `op_20260729_relation0${requests.length}`,
            snapshot: withRelationCell(stale, request.targetRowId, label, `dataset_rev_20260729_relation000${requests.length + 2}`)
          };
        }
      } }
    });
    await act(async () => {
      root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Edit relation: Company, row 1"));
    await click(dom, buttonNamed(container, "Load more rows"));
    const targets = requireElement(container.querySelector<HTMLElement>('[aria-label="Related row"]'));
    expect(Array.from(targets.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "Acme")).toHaveLength(1);
    expect(buttonNamed(container, "Save").disabled).toBe(true);
    await click(dom, buttonNamed(targets, "Beta"));
    await click(dom, buttonNamed(container, "Save"));

    expect(requests[0]).toMatchObject({
      expectedRevisionId: initial.revisionId,
      rowId: "row_relationsource01",
      columnId: "column_relationlink01",
      targetRowId: "row_relationtarget02"
    });
    expect(buttonNamed(targets, "Beta").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("selection is preserved against the latest revision");
    expect(container.textContent).toContain("Acme");
    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map((request) => request.expectedRevisionId)).toEqual([
      initial.revisionId, stale.revisionId
    ]);
    expect(buttonNamed(targets, "Beta").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("could not save the relation");
    await click(dom, buttonNamed(container, "Save"));

    const relationTrigger = buttonNamed(container, "Edit relation: Company, row 1");
    expect(relationTrigger.textContent?.trim()).toBe("Beta");
    expect(dom.window.document.activeElement).toBe(relationTrigger);
    await click(dom, relationTrigger);
    await click(dom, buttonNamed(container, "No related row"));
    await click(dom, buttonNamed(container, "Save"));
    expect(requests.at(-1)?.targetRowId).toBeNull();
    expect(buttonNamed(container, "Edit relation: Company, row 1").textContent?.trim()).toBe("Not linked");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences a pending relation commit when the active vault identity changes", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = relationSourceSnapshot("dataset_rev_20260729_relation0001", true);
    const target = relationTargetSnapshot(initial.revisionId, [relationTargetRow("row_relationtarget01", "Acme")]);
    let captured: CollectionAddRelationColumnRequest | null = null;
    let resolveCommit!: (result: CollectionAddRelationColumnResult) => void;
    const pending = new Promise<CollectionAddRelationColumnResult>((resolve) => { resolveCommit = resolve; });
    let adoptionCount = 0;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        list: async (): Promise<CollectionListResult> => relationCatalog(initial),
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => ({ ...openIdentity(request), status: "ready", snapshot: target }),
        addRelationColumn: async (request: CollectionAddRelationColumnRequest): Promise<CollectionAddRelationColumnResult> => {
          captured = request;
          return pending;
        }
      } }
    });
    const render = (activeVaultId: string) => createElement(ManagedCollectionPanel, {
      activeVaultId,
      snapshot: initial,
      onClose: () => undefined,
      onAddNullableColumn: notFoundColumnResult,
      onRenameColumn: notFoundRenameResult,
      onTrashColumn: notFoundTrashColumnResult,
      onOpenView: async () => null,
      onCreateView: notFoundCreateViewResult,
      onAppendDefaultRow: notFoundAppendResult,
      onTrashRow: notFoundTrashResult,
      onAdoptSnapshot: () => { adoptionCount += 1; return true; },
      onEditCell: async (request) => ({ ...editIdentity(request), status: "failed" }),
      onReload: async () => initial,
      t
    });
    await act(async () => { root.render(render("vault_20260727_collection01")); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Add relation field"));
    await inputText(dom, requireElement(container.querySelector<HTMLInputElement>("#collection-relation-name")), "Company");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-relation-table")), target.tableId);
    await click(dom, buttonNamed(container, "Save"));
    expect(captured).not.toBeNull();

    await act(async () => { root.render(render("vault_20260727_collection02")); await settle(dom); });
    const request = captured as CollectionAddRelationColumnRequest | null;
    if (!request) throw new Error("Expected relation request.");
    await act(async () => {
      resolveCommit({
        ...relationColumnIdentity(request),
        status: "committed",
        columnId: "column_relationlink01",
        operationId: "op_20260729_relation01",
        snapshot: withRelationColumn(initial, request, null, null, "dataset_rev_20260729_relation0002")
      });
      await settle(dom);
    });
    expect(adoptionCount).toBe(0);
    expect(container.textContent).not.toContain("Relation field added as a new revision.");
    expect(container.textContent).not.toContain("Company");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("rejects a target page from another revision without replacing visible target rows", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const base = relationSourceSnapshot("dataset_rev_20260729_relation0002", false);
    const initial = withRelationColumn(base, relationAddRequest(base), "row_relationtarget01", "Acme", base.revisionId);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { collections: {
        open: async (request: CollectionOpenRequest): Promise<CollectionOpenResult> => request.rowCursor
          ? {
              ...openIdentity(request),
              status: "ready",
              snapshot: relationTargetSnapshot("dataset_rev_20260729_relation9999", [relationTargetRow("row_relationtarget02", "Beta")])
            }
          : {
              ...openIdentity(request),
              status: "ready",
              snapshot: relationTargetSnapshot(initial.revisionId, [relationTargetRow("row_relationtarget01", "Acme")], true),
              nextRowCursor: "collection_rows_relation_page02"
            }
      } }
    });
    await act(async () => { root.render(createElement(RelationCollectionHarness, { initialSnapshot: initial })); await settle(dom); });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Edit relation: Company, row 1"));
    await click(dom, buttonNamed(container, "Load more rows"));
    const targets = requireElement(container.querySelector<HTMLElement>('[aria-label="Related row"]'));

    expect(targets.textContent).toContain("Acme");
    expect(targets.textContent).not.toContain("Beta");
    expect(container.textContent).toContain("could not load related rows");
    expect(container.textContent).toContain("Ada");

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

  it("edits one saved view definition, preserves its stale draft, and restores selector focus", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initial = savedView("view_20260728_editview001", "Editable");
    const concurrent = { ...initial, viewRevision: 2 };
    const committed = { ...initial, viewRevision: 3,
      filter: { operator: "eq" as const, columnId: "column_name000001", value: "Alpha" },
      sort: { columnId: "column_total00001", direction: "desc" as const } };
    const base = collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha");
    const requests: CollectionUpdateViewRequest[] = [];
    await act(async () => {
      root.render(createElement(CollectionViewHarness, {
        initialSnapshot: withViews(base, [initial], initial.viewId),
        onOpen: async () => null,
        onCreate: notFoundCreateViewResult,
        onUpdate: async (request) => {
          requests.push(request);
          return requests.length === 1
            ? { ...viewMutationIdentity(request), status: "stale", currentViewRevision: 2,
              snapshot: withViews(base, [concurrent], concurrent.viewId) }
            : { ...viewMutationIdentity(request), status: "committed", operationId: "op_20260728_viewupdate01",
              snapshot: withViews(base, [committed], committed.viewId) };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Edit view"));
    const operator = requireElement(container.querySelector<HTMLSelectElement>("#collection-view-filter-operator"));
    await selectValue(dom, operator, "eq");
    const filterValue = requireElement(container.querySelector<HTMLInputElement>("#collection-view-filter-value"));
    await act(async () => { filterValue.focus(); await settle(dom); });
    await inputText(dom, filterValue, "Alpha");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-view-sort-column")), "column_total00001");
    await selectValue(dom, requireElement(container.querySelector<HTMLSelectElement>("#collection-view-sort-direction")), "desc");
    await click(dom, buttonNamed(container, "Save"));
    expect(requests[0]).toMatchObject({
      expectedRevisionId: base.revisionId,
      expectedViewRevision: 1,
      viewId: initial.viewId,
      filter: committed.filter,
      sort: committed.sort
    });
    expect(container.textContent).toContain("The collection changed. Your view draft is preserved.");
    expect(requireElement(container.querySelector<HTMLInputElement>("#collection-view-filter-value")).value).toBe("Alpha");
    expect(dom.window.document.activeElement).toBe(requireElement(container.querySelector<HTMLInputElement>('input[type="checkbox"]')));

    await click(dom, buttonNamed(container, "Save"));
    expect(requests.map(({ expectedViewRevision }) => expectedViewRevision)).toEqual([1, 2]);
    const selector = requireElement(container.querySelector<HTMLSelectElement>("#collection-view-select"));
    expect(selector.value).toBe(initial.viewId);
    expect(container.textContent).toContain("View definition saved as a new revision.");
    expect(dom.window.document.activeElement).toBe(selector);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renames the active owned view with exact CAS and falls back to All rows after trash", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const initialView = { ...savedView("view_20260728_lifecycle01", "Original"), canRename: true, canTrash: true };
    const concurrentView = { ...initialView, viewRevision: 2, name: "Server name" };
    const renamedView = { ...initialView, viewRevision: 3, name: "My name" };
    const base = collectionSnapshot("dataset_rev_20260728_revision0001", "Alpha");
    const renameRequests: CollectionRenameViewRequest[] = [];
    const trashRequests: CollectionTrashViewRequest[] = [];
    await act(async () => {
      root.render(createElement(CollectionViewHarness, {
        initialSnapshot: withViews(base, [initialView], initialView.viewId),
        onOpen: async () => null,
        onCreate: notFoundCreateViewResult,
        onRename: async (request) => {
          renameRequests.push(request);
          return renameRequests.length === 1
            ? { ...viewMutationIdentity(request), status: "stale", currentViewRevision: 2,
              snapshot: withViews(base, [concurrentView], concurrentView.viewId) }
            : { ...viewMutationIdentity(request), status: "committed", operationId: "op_20260728_viewrename01",
              snapshot: withViews(base, [renamedView], renamedView.viewId) };
        },
        onTrash: async (request) => {
          trashRequests.push(request);
          return { ...viewMutationIdentity(request), status: "committed", operationId: "op_20260728_viewtrash001",
            snapshot: withViews(base, []) };
        }
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await click(dom, buttonNamed(container, "Rename"));
    const name = requireElement(container.querySelector<HTMLInputElement>("#collection-view-rename"));
    await inputText(dom, name, "My name");
    await click(dom, buttonNamed(container, "Save"));
    expect(renameRequests[0]).toMatchObject({
      expectedRevisionId: base.revisionId, viewId: initialView.viewId, expectedViewRevision: 1, name: "My name"
    });
    expect(name.value).toBe("My name");
    await click(dom, buttonNamed(container, "Save"));
    expect(renameRequests[1]).toMatchObject({ expectedViewRevision: 2, name: "My name" });
    expect(container.textContent).toContain("View renamed as a new revision.");

    await click(dom, buttonNamed(container, "Move to trash"));
    expect(trashRequests).toEqual([expect.objectContaining({
      expectedRevisionId: base.revisionId, viewId: initialView.viewId, expectedViewRevision: 3
    })]);
    const selector = requireElement(container.querySelector<HTMLSelectElement>("#collection-view-select"));
    expect(selector.value).toBe("");
    expect(Array.from(selector.options).map((option) => option.textContent)).toEqual(["All rows"]);
    expect(container.textContent).toContain("View moved to trash. All rows are shown.");
    expect(dom.window.document.activeElement).toBe(selector);
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
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async (activity) => { opened.push(activity.operationId); },
        onUndo: async (operationId) => { undone.push(operationId); },
        onRedo: async () => undefined,
        hasMore: false, loadingMore: false, loadMoreFailed: false, onLoadMore: async () => false,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection cell updated: Customers");
    await click(dom, buttonNamed(container, "Open"));
    await click(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-activity-undo-id="op_20260727_collection01"]')));
    expect(opened).toEqual(["op_20260727_collection01"]);
    expect(undone).toEqual(["op_20260727_collection01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("labels every Memory lifecycle Activity and forwards its exact safe target", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const opened: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [
          {
            operationId: "op_20260730_memoryupdate01",
            kind: "update_memory",
            createdAt: "2026-07-30T08:00:00.000Z",
            targetLabel: "Concise summaries",
            target: { kind: "memory", memoryId: "memory_20260730_concisesummaries" },
            status: "applied",
            canUndo: true,
          },
          {
            operationId: "op_20260730_memorytrash01",
            kind: "trash_memory",
            createdAt: "2026-07-30T08:01:00.000Z",
            targetLabel: "Review preference",
            target: { kind: "memory", memoryId: "memory_20260730_reviewpreference" },
            status: "applied",
            canUndo: true,
          },
          {
            operationId: "op_20260730_memoryrestore01",
            kind: "restore_memory",
            createdAt: "2026-07-30T08:02:00.000Z",
            targetLabel: "Writing style",
            target: { kind: "memory", memoryId: "memory_20260730_writingstyle" },
            status: "applied",
            canUndo: false,
          },
        ],
        undoingId: null,
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async (activity) => { opened.push(activity.operationId); },
        onUndo: async () => undefined,
        onRedo: async () => undefined,
        hasMore: false, loadingMore: false, loadMoreFailed: false, onLoadMore: async () => false,
        t,
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Memory updated: Concise summaries");
    expect(container.textContent).toContain("Memory moved to trash: Review preference");
    expect(container.textContent).toContain("Memory restored: Writing style");
    const exactOpen = requireElement(container.querySelector<HTMLButtonElement>(
      '[data-activity-open-id="op_20260730_memoryupdate01"]',
    ));
    await click(dom, exactOpen);
    expect(opened).toEqual(["op_20260730_memoryupdate01"]);

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
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        onRedo: async () => undefined,
        hasMore: false, loadingMore: false, loadMoreFailed: false, onLoadMore: async () => false,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection row moved to trash: Customers");
    await click(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-activity-undo-id="op_20260728_collectiontrash01"]')));
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
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        onRedo: async () => undefined,
        hasMore: false, loadingMore: false, loadMoreFailed: false, onLoadMore: async () => false,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection field moved to trash: Customers");
    await click(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-activity-undo-id="op_20260728_collectiontrashcolumn01"]')));
    expect(undone).toEqual(["op_20260728_collectiontrashcolumn01"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("labels a trashed collection view and keeps forward Undo available through Activity", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const undone: string[] = [];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activities: [{
          operationId: "op_20260728_collectionview01",
          kind: "trash_collection_view",
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
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async (operationId) => { undone.push(operationId); },
        onRedo: async () => undefined,
        hasMore: false, loadingMore: false, loadMoreFailed: false, onLoadMore: async () => false,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Collection view moved to trash: Priority items");
    await click(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-activity-undo-id="op_20260728_collectionview01"]')));
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
  readonly onUpdate?: (request: CollectionUpdateViewRequest) => Promise<CollectionUpdateViewResult>;
  readonly onRename?: (request: CollectionRenameViewRequest) => Promise<CollectionRenameViewResult>;
  readonly onTrash?: (request: CollectionTrashViewRequest) => Promise<CollectionTrashViewResult>;
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
    onUpdateView: props.onUpdate ?? notFoundUpdateViewResult,
    onRenameView: props.onRename ?? notFoundRenameViewResult,
    onTrashView: props.onTrash ?? notFoundTrashViewResult,
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

function FormulaCollectionHarness(props: {
  readonly initialSnapshot: CollectionSnapshot;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
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

function RelationCollectionHarness(props: {
  readonly initialSnapshot: CollectionSnapshot;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
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
  canTrashColumn = false,
  canAddFormulaColumn = false
): CollectionSnapshot {
  return {
    datasetId: "dataset_20260727_collection01",
    revisionId,
    title: "Customers",
    tableId: "table_collection01",
    tableName: "Customers",
    columns: [
      { columnId: "column_name000001", label: "Name", logicalType: "string", canRename, canTrash: canTrashColumn, canUseAsFormulaOperand: false, canEditFormula: false },
      { columnId: "column_total00001", label: "Total", logicalType: "number", canRename: false, canTrash: false, canUseAsFormulaOperand: true, canEditFormula: false }
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
    canAddFormulaColumn,
    views: []
  };
}

function relationSourceSnapshot(revisionId: string, canAddRelationColumn: boolean): CollectionSnapshot {
  const source = collectionSnapshot(revisionId, "Ada");
  return {
    ...source,
    columns: source.columns.map((column) => ({
      ...column,
      canUseAsRelationDisplay: column.columnId === "column_name000001",
      canEditRelation: false,
      hasInboundRelationDescriptors: false
    })),
    rows: source.rows.map((row) => ({ ...row, rowId: "row_relationsource01", hasInboundRelationReferences: false })),
    canAddRelationColumn
  };
}

function relationTargetSnapshot(
  revisionId: string,
  rows: CollectionSnapshot["rows"],
  truncated = false
): CollectionSnapshot {
  return {
    datasetId: "dataset_20260727_collection01",
    revisionId,
    title: "Customers",
    tableId: "table_relationtarget01",
    tableName: "Companies",
    columns: [{
      columnId: "column_relationname01",
      label: "Company name",
      logicalType: "string",
      canRename: true,
      canTrash: false,
      canUseAsFormulaOperand: false,
      canEditFormula: false,
      canUseAsRelationDisplay: true,
      canEditRelation: false,
      hasInboundRelationDescriptors: true
    }],
    rows: [...rows],
    totalRowCount: truncated ? 2 : rows.length,
    returnedRowCount: rows.length,
    truncated,
    canAppendDefaultRow: false,
    canAddColumn: false,
    canAddFormulaColumn: false,
    canAddRelationColumn: false,
    views: []
  };
}

function relationTargetRow(rowId: string, label: string): CollectionSnapshot["rows"][number] {
  return {
    rowId,
    canTrash: false,
    hasInboundRelationReferences: true,
    cells: [{ columnId: "column_relationname01", value: label, editable: true }]
  };
}

function relationAddRequest(snapshot: CollectionSnapshot): CollectionAddRelationColumnRequest {
  return {
    apiVersion: 1,
    requestId: "collection_request_relation_fixture01",
    activeVaultId: "vault_20260727_collection01",
    datasetId: snapshot.datasetId,
    tableId: snapshot.tableId,
    expectedRevisionId: snapshot.revisionId,
    label: "Company",
    targetTableId: "table_relationtarget01",
    targetDisplayColumnId: "column_relationname01"
  };
}

function withRelationColumn(
  snapshot: CollectionSnapshot,
  request: CollectionAddRelationColumnRequest,
  targetRowId: string | null,
  displayLabel: string | null,
  revisionId: string
): CollectionSnapshot {
  const columnId = "column_relationlink01";
  return {
    ...snapshot,
    revisionId,
    canAddRelationColumn: false,
    columns: [...snapshot.columns, {
      columnId,
      label: request.label,
      logicalType: "string",
      canRename: true,
      canTrash: true,
      canUseAsFormulaOperand: false,
      canEditFormula: false,
      canUseAsRelationDisplay: false,
      canEditRelation: true,
      hasInboundRelationDescriptors: false,
      relation: {
        kind: "pige_single_relation",
        schemaVersion: 1,
        targetTableId: request.targetTableId,
        targetDisplayColumnId: request.targetDisplayColumnId
      }
    }],
    rows: snapshot.rows.map((row) => ({
      ...row,
      cells: [...row.cells, {
        columnId,
        value: { kind: "relation", targetRowId, displayLabel },
        editable: true
      }]
    }))
  };
}

function withRelationCell(
  snapshot: CollectionSnapshot,
  targetRowId: string | null,
  displayLabel: string | null,
  revisionId: string
): CollectionSnapshot {
  return {
    ...snapshot,
    revisionId,
    rows: snapshot.rows.map((row) => row.rowId === "row_relationsource01" ? {
      ...row,
      cells: row.cells.map((cell) => cell.columnId === "column_relationlink01" ? {
        ...cell,
        value: { kind: "relation" as const, targetRowId, displayLabel }
      } : cell)
    } : row)
  };
}

function relationCatalog(snapshot: CollectionSnapshot): CollectionListResult {
  return {
    apiVersion: 1,
    activeVaultId: "vault_20260727_collection01",
    status: "ready",
    datasets: [{
      datasetId: snapshot.datasetId,
      title: snapshot.title,
      activeRevisionId: snapshot.revisionId,
      tableCount: 2,
      tables: [
        { tableId: snapshot.tableId, tableName: snapshot.tableName, columnCount: snapshot.columns.length, rowCount: snapshot.totalRowCount, canOpen: true },
        { tableId: "table_relationtarget01", tableName: "Companies", columnCount: 1, rowCount: 2, canOpen: true }
      ],
      tablesTruncated: false
    }],
    totalDatasetCount: 1,
    hasMore: false
  };
}

function savedView(
  viewId: string,
  name: string,
  filter: CollectionViewSummary["filter"] = { operator: "is_null", columnId: "column_name000001" },
  sort: CollectionViewSummary["sort"] = { columnId: "column_name000001", direction: "asc" }
): CollectionViewSummary {
  return { viewId, viewRevision: 1, name, filter, sort, canEdit: true, canRename: true, canTrash: true };
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
    columns: [...snapshot.columns, { columnId, label, logicalType, canRename: false, canTrash: false, canUseAsFormulaOperand: false, canEditFormula: false }],
    rows: snapshot.rows.map((row) => ({
      ...row,
      cells: [...row.cells, { columnId, value: null, editable: true }]
    }))
  };
}

function withFormulaColumn(
  snapshot: CollectionSnapshot,
  request: CollectionAddFormulaColumnRequest
): CollectionSnapshot {
  const columnId = "column_formula00001";
  return {
    ...snapshot,
    revisionId: "dataset_rev_20260729_formula0002",
    columns: [...snapshot.columns, {
      columnId,
      label: request.label,
      logicalType: "number",
      canRename: true,
      canTrash: true,
      canUseAsFormulaOperand: false,
      canEditFormula: true,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: request.expression }
    }],
    rows: snapshot.rows.map((row) => ({
      ...row,
      cells: [...row.cells, { columnId, value: 10.5, editable: false, readOnlyReason: "formula" }]
    }))
  };
}

function editableFormulaSnapshot(revisionId: string): CollectionSnapshot {
  const request: CollectionAddFormulaColumnRequest = {
    apiVersion: 1,
    requestId: "collection_request_formula_fixture01",
    activeVaultId: "vault_20260727_collection01",
    datasetId: "dataset_20260727_collection01",
    tableId: "table_collection01",
    expectedRevisionId: "dataset_rev_20260729_formula0001",
    label: "Adjusted total",
    expression: {
      kind: "binary",
      operator: "divide",
      left: { kind: "column", columnId: "column_total00001" },
      right: { kind: "literal", value: 4 }
    }
  };
  return {
    ...withFormulaColumn(
      collectionSnapshot(request.expectedRevisionId, "Alpha", false, false, false, false, false, true),
      request
    ),
    revisionId
  };
}

function withUpdatedFormula(
  snapshot: CollectionSnapshot,
  request: CollectionUpdateFormulaColumnRequest,
  revisionId: string
): CollectionSnapshot {
  return {
    ...snapshot,
    revisionId,
    columns: snapshot.columns.map((column) => column.columnId === request.columnId ? {
      ...column,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: request.expression }
    } : column)
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

function formulaIdentity(request: CollectionAddFormulaColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId
  };
}

function formulaUpdateIdentity(request: CollectionUpdateFormulaColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    columnId: request.columnId
  };
}

function relationColumnIdentity(request: CollectionAddRelationColumnRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    targetTableId: request.targetTableId,
    targetDisplayColumnId: request.targetDisplayColumnId
  };
}

function relationCellIdentity(request: CollectionEditRelationCellRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    datasetId: request.datasetId,
    tableId: request.tableId,
    rowId: request.rowId,
    columnId: request.columnId,
    targetRowId: request.targetRowId
  };
}

function openIdentity(request: CollectionOpenRequest) {
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

function viewMutationIdentity(request: CollectionRenameViewRequest | CollectionUpdateViewRequest | CollectionTrashViewRequest) {
  return { ...createViewIdentity(request), viewId: request.viewId };
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

async function notFoundRenameViewResult(
  request: CollectionRenameViewRequest
): Promise<CollectionRenameViewResult> {
  return { ...viewMutationIdentity(request), status: "not_found" };
}

async function notFoundUpdateViewResult(
  request: CollectionUpdateViewRequest
): Promise<CollectionUpdateViewResult> {
  return { ...viewMutationIdentity(request), status: "not_found" };
}

async function notFoundTrashViewResult(
  request: CollectionTrashViewRequest
): Promise<CollectionTrashViewResult> {
  return { ...viewMutationIdentity(request), status: "not_found" };
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
