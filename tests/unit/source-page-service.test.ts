import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { ingressSnapshotService } from "../../apps/desktop/src/main/services/ingress-snapshot-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { SourcePageService } from "../../apps/desktop/src/main/services/source-page-service";
import {
  createVaultOnDisk,
  loadVaultSummary,
  readVaultManifest
} from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("source page service", () => {
  it("recovers a completed page write after a crash before checksum finalization", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-page-test-"));
    tempRoots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Source Pages",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-10T12:00:00.000Z")
    });
    const vaultPath = path.join(root, "Source Pages");
    const vault = loadVaultSummary(vaultPath);
    const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
    const capture = new LegacyCaptureFixture(vaultPort, vaultPath);
    const jobs = new JobsService(vaultPort);
    const captured = capture.submitText({
      text: "Initial source text.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });

    const sourceRecordFile = findFile(path.join(vaultPath, ".pige", "source-records"), `${captured.sourceId}.json`);
    const sourceRecordPath = path.relative(vaultPath, sourceRecordFile).split(path.sep).join("/");
    const sourceRecord = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordFile, "utf8")));
    const initialSourcePage = fs.readFileSync(path.join(vaultPath, requireValue(sourceRecord.knowledgePagePath)), "utf8");
    expect(initialSourcePage).toContain(`source_record_updated_at: ${JSON.stringify(sourceRecord.updatedAt)}`);
    const artifactPath = `artifacts/extracted-text/2026/07/${captured.sourceId}.txt`;
    const absoluteArtifactPath = path.join(vaultPath, ...artifactPath.split("/"));
    fs.mkdirSync(path.dirname(absoluteArtifactPath), { recursive: true });
    fs.writeFileSync(absoluteArtifactPath, "Recovered parser text that should appear after restart.\n", "utf8");
    const parseReadyRecord = SourceRecordSchema.parse({
      ...sourceRecord,
      artifacts: [{ id: "art_refresh_test", kind: "extracted_text", path: artifactPath }],
      metadata: { ...sourceRecord.metadata, parserStatus: "parsed" },
      updatedAt: "2026-07-10T12:05:00.000Z"
    });

    const originalRename = fs.renameSync.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      renameCount += 1;
      if (renameCount === 3) throw new Error("simulated crash before final source-record rename");
      originalRename(oldPath, newPath);
    });
    const crashError = captureError(() => new SourcePageService().refreshForSource(
      vaultPath,
      parseReadyRecord,
      sourceRecordPath,
      "job_20260710_refresh12",
      sourceRecord
    ));
    expect(crashError).toMatchObject({ code: "vault.write_failed" });
    vi.restoreAllMocks();

    const pendingRecord = readSourceRecord(sourceRecordFile);
    expect(pendingRecord.metadata.sourcePageRefreshPending).toBeTypeOf("object");
    const recovered = new SourcePageService().refreshForSource(
      vaultPath,
      pendingRecord,
      sourceRecordPath,
      "job_20260710_refresh12"
    );
    const finalRecord = readSourceRecord(sourceRecordFile);
    const sourcePage = fs.readFileSync(path.join(vaultPath, requireValue(finalRecord.knowledgePagePath)), "utf8");

    expect(recovered).toMatchObject({ updated: true, conflict: false });
    expect(finalRecord.metadata.sourcePageRefreshPending).toBeUndefined();
    expect(finalRecord.metadata.sourcePageRefreshConflict).toBe(false);
    expect(finalRecord.metadata.knowledgePageChecksum).toBe(checksum(sourcePage));
    expect(sourcePage).toContain("Recovered parser text that should appear after restart.");
    expect(sourcePage).toContain("source_record_schema_version: 1");
    expect(sourcePage).toContain(`source_record_updated_at: ${JSON.stringify(finalRecord.updatedAt)}`);
    expect(sourcePage).toContain('artifact_ids: ["art_refresh_test"]');
    expect(sourcePage).toContain("extracted_text artifact: `art_refresh_test`");
    expect(sourcePage).not.toContain("managed_copy_path:");
    expect(sourcePage).not.toContain("artifact_paths:");
    expect(sourcePage).not.toContain("- Managed copy:");
    expect(sourcePage).not.toContain(artifactPath);
  });

  it.skipIf(process.platform === "win32")("rejects a source-page parent symlink without writing outside the vault", () => {
    const fixture = makeTextFixture(false);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-page-outside-"));
    tempRoots.push(outside);
    fs.symlinkSync(outside, path.join(fixture.vaultPath, "sources", "text"), "dir");

    const caught = captureError(() => new SourcePageService().createForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.jobId
    ));

    expect(caught).toMatchObject({ code: "vault.path_unsafe" });
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(readSourceRecord(fixture.sourceRecordFile).knowledgePagePath).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("rejects a source-page symlink target without modifying its external file", () => {
    const fixture = makeTextFixture(true);
    const pagePath = path.join(fixture.vaultPath, requireValue(fixture.sourceRecord.knowledgePagePath));
    const outside = path.join(path.dirname(fixture.vaultPath), "outside-page.md");
    fs.writeFileSync(outside, "# External file\n", "utf8");
    fs.rmSync(pagePath);
    fs.symlinkSync(outside, pagePath, "file");

    const caught = captureError(() => new SourcePageService().refreshForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.jobId
    ));

    expect(caught).toMatchObject({ code: "vault.path_unsafe" });
    expect(fs.readFileSync(outside, "utf8")).toBe("# External file\n");
  });

  it("preserves a user edit that lands after the pending Source Record commit", () => {
    const fixture = makeTextFixture(true);
    const pagePath = path.join(fixture.vaultPath, requireValue(fixture.sourceRecord.knowledgePagePath));
    const parseReadyRecord = addExtractedText(fixture, "Parser text that should not replace a concurrent user edit.\n");
    const userEdit = "# User-owned source page edit\n\nKeep this body.\n";
    const originalRename = fs.renameSync.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      originalRename(oldPath, newPath);
      renameCount += 1;
      if (renameCount === 1) fs.writeFileSync(pagePath, userEdit, "utf8");
    });

    const caught = captureError(() => new SourcePageService().refreshForSource(
      fixture.vaultPath,
      parseReadyRecord,
      fixture.sourceRecordPath,
      fixture.jobId,
      fixture.sourceRecord
    ));
    vi.restoreAllMocks();

    expect(caught).toMatchObject({ code: "source_page.target_changed" });
    expect(fs.readFileSync(pagePath, "utf8")).toBe(userEdit);
    const pendingRecord = readSourceRecord(fixture.sourceRecordFile);
    expect(pendingRecord.metadata.sourcePageRefreshPending).toBeTypeOf("object");

    const recovered = new SourcePageService().refreshForSource(
      fixture.vaultPath,
      pendingRecord,
      fixture.sourceRecordPath,
      fixture.jobId
    );
    const finalRecord = readSourceRecord(fixture.sourceRecordFile);
    expect(recovered).toMatchObject({ updated: false, conflict: true });
    expect(finalRecord.metadata.sourcePageRefreshPending).toBeUndefined();
    expect(finalRecord.metadata.sourcePageRefreshConflict).toBe(true);
    expect(fs.readFileSync(pagePath, "utf8")).toBe(userEdit);
  });

  it("preserves a newer Source Record revision detected before pending replacement", () => {
    const fixture = makeTextFixture(true);
    const pagePath = path.join(fixture.vaultPath, requireValue(fixture.sourceRecord.knowledgePagePath));
    const originalPage = fs.readFileSync(pagePath, "utf8");
    const parseReadyRecord = addExtractedText(fixture, "Parser text for a Source Record race.\n");
    const concurrentRecord = SourceRecordSchema.parse({
      ...fixture.sourceRecord,
      metadata: { ...fixture.sourceRecord.metadata, title: "Concurrent durable update" },
      updatedAt: "2026-07-10T12:09:00.000Z"
    });
    const originalFsync = fs.fsyncSync.bind(fs);
    let injected = false;
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      originalFsync(descriptor);
      if (!injected) {
        injected = true;
        fs.writeFileSync(fixture.sourceRecordFile, `${JSON.stringify(concurrentRecord, null, 2)}\n`, "utf8");
      }
    });

    const caught = captureError(() => new SourcePageService().refreshForSource(
      fixture.vaultPath,
      parseReadyRecord,
      fixture.sourceRecordPath,
      fixture.jobId,
      fixture.sourceRecord
    ));
    vi.restoreAllMocks();

    expect(caught).toMatchObject({ code: "source_record.target_changed" });
    expect(readSourceRecord(fixture.sourceRecordFile).metadata.title).toBe("Concurrent durable update");
    expect(fs.readFileSync(pagePath, "utf8")).toBe(originalPage);
    expect(readSourceRecord(fixture.sourceRecordFile).metadata.sourcePageRefreshPending).toBeUndefined();
  });

  it("rejects a stale Source Record baseline before source-page projection begins", () => {
    const fixture = makeTextFixture(true);
    const pagePath = path.join(fixture.vaultPath, requireValue(fixture.sourceRecord.knowledgePagePath));
    const originalPage = fs.readFileSync(pagePath, "utf8");
    const parseReadyRecord = addExtractedText(fixture, "Parser text based on a stale Source Record.\n");
    const concurrentRecord = SourceRecordSchema.parse({
      ...fixture.sourceRecord,
      metadata: { ...fixture.sourceRecord.metadata, title: "Already committed elsewhere" },
      updatedAt: "2026-07-10T12:08:00.000Z"
    });
    fs.writeFileSync(fixture.sourceRecordFile, `${JSON.stringify(concurrentRecord, null, 2)}\n`, "utf8");

    const caught = captureError(() => new SourcePageService().refreshForSource(
      fixture.vaultPath,
      parseReadyRecord,
      fixture.sourceRecordPath,
      fixture.jobId,
      fixture.sourceRecord
    ));

    expect(caught).toMatchObject({ code: "source_record.target_changed" });
    expect(readSourceRecord(fixture.sourceRecordFile).metadata.title).toBe("Already committed elsewhere");
    expect(fs.readFileSync(pagePath, "utf8")).toBe(originalPage);
  });

  it("accepts an absolute Source Record path only inside the vault Source Record root", () => {
    const fixture = makeTextFixture(false);
    const result = new SourcePageService().createForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordFile,
      fixture.jobId
    );
    const sourcePage = fs.readFileSync(path.join(fixture.vaultPath, result.pagePath), "utf8");

    expect(result.created).toBe(true);
    expect(sourcePage).toContain(`source_record_path: ${JSON.stringify(fixture.sourceRecordPath)}`);
    expect(sourcePage).not.toContain(fixture.vaultPath);
  });

  it("rejects an absolute Source Record path outside the vault Source Record root", () => {
    const fixture = makeTextFixture(false);
    const outsideRecord = path.join(path.dirname(fixture.vaultPath), "outside-source-record.json");
    fs.writeFileSync(outsideRecord, `${JSON.stringify(fixture.sourceRecord, null, 2)}\n`, "utf8");

    const caught = captureError(() => new SourcePageService().createForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      outsideRecord,
      fixture.jobId
    ));

    expect(caught).toMatchObject({ code: "vault.path_unsafe" });
    expect(readSourceRecord(fixture.sourceRecordFile).knowledgePagePath).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked extracted-text preview without leaking external text", () => {
    const fixture = makeTextFixture(true);
    const outsideText = path.join(path.dirname(fixture.vaultPath), "outside-preview.txt");
    fs.writeFileSync(outsideText, "PRIVATE OUTSIDE TEXT\n", "utf8");
    const parseReadyRecord = addExtractedText(fixture, "placeholder\n");
    const artifactPath = requireValue(parseReadyRecord.artifacts[0]?.path);
    const absoluteArtifactPath = path.join(fixture.vaultPath, ...artifactPath.split("/"));
    fs.rmSync(absoluteArtifactPath);
    fs.symlinkSync(outsideText, absoluteArtifactPath, "file");

    const caught = captureError(() => new SourcePageService().refreshForSource(
      fixture.vaultPath,
      parseReadyRecord,
      fixture.sourceRecordPath,
      fixture.jobId,
      fixture.sourceRecord
    ));

    expect(caught).toMatchObject({ code: "vault.path_unsafe" });
    const page = fs.readFileSync(
      path.join(fixture.vaultPath, requireValue(fixture.sourceRecord.knowledgePagePath)),
      "utf8"
    );
    expect(page).not.toContain("PRIVATE OUTSIDE TEXT");
  });

  it("renders managed local-file preview from snapshot authority and fails closed when it is missing or tampered", async () => {
    const fixture = await makeAgentFileFixture("snapshot preview authority");
    fs.chmodSync(fixture.managedPath, 0o600);
    fs.writeFileSync(fixture.managedPath, "tampered managed copy", "utf8");

    const created = new SourcePageService().createForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.jobId
    );
    const page = fs.readFileSync(path.join(fixture.vaultPath, created.pagePath), "utf8");
    expect(page).toContain("snapshot preview authority");
    expect(page).not.toContain("tampered managed copy");

    const missing = await makeAgentFileFixture("missing descriptor");
    fs.rmSync(path.join(missing.vaultPath, ".pige", "private", "ingress-snapshots"), { recursive: true });
    expect(captureError(() => new SourcePageService().createForSource(
      missing.vaultPath,
      missing.sourceRecord,
      missing.sourceRecordPath,
      missing.jobId
    ))).toMatchObject({ code: "ingress_snapshot.not_found" });

    const tampered = await makeAgentFileFixture("tampered descriptor");
    const snapshotFile = findFile(
      path.join(tampered.vaultPath, ".pige", "private", "ingress-snapshots"),
      "snapshot.txt"
    );
    fs.chmodSync(snapshotFile, 0o600);
    fs.writeFileSync(snapshotFile, "descriptor mismatch", "utf8");
    expect(captureError(() => new SourcePageService().createForSource(
      tampered.vaultPath,
      tampered.sourceRecord,
      tampered.sourceRecordPath,
      tampered.jobId
    ))).toMatchObject({ code: "ingress_snapshot.descriptor_mismatch" });
  });

  it("keeps extracted-text artifact preview independent from a missing ingress descriptor", async () => {
    const fixture = await makeAgentFileFixture("managed body must not win");
    const artifactRecord = addExtractedText(fixture, "artifact preview remains authoritative\n");
    fs.rmSync(path.join(fixture.vaultPath, ".pige", "private", "ingress-snapshots"), { recursive: true });

    const created = new SourcePageService().createForSource(
      fixture.vaultPath,
      artifactRecord,
      fixture.sourceRecordPath,
      fixture.jobId,
      fixture.sourceRecord
    );
    const page = fs.readFileSync(path.join(fixture.vaultPath, created.pagePath), "utf8");
    expect(page).toContain("artifact preview remains authoritative");
    expect(page).not.toContain("managed body must not win");
  });

  it("preserves a pre-existing Markdown page and marks the projection conflicted", () => {
    const fixture = makeTextFixture(false);
    const pagePath = path.join(
      fixture.vaultPath,
      "sources",
      "text",
      "2026",
      `${fixture.sourceRecord.id}.md`
    );
    const userPage = "# Existing user page\n\nDo not adopt this as generated output.\n";
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, userPage, "utf8");

    const result = new SourcePageService().createForSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.jobId
    );
    const finalRecord = readSourceRecord(fixture.sourceRecordFile);

    expect(result.created).toBe(false);
    expect(fs.readFileSync(pagePath, "utf8")).toBe(userPage);
    expect(finalRecord.metadata.sourcePageRefreshConflict).toBe(true);
    expect(finalRecord.metadata.knowledgePageChecksum).toBeUndefined();
  });

  it("gates new, pending-recovery, existing-adoption, and conflict projections before their first write", () => {
    const service = new SourcePageService();
    const checkpoints: string[] = [];
    const blockPublication = (name: string): (() => void) => () => {
      checkpoints.push(name);
      throw new Error(`blocked ${name}`);
    };

    const fresh = makeTextFixture(false);
    const freshRecordBefore = fs.readFileSync(fresh.sourceRecordFile, "utf8");
    const freshPagePath = expectedTextPagePath(fresh);
    expect(() => service.createForSource(
      fresh.vaultPath,
      fresh.sourceRecord,
      fresh.sourceRecordPath,
      fresh.jobId,
      fresh.sourceRecord,
      { onPublicationStart: blockPublication("new") }
    )).toThrow("blocked new");
    expect(fs.readFileSync(fresh.sourceRecordFile, "utf8")).toBe(freshRecordBefore);
    expect(fs.existsSync(freshPagePath)).toBe(false);

    const pending = makeTextFixture(true);
    const pendingPagePath = path.join(pending.vaultPath, requireValue(pending.sourceRecord.knowledgePagePath));
    const pendingPageBefore = fs.readFileSync(pendingPagePath, "utf8");
    const pendingRecord = SourceRecordSchema.parse({
      ...pending.sourceRecord,
      metadata: {
        ...pending.sourceRecord.metadata,
        sourcePageRefreshPending: {
          targetChecksum: checksum(pendingPageBefore),
          updatedAt: "2026-07-10T12:10:00.000Z",
          jobId: pending.jobId
        }
      },
      updatedAt: "2026-07-10T12:10:00.000Z"
    });
    fs.writeFileSync(pending.sourceRecordFile, `${JSON.stringify(pendingRecord, null, 2)}\n`, "utf8");
    const pendingRecordBefore = fs.readFileSync(pending.sourceRecordFile, "utf8");
    expect(() => service.createForSource(
      pending.vaultPath,
      pendingRecord,
      pending.sourceRecordPath,
      pending.jobId,
      pendingRecord,
      { onPublicationStart: blockPublication("pending") }
    )).toThrow("blocked pending");
    expect(fs.readFileSync(pending.sourceRecordFile, "utf8")).toBe(pendingRecordBefore);
    expect(fs.readFileSync(pendingPagePath, "utf8")).toBe(pendingPageBefore);

    const existing = makeTextFixture(true);
    const existingPagePath = path.join(existing.vaultPath, requireValue(existing.sourceRecord.knowledgePagePath));
    const existingRecordBefore = fs.readFileSync(existing.sourceRecordFile, "utf8");
    const existingPageBefore = fs.readFileSync(existingPagePath, "utf8");
    expect(() => service.createForSource(
      existing.vaultPath,
      existing.sourceRecord,
      existing.sourceRecordPath,
      existing.jobId,
      existing.sourceRecord,
      { onPublicationStart: blockPublication("existing") }
    )).toThrow("blocked existing");
    expect(fs.readFileSync(existing.sourceRecordFile, "utf8")).toBe(existingRecordBefore);
    expect(fs.readFileSync(existingPagePath, "utf8")).toBe(existingPageBefore);

    const conflict = makeTextFixture(false);
    const conflictPagePath = expectedTextPagePath(conflict);
    const userPage = "# Existing user page\n\nKeep this page.\n";
    fs.mkdirSync(path.dirname(conflictPagePath), { recursive: true });
    fs.writeFileSync(conflictPagePath, userPage, "utf8");
    const conflictRecordBefore = fs.readFileSync(conflict.sourceRecordFile, "utf8");
    expect(() => service.createForSource(
      conflict.vaultPath,
      conflict.sourceRecord,
      conflict.sourceRecordPath,
      conflict.jobId,
      conflict.sourceRecord,
      { onPublicationStart: blockPublication("conflict") }
    )).toThrow("blocked conflict");
    expect(fs.readFileSync(conflict.sourceRecordFile, "utf8")).toBe(conflictRecordBefore);
    expect(fs.readFileSync(conflictPagePath, "utf8")).toBe(userPage);
    expect(checkpoints).toEqual(["new", "pending", "existing", "conflict"]);
  });
});

