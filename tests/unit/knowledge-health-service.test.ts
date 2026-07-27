import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES, type OperationRecord } from "@pige/schemas";
import { KnowledgeHealthService } from
  "../../apps/desktop/src/main/services/knowledge-health-service";
import {
  NoteMarkdownEditorService,
  type NoteMarkdownEditorActivityPort
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";

const request = {
  apiVersion: 1,
  requestId: "knowledge_health_request_abcdefghijklmnop",
  activeVaultId: "vault_20260727_healthtest"
} as const;
const pageId = "page_20260727_healthrepair";
const indexGeneration = "2026-07-27T12:00:00.000Z#abcdefghijklmnop";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("KnowledgeHealthService", () => {
  it("projects complete and partial derived reports without persistence", () => {
    const service = new KnowledgeHealthService({
      knowledgeHealth: () => ({
        indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
        invalidPageCount: 1,
        counts: {
          totalIssueCount: 1,
          brokenLinkPageCount: 1,
          unresolvedLinkCount: 2,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [{
          kind: "broken_link",
          page: { pageId: "page_20260727_healthaa", title: "Health" },
          unresolvedLinkCount: 2
        }],
        truncated: false
      })
    }, () => "2026-07-27T12:30:00.000Z");

    expect(service.run("/private/vault", request)).toEqual({
      ...request,
      status: "ready",
      checkedAt: "2026-07-27T12:30:00.000Z",
      indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
      coverage: "partial",
      invalidPageCount: 1,
      counts: {
        totalIssueCount: 1,
        brokenLinkPageCount: 1,
        unresolvedLinkCount: 2,
        orphanPageCount: 0,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues: [{
        kind: "broken_link",
        page: { pageId: "page_20260727_healthaa", title: "Health" },
        unresolvedLinkCount: 2
      }],
      truncated: false
    });
  });

  it("returns body-free unavailable and failed results", () => {
    expect(new KnowledgeHealthService({ knowledgeHealth: () => undefined })
      .run("/private/vault", request)).toEqual({ ...request, status: "unavailable" });
    expect(new KnowledgeHealthService({ knowledgeHealth: () => { throw new Error("/private/body"); } })
      .run("/private/vault", request)).toEqual({ ...request, status: "failed" });
  });

  it("trims projected issues to the strict UTF-8 result bound", () => {
    const issues = Array.from({ length: 100 }, (_, group) => {
      const pages = Array.from({ length: 8 }, (_, page) => {
        const suffix = (group * 8 + page).toString(36).padStart(8, "0");
        return { pageId: `page_20260727_${suffix}`, title: "x".repeat(512) };
      });
      return { kind: "duplicate_topic" as const, candidatePageCount: 8, pages };
    });
    const service = new KnowledgeHealthService({
      knowledgeHealth: () => ({
        indexGeneration: "2026-07-27T12:00:00.000Z#abcdefghijklmnop",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 100,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 100,
          unsourcedClaimCount: 0
        },
        issues,
        truncated: false
      })
    }, () => "2026-07-27T12:30:00.000Z");

    const result = service.run("/private/vault", request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected a ready report.");
    expect(result.truncated).toBe(true);
    expect(result.issues.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8"))
      .toBeLessThanOrEqual(KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES);
  });

  it("commits one exact unlink through the durable update_page owner", () => {
    const fixture = createRepairFixture("See [[Missing Page|missing context]] now.", "Missing Page");
    const report = fixture.service.run(fixture.vaultPath, request);
    expect(report.status).toBe("ready");
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues.find((entry) => entry.kind === "broken_link");
    if (!issue || issue.kind !== "broken_link" || !issue.repairContextId) {
      throw new Error("Expected an eligible repair context.");
    }

    const result = fixture.service.repair(fixture.vaultPath, {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_abcdefghijklmnop",
      activeVaultId: request.activeVaultId,
      indexGeneration,
      issueKind: "broken_link",
      pageId,
      action: "unlink_broken_reference",
      repairContextId: issue.repairContextId
    });

    expect(result).toMatchObject({ status: "committed", pageId });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("See missing context now.");
    expect(fixture.operations).toHaveLength(1);
    expect(fixture.operations[0]).toMatchObject({ kind: "update_page", reversible: "yes" });
  });

  it("fails stale before mutation when the report generation or page revision changes", () => {
    const fixture = createRepairFixture("See [[Missing Page]].", "Missing Page");
    const report = fixture.service.run(fixture.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues.find((entry) => entry.kind === "broken_link");
    if (!issue || issue.kind !== "broken_link" || !issue.repairContextId) {
      throw new Error("Expected an eligible repair context.");
    }
    fixture.setIndexGeneration("2026-07-27T12:31:00.000Z#successorgeneration");

    expect(fixture.service.repair(fixture.vaultPath, {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_staleabcdefghijklmnop",
      activeVaultId: request.activeVaultId,
      indexGeneration,
      issueKind: "broken_link",
      pageId,
      action: "unlink_broken_reference",
      repairContextId: issue.repairContextId
    })).toMatchObject({ status: "stale" });
    expect(fixture.operations).toEqual([]);

    const externallyChanged = createRepairFixture("See [[Missing Page]].", "Missing Page");
    const freshReport = externallyChanged.service.run(externallyChanged.vaultPath, request);
    if (freshReport.status !== "ready") throw new Error("Expected a ready report.");
    const freshIssue = freshReport.issues.find((entry) => entry.kind === "broken_link");
    if (!freshIssue || freshIssue.kind !== "broken_link" || !freshIssue.repairContextId) {
      throw new Error("Expected an eligible repair context.");
    }
    fs.writeFileSync(
      externallyChanged.pagePath,
      externallyChanged.markdown.replace("See ", "Externally changed "),
      "utf8"
    );
    expect(externallyChanged.service.repair(externallyChanged.vaultPath, {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_revisionabcdefghijkl",
      activeVaultId: request.activeVaultId,
      indexGeneration,
      issueKind: "broken_link",
      pageId,
      action: "unlink_broken_reference",
      repairContextId: freshIssue.repairContextId
    })).toMatchObject({ status: "stale" });
    expect(externallyChanged.operations).toEqual([]);
  });

  it("invalidates the prior report context and mints a fresh eligible context on rerun", () => {
    const fixture = createRepairFixture("See [[Missing Page]].", "Missing Page");
    const first = fixture.service.run(fixture.vaultPath, request);
    if (first.status !== "ready") throw new Error("Expected a ready report.");
    const firstIssue = first.issues.find((entry) => entry.kind === "broken_link");
    if (!firstIssue || firstIssue.kind !== "broken_link" || !firstIssue.repairContextId) {
      throw new Error("Expected the first repair context.");
    }
    const second = fixture.service.run(fixture.vaultPath, {
      ...request,
      requestId: "knowledge_health_request_rerunabcdefghijkl"
    });
    if (second.status !== "ready") throw new Error("Expected a ready rerun.");
    const secondIssue = second.issues.find((entry) => entry.kind === "broken_link");
    if (!secondIssue || secondIssue.kind !== "broken_link" || !secondIssue.repairContextId) {
      throw new Error("Expected the replacement repair context.");
    }
    expect(secondIssue.repairContextId).not.toBe(firstIssue.repairContextId);

    expect(fixture.service.repair(fixture.vaultPath, {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_oldcontextabcdef",
      activeVaultId: request.activeVaultId,
      indexGeneration,
      issueKind: "broken_link",
      pageId,
      action: "unlink_broken_reference",
      repairContextId: firstIssue.repairContextId
    })).toEqual({
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_oldcontextabcdef",
      activeVaultId: request.activeVaultId,
      indexGeneration,
      issueKind: "broken_link",
      pageId,
      action: "unlink_broken_reference",
      repairContextId: firstIssue.repairContextId,
      status: "not_found"
    });
    expect(fixture.operations).toEqual([]);
  });

  it("offers only the three exact forms and excludes unsafe or ambiguous occurrences", () => {
    for (const [body, target, eligible] of [
      ["[[Missing Page]]", "Missing Page", true],
      ["[[Missing Page|plain label]]", "Missing Page", true],
      ["[plain label](missing-local-target.md)", "missing-local-target.md", true],
      ["`[[Missing Page]]`", "Missing Page", false],
      ["![[Missing Page]]", "Missing Page", false],
      ["![plain label](missing-local-target.md)", "missing-local-target.md", false],
      ["[[Missing Page|**complex**]]", "Missing Page", false],
      ["[[Missing Page|nested [label]]]", "Missing Page", false],
      ["[[Missing Page]] and [[Missing Page]]", "Missing Page", false],
      ["No body link.", "Repair page", false],
      ["[label](../missing-local-target.md)", "../missing-local-target.md", false],
      ["[label](https://example.com/missing.md)", "https://example.com/missing.md", false]
    ] as const) {
      const fixture = createRepairFixture(body, target);
      const report = fixture.service.run(fixture.vaultPath, request);
      if (report.status !== "ready") throw new Error("Expected a ready report.");
      const issue = report.issues.find((entry) => entry.kind === "broken_link");
      expect(issue?.kind === "broken_link" && !!issue.repairContextId, body).toBe(eligible);
    }
  });
});

function createRepairFixture(body: string, target: string) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-health-repair-"));
  roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  const pagePath = path.join(vaultPath, "wiki", `${pageId}.md`);
  const markdown = `---\nid: ${pageId}\nschema_version: 1\ntitle: Repair page\ntype: note\ncreated_at: 2026-07-27T12:00:00.000Z\nupdated_at: 2026-07-27T12:00:00.000Z\nstatus: active\n---\n${body}\n`;
  fs.writeFileSync(pagePath, markdown, "utf8");
  const operations: OperationRecord[] = [];
  const activity: NoteMarkdownEditorActivityPort = {
    recordPageUpdate: ({ operation }) => operations.push(operation)
  };
  const editor = new NoteMarkdownEditorService({
    current: () => ({ vaultId: request.activeVaultId } as never),
    activeVaultPath: () => vaultPath
  }, activity, {
    now: () => new Date("2026-07-27T12:30:00.000Z"),
    randomId: () => "11111111-1111-4111-8111-111111111111"
  });
  let currentIndexGeneration = indexGeneration;
  const snapshot = () => ({
    indexGeneration: currentIndexGeneration,
    invalidPageCount: 0,
    counts: {
      totalIssueCount: 1,
      brokenLinkPageCount: 1,
      unresolvedLinkCount: 1,
      orphanPageCount: 0,
      duplicateTopicGroupCount: 0,
      unsourcedClaimCount: 0
    },
    issues: [{
      kind: "broken_link" as const,
      page: { pageId, title: "Repair page" },
      unresolvedLinkCount: 1
    }],
    repairTargetsByPageId: new Map([[pageId, target]]),
    truncated: false
  });
  return {
    vaultPath,
    pagePath,
    markdown,
    operations,
    setIndexGeneration: (value: string) => { currentIndexGeneration = value; },
    service: new KnowledgeHealthService(
      { knowledgeHealth: snapshot },
      () => "2026-07-27T12:30:00.000Z",
      editor,
      () => "22222222-2222-4222-8222-222222222222"
    )
  };
}
