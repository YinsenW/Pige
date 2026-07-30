import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vault display-name preload boundary", () => {
  it("parses both sides, verifies the complete request identity, and exposes no filesystem authority", () => {
    const source = fs.readFileSync("apps/desktop/src/preload/index.ts", "utf8");
    const handler = source.slice(
      source.indexOf("renameDisplayName: async"),
      source.indexOf("revealKnowledgeRoot: async")
    );

    expect(handler).toContain("VaultRenameDisplayNameRequestSchema.parse(request)");
    expect(handler).toContain("VaultRenameDisplayNameResultSchema.parse(");
    expect(handler).toContain("VAULT_RENAME_DISPLAY_NAME_CHANNEL");
    expect(handler).toContain("result.requestId !== parsed.requestId");
    expect(handler).toContain("result.activeVaultId !== parsed.activeVaultId");
    expect(handler).toContain("result.expectedMetadataRevision !== parsed.expectedMetadataRevision");
    expect(handler).toContain("result.displayName !== parsed.displayName");
    expect(handler).not.toContain("vaultPath");
    expect(handler).not.toContain("sourceContent");
    expect(handler).not.toContain("modelAuthorization");
  });
});
