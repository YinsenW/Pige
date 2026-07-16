import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

export interface SecretCryptoAdapter {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (encrypted: Buffer) => string;
}

interface SecretRecord {
  readonly ref: string;
  readonly encryptedValue: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SecretStoreFile {
  readonly schemaVersion: 1;
  readonly secrets: readonly SecretRecord[];
}

export class JsonSecretStore {
  readonly #secretsPath: string;
  readonly #crypto: SecretCryptoAdapter;

  constructor(userDataPath: string, crypto: SecretCryptoAdapter) {
    this.#secretsPath = path.join(userDataPath, "secrets.json");
    this.#crypto = crypto;
  }

  saveProviderSecret(secretValue: string, requestedRef?: string): string {
    const trimmed = secretValue.trim();
    if (!trimmed) {
      throw new PigeDomainError("secret_empty", "Provider API key cannot be empty.");
    }
    if (!this.#crypto.isEncryptionAvailable()) {
      throw new PigeDomainError("secret_encryption_unavailable", "Encrypted secret storage is unavailable.");
    }

    const now = new Date().toISOString();
    const ref = requestedRef ?? `provider_secret_${randomUUID().replaceAll("-", "_")}`;
    if (!/^provider_secret_[a-z0-9_]+$/u.test(ref)) {
      throw new PigeDomainError("secret_ref_invalid", "Provider secret reference is invalid.");
    }
    const file = this.#read();
    if (file.secrets.some((secret) => secret.ref === ref)) {
      throw new PigeDomainError("secret_ref_conflict", "Provider secret reference already exists.");
    }
    const record: SecretRecord = {
      ref,
      encryptedValue: this.#crypto.encryptString(trimmed).toString("base64"),
      createdAt: now,
      updatedAt: now
    };
    this.#write({
      schemaVersion: 1,
      secrets: [record, ...file.secrets.filter((secret) => secret.ref !== ref)]
    });
    return ref;
  }

  listSecretRefs(): string[] {
    return this.#read().secrets.map((secret) => secret.ref);
  }

  hasProviderSecret(ref: string): boolean {
    return this.#crypto.isEncryptionAvailable() && this.#read().secrets.some((secret) => secret.ref === ref);
  }

  readProviderSecret(ref: string): string {
    const record = this.#read().secrets.find((secret) => secret.ref === ref);
    if (!record) {
      throw new PigeDomainError("secret_missing", "Provider secret is missing.");
    }
    if (!this.#crypto.isEncryptionAvailable()) {
      throw new PigeDomainError("secret_encryption_unavailable", "Encrypted secret storage is unavailable.");
    }
    return this.#crypto.decryptString(Buffer.from(record.encryptedValue, "base64"));
  }

  deleteProviderSecret(ref: string): void {
    const file = this.#read();
    if (!file.secrets.some((secret) => secret.ref === ref)) return;
    this.#write({
      schemaVersion: 1,
      secrets: file.secrets.filter((secret) => secret.ref !== ref)
    });
  }

  #read(): SecretStoreFile {
    if (!fs.existsSync(this.#secretsPath)) {
      return { schemaVersion: 1, secrets: [] };
    }
    const raw = JSON.parse(fs.readFileSync(this.#secretsPath, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    }
    const parsed = raw as SecretStoreFile;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.secrets)) {
      throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    }
    return parsed;
  }

  #write(file: SecretStoreFile): void {
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
