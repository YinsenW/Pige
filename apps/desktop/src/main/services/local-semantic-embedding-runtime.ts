const EMBEDDING_DIMENSION = 1024;
const MAX_DOCUMENT_BATCH = 16;
const MAX_DOCUMENT_CODE_POINTS = 1_200;
const MAX_QUERY_CODE_POINTS = 320;
const QUERY_INSTRUCTION =
  "Instruct: Given a user query, retrieve relevant passages from the local knowledge base that answer the query\nQuery: ";

export interface LocalSemanticAssetLease {
  readonly path: string;
  readonly identity: string;
  readonly stillCurrent: () => boolean;
}

export interface LocalSemanticEmbeddingBackend {
  readonly dimension: number;
  embed(input: string): Promise<readonly number[]>;
  dispose(): Promise<void>;
}

export interface LocalSemanticEmbeddingBackendFactory {
  create(assetPath: string): Promise<LocalSemanticEmbeddingBackend>;
}

export interface LocalSemanticEmbeddingRuntimeOptions {
  readonly createAssetLease: () => LocalSemanticAssetLease | undefined;
  readonly backendFactory?: LocalSemanticEmbeddingBackendFactory;
}

export class LocalSemanticEmbeddingRuntime {
  readonly #createAssetLease: LocalSemanticEmbeddingRuntimeOptions["createAssetLease"];
  readonly #backendFactory: LocalSemanticEmbeddingBackendFactory;
  #loaded: LoadedEmbeddingBackend | undefined;
  #loading: LoadingEmbeddingBackend | undefined;
  #generation = 0;

  constructor(options: LocalSemanticEmbeddingRuntimeOptions) {
    this.#createAssetLease = options.createAssetLease;
    this.#backendFactory = options.backendFactory ?? createNodeLlamaEmbeddingBackendFactory();
  }

  async embedQuery(queryInput: string): Promise<Float32Array> {
    const query = boundedText(queryInput, MAX_QUERY_CODE_POINTS, "query");
    return this.#embed(`${QUERY_INSTRUCTION}${query}`);
  }

  async embedDocuments(inputs: readonly string[]): Promise<readonly Float32Array[]> {
    if (inputs.length === 0 || inputs.length > MAX_DOCUMENT_BATCH) {
      throw new Error("The local embedding batch is outside its bound.");
    }
    const documents = inputs.map((input) => boundedText(input, MAX_DOCUMENT_CODE_POINTS, "document"));
    const results: Float32Array[] = [];
    for (const document of documents) results.push(await this.#embed(document));
    return results;
  }

  async available(): Promise<boolean> {
    try {
      await this.#currentBackend();
      return true;
    } catch {
      return false;
    }
  }

  availableNow(): boolean {
    return Boolean(this.#loaded?.lease.stillCurrent());
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    const loaded = this.#loaded;
    const loading = this.#loading;
    this.#loaded = undefined;
    this.#loading = undefined;
    if (loaded) await loaded.backend.dispose();
    if (loading) await loading.promise.catch(() => undefined);
  }

  async #embed(input: string): Promise<Float32Array> {
    const loaded = await this.#currentBackend();
    if (!loaded.lease.stillCurrent()) {
      await this.#discard(loaded);
      throw new Error("The verified local embedding asset changed before inference.");
    }
    const vector = normalizeEmbedding(await loaded.backend.embed(input));
    if (!loaded.lease.stillCurrent()) {
      await this.#discard(loaded);
      throw new Error("The verified local embedding asset changed during inference.");
    }
    return vector;
  }

  async #currentBackend(): Promise<LoadedEmbeddingBackend> {
    const lease = this.#createAssetLease();
    if (!lease || !lease.stillCurrent()) {
      await this.dispose();
      throw new Error("A verified enabled local embedding asset is unavailable.");
    }
    if (this.#loaded?.lease.identity === lease.identity && this.#loaded.lease.stillCurrent()) {
      return this.#loaded;
    }
    if (this.#loaded) await this.dispose();
    if (this.#loading) {
      if (this.#loading.identity === lease.identity) return this.#loading.promise;
      await this.dispose();
    }
    const generation = this.#generation;
    const promise = this.#load(lease, generation).finally(() => {
      if (this.#loading?.promise === promise) this.#loading = undefined;
    });
    this.#loading = { identity: lease.identity, promise };
    return promise;
  }

  async #load(lease: LocalSemanticAssetLease, generation: number): Promise<LoadedEmbeddingBackend> {
    const backend = await this.#backendFactory.create(lease.path);
    if (
      backend.dimension !== EMBEDDING_DIMENSION ||
      generation !== this.#generation ||
      !lease.stillCurrent()
    ) {
      await backend.dispose();
      throw new Error("The local embedding runtime did not match the verified asset contract.");
    }
    const loaded = { lease, backend };
    this.#loaded = loaded;
    return loaded;
  }

