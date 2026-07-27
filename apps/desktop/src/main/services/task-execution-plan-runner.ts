import { PigeDomainError } from "@pige/domain";
import type {
  PermissionCapability,
  PermissionDataBoundary,
  PermissionResourceScope
} from "@pige/schemas";
import type { PermissionBrokerService } from "./permission-broker-service";
import { PermissionedExternalCapabilityRegistry } from "./permissioned-external-capability-service";
import type {
  PigeAgentToolCallContext,
  PigeAgentToolDefinition,
  PigeAgentToolResult
} from "./pi-agent-runtime-adapter";
import {
  createTaskExecutionPlanCapabilityAdapter,
  type TaskExecutionPlanCapabilityMetadata
} from "./task-execution-plan-capability-adapter";
import {
  TaskExecutionPlanService,
  type TaskExecutionPlan,
  type TaskExecutionPlanBindingReader
} from "./task-execution-plan-service";
import {
  TaskProcessSessionService,
  type TaskProcessSessionRequest
} from "./task-process-session-service";

const TOOL_NAME = "pige_run_reviewed_task_plan";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface TaskExecutionPlanRunnerTurn {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly runtimeKind: "desktop_local" | "remote_agent_backend";
  readonly clientCapabilityTier: "desktop_full" | "web_client" | "mobile_lite";
  readonly readToolCatalogHash: () => string;
  readonly assertCurrent: () => void;
}

export interface TaskExecutionPlanRunnerStep {
  readonly ordinal: number;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly capability: PermissionCapability;
  readonly dataBoundary: PermissionDataBoundary;
  readonly resourceScope: PermissionResourceScope;
  readonly readOnlyProbe: boolean;
  readonly process: Omit<TaskProcessSessionRequest, "planId" | "jobId" | "stepOrdinal" | "assertCurrent">;
}

export interface ResolvedTaskExecutionPlanRun {
  readonly plan: TaskExecutionPlan;
  readonly readCurrentPlanBinding: TaskExecutionPlanBindingReader;
  readonly steps: readonly TaskExecutionPlanRunnerStep[];
}

export type TaskExecutionPlanRunnerResolver = (input: {
  readonly vaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly policyHash: string;
  readonly toolCatalogHash: string;
  readonly signal: AbortSignal;
}) => Promise<ResolvedTaskExecutionPlanRun>;

interface RunnerState {
  resolved: ResolvedTaskExecutionPlanRun | undefined;
  resolving: Promise<ResolvedTaskExecutionPlanRun> | undefined;
  active: Promise<PigeAgentToolResult> | undefined;
  nextIndex: number;
  terminalResult: PigeAgentToolResult | undefined;
  invalid: boolean;
}

/**
 * Presents one empty-input Home tool while keeping executable, argv, paths, and URLs
 * inside the reviewed plan and process owners.
 */
export class TaskExecutionPlanRunner {
  readonly #plans: TaskExecutionPlanService;
  readonly #sessions: TaskProcessSessionService;
  readonly #broker: PermissionBrokerService;
  readonly #resolve: TaskExecutionPlanRunnerResolver;

  constructor(options: {
    readonly plans: TaskExecutionPlanService;
    readonly sessions: TaskProcessSessionService;
    readonly broker: PermissionBrokerService;
    readonly resolve: TaskExecutionPlanRunnerResolver;
  }) {
    if (
      !options ||
      !(options.plans instanceof TaskExecutionPlanService) ||
      !(options.sessions instanceof TaskProcessSessionService) ||
      !options.broker ||
      typeof options.resolve !== "function"
    ) throw runnerError("task_execution.runner_configuration_invalid");
    this.#plans = options.plans;
    this.#sessions = options.sessions;
    this.#broker = options.broker;
    this.#resolve = options.resolve;
  }

