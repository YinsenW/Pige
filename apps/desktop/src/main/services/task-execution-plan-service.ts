import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import taskExecutionPlanManifest from "../../../../../resources/task-execution-plan.manifest.json";
import type { HighRiskConfirmationService } from "./high-risk-confirmation-service";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:@()+-]{0,191}$/u;
const PLAN_ID_PATTERN = /^plan_[a-f0-9]{32}$/u;

export type TaskExecutionAuthoredIntent = "neutral_attachment" | "explicit_user_task";
export type TaskExecutionInteractionProtocol = "none" | "browser_oauth";
export type TaskExecutionRecoveryMode = "probe_then_adopt" | "fail_closed";

export interface TaskExecutionPlanEnvironment {
  readonly controlledHomeRoot: string;
  readonly configRoot: string;
  readonly sanitizedPathEntries: readonly string[];
  readonly descendantExecutableIdentities: readonly string[];
  readonly canonicalWorkingDirectory: string;
  readonly temporaryDirectoryPolicy: string;
  readonly localeProfile: string;
  readonly npmRegistry: string;
  readonly npmPrefix: string;
  readonly npmCache: string;
  readonly npmConfigProvenance: string;
  readonly targetAgentRoots: readonly string[];
  readonly networkOrigins: readonly string[];
  readonly destinations: readonly string[];
  readonly secretHandleVersions: Readonly<Record<string, string>>;
}

export interface TaskExecutionPlanStepInput {
  readonly ordinal: number;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly actionId: string;
  readonly normalizedExecutableIdentity: string;
  readonly argv: readonly string[];
  readonly canonicalWorkingDirectory: string;
  readonly environmentProfileHash: string;
  readonly networkOrigins: readonly string[];
  readonly destinations: readonly string[];
  readonly interactionProtocol: TaskExecutionInteractionProtocol;
  readonly timeoutMs: number;
  readonly inputHash: string;
  readonly postconditionProbeId: string;
  readonly recoveryMode: TaskExecutionRecoveryMode;
}

export interface ResolveTaskExecutionPlanInput {
  readonly vaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly authoredTaskIntent: TaskExecutionAuthoredIntent;
  readonly policyHash: string;
  readonly toolCatalogHash: string;
  readonly recipeId: string;
  readonly actorId: string;
  readonly actorVersion: string;
  readonly actorDigest: string;
  readonly environment: TaskExecutionPlanEnvironment;
  readonly steps: readonly TaskExecutionPlanStepInput[];
  readonly resolvedVersion: string;
  readonly integrities: readonly string[];
  readonly destinationRoots: readonly string[];
  readonly skillCount: number;
  readonly targetAgents: readonly string[];
}

export interface TaskExecutionPlanStep extends TaskExecutionPlanStepInput {}

export interface TaskExecutionPlanSummary {
  readonly planId: string;
  readonly toolLabel: string;
  readonly resolvedVersion: string;
  readonly sourceOrigin: string;
  readonly integrities: readonly string[];
  readonly stepCount: number;
  readonly destinationRoots: readonly string[];
  readonly skillCount: number;
  readonly targetAgents: readonly string[];
  readonly requiresBrowserOAuth: boolean;
}

export interface TaskExecutionPlanBinding {
  readonly planId: string;
  readonly vaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly authoredTaskIntent: TaskExecutionAuthoredIntent;
  readonly policyHash: string;
  readonly toolCatalogHash: string;
  readonly recipeId: string;
  readonly recipeVersion: string;
  readonly recipeDigest: string;
  readonly actorId: string;
  readonly actorVersion: string;
  readonly actorDigest: string;
  readonly environment: TaskExecutionPlanEnvironment;
  readonly planDigest: string;
}

export interface TaskExecutionPlan extends TaskExecutionPlanBinding {
  readonly summary: TaskExecutionPlanSummary;
  readonly steps: readonly TaskExecutionPlanStep[];
}

export interface TaskExecutionStepAuthority {
  readonly __taskExecutionStepAuthority?: never;
}

export type TaskExecutionPlanConfirmation = (
  summary: TaskExecutionPlanSummary,
  binding: TaskExecutionPlanBinding,
  signal?: AbortSignal
) => Promise<"allow" | "deny">;

