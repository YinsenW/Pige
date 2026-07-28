import { describe, expect, it } from "vitest";
import { ManagedCollectionDiscovery } from "../../apps/desktop/src/main/services/managed-collection-discovery";
import type { BundleBinding } from "../../apps/desktop/src/main/services/managed-collection-storage";

const vaultId = "vault_20260729_discovery";

describe("ManagedCollectionDiscovery", () => {
  it("orders bounded safe summaries and rejects stale or tampered catalog cursors", () => {
    let bundles = [bundle("Beta", "bbbbbbbbbbbb"), bundle(" alpha ", "cccccccccccc"), bundle("Alpha", "aaaaaaaaaaaa")];
    const service = new ManagedCollectionDiscovery(() => bundles);
    const first = service.list(vaultId, "/vault", {
      apiVersion: 1,
      activeVaultId: vaultId,
      limit: 2
    });
    expect(first).toMatchObject({
      status: "ready",
      totalDatasetCount: 3,
      hasMore: true,
      datasets: [
        { datasetId: "dataset_20260729_aaaaaaaaaaaa", title: "Alpha", tableCount: 1 },
        { datasetId: "dataset_20260729_cccccccccccc", title: "alpha", tableCount: 1 }
      ],
      nextCursor: expect.stringMatching(/^collection_catalog_[a-f0-9]{64}$/u)
    });
    if (first.status !== "ready" || !first.nextCursor) throw new Error("Catalog continuation missing");
    expect(JSON.stringify(first)).not.toMatch(/\/vault|checksum|payload|sqlite|sourceId/u);

    expect(service.list(vaultId, "/vault", {
      apiVersion: 1,
      activeVaultId: vaultId,
      limit: 2,
      cursor: first.nextCursor
    })).toMatchObject({
      status: "ready",
      hasMore: false,
      datasets: [{ datasetId: "dataset_20260729_bbbbbbbbbbbb" }]
    });

    bundles = [bundle("Beta changed", "bbbbbbbbbbbb"), bundles[1]!, bundles[2]!];
    expect(service.list(vaultId, "/vault", {
      apiVersion: 1,
      activeVaultId: vaultId,
      limit: 2,
      cursor: first.nextCursor
    })).toEqual({ apiVersion: 1, activeVaultId: vaultId, status: "failed" });
    expect(service.list(vaultId, "/vault", {
      apiVersion: 1,
      activeVaultId: vaultId,
      limit: 2,
      cursor: `collection_catalog_${"f".repeat(64)}`
    })).toEqual({ apiVersion: 1, activeVaultId: vaultId, status: "failed" });
  });

  it("binds row cursors to exact vault, revision, table, view plan, and exclusive boundary", () => {
    const service = new ManagedCollectionDiscovery(() => []);
    const identity = {
      vaultId,
      datasetId: "dataset_20260729_aaaaaaaaaaaa",
      revisionId: "dataset_rev_20260729_aaaaaaaaaaaa",
      tableId: "table_aaaaaaaaaaaa",
      viewId: "view_aaaaaaaaaaaa",
      viewFingerprint: `sha256:${"a".repeat(64)}`
    };
    const cursor = service.mintRowCursor(identity, 50, "row_aaaaaaaaaaaa");
    expect(service.resolveRowPage(identity, 25, cursor)).toEqual({
      limit: 25,
      offset: 50,
      boundaryRowId: "row_aaaaaaaaaaaa"
    });
    expect(service.resolveRowPage({ ...identity, revisionId: "dataset_rev_20260729_bbbbbbbbbbbb" }, 25, cursor))
      .toBeUndefined();
    expect(service.resolveRowPage({ ...identity, viewFingerprint: `sha256:${"b".repeat(64)}` }, 25, cursor))
      .toBeUndefined();
    expect(service.resolveRowPage(identity, 25, `collection_rows_${"f".repeat(64)}`))
      .toBeUndefined();
  });
});

function bundle(title: string, suffix: string): BundleBinding {
  const datasetId = `dataset_20260729_${suffix}`;
  const revisionId = `dataset_rev_20260729_${suffix}`;
  return {
    vaultPath: "/vault",
    bundlePath: `/vault/datasets/${datasetId}.pige-dataset`,
    bundleRelativePath: `datasets/${datasetId}.pige-dataset`,
    manifestPath: `/vault/datasets/${datasetId}.pige-dataset/dataset.json`,
    manifestBytes: Buffer.alloc(0),
    manifestStat: {} as BundleBinding["manifestStat"],
    manifest: {
      schemaVersion: 1,
      datasetId,
      profile: "managed_collection",
      title,
      activeRevision: revisionId,
      initialRevision: revisionId,
      source: { path: "source.json", checksum: `sha256:${"1".repeat(64)}`, size: 1 },
      schema: { path: "schema.json", checksum: `sha256:${"2".repeat(64)}`, size: 1 },
      payload: { path: "data.sqlite", checksum: `sha256:${"3".repeat(64)}`, size: 1 },
      revision: { path: "revision.json", checksum: `sha256:${"4".repeat(64)}`, size: 1 },
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    } as BundleBinding["manifest"],
    revision: { id: revisionId } as BundleBinding["revision"],
    schema: {
      datasetId,
      revisionId,
      tables: [{
        id: `table_${suffix}`,
        name: "Records",
        rowCount: 60,
        columnCount: 2,
        columns: [{ id: `column_${suffix}`, name: "Name" }, { id: `column_${suffix}x`, name: "Value" }]
      }]
    } as BundleBinding["schema"],
    payloadPath: `/vault/datasets/${datasetId}.pige-dataset/data.sqlite`
  };
}