  toolForExplicitHomeTurn(turn: TaskExecutionPlanRunnerTurn): PigeAgentToolDefinition {
    assertTurn(turn);
    let initialCatalogHash: string | undefined;
    const state: RunnerState = {
      resolved: undefined,
      resolving: undefined,
      active: undefined,
      nextIndex: 0,
      terminalResult: undefined,
      invalid: false
    };
    const assertCurrent = (): void => {
      try {
        turn.assertCurrent();
        const currentCatalogHash = readCatalogHash(turn);
        if (initialCatalogHash && currentCatalogHash !== initialCatalogHash) throw new Error("catalog changed");
      } catch {
        state.invalid = true;
        throw runnerError("task_execution.runner_binding_changed");
      }
    };
    const execute = async (
      args: unknown,
      signal: AbortSignal,
      context: PigeAgentToolCallContext
    ): Promise<PigeAgentToolResult> => {
      assertEmptyInput(args);
      if (state.invalid) throw runnerError("task_execution.runner_binding_changed");
      if (signal.aborted) throw runnerCancelled();
      try {
        assertCurrent();
        initialCatalogHash ??= readCatalogHash(turn);
      } catch (caught) {
        throw caught;
      }
      if (state.terminalResult) return state.terminalResult;
      if (state.active) return state.active;
      const active = this.#executeNext(turn, initialCatalogHash, state, assertCurrent, signal, context)
        .catch((caught: unknown) => {
          state.invalid = true;
          if (signal.aborted || isAbort(caught)) throw runnerCancelled();
          if (caught instanceof PigeDomainError && caught.code.startsWith("task_execution.runner_")) {
            throw caught;
          }
          throw runnerError("task_execution.runner_failed");
        })
        .finally(() => {
          if (state.active === active) state.active = undefined;
        });
      state.active = active;
      return active;
    };
    const tool: PigeAgentToolDefinition = {
      name: TOOL_NAME,
      label: "Run reviewed task plan",
      description: "Confirms and runs only the exact next step of a reviewed task plan.",
      parameters: strictObjectSchema({}, []),
      outputSchema: processResultSchema(),
      version: "1",
      capability: "install_local_tool",
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "none",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 2, maxOutputBytes: 270_336, timeoutMs: 600_000 },
      ownerService: "TaskExecutionPlanRunner",
      authorize: () => {
        assertCurrent();
        return true;
      },
      execute
    };
    return Object.freeze(tool);
  }

  async #executeNext(
    turn: TaskExecutionPlanRunnerTurn,
    toolCatalogHash: string,
    state: RunnerState,
    assertCurrent: () => void,
    signal: AbortSignal,
    context: PigeAgentToolCallContext
  ): Promise<PigeAgentToolResult> {
    const resolved = await this.#resolveOnce(turn, toolCatalogHash, state, assertCurrent, signal);
    signal.throwIfAborted();
    assertCurrent();
    const registration = resolved.steps[state.nextIndex];
    const planStep = resolved.plan.steps[state.nextIndex];
    if (!registration || !planStep || registration.ordinal !== planStep.ordinal) {
      throw runnerError("task_execution.runner_plan_invalid");
    }
    const planBinding = (): ReturnType<TaskExecutionPlanBindingReader> => {
      assertCurrent();
      return resolved.readCurrentPlanBinding();
    };
    await this.#plans.confirmPlan(resolved.plan, planBinding, signal);
    signal.throwIfAborted();
    assertCurrent();
    const metadata: TaskExecutionPlanCapabilityMetadata = {
      planId: resolved.plan.planId,
      jobId: resolved.plan.jobId,
      stepOrdinal: planStep.ordinal,
      planDigest: resolved.plan.planDigest as `sha256:${string}`,
      adapterId: planStep.adapterId,
      adapterVersion: planStep.adapterVersion,
      adapterDigest: planStep.adapterDigest as `sha256:${string}`,
      actionId: planStep.actionId,
      toolName: registration.toolName,
      toolLabel: registration.toolLabel,
      capability: registration.capability,
      dataBoundary: registration.dataBoundary,
      resourceScope: registration.resourceScope,
      readOnlyProbe: registration.readOnlyProbe
    };
    const process: TaskProcessSessionRequest = {
      ...registration.process,
      planId: resolved.plan.planId,
      jobId: resolved.plan.jobId,
      stepOrdinal: planStep.ordinal,
      assertCurrent: () => {
        assertCurrent();
        if (canonicalJson(resolved.readCurrentPlanBinding()) !== canonicalJson(this.#plans.binding(resolved.plan))) {
          throw runnerError("task_execution.runner_binding_changed");
        }
      }
    };
    assertStepRegistration(planStep, registration, process, resolved.steps.length);
    const adapter = createTaskExecutionPlanCapabilityAdapter({
      metadata,
      process,
      sessions: this.#sessions,
      assertAuthority: (authority) => {
        assertExactAuthority(resolved.plan, planStep.ordinal, authority);
        if (authority.disposition !== "execute") throw runnerError("task_execution.runner_authority_invalid");
        const issued = this.#plans.issueNextAuthority(resolved.plan, planStep.ordinal, planBinding);
        this.#plans.consumeAuthority(issued, resolved.plan, planStep.ordinal, planBinding);
      }
    });
    const registry = new PermissionedExternalCapabilityRegistry([adapter], this.#broker);
    const tool = registry.toolsForTurn({
      vaultPath: turn.vaultPath,
      vaultId: turn.vaultId,
      jobId: turn.jobId,
      policyContextId: turn.policyContextId,
      policyHash: turn.policyHash,
      runtimeKind: turn.runtimeKind,
      clientCapabilityTier: turn.clientCapabilityTier,
      assertCurrent
    })[0];
    if (!tool) throw runnerError("task_execution.runner_plan_invalid");
    const result = await tool.execute({}, signal, context);
    assertCurrent();
    const status = readResultStatus(result);
    if (status === "failed" || status === "timed_out") {
      throw runnerError("task_execution.runner_step_failed");
    }
    if (status === "interaction_pending") return result;
    state.nextIndex += 1;
    if (state.nextIndex === resolved.steps.length) {
      if (!registration.readOnlyProbe || status !== "completed") {
        throw runnerError("task_execution.runner_plan_invalid");
      }
      state.terminalResult = result;
    }
    return result;
  }

  async #resolveOnce(
    turn: TaskExecutionPlanRunnerTurn,
    toolCatalogHash: string,
    state: RunnerState,
    assertCurrent: () => void,
    signal: AbortSignal
  ): Promise<ResolvedTaskExecutionPlanRun> {
    if (state.resolved) return state.resolved;
    if (!state.resolving) {
      state.resolving = this.#resolve({
        vaultId: turn.vaultId,
        jobId: turn.jobId,
        clientTurnId: turn.clientTurnId,
        policyHash: turn.policyHash,
        toolCatalogHash,
        signal
      }).then((resolved) => {
        signal.throwIfAborted();
        assertCurrent();
        assertResolvedPlan(this.#plans, resolved, turn, toolCatalogHash);
        state.resolved = resolved;
        return resolved;
      });
    }
    return state.resolving;
  }
}

