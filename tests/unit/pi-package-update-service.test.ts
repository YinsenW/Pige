import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PiPackageManagerService, type PiPackageRecord
} from "../../apps/desktop/src/main/services/pi-package-manager-service";
import { hashPiPackageTree } from "../../apps/desktop/src/main/services/pi-package-lifecycle-store";
import { PiPackageUpdateService } from "../../apps/desktop/src/main/services/pi-package-update-service";

const PACKAGE_NAME = "pige-update-fixture";
const PACKAGE_ID = `pkg_${createHash("sha256").update(PACKAGE_NAME).digest("hex").slice(0, 24)}`;
const UPDATE_REQUEST_ID = "pi_package_update_request_abcdefghijklmnop";
const PIN_REQUEST_ID = "pi_package_pin_request_abcdefghijklmnop";
const ROLLBACK_ID = "pi_package_rollback_abcdefghijklmnop";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageUpdateService", () => {
  it("commits an exact disabled update and performs one offline rollback via its opaque id", async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    const updated = await service.update(updateRequest(fixture));
    expect(updated).toMatchObject({
      status: "committed",
      registry: { revision: 2, packages: [{ version: "2.0.0", state: "installed_disabled",
        enabled: false, canRollback: true,
        rollbackTarget: { rollbackId: ROLLBACK_ID, targetVersion: "1.0.0" } }] }
    });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(2);
    fixture.fetchImpl.mockImplementation(async () => { throw new Error("offline"); });

    const rollbackRequest = {
      apiVersion: 1, requestId: "pi_package_rollback_request_abcdefghijklmnop",
      packageId: PACKAGE_ID, expectedRegistryRevision: 2, rollbackId: ROLLBACK_ID,
      targetVersion: "1.0.0"
    } as const;
    const rolledBack = await service.rollback(rollbackRequest);
    expect(rolledBack).toMatchObject({
      status: "committed", registry: { revision: 3, packages: [{ version: "1.0.0", canRollback: false }] }
    });
    await expect(service.rollback(rollbackRequest))
      .resolves.toMatchObject({ status: "committed", registry: { revision: 3 } });
    await expect(service.rollback({
      apiVersion: 1, requestId: "pi_package_rollback_request_secondrequest0001",
      packageId: PACKAGE_ID, expectedRegistryRevision: 3, rollbackId: ROLLBACK_ID,
      targetVersion: "1.0.0"
    })).resolves.toMatchObject({ status: "not_found", registry: { revision: 3 } });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps current bytes and registry unchanged on integrity drift, tamper, and download failure", async () => {
    const staleFixture = await createFixture();
    const staleService = createService(staleFixture);
    await expect(staleService.update({ ...updateRequest(staleFixture), expectedRegistryRevision: 0 }))
      .resolves.toMatchObject({ status: "stale", registry: { revision: 1, packages: [{ version: "1.0.0" }] } });
    expect(staleFixture.fetchImpl).not.toHaveBeenCalled();

    const integrityFixture = await createFixture();
    const integrityService = createService(integrityFixture);
    await expect(integrityService.update({
      ...updateRequest(integrityFixture),
      targetIntegrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
    })).resolves.toMatchObject({ status: "failed" });
    expect(integrityFixture.manager.summary()).toMatchObject({ revision: 1, packages: [{ version: "1.0.0" }] });
    expect(fs.readFileSync(path.join(integrityFixture.installedPath, "index.js"), "utf8")).toContain("version = 1");

    const tamperFixture = await createFixture();
    fs.writeFileSync(path.join(tamperFixture.installedPath, "index.js"), "tampered\n");
    const tamperService = createService(tamperFixture);
    await expect(tamperService.update(updateRequest(tamperFixture))).resolves.toMatchObject({ status: "failed" });
    expect(tamperFixture.fetchImpl).not.toHaveBeenCalled();
    expect(tamperFixture.manager.summary()).toMatchObject({ revision: 1, packages: [{ version: "1.0.0" }] });

    const downloadFixture = await createFixture();
    downloadFixture.fetchImpl.mockImplementationOnce(async () => { throw new Error("network failed"); });
    const downloadService = createService(downloadFixture);
    await expect(downloadService.update(updateRequest(downloadFixture))).resolves.toMatchObject({ status: "failed" });
    expect(downloadFixture.manager.summary()).toMatchObject({ revision: 1, packages: [{ version: "1.0.0" }] });
    expect(fs.readFileSync(path.join(downloadFixture.installedPath, "index.js"), "utf8")).toContain("version = 1");
  });

  it("adopts one prepared verified tree after restart exactly once", async () => {
    const fixture = await createFixture();
    await fixture.manager.withLifecycleLock(async () => {
      const current = fixture.manager.readLifecycleRegistry();
      const prepared = await fixture.manager.prepareExactUpdateCandidate({
        requestId: UPDATE_REQUEST_ID, current: current.packages[0]!, targetVersion: "2.0.0",
        targetIntegrity: fixture.targetIntegrity, signal: new AbortController().signal
      });
      fixture.manager.lifecycleStore.prepareUpdate({
        requestId: UPDATE_REQUEST_ID, rollbackId: ROLLBACK_ID, expectedRegistryRevision: current.revision,
        previousRecord: current.packages[0]!, nextRecord: prepared.record,
        candidatePath: prepared.candidatePath, createdAt: "2026-07-29T00:00:00.000Z"
      });
      fixture.manager.discardPreparedUpdate(prepared);
    });

    const restartedManager = createManager(fixture);
    const restarted = new PiPackageUpdateService({ manager: restartedManager });
    await expect(restarted.summary()).resolves.toMatchObject({ revision: 2, packages: [{ version: "2.0.0" }] });
    const secondRestart = new PiPackageUpdateService({ manager: createManager(fixture) });
    await expect(secondRestart.summary()).resolves.toMatchObject({ revision: 2, packages: [{ version: "2.0.0" }] });
    const receipt = JSON.parse(fs.readFileSync(path.join(
      fixture.machineRoot, "pi-packages", "updates", ROLLBACK_ID, ".pige-package-update.json"
    ), "utf8"));
    expect(receipt).toMatchObject({ state: "committed", committedRegistryRevision: 2 });
  });

  it("atomically pins and unpins the exact installed record while preserving rollback authority", async () => {
    const fixture = await createFixture();
    const service = createService(fixture);
    await expect(service.update(updateRequest(fixture))).resolves.toMatchObject({
      status: "committed", registry: { revision: 2, packages: [{ version: "2.0.0", canRollback: true }] }
    });
    const beforePin = fixture.manager.readLifecycleRegistry().packages[0]!;
    const pinRequest = { apiVersion: 1 as const, requestId: PIN_REQUEST_ID, packageId: PACKAGE_ID,
      expectedRegistryRevision: 2, pinned: true };
    await expect(service.setPinned(pinRequest)).resolves.toMatchObject({
      status: "committed", registry: { revision: 3, packages: [{ version: "2.0.0", pinned: true,
        canUpdate: false, canRollback: false, rollbackTarget: null }] }
    });
    const pinnedRecord = fixture.manager.readLifecycleRegistry().packages[0]!;
    expect(pinnedRecord).toMatchObject({ version: beforePin.version, treeHash: beforePin.treeHash, pinned: true });
    await expect(service.setPinned({ ...pinRequest, expectedRegistryRevision: 3 })).resolves.toMatchObject({
      status: "committed", registry: { revision: 3, packages: [{ pinned: true }] }
    });

    const fetches = fixture.fetchImpl.mock.calls.length;
    await expect(service.update({ ...updateRequest(fixture), requestId: "pi_package_update_request_pinnedcrafted001",
      expectedRegistryRevision: 3 })).resolves.toEqual(expect.objectContaining({ status: "failed" }));
    await expect(service.rollback({ apiVersion: 1, requestId: "pi_package_rollback_request_pinnedcrafted001",
      packageId: PACKAGE_ID, expectedRegistryRevision: 3, rollbackId: ROLLBACK_ID,
      targetVersion: "1.0.0" })).resolves.toEqual(expect.objectContaining({ status: "failed" }));
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(fetches);

    const restarted = new PiPackageUpdateService({ manager: createManager(fixture) });
    await expect(restarted.summary()).resolves.toMatchObject({ revision: 3, packages: [{ pinned: true }] });
    await expect(restarted.setPinned({ ...pinRequest, requestId: "pi_package_pin_request_unpinningrequest01",
      expectedRegistryRevision: 3, pinned: false })).resolves.toMatchObject({
      status: "committed", registry: { revision: 4, packages: [{ pinned: false, canUpdate: true,
        canRollback: true, rollbackTarget: { rollbackId: ROLLBACK_ID, targetVersion: "1.0.0" } }] }
    });
    await expect(restarted.summary().then((summary) => summary.packages[0])).resolves.not.toHaveProperty("privatePath");
    await expect(restarted.setPinned({ ...pinRequest, requestId: "pi_package_pin_request_stalepinrequest01",
      expectedRegistryRevision: 3 })).resolves.toMatchObject({ status: "stale", registry: { revision: 4 } });
    await expect(restarted.setPinned({ ...pinRequest, requestId: "pi_package_pin_request_missingpinrequest01",
      packageId: "pkg_ffffffffffffffffffffffff", expectedRegistryRevision: 4 })).resolves.toMatchObject({
      status: "not_found", registry: { revision: 4 }
    });
  });
});

