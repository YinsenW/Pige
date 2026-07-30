import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { z } from "zod";

/** Retained only for source compatibility with older tests and callers; new storage never invokes it. */
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
  value: z.string().min(1)
}).strict();
const LegacySecretRecordSchema = SecretRecordIdentitySchema.extend({
  legacyEncryptedValue: z.string().min(1)
}).strict();
const SecretStoreFileSchema = z.object({
  schemaVersion: z.literal(2),
  secrets: z.array(z.union([LocalSecretRecordSchema, LegacySecretRecordSchema])).max(256)
}).strict();
const LegacySecretStoreFileSchema = z.object({
  schemaVersion: z.literal(1),
  secrets: z.array(SecretRecordIdentitySchema.extend({
    encryptedValue: z.string().min(1)
  }).strict()).max(256)
}).strict();

type SecretRecord = z.infer<typeof LocalSecretRecordSchema> | z.infer<typeof LegacySecretRecordSchema>;
type SecretStoreFile = z.infer<typeof SecretStoreFileSchema>;

export class JsonSecretStore {
  readonly #secretsPath: string;

  constructor(userDataPath: string, _retiredCrypto?: SecretCryptoAdapter) {
    this.#secretsPath = path.join(userDataPath, "secrets.json");
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
      secrets: [{ ref, value, createdAt: now, updatedAt: now }, ...file.secrets]
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
        ? { ref, value, createdAt: secret.createdAt, updatedAt: new Date().toISOString() }
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
      contents = fs.existsSync(this.#secretsPath) ? fs.readFileSync(this.#secretsPath) : Buffer.alloc(0);
    } catch {
      contents = Buffer.from("unavailable", "utf8");
    }
    return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
  }

  hasProviderSecret(refInput: string): boolean {
    const ref = parseSecretRef(refInput);
    const record = this.#read().secrets.find((secret) => secret.ref === ref);
    return record !== undefined && "value" in record;
  }

  readProviderSecret(refInput: string): string {
    const ref = parseSecretRef(refInput);
    const record = this.#read().secrets.find((secret) => secret.ref === ref);
    if (!record) throw new PigeDomainError("secret_missing", "Provider secret is missing.");
    if (!("value" in record)) {
      throw new PigeDomainError(
        "secret_reconnect_required",
        "This provider credential uses the retired keychain format and must be reconnected."
      );
    }
    return record.value;
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
    return value;
  }

  #read(): SecretStoreFile {
    if (!fs.existsSync(this.#secretsPath)) return { schemaVersion: 2, secrets: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.#secretsPath, "utf8"));
    } catch {
      throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    }
    if (typeof parsed === "object" && parsed !== null && "schemaVersion" in parsed && parsed.schemaVersion === 1) {
      const legacy = LegacySecretStoreFileSchema.safeParse(parsed);
      if (!legacy.success) throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
      return SecretStoreFileSchema.parse({
        schemaVersion: 2,
        secrets: legacy.data.secrets.map(({ encryptedValue, ...identity }) => ({
          ...identity,
          legacyEncryptedValue: encryptedValue
        }))
      });
    }
    const current = SecretStoreFileSchema.safeParse(parsed);
    if (!current.success) throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    return current.data;
  }

  #write(fileInput: SecretStoreFile): void {
    const file = SecretStoreFileSchema.parse(fileInput);
    fs.mkdirSync(path.dirname(this.#secretsPath), { recursive: true });
    const temporaryPath = `${this.#secretsPath}.${process.pid}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporaryPath, "w", 0o600);
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
