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
import {
  readMarkdownPageBodyAtSignature,
  scanMarkdownFileSignatures
} from "../../apps/desktop/src/main/services/markdown-page-index";
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
  it("rejects a request scoped to a different active vault before searching", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);

    expect(() => retrieval.search({
      scope: { kind: "active_vault", vaultId: "vault_20260709_wrongscope" },
      query: "private query body"
    })).toThrowError(expect.objectContaining({
      code: "vault.binding_changed",
      message: "The active vault binding changed during local search."
    }));
  });

  it("rejects an internal search query above the 320-character retrieval bound", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);

    expect(() => retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "a".repeat(321)
    })).toThrowError(expect.objectContaining({ code: "retrieval_query_too_long" }));
  });

  it("fails closed when the active vault path changes after local search", () => {
    const { vaultPath, vault } = makeVault();
    let pathReads = 0;
    const retrieval = new RetrievalService({
      current: () => vault,
      activeVaultPath: () => {
        pathReads += 1;
        return pathReads >= 3 ? path.join(path.dirname(vaultPath), "Replacement") : vaultPath;
      }
    });
    writePage(vaultPath, "wiki/drift.md", {
      id: "page_20260709_drift123",
      title: "Drift Evidence",
      body: "This snippet must not cross a stale vault boundary."
    });

    expect(() => retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "stale vault boundary"
    })).toThrowError(expect.objectContaining({ code: "vault.binding_changed" }));
  });

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

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "local rag",
      limit: 5
    });

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

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "本地识别"
    });

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

    const resultJson = JSON.stringify(retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "source record raw text retrieval"
    }));

    expect(resultJson).toContain("Useful public idea");
    expect(resultJson).not.toContain("raw/text");
    expect(resultJson).not.toContain(".pige/source-records");
  });

  it("rejects a scanned page replaced by an external symlink before body read", () => {
    const { vaultPath } = makeVault();
    writePage(vaultPath, "wiki/replaced.md", {
      id: "page_20260709_replaced1",
      title: "Replace Me",
      body: "Original safe body."
    });
    const [signature] = scanMarkdownFileSignatures(vaultPath);
    if (!signature) throw new Error("Expected scanned Markdown signature.");
    const externalPath = path.join(path.dirname(vaultPath), "outside-private.md");
    fs.writeFileSync(externalPath, "PRIVATE_EXTERNAL_BODY", "utf8");
    fs.unlinkSync(signature.absolutePath);
    fs.symlinkSync(externalPath, signature.absolutePath);

    expect(() => readMarkdownPageBodyAtSignature(vaultPath, signature, 128 * 1024)).toThrow();
  });

  it("reads a sparse Markdown page only through the explicit byte budget", () => {
    const { vaultPath } = makeVault();
    writePage(vaultPath, "wiki/sparse.md", {
      id: "page_20260709_sparse01",
      title: "Sparse Page",
      body: "bounded prefix"
    });
    const filePath = path.join(vaultPath, "wiki/sparse.md");
    fs.truncateSync(filePath, 512 * 1024 * 1024);
    const signature = scanMarkdownFileSignatures(vaultPath).find((item) => item.absolutePath === filePath);
    if (!signature) throw new Error("Expected sparse Markdown signature.");

    const bounded = readMarkdownPageBodyAtSignature(vaultPath, signature, 128 * 1024);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(128 * 1024);
    expect(bounded).toContain("bounded prefix");
  });

  it("omits producer metadata outside renderer bounds instead of failing the search", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/valid.md", {
      id: "page_20260709_valid001",
      title: "Valid Match",
      body: "bounded producer compatibility"
    });
    writePage(vaultPath, "wiki/oversized.MD", {
      id: `page_20260709_${"a".repeat(160)}`,
      title: "Oversized Identity",
      body: "bounded producer compatibility"
    });

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "bounded producer compatibility"
    });

    expect(result.results.map((item) => item.summary.title)).toEqual(["Valid Match"]);
    expect(result.invalidPageCount).toBe(1);
  });

  it("does not let an invalid indexed match suppress a lower-ranked valid result", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeIndexedRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/invalid-indexed.md", {
      id: `page_20260709_${"a".repeat(160)}`,
      title: "Exact bounded indexed match",
      body: "Exact bounded indexed match"
    });
    writePage(vaultPath, "wiki/valid-indexed.md", {
      id: "page_20260709_valididx1",
      title: "Valid Indexed Result",
      body: "This lower-ranked page contains the exact bounded indexed match."
    });

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "exact bounded indexed match",
      limit: 1
    });

    expect(result.mode).toBe("lexical_sqlite_fts");
    expect(result.total).toBe(1);
    expect(result.invalidPageCount).toBe(1);
    expect(result.results.map((item) => item.summary.title)).toEqual(["Valid Indexed Result"]);
  });

  it("uses SQLite FTS when the local database service is available", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeIndexedRetrieval(vaultPath, vault);
    writePage(vaultPath, "wiki/indexed.md", {
      id: "page_20260709_indexed1",
      title: "Indexed Retrieval",
      body: "SQLite FTS should serve local vault search when the index is ready."
    });

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "sqlite search"
    });

    expect(result.mode).toBe("lexical_sqlite_fts");
    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeUndefined();
    expect(result.results[0]?.summary.title).toBe("Indexed Retrieval");
  });

  it("projects SQLite FTS snippets into the renderer character bound", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeIndexedRetrieval(vaultPath, vault);
    const longToken = "a".repeat(320);
    writePage(vaultPath, "wiki/bounded-indexed-snippet.md", {
      id: "page_20260709_boundfts1",
      title: "Bounded Indexed Snippet",
      body: longToken
    });

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: longToken
    });

    expect(result.mode).toBe("lexical_sqlite_fts");
    expect(result.results[0]?.snippets[0]?.length).toBeLessThanOrEqual(260);
  });

  it("builds bounded context evidence with citations and ranked pages", () => {
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

    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "How does local retrieval work?",
      limit: 8
    });
    const context = buildHomeQueryContextPack(result);

    expect(context.selectedEvidence).toHaveLength(2);
    expect(context.selectedEvidence[0]?.citation).toMatchObject({
      refId: "citation_1",
      label: "[1]",
      pageId: "page_20260709_answer01",
      locator: "snippet:1"
    });
    expect(result.results[0]?.summary.title).toBe("RAG Pipeline");
    expect(JSON.stringify(context)).not.toContain("FULL_BODY_SENTINEL_MUST_NOT_LEAK");
  });

  it("serializes context-pack refs and budgets without selected snippet bodies", () => {
    const { vaultPath, vault } = makeVault();
    const retrieval = makeRetrieval(vaultPath, vault);
    for (let index = 0; index < 12; index += 1) {
      writePage(vaultPath, `wiki/evidence-${index}.md`, {
        id: `page_20260709_bound${String(index).padStart(3, "0")}`,
        title: `Bounded Evidence ${index}`,
        body: `Bounded retrieval evidence ${index}. private-body-${index}`
      });
    }

    const search = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: "bounded retrieval evidence",
      limit: 20
    });
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
