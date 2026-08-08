import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { AnalyticalSnapshotService } from "../../apps/desktop/src/main/services/analytical-snapshot-service";
import { registerAnalyticalSnapshotIpc } from "../../apps/desktop/src/main/register-analytical-snapshot-ipc";

type Handler = (event: IpcMainInvokeEvent, input: unknown) => unknown;

const vaultId = "vault_20260809_snapshotipc";
const datasetId = "dataset_20260809_abcdefghijkl";
const revisionId = "dataset_rev_20260809_abcdefghijkl";
const tableId = "table_abcdefghijkl";
const snapshotId = "snapshot_20260809_abcdefghijkl";
const rowId = "row_abcdefghijkl";
const operationId = "op_20260809_snapshotipc";

describe("registerAnalyticalSnapshotIpc", () => {
  it("keeps the create, browse, and citation flow trusted, identity-bound, and pathless", async () => {
    const handlers = new Map<string, Handler>();
    const record = {
      schemaVersion: 1 as const,
      snapshotId,
      requestId: "collection_request_snapshotipc000001",
      datasetId,
      revisionId,
      tableId,
      title: "Events snapshot",
      tableName: "Events",
      sourceRevisionHash: `sha256:${"a".repeat(64)}`,
      rowCount: 1,
      columnCount: 1,
      operationId,
      createdAt: "2026-08-09T00:00:00.000Z"
    };
    const preview = {
      snapshotId,
      datasetId,
      revisionId,
      tableId,
      title: record.title,
      tableName: record.tableName,
      columns: [{ columnId: "column_abcdefghijkl", label: "Name", logicalType: "string" as const,
        canRename: false, canTrash: false, canUseAsFormulaOperand: false, canEditFormula: false }],
      rows: [{ rowId, cells: [{ columnId: "column_abcdefghijkl", value: "Launch", editable: true }], canTrash: false }],
      totalRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      snapshotHash: `sha256:${"b".repeat(64)}`
    };
    const service = {
      list: vi.fn(() => [{
        snapshotId, datasetId, revisionId, tableId, title: record.title, tableName: record.tableName,
        rowCount: record.rowCount, columnCount: record.columnCount, operationId, createdAt: record.createdAt
      }]),
      create: vi.fn(() => ({ status: "committed" as const, record })),
      open: vi.fn(() => ({ status: "ready" as const, preview })),
      openCitation: vi.fn(() => ({ status: "ready" as const, citation: {
        snapshotId, citationRef: `snapshot_citation_${"c".repeat(16)}`, rowId,
        columnIds: ["column_abcdefghijkl"], resultHash: `sha256:${"d".repeat(64)}`, preview
      } }))
    } as unknown as AnalyticalSnapshotService;
    registerAnalyticalSnapshotIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as Handler); } },
      isTrustedSender: (sender) => sender.id === 7,
      getActiveVaultId: () => vaultId,
      service
    });
    const event = { sender: { id: 7 } } as IpcMainInvokeEvent;
    const list = await handlers.get("collections.analyticalSnapshots.list")!(event, {
      apiVersion: 1, requestId: "collection_request_snapshotipc000002", activeVaultId: vaultId
    });
    expect(list).toMatchObject({ status: "ready", snapshots: [{ snapshotId, operationId }] });
    const created = await handlers.get("collections.analyticalSnapshots.create")!(event, {
      apiVersion: 1, requestId: "collection_request_snapshotipc000003", activeVaultId: vaultId,
      datasetId, tableId, expectedRevisionId: revisionId
    });
    expect(created).toMatchObject({ status: "committed", snapshot: { snapshotId, operationId } });
    const opened = await handlers.get("collections.analyticalSnapshots.open")!(event, {
      apiVersion: 1, requestId: "collection_request_snapshotipc000004", activeVaultId: vaultId, snapshotId
    });
    expect(opened).toMatchObject({ status: "ready", preview: { snapshotId, revisionId } });
    const cited = await handlers.get("collections.analyticalSnapshots.openCitation")!(event, {
      apiVersion: 1, requestId: "collection_request_snapshotipc000005", activeVaultId: vaultId, snapshotId, rowId
    });
    expect(cited).toMatchObject({ status: "ready", citation: { rowId } });
    expect(JSON.stringify({ list, created, opened, cited })).not.toMatch(/path|payload|sqlite|secret|body/iu);
    expect(service.list).toHaveBeenCalledOnce();
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.open).toHaveBeenCalledOnce();
    expect(service.openCitation).toHaveBeenCalledOnce();
  });

  it("returns a body-free failed result and never calls Main for an untrusted sender", async () => {
    const handlers = new Map<string, Handler>();
    const service = { list: vi.fn(), create: vi.fn(), open: vi.fn(), openCitation: vi.fn() } as unknown as AnalyticalSnapshotService;
    registerAnalyticalSnapshotIpc({
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as Handler); } },
      isTrustedSender: () => false,
      getActiveVaultId: () => vaultId,
      service
    });
    const result = await handlers.get("collections.analyticalSnapshots.create")!({ sender: {} } as IpcMainInvokeEvent, {
      apiVersion: 1, requestId: "collection_request_snapshotipc000006", activeVaultId: vaultId,
      datasetId, tableId, expectedRevisionId: revisionId
    });
    expect(result).toEqual({
      apiVersion: 1, requestId: "collection_request_snapshotipc000006", activeVaultId: vaultId,
      datasetId, tableId, expectedRevisionId: revisionId, status: "failed"
    });
    expect(service.create).not.toHaveBeenCalled();
  });
});
