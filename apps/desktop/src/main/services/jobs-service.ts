import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  JobActionRequest,
  JobActionResult,
  JobSummary,
  JobsListRequest,
  JobsListResult,
  LocalDatabaseRebuildResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  SourceRecordSchema,
  type JobClass,
  type JobRecord,
  type JobStage,
  type JobState,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestOcrToolExecution,
  type AgentIngestOcrToolRequest,
  type AgentIngestParseToolExecution,
  type AgentIngestParseToolRequest
} from "./agent-ingest-service";
import type { DocumentParserPort } from "./document-parser-service";
import { SourcePageService } from "./source-page-service";
import type { LocalDatabaseService } from "./local-database-service";
import type { OcrPort, OcrSourceCapability } from "./ocr-service";
import {
  JobCancellationError,
  type JobCancellationBoundary,
  type JobDurableWriteState,
  type JobExecutionControl,
  type JobProgressUpdate
} from "./job-execution-control";

export interface JobsVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ProcessQueuedCapturesRequest {
  readonly jobIds?: readonly string[];
  readonly limit?: number;
}

export interface ProcessQueuedCapturesResult {
  readonly processed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface ProcessQueuedAgentIngestRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
}

export type ProcessQueuedAgentIngestResult = ProcessQueuedCapturesResult;

export interface ProcessQueuedParsesRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ProcessQueuedParsesResult extends ProcessQueuedCapturesResult {
  readonly agentReadySourceIds: readonly string[];
  readonly ocrWaitingSourceIds: readonly string[];
}

export interface RequeueWaitingAgentIngestResult {
  readonly requeued: number;
}

export type RequeueWaitingParsesResult = RequeueWaitingAgentIngestResult;
export type RequeueWaitingOcrResult = RequeueWaitingAgentIngestResult;

export interface RecoverInterruptedJobsResult {
  readonly requeued: number;
  readonly failedRetryable: number;
}

export interface ProcessQueuedIndexRebuildRequest {
  readonly jobIds?: readonly string[];
  readonly limit?: number;
}

export interface ProcessQueuedIndexRebuildResult extends ProcessQueuedCapturesResult {
  readonly lastRebuild?: LocalDatabaseRebuildResult;
}

export interface ProcessQueuedOcrRequest {
  readonly jobIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
  readonly abortSignal?: AbortSignal;
}

export interface ProcessQueuedOcrResult extends ProcessQueuedCapturesResult {
  readonly agentReadySourceIds: readonly string[];
}

const DEFAULT_JOB_LIST_LIMIT = 20;
const MAX_JOB_LIST_LIMIT = 100;
const CANCELABLE_STATES = new Set<JobState>(["queued", "waiting_dependency", "waiting_permission", "failed_retryable"]);
const RETRYABLE_STATES = new Set<JobState>(["failed_retryable", "waiting_dependency", "cancelled"]);
const COOPERATIVELY_CANCELABLE_CLASSES = new Set<JobClass>(["parse", "ocr", "agent_ingest", "index_rebuild"]);

export class JobsService {
  readonly #vaults: JobsVaultPort;
  readonly #sourcePages: SourcePageService;
  readonly #agentIngest: AgentIngestService | undefined;
  readonly #database: LocalDatabaseService | undefined;
  readonly #documentParser: DocumentParserPort | undefined;
  readonly #ocr: OcrPort | undefined;
  readonly #activeExecutions = new Map<string, AbortController>();
  #indexRebuildTail: Promise<void> = Promise.resolve();

  constructor(
    vaults: JobsVaultPort,
    agentIngest?: AgentIngestService,
    database?: LocalDatabaseService,
    documentParser?: DocumentParserPort,
    ocr?: OcrPort
  ) {
    this.#vaults = vaults;
    this.#sourcePages = new SourcePageService();
    this.#agentIngest = agentIngest;
    this.#database = database;
    this.#documentParser = documentParser;
    this.#ocr = ocr;
  }

  list(request: JobsListRequest = {}): JobsListResult {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const states = new Set<JobState>(request.states ?? []);
    const classes = new Set<JobClass>(request.classes ?? []);
    const limit = clampLimit(request.limit);
    const { jobs, invalidJobCount } = readJobRecords(path.join(vaultPath, ".pige", "jobs"));
    const summaries = jobs
      .filter((job) => states.size === 0 || states.has(job.state))
      .filter((job) => classes.size === 0 || classes.has(job.class))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((job) => toJobSummary(vaultPath, job));

    return {
      scannedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      total: jobs.length,
      invalidJobCount,
      jobs: summaries
    };
  }

  cancel(request: JobActionRequest): JobActionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFile = readJobRecordFile(vaultPath, request.jobId);
    if (!jobFile) {
      return { status: "not_found", reason: "Job record was not found." };
    }

