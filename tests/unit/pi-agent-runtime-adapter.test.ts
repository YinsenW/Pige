import { describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import {
  AgentRepairRequiredError,
  MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES,
  PiAgentRuntimeAdapter,
  createAgentRepairFeedback,
  createPigeAgentToolCatalogHash,
  type PigeAgentToolDefinition
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
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

const TOOL_RESULT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    modelText: { type: "string" },
    details: { type: "object" },
    terminate: { type: "boolean" }
  },
  required: ["modelText", "details"],
  additionalProperties: false
} as const;

const BASE_TOOL_DESCRIPTOR = {
  version: "1",
  capability: "read_current_source",
  outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
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
  limits: { maxInputBytes: 131_072, maxOutputBytes: 131_072, timeoutMs: 120_000 },
  ownerService: "AgentIngestService"
} as const;

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

  it("propagates Host permission control flow instead of letting Pi continue the model loop", async () => {
    let modelTurns = 0;
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_external_action", args: {} },
        { kind: "text", text: "This later provider turn must never run." }
      ]
    });
    const tool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_external_action",
      label: "External action",
      description: "Exercise one permission-gated external action.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      authorize: () => true,
      execute: async () => {
        throw new PigeDomainError(
          "permission.confirmation_required",
          "The exact external action requires permission."
        );
      }
    };

    await expect(adapter.run({
      ...makeRequest([tool]),
      beforeModelTurn: () => { modelTurns += 1; }
    })).rejects.toMatchObject({ code: "permission.confirmation_required" });

    // One explicit preflight plus Pi's first-turn preparation ran; no later provider turn followed the tool error.
    expect(modelTurns).toBe(2);
  });

  it("does not exhaust the structural event budget on bounded high-frequency provider deltas", async () => {
    const calls: string[] = [];
    const published: unknown[] = [];
    const title = `Bounded ${"stream ".repeat(1_600)}`;
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{
        kind: "tool_call",
        toolName: "pige_create_knowledge_note",
        args: { title }
      }]
    });

    const result = await adapter.run(makeRequest(makeTools(calls, published)));

    expect(calls).toEqual(["publish"]);
    expect(published).toEqual([{ title }]);
    expect(result.events.filter((event) => event.type === "message_update")).toHaveLength(1);
    expect(result.events.at(-1)?.type).toBe("agent_end");
  });

  it("emits only parsed safe answer snapshots from the exact terminal Home tool", async () => {
    await expectExactAuthorizedDrafts("openai_responses");
  });

  it.each([
    "openai_chat_completions",
    "anthropic_messages"
  ] as const)("emits only exact authorized safe answer snapshots for %s", async (endpointProtocol) => {
    await expectExactAuthorizedDrafts(endpointProtocol);
  });

  it("completes from the parsed terminal answer without a presentation-only provider turn", async () => {
    const drafts: string[] = [];
    const answer = "This validated answer is emitted only from parsed terminal arguments.";
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{
        kind: "tool_call",
        toolName: "pige_finish_home_turn",
        args: { answer, citationRefs: [], grounding: "general" }
      }]
    });

    const result = await adapter.run({
      ...makeRequest([makeFinishHomeTool()]),
      terminalDraft: {
        toolName: "pige_finish_home_turn",
        argumentName: "answer",
        maxCharacters: 8_000,
        onSnapshot: (text) => drafts.push(text)
      }
    });

    expect(drafts.at(-1)).toBe(answer);
    expect(result.assistantText).toBe("");
  });

  it("repairs invalid terminal arguments and accepts a later valid result in the same Job", async () => {
    const drafts: string[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        {
          kind: "tool_call",
          toolName: "pige_finish_home_turn",
          args: { answer: "Missing grounding", citationRefs: [] }
        },
        {
          kind: "tool_call",
          toolName: "pige_finish_home_turn",
          args: { answer: "Corrected", citationRefs: [], grounding: "general" }
        }
      ]
    });

    const result = await adapter.run({
      ...makeRequest([makeFinishHomeTool()]),
      completionRepair: makeCompletionRepairBoundary(),
      terminalDraft: {
        toolName: "pige_finish_home_turn",
        argumentName: "answer",
        maxCharacters: 8_000,
        onSnapshot: (text) => drafts.push(text)
      }
    });

    expect(result.invokedTools).toEqual(["pige_finish_home_turn", "pige_finish_home_turn"]);
    expect(result.events.filter((event) => event.type === "tool_execution_end")).toEqual([
      expect.objectContaining({ isError: true }),
      expect.objectContaining({ isError: false })
    ]);
    expect(drafts).toEqual(["Missing grounding", "Corrected"]);
    expect(drafts.join(" ")).not.toContain("citationRefs");
  });

  it("continues after more than one prose omission before a registered terminal action", async () => {
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "text", text: "First incomplete prose response." },
        { kind: "text", text: "Second incomplete prose response." },
        {
          kind: "tool_call",
          toolName: "pige_finish_home_turn",
          args: { answer: "Terminal completion", citationRefs: [], grounding: "general" }
        }
      ]
    });

    const result = await adapter.run({
      ...makeRequest([makeFinishHomeTool()]),
      completionRepair: makeCompletionRepairBoundary()
    });

    expect(result.invokedTools).toEqual(["pige_finish_home_turn"]);
  });

  it("allows a safe read revisit after rejected terminal evidence and then completes", async () => {
    const reads: string[] = [];
    const finishTool = makeFinishHomeTool({ rejectCitation: "citation_9" });
    const readTool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_search_knowledge",
      label: "Search",
      description: "Read current bounded evidence.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        reads.push("read");
        return { modelText: "citation_1", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: readTool.name, args: {} },
        {
          kind: "tool_call",
          toolName: finishTool.name,
          args: { answer: "Wrong ref", citationRefs: ["citation_9"], grounding: "local_knowledge" }
        },
        { kind: "tool_call", toolName: readTool.name, args: {} },
        {
          kind: "tool_call",
          toolName: finishTool.name,
          args: { answer: "Correct ref", citationRefs: ["citation_1"], grounding: "local_knowledge" }
        }
      ]
    });

    const result = await adapter.run({
      ...makeRequest([readTool, finishTool]),
      completionRepair: makeCompletionRepairBoundary()
    });

    expect(reads).toEqual(["read", "read"]);
    expect(result.invokedTools).toEqual([
      "pige_search_knowledge",
      "pige_finish_home_turn",
      "pige_search_knowledge",
      "pige_finish_home_turn"
    ]);
  });

  it("fails with a typed protocol incompatibility after bounded repeated non-progress", async () => {
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: Array.from({ length: 4 }, () => ({
        kind: "tool_call" as const,
        toolName: "pige_finish_home_turn",
        args: { answer: "Still missing required fields" }
      }))
    });

    await expect(adapter.run({
      ...makeRequest([makeFinishHomeTool()]),
      completionRepair: {
        ...makeCompletionRepairBoundary(),
        maxRepeatedFailureFingerprints: 2
      }
    })).rejects.toMatchObject({ code: "model_provider.tool_protocol_incompatible" });
  });

  it("does not expose generic Pi text as a Home draft", async () => {
    const drafts: string[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "text", text: "Raw provider prose must never become a Home draft." }]
    });

    await adapter.run({
      ...makeRequest([]),
      terminalDraft: {
        toolName: "pige_finish_home_turn",
        argumentName: "answer",
        maxCharacters: 8_000,
        onSnapshot: (text) => drafts.push(text)
      }
    });

    expect(drafts).toEqual([]);
  });

  it.each([
    "path=/Users/alice/private/notes.md",
    '{"apiKey":"opaque-value-123456"}',
    "Safe words followed by a control\u0000character"
  ])("does not emit a restricted or control-bearing terminal draft: %s", async (answer) => {
    const drafts: string[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{
        kind: "tool_call",
        toolName: "pige_finish_home_turn",
        args: { answer, citationRefs: [], grounding: "general" }
      }]
    });

    await adapter.run({
      ...makeRequest([makeFinishHomeTool()]),
      terminalDraft: {
        toolName: "pige_finish_home_turn",
        argumentName: "answer",
        maxCharacters: 8_000,
        onSnapshot: (text) => drafts.push(text)
      }
    });

    expect(drafts).toEqual([]);
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

  it("preserves a host policy failure raised before a later Pi model turn", async () => {
    const policyFailure = new Error("host policy blocked the second model turn");
    let checks = 0;
    let toolExecuted = false;
    const tools = makeTools([], []);
    tools[0] = {
      ...tools[0]!,
      execute: async () => {
        toolExecuted = true;
        return { modelText: "Inspected.", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "text", text: "Must not be returned." }
      ]
    });

    const run = adapter.run({
      ...makeRequest(tools),
      beforeModelTurn: () => {
        checks += 1;
        if (toolExecuted) throw policyFailure;
      }
    });

    await expect(run).rejects.toBe(policyFailure);
    expect(checks).toBeGreaterThanOrEqual(2);
  });

  it("passes a bounded opaque Pi tool call ID to authorization and execution without recording it", async () => {
    const toolCallId = `${"界".repeat(85)}x`;
    expect(new TextEncoder().encode(toolCallId)).toHaveLength(MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES);
    const authorizedIds: string[] = [];
    const executedIds: string[] = [];
    const tools = makeTools([], []);
    tools[0] = {
      ...tools[0]!,
      authorize: (_args, context) => {
        authorizedIds.push(context.toolCallId);
        return true;
      },
      execute: async (_args, _signal, context) => {
        executedIds.push(context.toolCallId);
        return { modelText: "Inspected.", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId },
        { kind: "text", text: "Done." }
      ]
    });

    const result = await adapter.run(makeRequest(tools));

    expect(authorizedIds).toEqual([toolCallId]);
    expect(executedIds).toEqual([toolCallId]);
    expect(result.events.every((event) => !("toolCallId" in event))).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["blank", " \t\n "],
    ["oversized UTF-8", "界".repeat(86)],
    ["non-string", 42]
  ])("rejects a %s Pi tool call ID before authorization or execution", async (_case, toolCallId) => {
    let authorizationCalls = 0;
    let handlerCalls = 0;
    const tools = makeTools([], []);
    tools[0] = {
      ...tools[0]!,
      authorize: () => {
        authorizationCalls += 1;
        return true;
      },
      execute: async () => {
        handlerCalls += 1;
        return { modelText: "should not run", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId },
        { kind: "text", text: "Pige rejected the malformed call." }
      ]
    });

    const result = await adapter.run(makeRequest(tools));

    expect(authorizationCalls).toBe(0);
    expect(handlerCalls).toBe(0);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tool_execution_end",
      toolName: "pige_inspect_source",
      isError: true
    }));
  });

  it("rejects an invalid Pige descriptor before a model turn, authorization, or handler", async () => {
    let authorizationCalls = 0;
    let handlerCalls = 0;
    const tools = makeTools([], []);
    tools[0] = {
      ...tools[0]!,
      limits: { maxInputBytes: 0, maxOutputBytes: 1_024, timeoutMs: 1_000 },
      authorize: () => {
        authorizationCalls += 1;
        return true;
      },
      execute: async () => {
        handlerCalls += 1;
        return { modelText: "should not run", details: {} };
      }
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: "pige_inspect_source", args: {} }]
    });

    await expect(adapter.run(makeRequest(tools))).rejects.toMatchObject({
      code: "agent_runtime.tool_registry_invalid"
    });
    expect(authorizationCalls).toBe(0);
    expect(handlerCalls).toBe(0);
  });

  it("hashes the validated semantic tool catalog deterministically without handler identity", () => {
    const tools = makeTools([], []);
    const sameSemantics = tools.map((tool) => ({
      ...tool,
      execute: async () => ({ modelText: "different handler instance", details: {} })
    }));
    const changedVersion = tools.map((tool, index) => index === 0
      ? { ...tool, version: "2" }
      : tool);

    const first = createPigeAgentToolCatalogHash(tools);

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(createPigeAgentToolCatalogHash(tools)).toBe(first);
    expect(createPigeAgentToolCatalogHash(sameSemantics)).toBe(first);
    expect(createPigeAgentToolCatalogHash(changedVersion)).not.toBe(first);
  });

  it("propagates external cancellation through the Pi run and active tool signal", async () => {
    const controller = new AbortController();
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const tools: PigeAgentToolDefinition[] = [{
      ...BASE_TOOL_DESCRIPTOR,
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
    }, makeFinishHomeTool()];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: "pige_inspect_source", args: {} }]
    });
    const run = adapter.run({
      ...makeRequest(tools),
      completionRepair: makeCompletionRepairBoundary(),
      signal: controller.signal
    });
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

  it("rehydrates bounded prior turns without returning historical assistant text as the new result", async () => {
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "text", text: "Current answer only." }]
    });

    const result = await adapter.run({
      ...makeRequest([]),
      history: [
        { role: "user", text: "Earlier question.", createdAt: "2026-07-11T00:00:00.000Z" },
        { role: "assistant", text: "Earlier answer.", createdAt: "2026-07-11T00:00:01.000Z" }
      ],
      userPrompt: "Continue the conversation."
    });

    expect(result.assistantText).toBe("Current answer only.");
  });

  it("fails closed before a provider turn when rehydrated history exceeds its bound", async () => {
    const adapter = new PiAgentRuntimeAdapter({ fauxResponses: [{ kind: "text", text: "unreachable" }] });

    await expect(adapter.run({
      ...makeRequest([]),
      history: Array.from({ length: 17 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        text: `Synthetic turn ${index}`,
        createdAt: "2026-07-11T00:00:00.000Z"
      }))
    })).rejects.toMatchObject({ code: "agent_runtime.turn_history_invalid" });
  });
});

