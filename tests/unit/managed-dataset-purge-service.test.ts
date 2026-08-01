import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema, type DatasetManifest } from "@pige/schemas";
import { ManagedDatasetLifecycleService } from "../../apps/desktop/src/main/services/managed-dataset-lifecycle-service";
import { ManagedDatasetPurgeService } from "../../apps/desktop/src/main/services/managed-dataset-purge-service";
import type { BundleBinding } from "../../apps/desktop/src/main/services/managed-collection-storage";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("ManagedDatasetPurgeService", () => {
  it("permanently deletes only the exact trashed bundle and adopts request replay", () => {
    const fixture = createFixture();
    const lifecycle = createLifecycle(fixture);
    const trashed = lifecycle.trash(trashRequest(fixture));
    if (trashed.status !== "committed") throw new Error("Dataset trash did not commit");
    const listed = lifecycle.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist1",
      activeVaultId: fixture.vaultId });
    if (listed.status !== "ready") throw new Error("Dataset trash list unavailable");
    const request = purgeRequest(fixture, trashed.operationId, listed.revision);
    const service = createPurge(fixture);
    const result = service.purge(request);
    expect(result).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_/) });
    expect(service.purge(request)).toEqual(result);
    expect(fs.existsSync(fixture.bundlePath)).toBe(false);
    expect(fs.readFileSync(fixture.sourceRecordPath, "utf8")).toBe("source-evidence");
    expect(fs.readFileSync(fixture.sourceAssetPath, "utf8")).toBe("original-source");
    expect(lifecycle.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist2",
      activeVaultId: fixture.vaultId })).toMatchObject({ status: "ready", datasets: [] });
    if (result.status !== "committed") throw new Error("Dataset purge did not commit");
    expect(readOperation(fixture.vaultPath, result.operationId)).toMatchObject({
      kind: "purge_dataset", reversible: "no", targetRefs: [{ kind: "dataset", id: fixture.datasetId }]
    });
  });

  it("resumes an interrupted purge after restart without duplicating the irreversible effect", () => {
    const fixture = createFixture();
    const lifecycle = createLifecycle(fixture);
    const trashed = lifecycle.trash(trashRequest(fixture));
    if (trashed.status !== "committed") throw new Error("Dataset trash did not commit");
    const listed = lifecycle.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist3",
      activeVaultId: fixture.vaultId });
    if (listed.status !== "ready") throw new Error("Dataset trash list unavailable");
    const interrupted = createPurge(fixture, { afterOperation: () => { throw new Error("simulated crash"); } });
    expect(interrupted.purge(purgeRequest(fixture, trashed.operationId, listed.revision))).toMatchObject({ status: "failed" });
    expect(fs.existsSync(fixture.bundlePath)).toBe(false);
    const restarted = createPurge(fixture);
    expect(restarted.recoverIncompletePurges()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.recoverIncompletePurges()).toEqual({ recovered: 0, failed: 0 });
    expect(fs.readFileSync(fixture.sourceRecordPath, "utf8")).toBe("source-evidence");
    expect(readOperations(fixture.vaultPath).filter(({ kind }) => kind === "purge_dataset")).toHaveLength(1);
  });

  it("fails closed before mutation when the trash inventory or bundle tree drifts", () => {
    const fixture = createFixture();
    const lifecycle = createLifecycle(fixture);
    const trashed = lifecycle.trash(trashRequest(fixture));
    if (trashed.status !== "committed") throw new Error("Dataset trash did not commit");
    const listed = lifecycle.listTrash({ apiVersion: 1, requestId: "collection_request_datasettrashlist4",
      activeVaultId: fixture.vaultId });
    if (listed.status !== "ready") throw new Error("Dataset trash list unavailable");
    expect(createPurge(fixture).purge({ ...purgeRequest(fixture, trashed.operationId, listed.revision),
      expectedTrashRevision: `datasettrashrev_${"b".repeat(64)}` })).toMatchObject({ status: "stale" });
    const trashBundle = path.join(fixture.vaultPath, ".pige", "trash", "datasets", trashed.operationId, "bundle");
    fs.writeFileSync(path.join(trashBundle, "tampered"), "unsafe");
    expect(createPurge(fixture).purge(purgeRequest(fixture, trashed.operationId, listed.revision))).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(path.join(trashBundle, "tampered"), "utf8")).toBe("unsafe");
    expect(readOperations(fixture.vaultPath).filter(({ kind }) => kind === "purge_dataset")).toHaveLength(0);
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-purge-")); roots.push(root);
  const vaultPath = path.join(root, "Vault");
  const bundleRelativePath = "datasets/records--dataset_20260802_abcdefghijkl";
  const bundlePath = path.join(vaultPath, ...bundleRelativePath.split("/"));
  fs.mkdirSync(path.join(bundlePath, "data", "revisions"), { recursive: true });
  fs.writeFileSync(path.join(bundlePath, "dataset.json"), "manifest");
  fs.writeFileSync(path.join(bundlePath, "data", "revisions", "payload.sqlite"), "payload");
  const sourceRecordPath = path.join(vaultPath, ".pige", "source-records", "source.json");
  const sourceAssetPath = path.join(vaultPath, "sources", "original.csv");
  fs.mkdirSync(path.dirname(sourceRecordPath), { recursive: true }); fs.writeFileSync(sourceRecordPath, "source-evidence");
  fs.mkdirSync(path.dirname(sourceAssetPath), { recursive: true }); fs.writeFileSync(sourceAssetPath, "original-source");
  return { vaultPath, bundlePath, bundleRelativePath, sourceRecordPath, sourceAssetPath,
    vaultId: "vault_20260802_datasetpurge", datasetId: "dataset_20260802_abcdefghijkl",
    revisionId: "dataset_rev_20260802_abcdefghijkl" };
}

