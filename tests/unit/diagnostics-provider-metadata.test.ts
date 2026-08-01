import { describe, expect, it } from "vitest";
import type { ModelProviderSettingsSummary } from "@pige/contracts";
import { projectDiagnosticsProviderMetadata } from "../../apps/desktop/src/main/services/diagnostics-provider-metadata";

describe("diagnostics provider metadata", () => {
  it("projects deterministic aggregate facts without provider or model identity", () => {
    const summary: ModelProviderSettingsSummary = {
      revision: "private-revision",
      presets: [],
      providers: [{
        id: "provider_private_alpha",
        displayName: "Private provider name",
        providerKind: "openai_compatible",
        endpointProtocol: "openai_responses",
        authRequirement: "api_key",
        baseUrl: "https://private.example.test/v1",
        modelListStrategy: "list_models",
        cloudBoundary: "custom_cloud_endpoint",
        runtimeStatus: {
          discovery: "verified",
          generation: "failed",
          updatedAt: "2026-08-01T01:02:03.000Z"
        },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T01:02:03.000Z"
      }],
      models: [{
        id: "model_profile_private",
        providerProfileId: "provider_private_alpha",
        modelId: "private-model-id",
        displayName: "Private model name",
        source: "provider_list",
        enabled: true,
        isDefault: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T01:02:03.000Z"
      }],
      defaultModelProfileId: "model_profile_private",
      hasDefaultModel: true,
      defaultBinding: {
        state: "ready",
        modelProfileId: "model_profile_private",
        providerProfileId: "provider_private_alpha"
      }
    };

    const projected = projectDiagnosticsProviderMetadata(summary);
    const serialized = JSON.stringify(projected);

    expect(projected).toEqual({
      schemaVersion: 1,
      providerCount: 1,
      modelCount: 1,
      enabledModelCount: 1,
      hasDefaultModel: true,
      providers: [{
        providerKind: "openai_compatible",
        endpointProtocol: "openai_responses",
        authRequirement: "api_key",
        modelListStrategy: "list_models",
        cloudBoundary: "custom_cloud_endpoint",
        discovery: "verified",
        generation: "failed",
        modelCount: 1,
        enabledModelCount: 1
      }]
    });
    for (const privateValue of [
      "provider_private_alpha",
      "Private provider name",
      "https://private.example.test/v1",
      "model_profile_private",
      "private-model-id",
      "Private model name",
      "2026-08-01T01:02:03.000Z",
      "private-revision"
    ]) expect(serialized).not.toContain(privateValue);
  });
});