    if (jobFile.job.state === "cancel_requested") {
      return {
        status: "cancel_requested",
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    if (jobFile.job.state === "running") {
      const controller = this.#activeExecutions.get(jobFile.job.id);
      if (!controller || !COOPERATIVELY_CANCELABLE_CLASSES.has(jobFile.job.class)) {
        return {
          status: "not_allowed",
          reason: `Running ${jobFile.job.class} jobs do not support cooperative cancellation.`,
          job: toJobSummary(vaultPath, jobFile.job)
        };
      }
      const requestedAt = new Date().toISOString();
      const updatedJob = JobRecordSchema.parse({
        ...jobFile.job,
        state: "cancel_requested",
        updatedAt: requestedAt,
        cancellation: {
          ...jobFile.job.cancellation,
          requestedAt,
          requestedBy: "user"
        },
        message: "Cancellation requested; waiting for a safe local checkpoint."
      });
      writeJsonAtomic(jobFile.path, updatedJob);
      controller.abort();
      return {
        status: "cancel_requested",
        job: toJobSummary(vaultPath, updatedJob)
      };
    }

    if (
      CANCELABLE_STATES.has(jobFile.job.state) &&
      jobFile.job.cancellation?.durableWritesApplied === true
    ) {
      return {
        status: "not_allowed",
        reason: "A retained action-safety guard prevents clean cancellation; the job remains retryable.",
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    if (!CANCELABLE_STATES.has(jobFile.job.state)) {
      return {
        status: "not_allowed",
        reason: `Job state ${jobFile.job.state} cannot be cancelled.`,
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    const cancelledAt = new Date().toISOString();
    const updatedJob = JobRecordSchema.parse({
      ...jobFile.job,
      state: "cancelled",
      updatedAt: cancelledAt,
      finishedAt: cancelledAt,
      cancellation: {
        ...jobFile.job.cancellation,
        requestedAt: cancelledAt,
        requestedBy: "user",
        safeCheckpointId: "before_durable_write",
        durableWritesApplied: false
      },
      message: "Job cancelled. Preserved source data remains in the vault."
    });
    writeJsonAtomic(jobFile.path, updatedJob);
    return {
      status: "cancelled",
      job: toJobSummary(vaultPath, updatedJob)
    };
  }

  retry(request: JobActionRequest): JobActionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFile = readJobRecordFile(vaultPath, request.jobId);
    if (!jobFile) {
      return { status: "not_found", reason: "Job record was not found." };
    }

    if (!RETRYABLE_STATES.has(jobFile.job.state)) {
      return {
        status: "not_allowed",
        reason: `Job state ${jobFile.job.state} cannot be retried.`,
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    const preserveDurableWrites = jobFile.job.cancellation?.durableWritesApplied === true;
    const {
      stage: _stage,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      progress: _progress,
      cancellation: _cancellation,
      error: _error,
      waitingDependency: _waitingDependency,
      ...retryableJob
    } = jobFile.job;
    const updatedJob = JobRecordSchema.parse({
      ...retryableJob,
      state: "queued",
      updatedAt: new Date().toISOString(),
      ...(preserveDurableWrites ? { cancellation: { durableWritesApplied: true } } : {}),
      message: "Job requeued for later processing."
    });
    writeJsonAtomic(jobFile.path, updatedJob);
    return {
      status: "requeued",
      job: toJobSummary(vaultPath, updatedJob)
    };
  }

  recoverInterruptedJobs(): RecoverInterruptedJobsResult {
    const vaultPath = this.#requireActiveVaultPath();
    let requeued = 0;
    let failedRetryable = 0;
    for (const jobFile of readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.state !== "running" && jobFile.job.state !== "cancel_requested") continue;
      const canResumeIdempotently = jobFile.job.state === "running" &&
        (jobFile.job.class === "capture" ||
          jobFile.job.class === "parse" ||
          jobFile.job.class === "ocr" ||
          jobFile.job.class === "agent_ingest" ||
          jobFile.job.class === "index_rebuild");
      const state: JobState = canResumeIdempotently ? "queued" : "failed_retryable";
      const message = canResumeIdempotently
        ? "Pige restarted during this idempotent local job; validated outputs will be reused and processing has been requeued."
        : "Pige restarted before this job reached a safe completion point. Preserved inputs remain available for an explicit retry.";
      writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
        ...jobFile.job,
        state,
        updatedAt: new Date().toISOString(),
        message
      }));
      if (canResumeIdempotently) requeued += 1;
      else failedRetryable += 1;
    }
    return { requeued, failedRetryable };
  }

  requeueWaitingAgentIngest(): RequeueWaitingAgentIngestResult {
    const vaultPath = this.#requireActiveVaultPath();
    if (!canRunAgentIngest(this.#agentIngest)) {
      return { requeued: 0 };
    }

    let requeued = 0;
    for (const jobFile of readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.class !== "agent_ingest" || jobFile.job.state !== "waiting_dependency") continue;
      const sourceRecord = jobFile.job.sourceId ? readSourceRecord(vaultPath, jobFile.job.sourceId) : undefined;
      const agentSelectedOcr = Boolean(sourceRecord && supportsAgentSelectedOcr(sourceRecord.kind));
      const waitingAgentOcr = agentSelectedOcr &&
        hasWaitingAgentOcrChild(vaultPath, jobFile.job);
      const completedEmptyAgentOcr = Boolean(
        sourceRecord &&
        sourceRecord.metadata.agentTextReady !== true &&
        sourceRecord.metadata.ocrStatus === "completed_empty" &&
        hasCompletedEmptyAgentOcrChild(vaultPath, jobFile.job, sourceRecord)
      );
      if (completedEmptyAgentOcr) continue;
      const agentOcrRequiredBeforePublication = agentSelectedOcr &&
        sourceRecord?.metadata.agentTextReady !== true &&
        (sourceRecord?.kind === "image_file" || sourceRecord?.metadata.needsOcr === true);
      if (waitingAgentOcr || agentOcrRequiredBeforePublication) {
        if (!sourceRecord || !inspectOcrSource(this.#ocr, sourceRecord).ready) continue;
      } else if (!agentSelectedOcr && sourceRecord && shouldWaitForRunnableOcr(this.#ocr, sourceRecord)) {
        continue;
      }
      if (
        sourceRecord &&
        supportsAgentSelectedParser(sourceRecord.kind) &&
        hasWaitingAgentParseChild(vaultPath, jobFile.job) &&
        !this.#documentParser?.canParse(sourceRecord.kind)
      ) continue;
      writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
        ...jobFile.job,
        state: "queued",
        updatedAt: new Date().toISOString(),
        message: "Default model is ready; Agent ingest requeued."
      }));
      requeued += 1;
    }

    return { requeued };
  }

  requeueWaitingParses(): RequeueWaitingParsesResult {
    const vaultPath = this.#requireActiveVaultPath();
    const parser = this.#documentParser;
    if (!parser) return { requeued: 0 };

    let requeued = 0;
    for (const jobFile of readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.class !== "parse" || jobFile.job.state !== "waiting_dependency" || !jobFile.job.sourceId) continue;
      if (isAgentSelectedParseJob(jobFile.job)) continue;
      const sourceRecord = readSourceRecord(vaultPath, jobFile.job.sourceId);
      if (!sourceRecord || !parser.canParse(sourceRecord.kind)) continue;
      writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
        ...jobFile.job,
        state: "queued",
        updatedAt: new Date().toISOString(),
        message: "Bundled document parser is ready; parse requeued."
      }));
      requeued += 1;
    }
    return { requeued };
  }

  requeueWaitingOcr(): RequeueWaitingOcrResult {
    const vaultPath = this.#requireActiveVaultPath();
    const ocr = this.#ocr;
    if (!ocr) return { requeued: 0 };

    let requeued = 0;
    for (const jobFile of readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.class !== "ocr" || jobFile.job.state !== "waiting_dependency" || !jobFile.job.sourceId) continue;
      if (isAgentSelectedOcrJob(jobFile.job)) continue;
      const sourceRecord = readSourceRecord(vaultPath, jobFile.job.sourceId);
      if (!sourceRecord || !inspectOcrSource(ocr, sourceRecord).ready) continue;
      writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
        ...jobFile.job,
        state: "queued",
        updatedAt: new Date().toISOString(),
        message: "Local OCR capability is ready; OCR requeued."
      }));
      requeued += 1;
    }
    return { requeued };
  }

  async requestIndexRebuild(): Promise<LocalDatabaseRebuildResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const job = createIndexRebuildJob(vaultPath);
    const result = await this.processQueuedIndexRebuild({ jobIds: [job.id] });
    if (!result.lastRebuild) {
      throw new PigeDomainError("index_rebuild_failed", "Index rebuild failed. The job remains retryable.");
    }
    return result.lastRebuild;
  }

  processQueuedCaptures(request: ProcessQueuedCapturesRequest = {}): ProcessQueuedCapturesResult {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedCaptureJobFiles(vaultPath, request);
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      let execution: { readonly job: JobRecord; readonly control: JobExecutionControl } | undefined;
      try {
        const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
        if (!sourceRecordFile) {
          markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved job remains retryable.");
          failed += 1;
          continue;
        }

        const captureExecution = this.#beginNonCooperativeExecution(
          jobFile.path,
          jobFile.job,
          "capturing_source",
          "Publishing the preserved source into the local knowledge vault."
        );
        execution = captureExecution;
        const page = this.#sourcePages.createForSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          captureExecution.job.id,
          sourceRecordFile.sourceRecord,
          {
            onPublicationStart: () => captureExecution.control.markDurableCheckpoint(
              "capture_source_page_publication_started"
            )
          }
        );
        if (
          supportsAgentSelectedParser(sourceRecordFile.sourceRecord.kind) ||
          supportsAgentSelectedOcr(sourceRecordFile.sourceRecord.kind)
        ) {
          ensureAgentIngestJob(
            vaultPath,
            captureExecution.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest)
          );
        } else {
          ensureAgentIngestJob(
            vaultPath,
            captureExecution.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest)
          );
        }
        this.#completeCooperativeExecution(
          jobFile.path,
          captureExecution.job,
          "completed",
          page.created
            ? "Source page created from preserved source."
            : "Source page already exists for preserved source.",
          "source",
          captureExecution.control.durableWriteState()
        );
        appendLog(vaultPath, `${new Date().toISOString()} Created source page [${page.title}](${page.pagePath}) for source \`${jobFile.job.sourceId}\`.`);
        completed += 1;
      } catch (caught) {
        const cancellation = execution ? resolveCancellation(execution.control, caught) : undefined;
        if (cancellation) {
          markJobCancellationOutcome(jobFile.path, execution?.job ?? jobFile.job, cancellation);
        } else {
          markJobFailedRetryable(
            jobFile.path,
            execution?.job ?? jobFile.job,
            "Source page creation failed. Preserved source remains retryable.",
            execution?.control.durableWriteState()
          );
        }
        failed += 1;
      }
    }

    return {
      processed: jobFiles.length,
      completed,
      failed
    };
  }

  async processQueuedParses(request: ProcessQueuedParsesRequest = {}): Promise<ProcessQueuedParsesResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedParseJobFiles(vaultPath, request);
    const agentReadySourceIds: string[] = [];
    const ocrWaitingSourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved parse job remains retryable.");
        failed += 1;
        continue;
      }
      const parser = this.#documentParser;
      if (!parser || !parser.canParse(sourceRecordFile.sourceRecord.kind)) {
        markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for a bundled local parser that supports this document type.");
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile.path,
        jobFile.job,
        "parsing",
        "Extracting document text in the local parser worker."
      );
      const runningJob = execution.job;
      const agentSelected = isAgentSelectedParseJob(runningJob);
      const detachParentAbort = bridgeParentAbortToChild(
        jobFile.path,
        execution.controller,
        request.abortSignal
      );

      try {
        execution.control.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "document" });
        const result = await parser.parseSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          runningJob,
          execution.control
        );
        const refreshedSource = readSourceRecord(vaultPath, sourceRecordFile.sourceRecord.id) ?? sourceRecordFile.sourceRecord;
        let ocrCapability: OcrSourceCapability | undefined;
        if (!agentSelected && result.needsOcr) {
          ocrCapability = inspectOcrSource(this.#ocr, refreshedSource);
          ensureOcrWaitingJob(
            vaultPath,
            runningJob,
            refreshedSource,
            ocrCapability
          );
          ocrWaitingSourceIds.push(refreshedSource.id);
        }
        if (
          !agentSelected &&
          result.extractedTextArtifactPath &&
          result.agentTextReady &&
          (!result.needsOcr || ocrCapability?.ready !== true)
        ) {
          ensureAgentIngestJob(vaultPath, runningJob, refreshedSource.id, canRunAgentIngest(this.#agentIngest));
          agentReadySourceIds.push(refreshedSource.id);
        }
        const hasWarnings = result.needsOcr || result.sourcePageConflict || result.warnings.length > 0;
        this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          hasWarnings ? "completed_with_warnings" : "completed",
          createParseCompletionMessage(result, sourceRecordFile.sourceRecord.kind),
          "document",
          execution.control.durableWriteState()
        );
        appendLog(
          vaultPath,
          `${new Date().toISOString()} Parsed ${documentLabel(refreshedSource.kind)} source \`${refreshedSource.id}\`: ${result.textCharacterCount} text characters, coverage ${result.textCoverage}.${result.needsOcr ? " OCR enrichment is waiting." : ""}`
        );
        completed += 1;
      } catch (caught) {
        const cancellation = resolveCancellation(execution.control, caught);
        if (cancellation) {
          markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else {
          const failure = parseFailure(caught, sourceRecordFile.sourceRecord.kind);
          if (failure.waiting) {
            markJobWaitingDependency(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else if (failure.final) {
            markJobFailedFinal(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else {
            markJobFailedRetryable(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          }
        }
        failed += 1;
      } finally {
        detachParentAbort();
        this.#finishCooperativeExecution(runningJob.id, execution.controller);
      }
    }

    return {
      processed: jobFiles.length,
      completed,
      failed,
      agentReadySourceIds,
      ocrWaitingSourceIds
    };
  }

  async processQueuedOcr(request: ProcessQueuedOcrRequest = {}): Promise<ProcessQueuedOcrResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedOcrJobFiles(vaultPath, request);
    const agentReadySourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved OCR job remains retryable.");
        failed += 1;
        continue;
      }
      const agentSelected = isAgentSelectedOcrJob(jobFile.job);
      const ocr = this.#ocr;
      const capability = inspectOcrSource(ocr, sourceRecordFile.sourceRecord);
      if (!ocr || !capability.ready) {
        if (!agentSelected && sourceRecordFile.sourceRecord.metadata.agentTextReady === true) {
          ensureAgentIngestJob(
            vaultPath,
            jobFile.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest)
          );
          agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
        }
        markJobWaitingDependency(jobFile.path, jobFile.job, capability.message);
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile.path,
        jobFile.job,
        "ocr",
        sourceRecordFile.sourceRecord.kind === "pdf_file"
          ? "Rendering verified PDF page targets and recognizing them with local OCR."
          : sourceRecordFile.sourceRecord.kind === "pptx_file"
            ? "Materializing verified PPTX media targets and recognizing them with local OCR."
            : "Recognizing image text with the local platform OCR helper."
      );
      const runningJob = execution.job;
      const detachParentAbort = bridgeParentAbortToChild(
        jobFile.path,
        execution.controller,
        request.abortSignal
      );

      try {
        const result = await ocr.ocrSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          runningJob,
          execution.control
        );
        if (!agentSelected && result.agentTextReady) {
          ensureAgentIngestJob(vaultPath, runningJob, sourceRecordFile.sourceRecord.id, canRunAgentIngest(this.#agentIngest));
          agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
        }
        const hasWarnings = !result.agentTextReady || result.sourcePageConflict || result.warnings.length > 0;
        this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          hasWarnings ? "completed_with_warnings" : "completed",
          createOcrCompletionMessage(result, sourceRecordFile.sourceRecord.kind),
          sourceRecordFile.sourceRecord.kind === "pdf_file"
            ? "page"
            : sourceRecordFile.sourceRecord.kind === "pptx_file"
              ? "media"
              : "image",
          execution.control.durableWriteState()
        );
        appendLog(
          vaultPath,
          `${new Date().toISOString()} OCR processed ${documentLabel(sourceRecordFile.sourceRecord.kind)} source \`${sourceRecordFile.sourceRecord.id}\`: ${result.textCharacterCount} text characters.${result.confidence !== undefined ? ` confidence ${result.confidence.toFixed(3)}.` : ""}`
        );
        completed += 1;
      } catch (caught) {
        const cancellation = resolveCancellation(execution.control, caught);
        if (cancellation) {
          markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else {
          const failure = ocrFailure(caught, sourceRecordFile.sourceRecord.kind);
          if (failure.waiting) {
            if (
              !agentSelected &&
              sourceRecordFile.sourceRecord.metadata.agentTextReady === true &&
              isOcrCapabilityUnavailableError(caught)
            ) {
              ensureAgentIngestJob(
                vaultPath,
                runningJob,
                sourceRecordFile.sourceRecord.id,
                canRunAgentIngest(this.#agentIngest)
              );
              if (!agentReadySourceIds.includes(sourceRecordFile.sourceRecord.id)) {
                agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
              }
            }
            markJobWaitingDependency(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else if (failure.final) {
            markJobFailedFinal(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else {
            markJobFailedRetryable(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          }
        }
        failed += 1;
      } finally {
        detachParentAbort();
        this.#finishCooperativeExecution(runningJob.id, execution.controller);
      }
    }

    return { processed: jobFiles.length, completed, failed, agentReadySourceIds };
  }

  async processQueuedAgentIngest(request: ProcessQueuedAgentIngestRequest = {}): Promise<ProcessQueuedAgentIngestResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedAgentIngestJobFiles(vaultPath, request);
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const agentIngest = this.#agentIngest;
      if (!agentIngest || !canRunAgentIngest(agentIngest)) {
        markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for a tested default model before Agent ingest.");
        failed += 1;
        continue;
      }

      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Agent ingest remains retryable.");
        failed += 1;
        continue;
      }
      if (
        !supportsAgentSelectedOcr(sourceRecordFile.sourceRecord.kind) &&
        shouldWaitForRunnableOcr(this.#ocr, sourceRecordFile.sourceRecord)
      ) {
        markJobWaitingDependency(
          jobFile.path,
          jobFile.job,
          createAgentOcrWaitMessage(sourceRecordFile.sourceRecord)
        );
        failed += 1;
        continue;
      }
      const execution = this.#beginCooperativeExecution(
        jobFile.path,
        jobFile.job,
        "waiting_for_model",
        "Agent ingest is preparing grounded evidence for the configured model."
      );
      const runningJob = execution.job;
      let activeJob = runningJob;
      try {
        const result = await agentIngest.ingestSource(vaultPath, sourceRecordFile.sourceRecord, runningJob, {
          onPolicyResolved: (snapshot) => {
            const current = readJobRecordAtPath(jobFile.path) ?? activeJob;
            activeJob = JobRecordSchema.parse({
              ...current,
              policyContextId: snapshot.policyContextId,
              policyHash: snapshot.policyHash,
              updatedAt: new Date().toISOString(),
              message: "Agent ingest policy and model-egress gates resolved before provider access."
            });
            writeJsonAtomic(jobFile.path, activeJob);
          },
          onEgressRecorded: (operationId) => {
            const current = readJobRecordAtPath(jobFile.path) ?? activeJob;
            activeJob = JobRecordSchema.parse({
              ...current,
              operationIds: Array.from(new Set([...(current.operationIds ?? []), operationId])),
              updatedAt: new Date().toISOString()
            });
            writeJsonAtomic(jobFile.path, activeJob);
          },
          assertSourceCurrent: (expectedSource) => {
            const currentSource = readSourceRecord(vaultPath, sourceRecordFile.sourceRecord.id);
            if (
              !currentSource ||
              sourceRecordRevision(currentSource) !== sourceRecordRevision(expectedSource) ||
              (
                !supportsAgentSelectedParser(currentSource.kind) &&
                !supportsAgentSelectedOcr(currentSource.kind) &&
                shouldWaitForRunnableOcr(this.#ocr, currentSource)
              )
            ) {
              throw new PigeDomainError(
                "agent_ingest.source_changed",
                "The selected source evidence changed while Agent ingest was running."
              );
            }
          },
          parseCurrentSource: (parseRequest) => this.#runAgentSelectedParseTool(
            vaultPath,
            runningJob,
            parseRequest,
            execution.control
          ),
          ocrCurrentSource: (ocrRequest) => this.#runAgentSelectedOcrTool(
            vaultPath,
            runningJob,
            ocrRequest,
            execution.control
          ),
          throwIfCancellationRequested: () => execution.control.throwIfCancellationRequested(),
          onPublicationStart: (checkpointId) => execution.control.markDurableCheckpoint(checkpointId),
          signal: execution.control.signal
        });
        const completedJob = this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          result.reviewRequired ? "completed_with_warnings" : "completed",
          result.reviewRequired
            ? "Agent ingest created a wiki note that needs review."
            : result.created ? "Agent ingest created a wiki note." : "Agent ingest wiki note already exists.",
          "source",
          execution.control.durableWriteState(),
          result.operationIds
        );
        if (completedJob.state === "cancelled") {
          failed += 1;
        } else {
          const warningSuffix = result.reviewRequired ? " Review is needed before treating it as clean knowledge." : "";
          appendLog(vaultPath, `${new Date().toISOString()} Created wiki note [${result.title}](${result.pagePath}) from source \`${sourceRecordFile.sourceRecord.id}\`.${warningSuffix}`);
          completed += 1;
        }
      } catch (caught) {
        const cancellation = resolveCancellation(execution.control, caught);
        const durableState = execution.control.durableWriteState();
        if (cancellation) {
          markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (caught instanceof PigeDomainError && caught.code === "model_provider.default_model_missing") {
          markJobWaitingDependency(jobFile.path, runningJob, "Waiting for a tested default model before Agent ingest.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "agent_runtime.tool_dependency_waiting") {
          markJobWaitingDependency(
            jobFile.path,
            runningJob,
            "Agent-selected source processing is waiting for a registered local capability.",
            durableState
          );
        } else if (caught instanceof PigeDomainError && caught.code === "source.external_unavailable") {
          markJobWaitingDependency(jobFile.path, runningJob, "Waiting for the referenced original source to be reconnected before Agent ingest can continue.", durableState);
        } else if (caught instanceof PigeDomainError && /^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
          markJobFailedFinal(jobFile.path, runningJob, "The source cannot be verified safely. Re-import it to create a new source version before Agent ingest.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.confirmation_required") {
          markJobWaitingPermission(jobFile.path, runningJob, "Waiting for explicit approval before selected evidence is sent to the configured model service.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.blocked") {
          markJobFailedFinal(jobFile.path, runningJob, "Model egress is blocked by the current privacy policy; the preserved source remains local.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "agent_ingest.source_changed") {
          const currentSource = readSourceRecord(vaultPath, sourceRecordFile.sourceRecord.id);
          if (currentSource && shouldWaitForRunnableOcr(this.#ocr, currentSource)) {
            markJobWaitingDependency(
              jobFile.path,
              runningJob,
              `Source evidence changed while Agent ingest was running; waiting for ${documentLabel(currentSource.kind)} OCR enrichment before retry.`,
              durableState
            );
          } else {
            const currentJob = readJobRecordAtPath(jobFile.path) ?? runningJob;
            writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
              ...withDurableWriteState(currentJob, durableState),
              state: "queued",
              updatedAt: new Date().toISOString(),
              message: "Source evidence changed while Agent ingest was running; ingest requeued with the latest evidence."
            }));
          }
        } else {
          markJobFailedRetryable(
            jobFile.path,
            runningJob,
            "Agent ingest failed. Preserved source and source page remain retryable.",
            durableState
          );
        }
        failed += 1;
      } finally {
        this.#finishCooperativeExecution(runningJob.id, execution.controller);
      }
    }

    return {
      processed: jobFiles.length,
      completed,
      failed
    };
  }

  async #runAgentSelectedParseTool(
    vaultPath: string,
    parentJob: JobRecord,
    request: AgentIngestParseToolRequest,
    parentControl: JobExecutionControl
  ): Promise<AgentIngestParseToolExecution> {
    assertAgentParseToolRequest(parentJob, request);
    const currentParent = readJobRecordFile(vaultPath, parentJob.id);
    if (!currentParent) {
      throw new PigeDomainError("agent_runtime.tool_parent_missing", "The active Agent Job is unavailable.");
    }
    if (currentParent.job.state === "cancel_requested" || currentParent.job.state === "cancelled") {
      throw new JobCancellationError({
        durableWritesApplied: currentParent.job.cancellation?.durableWritesApplied === true,
        ...(currentParent.job.cancellation?.safeCheckpointId
          ? { safeCheckpointId: currentParent.job.cancellation.safeCheckpointId }
          : {})
      });
    }
    if (currentParent.job.state !== "running" || currentParent.job.class !== "agent_ingest") {
      throw new PigeDomainError("agent_runtime.tool_parent_inactive", "The Agent tool parent is not the active ingest Job.");
    }
    if (currentParent.job.policyHash !== request.policyHash) {
      throw new PigeDomainError("agent_runtime.tool_binding_changed", "The Agent policy binding changed before tool dispatch.");
    }

    const sourceFile = readSourceRecordFile(vaultPath, request.sourceRecord.id);
    if (
      !sourceFile ||
      sourceRecordRevision(sourceFile.sourceRecord) !== sourceRecordRevision(request.sourceRecord)
    ) {
      throw new PigeDomainError("agent_ingest.source_changed", "The selected source changed before parser dispatch.");
    }
    if (!supportsAgentSelectedParser(sourceFile.sourceRecord.kind)) {
      throw new PigeDomainError("parser.unsupported_source", "The Agent-selected parser tool does not support this preserved source type.");
    }

    const parserReady = Boolean(this.#documentParser?.canParse(sourceFile.sourceRecord.kind));
    const dependencyCode = parserDependencyCode(sourceFile.sourceRecord.kind);
    let child = ensureAgentParseToolJob(
      vaultPath,
      currentParent.job,
      sourceFile.sourceRecord,
      request,
      parserReady ? "queued" : "waiting_dependency"
    );
    const reused = child.state === "completed" || child.state === "completed_with_warnings";
    if (reused) {
      parentControl.markDurableCheckpoint("agent_parse_child_output_adoption_started");
      return createAgentParseToolExecution(
        child,
        sourceFile.sourceRecord,
        sourceFile.sourceRecord.metadata.needsOcr === true ? "needs_ocr" : "reused"
      );
    }
    if (!parserReady) {
      return createAgentParseToolExecution(child, sourceFile.sourceRecord, "waiting_dependency", dependencyCode);
    }

    if (child.state === "failed_final") {
      throw new PigeDomainError("parser.tool_failed_final", "The durable document parse child cannot be retried safely.");
    }
    if (child.state === "running" || child.state === "cancel_requested") {
      throw new PigeDomainError("parser.tool_recovery_required", "The durable document parse child requires startup recovery before reuse.");
    }
    if (child.state !== "queued") {
      const retry = this.retry({ jobId: child.id });
      if (retry.status !== "requeued" || !retry.job) {
        throw new PigeDomainError("parser.tool_retry_failed", "The durable PDF parse child could not be requeued.");
      }
      child = readJobRecordFile(vaultPath, child.id)?.job ?? child;
    }
    parentControl.markDurableCheckpoint("agent_parse_child_publication_started");
    await this.processQueuedParses({
      jobIds: [child.id],
      limit: 1,
      abortSignal: request.signal
    });
    child = readJobRecordFile(vaultPath, child.id)?.job ?? child;

    const refreshedSource = readSourceRecord(vaultPath, sourceFile.sourceRecord.id) ?? sourceFile.sourceRecord;
    if (child.state === "completed" || child.state === "completed_with_warnings") {
      const status = refreshedSource.metadata.needsOcr === true
        ? "needs_ocr"
        : "parsed";
      return createAgentParseToolExecution(child, refreshedSource, status);
    }
    if (child.state === "waiting_dependency") {
      return createAgentParseToolExecution(child, refreshedSource, "waiting_dependency", dependencyCode);
    }
    if (request.signal.aborted || child.state === "cancelled" || child.state === "cancel_requested") {
      throw new JobCancellationError({
        durableWritesApplied: child.cancellation?.durableWritesApplied === true,
        ...(child.cancellation?.safeCheckpointId ? { safeCheckpointId: child.cancellation.safeCheckpointId } : {})
      });
    }
    if (child.state === "failed_final") {
      throw new PigeDomainError("parser.tool_failed_final", "The durable document parse child failed validation.");
    }
    throw new PigeDomainError("parser.tool_failed_retryable", "The durable document parse child remains retryable.");
  }

  async #runAgentSelectedOcrTool(
    vaultPath: string,
    parentJob: JobRecord,
    request: AgentIngestOcrToolRequest,
    parentControl: JobExecutionControl
  ): Promise<AgentIngestOcrToolExecution> {
    assertAgentOcrToolRequest(parentJob, request);
    const currentParent = readJobRecordFile(vaultPath, parentJob.id);
    if (!currentParent) {
      throw new PigeDomainError("agent_runtime.tool_parent_missing", "The active Agent Job is unavailable.");
    }
    if (currentParent.job.state === "cancel_requested" || currentParent.job.state === "cancelled") {
      throw new JobCancellationError({
        durableWritesApplied: currentParent.job.cancellation?.durableWritesApplied === true,
        ...(currentParent.job.cancellation?.safeCheckpointId
          ? { safeCheckpointId: currentParent.job.cancellation.safeCheckpointId }
          : {})
      });
    }
    if (currentParent.job.state !== "running" || currentParent.job.class !== "agent_ingest") {
      throw new PigeDomainError("agent_runtime.tool_parent_inactive", "The Agent tool parent is not the active ingest Job.");
    }
    if (currentParent.job.policyHash !== request.policyHash) {
      throw new PigeDomainError("agent_runtime.tool_binding_changed", "The Agent policy binding changed before tool dispatch.");
    }

    const sourceFile = readSourceRecordFile(vaultPath, request.sourceRecord.id);
    if (
      !sourceFile ||
      sourceRecordRevision(sourceFile.sourceRecord) !== sourceRecordRevision(request.sourceRecord)
    ) {
      throw new PigeDomainError("agent_ingest.source_changed", "The selected source changed before OCR dispatch.");
    }
    if (!supportsAgentSelectedOcr(sourceFile.sourceRecord.kind)) {
      throw new PigeDomainError("ocr.source_unsupported", "The Agent-selected OCR tool does not support this preserved source type.");
    }

    const capability = inspectOcrSource(this.#ocr, sourceFile.sourceRecord);
    const dependencyCode = ocrDependencyCode(sourceFile.sourceRecord.kind);
    let child = ensureAgentOcrToolJob(
      vaultPath,
      currentParent.job,
      sourceFile.sourceRecord,
      request,
      capability.ready ? "queued" : "waiting_dependency"
    );
    const reused = child.state === "completed" || child.state === "completed_with_warnings";
    if (reused) {
      parentControl.markDurableCheckpoint("agent_ocr_child_output_adoption_started");
      return createAgentOcrToolExecution(
        child,
        sourceFile.sourceRecord,
        sourceFile.sourceRecord.metadata.agentTextReady === true ? "reused" : "no_readable_evidence"
      );
    }
    if (!capability.ready) {
      return createAgentOcrToolExecution(
        child,
        sourceFile.sourceRecord,
        "waiting_dependency",
        dependencyCode
      );
    }

    if (child.state === "failed_final") {
      throw new PigeDomainError("ocr.tool_failed_final", "The durable source OCR child cannot be retried safely.");
    }
    if (child.state === "running" || child.state === "cancel_requested") {
      throw new PigeDomainError("ocr.tool_recovery_required", "The durable source OCR child requires startup recovery before reuse.");
    }
    if (child.state !== "queued") {
      const retry = this.retry({ jobId: child.id });
      if (retry.status !== "requeued" || !retry.job) {
        throw new PigeDomainError("ocr.tool_retry_failed", "The durable source OCR child could not be requeued.");
      }
      child = readJobRecordFile(vaultPath, child.id)?.job ?? child;
    }
    parentControl.markDurableCheckpoint("agent_ocr_child_publication_started");
    await this.processQueuedOcr({
      jobIds: [child.id],
      limit: 1,
      abortSignal: request.signal
    });
    child = readJobRecordFile(vaultPath, child.id)?.job ?? child;

    const refreshedSource = readSourceRecord(vaultPath, sourceFile.sourceRecord.id) ?? sourceFile.sourceRecord;
    if (child.state === "completed" || child.state === "completed_with_warnings") {
      return createAgentOcrToolExecution(
        child,
        refreshedSource,
        refreshedSource.metadata.agentTextReady === true ? "processed" : "no_readable_evidence",
        refreshedSource.metadata.agentTextReady === true ? undefined : ocrNoReadableEvidenceCode(sourceFile.sourceRecord.kind)
      );
    }
    if (child.state === "waiting_dependency") {
      return createAgentOcrToolExecution(child, refreshedSource, "waiting_dependency", dependencyCode);
    }
    if (request.signal.aborted || child.state === "cancelled" || child.state === "cancel_requested") {
      throw new JobCancellationError({
        durableWritesApplied: child.cancellation?.durableWritesApplied === true,
        ...(child.cancellation?.safeCheckpointId ? { safeCheckpointId: child.cancellation.safeCheckpointId } : {})
      });
    }
    if (child.state === "failed_final") {
      throw new PigeDomainError("ocr.tool_failed_final", "The durable source OCR child failed validation.");
    }
    throw new PigeDomainError("ocr.tool_failed_retryable", "The durable source OCR child remains retryable.");
  }

  processQueuedIndexRebuild(
    request: ProcessQueuedIndexRebuildRequest = {}
  ): Promise<ProcessQueuedIndexRebuildResult> {
    const next = this.#indexRebuildTail.then(() => this.#processQueuedIndexRebuild(request));
    this.#indexRebuildTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async #processQueuedIndexRebuild(
    request: ProcessQueuedIndexRebuildRequest
  ): Promise<ProcessQueuedIndexRebuildResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedIndexRebuildJobFiles(vaultPath, request);
    let completed = 0;
    let failed = 0;
    let lastRebuild: LocalDatabaseRebuildResult | undefined;

    for (const jobFile of jobFiles) {
      const database = this.#database;
      if (!database) {
        markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for the Local Database Service before index rebuild.");
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile.path,
        jobFile.job,
        "indexing",
        "Rebuilding local database index from Markdown in a local worker."
      );
      const runningJob = execution.job;
      try {
        const rebuild = await database.rebuildInWorker(vaultPath, {
          signal: execution.control.signal,
          onProgress: (progress) => execution.control.reportProgress(progress)
        });
        execution.control.throwIfCancellationRequested();
        let completionState: Extract<JobState, "completed" | "completed_with_warnings"> = "completed";
        let message = `Index rebuilt from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`;
        try {
          appendLog(vaultPath, `${new Date().toISOString()} Rebuilt local database index from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`);
        } catch {
          completionState = "completed_with_warnings";
          message = `${message} Local activity log update needs repair.`;
        }
        const completedJob = this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          completionState,
          message,
          "index_item",
          execution.control.durableWriteState()
        );
        if (completedJob.state === "cancelled") {
          failed += 1;
          continue;
        }
        lastRebuild = { ...rebuild, jobId: runningJob.id, state: completedJob.state };
        completed += 1;
      } catch (caught) {
        const cancellation = resolveCancellation(execution.control, caught);
        if (cancellation) {
          markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else {
          markJobFailedRetryable(
            jobFile.path,
            runningJob,
            "Index rebuild failed. Markdown knowledge and the previous committed index remain intact; the job is retryable.",
            execution.control.durableWriteState()
          );
        }
        failed += 1;
      } finally {
        this.#finishCooperativeExecution(runningJob.id, execution.controller);
      }
    }

    return {
      processed: jobFiles.length,
      completed,
      failed,
      ...(lastRebuild ? { lastRebuild } : {})
    };
  }

  #requireActiveVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return vaultPath;
  }

  #beginCooperativeExecution(
    jobPath: string,
    job: JobRecord,
    stage: JobStage,
    message: string
  ): { readonly job: JobRecord; readonly controller: AbortController; readonly control: JobExecutionControl } {
    return this.#beginExecution(jobPath, job, stage, message, true);
  }

  #beginNonCooperativeExecution(
    jobPath: string,
    job: JobRecord,
    stage: JobStage,
    message: string
  ): { readonly job: JobRecord; readonly control: JobExecutionControl } {
    const execution = this.#beginExecution(jobPath, job, stage, message, false);
    return { job: execution.job, control: execution.control };
  }

  #beginExecution(
    jobPath: string,
    job: JobRecord,
    stage: JobStage,
    message: string,
    cooperative: boolean
  ): { readonly job: JobRecord; readonly controller: AbortController; readonly control: JobExecutionControl } {
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const preserveDurableWrites = job.cancellation?.durableWritesApplied === true;
    const {
      stage: _previousStage,
      startedAt: _previousStartedAt,
      finishedAt: _previousFinishedAt,
      progress: _previousProgress,
      cancellation: _previousCancellation,
      ...jobBase
    } = job;
    const runningJob = JobRecordSchema.parse({
      ...jobBase,
      state: "running",
      stage,
      startedAt,
      updatedAt: startedAt,
      ...(preserveDurableWrites ? { cancellation: { durableWritesApplied: true } } : {}),
      message
    });
    if (cooperative) this.#activeExecutions.set(job.id, controller);
    try {
      writeJsonAtomic(jobPath, runningJob);
    } catch (caught) {
      if (cooperative) this.#activeExecutions.delete(job.id);
      throw caught;
    }
    return {
      job: runningJob,
      controller,
      control: new FileBackedJobExecutionControl(jobPath, controller, {
        durableWritesApplied: preserveDurableWrites
      })
    };
  }

  #completeCooperativeExecution(
    jobPath: string,
    fallback: JobRecord,
    state: Extract<JobState, "completed" | "completed_with_warnings">,
    message: string,
    defaultUnit: string,
    durableState: JobDurableWriteState,
    operationIds: readonly string[] = []
  ): JobRecord {
    const current = readJobRecordAtPath(jobPath) ?? fallback;
    const cancellationArrived = current.state === "cancel_requested";
    const durableWritesApplied = current.cancellation?.durableWritesApplied === true ||
      durableState.durableWritesApplied;
    const mergedOperationIds = Array.from(new Set([...(current.operationIds ?? []), ...operationIds]));
    const progress = completedProgress(current.progress, defaultUnit);
    const finishedAt = new Date().toISOString();
    if (cancellationArrived && !durableWritesApplied) {
      const cancelledJob = JobRecordSchema.parse({
        ...current,
        state: "cancelled",
        progress,
        updatedAt: finishedAt,
        finishedAt,
        cancellation: {
          ...current.cancellation,
          durableWritesApplied: false
        },
        ...(mergedOperationIds.length > 0 ? { operationIds: mergedOperationIds } : {}),
        message: "Job cancelled at a safe checkpoint. Preserved source data remains in the vault."
      });
      writeJsonAtomic(jobPath, cancelledJob);
      return cancelledJob;
    }
    const completedJob = JobRecordSchema.parse({
      ...withDurableWriteState(current, durableState),
      state: cancellationArrived ? "completed_with_warnings" : state,
      progress,
      updatedAt: finishedAt,
      finishedAt,
      ...(mergedOperationIds.length > 0 ? { operationIds: mergedOperationIds } : {}),
      message: cancellationArrived
        ? "Durable output committed before cancellation could safely apply; the completed result was preserved."
        : message
    });
    writeJsonAtomic(jobPath, completedJob);
    return completedJob;
  }

  #finishCooperativeExecution(jobId: string, controller: AbortController): void {
    if (this.#activeExecutions.get(jobId) === controller) this.#activeExecutions.delete(jobId);
  }
}

