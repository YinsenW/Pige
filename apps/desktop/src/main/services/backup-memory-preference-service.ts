import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  BackupMemoryPreferenceSummarySchema,
  BackupMemoryPreferenceUpdateRequestSchema,
  BackupMemoryPreferenceUpdateResultSchema,
  OperationIdSchema,
  OperationRecordSchema,
  VaultConfigSchema,
  type BackupMemoryPreferenceSummary,
  type BackupMemoryPreferenceUpdateRequest,
  type BackupMemoryPreferenceUpdateResult,
  type VaultConfig
} from "@pige/schemas";
import { flushDirectoryWhereSupported } from "./durable-directory-sync";
import { readVaultConfig } from "./vault-layout";

interface BackupMemoryPreferenceVaultPort {
  current(): { readonly vaultId: string } | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease(vaultPath: string): void;
}

export interface BackupMemoryPreferenceServiceOptions {
  readonly vault: BackupMemoryPreferenceVaultPort;
  readonly hasActiveBackupJob: () => boolean;
  readonly now?: () => string;
}

export class BackupMemoryPreferenceService {
  readonly #vault: BackupMemoryPreferenceVaultPort;
  readonly #hasActiveBackupJob: () => boolean;
  readonly #now: () => string;

  constructor(options: BackupMemoryPreferenceServiceOptions) {
    this.#vault = options.vault;
    this.#hasActiveBackupJob = options.hasActiveBackupJob;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  summary(): BackupMemoryPreferenceSummary {
    const binding = this.#binding();
    return this.#summary(binding.vaultId, binding.bytes, binding.config);
  }

  update(input: BackupMemoryPreferenceUpdateRequest): BackupMemoryPreferenceUpdateResult {
    const request = BackupMemoryPreferenceUpdateRequestSchema.parse(input);
    const binding = this.#binding();
    this.#vault.assertWriterLease(binding.vaultPath);
    const current = this.#summary(binding.vaultId, binding.bytes, binding.config);
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
    if (request.activeVaultId !== binding.vaultId || request.expectedRevision !== current.revision) {
      return BackupMemoryPreferenceUpdateResultSchema.parse({ ...identity, status: "stale", summary: current });
    }
    if (this.#hasActiveBackupJob()) {
      return BackupMemoryPreferenceUpdateResultSchema.parse({
        ...identity,
        status: "blocked",
        summary: { ...current, canUpdate: false }
      });
    }
    if (binding.config.backup.includeVaultMemory === request.includeVaultMemory) {
      return BackupMemoryPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary: current });
    }

    const next = VaultConfigSchema.parse({
      ...binding.config,
      backup: { ...binding.config.backup, includeVaultMemory: request.includeVaultMemory }
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
        includeVaultMemory: request.includeVaultMemory,
        assertWriterLease: () => this.#vault.assertWriterLease(binding.vaultPath)
      });
    } catch (caught) {
      atomicReplace(binding.configPath, binding.bytes, () => this.#vault.assertWriterLease(binding.vaultPath));
      throw caught;
    }
    const summary = this.#summary(binding.vaultId, nextBytes, next);
    return BackupMemoryPreferenceUpdateResultSchema.parse({ ...identity, status: "updated", summary });
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
    const current = fs.readFileSync(path.join(vaultPath, ".pige", "config.json"));
    if (!current.equals(expected)) throw stale();
  }

  #summary(vaultId: string, bytes: Buffer, config: VaultConfig): BackupMemoryPreferenceSummary {
    return BackupMemoryPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: vaultId,
      revision: `backupmemoryrev_${digest(bytes)}`,
      includeVaultMemory: config.backup.includeVaultMemory,
      canUpdate: !this.#hasActiveBackupJob()
    });
  }
}

function writeSettingOperation(input: {
  readonly vaultPath: string;
  readonly requestId: string;
  readonly createdAt: string;
  readonly beforeBytes: Buffer;
  readonly afterBytes: Buffer;
  readonly includeVaultMemory: boolean;
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
    targetRefs: [{ kind: "setting", id: "memory.includeMemoryInBackup" }],
    sourceRefs: [],
    before: { kind: "setting", id: "memory.includeMemoryInBackup", checksum: `sha256:${digest(input.beforeBytes)}` },
    after: { kind: "setting", id: "memory.includeMemoryInBackup", checksum: `sha256:${digest(input.afterBytes)}` },
    summary: input.includeVaultMemory
      ? "Include vault Agent memory in future backups."
      : "Exclude vault Agent memory from future backups.",
    reversible: "yes",
    rollbackHint: "Change the Agent memory backup preference again in Settings.",
    warnings: []
  });
  const directory = path.join(input.vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, `${id}.json`);
  const bytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (!existing.equals(bytes)) throw new PigeDomainError("backup.memory_preference_conflict", "The setting operation already exists with different content.");
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

function stale(): PigeDomainError {
  return new PigeDomainError("backup.memory_preference_stale", "The active vault or backup preference changed.");
}
