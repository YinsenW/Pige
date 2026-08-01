import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  UpdateSourceStoragePolicyRequestSchema,
  UpdateSourceStoragePolicyResultSchema
} from "@pige/schemas";

describe("source storage policy contract", () => {
  const request = {
    apiVersion: 1 as const,
    requestId: "sourcepolicyreq_abcdefghijklmnop",
    activeVaultId: "vault_20260802_policy01",
    expectedRevision: `ssrev_${"a".repeat(64)}`,
    defaultStrategy: "reference_original" as const
  };

  it("binds the exact Vault, source-storage revision, request, and future-only strategy", () => {
    expect(UpdateSourceStoragePolicyRequestSchema.parse(request)).toEqual(request);
    expect(() => UpdateSourceStoragePolicyRequestSchema.parse({ ...request, expectedRevision: undefined })).toThrow();
    expect(() => UpdateSourceStoragePolicyRequestSchema.parse({ ...request, localPath: "/private/source" })).toThrow();
    expect(UpdateSourceStoragePolicyResultSchema.parse({
      ...request,
      status: "updated",
      operationId: "op_20260802_sourcepolicyabcdef",
      summary: { activeVaultId: request.activeVaultId, revision: `ssrev_${"b".repeat(64)}`,
        defaultStrategy: request.defaultStrategy }
    })).toMatchObject({ status: "updated", operationId: "op_20260802_sourcepolicyabcdef" });
  });

  it("parses both IPC directions and rejects response identity substitution", () => {
    const contracts = fs.readFileSync(path.resolve("packages/contracts/src/index.ts"), "utf8");
    const main = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const preload = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    expect(contracts).toContain("Promise<UpdateSourceStoragePolicyResult>");
    expect(main).toContain("UpdateSourceStoragePolicyRequestSchema.parse(request)");
    expect(main).toContain('confirmSettingAction(event.sender, ["sourceStorage.defaultStrategy"]');
    expect(main).toContain("Existing source files and managed copies will not be moved or rewritten.");
    expect(main).toContain("getSourceStoragePreferenceService().update");
    expect(preload).toContain("UpdateSourceStoragePolicyRequestSchema.parse(request)");
    expect(preload).toContain("UpdateSourceStoragePolicyResultSchema.parse(");
    expect(preload).toContain("Invalid source storage preference response identity.");
  });
});
