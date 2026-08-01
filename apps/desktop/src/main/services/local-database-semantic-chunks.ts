import { createHash } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LibraryPageSummary } from "@pige/contracts";
import type { ChunkLanguageFact } from "@pige/schemas";
import {
  MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES,
  readMarkdownPageBodyAtSignature
} from "./markdown-page-index";
import { RAG_CHUNKER_VERSION } from "./rag-chunker";
import { sanitizeSearchBody } from "./search-text-utils";
import { inheritedChunkLanguage } from "./durable-language";

const CURRENT_INDEX_REVISION = 7;
const MAX_INDEXED_BODY_CHARS = 500_000;
const MAX_INDEXED_BODY_BYTES = MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES + (MAX_INDEXED_BODY_CHARS * 4);
const CHUNK_ID_PATTERN = /^chunk_[a-f0-9]{32}$/u;

export interface LocalDatabaseChunkIndexStatus {
  readonly indexedPageCount: number;
  readonly chunkCount: number;
  readonly chunkerVersion: string;
  readonly indexRevision: number;
  readonly indexGeneration: string;
}

export interface LocalDatabaseSemanticChunkBatchRequest {
  readonly expectedGeneration?: string;
  readonly afterChunkId?: string;
  readonly limit: number;
}

export interface LocalDatabaseSemanticChunksByIdRequest {
  readonly expectedGeneration: string;
  readonly chunkIds: readonly string[];
}

export interface LocalDatabaseSemanticChunk {
  readonly chunkId: string;
  readonly text: string;
  readonly textHash: string;
  readonly summary: LibraryPageSummary;
  readonly language: ChunkLanguageFact;
}

export interface LocalDatabaseSemanticChunkBatch {
  readonly indexRevision: number;
  readonly indexGeneration: string;
  readonly chunkerVersion: string;
  readonly chunks: readonly LocalDatabaseSemanticChunk[];
  readonly nextAfterChunkId?: string;
}

export interface LocalDatabaseSemanticReadPort {
  readonly openDatabase: (vaultPath: string) => DatabaseSync;
  readonly ensureReady: (vaultPath: string) => boolean;
  readonly needsRebuild: (vaultPath: string) => boolean;
  readonly rowToSummary: (row: Record<string, unknown>) => LibraryPageSummary;
}

