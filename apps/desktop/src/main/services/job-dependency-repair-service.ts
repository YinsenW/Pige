import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobState } from "@pige/schemas";

export type DependencyRepairPreparation =
  | {
      readonly status: "ready";
      readonly jobId: string;
      readonly activeVaultId: string;
      readonly expectedJobUpdatedAt: string;
      readonly dependencyKind: NonNullable<JobRecord["waitingDependency"]>["dependencyKind"];
      readonly requiredAction: NonNullable<JobRecord["waitingDependency"]>["requiredAction"];
      readonly messageKey: string;
    }
  | { readonly status: "stale" | "ineligible" | "not_found" };

export interface DependencyRepairRequest {
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly expectedJobUpdatedAt: string;
}

export interface DependencyRepairExecution {
  readonly request: DependencyRepairRequest;
  readonly repair: (preparation: Extract<DependencyRepairPreparation, { status: "ready" }>) => Promise<void>;
  readonly readCurrentJob: () => JobRecord | undefined;
  readonly resume: () => Promise<unknown>;
}

/**
 * Builds a renderer-safe repair intent from a waiting Job. Execution stays with
 * the owning capability service; this owner only performs identity/currentness
 * and safe-action classification.
 */
export class JobDependencyRepairService {
  prepare(job: JobRecord | undefined, request: DependencyRepairRequest): DependencyRepairPreparation {
    if (!job || job.id !== request.jobId) return { status: "not_found" };
    if (job.activeVaultId !== request.activeVaultId || job.updatedAt !== request.expectedJobUpdatedAt) {
      return { status: "stale" };
    }
    if (job.state !== "waiting_dependency" || !job.waitingDependency) {
      return { status: "ineligible" };
    }
    if (job.waitingDependency.requiredAction === "unavailable") {
      return { status: "ineligible" };
    }
    return {
      status: "ready",
      jobId: job.id,
      activeVaultId: request.activeVaultId,
      expectedJobUpdatedAt: request.expectedJobUpdatedAt,
      dependencyKind: job.waitingDependency.dependencyKind,
      requiredAction: job.waitingDependency.requiredAction,
      messageKey: job.waitingDependency.messageKey
    };
  }

  assertRepairable(preparation: DependencyRepairPreparation): Extract<DependencyRepairPreparation, { status: "ready" }> {
    if (preparation.status !== "ready") {
      throw new PigeDomainError("job.dependency_repair_ineligible", "The waiting dependency is no longer repairable.");
    }
    return preparation;
  }

  async repairAndResume(input: DependencyRepairExecution): Promise<"resumed"> {
    const current = this.assertRepairable(this.prepare(input.readCurrentJob(), input.request));
    await input.repair(current);
    const afterRepair = this.assertRepairable(this.prepare(input.readCurrentJob(), input.request));
    await input.resume();
    // The resume callback owns the durable Job transition. This owner only
    // permits it after both sides of the repair have passed the same CAS.
    this.assertRepairable(afterRepair);
    return "resumed";
  }
}

export function isWaitingDependencyState(state: JobState): boolean {
  return state === "waiting_dependency";
}
