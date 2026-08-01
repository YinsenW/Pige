import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BackupTrashPreferenceSummarySchema,
  BackupTrashPreferenceUpdateRequestSchema,
  BackupTrashPreferenceUpdateResultSchema
} from "@pige/schemas";

describe("trash backup preference contract", () => {
  it("keeps request and authoritative results strict and pathless", () => {
    const summary = BackupTrashPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: "vault_20260801_trashbackup0001",
      revision: `backuptrashrev_${"a".repeat(64)}`,
      includeTrash: true,
      canUpdate: true
    });
    const request = BackupTrashPreferenceUpdateRequestSchema.parse({
      apiVersion: 1,
      requestId: "backuptrashreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeTrash: false
    });
    expect(BackupTrashPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "updated",
      summary: { ...summary, revision: `backuptrashrev_${"b".repeat(64)}`, includeTrash: false }
    }).status).toBe("updated");
    expect(() => BackupTrashPreferenceUpdateRequestSchema.parse({ ...request, trashPath: "/private/vault/.pige/trash" })).toThrow();
  });

  it("validates both preload directions and exact response identity", () => {
    const source = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const start = source.indexOf("trashPreferenceStatus:");
    const block = source.slice(start, source.indexOf("memoryPreferenceStatus:", start));
    expect(block).toContain("BackupTrashPreferenceSummarySchema.parse");
    expect(block).toContain("BackupTrashPreferenceUpdateRequestSchema.parse");
    expect(block).toContain("BackupTrashPreferenceUpdateResultSchema.parse");
    expect(block).toContain("result.requestId !== parsedRequest.requestId");
  });
});
