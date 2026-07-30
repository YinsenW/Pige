import { describe, expect, it } from "vitest";
import {
  RecentVaultForgetRequestSchema,
  RecentVaultForgetResultSchema,
  RecentVaultReconnectRequestSchema,
  RecentVaultReconnectResultSchema,
  RecentVaultSummaryProjectionSchema
} from "@pige/schemas";

const revision = `recentvaultrev_${"a".repeat(64)}`;
const vaultId = "vault_20260731_recent01";

describe("recent Vault lifecycle schemas", () => {
  it("binds forget and reconnect to the exact Vault revision without path authority", () => {
    const forget = {
      apiVersion: 1 as const,
      requestId: "recentvaultforgetreq_0123456789abcdef",
      vaultId,
      expectedRevision: revision
    };
    const reconnect = {
      apiVersion: 1 as const,
      requestId: "recentvaultreconnectreq_0123456789abcdef",
      vaultId,
      expectedRevision: revision
    };
    expect(RecentVaultForgetRequestSchema.parse(forget)).toEqual(forget);
    expect(RecentVaultReconnectRequestSchema.parse(reconnect)).toEqual(reconnect);
    expect(RecentVaultForgetResultSchema.parse({ ...forget, status: "forgotten" })).not.toHaveProperty("path");
    expect(RecentVaultReconnectResultSchema.parse({
      ...reconnect,
      status: "reconnected",
      revision: `recentvaultrev_${"b".repeat(64)}`
    })).not.toHaveProperty("path");
  });

  it("rejects renderer paths, content authority, and unknown result details", () => {
    const request = {
      apiVersion: 1,
      requestId: "recentvaultreconnectreq_0123456789abcdef",
      vaultId,
      expectedRevision: revision
    };
    expect(() => RecentVaultReconnectRequestSchema.parse({ ...request, selectedPath: "/private/vault" })).toThrow();
    expect(() => RecentVaultReconnectRequestSchema.parse({ ...request, sourceContent: "private" })).toThrow();
    expect(() => RecentVaultReconnectResultSchema.parse({ ...request, status: "failed", reason: "/private" })).toThrow();
  });

  it("requires opaque currentness on recent display projections", () => {
    expect(RecentVaultSummaryProjectionSchema.parse({
      vaultId,
      name: "Research",
      pathDisplay: "~/Research",
      schemaVersion: 2,
      lastOpenedAt: "2026-07-31T08:00:00.000Z",
      revision
    })).toMatchObject({ vaultId, revision });
    expect(() => RecentVaultSummaryProjectionSchema.parse({
      vaultId,
      name: "Research",
      pathDisplay: "~/Research",
      schemaVersion: 2,
      lastOpenedAt: "2026-07-31T08:00:00.000Z"
    })).toThrow();
  });
});
