import { describe, expect, it } from "vitest";
import { ProviderModelJsonClient } from "../../apps/desktop/src/main/services/model-json-client";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";

describe("provider model JSON client", () => {
  it("calls OpenAI-compatible chat completions with JSON response mode", async () => {
    const seen: { url?: string; auth?: string; body?: unknown } = {};
    const client = new ProviderModelJsonClient(async (url, init) => {
      seen.url = String(url);
      seen.auth = new Headers(init?.headers).get("authorization") ?? undefined;
      seen.body = JSON.parse(String(init?.body));
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ title: "Note" })
            }
          }
        ]
      });
    });

    const result = await client.generateJson(makeConfig("openai"), {
      system: "system prompt",
      user: "user prompt",
      maxTokens: 500
    });

    expect(seen.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen.auth).toBe("Bearer sk-runtime-secret");
    expect(seen.body).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      store: false
    });
    expect(result.text).toBe('{"title":"Note"}');
  });

  it("calls Anthropic-compatible messages with version and API-key headers", async () => {
    const seen: { url?: string; apiKey?: string; version?: string; body?: unknown } = {};
    const client = new ProviderModelJsonClient(async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.url = String(url);
      seen.apiKey = headers.get("x-api-key") ?? undefined;
      seen.version = headers.get("anthropic-version") ?? undefined;
      seen.body = JSON.parse(String(init?.body));
      return jsonResponse({
        content: [{ type: "text", text: JSON.stringify({ title: "Anthropic note" }) }]
      });
    });

    const result = await client.generateJson(makeConfig("anthropic"), {
      system: "system prompt",
      user: "user prompt",
      maxTokens: 500
    });

    expect(seen.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen.apiKey).toBe("sk-runtime-secret");
    expect(seen.version).toBe("2023-06-01");
    expect(seen.body).toMatchObject({
      model: "test-model",
      system: "system prompt"
    });
    expect(result.text).toBe('{"title":"Anthropic note"}');
  });

  it("maps provider authentication failures to redacted domain errors", async () => {
    const client = new ProviderModelJsonClient(async () => new Response("unauthorized", { status: 401 }));

    await expect(
      client.generateJson(makeConfig("openai"), {
        system: "system",
        user: "user",
        maxTokens: 10
      })
    ).rejects.toThrow("The provider rejected the API key.");
  });

  it("uses the persisted-profile URL contract for IPv6 loopback model calls", async () => {
    let seenUrl: string | undefined;
    const client = new ProviderModelJsonClient(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ choices: [{ message: { content: "{}" } }] });
    });

    await client.generateJson(makeConfig("openai_compatible", " HTTP://[::1]:11434/v1/// "), {
      system: "system",
      user: "user",
      maxTokens: 10
    });

    expect(seenUrl).toBe("http://[::1]:11434/v1/chat/completions");
  });

  it("rejects unsafe persisted provider URLs before sending credentials", async () => {
    let calls = 0;
    const client = new ProviderModelJsonClient(async () => {
      calls += 1;
      return jsonResponse({ choices: [{ message: { content: "{}" } }] });
    });

    for (const baseUrl of [
      "http://models.example.com/v1",
      "https://token@models.example.com/v1",
      "https://models.example.com/v1?api_key=secret",
      "https://models.example.com/v1#secret"
    ]) {
      await expect(client.generateJson(makeConfig("openai_compatible", baseUrl), {
        system: "system",
        user: "user",
        maxTokens: 10
      })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});

function makeConfig(
  providerKind: "openai" | "anthropic" | "openai_compatible",
  baseUrl?: string
): ModelProviderRuntimeConfig {
  return {
    provider: {
      id: "provider_test",
      displayName: "Test Provider",
      providerKind,
      ...(baseUrl ? { baseUrl } : {}),
      authSecretRef: "provider_secret_test",
      modelListStrategy: "manual",
      cloudBoundary: "cloud",
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z"
    },
    model: {
      id: "model_test",
      providerProfileId: "provider_test",
      modelId: "test-model",
      source: "manual",
      enabled: true,
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z"
    },
    apiKey: "sk-runtime-secret"
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
