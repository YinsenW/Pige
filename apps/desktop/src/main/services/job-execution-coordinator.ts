import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  PigeErrorSummarySchema,
  type JobCheckpoint,
  type JobRecord,
  type JobRef,
  type JobStage,
  type JobState,
  type PigeErrorSummary,
  type PigeWarning
} from "@pige/schemas";
import { type JobRecordSnapshot, JobRecordStore } from "./job-record-store";

type JobProgress = NonNullable<JobRecord["progress"]>;
type JobPrivacy = NonNullable<JobRecord["privacy"]>;
type WaitingDependency = NonNullable<JobRecord["waitingDependency"]>;

const BEGIN_STATES = new Set<JobState>([
  "queued",
  "failed_retryable"
]);

const RESUME_STATES = new Set<JobState>([
  "waiting_dependency",
  "waiting_permission",
  "waiting_model_egress",
  "awaiting_review"
]);

const OUTCOME_SOURCE_STATES = new Set<JobState>(["running", "cancel_requested"]);
const OUTCOME_STATES = new Set<JobState>([
  "waiting_dependency",
  "waiting_permission",
  "waiting_model_egress",
  "awaiting_review",
  "completed",
  "completed_with_warnings",
  "failed_retryable",
  "failed_final",
  "cancelled"
]);

const TERMINAL_STATES = new Set<JobState>([
  "completed",
  "completed_with_warnings",
  "failed_final",
  "cancelled",
  "compacted"
]);

const FACT_KEYS = new Set([
  "stage",
  "inputRefs",
  "outputRefs",
  "permissionRequestIds",
  "proposalIds",
  "operationIds",
  "checkpoints",
  "progress",
  "warnings",
  "policyContextId",
  "policyHash",
  "privacy",
  "message"
]);

export interface JobExecutionFactsPatch {
  readonly stage?: JobStage;
  readonly inputRefs?: readonly JobRef[];
  readonly outputRefs?: readonly JobRef[];
  readonly permissionRequestIds?: readonly string[];
  readonly proposalIds?: readonly string[];
  readonly operationIds?: readonly string[];
  readonly checkpoints?: readonly JobCheckpoint[];
  readonly progress?: JobProgress;
  readonly warnings?: readonly PigeWarning[];
  readonly policyContextId?: string;
  readonly policyHash?: string;
  readonly privacy?: JobPrivacy;
  readonly message?: string;
}

export interface BeginJobInput {
  readonly stage: JobStage;
  readonly message: string;
  readonly facts?: JobExecutionFactsPatch;
}

export type JobExecutionResumeProof =
  | {
      readonly kind: "dependency_repaired";
      readonly dependency: WaitingDependency;
      readonly operationId: string;
    }
  | {
      readonly kind: "permission_decided";
      readonly permissionRequestId: string;
      readonly permissionDecisionId: string;
    }
  | {
      readonly kind: "model_egress_decided";
      readonly approvalRequestId: string;
      readonly operationId: string;
    }
  | {
      readonly kind: "review_resolved";
      readonly proposalId: string;
      readonly operationId: string;
    };

export interface ResumeJobInput {
  readonly stage: JobStage;
  readonly message: string;
  readonly proof: JobExecutionResumeProof;
  readonly facts?: JobExecutionFactsPatch;
}

interface RetryableJobOutcome {
  readonly kind: "requeue";
  readonly error: PigeErrorSummary;
  readonly reason: string;
  readonly maxAutomaticRetries: number;
  readonly nextRetryAt?: string;
  readonly requiresUserAction?: boolean;
  readonly message: string;
  readonly facts?: JobExecutionFactsPatch;
}

