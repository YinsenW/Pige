import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  JobActionRequest,
  JobActionResult,
  JobSummary,
  JobsListRequest,
  JobsListResult,
  LocalDatabaseRebuildResult,
  ModelEgressPendingRequest,
  ModelEgressResolveRequest,
  ModelEgressResolveResult,
  PermissionPendingRequest,
  PermissionResolveRequest,
  PermissionResolveResult,
  ProposalDecisionRequest,
  ProposalDecisionResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  JobRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema,
  type ConfirmationProposal,
  type JobClass,
  type JobRecord,
  type JobStage,
  type JobState,
  type PermissionActionLifecycleRecord,
  type PermissionCapability,
  type PigeErrorSummary,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import {
  AgentIngestService,
  createProposalApplyOperationId,
  type AgentIngestDatasetToolExecution,
  type AgentIngestDatasetToolRequest,
  type AgentIngestOcrToolExecution,
  type AgentIngestOcrToolRequest,
  type AgentIngestParseToolExecution,
  type AgentIngestParseToolRequest,
  type AgentIngestPublicationBinding,
  type AgentIngestPublishedResult,
  type AgentIngestProposalBinding
} from "./agent-ingest-service";
import type { DocumentParserPort } from "./document-parser-service";
import type { DatasetMaterializerPort } from "./dataset-service";
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
import { ProposalService } from "./proposal-service";
import { AgentTurnConversationStore, type PreservedAgentTurn } from "./agent-turn-conversation-store";
import {
  JobRecordStore,
  type JobRecordSnapshot
} from "./job-record-store";
import {
  ModelEgressApprovalService,
  ModelEgressConfirmationRequiredError
} from "./model-egress-approval-service";
import { PermissionBrokerService } from "./permission-broker-service";
import type { PermissionedExternalJobPort } from "./permissioned-external-capability-service";

type JobRecordFile = JobRecordSnapshot;

export interface JobsVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease?(vaultPath: string): void;
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

export type ProcessQueuedDatasetImportsRequest = ProcessQueuedParsesRequest;
export type ProcessQueuedDatasetImportsResult = ProcessQueuedCapturesResult;

export interface RequeueWaitingAgentIngestResult {
  readonly requeued: number;
}

export type RequeueWaitingParsesResult = RequeueWaitingAgentIngestResult;
export type RequeueWaitingOcrResult = RequeueWaitingAgentIngestResult;

export interface RecoverInterruptedJobsResult {
  readonly requeued: number;
  readonly failedRetryable: number;
}

export interface RecoverProposalDecisionsResult {
  readonly applied: number;
  readonly rejected: number;
  readonly conflicted: number;
  readonly failed: number;
}

export interface CreateRetrievalQueryJobRequest {
  readonly queryHash: string;
}

export interface CreateAgentTurnJobRequest {
  readonly conversationEventId: string;
  readonly conversationLocator: string;
  readonly inputHash: string;
  readonly sourceIds?: readonly string[];
  readonly sourceExpected?: boolean;
}

export interface TextAgentTurnExecution {
  readonly job: JobRecord;
  readonly signal: AbortSignal;
  readonly markDurableCheckpoint: (checkpointId: string) => void;
}

export interface ReconcilePendingAgentTurnSourcesResult {
  readonly linked: number;
  readonly waiting: number;
  readonly failed: number;
}

export interface ReserveAgentTurnUrlSourceRequest {
  readonly toolId: "pige_fetch_url";
  readonly toolVersion: "1";
  readonly inputHash: string;
  readonly catalogHash: string;
  readonly policyHash: string;
  readonly toolCallId: string;
}

export interface AgentTurnUrlSourceLink {
  readonly job: JobRecord;
  readonly sourceId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
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
const CANCELABLE_STATES = new Set<JobState>([
  "queued",
  "waiting_dependency",
  "waiting_permission",
  "waiting_model_egress",
  "failed_retryable"
]);
const RETRYABLE_STATES = new Set<JobState>(["failed_retryable", "waiting_dependency", "cancelled"]);
const COOPERATIVELY_CANCELABLE_CLASSES = new Set<JobClass>([
  "parse",
  "ocr",
  "dataset_import",
  "agent_turn",
  "agent_ingest",
  "index_rebuild"
]);

export class JobsService implements PermissionedExternalJobPort {
  readonly #vaults: JobsVaultPort;
  readonly #sourcePages: SourcePageService;
  readonly #agentIngest: AgentIngestService | undefined;
  readonly #database: LocalDatabaseService | undefined;
  readonly #documentParser: DocumentParserPort | undefined;
  readonly #ocr: OcrPort | undefined;
  readonly #datasets: DatasetMaterializerPort | undefined;
  readonly #modelEgressApprovals: ModelEgressApprovalService | undefined;
  readonly #permissionBroker: PermissionBrokerService | undefined;
  readonly #jobRecordStores = new Map<string, JobRecordStore>();
  readonly #activeExecutions = new Map<string, AbortController>();
  #indexRebuildTail: Promise<void> = Promise.resolve();

  constructor(
    vaults: JobsVaultPort,
    agentIngest?: AgentIngestService,
    database?: LocalDatabaseService,
    documentParser?: DocumentParserPort,
    ocr?: OcrPort,
    datasets?: DatasetMaterializerPort,
    modelEgressApprovals?: ModelEgressApprovalService,
    permissionBroker?: PermissionBrokerService
  ) {
    this.#vaults = vaults;
    this.#sourcePages = new SourcePageService();
    this.#agentIngest = agentIngest;
    this.#database = database;
    this.#documentParser = documentParser;
    this.#ocr = ocr;
    this.#datasets = datasets;
    this.#modelEgressApprovals = modelEgressApprovals;
    this.#permissionBroker = permissionBroker;
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

  summarize(job: JobRecord): JobSummary {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath || job.activeVaultId !== activeVault.vaultId) {
      throw new PigeDomainError("job.binding_changed", "The Job no longer belongs to the active vault.");
    }
    return toJobSummary(vaultPath, job);
  }

  resolveModelEgress(request: ModelEgressResolveRequest): ModelEgressResolveResult {
    const approvals = this.#requireModelEgressApprovals();
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!activeVault) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    const before = approvals.read(vaultPath, request.requestId);
    if (before.vaultId !== activeVault.vaultId || before.jobId !== request.jobId) {
      throw new PigeDomainError("model_egress.approval_stale", "The model egress approval belongs to another vault.");
    }
    const currentSnapshot = this.#readJobSnapshot(vaultPath, before.jobId);
    if (!currentSnapshot) {
      throw new PigeDomainError("model_egress.approval_stale", "The model egress approval Job is unavailable.");
    }
    const sameCommittedDecision =
      (before.state === "approved" && request.decision === "allow_once") ||
      (before.state === "denied" && request.decision === "deny");
    const decisionAlreadyApplied = sameCommittedDecision && (
      (before.state === "approved" &&
        (currentSnapshot.job.state === "queued" || currentSnapshot.job.state === "running") &&
        currentSnapshot.job.error?.modelEgressApprovalRequestId === undefined) ||
      (before.state === "denied" &&
        currentSnapshot.job.state === "failed_final" &&
        currentSnapshot.job.error?.modelEgressApprovalRequestId === before.id)
    );
    if (decisionAlreadyApplied) {
      approvals.releaseDecision(vaultPath, before.id);
      if (before.state === "denied") approvals.markReconciled(vaultPath, before.id);
      return {
        status: before.state === "denied" ? "denied" : "approved",
        requestId: before.id,
        jobId: before.jobId
      };
    }
    if (before.state !== "pending" && !sameCommittedDecision) {
      approvals.commitDecision(vaultPath, request.requestId, request.decision);
    }
    const jobSnapshot = this.#assertModelEgressResolutionCurrent(vaultPath, before, currentSnapshot);
    const resumesLiveInvocation = approvals.hasLiveWaiter(request.requestId);
    const resolved = approvals.commitDecision(vaultPath, request.requestId, request.decision);
    this.#reconcileModelEgressRecord(vaultPath, resolved, resumesLiveInvocation, jobSnapshot);
    approvals.releaseDecision(vaultPath, resolved.id);
    if (resolved.state === "denied") approvals.markReconciled(vaultPath, resolved.id);
    return {
      status: resolved.state === "denied" ? "denied" : "approved",
      requestId: resolved.id,
      jobId: resolved.jobId
    };
  }

