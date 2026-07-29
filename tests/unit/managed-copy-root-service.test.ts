import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedCopyRootService } from "../../apps/desktop/src/main/services/managed-copy-root-service";

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
});
