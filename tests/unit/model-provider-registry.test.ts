import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProviderConnectionTester, type FetchLike } from "../../apps/desktop/src/main/services/model-provider-connection";
import {
  ModelProviderRegistry,
  type ModelProviderActiveReferencePort,
  type ModelProviderRuntimeConfig
} from "../../apps/desktop/src/main/services/model-provider-registry";
import type { ModelProviderGenerationProbePort } from "../../apps/desktop/src/main/services/model-provider-generation-probe";
import { JsonSecretStore, type SecretCryptoAdapter } from "../../apps/desktop/src/main/services/secret-store";

const tempRoots: string[] = [];

const fakeCrypto: SecretCryptoAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/u, "")
};

const passingProbe: ModelProviderGenerationProbePort = {
  probe: async () => undefined
};

function makeRegistry(
  fetchImpl: FetchLike = okModelListFetch(["gpt-4.1"]),
  crypto: SecretCryptoAdapter = fakeCrypto,
  probe: ModelProviderGenerationProbePort = passingProbe,
  activeReferences?: ModelProviderActiveReferencePort
): { root: string; registry: ModelProviderRegistry; secrets: JsonSecretStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-model-registry-test-"));
  tempRoots.push(root);
  const secrets = new JsonSecretStore(root, crypto);
  return {
    root,
    secrets,
    registry: new ModelProviderRegistry(
      root,
      secrets,
      new ModelProviderConnectionTester(fetchImpl),
      probe,
      activeReferences
    )
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("model provider registry", () => {
  it("reports an empty registry as not configured without creating local files", () => {
    const { root, registry } = makeRegistry();

    expect(registry.summary()).toMatchObject({
      hasDefaultModel: false,
      defaultBinding: { state: "not_configured" }
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("connects the reviewed OpenAI preset from an API key and creates one ready global default", async () => {
    const { root, registry } = makeRegistry(okModelListFetch([
      "text-embedding-3-small",
      "gpt-realtime",
      "gpt-5-mini",
      "gpt-4.1"
    ]));

    const summary = await registry.addPresetProvider({
      presetId: "openai",
      apiKey: "sk-reviewed-preset-secret"
    });

    expect(summary.presets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        presetId: "openai",
        providerKind: "openai",
        endpointProtocol: "openai_responses",
        fixedBaseUrl: "https://api.openai.com/v1",
        modelListStrategy: "list_models",
        cloudBoundary: "cloud"
      }),
      expect.objectContaining({ presetId: "deepseek", endpointProtocol: "openai_chat_completions" })
    ]));
    expect(summary.providers).toHaveLength(1);
    expect(summary.providers[0]).toMatchObject({
      presetId: "openai",
      providerKind: "openai",
      endpointProtocol: "openai_responses"
    });
    expect(summary.models.map((model) => model.modelId)).toEqual(["gpt-5-mini", "gpt-4.1"]);
    expect(summary.models.find((model) => model.isDefault)?.modelId).toBe("gpt-5-mini");
    expect(summary.models.find((model) => model.modelId === "gpt-4.1")?.enabled).toBe(false);
    expect(summary.hasDefaultModel).toBe(true);
    expect(summary.defaultBinding).toEqual({
      state: "ready",
      providerProfileId: summary.providers[0]?.id,
      modelProfileId: summary.defaultModelProfileId
    });
    expect(registry.hasDefaultRuntimeBinding()).toBe(true);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("sk-reviewed-preset-secret");
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).not.toContain("sk-reviewed");
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).not.toContain("sk-reviewed");
  });

  it("connects the reviewed DeepSeek preset with its fixed Chat Completions endpoint", async () => {
    const probe = new RecordingProbe();
    const { registry } = makeRegistry(
      okModelListFetch(["deepseek-v4-flash", "deepseek-v4-pro"]),
      fakeCrypto,
      probe
    );

    const summary = await registry.addPresetProvider({
      presetId: "deepseek",
      apiKey: "synthetic-deepseek-key"
    });

    expect(summary.providers).toEqual([
      expect.objectContaining({
        presetId: "deepseek",
        providerKind: "openai_compatible",
        endpointProtocol: "openai_chat_completions",
        baseUrl: "https://api.deepseek.com"
      })
    ]);
    expect(summary.models.map((model) => model.modelId)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro"
    ]);
    expect(summary.models.find((model) => model.isDefault)?.modelId).toBe("deepseek-v4-pro");
    expect(summary.models.find((model) => model.modelId === "deepseek-v4-flash")?.enabled).toBe(false);
    expect(probe.configs).toEqual([
      expect.objectContaining({
        provider: expect.objectContaining({
          endpointProtocol: "openai_chat_completions",
          baseUrl: "https://api.deepseek.com"
        }),
        model: expect.objectContaining({ modelId: "deepseek-v4-pro" }),
        apiKey: "synthetic-deepseek-key"
      })
    ]);
  });

  it("does not replace a Custom Provider that happens to use a preset endpoint", async () => {
    const { registry } = makeRegistry(okModelListFetch(["deepseek-v4-pro"]));
    const custom = await registry.addManualProvider({
      displayName: "Custom DeepSeek-compatible",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://api.deepseek.com",
      apiKey: "custom-endpoint-secret",
      manualModelId: "deepseek-v4-pro",
      cloudBoundary: "cloud"
    });
    if ("status" in custom) throw new Error("Custom Provider did not connect.");
    const customProvider = custom.providers[0];
    const customDefault = custom.defaultModelProfileId;

    const connected = await registry.addPresetProvider({
      presetId: "deepseek",
      apiKey: "preset-endpoint-secret"
    });

    expect(connected.providers).toHaveLength(2);
    const retainedCustom = connected.providers.find((provider) => provider.id === customProvider?.id);
    expect(retainedCustom).toMatchObject({ displayName: "Custom DeepSeek-compatible" });
    expect(retainedCustom?.presetId).toBeUndefined();
    expect(connected.providers.find((provider) => provider.presetId === "deepseek")).toBeDefined();
    expect(connected.defaultModelProfileId).toBe(customDefault);
    expect(connected.models.filter((model) => model.modelId === "deepseek-v4-pro")).toHaveLength(2);
  });

  it("reconnects one explicit preset identity without resetting its model choices", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini", "gpt-4.1"]));
    const first = await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const providerId = first.providers[0]?.id ?? "";
    const secondary = first.models.find((model) => model.modelId === "gpt-4.1");
    await registry.updateModel({
      modelProfileId: secondary?.id ?? "",
      enabled: true,
      displayName: "Preferred model"
    });
    await registry.setDefaultModel({ modelProfileId: secondary?.id ?? "" });

    const reconnected = await registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" });

    expect(reconnected.providers).toHaveLength(1);
    expect(reconnected.providers[0]).toMatchObject({ id: providerId, presetId: "openai" });
    expect(reconnected.models.find((model) => model.modelId === "gpt-4.1")).toMatchObject({
      id: secondary?.id,
      displayName: "Preferred model",
      enabled: true,
      isDefault: true
    });
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("second-secret");
    expect(registrySecretRefs(root)).toHaveLength(1);
  });

  it("connects a reviewed no-auth Ollama preset without a dummy secret or Authorization header", async () => {
    let authorizationSeen = false;
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(async (_url, init) => {
      const headers = new Headers(init?.headers);
      authorizationSeen ||= headers.has("authorization") || headers.has("x-api-key");
      return new Response(JSON.stringify({ data: [{ id: "llama3.2" }, { id: "qwen3" }] }), { status: 200 });
    }, fakeCrypto, probe);

    const summary = await registry.addPresetProvider({ presetId: "ollama" });

    expect(summary.providers).toEqual([
      expect.objectContaining({
        presetId: "ollama",
        authRequirement: "none",
        baseUrl: "http://127.0.0.1:11434/v1",
        cloudBoundary: "local"
      })
    ]);
    expect(summary.models.find((model) => model.modelId === "llama3.2")).toMatchObject({
      enabled: true,
      isDefault: true
    });
    expect(summary.models.find((model) => model.modelId === "qwen3")?.enabled).toBe(false);
    expect(authorizationSeen).toBe(false);
    expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false);
    expect(probe.configs[0]?.apiKey).toBeUndefined();
  });

  it("returns zero-write manual bootstrap discovery before committing a custom provider", async () => {
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]), fakeCrypto, probe);
    const request = {
      displayName: "Discovery first",
      providerKind: "custom" as const,
      endpointProtocol: "openai_responses" as const,
      baseUrl: "https://discovery.example/v1",
      apiKey: "discovery-secret",
      cloudBoundary: "unknown" as const
    };

    const discovered = await registry.addManualProvider(request);
    expect(discovered).toEqual({
      status: "needs_manual_model",
      reason: "select_bootstrap_model",
      discoveredModels: [{ modelId: "model-a" }, { modelId: "model-b" }]
    });
    expect(fs.readdirSync(root)).toEqual([]);
    expect(probe.configs).toHaveLength(0);

    const connected = await registry.addManualProvider({ ...request, manualModelId: "model-b" });
    expect("status" in connected).toBe(false);
    if ("status" in connected) throw new Error("Custom Provider did not commit after bootstrap selection.");
    expect(connected.models.find((model) => model.modelId === "model-b")).toMatchObject({
      enabled: true,
      isDefault: true
    });
    expect(connected.models.find((model) => model.modelId === "model-a")?.enabled).toBe(false);
    expect(probe.configs).toHaveLength(1);
  });

  it("uses a zero-write manual fallback when a custom endpoint does not expose model discovery", async () => {
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(
      async () => new Response("not supported", { status: 404 }),
      fakeCrypto,
      probe
    );
    const request = {
      displayName: "Manual fallback",
      providerKind: "custom" as const,
      endpointProtocol: "openai_chat_completions" as const,
      baseUrl: "https://manual.example/v1",
      apiKey: "manual-secret",
      cloudBoundary: "unknown" as const
    };

    expect(await registry.addManualProvider(request)).toEqual({
      status: "needs_manual_model",
      reason: "discovery_unavailable",
      discoveredModels: []
    });
    expect(fs.readdirSync(root)).toEqual([]);

    const connected = await registry.addManualProvider({ ...request, manualModelId: "manual-model" });
    if ("status" in connected) throw new Error("Manual fallback did not commit after the Pi probe.");
    expect(connected.models).toEqual([
      expect.objectContaining({ modelId: "manual-model", source: "manual", enabled: true, isDefault: true })
    ]);
    expect(probe.configs).toHaveLength(1);
  });

  it("fails closed when a custom provider omits its explicit Base URL", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["custom-model"]));

    await expect(registry.addManualProvider({
      displayName: "Missing boundary",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      apiKey: "synthetic-key",
      manualModelId: "custom-model",
      cloudBoundary: "unknown"
    })).rejects.toMatchObject({ code: "model_provider.base_url_missing" });

    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("probes the exact transient protocol, endpoint, model, and key before persisting anything", async () => {
    let root = "";
    const probe = new RecordingProbe((config) => {
      expect(fs.existsSync(path.join(root, "provider-profiles.json"))).toBe(false);
      expect(fs.existsSync(path.join(root, "model-profiles.json"))).toBe(false);
      expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false);
      expect(config).toMatchObject({
        provider: {
          providerKind: "custom",
          endpointProtocol: "openai_chat_completions",
          baseUrl: "https://models.example.com/v1"
        },
        model: { modelId: "selected-model" },
        apiKey: "exact-key"
      });
    });
    const fixture = makeRegistry(okModelListFetch(["selected-model"]), fakeCrypto, probe);
    root = fixture.root;

    const summary = await fixture.registry.addManualProvider({
      displayName: "Explicit protocol",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://models.example.com/v1/",
      apiKey: "exact-key",
      manualModelId: "selected-model",
      cloudBoundary: "self_hosted"
    });

    expect(probe.configs).toHaveLength(1);
    expect(summary.providers[0]?.endpointProtocol).toBe("openai_chat_completions");
    const persisted = JSON.parse(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")) as {
      providers: Array<Record<string, unknown>>;
    };
    expect(persisted.providers[0]).toMatchObject({ endpointProtocol: "openai_chat_completions" });
    expect(persisted.providers[0]).not.toHaveProperty("health");
    expect(persisted.providers[0]).not.toHaveProperty("probe");
  });

  it("preserves the known-good preset binding when reconnect discovery fails", async () => {
    let modelIds = ["gpt-5-mini"];
    const { root, registry } = makeRegistry(async () => okModelListFetch(modelIds)("https://example.invalid"));
    const first = await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const beforeProviders = fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8");
    const beforeModels = fs.readFileSync(path.join(root, "model-profiles.json"), "utf8");
    const beforeSecretRefs = registrySecretRefs(root);
    modelIds = ["embedding-only-model"];

    await expect(registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" }))
      .rejects.toMatchObject({ code: "model_provider.preset_model_unavailable" });

    expect(registry.summary()).toEqual(first);
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).toBe(beforeModels);
    expect(registrySecretRefs(root)).toEqual(beforeSecretRefs);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("first-secret");
  });

  it("proves the selected model again on reconnect before replacing the known-good binding", async () => {
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini"]), fakeCrypto, probe);
    await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const beforeProviders = fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8");
    const beforeModels = fs.readFileSync(path.join(root, "model-profiles.json"), "utf8");
    const beforeSecretRefs = registrySecretRefs(root);
    probe.failNext = true;

    await expect(registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" }))
      .rejects.toThrow("synthetic probe failure");

    expect(probe.configs.map((config) => [config.model.modelId, config.apiKey])).toEqual([
      ["gpt-5-mini", "first-secret"],
      ["gpt-5-mini", "second-secret"]
    ]);
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).toBe(beforeModels);
    expect(registrySecretRefs(root)).toEqual(beforeSecretRefs);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("first-secret");
  });

  it("reconnects a preset as one profile and removes the superseded secret", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini", "gpt-4.1"]));
    await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const firstRefs = registrySecretRefs(root);

    const summary = await registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" });

    expect(summary.providers).toHaveLength(1);
    expect(summary.models.filter((model) => model.providerProfileId === summary.providers[0]?.id)).toHaveLength(2);
    expect(registrySecretRefs(root)).toHaveLength(1);
    expect(registrySecretRefs(root)).not.toEqual(firstRefs);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("second-secret");
  });

  it("restores provider, model, and secret state when a staged model-file commit fails", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini"]));
    await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const providersPath = path.join(root, "provider-profiles.json");
    const modelsPath = path.join(root, "model-profiles.json");
    const beforeProviders = fs.readFileSync(providersPath, "utf8");
    const beforeModels = fs.readFileSync(modelsPath, "utf8");
    const beforeSecretRefs = registrySecretRefs(root);
    const originalRename = fs.renameSync;
    let failedModelCommit = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === modelsPath && !failedModelCommit) {
        failedModelCommit = true;
        throw new Error("injected model commit failure");
      }
      return originalRename(from, to);
    });

    await expect(registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" }))
      .rejects.toMatchObject({ code: "model_provider.persistence_failed" });

    expect(fs.readFileSync(providersPath, "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    expect(registrySecretRefs(root)).toEqual(beforeSecretRefs);
    vi.restoreAllMocks();
    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["gpt-5-mini"])),
      passingProbe
    );
    expect(reopened.summary().defaultBinding.state).toBe("ready");
    expect(reopened.getDefaultRuntimeConfig()?.apiKey).toBe("first-secret");
  });

  it("recovers a persisted connect transaction after an in-process rollback is interrupted", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini"]));
    await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const providersPath = path.join(root, "provider-profiles.json");
    const modelsPath = path.join(root, "model-profiles.json");
    const beforeProviders = fs.readFileSync(providersPath, "utf8");
    const beforeModels = fs.readFileSync(modelsPath, "utf8");
    const beforeSecretRefs = registrySecretRefs(root);
    const originalRename = fs.renameSync;
    let providerRenames = 0;
    let failedModelCommit = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === providersPath) {
        providerRenames += 1;
        if (providerRenames === 2) throw new Error("injected provider rollback failure");
      }
      if (String(to) === modelsPath && !failedModelCommit) {
        failedModelCommit = true;
        throw new Error("injected model commit failure");
      }
      return originalRename(from, to);
    });

    await expect(registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" }))
      .rejects.toMatchObject({ code: "model_provider.persistence_repair_required" });

    expect(fs.readFileSync(providersPath, "utf8")).not.toBe(beforeProviders);
    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    const currentProviderFile = JSON.parse(fs.readFileSync(providersPath, "utf8")) as {
      providers: Array<{ authSecretRef: string }>;
    };
    const currentSecretRefs = registrySecretRefs(root);
    expect(currentSecretRefs).toHaveLength(2);
    expect(currentSecretRefs).toEqual(expect.arrayContaining(beforeSecretRefs));
    expect(currentSecretRefs).toContain(currentProviderFile.providers[0]?.authSecretRef);
    vi.restoreAllMocks();
    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["gpt-5-mini"])),
      passingProbe
    );
    expect(reopened.summary().defaultBinding.state).toBe("ready");
    expect(reopened.getDefaultRuntimeConfig()?.apiKey).toBe("first-secret");
    expect(fs.readFileSync(providersPath, "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    expect(registrySecretRefs(root)).toEqual(beforeSecretRefs);
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(false);
  });

  it("keeps provider persistence verification write-only until the runtime boundary", async () => {
    let decryptCalls = 0;
    const crypto: SecretCryptoAdapter = {
      ...fakeCrypto,
      decryptString: (encrypted) => {
        decryptCalls += 1;
        return fakeCrypto.decryptString(encrypted);
      }
    };
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini"]), crypto);
    await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    await registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" });

    expect(decryptCalls).toBe(0);
    expect(registry.summary().defaultBinding.state).toBe("ready");
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).not.toContain("second-secret");
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).not.toContain("second-secret");
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("second-secret");
    expect(decryptCalls).toBe(1);
  });

  it("stores provider metadata and discovered model profiles without writing raw API keys to profile files", async () => {
    const { root, registry } = makeRegistry();

    const summary = await registry.addManualProvider({
      displayName: "OpenAI",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      apiKey: "sk-test-secret-123456789",
      manualModelId: "gpt-4.1",
      cloudBoundary: "cloud"
    });

    const providerProfiles = fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8");
    const modelProfiles = fs.readFileSync(path.join(root, "model-profiles.json"), "utf8");
    const secrets = fs.readFileSync(path.join(root, "secrets.json"), "utf8");

    expect(summary.hasDefaultModel).toBe(true);
    expect(summary.providers[0]?.cloudBoundary).toBe("cloud");
    expect(summary.providers[0]?.boundaryVerification).toBe("builtin_verified");
    expect(summary.models[0]?.source).toBe("provider_list");
    expect(summary.models[0]?.isDefault).toBe(true);
    expect(providerProfiles).not.toContain("sk-test-secret");
    expect(modelProfiles).not.toContain("sk-test-secret");
    expect(secrets).not.toContain("sk-test-secret-123456789");
    expect(secrets).toContain(Buffer.from("encrypted:sk-test-secret-123456789", "utf8").toString("base64"));
  });

  it("reopens a fresh registry with the persisted explicit protocol and ready global default", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-5-mini"]));
    const connected = await registry.addPresetProvider({ presetId: "openai", apiKey: "reopen-secret" });

    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["gpt-5-mini"])),
      passingProbe
    );
    const summary = reopened.summary();

    expect(summary).toEqual({
      ...connected,
      providers: connected.providers.map(({ runtimeStatus: _runtimeStatus, ...provider }) => provider)
    });
    expect(summary.providers[0]?.endpointProtocol).toBe("openai_responses");
    expect(summary.defaultBinding).toMatchObject({
      state: "ready",
      providerProfileId: summary.providers[0]?.id,
      modelProfileId: summary.defaultModelProfileId
    });
    expect(reopened.getDefaultRuntimeConfig()).toMatchObject({
      provider: { endpointProtocol: "openai_responses" },
      model: { modelId: "gpt-5-mini" },
      apiKey: "reopen-secret"
    });
  });

  it("normalizes a legacy persisted profile protocol without rewriting the legacy file on read", async () => {
    const modelIds = ["gpt-5-mini", "chat-model", "messages-model", "custom-model"];
    const { root, registry } = makeRegistry(okModelListFetch(modelIds));
    await registry.addPresetProvider({ presetId: "openai", apiKey: "legacy-secret" });
    await registry.addManualProvider({
      displayName: "Legacy chat",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://chat.example/v1",
      apiKey: "legacy-chat-secret",
      manualModelId: "chat-model",
      cloudBoundary: "self_hosted"
    });
    await registry.addManualProvider({
      displayName: "Legacy messages",
      providerKind: "anthropic_compatible",
      endpointProtocol: "anthropic_messages",
      baseUrl: "https://messages.example/v1",
      apiKey: "legacy-messages-secret",
      manualModelId: "messages-model",
      cloudBoundary: "self_hosted"
    });
    await registry.addManualProvider({
      displayName: "Legacy custom",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://custom.example/v1",
      apiKey: "legacy-custom-secret",
      manualModelId: "custom-model",
      cloudBoundary: "self_hosted"
    });
    const providersPath = path.join(root, "provider-profiles.json");
    const file = JSON.parse(fs.readFileSync(providersPath, "utf8")) as {
      providers: Array<Record<string, unknown>>;
    };
    for (const provider of file.providers) delete provider.endpointProtocol;
    fs.writeFileSync(providersPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    const legacyBytes = fs.readFileSync(providersPath, "utf8");

    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(modelIds)),
      passingProbe
    );

    const protocolsByKind = Object.fromEntries(
      reopened.summary().providers.map((provider) => [provider.providerKind, provider.endpointProtocol])
    );
    expect(protocolsByKind).toEqual({
      custom: "openai_chat_completions",
      anthropic_compatible: "anthropic_messages",
      openai_compatible: "openai_chat_completions",
      openai: "openai_responses"
    });
    expect(reopened.getDefaultRuntimeConfig()?.provider.endpointProtocol).toBe("openai_responses");
    expect(fs.readFileSync(providersPath, "utf8")).toBe(legacyBytes);
  });

  it("checks the selected runtime binding by secret reference without decrypting credentials", async () => {
    let decryptCalls = 0;
    const crypto: SecretCryptoAdapter = {
      ...fakeCrypto,
      decryptString: (encrypted) => {
        decryptCalls += 1;
        return fakeCrypto.decryptString(encrypted);
      }
    };
    const { root, registry } = makeRegistry(okModelListFetch(["gpt-4.1"]), crypto);

    await registry.addManualProvider({
      displayName: "OpenAI",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      apiKey: "sk-runtime-secret",
      manualModelId: "gpt-4.1",
      cloudBoundary: "cloud"
    });

    expect(registry.hasDefaultRuntimeBinding()).toBe(true);
    expect(decryptCalls).toBe(0);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("sk-runtime-secret");
    expect(decryptCalls).toBe(1);

    fs.writeFileSync(path.join(root, "secrets.json"), '{"schemaVersion":1,"secrets":[]}\n', "utf8");
    expect(registry.hasDefaultRuntimeBinding()).toBe(false);
    expect(decryptCalls).toBe(1);
  });

  it("reports configured-but-unusable state with only safe IDs and a typed redacted repair error", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["private-model"]));
    const connected = await registry.addManualProvider({
      displayName: "Private endpoint label",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://private-host.example/v1",
      apiKey: "must-never-return",
      manualModelId: "private-model",
      cloudBoundary: "self_hosted"
    });
    fs.writeFileSync(path.join(root, "secrets.json"), '{"schemaVersion":1,"secrets":[]}\n', "utf8");

    const summary = registry.summary();

    expect(summary.hasDefaultModel).toBe(false);
    expect(summary.defaultModelProfileId).toBeUndefined();
    expect(summary.defaultBinding).toEqual({
      state: "configured_unusable",
      providerProfileId: connected.providers[0]?.id,
      modelProfileId: connected.defaultModelProfileId,
      error: {
        code: "model_provider.binding_unusable",
        domain: "model_provider",
        messageKey: "errors.model_provider.binding_unusable",
        retryable: false,
        severity: "error",
        userAction: "configure_model"
      }
    });
    const bindingJson = JSON.stringify(summary.defaultBinding);
    expect(bindingJson).not.toContain("private-host");
    expect(bindingJson).not.toContain("must-never-return");
    expect(bindingJson).not.toContain("provider_secret");
  });

  it("falls back to manual model storage when a compatible provider does not expose a model list", async () => {
    const { registry } = makeRegistry(async () => new Response("not found", { status: 404 }));

    const summary = await registry.addManualProvider({
      displayName: "Compatible",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret-compatible",
      manualModelId: "custom-model",
      cloudBoundary: "self_hosted"
    });

    expect(summary.providers[0]?.modelListStrategy).toBe("failed_then_manual");
    expect(summary.providers[0]?.boundaryVerification).toBe("user_asserted");
    expect(summary.models[0]?.modelId).toBe("custom-model");
    expect(summary.models[0]?.source).toBe("manual");
  });

  it("does not persist provider, model, or secret files when connection authentication fails", async () => {
    const { root, registry } = makeRegistry(async () => new Response("unauthorized", { status: 401 }));

    await expect(
      registry.addManualProvider({
        displayName: "OpenAI",
        providerKind: "openai",
        endpointProtocol: "openai_responses",
        apiKey: "bad-secret",
        manualModelId: "gpt-4.1",
        cloudBoundary: "cloud"
      })
    ).rejects.toThrow("The provider rejected the API key.");

    expect(fs.existsSync(path.join(root, "provider-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "model-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false);
  });

  it("returns a fixed provider persistence error without exposing a private local path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-model-registry-private-path-"));
    tempRoots.push(root);
    const crypto: SecretCryptoAdapter = {
      ...fakeCrypto,
      encryptString: () => {
        throw new Error(`EACCES while writing ${path.join(root, "secrets.json")}`);
      }
    };
    const registry = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, crypto),
      new ModelProviderConnectionTester(okModelListFetch(["gpt-5-mini"])),
      passingProbe
    );

    let caught: unknown;
    try {
      await registry.addPresetProvider({ presetId: "openai", apiKey: "opaque-provider-secret" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "model_provider.persistence_failed",
      message: "Provider setup could not be saved to protected local storage."
    });
    expect(String(caught)).not.toContain(root);
    expect(String(caught)).not.toContain("secrets.json");
    expect(fs.existsSync(path.join(root, "provider-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "model-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false);
  });

  it("rejects a custom base URL on a built-in provider before persisting a secret", async () => {
    const { root, registry } = makeRegistry();

    await expect(registry.addManualProvider({
      displayName: "Disguised official provider",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "must-not-persist",
      manualModelId: "local-model",
      cloudBoundary: "local"
    })).rejects.toThrow("choose a compatible provider");

    expect(fs.existsSync(path.join(root, "provider-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "model-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "secrets.json"))).toBe(false);
  });

  it("does not treat an unverified remote compatible endpoint as local", async () => {
    const { registry } = makeRegistry(okModelListFetch(["remote-model"]));

    const summary = await registry.addManualProvider({
      displayName: "Remote compatible",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret-remote",
      manualModelId: "remote-model",
      cloudBoundary: "local"
    });

    expect(summary.providers[0]?.cloudBoundary).toBe("unknown");
    expect(summary.providers[0]?.boundaryVerification).toBe("unknown");
  });

  it("classifies a canonical loopback compatible endpoint as verified local", async () => {
    const { registry } = makeRegistry(okModelListFetch(["local-model"]));

    const summary = await registry.addManualProvider({
      displayName: "Local compatible",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "local-placeholder",
      manualModelId: "local-model",
      cloudBoundary: "unknown"
    });

    expect(summary.providers[0]?.cloudBoundary).toBe("local");
    expect(summary.providers[0]?.boundaryVerification).toBe("loopback_verified");
  });

  it("canonicalizes a safe provider base URL before persistence", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["local-model"]));

    const summary = await registry.addManualProvider({
      displayName: "IPv6 local compatible",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: " HTTP://[::1]:11434/v1/// ",
      apiKey: "local-placeholder",
      manualModelId: "local-model",
      cloudBoundary: "unknown"
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")) as {
      providers: Array<{ baseUrl?: string }>;
    };

    expect(summary.providers[0]?.baseUrl).toBe("http://[::1]:11434/v1");
    expect(persisted.providers[0]?.baseUrl).toBe("http://[::1]:11434/v1");
    expect(summary.providers[0]?.cloudBoundary).toBe("local");
    expect(summary.providers[0]?.boundaryVerification).toBe("loopback_verified");
  });

  it("refreshes one provider inventory, deduplicates custom models, and preserves one global default", async () => {
    let modelIds = ["model-a", "model-b"];
    const { registry } = makeRegistry(
      async () => okModelListFetch(modelIds)("https://example.invalid")
    );
    const connected = await registry.addManualProvider({
      displayName: "Inventory Provider",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://inventory.example/v1",
      apiKey: "inventory-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    const providerId = connected.providers[0]?.id ?? "";
    const originalA = connected.models.find((model) => model.modelId === "model-a");
    const originalB = connected.models.find((model) => model.modelId === "model-b");
    expect(originalA?.enabled).toBe(true);
    expect(originalB?.enabled).toBe(false);
    await registry.updateModel({ modelProfileId: originalB?.id ?? "", enabled: true });

    const deduplicated = await registry.addManualModel({
      providerProfileId: providerId,
      modelId: "model-a",
      displayName: "Preferred A"
    });
    await registry.addManualModel({ providerProfileId: providerId, modelId: "manual-c" });
    expect(deduplicated.models.filter((model) => model.modelId === "model-a")).toHaveLength(1);
    expect(deduplicated.models.find((model) => model.modelId === "model-a")).toMatchObject({
      id: originalA?.id,
      displayName: "Preferred A"
    });

    modelIds = ["model-a", "model-d"];
    const refreshed = await registry.refreshProviderModels({ providerProfileId: providerId });
    expect(refreshed.models.find((model) => model.modelId === "model-a")).toMatchObject({
      id: originalA?.id,
      displayName: "Preferred A",
      enabled: true,
      isDefault: true
    });
    expect(refreshed.models.find((model) => model.modelId === "model-b")?.enabled).toBe(true);
    expect(refreshed.models.find((model) => model.modelId === "manual-c")?.enabled).toBe(true);
    const modelD = refreshed.models.find((model) => model.modelId === "model-d");
    expect(modelD).toMatchObject({ source: "provider_list", enabled: false });

    const enabled = await registry.updateModel({ modelProfileId: modelD?.id ?? "", enabled: true });
    expect(enabled.models.find((model) => model.id === modelD?.id)?.enabled).toBe(true);
    expect(enabled.defaultModelProfileId).toBe(originalA?.id);
    const renamed = await registry.updateModel({
      modelProfileId: modelD?.id ?? "",
      displayName: "Daily model"
    });
    expect(renamed.models.find((model) => model.id === modelD?.id)?.displayName).toBe("Daily model");
    const cleared = await registry.updateModel({ modelProfileId: modelD?.id ?? "", displayName: null });
    expect(cleared.models.find((model) => model.id === modelD?.id)?.displayName).toBeUndefined();
  });

  it("recovers a persisted Refresh transaction after a crash-window rollback failure", async () => {
    let modelIds = ["model-a"];
    const { root, registry } = makeRegistry(async () => okModelListFetch(modelIds)("https://example.invalid"));
    const connected = await registry.addManualProvider({
      displayName: "Refresh recovery",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://refresh-recovery.example/v1",
      apiKey: "refresh-recovery-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Refresh recovery Provider did not connect.");
    const providerId = connected.providers[0]?.id ?? "";
    const providersPath = path.join(root, "provider-profiles.json");
    const modelsPath = path.join(root, "model-profiles.json");
    const beforeProviders = fs.readFileSync(providersPath, "utf8");
    const beforeModels = fs.readFileSync(modelsPath, "utf8");
    modelIds = ["model-a", "model-b"];
    const originalRename = fs.renameSync;
    let providerRenames = 0;
    let failedModelCommit = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === providersPath) {
        providerRenames += 1;
        if (providerRenames === 2) throw new Error("injected Refresh rollback failure");
      }
      if (String(to) === modelsPath && !failedModelCommit) {
        failedModelCommit = true;
        throw new Error("injected Refresh model commit failure");
      }
      return originalRename(from, to);
    });

    await expect(registry.refreshProviderModels({ providerProfileId: providerId }))
      .rejects.toMatchObject({ code: "model_provider.persistence_repair_required" });
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(true);
    vi.restoreAllMocks();

    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(modelIds)),
      passingProbe
    );
    expect(fs.readFileSync(providersPath, "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    expect(reopened.summary().models.map((model) => model.modelId)).toEqual(["model-a"]);
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(false);
  });

  it("preserves the last known Provider inventory when Refresh fails", async () => {
    let failRefresh = false;
    const { registry } = makeRegistry(async () => failRefresh
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify({ data: [{ id: "stable-model" }, { id: "disabled-model" }] }), { status: 200 }));
    const connected = await registry.addManualProvider({
      displayName: "Stable inventory",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://stable.example/v1",
      apiKey: "stable-secret",
      manualModelId: "stable-model",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Stable Provider did not connect.");
    const before = registry.summary();
    failRefresh = true;

    await expect(registry.refreshProviderModels({
      providerProfileId: connected.providers[0]?.id ?? ""
    })).rejects.toMatchObject({ code: "model_provider.connection_failed" });
    expect(registry.summary()).toEqual(before);
  });

  it("changes the default model by profile ID", async () => {
    const probe = new RecordingProbe();
    const { registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]), fakeCrypto, probe);
    const first = await registry.addManualProvider({
      displayName: "Provider A",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      apiKey: "secret-a",
      manualModelId: "model-a",
      cloudBoundary: "cloud"
    });
    const second = await registry.addManualProvider({
      displayName: "Provider B",
      providerKind: "openai_compatible",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://example.com/v1",
      apiKey: "secret-b",
      manualModelId: "model-b",
      cloudBoundary: "self_hosted"
    });

    const nextDefault = second.models.find((model) => model.modelId === "model-b");
    expect(nextDefault).toBeDefined();
    const updated = await registry.setDefaultModel({ modelProfileId: nextDefault?.id ?? "" });

    expect(first.defaultModelProfileId).not.toBe(updated.defaultModelProfileId);
    expect(updated.models.find((model) => model.modelId === "model-b")?.isDefault).toBe(true);
    expect(probe.configs).toHaveLength(2);
  });

  it("changes the global default without probing every discovered model", async () => {
    const probe = new RecordingProbe();
    const { registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]), fakeCrypto, probe);
    const first = await registry.addManualProvider({
      displayName: "Provider A",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      apiKey: "secret-a",
      manualModelId: "model-a",
      cloudBoundary: "cloud"
    });
    const second = await registry.addManualProvider({
      displayName: "Provider B",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://example.com/v1",
      apiKey: "secret-b",
      manualModelId: "model-b",
      cloudBoundary: "self_hosted"
    });
    const nextDefault = second.models.find((model) => model.modelId === "model-b");
    probe.failNext = true;

    const updated = await registry.setDefaultModel({ modelProfileId: nextDefault?.id ?? "" });

    expect(updated.defaultModelProfileId).toBe(nextDefault?.id);
    expect(updated.defaultModelProfileId).not.toBe(first.defaultModelProfileId);
    expect(probe.configs).toHaveLength(2);
  });

  it("replaces one existing credential only after a successful generation probe", async () => {
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]), fakeCrypto, probe);
    const connected = await registry.addManualProvider({
      displayName: "Credential update",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://credential.example/v1",
      apiKey: "old-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Credential update Provider did not connect.");
    const providerId = connected.providers[0]?.id ?? "";
    const secretRefs = registrySecretRefs(root);

    const updated = await registry.updateProviderCredential({
      providerProfileId: providerId,
      expectedRevision: registry.summary().revision ?? "",
      apiKey: "new-secret"
    });

    expect(updated.providers.map(({ runtimeStatus: _runtimeStatus, ...provider }) => provider))
      .toEqual(connected.providers.map(({ runtimeStatus: _runtimeStatus, ...provider }) => provider));
    expect(updated.providers[0]?.runtimeStatus?.generation).toBe("verified");
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("new-secret");
    expect(registrySecretRefs(root)).toEqual(secretRefs);
    expect(probe.configs.at(-1)).toMatchObject({ apiKey: "new-secret" });
    expect(JSON.stringify(updated)).not.toContain("old-secret");
    expect(JSON.stringify(updated)).not.toContain("new-secret");
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).not.toContain("new-secret");
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).not.toContain("new-secret");
  });

  it("keeps the prior credential when replacement validation or persistence fails", async () => {
    const probe = new RecordingProbe();
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]), fakeCrypto, probe);
    const connected = await registry.addManualProvider({
      displayName: "Stable credential",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://stable-credential.example/v1",
      apiKey: "stable-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Stable credential Provider did not connect.");
    const providerProfileId = connected.providers[0]?.id ?? "";

    probe.failNext = true;
    await expect(registry.updateProviderCredential({
      providerProfileId,
      expectedRevision: registry.summary().revision ?? "",
      apiKey: "rejected-secret"
    }))
      .rejects.toThrow("synthetic probe failure");
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("stable-secret");

    const secretsPath = path.join(root, "secrets.json");
    const originalRename = fs.renameSync;
    let failedWrite = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === secretsPath && !failedWrite) {
        failedWrite = true;
        throw new Error("injected secret replacement failure");
      }
      return originalRename(from, to);
    });
    await expect(registry.updateProviderCredential({
      providerProfileId,
      expectedRevision: registry.summary().revision ?? "",
      apiKey: "unsaved-secret"
    }))
      .rejects.toMatchObject({ code: "secret_update_failed" });
    vi.restoreAllMocks();
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("stable-secret");
    expect(registrySecretRefs(root)).toHaveLength(1);
  });

  it("rejects stale credential and delete mutations before probing or persistence", async () => {
    const probe = new RecordingProbe();
    const { registry } = makeRegistry(okModelListFetch(["model-a"]), fakeCrypto, probe);
    const connected = await registry.addManualProvider({
      displayName: "Revision fenced",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://revision.example/v1",
      apiKey: "stable-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Revision fixture did not connect.");
    const providerProfileId = connected.providers[0]?.id ?? "";
    const probeCount = probe.configs.length;
    const staleRevision = `sha256:${"0".repeat(64)}`;

    await expect(registry.updateProviderCredential({
      providerProfileId,
      expectedRevision: staleRevision,
      apiKey: "must-not-probe"
    })).rejects.toMatchObject({ code: "model_provider.profile_stale" });
    await expect(registry.deleteProvider({ providerProfileId, expectedRevision: staleRevision }))
      .rejects.toMatchObject({ code: "model_provider.profile_stale" });

    expect(probe.configs).toHaveLength(probeCount);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("stable-secret");
    expect(registry.summary().providers).toHaveLength(1);
  });

  it("blocks credential replacement while an active owner references the Provider", async () => {
    const activeReferences: ModelProviderActiveReferencePort = {
      assertProviderInactive: () => {
        throw Object.assign(new Error("active reference"), { code: "model_provider.active_reference" });
      }
    };
    const probe = new RecordingProbe();
    const { registry } = makeRegistry(
      okModelListFetch(["model-a"]),
      fakeCrypto,
      probe,
      activeReferences
    );
    const connected = await registry.addManualProvider({
      displayName: "Active credential",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://active-credential.example/v1",
      apiKey: "stable-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Active credential fixture did not connect.");
    const probeCount = probe.configs.length;

    await expect(registry.updateProviderCredential({
      providerProfileId: connected.providers[0]?.id ?? "",
      expectedRevision: registry.summary().revision ?? "",
      apiKey: "must-not-probe"
    })).rejects.toMatchObject({ code: "model_provider.active_reference" });
    expect(probe.configs).toHaveLength(probeCount);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("stable-secret");
  });

  it("projects discovery and generation truth without persisting transient runtime state", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]));
    const connected = await registry.addManualProvider({
      displayName: "Runtime truth",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://runtime-truth.example/v1",
      apiKey: "runtime-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Runtime truth fixture did not connect.");
    const providerProfileId = connected.providers[0]?.id ?? "";
    expect(connected.providers[0]?.runtimeStatus).toMatchObject({ generation: "verified" });

    registry.recordGenerationOutcome(providerProfileId, "failed");
    expect(registry.summary().providers[0]?.runtimeStatus).toMatchObject({ generation: "failed" });
    await registry.refreshProviderModels({ providerProfileId });
    expect(registry.summary().providers[0]?.runtimeStatus).toMatchObject({
      discovery: "verified",
      generation: "failed"
    });

    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["model-a"])),
      passingProbe
    );
    expect(reopened.summary().providers[0]?.runtimeStatus).toBeUndefined();
  });

  it("deletes owned profiles and secret while deterministically rebinding the default", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]));
    const first = await registry.addManualProvider({
      displayName: "Provider A",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://provider-a.example/v1",
      apiKey: "secret-a",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    const second = await registry.addManualProvider({
      displayName: "Provider B",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://provider-b.example/v1",
      apiKey: "secret-b",
      manualModelId: "model-b",
      cloudBoundary: "unknown"
    });
    if ("status" in first || "status" in second) throw new Error("Delete fixtures did not connect.");
    const firstProviderId = first.providers.find((provider) => provider.displayName === "Provider A")?.id ?? "";
    const secondModel = second.models.find((model) => model.modelId === "model-b");

    const deleted = await registry.deleteProvider({
      providerProfileId: firstProviderId,
      expectedRevision: registry.summary().revision ?? ""
    });

    expect(deleted.providers.map((provider) => provider.displayName)).toEqual(["Provider B"]);
    expect(deleted.models).not.toEqual([]);
    expect(deleted.models.every((model) => model.providerProfileId === deleted.providers[0]?.id)).toBe(true);
    expect(deleted.defaultModelProfileId).toBe(secondModel?.id);
    expect(deleted.defaultBinding.state).toBe("ready");
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("secret-b");
    expect(registrySecretRefs(root)).toHaveLength(1);
  });

  it("clears the default and leaves no orphan after deleting the final Provider", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]));
    const connected = await registry.addManualProvider({
      displayName: "Only Provider",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://only.example/v1",
      apiKey: "only-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Only Provider did not connect.");

    const deleted = await registry.deleteProvider({
      providerProfileId: connected.providers[0]?.id ?? "",
      expectedRevision: registry.summary().revision ?? ""
    });

    expect(deleted).toMatchObject({ providers: [], models: [], hasDefaultModel: false });
    expect(deleted.defaultBinding).toEqual({ state: "not_configured" });
    expect(registrySecretRefs(root)).toEqual([]);
  });

  it("blocks deletion while an active owner references the Provider", async () => {
    const activeReferences: ModelProviderActiveReferencePort = {
      assertProviderInactive: () => {
        throw Object.assign(new Error("active reference"), { code: "model_provider.active_reference" });
      }
    };
    const { root, registry } = makeRegistry(
      okModelListFetch(["model-a"]),
      fakeCrypto,
      passingProbe,
      activeReferences
    );
    const connected = await registry.addManualProvider({
      displayName: "Active Provider",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://active.example/v1",
      apiKey: "active-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Active Provider did not connect.");

    await expect(registry.deleteProvider({
      providerProfileId: connected.providers[0]?.id ?? "",
      expectedRevision: registry.summary().revision ?? ""
    }))
      .rejects.toMatchObject({ code: "model_provider.active_reference" });
    expect(registry.summary().providers).toHaveLength(1);
    expect(registrySecretRefs(root)).toHaveLength(1);
  });

  it("finishes committed secret cleanup after restart without restoring deleted profiles", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]));
    const connected = await registry.addManualProvider({
      displayName: "Crash cleanup",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://cleanup.example/v1",
      apiKey: "cleanup-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Crash cleanup Provider did not connect.");
    const secretsPath = path.join(root, "secrets.json");
    const originalRename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === secretsPath) throw new Error("injected cleanup interruption");
      return originalRename(from, to);
    });

    await expect(registry.deleteProvider({
      providerProfileId: connected.providers[0]?.id ?? "",
      expectedRevision: registry.summary().revision ?? ""
    }))
      .rejects.toMatchObject({ code: "model_provider.persistence_repair_required" });
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(true);
    expect(registry.summary().providers).toEqual([]);
    vi.restoreAllMocks();

    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["model-a"])),
      passingProbe
    );
    expect(reopened.summary()).toMatchObject({ providers: [], models: [], hasDefaultModel: false });
    expect(registrySecretRefs(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(false);
  });

  it("restores Provider, models, default, and secret when deletion fails before commit", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a"]));
    const connected = await registry.addManualProvider({
      displayName: "Rollback delete",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://rollback-delete.example/v1",
      apiKey: "rollback-secret",
      manualModelId: "model-a",
      cloudBoundary: "unknown"
    });
    if ("status" in connected) throw new Error("Rollback delete Provider did not connect.");
    const providersPath = path.join(root, "provider-profiles.json");
    const modelsPath = path.join(root, "model-profiles.json");
    const beforeProviders = fs.readFileSync(providersPath, "utf8");
    const beforeModels = fs.readFileSync(modelsPath, "utf8");
    const originalRename = fs.renameSync;
    let failedModelCommit = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === modelsPath && !failedModelCommit) {
        failedModelCommit = true;
        throw new Error("injected delete model commit failure");
      }
      return originalRename(from, to);
    });

    await expect(registry.deleteProvider({
      providerProfileId: connected.providers[0]?.id ?? "",
      expectedRevision: registry.summary().revision ?? ""
    }))
      .rejects.toMatchObject({ code: "model_provider.persistence_failed" });
    expect(fs.readFileSync(providersPath, "utf8")).toBe(beforeProviders);
    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("rollback-secret");
    expect(registrySecretRefs(root)).toHaveLength(1);
    expect(fs.existsSync(path.join(root, "provider-connect-transaction.json"))).toBe(false);
  });

  it("restores and reopens the prior global default when the default-model write fails", async () => {
    const { root, registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]));
    const first = await registry.addManualProvider({
      displayName: "Provider A",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      apiKey: "secret-a",
      manualModelId: "model-a",
      cloudBoundary: "cloud"
    });
    const second = await registry.addManualProvider({
      displayName: "Provider B",
      providerKind: "custom",
      endpointProtocol: "openai_chat_completions",
      baseUrl: "https://example.com/v1",
      apiKey: "secret-b",
      manualModelId: "model-b",
      cloudBoundary: "self_hosted"
    });
    const nextDefault = second.models.find((model) => model.modelId === "model-b");
    const modelsPath = path.join(root, "model-profiles.json");
    const beforeModels = fs.readFileSync(modelsPath, "utf8");
    const originalRename = fs.renameSync;
    let failedCommit = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === modelsPath && !failedCommit) {
        failedCommit = true;
        throw new Error("injected default write failure");
      }
      return originalRename(from, to);
    });

    await expect(registry.setDefaultModel({ modelProfileId: nextDefault?.id ?? "" }))
      .rejects.toMatchObject({ code: "model_provider.persistence_failed" });

    expect(fs.readFileSync(modelsPath, "utf8")).toBe(beforeModels);
    vi.restoreAllMocks();
    const reopened = new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, fakeCrypto),
      new ModelProviderConnectionTester(okModelListFetch(["model-a", "model-b"])),
      passingProbe
    );
    expect(reopened.summary().defaultModelProfileId).toBe(first.defaultModelProfileId);
    expect(reopened.summary().defaultBinding.state).toBe("ready");
  });
});

function okModelListFetch(modelIds: readonly string[]): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        data: modelIds.map((id) => ({ id }))
      }),
      { status: 200 }
    );
}

function registrySecretRefs(root: string): string[] {
  const file = JSON.parse(fs.readFileSync(path.join(root, "secrets.json"), "utf8")) as {
    secrets: Array<{ ref: string }>;
  };
  return file.secrets.map((secret) => secret.ref);
}

class RecordingProbe implements ModelProviderGenerationProbePort {
  readonly configs: ModelProviderRuntimeConfig[] = [];
  failNext = false;
  readonly #onProbe?: (config: ModelProviderRuntimeConfig) => void;

  constructor(onProbe?: (config: ModelProviderRuntimeConfig) => void) {
    this.#onProbe = onProbe;
  }

  async probe(config: ModelProviderRuntimeConfig): Promise<void> {
    this.configs.push(config);
    this.#onProbe?.(config);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("synthetic probe failure");
    }
  }
}
