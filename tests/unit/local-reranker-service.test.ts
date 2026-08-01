import { describe, expect, it } from "vitest";
import {
  LOCAL_RERANKER_ASSET_BYTES,
  LOCAL_RERANKER_ASSET_ID,
  LOCAL_RERANKER_ASSET_REVISION,
  LOCAL_RERANKER_ASSET_SHA256
} from "@pige/schemas";
import { LocalRerankerService } from "../../apps/desktop/src/main/services/local-reranker-service";
import type {
  LocalRerankerAssetStorePort,
  LocalRerankerRecord,
  VerifiedLocalRerankerAsset
} from "../../apps/desktop/src/main/services/local-reranker-asset-store";

const NOW = new Date("2026-08-01T12:00:00.000Z");

class FakeStore implements LocalRerankerAssetStorePort {
  record: LocalRerankerRecord = initialRecord();
  assetPresent = false;
  stagingValid = false;
  bindingMatches = false;
  readonly binding: VerifiedLocalRerankerAsset = {
    path: "/private/pige/reranker.gguf", dev: 1, ino: 2,
    size: LOCAL_RERANKER_ASSET_BYTES, mtimeMs: 3
  };
  read(): LocalRerankerRecord { return structuredClone(this.record); }
  write(record: LocalRerankerRecord): void { this.record = structuredClone(record); }
  createStagingPath(requestId: string): string { return `/private/staging/${requestId}.download`; }
  async verify(pathInput?: string): Promise<VerifiedLocalRerankerAsset> {
    if (pathInput?.includes("staging")) {
      if (!this.stagingValid) throw new Error("invalid staging");
      return { ...this.binding, path: pathInput };
    }
    if (!this.assetPresent) throw new Error("missing asset");
    return this.binding;
  }
  stillMatches(binding: VerifiedLocalRerankerAsset | undefined): boolean {
    return this.assetPresent && this.bindingMatches && binding?.ino === this.binding.ino;
  }
  async publish(): Promise<VerifiedLocalRerankerAsset> {
    if (!this.stagingValid) throw new Error("invalid staging");
    this.assetPresent = true;
    this.bindingMatches = true;
    this.stagingValid = false;
    return this.binding;
  }
  removeAsset(): void { this.assetPresent = false; this.bindingMatches = false; }
  discardStaging(): void { this.stagingValid = false; }
  assetPath(): string { return this.binding.path; }
}

describe("LocalRerankerService", () => {
  it("downloads the exact pinned asset, installs disabled, and requires explicit enable", async () => {
    const store = new FakeStore();
    let downloadUrl = "";
    const service = new LocalRerankerService({
      appDataRoot: "/unused", store, now: () => NOW,
      transport: { download: async (url) => { downloadUrl = url; store.stagingValid = true; } }
    });
    const accepted = service.install(request("install0000000001", 0));
    expect(accepted.status).toBe("accepted");
    await waitFor(() => service.status({ apiVersion: 1 }).assetState === "disabled");
    expect(downloadUrl).toContain("4bf3a1660c61f2754fc18035fb1d728d9b8735fc/Qwen3-Reranker-0.6B-Q3_K_M.gguf");
    expect(service.availableNow()).toBe(false);
    const enabled = await service.enable(request("enable0000000001", store.record.revision));
    expect(enabled.status).toBe("committed");
    expect(service.availableNow()).toBe(true);
    expect(JSON.stringify(service.status({ apiVersion: 1 }))).not.toMatch(/sha256|huggingface|\.gguf|private/u);
  });

  it("enforces revision CAS and revokes the runtime lease on disable and remove", async () => {
    const store = readyStore();
    let revoked = 0;
    const service = new LocalRerankerService({
      appDataRoot: "/unused", store, now: () => NOW,
      transport: { download: async () => undefined },
      onAssetRevoked: () => { revoked += 1; }
    });
    await service.recover();
    const lease = service.createAssetLease();
    expect(lease?.stillCurrent()).toBe(true);
    expect(service.disable(request("disable00000001", 99)).status).toBe("stale");
    expect(service.disable(request("disable00000002", store.record.revision)).status).toBe("committed");
    expect(lease?.stillCurrent()).toBe(false);
    expect(revoked).toBe(1);
    await service.enable(request("enable0000000002", store.record.revision));
    expect(service.remove(request("remove0000000001", store.record.revision)).status).toBe("committed");
    expect(store.assetPresent).toBe(false);
  });

  it("recovers interrupted valid installs disabled and corrupt assets as needs repair", async () => {
    const adoptedStore = readyStore("verifying");
    const adopted = makeService(adoptedStore);
    await adopted.recover();
    expect(adopted.status({ apiVersion: 1 }).assetState).toBe("disabled");

    const corruptStore = readyStore();
    corruptStore.assetPresent = false;
    const corrupt = makeService(corruptStore);
    await corrupt.recover();
    expect(corrupt.status({ apiVersion: 1 })).toMatchObject({
      assetState: "needs_repair", hybridSearchRemainsAvailable: true
    });
    const repairRevision = corruptStore.record.revision;
    await corrupt.recover();
    expect(corruptStore.record.revision).toBe(repairRevision);
  });
});

function initialRecord(state: LocalRerankerRecord["state"] = "not_installed"): LocalRerankerRecord {
  const active = state === "installing" || state === "verifying";
  return {
    schemaVersion: 1, revision: 0, assetId: LOCAL_RERANKER_ASSET_ID,
    assetRevision: LOCAL_RERANKER_ASSET_REVISION, assetSha256: LOCAL_RERANKER_ASSET_SHA256,
    assetBytes: LOCAL_RERANKER_ASSET_BYTES, state, updatedAt: NOW.toISOString(), receipts: [],
    ...(active ? {
      activeRequestId: "rerankasset_install0000000000", activeJobId: "job_20260801_abcdef1234567890"
    } : {})
  };
}
function readyStore(state: LocalRerankerRecord["state"] = "ready"): FakeStore {
  const store = new FakeStore();
  store.record = initialRecord(state);
  store.assetPresent = true;
  store.bindingMatches = true;
  return store;
}
function makeService(store: FakeStore): LocalRerankerService {
  return new LocalRerankerService({
    appDataRoot: "/unused", store, now: () => NOW, transport: { download: async () => undefined }
  });
}
function request(suffix: string, expectedRevision: number) {
  return { apiVersion: 1 as const, requestId: `rerankasset_${suffix}`, expectedRevision };
}
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for reranker state.");
}
