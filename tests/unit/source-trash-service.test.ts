import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@pige/schemas";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { SourceTrashService, sourceTrashCandidateEligible } from "../../apps/desktop/src/main/services/source-trash-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(storage: "managed" | "reference" = "managed") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-trash-")); roots.push(root);
  createVaultOnDisk({ parentDirectory: root, vaultName: "Vault", appDataPath: path.join(root, "app"),
    tempPath: path.join(root, "temp"), now: new Date("2026-08-02T08:00:00.000Z") });
  const vaultPath = path.join(root, "Vault"), vault = loadVaultSummary(vaultPath);
  const sourceId = "src_20260802_abcdefgh", pageId = "page_20260802_abcdefgh";
  const pageRelative = `sources/${pageId}.md`, pagePath = path.join(vaultPath, pageRelative);
  const page = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Source evidence"\ntype: "source"\ncreated_at: "2026-08-02T08:00:00.000Z"\nupdated_at: "2026-08-02T08:00:00.000Z"\nstatus: "active"\naliases: []\ntags: []\nsource_ids: ["${sourceId}"]\n---\n\n# Source evidence\n\nSafe body.\n`;
  fs.mkdirSync(path.dirname(pagePath), { recursive: true }); fs.writeFileSync(pagePath, page);
  const managedRelative = "sources/assets/evidence.txt", managedPath = path.join(vaultPath, managedRelative);
  const outsidePath = path.join(root, "original.txt");
  fs.mkdirSync(path.dirname(managedPath), { recursive: true });
  fs.writeFileSync(storage === "managed" ? managedPath : outsidePath, "evidence bytes");
  const record: SourceRecord = {
    schemaVersion: 1, id: sourceId, language: { domain: "source_record", language: "en", basis: "source_inherited" },
    kind: "text", storageStrategy: storage === "managed" ? "copy_to_source_library" : "reference_original",
    semanticOrchestration: "agent_turn", knowledgePageId: pageId, knowledgePagePath: pageRelative,
    ...(storage === "managed" ? { original: { uri: "file:///private/source.txt", displayName: "evidence.txt" },
      managedCopy: { path: managedRelative, rootId: "root_vault_managed", pathBasis: "vault_relative",
        checksum: checksum("evidence bytes"), size: 14 } } : {
      original: { uri: "file:///private/original.txt", path: outsidePath, displayName: "original.txt",
        checksum: checksum("evidence bytes"), lastKnownSize: 14 }
    }),
    artifacts: [], metadata: {}, createdAt: "2026-08-02T08:00:00.000Z", updatedAt: "2026-08-02T08:00:00.000Z"
  };
  const recordPath = path.join(vaultPath, ".pige", "source-records", "2026", "08", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true }); fs.writeFileSync(recordPath, JSON.stringify(record));
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const usage = { hasActiveSourceUse: vi.fn(() => false) };
  const notes = new NotesService(vaults, undefined, undefined, undefined, undefined,
    { canTrash: (currentVaultPath, currentRecord, currentPageId) =>
      sourceTrashCandidateEligible(currentVaultPath, currentRecord, currentPageId, usage) });
  return { root, vaultPath, vault, sourceId, pageId, pagePath, pageRelative, managedPath, outsidePath, recordPath,
    record, notes, usage, service: new SourceTrashService(vaults, notes, usage,
      { now: () => new Date("2026-08-02T09:00:00.000Z"), randomId: () => "fixed-random" }) };
}

async function request(value: ReturnType<typeof fixture>) {
  const render = await value.notes.render({ pageId: value.pageId }, "owner_source_trash");
  expect(render.sourceTrashEligibility).toMatchObject({ canTrash: true, sourceId: value.sourceId });
  return { apiVersion: 1 as const, requestId: "sourcetrashreq_abcdefghijklmnop",
    activeVaultId: value.vault.vaultId, currentPageId: value.pageId, renderContextId: render.renderContextId!,
    sourceId: value.sourceId, expectedSourceRevision: render.sourceTrashEligibility!.sourceRevision,
    confirmation: "move_to_trash" as const };
}

