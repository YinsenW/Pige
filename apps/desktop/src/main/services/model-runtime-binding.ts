import { createHash } from "node:crypto";
import type { ModelProfileSummary, ProviderProfileSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";

interface ProviderIdentityInput {
  readonly id: string;
  readonly providerKind: ProviderProfileSummary["providerKind"];
  readonly baseUrl?: string | undefined;
  readonly modelListStrategy: ProviderProfileSummary["modelListStrategy"];
  readonly cloudBoundary: ProviderProfileSummary["cloudBoundary"];
  readonly boundaryVerification?: ProviderProfileSummary["boundaryVerification"] | undefined;
  readonly updatedAt: string;
}

interface ModelIdentityInput {
  readonly id: string;
  readonly providerProfileId: string;
  readonly modelId: string;
  readonly source: ModelProfileSummary["source"];
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export interface ModelRuntimeBindingIdentity {
  readonly providerIdentityHash: string;
  readonly modelIdentityHash: string;
}

export function createModelRuntimeBindingIdentity(
  model: ModelIdentityInput,
  provider: ProviderIdentityInput
): ModelRuntimeBindingIdentity {
  return {
    providerIdentityHash: hashIdentity({
      id: provider.id,
      providerKind: provider.providerKind,
      baseUrl: provider.baseUrl ?? null,
      modelListStrategy: provider.modelListStrategy,
      cloudBoundary: provider.cloudBoundary,
      boundaryVerification: provider.boundaryVerification ?? "unknown",
      updatedAt: provider.updatedAt
    }),
    modelIdentityHash: hashIdentity({
      id: model.id,
      providerProfileId: model.providerProfileId,
      modelId: model.modelId,
      source: model.source,
      enabled: model.enabled,
      updatedAt: model.updatedAt
    })
  };
}

export function assertModelProviderPair(
  model: ModelProfileSummary,
  provider: ProviderProfileSummary
): void {
  if (!model.enabled || !model.isDefault || model.providerProfileId !== provider.id) {
    throw new PigeDomainError(
      "model_provider.runtime_config_changed",
      "The selected default model and provider are not one valid enabled binding."
    );
  }
}

export function assertApprovedModelProviderBinding(
  model: ModelProfileSummary | undefined,
  provider: ProviderProfileSummary | undefined,
  approved: ModelRuntimeBindingIdentity,
  message: string
): void {
  if (!model || !provider || model.providerProfileId !== provider.id) {
    throw new PigeDomainError("model_provider.runtime_config_changed", message);
  }
  const current = createModelRuntimeBindingIdentity(model, provider);
  if (
    current.modelIdentityHash !== approved.modelIdentityHash ||
    current.providerIdentityHash !== approved.providerIdentityHash
  ) {
    throw new PigeDomainError("model_provider.runtime_config_changed", message);
  }
}

export function assertApprovedRuntimeBinding(
  runtimeConfig: ModelProviderRuntimeConfig | undefined,
  approved: ModelRuntimeBindingIdentity
): asserts runtimeConfig is ModelProviderRuntimeConfig {
  if (!runtimeConfig || runtimeConfig.model.providerProfileId !== runtimeConfig.provider.id) {
    throw new PigeDomainError(
      "model_provider.runtime_config_changed",
      "The provider runtime binding changed before the approved model call could start."
    );
  }
  const current = createModelRuntimeBindingIdentity(runtimeConfig.model, runtimeConfig.provider);
  if (
    current.modelIdentityHash !== approved.modelIdentityHash ||
    current.providerIdentityHash !== approved.providerIdentityHash
  ) {
    throw new PigeDomainError(
      "model_provider.runtime_config_changed",
      "The provider endpoint or model changed before the approved model call could start."
    );
  }
}

function hashIdentity(identity: Readonly<Record<string, unknown>>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex")}`;
}
