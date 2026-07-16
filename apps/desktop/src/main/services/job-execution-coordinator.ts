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

const PENDING_CANCELLATION_STATES = new Set<JobState>([
  "queued",
  "failed_retryable",
  "waiting_dependency",
  "waiting_permission",
  "waiting_model_egress",
  "awaiting_review"
]);

const EXPLICIT_RETRY_STATES = new Set<JobState>([
  "failed_retryable",
  "waiting_dependency",
  "cancelled"
]);

const PRE_EXECUTION_OUTCOME_STATES = new Set<JobState>([
  "waiting_dependency",
  "waiting_permission",
  "waiting_model_egress",
  "awaiting_review",
  "failed_retryable",
  "failed_final"
]);
const WAITING_RESOLUTION_STATES = new Set<JobState>([
  "failed_retryable",
  "failed_final",
  "cancelled"
]);
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
const CANCELLATION_OUTCOME_STATES = new Set<JobState>([
  "completed_with_warnings",
  "failed_retryable",
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
  "childJobIds",
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
  readonly childJobIds?: readonly string[];
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
    }
  | {
      readonly kind: "source_preserved";
      readonly sourceId: string;
      readonly conversationEventId: string;
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

export interface CancelPendingJobInput extends RequestCancellationInput {
  readonly safeCheckpointId: string;
}

export interface PrepareJobRetryInput {
  readonly message: string;
}

export type QueueJobReason =
  | "dependency_repaired"
  | "source_preserved"
  | "idempotent_recovery"
  | "agent_continuation"
  | "source_changed"
  | "permission_decided"
  | "model_egress_decided"
  | "review_resolved";

interface QueueJobInputBase {
  readonly message: string;
  readonly stage?: JobStage;
  readonly clearStage?: boolean;
  readonly facts?: JobExecutionFactsPatch;
}

export type QueueJobInput = QueueJobInputBase & (
  | {
      readonly reason: "dependency_repaired";
      readonly proof: Extract<JobExecutionResumeProof, { kind: "dependency_repaired" }>;
    }
  | {
      readonly reason: "source_preserved";
      readonly proof: Extract<JobExecutionResumeProof, { kind: "source_preserved" }>;
    }
  | {
      readonly reason: "permission_decided";
      readonly proof: Extract<JobExecutionResumeProof, { kind: "permission_decided" }>;
    }
  | {
      readonly reason: "model_egress_decided";
      readonly proof: Extract<JobExecutionResumeProof, { kind: "model_egress_decided" }>;
    }
  | {
      readonly reason: "review_resolved";
      readonly proof: Extract<JobExecutionResumeProof, { kind: "review_resolved" }>;
    }
  | {
      readonly reason: Exclude<QueueJobReason,
        | "dependency_repaired"
        | "source_preserved"
        | "permission_decided"
        | "model_egress_decided"
        | "review_resolved">;
      readonly proof?: never;
    }
);

export interface RecoverInterruptedJobInput {
  readonly canResumeIdempotently: boolean;
  readonly queuedMessage: string;
  readonly retryableMessage: string;
}

export interface TerminalizeUncertainEffectInput {
  readonly checkpointId: string;
  readonly error: PigeErrorSummary;
  readonly reason: string;
  readonly message: string;
  readonly facts?: JobExecutionFactsPatch;
}

export interface AdoptDurableCompletionInput {
  readonly checkpointId: string;
  readonly message: string;
  readonly facts: JobExecutionFactsPatch;
}

export interface ResolveJobReviewInput {
  readonly proposalId: string;
  readonly result: "completed" | "completed_with_warnings" | "failed_final";
  readonly message: string;
  readonly error?: PigeErrorSummary;
  readonly facts?: JobExecutionFactsPatch;
}

export interface MarkDurableBoundaryInput {
  readonly checkpointId: string;
  readonly message?: string;
  readonly facts?: JobExecutionFactsPatch;
}

export interface CancellationOutcomeInput {
  readonly cancelledMessage: string;
  readonly preservedResultMessage: string;
  readonly partialResultMessage?: string;
  readonly safeCheckpointId?: string;
  readonly durableResultComplete?: boolean;
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
  if (RESUME_STATES.has(from) && (to === "running" || WAITING_RESOLUTION_STATES.has(to))) return true;
  if (PENDING_CANCELLATION_STATES.has(from) && to === "cancelled") return true;
  if (from === "running" && to === "cancel_requested") return true;
  if (from === "queued" && PRE_EXECUTION_OUTCOME_STATES.has(to)) return true;
  if (from === "running" && OUTCOME_STATES.has(to)) return true;
  return from === "cancel_requested" && CANCELLATION_OUTCOME_STATES.has(to);
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
      progress: undefined,
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
        durableResultComplete: true,
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
    if (snapshot.job.state === "cancel_requested") {
      return this.#lateCancellationOutcome(snapshot, input.message, input.facts);
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
    if (snapshot.job.state === "cancel_requested") {
      return this.#lateCancellationOutcome(snapshot, input.message, input.facts);
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

  cancelPending(snapshot: JobRecordSnapshot, input: CancelPendingJobInput): JobRecordSnapshot {
    assertKeys(input, ["requestedBy", "message", "safeCheckpointId"]);
    if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
    if (!PENDING_CANCELLATION_STATES.has(snapshot.job.state)) {
      throw invalidTransition(snapshot.job.state, "cancelled");
    }
    if (snapshot.job.cancellation?.durableWritesApplied === true) {
      throw new PigeDomainError(
        "job.cancellation_unsafe",
        "A Job with durable effects cannot be represented as cleanly cancelled."
      );
    }
    if (input.safeCheckpointId.trim() === "") {
      throw new PigeDomainError("job.cancellation_invalid", "A clean cancellation requires a safe checkpoint ID.");
    }
    const timestamp = this.#timestamp(snapshot.job);
    return this.#commit(snapshot, {
      ...snapshot.job,
      state: "cancelled",
      updatedAt: timestamp,
      finishedAt: timestamp,
      message: input.message,
      waitingDependency: undefined,
      error: undefined,
      cancellation: {
        requestedAt: timestamp,
        requestedBy: input.requestedBy,
        safeCheckpointId: input.safeCheckpointId,
        durableWritesApplied: false
      }
    });
  }

  prepareRetry(snapshot: JobRecordSnapshot, input: PrepareJobRetryInput): JobRecordSnapshot {
    assertKeys(input, ["message"]);
    if (!EXPLICIT_RETRY_STATES.has(snapshot.job.state)) {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw invalidTransition(snapshot.job.state, "queued");
    }
    const preserveDurableWrites = snapshot.job.cancellation?.durableWritesApplied === true;
    const {
      stage: _stage,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      progress: _progress,
      cancellation: _cancellation,
      error: _error,
      waitingDependency: _waitingDependency,
      ...base
    } = snapshot.job;
    return this.#commit(snapshot, {
      ...base,
      state: "queued",
      updatedAt: this.#timestamp(snapshot.job),
      ...(preserveDurableWrites ? { cancellation: { durableWritesApplied: true } } : {}),
      message: input.message
    });
  }

  queue(snapshot: JobRecordSnapshot, input: QueueJobInput): JobRecordSnapshot {
    assertKeys(input, ["reason", "message", "stage", "clearStage", "proof", "facts"]);
    if (input.facts) assertFacts(input.facts);
    const resumeReason = input.reason === "dependency_repaired" ||
      input.reason === "source_preserved" ||
      input.reason === "permission_decided" ||
      input.reason === "model_egress_decided" ||
      input.reason === "review_resolved";
    const decisionReason = resumeReason &&
      input.reason !== "dependency_repaired" &&
      input.reason !== "source_preserved";
    const proofFacts = resumeReason
      ? validateQueueResumeProof(snapshot.job, input.reason, input.proof)
      : undefined;
    if (!resumeReason && input.proof) {
      throw new PigeDomainError("job.command_invalid", "This queue reason does not accept a decision proof.");
    }
    const allowed = decisionReason
      ? RESUME_STATES.has(snapshot.job.state) ||
        (input.reason === "model_egress_decided" && snapshot.job.state === "failed_retryable")
      : input.reason === "dependency_repaired"
        ? snapshot.job.state === "waiting_dependency"
        : input.reason === "source_preserved"
          ? snapshot.job.state === "waiting_dependency"
        : input.reason === "idempotent_recovery"
          ? snapshot.job.state === "running"
          : snapshot.job.state === "running" || snapshot.job.state === "cancel_requested";
    if (!allowed) {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw invalidTransition(snapshot.job.state, "queued");
    }
    if (snapshot.job.state === "cancel_requested") {
      throw new PigeDomainError(
        "job.cancellation_pending",
        "A Job with pending cancellation cannot be queued for more semantic work."
      );
    }
    const projected = applyFacts(applyFacts(snapshot.job, input.facts), proofFacts);
    const {
      stage: projectedStage,
      finishedAt: _finishedAt,
      waitingDependency: _waitingDependency,
      error: _error,
      ...current
    } = projected;
    return this.#commit(snapshot, {
      ...current,
      state: "queued",
      ...(input.stage
        ? { stage: input.stage }
        : input.clearStage !== true && projectedStage ? { stage: projectedStage } : {}),
      updatedAt: this.#timestamp(snapshot.job),
      ...(decisionReason
        ? {
            retry: {
              retryCount: snapshot.job.retry?.retryCount ?? 0,
              maxAutomaticRetries: 0,
              requiresUserAction: false
            }
          }
        : {}),
      message: input.message
    });
  }

  recoverInterrupted(
    snapshot: JobRecordSnapshot,
    input: RecoverInterruptedJobInput
  ): JobRecordSnapshot {
    assertKeys(input, ["canResumeIdempotently", "queuedMessage", "retryableMessage"]);
    if (snapshot.job.state !== "running" && snapshot.job.state !== "cancel_requested") {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw invalidTransition(snapshot.job.state, input.canResumeIdempotently ? "queued" : "failed_retryable");
    }
    if (input.canResumeIdempotently && snapshot.job.state === "running") {
      return this.queue(snapshot, {
        reason: "idempotent_recovery",
        message: input.queuedMessage,
        clearStage: true
      });
    }
    return this.#requeue(snapshot, {
      kind: "requeue",
      error: {
        code: "unknown.execution_failed",
        domain: "unknown",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      },
      reason: "job.interrupted_without_safe_completion",
      maxAutomaticRetries: 0,
      requiresUserAction: true,
      message: input.retryableMessage
    });
  }

  terminalizeUncertainEffect(
    snapshot: JobRecordSnapshot,
    input: TerminalizeUncertainEffectInput
  ): JobRecordSnapshot {
    assertKeys(input, ["checkpointId", "error", "reason", "message", "facts"]);
    if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
    if (input.checkpointId.trim() === "") {
      throw new PigeDomainError("job.cancellation_invalid", "An uncertain external effect requires a checkpoint ID.");
    }
    const error = parseError(input.error);
    if (error.retryable) {
      throw new PigeDomainError("job.failure_invalid", "An uncertain external effect must fail closed without replay.");
    }
    if (snapshot.job.state === "cancel_requested") {
      return this.#projectCancellationOutcome(snapshot, {
        cancelledMessage: input.message,
        preservedResultMessage: input.message,
        partialResultMessage: input.message,
        safeCheckpointId: input.checkpointId,
        ...(input.facts ? { facts: input.facts } : {})
      }, true);
    }
    const timestamp = this.#timestamp(snapshot.job);
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      state: "failed_final",
      updatedAt: timestamp,
      finishedAt: timestamp,
      waitingDependency: undefined,
      error,
      retry: {
        retryCount: snapshot.job.retry?.retryCount ?? 0,
        maxAutomaticRetries: 0,
        requiresUserAction: false,
        lastRetryReason: input.reason
      },
      cancellation: {
        ...snapshot.job.cancellation,
        safeCheckpointId: input.checkpointId,
        durableWritesApplied: true
      },
      message: input.message
    });
  }

  adoptDurableCompletion(
    snapshot: JobRecordSnapshot,
    input: AdoptDurableCompletionInput
  ): JobRecordSnapshot {
    assertKeys(input, ["checkpointId", "message", "facts"]);
    assertFacts(input.facts);
    if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
    if (snapshot.job.state !== "queued" && snapshot.job.state !== "running" && snapshot.job.state !== "cancel_requested") {
      throw invalidTransition(snapshot.job.state, "completed");
    }
    if (input.checkpointId.trim() === "" || (input.facts.outputRefs?.length ?? 0) === 0) {
      throw new PigeDomainError(
        "job.recovery_proof_invalid",
        "Adopting a durable completion requires its checkpoint and output reference."
      );
    }
    if (snapshot.job.state === "cancel_requested") {
      return this.#projectCancellationOutcome(snapshot, {
        cancelledMessage: input.message,
        preservedResultMessage: input.message,
        safeCheckpointId: input.checkpointId,
        durableResultComplete: true,
        facts: input.facts
      }, true);
    }
    const timestamp = this.#timestamp(snapshot.job);
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      state: "completed",
      updatedAt: timestamp,
      finishedAt: timestamp,
      waitingDependency: undefined,
      error: undefined,
      cancellation: {
        ...snapshot.job.cancellation,
        safeCheckpointId: input.checkpointId,
        durableWritesApplied: true
      },
      message: input.message
    });
  }

  resolveReview(snapshot: JobRecordSnapshot, input: ResolveJobReviewInput): JobRecordSnapshot {
    assertKeys(input, ["proposalId", "result", "message", "error", "facts"]);
    if (
      snapshot.job.state !== "awaiting_review" ||
      !snapshot.job.proposalIds?.includes(input.proposalId)
    ) {
      if (isTerminalJobState(snapshot.job.state)) throw terminalImmutable(snapshot.job.state);
      throw new PigeDomainError("job.resume_proof_invalid", "The reviewed proposal is not bound to this Job.");
    }
    const error = input.error ? parseError(input.error) : undefined;
    if (input.result === "failed_final" && (!error || error.retryable)) {
      throw new PigeDomainError("job.failure_invalid", "A conflicted review requires a final body-free error.");
    }
    if (input.result !== "failed_final" && error) {
      throw new PigeDomainError("job.failure_invalid", "A completed review must not retain an error owner.");
    }
    const timestamp = this.#timestamp(snapshot.job);
    const next = applyFacts(snapshot.job, input.facts);
    return this.#commit(snapshot, {
      ...next,
      state: input.result,
      updatedAt: timestamp,
      finishedAt: timestamp,
      waitingDependency: undefined,
      ...(error ? { error } : { error: undefined }),
      message: input.message
    });
  }

  markDurableBoundary(
    snapshot: JobRecordSnapshot,
    input: MarkDurableBoundaryInput
  ): JobRecordSnapshot {
    assertKeys(input, ["checkpointId", "message", "facts"]);
    if (snapshot.job.state !== "running" && snapshot.job.state !== "cancel_requested") {
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
    assertKeys(input, [
      "cancelledMessage",
      "preservedResultMessage",
      "partialResultMessage",
      "safeCheckpointId",
      "durableResultComplete",
      "facts"
    ]);
    if (snapshot.job.state !== "cancel_requested") {
      throw invalidTransition(snapshot.job.state, "cancelled");
    }
    return this.#projectCancellationOutcome(snapshot, input);
  }

  #lateCancellationOutcome(
    snapshot: JobRecordSnapshot,
    message: string,
    facts?: JobExecutionFactsPatch
  ): JobRecordSnapshot {
    return this.#projectCancellationOutcome(snapshot, {
      cancelledMessage: message,
      preservedResultMessage: message,
      partialResultMessage: message,
      ...(facts ? { facts } : {})
    });
  }

  #projectCancellationOutcome(
    snapshot: JobRecordSnapshot,
    input: CancellationOutcomeInput,
    provenDurableWritesApplied = false
  ): JobRecordSnapshot {
    if (snapshot.job.state !== "cancel_requested") {
      throw invalidTransition(snapshot.job.state, "cancelled");
    }
    const durableWritesApplied = provenDurableWritesApplied ||
      snapshot.job.cancellation?.durableWritesApplied === true;
    const state = durableWritesApplied
      ? input.durableResultComplete === true ? "completed_with_warnings" : "failed_retryable"
      : "cancelled";
    this.#assertTransition(snapshot.job, state);
    const timestamp = this.#timestamp(snapshot.job);
    const next = durableWritesApplied ? applyFacts(snapshot.job, input.facts) : snapshot.job;
    const safeCheckpointId = input.safeCheckpointId ??
      snapshot.job.cancellation?.safeCheckpointId ??
      (durableWritesApplied ? undefined : "before_durable_write");
    const message = durableWritesApplied
      ? input.durableResultComplete === true
        ? input.preservedResultMessage
        : input.partialResultMessage ?? input.preservedResultMessage
      : input.cancelledMessage;
    return this.#commit(snapshot, {
      ...next,
      state,
      updatedAt: timestamp,
      message,
      waitingDependency: undefined,
      cancellation: {
        ...snapshot.job.cancellation,
        ...(safeCheckpointId ? { safeCheckpointId } : {}),
        durableWritesApplied
      },
      ...(state === "failed_retryable"
        ? {
            finishedAt: undefined,
            error: {
              code: "unknown.execution_failed",
              domain: "unknown",
              messageKey: "error.generic",
              retryable: true,
              severity: "error",
              userAction: "retry"
            },
            retry: {
              retryCount: snapshot.job.retry?.retryCount ?? 0,
              maxAutomaticRetries: 0,
              requiresUserAction: true,
              lastRetryReason: "job.cancelled_after_durable_output"
            }
          }
        : { finishedAt: timestamp, error: undefined })
    });
  }

  #wait(
    snapshot: JobRecordSnapshot,
    state: Extract<JobState, "waiting_dependency" | "waiting_permission" | "waiting_model_egress" | "awaiting_review">,
    message: string,
    facts?: JobExecutionFactsPatch,
    additions: Partial<Pick<JobRecord, "waitingDependency" | "error">> = {}
  ): JobRecordSnapshot {
    if (snapshot.job.state === "cancel_requested") {
      return this.#lateCancellationOutcome(snapshot, message, facts);
    }
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
    return new Date(Math.max(now.getTime(), currentTime + 1)).toISOString();
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
    ...(facts.childJobIds ? { childJobIds: mergeStrings(job.childJobIds, facts.childJobIds) } : {}),
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

function validateQueueResumeProof(
  job: JobRecord,
  reason: Extract<QueueJobReason,
    | "dependency_repaired"
    | "source_preserved"
    | "permission_decided"
    | "model_egress_decided"
    | "review_resolved">,
  proof: JobExecutionResumeProof | undefined
): JobExecutionFactsPatch {
  const expectedKind = reason;
  if (!proof || proof.kind !== expectedKind) {
    throw new PigeDomainError("job.resume_proof_invalid", "The queued Job resume proof does not match its owner.");
  }
  return validateResumeProof(job, proof);
}

function validateResumeProof(job: JobRecord, proof: JobExecutionResumeProof): JobExecutionFactsPatch {
  switch (proof.kind) {
    case "dependency_repaired":
      assertKeys(proof, ["kind", "dependency"]);
      if (
        job.state !== "waiting_dependency" ||
        !job.waitingDependency ||
        !isExactDependencyBinding(job.waitingDependency, proof.dependency)
      ) {
        throw invalidResumeProof();
      }
      return {};
    case "source_preserved":
      assertKeys(proof, ["kind", "sourceId", "conversationEventId"]);
      if (
        job.state !== "waiting_dependency" ||
        job.class !== "agent_turn" ||
        job.stage !== "capturing_source" ||
        job.sourceId !== proof.sourceId ||
        job.conversationEventId !== proof.conversationEventId
      ) {
        throw invalidResumeProof();
      }
      return {};
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
        (job.state !== "waiting_model_egress" && job.state !== "failed_retryable") ||
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

function isExactDependencyBinding(current: WaitingDependency, proof: WaitingDependency): boolean {
  const allowedKeys = new Set(["dependencyKind", "dependencyId", "requiredAction", "messageKey"]);
  if (Object.keys(proof).some((key) => !allowedKeys.has(key))) return false;
  return current.dependencyKind === proof.dependencyKind &&
    current.dependencyId === proof.dependencyId &&
    current.requiredAction === proof.requiredAction &&
    current.messageKey === proof.messageKey;
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
