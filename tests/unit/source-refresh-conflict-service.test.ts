import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { NoteMarkdownEditorActivityAdapter, NoteMarkdownEditorService } from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { SourceRefreshConflictService } from "../../apps/desktop/src/main/services/source-refresh-conflict-service";
import { createSourcePageTitle, renderSourcePage } from "../../apps/desktop/src/main/services/source-page-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SourceRefreshConflictService", () => {
  it("applies the refreshed Source Page through Activity and exact Undo, then adopts after restart", () => {
    const fixture = makeFixture();
    const read = fixture.service.read(readRequest(fixture), () => true);
    expect(read).toMatchObject({ status: "ready", review: { lines: expect.any(Array) } });
    if (read.status !== "ready") throw new Error("Expected conflict review");
    expect(JSON.stringify(read)).not.toContain(fixture.vaultPath);
    expect(JSON.stringify(read)).not.toContain("refreshed evidence body");

    const result = fixture.service.resolve({
      ...readRequest(fixture), conflictId: read.review.conflictId,
      expectedSourceRevision: read.review.expectedSourceRevision,
      expectedPageRevision: read.review.expectedPageRevision,
      decision: "apply_proposed"
    }, () => true);
    expect(result).toMatchObject({ status: "applied", operationId: expect.stringMatching(/^op_/) });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("No extracted text preview is available yet");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).not.toContain("User-owned Source Page edit");
    expect(new SourceRefreshConflictService(fixture.vaults, fixture.editor).read(readRequest(fixture), () => true).status)
      .toBe("resolved");

    if (result.status !== "applied") throw new Error("Expected applied resolution");
    const activity = new KnowledgeActivityService(fixture.vaults, undefined, fixture.activity);
    expect(activity.undo({ operationId: result.operationId })).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("User-owned Source Page edit");
  });

  it("keeps current bytes durably and rejects a stale decision without mutation", () => {
    const fixture = makeFixture();
    const read = fixture.service.read(readRequest(fixture), () => true);
    if (read.status !== "ready") throw new Error("Expected conflict review");
    const stale = fixture.service.resolve({
      ...readRequest(fixture), conflictId: read.review.conflictId,
      expectedSourceRevision: read.review.expectedSourceRevision,
      expectedPageRevision: `noteeditrev_${"0".repeat(64)}`,
      decision: "apply_proposed"
    }, () => true);
    expect(stale.status).toBe("stale");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("User-owned Source Page edit");

    const kept = fixture.service.resolve({
      ...readRequest(fixture), conflictId: read.review.conflictId,
      expectedSourceRevision: read.review.expectedSourceRevision,
      expectedPageRevision: read.review.expectedPageRevision,
      decision: "keep_current"
    }, () => true);
    expect(kept.status).toBe("kept");
    expect(new SourceRefreshConflictService(fixture.vaults, fixture.editor).read(readRequest(fixture), () => true).status)
      .toBe("resolved");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("User-owned Source Page edit");
  });

  it("saves the refreshed version as a reversible new note without replacing the edited Source Page", () => {
    const fixture = makeFixture();
    const read = fixture.service.read(readRequest(fixture), () => true);
    if (read.status !== "ready") throw new Error("Expected conflict review");
    const result = fixture.service.resolve({
      ...readRequest(fixture), conflictId: read.review.conflictId,
      expectedSourceRevision: read.review.expectedSourceRevision,
      expectedPageRevision: read.review.expectedPageRevision,
      decision: "save_proposed_as_new_page"
    }, () => true);
    expect(result).toMatchObject({ status: "saved", createdPageId: expect.stringMatching(/^page_/) });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("User-owned Source Page edit");
    if (result.status !== "saved") throw new Error("Expected saved resolution");
    const created = path.join(fixture.vaultPath, "wiki", "generated", "2026", `${result.createdPageId}.md`);
    expect(fs.readFileSync(created, "utf8")).toContain("No extracted text preview is available yet");
    expect(new KnowledgeActivityService(fixture.vaults).undo({ operationId: result.operationId }))
      .toMatchObject({ status: "undone" });
    expect(fs.existsSync(created)).toBe(false);
  });
});

function makeFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-conflict-")));
  roots.push(root);
  const vault = createVaultOnDisk({
    parentDirectory: root, vaultName: "Conflict Vault", appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"), now: new Date("2026-08-02T01:00:00.000Z")
  });
  const vaultPath = path.join(root, "Conflict Vault");
  const sourceFile = path.join(root, "evidence.txt");
  fs.writeFileSync(sourceFile, "refreshed evidence body\n", "utf8");
  const stat = fs.statSync(sourceFile);
  const sourceId = "src_20260802_conflict01";
  const pageId = "page_20260802_conflict01";
  const pageRelativePath = `sources/files/2026/${sourceId}.md`;
  const sourceRecordRelativePath = `.pige/source-records/2026/08/${sourceId}.json`;
  const record = SourceRecordSchema.parse({
    id: sourceId, kind: "plain_text_file", storageStrategy: "reference_original",
    semanticOrchestration: "agent_turn",
    original: { uri: pathToFileURL(sourceFile).href, path: sourceFile, displayName: "evidence.txt",
      lastKnownMtime: stat.mtime.toISOString(), lastKnownSize: stat.size,
      checksum: hashText("refreshed evidence body\n") },
    artifacts: [], knowledgePageId: pageId, knowledgePagePath: pageRelativePath,
    metadata: { title: "Evidence", parserStatus: "text_ready", sourcePageRefreshConflict: true,
      sourceRefreshRevision: `sourcerefreshrev_${"a".repeat(64)}`,
      sourceRefreshJobId: "job_20260802_sourceconflict", sourceRefreshOperationId: "op_20260802_sourceconflict" },
    createdAt: "2026-08-02T01:00:00.000Z", updatedAt: "2026-08-02T01:05:00.000Z"
  });
  const sourceRecordPath = path.join(vaultPath, sourceRecordRelativePath);
  fs.mkdirSync(path.dirname(sourceRecordPath), { recursive: true });
  fs.writeFileSync(sourceRecordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const proposed = renderSourcePage({ pageId, pagePath: pageRelativePath, sourceRecord: record,
    sourceRecordPath: sourceRecordRelativePath, jobId: "job_20260802_sourceconflict",
    title: createSourcePageTitle(vaultPath, record), now: record.updatedAt, vaultPath });
  const current = proposed.replace("No related pages yet.", "User-owned Source Page edit");
  const pagePath = path.join(vaultPath, pageRelativePath);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, current, "utf8");
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const activity = new NoteMarkdownEditorActivityAdapter(vaults);
  const editor = new NoteMarkdownEditorService(vaults, activity, { now: () => new Date("2026-08-02T01:10:00.000Z") });
  const service = new SourceRefreshConflictService(vaults, editor);
  return { vault, vaultPath, vaults, activity, editor, service, sourceId, pageId, pagePath };
}

function readRequest(fixture: ReturnType<typeof makeFixture>) {
  return {
    apiVersion: 1 as const,
    requestId: "sourcerefreshreq_abcdefghijklmnop",
    activeVaultId: fixture.vault.vaultId,
    currentPageId: fixture.pageId,
    renderContextId: `notectx_${"b".repeat(32)}`,
    sourceId: fixture.sourceId
  };
}

function hashText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
