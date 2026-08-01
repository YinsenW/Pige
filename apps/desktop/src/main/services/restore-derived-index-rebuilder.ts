import type { LocalDatabaseRebuildResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";

interface RestoreDatabaseIndexOwner {
  rebuildInWorker(vaultPath: string): Promise<LocalDatabaseRebuildResult>;
  initialize(vaultPath: string): unknown;
}

interface RestoreSemanticIndexOwner {
  rebuild(vaultPath: string): Promise<"ready" | "skipped" | "unavailable" | "failed">;
}

export async function rebuildRestoreDerivedIndexes(
  vaultPath: string,
  database: RestoreDatabaseIndexOwner,
  semantic: RestoreSemanticIndexOwner
): Promise<LocalDatabaseRebuildResult> {
  const rebuilt = await database.rebuildInWorker(vaultPath);
  database.initialize(vaultPath);
  const semanticResult = await semantic.rebuild(vaultPath);
  if (semanticResult === "failed" || semanticResult === "unavailable") {
    throw new PigeDomainError(
      "restore.index_rebuild_failed",
      "Restored durable data is safe, but an enabled derived semantic index could not be rebuilt."
    );
  }
  return rebuilt;
}
