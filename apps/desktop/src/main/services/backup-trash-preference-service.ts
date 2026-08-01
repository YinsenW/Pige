import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  BackupTrashPreferenceSummarySchema,
  BackupTrashPreferenceUpdateRequestSchema,
  BackupTrashPreferenceUpdateResultSchema,
  OperationIdSchema,
  OperationRecordSchema,
  VaultConfigSchema,
  type BackupTrashPreferenceSummary,
  type BackupTrashPreferenceUpdateRequest,
  type BackupTrashPreferenceUpdateResult,
  type VaultConfig
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { readVaultConfig } from "./vault-layout";

interface BackupTrashPreferenceVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface BackupTrashPreferenceServiceOptions {
  readonly vault: BackupTrashPreferenceVaultPort;
  readonly hasActiveBackupJob: () => boolean;
  readonly now?: () => string;
}

export class BackupTrashPreferenceService {
  readonly #vault: BackupTrashPreferenceVaultPort;
  readonly #hasActiveBackupJob: () => boolean;
  readonly #now: () => string;

  constructor(options: BackupTrashPreferenceServiceOptions) {
    this.#vault = options.vault;
    this.#hasActiveBackupJob = options.hasActiveBackupJob;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  summary(): BackupTrashPreferenceSummary {
    const binding = this.#binding();
    return this.#summary(binding.vaultId, binding.bytes, binding.config);
  }

  update(input: BackupTrashPreferenceUpdateRequest): BackupTrashPreferenceUpdateResult {
    const request = BackupTrashPreferenceUpdateRequestSchema.parse(input);
    const binding = this.#binding();
    const current = this.#summary(binding.vaultId, binding.bytes, binding.config);
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    if (request.activeVaultId !== binding.vaultId || request.expectedRevision !== current.revision) {
      return BackupTrashPreferenceUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
    }
    if (this.#hasActiveBackupJob()) {
      return BackupTrashPreferenceUpdateResultSchema.parse({
        ...identity,
        status: "blocked",
        summary: { ...current, canUpdate: false }
      });
    }
    if (binding.config.backup.includeTrash === request.includeTrash) {
      return BackupTrashPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary: current });
    }

    const next = VaultConfigSchema.parse({
      ...binding.config,
      backup: { ...binding.config.backup, includeTrash: request.includeTrash }
    });
    const nextBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8");
    this.#assertCurrent(binding.vaultPath, binding.vaultId, binding.bytes);
    atomicReplace(binding.configPath, nextBytes, () => this.#vault.assertWriterLease(binding.vaultPath));
    try {
      writeSettingOperation({
        vaultPath: binding.vaultPath,
        requestId: request.requestId,
        createdAt: this.#now(),
        beforeBytes: binding.bytes,
        afterBytes: nextBytes,
        includeTrash: request.includeTrash,
        assertWriterLease: () => this.#vault.assertWriterLease(binding.vaultPath)
      });
    } catch (caught) {
      atomicReplace(binding.configPath, binding.bytes, () => this.#vault.assertWriterLease(binding.vaultPath));
      throw caught;
    }
    return BackupTrashPreferenceUpdateResultSchema.parse({
      ...identity,
      status: "updated",
      summary: this.#summary(binding.vaultId, nextBytes, next)
    });
  }

  #binding(): {
    readonly vaultId: string;
    readonly vaultPath: string;
    readonly configPath: string;
    readonly bytes: Buffer;
    readonly config: VaultConfig;
  } {
    const active = this.#vault.current();
    const vaultPath = this.#vault.activeVaultPath();
    if (!active || !vaultPath) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    this.#vault.assertWriterLease(vaultPath);
    const configPath = path.join(vaultPath, ".pige", "config.json");
    const bytes = fs.readFileSync(configPath);
    return { vaultId: active.vaultId, vaultPath, configPath, bytes, config: readVaultConfig(vaultPath) };
  }

  #assertCurrent(vaultPath: string, vaultId: string, expected: Buffer): void {
    const active = this.#vault.current();
    if (active?.vaultId !== vaultId || this.#vault.activeVaultPath() !== vaultPath) throw stale();
    this.#vault.assertWriterLease(vaultPath);
    if (!fs.readFileSync(path.join(vaultPath, ".pige", "config.json")).equals(expected)) throw stale();
  }

  #summary(vaultId: string, bytes: Buffer, config: VaultConfig): BackupTrashPreferenceSummary {
    return BackupTrashPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: vaultId,
      revision: `backuptrashrev_${digest(bytes)}`,
      includeTrash: config.backup.includeTrash,
      canUpdate: !this.#hasActiveBackupJob()
    });
  }
}

export function includesTrashInBackup(vaultPath?: string): boolean {
  return vaultPath ? readVaultConfig(vaultPath).backup.includeTrash : true;
}

export function filterTrashBackupPaths(paths: readonly string[], includeTrash: boolean): readonly string[] {
  return includeTrash ? paths : paths.filter((relativePath) => !relativePath.startsWith(".pige/trash/"));
}

function writeSettingOperation(input: {
  readonly vaultPath: string;
  readonly requestId: string;
  readonly createdAt: string;
  readonly beforeBytes: Buffer;
  readonly afterBytes: Buffer;
  readonly includeTrash: boolean;
  readonly assertWriterLease: () => void;
}): void {
  const date = input.createdAt.slice(0, 10).replaceAll("-", "");
  const id = OperationIdSchema.parse(`op_${date}_${digest(Buffer.from(input.requestId)).slice(0, 48)}`);
  const operation = OperationRecordSchema.parse({
    id,
    schemaVersion: 1,
    createdAt: input.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "change_setting",
    targetRefs: [{ kind: "setting", id: "backup.includeTrash" }],
    sourceRefs: [],
    before: { kind: "setting", id: "backup.includeTrash", checksum: `sha256:${digest(input.beforeBytes)}` },
    after: { kind: "setting", id: "backup.includeTrash", checksum: `sha256:${digest(input.afterBytes)}` },
    summary: input.includeTrash ? "Include recoverable trash in future backups." : "Exclude recoverable trash from future backups.",
    reversible: "yes",
    rollbackHint: "Change the trash backup preference again in Settings.",
    warnings: []
  });
  const directory = path.join(input.vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, `${id}.json`);
  const bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (fs.existsSync(filePath)) {
    if (!fs.readFileSync(filePath).equals(bytes)) throw conflict();
    return;
  }
  const temporary = path.join(directory, `.${id}.${randomUUID()}.tmp`);
  input.assertWriterLease();
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  const descriptor = fs.openSync(temporary, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  input.assertWriterLease();
  fs.linkSync(temporary, filePath);
  fs.rmSync(temporary, { force: true });
  flushDirectoryWhereSupported(directory);
}

function atomicReplace(filePath: string, bytes: Buffer, assertWriterLease: () => void): void {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  const descriptor = fs.openSync(temporary, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  assertWriterLease();
  fs.renameSync(temporary, filePath);
  flushDirectoryWhereSupported(directory);
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function conflict(): PigeDomainError {
  return new PigeDomainError("backup.trash_preference_conflict", "The setting operation already exists with different content.");
}

function stale(): PigeDomainError {
  return new PigeDomainError("backup.trash_preference_stale", "The active vault or trash backup preference changed.");
}
