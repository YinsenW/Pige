import { describe, expect, it } from "vitest";
import {
  LocalRerankerRuntime,
  type LocalRerankerBackend
} from "../../apps/desktop/src/main/services/local-reranker-runtime";

describe("LocalRerankerRuntime", () => {
  it("ranks a bounded candidate set and admits only current finite scores", async () => {
    const calls: Array<{ query: string; documents: readonly string[] }> = [];
    const runtime = new LocalRerankerRuntime({
      createAssetLease: () => ({ path: "/private/reranker.gguf", identity: "lease-1", stillCurrent: () => true }),
      backendFactory: {
        create: async () => ({
          rank: async (query, documents) => {
            calls.push({ query, documents });
            return [0.2, 0.9];
          },
          dispose: async () => undefined
        })
      },
      now: (() => { let value = 0; return () => value += 10; })()
    });

    await expect(runtime.rerank("local query", ["first", "second"])).resolves.toEqual([0.2, 0.9]);
    expect(calls).toEqual([{ query: "local query", documents: ["first", "second"] }]);
    expect(runtime.availableNow()).toBe(true);
    await runtime.dispose();
  });

  it("revokes a loaded backend when the verified asset changes during ranking", async () => {
    let current = true;
    let disposed = 0;
    const backend: LocalRerankerBackend = {
      rank: async () => { current = false; return [0.5, 0.4]; },
      dispose: async () => { disposed += 1; }
    };
    const runtime = new LocalRerankerRuntime({
      createAssetLease: () => ({ path: "/private/reranker.gguf", identity: "lease-1", stillCurrent: () => current }),
      backendFactory: { create: async () => backend }
    });

    await expect(runtime.rerank("query", ["one", "two"])).rejects.toThrow("changed during inference");
    expect(disposed).toBe(1);
    expect(runtime.availableNow()).toBe(false);
  });

  it("fails closed for slow, malformed, empty, or oversized inference", async () => {
    let elapsed = 0;
    let scores: readonly number[] = [0.4, 0.3];
    const runtime = new LocalRerankerRuntime({
      createAssetLease: () => ({ path: "/private/reranker.gguf", identity: "lease-1", stillCurrent: () => true }),
      backendFactory: {
        create: async () => ({ rank: async () => scores, dispose: async () => undefined })
      },
      now: () => { const current = elapsed; elapsed += 6_000; return current; }
    });

    await expect(runtime.rerank("query", ["one", "two"])).rejects.toThrow("bounded runtime");
    scores = [Number.NaN, 0.2];
    elapsed = 0;
    await expect(runtime.rerank("query", ["one", "two"])).rejects.toThrow("bounded runtime");
    await expect(runtime.rerank(" ", ["one", "two"])).rejects.toThrow("outside its bound");
    await expect(runtime.rerank("query", Array.from({ length: 13 }, () => "document"))).rejects.toThrow("candidate count");
  });
});
