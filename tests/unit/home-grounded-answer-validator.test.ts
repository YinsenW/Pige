import { describe, expect, it } from "vitest";
import type { AgentAnswerCitation } from "@pige/contracts";
import { validateHomeGroundedAnswer } from "../../apps/desktop/src/main/services/home-grounded-answer-validator";

const citations: readonly AgentAnswerCitation[] = [{
  refId: "citation_2",
  label: "[2]",
  pageId: "page_20260801_groundedanswer",
  title: "Launch plan",
  pageType: "note",
  locator: "paragraph:1"
}];

describe("validateHomeGroundedAnswer", () => {
  it("passes ordinary Pi prose through before any evidence is inspected", () => {
    expect(validateHomeGroundedAnswer({
      assistantText: "A general answer.",
      availableCitations: [],
      groundingRequired: false,
      locale: "en"
    })).toEqual({ answer: "A general answer.", grounding: "general", citations: [] });
  });

  it("projects only exact Host-owned citations after evidence is inspected", () => {
    expect(validateHomeGroundedAnswer({
      assistantText: "The launch is July 18. [citation_2]",
      availableCitations: citations,
      groundingRequired: true,
      locale: "en"
    })).toEqual({
      answer: "The launch is July 18. [citation_2]",
      grounding: "local_knowledge",
      citations
    });
  });

  it.each([
    ["evidence without a citation", "The launch is July 18."],
    ["an invented citation", "The launch is July 18. [citation_99]"]
  ])("collapses %s to an honest localized insufficiency", (_label, assistantText) => {
    expect(validateHomeGroundedAnswer({
      assistantText,
      availableCitations: citations,
      groundingRequired: true,
      locale: "en"
    })).toEqual({
      answer: "I couldn't verify an answer from the selected local evidence.",
      grounding: "insufficient_evidence",
      citations: []
    });
  });

  it("does not project fabricated citation syntax in an otherwise general answer", () => {
    expect(validateHomeGroundedAnswer({
      assistantText: "Invented [citation_9]",
      availableCitations: [],
      groundingRequired: false,
      locale: "zh-Hans"
    })).toEqual({ answer: "我无法根据所选本地证据验证答案。", grounding: "insufficient_evidence", citations: [] });
  });
});
