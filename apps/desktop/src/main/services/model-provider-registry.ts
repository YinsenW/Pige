import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AddManualProviderRequest,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  ProviderProfileSummary,
  SetDefaultModelRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ModelProfilesFileSchema,
  ProviderProfilesFileSchema,
  isBuiltInProviderKind,
  isProviderLoopbackHostname,
  type BoundaryVerification,
  type CloudBoundary,
  type ModelListStrategy,
  type ModelProfile,
  type ModelProfilesFile,
  type ProviderKind,
  type ProviderProfile,
  type ProviderProfilesFile
} from "@pige/schemas";
import { ModelProviderConnectionTester, type DiscoveredModel } from "./model-provider-connection";
import { JsonSecretStore } from "./secret-store";
import { normalizeProviderBaseUrl } from "./provider-base-url";

export class ModelProviderRegistry {
  readonly #providersPath: string;
  readonly #modelsPath: string;
  readonly #secrets: JsonSecretStore;
  readonly #connectionTester: ModelProviderConnectionTester;

  constructor(
    userDataPath: string,
    secrets: JsonSecretStore,
    connectionTester: ModelProviderConnectionTester = new ModelProviderConnectionTester()
  ) {
    this.#providersPath = path.join(userDataPath, "provider-profiles.json");
    this.#modelsPath = path.join(userDataPath, "model-profiles.json");
    this.#secrets = secrets;
    this.#connectionTester = connectionTester;
  }

  summary(): ModelProviderSettingsSummary {
    const providers = this.#readProviders().providers;
    const modelFile = this.#readModels();
    return {
      providers: providers.map(toProviderSummary),
      models: modelFile.models.map((model) => toModelSummary(model, modelFile.defaultModelProfileId)),
      ...(modelFile.defaultModelProfileId ? { defaultModelProfileId: modelFile.defaultModelProfileId } : {}),
      hasDefaultModel: Boolean(modelFile.defaultModelProfileId)
    };
  }

  hasDefaultModel(): boolean {
    return this.summary().hasDefaultModel;
  }

  getDefaultModel(): ModelProfileSummary | undefined {
    return this.summary().models.find((model) => model.isDefault);
  }

  getDefaultProvider(): ProviderProfileSummary | undefined {
    const summary = this.summary();
    const defaultModel = summary.models.find((model) => model.isDefault);
    if (!defaultModel) return undefined;
    return summary.providers.find((provider) => provider.id === defaultModel.providerProfileId);
  }

  hasDefaultRuntimeBinding(): boolean {
    try {
      const modelFile = this.#readModels();
      const defaultModel = modelFile.models.find(
        (model) => model.id === modelFile.defaultModelProfileId && model.enabled
      );
      if (!defaultModel) return false;
      const provider = this.#readProviders().providers.find(
        (profile) => profile.id === defaultModel.providerProfileId
      );
      return Boolean(provider && this.#secrets.hasProviderSecret(provider.authSecretRef));
    } catch {
      return false;
    }
  }

  getDefaultRuntimeConfig(): ModelProviderRuntimeConfig | undefined {
    const modelFile = this.#readModels();
    const defaultModel = modelFile.models.find((model) => model.id === modelFile.defaultModelProfileId && model.enabled);
    if (!defaultModel) return undefined;
    const provider = this.#readProviders().providers.find((profile) => profile.id === defaultModel.providerProfileId);
    if (!provider) return undefined;
    return {
      provider,
      model: defaultModel,
      apiKey: this.#secrets.readProviderSecret(provider.authSecretRef)
    };
  }

