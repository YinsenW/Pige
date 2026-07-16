import { describe, expect, it } from "vitest";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { resolveModelCapabilities } from "../../apps/desktop/src/main/services/model-capability-registry";

describe("model capability registry", () => {
  it("preserves reviewed Pi metadata for a known upstream model", () => {
    const resolved = resolveModelCapabilities({
      config: makeConfig({ providerKind: "openai", modelId: "gpt-4-turbo" }),
      api: "openai-responses",
      providerId: "pige:provider_test",
      baseUrl: "https://api.openai.com/v1"
    });

    expect(resolved.source).toBe("pi_catalog");
    expect(resolved.model).toMatchObject({
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128_000,
      maxTokens: 4_096
    });
  });

  it("merges explicit Pige capability facts without changing provider identity", () => {
    const config = makeConfig({
      providerKind: "custom",
      modelId: "private-model",
      supportsVision: true,
      contextWindowTokens: 96_000,
      defaultThinkingLevel: "high"
    });
    const resolved = resolveModelCapabilities({
      config,
      api: "openai-completions",
      providerId: "pige:provider_test",
      baseUrl: "https://models.example.test/v1"
    });

    expect(resolved.source).toBe("pige_profile");
    expect(resolved.model).toMatchObject({
      provider: "pige:provider_test",
      baseUrl: "https://models.example.test/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 96_000,
      maxTokens: 4_096
    });
  });

  it("uses an explicit conservative registry profile only for unknown models", () => {
    const resolved = resolveModelCapabilities({
      config: makeConfig({ providerKind: "custom", modelId: "unknown-model" }),
      api: "openai-completions",
      providerId: "pige:provider_test",
      baseUrl: "http://127.0.0.1:11434/v1"
    });

    expect(resolved.source).toBe("conservative_unknown");
    expect(resolved.model).toMatchObject({
      reasoning: false,
      input: ["text"],
      contextWindow: 32_768,
      maxTokens: 4_096
    });
  });
});

function makeConfig(input: {
  readonly providerKind: "openai" | "custom";
  readonly modelId: string;
  readonly supportsVision?: boolean;
  readonly contextWindowTokens?: number;
  readonly defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}): ModelProviderRuntimeConfig {
  return {
    provider: {
      id: "provider_test",
      displayName: "Test",
      providerKind: input.providerKind,
      endpointProtocol: input.providerKind === "openai" ? "openai_responses" : "openai_chat_completions",
      ...(input.providerKind === "custom" ? { baseUrl: "http://127.0.0.1:11434/v1" } : {}),
      authRequirement: "none",
      modelListStrategy: "manual_only",
      cloudBoundary: input.providerKind === "openai" ? "cloud" : "local",
      boundaryVerification: input.providerKind === "openai" ? "builtin_verified" : "loopback_verified",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z"
    },
    model: {
      id: "model_test",
      providerProfileId: "provider_test",
      modelId: input.modelId,
      source: "manual",
      enabled: true,
      ...(input.supportsVision === undefined ? {} : { supportsVision: input.supportsVision }),
      ...(input.contextWindowTokens === undefined ? {} : { contextWindowTokens: input.contextWindowTokens }),
      ...(input.defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel: input.defaultThinkingLevel }),
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z"
    }
  };
}