  async #discard(loaded: LoadedEmbeddingBackend): Promise<void> {
    if (this.#loaded === loaded) this.#loaded = undefined;
    await loaded.backend.dispose();
  }
}

interface LoadedEmbeddingBackend {
  readonly lease: LocalSemanticAssetLease;
  readonly backend: LocalSemanticEmbeddingBackend;
}

interface LoadingEmbeddingBackend {
  readonly identity: string;
  readonly promise: Promise<LoadedEmbeddingBackend>;
}

function createNodeLlamaEmbeddingBackendFactory(): LocalSemanticEmbeddingBackendFactory {
  return {
    create: async (assetPath) => {
      process.env.NODE_LLAMA_CPP_SKIP_DOWNLOAD = "true";
      const { getLlama } = await import("node-llama-cpp");
      const expectedGpu = expectedGpuBackend();
      const llama = await getLlama({ gpu: expectedGpu.requested });
      if (llama.buildType !== "prebuilt" || llama.gpu !== expectedGpu.actual) {
        await llama.dispose();
        throw new Error("The local embedding runtime is not the reviewed platform prebuilt.");
      }
      const model = await llama.loadModel({ modelPath: assetPath });
      try {
        if (
          model.embeddingVectorSize !== EMBEDDING_DIMENSION ||
          model.fileInfo.architectureMetadata.pooling_type !== 3
        ) {
          throw new Error("The local embedding model dimension or pooling contract is invalid.");
        }
        const context = await model.createEmbeddingContext({
          contextSize: 2_048,
          batchSize: 512,
          threads: 6
        });
        return {
          dimension: model.embeddingVectorSize,
          embed: async (input) => (await context.getEmbeddingFor(input)).vector,
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
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { requested: "auto", actual: "metal" };
  }
  if ((process.platform === "darwin" || process.platform === "win32") && process.arch === "x64") {
    return { requested: false, actual: false };
  }
  throw new Error("The local embedding runtime has no reviewed prebuilt for this platform.");
}

function boundedText(input: string, maximumCodePoints: number, kind: "query" | "document"): string {
  if (typeof input !== "string" || input.trim().length === 0 || Array.from(input).length > maximumCodePoints) {
    throw new Error(`The local embedding ${kind} is outside its bound.`);
  }
  return input;
}

function normalizeEmbedding(input: readonly number[]): Float32Array {
  if (input.length !== EMBEDDING_DIMENSION) throw new Error("The local embedding dimension is invalid.");
  let squaredMagnitude = 0;
  for (const value of input) {
    if (!Number.isFinite(value)) throw new Error("The local embedding contains a non-finite value.");
    squaredMagnitude += value * value;
  }
  const magnitude = Math.sqrt(squaredMagnitude);
  if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error("The local embedding magnitude is invalid.");
  const normalized = new Float32Array(EMBEDDING_DIMENSION);
  for (let index = 0; index < input.length; index += 1) normalized[index] = input[index]! / magnitude;
  return normalized;
}

export const LOCAL_SEMANTIC_EMBEDDING_DIMENSION = EMBEDDING_DIMENSION;
export const LOCAL_SEMANTIC_QUERY_INSTRUCTION = QUERY_INSTRUCTION;
