import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { ingressSnapshotService } from "../../apps/desktop/src/main/services/ingress-snapshot-service";
import { ManagedCopyRootService } from "../../apps/desktop/src/main/services/managed-copy-root-service";
import {
  configureManagedCopyLocatorResolver,
  createVerifiedSourceFileSnapshotAsync,
  readVerifiedSourceTextPrefix,
  verifyReadableSourceFile,
  verifyReadableSourceFileAsync
} from "../../apps/desktop/src/main/services/source-file-access";
import { createVaultOnDisk, readVaultManifest } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  configureManagedCopyLocatorResolver(undefined);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("source file access", () => {
  it("keeps reference-original bytes isolated while failing currentness after the live file mutates", async () => {
    const fixture = await makeFixture("reference_original", "immutable snapshot bytes");
    const isolated = ingressSnapshotService.acquireRead(fixture.vaultPath, fixture.binding);

    fs.writeFileSync(fixture.originalPath, "mutated original bytes", "utf8");

    expect(fs.readFileSync(isolated.absolutePath, "utf8")).toBe("immutable snapshot bytes");
    expect(captureError(() => verifyReadableSourceFile(fixture.vaultPath, fixture.sourceRecord)))
      .toMatchObject({ code: "ingress_snapshot.source_changed" });
    await expect(verifyReadableSourceFileAsync(fixture.vaultPath, fixture.sourceRecord))
      .rejects.toMatchObject({ code: "ingress_snapshot.source_changed" });
    await expect(createVerifiedSourceFileSnapshotAsync(fixture.vaultPath, fixture.sourceRecord))
      .rejects.toMatchObject({ code: "ingress_snapshot.source_changed" });
    expect(captureError(() => readVerifiedSourceTextPrefix(fixture.vaultPath, fixture.sourceRecord, 1024)))
      .toMatchObject({ code: "ingress_snapshot.source_changed" });
    isolated.release();
  });

  it("routes every managed-source reader through the immutable ingress snapshot", async () => {
    const fixture = await makeFixture("copy_to_source_library", "snapshot-owned body");
    fs.chmodSync(requireValue(fixture.managedPath), 0o600);
    fs.writeFileSync(requireValue(fixture.managedPath), "tampered managed body", "utf8");

    const syncFile = verifyReadableSourceFile(fixture.vaultPath, fixture.sourceRecord);
    const asyncFile = await verifyReadableSourceFileAsync(fixture.vaultPath, fixture.sourceRecord);
    const disposable = await createVerifiedSourceFileSnapshotAsync(fixture.vaultPath, fixture.sourceRecord);
    const prefix = readVerifiedSourceTextPrefix(fixture.vaultPath, fixture.sourceRecord, 1024);

    expect(syncFile.location).toBe("managed_copy");
    expect(asyncFile.location).toBe("managed_copy");
    expect(fs.readFileSync(syncFile.absolutePath, "utf8")).toBe("snapshot-owned body");
    expect(asyncFile.absolutePath).toBe(syncFile.absolutePath);
    expect(fs.readFileSync(disposable.absolutePath, "utf8")).toBe("snapshot-owned body");
    expect(prefix).toEqual({ text: "snapshot-owned body", complete: true });
    expect(ingressSnapshotService.readerCount(fixture.binding)).toBe(1);
    await disposable.dispose();
    expect(ingressSnapshotService.readerCount(fixture.binding)).toBe(0);
  });

  it("resolves root-relative managed copies through the exact current machine binding", () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-root-access-")));
    roots.push(root);
    const userData = path.join(root, "user-data");
    const external = path.join(root, "external");
    fs.mkdirSync(userData);
    fs.mkdirSync(external);
    const vault = createVaultOnDisk({
      parentDirectory: root,
      vaultName: "External Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-29T00:00:00.000Z")
    });
    const vaultPath = path.join(root, "External Vault");
    const owner = new ManagedCopyRootService(userData);
    const receipt = owner.bindDefault({ vaultId: vault.vaultId, selectedDirectory: external });
    configureManagedCopyLocatorResolver({
      resolve: (vaultId, activeVaultPath, managedCopy) => owner.resolveManagedCopy(vaultId, activeVaultPath, managedCopy)
    });
    const relativePath = "raw/files/example.txt";
    const body = "external managed source";
    fs.mkdirSync(path.dirname(path.join(external, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(external, relativePath), body, "utf8");
    const sourceRecord = SourceRecordSchema.parse({
      id: "src_20260729_sourceaccess1",
      kind: "plain_text_file",
      storageStrategy: "copy_to_source_library",
      semanticOrchestration: "agent_turn",
      managedCopy: {
        path: relativePath,
        rootId: receipt.rootId,
        pathBasis: "root_relative",
        checksum: checksum(body),
        size: Buffer.byteLength(body)
      },
      artifacts: [],
      metadata: {},
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    });

    expect(verifyReadableSourceFile(vaultPath, sourceRecord)).toMatchObject({
      absolutePath: path.join(external, relativePath),
      checksum: checksum(body),
      size: Buffer.byteLength(body),
      location: "managed_copy"
    });
  });
});

