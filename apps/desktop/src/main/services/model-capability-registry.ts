import type { Api, Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";

export type ModelCapabilitySource = "pi_catalog" | "pige_profile" | "conservative_unknown";

export interface ResolvedModelCapabilities {
  readonly model: Model<Api>;
  readonly source: ModelCapabilitySource;
}

const UNKNOWN_CONTEXT_WINDOW_TOKENS = 32_768;
const UNKNOWN_MAX_OUTPUT_TOKENS = 4_096;

export function resolveModelCapabilities(input: {
  readonly config: ModelProviderRuntimeConfig;
  readonly api: Api;
  readonly providerId: string;
  readonly baseUrl: string;
}): ResolvedModelCapabilities {
  const reviewed = findReviewedPiModel(input.config, input.api);
  const profile = input.config.model;
  const explicitProfileCapabilities = profile.supportsVision !== undefined ||
    profile.contextWindowTokens !== undefined || profile.defaultThinkingLevel !== undefined;
  const base = reviewed ?? createConservativeUnknownModel(input);
  const reasoning = profile.defaultThinkingLevel === undefined
    ? base.reasoning
    : profile.defaultThinkingLevel !== "off";
  const inputKinds = profile.supportsVision === undefined
    ? base.input
    : profile.supportsVision ? ["text", "image"] as const : ["text"] as const;
  const contextWindow = profile.contextWindowTokens ?? base.contextWindow;

  return {
    model: {
      ...base,
      id: profile.modelId,
      name: profile.displayName ?? base.name,
      api: input.api,
      provider: input.providerId,
      baseUrl: input.baseUrl,
      reasoning,
      input: [...inputKinds],
      contextWindow,
      maxTokens: Math.min(base.maxTokens, contextWindow)
    } as Model<Api>,
    source: explicitProfileCapabilities
      ? "pige_profile"
      : reviewed ? "pi_catalog" : "conservative_unknown"
  };
}

function findReviewedPiModel(
  config: ModelProviderRuntimeConfig,
  api: Api
): Model<Api> | undefined {
  const catalog = config.provider.providerKind === "openai"
    ? OPENAI_MODELS
    : config.provider.providerKind === "anthropic"
      ? ANTHROPIC_MODELS
      : config.provider.presetId === "deepseek"
        ? DEEPSEEK_MODELS
        : undefined;
  const candidate = catalog
    ? Object.values(catalog).find((model) => model.id === config.model.modelId)
    : undefined;
  return candidate?.api === api ? candidate as Model<Api> : undefined;
}

function createConservativeUnknownModel(input: {
  readonly config: ModelProviderRuntimeConfig;
  readonly api: Api;
  readonly providerId: string;
  readonly baseUrl: string;
}): Model<Api> {
  return {
    id: input.config.model.modelId,
    name: input.config.model.displayName ?? input.config.model.modelId,
    api: input.api,
    provider: input.providerId,
    baseUrl: input.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: UNKNOWN_CONTEXT_WINDOW_TOKENS,
    maxTokens: UNKNOWN_MAX_OUTPUT_TOKENS
  };
}
