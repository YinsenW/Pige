import { Buffer } from "node:buffer";
import { Agent } from "@earendil-works/pi-agent-core";
import { PigeDomainError } from "@pige/domain";
import { createPiBinding, type PiFauxResponse } from "./pi-agent-provider-binding";
import {
  SafeAssistantDraftController,
  appendEventRecord,
  collectAssistantText,
  createPiHistoryMessages,
  toEventRecord,
  type PiAgentEventRecord,
  type PiAgentHistoryMessage,
  type PiAgentDraftBoundary
} from "./pi-agent-safe-projection";
import {
  assertPigeAgentToolDescriptors,
  createPigeAgentToolCallContext,
  isPigeToolInputWithinLimit,
  toPiTool,
  type PigeAgentToolDefinition
} from "./pi-agent-tool-boundary";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";

export type { PiFauxResponse } from "./pi-agent-provider-binding";
export type {
  PiAgentDraftBoundary,
  PiAgentEventRecord,
  PiAgentHistoryMessage
} from "./pi-agent-safe-projection";
export {
  MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES,
  createPigeAgentToolCatalogHash,
  createPigeTextToolResult,
  type PigeAgentToolCallContext,
  type PigeAgentToolDataBoundary,
  type PigeAgentToolDefinition,
  type PigeAgentToolDescriptor,
  type PigeAgentToolEffect,
  type PigeAgentToolExecution,
  type PigeAgentToolExecutionLimits,
  type PigeAgentToolIdempotency,
  type PigeAgentToolResult,
  type PigeAgentToolTrust
} from "./pi-agent-tool-boundary";

export interface PiAgentRunRequest {
  readonly runtimeConfig: ModelProviderRuntimeConfig;
  readonly jobId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly history?: readonly PiAgentHistoryMessage[];
  readonly tools: readonly PigeAgentToolDefinition[];
  readonly beforeModelTurn?: () => void | Promise<void>;
  readonly limits?: PiAgentRunLimits;
  readonly draft?: PiAgentDraftBoundary;
  readonly signal?: AbortSignal;
}

export interface PiAgentRunLimits {
  readonly maxWallTimeMs: number;
  readonly maxToolCalls: number;
  readonly maxWorkBytes: number;
  readonly maxAssistantCharacters: number;
}

export interface PiAgentRunResult {
  readonly adapterMode: "embedded_pi_sdk";
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly modelId: string;
  readonly events: readonly PiAgentEventRecord[];
  readonly assistantText: string;
  readonly invokedTools: readonly string[];
}

export interface PiAgentRuntimeAdapterOptions {
  readonly fauxResponses?: readonly PiFauxResponse[];
}