class FileBackedJobExecutionControl implements JobExecutionControl {
  readonly signal: AbortSignal;
  readonly #jobPath: string;
  #durableWritesApplied: boolean;
  #durableCheckpointId: string | undefined;

  constructor(jobPath: string, controller: AbortController, initialState: JobDurableWriteState) {
    this.#jobPath = jobPath;
    this.signal = controller.signal;
    this.#durableWritesApplied = initialState.durableWritesApplied;
    this.#durableCheckpointId = initialState.safeCheckpointId;
  }

  throwIfCancellationRequested(boundary: JobCancellationBoundary = {}): void {
    const current = readJobRecordAtPath(this.#jobPath);
    if (!this.signal.aborted && current?.state !== "cancel_requested") return;
    const safeCheckpointId = boundary.safeCheckpointId ??
      current?.cancellation?.safeCheckpointId ??
      this.#durableCheckpointId;
    throw new JobCancellationError({
      durableWritesApplied: this.#durableWritesApplied ||
        current?.cancellation?.durableWritesApplied === true ||
        boundary.durableWritesApplied === true,
      ...(safeCheckpointId ? { safeCheckpointId } : {})
    });
  }

  reportProgress(progress: JobProgressUpdate, boundary: JobCancellationBoundary = {}): void {
    this.throwIfCancellationRequested(boundary);
    const current = readJobRecordAtPath(this.#jobPath);
    if (!current || current.state !== "running") {
      throw new Error("Job progress can only be recorded for the active running job.");
    }
    const nextProgress = normalizeProgress(current.progress, progress);
    writeJsonAtomic(this.#jobPath, JobRecordSchema.parse({
      ...current,
      progress: nextProgress,
      updatedAt: new Date().toISOString()
    }));
  }

