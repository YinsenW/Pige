import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ModelProviderGenerationProbe } from "../../apps/desktop/src/main/services/model-provider-generation-probe";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("model provider generation probe", () => {
  it("runs a real isolated OpenAI Responses generation, Pige tool, and tool-result round trip", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startResponsesServer(requests);
    const config = makeResponsesConfig(`${baseUrl}/v1`);

    await new ModelProviderGenerationProbe().probe(config);

    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.path)).toEqual(["/v1/responses", "/v1/responses"]);
    expect(requests.map((request) => request.authorization)).toEqual([
      "Bearer scoped-responses-key",
      "Bearer scoped-responses-key"
    ]);
    const firstBody = parseRequestBody(requests[0]);
    const secondBody = parseRequestBody(requests[1]);
    expect(firstBody).toMatchObject({
      model: "responses-probe-model",
      stream: true,
      store: false,
      tools: [expect.objectContaining({ type: "function", name: "pige_provider_probe" })]
    });
    expect(secondBody).toMatchObject({ model: "responses-probe-model", stream: true, store: false });
    const secondInput = Array.isArray(secondBody.input) ? secondBody.input : [];
    expect(secondInput).toContainEqual(expect.objectContaining({
      type: "function_call",
      call_id: "call_probe_1",
      name: "pige_provider_probe"
    }));
    expect(secondInput).toContainEqual(expect.objectContaining({
      type: "function_call_output",
      call_id: "call_probe_1",
      output: JSON.stringify({ ready: true })
    }));
    const bodies = requests.map((request) => request.body).join("\n");
    expect(bodies).not.toContain("DO_NOT_SEND_PROFILE_LABEL");
    expect(bodies).not.toContain("provider_secret_do_not_send");
    expect(bodies).not.toContain("scoped-responses-key");
  });

  it("aborts the bounded probe and returns a fixed redacted failure", async () => {
    const runtime = {
      run: (request: { readonly signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(new Error("private timeout detail")), { once: true });
      })
    };

    await expect(new ModelProviderGenerationProbe(runtime, 5).probe(makeResponsesConfig("https://example.com/v1")))
      .rejects.toMatchObject({
        code: "model_provider.generation_probe_failed",
        message: "The selected provider model could not complete the synthetic readiness probe."
      });
  });
});

interface CapturedRequest {
  readonly path: string;
  readonly authorization?: string;
  readonly body: string;
}

async function startResponsesServer(requests: CapturedRequest[]): Promise<string> {
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      path: request.url ?? "",
      ...(typeof request.headers.authorization === "string" ? { authorization: request.headers.authorization } : {}),
      body
    });
    if (requests.length === 1) writeToolCallResponse(response);
    else writeTextResponse(response);
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

function writeToolCallResponse(response: ServerResponse): void {
  const item = {
    id: "fc_probe_1",
    type: "function_call",
    status: "completed",
    arguments: "{}",
    call_id: "call_probe_1",
    name: "pige_provider_probe"
  };
  beginEventStream(response);
  writeResponseEvent(response, {
    type: "response.created",
    sequence_number: 0,
    response: openAiResponse("resp_probe_1", "in_progress", [])
  });
  writeResponseEvent(response, {
    type: "response.output_item.added",
    sequence_number: 1,
    output_index: 0,
    item: { ...item, status: "in_progress", arguments: "" }
  });
  writeResponseEvent(response, {
    type: "response.function_call_arguments.done",
    sequence_number: 2,
    output_index: 0,
    item_id: item.id,
    name: item.name,
    arguments: item.arguments
  });
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: 3,
    output_index: 0,
    item
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: 4,
    response: openAiResponse("resp_probe_1", "completed", [item])
  });
  response.end("data: [DONE]\n\n");
}

function writeTextResponse(response: ServerResponse): void {
  const initialItem = {
    id: "msg_probe_2",
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }]
  };
  const completedItem = {
    ...initialItem,
    status: "completed",
    content: [{ type: "output_text", text: "probe ready", annotations: [], logprobs: [] }]
  };
  beginEventStream(response);
  writeResponseEvent(response, {
    type: "response.created",
    sequence_number: 0,
    response: openAiResponse("resp_probe_2", "in_progress", [])
  });
  writeResponseEvent(response, {
    type: "response.output_item.added",
    sequence_number: 1,
    output_index: 0,
    item: initialItem
  });
  writeResponseEvent(response, {
    type: "response.output_text.delta",
    sequence_number: 2,
    output_index: 0,
    content_index: 0,
    item_id: initialItem.id,
    delta: "probe ready",
    logprobs: []
  });
  writeResponseEvent(response, {
    type: "response.output_item.done",
    sequence_number: 3,
    output_index: 0,
    item: completedItem
  });
  writeResponseEvent(response, {
    type: "response.completed",
    sequence_number: 4,
    response: openAiResponse("resp_probe_2", "completed", [completedItem])
  });
  response.end("data: [DONE]\n\n");
}

function openAiResponse(id: string, status: "in_progress" | "completed", output: readonly unknown[]) {
  return {
    id,
    object: "response",
    created_at: 1,
    status,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 4_096,
    model: "responses-probe-model",
    output,
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: null,
    store: false,
    temperature: 0,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: status === "completed"
      ? {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2
        }
      : null,
    metadata: {}
  };
}

function beginEventStream(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
}

function writeResponseEvent(response: ServerResponse, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequestBody(request: CapturedRequest | undefined): Record<string, unknown> {
  if (!request) throw new Error("Expected a captured request.");
  return JSON.parse(request.body) as Record<string, unknown>;
}

function makeResponsesConfig(baseUrl: string): ModelProviderRuntimeConfig {
  return {
    provider: {
      id: "provider_responses_probe",
      displayName: "DO_NOT_SEND_PROFILE_LABEL",
      providerKind: "custom",
      endpointProtocol: "openai_responses",
      baseUrl,
      authSecretRef: "provider_secret_do_not_send",
      modelListStrategy: "manual",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    },
    model: {
      id: "model_responses_probe",
      providerProfileId: "provider_responses_probe",
      modelId: "responses-probe-model",
      source: "manual",
      enabled: true,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    },
    apiKey: "scoped-responses-key"
  };
}
