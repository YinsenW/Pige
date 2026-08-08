import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

export const ANALYTICAL_SNAPSHOT_PROFILE = "analytical_snapshot" as const;
export const ANALYTICAL_SNAPSHOT_DATA_DIRECTORY = "data" as const;

const DATASET_ID_PATTERN = /^dataset_\d{8}_[a-z0-9]{12,}$/u;
const BUNDLE_DIRECTORY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,120}--(dataset_\d{8}_[a-z0-9]{12,})$/u;
const RELATIVE_PART_PATTERN = /^data\/part-[a-z0-9][a-z0-9._-]*\.parquet$/u;

/** Main-owned path authority for immutable analytical Dataset parts. */
export class AnalyticalSnapshotStore {
  bundlePath(vaultPath: string, bundleDirectoryName: string): string {
    const match = BUNDLE_DIRECTORY_PATTERN.exec(bundleDirectoryName);
    if (!match || !DATASET_ID_PATTERN.test(match[1]!)) throw invalidSnapshotPath();
    const vault = safeVaultPath(vaultPath);
    const datasetsRoot = confinedChild(vault, "datasets");
    const bundle = confinedChild(datasetsRoot, bundleDirectoryName);
    return bundle;
  }

  partPath(vaultPath: string, bundleDirectoryName: string, relativePath: string): string {
    if (!RELATIVE_PART_PATTERN.test(relativePath)) throw invalidSnapshotPath();
    return confinedChild(this.bundlePath(vaultPath, bundleDirectoryName), relativePath);
  }
}

function safeVaultPath(vaultPath: string): string {
  const stat = fs.lstatSync(vaultPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidSnapshotPath();
  return fs.realpathSync(vaultPath);
}

function confinedChild(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\\") || path.posix.isAbsolute(relativePath) ||
      relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw invalidSnapshotPath();
  }
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw invalidSnapshotPath();
  }
  return resolved;
}

function invalidSnapshotPath(): PigeDomainError {
  return new PigeDomainError("dataset.snapshot.path_unsafe", "The analytical Snapshot path is unsafe.");
}