async function expectExactAuthorizedDrafts(
  endpointProtocol: "openai_responses" | "openai_chat_completions" | "anthropic_messages"
): Promise<void> {
  const drafts: string[] = [];
  const answer = "This bounded Home answer is safe to show while final validation finishes.";
  const adapter = new PiAgentRuntimeAdapter({
    fauxResponses: [{
      kind: "tool_call",
      toolName: "pige_finish_home_turn",
      args: { answer, citationRefs: [], grounding: "general" }
    }]
  });

  await adapter.run({
    ...makeRequest([makeFinishHomeTool()]),
    runtimeConfig: {
      ...runtimeConfig,
      provider: { ...runtimeConfig.provider, endpointProtocol }
    },
    terminalDraft: {
      toolName: "pige_finish_home_turn",
      argumentName: "answer",
      maxCharacters: 8_000,
      onSnapshot: (text) => drafts.push(text)
    }
  });

  expect(drafts.length).toBeGreaterThan(0);
  expect(drafts.at(-1)).toBe(answer);
  expect(drafts.every((draft) => answer.startsWith(draft))).toBe(true);
  expect(drafts.join(" ")).not.toContain("citationRefs");
}

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
      ...BASE_TOOL_DESCRIPTOR,
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
      ...BASE_TOOL_DESCRIPTOR,
      capability: "write_generated_note",
      effect: "idempotent_write",
      outputTrust: "host_validated",
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