describe("source trash service", () => {
  it("moves one unreferenced in-vault source group, replays once, and restores exact stable identities", async () => {
    const value = fixture(), input = await request(value);
    const committed = value.service.trash("owner_source_trash", input);
    expect(committed.status).toBe("committed");
    expect(value.service.trash("owner_source_trash", input)).toEqual(committed);
    expect(fs.existsSync(value.recordPath)).toBe(false);
    expect(fs.existsSync(value.pagePath)).toBe(false);
    expect(fs.existsSync(value.managedPath)).toBe(false);
    const listed = value.service.list({ apiVersion: 1, requestId: "sourcetrashlistreq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId });
    expect(listed.status).toBe("ready");
    if (listed.status !== "ready") throw new Error("Expected trash listing.");
    expect(listed.sources).toHaveLength(1);
    const item = listed.sources[0]!;
    const restored = value.service.restore({ apiVersion: 1, requestId: "sourcetrashrestorereq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId, sourceId: item.sourceId, pageId: item.pageId,
      trashOperationId: item.trashOperationId, expectedTrashRevision: item.trashRevision });
    expect(restored.status).toBe("committed");
    expect(JSON.parse(fs.readFileSync(value.recordPath, "utf8"))).toMatchObject({ id: value.sourceId, knowledgePageId: value.pageId });
    expect(fs.readFileSync(value.pagePath, "utf8")).toContain(`id: "${value.pageId}"`);
    expect(fs.readFileSync(value.managedPath, "utf8")).toBe("evidence bytes");
    expect(value.service.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
  });

  it("trashes Pige-owned reference metadata without touching the referenced original", async () => {
    const value = fixture("reference"), input = await request(value);
    expect(value.service.trash("owner_source_trash", input).status).toBe("committed");
    expect(fs.readFileSync(value.outsidePath, "utf8")).toBe("evidence bytes");
    expect(fs.existsSync(value.recordPath)).toBe(false);
    expect(fs.existsSync(value.pagePath)).toBe(false);
  });

  it("fails managed-copy trash closed for another durable page reference or active Job", async () => {
    const referenced = fixture(), referencedRequest = await request(referenced);
    const otherId = "page_20260802_otherref1";
    fs.writeFileSync(path.join(referenced.vaultPath, "wiki", "other.md"), `---\nid: "${otherId}"\nschema_version: 1\ntitle: "Other"\ntype: "note"\ncreated_at: "2026-08-02T08:00:00.000Z"\nupdated_at: "2026-08-02T08:00:00.000Z"\nstatus: "active"\naliases: []\ntags: []\nsource_ids: ["${referenced.sourceId}"]\n---\n\n# Other\n`);
    expect(referenced.service.trash("owner_source_trash", referencedRequest).status).toBe("ineligible");
    expect(fs.existsSync(referenced.recordPath)).toBe(true);

    const active = fixture(), activeRequest = await request(active); active.usage.hasActiveSourceUse.mockReturnValue(true);
    expect(active.service.trash("owner_source_trash", activeRequest).status).toBe("ineligible");
    expect(fs.existsSync(active.managedPath)).toBe(true);
  });

  it("recovers a receipt-bound interrupted Operation exactly once", async () => {
    const value = fixture(), input = await request(value);
    const result = value.service.trash("owner_source_trash", input);
    if (result.status !== "committed") throw new Error("Expected committed trash.");
    const operationPath = path.join(value.vaultPath, ".pige", "operations", "2026", "08", `${result.operationId}.json`);
    fs.rmSync(operationPath);
    const restarted = new SourceTrashService({ current: () => value.vault, activeVaultPath: () => value.vaultPath }, value.notes, value.usage);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
  });
});

function checksum(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
