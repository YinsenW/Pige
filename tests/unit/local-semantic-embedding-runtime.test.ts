import { describe, expect, it } from "vitest";
import {
  LOCAL_SEMANTIC_EMBEDDING_DIMENSION,
  LOCAL_SEMANTIC_QUERY_INSTRUCTION,
  LocalSemanticEmbeddingRuntime,
  type LocalSemanticEmbeddingBackend
} from "../../apps/desktop/src/main/services/local-semantic-embedding-runtime";

function vector(value = 1): readonly number[] {
  return Array.from({ length: LOCAL_SEMANTIC_EMBEDDING_DIMENSION }, () => value);
}

describe("LocalSemanticEmbeddingRuntime", () => {
  it("uses the frozen query instruction, raw documents, and normalized 1024-dimension output", async () => {
    const inputs: string[] = [];
    const runtime = new LocalSemanticEmbeddingRuntime({
      createAssetLease: () => ({ path: "/private/model.gguf", identity: "lease-1", stillCurrent: () => true }),
      backendFactory: {
        create: async () => ({
          dimension: LOCAL_SEMANTIC_EMBEDDING_DIMENSION,
          embed: async (input) => {
            inputs.push(input);
            return vector(2);
          },
          dispose: async () => undefined
        })
      }
    });

    const query = await runtime.embedQuery("find the local note");
    const [document] = await runtime.embedDocuments(["Local note body"]);

    expect(inputs).toEqual([
      `${LOCAL_SEMANTIC_QUERY_INSTRUCTION}find the local note`,
      "Local note body"
    ]);
    expect(query).toHaveLength(1_024);
    expect(document).toHaveLength(1_024);
    expect(Math.hypot(...query)).toBeCloseTo(1, 5);
    await runtime.dispose();
  });

  it("disposes and fails closed when the verified asset identity changes during inference", async () => {
    let current = true;
    let disposed = 0;
    const backend: LocalSemanticEmbeddingBackend = {
      dimension: LOCAL_SEMANTIC_EMBEDDING_DIMENSION,
      embed: async () => {
        current = false;
        return vector();
      },
      dispose: async () => { disposed += 1; }
    };
    const runtime = new LocalSemanticEmbeddingRuntime({
      createAssetLease: () => ({ path: "/private/model.gguf", identity: "lease-1", stillCurrent: () => current }),
      backendFactory: { create: async () => backend }
    });

    await expect(runtime.embedQuery("query")).rejects.toThrow("changed during inference");
    expect(disposed).toBe(1);
    await expect(runtime.available()).resolves.toBe(false);
  });

  it("does not adopt an in-flight backend after the verified asset identity changes", async () => {
    let identity = "lease-1";
    let releaseFirstLoad!: () => void;
    const firstLoad = new Promise<void>((resolve) => { releaseFirstLoad = resolve; });
    const disposed: string[] = [];
    const runtime = new LocalSemanticEmbeddingRuntime({
      createAssetLease: () => {
        const leasedIdentity = identity;
        return {
          path: `/private/${leasedIdentity}.gguf`,
          identity: leasedIdentity,
          stillCurrent: () => identity === leasedIdentity
        };
      },
      backendFactory: {
        create: async (assetPath) => {
          if (assetPath.endsWith("lease-1.gguf")) await firstLoad;
          return {
            dimension: LOCAL_SEMANTIC_EMBEDDING_DIMENSION,
            embed: async () => vector(),
            dispose: async () => { disposed.push(assetPath); }
          };
        }
      }
    });

    const staleLoad = runtime.embedQuery("stale query");
    identity = "lease-2";
    const currentLoad = runtime.embedQuery("current query");
    releaseFirstLoad();

    await expect(staleLoad).rejects.toThrow();
    await expect(currentLoad).resolves.toHaveLength(LOCAL_SEMANTIC_EMBEDDING_DIMENSION);
    expect(disposed).toContain("/private/lease-1.gguf");
    await runtime.dispose();
  });

  it("rejects invalid dimensions, non-finite values, empty input, and oversized batches", async () => {
    let result: readonly number[] = vector();
    const runtime = new LocalSemanticEmbeddingRuntime({
      createAssetLease: () => ({ path: "/private/model.gguf", identity: "lease-1", stillCurrent: () => true }),
      backendFactory: {
        create: async () => ({
          dimension: LOCAL_SEMANTIC_EMBEDDING_DIMENSION,
          embed: async () => result,
          dispose: async () => undefined
        })
      }
    });

    result = vector().slice(1);
    await expect(runtime.embedQuery("query")).rejects.toThrow("dimension");
    result = [...vector().slice(0, -1), Number.NaN];
    await expect(runtime.embedQuery("query")).rejects.toThrow("non-finite");
    await expect(runtime.embedQuery(" ")).rejects.toThrow("outside its bound");
    await expect(runtime.embedDocuments(Array.from({ length: 17 }, () => "body"))).rejects.toThrow("batch");
  });
});
