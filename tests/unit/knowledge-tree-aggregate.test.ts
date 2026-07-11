import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildKnowledgeTreeSnapshot,
  type KnowledgeTreeNode
} from "../../apps/desktop/src/main/services/knowledge-tree-aggregate";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Knowledge Tree aggregate", () => {
  it("rebuilds an explainable domain, topic, concept, and source tree from durable Markdown", () => {
    const vaultPath = makeVaultRoot();
    writePage(vaultPath, "wiki/topics/local-first.md", {
      id: "page_20260711_domain001",
      title: "Local-first",
      type: "topic"
    });
    writePage(vaultPath, "wiki/topics/local-rag.md", {
      id: "page_20260711_topic001",
      title: "Local RAG",
      type: "topic",
      aliases: ["RAG"],
      topics: ["page_20260711_domain001"]
    });
    writePage(vaultPath, "wiki/concepts/lexical-retrieval.md", {
      id: "page_20260711_concept01",
      title: "Lexical Retrieval",
      type: "concept",
      topics: ["RAG"],
      sourceIds: ["src_20260711_lexical01"]
    });
    writePage(vaultPath, "wiki/notes/ranking.md", {
      id: "page_20260711_note0001",
      title: "Ranking Notes",
      topics: ["RAG"],
      sourceIds: ["src_20260711_ranking01"],
      body: "PRIVATE_TREE_BODY must never enter the aggregate."
    });
    writePage(vaultPath, "wiki/notes/evidence.md", {
      id: "page_20260711_note0002",
      title: "Lexical Evidence",
      sourceIds: ["src_20260711_evidence1"],
      body: "Evidence for [[Lexical Retrieval]]."
    });
    writePage(vaultPath, "sources/rag-paper.md", {
      id: "page_20260711_source01",
      title: "RAG Paper",
      type: "source",
      topics: ["Local RAG"],
      sourceIds: ["src_20260711_paper0001"]
    });
    writePage(vaultPath, "wiki/concepts/agent-memory.md", {
      id: "page_20260711_concept02",
      title: "Agent Memory",
      type: "concept",
      sourceIds: ["src_20260711_memory001"]
    });

    const service = new LocalDatabaseService();
    expect(service.rebuild(vaultPath)).toMatchObject({ pageCount: 7, invalidPageCount: 0 });

    const snapshot = service.knowledgeTree(vaultPath);
    expect(snapshot).toBeDefined();
    expect(snapshot?.state).toBe("ready");
    expect(snapshot?.totals).toEqual({
      pageCount: 7,
      topicCount: 2,
      conceptCount: 2,
      fragmentPageCount: 2,
      sourceCount: 5,
      leafCount: 7
    });
    expect(snapshot?.roots.map((root) => root.title)).toEqual(["Local-first", "Unassigned"]);

    const domain = snapshot?.roots[0];
    expect(domain).toMatchObject({
      kind: "domain",
      navigation: { pageId: "page_20260711_domain001", pagePath: "wiki/topics/local-first.md" },
      metrics: { structuralPageCount: 3, fragmentPageCount: 2, sourceCount: 4, leafCount: 6, weight: 9 }
    });
    const rag = childNamed(domain, "Local RAG");
    expect(rag).toMatchObject({
      kind: "topic",
      navigation: { pageId: "page_20260711_topic001", pagePath: "wiki/topics/local-rag.md" },
      metrics: { structuralPageCount: 2, fragmentPageCount: 2, sourceCount: 4, leafCount: 6, weight: 8 }
    });
    expect(rag?.pageRefs.map((page) => page.title)).toEqual(["Ranking Notes"]);
    const lexical = childNamed(rag, "Lexical Retrieval");
    expect(lexical).toMatchObject({
      kind: "concept",
      metrics: { structuralPageCount: 1, fragmentPageCount: 1, sourceCount: 2, leafCount: 3, weight: 4 }
    });
    expect(lexical?.pageRefs.map((page) => page.title)).toEqual(["Lexical Evidence"]);
    expect(lexical?.sourceRefs).toEqual(["src_20260711_evidence1", "src_20260711_lexical01"]);

    const paper = rag?.children.find((child) => child.sourceId === "src_20260711_paper0001");
    expect(paper).toMatchObject({
      kind: "source",
      title: "RAG Paper",
      navigation: { pageId: "page_20260711_source01", pagePath: "sources/rag-paper.md" }
    });
    expect(snapshot?.roots[1]).toMatchObject({ kind: "domain", synthetic: true, title: "Unassigned" });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("PRIVATE_TREE_BODY");
    expect(serialized).not.toContain(vaultPath);
  });

  it("rebuilds the same deterministic tree after the SQLite working layer is deleted", () => {
    const vaultPath = makeVaultRoot();
    writePage(vaultPath, "wiki/topics/domain.md", {
      id: "page_20260711_domain002",
      title: "Knowledge Systems",
      type: "topic"
    });
    writePage(vaultPath, "wiki/concepts/indexes.md", {
      id: "page_20260711_concept03",
      title: "Rebuildable Indexes",
      type: "concept",
      topics: ["Knowledge Systems"],
      sourceIds: ["src_20260711_index001"]
    });
    const service = new LocalDatabaseService();
    service.rebuild(vaultPath);
    const before = service.knowledgeTree(vaultPath);

    fs.rmSync(path.join(vaultPath, ".pige/db/vault.sqlite"), { force: true });

    expect(service.knowledgeTree(vaultPath)).toEqual(before);
  });

  it("returns a deterministic empty state without manufacturing hidden hierarchy", () => {
    const snapshot = new LocalDatabaseService().knowledgeTree(makeVaultRoot());

    expect(snapshot).toEqual({
      schemaVersion: 1,
      state: "empty",
      invalidPageCount: 0,
      totals: {
        pageCount: 0,
        topicCount: 0,
        conceptCount: 0,
        fragmentPageCount: 0,
        sourceCount: 0,
        leafCount: 0
      },
      roots: []
    });
  });

  it("rebuilds a pre-Knowledge-Tree index revision before serving aggregates", () => {
    const vaultPath = makeVaultRoot();
    writePage(vaultPath, "wiki/topics/domain.md", {
      id: "page_20260711_domain004",
      title: "Retrieval",
      type: "topic"
    });
    writePage(vaultPath, "wiki/concepts/lexical.md", {
      id: "page_20260711_concept04",
      title: "Lexical Search",
      type: "concept",
      topics: ["Retrieval"]
    });
    const service = new LocalDatabaseService();
    service.rebuild(vaultPath);
    const database = new DatabaseSync(path.join(vaultPath, ".pige/db/vault.sqlite"));
    try {
      database.exec("DELETE FROM relation_edges; DELETE FROM topics; PRAGMA user_version = 1;");
    } finally {
      database.close();
    }

    const snapshot = service.knowledgeTree(vaultPath);

    expect(snapshot?.roots[0]?.title).toBe("Retrieval");
    expect(snapshot?.roots[0]?.children[0]?.title).toBe("Lexical Search");
  });

  it("skips corrupt pages while preserving valid relative navigation", () => {
    const vaultPath = makeVaultRoot();
    writePage(vaultPath, "wiki/topics/valid.md", {
      id: "page_20260711_domain003",
      title: "Valid Domain",
      type: "topic"
    });
    const corruptPath = path.join(vaultPath, "wiki/topics/corrupt.md");
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, "---\ntitle: incomplete\n---\nprivate body", "utf8");

    const service = new LocalDatabaseService();
    service.rebuild(vaultPath);
    const snapshot = service.knowledgeTree(vaultPath);

    expect(snapshot?.invalidPageCount).toBe(1);
    expect(snapshot?.totals.pageCount).toBe(1);
    expect(snapshot?.roots[0]?.navigation).toEqual({
      pageId: "page_20260711_domain003",
      pagePath: "wiki/topics/valid.md"
    });
    expect(JSON.stringify(snapshot)).not.toContain("private body");
  });

  it("breaks cyclic topic assignments deterministically without losing either branch", () => {
    const vaultPath = makeVaultRoot();
    writePage(vaultPath, "wiki/topics/a.md", {
      id: "page_20260711_topic0a1",
      title: "Alpha",
      type: "topic",
      topics: ["Beta"]
    });
    writePage(vaultPath, "wiki/topics/b.md", {
      id: "page_20260711_topic0b1",
      title: "Beta",
      type: "topic",
      topics: ["Alpha"]
    });
    const service = new LocalDatabaseService();
    service.rebuild(vaultPath);

    const first = service.knowledgeTree(vaultPath);
    const second = service.knowledgeTree(vaultPath);

    expect(second).toEqual(first);
    expect(first?.roots).toHaveLength(1);
    expect(first?.roots[0]?.title).toBe("Beta");
    expect(first?.roots[0]?.children[0]?.title).toBe("Alpha");
    expect(first?.roots[0]?.children[0]?.relatedParentPageIds).toEqual([]);
    expect(first?.roots[0]?.relatedParentPageIds).toEqual(["page_20260711_topic0a1"]);
  });

  it("builds deep topic chains iteratively without exhausting the call stack", () => {
    const depth = 1_500;
    const pages = Array.from({ length: depth }, (_, index) => ({
      pageId: `page_20260711_deep${String(index).padStart(4, "0")}`,
      title: `Topic ${String(index).padStart(4, "0")}`,
      pageType: "topic" as const,
      status: "active" as const,
      pagePath: `wiki/topics/${String(index).padStart(4, "0")}.md`,
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z",
      sourceIds: []
    }));
    const relations = pages.slice(1).map((page, index) => ({
      fromPageId: page.pageId,
      toPageId: pages[index]!.pageId,
      relationType: "has_topic" as const
    }));

    const snapshot = buildKnowledgeTreeSnapshot(pages, relations, 0);
    let cursor = snapshot.roots[0];
    let visited = 0;
    while (cursor) {
      visited += 1;
      cursor = cursor.children.find((child) => child.kind === "topic");
    }

    expect(visited).toBe(depth);
    expect(snapshot.roots[0]?.metrics.structuralPageCount).toBe(depth);
  });
});

function makeVaultRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-knowledge-tree-test-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, ".pige/db"), { recursive: true });
  return root;
}

function childNamed(parent: KnowledgeTreeNode | undefined, title: string): KnowledgeTreeNode | undefined {
  return parent?.children.find((child) => child.title === title);
}

function writePage(vaultPath: string, relativePath: string, input: {
  readonly id: string;
  readonly title: string;
  readonly type?: string;
  readonly status?: string;
  readonly aliases?: readonly string[];
  readonly topics?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly body?: string;
}): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: ${JSON.stringify(input.id)}
schema_version: 1
title: ${JSON.stringify(input.title)}
type: ${JSON.stringify(input.type ?? "note")}
created_at: "2026-07-11T12:00:00.000Z"
updated_at: "2026-07-11T12:00:00.000Z"
status: ${JSON.stringify(input.status ?? "active")}
language: "en"
aliases: ${JSON.stringify(input.aliases ?? [])}
topics: ${JSON.stringify(input.topics ?? [])}
source_ids: ${JSON.stringify(input.sourceIds ?? [])}
---

${input.body ?? `# ${input.title}`}
`, "utf8");
}
