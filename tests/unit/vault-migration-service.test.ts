import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobRecordSchema } from "@pige/schemas";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";
import { createVaultOnDisk, inspectVaultCompatibility } from "../../apps/desktop/src/main/services/vault-layout";
import { VaultMigrationService } from "../../apps/desktop/src/main/services/vault-migration-service";
import { acquireVaultWriterLease } from "../../apps/desktop/src/main/services/vault-writer-lease";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("VaultMigrationService", () => {
  it("backs up and commits a v1 vault to v2 with manifest last and one durable Job/Operation", async () => {
    const fixture = createV1Vault();
    const service = new VaultMigrationService(fixture.userData);
    const preview = service.inspect(fixture.vaultPath);
    expect(preview?.fromVersion).toBe(1);
    expect(preview?.toVersion).toBe(2);
    expect(preview?.affectedDomains.map((entry) => entry.domain)).toEqual([
      "vault_manifest",
      "source_records",
      "markdown_pages",
      "ocr_artifacts",
      "conversation_events",
      "memory",
      "rebuildable_chunks"
    ]);

    const lease = acquireVaultWriterLease(fixture.vaultPath);
    try {
      const result = await service.apply({
        apiVersion: 1,
        requestId: "vaultmigrationreq_0123456789abcdef",
        vaultId: fixture.vaultId,
        previewId: preview!.previewId
      }, lease);
      expect("status" in result ? result.status : "completed").toBe("completed");
      if ("status" in result) throw new Error("Migration unexpectedly failed.");
      expect(inspectVaultCompatibility(fixture.vaultPath).status).toBe("current");
      expect(fs.existsSync(path.join(fixture.vaultPath, ".pige/jobs", `${result.jobId}.json`))).toBe(true);
      expect(findFiles(path.join(fixture.vaultPath, ".pige/operations"), ".json")).toHaveLength(1);
      expect(findFiles(path.join(fixture.userData, "migration-backups"), ".zip")).toHaveLength(1);
      const index = fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8");
      expect(index).toContain('language_basis: "legacy_missing"');
    } finally {
      lease.release();
    }
  });

  it("fails closed when the preview snapshot changes before apply", async () => {
    const fixture = createV1Vault();
    const service = new VaultMigrationService(fixture.userData);
    const preview = service.inspect(fixture.vaultPath)!;
    const manifestPath = path.join(fixture.vaultPath, ".pige/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, updated_at: "2026-07-30T00:00:00.000Z" }, null, 2)}\n`);
    const lease = acquireVaultWriterLease(fixture.vaultPath);
    try {
      const result = await service.apply({
        apiVersion: 1,
        requestId: "vaultmigrationreq_fedcba9876543210",
        vaultId: fixture.vaultId,
        previewId: preview.previewId
      }, lease);
      expect("status" in result && result.status).toBe("stale");
      expect(inspectVaultCompatibility(fixture.vaultPath).status).toBe("needs_migration");
      expect(findFiles(path.join(fixture.userData, "migration-backups"), ".zip")).toHaveLength(0);
    } finally {
      lease.release();
    }
  });

  it("rejects a symlinked migration input before backup or commit", () => {
    const fixture = createV1Vault();
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "escaped.md"), "secret");
    fs.symlinkSync(outside, path.join(fixture.vaultPath, "wiki", "linked"));
    const service = new VaultMigrationService(fixture.userData);
    expect(() => service.inspect(fixture.vaultPath)).toThrow(/symbolic links/u);
  });

  it("adopts a manifest-committed migration after restart without a second Job or Operation", async () => {
    const fixture = createV1Vault();
    const service = new VaultMigrationService(fixture.userData);
    const preview = service.inspect(fixture.vaultPath)!;
    const lease = acquireVaultWriterLease(fixture.vaultPath);
    try {
      const result = await service.apply({
        apiVersion: 1,
        requestId: "vaultmigrationreq_aaaaaaaaaaaaaaaa",
        vaultId: fixture.vaultId,
        previewId: preview.previewId
      }, lease);
      if ("status" in result) throw new Error("Migration unexpectedly failed.");

      const jobsRoot = path.join(fixture.vaultPath, ".pige/jobs");
      const jobPath = path.join(jobsRoot, `${result.jobId}.json`);
      const store = new JobRecordStore({ rootPath: jobsRoot, assertWriterLease: () => lease.assertHeld() });
      const completed = store.read(jobPath);
      store.compareAndSwap(completed, JobRecordSchema.parse({
        ...completed.job,
        state: "running",
        updatedAt: completed.job.createdAt,
        finishedAt: undefined,
        outputRefs: [],
        operationIds: [],
        checkpoints: completed.job.checkpoints?.map((checkpoint, index) => index < 6
          ? checkpoint
          : { ...checkpoint, state: "not_started", startedAt: undefined, finishedAt: undefined, outputRefs: [] }),
        progress: { completedUnits: 6, totalUnits: 8, unit: "checkpoint" }
      }));
      for (const operationPath of findFiles(path.join(fixture.vaultPath, ".pige/operations"), ".json")) {
        fs.rmSync(operationPath);
      }

      const restarted = new VaultMigrationService(fixture.userData);
      expect(restarted.recoverCommitted(fixture.vaultPath, lease)).toBe(1);
      expect(store.read(jobPath).job.state).toBe("completed");
      expect(findFiles(path.join(fixture.vaultPath, ".pige/jobs"), ".json")).toHaveLength(1);
      expect(findFiles(path.join(fixture.vaultPath, ".pige/operations"), ".json")).toHaveLength(1);
      expect(restarted.recoverCommitted(fixture.vaultPath, lease)).toBe(0);
    } finally {
      lease.release();
    }
  });
});

function createV1Vault(): { root: string; userData: string; vaultPath: string; vaultId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-migration-"));
  roots.push(root);
  const parentDirectory = path.join(root, "vaults");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(parentDirectory, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.join(root, "app-data"), { recursive: true });
  fs.mkdirSync(path.join(root, "temp"), { recursive: true });
  const summary = createVaultOnDisk({
    parentDirectory,
    vaultName: "Legacy Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-29T08:00:00.000Z")
  });
  const vaultPath = path.join(parentDirectory, "Legacy Vault");
  const manifestPath = path.join(vaultPath, ".pige/manifest.json");
  const current = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const { durable_domain_versions: _versions, ...legacy } = current;
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...legacy, vault_schema_version: 1 }, null, 2)}\n`);
  return { root, userData, vaultPath, vaultId: summary.vaultId };
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(absolute, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(absolute);
  }
  return files;
}
