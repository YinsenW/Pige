import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PiPackageLifecycleStore,
  hashPiPackageTree,
  type PiPackageLifecycleRecord
} from "../../apps/desktop/src/main/services/pi-package-lifecycle-store";

interface TestRecord extends PiPackageLifecycleRecord {
  readonly owner: "test";
}

const roots: string[] = [];
const requestId = "pi_package_uninstall_request_abcdefghijklmnop";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageLifecycleStore", () => {
  it("persists one exact receipt, moves the descriptor-verified tree to retained trash, and commits idempotently", () => {
    const fixture = createFixture();
    const receipt = fixture.store.prepareUninstall({
      requestId, packageId: fixture.record.packageId, expectedRegistryRevision: 3,
      record: fixture.record, createdAt: "2026-07-28T12:00:00.000Z"
    });

    fixture.store.ensureTrashed(receipt);
    expect(fs.existsSync(fixture.installedPath)).toBe(false);
    const trashPath = path.join(fixture.packageRoot, "trash", requestId, "package");
    expect(fs.readFileSync(path.join(trashPath, "index.js"), "utf8")).toBe("export const value = 1;\n");
    expect(fixture.store.markUninstallCommitted(receipt, 4)).toMatchObject({
      state: "committed", committedRegistryRevision: 4
    });
    expect(fixture.store.markUninstallCommitted(receipt, 4)).toMatchObject({ state: "committed" });
    expect(fs.existsSync(trashPath)).toBe(true);
  });

  it("adopts a prepared post-rename receipt after restart without renumbering or restoring package bytes", () => {
    const fixture = createFixture();
    const receipt = fixture.store.prepareUninstall({
      requestId, packageId: fixture.record.packageId, expectedRegistryRevision: 8,
      record: fixture.record, createdAt: "2026-07-28T12:01:00.000Z"
    });
    fixture.store.ensureTrashed(receipt);
    const interruptedTemporary = path.join(
      fixture.packageRoot, "trash", `${requestId}.00000000-0000-4000-8000-000000000001.tmp`
    );
    fs.mkdirSync(interruptedTemporary);
    fs.writeFileSync(path.join(interruptedTemporary, "partial"), "partial\n");

    const restarted = createStore(fixture.packageRoot, fixture.installedRoot);
    expect(fs.existsSync(interruptedTemporary)).toBe(false);
    expect(restarted.listPreparedUninstalls()).toEqual([receipt]);
    restarted.ensureTrashed(receipt);
    restarted.markUninstallCommitted(receipt, 9);
    expect(restarted.listPreparedUninstalls()).toEqual([]);
    expect(fs.existsSync(fixture.installedPath)).toBe(false);
  });

  it("fails closed for a symlinked owner parent or hard-linked package file before trash mutation", () => {
    const symlinkFixture = createFixture();
    const realVersionRoot = path.dirname(symlinkFixture.installedPath);
    const displaced = `${realVersionRoot}.real`;
    fs.renameSync(realVersionRoot, displaced);
    fs.symlinkSync(displaced, realVersionRoot, "dir");
    expect(() => symlinkFixture.store.prepareUninstall({
      requestId, packageId: symlinkFixture.record.packageId, expectedRegistryRevision: 1,
      record: symlinkFixture.record, createdAt: "2026-07-28T12:02:00.000Z"
    })).toThrow(expect.objectContaining({ code: "package.install_changed" }));

    const hardlinkFixture = createFixture();
    fs.linkSync(
      path.join(hardlinkFixture.installedPath, "index.js"),
      path.join(hardlinkFixture.installedPath, "duplicate.js")
    );
    expect(() => hardlinkFixture.store.assertInstalled(hardlinkFixture.record))
      .toThrow(expect.objectContaining({ code: "package.install_changed" }));
    expect(fs.existsSync(hardlinkFixture.installedPath)).toBe(true);
  });

  it("durably swaps one verified update tree and consumes its opaque rollback exactly once", () => {
    const fixture = createFixture();
    const candidatePath = path.join(fixture.packageRoot, "candidate");
    fs.mkdirSync(candidatePath, { mode: 0o700 });
    fs.writeFileSync(path.join(candidatePath, "index.js"), "export const value = 2;\n", { mode: 0o600 });
    const treeHash = hashPiPackageTree(candidatePath);
    const next: TestRecord = {
      ...fixture.record, version: "2.0.0", treeHash,
      relativePath: path.join("installed", fixture.record.packageId, "2.0.0", treeHash.slice(7))
    };
    const receipt = fixture.store.prepareUpdate({
      requestId: "pi_package_update_request_abcdefghijklmnop",
      rollbackId: "pi_package_rollback_abcdefghijklmnop", expectedRegistryRevision: 3,
      previousRecord: fixture.record, nextRecord: next, candidatePath,
      createdAt: "2026-07-29T00:00:00.000Z"
    });
    fixture.store.ensureUpdated(receipt);
    const committed = fixture.store.markUpdateCommitted(receipt, 4);
    expect(fixture.store.rollbackTarget(next)).toEqual({
      rollbackId: receipt.rollbackId, targetVersion: fixture.record.version
    });
    const prepared = fixture.store.prepareRollback({
      receipt: committed, requestId: "pi_package_rollback_request_abcdefghijklmnop",
      expectedRegistryRevision: 6
    });
    fixture.store.ensureRolledBack(prepared);
    fixture.store.markRollbackCommitted(prepared, 7);
    expect(fixture.store.rollbackTarget(fixture.record)).toBeUndefined();
    expect(() => fixture.store.prepareRollback({
      receipt: committed, requestId: "pi_package_rollback_request_secondrequest0001",
      expectedRegistryRevision: 5
    })).toThrow(expect.objectContaining({ code: "package.rollback_receipt_conflict" }));
    expect(fs.readFileSync(path.join(fixture.installedPath, "index.js"), "utf8")).toContain("value = 1");
  });

  it("supersedes an older rollback when a newer exact update commits", () => {
    const fixture = createFixture();
    const first = prepareLifecycleUpdate(fixture, fixture.record, "2.0.0", "first", 1);
    fixture.store.ensureUpdated(first);
    const firstCommitted = fixture.store.markUpdateCommitted(first, 2);
    const second = prepareLifecycleUpdate(fixture, first.nextRecord, "3.0.0", "second", 2);
    fixture.store.ensureUpdated(second);
    const secondCommitted = fixture.store.markUpdateCommitted(second, 3);
    expect(fixture.store.readUpdateReceipt(firstCommitted.rollbackId)?.state).toBe("superseded");

    const rollback = fixture.store.prepareRollback({
      receipt: secondCommitted, requestId: "pi_package_rollback_request_secondrequest0001",
      expectedRegistryRevision: 3
    });
    fixture.store.ensureRolledBack(rollback);
    fixture.store.markRollbackCommitted(rollback, 4);
    expect(fixture.store.rollbackTarget(first.nextRecord)).toBeUndefined();
  });
});

