import { createHash } from "node:crypto";
import type { HighRiskConfirmationOwner } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type {
  PermissionActionBinding,
  PermissionActorType,
  PermissionCapability,
  PermissionDataBoundary,
  PermissionResourceScope
} from "@pige/schemas";
import {
  createPermissionActionBinding,
  PermissionBrokerService,
  type PermissionActionSummary,
  type PermissionHighRiskIntent
} from "./permission-broker-service";
import type {
  PigeAgentToolCallContext,
  PigeAgentToolDataBoundary,
  PigeAgentToolDefinition,
  PigeAgentToolEffect,
  PigeAgentToolExecution,
  PigeAgentToolExecutionLimits,
  PigeAgentToolIdempotency,
  PigeAgentToolResult,
  PigeAgentToolTrust
} from "./pi-agent-runtime-adapter";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const EXTERNAL_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;
const ID_PATTERN = /^[a-z][a-z0-9_.:-]{2,127}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const MAX_EXTERNAL_CAPABILITIES = 16;
const MAX_COMPLETED_EXECUTIONS = 128;
const processAdapters: PermissionedExternalCapabilityAdapter[] = [];
const executionAuthorities = new WeakMap<object, {
  readonly bindingHash: string;
  readonly capability: PermissionCapability;
}>();
let processRegistryCreated = false;

export interface PermissionedExternalExecutionAuthority {
  readonly bindingHash: string;
}

export function assertPermissionedExternalExecutionAuthority(
  authority: PermissionedExternalExecutionAuthority | undefined,
  capability: PermissionCapability
): void {
  if (!authority) throw executionAuthorityInvalid();
  const record = executionAuthorities.get(authority);
  if (!record || record.bindingHash !== authority.bindingHash || record.capability !== capability) {
    throw executionAuthorityInvalid();
  }
}

export interface PermissionedExternalCapabilityAdapter {
  readonly tool: {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly outputSchema: Readonly<Record<string, unknown>>;
    readonly effect: PigeAgentToolEffect;
    readonly inputTrust: PigeAgentToolTrust;
    readonly outputTrust: PigeAgentToolTrust;
    readonly dataBoundary: PigeAgentToolDataBoundary;
    readonly execution: PigeAgentToolExecution;
    readonly idempotency: PigeAgentToolIdempotency;
    readonly limits: PigeAgentToolExecutionLimits;
    readonly ownerService: string;
  };
  readonly actor: {
    readonly type: Extract<PermissionActorType, "skill" | "package" | "local_tool">;
    readonly id: string;
    readonly displayName: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly action: {
    readonly id: string;
    readonly version: string;
    readonly labelKey: string;
  };
  readonly permission: {
    readonly capability: PermissionCapability;
    readonly dataBoundary: PermissionDataBoundary;
    readonly resourceScope: PermissionResourceScope;
    readonly resourceKind: PermissionActionSummary["resourceKind"];
    readonly reasonCode: string;
    readonly highRisk?: PermissionHighRiskIntent;
  };
  normalizeInput(args: unknown): unknown;
  resourceIdentity(normalizedInput: unknown): unknown;
  resourceDisplayName?(normalizedInput: unknown): string;
  resourceCount(normalizedInput: unknown): number;
  execute(
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext,
    authority?: PermissionedExternalExecutionAuthority
  ): Promise<PigeAgentToolResult>;
  adoptCompleted?(
    completionMarkerHash: string,
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext
  ): Promise<PigeAgentToolResult>;
}

export interface PermissionedExternalTurnContext {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly jobId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly runtimeKind: "desktop_local" | "remote_agent_backend";
  readonly clientCapabilityTier: "desktop_full" | "web_client" | "mobile_lite";
  readonly confirmationOwner?: HighRiskConfirmationOwner;
  readonly assertCurrent: () => void;
}

export class PermissionedExternalCapabilityRegistry {
  readonly #adapters: readonly PermissionedExternalCapabilityAdapter[];
  readonly #broker: PermissionBrokerService | undefined;
  readonly #inFlight = new Map<string, Promise<PigeAgentToolResult>>();
  readonly #completed = new Map<string, PigeAgentToolResult>();

  constructor(
    adapters: readonly PermissionedExternalCapabilityAdapter[] = [],
    broker?: PermissionBrokerService
  ) {
    if (adapters.length > MAX_EXTERNAL_CAPABILITIES) throw registryInvalid();
    const names = new Set<string>();
    for (const adapter of adapters) {
      assertAdapter(adapter);
      if (names.has(adapter.tool.name)) throw registryInvalid();
      names.add(adapter.tool.name);
    }
    if (adapters.length > 0 && !broker) throw registryInvalid();
    this.#adapters = Object.freeze([...adapters]);
    this.#broker = broker;
  }