function expectedTextPagePath(fixture: {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
}): string {
  return path.join(
    fixture.vaultPath,
    "sources",
    "text",
    "2026",
    `${fixture.sourceRecord.id}.md`
  );
}

function makeTextFixture(processCapture: boolean): {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly sourceRecordFile: string;
  readonly jobId: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-page-fixture-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Source Fixture",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Source Fixture");
  const vault = loadVaultSummary(vaultPath);
  const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
  const captured = new LegacyCaptureFixture(vaultPort, vaultPath).submitText({
    text: "Initial source text.",
    inputKind: "typed_text",
    userIntent: "capture",
    locale: "en"
  });
  if (processCapture) new JobsService(vaultPort).processQueuedCaptures({ jobIds: [captured.jobId] });
  const sourceRecordFile = findFile(path.join(vaultPath, ".pige", "source-records"), `${captured.sourceId}.json`);
  const sourceRecordPath = path.relative(vaultPath, sourceRecordFile).split(path.sep).join("/");
  return {
    vaultPath,
    sourceRecord: readSourceRecord(sourceRecordFile),
    sourceRecordPath,
    sourceRecordFile,
    jobId: captured.jobId
  };
}

function addExtractedText(
  fixture: {
    readonly vaultPath: string;
    readonly sourceRecord: SourceRecord;
  },
  text: string
): SourceRecord {
  const artifactPath = `artifacts/extracted-text/2026/07/${fixture.sourceRecord.id}.txt`;
  const absoluteArtifactPath = path.join(fixture.vaultPath, ...artifactPath.split("/"));
  fs.mkdirSync(path.dirname(absoluteArtifactPath), { recursive: true });
  fs.writeFileSync(absoluteArtifactPath, text, "utf8");
  return SourceRecordSchema.parse({
    ...fixture.sourceRecord,
    artifacts: [{ id: `art_${fixture.sourceRecord.id.slice(4)}_refresh`, kind: "extracted_text", path: artifactPath }],
    metadata: { ...fixture.sourceRecord.metadata, parserStatus: "parsed" },
    updatedAt: "2026-07-10T12:05:00.000Z"
  });
}

