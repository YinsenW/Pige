import { describe, expect, it } from "vitest";
import { ModelProviderConnectionTester, type FetchLike } from "../../apps/desktop/src/main/services/model-provider-connection";

describe("model provider connection tester", () => {
  it("uses OpenAI-compatible model list requests", async () => {
    const seen: { url?: string; auth?: string } = {};
    const tester = new ModelProviderConnectionTester(async (url, init) => {
      seen.url = String(url);
      seen.auth = new Headers(init?.headers).get("authorization") ?? undefined;
      return jsonResponse({ data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }] });
    });

    const result = await tester.testManualProvider({
      providerKind: "openai",
      apiKey: "sk-test",
      manualModelId: "gpt-4.1",
      cloudBoundary: "cloud"
    });

    expect(seen.url).toBe("https://api.openai.com/v1/models");
    expect(seen.auth).toBe("Bearer sk-test");
    expect(result.modelListStrategy).toBe("list_models");
    expect(result.discoveredModels.map((model) => model.modelId)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
  });

  it("uses Anthropic-compatible model list headers", async () => {
    const seen: { url?: string; apiKey?: string; version?: string } = {};
    const tester = new ModelProviderConnectionTester(async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.url = String(url);
      seen.apiKey = headers.get("x-api-key") ?? undefined;
      seen.version = headers.get("anthropic-version") ?? undefined;
      return jsonResponse({ data: [{ id: "claude-sonnet-test", display_name: "Claude Sonnet Test" }] });
    });

    const result = await tester.testManualProvider({
      providerKind: "anthropic",
      apiKey: "sk-ant-test",
      manualModelId: "claude-sonnet-test",
      cloudBoundary: "cloud"
    });

    expect(seen.url).toBe("https://api.anthropic.com/v1/models");
    expect(seen.apiKey).toBe("sk-ant-test");
    expect(seen.version).toBe("2023-06-01");
    expect(result.discoveredModels[0]?.displayName).toBe("Claude Sonnet Test");
  });

  it("allows manual model IDs when a compatible endpoint has no model-list route", async () => {
    const tester = new ModelProviderConnectionTester(async () => new Response("not found", { status: 404 }));

    const result = await tester.testManualProvider({
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1/",
      apiKey: "test-key",
      manualModelId: "private-model",
      cloudBoundary: "self_hosted"
    });

    expect(result.modelListStrategy).toBe("failed_then_manual");
    expect(result.discoveredModels).toEqual([]);
    expect(result.selectedModelId).toBe("private-model");
  });

  it("does not hide official-provider model-list failures behind manual IDs", async () => {
    const tester = new ModelProviderConnectionTester(async () => new Response("not found", { status: 404 }));

    await expect(
      tester.testManualProvider({
        providerKind: "openai",
        apiKey: "test-key",
        manualModelId: "unverified-model",
        cloudBoundary: "cloud"
      })
    ).rejects.toThrow("The provider connection test failed.");
  });

  it("requires a compatible provider kind for custom base URLs", async () => {
    const tester = new ModelProviderConnectionTester(async () => jsonResponse({ data: [{ id: "model" }] }));

    await expect(tester.testManualProvider({
      providerKind: "openai",
      baseUrl: "https://proxy.example.com/v1",
      apiKey: "test-key",
      manualModelId: "model",
      cloudBoundary: "cloud"
    })).rejects.toThrow("choose a compatible provider");
  });

  it("rejects missing selected models when the provider returns a list", async () => {
    const tester = new ModelProviderConnectionTester(async () => jsonResponse({ data: [{ id: "available-model" }] }));

    await expect(
      tester.testManualProvider({
        providerKind: "openai",
        apiKey: "test-key",
        manualModelId: "missing-model",
        cloudBoundary: "cloud"
      })
    ).rejects.toThrow("The selected model was not returned by this provider.");
  });

  it("rejects non-local HTTP endpoints", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ data: [{ id: "model" }] });
    const tester = new ModelProviderConnectionTester(fetchImpl);

    await expect(
      tester.testManualProvider({
        providerKind: "openai_compatible",
        baseUrl: "http://models.example.com/v1",
        apiKey: "test-key",
        manualModelId: "model",
        cloudBoundary: "self_hosted"
      })
    ).rejects.toThrow("Provider base URL must use HTTPS unless it is local loopback HTTP.");
  });

  it("rejects provider base URLs that can smuggle credentials or sensitive query data", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ data: [{ id: "model" }] });
    const tester = new ModelProviderConnectionTester(fetchImpl);

    for (const baseUrl of [
      "https://token@models.example.com/v1",
      "https://models.example.com/v1?api_key=secret",
      "https://models.example.com/v1#credential"
    ]) {
      await expect(
        tester.testManualProvider({
          providerKind: "openai_compatible",
          baseUrl,
          apiKey: "test-key",
          manualModelId: "model",
          cloudBoundary: "unknown"
        })
      ).rejects.toThrow("Provider base URL cannot contain credentials, query parameters, or fragments.");
    }
  });

  it("normalizes IPv6 loopback URLs with the same rule used by persisted profiles", async () => {
    let seenUrl: string | undefined;
    const tester = new ModelProviderConnectionTester(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ data: [{ id: "local-model" }] });
    });

    await tester.testManualProvider({
      providerKind: "openai_compatible",
      baseUrl: " HTTP://[::1]:11434/v1/// ",
      apiKey: "local-placeholder",
      manualModelId: "local-model",
      cloudBoundary: "unknown"
    });

    expect(seenUrl).toBe("http://[::1]:11434/v1/models");
  });

  it("fails closed on oversized or unbounded model-list responses", async () => {
    const request = {
      providerKind: "openai" as const,
      apiKey: "test-key",
      manualModelId: "gpt-5-mini",
      cloudBoundary: "cloud" as const
    };
    const declared = new ModelProviderConnectionTester(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) }
    }));
    const streamed = new ModelProviderConnectionTester(async () => new Response("x".repeat(1024 * 1024 + 1), {
      status: 200
    }));

    await expect(declared.testManualProvider(request)).rejects.toThrow("exceeded the response limit");
    await expect(streamed.testManualProvider(request)).rejects.toThrow("exceeded the response limit");
  });

  it("bounds discovered model counts and model metadata", async () => {
    const request = {
      providerKind: "openai" as const,
      apiKey: "test-key",
      manualModelId: "gpt-5-mini",
      cloudBoundary: "cloud" as const
    };
    const tooMany = new ModelProviderConnectionTester(async () => jsonResponse({
      data: Array.from({ length: 501 }, (_, index) => ({ id: `model-${index}` }))
    }));
    const oversizedId = new ModelProviderConnectionTester(async () => jsonResponse({
      data: [{ id: "m".repeat(201) }]
    }));

    await expect(tooMany.testManualProvider(request)).rejects.toThrow("too many models");
    await expect(oversizedId.testManualProvider(request)).rejects.toThrow("invalid model identifier");
  });

  it("applies a bounded read deadline after response headers arrive", async () => {
    const tester = new ModelProviderConnectionTester(async () => new Response(new ReadableStream({
      start() {
        // Intentionally leave the body open to prove the read deadline.
      }
    }), { status: 200 }), 5);

    await expect(tester.testManualProvider({
      providerKind: "openai",
      apiKey: "test-key",
      manualModelId: "gpt-5-mini",
      cloudBoundary: "cloud"
    })).rejects.toThrow("timed out while reading");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
