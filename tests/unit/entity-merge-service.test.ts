import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EntityMergeService } from "../../apps/desktop/src/main/services/entity-merge-service";
import { NoteMergeService } from "../../apps/desktop/src/main/services/note-merge-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260802_entitymergefixture";
const SURVIVOR_ID = "page_20260802_entitymergesurvivor";
const ABSORBED_ID = "page_20260802_entitymergeabsorbed";
const MENTION_ID = "page_20260802_entitymergemention";
const SURVIVOR_UPDATED = "2026-08-02T08:00:00.000Z";
const ABSORBED_UPDATED = "2026-08-02T08:01:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("EntityMergeService", () => {
  it("merges equal-type entities, rewrites exact mentions, and supports replay, Undo, and Redo", async () => {
    const fixture = await createFixture();
    const request = mergeRequest(fixture);
    const committed = fixture.service.merge("reader_owner", request);
    expect(committed).toMatchObject({ status: "committed" });
    if (committed.status !== "committed") throw new Error("Entity merge did not commit");

    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toContain("## Grace Hopper");
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toContain('aliases: ["Grace Hopper","Grace Brewster Hopper"]');
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toContain('identifiers: ["wikidata:Q7259","wikidata:Q11641"]');
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toContain(`entities: [${JSON.stringify(SURVIVOR_ID)}]`);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toContain(`related_page_ids: [${JSON.stringify(SURVIVOR_ID)}]`);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).not.toContain(ABSORBED_ID);
    expect(fs.existsSync(fixture.absorbedPath)).toBe(false);
    expect(fixture.service.merge("reader_owner", request)).toEqual(committed);

    const operation = operations(fixture.vaultPath).find((entry) => entry.id === committed.operationId)!;
    expect(fixture.service.activitySummary(operation)).toMatchObject({
      status: "applied", canUndo: true, target: { kind: "page", pageId: SURVIVOR_ID }
    });
    expect(fixture.service.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toBe(fixture.absorbedMarkdown);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toBe(fixture.mentionMarkdown);

    expect(fixture.service.redo({ operationId: operation.id })).toMatchObject({ status: "redone" });
    expect(fs.existsSync(fixture.absorbedPath)).toBe(false);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toContain(SURVIVOR_ID);
  });

  it("fails closed for a different Entity type without changing either page", async () => {
    const fixture = await createFixture("organization");
    expect(fixture.service.merge("reader_owner", mergeRequest(fixture))).toEqual({ status: "ineligible" });
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toBe(fixture.absorbedMarkdown);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toBe(fixture.mentionMarkdown);
    expect(operations(fixture.vaultPath)).toHaveLength(0);
  });

  it("preserves deliberately read-only Source pages instead of rewriting their Entity references", async () => {
    const fixture = await createFixture();
    const sourcePath = path.join(fixture.vaultPath, "sources", "evidence.md");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const sourceMarkdown = frontmatter("page_20260802_entitymergesource", "Evidence", "source",
      "2026-08-02T08:03:00.000Z", [ABSORBED_ID]) + "---\n\nPreserved source page.\n";
    fs.writeFileSync(sourcePath, sourceMarkdown, "utf8");

    expect(fixture.service.merge("reader_owner", mergeRequest(fixture))).toEqual({ status: "ineligible" });
    expect(fs.readFileSync(sourcePath, "utf8")).toBe(sourceMarkdown);
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toBe(fixture.absorbedMarkdown);
    expect(operations(fixture.vaultPath)).toHaveLength(0);
  });

  it("discards an uncommitted receipt when an affected mention drifts before publication", async () => {
    const fixture = await createFixture();
    let assertions = 0;
    const entities = new EntityMergeService(fixture.vaults, {
      resolveTrashTarget: (ownerId, request) => {
        const target = fixture.notes.resolveTrashTarget(ownerId, request);
        if (target.status !== "ready") return target;
        return { ...target, assertCurrent: () => {
          assertions += 1;
          if (assertions === 2) fs.appendFileSync(fixture.mentionPath, "\nexternal change\n");
          return target.assertCurrent();
        } };
      }
    });
    const service = new NoteMergeService(fixture.vaults, fixture.notes, { entityMergeService: entities });
    expect(service.merge("reader_owner", mergeRequest(fixture))).toEqual({ status: "stale" });
    expect(fs.readFileSync(fixture.survivorPath, "utf8")).toBe(fixture.survivorMarkdown);
    expect(fs.readFileSync(fixture.absorbedPath, "utf8")).toBe(fixture.absorbedMarkdown);
    expect(fs.readFileSync(fixture.mentionPath, "utf8")).toContain("external change");
    expect(fs.existsSync(path.join(fixture.vaultPath, ".pige", "entity-merges"))).toBe(true);
    expect(fs.readdirSync(path.join(fixture.vaultPath, ".pige", "entity-merges"))).toHaveLength(0);
    expect(operations(fixture.vaultPath)).toHaveLength(0);
  });

  it("recovers an interrupted durable receipt once after restart", async () => {
    const fixture = await createFixture();
    const committed = fixture.service.merge("reader_owner", mergeRequest(fixture));
    if (committed.status !== "committed") throw new Error("Entity merge did not commit");
    fs.unlinkSync(operationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!);

    const entities = new EntityMergeService(fixture.vaults, fixture.notes);
    const restarted = new NoteMergeService(fixture.vaults, fixture.notes, { entityMergeService: entities });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(operations(fixture.vaultPath).filter((entry) => entry.id === committed.operationId)).toHaveLength(1);
  });
});

