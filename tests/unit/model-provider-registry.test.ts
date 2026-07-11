import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelProviderConnectionTester, type FetchLike } from "../../apps/desktop/src/main/services/model-provider-connection";
import { ModelProviderRegistry } from "../../apps/desktop/src/main/services/model-provider-registry";
import { JsonSecretStore, type SecretCryptoAdapter } from "../../apps/desktop/src/main/services/secret-store";

const tempRoots: string[] = [];

const fakeCrypto: SecretCryptoAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/u, "")
};

function makeRegistry(
  fetchImpl: FetchLike = okModelListFetch(["gpt-4.1"]),
  crypto: SecretCryptoAdapter = fakeCrypto
): { root: string; registry: ModelProviderRegistry } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-model-registry-test-"));
  tempRoots.push(root);
  return {
    root,
    registry: new ModelProviderRegistry(
      root,
      new JsonSecretStore(root, crypto),
      new ModelProviderConnectionTester(fetchImpl)
    )
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("model provider registry", () => {
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

    expect(summary.presets).toEqual([
      expect.objectContaining({
        presetId: "openai",
        providerKind: "openai",
        endpointProtocol: "openai_responses",
        fixedBaseUrl: "https://api.openai.com/v1",
        modelListStrategy: "list_models",
        cloudBoundary: "cloud"
      })
    ]);
    expect(summary.providers).toHaveLength(1);
    expect(summary.providers[0]).toMatchObject({ presetId: "openai", providerKind: "openai" });
    expect(summary.models.map((model) => model.modelId)).toEqual(["gpt-5-mini", "gpt-4.1"]);
    expect(summary.models.find((model) => model.isDefault)?.modelId).toBe("gpt-5-mini");
    expect(summary.hasDefaultModel).toBe(true);
    expect(registry.hasDefaultRuntimeBinding()).toBe(true);
    expect(registry.getDefaultRuntimeConfig()?.apiKey).toBe("sk-reviewed-preset-secret");
    expect(fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8")).not.toContain("sk-reviewed");
    expect(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).not.toContain("sk-reviewed");
  });

  it("preserves the known-good preset binding when reconnect discovery fails", async () => {
    let modelIds = ["gpt-5-mini"];
    const { root, registry } = makeRegistry(async () => okModelListFetch(modelIds)("https://example.invalid"));
    const first = await registry.addPresetProvider({ presetId: "openai", apiKey: "first-secret" });
    const beforeProviders = fs.readFileSync(path.join(root, "provider-profiles.json"), "utf8");
    const beforeModels = fs.readFileSync(path.join(root, "model-profiles.json"), "utf8");
    const beforeSecretRefs = registrySecretRefs(root);
    modelIds = ["gpt-4o-mini"];

    await expect(registry.addPresetProvider({ presetId: "openai", apiKey: "second-secret" }))
      .rejects.toThrow("reviewed default model is unavailable");

    expect(registry.summary()).toEqual(first);
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

  it("stores provider metadata and discovered model profiles without writing raw API keys to profile files", async () => {
    const { root, registry } = makeRegistry();

    const summary = await registry.addManualProvider({
      displayName: "OpenAI",
      providerKind: "openai",
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

  it("falls back to manual model storage when a compatible provider does not expose a model list", async () => {
    const { registry } = makeRegistry(async () => new Response("not found", { status: 404 }));

    const summary = await registry.addManualProvider({
      displayName: "Compatible",
      providerKind: "openai_compatible",
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
      new ModelProviderConnectionTester(okModelListFetch(["gpt-5-mini"]))
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

  it("changes the default model by profile ID", async () => {
    const { registry } = makeRegistry(okModelListFetch(["model-a", "model-b"]));
    const first = await registry.addManualProvider({
      displayName: "Provider A",
      providerKind: "openai",
      apiKey: "secret-a",
      manualModelId: "model-a",
      cloudBoundary: "cloud"
    });
    const second = await registry.addManualProvider({
      displayName: "Provider B",
      providerKind: "openai_compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "secret-b",
      manualModelId: "model-b",
      cloudBoundary: "self_hosted"
    });

    const nextDefault = second.models.find((model) => model.modelId === "model-b");
    expect(nextDefault).toBeDefined();
    const updated = registry.setDefaultModel({ modelProfileId: nextDefault?.id ?? "" });

    expect(first.defaultModelProfileId).not.toBe(updated.defaultModelProfileId);
    expect(updated.models.find((model) => model.modelId === "model-b")?.isDefault).toBe(true);
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
