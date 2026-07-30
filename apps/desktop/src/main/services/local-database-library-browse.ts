import type { DatabaseSync } from "node:sqlite";
import type { LibraryPageSummary } from "@pige/contracts";

export interface LocalDatabaseLibraryPageSliceRequest {
  readonly offset: number;
  readonly limit: number;
}

export interface LocalDatabaseLibraryPageSlice {
  readonly indexGeneration: string;
  readonly total: number;
  readonly invalidPageCount: number;
  readonly pages: readonly LibraryPageSummary[];
  readonly previousPage?: LibraryPageSummary;
}

export function readLocalDatabaseLibraryPageSlice(
  db: DatabaseSync,
  request: LocalDatabaseLibraryPageSliceRequest,
  toSummary: (row: Record<string, unknown>) => LibraryPageSummary
): LocalDatabaseLibraryPageSlice | undefined {
  const generationBefore = generation(db);
  if (!generationBefore) return undefined;
  const total = numeric(db.prepare("SELECT COUNT(*) AS value FROM pages").get()?.value);
  const invalidPageCount = numeric(
    db.prepare("SELECT invalid_page_count AS value FROM index_state WHERE id = 1").get()?.value
  );
  const offset = Math.max(0, Math.floor(request.offset));
  const limit = Math.max(1, Math.min(50, Math.floor(request.limit)));
  const rows = db.prepare(
    "SELECT * FROM pages ORDER BY updated_at DESC, page_path ASC LIMIT ? OFFSET ?"
  ).all(limit, offset);
  const previousRow = offset === 0 ? undefined : db.prepare(
    "SELECT * FROM pages ORDER BY updated_at DESC, page_path ASC LIMIT 1 OFFSET ?"
  ).get(offset - 1);
  if (generation(db) !== generationBefore) return undefined;
  return {
    indexGeneration: generationBefore, total, invalidPageCount,
    pages: rows.map(toSummary), ...(previousRow ? { previousPage: toSummary(previousRow) } : {})
  };
}

function generation(db: DatabaseSync): string | undefined {
  const value = db.prepare("SELECT rebuilt_at FROM index_state WHERE id = 1").get()?.rebuilt_at;
  return typeof value === "string" ? value : undefined;
}

function numeric(value: unknown): number {
  return typeof value === "number" || typeof value === "bigint" ? Number(value) : 0;
}
