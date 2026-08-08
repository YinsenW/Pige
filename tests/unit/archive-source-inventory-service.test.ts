import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { JobRecordSchema, SourceRecordSchema } from "@pige/schemas";
import {
  DEFAULT_ARCHIVE_SOURCE_INVENTORY_LIMITS,
  inspectArchiveSource,
  prepareArchiveSourceRecord
} from "../../apps/desktop/src/main/services/archive-source-inventory-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("archive source inventory service", () => {
  it("returns a bounded deterministic inventory with a checksum and safe relative locators", async () => {
    const archivePath = await writeArchive([
      { name: "docs/", data: Buffer.alloc(0) },
      { name: "docs/readme.txt", data: Buffer.from("local archive evidence", "utf8") },
      { name: "images/pixel.bin", data: Buffer.from([1, 2, 3, 4]) }
    ]);

    const first = await inspectArchiveSource({ archivePath });
    const second = await inspectArchiveSource({
      archivePath,
      expectedChecksum: first.archiveChecksum,
      expectedSize: first.archiveSize
    });

    expect(first).toEqual(second);
    expect(first.inventoryVersion).toBe("yauzl@3.4.0");
    expect(first.archiveChecksumBefore).toBe(first.archiveChecksum);
    expect(first.limitProfileDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.entries.map((entry) => entry.relativePath)).toEqual([
      "docs/",
      "docs/readme.txt",
      "images/pixel.bin"
    ]);
    expect(first.entries.map((entry) => entry.locator)).toEqual([
      "archive:entry:1",
      "archive:entry:2",
      "archive:entry:3"
    ]);
    expect(first.entries.every((entry) => !path.isAbsolute(entry.relativePath))).toBe(true);
    expect(first.totalUncompressedBytes).toBe(26);
  });

  it("captures one ZIP through the existing Capture Job and Source Page without extracting members", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-archive-capture-"));
    temporaryRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Archive Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-08-08T12:00:00.000Z")
    });
    const vaultPath = path.join(root, "Archive Vault");
    const vaultPort = {
      current: () => loadVaultSummary(vaultPath),
      activeVaultPath: () => vaultPath
    };
    const archivePath = await writeArchive([
      { name: "notes/readme.txt", data: Buffer.from("PRIVATE_ARCHIVE_MEMBER_BODY_8f7c", "utf8") },
      { name: "nested/", data: Buffer.alloc(0) }
    ]);
    const capture = new LegacyCaptureFixture(vaultPort, vaultPath);
    const first = await capture.submitFiles({
      filePaths: [archivePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    });

    expect(first).toMatchObject({ status: "queued", sourceIds: [expect.any(String)], jobIds: [expect.any(String)] });
    const jobId = first.jobIds[0];
    if (!jobId) throw new Error("Archive capture did not create a Capture Job.");
    expect(new JobsService(vaultPort).processQueuedCaptures({ jobIds: [jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const sourceId = first.sourceIds[0];
    if (!sourceId) throw new Error("Archive capture did not create a Source Record.");
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`);
    const sourceRecord = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
    expect(sourceRecord).toMatchObject({
      id: sourceId,
      kind: "archive",
      metadata: {
        archiveInventoryStatus: "ready",
        archiveInventoryEntryCount: 2,
        parserRequired: false
      }
    });
    const inventoryArtifact = sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_archive_inventory"));
    if (!inventoryArtifact) throw new Error("Archive inventory artifact was not published.");
    const inventoryPath = path.join(vaultPath, inventoryArtifact.path);
    const sourcePagePath = sourceRecord.knowledgePagePath
      ? path.join(vaultPath, sourceRecord.knowledgePagePath)
      : undefined;
    expect(sourcePagePath && fs.existsSync(sourcePagePath)).toBe(true);
    const inventoryBody = fs.readFileSync(inventoryPath, "utf8");
    const sourcePageBody = sourcePagePath ? fs.readFileSync(sourcePagePath, "utf8") : "";
    expect(sourcePageBody).toContain("## Archive Inventory");
    expect(sourcePageBody).toContain("Entries: 2");
    expect(inventoryBody).not.toContain("PRIVATE_ARCHIVE_MEMBER_BODY_8f7c");
    expect(sourcePageBody).not.toContain("PRIVATE_ARCHIVE_MEMBER_BODY_8f7c");
    expect(findFiles(path.join(vaultPath, "artifacts", "archive-inventory"), ".json")).toHaveLength(1);
    expect(findFiles(path.join(vaultPath, "raw", "files"), ".zip")).toHaveLength(1);

    const restarted = new JobsService(vaultPort);
    expect(restarted.processQueuedCaptures({ jobIds: [jobId] })).toEqual({
      processed: 0,
      completed: 0,
      failed: 0
    });
    expect(JobRecordSchema.parse(JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`), "utf8"))).state)
      .toBe("completed");
  });

  it("adopts a completed inventory receipt without creating a second artifact", async () => {
    const archivePath = await writeArchive([{ name: "notes/readme.txt", data: Buffer.from("receipt", "utf8") }]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-archive-receipt-"));
    temporaryRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Receipt Vault",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-08-08T12:00:00.000Z")
    });
    const vaultPath = path.join(root, "Receipt Vault");
    const sourceRecord = SourceRecordSchema.parse({
      id: "src_20260808_archive0001",
      kind: "archive",
      storageStrategy: "reference_original",
      semanticOrchestration: "agent_turn",
      original: { uri: `file://${archivePath}`, path: archivePath, displayName: "receipt.zip" },
      artifacts: [],
      metadata: {},
      createdAt: "2026-08-08T12:00:00.000Z",
      updatedAt: "2026-08-08T12:00:00.000Z"
    });
    const first = await prepareArchiveSourceRecord({
      vaultPath,
      sourceRecord,
      archivePath,
      expectedChecksum: (await inspectArchiveSource({ archivePath })).archiveChecksum,
      expectedSize: fs.statSync(archivePath).size
    });
    const second = await prepareArchiveSourceRecord({
      vaultPath,
      sourceRecord: first.sourceRecord,
      archivePath,
      expectedChecksum: first.inventory.archiveChecksum,
      expectedSize: first.inventory.archiveSize
    });

    expect(second.artifactId).toBe(first.artifactId);
    expect(second.artifactPath).toBe(first.artifactPath);
    expect(second.inventory).toEqual(first.inventory);
    expect(findFiles(path.join(vaultPath, "artifacts", "archive-inventory"), ".json")).toHaveLength(1);
  });

  it("rejects traversal entries before exposing an inventory", async () => {
    const archivePath = await writeArchive([{ name: "safeentry12345", data: Buffer.from("no", "utf8") }]);
    rewriteZipEntryName(archivePath, "../outside.txt");

    await expect(inspectArchiveSource({ archivePath })).rejects.toMatchObject({
      code: "source.archive_unsafe_entry"
    });
  });

  it("rejects a changed archive identity and configured bounds", async () => {
    const archivePath = await writeArchive([{ name: "data.txt", data: Buffer.from("original", "utf8") }]);
    const initial = await inspectArchiveSource({ archivePath });

    await expect(inspectArchiveSource({
      archivePath,
      limits: { maxArchiveBytes: initial.archiveSize - 1 }
    })).rejects.toMatchObject({ code: "source.archive_too_large" });

    fs.appendFileSync(archivePath, "changed");

    await expect(inspectArchiveSource({
      archivePath,
      expectedChecksum: initial.archiveChecksum,
      expectedSize: initial.archiveSize
    })).rejects.toMatchObject({ code: "source.archive_checksum_mismatch" });

    expect(DEFAULT_ARCHIVE_SOURCE_INVENTORY_LIMITS.maxArchiveBytes).toBe(100 * 1024 * 1024);
  });
});