export type JobExecutionOutcome =
  | {
      readonly kind: "completed";
      readonly result?: "completed" | "completed_with_warnings";
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | {
      readonly kind: "waiting";
      readonly reason: "dependency";
      readonly dependency: WaitingDependency;
      readonly error?: PigeErrorSummary;
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | {
      readonly kind: "waiting";
      readonly reason: "permission";
      readonly permissionRequestId: string;
      readonly error: PigeErrorSummary;
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | {
      readonly kind: "waiting";
      readonly reason: "model_egress";
      readonly approvalRequestId: string;
      readonly error: PigeErrorSummary;
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | {
      readonly kind: "waiting";
      readonly reason: "review";
      readonly proposalId: string;
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | {
      readonly kind: "failed";
      readonly error: PigeErrorSummary;
      readonly message: string;
      readonly facts?: JobExecutionFactsPatch;
    }
  | RetryableJobOutcome;

export interface RequestCancellationInput {
  readonly requestedBy: "user" | "system";
  readonly message: string;
}

export interface MarkDurableBoundaryInput {
  readonly checkpointId: string;
  readonly message?: string;
  readonly facts?: JobExecutionFactsPatch;
}

export interface CancellationOutcomeInput {
  readonly cancelledMessage: string;
  readonly preservedResultMessage: string;
  readonly facts?: JobExecutionFactsPatch;
}

export interface JobExecutionCoordinatorOptions {
  readonly now?: () => Date;
}

export function isTerminalJobState(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isLegalJobStateTransition(from: JobState, to: JobState): boolean {
  if (isTerminalJobState(from)) return false;
  if (BEGIN_STATES.has(from) && to === "running") return true;
  if (RESUME_STATES.has(from) && to === "running") return true;
  if (from === "running" && to === "cancel_requested") return true;
  return OUTCOME_SOURCE_STATES.has(from) && OUTCOME_STATES.has(to);
}

export class JobExecutionCoordinator {
  readonly #store: JobRecordStore;
  readonly #now: () => Date;

  constructor(store: JobRecordStore, options: JobExecutionCoordinatorOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
  }

  begin(snapshot: JobRecordSnapshot, input: BeginJobInput): JobRecordSnapshot {
    assertKeys(input, ["stage", "message", "facts"]);
    if (!BEGIN_STATES.has(snapshot.job.state)) {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw invalidTransition(snapshot.job.state, "running");
    }
    const timestamp = this.#timestamp(snapshot.job);
    const retry = snapshot.job.state === "failed_retryable"
      ? incrementRetry(snapshot.job.retry)
      : snapshot.job.retry;
    const cancellation = projectCancellationForBegin(snapshot.job.cancellation);
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      state: "running",
      stage: input.stage,
      startedAt: timestamp,
      updatedAt: timestamp,
      message: input.message,
      ...(retry ? { retry } : {}),
      cancellation,
      finishedAt: undefined,
      waitingDependency: undefined,
      error: undefined
    });
  }

  resume(snapshot: JobRecordSnapshot, input: ResumeJobInput): JobRecordSnapshot {
    assertKeys(input, ["stage", "message", "proof", "facts"]);
    if (!RESUME_STATES.has(snapshot.job.state)) {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw invalidTransition(snapshot.job.state, "running");
    }
    const proofFacts = validateResumeProof(snapshot.job, input.proof);
    const timestamp = this.#timestamp(snapshot.job);
    const cancellation = projectCancellationForBegin(snapshot.job.cancellation);
    return this.#commit(snapshot, {
      ...applyFacts(applyFacts(snapshot.job, input.facts), proofFacts),
      state: "running",
      stage: input.stage,
      startedAt: timestamp,
      updatedAt: timestamp,
      message: input.message,
      cancellation,
      finishedAt: undefined,
      waitingDependency: undefined,
      error: undefined
    });
  }

  patch(snapshot: JobRecordSnapshot, facts: JobExecutionFactsPatch): JobRecordSnapshot {
    assertFacts(facts);
    if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
    if (Object.keys(facts).length === 0) {
      throw new PigeDomainError("job.patch_empty", "A durable Job fact patch must not be empty.");
    }
    return this.#commit(snapshot, {
      ...applyFacts(snapshot.job, facts),
      updatedAt: this.#timestamp(snapshot.job)
    });
  }

  settle(snapshot: JobRecordSnapshot, outcome: JobExecutionOutcome): JobRecordSnapshot {
    assertOutcomeKeys(outcome);
    switch (outcome.kind) {
      case "completed":
        return this.#complete(snapshot, outcome);
      case "failed":
        return this.#failFinal(snapshot, outcome);
      case "requeue":
        return this.#requeue(snapshot, outcome);
      case "waiting":
        switch (outcome.reason) {
          case "dependency":
            return this.#waitForDependency(snapshot, outcome);
          case "permission":
            return this.#waitForPermission(snapshot, outcome);
          case "model_egress":
            return this.#waitForModelEgress(snapshot, outcome);
          case "review":
            return this.#waitForReview(snapshot, outcome);
        }
    }
  }

  #waitForDependency(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "waiting"; reason: "dependency" }>
  ): JobRecordSnapshot {
    return this.#wait(snapshot, "waiting_dependency", input.message, input.facts, {
      waitingDependency: input.dependency,
      ...(input.error ? { error: parseError(input.error) } : {})
    });
  }

  #waitForPermission(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "waiting"; reason: "permission" }>
  ): JobRecordSnapshot {
    assertMatchingOptionalId(input.error.permissionRequestId, input.permissionRequestId);
    const error = parseError({ ...input.error, permissionRequestId: input.permissionRequestId });
    return this.#wait(snapshot, "waiting_permission", input.message, {
      ...input.facts,
      permissionRequestIds: [
        ...(input.facts?.permissionRequestIds ?? []),
        input.permissionRequestId
      ]
    }, { error });
  }

  #waitForModelEgress(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "waiting"; reason: "model_egress" }>
  ): JobRecordSnapshot {
    assertMatchingOptionalId(input.error.modelEgressApprovalRequestId, input.approvalRequestId);
    const error = parseError({
      ...input.error,
      modelEgressApprovalRequestId: input.approvalRequestId
    });
    return this.#wait(snapshot, "waiting_model_egress", input.message, input.facts, { error });
  }

  #waitForReview(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "waiting"; reason: "review" }>
  ): JobRecordSnapshot {
    return this.#wait(snapshot, "awaiting_review", input.message, {
      ...input.facts,
      proposalIds: [...(input.facts?.proposalIds ?? []), input.proposalId]
    });
  }

  #complete(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "completed" }>
  ): JobRecordSnapshot {
    if (snapshot.job.state === "cancel_requested") {
      return this.cancellationOutcome(snapshot, {
        cancelledMessage: input.message,
        preservedResultMessage: input.message,
        ...(input.facts ? { facts: input.facts } : {})
      });
    }
    const state = input.result ?? "completed";
    this.#assertTransition(snapshot.job, state);
    return this.#finish(snapshot, state, input.message, input.facts);
  }

  #failFinal(
    snapshot: JobRecordSnapshot,
    input: Extract<JobExecutionOutcome, { kind: "failed" }>
  ): JobRecordSnapshot {
    const error = parseError(input.error);
    if (error.retryable) {
      throw new PigeDomainError(
        "job.failure_invalid",
        "The Job failure state must agree with the shared error retryability projection."
      );
    }
    this.#assertTransition(snapshot.job, "failed_final");
    const next = applyFacts(snapshot.job, input.facts);
    const timestamp = this.#timestamp(snapshot.job);
    return this.#commit(snapshot, {
      ...next,
      state: "failed_final",
      updatedAt: timestamp,
      message: input.message,
      error,
      ...(snapshot.job.retry ? { retry: snapshot.job.retry } : {}),
      waitingDependency: undefined,
      finishedAt: timestamp
    });
  }

  #requeue(snapshot: JobRecordSnapshot, input: RetryableJobOutcome): JobRecordSnapshot {
    const error = parseError(input.error);
    if (!error.retryable) {
      throw new PigeDomainError(
        "job.failure_invalid",
        "A requeued Job requires a retryable shared error projection."
      );
    }
    this.#assertTransition(snapshot.job, "failed_retryable");
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      state: "failed_retryable",
      updatedAt: this.#timestamp(snapshot.job),
      message: input.message,
      error,
      retry: {
        retryCount: snapshot.job.retry?.retryCount ?? 0,
        maxAutomaticRetries: input.maxAutomaticRetries,
        ...(input.nextRetryAt ? { nextRetryAt: input.nextRetryAt } : {}),
        lastRetryReason: input.reason,
        ...(input.requiresUserAction === undefined
          ? {}
          : { requiresUserAction: input.requiresUserAction })
      },
      waitingDependency: undefined,
      finishedAt: undefined
    });
  }

  requestCancellation(
    snapshot: JobRecordSnapshot,
    input: RequestCancellationInput
  ): JobRecordSnapshot {
    assertKeys(input, ["requestedBy", "message"]);
    if (snapshot.job.state === "cancel_requested") return snapshot;
    this.#assertTransition(snapshot.job, "cancel_requested");
    const timestamp = this.#timestamp(snapshot.job);
    return this.#commit(snapshot, {
      ...snapshot.job,
      state: "cancel_requested",
      updatedAt: timestamp,
      message: input.message,
      cancellation: {
        ...snapshot.job.cancellation,
        requestedAt: timestamp,
        requestedBy: input.requestedBy
      }
    });
  }

  markDurableBoundary(
    snapshot: JobRecordSnapshot,
    input: MarkDurableBoundaryInput
  ): JobRecordSnapshot {
    assertKeys(input, ["checkpointId", "message", "facts"]);
    if (snapshot.job.state !== "running") {
      throw invalidTransition(snapshot.job.state, snapshot.job.state);
    }
    if (input.checkpointId.trim() === "") {
      throw new PigeDomainError("job.cancellation_invalid", "A durable boundary requires a checkpoint ID.");
    }
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      updatedAt: this.#timestamp(snapshot.job),
      ...(input.message ? { message: input.message } : {}),
      cancellation: {
        ...snapshot.job.cancellation,
        safeCheckpointId: input.checkpointId,
        durableWritesApplied: true
      }
    });
  }

  cancellationOutcome(
    snapshot: JobRecordSnapshot,
    input: CancellationOutcomeInput
  ): JobRecordSnapshot {
    assertKeys(input, ["cancelledMessage", "preservedResultMessage", "facts"]);
    if (snapshot.job.state !== "cancel_requested") {
      throw invalidTransition(snapshot.job.state, "cancelled");
    }
    const durableWritesApplied = snapshot.job.cancellation?.durableWritesApplied === true;
    const state = durableWritesApplied ? "completed_with_warnings" : "cancelled";
    this.#assertTransition(snapshot.job, state);
    return this.#finish(
      snapshot,
      state,
      durableWritesApplied ? input.preservedResultMessage : input.cancelledMessage,
      input.facts
    );
  }

  #wait(
    snapshot: JobRecordSnapshot,
    state: Extract<JobState, "waiting_dependency" | "waiting_permission" | "waiting_model_egress" | "awaiting_review">,
    message: string,
    facts?: JobExecutionFactsPatch,
    additions: Partial<Pick<JobRecord, "waitingDependency" | "error">> = {}
  ): JobRecordSnapshot {
    this.#assertTransition(snapshot.job, state);
    const next = applyFacts(snapshot.job, facts);
    return this.#commit(snapshot, {
      ...next,
      state,
      updatedAt: this.#timestamp(snapshot.job),
      message,
      finishedAt: undefined,
      waitingDependency: undefined,
      error: undefined,
      ...additions
    });
  }

  #finish(
    snapshot: JobRecordSnapshot,
    state: Extract<JobState, "completed" | "completed_with_warnings" | "cancelled">,
    message: string,
    facts?: JobExecutionFactsPatch
  ): JobRecordSnapshot {
    const next = applyFacts(snapshot.job, facts);
    const timestamp = this.#timestamp(snapshot.job);
    return this.#commit(snapshot, {
      ...next,
      state,
      updatedAt: timestamp,
      finishedAt: timestamp,
      message,
      waitingDependency: undefined,
      error: undefined,
      ...(state === "cancelled"
        ? {
            cancellation: {
              ...snapshot.job.cancellation,
              durableWritesApplied: false
            }
          }
        : {})
    });
  }

  #assertTransition(current: JobRecord, nextState: JobState): void {
    if (isTerminalJobState(current.state)) throw terminalImmutable(current.state);
    if (!isLegalJobStateTransition(current.state, nextState)) {
      throw invalidTransition(current.state, nextState);
    }
  }

  #timestamp(current: JobRecord): string {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new PigeDomainError("job.clock_invalid", "The Job coordinator clock returned an invalid timestamp.");
    }
    const currentTime = Date.parse(current.updatedAt);
    return new Date(Math.max(now.getTime(), currentTime)).toISOString();
  }

  #commit(snapshot: JobRecordSnapshot, candidate: unknown): JobRecordSnapshot {
    return this.#store.compareAndSwap(snapshot, JobRecordSchema.parse(candidate));
  }
}

