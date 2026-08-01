import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSecretStore } from "../../apps/desktop/src/main/services/secret-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JsonSecretStore", () => {
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

function temporaryRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-secret-store-")));
  roots.push(root);
  return root;
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true }).map(String).sort();
}
