import { isDeepStrictEqual } from "node:util";
import type { DeleteManualModelRequest, ModelProviderSettingsSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { ModelProfilesFileSchema, type ModelProfile, type ModelProfilesFile, type ProviderProfilesFile } from "@pige/schemas";

export interface ManualModelLifecyclePort {
  readonly assertExpectedRevision: (expectedRevision: string) => void;
  readonly readProviders: () => ProviderProfilesFile;
  readonly readModels: () => ModelProfilesFile;
  readonly assertProviderInactive: (providerProfileId: string) => void;
  readonly setProviderMutating: (providerProfileId: string, mutating: boolean) => void;
  readonly selectDeterministicDefault: (
    providers: ProviderProfilesFile["providers"],
    models: readonly ModelProfile[]
  ) => ModelProfile | undefined;
  readonly commitProfileFiles: (providers: ProviderProfilesFile, models: ModelProfilesFile) => void;
  readonly summary: () => ModelProviderSettingsSummary;
}

export async function deleteManualModelWithRecovery(
  request: DeleteManualModelRequest,
  port: ManualModelLifecyclePort
): Promise<ModelProviderSettingsSummary> {
  port.assertExpectedRevision(request.expectedRevision);
  const providers = port.readProviders();
  const models = port.readModels();
  const selected = models.models.find((model) => model.id === request.modelProfileId);
  if (!selected || selected.source !== "manual") {
    throw new PigeDomainError(
      "model_provider.manual_model_missing",
      "Only a currently installed manual model can be removed."
    );
  }
  const retainedModels = models.models.filter((model) => model.id !== selected.id);
  const replacement = models.defaultModelProfileId === selected.id
    ? port.selectDeterministicDefault(providers.providers, retainedModels)
    : undefined;
  const affectedProviderIds = new Set([selected.providerProfileId]);
  if (replacement) affectedProviderIds.add(replacement.providerProfileId);
  for (const providerId of affectedProviderIds) {
    port.assertProviderInactive(providerId);
    port.setProviderMutating(providerId, true);
  }
  try {
    port.assertExpectedRevision(request.expectedRevision);
    const currentProviders = port.readProviders();
    const currentModels = port.readModels();
    const exact = currentModels.models.find((model) => model.id === selected.id);
    if (!exact || !isDeepStrictEqual(exact, selected)) {
      throw new PigeDomainError(
        "model_provider.profile_stale",
        "The selected manual model changed before it could be removed."
      );
    }
    const nextRetainedModels = currentModels.models.filter((model) => model.id !== selected.id);
    const nextDefault = currentModels.defaultModelProfileId === selected.id
      ? port.selectDeterministicDefault(currentProviders.providers, nextRetainedModels)
      : undefined;
    const nextModels = ModelProfilesFileSchema.parse({
      schemaVersion: 1,
      ...(currentModels.defaultModelProfileId === selected.id
        ? nextDefault ? { defaultModelProfileId: nextDefault.id } : {}
        : currentModels.defaultModelProfileId ? { defaultModelProfileId: currentModels.defaultModelProfileId } : {}),
      models: nextRetainedModels
    });
    port.commitProfileFiles(currentProviders, nextModels);
    return port.summary();
  } finally {
    for (const providerId of affectedProviderIds) port.setProviderMutating(providerId, false);
  }
}
