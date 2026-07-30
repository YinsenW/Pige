import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BackupMemoryPreferenceSummarySchema,
  BackupMemoryPreferenceUpdateRequestSchema,
  BackupMemoryPreferenceUpdateResultSchema
} from "@pige/schemas";

describe("Agent memory backup preference contract", () => {
  it("keeps request, summary, and result strict and pathless", () => {
    const summary = BackupMemoryPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: "vault_20260731_memorybackup01",
      revision: `backupmemoryrev_${"a".repeat(64)}`,
      includeVaultMemory: true,
      canUpdate: true
    });
    const request = BackupMemoryPreferenceUpdateRequestSchema.parse({
      apiVersion: 1,
      requestId: "backupmemoryreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeVaultMemory: false
    });
    expect(BackupMemoryPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "updated",
      summary: { ...summary, revision: `backupmemoryrev_${"b".repeat(64)}`, includeVaultMemory: false }
    }).status).toBe("updated");
    expect(() => BackupMemoryPreferenceUpdateRequestSchema.parse({ ...request, vaultPath: "/private/vault" })).toThrow();
    expect(() => BackupMemoryPreferenceSummarySchema.parse({ ...summary, rawConfig: "private" })).toThrow();
  });

  it("validates both preload directions and exact response identity", () => {
    const source = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const block = source.slice(source.indexOf("memoryPreferenceStatus:"), source.indexOf("create: async", source.indexOf("memoryPreferenceStatus:")));
    expect(block).toContain("BackupMemoryPreferenceSummarySchema.parse");
    expect(block).toContain("BackupMemoryPreferenceUpdateRequestSchema.parse");
    expect(block).toContain("BackupMemoryPreferenceUpdateResultSchema.parse");
    expect(block).toContain("result.requestId !== parsedRequest.requestId");
    expect(block).toContain("result.activeVaultId !== parsedRequest.activeVaultId");
  });
});
