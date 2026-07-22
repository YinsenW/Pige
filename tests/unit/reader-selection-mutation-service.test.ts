import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReaderSelectionIdentity } from "@pige/contracts";
import {
  applyReaderSelectionPageUpdate,
  createAgentPageUpdateStagedPath
} from "../../apps/desktop/src/main/services/agent-page-update-service";
import { readReaderSelectionPageUpdateOperation } from "../../apps/desktop/src/main/services/agent-turn-publication";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { readCurrentNotePageForMutation } from "../../apps/desktop/src/main/services/retrieval-evidence-boundary";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection mutation", () => {
  it("atomically applies one generated-note replacement and exposes exact Activity Undo", () => {
    const fixture = makeFixture();
    const result = applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: "The polished passage is concise.",
      action: "polish"
    });

    const applied = fs.readFileSync(fixture.pagePath, "utf8");
    expect(applied).toContain("The polished passage is concise.");
    expect(applied).not.toContain(fixture.selectedText);
    const activity = new KnowledgeActivityService(fixture.vaults);
    expect(activity.list().activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: result.operation.id, kind: "update_page", canUndo: true })
    ]));

    expect(activity.undo({ operationId: result.operation.id })).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("adopts a proven published replacement on retry and commits one Operation", () => {
    const fixture = makeFixture(undefined, "translate");
    const first = applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: "The translated passage is bounded.",
      action: "translate"
    });
    const operationPath = path.join(
      fixture.vaultPath,
      ".pige",
      "operations",
      "2026",
      "07",
      `${first.operation.id}.json`
    );
    fs.rmSync(operationPath);

    const recovered = applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: "The translated passage is bounded.",
      action: "translate"
    });

    expect(recovered.recovered).toBe(true);
    expect(recovered.operation.id).toBe(first.operation.id);
    expect(fs.existsSync(operationPath)).toBe(true);
    expect(fs.existsSync(path.join(
      fixture.vaultPath,
      ...createAgentPageUpdateStagedPath(first.operation.id).split("/")
    ))).toBe(false);
  });

  it("validates the exact durable Reader Operation before recovery trusts its Job ref", () => {
    const fixture = makeFixture(undefined, "polish");
    const applied = applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: "The validated replacement remains bounded.",
      action: "polish"
    });
    expect(readReaderSelectionPageUpdateOperation({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      selection: fixture.selection,
      replacement: "The validated replacement remains bounded.",
      action: "polish"
    })?.id).toBe(applied.operation.id);
    expect(() => readReaderSelectionPageUpdateOperation({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      selection: fixture.selection,
      replacement: "A different but structurally valid replacement.",
      action: "polish"
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));

    const operationPath = path.join(
      fixture.vaultPath,
      ".pige",
      "operations",
      "2026",
      "07",
      `${applied.operation.id}.json`
    );
    fs.writeFileSync(operationPath, "{}\n", "utf8");
    expect(() => readReaderSelectionPageUpdateOperation({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      selection: fixture.selection,
      replacement: "The validated replacement remains bounded.",
      action: "polish"
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });

  it("rejects a selection boundary inside a UTF-8 code point without changing the page", () => {
    const fixture = makeFixture("中文段落保持私密。");
    const beforeBytes = Buffer.from(fixture.markdown, "utf8");
    const invalidStart = fixture.selection.span.start + 1;
    const invalidSelection: ReaderSelectionIdentity = {
      ...fixture.selection,
      span: { ...fixture.selection.span, start: invalidStart },
      selectedContentHash: hash(beforeBytes.subarray(invalidStart, fixture.selection.span.endExclusive))
    };
    const invalidBoundJob = {
      ...fixture.job,
      inputRefs: fixture.job.inputRefs?.map((ref) => ref.role === "agent_turn_reader_selection"
        ? {
            ...ref,
            checksum: invalidSelection.selectedContentHash,
            locator: `utf8_bytes:${invalidSelection.span.start}:${invalidSelection.span.endExclusive}`
          }
        : ref)
    };

    expect(() => applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: invalidBoundJob,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: invalidSelection,
      replacement: "安全替换。",
      action: "polish"
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.update_content_restricted" }));
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("rejects restricted replacement content without changing the page", () => {
    const fixture = makeFixture(undefined, "expand");
    expect(() => applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: String.raw`\\server\share`,
      action: "expand"
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.update_content_restricted" }));
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });

  it("applies an approved awaiting-review replacement through the same reversible writer", () => {
    const fixture = makeFixture(undefined, "expand", "awaiting_review");
    const result = applyReaderSelectionPageUpdate({
      vaultPath: fixture.vaultPath,
      job: fixture.job,
      target: readCurrentNotePageForMutation(fixture.vaultPath, fixture.selection.pageId),
      selection: fixture.selection,
      replacement: "The reviewed expansion is now approved.",
      action: "expand"
    });

    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("The reviewed expansion is now approved.");
    const activity = new KnowledgeActivityService(fixture.vaults);
    expect(activity.list().activities[0]).toMatchObject({
      operationId: result.operation.id,
      kind: "update_page",
      canUndo: true
    });
    expect(activity.undo({ operationId: result.operation.id })).toMatchObject({ status: "undone" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.markdown);
  });
});

function makeFixture(
  selectedText = "The original selected passage remains private.",
  transformAction: "translate" | "polish" | "expand" = "polish",
  lifecycle: "completed" | "awaiting_review" = "completed"
): {
  readonly vaultPath: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly selectedText: string;
  readonly selection: ReaderSelectionIdentity;
  readonly job: ReturnType<JobsService["readAgentTurnJob"]> & {};
  readonly vaults: {
    readonly current: () => ReturnType<typeof loadVaultSummary>;
    readonly activeVaultPath: () => string;
  };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-mutation-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Mutation",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-18T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Mutation");
  const pageId = "page_20260718_mutation12";
  const pagePath = path.join(vaultPath, "wiki", "generated", "2026", `${pageId}.md`);
  const markdown = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Reader mutation"\ntype: "note"\ncreated_at: "2026-07-18T12:00:00.000Z"\nupdated_at: "2026-07-18T12:00:00.000Z"\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\n  last_job_id: "job_20260718_seednote12"\n  model_profile_id: "model_reader_mutation"\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# Reader mutation\n\n${selectedText}\n`;
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, markdown, "utf8");
  const start = Buffer.byteLength(markdown.slice(0, markdown.indexOf(selectedText)), "utf8");
  const selectedBytes = Buffer.from(selectedText, "utf8");
  const selection: ReaderSelectionIdentity = {
    pageId,
    pageContentHash: hash(Buffer.from(markdown, "utf8")),
    span: { unit: "utf8_bytes", start, endExclusive: start + selectedBytes.length },
    selectedContentHash: hash(selectedBytes)
  };
  const vault = loadVaultSummary(vaultPath);
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const jobs = new JobsService(vaults);
  const created = jobs.createAgentTurnJob({
    conversationEventId: "evt_20260718_mutation12",
    conversationLocator: ".pige/conversations/2026/07/conv_20260718_mutation12.jsonl",
    inputHash: hash(Buffer.from("reader mutation", "utf8")),
    currentNoteScope: {
      pageId,
      bindingHash: hash(Buffer.from("reader mutation binding", "utf8")),
      selection,
      transformAction
    }
  });
  const running = jobs.beginAgentTurnJob(created, { stage: "planning", message: "Reader transform started." });
  const job = jobs.settleAgentTurnJob(running, lifecycle === "completed"
    ? {
        kind: "completed",
        message: "Reader transform model turn completed."
      }
    : {
        kind: "waiting",
        reason: "review",
        proposalId: "proposal_20260718_readerreview",
        message: "Reader transform waits for review."
      });
  return {
    vaultPath,
    pagePath,
    markdown,
    selectedText,
    selection,
    job,
    vaults
  };
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
