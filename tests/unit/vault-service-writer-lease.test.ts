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
  onNextAssert(vaultPath: string, callback: () => void): void;
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

  it("returns the canonical summary when opening through an alias", () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Canonical Vault");
    const aliasPath = path.join(root, "vault-alias");
    fs.symlinkSync(vault.path, aliasPath, process.platform === "win32" ? "junction" : "dir");
    const factory: VaultWriterLeaseFactory = (requestedPath) => ({
      vaultPath: fs.realpathSync.native(requestedPath),
      assertHeld() {},
      release() {}
    });
    const service = trackService(new VaultService(makeSettingsStore(root), () => false, factory));

    const result = service.openPath(aliasPath);
    expect(result).toMatchObject({
      status: "completed",
      vault: {
        activeVaultPathDisplay: vault.path,
        knowledgeRootDisplay: vault.path
      },
      onboarding: {
        activeVault: {
          activeVaultPathDisplay: vault.path,
          knowledgeRootDisplay: vault.path
        }
      }
    });
    expect(service.current()?.activeVaultPathDisplay).toBe(vault.path);
  });

  it("reveals only canonical active storage roots and treats operating-system failures as body-free results", async () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Reveal Safe");
    const harness = makeLeaseHarness();
    const revealedPaths: string[] = [];
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      harness.factory,
      async (targetPath) => {
        revealedPaths.push(targetPath);
        return "";
      }
    ));
    service.openPath(vault.path);

    await expect(service.revealKnowledgeRoot()).resolves.toEqual({
      status: "revealed",
      target: "knowledge_root"
    });
    await expect(service.revealSourceAssetRoot()).resolves.toEqual({
      status: "revealed",
      target: "source_asset_root"
    });
    expect(revealedPaths).toEqual([
      fs.realpathSync.native(vault.path),
      fs.realpathSync.native(path.join(vault.path, "raw"))
    ]);

    const osFailure = trackService(new VaultService(
      makeSettingsStore(root, "os-failure-settings"),
      () => false,
      makeLeaseHarness().factory,
      async () => "RAW_OS_FAILURE path-sentinel"
    ));
    osFailure.openPath(vault.path);
    await expect(osFailure.revealKnowledgeRoot()).resolves.toEqual(revealFailure("knowledge_root"));

    const rejected = trackService(new VaultService(
      makeSettingsStore(root, "rejected-settings"),
      () => false,
      makeLeaseHarness().factory,
      async () => { throw new Error("RAW_REJECTION path-sentinel"); }
    ));
    rejected.openPath(vault.path);
    await expect(rejected.revealSourceAssetRoot()).resolves.toEqual(revealFailure("source_asset_root"));
  });

  it("does not reveal an unbound external root or a replaced config path", async () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "External Root");
    const configPath = path.join(vault.path, ".pige", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      sourceStorage: { sourceAssetRootKind: string };
    };
    config.sourceStorage.sourceAssetRootKind = "external_binding";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const revealedPaths: string[] = [];
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      makeLeaseHarness().factory,
      async (targetPath) => {
        revealedPaths.push(targetPath);
        return "";
      }
    ));
    service.openPath(vault.path);

    expect(service.current()?.sourceAssetRootDisplay).toBe("");
    await expect(service.revealSourceAssetRoot()).resolves.toEqual(revealFailure("source_asset_root"));
    expect(revealedPaths).toEqual([]);

    if (process.platform !== "win32") {
      const replacementPath = path.join(root, "replacement-config.json");
      fs.writeFileSync(replacementPath, fs.readFileSync(configPath));
      fs.rmSync(configPath);
      fs.symlinkSync(replacementPath, configPath);
      await expect(service.revealSourceAssetRoot()).resolves.toEqual(revealFailure("source_asset_root"));
      expect(revealedPaths).toEqual([]);
    }
  });

  it("fails closed when the in-vault source root is replaced by a symlink", async () => {
    if (process.platform === "win32") return;
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Source Symlink");
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.rmSync(path.join(vault.path, "raw"), { recursive: true });
    fs.symlinkSync(outside, path.join(vault.path, "raw"), "dir");
    const revealer = vi.fn(async () => "");
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      makeLeaseHarness().factory,
      revealer
    ));
    service.openPath(vault.path);

    await expect(service.revealSourceAssetRoot()).resolves.toEqual(revealFailure("source_asset_root"));
    expect(revealer).not.toHaveBeenCalled();
  });

  it("rejects a same-name source-root successor before calling the operating system", async () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Source Successor");
    const outside = path.join(root, "outside-successor");
    fs.mkdirSync(outside);
    const harness = makeLeaseHarness();
    const revealer = vi.fn(async () => "");
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      harness.factory,
      revealer
    ));
    service.openPath(vault.path);
    harness.onNextAssert(vault.path, () => undefined);
    harness.onNextAssert(vault.path, () => {
      fs.rmSync(path.join(vault.path, "raw"), { recursive: true });
      fs.symlinkSync(
        outside,
        path.join(vault.path, "raw"),
        process.platform === "win32" ? "junction" : "dir"
      );
    });

    await expect(service.revealSourceAssetRoot()).resolves.toEqual(revealFailure("source_asset_root"));
    expect(revealer).not.toHaveBeenCalled();
    fs.rmSync(path.join(vault.path, "raw"), { recursive: true });
    fs.mkdirSync(path.join(vault.path, "raw"));
  });

  it.skipIf(process.platform === "win32")("closes a reveal descriptor when identity inspection fails", async () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Descriptor Inspect Failure");
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      makeLeaseHarness().factory,
      async () => ""
    ));
    service.openPath(vault.path);
    const closeSpy = vi.spyOn(fs, "closeSync");
    const fstatSpy = vi.spyOn(fs, "fstatSync").mockImplementationOnce(() => {
      throw new Error("synthetic fstat failure");
    });

    await expect(service.revealKnowledgeRoot()).resolves.toEqual(revealFailure("knowledge_root"));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    fstatSpy.mockRestore();
    closeSpy.mockRestore();
  });

  it.skipIf(process.platform === "win32")("keeps a typed result when descriptor cleanup reports failure", async () => {
    const root = fs.realpathSync.native(makeTempRoot());
    const vault = makeVault(root, "Descriptor Close Failure");
    const service = trackService(new VaultService(
      makeSettingsStore(root),
      () => false,
      makeLeaseHarness().factory,
      async () => ""
    ));
    service.openPath(vault.path);
    const realClose = fs.closeSync.bind(fs);
    let descriptorToClose: number | undefined;
    const closeSpy = vi.spyOn(fs, "closeSync").mockImplementationOnce((descriptor) => {
      descriptorToClose = descriptor;
      throw new Error("synthetic close failure");
    });

    await expect(service.revealKnowledgeRoot()).resolves.toEqual({
      status: "revealed",
      target: "knowledge_root"
    });
    closeSpy.mockRestore();
    if (descriptorToClose !== undefined) realClose(descriptorToClose);
  });

  it("closes ordinary vault access while atomically swapping a restored binding", () => {
    const root = makeTempRoot();
    const original = makeVault(root, "Original");
    const restoredPath = path.join(root, "vaults", "Original Restored");
    const restoredSummary = { ...original.summary, name: "Original Restored" };
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(original.path);

    const transition = service.beginRestoreTransition({
      expectedActiveVaultPath: original.path,
      expectedActiveVaultId: original.summary.vaultId
    });

    expect(transition.previousVaultPath).toBe(original.path);
    expect(() => service.current()).toThrowError(expect.objectContaining({
      code: "restore.in_progress"
    }));
    expect(() => service.assertWriterLease(original.path)).toThrowError(expect.objectContaining({
      code: "restore.in_progress"
    }));

    transition.commit(restoredPath, restoredSummary);

    expect(harness.events.filter(({ kind }) => kind !== "assert")).toEqual([
      { kind: "acquire", vaultPath: original.path },
      { kind: "acquire", vaultPath: restoredPath },
      { kind: "release", vaultPath: original.path }
    ]);
    expect(service.activeVaultPath()).toBe(restoredPath);
    expect(service.current()).toMatchObject({ vaultId: original.summary.vaultId });
    expect(settings.read().recentVaults).toEqual([
      expect.objectContaining({ vaultId: original.summary.vaultId, path: restoredPath })
    ]);
  });

  it("keeps the original binding fenced when restored-vault lease acquisition fails", () => {
    const root = makeTempRoot();
    const original = makeVault(root, "Original");
    const restoredPath = path.join(root, "vaults", "Original Restored");
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(original.path);
    harness.failAcquisition(restoredPath);
    const transition = service.beginRestoreTransition({
      expectedActiveVaultPath: original.path,
      expectedActiveVaultId: original.summary.vaultId
    });

    expect(() => transition.commit(restoredPath, original.summary)).toThrowError(
      expect.objectContaining({ code: "vault.writer_locked" })
    );
    expect(() => service.current()).toThrowError(expect.objectContaining({
      code: "restore.in_progress"
    }));
    expect(settings.getActiveVaultPath()).toBe(original.path);
    expect(harness.control(original.path).releaseCount).toBe(0);

    transition.rollback();
    expect(service.activeVaultPath()).toBe(original.path);
    expect(harness.control(original.path).releaseCount).toBe(0);
  });

  it("fails closed when the persisted machine binding changes during restore", () => {
    const root = makeTempRoot();
    const original = makeVault(root, "Original");
    const replacement = makeVault(root, "Unexpected");
    const restoredPath = path.join(root, "vaults", "Original Restored");
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    service.openPath(original.path);
    const transition = service.beginRestoreTransition({
      expectedActiveVaultPath: original.path,
      expectedActiveVaultId: original.summary.vaultId
    });
    settings.setActiveVault(replacement.path, replacement.summary);

    expect(() => transition.commit(restoredPath, original.summary)).toThrowError(
      expect.objectContaining({ code: "vault.binding_changed" })
    );
    expect(() => transition.rollback()).toThrowError(expect.objectContaining({
      code: "vault.binding_changed"
    }));
    expect(() => service.current()).toThrowError(expect.objectContaining({
      code: "restore.in_progress"
    }));
    expect(harness.control(original.path).releaseCount).toBe(0);
    expect(harness.control(restoredPath).releaseCount).toBe(1);
  });

  it("can commit a first-run clone when no vault is active", () => {
    const root = makeTempRoot();
    const clone = makeVault(root, "Clone");
    const settings = makeSettingsStore(root);
    const harness = makeLeaseHarness();
    const service = trackService(new VaultService(settings, () => false, harness.factory));
    const transition = service.beginRestoreTransition();

    expect(transition.previousVault).toBeUndefined();
    transition.commit(clone.path, clone.summary);

    expect(service.current()).toMatchObject({ vaultId: clone.summary.vaultId });
    expect(settings.getActiveVaultPath()).toBe(clone.path);
    expect(harness.acquiredPaths).toEqual([clone.path]);
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

function revealFailure(target: "knowledge_root" | "source_asset_root") {
  return {
    status: "failed" as const,
    target,
    error: {
      code: "vault.reveal_failed",
      domain: "vault" as const,
      messageKey: "errors.vault.reveal_failed",
      retryable: true,
      severity: "warning" as const,
      userAction: "retry" as const
    }
  };
}

function makeLeaseHarness(): LeaseHarness {
  const acquiredPaths: string[] = [];
  const events: LeaseEvent[] = [];
  const failedPaths = new Set<string>();
  const controls = new Map<string, FakeLeaseControl>();
  const assertHooks = new Map<string, Array<() => void>>();

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
        assertHooks.get(vaultPath)?.shift()?.();
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
    },
    onNextAssert(vaultPath, callback) {
      const canonicalPath = path.resolve(vaultPath);
      const callbacks = assertHooks.get(canonicalPath) ?? [];
      callbacks.push(callback);
      assertHooks.set(canonicalPath, callbacks);
    }
  };
}
