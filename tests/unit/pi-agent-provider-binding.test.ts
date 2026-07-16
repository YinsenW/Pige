import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  PiAgentRuntimeAdapter,
  type PigeAgentToolDefinition
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { createModelRuntimeBindingIdentity } from "../../apps/desktop/src/main/services/model-runtime-binding";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Pi AI provider binding", () => {
  it("dispatches OpenAI Chat Completions by explicit protocol rather than compatible kind", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondOpenAi);
    const config = makeConfig(
      "openai_chat_completions",
      "anthropic_compatible",
      `${baseUrl}/v1`,
      "openai-selected"
    );

    const result = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: config,
      jobId: "job_20260711_piopenai",
      systemPrompt: "Return a bounded acknowledgement.",
      userPrompt: "Acknowledge this synthetic local request.",
      tools: []
    });

    expect(result.modelId).toBe("openai-selected");
    expect(result.assistantText).toBe("openai binding ok");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/v1/chat/completions", authorization: "Bearer scoped-test-key" });
    expect(requests[0]?.body).toContain('"model":"openai-selected"');
  });

  it("runs an explicit no-auth local provider without Authorization or ambient credentials", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondOpenAi);
    const keyed = makeConfig(
      "openai_chat_completions",
      "openai_compatible",
      `${baseUrl}/v1`,
      "ollama-selected",
      "ollama"
    );
    const { authSecretRef: _authSecretRef, ...provider } = keyed.provider;

    const result = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: {
        provider: { ...provider, authRequirement: "none" },
        model: keyed.model
      },
      jobId: "job_20260712_pinoauth",
      systemPrompt: "Return a bounded acknowledgement.",
      userPrompt: "Acknowledge this synthetic local request.",
      tools: []
    });

    expect(result.assistantText).toBe("openai binding ok");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBeUndefined();
    expect(requests[0]?.apiKey).toBeUndefined();
  });

  it("dispatches Anthropic Messages by explicit protocol rather than compatible kind", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondAnthropic);
    const config = makeConfig(
      "anthropic_messages",
      "openai_compatible",
      baseUrl,
      "anthropic-selected"
    );

    const result = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: config,
      jobId: "job_20260711_pianthropic",
      systemPrompt: "Return a bounded acknowledgement.",
      userPrompt: "Acknowledge this synthetic local request.",
      tools: []
    });

    expect(result.modelId).toBe("anthropic-selected");
    expect(result.assistantText).toBe("anthropic binding ok");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/v1/messages", apiKey: "scoped-test-key" });
    expect(requests[0]?.body).toContain('"model":"anthropic-selected"');
  });

  it("keeps two same-vendor profiles isolated by selected model and scoped credential", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondOpenAi);
    const first = makeConfig(
      "openai_chat_completions",
      "custom",
      `${baseUrl}/v1`,
      "same-vendor-a",
      "a",
      "profile-key-a"
    );
    const second = makeConfig(
      "openai_chat_completions",
      "custom",
      `${baseUrl}/v1`,
      "same-vendor-b",
      "b",
      "profile-key-b"
    );

    const firstResult = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: first,
      jobId: "job_20260711_piprofilea",
      systemPrompt: "Acknowledge.",
      userPrompt: "Profile A.",
      tools: []
    });
    const secondResult = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: second,
      jobId: "job_20260711_piprofileb",
      systemPrompt: "Acknowledge.",
      userPrompt: "Profile B.",
      tools: []
    });

    expect([firstResult.modelId, secondResult.modelId]).toEqual(["same-vendor-a", "same-vendor-b"]);
    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer profile-key-a",
      "Bearer profile-key-b"
    ]);
    expect(requests[0]?.body).toContain('"model":"same-vendor-a"');
    expect(requests[1]?.body).toContain('"model":"same-vendor-b"');
  });

  it("preserves DeepSeek-compatible OpenAI and Anthropic generation path prefixes", async () => {
    const openAiRequests: CapturedRequest[] = [];
    const openAiBaseUrl = await startServer(openAiRequests, respondOpenAi);
    const anthropicRequests: CapturedRequest[] = [];
    const anthropicBaseUrl = await startServer(anthropicRequests, respondAnthropic);

    await new PiAgentRuntimeAdapter().run({
      runtimeConfig: makeConfig(
        "openai_chat_completions",
        "openai_compatible",
        openAiBaseUrl,
        "openai-selected",
        "deepseek_openai",
        "synthetic-openai-compatible-key"
      ),
      jobId: "job_20260712_deepseekopenai",
      systemPrompt: "Return a bounded acknowledgement.",
      userPrompt: "Acknowledge this synthetic local request.",
      tools: []
    });
    await new PiAgentRuntimeAdapter().run({
      runtimeConfig: makeConfig(
        "anthropic_messages",
        "anthropic_compatible",
        `${anthropicBaseUrl}/anthropic`,
        "anthropic-selected",
        "deepseek_anthropic",
        "synthetic-anthropic-compatible-key"
      ),
      jobId: "job_20260712_deepseekanthropic",
      systemPrompt: "Return a bounded acknowledgement.",
      userPrompt: "Acknowledge this synthetic local request.",
      tools: []
    });

    expect(openAiRequests).toEqual([
      expect.objectContaining({
        path: "/chat/completions",
        authorization: "Bearer synthetic-openai-compatible-key"
      })
    ]);
    expect(anthropicRequests).toEqual([
      expect.objectContaining({
        path: "/anthropic/v1/messages",
        apiKey: "synthetic-anthropic-compatible-key"
      })
    ]);
  });

  it("replays a reviewed DeepSeek reasoning tool call with the official Pi model metadata", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, (response) => {
      if (requests.length === 1) {
        respondOpenAiToolCall(response);
        return;
      }
      const body = JSON.parse(requests.at(-1)?.body ?? "{}") as {
        messages?: Array<{ role?: string; tool_calls?: unknown; reasoning_content?: unknown }>;
      };
      const assistantToolCall = body.messages?.find(
        (message) => message.role === "assistant" && message.tool_calls !== undefined
      );
      if (assistantToolCall?.reasoning_content !== "") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "missing_reasoning_content" } }));
        return;
      }
      respondOpenAi(response);
    });
    const baseConfig = makeConfig(
      "openai_chat_completions",
      "openai_compatible",
      baseUrl,
      "deepseek-v4-pro",
      "deepseek_reasoning"
    );
    const config: ModelProviderRuntimeConfig = {
      ...baseConfig,
      provider: { ...baseConfig.provider, presetId: "deepseek" }
    };
    const inspectTool: PigeAgentToolDefinition = {
      name: "pige_inspect_source",
      label: "Inspect source",
      description: "Return one bounded synthetic source inspection.",
      version: "1",
      capability: "read_current_source",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
        required: ["status"],
        additionalProperties: false
      },
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "current_source",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "current_source" },
      limits: { maxInputBytes: 64, maxOutputBytes: 256, timeoutMs: 1_000 },
      ownerService: "PiAgentProviderBindingTest",
      execute: async () => ({
        content: [{ type: "text", text: JSON.stringify({ status: "ready" }) }],
        details: { status: "ready" }
      })
    };

    const result = await new PiAgentRuntimeAdapter().run({
      runtimeConfig: config,
      jobId: "job_20260713_deepseekreplay",
      systemPrompt: "Use only the supplied Pige tool, then acknowledge its result.",
      userPrompt: "Inspect the synthetic source.",
      tools: [inspectTool]
    });

    expect(result.assistantText).toBe("openai binding ok");
    expect(requests).toHaveLength(2);
    const replayBody = JSON.parse(requests[1]?.body ?? "{}") as {
      messages?: Array<{ role?: string; tool_calls?: unknown; reasoning_content?: unknown }>;
    };
    expect(replayBody.messages?.find(
      (message) => message.role === "assistant" && message.tool_calls !== undefined
    )).toMatchObject({ reasoning_content: "" });
  });

  it("treats endpoint protocol changes as binding identity drift", () => {
    const config = makeConfig(
      "openai_chat_completions",
      "custom",
      "https://models.example.com/v1",
      "identity-model"
    );
    const model = { ...config.model, isDefault: true };
    const original = createModelRuntimeBindingIdentity(model, config.provider);
    const changed = createModelRuntimeBindingIdentity(model, {
      ...config.provider,
      endpointProtocol: "openai_responses"
    });

    expect(changed.providerIdentityHash).not.toBe(original.providerIdentityHash);
    expect(changed.modelIdentityHash).toBe(original.modelIdentityHash);
  });

  it("fails closed before dispatch when a compatible runtime binding omits its Base URL", async () => {
    const config = makeConfig(
      "openai_chat_completions",
      "custom",
      "https://must-not-be-used.example/v1",
      "missing-base-model"
    );
    const { baseUrl: _baseUrl, ...providerWithoutBaseUrl } = config.provider;

    await expect(new PiAgentRuntimeAdapter().run({
      runtimeConfig: { ...config, provider: providerWithoutBaseUrl },
      jobId: "job_20260712_missingbase",
      systemPrompt: "Do not dispatch.",
      userPrompt: "Do not dispatch.",
      tools: []
    })).rejects.toMatchObject({ code: "model_provider.base_url_missing" });
  });
});

