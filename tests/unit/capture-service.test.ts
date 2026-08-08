import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureService,
  type AgentTurnFilePreservationBinding,
  type AgentTurnUrlPreservationBinding,
  type SourceFetchPort
} from "../../apps/desktop/src/main/services/capture-service";
import {
  createVaultOnDisk,
  loadVaultSummary,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";
import { verifyReadableSourceFile } from "../../apps/desktop/src/main/services/source-file-access";
import type { SourceRecord } from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import { HomeAgentAttachmentService } from "../../apps/desktop/src/main/services/home-agent-attachment-service";
import { ingressSnapshotService } from "../../apps/desktop/src/main/services/ingress-snapshot-service";
import { ManagedCopyRootService } from "../../apps/desktop/src/main/services/managed-copy-root-service";
import { configureManagedCopyLocatorResolver } from "../../apps/desktop/src/main/services/source-file-access";

const tempRoots: string[] = [];
let bindingSequence = 0;

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-capture-test-")));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Capture",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Capture");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeService(vaultPath: string, vault: VaultSummary, sourceFetch?: SourceFetchPort): CaptureService {
  return new CaptureService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, sourceFetch);
}

function nextFileBinding(): AgentTurnFilePreservationBinding {
  bindingSequence += 1;
  const suffix = `binding${String(bindingSequence).padStart(3, "0")}`;
  return {
    jobId: `job_20260722_${suffix}`,
    sourceId: `src_20260722_${suffix}`
  };
}

function urlBinding(url: string): AgentTurnUrlPreservationBinding {
  const suffix = "urlbinding01";
  return {
    jobId: `job_20260722_${suffix}`,
    sourceId: `src_20260722_${suffix}`,
    inputHash: `sha256:${createHash("sha256").update(url, "utf8").digest("hex")}`
  };
}

