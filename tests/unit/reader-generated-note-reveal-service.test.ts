import { describe, expect, it, vi } from "vitest";
import { ReaderGeneratedNoteRevealService } from "../../apps/desktop/src/main/services/reader-generated-note-reveal-service";

const request = {
  apiVersion: 1 as const,
  requestId: "notegeneratedreveal_abcdefghijklmnop",
  activeVaultId: "vault_20260801_abcdefgh",
  currentPageId: "page_20260801_generated1",
  renderContextId: `notectx_${"a".repeat(32)}`,
  expectedRevision: `noteeditrev_${"b".repeat(64)}`
};

describe("ReaderGeneratedNoteRevealService", () => {
  it("reveals one revalidated private path without projecting it", async () => {
    const assertCurrent = vi.fn(() => true);
    const resolveGeneratedReveal = vi.fn(() => ({
      status: "ready" as const,
      absolutePath: "/private/vault/wiki/generated.md",
      assertCurrent
    }));
    const reveal = vi.fn();
    const service = new ReaderGeneratedNoteRevealService({ resolveGeneratedReveal }, { reveal });

    await expect(service.reveal("owner_1", request)).resolves.toEqual({ ...request, status: "revealed" });
    expect(resolveGeneratedReveal).toHaveBeenCalledWith("owner_1", request);
    expect(assertCurrent).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith("/private/vault/wiki/generated.md");
  });

  it("fails closed before the registrar when currentness drifts", async () => {
    const reveal = vi.fn();
    const service = new ReaderGeneratedNoteRevealService({
      resolveGeneratedReveal: vi.fn(() => ({
        status: "ready" as const,
        absolutePath: "/private/vault/wiki/generated.md",
        assertCurrent: () => false
      }))
    }, { reveal });

    await expect(service.reveal("owner_1", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(reveal).not.toHaveBeenCalled();
  });

  it.each(["stale", "not_found", "ineligible"] as const)("preserves a body-free %s result", async (status) => {
    const reveal = vi.fn();
    const service = new ReaderGeneratedNoteRevealService({
      resolveGeneratedReveal: vi.fn(() => ({ status }))
    }, { reveal });
    await expect(service.reveal("owner_1", request)).resolves.toEqual({ ...request, status });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("maps registrar failures to a body-free result", async () => {
    const service = new ReaderGeneratedNoteRevealService({
      resolveGeneratedReveal: vi.fn(() => ({
        status: "ready" as const,
        absolutePath: "/private/vault/wiki/generated.md",
        assertCurrent: () => true
      }))
    }, { reveal: () => { throw new Error("private path detail"); } });
    await expect(service.reveal("owner_1", request)).resolves.toEqual({ ...request, status: "failed" });
  });
});