async function createFixture(absorbedType = "person") {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-entity-merge-"));
  roots.push(vaultPath);
  const survivorPath = path.join(vaultPath, "wiki", "ada.md");
  const absorbedPath = path.join(vaultPath, "wiki", "grace.md");
  const mentionPath = path.join(vaultPath, "wiki", "history.md");
  fs.mkdirSync(path.dirname(survivorPath), { recursive: true });
  fs.mkdirSync(path.dirname(mentionPath), { recursive: true });
  const survivorMarkdown = entityMarkdown(SURVIVOR_ID, "Ada Lovelace", SURVIVOR_UPDATED, "person", "Ada body.",
    "Ada Lovelace", ["wikidata:Q7259"]);
  const absorbedMarkdown = entityMarkdown(ABSORBED_ID, "Grace Hopper", ABSORBED_UPDATED, absorbedType, "Grace body.",
    "Grace Brewster Hopper", ["wikidata:Q11641"]);
  const mentionMarkdown = noteMarkdown(MENTION_ID, "Computing history", [ABSORBED_ID], [ABSORBED_ID]);
  fs.writeFileSync(survivorPath, survivorMarkdown, "utf8");
  fs.writeFileSync(absorbedPath, absorbedMarkdown, "utf8");
  fs.writeFileSync(mentionPath, mentionMarkdown, "utf8");
  const vault = { vaultId: VAULT_ID, name: "Entities", path: vaultPath, createdAt: SURVIVOR_UPDATED };
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const notes = new NotesService(vaults);
  const render = await notes.render({ pageId: SURVIVOR_ID }, "reader_owner");
  if (!render.renderContextId || !render.trashEligibility) throw new Error("missing Entity render authority");
  const entities = new EntityMergeService(vaults, notes, () => new Date("2026-08-02T09:00:00.000Z"), () => "fixedentitymerge");
  const service = new NoteMergeService(vaults, notes, { entityMergeService: entities });
  return { vaultPath, survivorPath, absorbedPath, mentionPath, survivorMarkdown, absorbedMarkdown,
    mentionMarkdown, vaults, notes, service, render };
}

function mergeRequest(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { apiVersion: 1 as const, requestId: "notemergereq_20260802entity01", activeVaultId: VAULT_ID,
    currentPageId: SURVIVOR_ID, renderContextId: fixture.render.renderContextId!,
    expectedRevision: fixture.render.trashEligibility!.revision, targetPageId: ABSORBED_ID,
    expectedTargetUpdatedAt: ABSORBED_UPDATED };
}

function entityMarkdown(id: string, title: string, updatedAt: string, entityType: string, body: string,
  canonicalName: string, identifiers: readonly string[]): string {
  return frontmatter(id, title, "entity", updatedAt, []) +
    `entity:\n  entity_type: ${JSON.stringify(entityType)}\n  canonical_name: ${JSON.stringify(canonicalName)}\n  identifiers: ${JSON.stringify(identifiers)}\n---\n\n${body}\n`;
}

function noteMarkdown(id: string, title: string, entities: readonly string[], related: readonly string[]): string {
  return frontmatter(id, title, "note", "2026-08-02T08:02:00.000Z", entities, related) + `---\n\nMention body.\n`;
}

function frontmatter(id: string, title: string, type: string, updatedAt: string, entities: readonly string[], related: readonly string[] = []): string {
  return `---\nid: ${JSON.stringify(id)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: ${type}\ncreated_at: "2026-08-02T07:00:00.000Z"\nupdated_at: ${JSON.stringify(updatedAt)}\nstatus: active\nlanguage: en\naliases: []\ntags: []\ntopics: []\nsource_ids: []\nrelated_page_ids: ${JSON.stringify(related)}\nentities: ${JSON.stringify(entities)}\n`;
}

function operationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(root, entry)).filter((entry) => entry.endsWith(".json"));
}
function operations(vaultPath: string): Array<{ id: string; [key: string]: unknown }> {
  return operationFiles(vaultPath).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}