interface ArchiveEntryFixture {
  readonly name: string;
  readonly data: Buffer;
}

async function writeArchive(entries: readonly ArchiveEntryFixture[]): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-archive-inventory-"));
  temporaryRoots.push(root);
  const archivePath = path.join(root, "source.zip");
  const zip = new ZipFile();
  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      zip.addEmptyDirectory(entry.name.slice(0, -1), {
        mtime: new Date("2026-07-09T12:00:00.000Z"),
        mode: 0o40755
      });
    } else {
      zip.addBuffer(entry.data, entry.name, {
        compress: true,
        mtime: new Date("2026-07-09T12:00:00.000Z"),
        mode: 0o100644
      });
    }
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  fs.writeFileSync(archivePath, Buffer.concat(chunks));
  return archivePath;
}

function rewriteZipEntryName(archivePath: string, replacement: string): void {
  const bytes = fs.readFileSync(archivePath);
  let replacements = 0;
  for (const signature of [0x04034b50, 0x02014b50]) {
    const offset = findSignature(bytes, signature);
    const nameLengthOffset = signature === 0x04034b50 ? offset + 26 : offset + 28;
    const nameOffset = signature === 0x04034b50 ? offset + 30 : offset + 46;
    const nameLength = bytes.readUInt16LE(nameLengthOffset);
    if (nameLength !== replacement.length) throw new Error("Fixture replacement must preserve ZIP name length.");
    bytes.write(replacement, nameOffset, nameLength, "utf8");
    replacements += 1;
  }
  if (replacements !== 2) throw new Error("ZIP fixture did not contain both entry headers.");
  fs.writeFileSync(archivePath, bytes);
}

function findSignature(bytes: Buffer, signature: number): number {
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (bytes.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error(`Missing ZIP signature ${signature.toString(16)}.`);
}

function findFile(root: string, suffix: string): string {
  const found = findFiles(root, suffix)[0];
  if (!found) throw new Error(`Missing file ending with ${suffix}`);
  return found;
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) return findFiles(candidate, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [candidate] : [];
  });
}
