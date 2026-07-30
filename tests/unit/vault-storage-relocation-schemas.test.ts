import { describe, expect, it } from "vitest";
import {
  VaultStorageRelocationRequestSchema,
  VaultStorageRelocationResultSchema,
  VaultStorageRelocationStatusSchema
} from "@pige/schemas";

const revision = `vaultrelocationrev_${"a".repeat(64)}`;
const request = {
  apiVersion: 1,
  requestId: "vaultrelocatereq_0123456789abcdef",
  activeVaultId: "vault_20260731_relocate01",
  expectedRevision: revision
} as const;

describe("Vault storage relocation schemas", () => {
  it("accepts exact pathless status, request, and result identities", () => {
    expect(VaultStorageRelocationStatusSchema.parse({
      apiVersion: 1,
      status: "ready",
      activeVaultId: request.activeVaultId,
      revision
    })).toMatchObject({ status: "ready", revision });
    expect(VaultStorageRelocationRequestSchema.parse(request)).toEqual(request);
    expect(VaultStorageRelocationResultSchema.parse({
      ...request,
      status: "relocated",
      revision: `vaultrelocationrev_${"b".repeat(64)}`
    })).toMatchObject({ status: "relocated" });
  });

  it("rejects renderer paths and unbounded result details", () => {
    expect(() => VaultStorageRelocationRequestSchema.parse({ ...request, destinationPath: "/private/new" }))
      .toThrow();
    expect(() => VaultStorageRelocationResultSchema.parse({ ...request, status: "failed", sourcePath: "/private/old" }))
      .toThrow();
    expect(() => VaultStorageRelocationResultSchema.parse({ ...request, status: "failed", error: "raw detail" }))
      .toThrow();
    expect(() => VaultStorageRelocationStatusSchema.parse({ apiVersion: 1, status: "unavailable", path: "/private" }))
      .toThrow();
  });
});
