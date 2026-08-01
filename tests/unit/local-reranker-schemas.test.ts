import { describe, expect, it } from "vitest";
import {
  LOCAL_RERANKER_ASSET_BYTES,
  LOCAL_RERANKER_ASSET_ID,
  LocalRerankerInstallRequestSchema,
  LocalRerankerInstallResultSchema,
  LocalRerankerStatusSchema
} from "@pige/schemas";

describe("local reranker schemas", () => {
  it("projects exact path-free lifecycle status", () => {
    expect(LocalRerankerStatusSchema.parse({
      apiVersion: 1, revision: 3, assetId: LOCAL_RERANKER_ASSET_ID,
      assetState: "disabled", downloadSizeBytes: LOCAL_RERANKER_ASSET_BYTES,
      hybridSearchRemainsAvailable: true
    })).toMatchObject({ assetState: "disabled", revision: 3 });
    expect(() => LocalRerankerStatusSchema.parse({
      apiVersion: 1, revision: 3, assetId: LOCAL_RERANKER_ASSET_ID,
      assetState: "ready", downloadSizeBytes: LOCAL_RERANKER_ASSET_BYTES,
      hybridSearchRemainsAvailable: true, path: "/private/model.gguf"
    })).toThrow();
  });

  it("binds mutations to request and expected revision without renderer URLs", () => {
    const request = {
      apiVersion: 1, requestId: "rerankasset_0123456789abcdef", expectedRevision: 4
    } as const;
    expect(LocalRerankerInstallRequestSchema.parse(request)).toEqual(request);
    expect(() => LocalRerankerInstallRequestSchema.parse({ ...request, url: "https://example.com/model" })).toThrow();
  });

  it("requires a durable Job identity only for accepted installs", () => {
    expect(LocalRerankerInstallResultSchema.parse({
      apiVersion: 1, requestId: "rerankasset_0123456789abcdef", revision: 5,
      status: "accepted", jobId: "job_20260801_abcdefghijkl"
    })).toMatchObject({ status: "accepted" });
    expect(() => LocalRerankerInstallResultSchema.parse({
      apiVersion: 1, requestId: "rerankasset_0123456789abcdef", revision: 5, status: "accepted"
    })).toThrow();
  });
});
