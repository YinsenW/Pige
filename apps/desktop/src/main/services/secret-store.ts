import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { z } from "zod";

export type SecretStorageMode = "os_protected" | "portable" | "unavailable";

/**
 * Main supplies Electron safeStorage here. Keeping the bridge injected makes the durable
 * file owner testable without giving renderer or provider code an Electron handle.
 */
export interface SecretCryptoAdapter {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (encrypted: Buffer) => string;
}

const SecretRefSchema = z.string().regex(/^provider_secret_[a-z0-9_]+$/u);
const SecretRecordIdentitySchema = z.object({
  ref: SecretRefSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
const LocalSecretRecordSchema = SecretRecordIdentitySchema.extend({
  value: z.string().min(1).max(16_384)
}).strict();
const ProtectedSecretRecordSchema = SecretRecordIdentitySchema.extend({
  storage: z.literal("os_protected"),
  encryptedValue: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).min(1).max(131_072)
}).strict();
const LegacySecretRecordSchema = SecretRecordIdentitySchema.extend({
  legacyEncryptedValue: z.string().min(1)
}).strict();
const SecretStoreFileSchema = z.object({
  schemaVersion: z.literal(2),
  secrets: z.array(z.union([LocalSecretRecordSchema, ProtectedSecretRecordSchema, LegacySecretRecordSchema])).max(256)
}).strict();
const LegacySecretStoreFileSchema = z.object({
  schemaVersion: z.literal(1),
  secrets: z.array(SecretRecordIdentitySchema.extend({
    encryptedValue: z.string().min(1)
  }).strict()).max(256)
}).strict();

type SecretRecordIdentity = z.infer<typeof SecretRecordIdentitySchema>;
type SecretRecord = z.infer<typeof LocalSecretRecordSchema> | z.infer<typeof ProtectedSecretRecordSchema> | z.infer<typeof LegacySecretRecordSchema>;
type SecretStoreFile = z.infer<typeof SecretStoreFileSchema>;
type SecretRootIdentity = { readonly dev: number; readonly ino: number };

const MAX_SECRET_STORE_BYTES = 5 * 1024 * 1024;
const NO_FOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;

export class JsonSecretStore {
  readonly #rootPath: string;
  readonly #rootIdentity: SecretRootIdentity;
  readonly #secretsPath: string;
  readonly #crypto: SecretCryptoAdapter | undefined;

  constructor(userDataPath: string, crypto?: SecretCryptoAdapter) {
    try {
      const resolved = path.resolve(userDataPath);
      fs.realpathSync.native(resolved);
      const stat = fs.lstatSync(resolved);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw secretStoreInvalidError();
      this.#rootPath = resolved;
      this.#rootIdentity = { dev: stat.dev, ino: stat.ino };
      this.#secretsPath = path.join(resolved, "secrets.json");
      this.#crypto = crypto;
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw secretStoreInvalidError();
    }
  }

  saveProviderSecret(secretValue: string, requestedRef?: string): string {
    const value = this.#validateSecretValue(secretValue);
    const now = new Date().toISOString();
    const ref = parseSecretRef(requestedRef ?? `provider_secret_${randomUUID().replaceAll("-", "_")}`);
    const file = this.#read();
    if (file.secrets.some((secret) => secret.ref === ref)) {
      throw new PigeDomainError("secret_ref_conflict", "Provider secret reference already exists.");
    }
    this.#write({
      schemaVersion: 2,
      secrets: [this.#recordForValue({ ref, createdAt: now, updatedAt: now }, value), ...file.secrets]
    });
    return ref;
  }

  replaceProviderSecret(refInput: string, secretValue: string): void {
    const ref = parseSecretRef(refInput);
    const value = this.#validateSecretValue(secretValue);
    const previous = this.#read();
    const existing = previous.secrets.find((secret) => secret.ref === ref);
    if (!existing) throw new PigeDomainError("secret_missing", "Provider secret is missing.");
    const next: SecretStoreFile = {
      schemaVersion: 2,
      secrets: previous.secrets.map((secret): SecretRecord => secret.ref === ref
        ? this.#recordForValue({ ref, createdAt: secret.createdAt, updatedAt: new Date().toISOString() }, value)
        : secret)
    };
    try {
      this.#write(next);
      if (this.readProviderSecret(ref) !== value) throw secretUpdateVerificationError();
    } catch (caught) {
      try {
        this.#write(previous);
        if (canonicalJson(this.#read()) !== canonicalJson(previous)) throw secretUpdateRepairRequiredError();
      } catch {
        throw secretUpdateRepairRequiredError();
      }
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError("secret_update_failed", "Provider credential replacement failed.");
    }
  }

  listSecretRefs(): string[] {
    return this.#read().secrets.map((secret) => secret.ref);
  }

  revisionToken(): string {
    let contents: Buffer;
    try {
      contents = this.#readBytes() ?? Buffer.alloc(0);
    } catch {
      contents = Buffer.from("unavailable", "utf8");
    }
    return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
  }

  hasProviderSecret(refInput: string): boolean {
    const ref = parseSecretRef(refInput);
    const record = this.#read().secrets.find((secret) => secret.ref === ref);
    return record !== undefined && this.#readRecordValue(record) !== undefined;
  }

  readProviderSecret(refInput: string): string {
    const ref = parseSecretRef(refInput);
    const record = this.#read().secrets.find((secret) => secret.ref === ref);
    if (!record) throw new PigeDomainError("secret_missing", "Provider secret is missing.");
    const value = this.#readRecordValue(record);
    if (value === undefined) throw secretReconnectRequiredError();
    return value;
  }

  storageMode(): SecretStorageMode {
    try {
      const file = this.#read();
      if (file.secrets.some((secret) => "legacyEncryptedValue" in secret)) return "unavailable";
      for (const secret of file.secrets) if ("encryptedValue" in secret) this.#readRecordValue(secret);
      return this.#protectionMode();
    } catch {
      return "unavailable";
    }
  }

  deleteProviderSecret(refInput: string): void {
    const ref = parseSecretRef(refInput);
    const file = this.#read();
    if (!file.secrets.some((secret) => secret.ref === ref)) return;
    this.#write({ schemaVersion: 2, secrets: file.secrets.filter((secret) => secret.ref !== ref) });
  }

  #validateSecretValue(secretValue: string): string {
    const value = secretValue.trim();
    if (!value) throw new PigeDomainError("secret_empty", "Provider API key cannot be empty.");
    if (Array.from(value).length > 16_384) {
      throw new PigeDomainError("secret_invalid", "Provider API key is too large.");
    }
    return value;
  }

  #read(): SecretStoreFile {
    const bytes = this.#readBytes();
    if (!bytes) return { schemaVersion: 2, secrets: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    }
    if (typeof parsed === "object" && parsed !== null && "schemaVersion" in parsed && parsed.schemaVersion === 1) {
      const legacy = LegacySecretStoreFileSchema.safeParse(parsed);
      if (!legacy.success) throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
      return this.#migratePortableRecords(SecretStoreFileSchema.parse({
        schemaVersion: 2,
        secrets: legacy.data.secrets.map(({ encryptedValue, ...identity }) => ({
          ...identity,
          legacyEncryptedValue: encryptedValue
        }))
      }));
    }
    const current = SecretStoreFileSchema.safeParse(parsed);
    if (!current.success) throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    return this.#migratePortableRecords(current.data);
  }

  #migratePortableRecords(file: SecretStoreFile): SecretStoreFile {
    if (this.#protectionMode() !== "os_protected" || !file.secrets.some((secret) => "value" in secret)) return file;
    const migrated: SecretStoreFile = {
      schemaVersion: 2,
      secrets: file.secrets.map((secret): SecretRecord => "value" in secret
        ? (() => {
          const { value, ...identity } = secret;
          return this.#recordForValue(identity, value);
        })()
        : secret)
    };
    this.#write(migrated);
    return migrated;
  }

  #write(fileInput: SecretStoreFile): void {
    const file = SecretStoreFileSchema.parse(fileInput);
    this.#assertRootCurrent();
    if (fs.existsSync(this.#secretsPath)) this.#assertSafeSecretFile();
    const temporaryPath = path.join(this.#rootPath, `.secrets.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW,
        0o600
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.#secretsPath);
      if (process.platform !== "win32") {
        fs.chmodSync(this.#secretsPath, 0o600);
      }
      fsyncDirectoryIfSupported(path.dirname(this.#secretsPath));
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Temporary cleanup cannot replace the primary persistence result.
      }
    }
  }

  #recordForValue(identity: SecretRecordIdentity, value: string): SecretRecord {
    const mode = this.#protectionMode();
    if (mode === "portable") return { ...identity, value };
    if (mode !== "os_protected" || !this.#crypto) throw secretProtectionUnavailableError();
    try {
      return { ...identity, storage: "os_protected", encryptedValue: this.#crypto.encryptString(value).toString("base64") };
    } catch {
      throw secretProtectionUnavailableError();
    }
  }

  #readRecordValue(record: SecretRecord): string | undefined {
    if ("value" in record) return record.value;
    if ("legacyEncryptedValue" in record) return undefined;
    if (this.#protectionMode() !== "os_protected" || !this.#crypto) throw secretProtectionUnavailableError();
    try {
      const value = this.#crypto.decryptString(Buffer.from(record.encryptedValue, "base64"));
      return this.#validateSecretValue(value);
    } catch {
      throw secretProtectionUnavailableError();
    }
  }

  #protectionMode(): SecretStorageMode {
    if (!this.#crypto) return "portable";
    try {
      return this.#crypto.isEncryptionAvailable() ? "os_protected" : "portable";
    } catch {
      return "unavailable";
    }
  }

  #readBytes(): Buffer | undefined {
    this.#assertRootCurrent();
    let before: fs.Stats;
    try {
      before = fs.lstatSync(this.#secretsPath);
    } catch (caught) {
      if (isMissing(caught)) return undefined;
      throw secretStoreInvalidError();
    }
    assertSafeSecretStat(before);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(this.#secretsPath, fs.constants.O_RDONLY | NO_FOLLOW);
      const opened = fs.fstatSync(descriptor);
      assertSafeSecretStat(opened);
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw secretStoreInvalidError();
      return fs.readFileSync(descriptor);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw secretStoreInvalidError();
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #assertRootCurrent(): void {
    try {
      const current = fs.lstatSync(this.#rootPath);
      if (!current.isDirectory() || current.isSymbolicLink() ||
        current.dev !== this.#rootIdentity.dev || current.ino !== this.#rootIdentity.ino) {
        throw secretStoreInvalidError();
      }
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw secretStoreInvalidError();
    }
  }

  #assertSafeSecretFile(): void {
    try {
      assertSafeSecretStat(fs.lstatSync(this.#secretsPath));
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw secretStoreInvalidError();
    }
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseSecretRef(value: string): string {
  const parsed = SecretRefSchema.safeParse(value);
  if (!parsed.success) throw new PigeDomainError("secret_ref_invalid", "Provider secret reference is invalid.");
  return parsed.data;
}

function secretUpdateVerificationError(): PigeDomainError {
  return new PigeDomainError(
    "secret_update_verification_failed",
    "Provider credential replacement could not be verified."
  );
}

function secretUpdateRepairRequiredError(): PigeDomainError {
  return new PigeDomainError(
    "secret_update_repair_required",
    "Provider credential replacement could not restore the previous local value safely."
  );
}

function secretReconnectRequiredError(): PigeDomainError {
  return new PigeDomainError(
    "secret_reconnect_required",
    "This provider credential cannot be read and must be reconnected."
  );
}

function secretProtectionUnavailableError(): PigeDomainError {
  return new PigeDomainError(
    "secret_protection_unavailable",
    "OS-protected credential storage is unavailable."
  );
}

function assertSafeSecretStat(stat: fs.Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_SECRET_STORE_BYTES) {
    throw secretStoreInvalidError();
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw secretStoreInvalidError();
}

function secretStoreInvalidError(): PigeDomainError {
  return new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
}

function isMissing(caught: unknown): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT";
}

function fsyncDirectoryIfSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFsync(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isUnsupportedDirectoryFsync(caught: unknown): boolean {
  if (typeof caught !== "object" || caught === null || !("code" in caught)) return false;
  return ["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"]
    .includes(String(caught.code));
}
