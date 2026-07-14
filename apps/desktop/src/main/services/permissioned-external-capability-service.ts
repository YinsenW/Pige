import { createHash } from "node:crypto";
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
  PermissionConfirmationRequiredError,
  type PermissionActionSummary
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
const processAdapters: PermissionedExternalCapabilityAdapter[] = [];
let processRegistryCreated = false;

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
  };
  normalizeInput(args: unknown): unknown;
  resourceIdentity(normalizedInput: unknown): unknown;
  resourceCount(normalizedInput: unknown): number;
  execute(
    normalizedInput: unknown,
    signal: AbortSignal,
    context: PigeAgentToolCallContext
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
  readonly assertCurrent: () => void;
}

export interface PermissionedExternalJobPort {
  bindPermissionRequest(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
  }): void;
  commitPermissionConsumption(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
    readonly decisionId: string;
    readonly capability: PermissionCapability;
  }): void;
  completePermissionAction(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
    readonly completionMarkerHash: string;
  }): void;
  readPermissionCompletion(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
  }): string | undefined;
}

export class PermissionedExternalCapabilityRegistry {
  readonly #adapters: readonly PermissionedExternalCapabilityAdapter[];
  readonly #broker: PermissionBrokerService | undefined;
  readonly #jobs: PermissionedExternalJobPort | undefined;

  constructor(
    adapters: readonly PermissionedExternalCapabilityAdapter[] = [],
    broker?: PermissionBrokerService,
    jobs?: PermissionedExternalJobPort
  ) {
    if (adapters.length > MAX_EXTERNAL_CAPABILITIES) throw registryInvalid();
    const names = new Set<string>();
    for (const adapter of adapters) {
      assertAdapter(adapter);
      if (names.has(adapter.tool.name)) throw registryInvalid();
      names.add(adapter.tool.name);
    }
    if (adapters.length > 0 && (!broker || !jobs)) throw registryInvalid();
    this.#adapters = Object.freeze([...adapters]);
    this.#broker = broker;
    this.#jobs = jobs;
  }

  toolNames(): readonly string[] {
    return this.#adapters.map((adapter) => adapter.tool.name);
  }

  toolsForTurn(turn: PermissionedExternalTurnContext): readonly PigeAgentToolDefinition[] {
    if (this.#adapters.length === 0) return [];
    const broker = this.broker();
    const jobs = this.jobPort();
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
        const binding = createExternalActionBinding(adapter, turn, normalizedInput);
        const summary: PermissionActionSummary = {
          actorDisplayName: adapter.actor.displayName,
          actionLabelKey: adapter.action.labelKey,
          resourceKind: adapter.permission.resourceKind,
          resourceCount: requireResourceCount(adapter.resourceCount(normalizedInput)),
          reasonCode: adapter.permission.reasonCode
        };
        const lifecycle = broker.prepare(turn.vaultPath, binding, summary);

        if (lifecycle.state === "pending") {
          jobs.bindPermissionRequest({
            jobId: turn.jobId,
            requestId: lifecycle.id,
            bindingHash: binding.bindingHash
          });
          throw new PermissionConfirmationRequiredError(lifecycle.id, binding.bindingHash);
        }
        if (lifecycle.state === "denied" || lifecycle.state === "cancelled") {
          throw new PigeDomainError("permission.denied", "The current external action was denied.");
        }
        if (lifecycle.state === "consumed" && lifecycle.completionMarkerHash) {
          const jobMarker = jobs.readPermissionCompletion({
            jobId: turn.jobId,
            requestId: lifecycle.id,
            bindingHash: binding.bindingHash
          });
          if (jobMarker !== lifecycle.completionMarkerHash || !adapter.adoptCompleted) {
            throw new PigeDomainError(
              "permission.completed_output_unavailable",
              "The completed external action cannot be adopted safely."
            );
          }
          const adopted = await adapter.adoptCompleted(
            lifecycle.completionMarkerHash,
            normalizedInput,
            signal,
            context
          );
          if (hashToolResult(adopted) !== lifecycle.completionMarkerHash) {
            throw new PigeDomainError(
              "permission.completed_output_changed",
              "The adopted external action output changed."
            );
          }
          return adopted;
        }
        if (lifecycle.state !== "approved" || !lifecycle.decisionId) {
          throw new PermissionConfirmationRequiredError(lifecycle.id, binding.bindingHash);
        }

        signal.throwIfAborted();
        turn.assertCurrent();
        const consumed = broker.consume(turn.vaultPath, lifecycle.id, binding);
        if (!consumed.decisionId) throw new PigeDomainError("permission.request_stale", "Permission decision is unavailable.");
        jobs.commitPermissionConsumption({
          jobId: turn.jobId,
          requestId: consumed.id,
          bindingHash: binding.bindingHash,
          decisionId: consumed.decisionId,
          capability: adapter.permission.capability
        });
        turn.assertCurrent();
        signal.throwIfAborted();
        const result = await adapter.execute(normalizedInput, signal, context);
        const completionMarkerHash = hashToolResult(result);
        jobs.completePermissionAction({
          jobId: turn.jobId,
          requestId: consumed.id,
          bindingHash: binding.bindingHash,
          completionMarkerHash
        });
        broker.markCompleted(turn.vaultPath, consumed.id, binding, completionMarkerHash);
        return result;
      }
    }));
  }

  private broker(): PermissionBrokerService {
    if (!this.#broker) throw registryInvalid();
    return this.#broker;
  }

  private jobPort(): PermissionedExternalJobPort {
    if (!this.#jobs) throw registryInvalid();
    return this.#jobs;
  }
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
  broker: PermissionBrokerService,
  jobs: PermissionedExternalJobPort
): PermissionedExternalCapabilityRegistry {
  processRegistryCreated = true;
  return new PermissionedExternalCapabilityRegistry(processAdapters, broker, jobs);
}

function createExternalActionBinding(
  adapter: PermissionedExternalCapabilityAdapter,
  turn: PermissionedExternalTurnContext,
  normalizedInput: unknown
): PermissionActionBinding {
  const actionInputHash = hashCanonical("pige.permission.action_input.v1", normalizedInput);
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
