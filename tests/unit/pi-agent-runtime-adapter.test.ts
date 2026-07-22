import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { PigeDomainError } from "@pige/domain";
import {
  MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES,
  PiAgentRuntimeAdapter,
  createPigeAgentToolCatalogHash,
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  assertPigeAgentToolDescriptors,
  toPiTool,
  type PigeAgentToolResult
} from "../../apps/desktop/src/main/services/pi-agent-tool-boundary";
import {
  collectAssistantText,
  SafeAssistantDraftController
} from "../../apps/desktop/src/main/services/pi-agent-safe-projection";

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
  it("accepts an exact current-note read boundary without widening it to the vault", async () => {
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_read_current_note", args: {} },
        { kind: "text", text: "The current note was read." }
      ]
    });
    const tool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_read_current_note",
      label: "Read current note",
      description: "Read only the Host-bound current note.",
      capability: "read_current_note",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      dataBoundary: { ...BASE_TOOL_DESCRIPTOR.dataBoundary, resourceScope: "current_note" },
      idempotency: { mode: "idempotent", scope: "current_note" },
      execute: async () => createPigeTextToolResult("Bound current-note evidence.", {})
    };

    const result = await adapter.run(makeRequest([tool]));

    expect(result.invokedTools).toEqual(["pige_read_current_note"]);
    expect(tool.dataBoundary.resourceScope).toBe("current_note");
    expect(tool.idempotency.scope).toBe("current_note");
  });

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
        },
        { kind: "text", text: "The source was inspected and the note was published." }
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

  it("lets Pi overlap one batch of explicitly read-only tools", async () => {
    let active = 0;
    let maxActive = 0;
    const runRead = async (): Promise<ReturnType<typeof createPigeTextToolResult>> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return createPigeTextToolResult("Bounded read result.", {});
    };
    const tools = ["pige_read_alpha", "pige_read_beta"].map((name) => ({
      ...BASE_TOOL_DESCRIPTOR,
      name,
      label: name,
      description: `Read ${name} without side effects.`,
      parameters: { type: "object", properties: {}, additionalProperties: false } as const,
      execution: "parallel_read_only" as const,
      authorize: () => true,
      execute: runRead
    } satisfies PigeAgentToolDefinition));
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        {
          kind: "tool_calls",
          calls: tools.map((tool) => ({ toolName: tool.name, args: {} }))
        },
        { kind: "text", text: "Read batch complete." }
      ]
    });

    const result = await adapter.run(makeRequest(tools));

    expect(maxActive).toBe(2);
    expect(result.invokedTools).toEqual(["pige_read_alpha", "pige_read_beta"]);
  });

  it("lets Pi serialize a mixed batch containing a side-effect tool", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const makeScheduledTool = (
      name: string,
      execution: "parallel_read_only" | "sequential",
      effect: "read_only" | "idempotent_write"
    ): PigeAgentToolDefinition => ({
      ...BASE_TOOL_DESCRIPTOR,
      name,
      label: name,
      description: `Exercise ${name} scheduling.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execution,
      effect,
      authorize: () => true,
      execute: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push(`${name}:end`);
        active -= 1;
        return createPigeTextToolResult("Scheduled result.", {});
      }
    });
    const tools = [
      makeScheduledTool("pige_read_safe", "parallel_read_only", "read_only"),
      makeScheduledTool("pige_write_safe", "sequential", "idempotent_write")
    ];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        {
          kind: "tool_calls",
          calls: tools.map((tool) => ({ toolName: tool.name, args: {} }))
        },
        { kind: "text", text: "Mixed batch complete." }
      ]
    });

    await adapter.run(makeRequest(tools));

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      "pige_read_safe:start",
      "pige_read_safe:end",
      "pige_write_safe:start",
      "pige_write_safe:end"
    ]);
  });

  it("preserves native tool updates and fixed-catalog added tool names", async () => {
    const tools: PigeAgentToolDefinition[] = [
      {
        ...BASE_TOOL_DESCRIPTOR,
        name: "pige_stream_read",
        label: "Stream read",
        description: "Stream one bounded read result.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        authorize: () => true,
        execute: async (_args, _signal, _context, onUpdate) => {
          onUpdate?.(createPigeTextToolResult("Partial result.", { partial: true }));
          return createPigeTextToolResult(
            "Final result.",
            { partial: false },
            { addedToolNames: ["pige_catalog_peer"] }
          );
        }
      },
      {
        ...BASE_TOOL_DESCRIPTOR,
        name: "pige_catalog_peer",
        label: "Catalog peer",
        description: "Remain available in the fixed Pige catalog.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => createPigeTextToolResult("Peer result.", {})
      }
    ];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_stream_read", args: {} },
        { kind: "text", text: "Streaming complete." }
      ]
    });

    const result = await adapter.run(makeRequest(tools));

    expect(result.events).toContainEqual({
      type: "tool_execution_update",
      toolName: "pige_stream_read"
    });
  });

  it("passes native image, update, added-tool, and future result fields through the Pi bridge", async () => {
    const partial: PigeAgentToolResult = {
      content: [{ type: "image", data: "c3ludGhldGlj", mimeType: "image/png" }],
      details: { stage: "partial" }
    };
    const final = {
      content: [
        { type: "text" as const, text: "Final result." },
        { type: "image" as const, data: "c3ludGhldGlj", mimeType: "image/png" }
      ],
      details: { stage: "final" },
      addedToolNames: ["pige_native_result"],
      futureMetadata: { retained: true }
    } as unknown as PigeAgentToolResult;
    const tool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_native_result",
      label: "Native result",
      description: "Preserve native Pi result capabilities.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_args, _signal, _context, onUpdate) => {
        onUpdate?.(partial);
        return final;
      }
    };
    const tools = [tool];
    assertPigeAgentToolDescriptors(tools);
    const descriptor = tools[0];
    if (!descriptor) throw new Error("Missing native result tool.");
    const updates: PigeAgentToolResult[] = [];
    const bridged = toPiTool(descriptor, new Map([[descriptor.name, descriptor]]));

    const result = await bridged.execute(
      "pi_tool_native_result",
      {},
      new AbortController().signal,
      (update) => updates.push(update)
    );

    expect(updates).toEqual([partial]);
    expect(result).toBe(final);
    expect(result).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })]),
      addedToolNames: ["pige_native_result"],
      futureMetadata: { retained: true }
    });
  });

  it("rejects added tool names outside the fixed Pige catalog", async () => {
    const tool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_fixed_catalog",
      label: "Fixed catalog",
      description: "Reject dynamic tool activation.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => createPigeTextToolResult(
        "Result.",
        {},
        { addedToolNames: ["pige_dynamic_unknown"] }
      )
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: tool.name, args: {} }]
    });

    await expect(adapter.run(makeRequest([tool]))).rejects.toMatchObject({
      code: "agent_runtime.dynamic_tool_activation_forbidden"
    });
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
      }, { kind: "text", text: "The bounded publication completed." }]
    });

    const result = await adapter.run(makeRequest(makeTools(calls, published)));

    expect(calls).toEqual(["publish"]);
    expect(published).toEqual([{ title }]);
    expect(result.events.filter((event) => event.type === "message_update")).toHaveLength(2);
    expect(result.events.at(-1)?.type).toBe("agent_end");
  });

  it("accepts an upstream assistant final without injecting a Host follow-up", async () => {
    let modelTurnChecks = 0;
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "text", text: "Native assistant completion." }]
    });

    const result = await adapter.run({
      ...makeRequest([]),
      beforeModelTurn: () => { modelTurnChecks += 1; }
    });

    expect(modelTurnChecks).toBe(1);
    expect(result.assistantText).toBe("Native assistant completion.");
    expect(result.invokedTools).toEqual([]);
  });

  it("accepts the upstream final assistant text after a tool call", async () => {
    const readTool: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_search_knowledge",
      label: "Search",
      description: "Read current bounded evidence.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => createPigeTextToolResult("citation_1")
    };
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: readTool.name, args: {} },
        { kind: "text", text: "Unvalidated grounded prose." }
      ]
    });

    const result = await adapter.run(makeRequest([readTool]));
    expect(result.assistantText).toBe("Unvalidated grounded prose.");
    expect(result.invokedTools).toEqual(["pige_search_knowledge"]);
  });

  it("uses one exact text-block projection for draft and final", async () => {
    const drafts: string[] = [];
    const controller = new SafeAssistantDraftController({
      maxCharacters: 8_000,
      onSnapshot: (text) => drafts.push(text)
    });
    const content = [{ type: "text", text: " leading " }, { type: "text", text: "and trailing\n" }];

    controller.observe(messageUpdate({
      type: "text_delta",
      contentIndex: 0,
      delta: "and trailing\n",
      partial: assistantMessage(content)
    }));
    await controller.assertCompleteAndSettle();

    const finalText = collectAssistantText([
      assistantMessage([{ type: "text", text: "pre-tool narration" }]),
      assistantMessage(content)
    ]);
    expect(finalText).toBe(" leading and trailing\n");
    expect(drafts).toEqual([finalText]);
  });

  it.each([
    "path=/Users/alice/private/notes.md",
    '{"apiKey":"opaque-value-123456"}'
  ])("preserves accepted assistant text without content classification: %s", async (answer) => {
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "text", text: answer }]
    });
    await expect(adapter.run(makeRequest([]))).resolves.toMatchObject({ assistantText: answer });
  });

  it.each(["   ", "Safe words followed by a control\u0000character"])(
    "rejects structurally invalid final assistant text: %s",
    async (answer) => {
      const adapter = new PiAgentRuntimeAdapter({ fauxResponses: [{ kind: "text", text: answer }] });
      await expect(adapter.run(makeRequest([]))).rejects.toMatchObject({
        code: "model_provider.tool_protocol_incompatible"
      });
    }
  );

  it("uses only the final assistant message instead of merging pre-tool narration", () => {
    expect(collectAssistantText([
      assistantMessage([{ type: "text", text: "I will inspect first." }]),
      assistantMessage([{ type: "text", text: "Final answer only." }])
    ])).toBe("Final answer only.");
  });

  it("lets Pi recover from an unknown tool result without granting ambient capabilities", async () => {
    const calls: string[] = [];
    const published: unknown[] = [];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "bash", args: { command: "cat ~/.ssh/id_ed25519" } },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Replanned" } },
        { kind: "text", text: "The bounded replan completed." }
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
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Validated" } },
        { kind: "text", text: "The validated tool input completed." }
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

  it("owns schema-invalid registered tool input at the exact tool boundary", async () => {
    let handlerCalls = 0;
    const descriptor: PigeAgentToolDefinition = {
      ...BASE_TOOL_DESCRIPTOR,
      name: "pige_strict_input",
      label: "Strict input",
      description: "Reject schema-invalid input before the handler.",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false
      },
      execute: async () => {
        handlerCalls += 1;
        return createPigeTextToolResult("unreachable");
      }
    };
    const bridged = toPiTool(descriptor, new Map([[descriptor.name, descriptor]]));

    await expect(bridged.execute(
      "pi_tool_invalid_input",
      { unexpected: true },
      new AbortController().signal
    )).rejects.toMatchObject({ code: "agent_runtime.tool_input_invalid" });
    expect(handlerCalls).toBe(0);
  });

  it("blocks an unauthorized durable action before its handler runs", async () => {
    let publishCalls = 0;
    const tools = makeTools([], []);
    tools[1] = {
      ...tools[1]!,
      authorize: () => false,
      execute: async () => {
        publishCalls += 1;
        return createPigeTextToolResult("should not run");
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
        return createPigeTextToolResult("Inspected.");
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
        return createPigeTextToolResult("Inspected.");
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
        return createPigeTextToolResult("should not run");
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
        return createPigeTextToolResult("should not run");
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
      execute: async () => createPigeTextToolResult("different handler instance")
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
        return createPigeTextToolResult("unreachable");
      }
    }];
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [{ kind: "tool_call", toolName: "pige_inspect_source", args: {} }]
    });
    const run = adapter.run({
      ...makeRequest(tools),
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

function makeRequest(tools: readonly PigeAgentToolDefinition[]) {
  return {
    runtimeConfig,
    jobId: "job_20260711_piagent01",
    systemPrompt: "Use only Pige-owned tools.",
    userPrompt: "Inspect the current source and publish grounded knowledge.",
    tools
  };
}

function messageUpdate(assistantMessageEvent: unknown): AgentEvent {
  const partial = (assistantMessageEvent as { partial: unknown }).partial;
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent
  } as AgentEvent;
}

function assistantMessage(content: readonly unknown[]): unknown {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "pige-faux:provider_pi_test",
    model: "pi-selected-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "toolUse",
    timestamp: Date.parse("2026-07-17T00:00:00.000Z")
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
        return createPigeTextToolResult(
          JSON.stringify({ evidence: [{ ref: "ev_01", text: "Synthetic evidence" }] }),
          { fragmentCount: 1 }
        );
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
        return createPigeTextToolResult(
          JSON.stringify({ status: "created" }),
          {}
        );
      }
    }
  ];
}
