import type { LocalSemanticAssetLease } from "./local-semantic-embedding-runtime";

const MAX_DOCUMENTS = 12;
const MAX_QUERY_CODE_POINTS = 320;
const MAX_DOCUMENT_CODE_POINTS = 2_000;
const MAX_ADMITTED_DURATION_MS = 5_000;

export interface LocalRerankerBackend {
  rank(query: string, documents: readonly string[]): Promise<readonly number[]>;
  dispose(): Promise<void>;
}

export interface LocalRerankerBackendFactory {
  create(assetPath: string): Promise<LocalRerankerBackend>;
}

export interface LocalRerankerRuntimeOptions {
  readonly createAssetLease: () => LocalSemanticAssetLease | undefined;
  readonly backendFactory?: LocalRerankerBackendFactory;
  readonly now?: () => number;
}

export class LocalRerankerRuntime {
  readonly #createAssetLease: LocalRerankerRuntimeOptions["createAssetLease"];
  readonly #backendFactory: LocalRerankerBackendFactory;
  readonly #now: () => number;
  #loaded: LoadedReranker | undefined;
  #loading: LoadingReranker | undefined;
  #generation = 0;
  #admitted = false;

  constructor(options: LocalRerankerRuntimeOptions) {
    this.#createAssetLease = options.createAssetLease;
    this.#backendFactory = options.backendFactory ?? createNodeLlamaRerankerBackendFactory();
    this.#now = options.now ?? (() => performance.now());
  }

  async rerank(queryInput: string, documentsInput: readonly string[]): Promise<readonly number[]> {
    const query = boundedText(queryInput, MAX_QUERY_CODE_POINTS, "query");
    if (documentsInput.length === 0 || documentsInput.length > MAX_DOCUMENTS) {
      throw new Error("The local reranker candidate count is outside its bound.");
    }
    const documents = documentsInput.map((document) => boundedText(document, MAX_DOCUMENT_CODE_POINTS, "document"));
    const loaded = await this.#currentBackend();
    if (!loaded.lease.stillCurrent()) {
      await this.#discard(loaded);
      throw new Error("The verified reranker changed before inference.");
    }
    const startedAt = this.#now();
    const scores = await loaded.backend.rank(query, documents);
    const duration = this.#now() - startedAt;
    if (!loaded.lease.stillCurrent()) {
      await this.#discard(loaded);
      throw new Error("The verified reranker changed during inference.");
    }
    if (duration > MAX_ADMITTED_DURATION_MS || scores.length !== documents.length ||
      scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      this.#admitted = false;
      throw new Error("The local reranker failed its bounded runtime contract.");
    }
    this.#admitted = true;
    return scores;
  }

  async available(): Promise<boolean> {
    try { await this.#currentBackend(); return true; } catch { return false; }
  }

  availableNow(): boolean {
    return this.#admitted && Boolean(this.#loaded?.lease.stillCurrent());
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    this.#admitted = false;
    const loaded = this.#loaded;
    const loading = this.#loading;
    this.#loaded = undefined;
    this.#loading = undefined;
    if (loaded) await loaded.backend.dispose();
    if (loading) await loading.promise.catch(() => undefined);
  }

  async #currentBackend(): Promise<LoadedReranker> {
    const lease = this.#createAssetLease();
    if (!lease || !lease.stillCurrent()) {
      await this.dispose();
      throw new Error("A verified enabled local reranker is unavailable.");
    }
    if (this.#loaded?.lease.identity === lease.identity && this.#loaded.lease.stillCurrent()) return this.#loaded;
    if (this.#loaded) await this.dispose();
    if (this.#loading) {
      if (this.#loading.identity === lease.identity) return this.#loading.promise;
      await this.dispose();
    }
    const generation = this.#generation;
    const promise = this.#backendFactory.create(lease.path).then(async (backend) => {
      if (generation !== this.#generation || !lease.stillCurrent()) {
        await backend.dispose();
        throw new Error("The reranker load lost its current asset lease.");
      }
      const loaded = { lease, backend };
      this.#loaded = loaded;
      return loaded;
    }).finally(() => {
      if (this.#loading?.promise === promise) this.#loading = undefined;
    });
    this.#loading = { identity: lease.identity, promise };
    return promise;
  }

  async #discard(loaded: LoadedReranker): Promise<void> {
    if (this.#loaded === loaded) this.#loaded = undefined;
    this.#admitted = false;
    await loaded.backend.dispose();
  }
}

interface LoadedReranker {
  readonly lease: LocalSemanticAssetLease;
  readonly backend: LocalRerankerBackend;
}
interface LoadingReranker {
  readonly identity: string;
  readonly promise: Promise<LoadedReranker>;
}

function createNodeLlamaRerankerBackendFactory(): LocalRerankerBackendFactory {
  return {
    create: async (assetPath) => {
      process.env.NODE_LLAMA_CPP_SKIP_DOWNLOAD = "true";
      const { getLlama } = await import("node-llama-cpp");
      const expected = expectedGpuBackend();
      const llama = await getLlama({ gpu: expected.requested });
      if (llama.buildType !== "prebuilt" || llama.gpu !== expected.actual) {
        await llama.dispose();
        throw new Error("The local reranker runtime is not the reviewed platform prebuilt.");
      }
      const model = await llama.loadModel({ modelPath: assetPath });
      try {
        const context = await model.createRankingContext({ contextSize: 4_096, batchSize: 512, threads: 6 });
        return {
          rank: (query, documents) => context.rankAll(query, [...documents]),
          dispose: async () => {
            await context.dispose();
            await model.dispose();
            await llama.dispose();
          }
        };
      } catch (error) {
        await model.dispose();
        await llama.dispose();
        throw error;
      }
    }
  };
}

function expectedGpuBackend(): { readonly requested: "auto" | false; readonly actual: "metal" | false } {
  if (process.platform === "darwin" && process.arch === "arm64") return { requested: "auto", actual: "metal" };
  if ((process.platform === "darwin" || process.platform === "win32") && process.arch === "x64") {
    return { requested: false, actual: false };
  }
  throw new Error("The local reranker has no reviewed prebuilt for this platform.");
}

function boundedText(input: string, maximumCodePoints: number, kind: "query" | "document"): string {
  const text = input.trim();
  if (!text || Array.from(text).length > maximumCodePoints) throw new Error(`The reranker ${kind} is outside its bound.`);
  return text;
}
