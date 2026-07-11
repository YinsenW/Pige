import type { ProviderPresetSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";

export interface ReviewedProviderPreset extends ProviderPresetSummary {
  readonly defaultModelId: string;
}

const OPENAI_PRESET: ReviewedProviderPreset = {
  presetId: "openai",
  displayName: "OpenAI",
  providerKind: "openai",
  endpointProtocol: "openai_responses",
  fixedBaseUrl: "https://api.openai.com/v1",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  apiKeyManagementUrl: "https://platform.openai.com/api-keys",
  defaultModelId: "gpt-5-mini"
};

const PRESETS = [OPENAI_PRESET] as const;

export function listReviewedProviderPresets(): readonly ProviderPresetSummary[] {
  return PRESETS.map(({ defaultModelId: _defaultModelId, ...summary }) => summary);
}

export function getReviewedProviderPreset(presetId: string): ReviewedProviderPreset {
  const normalized = presetId.trim().toLocaleLowerCase("en-US");
  const preset = PRESETS.find((candidate) => candidate.presetId === normalized);
  if (!preset) {
    throw new PigeDomainError("model_provider.preset_missing", "The selected provider preset is unavailable.");
  }
  return preset;
}

export function inferProviderPresetId(providerKind: string, baseUrl: string | undefined): string | undefined {
  if (baseUrl !== undefined) return undefined;
  return PRESETS.find((preset) => preset.providerKind === providerKind)?.presetId;
}

export function isReviewedPresetModel(presetId: string, modelId: string): boolean {
  const preset = getReviewedProviderPreset(presetId);
  if (preset.presetId !== "openai") return false;
  return /^(?:gpt-(?:5(?:\.\d+)?|4\.1|4o)(?:-(?:mini|nano|pro))?)(?:-\d{4}-\d{2}-\d{2})?$/u.test(modelId);
}
