import { createHash, randomBytes } from "node:crypto";
import type {
  KnowledgeActivityListRequest,
  KnowledgeActivityListResult,
  KnowledgeActivitySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { OperationRecord } from "@pige/schemas";

const DEFAULT_ACTIVITY_LIMIT = 5;
const MAX_ACTIVITY_LIMIT = 20;
const DEFAULT_CURSOR_CAPACITY = 128;

interface ActivityCursorBinding {
  readonly activeVaultId: string;
  readonly vaultPath: string;
  readonly snapshotHash: string;
  readonly offset: number;
  readonly boundaryOperationId: string;
  readonly boundaryCreatedAt: string;
}

export class KnowledgeActivityHistory {
  readonly #cursors = new Map<string, ActivityCursorBinding>();
  readonly #cursorCapacity: number;

  constructor(cursorCapacity = DEFAULT_CURSOR_CAPACITY) {
    this.#cursorCapacity = Math.max(1, cursorCapacity);
  }

  list(input: {
    readonly request: KnowledgeActivityListRequest;
    readonly activeVaultId: string;
    readonly vaultPath: string;
    readonly operations: readonly OperationRecord[];
    readonly invalidOperationCount: number;
    readonly summarize: (operation: OperationRecord) => KnowledgeActivitySummary | undefined;
  }): KnowledgeActivityListResult {
    const limit = clampLimit(input.request.limit);
    const activities = input.operations
      .map(input.summarize)
      .filter((summary): summary is KnowledgeActivitySummary => summary !== undefined)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.operationId.localeCompare(right.operationId));
    const snapshotHash = createSnapshotHash(activities);
    let offset = 0;
    if (input.request.cursor) {
      const binding = this.#cursors.get(input.request.cursor);
      if (!binding || binding.activeVaultId !== input.activeVaultId || binding.vaultPath !== input.vaultPath ||
        binding.snapshotHash !== snapshotHash || binding.offset < 1 ||
        activities[binding.offset - 1]?.operationId !== binding.boundaryOperationId ||
        activities[binding.offset - 1]?.createdAt !== binding.boundaryCreatedAt) {
        throw staleCursor();
      }
      offset = binding.offset;
    }
    if (offset >= activities.length && activities.length > 0) throw staleCursor();
    const page = activities.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < activities.length;
    const nextCursor = hasMore ? this.#registerCursor({
      activeVaultId: input.activeVaultId,
      vaultPath: input.vaultPath,
      snapshotHash,
      offset: nextOffset,
      boundaryOperationId: activities[nextOffset - 1]!.operationId,
      boundaryCreatedAt: activities[nextOffset - 1]!.createdAt
    }) : undefined;
    return {
      scannedAt: new Date().toISOString(),
      activeVaultId: input.activeVaultId,
      total: activities.length,
      invalidOperationCount: input.invalidOperationCount,
      activities: page,
      hasMore,
      ...(nextCursor ? { nextCursor } : {})
    };
  }

  #registerCursor(binding: ActivityCursorBinding): string {
    const cursor = `activity_history_${randomBytes(32).toString("hex")}`;
    this.#cursors.set(cursor, binding);
    while (this.#cursors.size > this.#cursorCapacity) {
      const oldest = this.#cursors.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#cursors.delete(oldest);
    }
    return cursor;
  }
}

function createSnapshotHash(activities: readonly KnowledgeActivitySummary[]): string {
  return createHash("sha256").update(JSON.stringify(activities.map((activity) => [
    activity.operationId,
    activity.createdAt,
    activity.status
  ]))).digest("hex");
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ACTIVITY_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw new PigeDomainError("activity.invalid_limit", "The Activity list limit is invalid.");
  }
  return Math.min(value, MAX_ACTIVITY_LIMIT);
}

function staleCursor(): PigeDomainError {
  return new PigeDomainError("activity.history_stale", "The Activity history changed before the next page was read.");
}
