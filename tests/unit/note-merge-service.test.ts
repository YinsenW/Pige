import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMergeService } from "../../apps/desktop/src/main/services/note-merge-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260730_notemergefixture";
const SURVIVOR_ID = "page_20260730_mergesurvivor";
const ABSORBED_ID = "page_20260730_mergeabsorbed";
const SURVIVOR_UPDATED = "2026-07-30T08:00:00.000Z";
const ABSORBED_UPDATED = "2026-07-30T08:01:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("NoteMergeService", () => {
  it("merges once, adopts replay, and restores both exact notes through Activity Undo", async () => {
    const fixture = await createFixture();
    const request = mergeRequest(fixture);
    const committed = fixture.service.merge("reader_owner", request);
    expect(committed).toMatchObject({ status: "committed" });
    if (committed.status !== "committed") throw new Error("merge did not commit");

    const merged = fs.readFileSync(fixture.survivorPath, "utf8");
    expect(merged).toContain("Survivor body");
    expect(merged).toContain("## Absorbed note");
    expect(merged).toContain("Absorbed body with [[Survivor note]]");
    expect(merged).toContain(ABSORBED_ID);
    expect(fs.existsSync(fixture.absorbedPath)).toBe(false);

    expect(fixture.service.merge("reader_owner", request)).toEqual(committed);
    expect(findOperations(fixture.vaultPath).filter((operation) => operation.id === committed.operationId)).toHaveLength(1);

    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(fixture.service.activitySummary(operation)).toMatchObject({
      kind: "update_page",
      status: "applied",
      canUndo: true,
      target: { kind: "page", pageId: SURVIVOR_ID }
    });
    expect(fixture.service.undo(operation)).toMatchObject({ status: "undone", operationId: operation.id });
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toBe(fixture.absorbedMarkdown);
    expect(fixture.service.activitySummary(operation, findOperations(fixture.vaultPath).find((item) => item.id === `${operation.id}undo`)))
      .toMatchObject({ status: "undone", canUndo: false, undoUnavailableReason: "already_undone" });
  });

  it("fails closed when either exact note changes before commit", async () => {
    const fixture = await createFixture();
    const request = mergeRequest(fixture);
    fs.writeFileSync(
      fixture.absorbedPath,
      fixture.absorbedMarkdown.replace(ABSORBED_UPDATED, "2026-07-30T08:02:00.000Z") + "\nexternal edit\n",
      "utf8"
    );
    expect(fixture.service.merge("reader_owner", request)).toEqual({ status: "stale" });
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toContain("external edit");
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });

  it("recovers a receipt whose durable file commit was interrupted", async () => {
    const fixture = await createFixture();
    const request = mergeRequest(fixture);
    const committed = fixture.service.merge("reader_owner", request);
    if (committed.status !== "committed") throw new Error("merge did not commit");
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);

    const restarted = new NoteMergeService(fixture.vaults, fixture.notes);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(findOperations(fixture.vaultPath).filter((operation) => operation.id === committed.operationId)).toHaveLength(1);
    expect(fs.existsSync(fixture.absorbedPath)).toBe(false);
  });
});

async function createFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-merge-"));
  roots.push(vaultPath);
  const survivorPath = path.join(vaultPath, "wiki", "survivor.md");
  const absorbedPath = path.join(vaultPath, "wiki", "absorbed.md");
  fs.mkdirSync(path.dirname(survivorPath), { recursive: true });
  const survivorMarkdown = noteMarkdown(SURVIVOR_ID, "Survivor note", SURVIVOR_UPDATED, "Survivor body", ["Original alias"]);
  const absorbedMarkdown = noteMarkdown(ABSORBED_ID, "Absorbed note", ABSORBED_UPDATED, "Absorbed body with [[Survivor note]]", ["Second alias"]);
  fs.writeFileSync(survivorPath, survivorMarkdown, "utf8");
  fs.writeFileSync(absorbedPath, absorbedMarkdown, "utf8");
  const vault = { vaultId: VAULT_ID, name: "Merge", path: vaultPath, createdAt: SURVIVOR_UPDATED };
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const notes = new NotesService(vaults);
  const render = await notes.render({ pageId: SURVIVOR_ID }, "reader_owner");
  if (!render.renderContextId || !render.trashEligibility) throw new Error("missing render authority");
  const service = new NoteMergeService(vaults, notes, {
    now: () => new Date("2026-07-30T09:00:00.000Z"),
    randomId: () => "fixedmergerequest"
  });
  return { vaultPath, survivorPath, absorbedPath, survivorMarkdown, absorbedMarkdown, vaults, notes, service, render };
}

function mergeRequest(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    apiVersion: 1 as const,
    requestId: "notemergereq_20260730fixture01",
    activeVaultId: VAULT_ID,
    currentPageId: SURVIVOR_ID,
    renderContextId: fixture.render.renderContextId!,
    expectedRevision: fixture.render.trashEligibility!.revision,
    targetPageId: ABSORBED_ID,
    expectedTargetUpdatedAt: ABSORBED_UPDATED
  };
}

function noteMarkdown(id: string, title: string, updatedAt: string, body: string, aliases: readonly string[]): string {
  return `---\nid: ${JSON.stringify(id)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: note\ncreated_at: "2026-07-30T07:00:00.000Z"\nupdated_at: ${JSON.stringify(updatedAt)}\nstatus: active\nlanguage: en\naliases: ${JSON.stringify(aliases)}\ntags: []\ntopics: []\nsource_ids: []\n---\n\n${body}\n`;
}

function findOperationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(root, entry))
    .filter((entry) => entry.endsWith(".json") && !entry.includes(`${path.sep}note-merge${path.sep}`));
}

function findOperations(vaultPath: string): Array<{ id: string; [key: string]: unknown }> {
  return findOperationFiles(vaultPath).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}
