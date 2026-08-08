import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { AnalyticalSnapshotTrashService } from "../../apps/desktop/src/main/services/analytical-snapshot-trash-service";
import { operationPathFor } from "../../apps/desktop/src/main/services/managed-collection-storage";

const vaultId = "vault_20260809_snapshottrash";
const datasetId = "dataset_20260809_snapshottrash01";
const revisionId = "dataset_rev_20260809_snapshottrash01";
const tableId = "table_snapshottrash01";
const snapshotId = "snapshot_20260809_snapshottrash01";
const createOperationId = "op_20260809_snapshotcreate01";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AnalyticalSnapshotTrashService", () => {
  it("moves only the immutable descriptor, then restores it once after a restart", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-analytical-snapshot-trash-"));
    roots.push(vaultPath);
    const record = {
      schemaVersion: 1 as const,
      snapshotId,
      requestId: "collection_request_snapshotcreated01",
      datasetId,
      revisionId,
      tableId,
      title: "Events snapshot",
      tableName: "Events",
      sourceRevisionHash: `sha256:${"a".repeat(64)}`,
      rowCount: 2,
      columnCount: 1,
      operationId: createOperationId,
      createdAt: "2026-08-09T00:00:00.000Z"
    };
    const descriptorPath = path.join(vaultPath, ".pige", "analytical-snapshots", `${snapshotId}.json`);
    fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
    fs.writeFileSync(descriptorPath, `${JSON.stringify(record)}\n`);
    const createOperation = OperationRecordSchema.parse({
      id: createOperationId,
      schemaVersion: 1,
      createdAt: record.createdAt,
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "create_dataset_snapshot",
      targetRefs: [{ kind: "dataset", id: snapshotId }],
      sourceRefs: [{ kind: "dataset", id: datasetId }],
      after: { kind: "dataset", id: snapshotId },
      summary: "Created analytical snapshot",
      reversible: "no",
      warnings: []
    });
    const operationPath = operationPathFor(vaultPath, createOperationId);
    fs.mkdirSync(path.dirname(operationPath), { recursive: true });
    fs.writeFileSync(operationPath, `${JSON.stringify(createOperation)}\n`);
    const snapshots = {
      open: vi.fn(() => ({ status: "ready" as const })),
      isCurrentRecord: vi.fn(() => true)
    } as never;
    const vaults = { current: () => ({ vaultId }), activeVaultPath: () => vaultPath };
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_snapshottrash01",
      activeVaultId: vaultId,
      snapshotId,
      expectedOperationId: createOperationId
    };
    const first = new AnalyticalSnapshotTrashService(vaults, snapshots, () => new Date("2026-08-09T00:01:00.000Z")).trash(request);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") throw new Error("Snapshot trash did not commit");
    expect(fs.existsSync(descriptorPath)).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/path|checksum|body|payload/u);

    const restarted = new AnalyticalSnapshotTrashService(vaults, snapshots, () => new Date("2026-08-09T00:02:00.000Z"));
    const listed = restarted.listTrash({ apiVersion: 1, requestId: "collection_request_snapshottrashlist01", activeVaultId: vaultId });
    expect(listed.status).toBe("ready");
    if (listed.status !== "ready" || first.status !== "committed") throw new Error("Snapshot trash inventory did not load");
    expect(listed.snapshots).toHaveLength(1);
    const restored = restarted.restore({
      apiVersion: 1,
      requestId: "collection_request_snapshotrestore01",
      activeVaultId: vaultId,
      snapshotId,
      trashOperationId: first.operationId,
      expectedTrashRevision: listed.revision
    });
    expect(restored.status).toBe("committed");
    expect(fs.existsSync(descriptorPath)).toBe(true);
    const activityOperation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPathFor(vaultPath, first.operationId), "utf8")));
    const restoreOperationId = restored.status === "committed" ? restored.operationId : "";
    const restoreOperation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPathFor(vaultPath, restoreOperationId), "utf8")));
    expect(restoreOperation.kind).toBe("restore_analytical_snapshot");
    expect(restarted.activitySummary(activityOperation, restoreOperation)).toMatchObject({
      kind: "restore_analytical_snapshot",
      status: "undone",
      canUndo: false
    });
    expect(restarted.restore({
      apiVersion: 1,
      requestId: "collection_request_snapshotrestore02",
      activeVaultId: vaultId,
      snapshotId,
      trashOperationId: first.operationId,
      expectedTrashRevision: listed.revision
    })).toMatchObject({ status: "stale" });
  });
});