  markDurableCheckpoint(checkpointId: string): void {
    if (!checkpointId) throw new Error("A durable checkpoint id is required.");
    const current = readJobRecordAtPath(this.#jobPath);
    if (!current) {
      throw new Error("The active Job record is unavailable at the durable publication boundary.");
    }
    if (this.signal.aborted || current.state === "cancel_requested" || current.state === "cancelled") {
      const safeCheckpointId = current.cancellation?.safeCheckpointId ?? this.#durableCheckpointId;
      throw new JobCancellationError({
        durableWritesApplied: current.cancellation?.durableWritesApplied === true || this.#durableWritesApplied,
        ...(safeCheckpointId ? { safeCheckpointId } : {})
      });
    }
    if (current.state !== "running") {
      throw new Error(`Job state ${current.state} cannot enter a durable publication boundary.`);
    }
    const guardedJob = JobRecordSchema.parse({
      ...current,
      cancellation: {
        ...current.cancellation,
        safeCheckpointId: checkpointId,
        durableWritesApplied: true
      },
      updatedAt: new Date().toISOString()
    });
    writeJsonAtomic(this.#jobPath, guardedJob);
    this.#durableWritesApplied = true;
    this.#durableCheckpointId = checkpointId;
    this.throwIfCancellationRequested({
      durableWritesApplied: true,
      safeCheckpointId: checkpointId
    });
  }

  durableWriteState(): JobDurableWriteState {
    return {
      durableWritesApplied: this.#durableWritesApplied,
      ...(this.#durableCheckpointId ? { safeCheckpointId: this.#durableCheckpointId } : {})
    };
  }
}

function normalizeProgress(
  current: JobRecord["progress"],
  update: JobProgressUpdate
): NonNullable<JobRecord["progress"]> {
  const totalUnits = update.totalUnits ?? current?.totalUnits;
  const unit = update.unit ?? current?.unit;
  const messageKey = update.messageKey ?? current?.messageKey;
  if (!Number.isFinite(update.completedUnits) || update.completedUnits < 0) {
    throw new Error("Job progress completed units must be finite and non-negative.");
  }
  if (totalUnits !== undefined && (
    !Number.isFinite(totalUnits) ||
    totalUnits <= 0 ||
    update.completedUnits > totalUnits
  )) {
    throw new Error("Job progress must stay within its positive total-unit bound.");
  }
  if (current && update.completedUnits < current.completedUnits) {
    throw new Error("Job progress must be monotonic.");
  }
  if (
    current?.totalUnits !== undefined &&
    update.totalUnits !== undefined &&
    current.totalUnits !== update.totalUnits
  ) {
    throw new Error("Job progress total units cannot change during one execution.");
  }
  if (current?.unit && update.unit && current.unit !== update.unit) {
    throw new Error("Job progress units cannot change during one execution.");
  }
  return {
    completedUnits: update.completedUnits,
    ...(totalUnits !== undefined ? { totalUnits } : {}),
    ...(unit ? { unit } : {}),
    ...(messageKey ? { messageKey } : {})
  };
}

function completedProgress(
  current: JobRecord["progress"],
  defaultUnit: string
): NonNullable<JobRecord["progress"]> {
  const totalUnits = current?.totalUnits;
  return {
    completedUnits: totalUnits ?? Math.max(current?.completedUnits ?? 0, 1),
    ...(totalUnits !== undefined ? { totalUnits } : {}),
    unit: current?.unit ?? defaultUnit,
    ...(current?.messageKey ? { messageKey: current.messageKey } : {})
  };
}

function resolveCancellation(
  control: JobExecutionControl,
  caught: unknown
): JobCancellationError | undefined {
  try {
    control.throwIfCancellationRequested();
  } catch (cancellation) {
    if (cancellation instanceof JobCancellationError) return cancellation;
  }
  return caught instanceof JobCancellationError ? caught : undefined;
}

function markJobCancellationOutcome(
  filePath: string,
  fallback: JobRecord,
  cancellation: JobCancellationError
): void {
  const current = readJobRecordAtPath(filePath) ?? fallback;
  const finishedAt = new Date().toISOString();
  const durableWritesApplied = current.cancellation?.durableWritesApplied === true || cancellation.durableWritesApplied;
  const safeCheckpointId = cancellation.safeCheckpointId ??
    current.cancellation?.safeCheckpointId ??
    (durableWritesApplied ? undefined : "before_durable_write");
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...current,
    state: durableWritesApplied ? "failed_retryable" : "cancelled",
    updatedAt: finishedAt,
    finishedAt,
    cancellation: {
      ...current.cancellation,
      requestedAt: current.cancellation?.requestedAt ?? finishedAt,
      requestedBy: current.cancellation?.requestedBy ?? "system",
      ...(safeCheckpointId ? { safeCheckpointId } : {}),
      durableWritesApplied
    },
    message: durableWritesApplied
      ? "A retained action-safety guard prevents clean cancellation; the job remains retryable."
      : "Job cancelled at a safe checkpoint. Preserved source data remains in the vault."
  }));
}

