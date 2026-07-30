import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({ getPath: vi.fn(), openPath: vi.fn(), showOpenDialog: vi.fn() }));
vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: { openPath: electronMocks.openPath }
}));

import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";
import { VaultMetadataService } from "../../apps/desktop/src/main/services/vault-metadata-service";
import { VaultService, type VaultWriterLeaseFactory } from "../../apps/desktop/src/main/services/vault-service";

const roots: string[] = [];
const services: VaultService[] = [];

beforeEach(() => electronMocks.getPath.mockReturnValue(process.cwd()));
afterEach(() => {
  for (const service of services.splice(0).reverse()) service.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("VaultService display-name rename", () => {
  it("returns a bounded not-found result when no Vault is active", () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-rename-empty-")));
    roots.push(root);
    const service = track(new VaultService(new LocalSettingsStore(path.join(root, "settings")), () => false, leaseFactory));
    const result = service.renameDisplayName({
      apiVersion: 1,
      requestId: "vaultrenamereq_0123456789abcdef",
      activeVaultId: "vault_20260731_missing1",
      expectedMetadataRevision: `vaultmeta_${"a".repeat(64)}`,
      displayName: "Retained draft"
    });
    expect(result).toEqual(expect.objectContaining({ status: "not_found", displayName: "Retained draft" }));
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("updates the active and recent projections and survives a service restart without changing identity or path", () => {
    const fixture = makeActiveVault();
    const before = fixture.service.current()!;
    const result = fixture.service.renameDisplayName(request(before, "Reference library"));

    expect(result).toMatchObject({ status: "renamed", metadata: { displayName: "Reference library" } });
    expect(fixture.service.current()).toMatchObject({
      vaultId: before.vaultId,
      name: "Reference library",
      activeVaultPathDisplay: fixture.vaultPath
    });
    expect(fixture.service.activeVaultPath()).toBe(fixture.vaultPath);
    expect(fixture.service.recent()).toEqual([
      expect.objectContaining({ vaultId: before.vaultId, name: "Reference library" })
    ]);

    fixture.service.close();
    const restarted = track(new VaultService(fixture.settings, () => false, leaseFactory));
    expect(restarted.current()).toMatchObject({
      vaultId: before.vaultId,
      name: "Reference library",
      activeVaultPathDisplay: fixture.vaultPath
    });
    expect(restarted.recent()[0]).toMatchObject({ vaultId: before.vaultId, name: "Reference library" });
  });

  it("returns stale authoritative metadata while retaining the submitted draft in the response identity", () => {
    const fixture = makeActiveVault();
    const before = fixture.service.current()!;
    const external = new VaultMetadataService(
      () => new Date("2026-07-31T10:00:00.000Z"),
      () => "external"
    );
    const externalResult = external.renameDisplayName(
      { vaultId: before.vaultId, vaultPath: fixture.vaultPath },
      request(before, "External update")
    );
    expect(externalResult.status).toBe("renamed");

    const stale = fixture.service.renameDisplayName(request(before, "My draft"));

    expect(stale).toMatchObject({
      status: "stale",
      displayName: "My draft",
      metadata: { displayName: "External update" }
    });
    expect(fixture.service.current()?.name).toBe("External update");
    expect(fixture.service.recent()[0]?.name).toBe("External update");
  });
});

function makeActiveVault() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-rename-service-")));
  roots.push(root);
  const summary = createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Folder identity",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  const vaultPath = path.join(root, "Folder identity");
  const settings = new LocalSettingsStore(path.join(root, "settings"));
  settings.setActiveVault(vaultPath, summary);
  const service = track(new VaultService(
    settings,
    () => false,
    leaseFactory,
    async () => "",
    undefined,
    undefined,
    new VaultMetadataService(() => new Date("2026-07-31T09:30:00.000Z"), () => "service")
  ));
  return { root, vaultPath, settings, service };
}

const leaseFactory: VaultWriterLeaseFactory = (vaultPath) => ({
  vaultPath: path.resolve(vaultPath),
  assertHeld: () => undefined,
  release: () => undefined
});

function track(service: VaultService): VaultService {
  services.push(service);
  return service;
}

function request(vault: NonNullable<ReturnType<VaultService["current"]>>, displayName: string) {
  return {
    apiVersion: 1 as const,
    requestId: "vaultrenamereq_0123456789abcdef",
    activeVaultId: vault.vaultId,
    expectedMetadataRevision: vault.metadataRevision!,
    displayName
  };
}
