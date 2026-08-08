import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AnalyticalSnapshotStore } from "../../apps/desktop/src/main/services/analytical-snapshot-store";

describe("AnalyticalSnapshotStore", () => {
  it("confines a Dataset Bundle analytical part to the vault", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-analytical-snapshot-store-"));
    const store = new AnalyticalSnapshotStore();
    const bundle = "sales--dataset_20260808_abcdefghijkl";

    expect(store.bundlePath(vaultPath, bundle)).toBe(path.join(vaultPath, "datasets", bundle));
    expect(store.partPath(vaultPath, bundle, "data/part-0001.parquet"))
      .toBe(path.join(vaultPath, "datasets", bundle, "data", "part-0001.parquet"));
  });

  it("rejects traversal, non-snapshot bundles, and symlinked vault roots", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-analytical-snapshot-store-"));
    const store = new AnalyticalSnapshotStore();

    expect(() => store.bundlePath(vaultPath, "dataset_20260808_abcdefghijkl"))
      .toThrow("dataset.snapshot.path_unsafe");
    expect(() => store.partPath(vaultPath, "sales--dataset_20260808_abcdefghijkl", "data/../dataset.json"))
      .toThrow("dataset.snapshot.path_unsafe");

    const symlinkPath = `${vaultPath}-link`;
    fs.symlinkSync(vaultPath, symlinkPath, "dir");
    expect(() => store.bundlePath(symlinkPath, "sales--dataset_20260808_abcdefghijkl"))
      .toThrow("dataset.snapshot.path_unsafe");
  });
});