function applyFacts(job: JobRecord, facts?: JobExecutionFactsPatch): JobRecord {
  if (!facts) return job;
  assertFacts(facts);
  return {
    ...job,
    ...(facts.stage ? { stage: facts.stage } : {}),
    ...(facts.inputRefs ? { inputRefs: mergeValues(job.inputRefs, facts.inputRefs) } : {}),
    ...(facts.outputRefs ? { outputRefs: mergeValues(job.outputRefs, facts.outputRefs) } : {}),
    ...(facts.permissionRequestIds
      ? { permissionRequestIds: mergeStrings(job.permissionRequestIds, facts.permissionRequestIds) }
      : {}),
    ...(facts.proposalIds ? { proposalIds: mergeStrings(job.proposalIds, facts.proposalIds) } : {}),
    ...(facts.operationIds ? { operationIds: mergeStrings(job.operationIds, facts.operationIds) } : {}),
    ...(facts.checkpoints ? { checkpoints: mergeCheckpoints(job.checkpoints, facts.checkpoints) } : {}),
    ...(facts.progress ? { progress: { ...facts.progress } } : {}),
    ...(facts.warnings ? { warnings: mergeValues(job.warnings, facts.warnings) } : {}),
    ...(facts.policyContextId ? { policyContextId: facts.policyContextId } : {}),
    ...(facts.policyHash ? { policyHash: facts.policyHash } : {}),
    ...(facts.privacy ? { privacy: mergePrivacy(job.privacy, facts.privacy) } : {}),
    ...(facts.message ? { message: facts.message } : {})
  };
}

