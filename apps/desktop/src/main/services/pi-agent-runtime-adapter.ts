import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
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

export interface PigeAgentToolCallContext {
  readonly toolCallId: string;
  readonly signal: AbortSignal;
}

export type PigeAgentToolEffect =
  | "read_only"
  | "compute"
  | "proposal"
  | "idempotent_write"
  | "destructive";

export type PigeAgentToolTrust = "model_generated" | "untrusted_source" | "host_validated";

export type PigeAgentToolExecution = "sequential" | "parallel_read_only";

export interface PigeAgentToolDataBoundary {
  readonly resourceScope: "none" | "current_source" | "current_vault";
  readonly pathAuthority: "host_only";
  readonly sourceIdAuthority: "host_only";
  readonly modelAuthority: "none";
}

export interface PigeAgentToolIdempotency {
  readonly mode: "idempotent" | "non_idempotent";
  readonly scope: "current_source" | "current_vault" | "tool_call" | "none";
}

export interface PigeAgentToolExecutionLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface PigeAgentToolDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly version?: string;
  readonly capability?: string;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly effect?: PigeAgentToolEffect;
  readonly inputTrust?: PigeAgentToolTrust;
  readonly outputTrust?: PigeAgentToolTrust;
  readonly dataBoundary?: PigeAgentToolDataBoundary;
  readonly execution?: PigeAgentToolExecution;
  readonly idempotency?: PigeAgentToolIdempotency;
  readonly limits?: PigeAgentToolExecutionLimits;
  readonly ownerService?: string;
  readonly authorize?: (
    args: unknown,
    context: PigeAgentToolCallContext
  ) => boolean | Promise<boolean>;
  readonly execute: (
    args: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext
  ) => Promise<PigeAgentToolResult>;
}

