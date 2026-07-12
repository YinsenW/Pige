import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  AddPresetProviderRequest,
  AddManualProviderRequest,
  AddManualModelRequest,
  DefaultModelBindingSummary,
  ModelProviderSettingsSummary,
  ModelProfileSummary,
  PigeErrorSummary,
  ProviderConnectNeedsManualModel,
  ProviderConnectResult,
  ProviderProfileSummary,
  RefreshProviderModelsRequest,
  UpdateModelRequest,
  SetDefaultModelRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ModelProfilesFileSchema,
  ModelProfileSchema,
  ProviderProfileSchema,
  ProviderProfilesFileSchema,
  isBuiltInProviderKind,
  isProviderLoopbackHostname,
  type BoundaryVerification,
  type CloudBoundary,
  type ModelListStrategy,
  type ModelProfile,
  type ModelProfilesFile,
  type ProviderAuthRequirement,
  type ProviderKind,
  type ProviderProfile,
  type ProviderProfilesFile
} from "@pige/schemas";
import {
  ModelProviderConnectionTester,
  type DiscoveredModel,
  type ProviderConnectionResult
} from "./model-provider-connection";
import { JsonSecretStore } from "./secret-store";
import { normalizeProviderBaseUrl } from "./provider-base-url";
import {
  getReviewedProviderPreset,
  isReviewedPresetModel,
  listReviewedProviderPresets,
  type ReviewedProviderPreset
} from "./model-provider-presets";
import {
  ModelProviderGenerationProbe,
  type ModelProviderGenerationProbePort
} from "./model-provider-generation-probe";

