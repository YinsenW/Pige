import type {
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRunRequest,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import {
  KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES,
  KnowledgeHealthRunResultSchema
} from "@pige/schemas";
import type { LocalDatabaseService } from "./local-database-service";

export class KnowledgeHealthService {
  readonly #database: Pick<LocalDatabaseService, "knowledgeHealth">;
  readonly #now: () => string;

  constructor(
    database: Pick<LocalDatabaseService, "knowledgeHealth">,
    now: () => string = () => new Date().toISOString()
  ) {
    this.#database = database;
    this.#now = now;
  }

  run(vaultPath: string, request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
    try {
      const snapshot = this.#database.knowledgeHealth(vaultPath);
      if (!snapshot) return unavailable(request);
      const issues = [...snapshot.issues];
      let result = readyResult(request, snapshot, this.#now(), issues, snapshot.truncated);
      while (utf8ByteLength(result) > KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES && issues.length > 0) {
        issues.pop();
        result = readyResult(request, snapshot, result.checkedAt, issues, true);
      }
      if (utf8ByteLength(result) > KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES) return failed(request);
      return KnowledgeHealthRunResultSchema.parse(result);
    } catch {
      return failed(request);
    }
  }
}

function readyResult(
  request: KnowledgeHealthRunRequest,
  snapshot: NonNullable<ReturnType<LocalDatabaseService["knowledgeHealth"]>>,
  checkedAt: string,
  issues: readonly KnowledgeHealthIssueSummary[],
  truncated: boolean
): Extract<KnowledgeHealthRunResult, { readonly status: "ready" }> {
  return {
    ...request,
    status: "ready",
    checkedAt,
    indexGeneration: snapshot.indexGeneration,
    coverage: snapshot.invalidPageCount === 0 ? "complete" : "partial",
    invalidPageCount: snapshot.invalidPageCount,
    counts: snapshot.counts,
    issues: [...issues],
    truncated: truncated || snapshot.counts.totalIssueCount > issues.length
  };
}

function unavailable(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "unavailable" });
}

function failed(request: KnowledgeHealthRunRequest): KnowledgeHealthRunResult {
  return KnowledgeHealthRunResultSchema.parse({ ...request, status: "failed" });
}

function utf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
