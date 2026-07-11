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

  saveProviderSecret(secretValue: string): string {
    const trimmed = secretValue.trim();
    if (!trimmed) {
      throw new PigeDomainError("secret_empty", "Provider API key cannot be empty.");
    }
    if (!this.#crypto.isEncryptionAvailable()) {
      throw new PigeDomainError("secret_encryption_unavailable", "Encrypted secret storage is unavailable.");
    }

    const now = new Date().toISOString();
    const ref = `provider_secret_${randomUUID().replaceAll("-", "_")}`;
    const record: SecretRecord = {
      ref,
      encryptedValue: this.#crypto.encryptString(trimmed).toString("base64"),
      createdAt: now,
      updatedAt: now
    };
    const file = this.#read();
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

  #read(): SecretStoreFile {
    if (!fs.existsSync(this.#secretsPath)) {
      return { schemaVersion: 1, secrets: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(this.#secretsPath, "utf8")) as SecretStoreFile;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.secrets)) {
      throw new PigeDomainError("secret_store_invalid", "Secret store is invalid.");
    }
    return parsed;
  }

  #write(file: SecretStoreFile): void {
    fs.mkdirSync(path.dirname(this.#secretsPath), { recursive: true });
    const temporaryPath = `${this.#secretsPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.#secretsPath);
  }
}