  pendingModelEgress(requestId: string): ModelEgressPendingRequest | undefined {
    const approvals = this.#requireModelEgressApprovals();
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!activeVault) return undefined;
    const record = approvals.pending(vaultPath, requestId);
    if (!record || record.vaultId !== activeVault.vaultId || !record.operationId || !record.decisionHash) {
      return undefined;
    }
    const snapshot = this.#readJobSnapshot(vaultPath, record.jobId);
    if (
      !snapshot ||
      snapshot.job.state !== "waiting_model_egress" ||
      snapshot.job.error?.modelEgressApprovalRequestId !== record.id
    ) return undefined;
    return {
      requestId: record.id,
      jobId: record.jobId,
      providerProfileId: record.providerProfileId,
      modelProfileId: record.modelProfileId,
      reasonCode: record.reasonCode,
      contentClasses: record.contentClasses,
      requestedAt: record.createdAt
    };
  }

  resolvePermission(request: PermissionResolveRequest): PermissionResolveResult {
    const broker = this.#requirePermissionBroker();
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!activeVault) throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    const before = broker.read(vaultPath, request.requestId);
    if (before.binding.vaultId !== activeVault.vaultId || before.binding.jobId !== request.jobId) {
      throw new PigeDomainError("permission.request_stale", "The permission request belongs to another vault or Job.");
    }
    const snapshot = this.#readJobSnapshot(vaultPath, before.binding.jobId);
    if (!snapshot) throw new PigeDomainError("permission.request_stale", "The permission request Job is unavailable.");
    const sameCommittedDecision =
      (request.decision === "allow_once" && (before.state === "approved" || before.state === "consumed")) ||
      (request.decision === "deny" && before.state === "denied");
    if (sameCommittedDecision && permissionDecisionApplied(snapshot.job, before)) {
      return {
        status: request.decision === "deny" ? "denied" : "approved",
        requestId: before.id,
        jobId: before.binding.jobId
      };
    }
    if (!sameCommittedDecision) {
      this.#assertPermissionResolutionCurrent(vaultPath, before.id, before.binding.bindingHash);
    }
    const resolved = broker.commitDecision(vaultPath, request);
    const currentSnapshot = this.#readJobSnapshot(vaultPath, resolved.lifecycle.binding.jobId);
    if (!currentSnapshot) throw new PigeDomainError("permission.request_stale", "The permission request Job is unavailable.");
    if (!permissionDecisionApplied(currentSnapshot.job, resolved.lifecycle)) {
      this.#reconcilePermissionRecord(vaultPath, resolved.lifecycle, currentSnapshot);
    }
    return {
      status: resolved.lifecycle.state === "denied" ? "denied" : "approved",
      requestId: resolved.lifecycle.id,
      jobId: resolved.lifecycle.binding.jobId
    };
  }

  pendingPermission(requestId: string): PermissionPendingRequest | undefined {
    const broker = this.#requirePermissionBroker();
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!activeVault) return undefined;
    const record = broker.readOptional(vaultPath, requestId);
    if (!record || record.binding.vaultId !== activeVault.vaultId) return undefined;
    if (record.state === "approved" || record.state === "denied") {
      const snapshot = this.#readJobSnapshot(vaultPath, record.binding.jobId);
      if (snapshot && !permissionDecisionApplied(snapshot.job, record)) {
        this.#reconcilePermissionRecord(vaultPath, record, snapshot);
      }
      return undefined;
    }
    const snapshot = this.#readJobSnapshot(vaultPath, record.binding.jobId);
    if (
      record.state !== "pending" ||
      !snapshot ||
      snapshot.job.state !== "waiting_permission" ||
      snapshot.job.error?.permissionRequestId !== record.id ||
      !jobHasPermissionBinding(snapshot.job, record.id, record.binding.bindingHash)
    ) return undefined;
    return {
      requestId: record.id,
      jobId: record.binding.jobId,
      actorType: record.binding.actorType,
      actorDisplayName: record.actorDisplayName,
      actorVersion: record.binding.actorVersion,
      capability: record.binding.capability,
      dataBoundary: record.binding.dataBoundary,
      actionLabelKey: record.actionLabelKey,
      resourceScope: record.binding.resourceScope,
      resourceKind: record.resourceKind,
      resourceCount: record.resourceCount,
      reasonCode: record.reasonCode,
      createdAt: record.createdAt
    };
  }

  reconcilePermissionActions(): { readonly reconciled: number } {
    const broker = this.#permissionBroker;
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!broker || !activeVault || !vaultPath) return { reconciled: 0 };
    let reconciled = broker.reconcileCommittedDecisions(vaultPath);
    for (const record of broker.listResolvable(vaultPath)) {
      if (record.binding.vaultId !== activeVault.vaultId) continue;
      const snapshot = this.#readJobSnapshot(vaultPath, record.binding.jobId);
      if (!snapshot) continue;
      if (record.state === "consumed") {
        const marker = readPermissionCompletionMarker(snapshot.job, record.id, record.binding.bindingHash);
        if (!record.completionMarkerHash && marker) {
          broker.markCompleted(vaultPath, record.id, record.binding, marker);
          reconciled += 1;
          continue;
        }
        if (record.completionMarkerHash && marker === record.completionMarkerHash) continue;
        if (this.#terminalizeUncertainPermissionAction(record, snapshot)) reconciled += 1;
        continue;
      }
      if (new Set<JobState>([
        "completed",
        "completed_with_warnings",
        "failed_final",
        "cancelled",
        "awaiting_review"
      ]).has(snapshot.job.state)) {
        if (record.state === "pending" || record.state === "approved") {
          broker.cancel(vaultPath, record.id);
          reconciled += 1;
        }
        continue;
      }
      if (record.state === "approved" || record.state === "denied") {
        try {
          if (this.#reconcilePermissionRecord(vaultPath, record, snapshot)) reconciled += 1;
        } catch (caught) {
          if (!(caught instanceof PigeDomainError) || caught.code !== "permission.request_stale") throw caught;
        }
        continue;
      }
    }
    return { reconciled };
  }

  #terminalizeUncertainPermissionAction(
    record: PermissionActionLifecycleRecord,
    snapshot: JobRecordSnapshot
  ): boolean {
    if (!jobHasPermissionBinding(snapshot.job, record.id, record.binding.bindingHash)) {
      throw new PigeDomainError("permission.request_stale", "The consumed permission action lost its Job binding.");
    }
    if (
      snapshot.job.state === "failed_final" &&
      snapshot.job.error?.code === "permission.completion_uncertain" &&
      snapshot.job.error.permissionRequestId === record.id
    ) return false;
    const now = new Date().toISOString();
    const { waitingDependency: _waiting, stage: _stage, ...current } = snapshot.job;
    this.#replaceJob(snapshot, JobRecordSchema.parse({
      ...current,
      state: "failed_final",
      updatedAt: now,
      finishedAt: now,
      cancellation: {
        ...snapshot.job.cancellation,
        durableWritesApplied: true
      },
      error: {
        code: "permission.completion_uncertain",
        domain: "permission",
        messageKey: "errors.permission.completion_uncertain",
        retryable: false,
        severity: "error",
        userAction: "none",
        permissionRequestId: record.id
      },
      retry: {
        retryCount: snapshot.job.retry?.retryCount ?? 0,
        maxAutomaticRetries: 0,
        requiresUserAction: false,
        lastRetryReason: "permission.completion_uncertain"
      },
      message: "The external action completion is uncertain; Pige will not replay it."
    }));
    return true;
  }

  #terminalizeConsumedPermissionCancellation(
    vaultPath: string,
    snapshot: JobRecordSnapshot
  ): string | undefined {
    const requestId = uncompletedConsumedPermissionRequestId(snapshot.job);
    if (!requestId) return undefined;
    const broker = this.#permissionBroker;
    if (!broker) {
      throw new PigeDomainError("permission.store_invalid", "Permission Broker state is unavailable.");
    }
    const record = broker.read(vaultPath, requestId);
    if (record.state !== "consumed" || record.completionMarkerHash) {
      throw new PigeDomainError("permission.request_stale", "The consumed permission action changed.");
    }
    this.#terminalizeUncertainPermissionAction(record, snapshot);
    return requestId;
  }

  #assertPermissionResolutionCurrent(
    vaultPath: string,
    requestId: string,
    bindingHash: string
  ): JobRecordSnapshot {
    const record = this.#requirePermissionBroker().read(vaultPath, requestId);
    const snapshot = this.#readJobSnapshot(vaultPath, record.binding.jobId);
    if (
      !snapshot ||
      snapshot.job.activeVaultId !== record.binding.vaultId ||
      (snapshot.job.class !== "agent_turn" && snapshot.job.class !== "agent_ingest") ||
      snapshot.job.state !== "waiting_permission" ||
      snapshot.job.error?.permissionRequestId !== requestId ||
      !jobHasPermissionBinding(snapshot.job, requestId, bindingHash)
    ) throw new PigeDomainError("permission.request_stale", "The Job no longer waits for this permission request.");
    return snapshot;
  }

  #reconcilePermissionRecord(
    vaultPath: string,
    record: PermissionActionLifecycleRecord,
    expectedSnapshot?: JobRecordSnapshot
  ): boolean {
    const snapshot = expectedSnapshot ?? this.#readJobSnapshot(vaultPath, record.binding.jobId);
    if (!snapshot) throw new PigeDomainError("permission.request_stale", "The permission Job is unavailable.");
    const current = snapshot.job;
    if (
      current.activeVaultId !== record.binding.vaultId ||
      (current.class !== "agent_turn" && current.class !== "agent_ingest")
    ) throw new PigeDomainError("permission.request_stale", "The permission Job binding changed.");
    if (
      new Set<JobState>(["completed", "completed_with_warnings", "failed_final", "cancelled", "awaiting_review"])
        .has(current.state)
    ) return false;
    if (record.state === "approved" && current.state === "queued" && current.error?.permissionRequestId === undefined) {
      return false;
    }
    if (record.state === "denied" && current.state === "failed_final") return false;
    if (
      current.state !== "waiting_permission" ||
      current.error?.permissionRequestId !== record.id ||
      !jobHasPermissionBinding(current, record.id, record.binding.bindingHash)
    ) throw new PigeDomainError("permission.request_stale", "The Job no longer waits for this permission request.");
    if (!record.decisionId) throw new PigeDomainError("permission.request_stale", "The permission decision is unavailable.");

    const now = new Date().toISOString();
    const decisionRef = {
      kind: "tool" as const,
      id: record.decisionId,
      role: "permission_action_decision"
    };
    const privacy = current.privacy ?? {
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: false,
      permissionDecisionIds: []
    };
    if (record.state === "denied") {
      const { waitingDependency: _waiting, stage: _stage, ...rest } = current;
      this.#replaceJob(snapshot, JobRecordSchema.parse({
        ...rest,
        state: "failed_final",
        updatedAt: now,
        finishedAt: now,
        inputRefs: mergeJobRefs(current.inputRefs ?? [], [decisionRef]),
        privacy: {
          ...privacy,
          permissionDecisionIds: Array.from(new Set([...privacy.permissionDecisionIds, record.decisionId]))
        },
        error: {
          code: "permission.denied",
          domain: "permission",
          messageKey: "errors.permission.denied",
          retryable: false,
          severity: "info",
          userAction: "none",
          permissionRequestId: record.id
        },
        retry: {
          retryCount: current.retry?.retryCount ?? 0,
          maxAutomaticRetries: 0,
          requiresUserAction: false,
          lastRetryReason: "permission.denied"
        },
        message: "The exact external action was denied; prior safe output remains available."
      }));
      return true;
    }
    if (record.state !== "approved") return false;
    const { error: _error, waitingDependency: _waiting, stage: _stage, finishedAt: _finished, ...rest } = current;
    this.#replaceJob(snapshot, JobRecordSchema.parse({
      ...rest,
      state: "queued",
      updatedAt: now,
      inputRefs: mergeJobRefs(current.inputRefs ?? [], [decisionRef]),
      privacy: {
        ...privacy,
        permissionDecisionIds: Array.from(new Set([...privacy.permissionDecisionIds, record.decisionId]))
      },
      retry: {
        retryCount: current.retry?.retryCount ?? 0,
        maxAutomaticRetries: 0,
        requiresUserAction: false
      },
      message: "One-use permission approved; the same Agent Job will revalidate before execution."
    }));
    return true;
  }

  bindPermissionRequest(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
  }): void {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, input.jobId);
    if (!snapshot || (snapshot.job.class !== "agent_turn" && snapshot.job.class !== "agent_ingest")) {
      throw new PigeDomainError("permission.request_stale", "The permission request Job is unavailable.");
    }
    if (
      snapshot.job.state === "waiting_permission" &&
      snapshot.job.error?.permissionRequestId === input.requestId &&
      jobHasPermissionBinding(snapshot.job, input.requestId, input.bindingHash)
    ) return;
    if (snapshot.job.state !== "running") {
      throw new PigeDomainError("permission.request_stale", "The permission request Job is not running.");
    }
    const now = new Date().toISOString();
    const permissionRef = createPermissionBindingRef(input.requestId, input.bindingHash);
    const next = JobRecordSchema.parse({
      ...snapshot.job,
      state: "waiting_permission",
      stage: "waiting_for_tool",
      updatedAt: now,
      permissionRequestIds: Array.from(new Set([...(snapshot.job.permissionRequestIds ?? []), input.requestId])),
      inputRefs: mergeJobRefs(snapshot.job.inputRefs ?? [], [permissionRef]),
      checkpoints: upsertPermissionCheckpoint(snapshot.job.checkpoints ?? [], {
        id: permissionCheckpointId(input.requestId),
        step: "permission_authorization",
        state: "not_started",
        inputRefs: [permissionRef],
        outputRefs: [],
        resumeHint: "revalidate_exact_permission_action"
      }),
      error: {
        code: "permission.confirmation_required",
        domain: "permission",
        messageKey: "errors.permission.confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "grant_permission",
        permissionRequestId: input.requestId
      },
      message: "Waiting for one exact current-action permission decision."
    });
    this.#replaceJob(snapshot, next);
  }

  commitPermissionConsumption(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
    readonly decisionId: string;
    readonly capability: PermissionCapability;
  }): void {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, input.jobId);
    if (
      !snapshot ||
      (snapshot.job.class !== "agent_turn" && snapshot.job.class !== "agent_ingest") ||
      snapshot.job.state !== "running" ||
      !jobHasPermissionBinding(snapshot.job, input.requestId, input.bindingHash)
    ) throw new PigeDomainError("permission.request_stale", "The permission action Job binding changed.");
    const now = new Date().toISOString();
    const permissionRef = createPermissionBindingRef(input.requestId, input.bindingHash);
    const decisionRef = {
      kind: "tool" as const,
      id: input.decisionId,
      role: "permission_action_decision"
    };
    const privacy = snapshot.job.privacy ?? {
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: false,
      permissionDecisionIds: []
    };
    this.#replaceJob(snapshot, JobRecordSchema.parse({
      ...snapshot.job,
      updatedAt: now,
      inputRefs: mergeJobRefs(snapshot.job.inputRefs ?? [], [permissionRef, decisionRef]),
      checkpoints: upsertPermissionCheckpoint(snapshot.job.checkpoints ?? [], {
        id: permissionCheckpointId(input.requestId),
        step: "permission_authorization",
        state: "running",
        startedAt: now,
        inputRefs: [permissionRef, decisionRef],
        outputRefs: [],
        resumeHint: "do_not_replay_without_completion_marker"
      }),
      privacy: {
        ...privacy,
        usedNetwork: privacy.usedNetwork || permissionUsesNetwork(input.capability),
        usedShell: privacy.usedShell || input.capability === "run_shell",
        accessedExternalFiles: privacy.accessedExternalFiles || input.capability === "external_filesystem",
        permissionDecisionIds: Array.from(new Set([...privacy.permissionDecisionIds, input.decisionId]))
      },
      cancellation: {
        ...snapshot.job.cancellation,
        durableWritesApplied: true
      },
      message: "One-use permission was consumed before the external action."
    }));
  }

  completePermissionAction(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
    readonly completionMarkerHash: string;
  }): void {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, input.jobId);
    if (
      !snapshot ||
      snapshot.job.state !== "running" ||
      !jobHasPermissionBinding(snapshot.job, input.requestId, input.bindingHash)
    ) throw new PigeDomainError("permission.request_stale", "The permission action completion binding changed.");
    const currentMarker = readPermissionCompletionMarker(snapshot.job, input.requestId, input.bindingHash);
    if (currentMarker) {
      if (currentMarker !== input.completionMarkerHash) {
        throw new PigeDomainError("permission.completion_conflict", "The permission action completion changed.");
      }
      return;
    }
    const now = new Date().toISOString();
    const permissionRef = createPermissionBindingRef(input.requestId, input.bindingHash);
    const completionRef = {
      kind: "tool" as const,
      checksum: input.completionMarkerHash,
      role: "permission_action_completion"
    };
    this.#replaceJob(snapshot, JobRecordSchema.parse({
      ...snapshot.job,
      updatedAt: now,
      outputRefs: mergeJobRefs(snapshot.job.outputRefs ?? [], [completionRef]),
      checkpoints: upsertPermissionCheckpoint(snapshot.job.checkpoints ?? [], {
        id: permissionCheckpointId(input.requestId),
        step: "permission_authorization",
        state: "done",
        startedAt: permissionCheckpoint(snapshot.job, input.requestId)?.startedAt ?? now,
        finishedAt: now,
        inputRefs: [permissionRef],
        outputRefs: [completionRef],
        checksumAfter: input.completionMarkerHash,
        resumeHint: "adopt_completed_permission_action"
      }),
      message: "The permissioned external action completed with a durable body-free marker."
    }));
  }

  readPermissionCompletion(input: {
    readonly jobId: string;
    readonly requestId: string;
    readonly bindingHash: string;
  }): string | undefined {
    const vaultPath = this.#requireActiveVaultPath();
    const job = this.#readJobSnapshot(vaultPath, input.jobId)?.job;
    if (!job || !jobHasPermissionBinding(job, input.requestId, input.bindingHash)) return undefined;
    return readPermissionCompletionMarker(job, input.requestId, input.bindingHash);
  }

  reconcileModelEgressApprovals(): { readonly reconciled: number } {
    const approvals = this.#modelEgressApprovals;
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!approvals || !activeVault || !vaultPath) return { reconciled: 0 };
    let reconciled = 0;
    for (const record of approvals.listResolvable(vaultPath)) {
      if (record.vaultId !== activeVault.vaultId) continue;
      try {
        if (this.#reconcileModelEgressRecord(vaultPath, record)) reconciled += 1;
        if (record.state === "denied" || record.state === "consumed") {
          approvals.markReconciled(vaultPath, record.id);
        }
      } catch (caught) {
        if (!(caught instanceof PigeDomainError) || caught.code !== "model_egress.approval_stale") throw caught;
        if (record.state === "approved") {
          approvals.invalidate(vaultPath, record.id);
        } else if (record.state === "denied" || record.state === "consumed") {
          approvals.markReconciled(vaultPath, record.id);
        }
      }
    }
    return { reconciled };
  }

  #assertModelEgressResolutionCurrent(
    vaultPath: string,
    record: ReturnType<ModelEgressApprovalService["read"]>,
    existingSnapshot?: JobRecordSnapshot
  ): JobRecordSnapshot {
    const snapshot = existingSnapshot ?? this.#readJobSnapshot(vaultPath, record.jobId);
    if (!snapshot) {
      throw new PigeDomainError("model_egress.approval_stale", "The model egress approval Job is unavailable.");
    }
    const current = snapshot.job;
    if (
      current.activeVaultId !== record.vaultId ||
      (current.class !== "agent_turn" && current.class !== "agent_ingest") ||
      current.state !== "waiting_model_egress" ||
      current.error?.modelEgressApprovalRequestId !== record.id
    ) {
      throw new PigeDomainError("model_egress.approval_stale", "The Job no longer waits for this model egress approval.");
    }
    return snapshot;
  }

  #reconcileModelEgressRecord(
    vaultPath: string,
    record: ReturnType<ModelEgressApprovalService["read"]>,
    resumesLiveInvocation = false,
    expectedSnapshot?: JobRecordSnapshot
  ): boolean {
    const snapshot = expectedSnapshot ?? this.#readJobSnapshot(vaultPath, record.jobId);
    if (!snapshot) {
      throw new PigeDomainError("model_egress.approval_stale", "The model egress approval Job is unavailable.");
    }
    const current = snapshot.job;
    if (
      current.activeVaultId !== record.vaultId ||
      (current.class !== "agent_turn" && current.class !== "agent_ingest")
    ) {
      throw new PigeDomainError("model_egress.approval_stale", "The model egress approval Job binding changed.");
    }
    const boundRequestId = current.error?.modelEgressApprovalRequestId;
    const terminalState = new Set<JobState>([
      "completed",
      "completed_with_warnings",
      "failed_final",
      "cancelled",
      "awaiting_review"
    ]).has(current.state);
    if (terminalState) return false;
    const alreadyApproved = record.state === "approved" &&
      (current.state === "queued" || current.state === "running") &&
      boundRequestId === undefined;
    const alreadyDenied = record.state === "denied" && current.state === "failed_final";
    if (alreadyApproved || alreadyDenied) return false;
    if (record.state === "consumed" && current.state === "queued" && boundRequestId === undefined) {
      const message = "A consumed model send could not prove completion; the Job will request fresh one-use approval before replay.";
      if (current.message === message) return false;
      this.#replaceJob(snapshot, JobRecordSchema.parse({
        ...current,
        updatedAt: new Date().toISOString(),
        message
      }));
      return true;
    }
    if (
      boundRequestId !== record.id ||
      !new Set<JobState>(["waiting_model_egress", "failed_retryable"]).has(current.state)
    ) {
      throw new PigeDomainError("model_egress.approval_stale", "The Job no longer waits for this model egress approval.");
    }

    const now = new Date().toISOString();
    if (record.state === "denied") {
      const { waitingDependency: _waiting, stage: _stage, ...rest } = current;
      this.#replaceJob(snapshot, JobRecordSchema.parse({
        ...rest,
        state: "failed_final",
        updatedAt: now,
        finishedAt: now,
        error: {
          code: "model_provider.egress_denied",
          domain: "model_provider",
          messageKey: "errors.model_provider.egress_denied",
          retryable: false,
          severity: "info",
          userAction: "none",
          modelEgressApprovalRequestId: record.id
        },
        retry: {
          retryCount: current.retry?.retryCount ?? 0,
          maxAutomaticRetries: 0,
          requiresUserAction: false,
          lastRetryReason: "model_provider.egress_denied"
        },
        message: "The user denied this exact model send; preserved input and sources remain available."
      }));
      return true;
    }

    const { error: _error, waitingDependency: _waiting, stage: _stage, finishedAt: _finishedAt, ...rest } = current;
    this.#replaceJob(snapshot, JobRecordSchema.parse({
      ...rest,
      state: resumesLiveInvocation ? "running" : "queued",
      updatedAt: now,
      retry: {
        retryCount: current.retry?.retryCount ?? 0,
        maxAutomaticRetries: 0,
        requiresUserAction: false
      },
      message: resumesLiveInvocation
        ? "The exact model send was approved once; the active Agent invocation is resuming."
        : record.state === "consumed"
        ? "A consumed model send could not prove completion; the Job will request fresh one-use approval before replay."
        : "The exact model send was approved once; the same Job is ready to resume."
    }));
    return true;
  }

  async approveProposal(
    proposals: ProposalService,
    request: ProposalDecisionRequest
  ): Promise<ProposalDecisionResult> {
    const current = readProposalForDecision(proposals, request.proposalId);
    if (!current) return { status: "not_found", reason: "Proposal record was not found." };
    if (current.state === "applied") {
      appendProposalApplyLog(this.#requireActiveVaultPath(), current);
      this.#finalizeProposalJob(current, "applied");
      return { status: "applied", proposal: current };
    }
    if (current.state === "conflicted") {
      this.#finalizeConflictedProposalJob(current);
      return { status: "conflicted", proposal: current };
    }
    if (!isSupportedAgentCreateProposal(current)) {
      return {
        status: "not_allowed",
        reason: "Only the current Agent-generated create-note proposal can be applied.",
        proposal: current
      };
    }
    let approved = current;
    if (current.state === "ready") {
      const decision = proposals.approve(request);
      if (decision.status !== "approved" || !decision.proposal) return decision;
      approved = decision.proposal;
    } else if (current.state !== "approved") {
      return {
        status: "not_allowed",
        reason: `Proposal state ${current.state} cannot be approved.`,
        proposal: current
      };
    }
    return this.#applyApprovedProposal(proposals, approved);
  }

  rejectProposal(proposals: ProposalService, request: ProposalDecisionRequest): ProposalDecisionResult {
    const current = readProposalForDecision(proposals, request.proposalId);
    if (!current) return { status: "not_found", reason: "Proposal record was not found." };
    if (current.state === "rejected") {
      if (isSupportedAgentCreateProposal(current)) this.#finalizeProposalJob(current, "rejected");
      return { status: "rejected", proposal: current };
    }
    if (current.state !== "ready") {
      return {
        status: "not_allowed",
        reason: `Proposal state ${current.state} cannot be rejected.`,
        proposal: current
      };
    }
    if (isSupportedAgentCreateProposal(current)) this.#assertProposalParentReady(current);
    const rejected = proposals.reject(request);
    if (
      rejected.status === "rejected" &&
      rejected.proposal &&
      isSupportedAgentCreateProposal(rejected.proposal)
    ) {
      this.#finalizeProposalJob(rejected.proposal, "rejected");
    }
    return rejected;
  }

  async recoverProposalDecisions(proposals: ProposalService): Promise<RecoverProposalDecisionsResult> {
    let applied = 0;
    let rejected = 0;
    let conflicted = 0;
    let failed = 0;
    for (const proposal of proposals.recoveryCandidates()) {
      if (!isSupportedAgentCreateProposal(proposal)) continue;
      try {
        if (proposal.state === "approved") {
          const result = await this.#applyApprovedProposal(proposals, proposal);
          if (result.status === "applied") applied += 1;
          if (result.status === "conflicted") conflicted += 1;
          continue;
        }
        if (proposal.state === "applied") {
          appendProposalApplyLog(this.#requireActiveVaultPath(), proposal);
          this.#finalizeProposalJob(proposal, "applied");
          applied += 1;
          continue;
        }
        if (proposal.state === "rejected") {
          this.#finalizeProposalJob(proposal, "rejected");
          rejected += 1;
          continue;
        }
        if (proposal.state === "conflicted") {
          this.#finalizeConflictedProposalJob(proposal);
          conflicted += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { applied, rejected, conflicted, failed };
  }

  cancel(request: JobActionRequest): JobActionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, request.jobId);
    if (!snapshot) {
      return { status: "not_found", reason: "Job record was not found." };
    }
    const jobFile = { path: snapshot.path, job: snapshot.job };

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
      const committed = this.#replaceJob(snapshot, updatedJob).job;
      controller.abort();
      return {
        status: "cancel_requested",
        job: toJobSummary(vaultPath, committed)
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
    const activeModelEgressApprovals = this.#modelEgressApprovals &&
      (jobFile.job.class === "agent_turn" || jobFile.job.class === "agent_ingest")
      ? this.#modelEgressApprovals.listForJob(vaultPath, jobFile.job.id).filter(
          (record) => record.state === "pending" || record.state === "approved"
        )
      : [];
    const activePermissionRequests = this.#permissionBroker &&
      (jobFile.job.class === "agent_turn" || jobFile.job.class === "agent_ingest")
      ? this.#permissionBroker.listForJob(vaultPath, jobFile.job.id).filter(
          (record) => record.state === "pending" || record.state === "approved"
        )
      : [];
    const committed = this.#replaceJob(snapshot, updatedJob).job;
    this.#activeExecutions.get(jobFile.job.id)?.abort();
    for (const approval of activeModelEgressApprovals) {
      this.#modelEgressApprovals?.invalidate(vaultPath, approval.id);
    }
    for (const request of activePermissionRequests) {
      this.#permissionBroker?.cancel(vaultPath, request.id);
    }
    return {
      status: "cancelled",
      job: toJobSummary(vaultPath, committed)
    };
  }

  retry(request: JobActionRequest): JobActionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, request.jobId);
    if (!snapshot) {
      return { status: "not_found", reason: "Job record was not found." };
    }
    const jobFile = { path: snapshot.path, job: snapshot.job };

    if (!RETRYABLE_STATES.has(jobFile.job.state)) {
      return {
        status: "not_allowed",
        reason: `Job state ${jobFile.job.state} cannot be retried.`,
        job: toJobSummary(vaultPath, jobFile.job)
      };
    }

    if (jobFile.job.class === "retrieval_query") {
      return {
        status: "not_allowed",
        reason: "Submit the Home question again to start a new bounded Agent turn.",
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
    const committed = this.#replaceJob(snapshot, updatedJob).job;
    return {
      status: "requeued",
      job: toJobSummary(vaultPath, committed)
    };
  }

  createRetrievalQueryJob(request: CreateRetrievalQueryJobRequest): JobRecord {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    if (!activeVault || !/^sha256:[a-f0-9]{64}$/u.test(request.queryHash)) {
      throw new PigeDomainError("rag.query_invalid", "The Home query identity is invalid.");
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
    const jobId = `job_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const job = JobRecordSchema.parse({
      id: jobId,
      class: "retrieval_query",
      state: "queued",
      priority: "interactive",
      scope: "vault",
      createdAt: timestamp,
      updatedAt: timestamp,
      activeVaultId: activeVault.vaultId,
      actor: {
        kind: "user",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      inputRefs: [{
        kind: "tool",
        id: "pige_home_query",
        checksum: request.queryHash,
        role: "query_hash"
      }],
      retry: {
        retryCount: 0,
        maxAutomaticRetries: 0,
        requiresUserAction: true
      },
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: false,
        permissionDecisionIds: []
      },
      message: "Home Agent question accepted."
    });
    return this.#createJob(createJobRecordPath(vaultPath, job.id), job);
  }

  createAgentTurnJob(request: CreateAgentTurnJobRequest): JobRecord {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    const timestamp = new Date().toISOString();
    const matchingJobs = readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))
      .filter(({ job }) => job.class === "agent_turn" && job.conversationEventId === request.conversationEventId);
    if (matchingJobs.length > 1) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple Agent Jobs claim one preserved turn.");
    }
    const jobId = matchingJobs[0]?.job.id ?? createAgentTurnJobId(request.conversationEventId);
    const sourceIds = Array.from(new Set(
      request.sourceIds ?? (request.sourceExpected ? [createAgentTurnSourceId(jobId)] : [])
    ));
    if (
      !activeVault ||
      !/^evt_\d{8}_[a-z0-9]{8,}$/u.test(request.conversationEventId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(request.inputHash) ||
      !isConfinedConversationLocator(request.conversationLocator) ||
      sourceIds.length > 1 ||
      (request.sourceExpected === true && sourceIds.length !== 1)
    ) {
      throw new PigeDomainError("agent_runtime.turn_invalid", "The unified Agent turn identity is invalid.");
    }

    const existing = matchingJobs[0];
    if (existing) {
      const conversationRef = existing.job.inputRefs?.find(
        (ref) => ref.kind === "conversation" && ref.role === "agent_turn_user_event"
      );
      const existingSourceIds = Array.from(new Set([
        ...(existing.job.sourceId ? [existing.job.sourceId] : []),
        ...(existing.job.inputRefs ?? [])
          .filter((ref) => ref.kind === "source" && ref.role === "agent_turn_source")
          .flatMap((ref) => ref.id ? [ref.id] : [])
      ]));
      if (
        existing.job.activeVaultId !== activeVault.vaultId ||
        conversationRef?.id !== request.conversationEventId ||
        conversationRef.locator !== request.conversationLocator ||
        conversationRef.checksum !== request.inputHash ||
        existingSourceIds.length !== sourceIds.length ||
        existingSourceIds.some((sourceId, index) => sourceId !== sourceIds[index])
      ) {
        throw new PigeDomainError("agent_runtime.turn_conflict", "The existing Agent Job binding does not match the preserved turn.");
      }
      return existing.job;
    }

    const job = JobRecordSchema.parse({
      id: jobId,
      class: "agent_turn",
      state: request.sourceExpected ? "waiting_dependency" : "queued",
      ...(request.sourceExpected ? { stage: "capturing_source" } : {}),
      priority: "interactive",
      scope: "vault",
      createdAt: timestamp,
      updatedAt: timestamp,
      activeVaultId: activeVault.vaultId,
      actor: {
        kind: "user",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      ...(sourceIds[0] ? { sourceId: sourceIds[0] } : {}),
      conversationEventId: request.conversationEventId,
      inputRefs: [
        {
          kind: "conversation",
          id: request.conversationEventId,
          locator: request.conversationLocator,
          checksum: request.inputHash,
          role: "agent_turn_user_event"
        },
        ...sourceIds.map((sourceId) => ({
          kind: "source" as const,
          id: sourceId,
          role: "agent_turn_source"
        }))
      ],
      retry: {
        retryCount: 0,
        maxAutomaticRetries: 0,
        requiresUserAction: false
      },
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: false,
        permissionDecisionIds: []
      },
      message: request.sourceExpected
        ? "Agent turn accepted; waiting for its source preservation binding."
        : "Agent turn accepted and preserved."
    });
    try {
      return this.#createJob(createJobRecordPath(vaultPath, job.id), job);
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "job.revision_conflict") {
        return this.createAgentTurnJob(request);
      }
      throw caught;
    }
  }

  findAgentTurnJobByConversationEvent(conversationEventId: string): JobRecord | undefined {
    const vaultPath = this.#requireActiveVaultPath();
    const matches = readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))
      .map(({ job }) => job)
      .filter((job) => job.class === "agent_turn" && job.conversationEventId === conversationEventId);
    if (matches.length > 1) {
      throw new PigeDomainError("agent_runtime.turn_conflict", "Multiple Agent Jobs claim one conversation event.");
    }
    return matches[0];
  }

  async runTextAgentTurn<T>(
    jobId: string,
    execute: (execution: TextAgentTurnExecution) => Promise<T>
  ): Promise<T> {
    const vaultPath = this.#requireActiveVaultPath();
    const initialSnapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = initialSnapshot;
    if (
      !jobFile ||
      !isQueuedHomeAgentTurn(jobFile.job)
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The text Agent turn is not ready for execution.");
    }
    const execution = this.#beginCooperativeExecution(
      jobFile,
      "planning",
      "Pi Agent is interpreting the preserved Home turn."
    );
    try {
      return await execute({
        job: execution.job,
        signal: execution.control.signal,
        markDurableCheckpoint: (checkpointId) => {
          const current = this.#readJobSnapshot(vaultPath, jobId)?.job;
          if (current?.cancellation?.durableWritesApplied === true) return;
          execution.control.markDurableCheckpoint(checkpointId);
        }
      });
    } catch (caught) {
      const cancellation = resolveCancellation(execution.control, caught);
      if (cancellation) {
        const currentSnapshot = this.#readJobSnapshot(vaultPath, jobId);
        const uncertainRequestId = currentSnapshot
          ? this.#terminalizeConsumedPermissionCancellation(vaultPath, currentSnapshot)
          : undefined;
        if (uncertainRequestId) {
          throw new PigeDomainError(
            "permission.completion_uncertain",
            "The external action may have completed and will not be replayed."
          );
        }
        this.#markJobCancellationOutcome(jobFile.path, execution.job, cancellation);
        throw new PigeDomainError("agent_runtime.turn_cancelled", "The Agent turn was cancelled at a safe checkpoint.");
      }
      throw caught;
    } finally {
      this.#finishCooperativeExecution(jobId, execution.controller);
    }
  }

  attachAgentTurnSource(jobId: string, sourceId: string): JobRecord {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    const sourceRecordFile = readSourceRecordFile(vaultPath, sourceId);
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.sourceId !== sourceId ||
      !sourceRecordFile ||
      sourceRecordFile.sourceRecord.metadata.agentTurnJobId !== jobId
    ) {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The preserved source does not match its unified Agent turn."
      );
    }
    if (
      jobFile.job.state !== "waiting_dependency" ||
      jobFile.job.stage !== "capturing_source"
    ) {
      if (jobFile.job.state === "queued") return jobFile.job;
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The unified Agent turn is not waiting for source preservation."
      );
    }
    const {
      stage: _stage,
      waitingDependency: _waitingDependency,
      error: _error,
      finishedAt: _finishedAt,
      ...current
    } = jobFile.job;
    const linked = JobRecordSchema.parse({
      ...current,
      state: "queued",
      updatedAt: new Date().toISOString(),
      message: "Agent turn source preservation completed; semantic processing is queued."
    });
    return this.#replaceJob(snapshot!, linked).job;
  }

  failAgentTurnSourcePreservation(jobId: string): JobRecord | undefined {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.state !== "waiting_dependency" ||
      jobFile.job.stage !== "capturing_source"
    ) {
      return jobFile?.job.class === "agent_turn" ? jobFile.job : undefined;
    }
    const failed = JobRecordSchema.parse({
      ...jobFile.job,
      state: "failed_retryable",
      updatedAt: new Date().toISOString(),
      message: "The attachment could not be preserved safely; the Agent turn remains available for an explicit retry."
    });
    return this.#replaceJob(snapshot!, failed).job;
  }

  reconcilePendingAgentTurnSources(): ReconcilePendingAgentTurnSourcesResult {
    const vaultPath = this.#requireActiveVaultPath();
    let linked = 0;
    let waiting = 0;
    let failed = 0;
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      if (
        jobFile.job.class !== "agent_turn" ||
        jobFile.job.state !== "waiting_dependency" ||
        jobFile.job.stage !== "capturing_source" ||
        !jobFile.job.sourceId
      ) {
        continue;
      }
      const sourceRecordFile = readSourceRecordFile(vaultPath, jobFile.job.sourceId);
      if (!sourceRecordFile) {
        waiting += 1;
        continue;
      }
      if (sourceRecordFile.sourceRecord.metadata.agentTurnJobId !== jobFile.job.id) {
        this.#markJobFailedFinal(
          jobFile.path,
          jobFile.job,
          "The preserved source binding conflicts with its Agent turn; automatic processing was stopped."
        );
        failed += 1;
        continue;
      }
      this.attachAgentTurnSource(jobFile.job.id, jobFile.job.sourceId);
      linked += 1;
    }
    return { linked, waiting, failed };
  }

  reconcilePendingAgentTurnUrlSources(): ReconcilePendingAgentTurnSourcesResult {
    const vaultPath = this.#requireActiveVaultPath();
    let linked = 0;
    let waiting = 0;
    let failed = 0;
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      const toolInput = jobFile.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE);
      const hasCompleteLink = [
        AGENT_TURN_URL_SOURCE_ROLE,
        AGENT_TURN_URL_PAGE_ROLE,
        AGENT_TURN_URL_OPERATION_ROLE
      ].every((role) => jobFile.job.outputRefs?.some((ref) => ref.role === role));
      if (
        jobFile.job.class !== "agent_turn" ||
        jobFile.job.state !== "running" ||
        jobFile.job.sourceId !== undefined ||
        toolInput?.kind !== "tool" ||
        toolInput.id !== "pige_fetch_url@1" ||
        !toolInput.checksum ||
        hasCompleteLink
      ) {
        continue;
      }
      const sourceId = createAgentTurnSourceId(jobFile.job.id);
      const sourceRecordFile = readSourceRecordFile(vaultPath, sourceId);
      if (!sourceRecordFile) {
        waiting += 1;
        continue;
      }
      try {
        this.linkAgentTurnUrlSource(jobFile.job.id, sourceId);
        linked += 1;
      } catch (caught) {
        if (!(caught instanceof PigeDomainError)) throw caught;
        this.#markJobFailedFinal(
          jobFile.path,
          jobFile.job,
          "The durable Agent-selected URL source could not be reconciled safely after restart."
        );
        failed += 1;
      }
    }
    return { linked, waiting, failed };
  }

  reserveAgentTurnUrlSource(
    jobId: string,
    request: ReserveAgentTurnUrlSourceRequest
  ): { readonly job: JobRecord; readonly sourceId: string } {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.sourceId !== undefined ||
      jobFile.job.state !== "running" ||
      request.toolId !== "pige_fetch_url" ||
      request.toolVersion !== "1" ||
      !isSha256(request.inputHash) ||
      !isSha256(request.catalogHash) ||
      !isSha256(request.policyHash) ||
      request.policyHash !== jobFile.job.policyHash ||
      !isBoundedOpaqueToolCallId(request.toolCallId)
    ) {
      throw new PigeDomainError(
        "agent_runtime.tool_binding_invalid",
        "The Agent-selected URL tool binding is invalid."
      );
    }
    const sourceId = createAgentTurnSourceId(jobFile.job.id);
    const requestedToolId = `${request.toolId}@${request.toolVersion}`;
    const existingInput = jobFile.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE);
    const existingCatalog = jobFile.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_CATALOG_ROLE);
    if (
      (existingInput && (
        existingInput.kind !== "tool" ||
        existingInput.id !== requestedToolId ||
        existingInput.checksum !== request.inputHash
      )) ||
      (existingCatalog && (
        existingCatalog.kind !== "tool" ||
        existingCatalog.id !== "pige_agent_tool_catalog" ||
        existingCatalog.checksum !== request.catalogHash
      ))
    ) {
      throw new PigeDomainError(
        "agent_runtime.tool_binding_changed",
        "The Agent-selected URL action changed before durable reuse."
      );
    }
    const provenanceHash = createToolCallProvenanceHash(jobFile.job.id, request.toolCallId);
    const baseRefs = [
      ...(jobFile.job.inputRefs ?? []).filter((ref) =>
        ref.role !== AGENT_TOOL_INPUT_ROLE &&
        ref.role !== AGENT_TOOL_CATALOG_ROLE
      ),
      existingInput ?? {
        kind: "tool" as const,
        id: requestedToolId,
        checksum: request.inputHash,
        role: AGENT_TOOL_INPUT_ROLE
      },
      existingCatalog ?? {
        kind: "tool" as const,
        id: "pige_agent_tool_catalog",
        checksum: request.catalogHash,
        role: AGENT_TOOL_CATALOG_ROLE
      }
    ];
    const reserved = JobRecordSchema.parse({
      ...jobFile.job,
      inputRefs: mergeAgentToolCallProvenance(baseRefs, provenanceHash),
      updatedAt: new Date().toISOString(),
      message: "Pi selected the host-bound URL fetch tool; the submitted URL action is durably reserved."
    });
    return { job: this.#replaceJob(snapshot!, reserved).job, sourceId };
  }

  markAgentTurnUrlSourcePublicationStarted(
    jobId: string,
    sourceId: string,
    inputHash: string
  ): JobRecord {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    const toolInput = jobFile?.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE);
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.state !== "running" ||
      jobFile.job.sourceId !== undefined ||
      sourceId !== createAgentTurnSourceId(jobId) ||
      toolInput?.kind !== "tool" ||
      toolInput.id !== "pige_fetch_url@1" ||
      toolInput.checksum !== inputHash
    ) {
      throw new PigeDomainError(
        "agent_runtime.tool_binding_invalid",
        "The Agent-selected URL publication guard binding is invalid."
      );
    }
    const guarded = JobRecordSchema.parse({
      ...jobFile.job,
      cancellation: {
        ...jobFile.job.cancellation,
        safeCheckpointId: "agent_turn_url_source_preserving",
        durableWritesApplied: true
      },
      updatedAt: new Date().toISOString(),
      message: "The Agent-selected URL source passed confinement checks; durable preservation is beginning."
    });
    return this.#replaceJob(snapshot!, guarded).job;
  }

  linkAgentTurnUrlSource(jobId: string, sourceId: string): AgentTurnUrlSourceLink {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    const sourceRecordFile = readSourceRecordFile(vaultPath, sourceId);
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.sourceId !== undefined ||
      jobFile.job.state !== "running" ||
      !sourceRecordFile ||
      sourceRecordFile.sourceRecord.kind !== "url" ||
      sourceRecordFile.sourceRecord.metadata.agentTurnJobId !== jobId ||
      !jobFile.job.policyContextId ||
      !jobFile.job.policyHash ||
      jobFile.job.cancellation?.durableWritesApplied !== true ||
      sourceRecordFile.sourceRecord.metadata.agentTurnUrlInputHash !==
        jobFile.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE)?.checksum
    ) {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The Agent-selected URL source does not match its parent turn."
      );
    }
    const urlSnapshotBindingHash = createAgentTurnUrlSnapshotBindingHash(
      sourceRecordFile.sourceRecord,
      jobFile.job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE)?.checksum
    );
    const page = this.#sourcePages.createForSource(
      vaultPath,
      sourceRecordFile.sourceRecord,
      sourceRecordFile.path,
      jobFile.job.id,
      sourceRecordFile.sourceRecord
    );
    const refreshedSource = readSourceRecord(vaultPath, sourceId);
    if (!refreshedSource) {
      throw new PigeDomainError(
        "agent_runtime.url_source_changed",
        "The Agent-selected URL source disappeared during projection."
      );
    }
    const sourceRef = {
      kind: "source" as const,
      id: sourceId,
      checksum: sourceInputRevision(refreshedSource),
      role: AGENT_TURN_URL_SOURCE_ROLE
    };
    const pageRef = {
      kind: "page" as const,
      id: page.pageId,
      locator: page.pagePath,
      role: AGENT_TURN_URL_PAGE_ROLE
    };
    const operation = writeAgentTurnUrlSourceOperation(
      vaultPath,
      jobFile.job,
      refreshedSource,
      page.pageId,
      page.pagePath,
      urlSnapshotBindingHash
    );
    const operationRef = {
      kind: "operation" as const,
      id: operation.id,
      role: AGENT_TURN_URL_OPERATION_ROLE
    };
    const linked = JobRecordSchema.parse({
      ...jobFile.job,
      outputRefs: [
        ...(jobFile.job.outputRefs ?? []).filter((ref) =>
          !(
            (ref.kind === "source" && ref.role === AGENT_TURN_URL_SOURCE_ROLE) ||
            (ref.kind === "page" && ref.role === AGENT_TURN_URL_PAGE_ROLE) ||
            (ref.kind === "operation" && ref.role === AGENT_TURN_URL_OPERATION_ROLE)
          )
        ),
        sourceRef,
        pageRef,
        operationRef
      ],
      operationIds: Array.from(new Set([...(jobFile.job.operationIds ?? []), operation.id])),
      cancellation: {
        ...jobFile.job.cancellation,
        safeCheckpointId: "agent_turn_url_source_preserved",
        durableWritesApplied: true
      },
      privacy: {
        usedCloudModel: jobFile.job.privacy?.usedCloudModel ?? false,
        usedNetwork: true,
        usedShell: false,
        accessedExternalFiles: false,
        permissionDecisionIds: jobFile.job.privacy?.permissionDecisionIds ?? []
      },
      updatedAt: new Date().toISOString(),
      message: "Agent-selected URL evidence was fetched, preserved, and projected without a Host-selected semantic continuation."
    });
    const committed = this.#replaceJob(snapshot!, linked).job;
    return { job: committed, sourceId, pageId: page.pageId, pagePath: page.pagePath, title: page.title };
  }

  readAgentTurnUrlSourceLink(jobId: string, sourceId: string): AgentTurnUrlSourceLink {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    const jobFile = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    const sourceRecord = readSourceRecord(vaultPath, sourceId);
    const sourceRef = jobFile?.job.outputRefs?.find(
      (ref) => ref.kind === "source" && ref.id === sourceId && ref.role === AGENT_TURN_URL_SOURCE_ROLE
    );
    const pageRef = jobFile?.job.outputRefs?.find(
      (ref) => ref.kind === "page" && ref.role === AGENT_TURN_URL_PAGE_ROLE
    );
    const pageId = sourceRecord?.knowledgePageId;
    const pagePath = sourceRecord?.knowledgePagePath;
    const title = typeof sourceRecord?.metadata.title === "string"
      ? sourceRecord.metadata.title
      : sourceRecord?.original?.displayName;
    if (
      !jobFile ||
      jobFile.job.class !== "agent_turn" ||
      jobFile.job.sourceId !== undefined ||
      !sourceRecord ||
      sourceRecord.kind !== "url" ||
      sourceRecord.metadata.agentTurnJobId !== jobId ||
      !sourceRef?.checksum ||
      !pageRef?.locator ||
      pageRef.id !== pageId ||
      pageRef.locator !== pagePath ||
      !pageId ||
      !pagePath ||
      !title
    ) {
      throw new PigeDomainError(
        "agent_runtime.url_source_changed",
        "The Agent-selected URL source linkage changed before reuse."
      );
    }
    return { job: jobFile.job, sourceId, pageId, pagePath, title };
  }

  writeRetrievalQueryJob(expected: JobRecord, job: JobRecord): JobRecord {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, job.id);
    const existing = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    if (
      !activeVault ||
      !existing ||
      existing.job.class !== "retrieval_query" ||
      job.class !== "retrieval_query" ||
      job.createdAt !== existing.job.createdAt ||
      job.activeVaultId !== activeVault.vaultId ||
      existing.job.activeVaultId !== activeVault.vaultId
    ) {
      throw new PigeDomainError("rag.job_binding_invalid", "The Home Agent Job binding is invalid.");
    }
    if (!isDeepStrictEqual(existing.job, JobRecordSchema.parse(expected))) {
      throw new PigeDomainError(
        "job.revision_conflict",
        "The retrieval Job changed before the requested mutation could be committed."
      );
    }
    const validated = JobRecordSchema.parse(job);
    return this.#replaceJob(snapshot!, validated).job;
  }

  writeAgentTurnJob(expected: JobRecord, job: JobRecord): JobRecord {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, job.id);
    const existing = snapshot ? { path: snapshot.path, job: snapshot.job } : undefined;
    if (
      !activeVault ||
      !existing ||
      existing.job.class !== "agent_turn" ||
      job.class !== "agent_turn" ||
      job.createdAt !== existing.job.createdAt ||
      job.conversationEventId !== existing.job.conversationEventId ||
      job.activeVaultId !== activeVault.vaultId ||
      existing.job.activeVaultId !== activeVault.vaultId
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The unified Agent turn binding is invalid.");
    }
    if (existing.job.state === "cancel_requested" && job.state !== "cancel_requested") {
      throw new PigeDomainError("agent_runtime.turn_cancelled", "The Agent turn has a pending cancellation request.");
    }
    if (!isDeepStrictEqual(existing.job, JobRecordSchema.parse(expected))) {
      throw new PigeDomainError(
        "job.revision_conflict",
        "The Agent turn changed before the requested mutation could be committed."
      );
    }
    const preserveDurableGuard = existing.job.cancellation?.durableWritesApplied === true;
    const validated = JobRecordSchema.parse({
      ...job,
      ...(preserveDurableGuard ? {
        cancellation: {
          ...job.cancellation,
          safeCheckpointId: existing.job.cancellation?.safeCheckpointId,
          durableWritesApplied: true
        }
      } : {})
    });
    return this.#replaceJob(snapshot!, validated).job;
  }

  readAgentTurnJob(jobId: string): JobRecord | undefined {
    const vaultPath = this.#requireActiveVaultPath();
    const snapshot = this.#readJobSnapshot(vaultPath, jobId);
    return snapshot?.job.class === "agent_turn" ? snapshot.job : undefined;
  }

  async processAgentTurnSource(jobId: string): Promise<JobRecord> {
    const before = this.readAgentTurnJob(jobId);
    if (!before?.sourceId) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The source-bearing Agent turn is invalid.");
    }
    if (before.state === "queued" && !isDatasetQueryContinuationTurn(before)) {
      await this.processQueuedAgentIngest({ jobIds: [jobId], sourceIds: [before.sourceId], limit: 1 });
    }
    const after = this.readAgentTurnJob(jobId);
    if (!after) {
      throw new PigeDomainError("agent_runtime.turn_unavailable", "The source-bearing Agent turn is unavailable.");
    }
    return after;
  }

  requeueWaitingTextAgentTurns(): { readonly requeued: number } {
    const vaultPath = this.#requireActiveVaultPath();
    let requeued = 0;
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      if (
        jobFile.job.class !== "agent_turn" ||
        jobFile.job.state !== "waiting_dependency" ||
        jobFile.job.stage !== "waiting_for_model" ||
        (jobFile.job.sourceId !== undefined && !hasDatasetQueryContinuationRefs(jobFile.job))
      ) {
        continue;
      }
      const {
        stage: _stage,
        finishedAt: _finishedAt,
        error: _error,
        waitingDependency: _waitingDependency,
        ...current
      } = jobFile.job;
      this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
        ...current,
        state: "queued",
        ...(jobFile.job.sourceId === undefined ? {} : { stage: "planning" as const }),
        updatedAt: new Date().toISOString(),
        message: "The preserved Agent turn is queued after model setup became ready."
      }));
      requeued += 1;
    }
    return { requeued };
  }

  listQueuedTextAgentTurns(limit = 20): readonly JobRecord[] {
    const vaultPath = this.#requireActiveVaultPath();
    return readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))
      .map((jobFile) => jobFile.job)
      .filter(isQueuedHomeAgentTurn)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, clampLimit(limit));
  }

  recoverInterruptedJobs(): RecoverInterruptedJobsResult {
    const vaultPath = this.#requireActiveVaultPath();
    let requeued = 0;
    let failedRetryable = 0;
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.state !== "running" && jobFile.job.state !== "cancel_requested") continue;
      if (jobFile.job.class === "backup") continue;
      const uncertainPermissionRequestId = uncompletedConsumedPermissionRequestId(jobFile.job);
      if (uncertainPermissionRequestId) {
        const now = new Date().toISOString();
        const { waitingDependency: _waiting, stage: _stage, ...current } = jobFile.job;
        this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
          ...current,
          state: "failed_final",
          updatedAt: now,
          finishedAt: now,
          cancellation: {
            ...jobFile.job.cancellation,
            durableWritesApplied: true
          },
          error: {
            code: "permission.completion_uncertain",
            domain: "permission",
            messageKey: "errors.permission.completion_uncertain",
            retryable: false,
            severity: "error",
            userAction: "none",
            permissionRequestId: uncertainPermissionRequestId
          },
          retry: {
            retryCount: jobFile.job.retry?.retryCount ?? 0,
            maxAutomaticRetries: 0,
            requiresUserAction: false,
            lastRetryReason: "permission.completion_uncertain"
          },
          message: "Pige restarted after one-use authority was consumed; the external action will not be replayed."
        }));
        continue;
      }
      const canResumeIdempotently = jobFile.job.state === "running" &&
        (jobFile.job.class === "capture" ||
          jobFile.job.class === "parse" ||
          jobFile.job.class === "ocr" ||
          jobFile.job.class === "dataset_import" ||
          jobFile.job.class === "agent_turn" ||
          jobFile.job.class === "agent_ingest" ||
          jobFile.job.class === "index_rebuild");
      const state: JobState = canResumeIdempotently ? "queued" : "failed_retryable";
      const message = canResumeIdempotently
        ? "Pige restarted during this idempotent local job; validated outputs will be reused and processing has been requeued."
        : "Pige restarted before this job reached a safe completion point. Preserved inputs remain available for an explicit retry.";
      this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
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
    const store = this.#jobRecordStore(vaultPath);
    if (!canRunAgentIngest(this.#agentIngest)) {
      return { requeued: 0 };
    }

    let requeued = 0;
    for (const jobFile of readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))) {
      if (!isAgentKnowledgeTurn(jobFile.job) || jobFile.job.state !== "waiting_dependency") continue;
      if (hasDatasetQueryContinuationRefs(jobFile.job)) continue;
      const sourceRecord = jobFile.job.sourceId ? readSourceRecord(vaultPath, jobFile.job.sourceId) : undefined;
      const agentSelectedOcr = Boolean(sourceRecord && supportsAgentSelectedOcr(sourceRecord.kind));
      const waitingAgentOcr = agentSelectedOcr &&
        hasWaitingAgentOcrChild(store, vaultPath, jobFile.job);
      const completedEmptyAgentOcr = Boolean(
        sourceRecord &&
        sourceRecord.metadata.agentTextReady !== true &&
        sourceRecord.metadata.ocrStatus === "completed_empty" &&
        hasCompletedEmptyAgentOcrChild(store, vaultPath, jobFile.job, sourceRecord)
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
        hasWaitingAgentParseChild(store, vaultPath, jobFile.job) &&
        !this.#documentParser?.canParse(sourceRecord.kind)
      ) continue;
      if (
        sourceRecord &&
        supportsAgentSelectedDataset(sourceRecord.kind) &&
        hasWaitingAgentDatasetChild(store, vaultPath, jobFile.job) &&
        !this.#datasets?.canMaterialize(sourceRecord.kind)
      ) continue;
      this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
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
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.class !== "parse" || jobFile.job.state !== "waiting_dependency" || !jobFile.job.sourceId) continue;
      if (isAgentSelectedParseJob(jobFile.job)) continue;
      const sourceRecord = readSourceRecord(vaultPath, jobFile.job.sourceId);
      if (!sourceRecord || !parser.canParse(sourceRecord.kind)) continue;
      this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
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
    for (const jobFile of readJobRecordFiles(this.#jobRecordStore(vaultPath), path.join(vaultPath, ".pige", "jobs"))) {
      if (jobFile.job.class !== "ocr" || jobFile.job.state !== "waiting_dependency" || !jobFile.job.sourceId) continue;
      if (isAgentSelectedOcrJob(jobFile.job)) continue;
      const sourceRecord = readSourceRecord(vaultPath, jobFile.job.sourceId);
      if (!sourceRecord || !inspectOcrSource(ocr, sourceRecord).ready) continue;
      this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
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
    const job = createIndexRebuildJob(this.#jobRecordStore(vaultPath), vaultPath);
    const result = await this.processQueuedIndexRebuild({ jobIds: [job.id] });
    if (!result.lastRebuild) {
      throw new PigeDomainError("index_rebuild_failed", "Index rebuild failed. The job remains retryable.");
    }
    return result.lastRebuild;
  }

  processQueuedCaptures(request: ProcessQueuedCapturesRequest = {}): ProcessQueuedCapturesResult {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedCaptureJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      let execution: { readonly job: JobRecord; readonly control: JobExecutionControl } | undefined;
      try {
        const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
        if (!sourceRecordFile) {
          this.#markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved job remains retryable.");
          failed += 1;
          continue;
        }

        const captureExecution = this.#beginNonCooperativeExecution(
          jobFile,
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
            this.#jobRecordStore(vaultPath),
            vaultPath,
            captureExecution.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest),
            this.#requireActiveVaultId(vaultPath)
          );
        } else {
          ensureAgentIngestJob(
            this.#jobRecordStore(vaultPath),
            vaultPath,
            captureExecution.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest),
            this.#requireActiveVaultId(vaultPath)
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
        if (isJobMutationContention(caught)) {
          failed += 1;
          continue;
        }
        const cancellation = execution ? resolveCancellation(execution.control, caught) : undefined;
        if (cancellation) {
          this.#markJobCancellationOutcome(jobFile.path, execution?.job ?? jobFile.job, cancellation);
        } else {
          this.#markJobFailedRetryable(
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
    const jobFiles = findQueuedParseJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    const agentReadySourceIds: string[] = [];
    const ocrWaitingSourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        this.#markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved parse job remains retryable.");
        failed += 1;
        continue;
      }
      const parser = this.#documentParser;
      if (!parser || !parser.canParse(sourceRecordFile.sourceRecord.kind)) {
        this.#markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for a bundled local parser that supports this document type.");
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile,
        "parsing",
        "Extracting document text in the local parser worker."
      );
      const runningJob = execution.job;
      const agentSelected = isAgentSelectedParseJob(runningJob);
      const detachParentAbort = bridgeParentAbortToChild(
        this.#jobRecordStore(vaultPath),
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
            this.#jobRecordStore(vaultPath),
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
          ensureAgentIngestJob(
            this.#jobRecordStore(vaultPath),
            vaultPath,
            runningJob,
            refreshedSource.id,
            canRunAgentIngest(this.#agentIngest),
            this.#requireActiveVaultId(vaultPath)
          );
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
          this.#markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (isJobMutationContention(caught)) {
          // Another exact Job revision won; do not overwrite its authoritative state.
        } else {
          const failure = parseFailure(caught, sourceRecordFile.sourceRecord.kind);
          if (failure.waiting) {
            this.#markJobWaitingDependency(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else if (failure.final) {
            this.#markJobFailedFinal(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else {
            this.#markJobFailedRetryable(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
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

  async processQueuedDatasetImports(
    request: ProcessQueuedDatasetImportsRequest = {}
  ): Promise<ProcessQueuedDatasetImportsResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedDatasetImportJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const sourceRecordFile = jobFile.job.sourceId
        ? readSourceRecordFile(vaultPath, jobFile.job.sourceId)
        : undefined;
      if (!sourceRecordFile) {
        this.#markJobFailedRetryable(
          jobFile.path,
          jobFile.job,
          "Source record is missing. Preserved Dataset import remains retryable."
        );
        failed += 1;
        continue;
      }
      const datasets = this.#datasets;
      if (!datasets || !datasets.canMaterialize(sourceRecordFile.sourceRecord.kind)) {
        this.#markJobWaitingDependency(
          jobFile.path,
          jobFile.job,
          "Waiting for the bundled local Dataset materialization capability."
        );
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile,
        "importing",
        "Materializing a bounded local Dataset Bundle from preserved structured evidence."
      );
      const runningJob = execution.job;
      const detachParentAbort = bridgeParentAbortToChild(
        this.#jobRecordStore(vaultPath),
        jobFile.path,
        execution.controller,
        request.abortSignal
      );
      try {
        execution.control.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "dataset" });
        const result = await datasets.materializeSource(
          vaultPath,
          sourceRecordFile.sourceRecord,
          sourceRecordFile.path,
          runningJob,
          execution.control
        );
        this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
          ...current,
          outputRefs: Array.from(new Map([
            ...(current.outputRefs ?? []).map((ref) => [`${ref.kind}:${ref.id}:${ref.role ?? ""}`, ref] as const),
            [`dataset:${result.datasetId}:dataset_bundle`, {
              kind: "dataset" as const,
              id: result.datasetId,
              role: "dataset_bundle"
            }],
            [`dataset_revision:${result.revisionId}:dataset_active_revision`, {
              kind: "dataset_revision" as const,
              id: result.revisionId,
              role: "dataset_active_revision"
            }]
          ]).values()),
          updatedAt: new Date().toISOString()
        }));
        const completedJob = this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          result.warnings.length > 0 ? "completed_with_warnings" : "completed",
          `Materialized Dataset revision with ${result.tableCount} table${result.tableCount === 1 ? "" : "s"} and ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`,
          "dataset",
          execution.control.durableWriteState(),
          result.operationIds
        );
        if (completedJob.state === "cancelled") {
          failed += 1;
        } else {
          appendLog(
            vaultPath,
            `${new Date().toISOString()} Materialized Dataset \`${result.datasetId}\` revision \`${result.revisionId}\` from source \`${sourceRecordFile.sourceRecord.id}\`: ${result.tableCount} tables, ${result.rowCount} rows.`
          );
          completed += 1;
        }
      } catch (caught) {
        const cancellation = resolveCancellation(execution.control, caught);
        if (cancellation) {
          this.#markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (isJobMutationContention(caught)) {
          // Another exact Job revision won; do not overwrite its authoritative state.
        } else {
          const failure = datasetImportFailure(caught);
          if (failure.waiting) {
            this.#markJobWaitingDependency(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else if (failure.final) {
            this.#markJobFailedFinal(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else {
            this.#markJobFailedRetryable(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          }
        }
        failed += 1;
      } finally {
        detachParentAbort();
        this.#finishCooperativeExecution(runningJob.id, execution.controller);
      }
    }

    return { processed: jobFiles.length, completed, failed };
  }

  async processQueuedOcr(request: ProcessQueuedOcrRequest = {}): Promise<ProcessQueuedOcrResult> {
    const vaultPath = this.#requireActiveVaultPath();
    const jobFiles = findQueuedOcrJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    const agentReadySourceIds: string[] = [];
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        this.#markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Preserved OCR job remains retryable.");
        failed += 1;
        continue;
      }
      const agentSelected = isAgentSelectedOcrJob(jobFile.job);
      const ocr = this.#ocr;
      const capability = inspectOcrSource(ocr, sourceRecordFile.sourceRecord);
      if (!ocr || !capability.ready) {
        if (!agentSelected && sourceRecordFile.sourceRecord.metadata.agentTextReady === true) {
          ensureAgentIngestJob(
            this.#jobRecordStore(vaultPath),
            vaultPath,
            jobFile.job,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest),
            this.#requireActiveVaultId(vaultPath)
          );
          agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
        }
        this.#markJobWaitingDependency(jobFile.path, jobFile.job, capability.message);
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile,
        "ocr",
        sourceRecordFile.sourceRecord.kind === "pdf_file"
          ? "Rendering verified PDF page targets and recognizing them with local OCR."
          : sourceRecordFile.sourceRecord.kind === "pptx_file"
            ? "Materializing verified PPTX media targets and recognizing them with local OCR."
            : "Recognizing image text with the local platform OCR helper."
      );
      const runningJob = execution.job;
      const detachParentAbort = bridgeParentAbortToChild(
        this.#jobRecordStore(vaultPath),
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
          ensureAgentIngestJob(
            this.#jobRecordStore(vaultPath),
            vaultPath,
            runningJob,
            sourceRecordFile.sourceRecord.id,
            canRunAgentIngest(this.#agentIngest),
            this.#requireActiveVaultId(vaultPath)
          );
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
          this.#markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (isJobMutationContention(caught)) {
          // Another exact Job revision won; do not overwrite its authoritative state.
        } else {
          const failure = ocrFailure(caught, sourceRecordFile.sourceRecord.kind);
          if (failure.waiting) {
            if (
              !agentSelected &&
              sourceRecordFile.sourceRecord.metadata.agentTextReady === true &&
              isOcrCapabilityUnavailableError(caught)
            ) {
              ensureAgentIngestJob(
                this.#jobRecordStore(vaultPath),
                vaultPath,
                runningJob,
                sourceRecordFile.sourceRecord.id,
                canRunAgentIngest(this.#agentIngest),
                this.#requireActiveVaultId(vaultPath)
              );
              if (!agentReadySourceIds.includes(sourceRecordFile.sourceRecord.id)) {
                agentReadySourceIds.push(sourceRecordFile.sourceRecord.id);
              }
            }
            this.#markJobWaitingDependency(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else if (failure.final) {
            this.#markJobFailedFinal(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
          } else {
            this.#markJobFailedRetryable(jobFile.path, runningJob, failure.message, execution.control.durableWriteState());
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
    const jobFiles = findQueuedAgentIngestJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    let completed = 0;
    let failed = 0;

    for (const jobFile of jobFiles) {
      const agentIngest = this.#agentIngest;
      let preservedAgentTurn: PreservedAgentTurn | undefined;
      if (jobFile.job.class === "agent_turn") {
        try {
          preservedAgentTurn = readPreservedAgentTurn(vaultPath, jobFile.job);
          const existingAssistant = new AgentTurnConversationStore().findAssistantTurn(
            vaultPath,
            preservedAgentTurn.locator,
            jobFile.job.id
          );
          if (existingAssistant) {
            const finishedAt = new Date().toISOString();
            this.#replaceExpectedJob(jobFile, JobRecordSchema.parse({
              ...jobFile.job,
              state: "completed",
              updatedAt: finishedAt,
              finishedAt,
              outputRefs: Array.from(new Map([
                ...(jobFile.job.outputRefs ?? []).map((ref) => [`${ref.kind}:${ref.id}:${ref.role ?? ""}`, ref] as const),
                [`conversation:${existingAssistant.id}:agent_turn_assistant_event`, {
                  kind: "conversation" as const,
                  id: existingAssistant.id,
                  role: "agent_turn_assistant_event",
                  ...(existingAssistant.contentHash ? { checksum: existingAssistant.contentHash } : {})
                }]
              ]).values()),
              message: "Recovered the durable assistant result for this source Agent turn."
            }));
            completed += 1;
            continue;
          }
        } catch {
          this.#markJobFailedRetryable(
            jobFile.path,
            jobFile.job,
            "The preserved Agent turn binding is unavailable. The source remains preserved."
          );
          failed += 1;
          continue;
        }
      }
      if (!agentIngest) {
        this.#markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for a tested default model before Agent ingest.");
        failed += 1;
        continue;
      }

      const sourceRecordFile = jobFile.job.sourceId ? readSourceRecordFile(vaultPath, jobFile.job.sourceId) : undefined;
      if (!sourceRecordFile) {
        this.#markJobFailedRetryable(jobFile.path, jobFile.job, "Source record is missing. Agent ingest remains retryable.");
        failed += 1;
        continue;
      }
      if (
        !supportsAgentSelectedOcr(sourceRecordFile.sourceRecord.kind) &&
        shouldWaitForRunnableOcr(this.#ocr, sourceRecordFile.sourceRecord)
      ) {
        this.#markJobWaitingDependency(
          jobFile.path,
          jobFile.job,
          createAgentOcrWaitMessage(sourceRecordFile.sourceRecord)
        );
        failed += 1;
        continue;
      }
      const execution = this.#beginCooperativeExecution(
        jobFile,
        "waiting_for_model",
        "Agent ingest is preparing grounded evidence for the configured model."
      );
      const runningJob = execution.job;
      let activeJob = runningJob;
      try {
        const result = await agentIngest.ingestSource(vaultPath, sourceRecordFile.sourceRecord, runningJob, {
          onPolicyResolved: (snapshot) => {
            activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
              ...current,
              policyContextId: snapshot.policyContextId,
              policyHash: snapshot.policyHash,
              updatedAt: new Date().toISOString(),
              message: "Agent ingest policy and model-egress gates resolved before provider access."
            }));
          },
          onEgressRecorded: (operationId) => {
            activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
              ...current,
              operationIds: Array.from(new Set([...(current.operationIds ?? []), operationId])),
              updatedAt: new Date().toISOString()
            }));
          },
          onModelEgressPending: (requestId) => {
            activeJob = this.#markJobWaitingModelEgress(
              jobFile.path,
              activeJob,
              requestId,
              "Waiting for one exact approval before selected evidence is sent to the configured model service.",
              execution.control.durableWriteState()
            );
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
          materializeCurrentDataset: (datasetRequest) => this.#runAgentSelectedDatasetTool(
            vaultPath,
            runningJob,
            datasetRequest,
            execution.control
          ),
          ocrCurrentSource: (ocrRequest) => this.#runAgentSelectedOcrTool(
            vaultPath,
            runningJob,
            ocrRequest,
            execution.control
          ),
          throwIfCancellationRequested: () => execution.control.throwIfCancellationRequested(),
          onPublicationStart: (checkpointId, publicationBinding) => {
            if (publicationBinding) {
              recordAgentNotePublicationCheckpoint(
                this.#jobRecordStore(vaultPath),
                vaultPath,
                jobFile.path,
                checkpointId,
                publicationBinding
              );
            }
            execution.control.markDurableCheckpoint(checkpointId);
          },
          onProposalStaged: (proposalResult) => {
            markAgentProposalAwaitingReview(
              this.#jobRecordStore(vaultPath),
              jobFile.path,
              runningJob,
              proposalResult.proposalId,
              proposalResult.proposalBinding,
              proposalResult.operationIds,
              proposalResult.pageId,
              proposalResult.pagePath
            );
          },
          ...(preservedAgentTurn?.metadata ? {
            userTurn: {
              text: preservedAgentTurn.event.text ?? "Inspect the attached preserved source.",
              objective: preservedAgentTurn.metadata.objective
            }
          } : {}),
          signal: execution.control.signal
        });
        if (result.outcome === "responded") {
          if (!preservedAgentTurn) {
            throw new PigeDomainError(
              "agent_runtime.turn_binding_invalid",
              "A source response requires a preserved Agent user turn."
            );
          }
          const conversations = new AgentTurnConversationStore();
          const assistantEvent = conversations.findAssistantTurn(
            vaultPath,
            preservedAgentTurn.locator,
            runningJob.id
          ) ?? conversations.appendAssistantTurn(
            vaultPath,
            preservedAgentTurn,
            runningJob.id,
            result.answer
          );
          activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
            ...current,
            outputRefs: Array.from(new Map([
              ...(current.outputRefs ?? []).map((ref) => [`${ref.kind}:${ref.id}:${ref.role ?? ""}`, ref] as const),
              [`conversation:${assistantEvent.id}:agent_turn_assistant_event`, {
                kind: "conversation" as const,
                id: assistantEvent.id,
                role: "agent_turn_assistant_event",
                ...(assistantEvent.contentHash ? { checksum: assistantEvent.contentHash } : {})
              }]
            ]).values()),
            updatedAt: new Date().toISOString()
          }));
          const completedJob = this.#completeCooperativeExecution(
            jobFile.path,
            runningJob,
            "completed",
            "Pi Agent answered from the inspected preserved source without publishing a note.",
            "source",
            execution.control.durableWriteState(),
            result.operationIds
          );
          if (completedJob.state === "cancelled") failed += 1;
          else completed += 1;
          continue;
        }
        if (result.outcome === "dataset_materialized") {
          activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
            ...current,
            outputRefs: Array.from(new Map([
              ...(current.outputRefs ?? []).map((ref) => [`${ref.kind}:${ref.id}:${ref.role ?? ""}`, ref] as const),
              [`dataset:${result.datasetId}:agent_dataset`, {
                kind: "dataset" as const,
                id: result.datasetId,
                role: "agent_dataset"
              }],
              [`dataset_revision:${result.revisionId}:agent_dataset_revision`, {
                kind: "dataset_revision" as const,
                id: result.revisionId,
                role: "agent_dataset_revision"
              }]
            ]).values()),
            operationIds: Array.from(new Set([...(current.operationIds ?? []), ...result.operationIds])),
            updatedAt: new Date().toISOString()
          }));
          if (preservedAgentTurn) {
            const latest = activeJob;
            if (latest.state === "cancel_requested") {
              const completedJob = this.#completeCooperativeExecution(
                jobFile.path,
                runningJob,
                result.warnings.length > 0 ? "completed_with_warnings" : "completed",
                `Pi Agent materialized a validated Dataset revision with ${result.tableCount} table${result.tableCount === 1 ? "" : "s"} before cancellation.`,
                "dataset",
                execution.control.durableWriteState(),
                result.operationIds
              );
              if (completedJob.state === "cancelled") failed += 1;
              else completed += 1;
              continue;
            }
            const {
              error: _error,
              waitingDependency: _waitingDependency,
              finishedAt: _finishedAt,
              ...continuation
            } = latest;
            activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
              ...withDurableWriteState(
                current.id === continuation.id ? current : continuation,
                execution.control.durableWriteState()
              ),
              state: "queued",
              stage: "planning",
              updatedAt: new Date().toISOString(),
              message: "Pi Agent materialized the selected Dataset and queued the same Home turn for its answer."
            }));
            completed += 1;
            continue;
          }
          const completedJob = this.#completeCooperativeExecution(
            jobFile.path,
            runningJob,
            result.warnings.length > 0 ? "completed_with_warnings" : "completed",
            `Pi Agent materialized a validated Dataset revision with ${result.tableCount} table${result.tableCount === 1 ? "" : "s"} and ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`,
            "dataset",
            execution.control.durableWriteState(),
            result.operationIds
          );
          if (completedJob.state === "cancelled") failed += 1;
          else completed += 1;
          continue;
        }
        if (result.outcome === "confirmation_needed") {
          markAgentProposalAwaitingReview(
            this.#jobRecordStore(vaultPath),
            jobFile.path,
            runningJob,
            result.proposalId,
            result.proposalBinding,
            result.operationIds,
            result.pageId,
            result.pagePath
          );
          completed += 1;
          continue;
        }
        completeAgentNotePublicationCheckpoint(this.#jobRecordStore(vaultPath), jobFile.path, result);
        if (preservedAgentTurn) {
          const conversations = new AgentTurnConversationStore();
          const assistantEvent = conversations.findAssistantTurn(
            vaultPath,
            preservedAgentTurn.locator,
            runningJob.id
          ) ?? conversations.appendAssistantTurn(
            vaultPath,
            preservedAgentTurn,
            runningJob.id,
            result.reviewRequired
              ? "Pi Agent completed the selected knowledge action, and the saved note needs review."
              : "Pi Agent completed the selected knowledge action and saved the result to the knowledge base."
          );
          activeJob = this.#mutateJob(jobFile.path, (current) => JobRecordSchema.parse({
            ...current,
            outputRefs: Array.from(new Map([
              ...(current.outputRefs ?? []).map((ref) => [`${ref.kind}:${ref.id}:${ref.role ?? ""}`, ref] as const),
              [`conversation:${assistantEvent.id}:agent_turn_assistant_event`, {
                kind: "conversation" as const,
                id: assistantEvent.id,
                role: "agent_turn_assistant_event",
                ...(assistantEvent.contentHash ? { checksum: assistantEvent.contentHash } : {})
              }]
            ]).values()),
            updatedAt: new Date().toISOString()
          }));
        }
        const completedJob = this.#completeCooperativeExecution(
          jobFile.path,
          runningJob,
          result.reviewRequired ? "completed_with_warnings" : "completed",
          result.reviewRequired
            ? "Agent ingest created a wiki note that needs review."
            : result.knowledgeAction === "linked"
              ? "Agent ingest linked two existing wiki notes."
              : result.mutationKind === "update_page"
                ? "Agent ingest updated an existing wiki note."
              : result.created ? "Agent ingest created a wiki note." : "Agent ingest wiki note already exists.",
          "source",
          execution.control.durableWriteState(),
          result.operationIds
        );
        if (completedJob.state === "cancelled") {
          failed += 1;
        } else {
          const warningSuffix = result.reviewRequired ? " Review is needed before treating it as clean knowledge." : "";
          appendLog(
            vaultPath,
            `${new Date().toISOString()} ${result.knowledgeAction === "linked" ? "Linked related knowledge from" : result.mutationKind === "update_page" ? "Updated" : "Created"} wiki note [${result.title}](${result.pagePath}) from source \`${sourceRecordFile.sourceRecord.id}\`.${warningSuffix}`
          );
          completed += 1;
        }
      } catch (caught) {
        const durableProposalParent = this.#readJobSnapshot(vaultPath, runningJob.id)?.job;
        if (
          durableProposalParent?.state === "awaiting_review" &&
          (durableProposalParent.proposalIds?.length ?? 0) > 0
        ) {
          completed += 1;
          continue;
        }
        const cancellation = resolveCancellation(execution.control, caught);
        const durableState = execution.control.durableWriteState();
        const currentSnapshot = cancellation
          ? this.#readJobSnapshot(vaultPath, runningJob.id)
          : undefined;
        if (cancellation && currentSnapshot && this.#terminalizeConsumedPermissionCancellation(vaultPath, currentSnapshot)) {
          // The external effect crossed its one-use boundary; preserve a non-retryable uncertain outcome.
        } else if (cancellation) {
          this.#markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (isJobMutationContention(caught)) {
          // Another exact Job revision won; do not overwrite its authoritative state.
        } else if (caught instanceof PigeDomainError && caught.code === "model_provider.default_model_missing") {
          this.#markJobWaitingDependency(jobFile.path, runningJob, "Waiting for a tested default model before Agent ingest.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "agent_runtime.tool_dependency_waiting") {
          this.#markJobWaitingDependency(
            jobFile.path,
            runningJob,
            "Agent-selected source processing is waiting for a registered local capability.",
            durableState
          );
        } else if (caught instanceof PigeDomainError && caught.code === "source.external_unavailable") {
          this.#markJobWaitingDependency(jobFile.path, runningJob, "Waiting for the referenced original source to be reconnected before Agent ingest can continue.", durableState);
        } else if (caught instanceof PigeDomainError && /^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
          this.#markJobFailedFinal(jobFile.path, runningJob, "The source cannot be verified safely. Re-import it to create a new source version before Agent ingest.", durableState);
        } else if (caught instanceof ModelEgressConfirmationRequiredError) {
          this.#markJobWaitingModelEgress(
            jobFile.path,
            runningJob,
            caught.requestId,
            "Waiting for one exact approval before selected evidence is sent to the configured model service.",
            durableState
          );
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.confirmation_required") {
          this.#markJobFailedFinal(
            jobFile.path,
            runningJob,
            "Model egress confirmation is unavailable; preserved source evidence remains local.",
            durableState
          );
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.blocked") {
          this.#markJobFailedFinal(jobFile.path, runningJob, "Model egress is blocked by the current privacy policy; the preserved source remains local.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "model_egress.denied") {
          this.#markJobFailedFinal(jobFile.path, runningJob, "The exact model send was denied; preserved source evidence remains available.", durableState);
        } else if (caught instanceof PigeDomainError && caught.code === "agent_ingest.source_changed") {
          const currentSource = readSourceRecord(vaultPath, sourceRecordFile.sourceRecord.id);
          if (currentSource && shouldWaitForRunnableOcr(this.#ocr, currentSource)) {
            this.#markJobWaitingDependency(
              jobFile.path,
              runningJob,
              `Source evidence changed while Agent ingest was running; waiting for ${documentLabel(currentSource.kind)} OCR enrichment before retry.`,
              durableState
            );
          } else {
            this.#mutateJob(jobFile.path, (currentJob) => JobRecordSchema.parse({
              ...withDurableWriteState(currentJob.id === runningJob.id ? currentJob : runningJob, durableState),
              state: "queued",
              updatedAt: new Date().toISOString(),
              message: "Source evidence changed while Agent ingest was running; ingest requeued with the latest evidence."
            }));
          }
        } else {
          this.#markJobFailedRetryable(
            jobFile.path,
            runningJob,
            "Agent ingest failed. Preserved source and source page remain retryable.",
            durableState,
            createAgentIngestRetryError(caught)
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

  async #applyApprovedProposal(
    proposals: ProposalService,
    proposal: ConfirmationProposal
  ): Promise<ProposalDecisionResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    const activeVault = this.#vaults.current();
    const agentIngest = this.#agentIngest;
    if (!vaultPath || !activeVault || !agentIngest) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is available for proposal apply.");
    }
    const assertActiveVault = (): void => {
      if (
        this.#vaults.activeVaultPath() !== vaultPath ||
        this.#vaults.current()?.vaultId !== activeVault.vaultId
      ) {
        throw new PigeDomainError(
          "proposal.vault_changed",
          "The active vault changed while the approved proposal was being applied."
        );
      }
    };
    assertActiveVault();
    const jobId = proposal.jobId;
    if (!jobId || !isSupportedAgentCreateProposal(proposal)) {
      return {
        status: "not_allowed",
        reason: "Only the current Agent-generated create-note proposal can be applied.",
        proposal
      };
    }
    const jobFile = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, jobId);
    if (!jobFile) {
      throw new PigeDomainError("proposal.parent_job_missing", "The proposal parent Job was not found.");
    }
    assertProposalParentJob(jobFile.job, proposal, activeVault.vaultId);
    const sourceRecord = jobFile.job.sourceId ? readSourceRecord(vaultPath, jobFile.job.sourceId) : undefined;
    if (!sourceRecord) {
      throw new PigeDomainError("proposal.source_missing", "The proposal source record was not found.");
    }
    assertProposalLogPath(vaultPath, path.join(vaultPath, "log.md"));

    try {
      const publication = await agentIngest.applyStagedProposal(
        vaultPath,
        sourceRecord,
        jobFile.job,
        proposal,
        {
          assertSourceCurrent: (expectedSource) => {
            assertActiveVault();
            const currentJob = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, jobId);
            if (!currentJob) {
              throw new PigeDomainError("proposal.parent_job_missing", "The proposal parent Job disappeared.");
            }
            assertProposalParentJob(currentJob.job, proposal, activeVault.vaultId);
            const currentSource = readSourceRecord(vaultPath, expectedSource.id);
            if (!currentSource || sourceRecordRevision(currentSource) !== sourceRecordRevision(expectedSource)) {
              throw new PigeDomainError(
                "agent_ingest.source_changed",
                "The proposal source evidence changed before apply."
              );
            }
          },
          onPublicationStart: (checkpointId) => {
            markProposalApplyStarted(
              this.#jobRecordStore(vaultPath),
              vaultPath,
              jobFile.job,
              proposal.id,
              checkpointId
            );
          }
        }
      );
      assertActiveVault();
      const applied = proposals.markApplied(proposal.id);
      if (applied.status !== "applied" || !applied.proposal) {
        throw new PigeDomainError("proposal.write_failed", "The applied proposal state could not be committed.");
      }
      appendProposalApplyLog(vaultPath, applied.proposal);
      this.#finalizeProposalJob(applied.proposal, "applied", publication);
      return applied;
    } catch (caught) {
      if (!isProposalApplyConflict(caught)) throw caught;
      const conflicted = proposals.markConflicted(proposal.id);
      if (conflicted.proposal) {
        markProposalJobConflicted(this.#jobRecordStore(vaultPath), vaultPath, jobFile.job, conflicted.proposal);
      }
      return conflicted;
    }
  }

  #assertProposalParentReady(proposal: ConfirmationProposal): void {
    const vaultPath = this.#requireActiveVaultPath();
    const activeVault = this.#vaults.current();
    if (!activeVault || !proposal.jobId) {
      throw new PigeDomainError("proposal.parent_job_missing", "The proposal parent Job was not found.");
    }
    const jobFile = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, proposal.jobId);
    if (!jobFile) {
      throw new PigeDomainError("proposal.parent_job_missing", "The proposal parent Job was not found.");
    }
    assertProposalParentJob(jobFile.job, proposal, activeVault.vaultId);
  }

  #finalizeConflictedProposalJob(proposal: ConfirmationProposal): JobRecord {
    const vaultPath = this.#requireActiveVaultPath();
    const activeVault = this.#vaults.current();
    if (!activeVault || !proposal.jobId || !isSupportedAgentCreateProposal(proposal)) {
      throw new PigeDomainError(
        "proposal.parent_job_missing",
        "The conflicted proposal parent Job was not found."
      );
    }
    const jobFile = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, proposal.jobId);
    if (!jobFile) {
      throw new PigeDomainError(
        "proposal.parent_job_missing",
        "The conflicted proposal parent Job was not found."
      );
    }
    assertProposalParentJob(jobFile.job, proposal, activeVault.vaultId, true);
    if (
      jobFile.job.state === "failed_final" &&
      jobFile.job.message === proposalConflictMessage()
    ) {
      return jobFile.job;
    }
    if (jobFile.job.state !== "awaiting_review") {
      throw new PigeDomainError(
        "proposal.parent_job_changed",
        "The conflicted proposal parent Job is no longer awaiting reconciliation."
      );
    }
    markProposalJobConflicted(this.#jobRecordStore(vaultPath), vaultPath, jobFile.job, proposal);
    const reconciled = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, proposal.jobId);
    if (
      !reconciled ||
      reconciled.job.state !== "failed_final" ||
      reconciled.job.message !== proposalConflictMessage()
    ) {
      throw new PigeDomainError(
        "proposal.parent_job_changed",
        "The conflicted proposal parent Job was not durably reconciled."
      );
    }
    return reconciled.job;
  }

  #finalizeProposalJob(
    proposal: ConfirmationProposal,
    outcome: "applied" | "rejected",
    publication?: AgentIngestPublishedResult
  ): JobRecord {
    const vaultPath = this.#vaults.activeVaultPath();
    const activeVault = this.#vaults.current();
    if (!vaultPath || !activeVault || !proposal.jobId) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is available for proposal resolution.");
    }
    const jobFile = readProposalParentJobRecord(this.#jobRecordStore(vaultPath), vaultPath, proposal.jobId);
    if (!jobFile) {
      throw new PigeDomainError("proposal.parent_job_missing", "The proposal parent Job was not found.");
    }
    assertProposalParentJob(jobFile.job, proposal, activeVault.vaultId, true);
    const target = outcome === "applied" ? requireProposalPageTarget(proposal) : undefined;
    if (outcome === "applied") {
      if (!this.#agentIngest) {
        throw new PigeDomainError("proposal.runtime_unavailable", "Proposal recovery is unavailable.");
      }
      this.#agentIngest.verifyAppliedProposalEffects(vaultPath, jobFile.job, proposal);
    }
    const recoveredOperationId = outcome === "applied"
      ? requireProposalApplyOperation(vaultPath, proposal, jobFile.job).id
      : undefined;
    const reviewRequired = publication?.reviewRequired ?? proposalContentNeedsReview(proposal);
    const desiredState = outcome === "applied"
      ? reviewRequired ? "completed_with_warnings" : "completed"
      : "completed_with_warnings";
    if (
      ["completed", "completed_with_warnings"].includes(jobFile.job.state) &&
      jobFile.job.message === proposalResolutionMessage(outcome, reviewRequired)
    ) {
      return jobFile.job;
    }
    if (jobFile.job.state !== "awaiting_review") {
      throw new PigeDomainError(
        "proposal.parent_job_changed",
        "The proposal parent Job is no longer awaiting this review decision."
      );
    }
    const operationIds = Array.from(new Set([
      ...(jobFile.job.operationIds ?? []),
      ...(publication?.operationIds ?? []),
      ...(recoveredOperationId ? [recoveredOperationId] : [])
    ]));
    const proposalApplyOperationIds = [publication?.operationId, recoveredOperationId]
      .filter((operationId): operationId is string => Boolean(operationId));
    const outputRefs = [...(jobFile.job.outputRefs ?? [])];
    const pageId = publication?.pageId ?? target?.id;
    const pagePath = publication?.pagePath ?? target?.path;
    if (pageId && !outputRefs.some((ref) => ref.kind === "page" && ref.id === pageId)) {
      outputRefs.push({
        kind: "page",
        id: pageId,
        ...(pagePath ? { path: pagePath } : {}),
        role: "applied_proposal_target"
      });
    }
    for (const operationId of proposalApplyOperationIds) {
      if (!outputRefs.some((ref) => ref.kind === "operation" && ref.id === operationId)) {
        outputRefs.push({ kind: "operation", id: operationId, role: "proposal_apply_audit" });
      }
    }
    const now = new Date().toISOString();
    const proposalCheckpointId = `proposal_apply:${proposal.id}`;
    const proposalCheckpoint = jobFile.job.checkpoints?.find(
      (checkpoint) => checkpoint.id === proposalCheckpointId
    );
    const checkpoints = outcome === "applied"
      ? [
          ...(jobFile.job.checkpoints ?? []).filter((checkpoint) => checkpoint.id !== proposalCheckpointId),
          {
            id: proposalCheckpointId,
            step: proposalCheckpoint?.step ?? "agent_proposal_apply_started",
            state: "done" as const,
            startedAt: proposalCheckpoint?.startedAt ?? proposal.decision?.decidedAt ?? proposal.updatedAt,
            finishedAt: now,
            inputRefs: [{ kind: "proposal" as const, id: proposal.id }],
            outputRefs: [
              ...(pageId ? [{ kind: "page" as const, id: pageId, ...(pagePath ? { path: pagePath } : {}) }] : []),
              ...proposalApplyOperationIds.map((operationId) => ({
                kind: "operation" as const,
                id: operationId,
                role: "proposal_apply_audit"
              }))
            ]
          }
        ]
      : jobFile.job.checkpoints;
    const resolved = JobRecordSchema.parse({
      ...jobFile.job,
      state: desiredState,
      stage: "writing",
      updatedAt: now,
      finishedAt: now,
      outputRefs,
      operationIds,
      ...(checkpoints ? { checkpoints } : {}),
      progress: {
        completedUnits: 1,
        totalUnits: 1,
        unit: outcome === "applied" ? "page" : "proposal"
      },
      message: proposalResolutionMessage(outcome, reviewRequired)
    });
    return this.#replaceExpectedJob(jobFile, resolved);
  }

  async #runAgentSelectedParseTool(
    vaultPath: string,
    parentJob: JobRecord,
    request: AgentIngestParseToolRequest,
    parentControl: JobExecutionControl
  ): Promise<AgentIngestParseToolExecution> {
    assertAgentParseToolRequest(parentJob, request);
    const currentParentSnapshot = this.#readJobSnapshot(vaultPath, parentJob.id);
    const currentParent = currentParentSnapshot
      ? { path: currentParentSnapshot.path, job: currentParentSnapshot.job }
      : undefined;
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
    if (currentParent.job.state !== "running" || !isAgentKnowledgeTurn(currentParent.job)) {
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
      this.#jobRecordStore(vaultPath),
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
      child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;
    }
    parentControl.markDurableCheckpoint("agent_parse_child_publication_started");
    await this.processQueuedParses({
      jobIds: [child.id],
      limit: 1,
      abortSignal: request.signal
    });
    child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;

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

  async #runAgentSelectedDatasetTool(
    vaultPath: string,
    parentJob: JobRecord,
    request: AgentIngestDatasetToolRequest,
    parentControl: JobExecutionControl
  ): Promise<AgentIngestDatasetToolExecution> {
    assertAgentDatasetToolRequest(parentJob, request);
    const currentParentSnapshot = this.#readJobSnapshot(vaultPath, parentJob.id);
    const currentParent = currentParentSnapshot
      ? { path: currentParentSnapshot.path, job: currentParentSnapshot.job }
      : undefined;
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
    if (currentParent.job.state !== "running" || !isAgentKnowledgeTurn(currentParent.job)) {
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
      throw new PigeDomainError("agent_ingest.source_changed", "The selected source changed before Dataset dispatch.");
    }
    if (!supportsAgentSelectedDataset(sourceFile.sourceRecord.kind)) {
      throw new PigeDomainError(
        "dataset.unsupported_source",
        "The Agent-selected Dataset tool does not support this preserved source type."
      );
    }

    const datasetReady = Boolean(this.#datasets?.canMaterialize(sourceFile.sourceRecord.kind));
    let child = ensureAgentDatasetToolJob(
      this.#jobRecordStore(vaultPath),
      vaultPath,
      currentParent.job,
      sourceFile.sourceRecord,
      request,
      datasetReady ? "queued" : "waiting_dependency"
    );
    if (child.state === "completed" || child.state === "completed_with_warnings") {
      markAgentDatasetOutputDurable(parentControl);
      return createAgentDatasetToolExecution(child, sourceFile.sourceRecord, "reused");
    }
    if (!datasetReady) {
      return createAgentDatasetToolExecution(
        child,
        sourceFile.sourceRecord,
        "waiting_dependency",
        "dataset_materializer_unavailable"
      );
    }
    if (child.state === "failed_final") {
      throw new PigeDomainError("dataset.tool_failed_final", "The durable Dataset child cannot be retried safely.");
    }
    if (child.state === "running" || child.state === "cancel_requested") {
      throw new PigeDomainError(
        "dataset.tool_recovery_required",
        "The durable Dataset child requires startup recovery before reuse."
      );
    }
    if (child.state !== "queued") {
      const retry = this.retry({ jobId: child.id });
      if (retry.status !== "requeued" || !retry.job) {
        throw new PigeDomainError("dataset.tool_retry_failed", "The durable Dataset child could not be requeued.");
      }
      child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;
    }
    await this.processQueuedDatasetImports({
      jobIds: [child.id],
      limit: 1,
      abortSignal: request.signal
    });
    child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;
    const refreshedSource = readSourceRecord(vaultPath, sourceFile.sourceRecord.id) ?? sourceFile.sourceRecord;
    if (child.state === "completed" || child.state === "completed_with_warnings") {
      markAgentDatasetOutputDurable(parentControl);
      return createAgentDatasetToolExecution(child, refreshedSource, "materialized");
    }
    if (child.state === "waiting_dependency") {
      return createAgentDatasetToolExecution(
        child,
        refreshedSource,
        "waiting_dependency",
        "dataset_materializer_unavailable"
      );
    }
    if (request.signal.aborted || child.state === "cancelled" || child.state === "cancel_requested") {
      throw new JobCancellationError({
        durableWritesApplied: child.cancellation?.durableWritesApplied === true,
        ...(child.cancellation?.safeCheckpointId ? { safeCheckpointId: child.cancellation.safeCheckpointId } : {})
      });
    }
    if (child.state === "failed_final") {
      throw new PigeDomainError("dataset.tool_failed_final", "The durable Dataset child failed validation.");
    }
    throw new PigeDomainError("dataset.tool_failed_retryable", "The durable Dataset child remains retryable.");
  }

  async #runAgentSelectedOcrTool(
    vaultPath: string,
    parentJob: JobRecord,
    request: AgentIngestOcrToolRequest,
    parentControl: JobExecutionControl
  ): Promise<AgentIngestOcrToolExecution> {
    assertAgentOcrToolRequest(parentJob, request);
    const currentParentSnapshot = this.#readJobSnapshot(vaultPath, parentJob.id);
    const currentParent = currentParentSnapshot
      ? { path: currentParentSnapshot.path, job: currentParentSnapshot.job }
      : undefined;
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
    if (currentParent.job.state !== "running" || !isAgentKnowledgeTurn(currentParent.job)) {
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
      this.#jobRecordStore(vaultPath),
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
      child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;
    }
    parentControl.markDurableCheckpoint("agent_ocr_child_publication_started");
    await this.processQueuedOcr({
      jobIds: [child.id],
      limit: 1,
      abortSignal: request.signal
    });
    child = this.#readJobSnapshot(vaultPath, child.id)?.job ?? child;

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
    const jobFiles = findQueuedIndexRebuildJobFiles(this.#jobRecordStore(vaultPath), vaultPath, request);
    let completed = 0;
    let failed = 0;
    let lastRebuild: LocalDatabaseRebuildResult | undefined;

    for (const jobFile of jobFiles) {
      const database = this.#database;
      if (!database) {
        this.#markJobWaitingDependency(jobFile.path, jobFile.job, "Waiting for the Local Database Service before index rebuild.");
        failed += 1;
        continue;
      }

      const execution = this.#beginCooperativeExecution(
        jobFile,
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
          this.#markJobCancellationOutcome(jobFile.path, runningJob, cancellation);
        } else if (isJobMutationContention(caught)) {
          // Another exact Job revision won; do not overwrite its authoritative state.
        } else {
          this.#markJobFailedRetryable(
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
    this.#assertWriterLease(vaultPath);
    return vaultPath;
  }

  #assertWriterLease(vaultPath: string): void {
    this.#vaults.assertWriterLease?.(vaultPath);
  }

  #jobRecordStore(vaultPath: string): JobRecordStore {
    const rootPath = path.join(vaultPath, ".pige", "jobs");
    const existing = this.#jobRecordStores.get(rootPath);
    if (existing) return existing;
    const store = this.#vaults.assertWriterLease
      ? new JobRecordStore({
          rootPath,
          assertWriterLease: () => this.#assertWriterLease(vaultPath)
        })
      : new JobRecordStore({ rootPath, unsafeAllowUnfenced: true });
    this.#jobRecordStores.set(rootPath, store);
    return store;
  }

  #readJobSnapshot(vaultPath: string, jobId: string): JobRecordSnapshot | undefined {
    if (!/^job_\d{8}_[a-z0-9]{8,}$/.test(jobId)) return undefined;
    try {
      return this.#jobRecordStore(vaultPath).read(createJobRecordPath(vaultPath, jobId));
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "job.record_not_found") return undefined;
      throw caught;
    }
  }

  #replaceJob(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot {
    return this.#jobRecordStore(this.#requireActiveVaultPath()).compareAndSwap(snapshot, next);
  }

  #createJob(jobPath: string, job: JobRecord): JobRecord {
    const vaultPath = this.#requireActiveVaultPath();
    return this.#jobRecordStore(vaultPath).createIfAbsent(jobPath, job).job;
  }

  #mutateJob(
    jobPath: string,
    transform: (current: JobRecord) => JobRecord
  ): JobRecord {
    const vaultPath = this.#requireActiveVaultPath();
    const store = this.#jobRecordStore(vaultPath);
    const snapshot = store.read(jobPath);
    return store.compareAndSwap(snapshot, transform(snapshot.job)).job;
  }

  #replaceExpectedJob(snapshot: JobRecordSnapshot, next: JobRecord): JobRecord {
    return this.#replaceJob(snapshot, next).job;
  }

  #markJobCancellationOutcome(
    filePath: string,
    fallback: JobRecord,
    cancellation: JobCancellationError
  ): JobRecord {
    return this.#mutateJob(filePath, (current) => createJobCancellationOutcome(current, fallback, cancellation));
  }

  #markJobFailedRetryable(
    filePath: string,
    fallback: JobRecord,
    message: string,
    durableState?: JobDurableWriteState,
    error?: PigeErrorSummary
  ): JobRecord {
    return this.#mutateJob(filePath, (current) => JobRecordSchema.parse({
      ...withDurableWriteState(current.id === fallback.id ? current : fallback, durableState),
      state: "failed_retryable",
      updatedAt: new Date().toISOString(),
      message,
      ...(error ? { error } : {})
    }));
  }

  #markJobWaitingDependency(
    filePath: string,
    fallback: JobRecord,
    message: string,
    durableState?: JobDurableWriteState
  ): JobRecord {
    return this.#mutateJob(filePath, (current) => JobRecordSchema.parse({
      ...withDurableWriteState(current.id === fallback.id ? current : fallback, durableState),
      state: "waiting_dependency",
      updatedAt: new Date().toISOString(),
      message
    }));
  }

  #markJobWaitingModelEgress(
    filePath: string,
    fallback: JobRecord,
    requestId: string,
    message: string,
    durableState?: JobDurableWriteState
  ): JobRecord {
    return this.#mutateJob(filePath, (current) => JobRecordSchema.parse({
      ...withDurableWriteState(current.id === fallback.id ? current : fallback, durableState),
      state: "waiting_model_egress",
      stage: "waiting_for_model",
      updatedAt: new Date().toISOString(),
      error: {
        code: "model_provider.egress_confirmation_required",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "confirm_model_egress",
        modelEgressApprovalRequestId: requestId
      },
      message
    }));
  }

  #markJobFailedFinal(
    filePath: string,
    fallback: JobRecord,
    message: string,
    durableState?: JobDurableWriteState
  ): JobRecord {
    return this.#mutateJob(filePath, (current) => JobRecordSchema.parse({
      ...withDurableWriteState(current.id === fallback.id ? current : fallback, durableState),
      state: "failed_final",
      updatedAt: new Date().toISOString(),
      message
    }));
  }

  #requireActiveVaultId(expectedVaultPath: string): string {
    const activeVault = this.#vaults.current();
    if (!activeVault || this.#vaults.activeVaultPath() !== expectedVaultPath) {
      throw new PigeDomainError("vault_missing", "The active Pige vault changed during Job creation.");
    }
    return activeVault.vaultId;
  }

  #requireModelEgressApprovals(): ModelEgressApprovalService {
    if (!this.#modelEgressApprovals) {
      throw new PigeDomainError(
        "model_egress.approval_store_invalid",
        "The model egress approval service is unavailable."
      );
    }
    return this.#modelEgressApprovals;
  }

  #requirePermissionBroker(): PermissionBrokerService {
    if (!this.#permissionBroker) {
      throw new PigeDomainError(
        "permission.store_invalid",
        "The Permission Broker service is unavailable."
      );
    }
    return this.#permissionBroker;
  }

  #beginCooperativeExecution(
    snapshot: JobRecordSnapshot,
    stage: JobStage,
    message: string
  ): { readonly job: JobRecord; readonly controller: AbortController; readonly control: JobExecutionControl } {
    return this.#beginExecution(snapshot, stage, message, true);
  }

  #beginNonCooperativeExecution(
    snapshot: JobRecordSnapshot,
    stage: JobStage,
    message: string
  ): { readonly job: JobRecord; readonly control: JobExecutionControl } {
    const execution = this.#beginExecution(snapshot, stage, message, false);
    return { job: execution.job, control: execution.control };
  }

  #beginExecution(
    snapshot: JobRecordSnapshot,
    stage: JobStage,
    message: string,
    cooperative: boolean
  ): { readonly job: JobRecord; readonly controller: AbortController; readonly control: JobExecutionControl } {
    const { path: jobPath, job } = snapshot;
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
    let committed: JobRecord;
    try {
      committed = this.#replaceExpectedJob(snapshot, runningJob);
    } catch (caught) {
      if (cooperative) this.#activeExecutions.delete(job.id);
      throw caught;
    }
    return {
      job: committed,
      controller,
      control: new FileBackedJobExecutionControl(
        this.#jobRecordStore(this.#requireActiveVaultPath()),
        jobPath,
        controller,
        {
        durableWritesApplied: preserveDurableWrites
        }
      )
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
    return this.#mutateJob(jobPath, (current) => {
      if (current.id !== fallback.id || !["running", "cancel_requested"].includes(current.state)) {
        throw new PigeDomainError("job.revision_conflict", "The active Job cannot be completed from its current state.");
      }
      const cancellationArrived = current.state === "cancel_requested";
      const durableWritesApplied = current.cancellation?.durableWritesApplied === true ||
        durableState.durableWritesApplied;
      const mergedOperationIds = Array.from(new Set([...(current.operationIds ?? []), ...operationIds]));
      const progress = completedProgress(current.progress, defaultUnit);
      const finishedAt = new Date().toISOString();
      if (cancellationArrived && !durableWritesApplied) {
        return JobRecordSchema.parse({
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
      }
      return JobRecordSchema.parse({
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
    });
  }

  #finishCooperativeExecution(jobId: string, controller: AbortController): void {
    if (this.#activeExecutions.get(jobId) === controller) this.#activeExecutions.delete(jobId);
  }
}

function markAgentDatasetOutputDurable(control: JobExecutionControl): void {
  const safeCheckpointId = "agent_dataset_child_output_adoption_started";
  control.throwIfCancellationRequested({ durableWritesApplied: true, safeCheckpointId });
  control.markDurableCheckpoint(safeCheckpointId);
}

class FileBackedJobExecutionControl implements JobExecutionControl {
  readonly signal: AbortSignal;
  readonly #store: JobRecordStore;
  readonly #jobPath: string;
  #durableWritesApplied: boolean;
  #durableCheckpointId: string | undefined;

  constructor(
    store: JobRecordStore,
    jobPath: string,
    controller: AbortController,
    initialState: JobDurableWriteState
  ) {
    this.#store = store;
    this.#jobPath = jobPath;
    this.signal = controller.signal;
    this.#durableWritesApplied = initialState.durableWritesApplied;
    this.#durableCheckpointId = initialState.safeCheckpointId;
  }

  throwIfCancellationRequested(boundary: JobCancellationBoundary = {}): void {
    const current = this.#readCurrent();
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
    const snapshot = this.#store.read(this.#jobPath);
    const current = snapshot.job;
    if (current.state !== "running") {
      throw new Error("Job progress can only be recorded for the active running job.");
    }
    const nextProgress = normalizeProgress(current.progress, progress);
    this.#store.compareAndSwap(snapshot, JobRecordSchema.parse({
      ...current,
      progress: nextProgress,
      updatedAt: new Date().toISOString()
    }));
  }

  markDurableCheckpoint(checkpointId: string): void {
    if (!checkpointId) throw new Error("A durable checkpoint id is required.");
    const snapshot = this.#store.read(this.#jobPath);
    const current = snapshot.job;
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
    this.#store.compareAndSwap(snapshot, guardedJob);
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

  #readCurrent(): JobRecord | undefined {
    try {
      return this.#store.read(this.#jobPath).job;
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "job.record_not_found") return undefined;
      throw caught;
    }
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

