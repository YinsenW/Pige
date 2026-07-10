import { describe, expect, it } from "vitest";
import { createPigeVaultId, isPigeRequirementId, isPigeVaultId } from "@pige/domain";

describe("requirement IDs", () => {
  it("accepts stable Pige requirement IDs", () => {
    expect(isPigeRequirementId("PIGE-DOC-001")).toBe(true);
    expect(isPigeRequirementId(`PIGE-${"UI2"}-001`)).toBe(true);
  });

  it("rejects lowercase or unpadded IDs", () => {
    expect(isPigeRequirementId("pige-doc-001")).toBe(false);
    expect(isPigeRequirementId("PIGE-DOC-1")).toBe(false);
  });
});

describe("vault IDs", () => {
  it("creates sync-ready local vault IDs", () => {
    const vaultId = createPigeVaultId(new Date("2026-07-09T12:00:00.000Z"), "ABC123xyz");
    expect(vaultId).toBe("vault_20260709_abc123xyz");
    expect(isPigeVaultId(vaultId)).toBe(true);
  });
});
