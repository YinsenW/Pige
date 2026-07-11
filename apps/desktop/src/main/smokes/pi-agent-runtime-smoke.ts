import type { ModelProviderRuntimeConfig } from "../services/model-provider-registry";
import { PiAgentRuntimeAdapter, type PigeAgentToolDefinition } from "../services/pi-agent-runtime-adapter";

export async function runPiAgentRuntimeSmoke(): Promise<{
  readonly adapterMode: "embedded_pi_sdk";
  readonly modelId: string;
  readonly invokedTools: readonly string[];
  readonly publicationCount: number;
}> {
  let publicationCount = 0;
  const tools: PigeAgentToolDefinition[] = [
    {
      name: "pige_inspect_source",
      label: "Inspect",
      description: "Inspect synthetic evidence.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ modelText: "Synthetic verified evidence.", details: { fragmentCount: 1 } })
    },
    {
      name: "pige_create_knowledge_note",
      label: "Publish",
      description: "Publish a synthetic validated note.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false
      },
      execute: async () => {
        publicationCount += 1;
        return { modelText: "Published.", details: {}, terminate: true };
      }
    }
  ];
  const result = await new PiAgentRuntimeAdapter({
    fauxResponses: [
      { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
      { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Smoke" } }
    ]
  }).run({
    runtimeConfig,
    jobId: "job_20260711_pismoke01",
    systemPrompt: "Use only the two Pige-owned smoke tools.",
    userPrompt: "Inspect and publish the synthetic smoke evidence.",
    tools
  });
  return {
    adapterMode: result.adapterMode,
    modelId: result.modelId,
    invokedTools: result.invokedTools,
    publicationCount
  };
}

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pi_smoke",
    displayName: "Pi Smoke",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_pi_smoke",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pi_smoke",
    providerProfileId: "provider_pi_smoke",
    modelId: "pi-smoke-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-smoke-key"
};