export type TaskExecutionPlanBindingReader = () => TaskExecutionPlanBinding;

export function createTaskExecutionPlanConfirmation(
  confirmations: HighRiskConfirmationService
): TaskExecutionPlanConfirmation {
  return (summary, binding, signal) => {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const confirmationId = `confirm_${binding.jobId.split("_")[1]}_${binding.planId.slice("plan_".length)}`;
      let revision: number | undefined;
      const owner = { kind: "agent_turn" as const, clientTurnId: binding.clientTurnId };
      const onAbort = (): void => {
        if (revision !== undefined) confirmations.withdraw({ confirmationId, expectedRevision: revision, owner });
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const registration = confirmations.register({
        confirmationId,
        effect: "reviewed_execution_plan",
        presentation: {
          action: "execute_reviewed_plan",
          target: "local_toolchain",
          subject: {
            kind: "reviewed_execution_plan",
            value: summary.toolLabel,
            plan: {
              ...summary,
              integrities: [...summary.integrities],
              destinationRoots: [...summary.destinationRoots],
              targetAgents: [...summary.targetAgents]
            }
          }
        },
        owner
      }, (decision) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(decision);
        return "committed";
      });
      revision = registration.revision;
      if (registration.status === "busy") {
        reject(new PigeDomainError("permission.confirmation_busy", "Another high-risk effect is awaiting confirmation."));
      } else if (registration.status === "already_resolved") {
        resolve(registration.decision);
      } else if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener("abort", onAbort, { once: true });
      }
    });
  };
}

interface RegisteredRecipeStep {
  readonly ordinal: number;
  readonly actionId: string;
  readonly interactionProtocol: TaskExecutionInteractionProtocol;
  readonly readOnlyProbe: boolean;
}

interface RegisteredRecipe {
  readonly recipeId: string;
  readonly recipeVersion: string;
  readonly displayName: string;
  readonly sourceOrigin: string;
  readonly digest: string;
  readonly steps: readonly RegisteredRecipeStep[];
}

interface ServiceLimits {
  readonly maxSteps: number;
  readonly maxOriginsPerStep: number;
  readonly maxDestinationsPerStep: number;
  readonly maxOutputBytesPerStep: number;
  readonly maxInteractionUrlBytes: number;
  readonly maxStepTimeoutMs: number;
}

interface PlanState {
  readonly plan: TaskExecutionPlan;
  status: "unconfirmed" | "confirming" | "confirmed" | "denied" | "invalid";
  confirmation: Promise<void> | undefined;
  nextOrdinal: number;
  activeAuthority: TaskExecutionStepAuthority | undefined;
}

interface AuthorityState {
  readonly owner: TaskExecutionPlanService;
  readonly planId: string;
  readonly ordinal: number;
  consumed: boolean;
}

const authorityStates = new WeakMap<object, AuthorityState>();

export class TaskExecutionPlanService {
  readonly #confirmation: TaskExecutionPlanConfirmation;
  readonly #limits: ServiceLimits;
  readonly #recipes: ReadonlyMap<string, RegisteredRecipe>;
  readonly #plans = new Map<string, PlanState>();

  constructor(options: {
    readonly confirmPlan: TaskExecutionPlanConfirmation;
    readonly manifest?: unknown;
  }) {
    if (!options || typeof options.confirmPlan !== "function") throw planInvalid();
    const parsed = parseManifest(options.manifest ?? taskExecutionPlanManifest);
    this.#confirmation = options.confirmPlan;
    this.#limits = parsed.limits;
    this.#recipes = new Map(parsed.recipes.map((recipe) => [recipe.recipeId, recipe]));
  }

  registeredRecipeIdentity(recipeId: string): {
    readonly recipeId: string;
    readonly recipeVersion: string;
    readonly recipeDigest: string;
  } {
    const recipe = this.#recipes.get(recipeId);
    if (!recipe) throw planInvalid();
    return Object.freeze({
      recipeId: recipe.recipeId,
      recipeVersion: recipe.recipeVersion,
      recipeDigest: recipe.digest
    });
  }

