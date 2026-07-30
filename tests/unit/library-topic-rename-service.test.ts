import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import { LibraryTopicRenameService } from "../../apps/desktop/src/main/services/library-topic-rename-service";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260731_topicrename";
const PAGE_ID = "page_20260731_topicrename";
const UPDATED_AT = "2026-07-31T08:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("LibraryTopicRenameService", () => {
  it("renames one exact Topic, adopts replay, and restores exact bytes through Activity Undo", async () => {
    const fixture = createFixture();
    const request = renameRequest();
    const committed = await fixture.service.rename("reader_owner", request);
    expect(committed).toMatchObject({ status: "committed", render: { summary: { title: "New Topic" } } });
    if (committed.status !== "committed") throw new Error("Topic rename did not commit");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain('aliases: ["Old Topic"]');

    expect(await fixture.service.rename("reader_owner", request)).toMatchObject({
      status: "committed", operationId: committed.operationId, render: { summary: { title: "New Topic" } }
    });
    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    expect(fixture.service.activitySummary(operation)).toMatchObject({
      kind: "update_page", status: "applied", canUndo: true, target: { kind: "page", pageId: PAGE_ID }
    });
    expect(fixture.service.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("fails closed on page drift, non-Topic pages, and changed replay input", async () => {
    const fixture = createFixture();
    fs.appendFileSync(fixture.pagePath, "\nexternal edit\n");
    expect(await fixture.service.rename("reader_owner", renameRequest())).toMatchObject({ status: "stale" });
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);

    const fresh = createFixture("note");
    expect(await fresh.service.rename("reader_owner", renameRequest())).toMatchObject({ status: "ineligible" });

    const replay = createFixture();
    const committed = await replay.service.rename("reader_owner", renameRequest());
    expect(committed.status).toBe("committed");
    expect(await replay.service.rename("reader_owner", { ...renameRequest(), title: "Different Topic" }))
      .toMatchObject({ status: "stale" });
  });

  it("recovers a committed Topic file after restart without duplicating the Operation", async () => {
    const fixture = createFixture();
    const committed = await fixture.service.rename("reader_owner", renameRequest());
    if (committed.status !== "committed") throw new Error("Topic rename did not commit");
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);

    const restarted = new LibraryTopicRenameService(fixture.vaults, fixture.notes);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(findOperations(fixture.vaultPath).filter((item) => item.id === committed.operationId)).toHaveLength(1);
  });

  it("adopts an interrupted Undo without applying the page transition twice", async () => {
    const fixture = createFixture();
    const committed = await fixture.service.rename("reader_owner", renameRequest());
    if (committed.status !== "committed") throw new Error("Topic rename did not commit");
    const operation = findOperations(fixture.vaultPath).find((item) => item.id === committed.operationId)!;
    const receiptRoot = path.join(fixture.vaultPath, ".pige", "topic-renames", renameRequest().requestId);
    fs.writeFileSync(path.join(receiptRoot, "undo.intent"), operation.id);
    fs.copyFileSync(path.join(receiptRoot, "before.md"), fixture.pagePath);

    expect(fixture.service.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const operations = findOperations(fixture.vaultPath);
    expect(operations).toHaveLength(2);
    expect(operations[1]?.sourceRefs).toContainEqual({ kind: "operation", id: operation.id });
    expect(fixture.service.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });
});

function createFixture(pageType: "topic" | "note" = "topic") {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-topic-rename-"));
  roots.push(vaultPath);
  const pagePath = path.join(vaultPath, "wiki", "topics", "old-topic.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const markdown = pageType === "topic" ? topicMarkdown() : topicMarkdown().replace("type: topic", "type: note");
  fs.writeFileSync(pagePath, markdown, "utf8");
  const vault = { vaultId: VAULT_ID, name: "Topics", path: vaultPath, createdAt: UPDATED_AT };
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const notes = new NotesService(vaults);
  const service = new LibraryTopicRenameService(vaults, notes, {
    now: () => new Date("2026-07-31T09:00:00.000Z"),
    randomId: () => "fixedtopicrename"
  });
  return { vaultPath, pagePath, markdown, vaults, notes, service };
}

function renameRequest() {
  return {
    apiVersion: 1 as const,
    requestId: "library_topic_rename_request_20260731fixture",
    activeVaultId: VAULT_ID,
    pageId: PAGE_ID,
    expectedUpdatedAt: UPDATED_AT,
    expectedRevision: topicRevision(topicMarkdown()),
    expectedTitle: "Old Topic",
    title: "New Topic"
  };
}

function topicMarkdown(): string {
  return `---\nid: ${PAGE_ID}\nschema_version: 1\ntitle: "Old Topic"\ntype: topic\ncreated_at: "2026-07-31T07:00:00.000Z"\nupdated_at: "${UPDATED_AT}"\nstatus: active\nlanguage: en\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\n---\n\nTopic body remains private.\n`;
}

function topicRevision(markdown: string): `noteeditrev_${string}` {
  return `noteeditrev_${importHash(markdown)}`;
}

function importHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function findOperationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function findOperations(vaultPath: string) {
  return findOperationFiles(vaultPath).map((file) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))));
}