async function makeAgentFileFixture(body: string): Promise<{
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly sourceRecordFile: string;
  readonly jobId: string;
  readonly managedPath: string;
}> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-page-ingress-")));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Ingress Page Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-27T10:00:00.000Z")
  });
  const vaultPath = path.join(root, "Ingress Page Vault");
  const originalPath = path.join(root, "accepted.txt");
  fs.writeFileSync(originalPath, body, "utf8");
  const stat = fs.lstatSync(originalPath);
  const jobId = "job_20260727_sourcepage01";
  const sourceId = "src_20260727_sourcepage01";
  const binding = {
    vaultId: readVaultManifest(vaultPath).vault_id,
    parentJobId: jobId,
    sourceId,
    ordinal: 0
  } as const;
  const descriptor = await ingressSnapshotService.createOrAdopt({
    vaultPath,
    ...binding,
    sourcePath: originalPath,
    checksum: checksum(body) as `sha256:${string}`,
    size: stat.size,
    noFollowIdentity: {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
      changedAtMs: stat.ctimeMs
    }
  });
  const managedRoot = path.join(vaultPath, "raw", "files");
  fs.mkdirSync(managedRoot, { recursive: true });
  const managedPath = path.join(managedRoot, `${sourceId}.txt`);
  const adopted = await ingressSnapshotService.promoteManagedCopy({
    vaultPath,
    binding,
    managedRoot,
    destinationPath: managedPath
  });
  const sourceRecordPath = `.pige/source-records/2026/07/${sourceId}.json`;
  const sourceRecordFile = path.join(vaultPath, ...sourceRecordPath.split("/"));
  const sourceRecord = SourceRecordSchema.parse({
    id: sourceId,
    kind: "plain_text_file",
    storageStrategy: "copy_to_source_library",
    semanticOrchestration: "agent_turn",
    original: {
      uri: `file://${originalPath}`,
      path: originalPath,
      displayName: "accepted.txt",
      lastKnownMtime: new Date(stat.mtimeMs).toISOString(),
      lastKnownSize: adopted.size,
      checksum: adopted.checksum
    },
    managedCopy: {
      path: path.relative(vaultPath, managedPath).split(path.sep).join("/"),
      checksum: adopted.checksum,
      size: adopted.size
    },
    artifacts: [],
    metadata: {
      agentTurnJobId: jobId,
      agentTurnAttachmentOrdinal: 0,
      parserStatus: "text_ready"
    },
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:00:00.000Z"
  });
  fs.mkdirSync(path.dirname(sourceRecordFile), { recursive: true });
  fs.writeFileSync(sourceRecordFile, `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
  expect(descriptor.sourceId).toBe(sourceId);
  return { vaultPath, sourceRecord, sourceRecordPath, sourceRecordFile, jobId, managedPath };
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected action to throw.");
}

function readSourceRecord(filePath: string): SourceRecord {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function checksum(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      try {
        return findFile(fullPath, suffix);
      } catch {
        // Continue searching sibling directories.
      }
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) return fullPath;
  }
  throw new Error(`Missing file ending with ${suffix}`);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
