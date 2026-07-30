import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { SourceOriginalReconnectService } from "../../apps/desktop/src/main/services/source-original-reconnect-service";
import { SourceRefreshService } from "../../apps/desktop/src/main/services/source-refresh-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-reconnect-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-29T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "Vault");
  const vault = loadVaultSummary(vaultPath);
  const sourceId = "src_20260729_reconnectservice1";
  const body = Buffer.from("the exact original source\n", "utf8");
  const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const oldPath = path.join(root, "missing.txt");
  const record = SourceRecordSchema.parse({
    schemaVersion: 1,
    id: sourceId,
    kind: "plain_text_file",
    storageStrategy: "reference_original",
    semanticOrchestration: "agent_turn",
    original: {
      uri: "file:///private/old.txt",
      path: oldPath,
      displayName: "source.txt",
      lastKnownSize: body.byteLength,
      checksum
    },
    artifacts: [],
    metadata: {},
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z"
  });
  const recordPath = path.join(vaultPath, ".pige/source-records/2026/07", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const service = new SourceOriginalReconnectService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, () => new Date("2026-07-31T08:00:00.000Z"));
  return { root, vaultPath, vault, sourceId, body, oldPath, recordPath, service };
}

describe("source original reconnect service", () => {
  it("atomically rebinds only the exact matching regular file", async () => {
    const value = fixture();
    const replacement = path.join(value.root, "replacement.txt");
    fs.writeFileSync(replacement, value.body);
    const proof = value.service.candidate(value.vault.vaultId, value.sourceId);
    if (!proof) throw new Error("Expected one unavailable referenced source.");

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_abcdefghijklmnop",
      ...proof
    }, replacement)).resolves.toMatchObject({ status: "reconnected", operationId: expect.any(String) });

    const committed = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(value.recordPath, "utf8")));
    expect(committed.original).toMatchObject({
      path: fs.realpathSync.native(replacement),
      lastKnownSize: value.body.byteLength
    });
    expect(committed.original?.uri).toMatch(/^file:/);
    expect(value.service.candidate(value.vault.vaultId, value.sourceId)).toBeUndefined();
    const restarted = new SourceOriginalReconnectService({
      current: () => value.vault,
      activeVaultPath: () => value.vaultPath
    });
    expect(restarted.listUnavailable(value.vault.vaultId).sources).toEqual([]);
    const operations = fs.readdirSync(path.join(value.vaultPath, ".pige/operations/2026/07"));
    expect(operations).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(value.vaultPath, ".pige/operations/2026/07", operations[0]!), "utf8")))
      .toMatchObject({ kind: "relink_source", targetRefs: [{ kind: "source", id: value.sourceId }] });
  });

  it("leaves the Source Record unchanged for mismatch, symlink, or stale vault", async () => {
    const value = fixture();
    const before = fs.readFileSync(value.recordPath, "utf8");
    const wrong = path.join(value.root, "wrong.txt");
    fs.writeFileSync(wrong, "different body\n", "utf8");
    const link = path.join(value.root, "linked.txt");
    fs.symlinkSync(wrong, link);
    const wrongFormat = path.join(value.root, "wrong.md");
    fs.writeFileSync(wrongFormat, value.body);
    const proof = value.service.candidate(value.vault.vaultId, value.sourceId);
    if (!proof) throw new Error("Expected repair proof.");

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_wrongabcdefghijkl",
      ...proof
    }, wrong)).resolves.toEqual({ status: "mismatch" });
    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_linkabcdefghijklmn",
      ...proof
    }, link)).resolves.toEqual({ status: "failed" });
    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_formatabcdefghijk",
      ...proof
    }, wrongFormat)).resolves.toEqual({ status: "mismatch" });
    await expect(value.service.reconnect({
      activeVaultId: "vault_20260729_changedidentity",
      requestId: "sourcereconnectdirect_vaultabcdefghijklm",
      ...proof
    }, wrong)).resolves.toEqual({ status: "stale" });
    expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before);
  });

  it("previews changed content safely and publishes it only after confirmation through source refresh", async () => {
    const value = fixture();
    const replacement = path.join(value.root, "replacement.txt");
    const changedBody = Buffer.from("a genuinely changed source revision\n", "utf8");
    fs.writeFileSync(replacement, changedBody);
    const refresh = new SourceRefreshService({
      current: () => value.vault,
      activeVaultPath: () => value.vaultPath
    }, { canParse: () => false, parseSource: async () => { throw new Error("not used for text"); } });
    const service = new SourceOriginalReconnectService({
      current: () => value.vault,
      activeVaultPath: () => value.vaultPath
    }, () => new Date("2026-07-31T08:00:00.000Z"), refresh);
    const proof = service.candidate(value.vault.vaultId, value.sourceId);
    if (!proof) throw new Error("Expected repair proof.");
    const before = fs.readFileSync(value.recordPath, "utf8");

    const preview = await service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_changedpreview1",
      ...proof
    }, replacement);
    expect(preview).toMatchObject({
      status: "changed",
      preview: { displayName: "source.txt", previousSize: value.body.byteLength, currentSize: changedBody.byteLength }
    });
    expect(JSON.stringify(preview)).not.toContain(replacement);
    expect(JSON.stringify(preview)).not.toContain(changedBody.toString("utf8"));
    expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before);
    expect(listJsonFiles(path.join(value.vaultPath, ".pige", "jobs"))).toEqual([]);
    if (preview.status !== "changed") throw new Error("Expected changed preview.");

    const result = await service.confirmChanged({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_changedconfirm1",
      ...proof,
      previewId: preview.preview.previewId
    });
    expect(result).toMatchObject({ status: "reconnected", contentState: "changed", operationId: expect.any(String) });
    const committed = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(value.recordPath, "utf8")));
    expect(committed.original).toMatchObject({
      path: fs.realpathSync.native(replacement),
      checksum: `sha256:${createHash("sha256").update(changedBody).digest("hex")}`,
      lastKnownSize: changedBody.byteLength
    });
    expect(fs.readFileSync(path.join(value.vaultPath, committed.knowledgePagePath!), "utf8"))
      .toContain("a genuinely changed source revision");
    const operations = listJsonFiles(path.join(value.vaultPath, ".pige", "operations"))
      .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as { kind: string });
    expect(operations.map((operation) => operation.kind).sort()).toEqual(["relink_source", "update_source_record"]);
    expect(listJsonFiles(path.join(value.vaultPath, ".pige", "jobs"))).toHaveLength(1);
    expect(refresh.recoverIncompleteOperations()).toMatchObject({
      recovered: 0, failed: 0, relinkedSourceIds: [value.sourceId]
    });
    expect(service.candidate(value.vault.vaultId, value.sourceId)).toBeUndefined();
  });

  it("removes its private receipt when the bound owner becomes stale after selection", async () => {
    const value = fixture();
    const replacement = path.join(value.root, "replacement.txt");
    fs.writeFileSync(replacement, value.body);
    const before = fs.readFileSync(value.recordPath, "utf8");
    const proof = value.service.candidate(value.vault.vaultId, value.sourceId);
    if (!proof) throw new Error("Expected repair proof.");
    let checks = 0;

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_staleafterpicker",
      ...proof
    }, replacement, () => ++checks < 2)).resolves.toEqual({ status: "stale" });
    expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before);
    expect(fs.readdirSync(path.join(value.vaultPath, ".pige/private/source-reconnect-receipts"))).toEqual([]);
  });

  it("never offers a referenced original that is still exactly available", () => {
    const value = fixture();
    fs.writeFileSync(value.oldPath, value.body);
    expect(value.service.candidate(value.vault.vaultId, value.sourceId)).toBeUndefined();
    expect(value.service.listUnavailable(value.vault.vaultId)).toEqual({ sources: [], truncated: false });
  });

  it("recovers the durable Operation after restart when publication was interrupted after relink", async () => {
    const value = fixture();
    const replacement = path.join(value.root, "replacement.txt");
    fs.writeFileSync(replacement, value.body);
    const proof = value.service.candidate(value.vault.vaultId, value.sourceId);
    if (!proof) throw new Error("Expected repair proof.");
    const operationsRoot = path.join(value.vaultPath, ".pige", "operations");
    fs.rmSync(operationsRoot, { recursive: true, force: true });
    fs.writeFileSync(operationsRoot, "temporarily unavailable", "utf8");

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      requestId: "sourcereconnectdirect_restartabcdefghij",
      ...proof
    }, replacement)).resolves.toEqual({ status: "failed" });
    expect(SourceRecordSchema.parse(JSON.parse(fs.readFileSync(value.recordPath, "utf8"))).original?.path)
      .toBe(fs.realpathSync.native(replacement));
    expect(fs.readdirSync(path.join(value.vaultPath, ".pige/private/source-reconnect-receipts"))).toHaveLength(1);

    fs.rmSync(operationsRoot);
    fs.mkdirSync(operationsRoot);
    const restarted = new SourceOriginalReconnectService({
      current: () => value.vault,
      activeVaultPath: () => value.vaultPath
    });
    expect(restarted.recoverIncompleteOperations()).toEqual({
      recovered: 1, failed: 0, relinkedSourceIds: [value.sourceId]
    });
    expect(fs.readdirSync(path.join(value.vaultPath, ".pige/private/source-reconnect-receipts"))).toEqual([]);
    expect(fs.readdirSync(path.join(operationsRoot, "2026/07"))).toHaveLength(1);
    expect(restarted.candidate(value.vault.vaultId, value.sourceId)).toBeUndefined();
  });
});

function listJsonFiles(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(root, entry.name);
      return entry.isDirectory() && !entry.isSymbolicLink()
        ? listJsonFiles(child)
        : entry.isFile() && entry.name.endsWith(".json") ? [child] : [];
    });
  } catch (caught) {
    return (caught as NodeJS.ErrnoException).code === "ENOENT" ? [] : (() => { throw caught; })();
  }
}