async function makeFixture(
  storageStrategy: "copy_to_source_library" | "reference_original",
  body: string
): Promise<{
  readonly vaultPath: string;
  readonly originalPath: string;
  readonly managedPath?: string;
  readonly binding: { readonly vaultId: string; readonly parentJobId: string; readonly sourceId: string; readonly ordinal: number };
  readonly sourceRecord: SourceRecord;
}> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-file-access-")));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-27T10:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Vault");
  const originalPath = path.join(root, "accepted.txt");
  fs.writeFileSync(originalPath, body, "utf8");
  const stat = fs.lstatSync(originalPath);
  const binding = {
    vaultId: readVaultManifest(vaultPath).vault_id,
    parentJobId: "job_20260727_sourceaccess01",
    sourceId: "src_20260727_sourceaccess01",
    ordinal: 0
  } as const;
  const digest = checksum(body);
  const descriptor = await ingressSnapshotService.createOrAdopt({
    vaultPath,
    ...binding,
    sourcePath: originalPath,
    checksum: digest,
    size: stat.size,
    noFollowIdentity: {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
      changedAtMs: stat.ctimeMs
    }
  });
  let managedPath: string | undefined;
  let adopted = descriptor;
  if (storageStrategy === "copy_to_source_library") {
    const managedRoot = path.join(vaultPath, "raw", "files");
    fs.mkdirSync(managedRoot, { recursive: true });
    managedPath = path.join(managedRoot, "accepted.txt");
    adopted = await ingressSnapshotService.promoteManagedCopy({
      vaultPath,
      binding,
      managedRoot,
      destinationPath: managedPath
    });
  }
  const sourceRecord = SourceRecordSchema.parse({
    id: binding.sourceId,
    kind: "plain_text_file",
    storageStrategy,
    semanticOrchestration: "agent_turn",
    original: {
      uri: `file://${originalPath}`,
      path: originalPath,
      displayName: "accepted.txt",
      lastKnownMtime: new Date(stat.mtimeMs).toISOString(),
      lastKnownSize: adopted.size,
      checksum: adopted.checksum
    },
    ...(managedPath ? {
      managedCopy: {
        path: path.relative(vaultPath, managedPath).split(path.sep).join("/"),
        checksum: adopted.checksum,
        size: adopted.size
      }
    } : {}),
    artifacts: [],
    metadata: {
      agentTurnJobId: binding.parentJobId,
      agentTurnAttachmentOrdinal: binding.ordinal,
      parserStatus: "text_ready"
    },
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z"
  });
  return { vaultPath, originalPath, managedPath, binding, sourceRecord };
}

function checksum(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected action to throw.");
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