function prepareLifecycleUpdate(
  fixture: ReturnType<typeof createFixture>, current: TestRecord, version: string, suffix: string,
  expectedRegistryRevision: number
) {
  const candidatePath = path.join(fixture.packageRoot, `candidate-${suffix}`);
  fs.mkdirSync(candidatePath, { mode: 0o700 });
  fs.writeFileSync(path.join(candidatePath, "index.js"), `export const value = '${suffix}';\n`, { mode: 0o600 });
  const treeHash = hashPiPackageTree(candidatePath);
  const next: TestRecord = { ...current, version, treeHash,
    relativePath: path.join("installed", current.packageId, version, treeHash.slice(7)) };
  return fixture.store.prepareUpdate({
    requestId: `pi_package_update_request_${suffix.padEnd(16, "a")}`,
    rollbackId: `pi_package_rollback_${suffix.padEnd(16, "a")}`,
    expectedRegistryRevision, previousRecord: current, nextRecord: next, candidatePath,
    createdAt: `2026-07-29T00:00:0${expectedRegistryRevision}.000Z`
  });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-lifecycle-"));
  roots.push(root);
  const packageRoot = path.join(fs.realpathSync.native(root), "pi-packages");
  const installedRoot = path.join(packageRoot, "installed");
  fs.mkdirSync(installedRoot, { recursive: true, mode: 0o700 });
  const temporary = path.join(root, "tree");
  fs.mkdirSync(temporary, { mode: 0o700 });
  fs.writeFileSync(path.join(temporary, "index.js"), "export const value = 1;\n", { mode: 0o600 });
  const treeHash = hashPiPackageTree(temporary);
  const packageId = "pkg_0123456789abcdef01234567";
  const version = "1.2.3";
  const relativePath = path.join("installed", packageId, version, treeHash.slice("sha256:".length));
  const installedPath = path.join(packageRoot, relativePath);
  fs.mkdirSync(path.dirname(installedPath), { recursive: true, mode: 0o700 });
  fs.renameSync(temporary, installedPath);
  const record: TestRecord = { packageId, packageName: "test-package", version, treeHash, relativePath, owner: "test" };
  return { packageRoot, installedRoot, installedPath, record, store: createStore(packageRoot, installedRoot) };
}

function createStore(packageRoot: string, installedRoot: string): PiPackageLifecycleStore<TestRecord> {
  return new PiPackageLifecycleStore({
    packageRoot,
    installedRoot,
    parseRecord: (value) => {
      const record = value as TestRecord;
      if (record?.owner !== "test") throw new Error("invalid test record");
      return record;
    }
  });
}
