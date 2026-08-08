import type { JobSummary } from "@pige/contracts";
import type { HomeJobRepairAction } from "./HomeJobAction";

export function createDependencyRepairAction(
  job: JobSummary,
  label: string,
  pendingLabel: string,
  onRepair: () => Promise<unknown>
): HomeJobRepairAction | undefined {
  if (job.state !== "waiting_dependency" || !job.waitingDependency || job.waitingDependency.requiredAction === "unavailable") {
    return undefined;
  }
  return { label, pendingLabel, onActivate: async () => { await onRepair(); } };
}

export async function repairDependencyRequest(input: {
  readonly job: JobSummary;
  readonly activeVaultId: string | undefined;
  readonly repair: (request: {
    readonly apiVersion: 1;
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly jobId: string;
    readonly expectedUpdatedAt: string;
  }) => Promise<{ readonly status: string; readonly jobId: string; readonly activeVaultId: string }>;
  readonly isCurrent: (activeVaultId: string, jobId: string) => boolean;
  readonly onRepaired: () => Promise<void>;
}): Promise<boolean> {
  const { job, activeVaultId } = input;
  if (!activeVaultId || job.state !== "waiting_dependency") return false;
  const result = await input.repair({
    apiVersion: 1,
    requestId: `jobrepairreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId,
    jobId: job.id,
    expectedUpdatedAt: job.updatedAt
  });
  if (!input.isCurrent(activeVaultId, job.id) || result.jobId !== job.id || result.activeVaultId !== activeVaultId) return false;
  if (result.status !== "repaired") return false;
  await input.onRepaired();
  return true;
}

export function createDependencyRepairHandler(input: {
  readonly activeVaultId: () => string | undefined;
  readonly repair: (request: {
    readonly apiVersion: 1;
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly jobId: string;
    readonly expectedUpdatedAt: string;
  }) => Promise<{ readonly status: string; readonly jobId: string; readonly activeVaultId: string }>;
  readonly onRepaired: (job: JobSummary) => Promise<void>;
}): (job: JobSummary) => Promise<boolean> {
  return (job) => repairDependencyRequest({
    job,
    activeVaultId: input.activeVaultId(),
    repair: input.repair,
    isCurrent: (vaultId, jobId) => input.activeVaultId() === vaultId && job.id === jobId,
    onRepaired: () => input.onRepaired(job)
  });
}
