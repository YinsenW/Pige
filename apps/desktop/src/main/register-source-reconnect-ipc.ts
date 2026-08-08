import type { BrowserWindow, IpcMain, OpenDialogOptions, WebContents } from "electron";
import type {
  JobSummary,
  ReferencedOriginalReconnectCandidate,
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult,
  SourceReconnectListRequest,
  SourceReconnectListResult,
  SourceReconnectCancelResult,
  SourceReconnectRequest,
  SourceReconnectResult
} from "@pige/contracts";
import {
  JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  ReferencedOriginalReconnectJobProjectionSchema,
  ReferencedOriginalReconnectRequestSchema,
  ReferencedOriginalReconnectResultSchema,
  SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL,
  SOURCE_RECONNECT_CANCEL_CHANNEL,
  SOURCE_RECONNECT_ORIGINAL_CHANNEL,
  SourceReconnectCancelRequestSchema,
  SourceReconnectCancelResultSchema,
  SourceReconnectListRequestSchema,
  SourceReconnectListResultSchema,
  SourceReconnectRequestSchema,
  SourceReconnectResultSchema,
  type ReferencedOriginalReconnectJobProjection
} from "@pige/schemas";
import type { JobsService, OriginalSourceReconnectCandidate } from "./services/jobs-service";
import type { SourceOriginalReconnectService } from "./services/source-original-reconnect-service";

interface RegisterSourceReconnectIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
  readonly getJobs: () => JobsService;
  readonly getReconnectService: () => SourceOriginalReconnectService;
  readonly resumeBackgroundJobs: () => void;
  readonly onSourceReconnected: () => void;
}

const identity = (request: ReferencedOriginalReconnectRequest) => ({ ...request });

function candidateMatches(
  candidate: OriginalSourceReconnectCandidate | undefined,
  request: ReferencedOriginalReconnectRequest
): candidate is OriginalSourceReconnectCandidate {
  return candidate?.activeVaultId === request.activeVaultId &&
    candidate.waitingJobId === request.waitingJobId &&
    candidate.jobRevision === request.expectedJobUpdatedAt;
}

function projectJob(job: JobSummary): ReferencedOriginalReconnectJobProjection {
  return ReferencedOriginalReconnectJobProjectionSchema.parse({
    id: job.id,
    class: job.class,
    state: job.state,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.sourceId ? { sourceId: job.sourceId } : {}),
    ...(job.sourceDisplayName ? { sourceDisplayName: job.sourceDisplayName } : {}),
    ...(job.sourceKind ? { sourceKind: job.sourceKind } : {}),
    canReconnectDependency: false,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  });
}