  resolvePlan(input: ResolveTaskExecutionPlanInput): TaskExecutionPlan {
    const recipe = this.#recipes.get(input.recipeId);
    if (!recipe) throw planInvalid();
    validateResolution(input, recipe, this.#limits);

    const environment = deepFreeze(cloneCanonical(input.environment));
    const steps = deepFreeze(input.steps.map((step) => cloneCanonical(step)));
    const identity = {
      vaultId: input.vaultId,
      jobId: input.jobId,
      clientTurnId: input.clientTurnId,
      authoredTaskIntent: input.authoredTaskIntent,
      policyHash: input.policyHash,
      toolCatalogHash: input.toolCatalogHash,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.recipeVersion,
      recipeDigest: recipe.digest,
      actorId: input.actorId,
      actorVersion: input.actorVersion,
      actorDigest: input.actorDigest,
      environment,
      steps
    } as const;
    const summaryIdentity = {
      toolLabel: recipe.displayName,
      resolvedVersion: input.resolvedVersion,
      sourceOrigin: recipe.sourceOrigin,
      integrities: [...input.integrities],
      destinationRoots: [...input.destinationRoots],
      skillCount: input.skillCount,
      targetAgents: [...input.targetAgents]
    } as const;
    const planDigest = hashCanonical("pige.task_execution.plan.v1", { ...identity, summaryIdentity });
    const planId = `plan_${planDigest.slice("sha256:".length, "sha256:".length + 32)}`;
    const summary = deepFreeze({
      planId,
      ...summaryIdentity,
      stepCount: steps.length,
      requiresBrowserOAuth: steps.some((step) => step.interactionProtocol === "browser_oauth")
    });
    const plan = deepFreeze({
      planId,
      ...identity,
      planDigest,
      summary
    });
    const existing = this.#plans.get(planId);
    if (existing) {
      if (canonicalJson(existing.plan) !== canonicalJson(plan)) throw planInvalid();
      return existing.plan;
    }
    this.#plans.set(planId, {
      plan,
      status: "unconfirmed",
      confirmation: undefined,
      nextOrdinal: recipe.steps[0]?.ordinal ?? 1,
      activeAuthority: undefined
    });
    return plan;
  }

  summary(plan: TaskExecutionPlan): TaskExecutionPlanSummary {
    return this.#requirePlan(plan).plan.summary;
  }

  binding(plan: TaskExecutionPlan): TaskExecutionPlanBinding {
    const current = this.#requirePlan(plan).plan;
    return deepFreeze({
      planId: current.planId,
      vaultId: current.vaultId,
      jobId: current.jobId,
      clientTurnId: current.clientTurnId,
      authoredTaskIntent: current.authoredTaskIntent,
      policyHash: current.policyHash,
      toolCatalogHash: current.toolCatalogHash,
      recipeId: current.recipeId,
      recipeVersion: current.recipeVersion,
      recipeDigest: current.recipeDigest,
      actorId: current.actorId,
      actorVersion: current.actorVersion,
      actorDigest: current.actorDigest,
      environment: current.environment,
      planDigest: current.planDigest
    });
  }

  async confirmPlan(
    plan: TaskExecutionPlan,
    readCurrent: TaskExecutionPlanBindingReader,
    signal?: AbortSignal
  ): Promise<void> {
    const state = this.#requirePlan(plan);
    signal?.throwIfAborted();
    this.#assertCurrent(state, readCurrent);
    if (state.status === "confirmed") return;
    if (state.status === "denied") throw confirmationDenied();
    if (state.status === "invalid") throw bindingChanged();
    if (state.confirmation) return state.confirmation;

    state.status = "confirming";
    const confirmation = (async () => {
      let decision: "allow" | "deny";
      try {
        decision = await this.#confirmation(state.plan.summary, this.binding(state.plan), signal);
        signal?.throwIfAborted();
        this.#assertCurrent(state, readCurrent);
      } catch (caught) {
        state.status = "invalid";
        throw caught;
      }
      if (decision !== "allow") {
        state.status = "denied";
        throw confirmationDenied();
      }
      state.status = "confirmed";
    })();
    state.confirmation = confirmation;
    try {
      await confirmation;
    } finally {
      state.confirmation = undefined;
    }
  }

  issueNextAuthority(
    plan: TaskExecutionPlan,
    expectedOrdinal: number,
    readCurrent: TaskExecutionPlanBindingReader
  ): TaskExecutionStepAuthority {
    const state = this.#requirePlan(plan);
    this.#assertCurrent(state, readCurrent);
    if (state.status !== "confirmed") throw authorityInvalid();
    if (expectedOrdinal !== state.nextOrdinal || !state.plan.steps.some((step) => step.ordinal === expectedOrdinal)) {
      this.#invalidate(state);
      throw authorityInvalid();
    }
    if (state.activeAuthority) return state.activeAuthority;
    const authority = Object.freeze(Object.create(null)) as TaskExecutionStepAuthority;
    authorityStates.set(authority, {
      owner: this,
      planId: state.plan.planId,
      ordinal: expectedOrdinal,
      consumed: false
    });
    state.activeAuthority = authority;
    return authority;
  }

  consumeAuthority(
    authority: TaskExecutionStepAuthority,
    plan: TaskExecutionPlan,
    expectedOrdinal: number,
    readCurrent: TaskExecutionPlanBindingReader
  ): TaskExecutionPlanStep {
    const state = this.#requirePlan(plan);
    const authorityState = authorityStates.get(authority);
    if (
      !authorityState ||
      authorityState.owner !== this ||
      authorityState.planId !== state.plan.planId ||
      authorityState.ordinal !== expectedOrdinal ||
      authorityState.consumed ||
      state.activeAuthority !== authority ||
      state.nextOrdinal !== expectedOrdinal
    ) {
      this.#invalidate(state);
      throw authorityInvalid();
    }
    this.#assertCurrent(state, readCurrent);
    const step = state.plan.steps.find((candidate) => candidate.ordinal === expectedOrdinal);
    if (!step) {
      this.#invalidate(state);
      throw authorityInvalid();
    }
    authorityState.consumed = true;
    state.activeAuthority = undefined;
    state.nextOrdinal = expectedOrdinal + 1;
    return step;
  }

  #requirePlan(plan: TaskExecutionPlan): PlanState {
    if (!plan || typeof plan !== "object" || !PLAN_ID_PATTERN.test(plan.planId ?? "")) throw planInvalid();
    const state = this.#plans.get(plan.planId);
    if (!state || canonicalJson(state.plan) !== canonicalJson(plan)) throw planInvalid();
    if (state.status === "invalid") throw bindingChanged();
    return state;
  }

  #assertCurrent(state: PlanState, readCurrent: TaskExecutionPlanBindingReader): void {
    if (typeof readCurrent !== "function") {
      this.#invalidate(state);
      throw bindingChanged();
    }
    let current: TaskExecutionPlanBinding;
    try {
      current = readCurrent();
    } catch {
      this.#invalidate(state);
      throw bindingChanged();
    }
    const expected = this.binding(state.plan);
    if (canonicalJson(current) !== canonicalJson(expected)) {
      this.#invalidate(state);
      throw bindingChanged();
    }
  }

  #invalidate(state: PlanState): void {
    state.status = "invalid";
    const authority = state.activeAuthority;
    if (authority) {
      const record = authorityStates.get(authority);
      if (record) record.consumed = true;
      state.activeAuthority = undefined;
    }
  }
}