function assertResolvedPlan(
  plans: TaskExecutionPlanService,
  resolved: ResolvedTaskExecutionPlanRun,
  turn: TaskExecutionPlanRunnerTurn,
  toolCatalogHash: string
): void {
  if (!resolved || typeof resolved.readCurrentPlanBinding !== "function" || !Array.isArray(resolved.steps)) {
    throw runnerError("task_execution.runner_plan_invalid");
  }
  const binding = plans.binding(resolved.plan);
  if (
    binding.vaultId !== turn.vaultId ||
    binding.jobId !== turn.jobId ||
    binding.clientTurnId !== turn.clientTurnId ||
    binding.authoredTaskIntent !== "explicit_user_task" ||
    binding.policyHash !== turn.policyHash ||
    binding.toolCatalogHash !== toolCatalogHash ||
    resolved.steps.length !== resolved.plan.steps.length ||
    resolved.steps.length < 1
  ) throw runnerError("task_execution.runner_plan_invalid");
  if (canonicalJson(resolved.readCurrentPlanBinding()) !== canonicalJson(binding)) {
    throw runnerError("task_execution.runner_binding_changed");
  }
}

function assertStepRegistration(
  step: TaskExecutionPlan["steps"][number],
  registration: TaskExecutionPlanRunnerStep,
  process: TaskProcessSessionRequest,
  stepCount: number
): void {
  if (
    registration.ordinal !== step.ordinal ||
    process.command.executable !== step.normalizedExecutableIdentity ||
    canonicalJson(process.command.args) !== canonicalJson(step.argv) ||
    process.command.workingDirectory !== step.canonicalWorkingDirectory ||
    process.command.timeoutMs !== step.timeoutMs ||
    registration.readOnlyProbe !== (step.ordinal === stepCount) ||
    (step.interactionProtocol === "browser_oauth") !== (process.interaction?.kind === "browser_oauth") ||
    (process.interaction && canonicalJson(process.interaction.allowedOrigins) !== canonicalJson(step.networkOrigins))
  ) throw runnerError("task_execution.runner_plan_invalid");
}