export function registerSourceReconnectIpc(options: RegisterSourceReconnectIpcOptions): void {
  options.ipcMain.handle(JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL, async (
    event,
    request: unknown
  ): Promise<ReferencedOriginalReconnectResult> => {
    const parsed = ReferencedOriginalReconnectRequestSchema.parse(request);
    const jobs = options.getJobs();
    const initial = jobs.readOriginalSourceReconnectCandidate(parsed.waitingJobId);
    if (!initial) {
      const status = jobs.readJobClass(parsed.waitingJobId) === undefined ? "not_found" : "stale";
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status });
    }
    if (!candidateMatches(initial, parsed)) {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
    }
    const proof = options.getReconnectService().candidate(parsed.activeVaultId, initial.sourceId);
    if (!proof) return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
    const reconnect = options.getReconnectService();
    const assertCurrent = () => candidateMatches(jobs.readOriginalSourceReconnectCandidate(parsed.waitingJobId), parsed) &&
      proofMatches(reconnect.candidate(parsed.activeVaultId, initial.sourceId), proof);
    let repair;
    if (parsed.previewId) {
      repair = await reconnect.confirmChanged(
        { activeVaultId: parsed.activeVaultId, requestId: parsed.requestId, ...reconnectProof(proof), previewId: parsed.previewId },
        assertCurrent
      );
    } else {
      const window = options.getWindow(event.sender);
      if (!window) return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "failed" });
      const selection = await options.showOpenDialog(window, { title: "Reconnect referenced source", properties: ["openFile"] });
      if (selection.canceled || selection.filePaths.length === 0) {
        return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "cancelled" });
      }
      if (selection.filePaths.length !== 1 || !assertCurrent()) {
        return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
      }
      repair = await reconnect.reconnect(
        { activeVaultId: parsed.activeVaultId, requestId: parsed.requestId, ...reconnectProof(proof) },
        selection.filePaths[0]!,
        assertCurrent
      );
    }
    if (repair.status === "changed") {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "changed", preview: repair.preview });
    }
    if (repair.status !== "reconnected") {
      return ReferencedOriginalReconnectResultSchema.parse({
        ...identity(parsed),
        status: repair.status === "ineligible" ? "stale" : repair.status
      });
    }
    const resumed = jobs.resumeOriginalSourceReconnect(initial);
    if (resumed.status !== "requeued" || !resumed.job) {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
    }
    reconnect.acknowledge(repair.operationId);
    options.resumeBackgroundJobs();
    options.onSourceReconnected();
    return ReferencedOriginalReconnectResultSchema.parse({
      ...identity(parsed),
      status: "reconnected",
      job: projectJob(resumed.job),
      operationId: repair.operationId,
      contentState: repair.contentState
    });
  });
  options.ipcMain.handle(SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL, (
    _event,
    request: unknown
  ): SourceReconnectListResult => {
    const parsed = SourceReconnectListRequestSchema.parse(request);
    try {
      const result = options.getReconnectService().listUnavailable(parsed.activeVaultId);
      return SourceReconnectListResultSchema.parse({ ...parsed, status: "ready", ...result });
    } catch {
      return SourceReconnectListResultSchema.parse({ ...parsed, status: "stale" });
    }
  });
  options.ipcMain.handle(SOURCE_RECONNECT_ORIGINAL_CHANNEL, async (
    event,
    request: unknown
  ): Promise<SourceReconnectResult> => {
    const parsed = SourceReconnectRequestSchema.parse(request);
    const reconnect = options.getReconnectService();
    const initial = reconnect.candidate(parsed.activeVaultId, parsed.sourceId);
    if (!initial) return SourceReconnectResultSchema.parse({ ...parsed, status: "not_found" });
    if (!proofMatches(initial, parsed)) return SourceReconnectResultSchema.parse({ ...parsed, status: "stale" });
    const assertCurrent = () => proofMatches(reconnect.candidate(parsed.activeVaultId, parsed.sourceId), parsed);
    let result;
    if (parsed.previewId) {
      result = await reconnect.confirmChanged(
        { activeVaultId: parsed.activeVaultId, requestId: parsed.requestId, ...reconnectProof(parsed), previewId: parsed.previewId },
        assertCurrent
      );
    } else {
      const window = options.getWindow(event.sender);
      if (!window) return SourceReconnectResultSchema.parse({ ...parsed, status: "failed" });
      const selection = await options.showOpenDialog(window, { title: "Reconnect referenced source", properties: ["openFile"] });
      if (selection.canceled || selection.filePaths.length === 0) {
        return SourceReconnectResultSchema.parse({ ...parsed, status: "cancelled" });
      }
      if (selection.filePaths.length !== 1 || !assertCurrent()) {
        return SourceReconnectResultSchema.parse({ ...parsed, status: "stale" });
      }
      result = await reconnect.reconnect(
        { activeVaultId: parsed.activeVaultId, requestId: parsed.requestId, ...reconnectProof(parsed) },
        selection.filePaths[0]!,
        assertCurrent
      );
    }
    if (result.status === "changed") return SourceReconnectResultSchema.parse({ ...parsed, status: "changed", preview: result.preview });
    if (result.status !== "reconnected") return SourceReconnectResultSchema.parse({ ...parsed, status: result.status });
    const resumedJobCount = options.getJobs().resumeOriginalSourceReconnectsForSource(parsed.sourceId);
    reconnect.acknowledge(result.operationId);
    if (resumedJobCount > 0) options.resumeBackgroundJobs();
    options.onSourceReconnected();
    return SourceReconnectResultSchema.parse({
      ...parsed,
      status: "reconnected",
      operationId: result.operationId,
      contentState: result.contentState,
      resumedJobCount
    });
  });
  options.ipcMain.handle(SOURCE_RECONNECT_CANCEL_CHANNEL, (
    _event,
    request: unknown
  ): SourceReconnectCancelResult => {
    const parsed = SourceReconnectCancelRequestSchema.parse(request);
    const status = options.getReconnectService().cancelChanged({
      activeVaultId: parsed.activeVaultId,
      requestId: parsed.requestId,
      ...reconnectProof(parsed),
      previewId: parsed.previewId
    });
    return SourceReconnectCancelResultSchema.parse({ ...parsed, status });
  });
}

function reconnectProof(candidate: ReferencedOriginalReconnectCandidate | SourceReconnectRequest) {
  return {
    sourceId: candidate.sourceId,
    sourceKind: candidate.sourceKind,
    sourceRevision: candidate.sourceRevision,
    expectedAvailability: candidate.expectedAvailability,
    expectedChecksum: candidate.expectedChecksum,
    expectedSize: candidate.expectedSize,
    formatIdentity: candidate.formatIdentity
  } as const;
}

function proofMatches(
  current: ReferencedOriginalReconnectCandidate | undefined,
  expected: ReferencedOriginalReconnectCandidate | SourceReconnectRequest
): boolean {
  return !!current && JSON.stringify(reconnectProof(current)) === JSON.stringify(reconnectProof(expected));
}
