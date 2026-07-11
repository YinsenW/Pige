import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Api,
  type AuthContext,
  type Credential,
  type CredentialStore,
  type Model,
  type ProviderStreams,
  type TSchema
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { PigeDomainError } from "@pige/domain";
import type { ModelProviderRuntimeConfig } from "./model-provider-registry";
import { normalizeProviderBaseUrl } from "./provider-base-url";

export interface PigeAgentToolResult {
  readonly modelText: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly terminate?: boolean;
}

export interface PigeAgentToolDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly authorize?: (args: unknown) => boolean | Promise<boolean>;
  readonly execute: (args: unknown, signal: AbortSignal) => Promise<PigeAgentToolResult>;
}

export interface PiAgentRunRequest {
  readonly runtimeConfig: ModelProviderRuntimeConfig;
  readonly jobId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools: readonly PigeAgentToolDefinition[];
  readonly beforeModelTurn?: () => void | Promise<void>;
  readonly signal?: AbortSignal;
}

export interface PiAgentEventRecord {
  readonly type: AgentEvent["type"];
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly isError?: boolean;
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

export type PiFauxResponse =
  | {
      readonly kind: "tool_call";
      readonly toolName: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId?: string;
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

export interface PiAgentRuntimeAdapterOptions {
  readonly fauxResponses?: readonly PiFauxResponse[];
}

interface ScopedPiBinding {
  readonly model: Model<Api>;
  readonly streamSimple: StreamFn;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const MAX_TURN_EVENTS = 512;

const denyAmbientAuthContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false
};

export class PiAgentRuntimeAdapter {
  readonly #options: PiAgentRuntimeAdapterOptions;

  constructor(options: PiAgentRuntimeAdapterOptions = {}) {
    this.#options = options;
  }

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    if (request.signal?.aborted) throw createAbortError();
    assertUniqueTools(request.tools);
    const binding = this.#createBinding(request.runtimeConfig);
    const toolsByName = new Map(request.tools.map((tool) => [tool.name, tool]));
    const events: PiAgentEventRecord[] = [];
    const invokedTools: string[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: request.systemPrompt,
        model: binding.model,
        thinkingLevel: "off",
        tools: request.tools.map(toPiTool)
      },
      streamFn: (model, context, options) => binding.streamSimple(model, context, options),
      sessionId: request.jobId,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      toolExecution: "sequential",
      prepareNextTurnWithContext: async () => {
        await request.beforeModelTurn?.();
        return undefined;
      },
      beforeToolCall: async ({ toolCall, args }) => {
        const tool = toolsByName.get(toolCall.name);
        if (!tool) {
          return { block: true, reason: "The requested tool is not registered for this Pige action." };
        }
        if (tool.authorize && !(await tool.authorize(args))) {
          return { block: true, reason: "Pige policy did not authorize this tool call." };
        }
        return undefined;
      }
    });

    const unsubscribe = agent.subscribe((event) => {
      if (events.length >= MAX_TURN_EVENTS) {
        agent.abort();
        return;
      }
      const record = toEventRecord(event);
      events.push(record);
      if (event.type === "tool_execution_start") invokedTools.push(event.toolName);
    });
    const onAbort = (): void => agent.abort();
    if (request.signal?.aborted) {
      onAbort();
    } else {
      request.signal?.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await request.beforeModelTurn?.();
      if (request.signal?.aborted) throw createAbortError();
      await agent.prompt(request.userPrompt);
      if (request.signal?.aborted) throw createAbortError();
      if (agent.state.errorMessage) {
        throw new PigeDomainError("model_provider.call_failed", "The embedded Pi Agent turn failed.");
      }
      return {
        adapterMode: "embedded_pi_sdk",
        providerProfileId: request.runtimeConfig.provider.id,
        modelProfileId: request.runtimeConfig.model.id,
        modelId: binding.model.id,
        events,
        assistantText: collectAssistantText(agent.state.messages),
        invokedTools
      };
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      agent.clearAllQueues();
      agent.reset();
    }
  }

  #createBinding(config: ModelProviderRuntimeConfig): ScopedPiBinding {
    if (this.#options.fauxResponses) {
      return createFauxBinding(config, this.#options.fauxResponses);
    }
    return createProviderBinding(config);
  }
}