function parseManifest(input: unknown): { readonly limits: ServiceLimits; readonly recipes: readonly RegisteredRecipe[] } {
  const record = asRecord(input);
  if (record.schemaVersion !== 1 || record.owner !== "TaskExecutionPlanService") throw planInvalid();
  const limitsRecord = asRecord(record.limits);
  const limits: ServiceLimits = {
    maxSteps: boundedInteger(limitsRecord.maxSteps, 1, 64),
    maxOriginsPerStep: boundedInteger(limitsRecord.maxOriginsPerStep, 0, 64),
    maxDestinationsPerStep: boundedInteger(limitsRecord.maxDestinationsPerStep, 0, 64),
    maxOutputBytesPerStep: boundedInteger(limitsRecord.maxOutputBytesPerStep, 1, 16 * 1024 * 1024),
    maxInteractionUrlBytes: boundedInteger(limitsRecord.maxInteractionUrlBytes, 1, 64 * 1024),
    maxStepTimeoutMs: boundedInteger(limitsRecord.maxStepTimeoutMs, 1, 3_600_000)
  };
  const fixture = asRecord(record.officialRecipeFixture);
  const sources = asArray(fixture.sources).map(asRecord);
  const sourceOrigin = requireOrigin(asString(sources[0]?.declaredOrigin));
  const steps = asArray(fixture.steps).map((value): RegisteredRecipeStep => {
    const step = asRecord(value);
    return deepFreeze({
      ordinal: boundedInteger(step.ordinal, 1, limits.maxSteps),
      actionId: requireId(step.actionId),
      interactionProtocol: requireInteractionProtocol(step.interactionProtocol),
      readOnlyProbe: step.readOnlyProbe === true
    });
  });
  assertContiguousOrdinals(steps);
  const recipeIdentity = cloneCanonical(fixture);
  return {
    limits: Object.freeze(limits),
    recipes: Object.freeze([deepFreeze({
      recipeId: requireId(fixture.recipeId),
      recipeVersion: requireVersion(fixture.recipeVersion),
      displayName: requireSafeLabel(fixture.displayName),
      sourceOrigin,
      digest: hashCanonical("pige.task_execution.registered_recipe.v1", recipeIdentity),
      steps
    })])
  };
}

