import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CollectionAnalyticalSnapshotCitationResult,
  CollectionAnalyticalSnapshotCreateResult,
  CollectionAnalyticalSnapshotListResult,
  CollectionAnalyticalSnapshotOpenResult,
  CollectionAnalyticalSnapshotPreview,
  CollectionAnalyticalSnapshotSummary,
  CollectionSnapshot
} from "@pige/schemas";
import { AnalyticalSnapshotPanel } from "../../apps/desktop/src/renderer/src/components/AnalyticalSnapshotPanel";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("AnalyticalSnapshotPanel", () => {
  it("creates, opens, and cites the exact immutable snapshot without duplicate submission", async () => {
    const summary = snapshotSummary();
    const preview = snapshotPreview();
    const list = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.listAnalyticalSnapshots>>[0]) =>
      ({ ...request, status: "ready" as const, snapshots: [] } satisfies CollectionAnalyticalSnapshotListResult));
    const create = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.createAnalyticalSnapshot>>[0]) =>
      ({ ...request, status: "committed" as const, snapshot: summary } satisfies CollectionAnalyticalSnapshotCreateResult));
    const open = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.openAnalyticalSnapshot>>[0]) =>
      ({ ...request, status: "ready" as const, preview } satisfies CollectionAnalyticalSnapshotOpenResult));
    const openCitation = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.openAnalyticalSnapshotCitation>>[0]) =>
      ({ ...request, status: "ready" as const, citation: {
        snapshotId: summary.snapshotId,
        citationRef: "snapshot_citation_abcdef0123456789",
        rowId: "row_abcdefghijkl",
        columnIds: ["column_abcdefghijkl"],
        resultHash: `sha256:${"d".repeat(64)}`,
        preview
      } } satisfies CollectionAnalyticalSnapshotCitationResult));
    const harness = await mount({ list, create, open, openCitation });
    await settle(harness.dom);
    const createButton = button(harness.container, "collection.snapshotCreate");
    createButton.focus();
    await act(async () => {
      createButton.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      createButton.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      await settle(harness.dom);
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      activeVaultId: "vault_20260809_snapshotui",
      datasetId: "dataset_20260809_abcdefghijkl",
      tableId: "table_abcdefghijkl",
      expectedRevisionId: "dataset_rev_20260809_abcdefghijkl"
    });
    expect(open).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain("Launch");
    await act(async () => {
      button(harness.container, "collection.snapshotCite").click();
      await settle(harness.dom);
    });
    expect(openCitation).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain("snapshot_citation_abcdef0123456789");
    await harness.unmount();
  });

  it("retains the current action and focus when Main rejects a stale snapshot gesture", async () => {
    const list = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.listAnalyticalSnapshots>>[0]) =>
      ({ ...request, status: "ready" as const, snapshots: [] } satisfies CollectionAnalyticalSnapshotListResult));
    const create = vi.fn(async (request: Parameters<NonNullable<typeof window.pige.collections.createAnalyticalSnapshot>>[0]) =>
      ({ ...request, status: "stale" as const } satisfies CollectionAnalyticalSnapshotCreateResult));
    const harness = await mount({
      list,
      create,
      open: vi.fn(),
      openCitation: vi.fn()
    });
    await settle(harness.dom);
    const createButton = button(harness.container, "collection.snapshotCreate");
    createButton.focus();
    await act(async () => {
      createButton.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      await settle(harness.dom);
    });
    expect(create).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain("collection.snapshot_stale");
    expect(harness.dom.window.document.activeElement).toBe(createButton);
    await harness.unmount();
  });
});

async function mount(actions: {
  readonly list: (...args: never[]) => Promise<unknown>;
  readonly create: (...args: never[]) => Promise<unknown>;
  readonly open: (...args: never[]) => Promise<unknown>;
  readonly openCitation: (...args: never[]) => Promise<unknown>;
}) {
  const dom = new JSDOM("<div id=\"root\"></div>", { pretendToBeVisual: true, url: "http://localhost/" });
  const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "MouseEvent", "crypto", "requestAnimationFrame"] as const) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    Node: { configurable: true, value: dom.window.Node },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    crypto: { configurable: true, value: { randomUUID: () => "01234567-89ab-cdef-0123-456789abcdef" } },
    requestAnimationFrame: { configurable: true, value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) }
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => undefined },
    detachEvent: { configurable: true, value: () => undefined }
  });
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { collections: {
    listAnalyticalSnapshots: actions.list,
    createAnalyticalSnapshot: actions.create,
    openAnalyticalSnapshot: actions.open,
    openAnalyticalSnapshotCitation: actions.openCitation
  } } });
  const container = dom.window.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => root.render(createElement(AnalyticalSnapshotPanel, {
    activeVaultId: "vault_20260809_snapshotui",
    snapshot: collectionSnapshot(),
    t: (key: string) => key
  })));
  return {
    dom,
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  };
}

function collectionSnapshot(): CollectionSnapshot {
  return {
    datasetId: "dataset_20260809_abcdefghijkl",
    revisionId: "dataset_rev_20260809_abcdefghijkl",
    title: "Events",
    tableId: "table_abcdefghijkl",
    tableName: "Events",
    columns: [{ columnId: "column_abcdefghijkl", label: "Name", logicalType: "string",
      canRename: true, canTrash: true, canUseAsFormulaOperand: false, canEditFormula: false }],
    rows: [],
    totalRowCount: 0,
    returnedRowCount: 0,
    truncated: false,
    canAppendDefaultRow: true,
    canAddColumn: true,
    canAddFormulaColumn: true,
    canAddRelationColumn: true,
    canAddLookupColumn: true,
    canAddRollupColumn: true,
    views: []
  };
}

function snapshotSummary(): CollectionAnalyticalSnapshotSummary {
  return {
    snapshotId: "snapshot_20260809_abcdefghijkl",
    datasetId: "dataset_20260809_abcdefghijkl",
    revisionId: "dataset_rev_20260809_abcdefghijkl",
    tableId: "table_abcdefghijkl",
    title: "Events snapshot",
    tableName: "Events",
    rowCount: 1,
    columnCount: 1,
    operationId: "op_20260809_snapshotui",
    createdAt: "2026-08-09T00:00:00.000Z"
  };
}

function snapshotPreview(): CollectionAnalyticalSnapshotPreview {
  return {
    snapshotId: "snapshot_20260809_abcdefghijkl",
    datasetId: "dataset_20260809_abcdefghijkl",
    revisionId: "dataset_rev_20260809_abcdefghijkl",
    tableId: "table_abcdefghijkl",
    title: "Events snapshot",
    tableName: "Events",
    columns: [{ columnId: "column_abcdefghijkl", label: "Name", logicalType: "string",
      canRename: false, canTrash: false, canUseAsFormulaOperand: false, canEditFormula: false }],
    rows: [{ rowId: "row_abcdefghijkl", cells: [{ columnId: "column_abcdefghijkl", value: "Launch", editable: true }], canTrash: false }],
    totalRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    snapshotHash: `sha256:${"b".repeat(64)}`
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result as HTMLButtonElement;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
