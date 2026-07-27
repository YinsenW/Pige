import type {
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem
} from "@pige/contracts";
import {
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_REVISION
} from "@pige/schemas";
import type {
  LocalDatabaseChunkIndexStatus,
  LocalDatabaseSemanticChunk,
  LocalDatabaseService
} from "./local-database-service";
import type { LocalSemanticEmbeddingRuntime } from "./local-semantic-embedding-runtime";
import {
  SQLITE_VECTOR_DIMENSION,
  type SqliteVectorIndexMetadata,
  type SqliteVectorIndexEntry,
  type SqliteVectorIndexReadResult,
  type SqliteVectorSearchResult
} from "./sqlite-vector-index-driver";
import { truncateSearchSnippet } from "./search-text-utils";

const VECTOR_CANDIDATE_LIMIT = 32;
const RECIPROCAL_RANK_OFFSET = 60;

export interface LocalRagEngineServiceOptions {
  readonly database: Pick<
    LocalDatabaseService,
    "chunkIndexStatus" | "semanticChunkBatch" | "semanticChunksById"
  >;
  readonly embeddings: Pick<
    LocalSemanticEmbeddingRuntime,
    "available" | "availableNow" | "embedQuery" | "embedDocuments"
  >;
  readonly createVectorPort: (vaultPath: string) => LocalRagVectorPort | Promise<LocalRagVectorPort>;
}

export interface LocalRagVectorRebuildSession {
  append(entries: readonly SqliteVectorIndexEntry[]): void;
  commit(): SqliteVectorIndexReadResult;
  abort(): void;
}

export interface LocalRagVectorPort {
  beginRebuild(metadata: SqliteVectorIndexMetadata): LocalRagVectorRebuildSession;
  readCurrent(metadata: SqliteVectorIndexMetadata): SqliteVectorIndexReadResult;
  search(input: {
    readonly metadata: SqliteVectorIndexMetadata;
    readonly queryVector: readonly number[];
    readonly k: number;
  }): SqliteVectorSearchResult;
}

export class LocalRagEngineService {
  readonly #database: LocalRagEngineServiceOptions["database"];
  readonly #embeddings: LocalRagEngineServiceOptions["embeddings"];
  readonly #createVectorPort: LocalRagEngineServiceOptions["createVectorPort"];
  readonly #readyGenerations = new Map<string, string>();

  constructor(options: LocalRagEngineServiceOptions) {
    this.#database = options.database;
    this.#embeddings = options.embeddings;
    this.#createVectorPort = options.createVectorPort;
  }

