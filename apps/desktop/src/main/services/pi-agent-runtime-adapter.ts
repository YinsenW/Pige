import { Agent } from "@earendil-works/pi-agent-core";
import { PigeDomainError } from "@pige/domain";
import {
  PiCompletionPolicy,
  type PiAgentCompletionBoundary
} from "./pi-agent-completion-policy";
import { createPiBinding, type PiFauxResponse } from "./pi-agent-provider-binding";
import {
  SafeTerminalDraftController,
  appendEventRecord,
  collectAssistantText,
  createPiHistoryMessages,
  toEventRecord,
  type PiAgentEventRecord,
  type PiAgentHistoryMessage,
  type PiAgentTerminalDraftBoundary
} from "./pi-agent-safe-projection";
import {
  assertPigeAgentToolDescriptors,
  createPigeAgentToolCallContext,
  isPigeToolInputWithinLimit,
  toPiTool,
  type PigeAgentToolDefinition
} from "./pi-agent-tool-boundary";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";

export {
  AgentRepairRequiredError,
  createAgentRepairFeedback,
  type AgentRepairFeedback,
  type PiAgentCompletionBoundary
} from "./pi-agent-completion-policy";
export type { PiFauxResponse } from "./pi-agent-provider-binding";
export type {
  PiAgentEventRecord,
  PiAgentHistoryMessage,
  PiAgentTerminalDraftBoundary
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
  readonly completionPolicy?: PiAgentCompletionBoundary;
  readonly terminalDraft?: PiAgentTerminalDraftBoundary;
  readonly signal?: AbortSignal;
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
    const completionPolicy = new PiCompletionPolicy(
      request.completionPolicy,
      tools.map((tool) => tool.name)
    );
    const binding = createPiBinding(request.runtimeConfig, this.#options.fauxResponses);
    const history = createPiHistoryMessages(request.history ?? [], binding.model);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const terminalDrafts = new SafeTerminalDraftController(request.terminalDraft);
    const events: PiAgentEventRecord[] = [];
    const invokedTools: string[] = [];
    let streamUpdateCount = 0;
    let beforeModelTurnFailure: unknown;
    let controlFlowFailure: PigeDomainError | undefined;
    let abortForControlFlowFailure: (() => void) | undefined;

    const runBeforeModelTurn = async (): Promise<void> => {
      try {
        completionPolicy.assertCanContinue();
        await request.beforeModelTurn?.();
      } catch (caught) {
        beforeModelTurnFailure = caught;
        throw caught;
      }
    };

    const agent = new Agent({
      initialState: {
        systemPrompt: request.systemPrompt,
        model: binding.model,
        thinkingLevel: "off",
        tools: tools.map((tool) => toPiTool(tool, toolsByName, {
          onRepair: (executedTool, feedback) => {
            completionPolicy.recordRepair(feedback);
            terminalDrafts.rejectAttempt(executedTool.name);
          },
          afterExecute: (executedTool, args, result) =>
            terminalDrafts.afterToolExecute(executedTool, args, result).then((presented) => {
              if (presented.terminate === true) {
                completionPolicy.recordTerminalAccepted(executedTool.name);
                completionPolicy.recordHostSettled();
              }
              return presented;
            }),
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
        })),
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
        if (!tool) {
          return { block: true, reason: "The requested tool is not registered for this Pige action." };
        }
        completionPolicy.recordToolCall(tool.name, args);
        const context = createPigeAgentToolCallContext(
          toolCall.id,
          request.signal ?? NEVER_ABORTED_SIGNAL
        );
        if (!context || !isPigeToolInputWithinLimit(args, tool.limits.maxInputBytes)) {
          return { block: true, reason: "Pige rejected invalid tool-call metadata or arguments." };
        }
        if (tool.authorize && !(await tool.authorize(args, context))) {
          completionPolicy.recordTerminalBlocked(tool.name);
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
      terminalDrafts.observe(event);
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
      await terminalDrafts.assertCompleteAndSettle();
      if (request.signal?.aborted) throw createAbortError();
      if (beforeModelTurnFailure) throw beforeModelTurnFailure;
      if (agent.state.errorMessage && completionPolicy.repairAttempted()) {
        completionPolicy.assertCanContinue();
      }
      if (
        agent.state.errorMessage &&
        binding.mode === "faux" &&
        completionPolicy.shouldReportProtocolOnFauxExhaustion()
      ) {
        throw new PigeDomainError(
          "model_provider.tool_protocol_incompatible",
          "The synthetic Pi provider exhausted its responses after a rejected semantic result."
        );
      }
      if (agent.state.errorMessage) {
        throw new PigeDomainError("model_provider.call_failed", "The embedded Pi Agent turn failed.");
      }
      const assistantText = collectAssistantText(agent.state.messages.slice(history.length));
      completionPolicy.assertCompleted(assistantText);
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

function createAbortError(): Error {
  const error = new Error("The embedded Pi Agent turn was cancelled.");
  error.name = "AbortError";
  return error;
}
