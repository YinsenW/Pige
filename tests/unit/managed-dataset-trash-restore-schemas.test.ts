import { describe, expect, it } from "vitest";
import {
  CollectionListDatasetTrashResultSchema,
  CollectionRestoreDatasetRequestSchema,
  CollectionRestoreDatasetResultSchema,
  CollectionPurgeDatasetRequestSchema,
  CollectionPurgeDatasetResultSchema
} from "@pige/schemas";

describe("Managed Dataset trash restore schemas", () => {
  it("keeps list and restore strict, bounded, and pathless", () => {
    const base = { apiVersion: 1 as const, requestId: "collection_request_datasetrestore01",
      activeVaultId: "vault_20260801_datasettrash", datasetId: "dataset_20260801_abcdefghijkl",
      expectedRevisionId: "dataset_rev_20260801_abcdefghijkl", trashOperationId: "op_20260801_datasettrash01",
      expectedTrashRevision: `datasettrashrev_${"a".repeat(64)}` };
    expect(CollectionRestoreDatasetRequestSchema.parse(base)).toEqual(base);
    expect(CollectionRestoreDatasetResultSchema.parse({ ...base, status: "committed",
      operationId: "op_20260801_datasetrestore01" })).toMatchObject({ status: "committed" });
    expect(() => CollectionRestoreDatasetRequestSchema.parse({ ...base, path: "/private" })).toThrow();
    expect(CollectionPurgeDatasetRequestSchema.parse({ ...base, confirmation: "delete_permanently" }))
      .toMatchObject({ confirmation: "delete_permanently" });
    expect(CollectionPurgeDatasetResultSchema.parse({ ...base, confirmation: "delete_permanently",
      status: "committed", operationId: "op_20260801_datasetpurge01" })).toMatchObject({ status: "committed" });
    expect(() => CollectionPurgeDatasetRequestSchema.parse({ ...base, confirmation: "delete_permanently",
      path: "/private" })).toThrow();
    expect(CollectionListDatasetTrashResultSchema.parse({ apiVersion: 1,
      requestId: "collection_request_datasettrashlist1", activeVaultId: base.activeVaultId, status: "ready",
      revision: base.expectedTrashRevision, datasets: [{ datasetId: base.datasetId, title: "Records",
        revisionId: base.expectedRevisionId, trashOperationId: base.trashOperationId,
        trashedAt: "2026-08-01T00:00:00.000Z" }] })).toMatchObject({ status: "ready" });
  });
});
