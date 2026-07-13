import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";

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
import {
  createVaultOnDisk,
  readVaultConfig
} from "../../apps/desktop/src/main/services/vault-layout";
import {
  VaultService,
  type VaultWriterLeaseFactory,
  type VaultWriterLeasePort
} from "../../apps/desktop/src/main/services/vault-service";

const tempRoots: string[] = [];
const services: VaultService[] = [];

interface TestVault {
  readonly path: string;
  readonly summary: ReturnType<typeof createVaultOnDisk>;
}

interface LeaseEvent {
  readonly kind: "acquire" | "assert" | "release";
  readonly vaultPath: string;
}

interface FakeLeaseControl {
  readonly releaseCount: number;
  lose(): void;
}

interface LeaseHarness {
  readonly acquiredPaths: string[];
  readonly events: LeaseEvent[];
  readonly factory: VaultWriterLeaseFactory;
  control(vaultPath: string): FakeLeaseControl;
  failAcquisition(vaultPath: string): void;
}

beforeEach(() => {
  electronMocks.getPath.mockReset();
  electronMocks.openPath.mockReset();
  electronMocks.showOpenDialog.mockReset();
});

afterEach(() => {
  for (const service of services.splice(0).reverse()) service.close();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("VaultService writer lease lifecycle", () => {
  it("acquires a writer lease when creating, opening, and restoring the startup vault", async () => {
    const root = makeTempRoot();
    electronMocks.getPath.mockImplementation((name: string) => path.join(root, `electron-${name}`));
    const parentWindow = {} as Parameters<VaultService["create"]>[0];

    const createParent = path.join(root, "created-vaults");
    fs.mkdirSync(createParent);
    const createHarness = makeLeaseHarness();
    const createService = trackService(new VaultService(
      makeSettingsStore(root, "create-settings"),
      () => false,
      createHarness.factory
    ));
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [createParent]
    });

    await expect(createService.create(parentWindow, { vaultName: "Created" })).resolves.toMatchObject({
      status: "completed"
    });
    expect(createHarness.acquiredPaths).toEqual([path.join(createParent, "Created")]);
    createService.close();

    const openedVault = makeVault(root, "Opened");
    const openHarness = makeLeaseHarness();
    const openService = trackService(new VaultService(
      makeSettingsStore(root, "open-settings"),
      () => false,
      openHarness.factory
    ));
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [openedVault.path]
    });

    await expect(openService.open(parentWindow)).resolves.toMatchObject({ status: "completed" });
    expect(openHarness.acquiredPaths).toEqual([openedVault.path]);
    openService.close();

    const startupStore = makeSettingsStore(root, "startup-settings");
    startupStore.setActiveVault(openedVault.path, openedVault.summary);
    const startupHarness = makeLeaseHarness();
    const startupService = trackService(new VaultService(
      startupStore,
      () => false,
      startupHarness.factory
    ));

    expect(startupHarness.acquiredPaths).toEqual([openedVault.path]);
    expect(startupService.current()).toMatchObject({ vaultId: openedVault.summary.vaultId });
  });

  it("acquires the next vault lease before releasing the previous lease", () => {
    const root = makeTempRoot();
    const firstVault = makeVault(root, "First");
    const secondVault = makeVault(root, "Second");
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      harness.factory
    ));

    service.openPath(firstVault.path);
    service.openPath(secondVault.path);

    expect(harness.events.filter(({ kind }) => kind !== "assert")).toEqual([
      { kind: "acquire", vaultPath: firstVault.path },
      { kind: "acquire", vaultPath: secondVault.path },
      { kind: "release", vaultPath: firstVault.path }
    ]);
    expect(service.activeVaultPath()).toBe(secondVault.path);
    expect(harness.control(firstVault.path).releaseCount).toBe(1);
    expect(harness.control(secondVault.path).releaseCount).toBe(0);
  });

  it("preserves the current vault and settings when the next lease cannot be acquired", () => {
    const root = makeTempRoot();
    const currentVault = makeVault(root, "Current");
    const lockedVault = makeVault(root, "Locked");
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(currentVault.path);
    harness.failAcquisition(lockedVault.path);

    expect(() => service.openPath(lockedVault.path)).toThrowError(expect.objectContaining({
      code: "vault.writer_locked"
    }));

    expect(service.current()).toMatchObject({ vaultId: currentVault.summary.vaultId });
    expect(service.activeVaultPath()).toBe(currentVault.path);
    expect(settings.getActiveVaultPath()).toBe(currentVault.path);
    expect(settings.read().recentVaults.map(({ path: recentPath }) => recentPath)).toEqual([
      currentVault.path
    ]);
    expect(harness.control(currentVault.path).releaseCount).toBe(0);
  });

  it("releases on close without clearing the persisted last active vault path", () => {
    const root = makeTempRoot();
    const vault = makeVault(root, "Persisted");
    const userDataPath = path.join(root, "persisted-settings");
    const settings = new LocalSettingsStore(userDataPath);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(vault.path);

    service.close();

    expect(harness.control(vault.path).releaseCount).toBe(1);
    expect(service.current()).toBeUndefined();
    expect(service.activeVaultPath()).toBeUndefined();
    expect(new LocalSettingsStore(userDataPath).getActiveVaultPath()).toBe(vault.path);
  });

  it("fails closed for active reads and updates after losing the writer lease", () => {
    const root = makeTempRoot();
    const vault = makeVault(root, "Lease Lost");
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(vault.path);
    const configBefore = readVaultConfig(vault.path);
    harness.control(vault.path).lose();

    const leaseLost = expect.objectContaining({ code: "vault.writer_lease_lost" });
    expect(() => service.current()).toThrowError(leaseLost);
    expect(() => service.activeVaultPath()).toThrowError(leaseLost);
    expect(() => service.assertWriterLease(vault.path)).toThrowError(leaseLost);
    expect(() => service.updateSourceStoragePolicy({
      defaultStrategy: "reference_original"
    })).toThrowError(leaseLost);

    expect(readVaultConfig(vault.path)).toEqual(configBefore);
    expect(settings.getActiveVaultPath()).toBe(vault.path);
    expect(() => service.close()).not.toThrow();
    expect(service.current()).toBeUndefined();
  });

  it("allows one real service writer and recovers after that service closes", () => {
    const root = makeTempRoot();
    const vault = makeVault(root, "Contended");
    const canonicalVaultPath = fs.realpathSync.native(vault.path);
    const first = trackService(new VaultService(makeSettingsStore(root, "first-settings")));
    const second = trackService(new VaultService(makeSettingsStore(root, "second-settings")));

    expect(first.openPath(vault.path)).toMatchObject({ status: "completed" });
    expect(() => second.openPath(vault.path)).toThrowError(expect.objectContaining({
      code: "vault.writer_locked"
    }));
    expect(first.current()).toMatchObject({ vaultId: vault.summary.vaultId });
    expect(second.current()).toBeUndefined();

    first.close();

    expect(second.openPath(vault.path)).toMatchObject({ status: "completed" });
    expect(second.activeVaultPath()).toBe(canonicalVaultPath);
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-service-lease-"));
  tempRoots.push(root);
  return root;
}

function makeSettingsStore(root: string, name = "settings"): LocalSettingsStore {
  return new LocalSettingsStore(path.join(root, name));
}

function makeVault(root: string, vaultName: string): TestVault {
  const parentDirectory = path.join(root, "vaults");
  fs.mkdirSync(parentDirectory, { recursive: true });
  const summary = createVaultOnDisk({
    parentDirectory,
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  return {
    path: path.join(parentDirectory, vaultName),
    summary
  };
}

function trackService(service: VaultService): VaultService {
  services.push(service);
  return service;
}

function makeLeaseHarness(): LeaseHarness {
  const acquiredPaths: string[] = [];
  const events: LeaseEvent[] = [];
  const failedPaths = new Set<string>();
  const controls = new Map<string, FakeLeaseControl>();

  const factory: VaultWriterLeaseFactory = (vaultPathInput) => {
    const vaultPath = path.resolve(vaultPathInput);
    acquiredPaths.push(vaultPath);
    events.push({ kind: "acquire", vaultPath });
    if (failedPaths.has(vaultPath)) {
      throw new PigeDomainError("vault.writer_locked", "Another Pige writer already owns this vault.");
    }

    let held = true;
    let releaseCount = 0;
    const lease: VaultWriterLeasePort = {
      vaultPath,
      assertHeld() {
        events.push({ kind: "assert", vaultPath });
        if (!held) {
          throw new PigeDomainError(
            "vault.writer_lease_lost",
            "The active vault writer lease is no longer held."
          );
        }
      },
      release() {
        events.push({ kind: "release", vaultPath });
        if (!held) {
          throw new PigeDomainError(
            "vault.writer_lease_lost",
            "The active vault writer lease is no longer held."
          );
        }
        held = false;
        releaseCount += 1;
      }
    };
    controls.set(vaultPath, {
      get releaseCount() {
        return releaseCount;
      },
      lose() {
        held = false;
      }
    });
    return lease;
  };

  return {
    acquiredPaths,
    events,
    factory,
    control(vaultPath) {
      const control = controls.get(path.resolve(vaultPath));
      if (!control) throw new Error(`No fake lease exists for ${vaultPath}.`);
      return control;
    },
    failAcquisition(vaultPath) {
      failedPaths.add(path.resolve(vaultPath));
    }
  };
}
