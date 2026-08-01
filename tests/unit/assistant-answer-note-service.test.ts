import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationEventSchema, OperationRecordSchema, type ConversationEvent } from "@pige/schemas";
import { AssistantAnswerNoteService } from
  "../../apps/desktop/src/main/services/assistant-answer-note-service";
import { KnowledgeActivityService } from
  "../../apps/desktop/src/main/services/knowledge-activity-service";

const temporaryRoots: string[] = [];
const activeVaultId = "vault_20260801_savedanswer01";
const conversationId = "conv_20260801_savedanswer01";
const assistantEventId = "evt_20260801_savedanswer01";

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AssistantAnswerNoteService", () => {
  it("saves one integrity-bound cited answer idempotently and Activity can Undo it after restart", () => {
    const fixture = createFixture();
    const service = new AssistantAnswerNoteService(fixture.vaults, fixture.conversations);
    const first = service.save(request("answersavereq_20260801saved0001"));
    const replay = new AssistantAnswerNoteService(fixture.vaults, fixture.conversations)
      .save(request("answersavereq_20260801saved0002"));

    expect(first).toMatchObject({ status: "saved", title: "North has three records." });
    expect(replay).toMatchObject({
      status: "saved",
      pageId: first.status === "saved" ? first.pageId : undefined,
      operationId: first.status === "saved" ? first.operationId : undefined
    });
    if (first.status !== "saved") throw new Error("Expected a saved result.");
    const pagePath = path.join(fixture.vaultPath, "wiki", "generated", "2026", `${first.pageId}.md`);
    const markdown = fs.readFileSync(pagePath, "utf8");
    expect(markdown).toContain("North has three records.");
    expect(markdown).toContain("[[Regional note]] — \\[1\\] (page:regional-note)");
    expect(markdown).toContain("[source:src_20260801_savedanswer01#dataset:regional-totals]");
    expect(markdown).toContain('source_ids: ["src_20260801_savedanswer01"]');
    expect(markdown).toContain('related_page_ids: ["page_20260801_relatednote01"]');
    expect(readOperations(fixture.vaultPath)).toHaveLength(1);
    expect(readOperations(fixture.vaultPath)[0]).toMatchObject({
      id: first.operationId,
      kind: "create_page",
      actor: { kind: "user" }
    });
    expect(JSON.stringify(readOperations(fixture.vaultPath)[0]?.sourceRefs)).toContain(assistantEventId);
    expect(fixture.assertWriterLease).toHaveBeenCalled();

    const activity = new KnowledgeActivityService(fixture.vaults);
    expect(activity.list().activities).toContainEqual(expect.objectContaining({
      operationId: first.operationId,
      kind: "create_page",
      status: "applied",
      canUndo: true,
      target: { kind: "page", pageId: first.pageId }
    }));
    expect(activity.undo({ operationId: first.operationId })).toMatchObject({ status: "undone" });
    expect(fs.existsSync(pagePath)).toBe(false);
    expect(new KnowledgeActivityService(fixture.vaults).list().activities).toContainEqual(
      expect.objectContaining({ operationId: first.operationId, status: "undone", canUndo: false })
    );
  });

  it("fails closed for vault drift, a missing event, and tampered durable answer bytes", () => {
    const fixture = createFixture();
    const service = new AssistantAnswerNoteService(fixture.vaults, fixture.conversations);
    expect(service.save({ ...request("answersavereq_20260801wrong0001"), activeVaultId: "vault_20260801_wrongvault01" }))
      .toMatchObject({ status: "stale" });

    fixture.currentEvent = undefined;
    expect(service.save(request("answersavereq_20260801missing01"))).toMatchObject({ status: "not_found" });

    fixture.currentEvent = { ...makeEvent(), text: "Changed after publication." };
    expect(service.save(request("answersavereq_20260801tamper001"))).toMatchObject({ status: "stale" });
    expect(readOperations(fixture.vaultPath)).toEqual([]);
    expect(fs.existsSync(path.join(fixture.vaultPath, "wiki", "generated"))).toBe(false);
  });
});

function request(requestId: string) {
  return { apiVersion: 1 as const, requestId, activeVaultId, conversationId, assistantEventId };
}

function createFixture() {
  const vaultPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-saved-answer-")));
  temporaryRoots.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, ".pige"), { mode: 0o700 });
  const fixture: {
    readonly vaultPath: string;
    readonly assertWriterLease: ReturnType<typeof vi.fn>;
    currentEvent: ConversationEvent | undefined;
    vaults: {
      current: () => never;
      activeVaultPath: () => string;
      assertWriterLease: (candidate: string) => void;
    };
    conversations: {
      readAssistantEvent: () => ConversationEvent | undefined;
    };
  } = {
    vaultPath,
    assertWriterLease: vi.fn(),
    currentEvent: makeEvent(),
    vaults: undefined as never,
    conversations: undefined as never
  };
  fixture.vaults = {
    current: () => ({ vaultId: activeVaultId }) as never,
    activeVaultPath: () => vaultPath,
    assertWriterLease: (candidate) => fixture.assertWriterLease(candidate)
  };
  fixture.conversations = { readAssistantEvent: () => fixture.currentEvent };
  return fixture;
}

function makeEvent(): ConversationEvent {
  const event = {
    schemaVersion: 1,
    id: assistantEventId,
    conversationId,
    type: "assistant_message",
    createdAt: "2026-08-01T08:00:00.000Z",
    parentEventId: "evt_20260801_savedanswer00",
    jobId: "job_20260801_savedanswer01",
    text: "North has three records.",
    answerGrounding: "source",
    answerCitations: [{
      refId: "citation_1",
      label: "[1]",
      pageId: "page_20260801_relatednote01",
      title: "Regional note",
      pageType: "note",
      locator: "page:regional-note"
    }, {
      kind: "dataset",
      refId: "dataset_citation_1",
      label: "[2]",
      title: "Regional totals",
      locator: "dataset:regional-totals",
      evidence: {
        datasetId: "dataset_20260801_savedanswer01",
        revisionId: "dataset_rev_20260801_savedanswer01",
        tableId: "table_savedanswer0001",
        schemaId: `sha256:${"a".repeat(64)}`,
        columnIds: ["column_savedanswer001"],
        rowIds: ["row_savedanswer000001"],
        queryPlanHash: `sha256:${"b".repeat(64)}`,
        resultHash: `sha256:${"c".repeat(64)}`,
        sourceId: "src_20260801_savedanswer01",
        sourceRevisionHash: `sha256:${"d".repeat(64)}`
      }
    }]
  } as const;
  return ConversationEventSchema.parse({
    ...event,
    contentHash: `sha256:${createHash("sha256").update(
      `pige.agent_assistant.v1\0${event.jobId}\0${event.parentEventId}\0${JSON.stringify({
        text: event.text,
        grounding: event.answerGrounding,
        citations: event.answerCitations
      })}`,
      "utf8"
    ).digest("hex")}`
  });
}

function readOperations(vaultPath: string) {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  return walk(root)
    .filter((candidate) => candidate.endsWith(".json"))
    .map((candidate) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(candidate, "utf8"))));
}

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}