function createJobCancellationOutcome(
  current: JobRecord,
  fallback: JobRecord,
  cancellation: JobCancellationError
): JobRecord {
  const authoritative = current.id === fallback.id ? current : fallback;
  const finishedAt = new Date().toISOString();
  const durableWritesApplied = authoritative.cancellation?.durableWritesApplied === true || cancellation.durableWritesApplied;
  const safeCheckpointId = cancellation.safeCheckpointId ??
    authoritative.cancellation?.safeCheckpointId ??
    (durableWritesApplied ? undefined : "before_durable_write");
  return JobRecordSchema.parse({
    ...authoritative,
    state: durableWritesApplied ? "failed_retryable" : "cancelled",
    updatedAt: finishedAt,
    finishedAt,
    cancellation: {
      ...authoritative.cancellation,
      requestedAt: authoritative.cancellation?.requestedAt ?? finishedAt,
      requestedBy: authoritative.cancellation?.requestedBy ?? "system",
      ...(safeCheckpointId ? { safeCheckpointId } : {}),
      durableWritesApplied
    },
    message: durableWritesApplied
      ? "A retained action-safety guard prevents clean cancellation; the job remains retryable."
      : "Job cancelled at a safe checkpoint. Preserved source data remains in the vault."
  });
}

function canRunAgentIngest(agentIngest: AgentIngestService | undefined): boolean {
  try {
    return Boolean(agentIngest?.hasDefaultModel());
  } catch {
    return false;
  }
}

