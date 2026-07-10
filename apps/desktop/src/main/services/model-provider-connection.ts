import { isBuiltInProviderKind, type CloudBoundary, type ModelListStrategy, type ProviderKind } from "@pige/schemas";
import { PigeDomainError } from "@pige/domain";
import { normalizeProviderBaseUrl } from "./provider-base-url";

export interface ProviderConnectionInput {
  readonly providerKind: ProviderKind;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly manualModelId: string;
  readonly cloudBoundary: CloudBoundary;
}

export interface DiscoveredModel {
  readonly modelId: string;
  readonly displayName?: string;
}

export interface ProviderConnectionResult {
  readonly checkedAt: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly discoveredModels: readonly DiscoveredModel[];
  readonly selectedModelId: string;
}

export type FetchLike = typeof fetch;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
const MODEL_LIST_UNSUPPORTED_STATUSES = new Set([404, 405, 501]);

export class ModelProviderConnectionTester {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async testManualProvider(input: ProviderConnectionInput): Promise<ProviderConnectionResult> {
    const selectedModelId = input.manualModelId.trim();
    if (!selectedModelId) {
      throw new PigeDomainError("model_id_empty", "Manual model ID cannot be empty.");
    }

    const apiKey = input.apiKey.trim();
    if (!apiKey) {
      throw new PigeDomainError("secret_empty", "Provider API key cannot be empty.");
    }
    if (isBuiltInProviderKind(input.providerKind) && input.baseUrl !== undefined) {
      throw new PigeDomainError(
        "model_provider.builtin_base_url_forbidden",
        "Built-in OpenAI and Anthropic profiles use their fixed official endpoint; choose a compatible provider for a custom base URL."
      );
    }

    const endpoint = buildModelsEndpoint(input.providerKind, input.baseUrl);
    const response = await this.#fetchWithTimeout(endpoint, {
      method: "GET",
      headers: buildModelListHeaders(input.providerKind, apiKey)
    });

    if (response.ok) {
      const discoveredModels = parseModelList(await response.json());
      if (discoveredModels.length === 0) {
        throw new PigeDomainError("model_provider.no_models", "The provider did not return any models.");
      }
      if (!discoveredModels.some((model) => model.modelId === selectedModelId)) {
        throw new PigeDomainError("model_provider.model_not_found", "The selected model was not returned by this provider.");
      }
      return {
        checkedAt: new Date().toISOString(),
        modelListStrategy: "list_models",
        discoveredModels,
        selectedModelId
      };
    }

    if (response.status === 401 || response.status === 403) {
      throw new PigeDomainError("model_provider.auth_failed", "The provider rejected the API key.");
    }

    if (supportsManualModelFallback(input.providerKind) && MODEL_LIST_UNSUPPORTED_STATUSES.has(response.status)) {
      return {
        checkedAt: new Date().toISOString(),
        modelListStrategy: "failed_then_manual",
        discoveredModels: [],
        selectedModelId
      };
    }

    throw new PigeDomainError("model_provider.connection_failed", "The provider connection test failed.");
  }

  async #fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        throw new PigeDomainError("model_provider.timeout", "The provider connection test timed out.");
      }
      throw new PigeDomainError("model_provider.network_failed", "The provider could not be reached.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildModelsEndpoint(providerKind: ProviderKind, baseUrl: string | undefined): string {
  const defaultBaseUrl =
    providerKind === "anthropic" || providerKind === "anthropic_compatible"
      ? DEFAULT_ANTHROPIC_BASE_URL
      : DEFAULT_OPENAI_BASE_URL;
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl ?? defaultBaseUrl);
  return `${normalizedBaseUrl}/models`;
}

function supportsManualModelFallback(providerKind: ProviderKind): boolean {
  return providerKind === "openai_compatible" || providerKind === "anthropic_compatible" || providerKind === "custom";
}

function buildModelListHeaders(providerKind: ProviderKind, apiKey: string): HeadersInit {
  if (providerKind === "anthropic" || providerKind === "anthropic_compatible") {
    return {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

function parseModelList(value: unknown): DiscoveredModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new PigeDomainError("model_provider.model_list_invalid", "The provider returned an invalid model list.");
  }

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    const modelId = item.id.trim();
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    const displayName =
      typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : undefined;
    models.push({
      modelId,
      ...(displayName ? { displayName } : {})
    });
  }
  return models;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
