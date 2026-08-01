import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type { SourceRecord } from "@pige/schemas";

export function sourceRefreshFingerprint(record: SourceRecord): { readonly checksum: string; readonly size: number } {
  if (record.storageStrategy === "copy_to_source_library" && record.managedCopy) {
    return { checksum: record.managedCopy.checksum, size: record.managedCopy.size };
  }
  if (record.storageStrategy === "reference_original" && record.original?.checksum !== undefined &&
    record.original.lastKnownSize !== undefined) {
    return { checksum: record.original.checksum, size: record.original.lastKnownSize };
  }
  throw new PigeDomainError("source.refresh_ineligible", "This source has no recorded input fingerprint.");
}

export function sourceRefreshRevision(record: SourceRecord): string {
  return `sourcerefreshrev_${createHash("sha256").update(JSON.stringify(record)).digest("hex")}`;
}

export function sourceRefreshDisplayName(record: SourceRecord): string {
  const raw = record.original?.displayName ?? (typeof record.metadata.title === "string" ? record.metadata.title : "Saved source");
  const safe = path.basename(raw).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ").trim();
  return (safe || "Saved source").slice(0, 160);
}
