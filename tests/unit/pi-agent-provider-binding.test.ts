import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Pi AI provider binding", () => {
  it("uses the selected OpenAI-compatible profile through Pi AI with no ambient dispatcher", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondOpenAi);
    const config = makeConfig("openai_compatible", `${baseUrl}/v1`, "openai-selected");

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

  it("uses the selected Anthropic-compatible profile through Pi AI with scoped x-api-key auth", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(requests, respondAnthropic);
    const config = makeConfig("anthropic_compatible", baseUrl, "anthropic-selected");

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
    const first = makeConfig("openai_compatible", `${baseUrl}/v1`, "same-vendor-a", "a", "profile-key-a");
    const second = makeConfig("openai_compatible", `${baseUrl}/v1`, "same-vendor-b", "b", "profile-key-b");

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
  providerKind: "openai_compatible" | "anthropic_compatible",
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