export interface PigeAgentToolDescriptor extends PigeAgentToolDefinition {
  readonly version: string;
  readonly capability: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly effect: PigeAgentToolEffect;
  readonly inputTrust: PigeAgentToolTrust;
  readonly outputTrust: PigeAgentToolTrust;
  readonly dataBoundary: PigeAgentToolDataBoundary;
  readonly execution: PigeAgentToolExecution;
  readonly idempotency: PigeAgentToolIdempotency;
  readonly limits: PigeAgentToolExecutionLimits;
  readonly ownerService: string;
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
      readonly toolCallId?: unknown;
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
const KEYLESS_PROVIDER_TRANSPORT_SENTINEL = "pige-keyless-provider";
const MAX_TURN_EVENTS = 512;
export const MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES = 256;

const PIGE_AGENT_TOOL_CATALOG_HASH_DOMAIN = "pige.agent_tool_catalog.v1";
const MAX_PIGE_AGENT_TOOLS = 64;
const MAX_DESCRIPTOR_LABEL_UTF8_BYTES = 128;
const MAX_DESCRIPTOR_DESCRIPTION_UTF8_BYTES = 2_048;
const MAX_DESCRIPTOR_SCHEMA_UTF8_BYTES = 65_536;
const MAX_DESCRIPTOR_CATALOG_UTF8_BYTES = 524_288;
const MAX_DESCRIPTOR_LIMIT_BYTES = 1_048_576;
const MAX_DESCRIPTOR_TIMEOUT_MS = 600_000;
const MAX_CANONICAL_JSON_DEPTH = 32;
const MAX_CANONICAL_JSON_NODES = 8_192;
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

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
    const tools = request.tools;
    assertPigeAgentToolDescriptors(tools);
    const binding = this.#createBinding(request.runtimeConfig);
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const events: PiAgentEventRecord[] = [];
    const invokedTools: string[] = [];
    let hasBeforeModelTurnFailure = false;
    let beforeModelTurnFailure: unknown;
    const runBeforeModelTurn = async (): Promise<void> => {
      try {
        await request.beforeModelTurn?.();
      } catch (caught) {
        hasBeforeModelTurnFailure = true;
        beforeModelTurnFailure = caught;
        throw caught;
      }
    };
    const agent = new Agent({
      initialState: {
        systemPrompt: request.systemPrompt,
        model: binding.model,
        thinkingLevel: "off",
        tools: tools.map(toPiTool)
      },
      streamFn: (model, context, options) => binding.streamSimple(model, context, options),
      sessionId: request.jobId,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      toolExecution: "sequential",
      prepareNextTurnWithContext: async () => {
        await runBeforeModelTurn();
        return undefined;
      },
      beforeToolCall: async ({ toolCall, args }) => {
        const tool = toolsByName.get(toolCall.name);
        if (!tool) {
          return { block: true, reason: "The requested tool is not registered for this Pige action." };
        }
        const context = createPigeAgentToolCallContext(toolCall.id, request.signal ?? NEVER_ABORTED_SIGNAL);
        if (!context || !isWithinCanonicalJsonByteLimit(args, tool.limits.maxInputBytes)) {
          return { block: true, reason: "Pige rejected invalid tool-call metadata or arguments." };
        }
        if (tool.authorize && !(await tool.authorize(args, context))) {
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
      await runBeforeModelTurn();
      if (request.signal?.aborted) throw createAbortError();
      await agent.prompt(request.userPrompt);
      if (request.signal?.aborted) throw createAbortError();
      if (hasBeforeModelTurnFailure) throw beforeModelTurnFailure;
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

export function createPigeAgentToolCatalogHash(
  tools: readonly PigeAgentToolDefinition[]
): string {
  assertPigeAgentToolDescriptors(tools);
  const catalog = tools.map((tool) => ({
    name: tool.name,
    version: tool.version,
    description: tool.description,
    capability: tool.capability,
    parameters: tool.parameters,
    outputSchema: tool.outputSchema,
    effect: tool.effect,
    inputTrust: tool.inputTrust,
    outputTrust: tool.outputTrust,
    dataBoundary: tool.dataBoundary,
    execution: tool.execution,
    idempotency: tool.idempotency,
    limits: tool.limits,
    ownerService: tool.ownerService
  }));
  const canonicalCatalog = canonicalRegistryJson(catalog, MAX_DESCRIPTOR_CATALOG_UTF8_BYTES);
  const hash = createHash("sha256");
  hash.update(PIGE_AGENT_TOOL_CATALOG_HASH_DOMAIN, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalCatalog, "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function createProviderBinding(config: ModelProviderRuntimeConfig): ScopedPiBinding {
  const api = toPiApi(config.provider.endpointProtocol);
  const baseUrl = resolveProviderBaseUrl(config);
  const providerId = `pige:${config.provider.id}`;
  const keyless = config.apiKey === undefined && config.provider.authRequirement !== "api_key";
  const model: Model<Api> = {
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
    auth: config.apiKey ? {
        apiKey: {
          name: "Pige brokered provider credential",
          resolve: async ({ credential }) => credential?.key
            ? { auth: { apiKey: credential.key }, source: "pige_credential_store" }
            : undefined
        }
      } : keyless ? {
        apiKey: {
          name: "Pige keyless provider",
          resolve: async () => ({
            auth: {
              apiKey: KEYLESS_PROVIDER_TRANSPORT_SENTINEL,
              headers: { Authorization: null, "x-api-key": null }
            },
            source: "pige_keyless_provider"
          })
        }
      } : {},
    models: [model],
    api: providerStreams(config.provider.endpointProtocol)
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

function resolveProviderBaseUrl(config: ModelProviderRuntimeConfig): string {
  if (config.provider.baseUrl) return normalizeProviderBaseUrl(config.provider.baseUrl);
  if (config.provider.providerKind === "openai" || config.provider.providerKind === "anthropic") {
    return defaultBaseUrl(config.provider.endpointProtocol);
  }
  throw new PigeDomainError(
    "model_provider.base_url_missing",
    "Compatible and custom providers require an explicit endpoint."
  );
}

function toPiApi(endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]): Api {
  switch (endpointProtocol) {
    case "openai_responses":
      return "openai-responses";
    case "openai_chat_completions":
      return "openai-completions";
    case "anthropic_messages":
      return "anthropic-messages";
    default:
      throw unsupportedEndpointProtocolError();
  }
}

function defaultBaseUrl(
  endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]
): string {
  return endpointProtocol === "anthropic_messages"
    ? DEFAULT_ANTHROPIC_BASE_URL
    : DEFAULT_OPENAI_BASE_URL;
}

function providerStreams(
  endpointProtocol: ModelProviderRuntimeConfig["provider"]["endpointProtocol"]
): ProviderStreams {
  switch (endpointProtocol) {
    case "openai_responses":
      return openAIResponsesApi();
    case "openai_chat_completions":
      return openAICompletionsApi();
    case "anthropic_messages":
      return anthropicMessagesApi();
    default:
      throw unsupportedEndpointProtocolError();
  }
}

function unsupportedEndpointProtocolError(): PigeDomainError {
  return new PigeDomainError(
    "model_provider.protocol_unsupported",
    "The selected provider endpoint protocol is unavailable."
  );
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
  faux.setResponses(responses.map((response, index) => {
    if (response.kind === "text") return fauxAssistantMessage(fauxText(response.text));
    const generatedCall = fauxToolCall(response.toolName, response.args, {
      id: `pi_tool_${index + 1}`
    });
    const toolCall = Object.prototype.hasOwnProperty.call(response, "toolCallId")
      ? { ...generatedCall, id: response.toolCallId } as typeof generatedCall
      : generatedCall;
    return fauxAssistantMessage(toolCall, { stopReason: "toolUse" });
  }));
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
  readonly #credential: Credential | undefined;

  constructor(providerId: string, apiKey: string | undefined) {
    this.#providerId = providerId;
    this.#credential = apiKey ? { type: "api_key", key: apiKey } : undefined;
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

function toPiTool(tool: PigeAgentToolDescriptor): AgentTool<TSchema, Readonly<Record<string, unknown>>> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as TSchema,
    executionMode: tool.execution === "parallel_read_only" ? "parallel" : "sequential",
    execute: async (toolCallId, args, signal) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      const context = createPigeAgentToolCallContext(toolCallId, effectiveSignal);
      if (!context) throw invalidToolCallError();
      assertToolInputWithinLimit(args, tool.limits.maxInputBytes);
      const result = await tool.execute(args, effectiveSignal, context);
      assertPigeAgentToolResult(result, tool.limits.maxOutputBytes);
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
      ...(event.type === "tool_execution_end" ? { isError: event.isError } : {})
    };
  }
  if (event.type === "tool_execution_update") {
    return { type: event.type, toolName: event.toolName };
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

function assertPigeAgentToolDescriptors(
  tools: readonly PigeAgentToolDefinition[]
): asserts tools is readonly PigeAgentToolDescriptor[] {
  if (tools.length > MAX_PIGE_AGENT_TOOLS) throw invalidToolRegistryError();
  const names = new Set<string>();
  for (const tool of tools) {
    if (
      !/^[a-z][a-z0-9_]{2,63}$/u.test(tool.name) ||
      names.has(tool.name) ||
      !isBoundedString(tool.label, 1, MAX_DESCRIPTOR_LABEL_UTF8_BYTES) ||
      !isBoundedString(tool.description, 1, MAX_DESCRIPTOR_DESCRIPTION_UTF8_BYTES) ||
      typeof tool.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(tool.version) ||
      typeof tool.capability !== "string" ||
      !/^[a-z][a-z0-9_.:-]{2,127}$/u.test(tool.capability) ||
      !isPigeAgentToolEffect(tool.effect) ||
      !isPigeAgentToolTrust(tool.inputTrust) ||
      !isPigeAgentToolTrust(tool.outputTrust) ||
      !isPigeAgentToolDataBoundary(tool.dataBoundary) ||
      !isPigeAgentToolExecution(tool.execution) ||
      !isPigeAgentToolIdempotency(tool.idempotency) ||
      !isPigeAgentToolLimits(tool.limits) ||
      typeof tool.ownerService !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.-]{2,127}$/u.test(tool.ownerService) ||
      typeof tool.execute !== "function" ||
      (tool.authorize !== undefined && typeof tool.authorize !== "function")
    ) throw invalidToolRegistryError();
    if (
      tool.execution === "parallel_read_only" &&
      (tool.effect !== "read_only" || tool.idempotency.mode !== "idempotent")
    ) throw invalidToolRegistryError();
    assertStrictObjectSchema(tool.parameters);
    assertStrictObjectSchema(tool.outputSchema);
    names.add(tool.name);
  }
}

function assertStrictObjectSchema(schema: unknown): void {
  if (
    !isRecord(schema) ||
    Array.isArray(schema) ||
    schema.type !== "object" ||
    !isRecord(schema.properties) ||
    Array.isArray(schema.properties) ||
    schema.additionalProperties !== false
  ) throw invalidToolRegistryError();
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) throw invalidToolRegistryError();
    const required = new Set<string>();
    for (const value of schema.required) {
      if (
        typeof value !== "string" ||
        required.has(value) ||
        !Object.prototype.hasOwnProperty.call(schema.properties, value)
      ) throw invalidToolRegistryError();
      required.add(value);
    }
  }
  canonicalRegistryJson(schema, MAX_DESCRIPTOR_SCHEMA_UTF8_BYTES);
}

function isPigeAgentToolEffect(value: unknown): value is PigeAgentToolEffect {
  return value === "read_only" || value === "compute" || value === "proposal" ||
    value === "idempotent_write" || value === "destructive";
}

function isPigeAgentToolTrust(value: unknown): value is PigeAgentToolTrust {
  return value === "model_generated" || value === "untrusted_source" || value === "host_validated";
}

function isPigeAgentToolExecution(value: unknown): value is PigeAgentToolExecution {
  return value === "sequential" || value === "parallel_read_only";
}

function isPigeAgentToolDataBoundary(value: unknown): value is PigeAgentToolDataBoundary {
  return isExactRecord(value, ["resourceScope", "pathAuthority", "sourceIdAuthority", "modelAuthority"]) &&
    (value.resourceScope === "none" || value.resourceScope === "current_source" || value.resourceScope === "current_vault") &&
    value.pathAuthority === "host_only" &&
    value.sourceIdAuthority === "host_only" &&
    value.modelAuthority === "none";
}

function isPigeAgentToolIdempotency(value: unknown): value is PigeAgentToolIdempotency {
  if (!isExactRecord(value, ["mode", "scope"])) return false;
  return value.mode === "idempotent"
    ? value.scope === "none" || value.scope === "current_source" || value.scope === "current_vault" || value.scope === "tool_call"
    : value.mode === "non_idempotent" && value.scope === "none";
}

function isPigeAgentToolLimits(value: unknown): value is PigeAgentToolExecutionLimits {
  if (!isExactRecord(value, ["maxInputBytes", "maxOutputBytes", "timeoutMs"])) return false;
  return isBoundedPositiveInteger(value.maxInputBytes, MAX_DESCRIPTOR_LIMIT_BYTES) &&
    isBoundedPositiveInteger(value.maxOutputBytes, MAX_DESCRIPTOR_LIMIT_BYTES) &&
    isBoundedPositiveInteger(value.timeoutMs, MAX_DESCRIPTOR_TIMEOUT_MS);
}

function isBoundedPositiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function isBoundedString(value: unknown, minimumBytes: number, maximumBytes: number): value is string {
  if (typeof value !== "string") return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= minimumBytes && bytes <= maximumBytes;
}

function isExactRecord(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => keys.includes(key));
}

function createPigeAgentToolCallContext(
  toolCallId: unknown,
  signal: AbortSignal
): PigeAgentToolCallContext | undefined {
  if (
    typeof toolCallId !== "string" ||
    toolCallId.trim().length === 0 ||
    Buffer.byteLength(toolCallId, "utf8") > MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES
  ) return undefined;
  return Object.freeze({ toolCallId, signal });
}

function assertToolInputWithinLimit(value: unknown, maxBytes: number): void {
  if (!isWithinCanonicalJsonByteLimit(value, maxBytes)) {
    throw new PigeDomainError(
      "agent_runtime.tool_input_invalid",
      "Pige rejected invalid or oversized tool arguments."
    );
  }
}

function assertPigeAgentToolResult(result: unknown, maxBytes: number): asserts result is PigeAgentToolResult {
  if (
    !isExactResultRecord(result) ||
    typeof result.modelText !== "string" ||
    !isRecord(result.details) ||
    Array.isArray(result.details) ||
    (result.terminate !== undefined && typeof result.terminate !== "boolean") ||
    !isWithinCanonicalJsonByteLimit(result, maxBytes)
  ) {
    throw new PigeDomainError(
      "agent_runtime.tool_result_invalid",
      "The Pige Agent tool returned an invalid or oversized result."
    );
  }
}

function isExactResultRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => key === "modelText" || key === "details" || key === "terminate") &&
    Object.prototype.hasOwnProperty.call(value, "modelText") &&
    Object.prototype.hasOwnProperty.call(value, "details");
}

function isWithinCanonicalJsonByteLimit(value: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(canonicalJson(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function canonicalRegistryJson(value: unknown, maxBytes: number): string {
  try {
    const canonical = canonicalJson(value);
    if (Buffer.byteLength(canonical, "utf8") > maxBytes) throw invalidToolRegistryError();
    return canonical;
  } catch (error) {
    if (error instanceof PigeDomainError) throw error;
    throw invalidToolRegistryError();
  }
}

function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, 0, { nodes: 0, ancestors: new Set<object>() });
}

function canonicalJsonValue(
  value: unknown,
  depth: number,
  state: { nodes: number; ancestors: Set<object> }
): string {
  state.nodes += 1;
  if (depth > MAX_CANONICAL_JSON_DEPTH || state.nodes > MAX_CANONICAL_JSON_NODES) {
    throw new TypeError("Canonical JSON bounds exceeded.");
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Canonical JSON value is unsupported.");
  if (state.ancestors.has(value)) throw new TypeError("Canonical JSON cycles are unsupported.");
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalJsonValue(entry, depth + 1, state)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON requires plain objects.");
    }
    const keys = Object.keys(value).sort();
    if (Reflect.ownKeys(value).length !== keys.length) {
      throw new TypeError("Canonical JSON requires enumerable string keys.");
    }
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonValue((value as Record<string, unknown>)[key], depth + 1, state)}`
    ).join(",")}}`;
  } finally {
    state.ancestors.delete(value);
  }
}

function invalidToolRegistryError(): PigeDomainError {
  return new PigeDomainError(
    "agent_runtime.tool_registry_invalid",
    "The Pige Agent tool registry is invalid."
  );
}

function invalidToolCallError(): PigeDomainError {
  return new PigeDomainError(
    "agent_runtime.tool_call_invalid",
    "Pige rejected invalid tool-call metadata."
  );
}

function createAbortError(): Error {
  const error = new Error("The embedded Pi Agent turn was cancelled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
