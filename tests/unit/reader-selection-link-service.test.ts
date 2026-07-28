import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReaderSelectionIdentity } from "@pige/contracts";
import {
  applyReaderSelectionLink,
  readReaderSelectionLinkOperation
} from "../../apps/desktop/src/main/services/reader-selection-link-service";
import { readAgentPageUpdateOperationBinding } from "../../apps/desktop/src/main/services/agent-page-update-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { readCurrentNotePageForMutation } from "../../apps/desktop/src/main/services/retrieval-evidence-boundary";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection link service", () => {
  it("atomically appends one provenance-neutral managed link and reversible Operation", () => {
    const fixture = makeFixture();
    const result = applyReaderSelectionLink(fixture.input());
    const markdown = fs.readFileSync(fixture.currentPath, "utf8");

    expect(result).toMatchObject({
      currentPageId: fixture.currentPageId,
      targetPageId: fixture.targetPageId,
      operation: { kind: "update_page", reversible: "yes" }
    });
    expect(markdown).toContain(`related_page_ids: ["${fixture.targetPageId}"]`);
    expect(markdown).toContain(`<!-- pige:managed:start agent-link ${result.operation.id} -->`);
    expect(markdown).toContain(`[Target \\] note](#wiki:${fixture.targetPageId})`);
    expect(markdown).toContain("source_ids: [\"src_20260728_readerlink\"]");
    expect(markdown).toContain('last_job_id: "job_20260728_seedsource"');
    expect(markdown).not.toContain("Preserved source");
    expect(result.operation.sourceRefs).toEqual([
      { kind: "job", id: fixture.job.id },
      expect.objectContaining({
        kind: "artifact",
        id: expect.stringMatching(/^art_reader_selection_[a-f0-9]{16}$/u),
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
      }),
      {
        kind: "page",
        id: fixture.targetPageId,
        path: `wiki/generated/2026/${fixture.targetPageId}.md`,
        checksum: fixture.targetHash
      }
    ]);
    expect(result.operation.before?.path).toContain(".pige/trash/page-updates/");
    expect(readAgentPageUpdateOperationBinding(result.operation)).toMatchObject({
      pageId: fixture.currentPageId,
      relationshipPageId: fixture.targetPageId
    });
    expect(readReaderSelectionLinkOperation({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      selection: fixture.selection,
      targetPage: readCurrentNotePageForMutation(fixture.vaultPath, fixture.targetPageId)
    })?.operation.id).toBe(result.operation.id);
  });

  it("rejects a target that changed after its current-page binding", () => {
    const fixture = makeFixture();
    const input = fixture.input();
    fs.appendFileSync(fixture.targetPath, "\nChanged after binding.\n", "utf8");

    expect(() => applyReaderSelectionLink(input)).toThrowError(
      expect.objectContaining({ code: "agent_ingest.page_conflict" })
    );
    expect(fs.readFileSync(fixture.currentPath, "utf8")).toBe(fixture.currentMarkdown);
  });

  it("rejects self-links and existing directed links", () => {
    const self = makeFixture();
    const selfInput = self.input();
    expect(() => applyReaderSelectionLink({ ...selfInput, targetPage: selfInput.currentPage }))
      .toThrowError(expect.objectContaining({ code: "agent_ingest.relationship_target_invalid" }));

    const existing = makeFixture(true);
    expect(() => applyReaderSelectionLink(existing.input()))
      .toThrowError(expect.objectContaining({ code: "agent_ingest.relationship_exists" }));
    expect(fs.readFileSync(existing.currentPath, "utf8")).toBe(existing.currentMarkdown);
  });

  it("idempotently adopts the same published link and commits one Operation", () => {
    const fixture = makeFixture();
    const first = applyReaderSelectionLink(fixture.input());
    const published = fs.readFileSync(fixture.currentPath, "utf8");
    const second = applyReaderSelectionLink(fixture.input());

    expect(second.operation.id).toBe(first.operation.id);
    expect(fs.readFileSync(fixture.currentPath, "utf8")).toBe(published);
    const operationDirectory = path.join(fixture.vaultPath, ".pige", "operations", "2026", "07");
    expect(fs.readdirSync(operationDirectory).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });
});