function validateResolution(input: ResolveTaskExecutionPlanInput, recipe: RegisteredRecipe, limits: ServiceLimits): void {
  if (
    !ID_PATTERN.test(input.vaultId) ||
    !ID_PATTERN.test(input.jobId) ||
    !ID_PATTERN.test(input.clientTurnId) ||
    input.authoredTaskIntent !== "explicit_user_task" ||
    !SHA256_PATTERN.test(input.policyHash) ||
    !SHA256_PATTERN.test(input.toolCatalogHash) ||
    !ID_PATTERN.test(input.actorId) ||
    !VERSION_PATTERN.test(input.actorVersion) ||
    !SHA256_PATTERN.test(input.actorDigest) ||
    !VERSION_PATTERN.test(input.resolvedVersion) ||
    !Number.isInteger(input.skillCount) ||
    input.skillCount < 0 ||
    input.steps.length !== recipe.steps.length ||
    input.steps.length > limits.maxSteps
  ) throw planInvalid();
  validateEnvironment(input.environment, limits);
  validateSafeStringArray(input.integrities, 16, SHA256_PATTERN);
  validateSafeStringArray(input.destinationRoots, limits.maxDestinationsPerStep * limits.maxSteps, SAFE_LABEL_PATTERN);
  validateSafeStringArray(input.targetAgents, 32, SAFE_LABEL_PATTERN);
  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    const registered = recipe.steps[index];
    if (!step || !registered) throw planInvalid();
    validateStep(step, registered, limits);
  }
}

function validateEnvironment(environment: TaskExecutionPlanEnvironment, limits: ServiceLimits): void {
  const scalarValues = [
    environment.controlledHomeRoot,
    environment.configRoot,
    environment.canonicalWorkingDirectory,
    environment.temporaryDirectoryPolicy,
    environment.localeProfile,
    environment.npmPrefix,
    environment.npmCache,
    environment.npmConfigProvenance
  ];
  if (scalarValues.some((value) => typeof value !== "string" || value.length < 1 || value.length > 4096)) throw planInvalid();
  requireOrigin(environment.npmRegistry);
  validateBoundStringArray(environment.sanitizedPathEntries, 64, 4096);
  validateBoundStringArray(environment.descendantExecutableIdentities, 64, 4096);
  validateBoundStringArray(environment.targetAgentRoots, 32, 4096);
  validateOriginArray(environment.networkOrigins, limits.maxOriginsPerStep * limits.maxSteps);
  validateBoundStringArray(environment.destinations, limits.maxDestinationsPerStep * limits.maxSteps, 4096);
  const handles = asRecord(environment.secretHandleVersions);
  if (Object.keys(handles).length > 32) throw planInvalid();
  for (const [handle, version] of Object.entries(handles)) {
    if (!ID_PATTERN.test(handle) || typeof version !== "string" || !VERSION_PATTERN.test(version)) throw planInvalid();
  }
}

