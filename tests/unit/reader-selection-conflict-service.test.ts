import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReaderSelectionIdentity } from "@pige/contracts";
import {
  applyReaderSelectionPageUpdate
} from "../../apps/desktop/src/main/services/agent-page-update-service";
import {
  createReaderSelectionProposalId,
  ReaderSelectionProposalService
} from "../../apps/desktop/src/main/services/reader-selection-proposal-service";
import { ReaderSelectionConflictService } from "../../apps/desktop/src/main/services/reader-selection-conflict-service";
import { createReaderSelectionPublicationIntentHash } from "../../apps/desktop/src/main/services/reader-selection-job-binding";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { readCurrentNotePageForMutation } from "../../apps/desktop/src/main/services/retrieval-evidence-boundary";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection conflict service", () => {
  it("fences stale decisions and applies the exact reviewed proposal with Activity Undo", () => {
    const fixture = makeConflictFixture();
    const service = new ReaderSelectionConflictService();
    const first = service.read(fixture.input);
    expect(first).toMatchObject({ state: "conflicted" });
    if (first.state !== "conflicted") throw new Error("expected conflict");
    expect(JSON.stringify(first)).not.toContain(fixture.vaultPath);
    expect(first.lines.some((line) => line.text.includes("User changed passage"))).toBe(true);

    const stale = service.resolve({
      ...fixture.input,
      expectedCurrentRevision: `noteeditrev_${"f".repeat(64)}`,
      decision: "apply_proposed"
    });
    expect(stale).toMatchObject({ state: "conflicted", currentRevision: first.currentRevision });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.concurrentMarkdown);

    const applied = service.resolve({
      ...fixture.input,
      expectedCurrentRevision: first.currentRevision,
      decision: "apply_proposed"
    });
    expect(applied).toMatchObject({ state: "applied" });
    if (applied.state !== "applied") throw new Error("expected apply");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain(fixture.replacement);
    expect(new ReaderSelectionConflictService().read(fixture.input)).toMatchObject({
      state: "applied",
      operation: { id: applied.operation.id }
    });

    const activity = new KnowledgeActivityService(fixture.vaults);
    expect(activity.list().activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: applied.operation.id, kind: "update_page", canUndo: true })
    ]));
    expect(activity.undo({ operationId: applied.operation.id })).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.concurrentMarkdown);
  });

  it("persists Keep current and Save as new across restart without changing the live note", () => {
    const kept = makeConflictFixture();
    const service = new ReaderSelectionConflictService();
    const keepPreview = service.read(kept.input);
    if (keepPreview.state !== "conflicted") throw new Error("expected conflict");
    expect(service.resolve({
      ...kept.input,
      expectedCurrentRevision: keepPreview.currentRevision,
      decision: "keep_current"
    })).toMatchObject({ state: "rejected" });
    expect(new ReaderSelectionConflictService().read(kept.input)).toMatchObject({ state: "rejected" });
    expect(fs.readFileSync(kept.pagePath, "utf8")).toBe(kept.concurrentMarkdown);

    const saved = makeConflictFixture();
    const savePreview = service.read(saved.input);
    if (savePreview.state !== "conflicted") throw new Error("expected conflict");
    const result = service.resolve({
      ...saved.input,
      expectedCurrentRevision: savePreview.currentRevision,
      decision: "save_proposed_as_new_page"
    });
    expect(result).toMatchObject({ state: "applied", operation: { kind: "create_page" } });
    if (result.state !== "applied" || !result.createdPageId) throw new Error("expected saved note");
    expect(fs.readFileSync(saved.pagePath, "utf8")).toBe(saved.concurrentMarkdown);
    expect(fs.existsSync(path.join(saved.vaultPath, "wiki", "generated", "2026", `${result.createdPageId}.md`))).toBe(true);
    expect(new ReaderSelectionConflictService().read(saved.input)).toMatchObject({
      state: "applied",
      createdPageId: result.createdPageId
    });
  });
});

function makeConflictFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-conflict-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Conflict",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-18T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Conflict");
  const pageId = "page_20260718_conflict12";
  const pagePath = path.join(vaultPath, "wiki", "generated", "2026", `${pageId}.md`);
  const selectedText = "The original selected passage remains private.";
  const markdown = pageMarkdown(pageId, "2026-07-18T12:00:00.000Z", selectedText);
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, markdown, "utf8");
  const start = Buffer.byteLength(markdown.slice(0, markdown.indexOf(selectedText)), "utf8");
  const selection: ReaderSelectionIdentity = {
    pageId,
    pageContentHash: hash(markdown),
    span: { unit: "utf8_bytes", start, endExclusive: start + Buffer.byteLength(selectedText, "utf8") },
    selectedContentHash: hash(selectedText)
  };
  const vault = loadVaultSummary(vaultPath);
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const jobs = new JobsService(vaults);
  const created = jobs.createAgentTurnJob({
    conversationEventId: "evt_20260718_conflict12",
    conversationLocator: ".pige/conversations/2026/07/conv_20260718_conflict12.jsonl",
    inputHash: hash("reader conflict"),
    currentNoteScope: {
      pageId,
      bindingHash: hash("reader conflict binding"),
      selection,
      transformAction: "polish"
    }
  });
  const running = jobs.beginAgentTurnJob(created, { stage: "planning", message: "Reader transform started." });
  const settled = jobs.settleAgentTurnJob(running, {
    kind: "waiting",
    reason: "review",
    proposalId: createReaderSelectionProposalId(running.id),
    message: "Reader transform waits for review."
  });
  const job = {
    ...settled,
    policyContextId: "policy_reader_conflict",
    policyHash: `sha256:${"e".repeat(64)}`
  };
  const replacement = "The polished proposal keeps the cited meaning.";
  const targetBeforeConcurrentEdit = readCurrentNotePageForMutation(vaultPath, pageId);
  const concurrentMarkdown = pageMarkdown(pageId, "2026-07-18T12:01:00.000Z", "User changed passage while review waited.");
  fs.writeFileSync(pagePath, concurrentMarkdown, "utf8");
  expect(() => applyReaderSelectionPageUpdate({
    vaultPath,
    job,
    target: targetBeforeConcurrentEdit,
    selection,
    replacement,
    action: "polish"
  })).toThrowError(expect.objectContaining({ code: "agent_ingest.page_conflict" }));
  const proposalId = createReaderSelectionProposalId(job.id);
  return {
    vaultPath,
    pagePath,
    concurrentMarkdown,
    replacement,
    vaults,
    input: {
      vaultPath,
      job,
      proposalId,
      intentHash: createReaderSelectionPublicationIntentHash(job.id, "polish", selection, replacement),
      selection,
      replacement,
      modelProfileId: "model_reader_conflict",
      action: "polish" as const,
      previewLines: [
        { kind: "removed" as const, text: selectedText },
        { kind: "added" as const, text: replacement }
      ]
    }
  };
}

function pageMarkdown(pageId: string, updatedAt: string, body: string): string {
  return `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Reader conflict"\ntype: "note"\ncreated_at: "2026-07-18T12:00:00.000Z"\nupdated_at: "${updatedAt}"\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\n  last_job_id: "job_20260718_seednote12"\n  model_profile_id: "model_reader_conflict"\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# Reader conflict\n\n${body}\n`;
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
