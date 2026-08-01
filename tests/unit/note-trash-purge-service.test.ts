import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NoteTrashPurgeService } from "../../apps/desktop/src/main/services/note-trash-purge-service";
import { NoteTrashService } from "../../apps/desktop/src/main/services/note-trash-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("NoteTrashPurgeService", () => {
  it("permanently deletes one exact confirmed trash payload only after durable tombstone and Operation", async () => {
    const fixture = await createFixture();
    const request = purgeRequest(fixture);
    const result = fixture.purge.purge(request);

    expect(result).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_20260802_[a-f0-9]{16}$/u) });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(readTrashPayloads(fixture.vaultPath)).toEqual([]);
    expect(fixture.trash.list({ apiVersion: 1, requestId: "notetrashlistreq_afterpurge123456",
      activeVaultId: fixture.vault.vaultId })).toMatchObject({ status: "ready", notes: [] });
    const operation = readOperation(fixture.vaultPath, result.status === "committed" ? result.operationId : "");
    expect(operation).toMatchObject({ kind: "purge_page", reversible: "no", targetRefs: [{
      kind: "page", id: fixture.pageId
    }], sourceRefs: [{ kind: "operation", id: fixture.summary.trashOperationId }] });
    expect(operation.after).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(fixture.vaultPath);
    expect(fixture.purge.purge(request)).toEqual(result);
  });

  it("fails stale, wrong-vault and tampered payload requests closed without deleting bytes", async () => {
    const fixture = await createFixture();
    const request = purgeRequest(fixture);
    expect(fixture.purge.purge({ ...request, activeVaultId: "vault_20260802_wrongvault" })).toMatchObject({ status: "failed" });
    expect(fixture.purge.purge({ ...request, expectedTrashRevision: `notetrashrev_${"a".repeat(64)}` }))
      .toMatchObject({ status: "stale" });
    const payload = onlyTrashPayload(fixture.vaultPath);
    fs.appendFileSync(payload, "\nTampered.\n", "utf8");
    expect(fixture.purge.purge(request)).toMatchObject({ status: "stale" });
    expect(fs.existsSync(payload)).toBe(true);
  });

  it("adopts an interrupted purge after restart without duplicating its Operation", async () => {
    const fixture = await createFixture();
    const request = purgeRequest(fixture);
    const unlinkSync = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation(((filePath: fs.PathLike) => {
      if (String(filePath).includes(`${path.sep}note-receipts${path.sep}`)) throw new Error("simulated process exit");
      return unlinkSync(filePath);
    }) as typeof fs.unlinkSync);
    expect(fixture.purge.purge(request)).toMatchObject({ status: "failed" });
    vi.restoreAllMocks();
    expect(readTrashPayloads(fixture.vaultPath)).toEqual([]);

    const restarted = new NoteTrashPurgeService(fixture.vaults);
    expect(restarted.recoverIncompletePurges()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.purge(request)).toMatchObject({ status: "committed" });
    expect(readOperationKinds(fixture.vaultPath).filter((kind) => kind === "purge_page")).toHaveLength(1);
    expect(fs.readdirSync(path.join(fixture.vaultPath, ".pige", "trash", "note-receipts"))).toEqual([]);
  });

  it("rejects a symlinked purge-evidence parent before writing or deleting the trash payload", async () => {
    const fixture = await createFixture();
    const external = path.join(path.dirname(fixture.vaultPath), "external-purge-intents");
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(fixture.vaultPath, ".pige", "trash", "note-purge-intents"));
    expect(fixture.purge.purge(purgeRequest(fixture))).toMatchObject({ status: "stale" });
    expect(readTrashPayloads(fixture.vaultPath)).toEqual(["purge-me.md"]);
    expect(fs.readdirSync(external)).toEqual([]);
  });
});

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-purge-"));
  roots.push(root);
  createVaultOnDisk({ parentDirectory: root, vaultName: "Purge Notes", appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"), now: new Date("2026-08-02T10:00:00.000Z") });
  const vaultPath = path.join(root, "Purge Notes");
  const vault = loadVaultSummary(vaultPath);
  const pageId = "page_20260802_purgeme123456";
  const pagePath = path.join(vaultPath, "wiki", "purge-me.md");
  const content = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Delete me permanently"\ntype: "note"\ncreated_at: "2026-08-02T10:00:00.000Z"\nupdated_at: "2026-08-02T10:00:00.000Z"\nstatus: "active"\naliases: []\nsource_ids: []\nnote:\n  note_kind: "general"\n  review_state: "clean"\n---\n\n# Delete me permanently\n\nExact durable bytes.\n`;
  fs.writeFileSync(pagePath, content, { encoding: "utf8", mode: 0o600 });
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const editor = new NoteMarkdownEditorService(vaults, { recordPageUpdate: () => undefined });
  const notes = new NotesService(vaults, undefined, undefined, editor);
  const trash = new NoteTrashService(vaults, notes, { now: () => new Date("2026-08-02T10:00:00.000Z"),
    randomId: () => "trash-fixed-id" });
  const rendered = await notes.render({ pageId }, "purge_test_owner");
  const trashed = trash.trash("purge_test_owner", { apiVersion: 1, requestId: "notetrashreq_purgefixture1234",
    activeVaultId: vault.vaultId, currentPageId: pageId, renderContextId: rendered.renderContextId!,
    expectedRevision: `noteeditrev_${createHash("sha256").update(content).digest("hex")}` });
  if (trashed.status !== "committed") throw new Error("Fixture note was not trashed.");
  const listed = trash.list({ apiVersion: 1, requestId: "notetrashlistreq_purgefixture1234", activeVaultId: vault.vaultId });
  if (listed.status !== "ready" || !listed.notes[0]) throw new Error("Fixture trash was not listed.");
  return { vaultPath, vault, vaults, pageId, pagePath, trash, summary: listed.notes[0],
    purge: new NoteTrashPurgeService(vaults, { now: () => new Date("2026-08-02T10:01:00.000Z"),
      randomId: () => "purge-fixed-id" }) };
}

function purgeRequest(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { apiVersion: 1 as const, requestId: "notetrashpurgereq_confirmed12345678", activeVaultId: fixture.vault.vaultId,
    pageId: fixture.pageId, trashOperationId: fixture.summary.trashOperationId,
    expectedTrashRevision: fixture.summary.expectedTrashRevision, confirmation: "delete_permanently" as const };
}

function onlyTrashPayload(vaultPath: string): string {
  const root = path.join(vaultPath, ".pige", "trash", "pages");
  const operationDirectory = path.join(root, fs.readdirSync(root)[0]!);
  return path.join(operationDirectory, fs.readdirSync(operationDirectory)[0]!);
}
function readTrashPayloads(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "trash", "pages");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((operation) => fs.readdirSync(path.join(root, operation)));
}
function readOperation(vaultPath: string, operationId: string) {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("Invalid Operation ID.");
  return JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6),
    `${operationId}.json`), "utf8"));
}
function readOperationKinds(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  return fs.readdirSync(root).flatMap((year) => fs.readdirSync(path.join(root, year)).flatMap((month) =>
    fs.readdirSync(path.join(root, year, month)).map((name) => JSON.parse(
      fs.readFileSync(path.join(root, year, month, name), "utf8")).kind as string)));
}