function assertFacts(facts: JobExecutionFactsPatch): void {
  assertKeys(facts, FACT_KEYS);
}

function assertOutcomeKeys(outcome: JobExecutionOutcome): void {
  switch (outcome.kind) {
    case "completed":
      assertKeys(outcome, ["kind", "result", "message", "facts"]);
      return;
    case "failed":
      assertKeys(outcome, ["kind", "error", "message", "facts"]);
      return;
    case "requeue":
      assertKeys(outcome, [
        "kind",
        "error",
        "reason",
        "maxAutomaticRetries",
        "nextRetryAt",
        "requiresUserAction",
        "message",
        "facts"
      ]);
      return;
    case "waiting":
      switch (outcome.reason) {
        case "dependency":
          assertKeys(outcome, ["kind", "reason", "dependency", "error", "message", "facts"]);
          return;
        case "permission":
          assertKeys(outcome, ["kind", "reason", "permissionRequestId", "error", "message", "facts"]);
          return;
        case "model_egress":
          assertKeys(outcome, ["kind", "reason", "approvalRequestId", "error", "message", "facts"]);
          return;
        case "review":
          assertKeys(outcome, ["kind", "reason", "proposalId", "message", "facts"]);
          return;
      }
  }
}

function validateResumeProof(job: JobRecord, proof: JobExecutionResumeProof): JobExecutionFactsPatch {
  switch (proof.kind) {
    case "dependency_repaired":
      assertKeys(proof, ["kind", "dependency", "operationId"]);
      if (
        job.state !== "waiting_dependency" ||
        !job.waitingDependency ||
        JSON.stringify(job.waitingDependency) !== JSON.stringify(proof.dependency)
      ) {
        throw invalidResumeProof();
      }
      return { operationIds: [proof.operationId] };
    case "permission_decided":
      assertKeys(proof, ["kind", "permissionRequestId", "permissionDecisionId"]);
      if (
        job.state !== "waiting_permission" ||
        job.error?.permissionRequestId !== proof.permissionRequestId ||
        !job.permissionRequestIds?.includes(proof.permissionRequestId)
      ) {
        throw invalidResumeProof();
      }
      return {
        privacy: {
          usedCloudModel: false,
          usedNetwork: false,
          usedShell: false,
          accessedExternalFiles: false,
          permissionDecisionIds: [proof.permissionDecisionId]
        }
      };
    case "model_egress_decided":
      assertKeys(proof, ["kind", "approvalRequestId", "operationId"]);
      if (
        job.state !== "waiting_model_egress" ||
        job.error?.modelEgressApprovalRequestId !== proof.approvalRequestId
      ) {
        throw invalidResumeProof();
      }
      return { operationIds: [proof.operationId] };
    case "review_resolved":
      assertKeys(proof, ["kind", "proposalId", "operationId"]);
      if (job.state !== "awaiting_review" || !job.proposalIds?.includes(proof.proposalId)) {
        throw invalidResumeProof();
      }
      return { operationIds: [proof.operationId] };
  }
}

