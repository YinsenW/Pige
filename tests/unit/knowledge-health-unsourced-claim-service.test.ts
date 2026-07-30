import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "@pige/schemas";
import { KnowledgeHealthUnsourcedClaimService } from
  "../../apps/desktop/src/main/services/knowledge-health-unsourced-claim-service";
import {
  NoteMarkdownEditorService,
  type NoteMarkdownEditorActivityPort
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";

const roots: string[] = [];
const vaultId = "vault_20260731_claimsource";
const claimPageId = "page_20260731_claimsource";
const sourcePageId = "page_20260731_sourcechoice";
const sourceId = "src_20260731_sourcechoice";
const indexGeneration = "2026-07-31T12:00:00.000Z#claimsource";
const runRequest = {
  apiVersion: 1 as const,
  requestId: "knowledge_health_request_claimsourceabcdef",
  activeVaultId: vaultId
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("KnowledgeHealthUnsourcedClaimService", () => {
  it("binds one explicitly chosen current Source through the reversible note editor", () => {
    const fixture = createFixture();
    const report = fixture.service.project(fixture.vaultPath, runRequest, readyReport());
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId ||
      !issue.claimRevision || !issue.claimRenderProof) throw new Error("Expected repairable claim proof.");
    const proof = {
      apiVersion: 1 as const,
      activeVaultId: vaultId,
      reportRequestId: report.requestId,
      indexGeneration,
      issueKind: "unsourced_claim" as const,
      pageId: claimPageId,
      repairContextId: issue.repairContextId,
      claimRevision: issue.claimRevision,
      claimRenderProof: issue.claimRenderProof
    };
    const search = fixture.service.search(fixture.vaultPath, {
      ...proof,
      requestId: "knowledge_health_claim_source_search_abcdefghijklmnop",
      query: "Evidence"
    });
    expect(search).toMatchObject({ status: "ready", truncated: false });
    if (search.status !== "ready" || search.sources.length !== 1) throw new Error("Expected one source choice.");
    expect(search.sources[0]).toEqual({
      sourceContextId: expect.stringMatching(/^knowledge_health_claim_source_context_/),
      page: { pageId: sourcePageId, title: "Evidence source" }
    });
    expect(JSON.stringify(search)).not.toContain(sourceId);

    const repaired = fixture.service.repair(fixture.vaultPath, {
      ...proof,
      requestId: "knowledge_health_claim_source_repair_abcdefghijklmnop",
      action: "bind_claim_source",
      sourceContextId: search.sources[0]!.sourceContextId
    });
    expect(repaired).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_/) });
    const markdown = fs.readFileSync(fixture.claimPath, "utf8");
    expect(markdown).toContain(`source_ids: ["${sourceId}"]`);
    expect(markdown).toContain(`  evidence: ["${sourceId}#source"]`);
    expect(fixture.operations).toHaveLength(1);
    expect(fixture.operations[0]).toMatchObject({
      kind: "update_page",
      targetRefs: [{ kind: "page", id: claimPageId }],
      reversible: "yes"
    });
  });

  it("fails closed when the chosen SourceRecord or claim revision drifts", () => {
    const fixture = createFixture();
    const report = fixture.service.project(fixture.vaultPath, runRequest, readyReport());
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId ||
      !issue.claimRevision || !issue.claimRenderProof) throw new Error("Expected repair proof.");
    const proof = { apiVersion: 1 as const, activeVaultId: vaultId, reportRequestId: report.requestId,
      indexGeneration, issueKind: "unsourced_claim" as const, pageId: claimPageId,
      repairContextId: issue.repairContextId, claimRevision: issue.claimRevision,
      claimRenderProof: issue.claimRenderProof };
    const search = fixture.service.search(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_search_driftabcdefghijk", query: "" });
    if (search.status !== "ready") throw new Error("Expected source choices.");
    const before = fs.readFileSync(fixture.claimPath, "utf8");
    const record = JSON.parse(fs.readFileSync(fixture.recordPath, "utf8"));
    fs.writeFileSync(fixture.recordPath, JSON.stringify({ ...record, updatedAt: "2026-07-31T12:01:00.000Z" }));
    expect(fixture.service.repair(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_repair_driftabcdefghijk", action: "bind_claim_source",
      sourceContextId: search.sources[0]!.sourceContextId })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.claimPath, "utf8")).toBe(before);
    expect(fixture.operations).toHaveLength(0);
  });
});

function createFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-claim-source-"));
  roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "sources"), { recursive: true });
  const claimPath = path.join(vaultPath, "wiki", `${claimPageId}.md`);
  fs.writeFileSync(claimPath, claimMarkdown(), "utf8");
  const sourcePath = path.join(vaultPath, "sources", `${sourcePageId}.md`);
  fs.writeFileSync(sourcePath, sourceMarkdown(), "utf8");
  const recordPath = path.join(vaultPath, ".pige", "source-records", "2026", "07", `${sourceId}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify({ schemaVersion: 1, id: sourceId, kind: "text",
    storageStrategy: "reference_original", semanticOrchestration: "agent_turn",
    knowledgePageId: sourcePageId, knowledgePagePath: `sources/${sourcePageId}.md`,
    original: { uri: `pige-test://${sourceId}` }, artifacts: [], metadata: {},
    createdAt: "2026-07-31T12:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z" }), "utf8");
  const operations: OperationRecord[] = [];
  const vaults = { current: () => ({ vaultId } as never), activeVaultPath: () => vaultPath };
  const activity: NoteMarkdownEditorActivityPort = { recordPageUpdate: ({ operation }) => operations.push(operation) };
  const editor = new NoteMarkdownEditorService(vaults, activity, {
    now: () => new Date("2026-07-31T12:30:00.000Z"), randomId: () => "claim-source-operation",
    allowClaim: true
  });
  const snapshot = () => readySnapshot();
  return { vaultPath, claimPath, recordPath, operations,
    service: new KnowledgeHealthUnsourcedClaimService(snapshotPort(snapshot), editor,
      () => "2026-07-31T12:30:00.000Z", () => "claim-source-context") };
}

function snapshotPort(snapshot: () => ReturnType<typeof readySnapshot>) {
  return { knowledgeHealth: () => snapshot() };
}

function readySnapshot() {
  return { indexGeneration, invalidPageCount: 0, counts: { totalIssueCount: 1,
    brokenLinkPageCount: 0, unresolvedLinkCount: 0, orphanPageCount: 0,
    duplicateTopicGroupCount: 0, unsourcedClaimCount: 1 }, issues: [{ kind: "unsourced_claim" as const,
    page: { pageId: claimPageId, title: "Unsupported claim" } }], truncated: false };
}

function readyReport() {
  return { ...runRequest, status: "ready" as const, checkedAt: "2026-07-31T12:00:00.000Z",
    indexGeneration, coverage: "complete" as const, invalidPageCount: 0, counts: readySnapshot().counts,
    issues: readySnapshot().issues, truncated: false };
}

function claimMarkdown(): string {
  return `---\nid: "${claimPageId}"\nschema_version: 1\ntitle: "Unsupported claim"\ntype: "claim"\ncreated_at: "2026-07-31T12:00:00.000Z"\nupdated_at: "2026-07-31T12:00:00.000Z"\nstatus: "needs_review"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []\n---\n\n# Unsupported claim\n\nA claim awaiting a real source.\n`;
}

function sourceMarkdown(): string {
  return `---\nid: "${sourcePageId}"\nschema_version: 1\ntitle: "Evidence source"\ntype: "source"\ncreated_at: "2026-07-31T12:00:00.000Z"\nupdated_at: "2026-07-31T12:00:00.000Z"\nstatus: "active"\nsource_ids: ["${sourceId}"]\n---\n\n# Evidence source\n`;
}
