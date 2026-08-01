import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PIGE_TRANSIENT_RUNTIME_ROOTS,
  createVaultRelativePathResolver,
  createVaultOnDisk,
  inspectVaultCompatibility,
  loadVaultSummary,
  readVaultConfig,
  readVaultManifest,
  resetRebuildableVaultStorage,
  updateVaultSourceStorageStrategy,
  validateVaultRootDocuments
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
  it("resolves vault-relative paths while preserving the caller-owned outside error", () => {
    const outsideError = new Error("owner-specific path failure");
    const resolveVaultRelativePath = createVaultRelativePathResolver(() => outsideError);
    const vaultPath = path.join(makeTempRoot(), "vault");

    expect(resolveVaultRelativePath(vaultPath, "artifacts/result.json"))
      .toBe(path.join(vaultPath, "artifacts/result.json"));
    expect(resolveVaultRelativePath(vaultPath, ".")).toBe(vaultPath);
    expect(() => resolveVaultRelativePath(vaultPath, "../outside.json")).toThrow(outsideError);

    const rejectVaultRoot = createVaultRelativePathResolver(
      () => outsideError,
      { allowVaultRoot: false }
    );
    expect(rejectVaultRoot(vaultPath, "artifacts/result.json"))
      .toBe(path.join(vaultPath, "artifacts/result.json"));
    expect(() => rejectVaultRoot(vaultPath, ".")).toThrow(outsideError);
  });

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
    expect(manifest.vault_schema_version).toBe(2);
    expect(manifest.durable_roots).toContain(".pige/conversations");
    expect(manifest.durable_roots).toContain("datasets");
    expect(fs.existsSync(path.join(vaultPath, "datasets"))).toBe(true);
    expect(manifest.rebuildable_roots).toContain(".pige/db");
    expect(fs.existsSync(path.join(vaultPath, PIGE_TRANSIENT_RUNTIME_ROOTS[0]))).toBe(true);
    expect(manifestText).not.toContain(root);
  });

  it("publishes a validated vault atomically and leaves creation retryable after publication failure", () => {
    const root = makeTempRoot();
    const target = path.join(root, "Retryable");
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("injected publication failure");
    });

    expect(() => createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Retryable",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    })).toThrow("injected publication failure");
    rename.mockRestore();

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(root).filter((entry) => entry.startsWith(".pige-vault-create-"))).toEqual([]);

    const retried = createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Retryable",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    });
    expect(retried.name).toBe("Retryable");
    expect(inspectVaultCompatibility(target).status).toBe("current");
  });

  it("preserves an existing empty destination while staging and replaces it only at publication", () => {
    const root = makeTempRoot();
    const target = path.join(root, "Existing Empty");
    fs.mkdirSync(target);

    const vault = createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Existing Empty",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    });

    expect(vault.name).toBe("Existing Empty");
    expect(inspectVaultCompatibility(target).status).toBe("current");
    expect(fs.readdirSync(root).filter((entry) => entry.startsWith(".pige-vault-create-"))).toEqual([]);
  });

  it("validates all three human-readable root documents and rejects unsafe or malformed replacements", () => {
    const root = makeTempRoot();
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Readable",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp")
    });
    const vaultPath = path.join(root, "Readable");
    expect(() => validateVaultRootDocuments(vaultPath)).not.toThrow();

    const policyPath = path.join(vaultPath, "PIGE.md");
    const policy = fs.readFileSync(policyPath, "utf8");
    fs.writeFileSync(policyPath, policy.replace("## Prompt Injection Rules", "## Missing Rules"), "utf8");
    expect(() => loadVaultSummary(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.root_documents_invalid"
    }));
    fs.writeFileSync(policyPath, policy, "utf8");

    const indexPath = path.join(vaultPath, "index.md");
    const index = fs.readFileSync(indexPath, "utf8");
    fs.writeFileSync(indexPath, index.replace('page_type: "index"', 'page_type: "source"'), "utf8");
    expect(() => loadVaultSummary(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.root_documents_invalid"
    }));
    fs.writeFileSync(indexPath, index, "utf8");

    const logPath = path.join(vaultPath, "log.md");
    fs.writeFileSync(logPath, Buffer.from([0xff, 0xfe, 0x00]));
    expect(() => loadVaultSummary(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.root_documents_invalid"
    }));

    const linkedLog = path.join(root, "linked-log.md");
    fs.writeFileSync(linkedLog, "# Log\n\n- 2026-08-01T00:00:00.000Z Created vault.\n", "utf8");
    fs.unlinkSync(logPath);
    fs.symlinkSync(linkedLog, logPath);
    expect(() => loadVaultSummary(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.root_documents_invalid"
    }));
    fs.unlinkSync(logPath);
    fs.linkSync(linkedLog, logPath);
    expect(() => loadVaultSummary(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.root_documents_invalid"
    }));
  });

  it("keeps every default human-readable file and manifest free of machine-local active paths", () => {
    const root = makeTempRoot();
    const appDataPath = path.join(root, "machine-app-data");
    const tempPath = path.join(root, "machine-temp");
    createVaultOnDisk({ parentDirectory: root, vaultName: "Portable", appDataPath, tempPath });
    const vaultPath = path.join(root, "Portable");

    for (const relative of ["PIGE.md", "index.md", "log.md", ".pige/manifest.json"] as const) {
      const bytes = fs.readFileSync(path.join(vaultPath, relative), "utf8");
      expect(bytes).not.toContain(vaultPath);
      expect(bytes).not.toContain(appDataPath);
      expect(bytes).not.toContain(tempPath);
    }
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
    const durablePrivateFiles = [
      ".pige/source-records/src.json",
      ".pige/memory/memory.json",
      ".pige/conversations/conversation.jsonl",
      ".pige/jobs/job.json",
      ".pige/proposals/proposal.json",
      ".pige/operations/operation.json",
      ".pige/trash/receipt.json"
    ];
    for (const relative of durablePrivateFiles) {
      const absolute = path.join(vaultPath, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `durable:${relative}`, "utf8");
    }
    fs.writeFileSync(path.join(vaultPath, ".pige/db/vault.sqlite"), "cache", "utf8");
    fs.writeFileSync(path.join(vaultPath, ".pige/runtime/lease-owner.json"), "runtime", "utf8");

    const result = resetRebuildableVaultStorage(vaultPath);

    expect(result.recreatedRoots).toEqual([".pige/db", ".pige/indexes", ".pige/cache"]);
    expect(fs.existsSync(path.join(vaultPath, "raw/source.txt"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "wiki/note.md"))).toBe(true);
    for (const relative of durablePrivateFiles) {
      expect(fs.readFileSync(path.join(vaultPath, relative), "utf8")).toBe(`durable:${relative}`);
    }
    expect(fs.existsSync(path.join(vaultPath, ".pige/db"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".pige/db/vault.sqlite"))).toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, ".pige/runtime/lease-owner.json"), "utf8")).toBe("runtime");
  });
});
