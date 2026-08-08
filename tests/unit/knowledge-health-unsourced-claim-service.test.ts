import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OperationRecord } from "@pige/schemas";
import { KnowledgeHealthUnsourcedClaimService } from
  "../../apps/desktop/src/main/services/knowledge-health-unsourced-claim-service";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService,
  readUserPageUpdateOperations
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
      reportEpoch: report.reportEpoch,
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
    const before = fs.readFileSync(fixture.claimPath, "utf8");

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
    if (repaired.status !== "committed") throw new Error("Expected a committed repair.");
    const operation = readOperation(fixture.vaultPath, repaired.operationId);
    expect(operation).toMatchObject({
      kind: "update_page",
      targetRefs: [{ kind: "page", id: claimPageId }],
      reversible: "yes"
    });
    expect(fixture.activity.activitySummary(operation)).toMatchObject({ kind: "update_page", canUndo: true });
    expect(fixture.activity.undo(operation, operation.after?.id)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.claimPath, "utf8")).toBe(before);
  });

  it("fails closed when the chosen SourceRecord or claim revision drifts", () => {
    const fixture = createFixture();
    const report = fixture.service.project(fixture.vaultPath, runRequest, readyReport());
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId ||
      !issue.claimRevision || !issue.claimRenderProof) throw new Error("Expected repair proof.");
    const proof = { apiVersion: 1 as const, activeVaultId: vaultId, reportRequestId: report.requestId,
      reportEpoch: report.reportEpoch, indexGeneration, issueKind: "unsourced_claim" as const, pageId: claimPageId,
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
    expect(fs.existsSync(path.join(fixture.vaultPath, ".pige", "operations"))).toBe(false);
  });

  it("rejects a claim-source proof from a different report epoch", () => {
    const fixture = createFixture();
    const report = fixture.service.project(fixture.vaultPath, runRequest, readyReport(1));
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId || !issue.claimRevision || !issue.claimRenderProof) {
      throw new Error("Expected repair proof.");
    }
    expect(fixture.service.search(fixture.vaultPath, {
      apiVersion: 1, activeVaultId: vaultId, reportRequestId: report.requestId, reportEpoch: 2,
      indexGeneration, issueKind: "unsourced_claim", pageId: claimPageId, repairContextId: issue.repairContextId,
      claimRevision: issue.claimRevision, claimRenderProof: issue.claimRenderProof,
      requestId: "knowledge_health_claim_source_search_epochabcdefghijklmnop", query: ""
    })).toMatchObject({ status: "stale" });
  });

  it("fails closed when the selected Source Page bytes drift", () => {
    const fixture = createFixture();
    const report = fixture.service.project(fixture.vaultPath, runRequest, readyReport());
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId || !issue.claimRevision || !issue.claimRenderProof) {
      throw new Error("Expected repair proof.");
    }
    const proof = { apiVersion: 1 as const, activeVaultId: vaultId, reportRequestId: report.requestId,
      reportEpoch: report.reportEpoch, indexGeneration, issueKind: "unsourced_claim" as const, pageId: claimPageId,
      repairContextId: issue.repairContextId, claimRevision: issue.claimRevision, claimRenderProof: issue.claimRenderProof };
    const search = fixture.service.search(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_search_sourcedriftabcdefghijkl", query: "Evidence" });
    if (search.status !== "ready") throw new Error("Expected source choices.");
    fs.appendFileSync(fixture.sourcePath, "\nSource changed before confirmation.\n", "utf8");
    expect(fixture.service.repair(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_repair_sourcedriftabcdefghijkl", action: "bind_claim_source",
      sourceContextId: search.sources[0]!.sourceContextId })).toMatchObject({ status: "stale" });
  });

  it("adopts a committed page after a restart when Activity publication is interrupted", () => {
    const fixture = createFixture();
    const durableActivity = fixture.activity;
    const interruptedActivity = {
      preparePageUpdate: durableActivity.preparePageUpdate.bind(durableActivity),
      recordPageUpdate: () => { throw new Error("simulated restart"); },
      abortPageUpdate: durableActivity.abortPageUpdate.bind(durableActivity)
    };
    const interruptedEditor = new NoteMarkdownEditorService(
      { current: () => ({ vaultId } as never), activeVaultPath: () => fixture.vaultPath },
      interruptedActivity,
      { now: () => new Date("2026-07-31T12:30:00.000Z"), randomId: () => "claim-source-operation", allowClaim: true }
    );
    const service = new KnowledgeHealthUnsourcedClaimService(snapshotPort(() => readySnapshot()), interruptedEditor,
      () => "2026-07-31T12:30:00.000Z", () => "claim-source-context");
    const report = service.project(fixture.vaultPath, runRequest, readyReport());
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues[0];
    if (issue?.kind !== "unsourced_claim" || !issue.repairContextId || !issue.claimRevision || !issue.claimRenderProof) {
      throw new Error("Expected repair proof.");
    }
    const proof = { apiVersion: 1 as const, activeVaultId: vaultId, reportRequestId: report.requestId,
      reportEpoch: report.reportEpoch, indexGeneration, issueKind: "unsourced_claim" as const, pageId: claimPageId,
      repairContextId: issue.repairContextId, claimRevision: issue.claimRevision, claimRenderProof: issue.claimRenderProof };
    const search = service.search(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_search_restartabcdefghijklmnop", query: "Evidence" });
    if (search.status !== "ready") throw new Error("Expected source choices.");
    const result = service.repair(fixture.vaultPath, { ...proof,
      requestId: "knowledge_health_claim_source_repair_restartabcdefghijklmnop", action: "bind_claim_source",
      sourceContextId: search.sources[0]!.sourceContextId });
    expect(result).toMatchObject({ status: "committed" });
    expect(fs.readFileSync(fixture.claimPath, "utf8")).toContain(`source_ids: ["${sourceId}"]`);
    const pending = path.join(fixture.vaultPath, ".pige", "operations", "2026", "07");
    expect(fs.readdirSync(pending).some((entry) => entry.endsWith(".pending.json"))).toBe(true);
    const restarted = new NoteMarkdownEditorActivityAdapter({
      current: () => ({ vaultId } as never), activeVaultPath: () => fixture.vaultPath
    });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const operations = readUserPageUpdateOperations(fixture.vaultPath);
    expect(operations).toHaveLength(1);
    expect(restarted.activitySummary(operations[0]!)).toMatchObject({ canUndo: true });
    expect(restarted.undo(operations[0]!, operations[0]!.after?.id)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.claimPath, "utf8")).toContain("source_ids: []");
    expect(fs.readdirSync(pending).some((entry) => entry.endsWith(".pending.json"))).toBe(false);
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
  const vaults = { current: () => ({ vaultId } as never), activeVaultPath: () => vaultPath };
  const activity = new NoteMarkdownEditorActivityAdapter(vaults);
  const editor = new NoteMarkdownEditorService(vaults, activity, {
    now: () => new Date("2026-07-31T12:30:00.000Z"), randomId: () => "claim-source-operation",
    allowClaim: true
  });
  const snapshot = () => readySnapshot();
  return { vaultPath, claimPath, sourcePath, recordPath, activity,
    service: new KnowledgeHealthUnsourcedClaimService(snapshotPort(snapshot), editor,
      () => "2026-07-31T12:30:00.000Z", () => "claim-source-context") };
}

function readOperation(vaultPath: string, operationId: string): OperationRecord {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("Expected a dated operation identity.");
  return JSON.parse(fs.readFileSync(path.join(
    vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6), `${operationId}.json`
  ), "utf8")) as OperationRecord;
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

function readyReport(reportEpoch = 1) {
  return { ...runRequest, status: "ready" as const, checkedAt: "2026-07-31T12:00:00.000Z", reportEpoch,
    indexGeneration, coverage: "complete" as const, invalidPageCount: 0, counts: readySnapshot().counts,
    issues: readySnapshot().issues, truncated: false };
}

function claimMarkdown(): string {
  return `---\nid: "${claimPageId}"\nschema_version: 1\ntitle: "Unsupported claim"\ntype: "claim"\ncreated_at: "2026-07-31T12:00:00.000Z"\nupdated_at: "2026-07-31T12:00:00.000Z"\nstatus: "needs_review"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\nclaim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []\n---\n\n# Unsupported claim\n\nA claim awaiting a real source.\n`;
}

function sourceMarkdown(): string {
  return `---\nid: "${sourcePageId}"\nschema_version: 1\ntitle: "Evidence source"\ntype: "source"\ncreated_at: "2026-07-31T12:00:00.000Z"\nupdated_at: "2026-07-31T12:00:00.000Z"\nstatus: "active"\nsource_ids: ["${sourceId}"]\n---\n\n# Evidence source\n`;
}
