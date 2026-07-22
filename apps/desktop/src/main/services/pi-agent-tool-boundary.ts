import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  type AgentTool,
  type AgentToolResult,
  type AgentToolUpdateCallback
} from "@earendil-works/pi-agent-core";
import { type TSchema, validateToolArguments } from "@earendil-works/pi-ai";
import { PigeDomainError } from "@pige/domain";

export type PigeAgentToolResult = AgentToolResult<Readonly<Record<string, unknown>>>;

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
  readonly resourceScope: "none" | "current_source" | "current_note" | "current_vault";
  readonly pathAuthority: "host_only";
  readonly sourceIdAuthority: "host_only";
  readonly modelAuthority: "none";
}

export interface PigeAgentToolIdempotency {
  readonly mode: "idempotent" | "non_idempotent";
  readonly scope: "current_source" | "current_note" | "current_vault" | "tool_call" | "none";
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
    context: PigeAgentToolCallContext,
    onUpdate?: AgentToolUpdateCallback<Readonly<Record<string, unknown>>>
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

export interface PiToolExecutionHooks {
  readonly afterExecute: (
    tool: PigeAgentToolDescriptor,
    args: unknown,
    result: PigeAgentToolResult
  ) => PigeAgentToolResult | Promise<PigeAgentToolResult>;
  readonly onError?: (caught: unknown) => void;
}

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

export function createPigeTextToolResult(
  text: string,
  details: Readonly<Record<string, unknown>> = {},
  options: {
    readonly terminate?: boolean;
    readonly addedToolNames?: readonly string[];
  } = {}
): PigeAgentToolResult {
  return {
    content: [{ type: "text", text }],
    details,
    ...(options.terminate === undefined ? {} : { terminate: options.terminate }),
    ...(options.addedToolNames === undefined ? {} : { addedToolNames: [...options.addedToolNames] })
  };
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

export function assertPigeAgentToolDescriptors(
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

export function toPiTool(
  tool: PigeAgentToolDescriptor,
  catalog: ReadonlyMap<string, PigeAgentToolDescriptor>,
  hooks?: PiToolExecutionHooks
): AgentTool<TSchema, Readonly<Record<string, unknown>>> {
  const piTool: AgentTool<TSchema, Readonly<Record<string, unknown>>> = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters as TSchema,
    executionMode: tool.execution === "parallel_read_only" ? "parallel" : "sequential",
    prepareArguments: (args) => {
      try {
        return validateToolArguments(piTool, {
          type: "toolCall",
          id: "pige_tool_argument_validation",
          name: tool.name,
          arguments: args as Record<string, unknown>
        });
      } catch {
        throw new PigeDomainError(
          "agent_runtime.tool_input_invalid",
          `The ${tool.name} tool arguments do not match its registered schema.`
        );
      }
    },
    execute: async (toolCallId, args, signal, onUpdate) => {
      try {
        const prepareArguments = piTool.prepareArguments;
        if (!prepareArguments) throw invalidToolRegistryError();
        const preparedArgs = prepareArguments(args);
        const effectiveSignal = signal ?? new AbortController().signal;
        const context = createPigeAgentToolCallContext(toolCallId, effectiveSignal);
        if (!context) throw invalidToolCallError();
        assertToolInputWithinLimit(preparedArgs, tool.limits.maxInputBytes);
        let result: PigeAgentToolResult;
        try {
          result = await tool.execute(preparedArgs, effectiveSignal, context, (partialResult) => {
            assertPigeAgentToolResult(partialResult, tool.limits.maxOutputBytes);
            assertAddedToolNames(partialResult, catalog);
            onUpdate?.(partialResult);
          });
        } catch (caught) {
          throw caught;
        }
        assertPigeAgentToolResult(result, tool.limits.maxOutputBytes);
        assertAddedToolNames(result, catalog);
        const presentedResult = hooks ? await hooks.afterExecute(tool, preparedArgs, result) : result;
        assertPigeAgentToolResult(presentedResult, tool.limits.maxOutputBytes);
        assertAddedToolNames(presentedResult, catalog);
        return presentedResult;
      } catch (caught) {
        hooks?.onError?.(caught);
        throw caught;
      }
    }
  };
  return piTool;
}

export function createPigeAgentToolCallContext(
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

export function isPigeToolInputWithinLimit(value: unknown, maxBytes: number): boolean {
  return isWithinCanonicalJsonByteLimit(value, maxBytes);
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
    (value.resourceScope === "none" || value.resourceScope === "current_source" ||
      value.resourceScope === "current_note" || value.resourceScope === "current_vault") &&
    value.pathAuthority === "host_only" &&
    value.sourceIdAuthority === "host_only" &&
    value.modelAuthority === "none";
}

function isPigeAgentToolIdempotency(value: unknown): value is PigeAgentToolIdempotency {
  if (!isExactRecord(value, ["mode", "scope"])) return false;
  return value.mode === "idempotent"
    ? value.scope === "none" || value.scope === "current_source" || value.scope === "current_note" ||
      value.scope === "current_vault" || value.scope === "tool_call"
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
    !isRecord(result) || Array.isArray(result) ||
    !Array.isArray(result.content) ||
    !result.content.every(isPiToolResultContent) ||
    !isRecord(result.details) ||
    Array.isArray(result.details) ||
    (result.addedToolNames !== undefined && (
      !Array.isArray(result.addedToolNames) ||
      result.addedToolNames.some((name) => typeof name !== "string")
    )) ||
    (result.terminate !== undefined && typeof result.terminate !== "boolean") ||
    !isWithinCanonicalJsonByteLimit(result, maxBytes)
  ) {
    throw new PigeDomainError(
      "agent_runtime.tool_result_invalid",
      "The Pige Agent tool returned an invalid or oversized result."
    );
  }
}

function isPiToolResultContent(value: unknown): boolean {
  if (!isRecord(value) || Array.isArray(value)) return false;
  return value.type === "text"
    ? typeof value.text === "string"
    : value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string";
}

function assertAddedToolNames(
  result: PigeAgentToolResult,
  catalog: ReadonlyMap<string, PigeAgentToolDescriptor>
): void {
  if (!result.addedToolNames) return;
  const names = new Set(result.addedToolNames);
  if (names.size !== result.addedToolNames.length || result.addedToolNames.some((name) => !catalog.has(name))) {
    throw new PigeDomainError(
      "agent_runtime.dynamic_tool_activation_forbidden",
      "The fixed Pige tool catalog rejected dynamic tool activation."
    );
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
