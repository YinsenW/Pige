import { describe, expect, it } from "vitest";
import { PiAgentRuntimeAdapter, type PigeAgentToolDefinition } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pi_test",
    displayName: "Pi Test Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43121/v1",
    authSecretRef: "provider_secret_pi_test",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pi_selected",
    providerProfileId: "provider_pi_test",
    modelId: "pi-selected-model",
    displayName: "Pi Selected Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-pi-key"
};

describe("Pi Agent runtime adapter", () => {
  it("runs the real Pi loop through ordered Pige-owned inspect and durable action tools", async () => {
    const calls: string[] = [];
    const published: unknown[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: { title: "Grounded", evidenceRefs: ["ev_01"] }
        }
      ]
    });

    const result = await adapter.run(makeRequest(makeTools(calls, published)));

    expect(calls).toEqual(["inspect", "publish"]);
    expect(published).toEqual([{ title: "Grounded", evidenceRefs: ["ev_01"] }]);
    expect(result).toMatchObject({
      adapterMode: "embedded_pi_sdk",
      providerProfileId: "provider_pi_test",
      modelProfileId: "model_pi_selected",
      modelId: "pi-selected-model",
      invokedTools: ["pige_inspect_source", "pige_create_knowledge_note"]
    });
    expect(result.events.filter((event) => event.type === "tool_execution_end")).toEqual([
      expect.objectContaining({ toolName: "pige_inspect_source", isError: false }),
      expect.objectContaining({ toolName: "pige_create_knowledge_note", isError: false })
    ]);
    expect(result.events[0]?.type).toBe("agent_start");
    expect(result.events.at(-1)?.type).toBe("agent_end");
  });

  it("lets Pi recover from an unknown tool result without granting ambient capabilities", async () => {
    const calls: string[] = [];
    const published: unknown[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "bash", args: { command: "cat ~/.ssh/id_ed25519" } },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Replanned" } }
      ]
    });

    const result = await adapter.run(makeRequest(makeTools(calls, published)));

    expect(calls).toEqual(["inspect", "publish"]);
    expect(result.invokedTools).toEqual(["bash", "pige_inspect_source", "pige_create_knowledge_note"]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_end",
      toolName: "bash",
      isError: true
    }));
  });

  it("rejects malformed tool arguments before the Pige handler and permits a bounded replan", async () => {
    const calls: string[] = [];
    const published: unknown[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: { destination: "/tmp/escape.md", title: "Injected" }
        },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Validated" } }
      ]
    });

    const result = await adapter.run(makeRequest(makeTools(calls, published)));

    expect(calls).toEqual(["inspect", "publish"]);
    expect(published).toEqual([{ title: "Validated" }]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_end",
      toolName: "pige_create_knowledge_note",
      isError: true
    }));
  });

  it("blocks an unauthorized durable action before its handler runs", async () => {
    let publishCalls = 0;
    const tools = makeTools([], []);
    tools[1] = {
      ...tools[1]!,
      authorize: () => false,
      execute: async () => {
        publishCalls += 1;
        return { modelText: "should not run", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Denied" } },
        { kind: "text", text: "Pige denied the write." }
      ]
    });

    const result = await adapter.run(makeRequest(tools));

    expect(publishCalls).toBe(0);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_end",
      toolName: "pige_create_knowledge_note",
      isError: true
    }));
  });

  it("propagates external cancellation through the Pi run and active tool signal", async () => {
    const controller = new AbortController();
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const tools: PigeAgentToolDefinition[] = [{
      name: "pige_inspect_source",
      label: "Inspect",
      description: "Wait for cancellation.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_args, signal) => {
        toolStarted();
        await new Promise<void>((_resolve, reject) => {
          const abort = (): void => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            reject(error);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
        return { modelText: "unreachable", details: {} };
      }
    }];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: "pige_inspect_source", args: {} }]
    });
    const run = adapter.run({ ...makeRequest(tools), signal: controller.signal });
    await started;
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a pre-aborted run before any Pi provider turn or tool call", async () => {
    const controller = new AbortController();
    controller.abort();
    const calls: string[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: "pige_inspect_source", args: {} }]
    });

    await expect(adapter.run({
      ...makeRequest(makeTools(calls, [])),
      signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });
});

function makeRequest(tools: readonly PigeAgentToolDefinition[]) {
  return {
    runtimeConfig,
    jobId: "job_20260711_piagent01",
    systemPrompt: "Use only Pige-owned tools.",
    userPrompt: "Inspect the current source and publish grounded knowledge.",
    tools
  };
}

function makeTools(calls: string[], published: unknown[]): PigeAgentToolDefinition[] {
  return [
    {
      name: "pige_inspect_source",
      label: "Inspect",
      description: "Inspect current source evidence.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      authorize: () => true,
      execute: async () => {
        calls.push("inspect");
        return {
          modelText: JSON.stringify({ evidence: [{ ref: "ev_01", text: "Synthetic evidence" }] }),
          details: { fragmentCount: 1 }
        };
      }
    },
    {
      name: "pige_create_knowledge_note",
      label: "Publish",
      description: "Publish a validated note.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } }
        },
        required: ["title"],
        additionalProperties: false
      },
      authorize: () => true,
      execute: async (args) => {
        calls.push("publish");
        published.push(args);
        return { modelText: JSON.stringify({ status: "created" }), details: {}, terminate: true };
      }
    }
  ];
}