function makeCompletionRepairBoundary() {
  return {
    terminalToolNames: ["pige_finish_home_turn"],
    maxWallTimeMs: 30_000,
    maxToolCalls: 32,
    maxWorkBytes: 64 * 1_024,
    maxRepeatedFailureFingerprints: 3
  } as const;
}

function makeFinishHomeTool(options: { readonly rejectCitation?: string } = {}): PigeAgentToolDefinition {
  return {
    ...BASE_TOOL_DESCRIPTOR,
    name: "pige_finish_home_turn",
    label: "Finish Home turn",
    description: "Return one bounded validated Home answer.",
    parameters: {
      type: "object",
      properties: {
        answer: { type: "string" },
        citationRefs: { type: "array", items: { type: "string" } },
        grounding: { type: "string" }
      },
      required: ["answer", "citationRefs", "grounding"],
      additionalProperties: false
    },
    authorize: () => true,
    execute: async (args) => {
      if (
        options.rejectCitation &&
        typeof args === "object" &&
        args !== null &&
        Array.isArray((args as { citationRefs?: unknown }).citationRefs) &&
        (args as { citationRefs: unknown[] }).citationRefs.includes(options.rejectCitation)
      ) {
        throw new AgentRepairRequiredError(createAgentRepairFeedback({
          category: "citation_invalid",
          fieldRefs: ["citationRefs"],
          allowedOpaqueRefs: ["citation_1"],
          repairHintKey: "repair.citations.use_allowed_refs",
          progressFingerprint: options.rejectCitation
        }));
      }
      return { modelText: "Home turn finished.", details: {}, terminate: true };
    }
  };
}
