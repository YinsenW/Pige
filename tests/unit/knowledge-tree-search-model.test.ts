import { describe, expect, it } from "vitest";
import {
  normalizeKnowledgeTreeQuery,
  searchKnowledgeTree,
  type KnowledgeTreeSearchCandidate
} from "../../apps/desktop/src/renderer/src/components/knowledge-tree-search-model";

const candidates: readonly KnowledgeTreeSearchCandidate[] = [{
  id: "domain", parentId: null, title: "Personal Knowledge", kind: "domain", kindLabel: "Domain"
}, {
  id: "topic", parentId: "domain", title: "Local RAG", kind: "topic", kindLabel: "Topic",
  pageId: "page_20260802_topic0001", focusKey: "domain-topic"
}, {
  id: "concept", parentId: "topic", title: "Ｌｅｘｉｃａｌ retrieval", kind: "concept", kindLabel: "Concept",
  pageId: "page_20260802_concept01", focusKey: "domain-topic-concept"
}];

describe("Knowledge Tree search model", () => {
  it("matches normalized titles and localized types with deterministic ancestor paths", () => {
    expect(normalizeKnowledgeTreeQuery("  ＬＥＸＩＣＡＬ   Retrieval ")).toBe("lexical retrieval");
    expect(searchKnowledgeTree(candidates, "lexical concept")).toEqual([{
      ...candidates[2],
      ancestorIds: ["domain", "topic"],
      breadcrumb: ["Local RAG"]
    }]);
    expect(searchKnowledgeTree(candidates, "Topic").map(({ id }) => id)).toEqual(["topic"]);
    expect(searchKnowledgeTree(candidates, "missing")).toEqual([]);
  });

  it("fails closed on cyclic candidate ancestry", () => {
    expect(searchKnowledgeTree([{ ...candidates[0]!, parentId: "topic" }, candidates[1]!], "local")).toEqual([]);
  });
});
