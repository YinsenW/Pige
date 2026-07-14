import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PIGE_TRANSIENT_RUNTIME_ROOTS,
  createVaultOnDisk,
  loadVaultSummary,
  readVaultConfig,
  readVaultManifest,
  resetRebuildableVaultStorage,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("vault layout", () => {
  it("creates the required readable vault files without storing machine-local absolute paths in the manifest", () => {
    const root = makeTempRoot();
    const vault = createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Research",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    const vaultPath = path.join(root, "Research");
    const manifest = readVaultManifest(vaultPath);
    const manifestText = fs.readFileSync(path.join(vaultPath, ".pige/manifest.json"), "utf8");

    expect(vault.name).toBe("Research");
    expect(fs.existsSync(path.join(vaultPath, "PIGE.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "log.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".pige/config.json"))).toBe(true);
    expect(manifest.vault_schema_version).toBe(1);
    expect(manifest.durable_roots).toContain(".pige/conversations");
    expect(manifest.durable_roots).toContain("datasets");
    expect(fs.existsSync(path.join(vaultPath, "datasets"))).toBe(true);
    expect(manifest.rebuildable_roots).toContain(".pige/db");
    expect(fs.existsSync(path.join(vaultPath, PIGE_TRANSIENT_RUNTIME_ROOTS[0]))).toBe(true);
    expect(manifestText).not.toContain(root);
  });

  it("keeps source storage policy in vault config and reflects it in the summary", () => {
    const root = makeTempRoot();
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Work",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    });

    const vaultPath = path.join(root, "Work");
    const updated = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const config = readVaultConfig(vaultPath);

    expect(config.sourceStorage.defaultStrategy).toBe("reference_original");
    expect(updated.defaultSourceStorageStrategy).toBe("reference_original");
    expect(loadVaultSummary(vaultPath).sourceAssetRootDisplay).toBe(path.join(vaultPath, "raw"));
  });

  it("resets only rebuildable database and index roots", () => {
    const root = makeTempRoot();
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Safe Reset",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    });

    const vaultPath = path.join(root, "Safe Reset");
    fs.writeFileSync(path.join(vaultPath, "raw/source.txt"), "durable source", "utf8");
    fs.writeFileSync(path.join(vaultPath, "wiki/note.md"), "# durable note", "utf8");
    fs.writeFileSync(path.join(vaultPath, ".pige/source-records/src.json"), "{}", "utf8");
    fs.writeFileSync(path.join(vaultPath, ".pige/db/vault.sqlite"), "cache", "utf8");
    fs.writeFileSync(path.join(vaultPath, ".pige/runtime/lease-owner.json"), "runtime", "utf8");

    const result = resetRebuildableVaultStorage(vaultPath);

    expect(result.recreatedRoots).toEqual([".pige/db", ".pige/indexes", ".pige/cache"]);
    expect(fs.existsSync(path.join(vaultPath, "raw/source.txt"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "wiki/note.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".pige/source-records/src.json"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".pige/db"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".pige/db/vault.sqlite"))).toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, ".pige/runtime/lease-owner.json"), "utf8")).toBe("runtime");
  });
});