function isJobMutationContention(value: unknown): boolean {
  return value instanceof PigeDomainError && new Set([
    "job.revision_conflict",
    "job.claim_conflict",
    "job.claim_lost"
  ]).has(value.code);
}

function isAgentKnowledgeTurn(job: JobRecord): boolean {
  return job.class === "agent_ingest" || job.class === "agent_turn";
}

function hasDatasetQueryContinuationRefs(job: JobRecord): boolean {
  if (job.class !== "agent_turn" || !job.sourceId) return false;
  const datasetRefs = (job.outputRefs ?? []).filter(
    (ref) => ref.kind === "dataset" && ref.role === "agent_dataset" && Boolean(ref.id)
  );
  const revisionRefs = (job.outputRefs ?? []).filter(
    (ref) => ref.kind === "dataset_revision" && ref.role === "agent_dataset_revision" && Boolean(ref.id)
  );
  return datasetRefs.length === 1 && revisionRefs.length === 1;
}

function isDatasetQueryContinuationTurn(job: JobRecord): boolean {
  return hasDatasetQueryContinuationRefs(job) && job.stage === "planning";
}

function isQueuedHomeAgentTurn(job: JobRecord): boolean {
  return job.class === "agent_turn" &&
    job.state === "queued" &&
    (job.sourceId === undefined || isDatasetQueryContinuationTurn(job));
}

function findQueuedCaptureJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedCapturesRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter((jobFile) => jobFile.job.class === "capture" && jobFile.job.state === "queued")
      .slice(0, limit);
  }

  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
    .filter((jobFile) => jobFile.job.class === "capture" && jobFile.job.state === "queued")
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedAgentIngestJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedAgentIngestRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter((jobFile) =>
        isAgentKnowledgeTurn(jobFile.job) &&
        jobFile.job.state === "queued" &&
        Boolean(jobFile.job.sourceId) &&
        !isDatasetQueryContinuationTurn(jobFile.job)
      )
      .filter((jobFile) => sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false))
      .slice(0, limit);
  }

  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
    .filter((jobFile) =>
      isAgentKnowledgeTurn(jobFile.job) &&
      jobFile.job.state === "queued" &&
      Boolean(jobFile.job.sourceId) &&
      !isDatasetQueryContinuationTurn(jobFile.job)
    )
    .filter((jobFile) => sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false))
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedParseJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedParsesRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  const matches = (jobFile: JobRecordFile): boolean =>
    jobFile.job.class === "parse" &&
    jobFile.job.state === "queued" &&
    (sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false));
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter(matches)
      .slice(0, limit);
  }

  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
    .filter(matches)
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedDatasetImportJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedDatasetImportsRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  const matches = (jobFile: JobRecordFile): boolean =>
    jobFile.job.class === "dataset_import" &&
    jobFile.job.state === "queued" &&
    (sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false));
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter(matches)
      .slice(0, limit);
  }
  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
    .filter(matches)
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedOcrJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedOcrRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  const sourceIds = new Set(request.sourceIds ?? []);
  const matches = (jobFile: JobRecordFile): boolean =>
    jobFile.job.class === "ocr" &&
    jobFile.job.state === "queued" &&
    (sourceIds.size === 0 || (jobFile.job.sourceId ? sourceIds.has(jobFile.job.sourceId) : false));
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter(matches)
      .slice(0, limit);
  }
  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
    .filter(matches)
    .sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt))
    .slice(0, limit);
}