  async addManualProvider(request: AddManualProviderRequest): Promise<ModelProviderSettingsSummary> {
    const manualModelId = request.manualModelId.trim();
    if (!manualModelId) {
      throw new PigeDomainError("model_id_empty", "Manual model ID cannot be empty.");
    }

    const normalizedBaseUrl = request.baseUrl === undefined ? undefined : normalizeProviderBaseUrl(request.baseUrl);
    if (isBuiltInProviderKind(request.providerKind) && normalizedBaseUrl !== undefined) {
      throw new PigeDomainError(
        "model_provider.builtin_base_url_forbidden",
        "Built-in OpenAI and Anthropic profiles use their fixed official endpoint; choose a compatible provider for a custom base URL."
      );
    }
    const normalizedRequest = normalizedBaseUrl === undefined ? request : { ...request, baseUrl: normalizedBaseUrl };
    const connection = await this.#connectionTester.testManualProvider(normalizedRequest);
    const now = new Date().toISOString();
    const providerId = createProfileId("provider", request.displayName);
    const boundary = classifyProviderBoundary(request.providerKind, normalizedBaseUrl, request.cloudBoundary);
    const provider: ProviderProfile = {
      id: providerId,
      displayName: normalizeDisplayName(request.displayName, "Provider"),
      providerKind: request.providerKind,
      ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
      authSecretRef: this.#secrets.saveProviderSecret(request.apiKey),
      modelListStrategy: connection.modelListStrategy,
      cloudBoundary: boundary.cloudBoundary,
      boundaryVerification: boundary.boundaryVerification,
      createdAt: now,
      updatedAt: now
    };
    const newModels = createModelProfiles({
      providerId,
      now,
      selectedModelId: connection.selectedModelId,
      modelListStrategy: connection.modelListStrategy,
      discoveredModels: connection.discoveredModels
    });
    const defaultModel = newModels.find((model) => model.modelId === connection.selectedModelId) ?? newModels[0];
    if (!defaultModel) {
      throw new PigeDomainError("model_provider.no_models", "No model profile could be created.");
    }

    const providers = this.#readProviders();
    const models = this.#readModels();
    this.#writeProviders({ schemaVersion: 1, providers: [provider, ...providers.providers] });
    this.#writeModels({
      schemaVersion: 1,
      defaultModelProfileId: models.defaultModelProfileId ?? defaultModel.id,
      models: [...newModels, ...models.models]
    });
    return this.summary();
  }

  setDefaultModel(request: SetDefaultModelRequest): ModelProviderSettingsSummary {
    const models = this.#readModels();
    if (!models.models.some((model) => model.id === request.modelProfileId && model.enabled)) {
      throw new PigeDomainError("model_profile_missing", "Default model must refer to an enabled model profile.");
    }
    this.#writeModels({
      schemaVersion: 1,
      defaultModelProfileId: request.modelProfileId,
      models: models.models
    });
    return this.summary();
  }

  #readProviders(): ProviderProfilesFile {
    if (!fs.existsSync(this.#providersPath)) {
      return { schemaVersion: 1, providers: [] };
    }
    return ProviderProfilesFileSchema.parse(JSON.parse(fs.readFileSync(this.#providersPath, "utf8")));
  }

  #readModels(): ModelProfilesFile {
    if (!fs.existsSync(this.#modelsPath)) {
      return { schemaVersion: 1, models: [] };
    }
    return ModelProfilesFileSchema.parse(JSON.parse(fs.readFileSync(this.#modelsPath, "utf8")));
  }

  #writeProviders(file: ProviderProfilesFile): void {
    this.#writeJson(this.#providersPath, ProviderProfilesFileSchema.parse(file));
  }

  #writeModels(file: ModelProfilesFile): void {
    this.#writeJson(this.#modelsPath, ModelProfilesFileSchema.parse(file));
  }

  #writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  }
}

function classifyProviderBoundary(
  providerKind: ProviderKind,
  baseUrl: string | undefined,
  requestedBoundary: CloudBoundary
): { cloudBoundary: CloudBoundary; boundaryVerification: BoundaryVerification } {
  if (providerKind === "openai" || providerKind === "anthropic") {
    return { cloudBoundary: "cloud", boundaryVerification: "builtin_verified" };
  }
  if (baseUrl) {
    const hostname = new URL(baseUrl).hostname;
    if (isProviderLoopbackHostname(hostname)) {
      return { cloudBoundary: "local", boundaryVerification: "loopback_verified" };
    }
  }
  if (requestedBoundary === "local") {
    return { cloudBoundary: "unknown", boundaryVerification: "unknown" };
  }
  return {
    cloudBoundary: requestedBoundary,
    boundaryVerification: requestedBoundary === "unknown" ? "unknown" : "user_asserted"
  };
}

export interface ModelProviderRuntimeConfig {
  readonly provider: ProviderProfile;
  readonly model: ModelProfile;
  readonly apiKey: string;
}

function createModelProfiles(options: {
  readonly providerId: string;
  readonly now: string;
  readonly selectedModelId: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly discoveredModels: readonly DiscoveredModel[];
}): ModelProfile[] {
  if (options.modelListStrategy === "list_models") {
    return options.discoveredModels.map((discovered) => ({
      id: createProfileId("model", discovered.modelId),
      providerProfileId: options.providerId,
      modelId: discovered.modelId,
      displayName: discovered.displayName ?? discovered.modelId,
      source: "provider_list",
      enabled: true,
      createdAt: options.now,
      updatedAt: options.now
    }));
  }

  return [
    {
      id: createProfileId("model", options.selectedModelId),
      providerProfileId: options.providerId,
      modelId: options.selectedModelId,
      displayName: options.selectedModelId,
      source: "manual",
      enabled: true,
      createdAt: options.now,
      updatedAt: options.now
    }
  ];
}

function toProviderSummary(provider: ProviderProfile): ProviderProfileSummary {
  return {
    id: provider.id,
    displayName: provider.displayName,
    providerKind: provider.providerKind as ProviderKind,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    modelListStrategy: provider.modelListStrategy,
    cloudBoundary: provider.cloudBoundary as CloudBoundary,
    ...(provider.boundaryVerification ? { boundaryVerification: provider.boundaryVerification } : {}),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

function toModelSummary(model: ModelProfile, defaultModelProfileId: string | undefined): ModelProfileSummary {
  return {
    id: model.id,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    ...(model.displayName ? { displayName: model.displayName } : {}),
    source: model.source,
    enabled: model.enabled,
    isDefault: model.id === defaultModelProfileId,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt
  };
}

function createProfileId(prefix: "provider" | "model", seed: string): string {
  const label = seed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  const suffix = randomUUID().replaceAll("-", "_").slice(0, 12);
  return `${prefix}_${label || "profile"}_${suffix}`;
}

function normalizeDisplayName(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 80);
  return trimmed || fallback;
}
