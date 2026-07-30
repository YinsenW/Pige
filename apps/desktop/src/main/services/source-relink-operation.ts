import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type OperationRecord, type SourceRecord } from "@pige/schemas";

export function createChangedSourceRelinkOperation(input: {
  readonly requestId: string;
  readonly refreshOperationId: string;
  readonly jobId: string;
  readonly record: SourceRecord;
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
}): OperationRecord {
  const date = /^op_(\d{8})_/u.exec(input.refreshOperationId)?.[1];
  if (!date) throw new PigeDomainError("source.reconnect_invalid", "The refresh Operation identity is invalid.");
  const suffix = createHash("sha256").update(
    `pige.source-reconnect.changed-operation.v1\0${input.requestId}\0${input.refreshOperationId}\0${input.record.id}\0${input.afterChecksum}`
  ).digest("hex").slice(0, 24);
  return OperationRecordSchema.parse({
    id: `op_${date}_${suffix}`,
    schemaVersion: 1,
    jobId: input.jobId,
    createdAt: new Date().toISOString(),
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "relink_source",
    targetRefs: [{ kind: "source", id: input.record.id }],
    sourceRefs: [{ kind: "job", id: input.jobId }, { kind: "operation", id: input.refreshOperationId }],
    before: { kind: "source", id: input.record.id, checksum: input.beforeChecksum },
    after: { kind: "source", id: input.record.id, checksum: input.afterChecksum },
    summary: "Reconnected one unavailable referenced original and refreshed its changed content.",
    reversible: "best_effort",
    rollbackHint: "Use Source revision Undo while the refreshed Source Record is still current.",
    warnings: []
  });
}