function canRunAgentIngest(agentIngest: AgentIngestService | undefined): boolean {
  try {
    return Boolean(agentIngest?.hasDefaultModel());
  } catch {
    return false;
  }
}

function findQueuedCaptureJobFiles(vaultPath: string, request: ProcessQueuedCapturesRequest): { path: string; job: JobRecord }[] {
  const limit = clampLimit(request.limit);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(vaultPath, jobId))
      .filter((jobFile): jobFile is { path: string; job: JobRecord } => Boolean(jobFile))
      .filter((jobFile) => jobFile.job.class === "capture" && jobFile.job.state === "queued")
      .slice(0, limit);
  }

  return readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter((jobFile) => jobFile.job.class === "capture" && jobFile.job.state === "queued")
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedAgentIngestJobFiles(
  vaultPath: string,
  request: ProcessQueuedAgentIngestRequest
): { path: string; job: JobRecord }[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(vaultPath, jobId))
      .filter((jobFile): jobFile is { path: string; job: JobRecord } => Boolean(jobFile))
      .filter((jobFile) => jobFile.job.class === "agent_ingest" && jobFile.job.state === "queued")
      .filter((jobFile) => sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false))
      .slice(0, limit);
  }

  return readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter((jobFile) => jobFile.job.class === "agent_ingest" && jobFile.job.state === "queued")
    .filter((jobFile) => sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false))
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedParseJobFiles(
  vaultPath: string,
  request: ProcessQueuedParsesRequest
): { path: string; job: JobRecord }[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  const matches = (jobFile: { path: string; job: JobRecord }): boolean =>
    jobFile.job.class === "parse" &&
    jobFile.job.state === "queued" &&
    (sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false));
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(vaultPath, jobId))
      .filter((jobFile): jobFile is { path: string; job: JobRecord } => Boolean(jobFile))
      .filter(matches)
      .slice(0, limit);
  }

  return readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter(matches)
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedOcrJobFiles(
  vaultPath: string,
  request: ProcessQueuedOcrRequest
): { path: string; job: JobRecord }[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  const matches = (jobFile: { path: string; job: JobRecord }): boolean =>
    jobFile.job.class === "ocr" &&
    jobFile.job.state === "queued" &&
    (sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false));
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(vaultPath, jobId))
      .filter((jobFile): jobFile is { path: string; job: JobRecord } => Boolean(jobFile))
      .filter(matches)
      .slice(0, limit);
  }
  return readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter(matches)
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedIndexRebuildJobFiles(
  vaultPath: string,
  request: ProcessQueuedIndexRebuildRequest
): { path: string; job: JobRecord }[] {
  const limit = clampLimit(request.limit);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(vaultPath, jobId))
      .filter((jobFile): jobFile is { path: string; job: JobRecord } => Boolean(jobFile))
      .filter((jobFile) => jobFile.job.class === "index_rebuild" && jobFile.job.state === "queued")
      .slice(0, limit);
  }

  return readJobRecordFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter((jobFile) => jobFile.job.class === "index_rebuild" && jobFile.job.state === "queued")
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_JOB_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_JOB_LIST_LIMIT, Math.floor(limit)));
}

function readJobRecords(root: string): { jobs: JobRecord[]; invalidJobCount: number } {
  if (!fs.existsSync(root)) {
    return { jobs: [], invalidJobCount: 0 };
  }

  const jobs: JobRecord[] = [];
  let invalidJobCount = 0;
  for (const filePath of listJsonFiles(root)) {
    try {
      const parsed = JobRecordSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (parsed.success) {
        jobs.push(parsed.data);
      } else {
        invalidJobCount += 1;
      }
    } catch {
      invalidJobCount += 1;
    }
  }
  return { jobs, invalidJobCount };
}

function readJobRecordFiles(root: string): { path: string; job: JobRecord }[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const jobs: { path: string; job: JobRecord }[] = [];
  for (const filePath of listJsonFiles(root)) {
    try {
      const parsed = JobRecordSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (parsed.success) jobs.push({ path: filePath, job: parsed.data });
    } catch {
      // Invalid records are surfaced through list(); processing skips them.
    }
  }
  return jobs;
}

