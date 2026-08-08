import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSecretStore, type SecretCryptoAdapter } from "../../apps/desktop/src/main/services/secret-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JsonSecretStore", () => {
  it("migrates existing plaintext records into OS-protected ciphertext without changing their references", () => {
    const root = temporaryRoot();
    const appData = path.join(root, "app-data");
    fs.mkdirSync(appData, { mode: 0o700 });
    fs.writeFileSync(path.join(appData, "secrets.json"), `${JSON.stringify({
      schemaVersion: 2,
      secrets: [{ ref: "provider_secret_existing", value: "existing-secret", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" }]
    })}\n`, { encoding: "utf8", mode: 0o600 });

    const store = new JsonSecretStore(appData, protectedCrypto());

    expect(store.readProviderSecret("provider_secret_existing")).toBe("existing-secret");
    expect(store.storageMode()).toBe("os_protected");
    const stored = fs.readFileSync(path.join(appData, "secrets.json"), "utf8");
    expect(stored).toContain('"storage": "os_protected"');
    expect(stored).not.toContain("existing-secret");
    expect(new JsonSecretStore(appData, protectedCrypto()).readProviderSecret("provider_secret_existing")).toBe("existing-secret");
  });

  it("makes portable fallback and protected-storage failures explicit without plaintext downgrade", () => {
    const root = temporaryRoot();
    const appData = path.join(root, "app-data");
    fs.mkdirSync(appData, { mode: 0o700 });
    const portable = new JsonSecretStore(appData, { ...protectedCrypto(), isEncryptionAvailable: () => false });
    const ref = portable.saveProviderSecret("portable-secret", "provider_secret_portable");
    expect(portable.storageMode()).toBe("portable");
    expect(fs.readFileSync(path.join(appData, "secrets.json"), "utf8")).toContain("portable-secret");

    const protectedStore = new JsonSecretStore(appData, protectedCrypto());
    expect(protectedStore.readProviderSecret(ref)).toBe("portable-secret");
    const broken = new JsonSecretStore(appData, { ...protectedCrypto(), decryptString: () => { throw new Error("denied"); } });
    expect(broken.storageMode()).toBe("unavailable");
    expect(() => broken.readProviderSecret(ref)).toThrowError(expect.objectContaining({ code: "secret_protection_unavailable" }));
    expect(fs.readFileSync(path.join(appData, "secrets.json"), "utf8")).not.toContain("portable-secret");
  });

  it("round-trips and deletes one synthetic machine-local credential across restart", () => {
    const root = temporaryRoot();
    const vault = path.join(root, "vault");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(vault, { mode: 0o700 });
    fs.mkdirSync(appData, { mode: 0o700 });
    fs.writeFileSync(path.join(vault, "PIGE.md"), "# Pige\n", "utf8");

    const first = new JsonSecretStore(appData);
    const ref = first.saveProviderSecret("synthetic-machine-secret", "provider_secret_synthetic_roundtrip");
    const restarted = new JsonSecretStore(appData);
    expect(restarted.readProviderSecret(ref)).toBe("synthetic-machine-secret");
    expect(fs.readFileSync(path.join(vault, "PIGE.md"), "utf8")).toBe("# Pige\n");
    expect(listFiles(vault)).toEqual(["PIGE.md"]);

    restarted.deleteProviderSecret(ref);
    expect(new JsonSecretStore(appData).hasProviderSecret(ref)).toBe(false);
  });

  it("fails closed before following a linked or multiply-linked credential file", () => {
    const root = temporaryRoot();
    const appData = path.join(root, "app-data");
    const vault = path.join(root, "vault");
    fs.mkdirSync(appData, { mode: 0o700 });
    fs.mkdirSync(vault, { mode: 0o700 });
    const foreign = path.join(vault, "foreign.json");
    fs.writeFileSync(foreign, '{"schemaVersion":2,"secrets":[]}\n', { encoding: "utf8", mode: 0o600 });
    fs.symlinkSync(foreign, path.join(appData, "secrets.json"));

    expect(() => new JsonSecretStore(appData).saveProviderSecret("must-not-escape"))
      .toThrowError(expect.objectContaining({ code: "secret_store_invalid" }));
    expect(fs.readFileSync(foreign, "utf8")).not.toContain("must-not-escape");

    fs.rmSync(path.join(appData, "secrets.json"));
    const store = new JsonSecretStore(appData);
    store.saveProviderSecret("private-value", "provider_secret_hardlink_guard");
    fs.linkSync(path.join(appData, "secrets.json"), path.join(vault, "copied-link.json"));
    expect(() => new JsonSecretStore(appData).readProviderSecret("provider_secret_hardlink_guard"))
      .toThrowError(expect.objectContaining({ code: "secret_store_invalid" }));
  });
});

function protectedCrypto(): SecretCryptoAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (encrypted) => encrypted.toString("utf8").replace(/^protected:/u, "")
  };
}

function temporaryRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-secret-store-")));
  roots.push(root);
  return root;
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true }).map(String).sort();
}
