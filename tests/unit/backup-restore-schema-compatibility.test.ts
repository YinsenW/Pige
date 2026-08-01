import { describe, expect, it } from "vitest";
import {
  BackupManifestSchema,
  VaultManifestSchema,
  type BackupManifest
} from "@pige/schemas";
import {
  assertRestoreSchemaCompatibility,
  restoreSchemaInspectionPaths
} from "../../apps/desktop/src/main/services/backup-restore-schema-compatibility";

describe("backup restore schema compatibility", () => {
  it("accepts current declared durable ranges and blocks one newer domain before restore", () => {
    const current = manifest();
    expect(assertRestoreSchemaCompatibility(current, vaultManifest(), new Map()))
      .toMatchObject({ jobs: { min: 1, max: 1 } });

    expect(() => assertRestoreSchemaCompatibility({
      ...current,
      domainSchemaVersions: {
        ...current.domainSchemaVersions!,
        jobs: { min: 1, max: 2 }
      }
    }, vaultManifest(), new Map())).toThrowError(expect.objectContaining({
      code: "restore.schema_unsupported"
    }));
  });

  it("derives legacy ranges from durable bytes instead of assuming format version one", () => {
    const legacy = BackupManifestSchema.parse({
      ...manifest(),
      domainSchemaVersions: undefined,
      fileCount: 1,
      totalBytes: 45,
      files: [{
        path: ".pige/jobs/2026/08/job_20260802_future.json",
        size: 45,
        checksum: `sha256:${"1".repeat(64)}`
      }]
    });
    expect(restoreSchemaInspectionPaths(legacy)).toEqual([
      ".pige/jobs/2026/08/job_20260802_future.json"
    ]);
    expect(() => assertRestoreSchemaCompatibility(legacy, vaultManifest(), new Map([[
      ".pige/jobs/2026/08/job_20260802_future.json",
      JSON.stringify({ schemaVersion: 2, opaqueFuture: true })
    ]]))).toThrowError(expect.objectContaining({ code: "restore.schema_unsupported" }));
  });

  it("accepts a bounded legacy version-one scan and requires every listed body", () => {
    const legacy = BackupManifestSchema.parse({
      ...manifest(),
      domainSchemaVersions: undefined,
      fileCount: 1,
      totalBytes: 19,
      files: [{
        path: ".pige/jobs/job.json",
        size: 19,
        checksum: `sha256:${"2".repeat(64)}`
      }]
    });
    expect(assertRestoreSchemaCompatibility(
      legacy,
      vaultManifest(),
      new Map([[".pige/jobs/job.json", JSON.stringify({ schemaVersion: 1 })]])
    )).toMatchObject({ jobs: { min: 1, max: 1 } });
    expect(() => assertRestoreSchemaCompatibility(legacy, vaultManifest(), new Map()))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
  });
});

function manifest(): BackupManifest {
  const version = { min: 1, max: 1 };
  return BackupManifestSchema.parse({
    format: "pige-backup",
    formatVersion: 1,
    backupId: "backup_20260802_schemacompat01",
    appVersion: "0.1.0-test",
    vaultId: "vault_20260802_schemacompat01",
    vaultName: "Schema compatibility",
    vaultSchemaVersion: 2,
    createdAt: "2026-08-02T00:00:00.000Z",
    fileCount: 0,
    totalBytes: 0,
    noteCount: 0,
    sourceCount: 0,
    conversationCount: 0,
    memoryCount: 0,
    includesSecrets: false,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false
    },
    domainSchemaVersions: {
      markdownPages: version,
      sourceRecords: version,
      conversationEvents: version,
      jobs: version,
      proposals: version,
      operations: version,
      memory: version,
      skills: version,
      datasets: version
    },
    excludedRoots: [".pige/db", ".pige/indexes", ".pige/cache"],
    externalDependencies: [],
    files: []
  });
}

function vaultManifest() {
  return VaultManifestSchema.parse({
    vault_id: "vault_20260802_schemacompat01",
    display_name: "Schema compatibility",
    vault_schema_version: 2,
    durable_domain_versions: {
      markdownPages: 2,
      sourceRecords: 2,
      ocrArtifacts: 2,
      conversationEvents: 2,
      memory: 2,
      datasets: 1,
      jobs: 1,
      proposals: 1,
      operations: 1,
      skills: 1,
      vaultConfig: 1
    },
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    app_min_version: "0.1.0",
    default_locale: "en",
    durable_roots: ["wiki"],
    rebuildable_roots: [".pige/db"]
  });
}
