import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultRenameDisplayNameResultSchema } from "@pige/schemas";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { VaultMetadataService } from "../../apps/desktop/src/main/services/vault-metadata-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("VaultMetadataService", () => {
  it("atomically renames only durable display metadata and preserves unknown manifest fields", () => {
    const binding = makeVault("Original folder");
    const manifestPath = path.join(binding.vaultPath, ".pige/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, future_owner_field: { keep: true } }, null, 2)}\n`);
    const before = loadVaultSummary(binding.vaultPath);
    const policyBefore = fs.readFileSync(path.join(binding.vaultPath, "PIGE.md"), "utf8");
    const owner = new VaultMetadataService(
      () => new Date("2026-07-31T08:30:00.000Z"),
      () => "fixed"
    );

    const result = owner.renameDisplayName(binding, renameRequest(binding.vaultId, before.metadataRevision!, "Calm library"));

    expect(VaultRenameDisplayNameResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ status: "renamed", metadata: { displayName: "Calm library" } });
    const committed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(committed).toMatchObject({
      vault_id: binding.vaultId,
      display_name: "Calm library",
      updated_at: "2026-07-31T08:30:00.000Z",
      future_owner_field: { keep: true }
    });
    expect(loadVaultSummary(binding.vaultPath)).toMatchObject({
      vaultId: binding.vaultId,
      name: "Calm library",
      activeVaultPathDisplay: binding.vaultPath
    });
    expect(fs.readFileSync(path.join(binding.vaultPath, "PIGE.md"), "utf8")).toBe(policyBefore);
    expect(fs.readdirSync(path.join(binding.vaultPath, ".pige")).some((name) => name.includes("manifest.rename"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(binding.vaultPath);
  });

  it("returns authoritative metadata on stale CAS and leaves the newer manifest unchanged", () => {
    const binding = makeVault("Stable folder");
    const before = loadVaultSummary(binding.vaultPath);
    const manifestPath = path.join(binding.vaultPath, ".pige/manifest.json");
    const external = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      ...external,
      display_name: "Elsewhere",
      updated_at: "2026-07-31T09:00:00.000Z"
    }, null, 2)}\n`);
    const bytesBefore = fs.readFileSync(manifestPath, "utf8");

    const result = new VaultMetadataService().renameDisplayName(
      binding,
      renameRequest(binding.vaultId, before.metadataRevision!, "My retained draft")
    );

    expect(result).toMatchObject({ status: "stale", metadata: { displayName: "Elsewhere" } });
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(bytesBefore);
  });

  it("fails closed when the manifest is replaced by a symbolic link", () => {
    const binding = makeVault("Safe folder");
    const before = loadVaultSummary(binding.vaultPath);
    const manifestPath = path.join(binding.vaultPath, ".pige/manifest.json");
    const target = path.join(binding.root, "outside-manifest.json");
    fs.renameSync(manifestPath, target);
    fs.symlinkSync(target, manifestPath);

    const result = new VaultMetadataService().renameDisplayName(
      binding,
      renameRequest(binding.vaultId, before.metadataRevision!, "Should not commit")
    );

    expect(result.status).toBe("failed");
    expect(fs.readFileSync(target, "utf8")).not.toContain("Should not commit");
  });
});

function makeVault(name: string) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-metadata-test-")));
  roots.push(root);
  const summary = createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  return { root, vaultPath: path.join(root, name), vaultId: summary.vaultId };
}

function renameRequest(vaultId: string, revision: string, displayName: string) {
  return {
    apiVersion: 1 as const,
    requestId: "vaultrenamereq_0123456789abcdef",
    activeVaultId: vaultId,
    expectedMetadataRevision: revision,
    displayName
  };
}