function findQueuedIndexRebuildJobFiles(
  store: JobRecordStore,
  vaultPath: string,
  request: ProcessQueuedIndexRebuildRequest
): JobRecordFile[] {
  const limit = clampLimit(request.limit);
  if (request.jobIds && request.jobIds.length > 0) {
    return request.jobIds
      .map((jobId) => readJobRecordFile(store, vaultPath, jobId))
      .filter((jobFile): jobFile is JobRecordFile => Boolean(jobFile))
      .filter((jobFile) => jobFile.job.class === "index_rebuild" && jobFile.job.state === "queued")
      .slice(0, limit);
  }

  return readJobRecordFiles(store, path.join(vaultPath, ".pige", "jobs"))
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

function readJobRecordFiles(store: JobRecordStore, root: string): JobRecordFile[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const jobs: JobRecordFile[] = [];
  for (const filePath of listJsonFiles(root)) {
    try {
      jobs.push(store.read(filePath));
    } catch {
      // Invalid records are surfaced through list(); processing skips them.
    }
  }
  return jobs;
}

function readJobRecordFile(
  store: JobRecordStore,
  vaultPath: string,
  jobId: string
): JobRecordFile | undefined {
  if (!/^job_\d{8}_[a-z0-9]{8,}$/.test(jobId)) return undefined;
  const jobPath = createJobRecordPath(vaultPath, jobId);
  if (!fs.existsSync(jobPath)) return undefined;

  try {
    return store.read(jobPath);
  } catch {
    return undefined;
  }
}

function readProposalParentJobRecord(
  store: JobRecordStore,
  vaultPath: string,
  jobId: string
): JobRecordFile | undefined {
  if (!/^job_\d{8}_[a-z0-9]{8,}$/.test(jobId)) return undefined;
  const jobPath = createJobRecordPath(vaultPath, jobId);
  try {
    return store.read(jobPath);
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "job.record_not_found") return undefined;
    throw new PigeDomainError(
      "proposal.parent_job_changed",
      "The proposal parent Job record is invalid."
    );
  }
}

function createJobRecordPath(vaultPath: string, jobId: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1];
  if (!dateKey) {
    throw new PigeDomainError("rag.job_binding_invalid", "The Home Agent Job ID is invalid.");
  }
  return path.join(vaultPath, ".pige", "jobs", dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
}

function createAgentTurnSourceId(jobId: string): string {
  const match = /^job_(\d{8})_([a-z0-9]{8,})$/u.exec(jobId);
  if (!match) {
    throw new PigeDomainError("agent_runtime.turn_invalid", "The unified Agent turn Job identity is invalid.");
  }
  return `src_${match[1]}_${match[2]}`;
}

function createAgentTurnJobId(conversationEventId: string): string {
  const match = /^evt_(\d{8})_[a-z0-9]{8,}$/u.exec(conversationEventId);
  if (!match) {
    throw new PigeDomainError("agent_runtime.turn_invalid", "The unified Agent conversation identity is invalid.");
  }
  const suffix = createHash("sha256")
    .update(`pige.agent_turn.job.v1\0${conversationEventId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `job_${match[1]}_${suffix}`;
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

type JobRef = NonNullable<JobRecord["inputRefs"]>[number];
type JobCheckpoint = NonNullable<JobRecord["checkpoints"]>[number];

function createPermissionBindingRef(requestId: string, bindingHash: string): JobRef {
  return {
    kind: "tool",
    id: requestId,
    checksum: bindingHash,
    role: "permission_action_binding"
  };
}

function permissionCheckpointId(requestId: string): string {
  return `permission_action:${requestId}`;
}

function permissionCheckpoint(job: JobRecord, requestId: string): JobCheckpoint | undefined {
  return job.checkpoints?.find((checkpoint) => checkpoint.id === permissionCheckpointId(requestId));
}

function uncompletedConsumedPermissionRequestId(job: JobRecord): string | undefined {
  return job.permissionRequestIds?.find((requestId) => {
    const checkpoint = permissionCheckpoint(job, requestId);
    return checkpoint?.state === "running" &&
      checkpoint.resumeHint === "do_not_replay_without_completion_marker";
  });
}

function jobHasPermissionBinding(job: JobRecord, requestId: string, bindingHash: string): boolean {
  return job.permissionRequestIds?.includes(requestId) === true &&
    job.inputRefs?.some((reference) =>
      reference.kind === "tool" &&
      reference.id === requestId &&
      reference.role === "permission_action_binding" &&
      reference.checksum === bindingHash
    ) === true;
}

function permissionDecisionApplied(
  job: JobRecord,
  record: PermissionActionLifecycleRecord
): boolean {
  if (!jobHasPermissionBinding(job, record.id, record.binding.bindingHash)) return false;
  if (record.state === "denied") {
    return job.state === "failed_final" && job.error?.permissionRequestId === record.id;
  }
  if (record.state === "approved") {
    return (job.state === "queued" || job.state === "running") &&
      job.error?.permissionRequestId === undefined;
  }
  return record.state === "consumed" && job.state === "running";
}

function readPermissionCompletionMarker(
  job: JobRecord,
  requestId: string,
  bindingHash: string
): string | undefined {
  if (!jobHasPermissionBinding(job, requestId, bindingHash)) return undefined;
  const checkpoint = permissionCheckpoint(job, requestId);
  if (checkpoint?.state !== "done" || !checkpoint.checksumAfter) return undefined;
  const outputMarker = checkpoint.outputRefs.find((reference) =>
    reference.kind === "tool" &&
    reference.role === "permission_action_completion" &&
    reference.checksum === checkpoint.checksumAfter
  );
  return outputMarker?.checksum;
}

function mergeJobRefs(existing: readonly JobRef[], additions: readonly JobRef[]): JobRef[] {
  const merged = new Map<string, JobRef>();
  for (const reference of [...existing, ...additions]) {
    const key = [
      reference.kind,
      reference.id ?? "",
      reference.role ?? "",
      reference.checksum ?? "",
      reference.locator ?? ""
    ].join(":");
    merged.set(key, reference);
  }
  return [...merged.values()];
}

function upsertPermissionCheckpoint(
  existing: readonly JobCheckpoint[],
  next: JobCheckpoint
): JobCheckpoint[] {
  return [...existing.filter((checkpoint) => checkpoint.id !== next.id), next];
}

function permissionUsesNetwork(capability: PermissionCapability): boolean {
  return capability === "external_network" ||
    capability === "use_brokered_credential" ||
    capability === "install_package" ||
    capability === "install_local_tool";
}

function toJobSummary(vaultPath: string, job: JobRecord): JobSummary {
  const sourceRecord = job.sourceId ? readSourceRecord(vaultPath, job.sourceId) : undefined;
  const backupKind = job.class === "backup"
    ? job.inputRefs?.some((ref) => ref.role === "backup_destination")
      ? "user_backup"
      : job.inputRefs?.some((ref) => ref.role === "rollback_backup_destination")
        ? "restore_rollback"
        : undefined
    : undefined;
  return {
    id: job.id,
    class: job.class,
    state: job.state,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.sourceId ? { sourceId: job.sourceId } : {}),
    ...(job.captureId ? { captureId: job.captureId } : {}),
    ...(job.conversationEventId ? { conversationEventId: job.conversationEventId } : {}),
    ...(job.error?.modelEgressApprovalRequestId
      ? { modelEgressApprovalRequestId: job.error.modelEgressApprovalRequestId }
      : {}),
    ...(job.error?.permissionRequestId
      ? { permissionRequestId: job.error.permissionRequestId }
      : {}),
    ...(sourceRecord?.kind ? { sourceKind: sourceRecord.kind } : {}),
    ...(sourceRecord ? { sourceDisplayName: sourceRecord.original?.displayName ?? sourceRecord.kind } : {}),
    ...(backupKind ? { backupKind } : {}),
    ...(job.error ? { error: job.error } : {}),
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function readPreservedAgentTurn(vaultPath: string, job: JobRecord): PreservedAgentTurn {
  const reference = job.inputRefs?.find(
    (candidate) => candidate.kind === "conversation" &&
      candidate.role === "agent_turn_user_event" &&
      candidate.id === job.conversationEventId
  );
  if (!job.conversationEventId || !reference?.locator || !reference.checksum) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The source Agent turn lacks its durable user-event binding.");
  }
  return new AgentTurnConversationStore().readUserTurn(
    vaultPath,
    reference.locator,
    job.conversationEventId,
    reference.checksum
  );
}

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord | undefined {
  return readSourceRecordFile(vaultPath, sourceId)?.sourceRecord;
}

function readSourceRecordFile(vaultPath: string, sourceId: string): { path: string; sourceRecord: SourceRecord } | undefined {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const relativePath = [".pige", "source-records", dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`].join("/");
  const sourceRecordPath = path.join(vaultPath, ...relativePath.split("/"));
  try {
    const bytes = readConfinedDurableRecord(
      vaultPath,
      path.join(vaultPath, ".pige", "source-records"),
      sourceRecordPath,
      2 * 1024 * 1024
    );
    if (bytes === undefined) return undefined;
    const parsed = SourceRecordSchema.safeParse(JSON.parse(bytes));
    return parsed.success ? { path: relativePath, sourceRecord: parsed.data } : undefined;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    return undefined;
  }
}

function readConfinedDurableRecord(
  vaultPath: string,
  durableRoot: string,
  filePath: string,
  maximumBytes: number,
  errorCode = "source.record_unsafe"
): string | undefined {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedRoot = path.resolve(durableRoot);
  const resolvedFile = path.resolve(filePath);
  if (
    !resolvedRoot.startsWith(`${resolvedVault}${path.sep}`) ||
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new PigeDomainError(errorCode, "The durable record path escapes its owned root.");
  }
  let current = resolvedVault;
  for (const component of path.relative(resolvedVault, path.dirname(resolvedFile)).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (caught) {
      if (isErrno(caught, "ENOENT")) return undefined;
      throw new PigeDomainError(errorCode, "A durable record parent cannot be inspected safely.");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError(errorCode, "A durable record parent is not a safe directory.");
    }
  }
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(resolvedFile);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw new PigeDomainError(errorCode, "The durable record cannot be inspected safely.");
  }
  if (
    !pathStatBefore.isFile() ||
    pathStatBefore.isSymbolicLink() ||
    pathStatBefore.nlink !== 1 ||
    pathStatBefore.size > maximumBytes
  ) {
    throw new PigeDomainError(errorCode, "The durable record is not a bounded private regular file.");
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const realFile = fs.realpathSync(resolvedFile);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new PigeDomainError(errorCode, "The durable record resolves outside its owned root.");
  }
  const descriptor = fs.openSync(resolvedFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameDurableFileRevision(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError(errorCode, "The durable record changed before it could be read.");
    }
    const buffer = Buffer.alloc(descriptorStatBefore.size);
    const bytesRead = descriptorStatBefore.size === 0
      ? 0
      : fs.readSync(descriptor, buffer, 0, descriptorStatBefore.size, 0);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    const pathStatAfter = fs.lstatSync(resolvedFile);
    if (
      bytesRead !== descriptorStatBefore.size ||
      !sameDurableFileRevision(descriptorStatBefore, descriptorStatAfter) ||
      !sameDurableFileRevision(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink() ||
      pathStatAfter.nlink !== 1
    ) {
      throw new PigeDomainError(errorCode, "The durable record changed while it was being read.");
    }
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function sameDurableFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}

function readProposalForDecision(
  proposals: ProposalService,
  proposalId: string
): ConfirmationProposal | undefined {
  try {
    return proposals.get({ proposalId }).proposal;
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "proposal.not_found") return undefined;
    throw caught;
  }
}

function isSupportedAgentCreateProposal(proposal: ConfirmationProposal): boolean {
  const operation = proposal.proposedOperations[0];
  const target = proposal.targetRefs[0];
  const decisionIsValid = proposal.state === "ready" || proposal.decision?.decidedBy === "user";
  return Boolean(
    proposal.jobId &&
    decisionIsValid &&
    proposal.trustLevel === "review_required" &&
    proposal.proposedOperations.length === 1 &&
    operation?.kind === "create" &&
    operation.path.startsWith("wiki/generated/") &&
    operation.path.endsWith(".md") &&
    proposal.targetRefs.length === 1 &&
    target?.kind === "page" &&
    target.path === operation.path &&
    Object.keys(proposal.baseHashes).length === 0
  );
}

function requireProposalPageTarget(
  proposal: ConfirmationProposal
): ConfirmationProposal["targetRefs"][number] {
  const target = proposal.targetRefs[0];
  if (!isSupportedAgentCreateProposal(proposal) || !target) {
    throw new PigeDomainError("proposal.not_allowed", "The proposal does not have one supported page target.");
  }
  return target;
}

function assertProposalParentJob(
  job: JobRecord,
  proposal: ConfirmationProposal,
  activeVaultId: string,
  allowResolved = false
): void {
  const target = requireProposalPageTarget(proposal);
  const allowedStates = allowResolved
    ? new Set<JobState>(["awaiting_review", "completed", "completed_with_warnings", "failed_final"])
    : new Set<JobState>(["awaiting_review"]);
  if (
    job.id !== proposal.jobId ||
    !isAgentKnowledgeTurn(job) ||
    job.activeVaultId !== activeVaultId ||
    !job.sourceId ||
    !allowedStates.has(job.state) ||
    !job.proposalIds?.includes(proposal.id) ||
    !job.outputRefs?.some((ref) => ref.kind === "proposal" && ref.id === proposal.id) ||
    !job.outputRefs?.some((ref) =>
      ref.kind === "page" && ref.id === target.id && ref.path === target.path
    ) ||
    !proposal.sourceRefs.some((ref) => ref.kind === "job" && ref.id === job.id) ||
    !proposal.sourceRefs.some((ref) => ref.kind === "source" && ref.id === job.sourceId)
  ) {
    throw new PigeDomainError(
      "proposal.parent_job_changed",
      "The proposal no longer matches its active vault, parent Job, source, or target."
    );
  }
}

function recordAgentNotePublicationCheckpoint(
  store: JobRecordStore,
  vaultPath: string,
  jobPath: string,
  checkpointId: string,
  binding: AgentIngestPublicationBinding
): void {
  if (binding.mutationKind === "update_page") {
    recordAgentPageUpdateCheckpoint(store, vaultPath, jobPath, checkpointId, binding);
    return;
  }
  const snapshot = store.read(jobPath);
  const current = snapshot.job;
  if (
    !current ||
    current.state !== "running" ||
    current.sourceId !== binding.sourceId ||
    current.policyContextId !== binding.policyContextId ||
    current.policyHash !== binding.policyHash
  ) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The active Agent Job cannot bind its generated-note publication."
    );
  }
  const matches = current.checkpoints?.filter((checkpoint) => checkpoint.id === checkpointId) ?? [];
  if (matches.length > 1) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The generated-note publication checkpoint is ambiguous."
    );
  }
  const existing = matches[0];
  const expectedInputRefs = [
    {
      kind: "source" as const,
      id: binding.sourceId,
      checksum: binding.sourceRevisionHash,
      role: "publication_source_revision"
    },
    {
      kind: "tool" as const,
      id: binding.policyContextId,
      checksum: binding.policyHash,
      role: "publication_policy"
    }
  ];
  const expectedOutputRefs = [
    {
      kind: "page" as const,
      id: binding.pageId,
      path: binding.pagePath,
      checksum: binding.contentHash,
      role: "expected_generated_note"
    },
    {
      kind: "operation" as const,
      id: binding.operationId,
      path: binding.operationPath,
      role: "expected_create_operation"
    }
  ];
  const exactExisting = existing && matchesAgentNotePublicationCheckpoint(
    existing,
    checkpointId,
    expectedInputRefs,
    expectedOutputRefs,
    binding.contentHash
  );
  const replaceUncommitted = existing && !exactExisting && canReplaceUncommittedAgentNoteCheckpoint(
    vaultPath,
    existing,
    checkpointId,
    expectedInputRefs,
    expectedOutputRefs,
    binding
  );
  if (existing && !exactExisting && !replaceUncommitted) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The generated-note publication checkpoint changed before commit."
    );
  }
  const now = new Date().toISOString();
  const checkpoint = {
    id: checkpointId,
    step: checkpointId,
    state: "running" as const,
    startedAt: replaceUncommitted ? now : existing?.startedAt ?? now,
    inputRefs: expectedInputRefs,
    outputRefs: expectedOutputRefs,
    checksumAfter: binding.contentHash,
    resumeHint: "Verify the exact generated-note bytes before adopting its create Operation."
  };
  store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...current,
    checkpoints: [
      ...(current.checkpoints ?? []).filter((candidate) => candidate.id !== checkpointId),
      checkpoint
    ],
    updatedAt: now
  }));
}

