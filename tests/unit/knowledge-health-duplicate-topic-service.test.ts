import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeHealthDuplicateTopicService } from
  "../../apps/desktop/src/main/services/knowledge-health-duplicate-topic-service";

const roots: string[] = [];
const vaultId = "vault_20260731_duplicatetopics";
const firstId = "page_20260731_duplicateaa";
const secondId = "page_20260731_duplicatebb";
const runRequest = { apiVersion: 1, requestId: "knowledge_health_request_duplicatetopics01", activeVaultId: vaultId } as const;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("KnowledgeHealthDuplicateTopicService", () => {
  it("projects exact proof, merges once, adopts replay, and restores both topics through Undo", () => {
    const fixture = createFixture();
    const projected = fixture.service.project(fixture.vaultPath, runRequest, fixture.snapshot, fixture.issue);
    expect(projected).toMatchObject({ kind: "duplicate_topic", repairContextId: expect.any(String) });
    if (projected.kind !== "duplicate_topic" || !projected.repairContextId || !projected.pageProofs) {
      throw new Error("duplicate-topic proof missing");
    }
    const request = {
      apiVersion: 1 as const,
      requestId: "knowledge_health_duplicate_topic_repair_request_abcdefghijklmnop",
      activeVaultId: vaultId,
      reportRequestId: runRequest.requestId,
      indexGeneration: fixture.snapshot.indexGeneration,
      issueKind: "duplicate_topic" as const,
      repairContextId: projected.repairContextId,
      survivorPageId: projected.pageProofs[0]!.pageId,
      survivorRevision: projected.pageProofs[0]!.revision,
      survivorRenderProof: projected.pageProofs[0]!.renderProof,
      absorbedPageId: projected.pageProofs[1]!.pageId,
      absorbedRevision: projected.pageProofs[1]!.revision,
      absorbedRenderProof: projected.pageProofs[1]!.renderProof
    };
    const committed = fixture.service.repair(fixture.vaultPath, request);
    expect(committed).toMatchObject({ status: "committed", operationId: expect.any(String) });
    if (committed.status !== "committed") throw new Error("topic merge did not commit");
    expect(fs.readFileSync(fixture.firstPath, "utf8")).toContain("## Duplicate Beta");
    expect(fs.existsSync(fixture.secondPath)).toBe(false);
    const operationFile = findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${committed.operationId}.json`))!;
    fs.unlinkSync(operationFile);
    const restarted = new KnowledgeHealthDuplicateTopicService(fixture.vaults, fixture.database);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(restarted.repair(fixture.vaultPath, request)).toEqual(committed);

    const operation = findOperations(fixture.vaultPath).find(({ id }) => id === committed.operationId)!;
    expect(restarted.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });
    expect(restarted.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.firstPath, "utf8")).toBe(fixture.firstMarkdown);
    expect(fs.readFileSync(fixture.secondPath, "utf8")).toBe(fixture.secondMarkdown);
    const undo = findOperations(fixture.vaultPath).find(({ id }) => id === `${operation.id}undo`)!;
    expect(restarted.activitySummary(operation, undo)).toMatchObject({ status: "undone", canRedo: true });
    const redone = restarted.redo({ operationId: operation.id });
    expect(redone).toMatchObject({ status: "redone", redoOperationId: expect.any(String) });
    if (redone.status !== "redone" || !redone.redoOperationId) throw new Error("duplicate-topic Redo did not commit");
    expect(fs.existsSync(fixture.secondPath)).toBe(false);
    expect(restarted.redo({ operationId: operation.id })).toMatchObject({ status: "already_redone" });
    const redoOperation = findOperations(fixture.vaultPath).find(({ id }) => id === redone.redoOperationId)!;
    expect(restarted.undo(redoOperation)).toMatchObject({ status: "undone" });
    const redoUndo = findOperations(fixture.vaultPath).find(({ id }) => id === `${redoOperation.id}undo`)!;
    expect(restarted.activitySummary(redoOperation, redoUndo)).toMatchObject({ status: "undone", canRedo: true });
    expect(restarted.redo({ operationId: redoOperation.id })).toMatchObject({ status: "redone" });
  });

  it("fails closed when a projected topic changes before repair", () => {
    const fixture = createFixture();
    const projected = fixture.service.project(fixture.vaultPath, runRequest, fixture.snapshot, fixture.issue);
    if (projected.kind !== "duplicate_topic" || !projected.repairContextId || !projected.pageProofs) throw new Error("proof missing");
    fs.appendFileSync(fixture.secondPath, "\nexternal edit\n");
    expect(fixture.service.repair(fixture.vaultPath, {
      apiVersion: 1, requestId: "knowledge_health_duplicate_topic_repair_request_stalefixture0001",
      activeVaultId: vaultId, reportRequestId: runRequest.requestId, indexGeneration: fixture.snapshot.indexGeneration,
      issueKind: "duplicate_topic", repairContextId: projected.repairContextId,
      survivorPageId: projected.pageProofs[0]!.pageId, survivorRevision: projected.pageProofs[0]!.revision,
      survivorRenderProof: projected.pageProofs[0]!.renderProof, absorbedPageId: projected.pageProofs[1]!.pageId,
      absorbedRevision: projected.pageProofs[1]!.revision, absorbedRenderProof: projected.pageProofs[1]!.renderProof
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.secondPath, "utf8")).toContain("external edit");
    expect(findOperations(fixture.vaultPath)).toHaveLength(0);
  });

  it("adopts an interrupted Redo after restart and rejects restored-topic drift", () => {
    const fixture = createFixture();
    const projected = fixture.service.project(fixture.vaultPath, runRequest, fixture.snapshot, fixture.issue);
    if (projected.kind !== "duplicate_topic" || !projected.repairContextId || !projected.pageProofs) throw new Error("proof missing");
    const request = { apiVersion: 1 as const, requestId: "knowledge_health_duplicate_topic_repair_request_restartredofixture01",
      activeVaultId: vaultId, reportRequestId: runRequest.requestId, indexGeneration: fixture.snapshot.indexGeneration,
      issueKind: "duplicate_topic" as const, repairContextId: projected.repairContextId,
      survivorPageId: projected.pageProofs[0]!.pageId, survivorRevision: projected.pageProofs[0]!.revision,
      survivorRenderProof: projected.pageProofs[0]!.renderProof, absorbedPageId: projected.pageProofs[1]!.pageId,
      absorbedRevision: projected.pageProofs[1]!.revision, absorbedRenderProof: projected.pageProofs[1]!.renderProof };
    const committed = fixture.service.repair(fixture.vaultPath, request);
    if (committed.status !== "committed") throw new Error("duplicate-topic merge did not commit");
    const operation = findOperations(fixture.vaultPath).find(({ id }) => id === committed.operationId)!;
    expect(fixture.service.undo(operation)).toMatchObject({ status: "undone" });
    const redone = fixture.service.redo({ operationId: operation.id });
    if (redone.status !== "redone" || !redone.redoOperationId) throw new Error("duplicate-topic Redo did not commit");
    fs.unlinkSync(findOperationFiles(fixture.vaultPath).find((file) => file.endsWith(`${redone.redoOperationId}.json`))!);
    const restarted = new KnowledgeHealthDuplicateTopicService(fixture.vaults, fixture.database);
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });

    expect(restarted.undo(findOperations(fixture.vaultPath).find(({ id }) => id === redone.redoOperationId)!))
      .toMatchObject({ status: "undone" });
    fs.appendFileSync(fixture.secondPath, "\nexternal drift\n");
    expect(restarted.redo({ operationId: redone.redoOperationId })).toMatchObject({ status: "stale" });
  });
});

function createFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-health-topic-merge-")); roots.push(vaultPath);
  const firstPath = path.join(vaultPath, "wiki", "duplicate-a.md");
  const secondPath = path.join(vaultPath, "wiki", "duplicate-b.md");
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  const firstMarkdown = topicMarkdown(firstId, "Duplicate Alpha", "Alpha body", ["alpha"]);
  const secondMarkdown = topicMarkdown(secondId, "Duplicate Beta", "Beta body", ["beta"]);
  fs.writeFileSync(firstPath, firstMarkdown); fs.writeFileSync(secondPath, secondMarkdown);
  const vault = { vaultId, name: "Topics", path: vaultPath, createdAt: "2026-07-31T08:00:00.000Z" };
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const issue = { kind: "duplicate_topic" as const, candidatePageCount: 2,
    pages: [{ pageId: firstId, title: "Duplicate Alpha" }, { pageId: secondId, title: "Duplicate Beta" }] };
  const snapshot = { indexGeneration: "2026-07-31T08:30:00.000Z#duplicatetopics", invalidPageCount: 0,
    counts: { totalIssueCount: 1, brokenLinkPageCount: 0, unresolvedLinkCount: 0, orphanPageCount: 0,
      duplicateTopicGroupCount: 1, unsourcedClaimCount: 0 }, issues: [issue], truncated: false };
  const database = { knowledgeHealth: () => snapshot };
  const service = new KnowledgeHealthDuplicateTopicService(vaults, database, {
    now: () => new Date("2026-07-31T09:00:00.000Z"), randomId: () => "fixedduplicatetopicmerge1234567890"
  });
  return { vaultPath, firstPath, secondPath, firstMarkdown, secondMarkdown, vaults, database, service, issue, snapshot };
}

function topicMarkdown(id: string, title: string, body: string, aliases: readonly string[]): string {
  return `---\nid: ${JSON.stringify(id)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: topic\ncreated_at: "2026-07-31T08:00:00.000Z"\nupdated_at: "2026-07-31T08:00:00.000Z"\nstatus: active\nlanguage: en\naliases: ${JSON.stringify(aliases)}\ntags: []\ntopics: []\nsource_ids: []\n---\n\n${body}\n`;
}

function findOperations(vaultPath: string): Array<{ id: string; [key: string]: unknown }> {
  return findOperationFiles(vaultPath).map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}

function findOperationFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, encoding: "utf8" }).filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(root, entry));
}
