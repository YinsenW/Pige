import { describe, expect, it } from "vitest";
import {
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_REVISION,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_SHA256
} from "@pige/schemas";
import { LocalSemanticRetrievalService } from
  "../../apps/desktop/src/main/services/local-semantic-retrieval-service";
import type {
  LocalSemanticAssetRecord,
  LocalSemanticRetrievalAssetStorePort,
  VerifiedLocalSemanticAsset
} from "../../apps/desktop/src/main/services/local-semantic-retrieval-asset-store";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const STATUS_REQUEST = { apiVersion: 1 as const };

class FakeAssetStore implements LocalSemanticRetrievalAssetStorePort {
  record: LocalSemanticAssetRecord = initialRecord();
  assetPresent = false;
  stagingValid = false;
  bindingMatches = false;
  readonly binding: VerifiedLocalSemanticAsset = {
    path: "/private/pige/assets/model.gguf",
    dev: 1,
    ino: 2,
    size: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
    mtimeMs: 3
  };

  read(): LocalSemanticAssetRecord { return structuredClone(this.record); }
  write(record: LocalSemanticAssetRecord): void { this.record = structuredClone(record); }
  createStagingPath(requestId: string): string { return `/private/pige/staging/${requestId}.download`; }
  verify(pathInput?: string): VerifiedLocalSemanticAsset {
    if (pathInput?.includes("staging")) {
      if (!this.stagingValid) throw new Error("invalid staging");
      return { ...this.binding, path: pathInput };
    }
    if (!this.assetPresent) throw new Error("missing asset");
    return this.binding;
  }
  stillMatches(binding: VerifiedLocalSemanticAsset | undefined): boolean {
    return this.assetPresent && this.bindingMatches && binding?.ino === this.binding.ino;
  }
  publish(): VerifiedLocalSemanticAsset {
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

describe("LocalSemanticRetrievalService", () => {
  it("installs the pinned asset once and exposes only lifecycle truth", async () => {
    const store = new FakeAssetStore();
    let downloads = 0;
    const service = new LocalSemanticRetrievalService({
      appDataRoot: "/unused",
      store,
      now: () => NOW,
      transport: {
        download: async (url) => {
          downloads += 1;
          expect(url).toContain("Qwen3-Embedding-0.6B-Q8_0.gguf");
          store.stagingValid = true;
        }
      }
    });
    const request = { apiVersion: 1 as const, requestId: "ragasset_install000000001", expectedRevision: 0 };
    const accepted = service.install(request);

    expect(accepted.status).toBe("accepted");
    await waitFor(() => service.status(STATUS_REQUEST).assetState === "ready");
    expect(downloads).toBe(1);
    expect(service.embeddingModelInstalled()).toBe(true);
    expect(service.install(request)).toEqual(accepted);
    expect(JSON.stringify(service.status(STATUS_REQUEST))).not.toMatch(/sha256|huggingface|\.gguf|private/u);
  });

  it("enforces revision CAS while disable, enable, and remove preserve lexical fallback", () => {
    const store = readyStore();
    const service = makeService(store);
    service.recover();

    expect(service.disable(request("disable000000001", 99))).toMatchObject({ status: "stale", revision: 0 });
    const disabled = service.disable(request("disable000000002", store.record.revision));
    expect(disabled.status).toBe("committed");
    expect(service.status(STATUS_REQUEST)).toMatchObject({ assetState: "disabled", lexicalSearchRemainsAvailable: true });
    expect(service.embeddingModelInstalled()).toBe(false);

    const enabled = service.enable(request("enable0000000001", store.record.revision));
    expect(enabled.status).toBe("committed");
    expect(service.embeddingModelInstalled()).toBe(true);
    const removed = service.remove(request("remove0000000001", store.record.revision));
    expect(removed.status).toBe("committed");
    expect(service.status(STATUS_REQUEST)).toMatchObject({ assetState: "not_installed", lexicalSearchRemainsAvailable: true });
  });

  it("adopts a verified published asset after restart and fails corrupt bytes closed", () => {
    const adoptedStore = readyStore("verifying");
    const adopted = makeService(adoptedStore);
    adopted.recover();
    expect(adopted.status(STATUS_REQUEST).assetState).toBe("ready");
    expect(adopted.embeddingModelInstalled()).toBe(true);

    const corruptStore = readyStore();
    corruptStore.assetPresent = false;
    const corrupt = makeService(corruptStore);
    corrupt.recover();
    expect(corrupt.status(STATUS_REQUEST)).toMatchObject({ assetState: "needs_repair", lexicalSearchRemainsAvailable: true });
    expect(corrupt.embeddingModelInstalled()).toBe(false);
  });

  it("moves a failed verification to needs_repair without publishing capability", async () => {
    const store = new FakeAssetStore();
    const service = new LocalSemanticRetrievalService({
      appDataRoot: "/unused",
      store,
      now: () => NOW,
      transport: { download: async () => { store.stagingValid = false; } }
    });
    service.install(request("install0000000002", 0));
    await waitFor(() => service.status(STATUS_REQUEST).assetState === "needs_repair");
    expect(service.embeddingModelInstalled()).toBe(false);
    expect(store.assetPresent).toBe(false);
  });
});

function initialRecord(state: LocalSemanticAssetRecord["state"] = "not_installed"): LocalSemanticAssetRecord {
  const active = state === "installing" || state === "verifying";
  return {
    schemaVersion: 1,
    revision: 0,
    assetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
    assetRevision: LOCAL_SEMANTIC_RETRIEVAL_ASSET_REVISION,
    assetSha256: LOCAL_SEMANTIC_RETRIEVAL_ASSET_SHA256,
    assetBytes: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
    state,
    updatedAt: NOW.toISOString(),
    receipts: [],
    ...(active ? { activeRequestId: "ragasset_install00000000", activeJobId: "job_20260727_abcdef1234567890" } : {})
  };
}

function readyStore(state: LocalSemanticAssetRecord["state"] = "ready"): FakeAssetStore {
  const store = new FakeAssetStore();
  store.record = initialRecord(state);
  store.assetPresent = true;
  store.bindingMatches = true;
  return store;
}

function makeService(store: FakeAssetStore): LocalSemanticRetrievalService {
  return new LocalSemanticRetrievalService({
    appDataRoot: "/unused",
    store,
    now: () => NOW,
    transport: { download: async () => undefined }
  });
}

function request(suffix: string, expectedRevision: number) {
  return { apiVersion: 1 as const, requestId: `ragasset_${suffix}`, expectedRevision };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for local semantic asset state.");
}
