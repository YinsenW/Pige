import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionAnswerService, readQuestionAnswerIds } from "../../apps/desktop/src/main/services/question-answer-service";

const tempRoots: string[] = [];
const request = {
  apiVersion: 1 as const,
  requestId: "questionanswerreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_question",
  currentPageId: "page_20260801_question1",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  action: "add" as const,
  targetPageId: "page_20260801_answer001",
  expectedTargetUpdatedAt: "2026-08-01T11:00:00.000Z"
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("QuestionAnswerService", () => {
  it("searches current Note and Claim candidates and commits one exact answer link", async () => {
    const vaultPath = makeVault();
    writePage(vaultPath, request.targetPageId, "Answer note", "note", request.expectedTargetUpdatedAt);
    writePage(vaultPath, "page_20260801_claim001", "Answer claim", "claim", "2026-08-01T10:30:00.000Z");
    writePage(vaultPath, "page_20260801_unsourced1", "Answer without evidence", "note", "2026-08-01T10:45:00.000Z", false);
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_questionanswer1" }));
    const service = new QuestionAnswerService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(assertCurrent)),
      render: vi.fn(async () => questionRender([answerItem()]))
    } as never, { open: vi.fn(() => openedQuestion()), save } as never, () => vaultPath,
    () => new Date("2026-08-01T12:00:00.000Z"));

    expect(service.search("reader_owner", { ...request, query: "answer" })).toMatchObject({
      status: "ready",
      candidates: [
        { pageId: "page_20260801_claim001", title: "Answer claim", pageType: "claim" },
        { pageId: request.targetPageId, title: "Answer note", pageType: "note" }
      ]
    });
    await expect(service.change("reader_owner", request)).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_questionanswer1",
      render: { questionAnswers: { items: [{ pageId: request.targetPageId }] } }
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      pageId: request.currentPageId,
      markdown: expect.stringContaining(`answered_by: ["${request.targetPageId}"]`)
    }));
    expect(assertCurrent).toHaveBeenCalledTimes(4);

    const { expectedTargetUpdatedAt: _expectedTargetUpdatedAt, ...removeIdentity } = request;
    const removeSave = vi.fn(() => ({ status: "committed" as const, operationId: "op_20260801_questionanswer2" }));
    const remove = new QuestionAnswerService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)),
      render: vi.fn(async () => questionRender([]))
    } as never, { open: vi.fn(() => openedQuestion([request.targetPageId])), save: removeSave } as never,
    () => vaultPath, () => new Date("2026-08-01T13:00:00.000Z"));
    await expect(remove.change("reader_owner", { ...removeIdentity,
      requestId: "questionanswerreq_removeabcdefghijkl", action: "remove" })).resolves.toMatchObject({
      status: "committed", operationId: "op_20260801_questionanswer2",
      render: { questionAnswers: { items: [] } }
    });
    expect(removeSave).toHaveBeenCalledWith(expect.objectContaining({
      markdown: expect.stringContaining("answered_by: []")
    }));
  });

  it("fails closed before mutation when target or Reader identity drifts", async () => {
    const vaultPath = makeVault();
    writePage(vaultPath, request.targetPageId, "Answer note", "note", "2026-08-01T11:00:01.000Z");
    const save = vi.fn();
    const staleTarget = new QuestionAnswerService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => openedQuestion()), save } as never, () => vaultPath);
    await expect(staleTarget.change("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    const staleReader = new QuestionAnswerService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn()
    } as never, { open: vi.fn(() => openedQuestion()), save } as never, () => vaultPath);
    await expect(staleReader.change("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    writePage(vaultPath, request.targetPageId, "Answer note", "note", request.expectedTargetUpdatedAt);
    const racedTarget = new QuestionAnswerService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => {
      writePage(vaultPath, request.targetPageId, "Answer note", "note", "2026-08-01T11:00:02.000Z");
      return openedQuestion();
    }), save } as never, () => vaultPath);
    await expect(racedTarget.change("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(save).not.toHaveBeenCalled();
  });

  it("parses only one bounded, unique answered_by truth", () => {
    expect(readQuestionAnswerIds(questionFrontmatter([]))).toEqual([]);
    expect(readQuestionAnswerIds(questionFrontmatter([request.targetPageId, request.targetPageId]))).toBeUndefined();
    expect(readQuestionAnswerIds(questionFrontmatter([]).replace("  answered_by: []", "  answered_by: []\n  answered_by: []"))).toBeUndefined();
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-question-answer-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "wiki"), { recursive: true });
  return root;
}

function writePage(vaultPath: string, pageId: string, title: string, type: "note" | "claim", updatedAt: string,
  grounded = true): void {
  fs.writeFileSync(path.join(vaultPath, "wiki", `${pageId}.md`), `---\nid: "${pageId}"\nschema_version: 1\ntitle: "${title}"\ntype: "${type}"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: ${updatedAt}\nstatus: "active"\naliases: []\nsource_ids: ${grounded ? '["src_20260801_answer0001"]' : "[]"}\n---\n\n# ${title}\n`, "utf8");
}

function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}
function openedQuestion(ids: readonly string[] = []) {
  return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"b".repeat(64)}`, markdown: `---\n${questionFrontmatter(ids)}---\n\n# Question\n` };
}
function questionFrontmatter(ids: readonly string[]): string {
  return `id: "${request.currentPageId}"\nschema_version: 1\ntitle: "Question"\ntype: "question"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: 2026-08-01T10:00:00.000Z\nstatus: "active"\naliases: []\nsource_ids: []\nquestion:\n  state: "open"\n  answered_by: ${JSON.stringify(ids)}\n`;
}
function answerItem() { return { pageId: request.targetPageId, title: "Answer note", pageType: "note" as const,
  updatedAt: request.expectedTargetUpdatedAt }; }
function questionRender(items: readonly ReturnType<typeof answerItem>[]) {
  return { summary: { pageId: request.currentPageId, title: "Question", pageType: "question" as const,
    status: "active" as const, pagePath: "wiki/question.md", createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] }, html: "<h1>Question</h1>", byteSize: 80,
    renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    questionAnswers: { canEdit: true, revision: `noteeditrev_${"b".repeat(64)}`, items } };
}