function readJobRecordFile(vaultPath: string, jobId: string): { path: string; job: JobRecord } | undefined {
  if (!/^job_\d{8}_[a-z0-9]{8,}$/.test(jobId)) return undefined;
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1];
  if (!dateKey) return undefined;
  const jobPath = path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
  if (!fs.existsSync(jobPath)) return undefined;

  try {
    const parsed = JobRecordSchema.safeParse(JSON.parse(fs.readFileSync(jobPath, "utf8")));
    return parsed.success ? { path: jobPath, job: parsed.data } : undefined;
  } catch {
    return undefined;
  }
}

function readJobRecordAtPath(jobPath: string): JobRecord | undefined {
  try {
    const parsed = JobRecordSchema.safeParse(JSON.parse(fs.readFileSync(jobPath, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function listJsonFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

function toJobSummary(vaultPath: string, job: JobRecord): JobSummary {
  const sourceRecord = job.sourceId ? readSourceRecord(vaultPath, job.sourceId) : undefined;
  return {
    id: job.id,
    class: job.class,
    state: job.state,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.sourceId ? { sourceId: job.sourceId } : {}),
    ...(job.captureId ? { captureId: job.captureId } : {}),
    ...(job.conversationEventId ? { conversationEventId: job.conversationEventId } : {}),
    ...(sourceRecord?.kind ? { sourceKind: sourceRecord.kind } : {}),
    ...(sourceRecord ? { sourceDisplayName: sourceRecord.original?.displayName ?? sourceRecord.kind } : {}),
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord | undefined {
  return readSourceRecordFile(vaultPath, sourceId)?.sourceRecord;
}

function readSourceRecordFile(vaultPath: string, sourceId: string): { path: string; sourceRecord: SourceRecord } | undefined {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const relativePath = [".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`].join("/");
  const sourceRecordPath = path.join(vaultPath, ...relativePath.split("/"));
  if (!fs.existsSync(sourceRecordPath)) return undefined;
  try {
    const parsed = SourceRecordSchema.safeParse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
    return parsed.success ? { path: relativePath, sourceRecord: parsed.data } : undefined;
  } catch {
    return undefined;
  }
}

function markJobFailedRetryable(
  filePath: string,
  job: JobRecord,
  message: string,
  durableState?: JobDurableWriteState
): void {
  const current = readJobRecordAtPath(filePath) ?? job;
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...withDurableWriteState(current, durableState),
    state: "failed_retryable",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobWaitingDependency(
  filePath: string,
  job: JobRecord,
  message: string,
  durableState?: JobDurableWriteState
): void {
  const current = readJobRecordAtPath(filePath) ?? job;
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...withDurableWriteState(current, durableState),
    state: "waiting_dependency",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobWaitingPermission(
  filePath: string,
  job: JobRecord,
  message: string,
  durableState?: JobDurableWriteState
): void {
  const current = readJobRecordAtPath(filePath) ?? job;
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...withDurableWriteState(current, durableState),
    state: "waiting_permission",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobFailedFinal(
  filePath: string,
  job: JobRecord,
  message: string,
  durableState?: JobDurableWriteState
): void {
  const current = readJobRecordAtPath(filePath) ?? job;
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...withDurableWriteState(current, durableState),
    state: "failed_final",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function withDurableWriteState(job: JobRecord, state?: JobDurableWriteState): JobRecord {
  const durableWritesApplied = job.cancellation?.durableWritesApplied === true || state?.durableWritesApplied === true;
  if (!durableWritesApplied) return job;
  return JobRecordSchema.parse({
    ...job,
    cancellation: {
      ...job.cancellation,
      ...(state?.safeCheckpointId ? { safeCheckpointId: state.safeCheckpointId } : {}),
      durableWritesApplied: true
    }
  });
}

const AGENT_TOOL_SOURCE_ROLE = "agent_tool_source_revision";
const AGENT_TOOL_INPUT_ROLE = "agent_tool_canonical_input";
const AGENT_TOOL_CATALOG_ROLE = "agent_tool_catalog";
const AGENT_TOOL_CALL_ROLE = "agent_tool_call_provenance";
const MAX_AGENT_TOOL_CALL_PROVENANCE_REFS = 16;

function assertAgentParseToolRequest(parentJob: JobRecord, request: AgentIngestParseToolRequest): void {
  if (
    request.sourceRecord.id !== parentJob.sourceId ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(request.toolId) ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(request.toolVersion) ||
    !isSha256(request.canonicalInputHash) ||
    !isSha256(request.catalogHash) ||
    !isSha256(request.policyHash)
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The Agent parser tool binding is invalid.");
  }
}

function assertAgentOcrToolRequest(parentJob: JobRecord, request: AgentIngestOcrToolRequest): void {
  if (
    request.sourceRecord.id !== parentJob.sourceId ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(request.toolId) ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(request.toolVersion) ||
    !isSha256(request.canonicalInputHash) ||
    !isSha256(request.catalogHash) ||
    !isSha256(request.policyHash)
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The Agent OCR tool binding is invalid.");
  }
}

function ensureAgentParseToolJob(
  vaultPath: string,
  parentJob: JobRecord,
  sourceRecord: SourceRecord,
  request: AgentIngestParseToolRequest,
  state: Extract<JobState, "queued" | "waiting_dependency">
): JobRecord {
  const sourceRevision = sourceInputRevision(sourceRecord);
  const actionDigest = createAgentToolActionDigest({
    identityVersion: 1,
    parentJobId: parentJob.id,
    toolId: request.toolId,
    toolVersion: request.toolVersion,
    sourceId: sourceRecord.id,
    sourceRevision,
    canonicalInputHash: request.canonicalInputHash
  });
  const jobId = createAgentToolJobId(parentJob.id, "parse", actionDigest);
  const provenanceHash = createToolCallProvenanceHash(parentJob.id, request.toolCallId);
  const now = new Date().toISOString();
  const requested = JobRecordSchema.parse({
    id: jobId,
    class: "parse",
    state,
    parentJobId: parentJob.id,
    createdAt: now,
    updatedAt: now,
    sourceId: sourceRecord.id,
    ...(parentJob.captureId ? { captureId: parentJob.captureId } : {}),
    ...(parentJob.conversationEventId ? { conversationEventId: parentJob.conversationEventId } : {}),
    policyContextId: parentJob.policyContextId,
    policyHash: request.policyHash,
    inputRefs: createAgentToolInputRefs({
      sourceRecord,
      sourceRevision,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      canonicalInputHash: request.canonicalInputHash,
      catalogHash: request.catalogHash,
      provenanceHash
    }),
    message: state === "queued"
      ? `Agent selected the bounded ${documentLabel(sourceRecord.kind)} parser tool; durable parse child queued.`
      : `Agent selected ${documentLabel(sourceRecord.kind)} parsing; waiting for the bundled parser capability.`
  });
  return ensureRequiredChildJob(vaultPath, parentJob, requested, (existing) => {
    assertAgentToolChildBinding(existing, requested);
    return JobRecordSchema.parse({
      ...existing,
      inputRefs: mergeAgentToolCallProvenance(existing.inputRefs ?? [], provenanceHash)
    });
  });
}

function ensureAgentOcrToolJob(
  vaultPath: string,
  parentJob: JobRecord,
  sourceRecord: SourceRecord,
  request: AgentIngestOcrToolRequest,
  state: Extract<JobState, "queued" | "waiting_dependency">
): JobRecord {
  const sourceRevision = sourceInputRevision(sourceRecord);
  const actionDigest = createAgentToolActionDigest({
    identityVersion: 1,
    parentJobId: parentJob.id,
    toolId: request.toolId,
    toolVersion: request.toolVersion,
    sourceId: sourceRecord.id,
    sourceRevision,
    canonicalInputHash: request.canonicalInputHash
  });
  const jobId = createAgentToolJobId(parentJob.id, "ocr", actionDigest);
  const provenanceHash = createToolCallProvenanceHash(parentJob.id, request.toolCallId);
  const now = new Date().toISOString();
  const requested = JobRecordSchema.parse({
    id: jobId,
    class: "ocr",
    state,
    parentJobId: parentJob.id,
    createdAt: now,
    updatedAt: now,
    sourceId: sourceRecord.id,
    ...(parentJob.captureId ? { captureId: parentJob.captureId } : {}),
    ...(parentJob.conversationEventId ? { conversationEventId: parentJob.conversationEventId } : {}),
    policyContextId: parentJob.policyContextId,
    policyHash: request.policyHash,
    inputRefs: createAgentToolInputRefs({
      sourceRecord,
      sourceRevision,
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      canonicalInputHash: request.canonicalInputHash,
      catalogHash: request.catalogHash,
      provenanceHash
    }),
    message: state === "queued"
      ? sourceRecord.kind === "image_file"
        ? "Agent selected bounded OCR for the verified preserved image; durable OCR child queued."
        : `Agent selected bounded OCR for parser-verified ${documentLabel(sourceRecord.kind)} targets; durable OCR child queued.`
      : `Agent selected ${documentLabel(sourceRecord.kind)} OCR; waiting for the reviewed local OCR capability.`
  });
  return ensureRequiredChildJob(vaultPath, parentJob, requested, (existing) => {
    assertAgentToolChildBinding(existing, requested);
    return JobRecordSchema.parse({
      ...existing,
      inputRefs: mergeAgentToolCallProvenance(existing.inputRefs ?? [], provenanceHash)
    });
  });
}

function createAgentToolInputRefs(input: {
  readonly sourceRecord: SourceRecord;
  readonly sourceRevision: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly canonicalInputHash: string;
  readonly catalogHash: string;
  readonly provenanceHash: string;
}): NonNullable<JobRecord["inputRefs"]> {
  return [
    {
      kind: "source",
      id: input.sourceRecord.id,
      checksum: input.sourceRevision,
      role: AGENT_TOOL_SOURCE_ROLE
    },
    {
      kind: "tool",
      id: `${input.toolId}@${input.toolVersion}`,
      checksum: input.canonicalInputHash,
      role: AGENT_TOOL_INPUT_ROLE
    },
    {
      kind: "tool",
      id: "pige_agent_tool_catalog",
      checksum: input.catalogHash,
      role: AGENT_TOOL_CATALOG_ROLE
    },
    {
      kind: "tool",
      id: input.toolId,
      checksum: input.provenanceHash,
      role: AGENT_TOOL_CALL_ROLE
    }
  ];
}

function assertAgentToolChildBinding(existing: JobRecord, requested: JobRecord): void {
  if (
    existing.id !== requested.id ||
    existing.class !== requested.class ||
    existing.parentJobId !== requested.parentJobId ||
    existing.sourceId !== requested.sourceId ||
    existing.policyHash !== requested.policyHash
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_changed", "The durable tool child binding changed before reuse.");
  }
  for (const role of [
    AGENT_TOOL_SOURCE_ROLE,
    AGENT_TOOL_INPUT_ROLE,
    AGENT_TOOL_CATALOG_ROLE
  ]) {
    const existingRef = existing.inputRefs?.find((ref) => ref.role === role);
    const requestedRef = requested.inputRefs?.find((ref) => ref.role === role);
    if (
      !existingRef ||
      !requestedRef ||
      existingRef.kind !== requestedRef.kind ||
      existingRef.id !== requestedRef.id ||
      existingRef.checksum !== requestedRef.checksum
    ) {
      throw new PigeDomainError("agent_runtime.tool_binding_changed", "The durable tool child input binding changed before reuse.");
    }
  }
}

function mergeAgentToolCallProvenance(
  refs: NonNullable<JobRecord["inputRefs"]>,
  provenanceHash: string
): NonNullable<JobRecord["inputRefs"]> {
  const provenance = refs.filter((ref) => ref.role === AGENT_TOOL_CALL_ROLE);
  if (provenance.some((ref) => ref.checksum === provenanceHash)) return refs;
  if (provenance.length >= MAX_AGENT_TOOL_CALL_PROVENANCE_REFS) return refs;
  const toolId = refs.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE)?.id?.split("@", 1)[0];
  if (!toolId) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The durable child tool identity is unavailable.");
  }
  return [
    ...refs,
    {
      kind: "tool",
      id: toolId,
      checksum: provenanceHash,
      role: AGENT_TOOL_CALL_ROLE
    }
  ];
}

function createAgentToolActionDigest(input: {
  readonly identityVersion: 1;
  readonly parentJobId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly canonicalInputHash: string;
}): string {
  const canonical = JSON.stringify({
    identityVersion: input.identityVersion,
    parentJobId: input.parentJobId,
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    canonicalInputHash: input.canonicalInputHash
  });
  return createHash("sha256").update("pige:agent-tool-child:v1\0", "utf8").update(canonical, "utf8").digest("hex");
}

function createToolCallProvenanceHash(parentJobId: string, toolCallId: string): string {
  return `sha256:${createHash("sha256")
    .update("pige:pi-tool-call-provenance:v1\0", "utf8")
    .update(parentJobId, "utf8")
    .update("\0", "utf8")
    .update(toolCallId, "utf8")
    .digest("hex")}`;
}

function createAgentToolJobId(
  parentJobId: string,
  jobClass: "parse" | "ocr",
  actionDigest: string
): string {
  return createParserOrOcrJobId(parentJobId, jobClass, actionDigest);
}

function isAgentSelectedParseJob(job: JobRecord): boolean {
  return job.class === "parse" &&
    job.inputRefs?.some((ref) => ref.kind === "tool" && ref.role === AGENT_TOOL_INPUT_ROLE) === true;
}

function isAgentSelectedOcrJob(job: JobRecord): boolean {
  return job.class === "ocr" &&
    job.inputRefs?.some((ref) => ref.kind === "tool" && ref.role === AGENT_TOOL_INPUT_ROLE) === true;
}

function hasWaitingAgentParseChild(vaultPath: string, parent: JobRecord): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(vaultPath, childId)?.job;
    return child?.state === "waiting_dependency" && isAgentSelectedParseJob(child);
  });
}

function hasWaitingAgentOcrChild(vaultPath: string, parent: JobRecord): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(vaultPath, childId)?.job;
    return child?.state === "waiting_dependency" && isAgentSelectedOcrJob(child);
  });
}

function hasCompletedEmptyAgentOcrChild(
  vaultPath: string,
  parent: JobRecord,
  sourceRecord: SourceRecord
): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(vaultPath, childId)?.job;
    return child?.state === "completed_with_warnings" &&
      isAgentSelectedOcrJob(child) &&
      sourceRecord.metadata.ocrJobId === child.id;
  });
}

