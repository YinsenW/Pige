import type { BrowserWindow, IpcMain, OpenDialogOptions, WebContents } from "electron";
import type {
  JobSummary,
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult
} from "@pige/contracts";
import {
  JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL,
  ReferencedOriginalReconnectJobProjectionSchema,
  ReferencedOriginalReconnectRequestSchema,
  ReferencedOriginalReconnectResultSchema,
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
    const window = options.getWindow(event.sender);
    if (!window) return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "failed" });
    const selection = await options.showOpenDialog(window, {
      title: "Reconnect referenced source",
      properties: ["openFile"]
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "cancelled" });
    }
    if (selection.filePaths.length !== 1 || !candidateMatches(
      jobs.readOriginalSourceReconnectCandidate(parsed.waitingJobId),
      parsed
    )) {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
    }
    const repair = await options.getReconnectService().reconnect(
      { activeVaultId: parsed.activeVaultId, sourceId: initial.sourceId },
      selection.filePaths[0]!,
      () => candidateMatches(jobs.readOriginalSourceReconnectCandidate(parsed.waitingJobId), parsed)
    );
    if (repair !== "reconnected") {
      return ReferencedOriginalReconnectResultSchema.parse({
        ...identity(parsed),
        status: repair === "not_found" ? "not_found" : repair === "stale" ? "stale" : "failed"
      });
    }
    const resumed = jobs.resumeOriginalSourceReconnect(initial);
    if (resumed.status !== "requeued" || !resumed.job) {
      return ReferencedOriginalReconnectResultSchema.parse({ ...identity(parsed), status: "stale" });
    }
    options.resumeBackgroundJobs();
    return ReferencedOriginalReconnectResultSchema.parse({
      ...identity(parsed),
      status: "reconnected",
      job: projectJob(resumed.job)
    });
  });
}