function assertMatchingOptionalId(current: string | undefined, expected: string): void {
  if (current !== undefined && current !== expected) {
    throw new PigeDomainError(
      "job.wait_binding_invalid",
      "The Job wait request does not match the bound shared error summary."
    );
  }
}

function assertKeys(value: object, allowed: Iterable<string>): void {
  const allowedKeys = allowed instanceof Set ? allowed : new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) {
    throw new PigeDomainError(
      "job.command_invalid",
      `The Job coordinator command contains an unsupported ${unknown} field.`
    );
  }
}

function parseError(error: PigeErrorSummary): PigeErrorSummary {
  return PigeErrorSummarySchema.parse(error);
}

function incrementRetry(retry: JobRecord["retry"]): NonNullable<JobRecord["retry"]> {
  return {
    retryCount: (retry?.retryCount ?? 0) + 1,
    maxAutomaticRetries: retry?.maxAutomaticRetries ?? 0,
    ...(retry?.lastRetryReason ? { lastRetryReason: retry.lastRetryReason } : {})
  };
}

function projectCancellationForBegin(
  cancellation: JobRecord["cancellation"]
): JobRecord["cancellation"] {
  if (cancellation?.durableWritesApplied !== true) return undefined;
  return {
    ...(cancellation.safeCheckpointId ? { safeCheckpointId: cancellation.safeCheckpointId } : {}),
    durableWritesApplied: true
  };
}