interface Fixture {
  readonly root: string; readonly machineRoot: string; readonly installedPath: string;
  readonly manager: PiPackageManagerService; readonly fetchImpl: ReturnType<typeof vi.fn>;
  readonly targetIntegrity: string;
}

async function createFixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-update-"));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  const packageRoot = path.join(machineRoot, "pi-packages");
  const source = path.join(root, "installed-source");
  fs.mkdirSync(source, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({
    name: PACKAGE_NAME, version: "1.0.0", pi: { extensions: ["index.js"] }
  }));
  fs.writeFileSync(path.join(source, "index.js"), "export const version = 1;\n");
  const treeHash = hashPiPackageTree(source);
  const relativePath = path.join("installed", PACKAGE_ID, "1.0.0", treeHash.slice(7));
  const installedPath = path.join(packageRoot, relativePath);
  fs.mkdirSync(path.dirname(installedPath), { recursive: true, mode: 0o700 });
  fs.renameSync(source, installedPath);
  const record: PiPackageRecord = {
    packageId: PACKAGE_ID, packageName: PACKAGE_NAME, version: "1.0.0",
    packageTypes: ["extension"], dependencyCount: 0, treeHash,
    archiveHash: digest("old archive"), integrity: targetIntegrityFor("old archive"),
    manifestHash: digest("old manifest"), relativePath,
    installedAt: "2026-07-28T00:00:00.000Z", enabled: false, trust: "community",
    requests: [{ requestId: "package_request_0001", revision: 1 }]
  };
  fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(packageRoot, "registry.json"), `${JSON.stringify({
    schemaVersion: 1, revision: 1, packages: [record]
  }, null, 2)}\n`, { mode: 0o600 });

  const archiveRoot = path.join(root, "archive", "package");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const manifest = { name: PACKAGE_NAME, version: "2.0.0", pi: { extensions: ["index.js"] } };
  fs.writeFileSync(path.join(archiveRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(path.join(archiveRoot, "index.js"), "globalThis.__pigePackageImported = true; export const version = 2;\n");
  const archivePath = path.join(root, "target.tgz");
  await tar.c({ cwd: path.dirname(archiveRoot), file: archivePath, gzip: true }, ["package"]);
  const archive = fs.readFileSync(archivePath);
  const targetIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const tarballUrl = `https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-2.0.0.tgz`;
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === `https://registry.npmjs.org/${PACKAGE_NAME}/2.0.0`) {
      return new Response(JSON.stringify({ ...manifest, dist: { tarball: tarballUrl, integrity: targetIntegrity } }));
    }
    if (url === tarballUrl) return new Response(archive);
    throw new Error(`Unexpected URL: ${url}`);
  });
  const fixture = { root, machineRoot, installedPath, fetchImpl, targetIntegrity } as Omit<Fixture, "manager">;
  return { ...fixture, manager: createManager(fixture) };
}

function createManager(fixture: Pick<Fixture, "machineRoot" | "fetchImpl">): PiPackageManagerService {
  return new PiPackageManagerService({
    appDataRoot: fixture.machineRoot, fetchImpl: fixture.fetchImpl,
    lookup: async () => ["93.184.216.34"]
  });
}

function createService(fixture: Fixture): PiPackageUpdateService {
  return new PiPackageUpdateService({ manager: fixture.manager, rollbackId: () => ROLLBACK_ID,
    now: () => new Date("2026-07-29T00:00:00.000Z") });
}

function updateRequest(fixture: Fixture) {
  return { apiVersion: 1 as const, requestId: UPDATE_REQUEST_ID, packageId: PACKAGE_ID,
    expectedRegistryRevision: 1, targetVersion: "2.0.0", targetIntegrity: fixture.targetIntegrity };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function targetIntegrityFor(value: string): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}
