import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("recent Vault lifecycle preload contract", () => {
  it("parses query and mutation boundaries and verifies exact pathless identities", () => {
    const source = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const boundary = source.slice(source.indexOf("recent: async"), source.indexOf("maintenance: {"));

    expect(boundary).toContain("RecentVaultSummaryProjectionSchema.array().max(8).parse");
    expect(boundary).toContain("RecentVaultForgetRequestSchema.parse(request)");
    expect(boundary).toContain("RecentVaultForgetResultSchema.parse");
    expect(boundary).toContain("RecentVaultReconnectRequestSchema.parse(request)");
    expect(boundary).toContain("RecentVaultReconnectResultSchema.parse");
    expect(boundary).toContain("sameRecentMutationIdentity(parsed, result)");
    expect(boundary).not.toContain("selectedPath");
    expect(boundary).not.toContain("filePaths");
    expect(boundary).not.toContain("sourceContent");
  });
});
