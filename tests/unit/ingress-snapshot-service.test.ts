import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IngressSnapshotService,
  type CreateIngressSnapshotInput,
  type IngressSnapshotDescriptor,
  type IngressSnapshotReleaseProof
} from "../../apps/desktop/src/main/services/ingress-snapshot-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("IngressSnapshotService", () => {
  it("does not create private snapshot storage during read-only pre-Send lookup", async () => {
    const fixture = makeFixture("not submitted");
    const service = new IngressSnapshotService();

    expect(service.read(fixture.vaultPath, fixture.input)).toBeUndefined();
    expect(await service.readAsync(fixture.vaultPath, fixture.input)).toBeUndefined();
    expect(await service.reap(fixture.vaultPath, () => undefined))
      .toEqual({ scanned: 0, released: 0, retained: 0 });
    expect(fs.existsSync(path.join(fixture.vaultPath, ".pige", "private", "ingress-snapshots"))).toBe(false);
  });

  it("creates one durable descriptor, adopts it across restart, and serves snapshot bytes through exact reader leases", async () => {
    const fixture = makeFixture("immutable accepted bytes");
    const service = new IngressSnapshotService({ now: fixedClock() });
    const first = await service.createOrAdopt(fixture.input);
    const adopted = await service.createOrAdopt(fixture.input);
    const restarted = new IngressSnapshotService();
    const restartedDescriptor = await restarted.createOrAdopt(fixture.input);

    expect(adopted).toEqual(first);
    expect(restartedDescriptor).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      vaultId: fixture.input.vaultId,
      parentJobId: fixture.input.parentJobId,
      sourceId: fixture.input.sourceId,
      ordinal: 1,
      checksum: fixture.input.checksum,
      size: fixture.input.size
    });
    expect(first.descriptorDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(findFiles(fixture.vaultPath, "descriptor.json")).toHaveLength(1);
    expect(findFiles(fixture.vaultPath, first.snapshotFileName)).toHaveLength(1);

    const syncLease = restarted.acquireRead(fixture.vaultPath, fixture.input);
    const asyncLease = await restarted.acquireReadAsync(fixture.vaultPath, fixture.input);
    expect(restarted.readerCount(fixture.input)).toBe(2);
    expect(fs.readFileSync(syncLease.absolutePath, "utf8")).toBe("immutable accepted bytes");
    expect(asyncLease.absolutePath).toBe(syncLease.absolutePath);
    syncLease.release();
    syncLease.release();
    expect(restarted.readerCount(fixture.input)).toBe(1);
    asyncLease.release();
    expect(restarted.readerCount(fixture.input)).toBe(0);
  });

  it("keeps reference-original provenance currentness separate while every reader consumes the immutable snapshot", async () => {
    const fixture = makeFixture("original version");
    const service = new IngressSnapshotService();
    await service.createOrAdopt(fixture.input);
    const lease = await service.acquireReadAsync(fixture.vaultPath, fixture.input);

    fs.writeFileSync(fixture.sourcePath, "mutated original", "utf8");
    expect(fs.readFileSync(lease.absolutePath, "utf8")).toBe("original version");
    await expect(service.proveReferencedOriginalCurrent(fixture.vaultPath, fixture.input))
      .rejects.toMatchObject({ code: "ingress_snapshot.source_changed" });
    expect(service.readerCount(fixture.input)).toBe(1);
    lease.release();
  });

  it("promotes one verified managed copy idempotently while retaining the private descriptor and snapshot", async () => {
    const fixture = makeFixture("managed promotion bytes");
    const managedRoot = path.join(fixture.root, "managed");
    const destinationPath = path.join(managedRoot, "2026", "accepted.bin");
    fs.mkdirSync(managedRoot, { recursive: true });
    const service = new IngressSnapshotService({ now: fixedClock() });
    const initial = await service.createOrAdopt(fixture.input);
    const promoted = await service.promoteManagedCopy({
      vaultPath: fixture.vaultPath,
      binding: fixture.input,
      managedRoot,
      destinationPath
    });
    const adopted = await service.promoteManagedCopy({
      vaultPath: fixture.vaultPath,
      binding: fixture.input,
      managedRoot,
      destinationPath
    });

    expect(fs.readFileSync(destinationPath, "utf8")).toBe("managed promotion bytes");
    expect(promoted.managedCopy).toMatchObject({
      destinationPath,
      checksum: fixture.input.checksum,
      size: fixture.input.size
    });
    expect(adopted).toEqual(promoted);
    expect(promoted.descriptorDigest).not.toBe(initial.descriptorDigest);
    expect(fs.readFileSync(service.acquireRead(fixture.vaultPath, fixture.input).absolutePath, "utf8"))
      .toBe("managed promotion bytes");

    const outside = path.join(fixture.root, "outside.bin");
    await expect(service.promoteManagedCopy({
      vaultPath: fixture.vaultPath,
      binding: fixture.input,
      managedRoot,
      destinationPath: outside
    })).rejects.toMatchObject({ code: "ingress_snapshot.descriptor_mismatch" });
  });

  it("fails closed for source symlinks, descriptor binding drift, and snapshot tampering", async () => {
    const fixture = makeFixture("guarded bytes");
    const service = new IngressSnapshotService();
    const symlinkPath = path.join(fixture.root, "source-link.txt");
    fs.symlinkSync(fixture.sourcePath, symlinkPath);
    const symlinkInput = { ...fixture.input, sourcePath: symlinkPath };
    await expect(service.createOrAdopt(symlinkInput)).rejects.toMatchObject({
      code: "ingress_snapshot.source_unavailable"
    });

    const descriptor = await service.createOrAdopt(fixture.input);
    const mismatched = { ...fixture.input, sourceId: "src_20260727_other0001" };
    await expect(service.createOrAdopt({ ...mismatched, ordinal: fixture.input.ordinal }))
      .resolves.toMatchObject({ sourceId: mismatched.sourceId });
    await expect(service.createOrAdopt({ ...fixture.input, checksum: digest("different") }))
      .rejects.toMatchObject({ code: "ingress_snapshot.descriptor_mismatch" });

    const snapshotLease = service.acquireRead(fixture.vaultPath, fixture.input);
    const snapshotPath = snapshotLease.absolutePath;
    snapshotLease.release();
    fs.chmodSync(snapshotPath, 0o600);
    fs.writeFileSync(snapshotPath, "tampered bytes", "utf8");
    expect(() => service.acquireRead(fixture.vaultPath, fixture.input)).toThrowError(
      expect.objectContaining({ code: "ingress_snapshot.descriptor_mismatch" })
    );
  });

  it("adopts a concurrent exact creator without duplicate descriptors", async () => {
    const fixture = makeFixture("concurrent accepted bytes");
    const first = new IngressSnapshotService();
    const second = new IngressSnapshotService();
    const [left, right] = await Promise.all([
      first.createOrAdopt(fixture.input),
      second.createOrAdopt(fixture.input)
    ]);

    expect(left).toEqual(right);
    expect(findFiles(fixture.vaultPath, "descriptor.json")).toHaveLength(1);
    expect(findFiles(fixture.vaultPath, left.snapshotFileName)).toHaveLength(1);
  });

  it("releases and reaps only with exact owner proof, exact descriptor digest, and no reader or recovery owner", async () => {
    const firstFixture = makeFixture("release one");
    const secondSource = path.join(firstFixture.root, "source-two.txt");
    fs.writeFileSync(secondSource, "release two", "utf8");
    const secondInput = createInput(firstFixture.vaultPath, secondSource, "release two", 2, "src_20260727_snapshot0002");
    const service = new IngressSnapshotService();
    const first = await service.createOrAdopt(firstFixture.input);
    const second = await service.createOrAdopt(secondInput);
    const lease = service.acquireRead(firstFixture.vaultPath, firstFixture.input);

    expect(service.release(firstFixture.vaultPath, proof(first))).toEqual({ status: "busy", readerCount: 1 });
    lease.release();
    expect(service.release(firstFixture.vaultPath, { ...proof(first), expectedDescriptorDigest: digest("stale") }))
      .toEqual({ status: "stale" });
    expect(service.release(firstFixture.vaultPath, proof(first))).toEqual({ status: "released" });
    expect(service.release(firstFixture.vaultPath, proof(first))).toEqual({ status: "not_found" });

    const retained = await service.reap(firstFixture.vaultPath, () => undefined);
    expect(retained).toEqual({ scanned: 1, released: 0, retained: 1 });
    const reaped = await service.reap(firstFixture.vaultPath, ({ descriptor }) => proof(descriptor));
    expect(reaped).toEqual({ scanned: 1, released: 1, retained: 0 });
    expect(await service.readAsync(firstFixture.vaultPath, secondInput)).toBeUndefined();
    expect(second.descriptorDigest).toMatch(/^sha256:/u);
  });

  it("reaps only interrupted private staging after restart and retains the user-owned source", async () => {
    const fixture = makeFixture("restart-owned source");
    const privateRoot = path.join(fixture.vaultPath, ".pige", "private", "ingress-snapshots");
    const interrupted = path.join(
      privateRoot,
      `snap_${"a".repeat(40)}.staging-00000000-0000-4000-8000-000000000001`
    );
    fs.mkdirSync(interrupted, { recursive: true });
    fs.writeFileSync(path.join(interrupted, "snapshot.txt"), "unpublished partial bytes", "utf8");
    const service = new IngressSnapshotService();

    expect(await service.reap(fixture.vaultPath, () => {
      throw new Error("Interrupted staging is not a published descriptor candidate.");
    })).toEqual({ scanned: 1, released: 1, retained: 0 });
    expect(fs.existsSync(interrupted)).toBe(false);
    expect(fs.readFileSync(fixture.sourcePath, "utf8")).toBe("restart-owned source");
  });

  it("lists only verified immutable descriptors for one exact parent Job", async () => {
    const fixture = makeFixture("first parent source");
    const secondSource = path.join(fixture.root, "second.txt");
    fs.writeFileSync(secondSource, "second parent source", "utf8");
    const second = createInput(
      fixture.vaultPath,
      secondSource,
      "second parent source",
      2,
      "src_20260727_snapshot0002"
    );
    const service = new IngressSnapshotService();
    await service.createOrAdopt(second);
    await service.createOrAdopt(fixture.input);

    expect(await service.listForParent(fixture.vaultPath, fixture.input.parentJobId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: fixture.input.sourceId, ordinal: fixture.input.ordinal }),
        expect.objectContaining({ sourceId: second.sourceId, ordinal: second.ordinal })
      ]));
    expect(await service.listForParent(fixture.vaultPath, "job_20260727_other0001")).toEqual([]);
  });

  it("discards only the exact unpublished descriptor and its integrity-matching managed copy", async () => {
    const fixture = makeFixture("unpublished managed bytes");
    const managedRoot = path.join(fixture.root, "managed");
    const destinationPath = path.join(managedRoot, "accepted.bin");
    fs.mkdirSync(managedRoot, { recursive: true });
    const service = new IngressSnapshotService();
    const descriptor = await service.createOrAdopt(fixture.input);
    const promoted = await service.promoteManagedCopy({
      vaultPath: fixture.vaultPath,
      binding: fixture.input,
      managedRoot,
      destinationPath
    });

    expect(service.discardUnpublished(fixture.vaultPath, fixture.input, descriptor.descriptorDigest))
      .toEqual({ status: "stale" });
    expect(service.discardUnpublished(fixture.vaultPath, fixture.input, promoted.descriptorDigest))
      .toEqual({ status: "released" });
    expect(fs.existsSync(destinationPath)).toBe(false);
    expect(service.discardUnpublished(fixture.vaultPath, fixture.input, promoted.descriptorDigest))
      .toEqual({ status: "not_found" });
  });
});