afterEach(() => {
  configureManagedCopyLocatorResolver(undefined);
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Agent-turn source preservation", () => {
  it("uses the selected external root only for future managed copies and retains old root identity", () => {
    const { vaultPath, vault } = makeVault();
    const userData = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-managed-root-user-")));
    const firstRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-managed-root-first-")));
    const secondRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-managed-root-second-")));
    tempRoots.push(userData, firstRoot, secondRoot);
    const owner = new ManagedCopyRootService(userData);
    owner.bindDefault({ vaultId: vault.vaultId, selectedDirectory: firstRoot });
    configureManagedCopyLocatorResolver({
      resolve: (vaultId, activeVaultPath, managedCopy) => owner.resolveManagedCopy(vaultId, activeVaultPath, managedCopy)
    });
    const externalVault: VaultSummary = {
      ...vault,
      sourceAssetRootKind: "external_binding",
      sourceAssetRootDisplay: path.basename(firstRoot),
      managedCopyRoot: owner.summary(vault.vaultId, "external_binding")
    };
    const service = new CaptureService({ current: () => externalVault, activeVaultPath: () => vaultPath }, undefined, owner);
    const firstText = "first external root";
    const firstBinding = {
      jobId: "job_20260729_externalroot1",
      sourceId: "src_20260729_externalroot1",
      inputChecksum: `sha256:${createHash("sha256").update(firstText).digest("hex")}`,
      ordinal: 0,
      attachmentSetHash: `sha256:${"1".repeat(64)}`
    };
    service.preserveTextForAgentTurn({ text: firstText, locale: "en" }, firstBinding);
    const firstRecord = readSourceRecord(vaultPath, firstBinding.sourceId);
    const firstRootId = firstRecord.managedCopy?.rootId;
    expect(firstRecord.managedCopy).toMatchObject({ pathBasis: "root_relative" });
    expect(fs.existsSync(path.join(firstRoot, firstRecord.managedCopy!.path))).toBe(true);

    owner.bindDefault({ vaultId: vault.vaultId, selectedDirectory: secondRoot });
    expect(verifyReadableSourceFile(vaultPath, firstRecord).absolutePath).toBe(
      path.join(firstRoot, firstRecord.managedCopy!.path)
    );
    expect(owner.selection(vault.vaultId)?.rootId).not.toBe(firstRootId);
    expect(readSourceRecord(vaultPath, firstBinding.sourceId).managedCopy?.rootId).toBe(firstRootId);
  });
  it("preserves exact pasted UTF-8 bytes once and adopts the same managed source on retry", () => {
    const { vaultPath, vault } = makeVault();
    const text = "  password=literal\napiKey: exact\n😀  ";
    const inputChecksum = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
    const binding = {
      jobId: "job_20260723_largepaste01",
      sourceId: "src_20260723_largepaste01",
      inputChecksum,
      ordinal: 0,
      attachmentSetHash: `sha256:${"a".repeat(64)}`
    };
    const service = makeService(vaultPath, vault);

    const first = service.preserveTextForAgentTurn({ text, locale: "en" }, binding);
    const retry = service.preserveTextForAgentTurn({ text, locale: "en" }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(retry).toEqual(first);
    expect(record).toMatchObject({
      id: binding.sourceId,
      kind: "text",
      storageStrategy: "copy_to_source_library",
      semanticOrchestration: "agent_turn",
      metadata: {
        agentTurnJobId: binding.jobId,
        agentTurnAttachmentOrdinal: 0,
        agentTurnAttachmentSetHash: binding.attachmentSetHash,
        unicodeCodePointCount: [...text].length,
        utf8ByteSize: Buffer.byteLength(text)
      }
    });
    expect(fs.readFileSync(path.join(vaultPath, record.managedCopy!.path), "utf8")).toBe(text);
    expect(JSON.stringify(record)).not.toContain(text);
  });

  it("adopts an exact ordered attachment set on retry without shadow durable records", async () => {
    const { vaultPath, vault } = makeVault();
    const inputRoot = path.dirname(vaultPath);
    const filePaths = ["one.md", "two.txt", "three.pdf"].map((name, index) => {
      const filePath = path.join(inputRoot, name);
      fs.writeFileSync(filePath, `attachment-${index}`, "utf8");
      return filePath;
    });
    const service = new HomeAgentAttachmentService(makeService(vaultPath, vault));
    const prepared = await service.prepare(filePaths.map((internalPath) => ({
      displayName: path.basename(internalPath),
      internalPath
    })));
    const request = {
      prepared,
      turn: { schemaVersion: 1 as const, inputKind: "file_picker" as const, locale: "en" as const },
      jobId: "job_20260722_multifile001",
      firstSourceId: "src_20260722_multifile001"
    };

    const first = await service.preserve(request);
    const retry = await service.preserve(request);

    expect(retry).toEqual(first);
    expect(first.sourceIds).toHaveLength(3);
    expect(first.sourceIds.map((sourceId) => readSourceRecord(vaultPath, sourceId))).toEqual(
      first.sourceIds.map((sourceId, ordinal) => expect.objectContaining({
        id: sourceId,
        metadata: expect.objectContaining({
          agentTurnJobId: request.jobId,
          agentTurnAttachmentOrdinal: ordinal,
          agentTurnAttachmentSetHash: prepared.attachmentSetHash
        })
      }))
    );
    expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
    expect(findFileOptional(path.join(vaultPath, ".pige/conversations"), ".jsonl")).toBeUndefined();
  });

  it("creates snapshots only after Send for accepted staged ordinals and never for rejected ordinals", async () => {
    const { vaultPath, vault } = makeVault();
    const inputRoot = path.dirname(vaultPath);
    const acceptedPath = path.join(inputRoot, "accepted.md");
    const rejectedPath = path.join(inputRoot, "rejected.exe");
    fs.writeFileSync(acceptedPath, "accepted source", "utf8");
    fs.writeFileSync(rejectedPath, "rejected source", "utf8");
    const attachments = new HomeAgentAttachmentService(makeService(vaultPath, vault));
    const stagedItems = [
      { kind: "file" as const, ordinal: 0, displayName: "rejected.exe" },
      { kind: "file" as const, ordinal: 1, displayName: "accepted.md" }
    ];
    const prepared = await attachments.prepare([
      { ordinal: 0, displayName: "rejected.exe", internalPath: rejectedPath },
      { ordinal: 1, displayName: "accepted.md", internalPath: acceptedPath }
    ], stagedItems);
    const binding = {
      jobId: "job_20260727_partition01",
      firstSourceId: "src_20260727_partition01"
    };

    expect(findFileOptional(path.join(vaultPath, ".pige/private/ingress-snapshots"), "descriptor.json"))
      .toBeUndefined();

    const preserved = await attachments.preserve({
      prepared,
      turn: { schemaVersion: 1, inputKind: "file_picker", locale: "en", stagedItems },
      ...binding
    });

    expect(preserved).toMatchObject({
      status: "preserved",
      sourceIds: [binding.firstSourceId]
    });
    expect(prepared.rejectedItems).toEqual([
      { ordinal: 0, kind: "file", displayName: "rejected.exe", reason: "unsupported_type" }
    ]);
    expect(findFiles(path.join(vaultPath, ".pige/private/ingress-snapshots"), "descriptor.json")).toHaveLength(1);
    expect(ingressSnapshotService.read(vaultPath, {
      vaultId: vault.vaultId,
      parentJobId: binding.jobId,
      sourceId: binding.firstSourceId,
      ordinal: 1
    })).toMatchObject({ sourceId: binding.firstSourceId, ordinal: 1 });
    expect(ingressSnapshotService.read(vaultPath, {
      vaultId: vault.vaultId,
      parentJobId: binding.jobId,
      sourceId: binding.firstSourceId,
      ordinal: 0
    })).toBeUndefined();
    expect(readSourceRecord(vaultPath, binding.firstSourceId).metadata.agentTurnAttachmentOrdinal).toBe(0);
  });

  it("removes an exact unpublished snapshot when a handled managed-copy publication fails", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "rejected-after-snapshot.md");
    fs.writeFileSync(sourcePath, "snapshot must not survive rejection", "utf8");
    const binding = {
      ...nextFileBinding(),
      ordinal: 0,
      attachmentSetHash: `sha256:${"c".repeat(64)}`
    };
    const promote = ingressSnapshotService.promoteManagedCopy.bind(ingressSnapshotService);
    vi.spyOn(ingressSnapshotService, "promoteManagedCopy").mockImplementationOnce(async (input) => {
      await promote(input);
      throw new Error("simulated post-promotion publication failure");
    });

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, binding);

    expect(result).toMatchObject({ status: "rejected", sourceIds: [], rejectedFiles: [{ reason: "copy_failed" }] });
    expect(findFileOptional(path.join(vaultPath, ".pige/private/ingress-snapshots"), "descriptor.json"))
      .toBeUndefined();
    expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), `${binding.sourceId}.json`))
      .toBeUndefined();
    expect(findFileOptional(path.join(vaultPath, "raw/files"), `${binding.sourceId}.md`))
      .toBeUndefined();
  });

  it("preserves a bound Markdown source without creating a shadow Job or conversation event", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "research-note.md");
    const body = "# Research Note\n\nA local-first knowledge file.";
    fs.writeFileSync(sourcePath, body, "utf8");
    const binding = nextFileBinding();

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, binding);

    const record = readSourceRecord(vaultPath, binding.sourceId);
    expect(result).toMatchObject({
      status: "queued",
      sourceIds: [binding.sourceId],
      jobIds: [],
      conversationEventIds: [],
      rejectedFiles: []
    });
    expect(record).toMatchObject({
      id: binding.sourceId,
      kind: "markdown_file",
      semanticOrchestration: "agent_turn",
      metadata: { agentTurnJobId: binding.jobId }
    });
    expect(fs.readFileSync(path.join(vaultPath, record.managedCopy?.path ?? ""), "utf8")).toBe(body);
    expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
    expect(findFileOptional(path.join(vaultPath, ".pige/conversations"), ".jsonl")).toBeUndefined();
  });

  it("requires one exact Agent-turn binding", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "one.md");
    fs.writeFileSync(sourcePath, "one", "utf8");

    await expect(makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath, sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    }, nextFileBinding())).rejects.toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
  });

  it("honors reference-original storage for new file captures without creating a managed copy", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "referenced-note.md");
    const body = "# Referenced\n\nRead in place.";
    fs.writeFileSync(sourcePath, body, "utf8");
    const binding = nextFileBinding();

    await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.original?.path).toBe(sourcePath);
    expect(verifyReadableSourceFile(vaultPath, record)).toMatchObject({
      absolutePath: sourcePath,
      location: "referenced_original",
      size: Buffer.byteLength(body)
    });
  });

  it("keeps reference-original provenance currentness separate from immutable snapshot reads", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "mutable-reference.md");
    const original = "# Original snapshot\n";
    fs.writeFileSync(sourcePath, original, "utf8");
    const binding = {
      jobId: "job_20260727_reference01",
      sourceId: "src_20260727_reference01",
      inputChecksum: digest(original),
      ordinal: 0,
      attachmentSetHash: `sha256:${"b".repeat(64)}`
    };

    await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const snapshotBinding = {
      vaultId: vault.vaultId,
      parentJobId: binding.jobId,
      sourceId: binding.sourceId,
      ordinal: binding.ordinal
    };
    const lease = ingressSnapshotService.acquireRead(vaultPath, snapshotBinding);
    fs.writeFileSync(sourcePath, "# Mutated live original\n", "utf8");

    expect(fs.readFileSync(lease.absolutePath, "utf8")).toBe(original);
    await expect(ingressSnapshotService.proveReferencedOriginalCurrent(vaultPath, snapshotBinding))
      .rejects.toMatchObject({ code: "ingress_snapshot.source_changed" });
    const record = readSourceRecord(vaultPath, binding.sourceId);
    expect(record).toMatchObject({
      storageStrategy: "reference_original",
      original: { checksum: digest(original), lastKnownSize: Buffer.byteLength(original) }
    });
    expect(record.managedCopy).toBeUndefined();
    lease.release();
  });

  it("adopts the immutable snapshot on retry without rereading a replaced original path", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "identity-bound.md");
    const displacedPath = path.join(path.dirname(vaultPath), "identity-bound-original.md");
    const body = "identity-bound bytes";
    fs.writeFileSync(sourcePath, body, "utf8");
    const binding = {
      jobId: "job_20260727_identity01",
      sourceId: "src_20260727_identity01",
      inputChecksum: digest(body),
      ordinal: 0,
      attachmentSetHash: `sha256:${"c".repeat(64)}`
    };
    const service = makeService(vaultPath, vault);
    const request = { filePaths: [sourcePath], inputKind: "file_picker" as const, userIntent: "capture" as const, locale: "en" as const };
    const first = await service.preserveFilesForAgentTurn(request, binding);
    fs.renameSync(sourcePath, displacedPath);
    fs.writeFileSync(sourcePath, body, "utf8");

    const retry = await service.preserveFilesForAgentTurn(request, binding);

    expect(first.sourceIds).toEqual([binding.sourceId]);
    expect(retry).toMatchObject({ status: "queued", sourceIds: [binding.sourceId], rejectedFiles: [] });
    expect(findFiles(path.join(vaultPath, ".pige/private/ingress-snapshots"), "descriptor.json")).toHaveLength(1);
    expect(findFiles(path.join(vaultPath, ".pige/source-records"), `${binding.sourceId}.json`)).toHaveLength(1);
    expect(findFiles(path.join(vaultPath, "raw/files"), `${binding.sourceId}.md`)).toHaveLength(1);
  });

  it("publishes a restart-retained snapshot after the original path disappears", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "restart-retained.md");
    const body = "immutable restart bytes";
    fs.writeFileSync(sourcePath, body, "utf8");
    const stat = fs.lstatSync(sourcePath);
    const binding = {
      jobId: "job_20260727_restart01",
      sourceId: "src_20260727_restart01",
      inputChecksum: digest(body),
      ordinal: 0,
      attachmentSetHash: `sha256:${"d".repeat(64)}`
    };
    await ingressSnapshotService.createOrAdopt({
      vaultPath,
      vaultId: vault.vaultId,
      parentJobId: binding.jobId,
      sourceId: binding.sourceId,
      ordinal: binding.ordinal,
      sourcePath,
      checksum: digest(body),
      size: stat.size,
      noFollowIdentity: {
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        modifiedAtMs: stat.mtimeMs,
        changedAtMs: stat.ctimeMs
      }
    });
    fs.rmSync(sourcePath);

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(result).toMatchObject({ status: "queued", sourceIds: [binding.sourceId], rejectedFiles: [] });
    expect(fs.readFileSync(path.join(vaultPath, record.managedCopy!.path), "utf8")).toBe(body);
    expect(record.original).toMatchObject({ path: sourcePath, checksum: digest(body) });
  });

  it.each([
    ["paper.pdf", "pdf_file", "waiting_parser_or_ocr", true],
    ["records.csv", "csv_file", "waiting_agent_dataset_tool", false],
    ["archive.sqlite", "sqlite_file", "waiting_agent_dataset_tool", false],
    ["meeting.m4a", "audio_file", "waiting_media_transcription", false],
    ["clip.mp4", "video_file", "waiting_media_transcription", false]
  ] as const)("projects %s as a Pi-selectable typed source", async (name, kind, parserStatus, parserRequired) => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), name);
    fs.writeFileSync(sourcePath, name.endsWith(".sqlite") ? Buffer.from("SQLite format 3\0") : "fixture");
    const binding = nextFileBinding();

    await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(record.kind).toBe(kind);
    expect(record.metadata).toMatchObject({ parserStatus, parserRequired });
    if (!parserRequired && kind !== "audio_file" && kind !== "video_file") {
      expect(record.metadata.datasetToolAvailable).toBe(true);
    }
    if (kind === "audio_file" || kind === "video_file") {
      expect(record.metadata.mediaTranscriptionStatus).toBe("unavailable");
      expect(record.metadata.datasetToolAvailable).toBeUndefined();
    }
  });

  it.each(["-journal", "-wal", "-shm"])(
    "rejects a managed SQLite source with a live %s sidecar before durable writes",
    async (sidecarSuffix) => {
      const { vaultPath, vault } = makeVault();
      const sourcePath = path.join(path.dirname(vaultPath), "live.sqlite");
      fs.writeFileSync(sourcePath, Buffer.from("SQLite format 3\0"));
      fs.writeFileSync(`${sourcePath}${sidecarSuffix}`, "live-sidecar", "utf8");

      const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
        filePaths: [sourcePath],
        inputKind: "file_picker",
        userIntent: "capture",
        locale: "en"
      }, nextFileBinding());

      expect(result).toMatchObject({
        status: "rejected",
        sourceIds: [],
        jobIds: [],
        conversationEventIds: [],
        rejectedFiles: [{ displayName: "live.sqlite", reason: "copy_failed" }]
      });
      expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
    }
  );

  it("preserves a bound URL snapshot and extracted artifact without a shadow Job", async () => {
    const { vaultPath, vault } = makeVault();
    const url = "https://example.com/article";
    const binding = urlBinding(url);
    const service = makeService(vaultPath, vault, {
      fetchSnapshot: async () => ({
        originalUrl: url,
        finalUrl: url,
        contentType: "text/html",
        title: "Captured Web Page",
        rawContent: "<html><body><p>Readable web body.</p></body></html>",
        extractedText: "Readable web body.",
        warnings: ["instruction_like_source_text"]
      })
    });

    const result = await service.preserveUrlForAgentTurn({
      url,
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(result).toMatchObject({ sourceId: binding.sourceId, displayName: "Captured Web Page" });
    expect(record).toMatchObject({
      kind: "url",
      semanticOrchestration: "agent_turn",
      metadata: {
        agentTurnJobId: binding.jobId,
        agentTurnUrlInputHash: binding.inputHash
      }
    });
    const extracted = record.artifacts.find((artifact) => artifact.kind === "extracted_text");
    expect(fs.readFileSync(path.join(vaultPath, extracted?.path ?? ""), "utf8")).toBe("Readable web body.");
    expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
  });

  it("rejects unsupported files without creating a source record", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "archive.zip");
    fs.writeFileSync(sourcePath, "zip-placeholder", "utf8");

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, nextFileBinding());

    expect(result).toMatchObject({
      status: "rejected",
      sourceIds: [],
      rejectedFiles: [{ displayName: "archive.zip", reason: "unsupported_type" }]
    });
    expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
  });
});

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord {
  return JSON.parse(fs.readFileSync(
    findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`),
    "utf8"
  )) as SourceRecord;
}

function findFile(root: string, suffix: string): string {
  const found = findFileOptional(root, suffix);
  if (!found) throw new Error(`Missing file ending with ${suffix}`);
  return found;
}

function findFileOptional(root: string, suffix: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) return fullPath;
  }
  return undefined;
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findFiles(fullPath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [fullPath] : [];
  });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
