import { describe, expect, it } from "vitest";
import {
  NOTE_SET_QUESTION_STATE_CHANNEL,
  NoteQuestionStateSummarySchema,
  NoteSetQuestionStateRequestSchema,
  NoteSetQuestionStateResultSchema
} from "@pige/schemas";

const request = {
  apiVersion: 1 as const,
  requestId: "notequestionreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_question",
  currentPageId: "page_20260801_question1",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`,
  state: "answered" as const
};

describe("question state renderer contract", () => {
  it("keeps the request exact and the summary bounded", () => {
    expect(NOTE_SET_QUESTION_STATE_CHANNEL).toBe("notes.setQuestionState");
    expect(NoteSetQuestionStateRequestSchema.parse(request)).toEqual(request);
    expect(NoteQuestionStateSummarySchema.parse({
      state: "partially_answered", canChange: true, revision: request.expectedRevision
    })).toEqual({ state: "partially_answered", canChange: true, revision: request.expectedRevision });
    expect(() => NoteSetQuestionStateRequestSchema.parse({ ...request, path: "/private/question.md" })).toThrow();
    expect(() => NoteSetQuestionStateRequestSchema.parse({ ...request, state: "resolved" })).toThrow();
  });

  it("returns only authoritative render identity on commit and body-free closed results", () => {
    const render = {
      summary: { pageId: request.currentPageId, title: "Question", pageType: "question" as const,
        status: "active" as const, pagePath: "questions/question.md",
        createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T11:00:00.000Z", sourceIds: [] },
      html: "<h1>Question</h1>", byteSize: 64,
      renderContextId: "notectx_fedcba9876543210fedcba9876543210",
      questionState: { state: "answered" as const, canChange: true,
        revision: `noteeditrev_${"b".repeat(64)}` }
    };
    expect(NoteSetQuestionStateResultSchema.parse({ ...request, status: "committed",
      operationId: "op_20260801_questionstate1", render })).toMatchObject({ status: "committed", render });
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteSetQuestionStateResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
      expect(() => NoteSetQuestionStateResultSchema.parse({
        ...request, status, body: "private", path: "/private/question.md", rawError: "private"
      })).toThrow();
    }
  });
});
