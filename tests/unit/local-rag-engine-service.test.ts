import { describe, expect, it, vi } from "vitest";
import type { RetrievalSearchResult } from "@pige/contracts";
import {
  LocalRagEngineService,
  type LocalRagVectorPort,
  type LocalRagVectorRebuildSession
} from "../../apps/desktop/src/main/services/local-rag-engine-service";
import type {
  LocalDatabaseChunkIndexStatus,
  LocalDatabaseSemanticChunk
} from "../../apps/desktop/src/main/services/local-database-service";

const STATUS: LocalDatabaseChunkIndexStatus = {
  indexedPageCount: 17,
  chunkCount: 17,
  chunkerVersion: "pige-markdown-v1",
  indexRevision: 3,
  indexGeneration: "generation-1"
};

describe("LocalRagEngineService", () => {
  it("streams bounded embedding batches into one current vector generation", async () => {
    const chunks = Array.from({ length: 17 }, (_, index) => chunk(index + 1));
    const appended: number[] = [];
    let committed = false;
    const session: LocalRagVectorRebuildSession = {
      append: (entries) => { appended.push(entries.length); },
      commit: () => { committed = true; return { status: "ready", count: chunks.length }; },
      abort: vi.fn()
    };
    const engine = new LocalRagEngineService({
      database: {
        chunkIndexStatus: () => STATUS,
        semanticChunkBatch: (_vaultPath, request) => {
          const start = request.afterChunkId
            ? chunks.findIndex(({ chunkId }) => chunkId === request.afterChunkId) + 1
            : 0;
          const selected = chunks.slice(start, start + request.limit);
          const next = start + selected.length < chunks.length ? selected.at(-1)?.chunkId : undefined;
          return { ...STATUS, chunks: selected, ...(next ? { nextAfterChunkId: next } : {}) };
        },
        semanticChunksById: () => undefined
      },
      embeddings: {
        available: async () => true,
        availableNow: () => true,
        embedQuery: async () => normalizedVector(),
        embedDocuments: async (texts) => texts.map(() => normalizedVector())
      },
      createVectorPort: () => ({
        beginRebuild: () => session,
        readCurrent: () => ({ status: "unavailable" }),
        search: () => ({ status: "unavailable" })
      })
    });

    await expect(engine.rebuild("/vault")).resolves.toBe("ready");
    expect(appended).toEqual([16, 1]);
    expect(committed).toBe(true);
  });

  it("fuses current semantic pages and returns lexical unchanged on generation drift", async () => {
    const semanticChunks = [chunk(2), chunk(1)];
    let drift = false;
    const vectors: LocalRagVectorPort = {
      beginRebuild: () => { throw new Error("not used"); },
      readCurrent: () => ({ status: "ready", count: 2 }),
      search: () => ({
        status: "ready",
        matches: semanticChunks.map(({ chunkId }, index) => ({ chunkId, distance: index / 10 }))
      })
    };
    const database = {
      chunkIndexStatus: () => drift ? { ...STATUS, indexGeneration: "generation-2" } : STATUS,
      semanticChunkBatch: () => undefined,
      semanticChunksById: () => ({ ...STATUS, chunks: semanticChunks })
    };
    const engine = new LocalRagEngineService({
      database,
      embeddings: {
        available: async () => true,
        availableNow: () => true,
        embedQuery: async () => normalizedVector(),
        embedDocuments: async () => []
      },
      createVectorPort: () => vectors
    });
    const lexical = lexicalResult();
    const hybrid = await engine.search("/vault", {
      scope: { kind: "active_vault", vaultId: lexical.activeVaultId },
      query: lexical.query,
      limit: 8
    }, lexical);

    expect(hybrid.mode).toBe("semantic_hybrid");
    expect(hybrid.results.map(({ summary }) => summary.pageId)).toEqual([
      "page_20260727_0000000000000001",
      "page_20260727_0000000000000002"
    ]);
    expect(JSON.stringify(hybrid)).not.toMatch(/distance|vector|chunk_/u);

    drift = true;
    await expect(engine.search("/vault", {
      scope: { kind: "active_vault", vaultId: lexical.activeVaultId },
      query: lexical.query
    }, lexical)).resolves.toBe(lexical);
  });
});

function chunk(index: number): LocalDatabaseSemanticChunk {
  const suffix = String(index).padStart(32, "0");
  return {
    chunkId: `chunk_${suffix}`,
    text: `Exact semantic passage ${index}`,
    textHash: `sha256:${"a".repeat(64)}`,
    summary: {
      pageId: `page_20260727_${String(index).padStart(16, "0")}`,
      title: `Semantic page ${index}`,
      pageType: "note",
      status: "active",
      pagePath: `wiki/semantic-${index}.md`,
      createdAt: "2026-07-27T12:00:00.000Z",
      updatedAt: "2026-07-27T12:00:00.000Z",
      sourceIds: []
    }
  };
}

function lexicalResult(): RetrievalSearchResult {
  const first = chunk(1);
  return {
    searchedAt: "2026-07-27T12:00:00.000Z",
    activeVaultId: "vault_20260727_semantic",
    query: "semantic passage",
    mode: "lexical_sqlite_fts",
    total: 1,
    invalidPageCount: 0,
    degraded: false,
    results: [{ summary: first.summary, score: 1, snippets: [first.text], matchReasons: ["body"] }]
  };
}

function normalizedVector(): Float32Array {
  const vector = new Float32Array(1_024);
  vector[0] = 1;
  return vector;
}