function validateStep(step: TaskExecutionPlanStepInput, registered: RegisteredRecipeStep, limits: ServiceLimits): void {
  if (
    step.ordinal !== registered.ordinal ||
    step.actionId !== registered.actionId ||
    step.interactionProtocol !== registered.interactionProtocol ||
    !ID_PATTERN.test(step.adapterId) ||
    !VERSION_PATTERN.test(step.adapterVersion) ||
    !SHA256_PATTERN.test(step.adapterDigest) ||
    typeof step.normalizedExecutableIdentity !== "string" ||
    step.normalizedExecutableIdentity.length < 1 ||
    step.normalizedExecutableIdentity.length > 4096 ||
    typeof step.canonicalWorkingDirectory !== "string" ||
    step.canonicalWorkingDirectory.length < 1 ||
    step.canonicalWorkingDirectory.length > 4096 ||
    !SHA256_PATTERN.test(step.environmentProfileHash) ||
    !SHA256_PATTERN.test(step.inputHash) ||
    !ID_PATTERN.test(step.postconditionProbeId) ||
    (step.recoveryMode !== "probe_then_adopt" && step.recoveryMode !== "fail_closed") ||
    !Number.isInteger(step.timeoutMs) ||
    step.timeoutMs < 1 ||
    step.timeoutMs > limits.maxStepTimeoutMs
  ) throw planInvalid();
  validateBoundStringArray(step.argv, 64, 4096);
  validateOriginArray(step.networkOrigins, limits.maxOriginsPerStep);
  validateBoundStringArray(step.destinations, limits.maxDestinationsPerStep, 4096);
}

function assertContiguousOrdinals(steps: readonly RegisteredRecipeStep[]): void {
  if (steps.length === 0) throw planInvalid();
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index]?.ordinal !== index + 1) throw planInvalid();
  }
}

function validateSafeStringArray(values: readonly string[], max: number, pattern: RegExp): void {
  if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) throw planInvalid();
  if (values.some((value) => typeof value !== "string" || !pattern.test(value))) throw planInvalid();
}

function validateBoundStringArray(values: readonly string[], max: number, maxBytes: number): void {
  if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) throw planInvalid();
  if (values.some((value) => typeof value !== "string" || value.length < 1 || Buffer.byteLength(value, "utf8") > maxBytes)) {
    throw planInvalid();
  }
}

function validateOriginArray(values: readonly string[], max: number): void {
  if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) throw planInvalid();
  for (const value of values) requireOrigin(value);
}

function requireOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.username || parsed.password) throw planInvalid();
    return parsed.origin;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw planInvalid();
  }
}

function requireInteractionProtocol(value: unknown): TaskExecutionInteractionProtocol {
  if (value !== "none" && value !== "browser_oauth") throw planInvalid();
  return value;
}

function requireId(value: unknown): string {
  const text = asString(value);
  if (!ID_PATTERN.test(text)) throw planInvalid();
  return text;
}

function requireVersion(value: unknown): string {
  const text = asString(value);
  if (!VERSION_PATTERN.test(text)) throw planInvalid();
  return text;
}

function requireSafeLabel(value: unknown): string {
  const text = asString(value);
  if (!SAFE_LABEL_PATTERN.test(text)) throw planInvalid();
  return text;
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw planInvalid();
  return value as number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw planInvalid();
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw planInvalid();
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw planInvalid();
  return value;
}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw planInvalid();
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
  throw planInvalid();
}

function planInvalid(): PigeDomainError {
  return new PigeDomainError("task_execution.plan_invalid", "The reviewed task execution plan is invalid.");
}

function bindingChanged(): PigeDomainError {
  return new PigeDomainError("task_execution.binding_changed", "The reviewed task execution plan binding changed.");
}

function confirmationDenied(): PigeDomainError {
  return new PigeDomainError("task_execution.confirmation_denied", "The reviewed task execution plan was denied.");
}

function authorityInvalid(): PigeDomainError {
  return new PigeDomainError("task_execution.authority_invalid", "The exact task execution step authority is invalid.");
}
