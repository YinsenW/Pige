import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import {
  buildHomeQueryContextPack,
  RetrievalService
} from "../../apps/desktop/src/main/services/retrieval-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-retrieval-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Retrieval",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Retrieval");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeRetrieval(vaultPath: string, vault: VaultSummary): RetrievalService {
  return new RetrievalService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  });
}

function makeIndexedRetrieval(vaultPath: string, vault: VaultSummary): RetrievalService {
  return new RetrievalService(
    {
      current: () => vault,
      activeVaultPath: () => vaultPath
    },
    new LocalDatabaseService()
  );
}

function writePage(vaultPath: string, relativePath: string, input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly type?: string;
  readonly language?: string;
}): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${input.id}"
schema_version: 1
title: "${input.title}"
type: "${input.type ?? "note"}"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "${input.language ?? "en"}"
source_ids: []
---

${input.body}
`, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("retrieval service", () => {
  it("returns ranked lexical results with snippets and match reasons", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/local-rag.md", {
      id: "page_20260709_rag12345",
      title: "Local RAG Design",
      body: "Local RAG uses lexical search first and vector retrieval later."
    });
    writePage(vaultPath, "wiki/other.md", {
      id: "page_20260709_other123",
      title: "Cooking Notes",
      body: "A pantry note about herbs."
    });

    const result = retrieval.search({ query: "local rag", limit: 5 });

    expect(result.mode).toBe("lexical_markdown_scan");
    expect(result.degradedReason).toBe("local_database_not_ready");
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.summary.title).toBe("Local RAG Design");
    expect(result.results[0]?.snippets[0]).toContain("Local RAG uses lexical search");
    expect(result.results[0]?.matchReasons).toContain("title");
  });

  it("uses CJK-friendly character grams instead of whitespace-only matching", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/ocr.md", {
      id: "page_20260709_cjk12345",
      title: "本地 OCR 方案",
      body: "截图和扫描 PDF 需要本地识别能力。",
      language: "zh-Hans"
    });

    const result = retrieval.search({ query: "本地识别" });

    expect(result.total).toBe(1);
    expect(result.results[0]?.summary.title).toBe("本地 OCR 方案");
    expect(result.results[0]?.snippets[0]).toContain("本地识别能力");
  });

  it("does not expose internal source storage paths through snippets", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "sources/text/2026/source.md", {
      id: "page_20260709_source12",
      title: "Source Page",
      type: "source",
      body: `# Source Page

Useful public idea about retrieval.

- Managed copy: \`raw/text/2026/07/src_20260709_secret.txt\`
- Source record: \`.pige/source-records/2026/07/src_20260709_secret.json\`
`
    });

    const resultJson = JSON.stringify(retrieval.search({ query: "source record raw text retrieval" }));

    expect(resultJson).toContain("Useful public idea");
    expect(resultJson).not.toContain("raw/text");
    expect(resultJson).not.toContain(".pige/source-records");
  });

  it("uses SQLite FTS when the local database service is available", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeIndexedRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/indexed.md", {
      id: "page_20260709_indexed1",
      title: "Indexed Retrieval",
      body: "SQLite FTS should serve local vault search when the index is ready."
    });

    const result = retrieval.search({ query: "sqlite search" });

    expect(result.mode).toBe("lexical_sqlite_fts");
    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeUndefined();
    expect(result.results[0]?.summary.title).toBe("Indexed Retrieval");
  });

  it("answers from bounded local evidence with citations and ranked pages", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/rag-pipeline.md", {
      id: "page_20260709_answer01",
      title: "RAG Pipeline",
      body: `Local retrieval selects bounded snippets before synthesis.

${"Supporting context stays inside the bounded preview. ".repeat(12)}FULL_BODY_SENTINEL_MUST_NOT_LEAK`
    });
    writePage(vaultPath, "wiki/rag-privacy.md", {
      id: "page_20260709_answer02",
      title: "RAG Privacy",
      body: "Local retrieval keeps the whole vault out of cloud model requests."
    });

    const result = retrieval.ask({ query: "How does local retrieval work?", locale: "en", limit: 8 });

    expect(result.answerMode).toBe("local_extractive");
    expect(result.confidence).toBe("grounded");
    expect(result.answer).toContain("The most relevant local notes");
    expect(result.answer).toContain("[1]");
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0]).toMatchObject({
      refId: "citation_1",
      label: "[1]",
      pageId: "page_20260709_answer01",
      locator: "snippet:1"
    });
    expect(result.results[0]?.summary.title).toBe("RAG Pipeline");
    expect(JSON.stringify(result)).not.toContain("FULL_BODY_SENTINEL_MUST_NOT_LEAK");
  });

  it("returns an explicit insufficient-evidence answer without citations", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);

    const result = retrieval.ask({ query: "What did we decide about lunar orchards?", locale: "en" });

    expect(result.confidence).toBe("insufficient");
    expect(result.citations).toEqual([]);
    expect(result.results).toEqual([]);
    expect(result.warnings).toContain("insufficient_evidence");
    expect(result.answer).toContain("not enough evidence");
  });

  it("keeps CJK answers usable before semantic retrieval is installed", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/local-ocr.md", {
      id: "page_20260709_answerzh",
      title: "本地 OCR",
      body: "图片和扫描文档需要先在本地完成文字识别，再进入检索索引。",
      language: "zh-Hans"
    });

    const result = retrieval.ask({ query: "本地文字识别怎么处理？", locale: "en" });

    expect(result.answer).toContain("本地笔记中最相关的内容");
    expect(result.answer).toContain("文字识别");
    expect(result.citations[0]?.pageId).toBe("page_20260709_answerzh");
  });

  it("serializes context-pack refs and budgets without selected snippet bodies", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    for (let index = 0; index < 12; index += 1) {
      writePage(vaultPath, `wiki/evidence-${index}.md`, {
        id: `page_20260709_bound${String(index).padStart(2, "0")}`,
        title: `Bounded Evidence ${index}`,
        body: `Bounded retrieval evidence ${index}. private-body-${index}`
      });
    }

    const search = retrieval.search({ query: "bounded retrieval evidence", limit: 20 });
    const context = buildHomeQueryContextPack(search);
    const serializedPack = JSON.stringify(context.pack);

    expect(context.pack.evidenceRefs).toHaveLength(8);
    expect(context.pack.omitted).toEqual([{ reason: "evidence_limit", count: 4 }]);
    expect(context.pack.evidenceRefs.every((ref) => ref.budgetTokens > 0)).toBe(true);
    expect(context.selectedEvidence).toHaveLength(8);
    expect(serializedPack).not.toContain("private-body");
    expect(serializedPack).not.toContain("Bounded retrieval evidence");
    expect(serializedPack).not.toContain("wiki/evidence");
  });
});
