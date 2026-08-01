import { createHash } from "node:crypto";
import path from "node:path";
import type { RestoreMode } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  VaultManifestSchema,
  type BackupDomainSchemaVersions,
  type BackupManifest,
  type VaultManifest
} from "@pige/schemas";
import { inspectIncludedAgentMemoryBackup } from "./agent-memory-backup";
import {
  commitVaultMigrationDurableDomains,
  commitVaultMigrationManifest,
  stageVaultMigration,
  validateVaultMigrationStage
} from "./vault-migration-storage";

type BackupManifestFile = BackupManifest["files"][number];

interface RestoreMigrationInput {
  readonly stagingPath: string;
  readonly sourceManifest: BackupManifest;
  readonly sourceVaultManifest: VaultManifest;
  readonly assertStaging: () => void;
  readonly snapshotFile: (filePath: string) => Pick<BackupManifestFile, "size" | "checksum">;
  readonly deriveDomainSchemaVersions: (
    vaultPath: string,
    includedPaths: readonly string[]
  ) => BackupDomainSchemaVersions;
}

export function migrateRestoredDurableDomains(input: RestoreMigrationInput): BackupManifest {
  let files = materializeExternalManagedCopyManifestFiles(input.sourceManifest);
  let working: BackupManifest = {
    ...input.sourceManifest,
    files,
    fileCount: files.length,
    totalBytes: totalFileBytes(files)
  };
  if (input.sourceVaultManifest.vault_schema_version === 2) return working;

  input.assertStaging();
  const migration = stageVaultMigration(
    input.stagingPath,
    input.sourceVaultManifest,
    input.sourceManifest.createdAt
  );
  validateVaultMigrationStage(migration);
  commitVaultMigrationDurableDomains(input.stagingPath, migration, input.assertStaging);
  commitVaultMigrationManifest(input.stagingPath, migration, input.assertStaging);
  input.assertStaging();

  const changedPaths = new Set([
    ...migration.files.map(({ relativePath }) => relativePath),
    migration.manifest.relativePath
  ]);
  const presentPaths = new Set(files.map(({ path }) => path));
  for (const changedPath of changedPaths) {
    if (!presentPaths.has(changedPath)) {
      throw new PigeDomainError("restore.result_invalid", "Vault migration changed an undeclared durable file.");
    }
  }
  files = files.map((file) => changedPaths.has(file.path)
    ? { path: file.path, ...input.snapshotFile(resolveVaultPath(input.stagingPath, file.path)) }
    : file);
  const includedPaths = files.map(({ path }) => path);
  const domainSchemaVersions = input.deriveDomainSchemaVersions(input.stagingPath, includedPaths);
  const memoryIntegrity = input.sourceManifest.memoryIntegrity
    ? inspectIncludedAgentMemoryBackup(
        input.stagingPath,
        input.sourceManifest.memoryIntegrity.sourceVaultId,
        includedPaths,
        true
      )
    : undefined;
  working = {
    ...working,
    vaultSchemaVersion: 2,
    domainSchemaVersions,
    ...(memoryIntegrity ? { memoryIntegrity } : {}),
    files,
    fileCount: files.length,
    totalBytes: totalFileBytes(files)
  };
  return working;
}

export function createMaterializedRestoreManifest(
  sourceManifest: BackupManifest,
  sourceVaultManifest: VaultManifest,
  backupId: string,
  mode: RestoreMode,
  resultVaultId: string,
  filesAlreadyMaterialized = false
): BackupManifest {
  let files = filesAlreadyMaterialized
    ? [...sourceManifest.files]
    : materializeExternalManagedCopyManifestFiles(sourceManifest);
  if (mode === "replace_existing") {
    return { ...sourceManifest, backupId, fileCount: files.length, totalBytes: totalFileBytes(files), files };
  }
  const restoredVaultManifest = VaultManifestSchema.parse({
    ...sourceVaultManifest,
    vault_id: resultVaultId,
    origin_vault_id: sourceManifest.vaultId,
    restored_from_backup_id: backupId
  });
  const body = Buffer.from(`${JSON.stringify(restoredVaultManifest, null, 2)}\n`, "utf8");
  const restoredManifestFile = {
    path: ".pige/manifest.json",
    size: body.byteLength,
    checksum: `sha256:${createHash("sha256").update(body).digest("hex")}`
  };
  files = files.map((file) => file.path === restoredManifestFile.path ? restoredManifestFile : file);
  return {
    ...sourceManifest,
    backupId,
    vaultId: resultVaultId,
    fileCount: files.length,
    totalBytes: totalFileBytes(files),
    files
  };
}

export function materializeExternalManagedCopyManifestFiles(
  sourceManifest: BackupManifest
): BackupManifestFile[] {
  const mappings = sourceManifest.externalManagedCopies ?? [];
  const byArchivePath = new Map(mappings.map((mapping) => [mapping.archivePath, mapping]));
  const bySourceRecordPath = new Map(mappings.map((mapping) => [mapping.sourceRecordPath, mapping]));
  return sourceManifest.files.map((file) => {
    const payload = byArchivePath.get(file.path);
    if (payload) return { path: payload.restorePath, size: payload.size, checksum: payload.checksum };
    const sourceRecord = bySourceRecordPath.get(file.path);
    return sourceRecord
      ? {
          path: sourceRecord.sourceRecordPath,
          size: sourceRecord.restoredSourceRecordSize,
          checksum: sourceRecord.restoredSourceRecordChecksum
        }
      : file;
  });
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  return path.join(vaultPath, ...relativePath.split("/"));
}

function totalFileBytes(files: readonly BackupManifestFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}