export class ModelProviderRegistry {
  readonly #providersPath: string;
  readonly #modelsPath: string;
  readonly #connectTransactionPath: string;
  readonly #secrets: JsonSecretStore;
  readonly #connectionTester: ModelProviderConnectionTester;
  readonly #generationProbe: ModelProviderGenerationProbePort;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    secrets: JsonSecretStore,
    connectionTester: ModelProviderConnectionTester = new ModelProviderConnectionTester(),
    generationProbe: ModelProviderGenerationProbePort = new ModelProviderGenerationProbe()
  ) {
    this.#providersPath = path.join(userDataPath, "provider-profiles.json");
    this.#modelsPath = path.join(userDataPath, "model-profiles.json");
    this.#connectTransactionPath = path.join(userDataPath, "provider-connect-transaction.json");
    this.#secrets = secrets;
    this.#connectionTester = connectionTester;
    this.#generationProbe = generationProbe;
    this.#recoverPendingConnection();
  }

  summary(): ModelProviderSettingsSummary {
    const providerRead = this.#tryReadProviders();
    const modelRead = this.#tryReadModels();
    const providers = providerRead.ok ? providerRead.value.providers : [];
    const modelFile = modelRead.ok ? modelRead.value : { schemaVersion: 1 as const, models: [] };
    const defaultBinding = providerRead.ok && modelRead.ok
      ? resolveDefaultBinding(providers, modelFile, this.#secrets)
      : configuredUnusableBinding();
    const effectiveDefaultModelId = defaultBinding.state === "ready"
      ? defaultBinding.modelProfileId
      : undefined;
    return {
      presets: listReviewedProviderPresets(),
      providers: providers.map(toProviderSummary),
      models: modelFile.models.map((model) => toModelSummary(model, effectiveDefaultModelId)),
      ...(effectiveDefaultModelId ? { defaultModelProfileId: effectiveDefaultModelId } : {}),
      hasDefaultModel: Boolean(effectiveDefaultModelId),
      defaultBinding
    };
  }

  async addPresetProvider(request: AddPresetProviderRequest): Promise<ModelProviderSettingsSummary> {
    const preset = getReviewedProviderPreset(request.presetId);
    return this.#queueMutation(() => this.#connectProvider({
      displayName: preset.displayName,
      providerKind: preset.providerKind,
      endpointProtocol: preset.endpointProtocol,
      authRequirement: preset.authRequirement,
      ...(!isBuiltInProviderKind(preset.providerKind) ? { baseUrl: preset.fixedBaseUrl } : {}),
      ...(request.apiKey ? { apiKey: request.apiKey } : {}),
      manualModelId: preset.bootstrapModelIds[0] ?? "bootstrap-model-required",
      cloudBoundary: preset.cloudBoundary
    }, preset).then((result) => {
      if (isNeedsManualModelResult(result)) {
        throw new PigeDomainError(
          "model_provider.preset_model_unavailable",
          "The reviewed preset could not select a bootstrap model."
        );
      }
      return result;
    }));
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
    return this.summary().defaultBinding.state === "ready";
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
      ...(provider.authSecretRef ? { apiKey: this.#secrets.readProviderSecret(provider.authSecretRef) } : {})
    };
  }

  async addManualProvider(request: AddManualProviderRequest): Promise<ProviderConnectResult> {
    return this.#queueMutation(() => this.#connectProvider({ ...request, authRequirement: "api_key" }));
  }

  refreshProviderModels(request: RefreshProviderModelsRequest): Promise<ModelProviderSettingsSummary> {
    return this.#queueMutation(() => this.#refreshProviderModels(request));
  }

  async #refreshProviderModels(request: RefreshProviderModelsRequest): Promise<ModelProviderSettingsSummary> {
    const providers = this.#readProviders();
    const provider = providers.providers.find((candidate) => candidate.id === request.providerProfileId);
    if (!provider || !hasUsableProviderCredential(provider, this.#secrets)) {
      throw new PigeDomainError("model_provider.binding_unusable", "The selected Provider Profile is unavailable.");
    }
    const apiKey = provider.authSecretRef
      ? this.#secrets.readProviderSecret(provider.authSecretRef)
      : undefined;
    const discovery = await this.#connectionTester.discoverModels({
      providerKind: provider.providerKind,
      endpointProtocol: provider.endpointProtocol,
      authRequirement: provider.authRequirement,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      cloudBoundary: provider.cloudBoundary
    });
    if (discovery.modelListStrategy !== "list_models") {
      throw new PigeDomainError(
        "model_provider.discovery_unavailable",
        "This provider does not expose a supported model list; add a custom model instead."
      );
    }
    const now = new Date().toISOString();
    const models = this.#readModels();
    const discoveredById = new Map(discovery.discoveredModels.map((model) => [model.modelId, model] as const));
    const currentProviderModels = models.models.filter((model) => model.providerProfileId === provider.id);
    const mergedProviderModels = discovery.discoveredModels.map((discovered) => {
      const existing = currentProviderModels.find((model) => model.modelId === discovered.modelId);
      return ModelProfileSchema.parse(existing ? {
        ...existing,
        displayName: existing.displayName ?? discovered.displayName ?? discovered.modelId,
        updatedAt: now
      } : {
        id: createProfileId("model", discovered.modelId),
        providerProfileId: provider.id,
        modelId: discovered.modelId,
        displayName: discovered.displayName ?? discovered.modelId,
        source: "provider_list",
        enabled: false,
        createdAt: now,
        updatedAt: now
      });
    });
    for (const existing of currentProviderModels) {
      if (discoveredById.has(existing.modelId)) continue;
      mergedProviderModels.push(existing);
    }
    const nextProviders = ProviderProfilesFileSchema.parse({
      schemaVersion: 1,
      providers: providers.providers.map((candidate) => candidate.id === provider.id
        ? { ...candidate, modelListStrategy: "list_models", updatedAt: now }
        : candidate)
    });
    const nextModels = ModelProfilesFileSchema.parse({
      ...models,
      models: [
        ...mergedProviderModels,
        ...models.models.filter((model) => model.providerProfileId !== provider.id)
      ]
    });
    this.#commitProfileFiles(nextProviders, nextModels);
    return this.summary();
  }

  addManualModel(request: AddManualModelRequest): Promise<ModelProviderSettingsSummary> {
    return this.#queueMutation(async () => {
      const provider = this.#readProviders().providers.find((candidate) => candidate.id === request.providerProfileId);
      if (!provider || !hasUsableProviderCredential(provider, this.#secrets)) {
        throw new PigeDomainError("model_provider.binding_unusable", "The selected Provider Profile is unavailable.");
      }
      const models = this.#readModels();
      const now = new Date().toISOString();
      const existing = models.models.find((model) =>
        model.providerProfileId === provider.id && model.modelId === request.modelId
      );
      const nextModel: ModelProfile = existing ? {
        ...existing,
        ...(request.displayName ? { displayName: request.displayName } : {}),
        enabled: true,
        updatedAt: now
      } : {
        id: createProfileId("model", request.modelId),
        providerProfileId: provider.id,
        modelId: request.modelId,
        displayName: request.displayName ?? request.modelId,
        source: "manual",
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      this.#writeModels(ModelProfilesFileSchema.parse({
        ...models,
        models: existing
          ? models.models.map((model) => model.id === existing.id ? nextModel : model)
          : [nextModel, ...models.models]
      }));
      return this.summary();
    });
  }

  updateModel(request: UpdateModelRequest): Promise<ModelProviderSettingsSummary> {
    return this.#queueMutation(async () => {
      const models = this.#readModels();
      const selected = models.models.find((model) => model.id === request.modelProfileId);
      const nextEnabled = request.enabled ?? selected?.enabled;
      if (!selected || (!nextEnabled && models.defaultModelProfileId === selected.id)) {
        throw new PigeDomainError(
          "model_provider.model_state_invalid",
          "The Global Default model must remain enabled until another default is selected."
        );
      }
      this.#writeModels(ModelProfilesFileSchema.parse({
        ...models,
        models: models.models.map((model) => model.id === selected.id
          ? {
              ...model,
              enabled: nextEnabled,
              ...(request.displayName === null
                ? { displayName: undefined }
                : request.displayName === undefined
                  ? {}
                  : { displayName: request.displayName }),
              updatedAt: new Date().toISOString()
            }
          : model)
      }));
      return this.summary();
    });
  }

  async #connectProvider(
    request: ProviderConnectRequest,
    preset?: ReviewedProviderPreset
  ): Promise<ProviderConnectResult> {
    const manualModelId = request.manualModelId?.trim();
    const apiKey = normalizeProviderCredential(request.authRequirement, request.apiKey);

    const normalizedBaseUrl = request.baseUrl === undefined ? undefined : normalizeProviderBaseUrl(request.baseUrl);
    if (isBuiltInProviderKind(request.providerKind) && normalizedBaseUrl !== undefined) {
      throw new PigeDomainError(
        "model_provider.builtin_base_url_forbidden",
        "Built-in OpenAI and Anthropic profiles use their fixed official endpoint; choose a compatible provider for a custom base URL."
      );
    }
    if (!isBuiltInProviderKind(request.providerKind) && normalizedBaseUrl === undefined) {
      throw new PigeDomainError(
        "model_provider.base_url_missing",
        "Compatible and custom providers require an explicit Base URL."
      );
    }
    const normalizedRequest = {
      ...request,
      ...(apiKey ? { apiKey } : {}),
      ...(normalizedBaseUrl === undefined ? {} : { baseUrl: normalizedBaseUrl })
    };
    let connection: ProviderConnectionResult;
    try {
      if (preset) {
        const discovery = await this.#connectionTester.discoverModels(normalizedRequest);
        const selectedModelId = preset.bootstrapModelIds.find((modelId) =>
          discovery.discoveredModels.some((model) => model.modelId === modelId)
        ) ?? discovery.discoveredModels.find((model) => isReviewedPresetModel(preset.presetId, model.modelId))?.modelId;
        if (!selectedModelId) {
          throw new PigeDomainError(
            "model_provider.preset_model_unavailable",
            "No reviewed bootstrap model is available for this provider account."
          );
        }
        connection = { ...discovery, selectedModelId };
      } else if (!manualModelId) {
        try {
          const discovery = await this.#connectionTester.discoverModels(normalizedRequest);
          return createNeedsManualModelResult(
            discovery.modelListStrategy === "list_models"
              ? "select_bootstrap_model"
              : "discovery_unavailable",
            discovery.discoveredModels
          );
        } catch (caught) {
          if (caught instanceof PigeDomainError && isManualDiscoveryFallbackError(caught.code)) {
            return createNeedsManualModelResult("discovery_failed", [], manualDiscoveryError());
          }
          throw caught;
        }
      } else {
        try {
          connection = await this.#connectionTester.testManualProvider({
            ...normalizedRequest,
            manualModelId
          });
        } catch (caught) {
          if (caught instanceof PigeDomainError && isManualDiscoveryFallbackError(caught.code)) {
            connection = {
              checkedAt: new Date().toISOString(),
              modelListStrategy: "failed_then_manual",
              discoveredModels: [],
              selectedModelId: manualModelId
            };
          } else {
            throw caught;
          }
        }
      }
    } catch (caught) {
      if (preset && caught instanceof PigeDomainError && caught.code === "model_provider.model_not_found") {
        throw new PigeDomainError(
          "model_provider.preset_model_unavailable",
          "The reviewed default model is unavailable for this provider account."
        );
      }
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError(
        "model_provider.connection_failed",
        "The provider connection could not be validated safely."
      );
    }
    const discoveredModels = preset
      ? connection.discoveredModels.filter((model) => isReviewedPresetModel(preset.presetId, model.modelId))
      : connection.discoveredModels;
    if (preset && !discoveredModels.some((model) => model.modelId === connection.selectedModelId)) {
      throw new PigeDomainError(
        "model_provider.preset_model_unavailable",
        "The reviewed default model is unavailable for this provider account."
      );
    }
    const now = new Date().toISOString();
    const providers = this.#readProviders();
    const models = this.#readModels();
    const replacedProviders = preset
      ? providers.providers.filter((provider) => provider.presetId === preset.presetId)
      : [];
    if (replacedProviders.length > 1) throw persistenceRepairRequiredError();
    const priorProvider = replacedProviders[0];
    const providerId = priorProvider?.id ?? createProfileId("provider", request.displayName);
    const boundary = classifyProviderBoundary(request.providerKind, normalizedBaseUrl, request.cloudBoundary);
    const providerWithoutSecret = {
      id: providerId,
      ...(preset ? { presetId: preset.presetId } : {}),
      displayName: normalizeDisplayName(request.displayName, "Provider"),
      providerKind: request.providerKind,
      endpointProtocol: request.endpointProtocol,
      authRequirement: request.authRequirement,
      ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
      modelListStrategy: connection.modelListStrategy,
      cloudBoundary: boundary.cloudBoundary,
      boundaryVerification: boundary.boundaryVerification,
      createdAt: priorProvider?.createdAt ?? now,
      updatedAt: now
    };
    const generatedModels = createModelProfiles({
      providerId,
      now,
      selectedModelId: connection.selectedModelId,
      modelListStrategy: connection.modelListStrategy,
      discoveredModels
    });
    const priorProviderModels = models.models.filter((model) => model.providerProfileId === providerId);
    const generatedModelIds = new Set(generatedModels.map((model) => model.modelId));
    const newModels = [
      ...generatedModels.map((model) => {
        const prior = priorProviderModels.find((candidate) => candidate.modelId === model.modelId);
        return prior ? ModelProfileSchema.parse({
          ...model,
          ...prior,
          enabled: model.modelId === connection.selectedModelId ? true : prior.enabled,
          updatedAt: now
        }) : model;
      }),
      ...priorProviderModels.filter((model) => !generatedModelIds.has(model.modelId))
    ];
    const defaultModel = newModels.find((model) => model.modelId === connection.selectedModelId) ?? newModels[0];
    if (!defaultModel) {
      throw new PigeDomainError("model_provider.no_models", "No model profile could be created.");
    }

    const replacedProviderIds = new Set(replacedProviders.map((provider) => provider.id));
    const retainedProviders = providers.providers.filter((provider) => !replacedProviderIds.has(provider.id));
    const retainedModels = models.models.filter((model) => !replacedProviderIds.has(model.providerProfileId));
    const effectivePriorDefault = resolveEffectiveDefaultModelId(providers.providers, models, this.#secrets);
    const nextDefaultModelId = effectivePriorDefault &&
      [...newModels, ...retainedModels].some((model) => model.id === effectivePriorDefault)
      ? effectivePriorDefault
      : defaultModel.id;
    const pendingProvider = ProviderProfileSchema.parse({
      ...providerWithoutSecret,
      ...(apiKey ? { authSecretRef: "provider_secret_pending" } : {})
    });
    const pendingProviders = ProviderProfilesFileSchema.parse({
      schemaVersion: 1,
      providers: [pendingProvider, ...retainedProviders]
    });
    const nextModels = ModelProfilesFileSchema.parse({
      schemaVersion: 1,
      defaultModelProfileId: nextDefaultModelId,
      models: [...newModels, ...retainedModels]
    });
    await this.#generationProbe.probe({
      provider: pendingProvider,
      model: defaultModel,
      ...(apiKey ? { apiKey } : {})
    });

    let providerSnapshot: FileSnapshot;
    let modelSnapshot: FileSnapshot;
    try {
      providerSnapshot = this.#snapshotFile(this.#providersPath);
      modelSnapshot = this.#snapshotFile(this.#modelsPath);
    } catch {
      throw persistenceFailedError();
    }

    const newSecretRef = apiKey ? `provider_secret_${randomUUID().replaceAll("-", "_")}` : null;
    const transaction: ProviderConnectTransaction = {
      schemaVersion: 1,
      newSecretRef,
      providerSnapshot,
      modelSnapshot
    };
    try {
      this.#writeConnectTransaction(transaction);
      if (apiKey && newSecretRef) this.#secrets.saveProviderSecret(apiKey, newSecretRef);
      const committedProvider = ProviderProfileSchema.parse({
        ...pendingProvider,
        ...(newSecretRef ? { authSecretRef: newSecretRef } : {})
      });
      const committedProviders = ProviderProfilesFileSchema.parse({
        ...pendingProviders,
        providers: [committedProvider, ...retainedProviders]
      });
      this.#writeProviders(committedProviders);
      this.#writeModels(nextModels);
      this.#verifyConnectedState(committedProviders, nextModels, newSecretRef);
      this.#removeConnectTransaction();
    } catch (caught) {
      const rolledBack = this.#rollbackConnectedState(transaction);
      if (!rolledBack) throw persistenceRepairRequiredError();
      if (caught instanceof PigeDomainError) throw caught;
      throw persistenceFailedError();
    }
    for (const replaced of replacedProviders) {
      if (replaced.authSecretRef) this.#deleteSecretIfUnreferenced(replaced.authSecretRef);
    }
    return this.summary();
  }

  setDefaultModel(request: SetDefaultModelRequest): Promise<ModelProviderSettingsSummary> {
    return this.#queueMutation(() => this.#setDefaultModel(request));
  }

  async #setDefaultModel(request: SetDefaultModelRequest): Promise<ModelProviderSettingsSummary> {
    const models = this.#readModels();
    const selected = models.models.find((model) => model.id === request.modelProfileId && model.enabled);
    const provider = selected
      ? this.#readProviders().providers.find((candidate) => candidate.id === selected.providerProfileId)
      : undefined;
    if (!selected || !provider || !hasUsableProviderCredential(provider, this.#secrets)) {
      throw new PigeDomainError("model_profile_missing", "Default model must refer to an enabled model profile.");
    }
    const nextModels = ModelProfilesFileSchema.parse({
      schemaVersion: 1,
      defaultModelProfileId: request.modelProfileId,
      models: models.models
    });
    let snapshot: FileSnapshot;
    try {
      snapshot = this.#snapshotFile(this.#modelsPath);
    } catch {
      throw persistenceFailedError();
    }
    try {
      this.#writeModels(nextModels);
      if (!isDeepStrictEqual(this.#readModels(), nextModels)) throw persistenceVerificationError();
    } catch (caught) {
      if (!this.#restoreAndVerify(this.#modelsPath, snapshot)) throw persistenceRepairRequiredError();
      if (caught instanceof PigeDomainError) throw caught;
      throw persistenceFailedError();
    }
    return this.summary();
  }

  #queueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
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

  #commitProfileFiles(providers: ProviderProfilesFile, models: ModelProfilesFile): void {
    let providerSnapshot: FileSnapshot;
    let modelSnapshot: FileSnapshot;
    try {
      providerSnapshot = this.#snapshotFile(this.#providersPath);
      modelSnapshot = this.#snapshotFile(this.#modelsPath);
    } catch {
      throw persistenceFailedError();
    }
    const transaction: ProviderConnectTransaction = {
      schemaVersion: 1,
      newSecretRef: null,
      providerSnapshot,
      modelSnapshot
    };
    try {
      this.#writeConnectTransaction(transaction);
      this.#writeProviders(providers);
      this.#writeModels(models);
      if (
        !isDeepStrictEqual(this.#readProviders(), providers) ||
        !isDeepStrictEqual(this.#readModels(), models)
      ) {
        throw persistenceVerificationError();
      }
      this.#removeConnectTransaction();
    } catch (caught) {
      if (!this.#rollbackConnectedState(transaction)) throw persistenceRepairRequiredError();
      if (caught instanceof PigeDomainError) throw caught;
      throw persistenceFailedError();
    }
  }

  #tryReadProviders(): RegistryRead<ProviderProfilesFile> {
    try {
      return { ok: true, value: this.#readProviders() };
    } catch {
      return { ok: false };
    }
  }

  #tryReadModels(): RegistryRead<ModelProfilesFile> {
    try {
      return { ok: true, value: this.#readModels() };
    } catch {
      return { ok: false };
    }
  }

  #snapshotFile(filePath: string): FileSnapshot {
    if (!fs.existsSync(filePath)) return { exists: false };
    return { exists: true, contents: fs.readFileSync(filePath, "utf8") };
  }

  #restoreAndVerify(filePath: string, snapshot: FileSnapshot): boolean {
    try {
      if (snapshot.exists) this.#writeText(filePath, snapshot.contents);
      else {
        fs.rmSync(filePath, { force: true });
        fsyncDirectoryIfSupported(path.dirname(filePath));
      }
      return snapshot.exists
        ? fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === snapshot.contents
        : !fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  #verifyConnectedState(
    providers: ProviderProfilesFile,
    models: ModelProfilesFile,
    secretRef: string | null
  ): void {
    try {
      if (
        !isDeepStrictEqual(this.#readProviders(), providers) ||
        !isDeepStrictEqual(this.#readModels(), models) ||
        (secretRef !== null && (
          !this.#secrets.listSecretRefs().includes(secretRef) ||
          !this.#secrets.hasProviderSecret(secretRef)
        ))
      ) {
        throw persistenceVerificationError();
      }
    } catch {
      throw persistenceVerificationError();
    }
  }

  #rollbackConnectedState(transaction: ProviderConnectTransaction): boolean {
    let failed = false;
    if (!this.#restoreAndVerify(this.#providersPath, transaction.providerSnapshot)) failed = true;
    if (!this.#restoreAndVerify(this.#modelsPath, transaction.modelSnapshot)) failed = true;
    try {
      if (transaction.newSecretRef !== null) {
        const referenced = this.#readProviders().providers.some(
          (provider) => provider.authSecretRef === transaction.newSecretRef
        );
        if (referenced) {
          failed = true;
        } else {
          this.#secrets.deleteProviderSecret(transaction.newSecretRef);
          if (this.#secrets.listSecretRefs().includes(transaction.newSecretRef)) failed = true;
        }
      }
    } catch {
      failed = true;
    }
    if (!failed) {
      try {
        this.#removeConnectTransaction();
      } catch {
        failed = true;
      }
    }
    return !failed;
  }

  #recoverPendingConnection(): void {
    if (!fs.existsSync(this.#connectTransactionPath)) return;
    let transaction: ProviderConnectTransaction;
    try {
      transaction = parseProviderConnectTransaction(
        JSON.parse(fs.readFileSync(this.#connectTransactionPath, "utf8"))
      );
    } catch {
      throw persistenceRepairRequiredError();
    }
    if (!this.#rollbackConnectedState(transaction)) throw persistenceRepairRequiredError();
  }

  #writeConnectTransaction(transaction: ProviderConnectTransaction): void {
    this.#writeJson(this.#connectTransactionPath, transaction);
    const persisted = parseProviderConnectTransaction(
      JSON.parse(fs.readFileSync(this.#connectTransactionPath, "utf8"))
    );
    if (!isDeepStrictEqual(persisted, transaction)) throw persistenceVerificationError();
  }

  #removeConnectTransaction(): void {
    fs.rmSync(this.#connectTransactionPath, { force: true });
    fsyncDirectoryIfSupported(path.dirname(this.#connectTransactionPath));
    if (fs.existsSync(this.#connectTransactionPath)) throw persistenceVerificationError();
  }

  #deleteSecretIfUnreferenced(secretRef: string): void {
    try {
      if (this.#readProviders().providers.some((provider) => provider.authSecretRef === secretRef)) return;
      this.#secrets.deleteProviderSecret(secretRef);
    } catch {
      // The committed binding is valid; encrypted orphan cleanup remains recoverable maintenance.
    }
  }

  #writeJson(filePath: string, value: unknown): void {
    this.#writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  #writeText(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(temporaryPath, "w", 0o600);
      fs.writeFileSync(fileDescriptor, value, "utf8");
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = undefined;
      fs.renameSync(temporaryPath, filePath);
      fsyncDirectoryIfSupported(path.dirname(filePath));
    } finally {
      if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // A failed temporary-file cleanup cannot replace the primary persistence result.
      }
    }
  }
}

function fsyncDirectoryIfSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFsync(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isUnsupportedDirectoryFsync(caught: unknown): boolean {
  if (typeof caught !== "object" || caught === null || !("code" in caught)) return false;
  return ["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"]
    .includes(String(caught.code));
}

type RegistryRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

type ProviderConnectRequest = Omit<AddManualProviderRequest, "apiKey"> & {
  readonly authRequirement: ProviderAuthRequirement;
  readonly apiKey?: string;
};

type FileSnapshot =
  | { readonly exists: false }
  | { readonly exists: true; readonly contents: string };

interface ProviderConnectTransaction {
  readonly schemaVersion: 1;
  readonly newSecretRef: string | null;
  readonly providerSnapshot: FileSnapshot;
  readonly modelSnapshot: FileSnapshot;
}

function parseProviderConnectTransaction(value: unknown): ProviderConnectTransaction {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    Object.keys(value).sort().join(",") !== "modelSnapshot,newSecretRef,providerSnapshot,schemaVersion"
  ) throw persistenceRepairRequiredError();
  if (
    value.newSecretRef !== null &&
    (typeof value.newSecretRef !== "string" || !/^provider_secret_[a-z0-9_]+$/u.test(value.newSecretRef))
  ) throw persistenceRepairRequiredError();
  return {
    schemaVersion: 1,
    newSecretRef: value.newSecretRef,
    providerSnapshot: parseFileSnapshot(value.providerSnapshot),
    modelSnapshot: parseFileSnapshot(value.modelSnapshot)
  };
}

function parseFileSnapshot(value: unknown): FileSnapshot {
  if (!isRecord(value) || typeof value.exists !== "boolean") throw persistenceRepairRequiredError();
  if (!value.exists && Object.keys(value).length === 1) return { exists: false };
  if (
    value.exists &&
    Object.keys(value).length === 2 &&
    typeof value.contents === "string" &&
    Buffer.byteLength(value.contents, "utf8") <= 4 * 1_024 * 1_024
  ) return { exists: true, contents: value.contents };
  throw persistenceRepairRequiredError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderCredential(
  authRequirement: ProviderAuthRequirement,
  value: string | undefined
): string | undefined {
  const apiKey = value?.trim();
  if (authRequirement === "api_key" && !apiKey) {
    throw new PigeDomainError("secret_empty", "Provider API key cannot be empty.");
  }
  if (authRequirement === "none" && apiKey) {
    throw new PigeDomainError("secret_forbidden", "This Provider preset does not accept an API key.");
  }
  return apiKey || undefined;
}

function hasUsableProviderCredential(provider: ProviderProfile, secrets: JsonSecretStore): boolean {
  if (provider.authRequirement === "none") return provider.authSecretRef === undefined;
  if (provider.authSecretRef === undefined) return provider.authRequirement === "optional_api_key";
  return secrets.hasProviderSecret(provider.authSecretRef);
}

function createNeedsManualModelResult(
  reason: ProviderConnectNeedsManualModel["reason"],
  discoveredModels: readonly DiscoveredModel[],
  error?: PigeErrorSummary
): ProviderConnectNeedsManualModel {
  return {
    status: "needs_manual_model",
    reason,
    discoveredModels: discoveredModels.map((model) => ({
      modelId: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {})
    })),
    ...(error ? { error } : {})
  };
}

function manualDiscoveryError(): PigeErrorSummary {
  return {
    code: "model_provider.discovery_failed",
    domain: "model_provider",
    messageKey: "errors.model_provider.connection_failed",
    retryable: true,
    severity: "error",
    userAction: "retry"
  };
}

function isManualDiscoveryFallbackError(code: string): boolean {
  return new Set([
    "model_provider.connection_failed",
    "model_provider.model_list_invalid",
    "model_provider.model_list_too_large",
    "model_provider.network_failed",
    "model_provider.no_models",
    "model_provider.timeout"
  ]).has(code);
}

function isNeedsManualModelResult(result: ProviderConnectResult): result is ProviderConnectNeedsManualModel {
  return "status" in result && result.status === "needs_manual_model";
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
  readonly apiKey?: string;
}

function resolveEffectiveDefaultModelId(
  providers: readonly ProviderProfile[],
  models: ModelProfilesFile,
  secrets: JsonSecretStore
): string | undefined {
  const binding = resolveDefaultBinding(providers, models, secrets);
  return binding.state === "ready" ? binding.modelProfileId : undefined;
}

function resolveDefaultBinding(
  providers: readonly ProviderProfile[],
  models: ModelProfilesFile,
  secrets: JsonSecretStore
): DefaultModelBindingSummary {
  const hasConfiguredState = providers.length > 0 || models.models.length > 0 ||
    models.defaultModelProfileId !== undefined;
  if (!hasConfiguredState) return { state: "not_configured" };

  const configuredModelId = models.defaultModelProfileId;
  if (!configuredModelId) return configuredUnusableBinding();
  const selected = models.models.find(
    (model) => model.id === configuredModelId && model.enabled
  );
  if (!selected) return configuredUnusableBinding({ modelProfileId: configuredModelId });
  const provider = providers.find((candidate) => candidate.id === selected.providerProfileId);
  if (!provider) {
    return configuredUnusableBinding({
      providerProfileId: selected.providerProfileId,
      modelProfileId: selected.id
    });
  }
  try {
    if (!hasUsableProviderCredential(provider, secrets)) {
      return configuredUnusableBinding({
        providerProfileId: provider.id,
        modelProfileId: selected.id
      });
    }
  } catch {
    return configuredUnusableBinding({
      providerProfileId: provider.id,
      modelProfileId: selected.id
    });
  }
  return {
    state: "ready",
    providerProfileId: provider.id,
    modelProfileId: selected.id
  };
}

const DEFAULT_BINDING_UNUSABLE_ERROR = {
  code: "model_provider.binding_unusable",
  domain: "model_provider",
  messageKey: "errors.model_provider.binding_unusable",
  retryable: false,
  severity: "error",
  userAction: "configure_model"
} satisfies PigeErrorSummary;

function configuredUnusableBinding(ids: {
  readonly providerProfileId?: string;
  readonly modelProfileId?: string;
} = {}): DefaultModelBindingSummary {
  return {
    state: "configured_unusable",
    ...(ids.providerProfileId ? { providerProfileId: ids.providerProfileId } : {}),
    ...(ids.modelProfileId ? { modelProfileId: ids.modelProfileId } : {}),
    error: { ...DEFAULT_BINDING_UNUSABLE_ERROR }
  };
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
      enabled: discovered.modelId === options.selectedModelId,
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
    ...(provider.presetId ? { presetId: provider.presetId } : {}),
    displayName: provider.displayName,
    providerKind: provider.providerKind as ProviderKind,
    endpointProtocol: provider.endpointProtocol,
    authRequirement: provider.authRequirement,
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

function persistenceFailedError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.persistence_failed",
    "Provider setup could not be saved to protected local storage."
  );
}

function persistenceVerificationError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.persistence_verification_failed",
    "Provider setup could not be verified after its local write."
  );
}

function persistenceRepairRequiredError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.persistence_repair_required",
    "Provider setup could not restore its previous local state safely."
  );
}