function makeFixture(body: string) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ingress-snapshot-")));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
  const sourcePath = path.join(root, "accepted-source.txt");
  fs.writeFileSync(sourcePath, body, "utf8");
  return { root, vaultPath, sourcePath, input: createInput(vaultPath, sourcePath, body) };
}

function createInput(
  vaultPath: string,
  sourcePath: string,
  body: string,
  ordinal = 1,
  sourceId = "src_20260727_snapshot0001"
): CreateIngressSnapshotInput {
  const stat = fs.lstatSync(sourcePath);
  return {
    vaultPath,
    vaultId: "vault_20260727_snapshot",
    parentJobId: "job_20260727_snapshot0001",
    sourceId,
    ordinal,
    sourcePath,
    checksum: digest(body),
    size: Buffer.byteLength(body),
    noFollowIdentity: {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
      changedAtMs: stat.ctimeMs
    }
  };
}

function proof(descriptor: IngressSnapshotDescriptor): IngressSnapshotReleaseProof {
  return {
    vaultId: descriptor.vaultId,
    parentJobId: descriptor.parentJobId,
    sourceId: descriptor.sourceId,
    ordinal: descriptor.ordinal,
    expectedDescriptorDigest: descriptor.descriptorDigest,
    parentDisposition: "terminal",
    childOwnershipComplete: true,
    recoveryOwnerIds: []
  };
}

function fixedClock(): () => Date {
  return () => new Date("2026-07-27T08:00:00.000Z");
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function findFiles(root: string, name: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name === name) found.push(absolute);
    }
  };
  visit(root);
  return found;
}