interface CapturedRequest {
  readonly path: string;
  readonly authorization?: string;
  readonly apiKey?: string;
  readonly body: string;
}

async function startServer(
  requests: CapturedRequest[],
  responder: (response: ServerResponse) => void
): Promise<string> {
  const server = http.createServer(async (request, response) => {
    requests.push({
      path: request.url ?? "",
      ...(typeof request.headers.authorization === "string" ? { authorization: request.headers.authorization } : {}),
      ...(typeof request.headers["x-api-key"] === "string" ? { apiKey: request.headers["x-api-key"] } : {}),
      body: await readBody(request)
    });
    responder(response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a local TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

function respondOpenAi(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-local",
    object: "chat.completion.chunk",
    created: 1,
    model: "openai-selected",
    choices: [{ index: 0, delta: { role: "assistant", content: "openai binding ok" }, finish_reason: null }]
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-local",
    object: "chat.completion.chunk",
    created: 1,
    model: "openai-selected",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function respondOpenAiToolCall(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-deepseek-tool",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: "call_deepseek_replay",
          type: "function",
          function: { name: "pige_inspect_source", arguments: "{}" }
        }]
      },
      finish_reason: null
    }]
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-deepseek-tool",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-v4-pro",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function respondAnthropic(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  writeAnthropicEvent(response, "message_start", {
    type: "message_start",
    message: {
      id: "msg_local",
      type: "message",
      role: "assistant",
      content: [],
      model: "anthropic-selected",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 }
    }
  });
  writeAnthropicEvent(response, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" }
  });
  writeAnthropicEvent(response, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "anthropic binding ok" }
  });
  writeAnthropicEvent(response, "content_block_stop", { type: "content_block_stop", index: 0 });
  writeAnthropicEvent(response, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 3 }
  });
  writeAnthropicEvent(response, "message_stop", { type: "message_stop" });
  response.end();
}

function writeAnthropicEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function makeConfig(
  endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"],
  providerKind: ModelProviderRuntimeConfig["provider"]["providerKind"],
  baseUrl: string,
  modelId: string,
  suffix = providerKind,
  apiKey = "scoped-test-key"
): ModelProviderRuntimeConfig {
  return {
    provider: {
      id: `provider_${suffix}`,
      displayName: providerKind,
      providerKind,
      endpointProtocol,
      authRequirement: "api_key",
      baseUrl,
      authSecretRef: `provider_secret_${suffix}`,
      modelListStrategy: "manual",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    },
    model: {
      id: `model_${suffix}`,
      providerProfileId: `provider_${suffix}`,
      modelId,
      source: "manual",
      enabled: true,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    },
    apiKey
  };
}