  toolNames(): readonly string[] {
    return this.#adapters.map((adapter) => adapter.tool.name);
  }

  toolsForTurn(turn: PermissionedExternalTurnContext): readonly PigeAgentToolDefinition[] {
    if (this.#adapters.length === 0) return [];
    const broker = this.broker();
    return this.#adapters.map((adapter): PigeAgentToolDefinition => ({
      ...adapter.tool,
      version: adapter.action.version,
      capability: adapter.permission.capability,
      authorize: () => {
        turn.assertCurrent();
        return true;
      },
      execute: async (args, signal, context) => {
        signal.throwIfAborted();
        turn.assertCurrent();
        const normalizedInput = adapter.normalizeInput(args);
        requireResourceCount(adapter.resourceCount(normalizedInput));
        const binding = createExternalActionBinding(adapter, turn, normalizedInput, context.toolCallId);
        return this.#runBound(adapter, normalizedInput, signal, context, turn, binding, broker);
      }
    }));
  }

  async #runBound(
    adapter: PermissionedExternalCapabilityAdapter,
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext,
    turn: PermissionedExternalTurnContext,
    binding: PermissionActionBinding,
    broker: PermissionBrokerService
  ): Promise<PigeAgentToolResult> {
    const completed = this.#completed.get(binding.bindingHash);
    if (completed) return completed;
    const active = this.#inFlight.get(binding.bindingHash);
    if (active) return active;

    const execution = this.#authorizeAndExecute(adapter, normalizedInput, signal, context, turn, binding, broker);
    this.#inFlight.set(binding.bindingHash, execution);
    try {
      return await execution;
    } finally {
      if (this.#inFlight.get(binding.bindingHash) === execution) this.#inFlight.delete(binding.bindingHash);
    }
  }

  async #authorizeAndExecute(
    adapter: PermissionedExternalCapabilityAdapter,
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext,
    turn: PermissionedExternalTurnContext,
    binding: PermissionActionBinding,
    broker: PermissionBrokerService
  ): Promise<PigeAgentToolResult> {
    let settle: ((result: PigeAgentToolResult) => void) | undefined;
    let fail: ((reason: unknown) => void) | undefined;
    const confirmedExecution = new Promise<PigeAgentToolResult>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const authority = broker.authorizeTurnAction({
      vaultPath: turn.vaultPath,
      binding,
      ...(turn.confirmationOwner ? { owner: turn.confirmationOwner } : {}),
      ...(adapter.permission.highRisk ? { highRisk: adapter.permission.highRisk } : {}),
      ...(adapter.permission.highRisk
        ? {
            resolveHighRisk: async (decision: "allow" | "deny") => {
              if (decision === "deny") {
                fail?.(new PigeDomainError("permission.denied", "The exact high-risk effect was denied."));
                return "committed" as const;
              }
              try {
                const result = await this.#executeBound(adapter, normalizedInput, signal, context, turn, binding);
                settle?.(result);
                return "committed" as const;
              } catch (caught) {
                fail?.(caught);
                return "failed" as const;
              }
            }
          }
        : {})
    });
    if (authority.status === "authorized") {
      return this.#executeBound(adapter, normalizedInput, signal, context, turn, binding);
    }
    if (authority.status === "denied") {
      throw new PigeDomainError("permission.denied", "The exact high-risk effect was denied.");
    }
    if (authority.status === "busy") {
      throw new PigeDomainError("permission.confirmation_busy", "Another high-risk effect is awaiting confirmation.");
    }
    const abort = (): void => {
      broker.withdrawHighRisk({
        confirmationId: authority.confirmationId,
        expectedRevision: authority.revision,
        owner: turn.confirmationOwner!
      });
      fail?.(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await confirmedExecution;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async #executeBound(
    adapter: PermissionedExternalCapabilityAdapter,
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext,
    turn: PermissionedExternalTurnContext,
    binding: PermissionActionBinding
  ): Promise<PigeAgentToolResult> {
    signal.throwIfAborted();
    turn.assertCurrent();
    const authority = issueExecutionAuthority(binding);
    try {
      const result = await adapter.execute(normalizedInput, signal, context, authority);
      turn.assertCurrent();
      hashToolResult(result);
      this.#rememberCompleted(binding.bindingHash, result);
      return result;
    } finally {
      executionAuthorities.delete(authority);
    }
  }

  #rememberCompleted(bindingHash: string, result: PigeAgentToolResult): void {
    this.#completed.set(bindingHash, result);
    const oldest = this.#completed.keys().next().value as string | undefined;
    if (this.#completed.size > MAX_COMPLETED_EXECUTIONS && oldest) this.#completed.delete(oldest);
  }

  private broker(): PermissionBrokerService {
    if (!this.#broker) throw registryInvalid();
    return this.#broker;
  }

}

function issueExecutionAuthority(binding: PermissionActionBinding): PermissionedExternalExecutionAuthority {
  const authority = Object.freeze({ bindingHash: binding.bindingHash });
  executionAuthorities.set(authority, {
    bindingHash: binding.bindingHash,
    capability: binding.capability
  });
  return authority;
}

function executionAuthorityInvalid(): PigeDomainError {
  return new PigeDomainError(
    "permission.execution_authority_invalid",
    "The external action does not have current execution authority."
  );
}

export function registerPermissionedExternalCapabilityAdapter(
  adapter: PermissionedExternalCapabilityAdapter
): void {
  if (
    processRegistryCreated ||
    processAdapters.length >= MAX_EXTERNAL_CAPABILITIES ||
    processAdapters.some((candidate) => candidate.tool.name === adapter.tool.name)
  ) throw registryInvalid();
  assertAdapter(adapter);
  processAdapters.push(adapter);
}

export function createPermissionedExternalCapabilityRegistry(
  broker: PermissionBrokerService
): PermissionedExternalCapabilityRegistry {
  processRegistryCreated = true;
  return new PermissionedExternalCapabilityRegistry(processAdapters, broker);
}

function createExternalActionBinding(
  adapter: PermissionedExternalCapabilityAdapter,
  turn: PermissionedExternalTurnContext,
  normalizedInput: unknown,
  toolCallId: string
): PermissionActionBinding {
  const actionInputHash = hashCanonical("pige.permission.action_input.v1", {
    toolCallId,
    input: normalizedInput
  });
  const resourceIdentityHash = hashCanonical(
    "pige.permission.resource_identity.v1",
    adapter.resourceIdentity(normalizedInput)
  );
  return createPermissionActionBinding({
    vaultId: turn.vaultId,
    jobId: turn.jobId,
    actorType: adapter.actor.type,
    actorId: adapter.actor.id,
    actorVersion: adapter.actor.version,
    actorDigest: adapter.actor.digest,
    actionId: adapter.action.id,
    actionVersion: adapter.action.version,
    actionInputHash,
    capability: adapter.permission.capability,
    dataBoundary: adapter.permission.dataBoundary,
    resourceScope: adapter.permission.resourceScope,
    resourceIdentityHash,
    policyContextId: turn.policyContextId,
    policyHash: turn.policyHash,
    runtimeKind: turn.runtimeKind,
    clientCapabilityTier: turn.clientCapabilityTier
  });
}

function hashToolResult(result: PigeAgentToolResult): `sha256:${string}` {
  return hashCanonical("pige.permission.tool_result.v1", result);
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    if (typeof value === "number" && !Number.isFinite(value)) throw registryInvalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw registryInvalid();
}

function assertAdapter(adapter: PermissionedExternalCapabilityAdapter): void {
  if (
    !adapter ||
    !EXTERNAL_TOOL_NAME_PATTERN.test(adapter.tool?.name ?? "") ||
    !["skill", "package", "local_tool"].includes(adapter.actor?.type ?? "") ||
    !ID_PATTERN.test(adapter.actor?.id ?? "") ||
    !VERSION_PATTERN.test(adapter.actor?.version ?? "") ||
    !SHA256_PATTERN.test(adapter.actor?.digest ?? "") ||
    !ID_PATTERN.test(adapter.action?.id ?? "") ||
    !VERSION_PATTERN.test(adapter.action?.version ?? "") ||
    typeof adapter.actor?.displayName !== "string" ||
    adapter.actor.displayName.trim().length === 0 ||
    typeof adapter.action?.labelKey !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,159}$/u.test(adapter.action.labelKey) ||
    typeof adapter.permission?.reasonCode !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,119}$/u.test(adapter.permission.reasonCode) ||
    typeof adapter.normalizeInput !== "function" ||
    typeof adapter.resourceIdentity !== "function" ||
    typeof adapter.resourceCount !== "function" ||
    typeof adapter.execute !== "function" ||
    (adapter.adoptCompleted !== undefined && typeof adapter.adoptCompleted !== "function")
  ) throw registryInvalid();
}

function requireResourceCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw registryInvalid();
  return value;
}

function registryInvalid(): PigeDomainError {
  return new PigeDomainError(
    "permission.external_registry_invalid",
    "The permissioned external capability registry is invalid."
  );
}
