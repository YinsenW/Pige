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
  type JobState,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import { AgentIngestService } from "./agent-ingest-service";
import type { DocumentParserPort } from "./document-parser-service";
import { SourcePageService } from "./source-page-service";
import type { LocalDatabaseService } from "./local-database-service";
import type { OcrPort, OcrSourceCapability } from "./ocr-service";

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
}

export interface ProcessQueuedOcrResult extends ProcessQueuedCapturesResult {
  readonly agentReadySourceIds: readonly string[];
}

const DEFAULT_JOB_LIST_LIMIT = 20;
const MAX_JOB_LIST_LIMIT = 100;
const CANCELABLE_STATES = new Set<JobState>(["queued", "waiting_dependency", "waiting_permission", "failed_retryable"]);
const RETRYABLE_STATES = new Set<JobState>(["failed_retryable", "waiting_dependency", "cancelled"]);

export class JobsService {
  readonly #vaults: JobsVaultPort;
  readonly #sourcePages: SourcePageService;
  readonly #agentIngest: AgentIngestService | undefined;
  readonly #database: LocalDatabaseService | undefined;
  readonly #documentParser: DocumentParserPort | undefined;
  readonly #ocr: OcrPort | undefined;

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

    if (!CANCELABLE_STATES.has(jobFile.job.state)) {
      return {
        status: "not_allowed",
        reason: `Job state ${jobFile.job.state} cannot be cancelled.`,
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    const updatedJob = JobRecordSchema.parse({
      ...jobFile.job,
      state: "cancelled",
      updatedAt: new Date().toISOString(),
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

    const updatedJob = JobRecordSchema.parse({
      ...jobFile.job,
      state: "queued",
      updatedAt: new Date().toISOString(),
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
      if (sourceRecord && shouldWaitForPdfOcr(this.#ocr, sourceRecord)) continue;
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

  requestIndexRebuild(): LocalDatabaseRebuildResult {
    const vaultPath = this.#requireActiveVaultPath();
    const job = createIndexRebuildJob(vaultPath);
    const result = this.processQueuedIndexRebuild({ jobIds: [job.id] });
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
      try {
        const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
        if (!sourceRecordFile) {
          markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved job remains retryable.");
          failed += 1;
          continue;
        }

        const page = this.#sourcePages.createForSource(vaultPath, sourceRecordFile.sourceRecord, sourceRecordFile.path, jobFile.job.id);
        const updatedJob = JobRecordSchema.parse({
          ...jobFile.job,
          state: "completed",
          updatedAt: new Date().toISOString(),
          message: page.created ? "Source page created from preserved source." : "Source page already exists for preserved source."
        });
        writeJsonAtomic(jobFile.path, updatedJob);
        if (needsParserOrOcr(sourceRecordFile.sourceRecord.kind)) {
          ensureParserOrOcrJob(
            vaultPath,
            updatedJob,
            sourceRecordFile.sourceRecord,
            Boolean(this.#documentParser?.canParse(sourceRecordFile.sourceRecord.kind)),
            inspectOcrSource(this.#ocr, sourceRecordFile.sourceRecord)
          );
        } else {
          ensureAgentIngestJob(vaultPath, updatedJob, sourceRecordFile.sourceRecord.id, canRunAgentIngest(this.#agentIngest));
        }
        appendLog(vaultPath, `${new Date().toISOString()} Created source page [${page.title}](${page.pagePath}) for source \`${jobFile.job.sourceId}\`.`);
        completed += 1;
      } catch {
        markJobFailedRetryable(jobFile.path, jobFile.job, "Source page creation failed. Preserved source remains retryable.");
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

      const runningJob = JobRecordSchema.parse({
        ...jobFile.job,
        state: "running",
        updatedAt: new Date().toISOString(),
        message: "Extracting document text in the local parser worker."
      });
      writeJsonAtomic(jobFile.path, runningJob);

      try {
        const result = await parser.parseSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          runningJob
        );
        const hasWarnings = result.needsOcr || result.sourcePageConflict || result.warnings.length > 0;
        const completedJob = JobRecordSchema.parse({
          ...runningJob,
          state: hasWarnings ? "completed_with_warnings" : "completed",
          updatedAt: new Date().toISOString(),
          message: createParseCompletionMessage(result, sourceRecordFile.sourceRecord.kind)
        });
        const refreshedSource = readSourceRecord(vaultPath, sourceRecordFile.sourceRecord.id) ?? sourceRecordFile.sourceRecord;
        let ocrCapability: OcrSourceCapability | undefined;
        if (result.needsOcr) {
          ocrCapability = inspectOcrSource(this.#ocr, refreshedSource);
          ensureOcrWaitingJob(
            vaultPath,
            completedJob,
            refreshedSource,
            ocrCapability
          );
          ocrWaitingSourceIds.push(refreshedSource.id);
        }
        if (
          result.extractedTextArtifactPath &&
          result.agentTextReady &&
          (!result.needsOcr || ocrCapability?.ready !== true)
        ) {
          ensureAgentIngestJob(vaultPath, completedJob, refreshedSource.id, canRunAgentIngest(this.#agentIngest));
          agentReadySourceIds.push(refreshedSource.id);
        }
        appendLog(
          vaultPath,
          `${new Date().toISOString()} Parsed ${documentLabel(refreshedSource.kind)} source \`${refreshedSource.id}\`: ${result.textCharacterCount} text characters, coverage ${result.textCoverage}.${result.needsOcr ? " OCR enrichment is waiting." : ""}`
        );
        writeJsonAtomic(jobFile.path, completedJob);
        completed += 1;
      } catch (caught) {
        const failure = parseFailure(caught, sourceRecordFile.sourceRecord.kind);
        if (failure.waiting) {
          markJobWaitingDependency(jobFile.path, runningJob, failure.message);
        } else if (failure.final) {
          markJobFailedFinal(jobFile.path, runningJob, failure.message);
        } else {
          markJobFailedRetryable(jobFile.path, runningJob, failure.message);
        }
        failed += 1;
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
      const ocr = this.#ocr;
      const capability = inspectOcrSource(ocr, sourceRecordFile.sourceRecord);
      if (!ocr || !capability.ready) {
        if (sourceRecordFile.sourceRecord.metadata.agentTextReady === true) {
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

      const runningJob = JobRecordSchema.parse({
        ...jobFile.job,
        state: "running",
        updatedAt: new Date().toISOString(),
        message: sourceRecordFile.sourceRecord.kind === "pdf_file"
          ? "Rendering verified PDF page targets and recognizing them with local OCR."
          : "Recognizing image text with the local platform OCR helper."
      });
      writeJsonAtomic(jobFile.path, runningJob);

      try {
        const result = await ocr.ocrSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          runningJob
        );
        const hasWarnings = !result.agentTextReady || result.sourcePageConflict || result.warnings.length > 0;
        const completedJob = JobRecordSchema.parse({
          ...runningJob,
          state: hasWarnings ? "completed_with_warnings" : "completed",
          updatedAt: new Date().toISOString(),
          message: createOcrCompletionMessage(result, sourceRecordFile.sourceRecord.kind)
        });
        if (result.agentTextReady) {
          ensureAgentIngestJob(vaultPath, completedJob, sourceRecordFile.sourceRecord.id, canRunAgentIngest(this.#agentIngest));
          agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
        }
        appendLog(
          vaultPath,
          `${new Date().toISOString()} OCR processed ${documentLabel(sourceRecordFile.sourceRecord.kind)} source \`${sourceRecordFile.sourceRecord.id}\`: ${result.textCharacterCount} text characters.${result.confidence !== undefined ? ` confidence ${result.confidence.toFixed(3)}.` : ""}`
        );
        writeJsonAtomic(jobFile.path, completedJob);
        completed += 1;
      } catch (caught) {
        const failure = ocrFailure(caught, sourceRecordFile.sourceRecord.kind);
        if (failure.waiting) {
          if (
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
          markJobWaitingDependency(jobFile.path, runningJob, failure.message);
        } else if (failure.final) {
          markJobFailedFinal(jobFile.path, runningJob, failure.message);
        } else {
          markJobFailedRetryable(jobFile.path, runningJob, failure.message);
        }
        failed += 1;
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
      if (shouldWaitForPdfOcr(this.#ocr, sourceRecordFile.sourceRecord)) {
        markJobWaitingDependency(
          jobFile.path,
          jobFile.job,
          sourceRecordFile.sourceRecord.metadata.agentTextReady === true
            ? "Waiting for selected PDF OCR enrichment before Agent ingest."
            : "Waiting for readable PDF OCR evidence before Agent ingest."
        );
        failed += 1;
        continue;
      }
      const sourceRevision = sourceRecordRevision(sourceRecordFile.sourceRecord);

      let activeJob = jobFile.job;
      try {
        const runningJob = JobRecordSchema.parse({
          ...jobFile.job,
          state: "running",
          updatedAt: new Date().toISOString(),
          message: "Agent ingest is generating a wiki note."
        });
        activeJob = runningJob;
        writeJsonAtomic(jobFile.path, runningJob);

        const result = await agentIngest.ingestSource(vaultPath, sourceRecordFile.sourceRecord, activeJob, {
          onPolicyResolved: (snapshot) => {
            activeJob = JobRecordSchema.parse({
              ...activeJob,
              policyContextId: snapshot.policyContextId,
              policyHash: snapshot.policyHash,
              updatedAt: new Date().toISOString(),
              message: "Agent ingest policy and model-egress gates resolved before provider access."
            });
            writeJsonAtomic(jobFile.path, activeJob);
          },
          onEgressRecorded: (operationId) => {
            activeJob = JobRecordSchema.parse({
              ...activeJob,
              operationIds: Array.from(new Set([...(activeJob.operationIds ?? []), operationId])),
              updatedAt: new Date().toISOString()
            });
            writeJsonAtomic(jobFile.path, activeJob);
          },
          assertSourceCurrent: () => {
            const currentSource = activeJob.sourceId ? readSourceRecord(vaultPath, activeJob.sourceId) : undefined;
            if (
              !currentSource ||
              sourceRecordRevision(currentSource) !== sourceRevision ||
              shouldWaitForPdfOcr(this.#ocr, currentSource)
            ) {
              throw new PigeDomainError(
                "agent_ingest.source_changed",
                "The selected source evidence changed while Agent ingest was running."
              );
            }
          }
        });
        const updatedJob = JobRecordSchema.parse({
          ...activeJob,
          state: result.reviewRequired ? "completed_with_warnings" : "completed",
          updatedAt: new Date().toISOString(),
          operationIds: Array.from(new Set([...(activeJob.operationIds ?? []), ...result.operationIds])),
          message: result.reviewRequired
            ? "Agent ingest created a wiki note that needs review."
            : result.created ? "Agent ingest created a wiki note." : "Agent ingest wiki note already exists."
        });
        writeJsonAtomic(jobFile.path, updatedJob);
        const warningSuffix = result.reviewRequired ? " Review is needed before treating it as clean knowledge." : "";
        appendLog(vaultPath, `${new Date().toISOString()} Created wiki note [${result.title}](${result.pagePath}) from source \`${activeJob.sourceId}\`.${warningSuffix}`);
        completed += 1;
      } catch (caught) {
        if (caught instanceof PigeDomainError && caught.code === "model_provider.default_model_missing") {
          markJobWaitingDependency(jobFile.path, activeJob, "Waiting for a tested default model before Agent ingest.");
        } else if (caught instanceof PigeDomainError && caught.code === "source.external_unavailable") {
          markJobWaitingDependency(jobFile.path, activeJob, "Waiting for the referenced original source to be reconnected before Agent ingest can continue.");
        } else if (caught instanceof PigeDomainError && /^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
          markJobFailedFinal(jobFile.path, activeJob, "The source cannot be verified safely. Re-import it to create a new source version before Agent ingest.");
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.confirmation_required") {
          markJobWaitingPermission(jobFile.path, activeJob, "Waiting for explicit approval before selected evidence is sent to the configured model service.");
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.blocked") {
          markJobFailedFinal(jobFile.path, activeJob, "Model egress is blocked by the current privacy policy; the preserved source remains local.");
        } else if (caught instanceof PigeDomainError && caught.code === "agent_ingest.source_changed") {
          const currentSource = activeJob.sourceId ? readSourceRecord(vaultPath, activeJob.sourceId) : undefined;
          if (currentSource && shouldWaitForPdfOcr(this.#ocr, currentSource)) {
            markJobWaitingDependency(
              jobFile.path,
              activeJob,
              "Source evidence changed while Agent ingest was running; waiting for PDF OCR enrichment before retry."
            );
          } else {
            writeJsonAtomic(jobFile.path, JobRecordSchema.parse({
              ...activeJob,
              state: "queued",
              updatedAt: new Date().toISOString(),
              message: "Source evidence changed while Agent ingest was running; ingest requeued with the latest evidence."
            }));
          }
        } else {
          markJobFailedRetryable(jobFile.path, activeJob, "Agent ingest failed. Preserved source and source page remain retryable.");
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

  processQueuedIndexRebuild(request: ProcessQueuedIndexRebuildRequest = {}): ProcessQueuedIndexRebuildResult {
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

      const runningJob = JobRecordSchema.parse({
        ...jobFile.job,
        state: "running",
        updatedAt: new Date().toISOString(),
        message: "Rebuilding local database index from Markdown."
      });
      writeJsonAtomic(jobFile.path, runningJob);

      try {
        const rebuild = database.rebuild(vaultPath);
        if (!rebuild) {
          markJobFailedRetryable(jobFile.path, runningJob, "Local database rebuild is unavailable. Index rebuild remains retryable.");
          failed += 1;
          continue;
        }

        const completedJob = JobRecordSchema.parse({
          ...runningJob,
          state: "completed",
          updatedAt: new Date().toISOString(),
          message: `Index rebuilt from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`
        });
        writeJsonAtomic(jobFile.path, completedJob);
        appendLog(vaultPath, `${new Date().toISOString()} Rebuilt local database index from Markdown: ${rebuild.pageCount} pages, ${rebuild.invalidPageCount} invalid pages skipped.`);
        lastRebuild = { ...rebuild, jobId: runningJob.id, state: "completed" };
        completed += 1;
      } catch {
        markJobFailedRetryable(jobFile.path, runningJob, "Index rebuild failed. Markdown knowledge remains intact and the job is retryable.");
        failed += 1;
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

function markJobFailedRetryable(filePath: string, job: JobRecord, message: string): void {
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...job,
    state: "failed_retryable",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobWaitingDependency(filePath: string, job: JobRecord, message: string): void {
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...job,
    state: "waiting_dependency",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobWaitingPermission(filePath: string, job: JobRecord, message: string): void {
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...job,
    state: "waiting_permission",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function markJobFailedFinal(filePath: string, job: JobRecord, message: string): void {
  writeJsonAtomic(filePath, JobRecordSchema.parse({
    ...job,
    state: "failed_final",
    updatedAt: new Date().toISOString(),
    message
  }));
}

function needsParserOrOcr(sourceKind: SourceKind): boolean {
  return sourceKind === "pdf_file" ||
    sourceKind === "docx_file" ||
    sourceKind === "pptx_file" ||
    sourceKind === "image_file";
}

function ensureParserOrOcrJob(
  vaultPath: string,
  captureJob: JobRecord,
  sourceRecord: SourceRecord,
  parserCanRun: boolean,
  ocrCapability: OcrSourceCapability
): void {
  const jobClass: JobClass = sourceRecord.kind === "image_file" ? "ocr" : "parse";
  const canRun = jobClass === "parse" ? parserCanRun : ocrCapability.ready;
  const state: JobState = canRun ? "queued" : "waiting_dependency";
  const message = jobClass === "ocr"
    ? ocrCapability.message
    : parserCanRun
      ? "Document source preserved; local parser job queued."
      : "Document source preserved; waiting for local parser capability before text extraction.";
  ensureParserOrOcrFollowUpJob(vaultPath, captureJob, sourceRecord, jobClass, state, message);
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
  const existing = readJobRecordFile(vaultPath, jobId);
  if (existing) return;
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const jobPath = path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
  writeJsonAtomic(jobPath, JobRecordSchema.parse({
    id: jobId,
    class: jobClass,
    state,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const label = sourceKind === "pdf_file" ? "PDF page OCR" : "Image OCR";
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

function shouldWaitForPdfOcr(ocr: OcrPort | undefined, sourceRecord: SourceRecord): boolean {
  if (sourceRecord.kind !== "pdf_file" || sourceRecord.metadata.needsOcr !== true) return false;
  if (sourceRecord.metadata.agentTextReady !== true) return true;
  return inspectOcrSource(ocr, sourceRecord).ready;
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
      caught.code === "parser.pdf_page_renderer.unavailable"
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
    if (/^ocr\.(?:source_checksum_mismatch|source_unavailable|source_unsupported|path_outside_vault|image\.(?:source_missing|not_regular|file_too_large|invalid|unsupported_format|multiframe_unsupported|dimensions_invalid|dimensions_too_large|decode_failed))$/u.test(caught.code)) {
      return { final: true, waiting: false, message: `The preserved ${label} cannot be processed safely in its current form. Re-import it to create a verified source version.` };
    }
  }
  return { final: false, waiting: false, message: `Local OCR failed for this ${label}. The preserved source and validated artifacts remain retryable.` };
}

function isOcrCapabilityUnavailableError(caught: unknown): boolean {
  return caught instanceof PigeDomainError && (
    /^ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)$/u.test(caught.code) ||
    caught.code === "parser.pdf_page_renderer.unavailable"
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

function ensureAgentIngestJob(vaultPath: string, captureJob: JobRecord, sourceId: string, canRun: boolean): void {
  const jobId = createAgentIngestJobId(sourceId);
  const existing = readJobRecordFile(vaultPath, jobId);
  const nextState: JobState = canRun ? "queued" : "waiting_dependency";
  const nextMessage = canRun
    ? "Source page ready; Agent ingest queued."
    : "Source page ready; waiting for a tested default model before Agent ingest.";

  if (existing) {
    if (existing.job.state === "waiting_dependency" && canRun) {
      writeJsonAtomic(existing.path, JobRecordSchema.parse({
        ...existing.job,
        state: nextState,
        updatedAt: new Date().toISOString(),
        message: nextMessage
      }));
    }
    return;
  }

  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const jobPath = path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
  const jobRecord = JobRecordSchema.parse({
    id: jobId,
    class: "agent_ingest",
    state: nextState,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceId,
    ...(captureJob.captureId ? { captureId: captureJob.captureId } : {}),
    ...(captureJob.conversationEventId ? { conversationEventId: captureJob.conversationEventId } : {}),
    message: nextMessage
  });
  writeJsonAtomic(jobPath, jobRecord);
}

function createParserOrOcrJobId(sourceId: string, jobClass: "parse" | "ocr"): string {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = sourceId.replace(/^src_\d{8}_/u, "");
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}