function makeFixture(alreadyLinked = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-link-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Link",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-28T09:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Link");
  const currentPageId = "page_20260728_linksource12";
  const targetPageId = "page_20260728_linktarget12";
  const selectedText = "A passage about the target topic.";
  const currentMarkdown = noteMarkdown({
    pageId: currentPageId,
    title: "Current note",
    body: selectedText,
    jobId: "job_20260728_seedsource",
    sourceIds: ["src_20260728_readerlink"],
    relatedPageIds: alreadyLinked ? [targetPageId] : []
  });
  const targetMarkdown = noteMarkdown({
    pageId: targetPageId,
    title: "Target ] note",
    body: "Current related knowledge.",
    jobId: "job_20260728_seedtarget",
    sourceIds: [],
    relatedPageIds: []
  });
  const currentPath = writePage(vaultPath, currentPageId, currentMarkdown);
  const targetPath = writePage(vaultPath, targetPageId, targetMarkdown);
  const start = Buffer.byteLength(currentMarkdown.slice(0, currentMarkdown.indexOf(selectedText)), "utf8");
  const selectedBytes = Buffer.from(selectedText, "utf8");
  const selection: ReaderSelectionIdentity = {
    pageId: currentPageId,
    pageContentHash: hash(currentMarkdown),
    span: { unit: "utf8_bytes", start, endExclusive: start + selectedBytes.length },
    selectedContentHash: hash(selectedText)
  };
  const vault = loadVaultSummary(vaultPath);
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const jobs = new JobsService(vaults);
  const created = jobs.createAgentTurnJob({
    conversationEventId: `evt_20260728_${alreadyLinked ? "linkexists12" : "linkservice12"}`,
    conversationLocator: `.pige/conversations/2026/07/conv_20260728_${alreadyLinked ? "linkexists12" : "linkservice12"}.jsonl`,
    inputHash: hash("reader link turn"),
    currentNoteScope: {
      pageId: currentPageId,
      bindingHash: hash("reader link binding"),
      selection,
      linkAction: "link"
    }
  });
  const running = jobs.beginAgentTurnJob(created, { stage: "planning", message: "Reader link started." });
  const job = jobs.settleAgentTurnJob(running, {
    kind: "completed",
    message: "Reader link target resolved."
  });
  return {
    vaultPath,
    currentPageId,
    targetPageId,
    currentPath,
    targetPath,
    currentMarkdown,
    selection,
    job,
    targetHash: hash(targetMarkdown),
    input: () => ({
      vaultPath,
      job,
      selection,
      currentPage: readCurrentNotePageForMutation(vaultPath, currentPageId),
      targetPage: readCurrentNotePageForMutation(vaultPath, targetPageId)
    })
  };
}

function noteMarkdown(input: {
  readonly pageId: string;
  readonly title: string;
  readonly body: string;
  readonly jobId: string;
  readonly sourceIds: readonly string[];
  readonly relatedPageIds: readonly string[];
}): string {
  return `---
id: "${input.pageId}"
schema_version: 1
title: "${input.title}"
type: "note"
created_at: "2026-07-28T08:00:00.000Z"
updated_at: "2026-07-28T08:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: []
topics: []
entities: []
source_ids: ${JSON.stringify(input.sourceIds)}
related_page_ids: ${JSON.stringify(input.relatedPageIds)}
provenance:
  generated_by: "pige"
  last_job_id: "${input.jobId}"
  model_profile_id: "model_reader_link"
  confidence: "high"
note:
  note_kind: "summary"
  review_state: "clean"
---

# ${input.title}

${input.body}
`;
}

function writePage(vaultPath: string, pageId: string, markdown: string): string {
  const pagePath = path.join(vaultPath, "wiki", "generated", "2026", `${pageId}.md`);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, markdown, "utf8");
  return pagePath;
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