export function readSemanticChunkIndexStatus(
  port: LocalDatabaseSemanticReadPort,
  vaultPath: string
): LocalDatabaseChunkIndexStatus | undefined {
  if (!port.ensureReady(vaultPath)) return undefined;
  const db = port.openDatabase(vaultPath);
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS chunk_count, COUNT(DISTINCT owner_id) AS page_count,
        MIN(chunker_version) AS min_version, MAX(chunker_version) AS max_version
      FROM chunks
    `).get();
    const minimumVersion = String(row?.min_version ?? RAG_CHUNKER_VERSION);
    const maximumVersion = String(row?.max_version ?? RAG_CHUNKER_VERSION);
    const state = readSemanticIndexState(db);
    if (!state || minimumVersion !== maximumVersion || maximumVersion !== RAG_CHUNKER_VERSION) return undefined;
    return {
      indexedPageCount: toNumber(row?.page_count),
      chunkCount: toNumber(row?.chunk_count),
      chunkerVersion: maximumVersion,
      indexRevision: state.indexRevision,
      indexGeneration: state.indexGeneration
    };
  } finally {
    db.close();
  }
}

export function readSemanticChunkBatch(
  port: LocalDatabaseSemanticReadPort,
  vaultPath: string,
  request: LocalDatabaseSemanticChunkBatchRequest
): LocalDatabaseSemanticChunkBatch | undefined {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 16 ||
    (request.afterChunkId !== undefined && !CHUNK_ID_PATTERN.test(request.afterChunkId))) return undefined;
  if (!port.ensureReady(vaultPath)) return undefined;
  const db = port.openDatabase(vaultPath);
  try {
    const state = readSemanticIndexState(db);
    if (!state || (request.expectedGeneration && request.expectedGeneration !== state.indexGeneration)) return undefined;
    const rows = db.prepare(`${semanticChunkSelectSql()} WHERE c.chunk_id > ? ORDER BY c.chunk_id ASC LIMIT ?`)
      .all(request.afterChunkId ?? "", request.limit + 1);
    const chunks = readCurrentRows(port, vaultPath, rows.slice(0, request.limit));
    if (!isStillCurrent(port, vaultPath, db, state.indexGeneration, chunks)) return undefined;
    return {
      ...state,
      chunks,
      ...(rows.length > request.limit && chunks.length > 0
        ? { nextAfterChunkId: chunks[chunks.length - 1]!.chunkId }
        : {})
    };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

export function readSemanticChunksById(
  port: LocalDatabaseSemanticReadPort,
  vaultPath: string,
  request: LocalDatabaseSemanticChunksByIdRequest
): LocalDatabaseSemanticChunkBatch | undefined {
  const chunkIds = [...new Set(request.chunkIds)];
  if (chunkIds.length === 0 || chunkIds.length > 64 || chunkIds.some((id) => !CHUNK_ID_PATTERN.test(id))) {
    return undefined;
  }
  if (!port.ensureReady(vaultPath)) return undefined;
  const db = port.openDatabase(vaultPath);
  try {
    const state = readSemanticIndexState(db);
    if (!state || state.indexGeneration !== request.expectedGeneration) return undefined;
    const placeholders = chunkIds.map(() => "?").join(", ");
    const rows = db.prepare(`${semanticChunkSelectSql()} WHERE c.chunk_id IN (${placeholders}) ORDER BY c.chunk_id ASC`)
      .all(...chunkIds);
    if (rows.length !== chunkIds.length) return undefined;
    const chunks = readCurrentRows(port, vaultPath, rows);
    return isStillCurrent(port, vaultPath, db, state.indexGeneration, chunks) ? { ...state, chunks } : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function semanticChunkSelectSql(): string {
  return `SELECT c.*, p.*, v.size_bytes, v.mtime_ms, v.ctime_ms, v.device_id, v.file_id
    FROM chunks c JOIN pages p ON p.page_id = c.owner_id
    JOIN vault_files v ON v.page_id = p.page_id AND v.path = c.page_path`;
}

function readSemanticIndexState(db: DatabaseSync): Pick<
  LocalDatabaseSemanticChunkBatch,
  "indexRevision" | "indexGeneration" | "chunkerVersion"
> | undefined {
  const indexRevision = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  if (indexRevision !== CURRENT_INDEX_REVISION) return undefined;
  const state = db.prepare("SELECT rebuilt_at FROM index_state WHERE id = 1").get();
  const version = db.prepare("SELECT MIN(chunker_version) AS minimum, MAX(chunker_version) AS maximum FROM chunks").get();
  const indexGeneration = typeof state?.rebuilt_at === "string" ? state.rebuilt_at : undefined;
  const minimum = version?.minimum === null ? RAG_CHUNKER_VERSION : String(version?.minimum ?? "");
  const maximum = version?.maximum === null ? RAG_CHUNKER_VERSION : String(version?.maximum ?? "");
  return indexGeneration && minimum === RAG_CHUNKER_VERSION && maximum === RAG_CHUNKER_VERSION
    ? { indexRevision, indexGeneration, chunkerVersion: RAG_CHUNKER_VERSION }
    : undefined;
}

function readCurrentRows(
  port: LocalDatabaseSemanticReadPort,
  vaultPath: string,
  rows: readonly Record<string, unknown>[]
): readonly LocalDatabaseSemanticChunk[] | undefined {
  const bodyByPage = new Map<string, string>();
  const chunks: LocalDatabaseSemanticChunk[] = [];
  for (const row of rows) {
    const pagePath = String(row.page_path);
    let body = bodyByPage.get(pagePath);
    if (body === undefined) {
      body = readMarkdownPageBodyAtSignature(vaultPath, {
        absolutePath: path.resolve(vaultPath, pagePath), pagePath,
        sizeBytes: toNumber(row.size_bytes), mtimeMs: toNumber(row.mtime_ms),
        ctimeMs: toNumber(row.ctime_ms), deviceId: String(row.device_id), fileId: String(row.file_id)
      }, MAX_INDEXED_BODY_BYTES).slice(0, MAX_INDEXED_BODY_CHARS);
      bodyByPage.set(pagePath, body);
    }
    const start = toNumber(row.character_start);
    const end = toNumber(row.character_end);
    const text = sanitizeSearchBody(body.slice(start, end));
    const textHash = String(row.text_hash);
    if (String(row.chunker_version) !== RAG_CHUNKER_VERSION || start < 0 || end <= start || end > body.length ||
      `sha256:${createHash("sha256").update(text).digest("hex")}` !== textHash) return undefined;
    const summary = port.rowToSummary(row);
    chunks.push({ chunkId: String(row.chunk_id), text, textHash, summary, language: inheritedChunkLanguage(summary.language) });
  }
  return chunks;
}

function isStillCurrent(
  port: LocalDatabaseSemanticReadPort,
  vaultPath: string,
  db: DatabaseSync,
  generation: string,
  chunks: readonly LocalDatabaseSemanticChunk[] | undefined
): chunks is readonly LocalDatabaseSemanticChunk[] {
  return Boolean(chunks) && readSemanticIndexState(db)?.indexGeneration === generation && !port.needsRebuild(vaultPath);
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}
