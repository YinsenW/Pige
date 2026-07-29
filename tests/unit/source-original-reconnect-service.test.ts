import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { SourceOriginalReconnectService } from "../../apps/desktop/src/main/services/source-original-reconnect-service";
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
  });
  return { root, vaultPath, vault, sourceId, body, oldPath, recordPath, service };
}

describe("source original reconnect service", () => {
  it("atomically rebinds only the exact matching regular file", async () => {
    const value = fixture();
    const replacement = path.join(value.root, "replacement.txt");
    fs.writeFileSync(replacement, value.body);

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      sourceId: value.sourceId
    }, replacement)).resolves.toBe("reconnected");

    const committed = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(value.recordPath, "utf8")));
    expect(committed.original).toMatchObject({
      path: replacement,
      lastKnownSize: value.body.byteLength
    });
    expect(committed.original?.uri).toMatch(/^file:/);
  });

  it("leaves the Source Record unchanged for mismatch, symlink, or stale vault", async () => {
    const value = fixture();
    const before = fs.readFileSync(value.recordPath, "utf8");
    const wrong = path.join(value.root, "wrong.txt");
    fs.writeFileSync(wrong, "different body\n", "utf8");
    const link = path.join(value.root, "linked.txt");
    fs.symlinkSync(wrong, link);

    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      sourceId: value.sourceId
    }, wrong)).resolves.toBe("failed");
    await expect(value.service.reconnect({
      activeVaultId: value.vault.vaultId,
      sourceId: value.sourceId
    }, link)).resolves.toBe("failed");
    await expect(value.service.reconnect({
      activeVaultId: "vault_20260729_changedidentity",
      sourceId: value.sourceId
    }, wrong)).resolves.toBe("stale");
    expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before);
  });
});
