import type { JobCancelRequest, JobCancelResult, JobSummary } from "@pige/contracts";

type CancelIdentity = {
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly expectedUpdatedAt: string;
};

export function createJobCancelRequest(identity: CancelIdentity): JobCancelRequest {
  return {
    apiVersion: 1,
    requestId: `jobcancelreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: identity.activeVaultId,
    jobId: identity.jobId,
    expectedUpdatedAt: identity.expectedUpdatedAt
  };
}

export async function cancelKnownJob(
  activeVaultId: string | undefined,
  jobId: string,
  ...groups: readonly (readonly JobSummary[])[]
): Promise<JobCancelResult | { readonly status: "failed" }> {
  const job = groups.flat().find((candidate) => candidate.id === jobId);
  if (!activeVaultId || !job) return { status: "failed" };
  return window.pige.jobs.cancel(createJobCancelRequest({
    activeVaultId,
    jobId,
    expectedUpdatedAt: job.updatedAt
  }));
}