function bridgeParentAbortToChild(
  jobPath: string,
  controller: AbortController,
  parentSignal: AbortSignal | undefined
): () => void {
  if (!parentSignal) return () => undefined;
  const abort = (): void => {
    const current = readJobRecordAtPath(jobPath);
    if (current?.state === "running") {
      const requestedAt = new Date().toISOString();
      writeJsonAtomic(jobPath, JobRecordSchema.parse({
        ...current,
        state: "cancel_requested",
        updatedAt: requestedAt,
        cancellation: {
          ...current.cancellation,
          requestedAt,
          requestedBy: "system"
        },
        message: current.class === "ocr"
          ? "Parent Agent cancellation requested; stopping the active OCR child."
          : "Parent Agent cancellation requested; stopping the active parser child."
      }));
    }
    controller.abort();
  };
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

function createAgentParseToolExecution(
  child: JobRecord,
  sourceRecord: SourceRecord,
  status: AgentIngestParseToolExecution["status"],
  dependencyCode?: string
): AgentIngestParseToolExecution {
  const parserWarnings = Array.isArray(sourceRecord.metadata.parserWarnings)
    ? sourceRecord.metadata.parserWarnings.filter((value): value is string => typeof value === "string").slice(0, 16)
    : [];
  return {
    status,
    childJobId: child.id,
    sourceRecord,
    artifactIds: sourceRecord.artifacts
      .filter((artifact) => artifact.kind === "extracted_text" || artifact.kind === "metadata")
      .map((artifact) => artifact.id),
    textCharacterCount: safeNonNegativeInteger(sourceRecord.metadata.textCharacterCount),
    textCoverage: typeof sourceRecord.metadata.textCoverage === "string"
      ? sourceRecord.metadata.textCoverage
      : "none",
    needsOcr: sourceRecord.metadata.needsOcr === true,
    agentTextReady: sourceRecord.metadata.agentTextReady === true,
    warnings: parserWarnings,
    ...(dependencyCode ? { dependencyCode } : {})
  };
}

function createAgentOcrToolExecution(
  child: JobRecord,
  sourceRecord: SourceRecord,
  status: AgentIngestOcrToolExecution["status"],
  dependencyCode?: string
): AgentIngestOcrToolExecution {
  const ocrWarnings = Array.isArray(sourceRecord.metadata.ocrWarnings)
    ? sourceRecord.metadata.ocrWarnings.filter((value): value is string => typeof value === "string").slice(0, 16)
    : [];
  const confidence = sourceRecord.metadata.ocrConfidence;
  return {
    status,
    childJobId: child.id,
    sourceRecord,
    artifactIds: sourceRecord.artifacts
      .filter((artifact) => artifact.kind === "ocr" || artifact.kind === "rendered_page" || artifact.kind === "metadata")
      .map((artifact) => artifact.id),
    textCharacterCount: safeNonNegativeInteger(sourceRecord.metadata.ocrTextCharacterCount),
    ...(typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? { confidence }
      : {}),
    agentTextReady: sourceRecord.metadata.agentTextReady === true,
    warnings: ocrWarnings,
    ...(dependencyCode ? { dependencyCode } : {})
  };
}

function safeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function sourceInputRevision(sourceRecord: SourceRecord): string {
  const preservedChecksum = sourceRecord.managedCopy?.checksum ?? sourceRecord.original?.checksum;
  if (preservedChecksum) return preservedChecksum;
  const fallback = JSON.stringify({
    sourceId: sourceRecord.id,
    kind: sourceRecord.kind,
    storageStrategy: sourceRecord.storageStrategy,
    original: sourceRecord.original ? {
      uri: sourceRecord.original.uri,
      lastKnownMtime: sourceRecord.original.lastKnownMtime ?? null,
      lastKnownSize: sourceRecord.original.lastKnownSize ?? null
    } : null,
    managedCopy: sourceRecord.managedCopy ? {
      rootId: sourceRecord.managedCopy.rootId ?? null,
      pathBasis: sourceRecord.managedCopy.pathBasis ?? null,
      size: sourceRecord.managedCopy.size
    } : null
  });
  return `sha256:${createHash("sha256")
    .update("pige:source-input-revision:v1\0", "utf8")
    .update(fallback, "utf8")
    .digest("hex")}`;
}

function isSha256(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function supportsAgentSelectedParser(sourceKind: SourceKind): boolean {
  return sourceKind === "pdf_file" || sourceKind === "docx_file" || sourceKind === "pptx_file";
}

function supportsAgentSelectedOcr(sourceKind: SourceKind): boolean {
  return sourceKind === "image_file" || sourceKind === "pdf_file" || sourceKind === "pptx_file";
}

function parserDependencyCode(sourceKind: SourceKind): string {
  if (sourceKind === "docx_file") return "docx_parser_unavailable";
  if (sourceKind === "pptx_file") return "pptx_parser_unavailable";
  return "pdf_parser_unavailable";
}

function ocrDependencyCode(sourceKind: SourceKind): string {
  if (sourceKind === "image_file") return "image_ocr_unavailable";
  return sourceKind === "pptx_file" ? "pptx_ocr_unavailable" : "pdf_ocr_unavailable";
}

function ocrNoReadableEvidenceCode(sourceKind: SourceKind): string {
  if (sourceKind === "image_file") return "image_ocr_no_readable_evidence";
  return sourceKind === "pptx_file" ? "pptx_ocr_no_readable_evidence" : "pdf_ocr_no_readable_evidence";
}

function ensureOcrWaitingJob(
  vaultPath: string,
  parseJob: JobRecord,
  sourceRecord: SourceRecord,
  capability: OcrSourceCapability
): void {
  ensureParserOrOcrFollowUpJob(
    vaultPath,
    parseJob,
    sourceRecord,
    "ocr",
    capability.ready ? "queued" : "waiting_dependency",
    capability.message
  );
}

function ensureParserOrOcrFollowUpJob(
  vaultPath: string,
  parentJob: JobRecord,
  sourceRecord: SourceRecord,
  jobClass: "parse" | "ocr",
  state: JobState,
  message: string
): void {
  const jobId = createParserOrOcrJobId(sourceRecord.id, jobClass);
  const now = new Date().toISOString();
  ensureRequiredChildJob(vaultPath, parentJob, JobRecordSchema.parse({
    id: jobId,
    class: jobClass,
    state,
    parentJobId: parentJob.id,
    createdAt: now,
    updatedAt: now,
    sourceId: sourceRecord.id,
    ...(parentJob.captureId ? { captureId: parentJob.captureId } : {}),
    ...(parentJob.conversationEventId ? { conversationEventId: parentJob.conversationEventId } : {}),
    message
  }));
}

function createParseCompletionMessage(result: {
  readonly textCharacterCount: number;
  readonly textCoverage: string;
  readonly needsOcr: boolean;
  readonly agentTextReady: boolean;
  readonly sourcePageConflict: boolean;
}, sourceKind: SourceKind): string {
  const label = documentLabel(sourceKind);
  if (result.sourcePageConflict) {
    return `${label} text extracted; the edited source page was preserved and requires review before refresh.`;
  }
  if (!result.agentTextReady) {
    return `${label} parser found insufficient embedded text; waiting for OCR before Agent ingest.`;
  }
  if (result.needsOcr) {
    return `${label} text extracted (${result.textCharacterCount} characters, ${result.textCoverage} coverage); image-heavy or text-sparse content is waiting for OCR enrichment.`;
  }
  return `${label} text extracted (${result.textCharacterCount} characters, ${result.textCoverage} coverage).`;
}

function createOcrCompletionMessage(result: {
  readonly textCharacterCount: number;
  readonly confidence?: number;
  readonly agentTextReady: boolean;
  readonly sourcePageConflict: boolean;
}, sourceKind: SourceKind): string {
  const label = sourceKind === "pdf_file"
    ? "PDF page OCR"
    : sourceKind === "pptx_file"
      ? "PPTX media OCR"
      : "Image OCR";
  if (result.sourcePageConflict) {
    return `${label} completed; the edited source page was preserved and requires review before refresh.`;
  }
  if (!result.agentTextReady) {
    return `${label} completed without readable text. The preserved source remains available.`;
  }
  if (sourceKind === "pdf_file" && result.textCharacterCount === 0) {
    return "PDF page OCR enrichment completed without additional text; verified native PDF text remains ready for Agent ingest.";
  }
  return `${label} extracted ${result.textCharacterCount} characters${result.confidence !== undefined ? ` at confidence ${result.confidence.toFixed(3)}` : ""}.`;
}

function inspectOcrSource(ocr: OcrPort | undefined, sourceRecord: SourceRecord): OcrSourceCapability {
  if (!ocr) {
    return {
      ready: false,
      message: createOcrDependencyMessage(sourceRecord.kind)
    };
  }
  if (ocr.inspectSource) return ocr.inspectSource(sourceRecord);
  return ocr.canOcr(sourceRecord.kind)
    ? { ready: true, message: `${documentLabel(sourceRecord.kind)} local OCR job queued.` }
    : { ready: false, message: createOcrDependencyMessage(sourceRecord.kind) };
}

function shouldWaitForRunnableOcr(ocr: OcrPort | undefined, sourceRecord: SourceRecord): boolean {
  if (sourceRecord.metadata.needsOcr !== true) return false;
  if (sourceRecord.metadata.agentTextReady !== true) return true;
  return inspectOcrSource(ocr, sourceRecord).ready;
}

function createAgentOcrWaitMessage(sourceRecord: SourceRecord): string {
  const label = documentLabel(sourceRecord.kind);
  return sourceRecord.metadata.agentTextReady === true
    ? `Waiting for selected ${label} OCR enrichment before Agent ingest.`
    : `Waiting for readable ${label} OCR evidence before Agent ingest.`;
}

function sourceRecordRevision(sourceRecord: SourceRecord): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sourceRecord), "utf8").digest("hex")}`;
}

function createOcrDependencyMessage(sourceKind: SourceKind): string {
  if (sourceKind === "image_file") {
    return "Image source preserved; waiting for local OCR capability from a healthy platform helper.";
  }
  return `${documentLabel(sourceKind)} OCR is waiting for a reviewed page, slide, or media pixel materializer.`;
}

function ocrFailure(caught: unknown, sourceKind: SourceKind): { readonly final: boolean; readonly waiting: boolean; readonly message: string } {
  const label = documentLabel(sourceKind);
  if (caught instanceof PigeDomainError) {
    if (
      /^ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)$/u.test(caught.code) ||
      caught.code === "parser.pdf_page_renderer.unavailable" ||
      caught.code === "ocr.pptx.target_not_ready"
    ) {
      return { final: false, waiting: true, message: `Waiting for a healthy local OCR capability before retrying this preserved ${label}.` };
    }
    if (caught.code === "source.external_unavailable") {
      return { final: false, waiting: true, message: `Waiting for the referenced original ${label} to be reconnected before local OCR can continue.` };
    }
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be processed safely in its current form. Re-import it to create a verified source version.` };
    }
    if (/^parser\.pdf_page_renderer\.(?:invalid_request|invalid_page|file_too_large|password_required|invalid_pdf|page_out_of_range)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The preserved PDF cannot be rendered safely for OCR in its current form. Re-import or replace it with a supported PDF." };
    }
    if (/^ocr\.pdf\.(?:parser_metadata_invalid|source_record_invalid|render_result_invalid|rendered_page_invalid|rendered_pages_too_large|result_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The verified PDF OCR target or derived page data failed validation. Re-parse or re-import the preserved PDF before retrying." };
    }
    if (/^ocr\.pptx\.(?:parser_metadata_invalid|source_record_invalid|media_target_invalid|media_target_changed|materializer_result_invalid|result_invalid|invalid_archive|duplicate_entry|expanded_too_large|media_too_large)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: "The verified PPTX OCR target or embedded media failed validation. Re-parse or re-import the preserved presentation before retrying." };
    }
    if (sourceKind === "pptx_file" && isDeterministicParserInputFailure(caught.code)) {
      return { final: true, waiting: false, message: "The preserved PPTX media cannot be materialized safely. Re-import it to create a verified source version." };
    }
    if (/^ocr\.(?:source_checksum_mismatch|source_unavailable|source_unsupported|path_outside_vault|image\.(?:source_missing|not_regular|file_too_large|invalid|unsupported_format|multiframe_unsupported|dimensions_invalid|dimensions_too_large|decode_failed))$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be processed safely in its current form. Re-import it to create a verified source version.` };
    }
  }
  return { final: false, waiting: false, message: `Local OCR failed for this ${label}. The preserved source and validated artifacts remain retryable.` };
}

function isOcrCapabilityUnavailableError(caught: unknown): boolean {
  return caught instanceof PigeDomainError && (
    /^ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)$/u.test(caught.code) ||
    caught.code === "parser.pdf_page_renderer.unavailable" ||
    caught.code === "ocr.pptx.target_not_ready"
  );
}

function parseFailure(caught: unknown, sourceKind: SourceKind): { readonly final: boolean; readonly waiting: boolean; readonly message: string } {
  const label = documentLabel(sourceKind);
  if (caught instanceof PigeDomainError) {
    if (caught.code === "parser.pdf.password_required") {
      return { final: true, waiting: false, message: "Encrypted PDF requires a password. The preserved source remains available, but password input is not supported yet." };
    }
    if (caught.code === "parser.docx.encrypted" || caught.code === "parser.pptx.encrypted") {
      return { final: true, waiting: false, message: `Encrypted ${label} files are not supported. The preserved source remains available.` };
    }
    if (isDeterministicParserInputFailure(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be parsed safely in its current form. The source record and original bytes remain available.` };
    }
    if (caught.code === "parser.source_checksum_mismatch") {
      return { final: true, waiting: false, message: `The preserved ${label} changed after capture. Re-import it to create a verified source version.` };
    }
    if (caught.code === "source.external_unavailable") {
      return { final: false, waiting: true, message: `The referenced original ${label} is unavailable. Reconnect it before retrying this job.` };
    }
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be verified safely. Re-import it to create a new source version.` };
    }
  }
  return { final: false, waiting: false, message: `${label} parsing failed. Preserved source and validated partial artifacts remain retryable.` };
}

function isDeterministicParserInputFailure(code: string): boolean {
  return /^(?:parser\.(?:pdf|docx|pptx)\.(?:file_too_large|invalid|invalid_archive|invalid_output|required_part_missing|too_many_entries|duplicate_entry|duplicate_relationship|unsafe_entry|unsafe_relationship|invalid_entry_size|encrypted|unsupported_compression|entry_too_large|expanded_too_large|suspicious_compression|xml_part_too_large|selected_xml_too_large|doctype_not_allowed|invalid_xml)|parser\.(?:path_outside_vault|source_unavailable))$/u.test(code);
}

function documentLabel(sourceKind: SourceKind): string {
  if (sourceKind === "docx_file") return "DOCX";
  if (sourceKind === "pptx_file") return "PPTX";
  return "PDF";
}

function ensureAgentIngestJob(vaultPath: string, parentJob: JobRecord, sourceId: string, canRun: boolean): void {
  const jobId = createAgentIngestJobId(sourceId);
  const nextState: JobState = canRun ? "queued" : "waiting_dependency";
  const nextMessage = canRun
    ? "Source page ready; Agent ingest queued."
    : "Source page ready; waiting for a tested default model before Agent ingest.";
  const now = new Date().toISOString();
  const jobRecord = JobRecordSchema.parse({
    id: jobId,
    class: "agent_ingest",
    state: nextState,
    parentJobId: parentJob.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    ...(parentJob.captureId ? { captureId: parentJob.captureId } : {}),
    ...(parentJob.conversationEventId ? { conversationEventId: parentJob.conversationEventId } : {}),
    message: nextMessage
  });
  ensureRequiredChildJob(
    vaultPath,
    parentJob,
    jobRecord,
    (existing) => existing.state === "waiting_dependency" && canRun
      ? JobRecordSchema.parse({
          ...existing,
          state: nextState,
          updatedAt: new Date().toISOString(),
          message: nextMessage
        })
      : existing
  );
}

function ensureRequiredChildJob(
  vaultPath: string,
  parentJob: JobRecord,
  requestedChild: JobRecord,
  reconcileExisting: (existing: JobRecord) => JobRecord = (existing) => existing
): JobRecord {
  const existing = readJobRecordFile(vaultPath, requestedChild.id);
  let child: JobRecord;
  if (existing) {
    if (
      existing.job.class !== requestedChild.class ||
      existing.job.sourceId !== requestedChild.sourceId
    ) {
      throw new Error("A deterministic required child Job conflicts with its persisted identity.");
    }
    child = JobRecordSchema.parse({
      ...reconcileExisting(existing.job),
      parentJobId: existing.job.parentJobId ?? parentJob.id
    });
    if (JSON.stringify(child) !== JSON.stringify(existing.job)) {
      writeJsonAtomic(existing.path, child);
    }
  } else {
    child = JobRecordSchema.parse({
      ...requestedChild,
      parentJobId: parentJob.id
    });
    const dateKey = /^job_(\d{8})_/.exec(child.id)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const childPath = path.join(
      vaultPath,
      ".pige",
      "jobs",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${child.id}.json`
    );
    writeJsonAtomic(childPath, child);
  }

  const parentFile = readJobRecordFile(vaultPath, parentJob.id);
  if (!parentFile) {
    throw new Error("The required child Job was persisted, but its parent Job is unavailable for linkage.");
  }
  if (!(parentFile.job.childJobIds ?? []).includes(child.id)) {
    writeJsonAtomic(parentFile.path, JobRecordSchema.parse({
      ...parentFile.job,
      childJobIds: Array.from(new Set([...(parentFile.job.childJobIds ?? []), child.id])),
      updatedAt: new Date().toISOString()
    }));
  }
  return child;
}

