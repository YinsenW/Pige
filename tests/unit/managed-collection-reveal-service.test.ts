import { describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { ManagedCollectionRevealService } from
  "../../apps/desktop/src/main/services/managed-collection-reveal-service";

const request = {
  apiVersion: 1,
  requestId: "collection_reveal_abcdefghijklmnop",
  activeVaultId: "vault_20260801_collectionreveal",
  datasetId: "dataset_20260801_collectionreveal",
  revisionId: "dataset_rev_20260801_collectionreveal",
  tableId: "table_collectionreveal01"
} as const;
const binding = {
  bundlePath: "/private/vault/data/datasets/dataset_20260801_collectionreveal",
  revisionId: request.revisionId,
  proof: "manifest-proof"
} as const;

describe("ManagedCollectionRevealService", () => {
  it("reveals one twice-revalidated current Dataset bundle without projecting its path", async () => {
    const reveal = vi.fn();
    const resolve = vi.fn(() => binding);
    const service = new ManagedCollectionRevealService(vaultPort(), { reveal }, resolve);

    const result = await service.reveal(request);
    expect(result).toEqual({ ...request, status: "revealed" });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith(binding.bundlePath);
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it("fails closed before Finder when the revision or immutable bundle proof drifts", async () => {
    const reveal = vi.fn();
    const staleRevision = new ManagedCollectionRevealService(vaultPort(), { reveal }, () => ({
      ...binding,
      revisionId: "dataset_rev_20260801_changedrevision"
    }));
    await expect(staleRevision.reveal(request)).resolves.toEqual({ ...request, status: "stale" });

    let reads = 0;
    const staleProof = new ManagedCollectionRevealService(vaultPort(), { reveal }, () => ({
      ...binding,
      proof: reads++ === 0 ? binding.proof : "changed-proof"
    }));
    await expect(staleProof.reveal(request)).resolves.toEqual({ ...request, status: "stale" });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("rechecks the active Vault immediately before the external reveal effect", async () => {
    let currentCalls = 0;
    const reveal = vi.fn();
    const service = new ManagedCollectionRevealService({
      current: () => ({ vaultId: currentCalls++ < 2 ? request.activeVaultId : "vault_other" }) as VaultSummary,
      activeVaultPath: () => "/private/vault"
    }, { reveal }, () => binding);

    await expect(service.reveal(request)).resolves.toEqual({ ...request, status: "stale" });
    expect(reveal).not.toHaveBeenCalled();
  });
});

function vaultPort() {
  return {
    current: () => ({ vaultId: request.activeVaultId }) as VaultSummary,
    activeVaultPath: () => "/private/vault"
  };
}
