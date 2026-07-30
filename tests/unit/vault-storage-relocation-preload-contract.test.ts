import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Vault storage relocation preload contract", () => {
  it("parses both sides, checks exact identity, and never carries picker paths", () => {
    const source = fs.readFileSync(path.resolve("apps/desktop/src/preload/index.ts"), "utf8");
    expect(source).toContain("VaultStorageRelocationStatusSchema.parse(");
    expect(source).toContain("VaultStorageRelocationRequestSchema.parse(request)");
    expect(source).toContain("ipcRenderer.invoke(VAULT_STORAGE_RELOCATE_CHANNEL, parsedRequest)");
    expect(source).toContain("VaultStorageRelocationResultSchema.parse(");
    expect(source).toContain("result.expectedRevision !== parsedRequest.expectedRevision");
    const relocationBridge = source.slice(
      source.indexOf("storageRelocationStatus:"),
      source.indexOf("removeRecent:")
    );
    expect(relocationBridge).not.toMatch(/destinationPath|sourcePath|stagingPath|filePaths|selectedDirectory/u);
  });
});