function mergeStrings(current: readonly string[] | undefined, added: readonly string[]): string[] {
  return [...new Set([...(current ?? []), ...added])];
}

function mergeValues<T>(current: readonly T[] | undefined, added: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const value of [...(current ?? []), ...added]) merged.set(JSON.stringify(value), value);
  return [...merged.values()];
}

function mergeCheckpoints(
  current: readonly JobCheckpoint[] | undefined,
  added: readonly JobCheckpoint[]
): JobCheckpoint[] {
  const merged = new Map((current ?? []).map((checkpoint) => [checkpoint.id, checkpoint]));
  for (const checkpoint of added) merged.set(checkpoint.id, checkpoint);
  return [...merged.values()];
}

function mergePrivacy(current: JobRecord["privacy"], added: JobPrivacy): JobPrivacy {
  return {
    usedCloudModel: current?.usedCloudModel === true || added.usedCloudModel,
    usedNetwork: current?.usedNetwork === true || added.usedNetwork,
    usedShell: current?.usedShell === true || added.usedShell,
    accessedExternalFiles: current?.accessedExternalFiles === true || added.accessedExternalFiles,
    permissionDecisionIds: mergeStrings(current?.permissionDecisionIds, added.permissionDecisionIds)
  };
}

function terminalImmutable(state: JobState): PigeDomainError {
  return new PigeDomainError("job.terminal_immutable", `Terminal Job state ${state} is immutable.`);
}

function invalidTransition(from: JobState, to: JobState): PigeDomainError {
  return new PigeDomainError("job.transition_invalid", `Job state ${from} cannot transition to ${to}.`);
}

function invalidResumeProof(): PigeDomainError {
  return new PigeDomainError(
    "job.resume_proof_invalid",
    "The Job resume proof does not match the durable wait binding."
  );
}
