import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { ManagedCopyRootService } from "../../apps/desktop/src/main/services/managed-copy-root-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

function directory(name: string): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `pige-${name}-`)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ManagedCopyRootService", () => {
  it("atomically selects a canonical default and retains prior stable bindings across a switch", () => {
    const userData = directory("managed-root-registry");
    const first = directory("managed-root-first");
    const second = directory("managed-root-second");
    const vaultId = "vault_20260729_managedroot01";
    const owner = new ManagedCopyRootService(userData);
    const initial = owner.summary(vaultId, "inside_vault");

    const firstReceipt = owner.bindDefault({ vaultId, selectedDirectory: first });
    const selectedFirst = owner.selection(vaultId);
    expect(selectedFirst).toMatchObject({ rootId: firstReceipt.rootId, rootPath: first, pathBasis: "root_relative" });
    expect(owner.summary(vaultId, "external_binding")).toMatchObject({
      activeVaultId: vaultId,
      mode: "external_binding",
      availability: "available",
      canConfigure: true
    });
    expect(owner.summary(vaultId, "external_binding").sourceStorageRevision).not.toBe(initial.sourceStorageRevision);

    const secondReceipt = owner.bindDefault({ vaultId, selectedDirectory: second });
    expect(secondReceipt.rootId).not.toBe(firstReceipt.rootId);
    expect(owner.selection(vaultId)?.rootPath).toBe(second);
    expect(owner.binding(vaultId, firstReceipt.rootId)?.rootPath).toBe(first);
  });

  it("fails closed for stale selection CAS and root-relative path escape", () => {
    const userData = directory("managed-root-stale");
    const selected = directory("managed-root-selected");
    const vaultPath = directory("managed-root-vault");
    const vaultId = "vault_20260729_managedroot02";
    const owner = new ManagedCopyRootService(userData);
    const receipt = owner.bindDefault({ vaultId, selectedDirectory: selected });

    expect(() => owner.bindDefault({
      vaultId,
      selectedDirectory: selected,
      expectedRevision: `sha256:${"0".repeat(64)}`
    })).toThrowError(expect.objectContaining({ code: "managed_copy.selection_stale" }));
    expect(() => owner.resolveManagedCopy(vaultId, vaultPath, {
      rootId: receipt.rootId,
      pathBasis: "root_relative",
      path: "../sibling.txt",
      checksum: `sha256:${"0".repeat(64)}`,
      size: 0
    })).toThrowError(expect.objectContaining({ code: "source.managed_locator_invalid" }));
  });

  it("reconnects a moved default with the same root identity after exact evidence proof and restart", () => {
    const parent = directory("managed-root-reconnect-parent");
    const userData = directory("managed-root-reconnect-user");
    const original = directory("managed-root-reconnect-original");
    const moved = path.join(parent, "moved-root");
    const vault = createVaultOnDisk({ parentDirectory: parent, vaultName: "Reconnect" });
    const vaultPath = path.join(parent, "Reconnect");
    const owner = new ManagedCopyRootService(userData);
    const selected = owner.bindDefault({ vaultId: vault.vaultId, selectedDirectory: original });
    const body = Buffer.from("stable managed source evidence", "utf8");
    const relativePath = "2026/08/source.bin";
    const sourcePath = path.join(original, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, body);
    const record = SourceRecordSchema.parse({
      id: "src_20260801_rootreconnect01",
      kind: "pdf_file",
      storageStrategy: "copy_to_source_library",
      managedCopy: {
        rootId: selected.rootId,
        pathBasis: "root_relative",
        path: relativePath,
        checksum: `sha256:${createHash("sha256").update(body).digest("hex")}`,
        size: body.byteLength
      },
      artifacts: [], metadata: {},
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    const recordPath = path.join(vaultPath, ".pige", "source-records", `${record.id}.json`);
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.renameSync(original, moved);

    const missing = owner.summary(vault.vaultId, "external_binding");
    expect(missing.availability).toBe("missing");
    const rebound = owner.reconnectDefault({
      vaultPath,
      vaultId: vault.vaultId,
      selectedDirectory: moved,
      expectedSourceStorageRevision: missing.sourceStorageRevision
    });
    expect(rebound.rootId).toBe(selected.rootId);
    const restarted = new ManagedCopyRootService(userData);
    expect(restarted.selection(vault.vaultId)).toMatchObject({
      rootId: selected.rootId,
      rootPath: moved
    });
    expect(restarted.resolveManagedCopy(vault.vaultId, vaultPath, record.managedCopy!).absolutePath)
      .toBe(path.join(moved, ...relativePath.split("/")));
    expect(fs.readFileSync(path.join(moved, ...relativePath.split("/")))).toEqual(body);
  });

  it("rejects a moved default when selected bytes do not match and retains the missing binding", () => {
    const parent = directory("managed-root-mismatch-parent");
    const userData = directory("managed-root-mismatch-user");
    const original = directory("managed-root-mismatch-original");
    const wrong = directory("managed-root-mismatch-wrong");
    const vault = createVaultOnDisk({ parentDirectory: parent, vaultName: "Mismatch" });
    const vaultPath = path.join(parent, "Mismatch");
    const owner = new ManagedCopyRootService(userData);
    const selected = owner.bindDefault({ vaultId: vault.vaultId, selectedDirectory: original });
    const body = Buffer.from("expected evidence", "utf8");
    const relativePath = "source.bin";
    fs.writeFileSync(path.join(original, relativePath), body);
    fs.writeFileSync(path.join(wrong, relativePath), "wrong evidence", "utf8");
    const record = SourceRecordSchema.parse({
      id: "src_20260801_rootmismatch01", kind: "pdf_file", storageStrategy: "copy_to_source_library",
      managedCopy: { rootId: selected.rootId, pathBasis: "root_relative", path: relativePath,
        checksum: `sha256:${createHash("sha256").update(body).digest("hex")}`, size: body.byteLength },
      artifacts: [], metadata: {}, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z"
    });
    fs.mkdirSync(path.join(vaultPath, ".pige", "source-records"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, ".pige", "source-records", `${record.id}.json`), `${JSON.stringify(record)}\n`);
    fs.rmSync(original, { recursive: true });
    const missing = owner.summary(vault.vaultId, "external_binding");

    expect(() => owner.reconnectDefault({ vaultPath, vaultId: vault.vaultId, selectedDirectory: wrong,
      expectedSourceStorageRevision: missing.sourceStorageRevision })).toThrowError(expect.objectContaining({
      code: "backup.reconnect_selection_invalid"
    }));
    expect(owner.summary(vault.vaultId, "external_binding").availability).toBe("missing");
  });
});