function createParserOrOcrJobId(
  datedIdentityId: string,
  jobClass: "parse" | "ocr",
  semanticDigest?: string
): string {
  const dateKey = /^(?:src|job)_(\d{8})_/u.exec(datedIdentityId)?.[1] ??
    new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = semanticDigest ?? datedIdentityId.replace(/^(?:src|job)_\d{8}_/u, "");
  return `job_${dateKey}_${suffix.slice(0, 10)}${jobClass === "parse" ? "pa" : "oc"}`;
}

function createAgentIngestJobId(sourceId: string): string {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = sourceId.replace(/^src_\d{8}_/u, "");
  return `job_${dateKey}_${suffix.slice(0, 10)}ag`;
}

function createIndexRebuildJob(vaultPath: string): JobRecord {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
  const jobId = `job_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const jobRecord = JobRecordSchema.parse({
    id: jobId,
    class: "index_rebuild",
    state: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    message: "Index rebuild queued."
  });
  const jobPath = path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
  writeJsonAtomic(jobPath, jobRecord);
  return jobRecord;
}

function appendLog(vaultPath: string, line: string): void {
  fs.appendFileSync(path.join(vaultPath, "log.md"), `- ${line}\n`, "utf8");
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true });
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    flushDirectoryWhereSupported(directoryPath);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative write failure.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the authoritative write result.
    }
  }
}

function flushDirectoryWhereSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFlush(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A directory-handle cleanup failure must not replace the durable write result.
      }
    }
  }
}

function isUnsupportedDirectoryFlush(value: unknown): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  if (new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]).has(code)) return true;
  return process.platform === "win32" && new Set(["EACCES", "EISDIR", "EPERM"]).has(code);
}
