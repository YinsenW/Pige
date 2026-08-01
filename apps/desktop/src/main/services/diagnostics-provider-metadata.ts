import type { ModelProviderSettingsSummary } from "@pige/contracts";

export interface DiagnosticsProviderMetadata {
  readonly schemaVersion: 1;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly enabledModelCount: number;
  readonly hasDefaultModel: boolean;
  readonly providers: readonly {
    readonly providerKind: string;
    readonly endpointProtocol: string;
    readonly authRequirement: string;
    readonly modelListStrategy: string;
    readonly cloudBoundary: string;
    readonly discovery: "not_checked" | "verified";
    readonly generation: "not_checked" | "verified" | "failed";
    readonly modelCount: number;
    readonly enabledModelCount: number;
  }[];
}

export function projectDiagnosticsProviderMetadata(
  summary: ModelProviderSettingsSummary
): DiagnosticsProviderMetadata {
  const providers = summary.providers.map((provider) => {
    const models = summary.models.filter((model) => model.providerProfileId === provider.id);
    return {
      providerKind: provider.providerKind,
      endpointProtocol: provider.endpointProtocol,
      authRequirement: provider.authRequirement,
      modelListStrategy: provider.modelListStrategy,
      cloudBoundary: provider.cloudBoundary,
      discovery: provider.runtimeStatus?.discovery ?? "not_checked",
      generation: provider.runtimeStatus?.generation ?? "not_checked",
      modelCount: models.length,
      enabledModelCount: models.filter((model) => model.enabled).length
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    schemaVersion: 1,
    providerCount: providers.length,
    modelCount: summary.models.length,
    enabledModelCount: summary.models.filter((model) => model.enabled).length,
    hasDefaultModel: summary.hasDefaultModel,
    providers
  };
}