function createLifecycle(fixture: ReturnType<typeof createFixture>) {
  const readCurrent = (): BundleBinding | undefined => {
    if (!fs.existsSync(fixture.bundlePath)) return undefined;
    return { vaultPath: fixture.vaultPath, bundlePath: fixture.bundlePath, bundleRelativePath: fixture.bundleRelativePath,
      manifestPath: path.join(fixture.bundlePath, "dataset.json"), manifestBytes: Buffer.from("manifest"),
      manifestStat: fs.statSync(path.join(fixture.bundlePath, "dataset.json")),
      manifest: { datasetId: fixture.datasetId, activeRevision: fixture.revisionId, title: "Records" } as DatasetManifest,
      revision: { id: fixture.revisionId } as BundleBinding["revision"], schema: {} as BundleBinding["schema"],
      payloadPath: path.join(fixture.bundlePath, "data", "revisions", "payload.sqlite") };
  };
  return new ManagedDatasetLifecycleService(vaultPort(fixture), () => new Date("2026-08-02T00:00:00.000Z"), readCurrent);
}
function createPurge(fixture: ReturnType<typeof createFixture>, hooks = {}) {
  return new ManagedDatasetPurgeService(vaultPort(fixture), () => new Date("2026-08-02T00:00:01.000Z"), hooks);
}
function vaultPort(fixture: ReturnType<typeof createFixture>) {
  return { current: () => ({ vaultId: fixture.vaultId }), activeVaultPath: () => fixture.vaultPath };
}
function trashRequest(fixture: ReturnType<typeof createFixture>) {
  return { apiVersion: 1 as const, requestId: "collection_request_datasettrash0002", activeVaultId: fixture.vaultId,
    datasetId: fixture.datasetId, expectedRevisionId: fixture.revisionId };
}
function purgeRequest(fixture: ReturnType<typeof createFixture>, trashOperationId: string, expectedTrashRevision: string) {
  return { apiVersion: 1 as const, requestId: "collection_request_datasetpurge0001", activeVaultId: fixture.vaultId,
    datasetId: fixture.datasetId, expectedRevisionId: fixture.revisionId, trashOperationId, expectedTrashRevision,
    confirmation: "delete_permanently" as const };
}
function readOperation(vaultPath: string, operationId: string) {
  return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige", "operations", `${operationId}.json`), "utf8")));
}
function readOperations(vaultPath: string) {
  const root = path.join(vaultPath, ".pige", "operations");
  return fs.readdirSync(root).map((name) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(root, name), "utf8"))));
}
