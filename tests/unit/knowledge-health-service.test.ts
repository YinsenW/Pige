import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES, type OperationRecord } from "@pige/schemas";
import { KnowledgeHealthService } from
  "../../apps/desktop/src/main/services/knowledge-health-service";
import { LocalDatabaseService } from
  "../../apps/desktop/src/main/services/local-database-service";
import {
  NoteMarkdownEditorActivityAdapter,
  NoteMarkdownEditorService,
  type NoteMarkdownEditorActivityPort
} from "../../apps/desktop/src/main/services/note-markdown-editor-service";
import { NoteMarkdownEditorRedoService } from
  "../../apps/desktop/src/main/services/note-markdown-editor-redo-service";

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
    if (!isRepairable(issue)) {
      throw new Error("Expected an eligible repair context.");
    }

    const result = fixture.service.repair(fixture.vaultPath, {
      ...repairProof(report, issue),
      requestId: "knowledge_health_repair_request_abcdefghijklmnop",
      action: "unlink_broken_reference"
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
    if (!isRepairable(issue)) {
      throw new Error("Expected an eligible repair context.");
    }
    fixture.setIndexGeneration("2026-07-27T12:31:00.000Z#successorgeneration");

    expect(fixture.service.repair(fixture.vaultPath, {
      ...repairProof(report, issue),
      requestId: "knowledge_health_repair_request_staleabcdefghijklmnop",
      action: "unlink_broken_reference"
    })).toMatchObject({ status: "stale" });
    expect(fixture.operations).toEqual([]);

    const externallyChanged = createRepairFixture("See [[Missing Page]].", "Missing Page");
    const freshReport = externallyChanged.service.run(externallyChanged.vaultPath, request);
    if (freshReport.status !== "ready") throw new Error("Expected a ready report.");
    const freshIssue = freshReport.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(freshIssue)) {
      throw new Error("Expected an eligible repair context.");
    }
    fs.writeFileSync(
      externallyChanged.pagePath,
      externallyChanged.markdown.replace("See ", "Externally changed "),
      "utf8"
    );
    expect(externallyChanged.service.repair(externallyChanged.vaultPath, {
      ...repairProof(freshReport, freshIssue),
      requestId: "knowledge_health_repair_request_revisionabcdefghijkl",
      action: "unlink_broken_reference"
    })).toMatchObject({ status: "stale" });
    expect(externallyChanged.operations).toEqual([]);
  });

  it("invalidates the prior report context and mints a fresh eligible context on rerun", () => {
    const fixture = createRepairFixture("See [[Missing Page]].", "Missing Page", true);
    const first = fixture.service.run(fixture.vaultPath, request);
    if (first.status !== "ready") throw new Error("Expected a ready report.");
    const firstIssue = first.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(firstIssue)) {
      throw new Error("Expected the first repair context.");
    }
    const firstSearch = fixture.service.searchTargets(fixture.vaultPath, {
      ...repairProof(first, firstIssue),
      requestId: "knowledge_health_target_search_firstcontextabcd",
      query: ""
    });
    if (firstSearch.status !== "ready" || firstSearch.targets.length !== 1) {
      throw new Error("Expected the first target proof.");
    }
    const firstTarget = firstSearch.targets[0]!;
    const second = fixture.service.run(fixture.vaultPath, {
      ...request,
      requestId: "knowledge_health_request_rerunabcdefghijkl"
    });
    if (second.status !== "ready") throw new Error("Expected a ready rerun.");
    const secondIssue = second.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(secondIssue)) {
      throw new Error("Expected the replacement repair context.");
    }
    expect(secondIssue.repairContextId).not.toBe(firstIssue.repairContextId);

    expect(fixture.service.repair(fixture.vaultPath, {
      ...repairProof(first, firstIssue),
      requestId: "knowledge_health_repair_request_oldcontextabcdef",
      action: "retarget_broken_reference",
      targetPageId: firstTarget.page.pageId,
      targetContextId: firstTarget.targetContextId,
      targetRevision: firstTarget.targetRevision,
      targetRenderProof: firstTarget.targetRenderProof
    })).toEqual({
      ...repairProof(first, firstIssue),
      requestId: "knowledge_health_repair_request_oldcontextabcdef",
      action: "retarget_broken_reference",
      targetPageId: firstTarget.page.pageId,
      targetContextId: firstTarget.targetContextId,
      targetRevision: firstTarget.targetRevision,
      targetRenderProof: firstTarget.targetRenderProof,
      status: "not_found"
    });
    expect(fixture.operations).toEqual([]);
  });

  it("retargets one explicit current note and preserves Activity and restart-safe Undo", () => {
    const fixture = createRepairFixture("See [[Missing Page|missing context]] now.", "Missing Page", true);
    const report = fixture.service.run(fixture.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(issue)) throw new Error("Expected an eligible repair context.");
    const searchRequest = {
      ...repairProof(report, issue),
      requestId: "knowledge_health_target_search_abcdefghijklmnop",
      query: "current"
    } as const;
    const searched = fixture.service.searchTargets(fixture.vaultPath, searchRequest);
    expect(searched.status).toBe("ready");
    if (searched.status !== "ready" || searched.targets.length !== 1) {
      throw new Error("Expected one explicit current target.");
    }
    const target = searched.targets[0]!;
    expect(JSON.stringify(searched)).not.toContain(fixture.vaultPath);
    expect(JSON.stringify(searched)).not.toContain("Target body");

    const result = fixture.service.repair(fixture.vaultPath, {
      ...repairProof(report, issue),
      requestId: "knowledge_health_repair_request_retargetabcdefgh",
      action: "retarget_broken_reference",
      targetPageId: target.page.pageId,
      targetContextId: target.targetContextId,
      targetRevision: target.targetRevision,
      targetRenderProof: target.targetRenderProof
    });
    expect(result).toMatchObject({ status: "committed", action: "retarget_broken_reference" });
    if (result.status !== "committed") throw new Error("Expected a committed retarget.");
    expect(fs.readFileSync(fixture.pagePath, "utf8"))
      .toContain(`See [[${fixture.targetPageId}|missing context]] now.`);
    expect(JSON.stringify(result)).not.toContain(fixture.vaultPath);

    const operation = readOperation(fixture.vaultPath, result.operationId);
    const restartedActivity = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
    expect(restartedActivity.activitySummary(operation)).toMatchObject({
      operationId: result.operationId,
      kind: "update_page",
      status: "applied",
      canUndo: true
    });
    expect(restartedActivity.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(restartedActivity.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("fails stale without mutation when an explicitly selected target changes", () => {
    const fixture = createRepairFixture("See [[Missing Page]].", "Missing Page", true);
    const report = fixture.service.run(fixture.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(issue)) throw new Error("Expected an eligible repair context.");
    const searched = fixture.service.searchTargets(fixture.vaultPath, {
      ...repairProof(report, issue),
      requestId: "knowledge_health_target_search_targetdriftabcdefgh",
      query: ""
    });
    if (searched.status !== "ready" || searched.targets.length !== 1) throw new Error("Expected a target.");
    const target = searched.targets[0]!;
    fs.writeFileSync(fixture.targetPagePath, fixture.targetMarkdown.replace("Target body.", "Changed target."), "utf8");

    expect(fixture.service.repair(fixture.vaultPath, {
      ...repairProof(report, issue),
      requestId: "knowledge_health_repair_request_targetdriftabcdefgh",
      action: "retarget_broken_reference",
      targetPageId: target.page.pageId,
      targetContextId: target.targetContextId,
      targetRevision: target.targetRevision,
      targetRenderProof: target.targetRenderProof
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
    expect(fixture.operations).toEqual([]);

    const sourceDrift = createRepairFixture("See [[Missing Page]].", "Missing Page", true);
    const sourceReport = sourceDrift.service.run(sourceDrift.vaultPath, request);
    if (sourceReport.status !== "ready") throw new Error("Expected a ready report.");
    const sourceIssue = sourceReport.issues.find((entry) => entry.kind === "broken_link");
    if (!isRepairable(sourceIssue)) throw new Error("Expected an eligible repair context.");
    fs.writeFileSync(sourceDrift.pagePath, sourceDrift.markdown.replace("See ", "Changed "), "utf8");
    expect(sourceDrift.service.searchTargets(sourceDrift.vaultPath, {
      ...repairProof(sourceReport, sourceIssue),
      requestId: "knowledge_health_target_search_sourcedriftabcde",
      query: ""
    })).toMatchObject({ status: "stale" });
  });

  it("connects one explicitly selected current parent and preserves restart-safe Activity and Undo", () => {
    const fixture = createOrphanFixture();
    const report = fixture.service.run(fixture.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const orphan = report.issues.find((issue) => issue.kind === "orphan_page");
    if (!isRepairableOrphan(orphan)) throw new Error("Expected an eligible orphan repair.");
    const searchRequest = {
      ...orphanProof(report, orphan),
      requestId: "knowledge_health_orphan_parent_search_abcdefghijklmnop",
      query: "entry"
    } as const;
    const searched = fixture.service.searchOrphanParents(fixture.vaultPath, searchRequest);
    expect(searched.status).toBe("ready");
    if (searched.status !== "ready" || searched.parents.length !== 1) throw new Error("Expected one parent.");
    const parent = searched.parents[0]!;
    expect(parent.page).toEqual({ pageId: fixture.parentPageId, title: "Entry note" });
    expect(JSON.stringify(searched)).not.toContain(fixture.vaultPath);
    expect(JSON.stringify(searched)).not.toContain("Parent body");

    const result = fixture.service.repairOrphan(fixture.vaultPath, {
      ...orphanProof(report, orphan),
      requestId: "knowledge_health_orphan_repair_request_abcdefghijklmnop",
      action: "connect_orphan_to_parent",
      sourcePageId: parent.page.pageId,
      sourceContextId: parent.sourceContextId,
      sourceRevision: parent.sourceRevision,
      sourceRenderProof: parent.sourceRenderProof
    });
    expect(result).toMatchObject({ status: "committed", sourcePageId: fixture.parentPageId });
    if (result.status !== "committed") throw new Error("Expected an orphan repair commit.");
    const connected = fs.readFileSync(fixture.parentPagePath, "utf8");
    expect(connected).toContain(`related_page_ids: ["${fixture.orphanPageId}"]`);
    expect(connected).toContain(`](#wiki:${fixture.orphanPageId})`);
    expect(connected).toContain("<!-- pige:managed:start knowledge-health-orphan ");
    expect(fs.readFileSync(fixture.orphanPagePath, "utf8")).toBe(fixture.orphanMarkdown);
    expect(JSON.stringify(result)).not.toContain(fixture.vaultPath);

    const rebuilt = new LocalDatabaseService();
    rebuilt.rebuild(fixture.vaultPath);
    expect(rebuilt.knowledgeHealth(fixture.vaultPath)?.issues.some((issue) =>
      issue.kind === "orphan_page" && issue.page.pageId === fixture.orphanPageId)).toBe(false);

    const operation = readOperation(fixture.vaultPath, result.operationId);
    const restarted = new NoteMarkdownEditorActivityAdapter(fixture.vaults);
    expect(restarted.activitySummary(operation)).toMatchObject({
      kind: "update_page", status: "applied", canUndo: true
    });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 0, failed: 0 });
    expect(restarted.undo(operation)).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.parentPagePath, "utf8")).toBe(fixture.parentMarkdown);
    rebuilt.rebuild(fixture.vaultPath);
    expect(rebuilt.knowledgeHealth(fixture.vaultPath)?.issues.some((issue) =>
      issue.kind === "orphan_page" && issue.page.pageId === fixture.orphanPageId)).toBe(true);

    const redone = new NoteMarkdownEditorRedoService(fixture.vaults).redo({
      operationId: operation.id,
      expectedRevisionId: operation.before?.id
    });
    expect(redone).toMatchObject({ status: "redone" });
    expect(fs.readFileSync(fixture.parentPagePath, "utf8")).toContain(
      `](#wiki:${fixture.orphanPageId})`
    );
    rebuilt.rebuild(fixture.vaultPath);
    expect(rebuilt.knowledgeHealth(fixture.vaultPath)?.issues.some((issue) =>
      issue.kind === "orphan_page" && issue.page.pageId === fixture.orphanPageId)).toBe(false);
  });

  it("fails closed for target/parent drift and report-epoch replay without mutating either page", () => {
    const indexDrift = createOrphanFixture();
    const indexReport = indexDrift.service.run(indexDrift.vaultPath, request);
    if (indexReport.status !== "ready") throw new Error("Expected a ready report.");
    const indexOrphan = indexReport.issues.find((issue) => issue.kind === "orphan_page");
    if (!isRepairableOrphan(indexOrphan)) throw new Error("Expected repair proof.");
    indexDrift.setIndexGeneration("2026-07-31T12:31:00.000Z#orphanindexsuccessor");
    expect(indexDrift.service.searchOrphanParents(indexDrift.vaultPath, {
      ...orphanProof(indexReport, indexOrphan),
      requestId: "knowledge_health_orphan_parent_search_indexabcdefghijk",
      query: ""
    })).toMatchObject({ status: "stale" });

    const targetDrift = createOrphanFixture();
    const report = targetDrift.service.run(targetDrift.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const orphan = report.issues.find((issue) => issue.kind === "orphan_page");
    if (!isRepairableOrphan(orphan)) throw new Error("Expected repair proof.");
    const searched = targetDrift.service.searchOrphanParents(targetDrift.vaultPath, {
      ...orphanProof(report, orphan),
      requestId: "knowledge_health_orphan_parent_search_driftabcdefghijk",
      query: ""
    });
    if (searched.status !== "ready" || searched.parents.length !== 1) throw new Error("Expected a parent.");
    const parent = searched.parents[0]!;
    fs.writeFileSync(targetDrift.orphanPagePath, targetDrift.orphanMarkdown.replace("Orphan body", "Changed body"));
    const repairRequest = {
      ...orphanProof(report, orphan),
      requestId: "knowledge_health_orphan_repair_request_driftabcdefghijk",
      action: "connect_orphan_to_parent" as const,
      sourcePageId: parent.page.pageId,
      sourceContextId: parent.sourceContextId,
      sourceRevision: parent.sourceRevision,
      sourceRenderProof: parent.sourceRenderProof
    };
    expect(targetDrift.service.repairOrphan(targetDrift.vaultPath, repairRequest))
      .toMatchObject({ status: "stale" });
    expect(fs.readFileSync(targetDrift.parentPagePath, "utf8")).toBe(targetDrift.parentMarkdown);

    const parentDrift = createOrphanFixture();
    const parentReport = parentDrift.service.run(parentDrift.vaultPath, request);
    if (parentReport.status !== "ready") throw new Error("Expected a ready report.");
    const parentOrphan = parentReport.issues.find((issue) => issue.kind === "orphan_page");
    if (!isRepairableOrphan(parentOrphan)) throw new Error("Expected repair proof.");
    const parentSearch = parentDrift.service.searchOrphanParents(parentDrift.vaultPath, {
      ...orphanProof(parentReport, parentOrphan),
      requestId: "knowledge_health_orphan_parent_search_parentabcdefghij",
      query: ""
    });
    if (parentSearch.status !== "ready" || parentSearch.parents.length !== 1) throw new Error("Expected a parent.");
    const selected = parentSearch.parents[0]!;
    fs.writeFileSync(parentDrift.parentPagePath, parentDrift.parentMarkdown.replace("Parent body", "Changed parent"));
    expect(parentDrift.service.repairOrphan(parentDrift.vaultPath, {
      ...orphanProof(parentReport, parentOrphan),
      requestId: "knowledge_health_orphan_repair_request_parentabcdefghij",
      action: "connect_orphan_to_parent",
      sourcePageId: selected.page.pageId,
      sourceContextId: selected.sourceContextId,
      sourceRevision: selected.sourceRevision,
      sourceRenderProof: selected.sourceRenderProof
    })).toMatchObject({ status: "stale" });

    parentDrift.service.run(parentDrift.vaultPath, {
      ...request,
      requestId: "knowledge_health_request_orphanrerunabcde"
    });
    expect(parentDrift.service.repairOrphan(parentDrift.vaultPath, {
      ...orphanProof(parentReport, parentOrphan),
      requestId: "knowledge_health_orphan_repair_request_replayabcdefghij",
      action: "connect_orphan_to_parent",
      sourcePageId: selected.page.pageId,
      sourceContextId: selected.sourceContextId,
      sourceRevision: selected.sourceRevision,
      sourceRenderProof: selected.sourceRenderProof
    })).toMatchObject({ status: "not_found" });
    expect(fs.readFileSync(parentDrift.orphanPagePath, "utf8")).toBe(parentDrift.orphanMarkdown);
  });

  it("repairs only the explicitly selected occurrence on a page with repeated broken links", () => {
    const fixture = createRepairFixture(
      "First [[Missing Page|first label]], then [[Missing Page|second label]].",
      "Missing Page"
    );
    const report = fixture.service.run(fixture.vaultPath, request);
    if (report.status !== "ready") throw new Error("Expected a ready report.");
    const issue = report.issues.find((entry) => entry.kind === "broken_link");
    if (issue?.kind !== "broken_link" || issue.repairableOccurrences?.length !== 2) {
      throw new Error("Expected two exact repairable occurrences.");
    }
    expect(issue.repairableOccurrences.map(({ ordinal, displayLabel }) => ({ ordinal, displayLabel })))
      .toEqual([
        { ordinal: 1, displayLabel: "first label" },
        { ordinal: 2, displayLabel: "second label" }
      ]);
    const selected = issue.repairableOccurrences[1]!;
    const result = fixture.service.repair(fixture.vaultPath, {
      apiVersion: 1,
      requestId: "knowledge_health_repair_request_selectedoccurrence",
      activeVaultId: report.activeVaultId,
      reportRequestId: report.requestId,
      indexGeneration: report.indexGeneration,
      issueKind: "broken_link",
      pageId: issue.page.pageId,
      action: "unlink_broken_reference",
      repairContextId: selected.repairContextId,
      sourceRevision: selected.sourceRevision,
      sourceRenderProof: selected.sourceRenderProof,
      occurrenceId: selected.occurrenceId
    });
    expect(result).toMatchObject({ status: "committed" });
    expect(fs.readFileSync(fixture.pagePath, "utf8"))
      .toContain("First [[Missing Page|first label]], then second label.");
    expect(fixture.operations).toHaveLength(1);
  });

  it("offers only exact safe forms and projects each duplicate occurrence independently", () => {
    for (const [body, target, eligibleCount] of [
      ["[[Missing Page]]", "Missing Page", 1],
      ["[[Missing Page|plain label]]", "Missing Page", 1],
      ["[plain label](missing-local-target.md)", "missing-local-target.md", 1],
      ["`[[Missing Page]]`", "Missing Page", 0],
      ["![[Missing Page]]", "Missing Page", 0],
      ["![plain label](missing-local-target.md)", "missing-local-target.md", 0],
      ["[[Missing Page|**complex**]]", "Missing Page", 0],
      ["[[Missing Page|nested [label]]]", "Missing Page", 0],
      ["[[Missing Page]] and [[Missing Page]]", "Missing Page", 2],
      ["No body link.", "Repair page", 0],
      ["[label](../missing-local-target.md)", "../missing-local-target.md", 0],
      ["[label](https://example.com/missing.md)", "https://example.com/missing.md", 0]
    ] as const) {
      const fixture = createRepairFixture(body, target);
      const report = fixture.service.run(fixture.vaultPath, request);
      if (report.status !== "ready") throw new Error("Expected a ready report.");
      const issue = report.issues.find((entry) => entry.kind === "broken_link");
      expect(issue?.kind === "broken_link" ? issue.repairableOccurrences?.length ?? 0 : 0, body)
        .toBe(eligibleCount);
    }
  });
});

function createRepairFixture(body: string, target: string, persistentActivity = false) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-health-repair-"));
  roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  const pagePath = path.join(vaultPath, "wiki", `${pageId}.md`);
  const markdown = `---\nid: ${pageId}\nschema_version: 1\ntitle: Repair page\ntype: note\ncreated_at: 2026-07-27T12:00:00.000Z\nupdated_at: 2026-07-27T12:00:00.000Z\nstatus: active\n---\n${body}\n`;
  fs.writeFileSync(pagePath, markdown, "utf8");
  const targetPageId = "page_20260727_currenttarget";
  const targetPagePath = path.join(vaultPath, "wiki", `${targetPageId}.md`);
  const targetMarkdown = `---\nid: ${targetPageId}\nschema_version: 1\ntitle: Current target\ntype: note\ncreated_at: 2026-07-27T12:00:00.000Z\nupdated_at: 2026-07-27T12:00:00.000Z\nstatus: active\n---\nTarget body.\n`;
  if (persistentActivity) fs.writeFileSync(targetPagePath, targetMarkdown, "utf8");
  const operations: OperationRecord[] = [];
  const vaults = {
    current: () => ({ vaultId: request.activeVaultId } as never),
    activeVaultPath: () => vaultPath
  };
  const activity: NoteMarkdownEditorActivityPort = persistentActivity
    ? new NoteMarkdownEditorActivityAdapter(vaults)
    : {
    recordPageUpdate: ({ operation }) => operations.push(operation)
  };
  const editor = new NoteMarkdownEditorService(vaults, activity, {
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
    repairTargetsByPageId: new Map([[pageId, [target]]]),
    truncated: false
  });
  return {
    vaultPath,
    pagePath,
    markdown,
    targetPageId,
    targetPagePath,
    targetMarkdown,
    vaults,
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

function isRepairable(issue: unknown): issue is {
  readonly kind: "broken_link";
  readonly page: { readonly pageId: string };
  readonly repairContextId: string;
  readonly sourceRevision: `noteeditrev_${string}`;
  readonly sourceRenderProof: `knowledge_health_render_${string}`;
  readonly occurrenceId: `knowledge_health_occurrence_${string}`;
} {
  if (!issue || typeof issue !== "object") return false;
  const value = issue as Record<string, unknown>;
  return value.kind === "broken_link" && typeof value.repairContextId === "string" &&
    typeof value.sourceRevision === "string" && typeof value.sourceRenderProof === "string" &&
    typeof value.occurrenceId === "string";
}

function repairProof(
  report: Extract<ReturnType<KnowledgeHealthService["run"]>, { readonly status: "ready" }>,
  issue: ReturnType<typeof requireRepairable>
) {
  return {
    apiVersion: 1 as const,
    activeVaultId: report.activeVaultId,
    reportRequestId: report.requestId,
    indexGeneration: report.indexGeneration,
    issueKind: "broken_link" as const,
    pageId: issue.page.pageId,
    repairContextId: issue.repairContextId,
    sourceRevision: issue.sourceRevision,
    sourceRenderProof: issue.sourceRenderProof,
    occurrenceId: issue.occurrenceId
  };
}

function requireRepairable(issue: unknown) {
  if (!isRepairable(issue)) throw new Error("Expected repair proof.");
  return issue;
}

function createOrphanFixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-health-orphan-"));
  roots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "wiki"), { recursive: true });
  const orphanPageId = "page_20260731_orphantarget";
  const parentPageId = "page_20260731_entryparent";
  const orphanPagePath = path.join(vaultPath, "wiki", `${orphanPageId}.md`);
  const parentPagePath = path.join(vaultPath, "wiki", `${parentPageId}.md`);
  const orphanMarkdown = noteMarkdown(orphanPageId, "Orphan target", "Orphan body.");
  const parentMarkdown = noteMarkdown(parentPageId, "Entry note", "Parent body.");
  fs.writeFileSync(orphanPagePath, orphanMarkdown, "utf8");
  fs.writeFileSync(parentPagePath, parentMarkdown, "utf8");
  const vaults = {
    current: () => ({ vaultId: request.activeVaultId } as never),
    activeVaultPath: () => vaultPath
  };
  const activity = new NoteMarkdownEditorActivityAdapter(vaults);
  const editor = new NoteMarkdownEditorService(vaults, activity, {
    now: () => new Date("2026-07-31T12:30:00.000Z"),
    randomId: () => "orphan-activity-fixture"
  });
  let currentIndexGeneration = indexGeneration;
  const snapshot = () => ({
    indexGeneration: currentIndexGeneration,
    invalidPageCount: 0,
    counts: {
      totalIssueCount: 1,
      brokenLinkPageCount: 0,
      unresolvedLinkCount: 0,
      orphanPageCount: 1,
      duplicateTopicGroupCount: 0,
      unsourcedClaimCount: 0
    },
    issues: [{
      kind: "orphan_page" as const,
      page: { pageId: orphanPageId, title: "Orphan target" }
    }],
    truncated: false
  });
  return {
    vaultPath,
    vaults,
    orphanPageId,
    parentPageId,
    orphanPagePath,
    parentPagePath,
    orphanMarkdown,
    parentMarkdown,
    setIndexGeneration: (value: string) => { currentIndexGeneration = value; },
    service: new KnowledgeHealthService(
      { knowledgeHealth: snapshot },
      () => "2026-07-31T12:30:00.000Z",
      editor,
      () => "orphan-context-fixture"
    )
  };
}

function noteMarkdown(pageId: string, title: string, body: string): string {
  return `---\nid: ${JSON.stringify(pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(title)}\ntype: "note"\ncreated_at: "2026-07-31T12:00:00.000Z"\nupdated_at: "2026-07-31T12:00:00.000Z"\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "user"\nnote:\n  note_kind: "user"\n  review_state: "clean"\n---\n\n# ${title}\n\n${body}\n`;
}

function isRepairableOrphan(issue: unknown): issue is {
  readonly kind: "orphan_page";
  readonly page: { readonly pageId: string };
  readonly repairContextId: string;
  readonly targetRevision: `noteeditrev_${string}`;
  readonly targetRenderProof: `knowledge_health_render_${string}`;
} {
  if (!issue || typeof issue !== "object") return false;
  const value = issue as Record<string, unknown>;
  return value.kind === "orphan_page" && typeof value.repairContextId === "string" &&
    typeof value.targetRevision === "string" && typeof value.targetRenderProof === "string";
}

function orphanProof(
  report: Extract<ReturnType<KnowledgeHealthService["run"]>, { readonly status: "ready" }>,
  issue: {
    readonly kind: "orphan_page";
    readonly page: { readonly pageId: string };
    readonly repairContextId: string;
    readonly targetRevision: `noteeditrev_${string}`;
    readonly targetRenderProof: `knowledge_health_render_${string}`;
  }
) {
  return {
    apiVersion: 1 as const,
    activeVaultId: report.activeVaultId,
    reportRequestId: report.requestId,
    indexGeneration: report.indexGeneration,
    issueKind: "orphan_page" as const,
    pageId: issue.page.pageId,
    repairContextId: issue.repairContextId,
    targetRevision: issue.targetRevision,
    targetRenderProof: issue.targetRenderProof
  };
}
function readOperation(vaultPath: string, operationId: string): OperationRecord {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid Operation identity.");
  return JSON.parse(fs.readFileSync(path.join(
    vaultPath, ".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`
  ), "utf8")) as OperationRecord;
}
