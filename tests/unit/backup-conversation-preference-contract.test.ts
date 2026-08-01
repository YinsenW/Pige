import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BackupConversationPreferenceSummarySchema,
  BackupConversationPreferenceUpdateRequestSchema,
  BackupConversationPreferenceUpdateResultSchema
} from "@pige/schemas";

describe("conversation history backup preference contract", () => {
  it("keeps request, summary, and authoritative closed results strict and pathless", () => {
    const summary = BackupConversationPreferenceSummarySchema.parse({
      apiVersion: 1,
      activeVaultId: "vault_20260801_conversationbackup01",
      revision: `backupconversationrev_${"a".repeat(64)}`,
      includeConversations: true,
      canUpdate: true
    });
    const request = BackupConversationPreferenceUpdateRequestSchema.parse({
      apiVersion: 1,
      requestId: "backupconversationreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeConversations: false
    });
    expect(BackupConversationPreferenceUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "updated",
      summary: { ...summary, revision: `backupconversationrev_${"b".repeat(64)}`, includeConversations: false }
    }).status).toBe("updated");
    expect(() => BackupConversationPreferenceUpdateRequestSchema.parse({ ...request, configPath: "/private/vault" })).toThrow();
    expect(() => BackupConversationPreferenceSummarySchema.parse({ ...summary, conversationBodies: ["private"] })).toThrow();
  });

  it("validates both preload directions and exact response identity", () => {
    const source = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const start = source.indexOf("conversationPreferenceStatus:");
    const block = source.slice(start, source.indexOf("memoryPreferenceStatus:", start));
    expect(block).toContain("BackupConversationPreferenceSummarySchema.parse");
    expect(block).toContain("BackupConversationPreferenceUpdateRequestSchema.parse");
    expect(block).toContain("BackupConversationPreferenceUpdateResultSchema.parse");
    expect(block).toContain("result.requestId !== parsedRequest.requestId");
    expect(block).toContain("result.activeVaultId !== parsedRequest.activeVaultId");
  });
});