  async rebuild(
    vaultPath: string,
    signal?: AbortSignal
  ): Promise<"ready" | "skipped" | "failed"> {
    let session: LocalRagVectorRebuildSession | undefined;
    try {
      const status = this.#database.chunkIndexStatus(vaultPath);
      if (!status) return "failed";
      if (!await this.#embeddings.available()) return "skipped";
      const vectors = await this.#createVectorPort(vaultPath);
      const metadata = vectorMetadata(status);
      session = vectors.beginRebuild(metadata);
      let afterChunkId: string | undefined;
      do {
        throwIfAborted(signal);
        const batch = this.#database.semanticChunkBatch(vaultPath, {
          expectedGeneration: status.indexGeneration,
          ...(afterChunkId ? { afterChunkId } : {}),
          limit: 16
        });
        if (!batch || batch.indexGeneration !== status.indexGeneration) throw new Error("Chunk generation changed.");
        if (batch.chunks.length > 0) {
          const vectors = await this.#embeddings.embedDocuments(batch.chunks.map(({ text }) => text));
          throwIfAborted(signal);
          session.append(batch.chunks.map((chunk, index) => ({
            chunkId: chunk.chunkId,
            vector: Array.from(vectors[index]!)
          })));
        }
        afterChunkId = batch.nextAfterChunkId;
      } while (afterChunkId);
      const current = this.#database.chunkIndexStatus(vaultPath);
      if (!current || current.indexGeneration !== status.indexGeneration) throw new Error("Chunk index changed.");
      const committed = session.commit();
      session = undefined;
      if (committed.status === "ready") this.#readyGenerations.set(vaultPath, status.indexGeneration);
      return committed.status === "ready" ? "ready" : "failed";
    } catch {
      session?.abort();
      this.#readyGenerations.delete(vaultPath);
      return "failed";
    }
  }

  async search(
    vaultPath: string,
    request: RetrievalSearchRequest,
    lexical: RetrievalSearchResult
  ): Promise<RetrievalSearchResult> {
    try {
      const status = this.#database.chunkIndexStatus(vaultPath);
      if (!status || !await this.#embeddings.available()) return lexical;
      const vectors = await this.#createVectorPort(vaultPath);
      const metadata = vectorMetadata(status);
      if (vectors.readCurrent(metadata).status !== "ready") return lexical;
      const queryVector = await this.#embeddings.embedQuery(request.query);
      const vectorResult = vectors.search({
        metadata,
        queryVector: Array.from(queryVector),
        k: VECTOR_CANDIDATE_LIMIT
      });
      if (vectorResult.status !== "ready" || vectorResult.matches.length === 0) return lexical;
      const selected = this.#database.semanticChunksById(vaultPath, {
        expectedGeneration: status.indexGeneration,
        chunkIds: vectorResult.matches.map(({ chunkId }) => chunkId)
      });
      if (!selected || selected.indexGeneration !== status.indexGeneration) return lexical;
      const chunks = new Map(selected.chunks.map((chunk) => [chunk.chunkId, chunk]));
      const semantic: LocalDatabaseSemanticChunk[] = [];
      const seenPages = new Set<string>();
      for (const match of vectorResult.matches) {
        const chunk = chunks.get(match.chunkId);
        if (!chunk) return lexical;
        if (!seenPages.has(chunk.summary.pageId)) {
          seenPages.add(chunk.summary.pageId);
          semantic.push(chunk);
        }
      }
      const current = this.#database.chunkIndexStatus(vaultPath);
      if (!current || current.indexGeneration !== status.indexGeneration) return lexical;
      this.#readyGenerations.set(vaultPath, status.indexGeneration);
      return fuseResults(lexical, semantic, request.limit);
    } catch {
      this.#readyGenerations.delete(vaultPath);
      return lexical;
    }
  }

  async available(vaultPath: string): Promise<boolean> {
    try {
      const status = this.#database.chunkIndexStatus(vaultPath);
      if (!status || !await this.#embeddings.available()) return false;
      const vectors = await this.#createVectorPort(vaultPath);
      const ready = vectors.readCurrent(vectorMetadata(status)).status === "ready";
      if (ready) this.#readyGenerations.set(vaultPath, status.indexGeneration);
      else this.#readyGenerations.delete(vaultPath);
      return ready;
    } catch {
      this.#readyGenerations.delete(vaultPath);
      return false;
    }
  }

  availableNow(vaultPath: string): boolean {
    const status = this.#database.chunkIndexStatus(vaultPath);
    return Boolean(status) && this.#embeddings.availableNow() &&
      this.#readyGenerations.get(vaultPath) === status?.indexGeneration;
  }
}

function vectorMetadata(status: LocalDatabaseChunkIndexStatus): SqliteVectorIndexMetadata {
  return {
    schemaVersion: 1,
    modelAssetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
    modelAssetRevision: LOCAL_SEMANTIC_RETRIEVAL_ASSET_REVISION,
    dimension: SQLITE_VECTOR_DIMENSION,
    chunkerVersion: status.chunkerVersion,
    sourceIndexGeneration: status.indexGeneration
  };
}

function fuseResults(
  lexical: RetrievalSearchResult,
  semantic: readonly LocalDatabaseSemanticChunk[],
  requestedLimit: number | undefined
): RetrievalSearchResult {
  const candidates = new Map<string, RetrievalSearchResultItem>();
  const scores = new Map<string, number>();
  lexical.results.forEach((item, index) => {
    candidates.set(item.summary.pageId, item);
    scores.set(item.summary.pageId, reciprocalRank(index));
  });
  semantic.forEach((chunk, index) => {
    const pageId = chunk.summary.pageId;
    if (!candidates.has(pageId)) {
      candidates.set(pageId, {
        summary: chunk.summary,
        score: 0,
        snippets: [truncateSearchSnippet(chunk.text.trim())],
        matchReasons: ["semantic_similarity"]
      });
    }
    scores.set(pageId, (scores.get(pageId) ?? 0) + reciprocalRank(index));
  });
  const limit = Math.max(1, Math.min(20, requestedLimit ?? 8));
  const results = [...candidates.values()]
    .map((item) => ({ ...item, score: Number((scores.get(item.summary.pageId) ?? 0).toFixed(8)) }))
    .sort((left, right) => right.score - left.score || left.summary.pageId.localeCompare(right.summary.pageId))
    .slice(0, limit);
  const { degradedReason: _degradedReason, ...withoutReason } = lexical;
  return {
    ...withoutReason,
    mode: "semantic_hybrid",
    total: Math.max(lexical.total, candidates.size),
    degraded: false,
    results
  };
}

function reciprocalRank(index: number): number {
  return 1 / (RECIPROCAL_RANK_OFFSET + index + 1);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Local semantic rebuild was cancelled.");
}