function assertExactAuthority(
  plan: TaskExecutionPlan,
  ordinal: number,
  authority: {
    readonly planId: string;
    readonly jobId: string;
    readonly stepOrdinal: number;
    readonly planDigest: `sha256:${string}`;
  }
): void {
  if (
    authority.planId !== plan.planId ||
    authority.jobId !== plan.jobId ||
    authority.stepOrdinal !== ordinal ||
    authority.planDigest !== plan.planDigest
  ) throw runnerError("task_execution.runner_authority_invalid");
}

function assertTurn(turn: TaskExecutionPlanRunnerTurn): void {
  if (
    !turn ||
    typeof turn.vaultPath !== "string" || !turn.vaultPath ||
    typeof turn.vaultId !== "string" || !turn.vaultId ||
    typeof turn.jobId !== "string" || !turn.jobId ||
    typeof turn.clientTurnId !== "string" || !turn.clientTurnId ||
    typeof turn.policyContextId !== "string" || !turn.policyContextId ||
    !SHA256_PATTERN.test(turn.policyHash) ||
    typeof turn.readToolCatalogHash !== "function" ||
    typeof turn.assertCurrent !== "function"
  ) throw runnerError("task_execution.runner_binding_invalid");
}

function readCatalogHash(turn: TaskExecutionPlanRunnerTurn): string {
  const value = turn.readToolCatalogHash();
  if (!SHA256_PATTERN.test(value)) throw runnerError("task_execution.runner_binding_changed");
  return value;
}

function assertEmptyInput(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw runnerError("task_execution.runner_input_invalid");
  }
}

function readResultStatus(result: PigeAgentToolResult): string {
  const details = result.details;
  const status = details && typeof details === "object" ? details.status : undefined;
  if (!["completed", "failed", "timed_out", "interaction_pending"].includes(String(status))) {
    throw runnerError("task_execution.runner_result_invalid");
  }
  return String(status);
}

function processResultSchema(): Readonly<Record<string, unknown>> {
  return strictObjectSchema({
    status: { enum: ["completed", "failed", "timed_out", "interaction_pending"] },
    stdout: { type: "string", maxLength: 262_144 },
    stderr: { type: "string", maxLength: 262_144 },
    exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
    signal: { anyOf: [{ type: "string" }, { type: "null" }] },
    outputBytes: { type: "integer", minimum: 0, maximum: 262_144 },
    truncated: { type: "boolean" }
  }, ["status", "stdout", "stderr", "exitCode", "signal", "outputBytes", "truncated"]);
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw runnerError("task_execution.runner_plan_invalid");
}

function isAbort(caught: unknown): boolean {
  return caught instanceof DOMException && caught.name === "AbortError";
}

function runnerCancelled(): PigeDomainError {
  return runnerError("task_execution.runner_cancelled");
}

function runnerError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The reviewed task plan could not continue.");
}