const MAX_TURN_STREAM_UPDATES = 1_048_576;
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export class PiAgentRuntimeAdapter {
  readonly #options: PiAgentRuntimeAdapterOptions;

  constructor(options: PiAgentRuntimeAdapterOptions = {}) {
    this.#options = options;
  }

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    if (request.signal?.aborted) throw createAbortError();
    const tools = request.tools;
    assertPigeAgentToolDescriptors(tools);
    const budget = new PiAgentRunBudget(request.limits);
    const binding = createPiBinding(request.runtimeConfig, this.#options.fauxResponses);
    const history = createPiHistoryMessages(request.history ?? [], binding.model);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const drafts = new SafeAssistantDraftController(request.draft);
    const events: PiAgentEventRecord[] = [];
    const invokedTools: string[] = [];
    let streamUpdateCount = 0;
    let beforeModelTurnFailure: unknown;
    let controlFlowFailure: PigeDomainError | undefined;
    let abortForControlFlowFailure: (() => void) | undefined;

    const runBeforeModelTurn = async (): Promise<void> => {
      try {
        budget.assertCanContinue();
        await request.beforeModelTurn?.();
      } catch (caught) {
        beforeModelTurnFailure = caught;
        throw caught;
      }
    };

    const bridgedTools = tools.map((tool) => toPiTool(tool, toolsByName, {
      afterExecute: (_executedTool, _args, result) => result,
      onError: (caught) => {
        if (
          caught instanceof PigeDomainError &&
          !controlFlowFailure &&
          (caught.code.startsWith("permission.") ||
            caught.code === "agent_runtime.dynamic_tool_activation_forbidden")
        ) {
          controlFlowFailure = caught;
          abortForControlFlowFailure?.();
        }
      }
    }));
    const bridgedToolsByName = new Map(bridgedTools.map((tool) => [tool.name, tool]));
    const agent = new Agent({
      initialState: {
        systemPrompt: request.systemPrompt,
        model: binding.model,
        thinkingLevel: "off",
        tools: bridgedTools,
        messages: history
      },
      streamFn: (model, context, options) => binding.streamSimple(model, context, options),
      sessionId: request.jobId,
      steeringMode: "one-at-a-time",
      prepareNextTurnWithContext: async ({ message }) => {
        if (message.stopReason === "toolUse") {
          await runBeforeModelTurn();
        }
        return undefined;
      },
      beforeToolCall: async ({ toolCall, args }) => {
        const tool = toolsByName.get(toolCall.name);
        const bridgedTool = bridgedToolsByName.get(toolCall.name);
        if (!tool || !bridgedTool) {
          return { block: true, reason: "The requested tool is not registered for this Pige action." };
        }
        let preparedArgs: unknown;
        try {
          const prepareArguments = bridgedTool.prepareArguments;
          if (!prepareArguments) throw new Error("Missing registered tool argument validator.");
          preparedArgs = prepareArguments(args);
        } catch {
          return { block: true, reason: "Pige rejected invalid registered tool arguments." };
        }
        budget.recordToolCall(tool.name, preparedArgs);
        const context = createPigeAgentToolCallContext(
          toolCall.id,
          request.signal ?? NEVER_ABORTED_SIGNAL
        );
        if (!context || !isPigeToolInputWithinLimit(preparedArgs, tool.limits.maxInputBytes)) {
          return { block: true, reason: "Pige rejected invalid tool-call metadata or arguments." };
        }
        if (tool.authorize && !(await tool.authorize(preparedArgs, context))) {
          return { block: true, reason: "Pige policy did not authorize this tool call." };
        }
        return undefined;
      }
    });
    abortForControlFlowFailure = () => agent.abort();

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_update" && ++streamUpdateCount > MAX_TURN_STREAM_UPDATES) {
        agent.abort();
        return;
      }
      if (!appendEventRecord(events, toEventRecord(event))) {
        agent.abort();
        return;
      }
      drafts.observe(event);
      if (event.type === "tool_execution_start") invokedTools.push(event.toolName);
    });
    const onAbort = (): void => agent.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await runBeforeModelTurn();
      if (request.signal?.aborted) throw createAbortError();
      try {
        await agent.prompt(request.userPrompt);
      } catch (caught) {
        if (controlFlowFailure) throw controlFlowFailure;
        throw caught;
      }
      if (controlFlowFailure) throw controlFlowFailure;
      await drafts.assertCompleteAndSettle();
      if (request.signal?.aborted) throw createAbortError();
      if (beforeModelTurnFailure) throw beforeModelTurnFailure;
      if (agent.state.errorMessage) {
        throw new PigeDomainError("model_provider.call_failed", "The embedded Pi Agent turn failed.");
      }
      const assistantText = collectAssistantText(agent.state.messages.slice(history.length));
      if (
        assistantText.trim().length === 0 ||
        Array.from(assistantText).length > (request.limits?.maxAssistantCharacters ?? 8_000) ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(assistantText)
      ) {
        throw new PigeDomainError(
          "model_provider.tool_protocol_incompatible",
          "The embedded Pi Agent turn ended without an assistant message."
        );
      }
      return {
        adapterMode: "embedded_pi_sdk",
        providerProfileId: request.runtimeConfig.provider.id,
        modelProfileId: request.runtimeConfig.model.id,
        modelId: binding.model.id,
        events,
        assistantText,
        invokedTools
      };
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      agent.reset();
    }
  }
}

class PiAgentRunBudget {
  readonly #limits: PiAgentRunLimits | undefined;
  readonly #startedAt = Date.now();
  #toolCalls = 0;
  #workBytes = 0;

  constructor(limits: PiAgentRunLimits | undefined) {
    if (limits && !isValidRunLimits(limits)) {
      throw new PigeDomainError("agent_runtime.tool_protocol_incompatible", "The Pi runtime limits are invalid.");
    }
    this.#limits = limits;
  }

  recordToolCall(toolName: string, args: unknown): void {
    if (!this.#limits) return;
    this.#toolCalls += 1;
    this.#workBytes += Buffer.byteLength(toolName, "utf8") + canonicalByteLength(args);
    this.assertCanContinue();
  }

  assertCanContinue(): void {
    if (!this.#limits) return;
    if (
      Date.now() - this.#startedAt > this.#limits.maxWallTimeMs ||
      this.#toolCalls > this.#limits.maxToolCalls ||
      this.#workBytes > this.#limits.maxWorkBytes
    ) {
      throw new PigeDomainError("agent_runtime.resource_limit_exceeded", "The Pi turn exceeded its resource limits.");
    }
  }
}

function isValidRunLimits(limits: PiAgentRunLimits): boolean {
  return Number.isSafeInteger(limits.maxWallTimeMs) && limits.maxWallTimeMs >= 1_000 && limits.maxWallTimeMs <= 600_000 &&
    Number.isSafeInteger(limits.maxToolCalls) && limits.maxToolCalls >= 1 && limits.maxToolCalls <= 256 &&
    Number.isSafeInteger(limits.maxWorkBytes) && limits.maxWorkBytes >= 4_096 && limits.maxWorkBytes <= 1_048_576 &&
    Number.isSafeInteger(limits.maxAssistantCharacters) && limits.maxAssistantCharacters >= 1 &&
      limits.maxAssistantCharacters <= 1_048_576;
}

function canonicalByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "undefined", "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function createAbortError(): Error {
  const error = new Error("The embedded Pi Agent turn was cancelled.");
  error.name = "AbortError";
  return error;
}
