import type { ProviderKind } from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";
import { normalizeProviderBaseUrl } from "./provider-base-url";

export interface ModelJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

export interface ModelJsonResult {
  readonly text: string;
}

export type FetchLike = typeof fetch;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 45_000;

export class ProviderModelJsonClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async generateJson(config: ModelProviderRuntimeConfig, request: ModelJsonRequest): Promise<ModelJsonResult> {
    if (isAnthropicKind(config.provider.providerKind)) {
      return this.#generateAnthropicJson(config, request);
    }
    return this.#generateOpenAiJson(config, request);
  }

  async #generateOpenAiJson(config: ModelProviderRuntimeConfig, request: ModelJsonRequest): Promise<ModelJsonResult> {
    const endpoint = `${normalizeProviderBaseUrl(config.provider.baseUrl ?? DEFAULT_OPENAI_BASE_URL)}/chat/completions`;
    const response = await this.#fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model.modelId,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ],
        temperature: 0.2,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" },
        store: false
      })
    }, request.signal);

    if (!response.ok) {
      throw createProviderError(response.status);
    }

    const json = await response.json();
    const content = readOpenAiContent(json);
    if (!content) {
      throw new PigeDomainError("model_provider.empty_response", "The provider returned an empty model response.");
    }
    return { text: content };
  }

  async #generateAnthropicJson(config: ModelProviderRuntimeConfig, request: ModelJsonRequest): Promise<ModelJsonResult> {
    const endpoint = `${normalizeProviderBaseUrl(config.provider.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL)}/messages`;
    const response = await this.#fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": config.apiKey
      },
      body: JSON.stringify({
        model: config.model.modelId,
        max_tokens: request.maxTokens,
        temperature: 0.2,
        system: request.system,
        messages: [
          {
            role: "user",
            content: request.user
          }
        ]
      })
    }, request.signal);

    if (!response.ok) {
      throw createProviderError(response.status);
    }

    const json = await response.json();
    const content = readAnthropicContent(json);
    if (!content) {
      throw new PigeDomainError("model_provider.empty_response", "The provider returned an empty model response.");
    }
    return { text: content };
  }

  async #fetchWithTimeout(url: string, init: RequestInit, externalSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let abortSource: "external" | "timeout" | undefined;
    const abort = (source: "external" | "timeout"): void => {
      if (abortSource) return;
      abortSource = source;
      controller.abort();
    };
    const onExternalAbort = (): void => abort("external");
    if (externalSignal?.aborted) {
      abort("external");
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timeout = setTimeout(() => abort("timeout"), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch (caught) {
      if (abortSource === "external") {
        throw createAbortError();
      }
      if (abortSource === "timeout") {
        throw new PigeDomainError("model_provider.timeout", "The provider model call timed out.");
      }
      throw new PigeDomainError("model_provider.network_failed", "The provider could not be reached.");
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function createAbortError(): Error {
  const error = new Error("The provider model call was cancelled.");
  error.name = "AbortError";
  return error;
}

function isAnthropicKind(kind: ProviderKind): boolean {
  return kind === "anthropic" || kind === "anthropic_compatible";
}

function createProviderError(status: number): PigeDomainError {
  if (status === 401 || status === 403) {
    return new PigeDomainError("model_provider.auth_failed", "The provider rejected the API key.");
  }
  if (status === 429) {
    return new PigeDomainError("model_provider.rate_limited", "The provider rate-limited the model call.");
  }
  return new PigeDomainError("model_provider.call_failed", "The provider model call failed.");
}

function readOpenAiContent(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) return undefined;
  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return undefined;
  const content = firstChoice.message.content;
  return typeof content === "string" ? content : undefined;
}

function readAnthropicContent(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
  const texts = value.content
    .map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean);
  return texts.join("\n").trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
