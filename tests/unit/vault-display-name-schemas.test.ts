import { describe, expect, it } from "vitest";
import {
  VaultDisplayNameSchema,
  VaultRenameDisplayNameRequestSchema,
  VaultRenameDisplayNameResultSchema
} from "@pige/schemas";

const request = {
  apiVersion: 1 as const,
  requestId: "vaultrenamereq_0123456789abcdef",
  activeVaultId: "vault_20260731_rename01",
  expectedMetadataRevision: `vaultmeta_${"a".repeat(64)}`,
  displayName: "Research notes"
};

describe("Vault display-name schemas", () => {
  it("accepts a bounded label and keeps mutation results pathless and identity-bound", () => {
    expect(VaultRenameDisplayNameRequestSchema.parse(request)).toEqual(request);
    const result = VaultRenameDisplayNameResultSchema.parse({
      ...request,
      status: "renamed",
      metadata: {
        activeVaultId: request.activeVaultId,
        displayName: request.displayName,
        revision: `vaultmeta_${"b".repeat(64)}`
      }
    });
    expect(result).not.toHaveProperty("path");
    expect(result).not.toHaveProperty("vaultPath");
  });

  it.each([
    " ../private/vault ",
    "../private/vault",
    "C:\\Users\\Private",
    "file:///Users/private",
    "line\nbreak",
    "\u202Ehidden",
    "x".repeat(81)
  ])("rejects path-, control-, direction-, or size-shaped names: %s", (name) => {
    expect(VaultDisplayNameSchema.safeParse(name).success).toBe(false);
    expect(VaultRenameDisplayNameRequestSchema.safeParse({ ...request, displayName: name }).success).toBe(false);
  });

  it("rejects authority expansion and unbound response fields", () => {
    expect(() => VaultRenameDisplayNameRequestSchema.parse({ ...request, sourceContent: "secret" })).toThrow();
    expect(() => VaultRenameDisplayNameRequestSchema.parse({ ...request, modelAuthorization: true })).toThrow();
    expect(() => VaultRenameDisplayNameResultSchema.parse({ ...request, status: "failed", vaultPath: "/private" })).toThrow();
  });
});
