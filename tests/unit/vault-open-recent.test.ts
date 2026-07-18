import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { OpenRecentVaultRequestSchema, VaultActionResultSchema } from "@pige/schemas";

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  openPath: vi.fn(),
  showOpenDialog: vi.fn()
}));

vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  shell: { openPath: electronMocks.openPath }
}));

import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";
import {
  VaultService,
  type VaultWriterLeaseFactory
} from "../../apps/desktop/src/main/services/vault-service";

const tempRoots: string[] = [];
const services: VaultService[] = [];

beforeEach(() => {
  electronMocks.getPath.mockReset();
  electronMocks.openPath.mockReset();
  electronMocks.showOpenDialog.mockReset();
});

afterEach(() => {
  for (const service of services.splice(0).reverse()) service.close();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("recent vault opening", () => {
  it("opens the exact stored vault by stable ID without invoking a path picker", () => {
    const root = makeTempRoot();
    const vault = makeVault(root, "Recent");
    const settings = makeRecentSettings(root, [{
      vaultId: vault.summary.vaultId,
      name: vault.summary.name,
      path: vault.path,
      schemaVersion: vault.summary.schemaVersion,
      lastOpenedAt: "2026-07-17T10:00:00.000Z"
    }]);
    const acquired: string[] = [];
    const service = trackService(new VaultService(settings, () => false, makeLeaseFactory(acquired)));

    const result = service.openRecent({ vaultId: vault.summary.vaultId });

    expect(result).toMatchObject({
      status: "completed",
      vault: { vaultId: vault.summary.vaultId }
    });
    expect(VaultActionResultSchema.parse(result)).toEqual(result);
    expect(acquired).toEqual([vault.path]);
    expect(settings.getActiveVaultPath()).toBe(vault.path);
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled();
  });

  it("rejects missing and duplicate recent IDs without disclosing stored paths", () => {
    const root = makeTempRoot();
    const first = makeVault(root, "First");
    const second = makeVault(root, "Second");
    const duplicateSettings = makeRecentSettings(root, [
      recentRecord(first, first.summary.vaultId),
      recentRecord(second, first.summary.vaultId)
    ]);
    const duplicateService = trackService(new VaultService(
      duplicateSettings,
      () => false,
      makeLeaseFactory([])
    ));

    expectDomainFailure(
      () => duplicateService.openRecent({ vaultId: first.summary.vaultId }),
      "vault.recent_ambiguous",
      root
    );
    expectDomainFailure(
      () => duplicateService.openRecent({ vaultId: "vault_20260717_missing01" }),
      "vault.recent_not_found",
      root
    );
  });

  it("rejects a stored path whose manifest identity no longer matches the recent ID", () => {
    const root = makeTempRoot();
    const expected = makeVault(root, "Expected");
    const successor = makeVault(root, "Successor");
    const settings = makeRecentSettings(root, [recentRecord(successor, expected.summary.vaultId)]);
    const service = trackService(new VaultService(settings, () => false, makeLeaseFactory([])));

    expectDomainFailure(
      () => service.openRecent({ vaultId: expected.summary.vaultId }),
      "vault.recent_stale",
      root
    );
    expect(settings.getActiveVaultPath()).toBeUndefined();
  });

  it("treats path display text and unprojected response fields as non-authoritative", () => {
    expect(() => OpenRecentVaultRequestSchema.parse({
      vaultId: "vault_20260717_recent01",
      pathDisplay: "/tmp/attacker-selected"
    })).toThrow();

    expect(() => VaultActionResultSchema.parse({
      status: "canceled",
      path: "/tmp/not-authoritative"
    })).toThrow();
  });

  it("keeps request and response parsing on both sides of the IPC boundary", () => {
    const mainSource = fs.readFileSync("apps/desktop/src/main/index.ts", "utf8");
    const preloadSource = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const mainHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("vault.openRecent"'),
      mainSource.indexOf('ipcMain.handle("vault.revealKnowledgeRoot"')
    );
    const preloadHandler = preloadSource.slice(
      preloadSource.indexOf("openRecent: async"),
      preloadSource.indexOf("revealKnowledgeRoot: async")
    );

    expect(mainHandler).toContain("OpenRecentVaultRequestSchema.parse(request)");
    expect(mainHandler).toContain("VaultActionResultSchema.parse(result)");
    expect(mainHandler).toContain("initializeActiveDatabase()");
    expect(mainHandler).toContain("resumeBackgroundJobs()");
    expect(preloadHandler).toContain("OpenRecentVaultRequestSchema.parse(request)");
    expect(preloadHandler).toContain("projectVaultActionResult(result)");
    expect(preloadSource).toContain("const parsed = VaultActionResultSchema.parse(value)");
    expect(preloadHandler).not.toContain("pathDisplay");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-open-recent-test-"));
  tempRoots.push(root);
  return root;
}

function makeVault(root: string, vaultName: string) {
  const summary = createVaultOnDisk({
    parentDirectory: root,
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  return { path: path.join(root, vaultName), summary };
}

function recentRecord(
  vault: ReturnType<typeof makeVault>,
  vaultId: string
) {
  return {
    vaultId,
    name: vault.summary.name,
    path: vault.path,
    schemaVersion: vault.summary.schemaVersion,
    lastOpenedAt: "2026-07-17T10:00:00.000Z"
  };
}

function makeRecentSettings(
  root: string,
  recentVaults: Parameters<LocalSettingsStore["write"]>[0]["recentVaults"]
): LocalSettingsStore {
  const settingsRoot = path.join(root, `settings-${Math.random().toString(36).slice(2)}`);
  const settings = new LocalSettingsStore(settingsRoot);
  settings.write({ schemaVersion: 1, recentVaults });
  return settings;
}

function makeLeaseFactory(acquired: string[]): VaultWriterLeaseFactory {
  return (vaultPath) => {
    const canonicalPath = path.resolve(vaultPath);
    acquired.push(canonicalPath);
    return {
      vaultPath: canonicalPath,
      assertHeld: () => undefined,
      release: () => undefined
    };
  };
}

function trackService(service: VaultService): VaultService {
  services.push(service);
  return service;
}

function expectDomainFailure(operation: () => unknown, code: string, privatePath: string): void {
  try {
    operation();
    throw new Error("Expected recent vault opening to fail.");
  } catch (caught) {
    expect(caught).toBeInstanceOf(PigeDomainError);
    expect(caught).toMatchObject({ code });
    expect(String((caught as Error).message)).not.toContain(privatePath);
  }
}