function createProviderBinding(config: ModelProviderRuntimeConfig): ScopedPiBinding {
  const anthropic = config.provider.providerKind === "anthropic" ||
    config.provider.providerKind === "anthropic_compatible";
  const api = anthropic
    ? "anthropic-messages"
    : config.provider.providerKind === "openai"
      ? "openai-responses"
      : "openai-completions";
  const baseUrl = normalizeProviderBaseUrl(
    config.provider.baseUrl ?? (anthropic ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL)
  );
  const providerId = `pige:${config.provider.id}`;
  const model: Model<typeof api> = {
    id: config.model.modelId,
    name: config.model.displayName ?? config.model.modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 4_096
  };
  const credentials = new ScopedCredentialStore(providerId, config.apiKey);
  const models = createModels({ credentials, authContext: denyAmbientAuthContext });
  models.setProvider(createProvider({
    id: providerId,
    name: config.provider.displayName,
    baseUrl,
    auth: {
      apiKey: {
        name: "Pige brokered provider credential",
        resolve: async ({ credential }) => credential?.key
          ? { auth: { apiKey: credential.key }, source: "pige_credential_store" }
          : undefined
      }
    },
    models: [model],
    api: (anthropic
      ? anthropicMessagesApi()
      : config.provider.providerKind === "openai"
        ? openAIResponsesApi()
        : openAICompletionsApi()) as ProviderStreams
  }));
  const selected = models.getModel(providerId, config.model.modelId);
  if (!selected) {
    throw new PigeDomainError("model_provider.model_not_found", "The selected model is unavailable in the scoped Pi runtime.");
  }
  return {
    model: selected,
    streamSimple: (model, context, options) => models.streamSimple(model, context, options)
  };
}

function createFauxBinding(
  config: ModelProviderRuntimeConfig,
  responses: readonly PiFauxResponse[]
): ScopedPiBinding {
  const providerId = `pige-faux:${config.provider.id}`;
  const faux = fauxProvider({
    provider: providerId,
    models: [{ id: config.model.modelId, name: config.model.displayName ?? config.model.modelId }]
  });
  faux.setResponses(responses.map((response, index) => response.kind === "text"
    ? fauxAssistantMessage(fauxText(response.text))
    : fauxAssistantMessage(
        fauxToolCall(response.toolName, response.args, {
          id: response.toolCallId ?? `pi_tool_${index + 1}`
        }),
        { stopReason: "toolUse" }
      )));
  const models = createModels({ authContext: denyAmbientAuthContext });
  models.setProvider(faux.provider);
  const selected = models.getModel(providerId, config.model.modelId);
  if (!selected) {
    throw new PigeDomainError("model_provider.model_not_found", "The selected faux model is unavailable in the scoped Pi runtime.");
  }
  return {
    model: selected,
    streamSimple: (model, context, options) => models.streamSimple(model, context, options)
  };
}

class ScopedCredentialStore implements CredentialStore {
  readonly #providerId: string;
  readonly #credential: Credential;

  constructor(providerId: string, apiKey: string) {
    this.#providerId = providerId;
    this.#credential = { type: "api_key", key: apiKey };
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === this.#providerId ? this.#credential : undefined;
  }

  async modify(
    _providerId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    throw new PigeDomainError("model_provider.credential_mutation_forbidden", "The scoped Pi runtime cannot mutate provider credentials.");
  }

  async delete(): Promise<void> {
    throw new PigeDomainError("model_provider.credential_mutation_forbidden", "The scoped Pi runtime cannot mutate provider credentials.");
  }
}

function toPiTool(tool: PigeAgentToolDefinition): AgentTool<TSchema, Readonly<Record<string, unknown>>> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as TSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, args, signal) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      const result = await tool.execute(args, effectiveSignal);
      return {
        content: [{ type: "text", text: result.modelText }],
        details: result.details,
        ...(result.terminate === undefined ? {} : { terminate: result.terminate })
      };
    }
  };
}

function toEventRecord(event: AgentEvent): PiAgentEventRecord {
  if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
    return {
      type: event.type,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      ...(event.type === "tool_execution_end" ? { isError: event.isError } : {})
    };
  }
  if (event.type === "tool_execution_update") {
    return { type: event.type, toolName: event.toolName, toolCallId: event.toolCallId };
  }
  return { type: event.type };
}

function collectAssistantText(messages: readonly unknown[]): string {
  const values: string[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
        values.push(content.text);
      }
    }
  }
  return values.join("\n").trim();
}

function assertUniqueTools(tools: readonly PigeAgentToolDefinition[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (!/^[a-z][a-z0-9_]{2,63}$/u.test(tool.name) || names.has(tool.name)) {
      throw new PigeDomainError("agent_runtime.tool_registry_invalid", "The Pige Agent tool registry is invalid.");
    }
    names.add(tool.name);
  }
}

function createAbortError(): Error {
  const error = new Error("The embedded Pi Agent turn was cancelled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