function recordAgentPageUpdateCheckpoint(
  store: JobRecordStore,
  vaultPath: string,
  jobPath: string,
  checkpointId: string,
  binding: Extract<AgentIngestPublicationBinding, { readonly mutationKind: "update_page" }>
): void {
  const snapshot = store.read(jobPath);
  const current = snapshot.job;
  if (
    checkpointId !== "agent_existing_note_update_started" ||
    !current ||
    current.state !== "running" ||
    current.sourceId !== binding.sourceId ||
    current.policyContextId !== binding.policyContextId ||
    current.policyHash !== binding.policyHash
  ) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The active Agent Job cannot bind its existing-note update."
    );
  }
  const expectedInputRefs = [
    {
      kind: "source" as const,
      id: binding.sourceId,
      checksum: binding.sourceRevisionHash,
      role: "publication_source_revision"
    },
    {
      kind: "tool" as const,
      id: binding.policyContextId,
      checksum: binding.policyHash,
      role: "publication_policy"
    },
    {
      kind: "tool" as const,
      id: `${binding.toolId}@${binding.toolVersion}`,
      checksum: binding.canonicalInputHash,
      role: "update_tool_input"
    },
    {
      kind: "tool" as const,
      id: "pige_agent_tool_catalog",
      checksum: binding.catalogHash,
      role: "agent_tool_catalog"
    },
    {
      kind: "tool" as const,
      id: "pi_tool_call_provenance",
      checksum: binding.toolCallProvenanceHash,
      role: "agent_tool_call_provenance"
    },
    {
      kind: "page" as const,
      id: binding.pageId,
      path: binding.pagePath,
      checksum: binding.beforeContentHash,
      role: "update_target_base"
    },
    ...(binding.relationshipTarget ? [{
      kind: "page" as const,
      id: binding.relationshipTarget.pageId,
      path: binding.relationshipTarget.pagePath,
      checksum: binding.relationshipTarget.contentHash,
      role: "relationship_target"
    }] : []),
    ...(binding.tagAdditions ?? []).map((tag) => ({
      kind: "tool" as const,
      id: tag,
      role: "tag_addition"
    })),
    {
      kind: "tool" as const,
      id: binding.modelProfileId,
      role: "update_model_profile"
    },
    ...binding.artifactIds.map((artifactId) => ({
      kind: "artifact" as const,
      id: artifactId,
      role: "update_evidence_artifact"
    }))
  ];
  const expectedOutputRefs = [
    {
      kind: "page" as const,
      id: binding.pageId,
      path: binding.pagePath,
      checksum: binding.contentHash,
      role: "expected_updated_note"
    },
    {
      kind: "page" as const,
      id: binding.pageId,
      path: binding.beforePath,
      checksum: binding.beforeContentHash,
      role: "preserved_update_before"
    },
    {
      kind: "page" as const,
      id: binding.pageId,
      path: binding.stagedPath,
      checksum: binding.contentHash,
      role: "staged_update_after"
    },
    {
      kind: "operation" as const,
      id: binding.operationId,
      path: binding.operationPath,
      role: "expected_update_operation"
    }
  ];
  if (
    readCheckpointFileHash(vaultPath, binding.pagePath, 1024 * 1024) !== binding.beforeContentHash ||
    readCheckpointFileHash(vaultPath, binding.stagedPath, 1024 * 1024) !== binding.contentHash
  ) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The staged existing-note update does not match its base or result hash."
    );
  }
  const matches = current.checkpoints?.filter((checkpoint) => checkpoint.id === checkpointId) ?? [];
  if (matches.length > 1) {
    throw new PigeDomainError("agent_ingest.page_conflict", "The existing-note update checkpoint is ambiguous.");
  }
  const existing = matches[0];
  if (existing && !matchesAgentNotePublicationCheckpoint(
    existing,
    checkpointId,
    expectedInputRefs,
    expectedOutputRefs,
    binding.contentHash
  )) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The existing-note update checkpoint changed before commit."
    );
  }
  const now = new Date().toISOString();
  const checkpoint = {
    id: checkpointId,
    step: checkpointId,
    state: "running" as const,
    startedAt: existing?.startedAt ?? now,
    inputRefs: expectedInputRefs,
    outputRefs: expectedOutputRefs,
    checksumBefore: binding.beforeContentHash,
    checksumAfter: binding.contentHash,
    resumeHint: "Verify the exact target, before-image, staged result, and update Operation before adoption."
  };
  store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...current,
    checkpoints: [
      ...(current.checkpoints ?? []).filter((candidate) => candidate.id !== checkpointId),
      checkpoint
    ],
    updatedAt: now
  }));
}

function readCheckpointFileHash(vaultPath: string, relativePath: string, maximumBytes: number): string | undefined {
  const absolutePath = resolveCheckpointPath(vaultPath, relativePath);
  try {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > maximumBytes) return undefined;
    const content = fs.readFileSync(absolutePath);
    const after = fs.lstatSync(absolutePath);
    if (
      after.isSymbolicLink() ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) return undefined;
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  } catch {
    return undefined;
  }
}

function canReplaceUncommittedAgentNoteCheckpoint(
  vaultPath: string,
  checkpoint: NonNullable<JobRecord["checkpoints"]>[number],
  checkpointId: string,
  expectedInputRefs: readonly NonNullable<JobRecord["inputRefs"]>[number][],
  expectedOutputRefs: readonly NonNullable<JobRecord["outputRefs"]>[number][],
  binding: AgentIngestPublicationBinding
): boolean {
  const existingPageRef = checkpoint.outputRefs.find((ref) => ref.role === "expected_generated_note");
  const existingOperationRef = checkpoint.outputRefs.find((ref) => ref.role === "expected_create_operation");
  const expectedPageRef = expectedOutputRefs.find((ref) => ref.role === "expected_generated_note");
  const expectedOperationRef = expectedOutputRefs.find((ref) => ref.role === "expected_create_operation");
  return checkpoint.step === checkpointId &&
    checkpoint.state === "running" &&
    checkpoint.inputRefs.length === expectedInputRefs.length &&
    expectedInputRefs.every((expected, index) => sameJobRef(checkpoint.inputRefs[index], expected)) &&
    checkpoint.outputRefs.length === expectedOutputRefs.length &&
    sameJobRefIgnoringChecksum(existingPageRef, expectedPageRef) &&
    expectedOperationRef !== undefined &&
    sameJobRef(existingOperationRef, expectedOperationRef) &&
    !fs.existsSync(resolveCheckpointPath(vaultPath, binding.pagePath)) &&
    !fs.existsSync(resolveCheckpointPath(vaultPath, binding.operationPath));
}

function resolveCheckpointPath(vaultPath: string, relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The generated-note checkpoint path is invalid."
    );
  }
  const resolvedVault = path.resolve(vaultPath);
  const resolvedTarget = path.resolve(resolvedVault, ...relativePath.split("/"));
  if (!resolvedTarget.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The generated-note checkpoint path escapes the active vault."
    );
  }
  return resolvedTarget;
}

function matchesAgentNotePublicationCheckpoint(
  checkpoint: NonNullable<JobRecord["checkpoints"]>[number],
  checkpointId: string,
  expectedInputRefs: readonly NonNullable<JobRecord["inputRefs"]>[number][],
  expectedOutputRefs: readonly NonNullable<JobRecord["outputRefs"]>[number][],
  contentHash: string
): boolean {
  return checkpoint.step === checkpointId &&
    ["running", "done"].includes(checkpoint.state) &&
    checkpoint.checksumAfter === contentHash &&
    checkpoint.inputRefs.length === expectedInputRefs.length &&
    checkpoint.outputRefs.length === expectedOutputRefs.length &&
    expectedInputRefs.every((expected, index) => sameJobRef(checkpoint.inputRefs[index], expected)) &&
    expectedOutputRefs.every((expected, index) => sameJobRef(checkpoint.outputRefs[index], expected));
}

function completeAgentNotePublicationCheckpoint(
  store: JobRecordStore,
  jobPath: string,
  publication: AgentIngestPublishedResult
): void {
  const snapshot = store.read(jobPath);
  const current = snapshot.job;
  if (!current) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The Agent Job disappeared before its generated-note checkpoint completed."
    );
  }
  const checkpointId = publication.mutationKind === "update_page"
    ? "agent_existing_note_update_started"
    : "agent_note_publication_started";
  const pageRole = publication.mutationKind === "update_page"
    ? "expected_updated_note"
    : "expected_generated_note";
  const operationRole = publication.mutationKind === "update_page"
    ? "expected_update_operation"
    : "expected_create_operation";
  const matches = current.checkpoints?.filter((checkpoint) => checkpoint.id === checkpointId) ?? [];
  if (matches.length === 0) return;
  const checkpoint = matches[0];
  const pageRef = checkpoint?.outputRefs.find((ref) => ref.role === pageRole);
  const operationRef = checkpoint?.outputRefs.find((ref) => ref.role === operationRole);
  if (
    matches.length !== 1 ||
    !checkpoint ||
    checkpoint.checksumAfter === undefined ||
    pageRef?.kind !== "page" ||
    pageRef.id !== publication.pageId ||
    pageRef.path !== publication.pagePath ||
    pageRef.checksum !== checkpoint.checksumAfter ||
    (publication.mutationKind === "update_page" && (
      !publication.operationId ||
      operationRef?.kind !== "operation" ||
      operationRef.id !== publication.operationId
    ))
  ) {
    throw new PigeDomainError(
      "agent_ingest.page_conflict",
      "The generated-note checkpoint changed before Job completion."
    );
  }
  if (checkpoint.state === "done") return;
  const now = new Date().toISOString();
  store.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...current,
    checkpoints: [
      ...(current.checkpoints ?? []).filter((candidate) => candidate.id !== checkpoint.id),
      { ...checkpoint, state: "done", finishedAt: now }
    ],
    updatedAt: now
  }));
}

function sameJobRef(
  actual: NonNullable<JobRecord["inputRefs"]>[number] | undefined,
  expected: NonNullable<JobRecord["inputRefs"]>[number]
): boolean {
  return actual?.kind === expected.kind &&
    actual.id === expected.id &&
    actual.path === expected.path &&
    actual.uri === expected.uri &&
    actual.checksum === expected.checksum &&
    actual.locator === expected.locator &&
    actual.role === expected.role;
}

function sameJobRefIgnoringChecksum(
  actual: NonNullable<JobRecord["inputRefs"]>[number] | undefined,
  expected: NonNullable<JobRecord["inputRefs"]>[number] | undefined
): boolean {
  return actual !== undefined && expected !== undefined &&
    actual.kind === expected.kind &&
    actual.id === expected.id &&
    actual.path === expected.path &&
    actual.uri === expected.uri &&
    actual.locator === expected.locator &&
    actual.role === expected.role;
}

function markProposalApplyStarted(
  store: JobRecordStore,
  vaultPath: string,
  fallback: JobRecord,
  proposalId: string,
  checkpointId: string
): void {
  const currentFile = readProposalParentJobRecord(store, vaultPath, fallback.id);
  if (!currentFile) {
    throw new PigeDomainError("proposal.parent_job_changed", "The proposal parent Job is unavailable.");
  }
  const current = currentFile.job;
  if (["completed", "completed_with_warnings"].includes(current.state)) return;
  if (current.state !== "awaiting_review" || !current.proposalIds?.includes(proposalId)) {
    throw new PigeDomainError(
      "proposal.parent_job_changed",
      "The proposal parent Job is no longer awaiting review."
    );
  }
  const checkpointRecordId = `proposal_apply:${proposalId}`;
  const existing = current.checkpoints?.find((checkpoint) => checkpoint.id === checkpointRecordId);
  const checkpoints = [
    ...(current.checkpoints ?? []).filter((checkpoint) => checkpoint.id !== checkpointRecordId),
    {
      id: checkpointRecordId,
      step: checkpointId,
      state: "running" as const,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      inputRefs: [{ kind: "proposal" as const, id: proposalId }],
      outputRefs: []
    }
  ];
  store.compareAndSwap(currentFile, JobRecordSchema.parse({
    ...current,
    stage: "writing",
    updatedAt: new Date().toISOString(),
    checkpoints,
    message: "Applying the explicitly approved knowledge proposal through the confined vault writer."
  }));
}

function markProposalJobConflicted(
  store: JobRecordStore,
  vaultPath: string,
  fallback: JobRecord,
  proposal: ConfirmationProposal
): void {
  const currentFile = readProposalParentJobRecord(store, vaultPath, fallback.id);
  if (!currentFile) {
    throw new PigeDomainError("proposal.parent_job_changed", "The proposal parent Job is unavailable.");
  }
  const current = currentFile.job;
  if (current.state !== "awaiting_review") return;
  const checkpointRecordId = `proposal_apply:${proposal.id}`;
  const checkpoints = [
    ...(current.checkpoints ?? []).filter((checkpoint) => checkpoint.id !== checkpointRecordId),
    {
      id: checkpointRecordId,
      step: "proposal_apply_conflicted",
      state: "failed" as const,
      startedAt: current.checkpoints?.find((checkpoint) => checkpoint.id === checkpointRecordId)?.startedAt,
      finishedAt: new Date().toISOString(),
      inputRefs: [{ kind: "proposal" as const, id: proposal.id }],
      outputRefs: []
    }
  ];
  store.compareAndSwap(currentFile, JobRecordSchema.parse({
    ...current,
    state: "failed_final",
    stage: "planning",
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    checkpoints,
    progress: { completedUnits: 0, totalUnits: 1, unit: "proposal" },
    message: proposalConflictMessage()
  }));
}

function proposalConflictMessage(): string {
  return "The approved proposal conflicts with current source evidence or its target. Existing bytes were preserved.";
}

function requireProposalApplyOperation(
  vaultPath: string,
  proposal: ConfirmationProposal,
  job: JobRecord
): ReturnType<typeof OperationRecordSchema.parse> {
  const target = requireProposalPageTarget(proposal);
  const operationId = createProposalApplyOperationId(proposal.id);
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) {
    throw new PigeDomainError("proposal.operation_conflict", "The proposal Operation identity is invalid.");
  }
  const operationPath = path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
  const bytes = readConfinedDurableRecord(
    vaultPath,
    path.join(vaultPath, ".pige", "operations"),
    operationPath,
    256 * 1024,
    "proposal.operation_conflict"
  );
  if (!bytes) {
    throw new PigeDomainError("proposal.operation_missing", "The applied proposal Operation is missing.");
  }
  let operation: ReturnType<typeof OperationRecordSchema.parse>;
  try {
    operation = OperationRecordSchema.parse(JSON.parse(bytes));
  } catch {
    throw new PigeDomainError("proposal.operation_conflict", "The applied proposal Operation is invalid.");
  }
  if (
    operation.id !== operationId ||
    operation.jobId !== job.id ||
    operation.proposalId !== proposal.id ||
    operation.kind !== "create_page" ||
    !operation.targetRefs.some((ref) => ref.kind === "page" && ref.id === target.id && ref.path === target.path)
  ) {
    throw new PigeDomainError(
      "proposal.operation_conflict",
      "The applied proposal Operation does not match its Job, proposal, or page target."
    );
  }
  return operation;
}

function proposalResolutionMessage(outcome: "applied" | "rejected", reviewRequired: boolean): string {
  if (outcome === "rejected") {
    return "The user rejected the staged knowledge proposal. Preserved source evidence remains unchanged.";
  }
  return reviewRequired
    ? "The approved knowledge proposal was applied with retained review warnings."
    : "The approved knowledge proposal was applied successfully.";
}

function proposalContentNeedsReview(proposal: ConfirmationProposal): boolean {
  const operation = proposal.proposedOperations[0];
  if (operation?.kind !== "create") return true;
  return parsePigeFrontmatter(operation.content)?.frontmatter.status === "needs_review";
}

function isProposalApplyConflict(value: unknown): value is PigeDomainError {
  return value instanceof PigeDomainError && new Set([
    "agent_ingest.page_conflict",
    "agent_ingest.source_changed",
    "proposal.binding_changed",
    "proposal.identity_conflict",
    "proposal.index_conflict",
    "proposal.operation_conflict",
    "proposal.parent_job_changed",
    "proposal.target_conflict"
  ]).has(value.code);
}

function appendProposalApplyLog(vaultPath: string, proposal: ConfirmationProposal): void {
  const target = requireProposalPageTarget(proposal);
  const sourceId = proposal.sourceRefs.find((ref) => ref.kind === "source")?.id;
  if (!sourceId) {
    throw new PigeDomainError("proposal.binding_changed", "The applied proposal source reference is missing.");
  }
  const operationId = createProposalApplyOperationId(proposal.id);
  const marker = `<!-- operation:${operationId} -->`;
  const logPath = path.join(vaultPath, "log.md");
  if (fs.existsSync(logPath) && fileContainsMarker(vaultPath, logPath, marker)) return;
  appendProposalLogLine(
    vaultPath,
    `${proposal.updatedAt} Applied proposal \`${proposal.id}\` to page [\`${target.id}\`](${target.path}) from source \`${sourceId}\`. ${marker}`
  );
}

