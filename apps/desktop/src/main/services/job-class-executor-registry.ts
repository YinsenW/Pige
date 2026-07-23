import type { JobActionRequest, JobActionResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { JobClass } from "@pige/schemas";

export type RunningJobCancellationPolicy = "cooperative" | "not_allowed" | "external";
export type JobRetryPolicy = "requeue" | "reject" | "external";
export type InterruptedJobRecoveryPolicy = "idempotent" | "explicit_retry" | "external";
export type JobActionOwner = "generic" | "external";

type MaybePromise<T> = T | Promise<T>;

export interface JobClassExecutor {
  readonly jobClass: JobClass;
  readonly actionOwner: JobActionOwner;
  readonly runningCancellation: RunningJobCancellationPolicy;
  readonly retryPolicy: JobRetryPolicy;
  readonly interruptedRecovery: InterruptedJobRecoveryPolicy;
  readonly cancel?: (request: JobActionRequest) => MaybePromise<JobActionResult>;
  readonly retry?: (request: JobActionRequest) => MaybePromise<JobActionResult>;
  readonly schedule?: (jobId?: string) => void;
}

export type JobClassExecutorActions = Partial<Record<
  JobClass,
  Pick<JobClassExecutor, "cancel" | "retry" | "schedule">
>>;

const POLICIES = {
  capture_batch: ["external", "external", "external", "explicit_retry"],
  capture: ["generic", "cooperative", "requeue", "idempotent"],
  parse: ["generic", "cooperative", "requeue", "idempotent"],
  ocr: ["generic", "cooperative", "requeue", "idempotent"],
  dataset_import: ["generic", "cooperative", "requeue", "idempotent"],
  agent_turn: ["generic", "cooperative", "requeue", "idempotent"],
  agent_ingest: ["generic", "cooperative", "requeue", "idempotent"],
  retrieval_query: ["generic", "not_allowed", "reject", "explicit_retry"],
  index_rebuild: ["generic", "cooperative", "requeue", "idempotent"],
  backup: ["external", "external", "external", "external"],
  restore: ["external", "external", "external", "explicit_retry"],
  permissioned_skill: ["external", "external", "external", "explicit_retry"],
  tool_install: ["external", "external", "external", "explicit_retry"],
  migration: ["external", "external", "external", "explicit_retry"],
  maintenance: ["external", "external", "external", "explicit_retry"]
} as const satisfies Record<
  JobClass,
  readonly [JobActionOwner, RunningJobCancellationPolicy, JobRetryPolicy, InterruptedJobRecoveryPolicy]
>;

export class JobClassExecutorRegistry {
  readonly #executors = new Map<JobClass, JobClassExecutor>();

  register(executor: JobClassExecutor): void {
    if (this.#executors.has(executor.jobClass)) {
      throw new PigeDomainError("job.executor_duplicate", "A Job class executor is already registered.");
    }
    this.#executors.set(executor.jobClass, Object.freeze({ ...executor }));
  }

  get(jobClass: JobClass): JobClassExecutor | undefined {
    return this.#executors.get(jobClass);
  }

  require(jobClass: JobClass): JobClassExecutor {
    const executor = this.get(jobClass);
    if (!executor) {
      throw new PigeDomainError("job.executor_unavailable", "The Job class has no registered executor.");
    }
    return executor;
  }

  classes(): readonly JobClass[] {
    return [...this.#executors.keys()];
  }

  scheduleAll(): void {
    for (const executor of this.#executors.values()) executor.schedule?.();
  }
}

export function createJobClassExecutorRegistry(
  actions: JobClassExecutorActions = {}
): JobClassExecutorRegistry {
  const registry = new JobClassExecutorRegistry();
  for (const [jobClass, policy] of Object.entries(POLICIES) as [
    JobClass,
    (typeof POLICIES)[JobClass]
  ][]) {
    registry.register({
      jobClass,
      actionOwner: policy[0],
      runningCancellation: policy[1],
      retryPolicy: policy[2],
      interruptedRecovery: policy[3],
      ...actions[jobClass]
    });
  }
  return registry;
}
