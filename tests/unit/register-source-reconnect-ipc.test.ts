import { describe, expect, it, vi } from "vitest";
import type { JobSummary } from "@pige/contracts";
import {
  JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  SOURCE_RECONNECT_CANCEL_CHANNEL,
  SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL,
  SOURCE_RECONNECT_ORIGINAL_CHANNEL
} from "@pige/schemas";
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
const proof = {
  sourceId: candidate.sourceId,
  sourceKind: "plain_text_file" as const,
  sourceRevision: `sourcerev_${"a".repeat(64)}`,
  expectedAvailability: "unavailable" as const,
  expectedChecksum: `sha256:${"b".repeat(64)}`,
  expectedSize: 12,
  formatIdentity: `sourcefmt_${"c".repeat(64)}`,
  displayName: "notes.txt"
};
const directRequest = {
  apiVersion: 1 as const,
  requestId: "sourcereconnectdirect_abcdefghijklmnop",
  activeVaultId: request.activeVaultId,
  sourceId: proof.sourceId,
  sourceKind: proof.sourceKind,
  sourceRevision: proof.sourceRevision,
  expectedAvailability: proof.expectedAvailability,
  expectedChecksum: proof.expectedChecksum,
  expectedSize: proof.expectedSize,
  formatIdentity: proof.formatIdentity
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

function harness(input: {
  readonly canceled?: boolean;
  readonly ambiguous?: boolean;
  readonly candidate?: OriginalSourceReconnectCandidate;
} = {}) {
  const handlers = new Map<string, (event: { sender: { id: number } }, request: unknown) => unknown>();
  const currentCandidate = input.candidate === undefined ? candidate : input.candidate;
  const jobs = {
    readOriginalSourceReconnectCandidate: vi.fn(() => currentCandidate),
    readJobClass: vi.fn(() => "agent_turn"),
    resumeOriginalSourceReconnect: vi.fn(() => ({ status: "requeued", job: resumedJob })),
    resumeOriginalSourceReconnectsForSource: vi.fn(() => 2)
  };
  const sourceCandidate = vi.fn(() => proof);
  const listUnavailable = vi.fn(() => ({ sources: [proof], truncated: false }));
  const reconnect = vi.fn(async (
    _binding: unknown,
    _filePath: string,
    assertCurrent: () => boolean
  ) => assertCurrent()
    ? { status: "reconnected" as const, operationId: "op_20260729_sourcereconnect", contentState: "current" as const }
    : { status: "stale" as const });
  const confirmChanged = vi.fn(async (_binding: unknown, assertCurrent: () => boolean) => assertCurrent()
    ? { status: "reconnected" as const, operationId: "op_20260729_changedrelink", contentState: "changed" as const }
    : { status: "stale" as const });
  const cancelChanged = vi.fn(() => "cancelled" as const);
  const acknowledge = vi.fn();
  const showOpenDialog = vi.fn(async () => input.canceled
    ? { canceled: true, filePaths: [] }
    : input.ambiguous
      ? { canceled: false, filePaths: ["/private/selected-a.txt", "/private/selected-b.txt"] }
      : { canceled: false, filePaths: ["/private/selected.txt"] });
  const resumeBackgroundJobs = vi.fn();
  const onSourceReconnected = vi.fn();
  registerSourceReconnectIpc({
    ipcMain: {
      handle: (channel, callback) => handlers.set(channel, callback as never)
    },
    getWindow: () => ({}) as never,
    showOpenDialog,
    getJobs: () => jobs as unknown as JobsService,
    getReconnectService: () => ({ reconnect, confirmChanged, cancelChanged, acknowledge, candidate: sourceCandidate, listUnavailable }) as unknown as SourceOriginalReconnectService,
    resumeBackgroundJobs,
    onSourceReconnected
  });
  return { handlers, jobs, reconnect, confirmChanged, acknowledge, sourceCandidate, listUnavailable, showOpenDialog,
    cancelChanged, resumeBackgroundJobs, onSourceReconnected };
}

describe("source reconnect IPC", () => {
  it("cancels without persistence or Job resume", async () => {
    const value = harness({ canceled: true });
    await expect(value.handlers.get(JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL)!({ sender: { id: 1 } }, request))
      .resolves.toEqual({
      ...request,
      status: "cancelled"
    });
    expect(value.reconnect).not.toHaveBeenCalled();
    expect(value.jobs.resumeOriginalSourceReconnect).not.toHaveBeenCalled();
  });

  it("fails stale identity before opening the file chooser", async () => {
    const value = harness({ candidate: { ...candidate, jobRevision: "2026-07-29T08:00:02.000Z" } });
    await expect(value.handlers.get(JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL)!({ sender: { id: 1 } }, request))
      .resolves.toMatchObject({ status: "stale" });
    expect(value.showOpenDialog).not.toHaveBeenCalled();
    expect(value.reconnect).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous Main picker result without handing any path to reconnect", async () => {
    const value = harness({ ambiguous: true });
    await expect(value.handlers.get(SOURCE_RECONNECT_ORIGINAL_CHANNEL)!({ sender: { id: 1 } }, directRequest))
      .resolves.toMatchObject({ ...directRequest, status: "stale" });
    expect(value.showOpenDialog).toHaveBeenCalledOnce();
    expect(value.reconnect).not.toHaveBeenCalled();
  });

  it("rebinds and resumes the same exact waiting Job with a pathless projection", async () => {
    const value = harness();
    const result = await value.handlers.get(JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL)!({ sender: { id: 1 } }, request);
    expect(result).toMatchObject({
      ...request,
      status: "reconnected",
      job: { id: request.waitingJobId, sourceId: candidate.sourceId, canReconnectDependency: false },
      operationId: "op_20260729_sourcereconnect",
      contentState: "current"
    });
    expect(value.reconnect).toHaveBeenCalledOnce();
    expect(value.jobs.resumeOriginalSourceReconnect).toHaveBeenCalledWith(candidate);
    expect(value.acknowledge).toHaveBeenCalledWith("op_20260729_sourcereconnect");
    expect(value.resumeBackgroundJobs).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("/private/selected.txt");
  });

  it("lists only safe unavailable-source proofs and reconnects one exact Settings selection", async () => {
    const value = harness();
    expect(value.handlers.get(SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL)!({ sender: { id: 1 } }, {
      apiVersion: 1,
      requestId: "sourcereconnectlist_abcdefghijklmnop",
      activeVaultId: request.activeVaultId
    })).toMatchObject({ status: "ready", sources: [proof] });
    const result = await value.handlers.get(SOURCE_RECONNECT_ORIGINAL_CHANNEL)!({ sender: { id: 1 } }, directRequest);
    expect(result).toMatchObject({
      ...directRequest,
      status: "reconnected",
      operationId: "op_20260729_sourcereconnect",
      contentState: "current",
      resumedJobCount: 2
    });
    expect(value.jobs.resumeOriginalSourceReconnectsForSource).toHaveBeenCalledWith(proof.sourceId);
    expect(value.acknowledge).toHaveBeenCalledWith("op_20260729_sourcereconnect");
    expect(value.resumeBackgroundJobs).toHaveBeenCalledOnce();
    expect(value.onSourceReconnected).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("/private/selected.txt");
    expect(JSON.stringify(result)).not.toContain("body");
  });

  it("confirms a changed selection without reopening the picker and resumes only after refresh publication", async () => {
    const value = harness();
    const previewId = `sourcerelinkpreview_${"d".repeat(32)}`;
    const result = await value.handlers.get(JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL)!({ sender: { id: 1 } }, {
      ...request,
      requestId: "sourcereconnectreq_changedconfirm",
      previewId
    });
    expect(result).toMatchObject({
      status: "reconnected",
      contentState: "changed",
      operationId: "op_20260729_changedrelink"
    });
    expect(value.showOpenDialog).not.toHaveBeenCalled();
    expect(value.reconnect).not.toHaveBeenCalled();
    expect(value.confirmChanged).toHaveBeenCalledWith(expect.objectContaining({ previewId }), expect.any(Function));
    expect(value.jobs.resumeOriginalSourceReconnect).toHaveBeenCalledOnce();
  });

  it("cancels a reviewed Settings preview through Main without reopening the picker", async () => {
    const value = harness();
    const previewId = `sourcerelinkpreview_${"e".repeat(32)}`;
    const result = await value.handlers.get(SOURCE_RECONNECT_CANCEL_CHANNEL)!({ sender: { id: 1 } }, {
      ...directRequest,
      previewId
    });
    expect(result).toMatchObject({
      ...directRequest,
      previewId,
      status: "cancelled"
    });
    expect(value.cancelChanged).toHaveBeenCalledWith(expect.objectContaining({ previewId }));
    expect(value.showOpenDialog).not.toHaveBeenCalled();
  });
});
