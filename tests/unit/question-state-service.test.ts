import { describe, expect, it, vi } from "vitest";
import {
  QuestionStateService,
  readQuestionState,
  updateQuestionStateMarkdown
} from "../../apps/desktop/src/main/services/question-state-service";

const request = {
  apiVersion: 1 as const,
  requestId: "notequestionreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_question",
  currentPageId: "page_20260801_question1",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  state: "partially_answered" as const
};

describe("QuestionStateService", () => {
  it("changes only the exact current question state and returns the authoritative render", async () => {
    const assertCurrent = vi.fn(() => true);
    const save = vi.fn(() => ({
      status: "committed" as const,
      operationId: "op_20260801_questionstate1"
    }));
    const render = vi.fn(async () => questionRender("partially_answered"));
    const service = new QuestionStateService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(assertCurrent)), render
    } as never, { open: vi.fn(() => openedQuestion()), save } as never,
    () => new Date("2026-08-01T12:00:00.000Z"));

    await expect(service.setState("reader_owner", request)).resolves.toMatchObject({
      ...request,
      status: "committed",
      operationId: "op_20260801_questionstate1",
      render: { questionState: { state: "partially_answered", canChange: true } }
    });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      activeVaultId: request.activeVaultId,
      pageId: request.currentPageId,
      expectedRevisionId: `sha256:${"a".repeat(64)}`,
      markdown: expect.stringContaining('question:\n  state: "partially_answered"\n  answered_by: []')
    }));
    expect(save.mock.calls[0]?.[0].markdown).toContain("updated_at: 2026-08-01T12:00:00.000Z");
    expect(save.mock.calls[0]?.[0].markdown).toContain("Keep this body unchanged.");
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "reader_owner");
  });

  it("fails closed before mutation for stale identity, no change, or malformed question truth", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const stale = new QuestionStateService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => false)), render: vi.fn()
    } as never, { open: vi.fn(() => openedQuestion()), save } as never);
    await expect(stale.setState("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });

    const unchanged = new QuestionStateService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => ({ ...openedQuestion(), markdown: questionMarkdown("partially_answered") })), save } as never);
    await expect(unchanged.setState("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });

    const malformed = new QuestionStateService({
      resolveManagedPageTarget: vi.fn(() => readyTarget(() => true)), render: vi.fn()
    } as never, { open: vi.fn(() => ({ ...openedQuestion(), markdown: questionMarkdown("open").replace(
      "  answered_by: []", "  state: answered\n  answered_by: []") })), save } as never);
    await expect(malformed.setState("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects non-question pages and preserves every field except state and updated_at", () => {
    expect(readQuestionState(frontmatter("open"))).toBe("open");
    expect(readQuestionState(frontmatter("open").replace("  answered_by: []", "  state: stale\n  answered_by: []")))
      .toBeUndefined();
    expect(updateQuestionStateMarkdown(
      questionMarkdown("open"), "answered", "2026-08-01T13:00:00.000Z"
    )).toBe(questionMarkdown("answered").replace(
      "updated_at: 2026-08-01T10:00:00.000Z",
      "updated_at: 2026-08-01T13:00:00.000Z"
    ));
    expect(updateQuestionStateMarkdown(
      questionMarkdown("open").replace('type: "question"', 'type: "note"'),
      "answered", "2026-08-01T13:00:00.000Z"
    )).toBeUndefined();
  });
});

function readyTarget(assertCurrent: () => boolean) {
  return { status: "ready" as const, pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent };
}

function openedQuestion() {
  return {
    status: "opened" as const,
    revisionId: `sha256:${"a".repeat(64)}`,
    renderIdentity: `sha256:${"b".repeat(64)}`,
    markdown: questionMarkdown("open")
  };
}

function questionRender(state: "open" | "partially_answered" | "answered" | "stale") {
  return {
    summary: {
      pageId: request.currentPageId, title: "Question", pageType: "question" as const,
      status: "active" as const, pagePath: "questions/question.md",
      createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: []
    },
    html: "<h1>Question</h1>", byteSize: 128,
    renderContextId: "notectx_fedcba9876543210fedcba9876543210",
    questionState: { state, canChange: true, revision: `noteeditrev_${"b".repeat(64)}` }
  };
}

function frontmatter(state: string): string {
  return `id: "${request.currentPageId}"
schema_version: 1
title: "Question"
type: "question"
created_at: 2026-08-01T10:00:00.000Z
updated_at: 2026-08-01T10:00:00.000Z
status: "active"
aliases: []
source_ids: []
question:
  state: "${state}"
  answered_by: []
`;
}

function questionMarkdown(state: string): string {
  return `---\n${frontmatter(state)}---\n\n# Question\n\nKeep this body unchanged.\n`;
}
