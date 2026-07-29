import { describe, expect, it, vi } from "vitest";
import type { JobSummary } from "@pige/contracts";
import { JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL } from "@pige/schemas";
import { registerSourceReconnectIpc } from "../../apps/desktop/src/main/register-source-reconnect-ipc";
import type { JobsService, OriginalSourceReconnectCandidate } from "../../apps/desktop/src/main/services/jobs-service";
import type { SourceOriginalReconnectService } from "../../apps/desktop/src/main/services/source-original-reconnect-service";

const request = {
  apiVersion: 1 as const,
  requestId: "sourcereconnectreq_abcdefgh",
  activeVaultId: "vault_20260729_abcdefgh",
  waitingJobId: "job_20260729_abcdefgh",
  expectedJobUpdatedAt: "2026-07-29T08:00:01.000Z"
};
const candidate: OriginalSourceReconnectCandidate = {
  activeVaultId: request.activeVaultId,
  waitingJobId: request.waitingJobId,
  jobRevision: request.expectedJobUpdatedAt,
  sourceId: "src_20260729_abcdefgh"
};
const resumedJob: JobSummary = {
  id: request.waitingJobId,
  class: "agent_turn",
  state: "queued",
  stage: "waiting_for_path",
  sourceId: candidate.sourceId,
  sourceDisplayName: "notes.txt",
  sourceKind: "plain_text_file",
  canReconnectDependency: false,
  message: "Job requeued for later processing.",
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:00:02.000Z"
};

function harness(input: { readonly canceled?: boolean; readonly candidate?: OriginalSourceReconnectCandidate } = {}) {
  let handler: ((event: { sender: { id: number } }, request: unknown) => Promise<unknown>) | undefined;
  const currentCandidate = input.candidate === undefined ? candidate : input.candidate;
  const jobs = {
    readOriginalSourceReconnectCandidate: vi.fn(() => currentCandidate),
    readJobClass: vi.fn(() => "agent_turn"),
    resumeOriginalSourceReconnect: vi.fn(() => ({ status: "requeued", job: resumedJob }))
  };
  const reconnect = vi.fn(async (
    _binding: unknown,
    _filePath: string,
    assertCurrent: () => boolean
  ) => assertCurrent() ? "reconnected" : "stale");
  const showOpenDialog = vi.fn(async () => input.canceled
    ? { canceled: true, filePaths: [] }
    : { canceled: false, filePaths: ["/private/selected.txt"] });
  const resumeBackgroundJobs = vi.fn();
  registerSourceReconnectIpc({
    ipcMain: {
      handle: (channel, callback) => {
        if (channel === JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL) handler = callback as typeof handler;
      }
    },
    getWindow: () => ({}) as never,
    showOpenDialog,
    getJobs: () => jobs as unknown as JobsService,
    getReconnectService: () => ({ reconnect }) as unknown as SourceOriginalReconnectService,
    resumeBackgroundJobs
  });
  return { handler: handler!, jobs, reconnect, showOpenDialog, resumeBackgroundJobs };
}

describe("source reconnect IPC", () => {
  it("cancels without persistence or Job resume", async () => {
    const value = harness({ canceled: true });
    await expect(value.handler({ sender: { id: 1 } }, request)).resolves.toEqual({
      ...request,
      status: "cancelled"
    });
    expect(value.reconnect).not.toHaveBeenCalled();
    expect(value.jobs.resumeOriginalSourceReconnect).not.toHaveBeenCalled();
  });

  it("fails stale identity before opening the file chooser", async () => {
    const value = harness({ candidate: { ...candidate, jobRevision: "2026-07-29T08:00:02.000Z" } });
    await expect(value.handler({ sender: { id: 1 } }, request)).resolves.toMatchObject({ status: "stale" });
    expect(value.showOpenDialog).not.toHaveBeenCalled();
    expect(value.reconnect).not.toHaveBeenCalled();
  });

  it("rebinds and resumes the same exact waiting Job with a pathless projection", async () => {
    const value = harness();
    const result = await value.handler({ sender: { id: 1 } }, request);
    expect(result).toMatchObject({
      ...request,
      status: "reconnected",
      job: { id: request.waitingJobId, sourceId: candidate.sourceId, canReconnectDependency: false }
    });
    expect(value.reconnect).toHaveBeenCalledOnce();
    expect(value.jobs.resumeOriginalSourceReconnect).toHaveBeenCalledWith(candidate);
    expect(value.resumeBackgroundJobs).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("/private/selected.txt");
  });
});