function fileContainsMarker(vaultPath: string, filePath: string, marker: string): boolean {
  const pathStatBefore = assertProposalLogPath(vaultPath, filePath);
  const needle = Buffer.from(marker, "utf8");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameDurableFileRevision(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log changed before inspection.");
    }
    const buffer = Buffer.alloc(64 * 1024);
    let overlap = Buffer.alloc(0);
    let position = 0;
    let found = false;
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = Buffer.concat([overlap, buffer.subarray(0, bytesRead)]);
      if (chunk.includes(needle)) {
        found = true;
        break;
      }
      const overlapBytes = Math.min(needle.length - 1, chunk.length);
      overlap = chunk.subarray(chunk.length - overlapBytes);
      position += bytesRead;
    }
    const descriptorStatAfter = fs.fstatSync(descriptor);
    const pathStatAfter = assertProposalLogPath(vaultPath, filePath);
    if (
      !sameDurableFileRevision(descriptorStatBefore, descriptorStatAfter) ||
      !sameDurableFileRevision(descriptorStatAfter, pathStatAfter)
    ) {
      throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log changed during inspection.");
    }
    return found;
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendProposalLogLine(vaultPath: string, line: string): void {
  const logPath = path.join(vaultPath, "log.md");
  const before = fs.existsSync(logPath) ? assertProposalLogPath(vaultPath, logPath) : undefined;
  const descriptor = fs.openSync(
    logPath,
    fs.constants.O_WRONLY |
      fs.constants.O_APPEND |
      fs.constants.O_CREAT |
      (fs.constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (
      !descriptorStat.isFile() ||
      descriptorStat.nlink !== 1 ||
      (before && !sameDurableFileRevision(before, descriptorStat))
    ) {
      throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log changed before append.");
    }
    const pathStatBeforeWrite = assertProposalLogPath(vaultPath, logPath);
    if (!sameDurableFileRevision(descriptorStat, pathStatBeforeWrite)) {
      throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log changed before append.");
    }
    fs.writeSync(descriptor, Buffer.from(`- ${line}\n`, "utf8"));
    fs.fsyncSync(descriptor);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    const pathStatAfter = assertProposalLogPath(vaultPath, logPath);
    if (
      descriptorStatAfter.dev !== pathStatAfter.dev ||
      descriptorStatAfter.ino !== pathStatAfter.ino ||
      descriptorStatAfter.size !== pathStatAfter.size ||
      descriptorStatAfter.nlink !== 1 ||
      pathStatAfter.nlink !== 1
    ) {
      throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log changed during append.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertProposalLogPath(vaultPath: string, logPath: string): fs.Stats {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedLog = path.resolve(logPath);
  if (resolvedLog !== path.join(resolvedVault, "log.md")) {
    throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log path is invalid.");
  }
  const vaultStat = fs.lstatSync(resolvedVault);
  const logStat = fs.lstatSync(resolvedLog);
  if (
    !vaultStat.isDirectory() ||
    vaultStat.isSymbolicLink() ||
    !logStat.isFile() ||
    logStat.isSymbolicLink() ||
    logStat.nlink !== 1
  ) {
    throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log is not a private regular file.");
  }
  const realVault = fs.realpathSync(resolvedVault);
  const realLog = fs.realpathSync(resolvedLog);
  if (!realLog.startsWith(`${realVault}${path.sep}`)) {
    throw new PigeDomainError("proposal.log_unsafe", "The proposal audit log escapes the active vault.");
  }
  return logStat;
}

function createAgentIngestRetryError(caught: unknown): PigeErrorSummary {
  if (caught instanceof PigeDomainError && caught.code === "model_provider.call_failed") {
    return {
      code: caught.code,
      domain: "model_provider",
      messageKey: "errors.model_provider.call_failed",
      retryable: true,
      severity: "error",
      userAction: "retry"
    };
  }
  if (caught instanceof PigeDomainError && caught.code === "agent_runtime.knowledge_action_missing") {
    return {
      code: caught.code,
      domain: "agent_runtime",
      messageKey: "errors.agent_runtime.source_turn_failed",
      retryable: true,
      severity: "error",
      userAction: "retry"
    };
  }
  return {
    code: "agent_runtime.source_turn_failed",
    domain: "agent_runtime",
    messageKey: "errors.agent_runtime.source_turn_failed",
    retryable: true,
    severity: "error",
    userAction: "retry"
  };
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

function markAgentProposalAwaitingReview(
  store: JobRecordStore,
  jobPath: string,
  fallback: JobRecord,
  proposalId: string,
  binding: AgentIngestProposalBinding,
  operationIds: readonly string[],
  pageId: string,
  pagePath: string
): JobRecord {
  let snapshot: JobRecordSnapshot;
  try {
    snapshot = store.read(jobPath);
  } catch (caught) {
    if (!(caught instanceof PigeDomainError) || caught.code !== "job.record_not_found") throw caught;
    throw new PigeDomainError(
      "agent_runtime.proposal_binding_invalid",
      "The active Agent parent is unavailable for durable proposal linkage."
    );
  }
  const current = snapshot.job;
  const sourceId = current.sourceId;
  if (
    !sourceId ||
    !isAgentKnowledgeTurn(current) ||
    sourceId !== binding.sourceId ||
    !["running", "cancel_requested", "awaiting_review"].includes(current.state) ||
    current.policyHash !== binding.policyHash
  ) {
    throw new PigeDomainError(
      "agent_runtime.proposal_binding_invalid",
      "The active Agent parent state, source, or policy does not match the durable proposal."
    );
  }
  const requiredRefs: NonNullable<JobRecord["inputRefs"]> = [
    {
      kind: "source",
      id: sourceId,
      checksum: binding.sourceBindingHash,
      role: AGENT_TOOL_SOURCE_ROLE
    },
    {
      kind: "tool",
      id: `${binding.toolId}@${binding.toolVersion}`,
      checksum: binding.canonicalInputHash,
      role: AGENT_TOOL_INPUT_ROLE
    },
    {
      kind: "tool",
      id: "pige_agent_tool_catalog",
      checksum: binding.catalogHash,
      role: AGENT_TOOL_CATALOG_ROLE
    }
  ];
  let inputRefs = [...(current.inputRefs ?? [])];
  for (const required of requiredRefs) {
    const existing = inputRefs.find((ref) => ref.role === required.role);
    if (existing) {
      if (
        existing.kind !== required.kind ||
        existing.id !== required.id ||
        existing.checksum !== required.checksum
      ) {
        throw new PigeDomainError(
          "agent_runtime.proposal_binding_changed",
          "The durable Agent proposal input binding changed before parent linkage."
        );
      }
      continue;
    }
    inputRefs.push(required);
  }
  if (binding.toolCallProvenanceHash) {
    inputRefs = mergeAgentToolCallProvenance(inputRefs, binding.toolCallProvenanceHash);
  }
  const outputRefs = [...(current.outputRefs ?? [])];
  if (!outputRefs.some((ref) => ref.kind === "proposal" && ref.id === proposalId)) {
    outputRefs.push({ kind: "proposal", id: proposalId, role: "awaiting_review" });
  }
  if (!outputRefs.some((ref) => ref.kind === "page" && ref.id === pageId && ref.path === pagePath)) {
    outputRefs.push({ kind: "page", id: pageId, path: pagePath, role: "proposed_target" });
  }
  const durable = withDurableWriteState(current, {
    durableWritesApplied: true,
    safeCheckpointId: AGENT_PROPOSAL_STAGED_CHECKPOINT
  });
  const {
    finishedAt: _finishedAt,
    error: _error,
    waitingDependency: _waitingDependency,
    ...jobBase
  } = durable;
  const awaitingReview = JobRecordSchema.parse({
    ...jobBase,
    state: "awaiting_review",
    stage: "planning",
    updatedAt: new Date().toISOString(),
    inputRefs,
    outputRefs,
    proposalIds: Array.from(new Set([...(current.proposalIds ?? []), proposalId])),
    operationIds: Array.from(new Set([...(current.operationIds ?? []), ...operationIds])),
    progress: {
      completedUnits: 1,
      totalUnits: 1,
      unit: "proposal"
    },
    message: "Agent ingest staged a grounded knowledge proposal for explicit review. No proposed Markdown was applied."
  });
  return store.compareAndSwap(snapshot, awaitingReview).job;
}

function writeAgentTurnUrlSourceOperation(
  vaultPath: string,
  job: JobRecord,
  sourceRecord: SourceRecord,
  pageId: string,
  pagePath: string,
  urlSnapshotBindingHash: string
): ReturnType<typeof OperationRecordSchema.parse> {
  const inputRef = job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_INPUT_ROLE);
  const catalogRef = job.inputRefs?.find((ref) => ref.role === AGENT_TOOL_CATALOG_ROLE);
  const extractedArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text");
  const dateKey = /^job_(\d{8})_/u.exec(job.id)?.[1];
  if (
    !dateKey ||
    !job.policyContextId ||
    !job.policyHash ||
    inputRef?.id !== "pige_fetch_url@1" ||
    !inputRef.checksum ||
    catalogRef?.id !== "pige_agent_tool_catalog" ||
    !catalogRef.checksum ||
    !sourceRecord.original?.checksum ||
    !sourceRecord.managedCopy?.checksum ||
    !extractedArtifact?.checksum ||
    !isSha256(urlSnapshotBindingHash)
  ) {
    throw new PigeDomainError(
      "agent_runtime.tool_binding_invalid",
      "The Agent-selected URL Operation binding is incomplete."
    );
  }
  const identity = JSON.stringify({
    schemaVersion: 1,
    jobId: job.id,
    sourceId: sourceRecord.id,
    pageId,
    toolInputHash: inputRef.checksum,
    catalogHash: catalogRef.checksum,
    policyHash: job.policyHash,
    rawChecksum: sourceRecord.original.checksum,
    managedCopyChecksum: sourceRecord.managedCopy.checksum,
    extractedArtifactChecksum: extractedArtifact.checksum
  });
  const operationId = `op_${dateKey}_${createHash("sha256")
    .update("pige:agent-turn-url-source-operation:v1\0", "utf8")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 12)}`;
  const operationPath = path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
  const existingBytes = readConfinedDurableRecord(
    vaultPath,
    path.join(vaultPath, ".pige", "operations"),
    operationPath,
    256 * 1024,
    "agent_runtime.url_source_changed"
  );
  if (existingBytes) {
    let existing: ReturnType<typeof OperationRecordSchema.parse>;
    try {
      existing = OperationRecordSchema.parse(JSON.parse(existingBytes));
    } catch {
      throw new PigeDomainError(
        "agent_runtime.url_source_changed",
        "The Agent-selected URL Operation is invalid."
      );
    }
    if (
      existing.id !== operationId ||
      existing.jobId !== job.id ||
      existing.kind !== "create_source_record" ||
      existing.policyAudit?.policyContextId !== job.policyContextId ||
      existing.policyAudit.policyHash !== job.policyHash ||
      !existing.targetRefs.some((ref) => ref.kind === "source" && ref.id === sourceRecord.id) ||
      !existing.targetRefs.some((ref) => ref.kind === "page" && ref.id === pageId && ref.path === pagePath) ||
      !existing.sourceRefs.some(
        (ref) => ref.kind === "root_binding" && ref.id === `agent_url_snapshot:${urlSnapshotBindingHash}`
      )
    ) {
      throw new PigeDomainError(
        "agent_runtime.url_source_changed",
        "The Agent-selected URL Operation conflicts with durable state."
      );
    }
    return existing;
  }

  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    actor: {
      kind: "pige_agent",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    permissionDecisionIds: job.privacy?.permissionDecisionIds ?? [],
    policyAudit: {
      policyContextId: job.policyContextId,
      policyHash: job.policyHash,
      enforcementOwners: ["Source Fetch Service", "Agent Orchestrator"]
    },
    kind: "create_source_record",
    targetRefs: [
      { kind: "source", id: sourceRecord.id },
      { kind: "page", id: pageId, path: pagePath }
    ],
    sourceRefs: [
      { kind: "job", id: job.id },
      { kind: "root_binding", id: `agent_url_snapshot:${urlSnapshotBindingHash}` }
    ],
    summary: "Pi selected one submitted URL for bounded fetch, preservation, and source-page projection.",
    reversible: "best_effort",
    rollbackHint: "Use Pige's trash-first source cleanup after reviewing the preserved evidence.",
    warnings: []
  });
  writeJsonAtomic(operationPath, operation);
  return operation;
}

function createAgentTurnUrlSnapshotBindingHash(
  sourceRecord: SourceRecord,
  expectedInputHash: string | undefined
): string {
  const originalUrl = normalizeAgentTurnUrl(sourceRecord.metadata.originalUrl);
  const originalUri = normalizeAgentTurnUrl(sourceRecord.original?.uri);
  const finalUrl = normalizeAgentTurnUrl(sourceRecord.metadata.finalUrl);
  const canonicalUrl = sourceRecord.metadata.canonicalUrl === undefined
    ? null
    : normalizeAgentTurnUrl(sourceRecord.metadata.canonicalUrl);
  const extractedArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text");
  const originalInputHash = originalUrl
    ? `sha256:${createHash("sha256").update(originalUrl, "utf8").digest("hex")}`
    : undefined;
  if (
    !originalUrl ||
    originalUrl !== originalUri ||
    !finalUrl ||
    !expectedInputHash ||
    originalInputHash !== expectedInputHash ||
    !sourceRecord.original?.checksum ||
    !sourceRecord.managedCopy?.checksum ||
    !extractedArtifact?.checksum
  ) {
    throw new PigeDomainError(
      "agent_runtime.url_source_changed",
      "The Agent-selected URL provenance changed before durable linkage."
    );
  }
  return `sha256:${createHash("sha256").update("pige:agent-turn-url-snapshot:v1\0", "utf8").update(JSON.stringify({
    sourceId: sourceRecord.id,
    originalUrl,
    finalUrl,
    canonicalUrl,
    rawChecksum: sourceRecord.original.checksum,
    managedCopyChecksum: sourceRecord.managedCopy.checksum,
    extractedArtifactChecksum: extractedArtifact.checksum
  }), "utf8").digest("hex")}`;
}

function normalizeAgentTurnUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

const AGENT_TOOL_SOURCE_ROLE = "agent_tool_source_revision";
const AGENT_TOOL_INPUT_ROLE = "agent_tool_canonical_input";
const AGENT_TOOL_CATALOG_ROLE = "agent_tool_catalog";
const AGENT_TOOL_CALL_ROLE = "agent_tool_call_provenance";
const AGENT_TURN_URL_SOURCE_ROLE = "agent_turn_url_source";
const AGENT_TURN_URL_PAGE_ROLE = "agent_turn_url_source_page";
const AGENT_TURN_URL_OPERATION_ROLE = "agent_turn_url_source_operation";
const MAX_AGENT_TOOL_CALL_PROVENANCE_REFS = 16;
const AGENT_PROPOSAL_STAGED_CHECKPOINT = "agent_knowledge_proposal_staged";

function assertAgentParseToolRequest(parentJob: JobRecord, request: AgentIngestParseToolRequest): void {
  if (
    request.sourceRecord.id !== parentJob.sourceId ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(request.toolId) ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(request.toolVersion) ||
    !isSha256(request.canonicalInputHash) ||
    !isSha256(request.catalogHash) ||
    request.compatibleCatalogHashes?.some((hash) => !isSha256(hash)) === true ||
    !isSha256(request.policyHash)
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The Agent parser tool binding is invalid.");
  }
}

function assertAgentDatasetToolRequest(parentJob: JobRecord, request: AgentIngestDatasetToolRequest): void {
  if (
    request.sourceRecord.id !== parentJob.sourceId ||
    !isBoundedOpaqueToolCallId(request.toolCallId) ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(request.toolId) ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(request.toolVersion) ||
    !isSha256(request.canonicalInputHash) ||
    !isSha256(request.catalogHash) ||
    request.compatibleCatalogHashes?.some((hash) => !isSha256(hash)) === true ||
    !isSha256(request.policyHash)
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The Agent Dataset tool binding is invalid.");
  }
}

function assertAgentOcrToolRequest(parentJob: JobRecord, request: AgentIngestOcrToolRequest): void {
  if (
    request.sourceRecord.id !== parentJob.sourceId ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(request.toolId) ||
    !/^[a-z0-9][a-z0-9._-]{0,31}$/u.test(request.toolVersion) ||
    !isSha256(request.canonicalInputHash) ||
    !isSha256(request.catalogHash) ||
    request.compatibleCatalogHashes?.some((hash) => !isSha256(hash)) === true ||
    !isSha256(request.policyHash)
  ) {
    throw new PigeDomainError("agent_runtime.tool_binding_invalid", "The Agent OCR tool binding is invalid.");
  }
}

function ensureAgentParseToolJob(
  store: JobRecordStore,
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
  return ensureRequiredChildJob(store, vaultPath, parentJob, requested, (existing) => {
    assertAgentToolChildBinding(existing, requested, request.compatibleCatalogHashes);
    return JobRecordSchema.parse({
      ...existing,
      inputRefs: mergeAgentToolCallProvenance(existing.inputRefs ?? [], provenanceHash)
    });
  });
}

function ensureAgentOcrToolJob(
  store: JobRecordStore,
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
  return ensureRequiredChildJob(store, vaultPath, parentJob, requested, (existing) => {
    assertAgentToolChildBinding(existing, requested, request.compatibleCatalogHashes);
    return JobRecordSchema.parse({
      ...existing,
      inputRefs: mergeAgentToolCallProvenance(existing.inputRefs ?? [], provenanceHash)
    });
  });
}

function ensureAgentDatasetToolJob(
  store: JobRecordStore,
  vaultPath: string,
  parentJob: JobRecord,
  sourceRecord: SourceRecord,
  request: AgentIngestDatasetToolRequest,
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
  const jobId = createAgentToolJobId(parentJob.id, "dataset_import", actionDigest);
  const provenanceHash = createToolCallProvenanceHash(parentJob.id, request.toolCallId);
  const now = new Date().toISOString();
  const requested = JobRecordSchema.parse({
    id: jobId,
    class: "dataset_import",
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
      ? "Agent selected bounded Dataset materialization for the verified structured source; durable child queued."
      : "Agent selected Dataset materialization; waiting for the bundled local capability."
  });
  return ensureRequiredChildJob(store, vaultPath, parentJob, requested, (existing) => {
    assertAgentToolChildBinding(existing, requested, request.compatibleCatalogHashes);
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

function assertAgentToolChildBinding(
  existing: JobRecord,
  requested: JobRecord,
  compatibleCatalogHashes: readonly string[] = []
): void {
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
    const catalogGenerationCompatible = role === AGENT_TOOL_CATALOG_ROLE &&
      existingRef?.checksum !== undefined &&
      compatibleCatalogHashes.includes(existingRef.checksum);
    if (
      !existingRef ||
      !requestedRef ||
      existingRef.kind !== requestedRef.kind ||
      existingRef.id !== requestedRef.id ||
      (existingRef.checksum !== requestedRef.checksum && !catalogGenerationCompatible)
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

function isBoundedOpaqueToolCallId(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function createAgentToolJobId(
  parentJobId: string,
  jobClass: "parse" | "ocr" | "dataset_import",
  actionDigest: string
): string {
  if (jobClass === "dataset_import") {
    const dateKey = /^job_(\d{8})_/u.exec(parentJobId)?.[1] ??
      new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return `job_${dateKey}_${actionDigest.slice(0, 10)}ds`;
  }
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

function isAgentSelectedDatasetJob(job: JobRecord): boolean {
  return job.class === "dataset_import" &&
    job.inputRefs?.some((ref) => ref.kind === "tool" && ref.role === AGENT_TOOL_INPUT_ROLE) === true;
}

function hasWaitingAgentParseChild(store: JobRecordStore, vaultPath: string, parent: JobRecord): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(store, vaultPath, childId)?.job;
    return child?.state === "waiting_dependency" && isAgentSelectedParseJob(child);
  });
}

function hasWaitingAgentOcrChild(store: JobRecordStore, vaultPath: string, parent: JobRecord): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(store, vaultPath, childId)?.job;
    return child?.state === "waiting_dependency" && isAgentSelectedOcrJob(child);
  });
}

function hasWaitingAgentDatasetChild(store: JobRecordStore, vaultPath: string, parent: JobRecord): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(store, vaultPath, childId)?.job;
    return child?.state === "waiting_dependency" && isAgentSelectedDatasetJob(child);
  });
}

function hasCompletedEmptyAgentOcrChild(
  store: JobRecordStore,
  vaultPath: string,
  parent: JobRecord,
  sourceRecord: SourceRecord
): boolean {
  return (parent.childJobIds ?? []).some((childId) => {
    const child = readJobRecordFile(store, vaultPath, childId)?.job;
    return child?.state === "completed_with_warnings" &&
      isAgentSelectedOcrJob(child) &&
      sourceRecord.metadata.ocrJobId === child.id;
  });
}

function bridgeParentAbortToChild(
  store: JobRecordStore,
  jobPath: string,
  controller: AbortController,
  parentSignal: AbortSignal | undefined
): () => void {
  if (!parentSignal) return () => undefined;
  const abort = (): void => {
    let snapshot: JobRecordSnapshot | undefined;
    try {
      snapshot = store.read(jobPath);
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "job.record_not_found") throw caught;
    }
    if (snapshot?.job.state === "running") {
      const requestedAt = new Date().toISOString();
      store.compareAndSwap(snapshot, JobRecordSchema.parse({
        ...snapshot.job,
        state: "cancel_requested",
        updatedAt: requestedAt,
        cancellation: {
          ...snapshot.job.cancellation,
          requestedAt,
          requestedBy: "system"
        },
        message: snapshot.job.class === "ocr"
          ? "Parent Agent cancellation requested; stopping the active OCR child."
          : snapshot.job.class === "dataset_import"
            ? "Parent Agent cancellation requested; stopping the active Dataset child."
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

function createAgentDatasetToolExecution(
  child: JobRecord,
  sourceRecord: SourceRecord,
  status: AgentIngestDatasetToolExecution["status"],
  dependencyCode?: string
): AgentIngestDatasetToolExecution {
  const datasetId = typeof sourceRecord.metadata.datasetId === "string"
    ? sourceRecord.metadata.datasetId
    : undefined;
  const revisionId = typeof sourceRecord.metadata.datasetRevisionId === "string"
    ? sourceRecord.metadata.datasetRevisionId
    : undefined;
  const warnings = Array.isArray(sourceRecord.metadata.datasetWarnings)
    ? sourceRecord.metadata.datasetWarnings
      .filter((value): value is string => typeof value === "string")
      .slice(0, 16)
    : [];
  return {
    status,
    childJobId: child.id,
    sourceRecord,
    ...(datasetId ? { datasetId } : {}),
    ...(revisionId ? { revisionId } : {}),
    tableCount: safeNonNegativeInteger(sourceRecord.metadata.datasetTableCount),
    rowCount: safeNonNegativeInteger(sourceRecord.metadata.datasetRowCount),
    warnings,
    operationIds: child.operationIds ?? [],
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

function supportsAgentSelectedDataset(sourceKind: SourceKind): boolean {
  return sourceKind === "csv_file" || sourceKind === "xlsx_file" || sourceKind === "sqlite_file";
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
  store: JobRecordStore,
  vaultPath: string,
  parseJob: JobRecord,
  sourceRecord: SourceRecord,
  capability: OcrSourceCapability
): void {
  ensureParserOrOcrFollowUpJob(
    store,
    vaultPath,
    parseJob,
    sourceRecord,
    "ocr",
    capability.ready ? "queued" : "waiting_dependency",
    capability.message
  );
}

function ensureParserOrOcrFollowUpJob(
  store: JobRecordStore,
  vaultPath: string,
  parentJob: JobRecord,
  sourceRecord: SourceRecord,
  jobClass: "parse" | "ocr",
  state: JobState,
  message: string
): void {
  const jobId = createParserOrOcrJobId(sourceRecord.id, jobClass);
  const now = new Date().toISOString();
  ensureRequiredChildJob(store, vaultPath, parentJob, JobRecordSchema.parse({
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

function datasetImportFailure(caught: unknown): { readonly final: boolean; readonly waiting: boolean; readonly message: string } {
  if (caught instanceof PigeDomainError) {
    if (caught.code === "source.external_unavailable") {
      return {
        final: false,
        waiting: true,
        message: "The referenced structured source is unavailable. Reconnect it before retrying Dataset materialization."
      };
    }
    if (/^source\.(?:checksum_mismatch|managed_unavailable|path_outside_vault|reference_invalid)$/u.test(caught.code)) {
      return {
        final: true,
        waiting: false,
        message: "The preserved structured source cannot be verified safely. Re-import it to create a new source version."
      };
    }
    if (
      /^dataset\.ingest\.(?:csv|xlsx|sqlite|limit)\./u.test(caught.code) ||
      /^dataset\.(?:import\.(?:invalid|unsupported|source_changed)|path_(?:invalid|unsafe)|identity_conflict|operation_conflict)$/u.test(caught.code)
    ) {
      return {
        final: true,
        waiting: false,
        message: "The preserved structured source cannot be materialized safely within current Dataset bounds. Original evidence remains available."
      };
    }
  }
  return {
    final: false,
    waiting: false,
    message: "Dataset materialization failed. Preserved source and validated immutable outputs remain retryable."
  };
}

function isDeterministicParserInputFailure(code: string): boolean {
  return /^(?:parser\.(?:pdf|docx|pptx)\.(?:file_too_large|invalid|invalid_archive|invalid_output|required_part_missing|too_many_entries|duplicate_entry|duplicate_relationship|unsafe_entry|unsafe_relationship|invalid_entry_size|encrypted|unsupported_compression|entry_too_large|expanded_too_large|suspicious_compression|xml_part_too_large|selected_xml_too_large|doctype_not_allowed|invalid_xml)|parser\.(?:path_outside_vault|source_unavailable))$/u.test(code);
}

function documentLabel(sourceKind: SourceKind): string {
  if (sourceKind === "docx_file") return "DOCX";
  if (sourceKind === "pptx_file") return "PPTX";
  return "PDF";
}

function ensureAgentIngestJob(
  store: JobRecordStore,
  vaultPath: string,
  parentJob: JobRecord,
  sourceId: string,
  canRun: boolean,
  activeVaultId: string
): void {
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
    activeVaultId,
    ...(parentJob.captureId ? { captureId: parentJob.captureId } : {}),
    ...(parentJob.conversationEventId ? { conversationEventId: parentJob.conversationEventId } : {}),
    message: nextMessage
  });
  ensureRequiredChildJob(
    store,
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
  store: JobRecordStore,
  vaultPath: string,
  parentJob: JobRecord,
  requestedChild: JobRecord,
  reconcileExisting: (existing: JobRecord) => JobRecord = (existing) => existing
): JobRecord {
  const childPath = createJobRecordPath(vaultPath, requestedChild.id);
  let existing: JobRecordSnapshot | undefined;
  try {
    existing = store.read(childPath);
  } catch (caught) {
    if (!(caught instanceof PigeDomainError) || caught.code !== "job.record_not_found") throw caught;
  }
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
      child = store.compareAndSwap(existing, child).job;
    }
  } else {
    child = JobRecordSchema.parse({
      ...requestedChild,
      parentJobId: parentJob.id
    });
    try {
      child = store.createIfAbsent(childPath, child).job;
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "job.revision_conflict") {
        return ensureRequiredChildJob(store, vaultPath, parentJob, requestedChild, reconcileExisting);
      }
      throw caught;
    }
  }

  let parentSnapshot: JobRecordSnapshot;
  try {
    parentSnapshot = store.read(createJobRecordPath(vaultPath, parentJob.id));
  } catch {
    throw new Error("The required child Job was persisted, but its parent Job is unavailable for linkage.");
  }
  if (!(parentSnapshot.job.childJobIds ?? []).includes(child.id)) {
    store.compareAndSwap(parentSnapshot, JobRecordSchema.parse({
      ...parentSnapshot.job,
      childJobIds: Array.from(new Set([...(parentSnapshot.job.childJobIds ?? []), child.id])),
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

function createIndexRebuildJob(store: JobRecordStore, vaultPath: string): JobRecord {
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
  return store.createIfAbsent(jobPath, jobRecord).job;
}

function isConfinedConversationLocator(locator: string): boolean {
  if (
    locator.includes("\\") ||
    locator.startsWith("/") ||
    locator.includes("\0") ||
    locator.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return false;
  }
  return /^\.pige\/conversations\/\d{4}\/\d{2}\/conv_\d{8}(?:_[a-z0-9]{4,})?\.jsonl$/u.test(locator);
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
