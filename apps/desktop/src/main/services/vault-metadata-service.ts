import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CurrentVaultManifestSchema,
  VaultRenameDisplayNameRequestSchema,
  VaultRenameDisplayNameResultSchema,
  type VaultManifestV2,
  type VaultMetadataSummary,
  type VaultRenameDisplayNameRequest,
  type VaultRenameDisplayNameResult
} from "@pige/schemas";
import { createVaultMetadataRevision, normalizeVaultName } from "./vault-layout";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";

const MAX_MANIFEST_BYTES = 256 * 1024;

export interface VaultMetadataBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

interface ManifestSnapshot {
  readonly manifest: VaultManifestV2;
  readonly metadata: VaultMetadataSummary;
  readonly manifestPath: string;
  readonly metadataDirectory: string;
}

export class VaultMetadataService {
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(now: () => Date = () => new Date(), randomId: () => string = randomUUID) {
    this.#now = now;
    this.#randomId = randomId;
  }

  renameDisplayName(
    bindingInput: VaultMetadataBinding,
    requestInput: VaultRenameDisplayNameRequest
  ): VaultRenameDisplayNameResult {
    const request = VaultRenameDisplayNameRequestSchema.parse(requestInput);
    const identity = { ...request };
    const binding = { vaultId: bindingInput.vaultId, vaultPath: path.resolve(bindingInput.vaultPath) };
    let temporaryPath: string | undefined;

    try {
      const current = readManifestSnapshot(binding);
      if (!current) return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "not_found" });
      if (current.metadata.revision !== request.expectedMetadataRevision) {
        return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "stale", metadata: current.metadata });
      }
      if (current.metadata.displayName === request.displayName) {
        return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "renamed", metadata: current.metadata });
      }

      const nextManifest = CurrentVaultManifestSchema.parse({
        ...current.manifest,
        display_name: request.displayName,
        updated_at: this.#now().toISOString()
      });
      const bytes = `${JSON.stringify(nextManifest, null, 2)}\n`;
      temporaryPath = path.join(current.metadataDirectory, `.manifest.rename-${this.#randomId()}.tmp`);
      writeNewDurableFile(temporaryPath, bytes);

      const rechecked = readManifestSnapshot(binding);
      if (!rechecked) return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "not_found" });
      if (rechecked.metadata.revision !== request.expectedMetadataRevision) {
        return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "stale", metadata: rechecked.metadata });
      }
      assertDirectory(current.metadataDirectory);
      fs.renameSync(temporaryPath, current.manifestPath);
      temporaryPath = undefined;
      fs.chmodSync(current.manifestPath, 0o600);
      flushDirectoryWhereSupported(current.metadataDirectory);

      const committed = readManifestSnapshot(binding);
      if (!committed || committed.metadata.displayName !== request.displayName) {
        return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "failed" });
      }
      return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "renamed", metadata: committed.metadata });
    } catch {
      return VaultRenameDisplayNameResultSchema.parse({ ...identity, status: "failed" });
    } finally {
      if (temporaryPath) {
        try { fs.unlinkSync(temporaryPath); } catch { /* an uncommitted private temp file is disposable */ }
      }
    }
  }
}

function readManifestSnapshot(binding: VaultMetadataBinding): ManifestSnapshot | undefined {
  const vaultPath = path.resolve(binding.vaultPath);
  const metadataDirectory = path.join(vaultPath, ".pige");
  const manifestPath = path.join(metadataDirectory, "manifest.json");
  assertDirectory(vaultPath);
  assertDirectory(metadataDirectory);

  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(manifestPath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_MANIFEST_BYTES) {
      throw new Error("Unsafe Vault manifest.");
    }
    descriptor = fs.openSync(manifestPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_MANIFEST_BYTES) {
      throw new Error("Unsafe Vault manifest.");
    }
    const bytes = fs.readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(bytes, "utf8") > MAX_MANIFEST_BYTES) throw new Error("Oversized Vault manifest.");
    const manifest = CurrentVaultManifestSchema.parse(JSON.parse(bytes));
    if (manifest.vault_id !== binding.vaultId) return undefined;
    const metadata = {
      activeVaultId: manifest.vault_id,
      displayName: manifest.display_name ?? normalizeVaultName(path.basename(vaultPath)),
      revision: createVaultMetadataRevision(manifest)
    } as const;
    return { manifest, metadata, manifestPath, metadataDirectory };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertDirectory(directoryPath: string): void {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe Vault metadata directory.");
}

function writeNewDurableFile(filePath: string, bytes: string): void {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
