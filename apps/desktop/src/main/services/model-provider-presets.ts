import type { ProviderPresetSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";

export interface ReviewedProviderPreset extends ProviderPresetSummary {
  readonly bootstrapModelIds: readonly string[];
}

const OPENAI_PRESET: ReviewedProviderPreset = {
  presetId: "openai",
  displayName: "OpenAI",
  providerKind: "openai",
  endpointProtocol: "openai_responses",
  authRequirement: "api_key",
  fixedBaseUrl: "https://api.openai.com/v1",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  apiKeyManagementUrl: "https://platform.openai.com/api-keys",
  bootstrapModelIds: ["gpt-5-mini", "gpt-4.1-mini"]
};

const ANTHROPIC_PRESET: ReviewedProviderPreset = {
  presetId: "anthropic",
  displayName: "Anthropic",
  providerKind: "anthropic",
  endpointProtocol: "anthropic_messages",
  authRequirement: "api_key",
  fixedBaseUrl: "https://api.anthropic.com/v1",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  apiKeyManagementUrl: "https://console.anthropic.com/settings/keys",
  bootstrapModelIds: ["claude-sonnet-4-5", "claude-sonnet-4-20250514"]
};

const DEEPSEEK_PRESET: ReviewedProviderPreset = {
  presetId: "deepseek",
  displayName: "DeepSeek",
  providerKind: "openai_compatible",
  endpointProtocol: "openai_chat_completions",
  authRequirement: "api_key",
  fixedBaseUrl: "https://api.deepseek.com",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  apiKeyManagementUrl: "https://platform.deepseek.com/api_keys",
  bootstrapModelIds: ["deepseek-chat", "deepseek-v4-pro", "deepseek-v4-flash"]
};

const GEMINI_PRESET: ReviewedProviderPreset = {
  presetId: "gemini",
  displayName: "Gemini",
  providerKind: "openai_compatible",
  endpointProtocol: "openai_chat_completions",
  authRequirement: "api_key",
  fixedBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  apiKeyManagementUrl: "https://aistudio.google.com/app/apikey",
  bootstrapModelIds: ["gemini-2.5-flash", "gemini-2.0-flash"]
};

const OLLAMA_PRESET: ReviewedProviderPreset = {
  presetId: "ollama",
  displayName: "Ollama",
  providerKind: "openai_compatible",
  endpointProtocol: "openai_chat_completions",
  authRequirement: "none",
  fixedBaseUrl: "http://127.0.0.1:11434/v1",
  modelListStrategy: "list_models",
  cloudBoundary: "local",
  bootstrapModelIds: ["llama3.2", "qwen3", "gemma3"]
};

const PRESETS = [OPENAI_PRESET, ANTHROPIC_PRESET, GEMINI_PRESET, DEEPSEEK_PRESET, OLLAMA_PRESET] as const;

export function listReviewedProviderPresets(): readonly ProviderPresetSummary[] {
  return PRESETS.map(({ bootstrapModelIds: _bootstrapModelIds, ...summary }) => summary);
}

export function getReviewedProviderPreset(presetId: string): ReviewedProviderPreset {
  const normalized = presetId.trim().toLocaleLowerCase("en-US");
  const preset = PRESETS.find((candidate) => candidate.presetId === normalized);
  if (!preset) {
    throw new PigeDomainError("model_provider.preset_missing", "The selected provider preset is unavailable.");
  }
  return preset;
}

export function isReviewedPresetModel(presetId: string, modelId: string): boolean {
  const preset = getReviewedProviderPreset(presetId);
  if (preset.presetId === "openai") {
    return /^(?:gpt-(?:5(?:\.\d+)?|4\.1|4o)(?:-(?:mini|nano|pro))?)(?:-\d{4}-\d{2}-\d{2})?$/u.test(modelId);
  }
  if (preset.presetId === "anthropic") return /^claude-[A-Za-z0-9._-]+$/u.test(modelId);
  if (preset.presetId === "gemini") return /^gemini-[A-Za-z0-9._-]+$/u.test(modelId);
  if (preset.presetId === "deepseek") return /^deepseek-[A-Za-z0-9._-]+$/u.test(modelId);
  if (preset.presetId === "ollama") return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(modelId);
  return false;
}
