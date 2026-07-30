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
import { VaultService, type VaultWriterLeaseFactory } from "../../apps/desktop/src/main/services/vault-service";

const roots: string[] = [];
const services: VaultService[] = [];

beforeEach(() => {
  electronMocks.getPath.mockReset().mockReturnValue(process.cwd());
  electronMocks.showOpenDialog.mockReset();
});
afterEach(() => {
  for (const service of services.splice(0).reverse()) service.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("recent Vault lifecycle", () => {
  it("forgets only a non-active machine-local entry and leaves every Vault byte untouched across restart", () => {
    const fixture = makeRecentFixture("Forget me");
    const marker = path.join(fixture.vaultPath, "keep.md");
    fs.writeFileSync(marker, "durable Vault bytes\n");
    const service = track(new VaultService(fixture.settings, () => false, leaseFactory));
    const recent = service.recent()[0]!;

    const result = service.forgetRecent(forgetRequest(recent.vaultId, recent.revision));

    expect(result.status).toBe("forgotten");
    expect(JSON.stringify(result)).not.toContain(fixture.vaultPath);
    expect(fs.readFileSync(marker, "utf8")).toBe("durable Vault bytes\n");
    expect(service.recent()).toEqual([]);
    expect(new LocalSettingsStore(fixture.settingsPath).toRecentVaultSummaries()).toEqual([]);
  });

  it("refuses to forget the active Vault even with the exact revision", () => {
    const fixture = makeRecentFixture("Active", true);
    const service = track(new VaultService(fixture.settings, () => false, leaseFactory));
    const recent = service.recent()[0]!;
    const settingsBefore = fs.readFileSync(path.join(fixture.settingsPath, "settings.json"), "utf8");

    const result = service.forgetRecent(forgetRequest(recent.vaultId, recent.revision));

    expect(result).toMatchObject({ status: "active", currentRevision: recent.revision });
    expect(service.current()?.vaultId).toBe(recent.vaultId);
    expect(fs.readFileSync(path.join(fixture.settingsPath, "settings.json"), "utf8")).toBe(settingsBefore);
    expect(fs.existsSync(fixture.vaultPath)).toBe(true);
  });

  it("reconnects a moved Vault through a Main-owned picker and persists the same stable ID", async () => {
    const fixture = makeRecentFixture("Moved");
    const movedPath = path.join(fixture.root, "Moved elsewhere");
    fs.renameSync(fixture.vaultPath, movedPath);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [movedPath] });
    const service = track(new VaultService(fixture.settings, () => false, leaseFactory));
    const before = service.recent()[0]!;

    const result = await service.reconnectRecent({} as never, reconnectRequest(before.vaultId, before.revision));

    expect(result).toMatchObject({ status: "reconnected" });
    expect(result.status === "reconnected" && result.revision).not.toBe(before.revision);
    expect(JSON.stringify(result)).not.toContain(movedPath);
    expect(service.recent()[0]).toMatchObject({
      vaultId: before.vaultId,
      pathDisplay: movedPath,
      lastOpenedAt: before.lastOpenedAt
    });
    service.close();
    const restarted = track(new VaultService(new LocalSettingsStore(fixture.settingsPath), () => false, leaseFactory));
    expect(restarted.openRecent({ vaultId: before.vaultId })).toMatchObject({
      status: "completed",
      vault: { vaultId: before.vaultId, activeVaultPathDisplay: movedPath }
    });
  });

  it("rejects stale, cancelled, and mismatched reconnects without changing the current entry", async () => {
    const fixture = makeRecentFixture("Retain me");
    const other = makeVault(fixture.root, "Different");
    const service = track(new VaultService(fixture.settings, () => false, leaseFactory));
    const recent = service.recent()[0]!;
    const settingsFile = path.join(fixture.settingsPath, "settings.json");
    const before = fs.readFileSync(settingsFile, "utf8");

    const stale = await service.reconnectRecent(
      {} as never,
      reconnectRequest(recent.vaultId, `recentvaultrev_${"f".repeat(64)}`)
    );
    expect(stale).toMatchObject({ status: "stale", currentRevision: recent.revision });
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled();

    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await service.reconnectRecent({} as never, reconnectRequest(recent.vaultId, recent.revision)))
      .toMatchObject({ status: "cancelled", currentRevision: recent.revision });
    electronMocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [other.vaultPath] });
    expect(await service.reconnectRecent({} as never, reconnectRequest(recent.vaultId, recent.revision)))
      .toMatchObject({ status: "mismatch" });
    expect(fs.readFileSync(settingsFile, "utf8")).toBe(before);
    expect(service.recent()[0]).toEqual(recent);
  });
});

function makeRecentFixture(name: string, active = false) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-recent-lifecycle-")));
  roots.push(root);
  const vault = makeVault(root, name);
  const settingsPath = path.join(root, "settings");
  const settings = new LocalSettingsStore(settingsPath);
  if (active) settings.setActiveVault(vault.vaultPath, vault.summary);
  else settings.write({
    schemaVersion: 1,
    recentVaults: [{
      vaultId: vault.summary.vaultId,
      name: vault.summary.name,
      path: vault.vaultPath,
      schemaVersion: vault.summary.schemaVersion,
      lastOpenedAt: "2026-07-31T08:00:00.000Z"
    }]
  });
  return { root, vaultPath: vault.vaultPath, settingsPath, settings };
}

function makeVault(root: string, name: string) {
  const summary = createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  return { vaultPath: path.join(root, name), summary };
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

function forgetRequest(vaultId: string, expectedRevision: string) {
  return { apiVersion: 1 as const, requestId: "recentvaultforgetreq_0123456789abcdef", vaultId, expectedRevision };
}

function reconnectRequest(vaultId: string, expectedRevision: string) {
  return { apiVersion: 1 as const, requestId: "recentvaultreconnectreq_0123456789abcdef", vaultId, expectedRevision };
}
