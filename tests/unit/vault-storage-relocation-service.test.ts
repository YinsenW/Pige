import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn()
}));
vi.mock("electron", () => ({
  app: { getPath: electronMocks.getPath },
  dialog: {
    showMessageBox: electronMocks.showMessageBox,
    showOpenDialog: electronMocks.showOpenDialog
  },
  shell: { openPath: vi.fn() }
}));

import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";
import { VaultService, type VaultWriterLeaseFactory } from "../../apps/desktop/src/main/services/vault-service";
import { VaultStorageRelocationService } from "../../apps/desktop/src/main/services/vault-storage-relocation-service";

const roots: string[] = [];
const services: VaultService[] = [];

beforeEach(() => {
  electronMocks.getPath.mockReset().mockReturnValue(process.cwd());
  electronMocks.showOpenDialog.mockReset();
  electronMocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
});
afterEach(() => {
  for (const service of services.splice(0).reverse()) service.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("safe Vault storage relocation", () => {
  it("copies and verifies every durable byte, atomically switches one binding, and keeps the original Vault", async () => {
    const fixture = makeFixture();
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [fixture.destinationParent] });
    let writeFenceProved = false;
    const service = relocationService(fixture, {
      afterWriteFence: () => {
        try { fixture.vaults.assertWriterLease(fixture.sourcePath); }
        catch (caught) { writeFenceProved = caught instanceof PigeDomainError && caught.code === "restore.in_progress"; }
      }
    });
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");

    const result = await service.relocate({} as never, request(status.activeVaultId, status.revision));

    const destinationPath = path.join(fixture.destinationParent, path.basename(fixture.sourcePath));
    expect(result.status).toBe("relocated");
    expect(JSON.stringify(result)).not.toContain(fixture.sourcePath);
    expect(JSON.stringify(result)).not.toContain(destinationPath);
    expect(writeFenceProved).toBe(true);
    expect(fs.readFileSync(path.join(fixture.sourcePath, "wiki", "note.md"), "utf8")).toBe("# Durable note\n");
    expect(fs.readFileSync(path.join(destinationPath, "wiki", "note.md"), "utf8")).toBe("# Durable note\n");
    expect(fs.readFileSync(path.join(destinationPath, "raw", "source.bin"), "utf8")).toBe("source-evidence");
    expect(fs.readFileSync(path.join(destinationPath, ".pige", "conversations", "history.jsonl"), "utf8"))
      .toBe('{"kind":"message"}\n');
    expect(fs.readFileSync(path.join(destinationPath, ".pige", "private", "ingress.bin"), "utf8"))
      .toBe("private-restart-evidence");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(destinationPath, ".pige", "private")).mode & 0o777).toBe(0o750);
      expect(fs.statSync(path.join(destinationPath, ".pige", "private", "ingress.bin")).mode & 0o777).toBe(0o640);
    }
    expect(fs.readdirSync(path.join(destinationPath, ".pige", "runtime"))).toEqual([]);
    expect(fs.readFileSync(path.join(fixture.sourcePath, ".pige", "runtime", "old-runtime"), "utf8")).toBe("transient");
    expect(fixture.settings.getActiveVaultPath()).toBe(destinationPath);
    expect(fixture.settings.toRecentVaultSummaries()).toHaveLength(1);
    expect(fixture.settings.toRecentVaultSummaries()[0]).toMatchObject({ vaultId: status.activeVaultId, pathDisplay: destinationPath });

    fixture.vaults.close();
    const restarted = track(new VaultService(new LocalSettingsStore(fixture.userDataPath), () => false, leaseFactory));
    expect(restarted.current()?.vaultId).toBe(status.activeVaultId);
    expect(restarted.activeVaultPath()).toBe(destinationPath);
  });

  it("blocks active Jobs before opening a picker and retains the exact active binding", async () => {
    const fixture = makeFixture();
    const service = relocationService(fixture, {}, ["running"]);
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");
    const settingsBefore = fs.readFileSync(path.join(fixture.userDataPath, "settings.json"), "utf8");

    const result = await service.relocate({} as never, request(status.activeVaultId, status.revision));

    expect(result).toMatchObject({ status: "blocked_active_work", currentRevision: status.revision });
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(fixture.userDataPath, "settings.json"), "utf8")).toBe(settingsBefore);
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.sourcePath);
  });

  it.skipIf(process.platform === "win32")(
    "canonicalizes a picker path with a symbolic-link ancestor before publishing the destination",
    async () => {
      const fixture = makeFixture();
      const linkedParent = path.join(fixture.root, "destination-link");
      fs.symlinkSync(fixture.destinationParent, linkedParent, "dir");
      electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [linkedParent] });
      const service = relocationService(fixture);
      const status = service.status();
      if (status.status !== "ready") throw new Error("Relocation status unavailable.");

      expect(await service.relocate({} as never, request(status.activeVaultId, status.revision)))
        .toMatchObject({ status: "relocated" });
      expect(fixture.vaults.activeVaultPath()).toBe(
        path.join(fixture.destinationParent, path.basename(fixture.sourcePath))
      );
    }
  );

  it("fails closed on source drift and continues using the complete original Vault", async () => {
    const fixture = makeFixture();
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [fixture.destinationParent] });
    const service = relocationService(fixture, {
      afterCopy: () => fs.writeFileSync(path.join(fixture.sourcePath, "wiki", "note.md"), "# Changed during copy\n")
    });
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");

    const result = await service.relocate({} as never, request(status.activeVaultId, status.revision));

    expect(result.status).toBe("failed");
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.sourcePath);
    expect(fs.readFileSync(path.join(fixture.sourcePath, "wiki", "note.md"), "utf8"))
      .toBe("# Changed during copy\n");
    expect(fs.existsSync(path.join(fixture.destinationParent, path.basename(fixture.sourcePath)))).toBe(false);
  });

  it("recovers a verified destination receipt after restart without recopying or deleting the original", async () => {
    const fixture = makeFixture();
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [fixture.destinationParent] });
    const service = relocationService(fixture, {
      afterDestinationCommit: () => { throw new Error("simulated crash"); }
    });
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");

    expect(await service.relocate({} as never, request(status.activeVaultId, status.revision)))
      .toMatchObject({ status: "failed" });
    const destinationPath = path.join(fixture.destinationParent, path.basename(fixture.sourcePath));
    expect(fixture.vaults.activeVaultPath()).toBe(fixture.sourcePath);
    expect(fs.existsSync(destinationPath)).toBe(true);
    expect(fs.existsSync(fixture.sourcePath)).toBe(true);

    fixture.vaults.close();
    const restartedVaults = track(new VaultService(new LocalSettingsStore(fixture.userDataPath), () => false, leaseFactory));
    const restartedRelocation = new VaultStorageRelocationService({
      userDataPath: fixture.userDataPath,
      vaultService: restartedVaults,
      pathSafety: fixture.pathSafety,
      pauseMutableWork: async () => () => undefined,
      activeJobStates: () => []
    });
    expect(await restartedRelocation.recoverInterrupted()).toEqual({ recovered: 1, failed: 0 });
    expect(restartedVaults.activeVaultPath()).toBe(destinationPath);
    expect(restartedVaults.current()?.vaultId).toBe(status.activeVaultId);
    expect(fs.readFileSync(path.join(fixture.sourcePath, "raw", "source.bin"), "utf8")).toBe("source-evidence");
  });

  it("rejects restart recovery when the original Vault changed after destination publication", async () => {
    const fixture = makeFixture();
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [fixture.destinationParent] });
    const service = relocationService(fixture, {
      afterDestinationCommit: () => { throw new Error("simulated crash"); }
    });
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");

    expect(await service.relocate({} as never, request(status.activeVaultId, status.revision)))
      .toMatchObject({ status: "failed" });
    fs.writeFileSync(path.join(fixture.sourcePath, "wiki", "note.md"), "# Changed before restart\n");

    fixture.vaults.close();
    const restartedVaults = track(new VaultService(new LocalSettingsStore(fixture.userDataPath), () => false, leaseFactory));
    const restartedRelocation = new VaultStorageRelocationService({
      userDataPath: fixture.userDataPath,
      vaultService: restartedVaults,
      pathSafety: fixture.pathSafety,
      pauseMutableWork: async () => () => undefined,
      activeJobStates: () => []
    });
    expect(await restartedRelocation.recoverInterrupted()).toEqual({ recovered: 0, failed: 1 });
    expect(restartedVaults.activeVaultPath()).toBe(fixture.sourcePath);
    expect(fs.readFileSync(path.join(fixture.sourcePath, "wiki", "note.md"), "utf8"))
      .toBe("# Changed before restart\n");
  });

  it("reports the authoritative relocated binding when receipt finalization fails after the atomic switch", async () => {
    const fixture = makeFixture();
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [fixture.destinationParent] });
    const service = relocationService(fixture, {
      afterBindingSwitch: () => { throw new Error("simulated post-switch failure"); }
    });
    const status = service.status();
    if (status.status !== "ready") throw new Error("Relocation status unavailable.");

    const result = await service.relocate({} as never, request(status.activeVaultId, status.revision));
    const destinationPath = path.join(fixture.destinationParent, path.basename(fixture.sourcePath));

    expect(result.status).toBe("relocated");
    expect(fixture.vaults.activeVaultPath()).toBe(destinationPath);
    expect(fs.existsSync(fixture.sourcePath)).toBe(true);
  });
});

function makeFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-relocation-")));
  roots.push(root);
  const sourceParent = path.join(root, "source-parent");
  const destinationParent = path.join(root, "destination-parent");
  const userDataPath = path.join(root, "user-data");
  fs.mkdirSync(sourceParent);
  fs.mkdirSync(destinationParent);
  fs.mkdirSync(userDataPath);
  const pathSafety = { appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") };
  const summary = createVaultOnDisk({
    parentDirectory: sourceParent,
    vaultName: "Safe Vault",
    ...pathSafety
  });
  const sourcePath = path.join(sourceParent, "Safe Vault");
  fs.writeFileSync(path.join(sourcePath, "wiki", "note.md"), "# Durable note\n");
  fs.writeFileSync(path.join(sourcePath, "raw", "source.bin"), "source-evidence");
  fs.writeFileSync(path.join(sourcePath, ".pige", "conversations", "history.jsonl"), '{"kind":"message"}\n');
  fs.mkdirSync(path.join(sourcePath, ".pige", "private"));
  fs.writeFileSync(path.join(sourcePath, ".pige", "private", "ingress.bin"), "private-restart-evidence");
  fs.chmodSync(path.join(sourcePath, ".pige", "private"), 0o750);
  fs.chmodSync(path.join(sourcePath, ".pige", "private", "ingress.bin"), 0o640);
  fs.writeFileSync(path.join(sourcePath, ".pige", "runtime", "old-runtime"), "transient");
  const settings = new LocalSettingsStore(userDataPath);
  settings.setActiveVault(sourcePath, summary);
  const vaults = track(new VaultService(settings, () => false, leaseFactory));
  return { root, sourcePath, destinationParent, userDataPath, pathSafety, settings, vaults };
}

function relocationService(
  fixture: ReturnType<typeof makeFixture>,
  hooks: NonNullable<ConstructorParameters<typeof VaultStorageRelocationService>[0]["testOnlyHooks"]> = {},
  states: readonly string[] = []
) {
  return new VaultStorageRelocationService({
    userDataPath: fixture.userDataPath,
    vaultService: fixture.vaults,
    pathSafety: fixture.pathSafety,
    pauseMutableWork: async () => () => undefined,
    activeJobStates: () => states,
    testOnlyHooks: hooks
  });
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

function request(activeVaultId: string, expectedRevision: string) {
  return {
    apiVersion: 1 as const,
    requestId: "vaultrelocatereq_0123456789abcdef",
    activeVaultId,
    expectedRevision
  };
}
