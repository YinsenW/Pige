import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  DiagnosticsClearLocalRequestSchema,
  DiagnosticsClearLocalResultSchema,
  DiagnosticsExportSupportBundleRequestSchema,
  DiagnosticsExportSupportBundleResultSchema,
  DiagnosticsPreviewSupportBundleRequestSchema,
  DiagnosticsSupportBundleMutationRequestSchema,
  DiagnosticsSupportBundleMutationResultSchema,
  DiagnosticsWorkflowSummarySchema,
  JobRecordSchema,
  SupportBundlePreviewSchema,
  type DiagnosticsClearLocalRequest,
  type DiagnosticsClearLocalResult,
  type DiagnosticsExportSupportBundleRequest,
  type DiagnosticsExportSupportBundleResult,
  type DiagnosticsPreviewSupportBundleRequest,
  type DiagnosticsSupportBundleMutationRequest,
  type DiagnosticsSupportBundleMutationResult,
  type DiagnosticsSupportBundleJobSummary,
  type DiagnosticsWorkflowSummary,
  type JobRecord,
  type SupportBundlePreview
} from "@pige/schemas";
import { DiagnosticsService } from "./diagnostics-service";
import type { DiagnosticsProviderMetadata } from "./diagnostics-provider-metadata";
import { JobExecutionCoordinator } from "./job-execution-coordinator";
import { JobRecordStore, type JobRecordSnapshot } from "./job-record-store";
import { acquireVaultWriterLease, type VaultWriterLease } from "./vault-writer-lease";

const REGISTRY_NAME = "registry.json";
const BINDING_NAME = "binding.json";
const PAYLOAD_NAME = "support-bundle.json";
const CLEAR_RECEIPT_NAME = ".diagnostics-clear.json";
const MAX_REGISTRY_BYTES = 256 * 1024;
const MAX_BINDING_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const JOB_FILE_PATTERN = /^job_\d{8}_[a-z0-9]{8,}\.json$/u;
const ACTIVE_STATES = new Set(["queued", "running", "cancel_requested"]);

interface DiagnosticsRegistry {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly machineScopeId: string;
  readonly jobIds: readonly string[];
}

interface SupportBundleBinding {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly requestId: string;
  readonly previewId: string;
  readonly scopeContextId: string;
  readonly activeVaultId: string | null;
  readonly expectedRevision: number;
  readonly destinationPath: string;
  readonly contentSha256: string;
  readonly contentBytes: number;
  readonly createdAt: string;
  readonly state: "prepared" | "published";
  readonly publishedAt?: string;
}

interface ClearReceipt {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly jobIds: readonly string[];
  readonly createdAt: string;
  readonly committedRevision?: number;
  readonly clearedArtifactCount?: number;
}

export interface DiagnosticsLifecycleOptions {
  readonly userDataPath: string;
  readonly diagnostics: DiagnosticsService;
  readonly getActiveVaultId: () => string | undefined;
  readonly providerMetadata?: () => DiagnosticsProviderMetadata;
  readonly now?: () => Date;
}

export class DiagnosticsLifecycleService {
  readonly #diagnostics: DiagnosticsService;
  readonly #getActiveVaultId: () => string | undefined;
  readonly #providerMetadata: (() => DiagnosticsProviderMetadata) | undefined;
  readonly #now: () => Date;
  readonly #root: string;
  readonly #jobsRoot: string;
  readonly #workRoot: string;
  readonly #trashRoot: string;
  readonly #registryPath: string;
  readonly #lease: VaultWriterLease;
  readonly #jobs: JobRecordStore;
  readonly #coordinator: JobExecutionCoordinator;
  readonly #previews = new Map<string, SupportBundlePreview>();
  readonly #previewProviderMetadata = new Map<string, DiagnosticsProviderMetadata>();
  readonly #executions = new Map<string, AbortController>();
  #closed = false;

  constructor(options: DiagnosticsLifecycleOptions) {
    this.#diagnostics = options.diagnostics;
    this.#getActiveVaultId = options.getActiveVaultId;
    this.#providerMetadata = options.providerMetadata;
    this.#now = options.now ?? (() => new Date());
    const userData = privateDirectory(options.userDataPath, true);
    this.#root = privateChild(userData, "diagnostics-workflow");
    privateChild(this.#root, ".pige");
    this.#jobsRoot = privateChild(path.join(this.#root, ".pige"), "jobs");
    this.#workRoot = privateChild(this.#root, "support-work");
    const diagnosticsRoot = privateChild(userData, "diagnostics");
    this.#trashRoot = privateChild(diagnosticsRoot, "trash");
    this.#registryPath = path.join(this.#root, REGISTRY_NAME);
    this.#lease = acquireVaultWriterLease(this.#root);
    this.#jobs = new JobRecordStore({ rootPath: this.#jobsRoot, assertWriterLease: () => this.#assertHeld() });
    this.#coordinator = new JobExecutionCoordinator(this.#jobs, { now: this.#now });
    this.#prepareRegistry();
    this.#recoverPreparedClears();
    this.#recoverJobs();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#executions.values()) controller.abort();
    this.#lease.release();
  }

  summary(): DiagnosticsWorkflowSummary {
    this.#assertHeld();
    return this.#project(this.#readRegistry());
  }

  preview(requestInput: DiagnosticsPreviewSupportBundleRequest): SupportBundlePreview {
    const request = DiagnosticsPreviewSupportBundleRequestSchema.parse(requestInput);
    const selectedOptionalCategories = request.optionalCategories ?? [];
    const registry = this.#readRegistry();
    const activeVaultId = this.#getActiveVaultId() ?? null;
    const preview = SupportBundlePreviewSchema.parse(this.#diagnostics.previewSupportBundle({
      apiVersion: 1,
      requestId: request.requestId,
      scopeContextId: scopeContextId(registry.machineScopeId, activeVaultId),
      expectedRevision: registry.revision,
      activeVaultId,
      selectedOptionalCategories
    }));
    if (selectedOptionalCategories.includes("provider_metadata")) {
      if (!this.#providerMetadata) throw lifecycleError("diagnostics.provider_metadata_unavailable");
      this.#previewProviderMetadata.set(preview.previewId, this.#providerMetadata());
    }
    this.#previews.set(preview.previewId, preview);
    return preview;
  }

  replayStart(requestInput: DiagnosticsExportSupportBundleRequest): DiagnosticsExportSupportBundleResult | undefined {
    const request = DiagnosticsExportSupportBundleRequestSchema.parse(requestInput);
    try {
      const replay = this.#findByRequestId(request.requestId);
      if (!replay) return undefined;
      assertStartBinding(this.#binding(replay.job.id), request);
      return DiagnosticsExportSupportBundleResultSchema.parse({
        ...request, status: "started", workflow: this.#project(this.#readRegistry())
      });
    } catch {
      return DiagnosticsExportSupportBundleResultSchema.parse({ ...request, status: "failed" });
    }
  }

  start(
    requestInput: DiagnosticsExportSupportBundleRequest,
    destinationPath: string
  ): DiagnosticsExportSupportBundleResult {
    const request = DiagnosticsExportSupportBundleRequestSchema.parse(requestInput);
    const identity = request;
    try {
      let registry = this.#readRegistry();
      const replay = this.replayStart(request);
      if (replay) return replay;
      const currentContext = this.#currentContext(registry);
      if (request.expectedRevision !== registry.revision || request.scopeContextId !== currentContext.scopeContextId) {
        return DiagnosticsExportSupportBundleResultSchema.parse({
          ...identity, status: "stale", workflow: this.#project(registry)
        });
      }
      if (this.#activeJob(registry)) {
        return DiagnosticsExportSupportBundleResultSchema.parse({
          ...identity, status: "busy", workflow: this.#project(registry)
        });
      }
      const preview = this.#previews.get(request.previewId);
      if (!preview || preview.expectedRevision !== request.expectedRevision ||
        preview.scopeContextId !== request.scopeContextId || preview.activeVaultId !== currentContext.activeVaultId) {
        return DiagnosticsExportSupportBundleResultSchema.parse({ ...identity, status: "failed" });
      }
      const createdAt = this.#nowIso();
      const jobId = createJobId(createdAt);
      const job = JobRecordSchema.parse({
        schemaVersion: 1,
        id: jobId,
        class: "maintenance",
        state: "queued",
        stage: "writing",
        priority: "interactive",
        scope: "machine_local",
        createdAt,
        updatedAt: createdAt,
        activeVaultId: currentContext.activeVaultId ?? undefined,
        actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
        inputRefs: [{ kind: "tool", id: request.previewId, role: "support_bundle_preview" }],
        outputRefs: [],
        checkpoints: supportCheckpoints(),
        progress: { completedUnits: 0, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.queued" },
        privacy: { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: true },
        message: "A local redacted support bundle export is queued."
      });
      const snapshot = this.#jobs.createIfAbsent(this.#jobPath(jobId), job);
      registry = this.#writeRegistry({ ...registry, revision: nextRevision(registry.revision), jobIds: [...registry.jobIds, jobId] });
      let content: string;
      try {
        const providerMetadata = this.#previewProviderMetadata.get(preview.previewId);
        if (preview.selectedOptionalCategories.includes("provider_metadata") && !providerMetadata) {
          throw lifecycleError("diagnostics.provider_metadata_unavailable");
        }
        content = this.#diagnostics.createSupportBundlePayload(preview, { ...(providerMetadata ? { providerMetadata } : {}) });
        if (Buffer.byteLength(content, "utf8") > MAX_PAYLOAD_BYTES) throw lifecycleError("diagnostics.export_blocked");
      }
      catch (caught) {
        failFinal(this.#jobs, snapshot, this.#nowIso(), "diagnostics.export_blocked", "choose_path");
        registry = this.#bumpRegistry(registry);
        throw caught;
      }
      const contentBytes = Buffer.byteLength(content, "utf8");
      const binding: SupportBundleBinding = {
        schemaVersion: 1,
        jobId,
        requestId: request.requestId,
        previewId: request.previewId,
        scopeContextId: request.scopeContextId,
        activeVaultId: currentContext.activeVaultId,
        expectedRevision: request.expectedRevision,
        destinationPath: path.resolve(destinationPath),
        contentSha256: sha256(content),
        contentBytes,
        createdAt,
        state: "prepared"
      };
      try { this.#writeWork(snapshot.job.id, binding, content); }
      catch (caught) {
        failFinal(this.#jobs, snapshot, this.#nowIso(), "diagnostics.export_repair_required", "choose_path");
        this.#bumpRegistry(registry);
        throw caught;
      }
      this.#schedule(jobId);
      return DiagnosticsExportSupportBundleResultSchema.parse({
        ...identity, status: "started", workflow: this.#project(registry)
      });
    } catch {
      return DiagnosticsExportSupportBundleResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  cancel(requestInput: DiagnosticsSupportBundleMutationRequest): DiagnosticsSupportBundleMutationResult {
    return this.#mutate(requestInput, "cancel");
  }

  retry(requestInput: DiagnosticsSupportBundleMutationRequest): DiagnosticsSupportBundleMutationResult {
    return this.#mutate(requestInput, "retry");
  }

  clear(requestInput: DiagnosticsClearLocalRequest): DiagnosticsClearLocalResult {
    const request = DiagnosticsClearLocalRequestSchema.parse(requestInput);
    const identity = request;
    try {
      let registry = this.#readRegistry();
      const existing = readJsonOptional(
        path.join(this.#trashRoot, request.requestId, CLEAR_RECEIPT_NAME),
        MAX_BINDING_BYTES
      );
      if (existing) {
        const receipt = parseClearReceipt(existing, request.requestId);
        if (receipt.expectedRevision !== request.expectedRevision) throw lifecycleError("diagnostics.request_conflict");
        const clearedArtifactCount = receipt.state === "prepared"
          ? this.#completeClear(receipt)
          : receipt.clearedArtifactCount ?? 0;
        registry = this.#readRegistry();
        return DiagnosticsClearLocalResultSchema.parse({
          ...identity, status: "cleared", workflow: this.#project(registry),
          health: this.#diagnostics.health(), clearedArtifactCount
        });
      }
      const context = this.#currentContext(registry);
      if (request.expectedRevision !== registry.revision || request.scopeContextId !== context.scopeContextId) {
        return DiagnosticsClearLocalResultSchema.parse({
          ...identity, status: "stale", workflow: this.#project(registry), health: this.#diagnostics.health()
        });
      }
      if (this.#activeJob(registry)) {
        return DiagnosticsClearLocalResultSchema.parse({
          ...identity, status: "busy", workflow: this.#project(registry), health: this.#diagnostics.health()
        });
      }
      const receipt = this.#prepareClear(request, registry);
      const clearedArtifactCount = this.#completeClear(receipt);
      registry = this.#readRegistry();
      this.#previews.clear();
      this.#previewProviderMetadata.clear();
      return DiagnosticsClearLocalResultSchema.parse({
        ...identity,
        status: "cleared",
        workflow: this.#project(registry),
        health: this.#diagnostics.health(),
        clearedArtifactCount
      });
    } catch {
      return DiagnosticsClearLocalResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #mutate(
    requestInput: DiagnosticsSupportBundleMutationRequest,
    action: "cancel" | "retry"
  ): DiagnosticsSupportBundleMutationResult {
    const request = DiagnosticsSupportBundleMutationRequestSchema.parse(requestInput);
    const identity = request;
    try {
      let registry = this.#readRegistry();
      const context = this.#currentContext(registry);
      if (request.expectedRevision !== registry.revision || request.scopeContextId !== context.scopeContextId) {
        return mutationResult(identity, "stale", this.#project(registry));
      }
      let snapshot = this.#readOptionalJob(request.jobId);
      if (!snapshot || !registry.jobIds.includes(request.jobId)) return mutationResult(identity, "not_found", this.#project(registry));
      if (this.#binding(snapshot.job.id).activeVaultId !== context.activeVaultId) {
        return mutationResult(identity, "ineligible", this.#project(registry));
      }
      if (action === "cancel") {
        if (snapshot.job.state === "completed" || snapshot.job.state === "completed_with_warnings") {
          return mutationResult(identity, "completed", this.#project(registry));
        }
        if (snapshot.job.state === "queued" || snapshot.job.state === "failed_retryable") {
          snapshot = this.#coordinator.cancelPending(snapshot, {
            requestedBy: "user", safeCheckpointId: "before_publication", message: "Support bundle export was canceled before publication."
          });
        } else if (snapshot.job.state === "running") {
          snapshot = this.#coordinator.requestCancellation(snapshot, {
            requestedBy: "user", message: "Support bundle cancellation was requested."
          });
          this.#executions.get(request.jobId)?.abort();
        } else if (snapshot.job.state !== "cancel_requested") {
          return mutationResult(identity, "ineligible", this.#project(registry));
        }
      } else {
        if (snapshot.job.state !== "failed_retryable") return mutationResult(identity, "ineligible", this.#project(registry));
        const binding = this.#binding(snapshot.job.id);
        const destination = this.#destinationState(binding);
        if (destination === "exact") {
          this.#coordinator.adoptDurableCompletion(snapshot, {
            checkpointId: "bundle_published",
            message: "Retry adopted the exact already-published support bundle.",
            facts: {
              outputRefs: [{ kind: "artifact", id: `support_bundle_${snapshot.job.id}`, checksum: binding.contentSha256, role: "support_bundle" }],
              progress: { completedUnits: 3, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.completed" }
            }
          });
          registry = this.#bumpRegistry(registry);
          return mutationResult(identity, "completed", this.#project(registry));
        }
        if (destination === "changed") {
          failFinal(this.#jobs, snapshot, this.#nowIso(), "diagnostics.destination_changed", "choose_path");
          registry = this.#bumpRegistry(registry);
          return mutationResult(identity, "ineligible", this.#project(registry));
        }
        snapshot = this.#coordinator.prepareRetry(snapshot, {
          reason: "explicit_user_retry", message: "The same support bundle Job is queued for retry."
        });
        this.#schedule(snapshot.job.id);
      }
      registry = this.#bumpRegistry(registry);
      return mutationResult(identity, "accepted", this.#project(registry));
    } catch {
      return DiagnosticsSupportBundleMutationResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #schedule(jobId: string): void {
    if (this.#executions.has(jobId) || this.#closed) return;
    queueMicrotask(() => void this.#execute(jobId));
  }

  async #execute(jobId: string): Promise<void> {
    if (this.#executions.has(jobId) || this.#closed) return;
    const controller = new AbortController();
    this.#executions.set(jobId, controller);
    try {
      let snapshot = this.#jobs.read(this.#jobPath(jobId));
      if (snapshot.job.state !== "queued") return;
      snapshot = this.#coordinator.begin(snapshot, {
        stage: "writing",
        message: "Preparing the verified local support bundle.",
        facts: {
          progress: { completedUnits: 1, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.preparing" },
          checkpoints: checkpointState(snapshot.job, "payload_prepared", "done")
        }
      });
      this.#bumpRegistry(this.#readRegistry());
      const binding = this.#binding(jobId);
      const content = this.#payload(jobId, binding);
      snapshot = this.#coordinator.patch(snapshot, {
        message: "Writing the verified local support bundle.",
        progress: { completedUnits: 2, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.writing" },
        checkpoints: checkpointState(snapshot.job, "bundle_writing", "running")
      });
      this.#bumpRegistry(this.#readRegistry());
      await this.#diagnostics.writePreparedSupportBundle(binding.destinationPath, content, { signal: controller.signal });
      const publishedAt = this.#nowIso();
      this.#writeBinding({ ...binding, state: "published", publishedAt });
      snapshot = this.#jobs.read(this.#jobPath(jobId));
      snapshot = this.#coordinator.adoptDurableCompletion(snapshot, {
        checkpointId: "bundle_published",
        message: "The redacted support bundle was exported locally.",
        facts: {
          outputRefs: [{ kind: "artifact", id: `support_bundle_${jobId}`, checksum: binding.contentSha256, role: "support_bundle" }],
          progress: { completedUnits: 3, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.completed" },
          checkpoints: checkpointState(snapshot.job, "bundle_published", "done")
        }
      });
      this.#diagnostics.recordEvent({
        level: "info", code: "diagnostics.exportSupportBundle", message: "Support bundle exported.",
        redactedDetails: { jobId, bytesWritten: binding.contentBytes }
      });
      this.#bumpRegistry(this.#readRegistry());
    } catch (caught) {
      this.#settleExecutionFailure(jobId, caught);
    } finally {
      this.#executions.delete(jobId);
    }
  }

  #settleExecutionFailure(jobId: string, caught: unknown): void {
    try {
      let snapshot = this.#jobs.read(this.#jobPath(jobId));
      if (snapshot.job.state === "cancel_requested") {
        const binding = this.#binding(jobId);
        if (this.#destinationState(binding) === "exact") {
          snapshot = this.#coordinator.adoptDurableCompletion(snapshot, {
            checkpointId: "bundle_published",
            message: "The support bundle completed before cancellation took effect.",
            facts: {
              outputRefs: [{ kind: "artifact", id: `support_bundle_${jobId}`, checksum: binding.contentSha256, role: "support_bundle" }],
              progress: { completedUnits: 3, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.completed" }
            }
          });
        } else {
          snapshot = this.#coordinator.cancellationOutcome(snapshot, {
            cancelledMessage: "Support bundle export was canceled before publication.",
            preservedResultMessage: "Support bundle export was canceled before publication.",
            safeCheckpointId: "before_publication"
          });
        }
      } else if (snapshot.job.state === "running") {
        snapshot = this.#coordinator.settle(snapshot, {
          kind: "requeue",
          error: diagnosticsError("diagnostics.export_failed", true, "retry"),
          reason: errorCode(caught),
          maxAutomaticRetries: 0,
          requiresUserAction: true,
          message: "Support bundle export failed safely and can retry the same verified payload."
        });
      }
      this.#bumpRegistry(this.#readRegistry());
    } catch { /* Preserve the original durable Job for startup reconciliation. */ }
  }

  #recoverJobs(): void {
    let registry = this.#readRegistry();
    const diskIds = this.#listJobIds();
    if (stableJson(registry.jobIds) !== stableJson(diskIds)) {
      registry = this.#writeRegistry({ ...registry, revision: nextRevision(registry.revision), jobIds: diskIds });
    }
    for (const jobId of registry.jobIds) {
      let snapshot = this.#readOptionalJob(jobId);
      if (!snapshot || !ACTIVE_STATES.has(snapshot.job.state)) continue;
      let binding: SupportBundleBinding;
      try { binding = this.#binding(jobId); } catch {
        snapshot = failFinal(this.#jobs, snapshot, this.#nowIso(), "diagnostics.export_repair_required", "choose_path");
        this.#bumpRegistry(this.#readRegistry());
        continue;
      }
      const destination = this.#destinationState(binding);
      if (destination === "exact") {
        this.#coordinator.adoptDurableCompletion(snapshot, {
          checkpointId: "bundle_published",
          message: "Restart adopted the exact already-published support bundle.",
          facts: {
            outputRefs: [{ kind: "artifact", id: `support_bundle_${jobId}`, checksum: binding.contentSha256, role: "support_bundle" }],
            progress: { completedUnits: 3, totalUnits: 3, unit: "checkpoint", messageKey: "diagnostics.support.completed" }
          }
        });
        this.#bumpRegistry(this.#readRegistry());
      } else if (destination === "changed") {
        failFinal(this.#jobs, snapshot, this.#nowIso(), "diagnostics.destination_changed", "choose_path");
        this.#bumpRegistry(this.#readRegistry());
      } else if (snapshot.job.state === "cancel_requested") {
        this.#coordinator.cancellationOutcome(snapshot, {
          cancelledMessage: "Restart completed the pending support bundle cancellation.",
          preservedResultMessage: "Restart completed the pending support bundle cancellation.",
          safeCheckpointId: "before_publication"
        });
        this.#bumpRegistry(this.#readRegistry());
      } else {
        if (snapshot.job.state === "running") {
          snapshot = this.#coordinator.queue(snapshot, {
            reason: "idempotent_recovery", clearStage: true,
            message: "Restart re-adopted the same support bundle Job and payload."
          });
          this.#bumpRegistry(this.#readRegistry());
        }
        this.#schedule(jobId);
      }
    }
  }

  #project(registry: DiagnosticsRegistry): DiagnosticsWorkflowSummary {
    const context = this.#currentContext(registry);
    const latest = this.#latestJob(registry);
    return DiagnosticsWorkflowSummarySchema.parse({
      apiVersion: 1,
      revision: registry.revision,
      scopeContextId: context.scopeContextId,
      activeVaultId: context.activeVaultId,
      localOnly: true,
      ownedArtifactCount: this.#ownedArtifactCount(registry),
      ...(latest ? { job: projectJob(latest.job) } : {})
    });
  }

  #currentContext(registry: DiagnosticsRegistry): { scopeContextId: string; activeVaultId: string | null } {
    const activeVaultId = this.#getActiveVaultId() ?? null;
    return { activeVaultId, scopeContextId: scopeContextId(registry.machineScopeId, activeVaultId) };
  }

  #latestJob(registry: DiagnosticsRegistry): JobRecordSnapshot | undefined {
    return registry.jobIds.map((id) => this.#readOptionalJob(id)).filter((value): value is JobRecordSnapshot => !!value)
      .sort((left, right) => right.job.createdAt.localeCompare(left.job.createdAt) || right.job.id.localeCompare(left.job.id, "en"))[0];
  }

  #activeJob(registry: DiagnosticsRegistry): JobRecordSnapshot | undefined {
    return registry.jobIds.map((id) => this.#readOptionalJob(id))
      .find((snapshot) => snapshot !== undefined && ACTIVE_STATES.has(snapshot.job.state));
  }

  #findByRequestId(requestId: string): JobRecordSnapshot | undefined {
    let found: JobRecordSnapshot | undefined;
    for (const jobId of this.#readRegistry().jobIds) {
      const snapshot = this.#readOptionalJob(jobId);
      if (!snapshot) continue;
      let binding: SupportBundleBinding;
      try { binding = this.#binding(jobId); } catch { continue; }
      if (binding.requestId !== requestId) continue;
      if (found) throw lifecycleError("diagnostics.request_conflict");
      found = snapshot;
    }
    return found;
  }

  #ownedArtifactCount(registry: DiagnosticsRegistry): number {
    return this.#diagnostics.ownedEventArtifactCount() + registry.jobIds.reduce((count, id) =>
      count + (this.#readOptionalJob(id) ? 1 : 0) + (fs.existsSync(this.#workPath(id)) ? 1 : 0), 0);
  }

  #prepareClear(request: DiagnosticsClearLocalRequest, registry: DiagnosticsRegistry): ClearReceipt {
    const clearRoot = path.join(this.#trashRoot, request.requestId);
    const receiptPath = path.join(clearRoot, CLEAR_RECEIPT_NAME);
    const existing = readJsonOptional(receiptPath, MAX_BINDING_BYTES) as ClearReceipt | undefined;
    if (existing) return parseClearReceipt(existing, request.requestId);
    fs.mkdirSync(clearRoot, { mode: 0o700 });
    const receipt: ClearReceipt = {
      schemaVersion: 1, state: "prepared", requestId: request.requestId,
      expectedRevision: registry.revision, jobIds: [...registry.jobIds], createdAt: this.#nowIso()
    };
    writeJsonAtomic(receiptPath, receipt);
    return receipt;
  }

  #completeClear(receipt: ClearReceipt): number {
    const clearRoot = path.join(this.#trashRoot, receipt.requestId);
    let moved = this.#diagnostics.trashOwnedEvents(clearRoot);
    const jobsTrash = privateChild(clearRoot, "jobs");
    const workTrash = privateChild(clearRoot, "support-work");
    for (const jobId of receipt.jobIds) {
      moved += moveIfPresent(this.#jobPath(jobId), path.join(jobsTrash, `${jobId}.json`));
      moved += moveIfPresent(this.#workPath(jobId), path.join(workTrash, jobId));
    }
    let registry = this.#readRegistry();
    const remaining = registry.jobIds.filter((jobId) => !receipt.jobIds.includes(jobId));
    if (stableJson(remaining) !== stableJson(registry.jobIds)) {
      registry = this.#writeRegistry({ ...registry, revision: nextRevision(registry.revision), jobIds: remaining });
    }
    const committed: ClearReceipt = {
      ...receipt, state: "committed", committedRevision: registry.revision, clearedArtifactCount: moved
    };
    writeJsonAtomic(path.join(clearRoot, CLEAR_RECEIPT_NAME), committed);
    return moved;
  }

  #recoverPreparedClears(): void {
    for (const name of safeDirectoryNames(this.#trashRoot)) {
      if (!/^diagclearreq_[a-z0-9]{16,64}$/u.test(name)) continue;
      const value = readJsonOptional(path.join(this.#trashRoot, name, CLEAR_RECEIPT_NAME), MAX_BINDING_BYTES);
      if (!value) continue;
      const receipt = parseClearReceipt(value, name);
      if (receipt.state === "prepared") this.#completeClear(receipt);
    }
  }

  #writeWork(jobId: string, binding: SupportBundleBinding, content: string): void {
    const target = this.#workPath(jobId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.mkdirSync(temporary, { mode: 0o700 });
    try {
      writePrivateFile(path.join(temporary, BINDING_NAME), `${JSON.stringify(binding, null, 2)}\n`);
      writePrivateFile(path.join(temporary, PAYLOAD_NAME), content);
      fs.renameSync(temporary, target);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }

  #binding(jobId: string): SupportBundleBinding {
    return parseBinding(readJsonRequired(path.join(this.#workPath(jobId), BINDING_NAME), MAX_BINDING_BYTES), jobId);
  }

  #writeBinding(binding: SupportBundleBinding): void {
    writeJsonAtomic(path.join(this.#workPath(binding.jobId), BINDING_NAME), binding);
  }

  #payload(jobId: string, binding: SupportBundleBinding): string {
    const payload = readTextRequired(path.join(this.#workPath(jobId), PAYLOAD_NAME), MAX_PAYLOAD_BYTES);
    if (Buffer.byteLength(payload, "utf8") !== binding.contentBytes || sha256(payload) !== binding.contentSha256) {
      throw lifecycleError("diagnostics.payload_changed");
    }
    return payload;
  }

  #destinationState(binding: SupportBundleBinding): "missing" | "exact" | "changed" {
    try {
      const content = readTextRequired(binding.destinationPath, MAX_PAYLOAD_BYTES);
      return Buffer.byteLength(content, "utf8") === binding.contentBytes && sha256(content) === binding.contentSha256
        ? "exact" : "changed";
    } catch (caught) {
      return isErrno(caught, "ENOENT") ? "missing" : "changed";
    }
  }

  #readOptionalJob(jobId: string): JobRecordSnapshot | undefined {
    try { return this.#jobs.read(this.#jobPath(jobId)); }
    catch (caught) { if (isErrno(caught, "ENOENT") || (caught instanceof PigeDomainError && caught.code === "job.record_not_found")) return undefined; throw caught; }
  }

  #listJobIds(): string[] {
    return fs.readdirSync(this.#jobsRoot).filter((name) => JOB_FILE_PATTERN.test(name))
      .map((name) => name.slice(0, -5)).sort((left, right) => left.localeCompare(right, "en"));
  }

  #jobPath(jobId: string): string { return path.join(this.#jobsRoot, `${jobId}.json`); }
  #workPath(jobId: string): string { return path.join(this.#workRoot, jobId); }
  #bumpRegistry(registry: DiagnosticsRegistry): DiagnosticsRegistry {
    return this.#writeRegistry({ ...registry, revision: nextRevision(registry.revision) });
  }
  #prepareRegistry(): void {
    if (fs.existsSync(this.#registryPath)) { this.#readRegistry(); return; }
    this.#writeRegistry({ schemaVersion: 1, revision: 0, machineScopeId: randomBytes(32).toString("hex"), jobIds: [] });
  }
  #readRegistry(): DiagnosticsRegistry { return parseRegistry(readJsonRequired(this.#registryPath, MAX_REGISTRY_BYTES)); }
  #writeRegistry(value: DiagnosticsRegistry): DiagnosticsRegistry { const parsed = parseRegistry(value); writeJsonAtomic(this.#registryPath, parsed); return parsed; }
  #nowIso(): string { const value = this.#now(); if (!Number.isFinite(value.getTime())) throw lifecycleError("diagnostics.clock_invalid"); return value.toISOString(); }
  #assertHeld(): void { if (this.#closed) throw lifecycleError("diagnostics.lifecycle_closed"); this.#lease.assertHeld(); }
}

function mutationResult(
  identity: DiagnosticsSupportBundleMutationRequest,
  status: "accepted" | "completed" | "stale" | "not_found" | "ineligible",
  workflow: DiagnosticsWorkflowSummary
): DiagnosticsSupportBundleMutationResult {
  return DiagnosticsSupportBundleMutationResultSchema.parse({ ...identity, status, workflow });
}

function projectJob(job: JobRecord): DiagnosticsSupportBundleJobSummary {
  const completedUnits = Math.min(3, Math.max(0, Math.trunc(job.progress?.completedUnits ?? 0)));
  const repairAction = job.state === "failed_retryable" ? "retry"
    : job.state === "failed_final" ? "choose_destination"
      : new Set(["completed", "completed_with_warnings", "cancelled"]).has(job.state) ? "clear" : "none";
  return {
    jobId: job.id,
    state: job.state as DiagnosticsSupportBundleJobSummary["state"],
    progress: {
      completedUnits,
      totalUnits: 3,
      percent: Math.round(completedUnits / 3 * 100),
      messageKey: job.progress?.messageKey ?? `diagnostics.support.${job.state}`
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    canCancel: job.state === "queued" || job.state === "running" || job.state === "cancel_requested",
    canRetry: job.state === "failed_retryable",
    repairAction,
    ...(job.error ? { error: job.error } : {})
  };
}

function supportCheckpoints() {
  return ["payload_prepared", "bundle_writing", "bundle_published"].map((id) => ({
    id, step: id, state: "not_started" as const, inputRefs: [], outputRefs: []
  }));
}

function checkpointState(job: JobRecord, id: string, state: "running" | "done") {
  const now = job.updatedAt;
  return (job.checkpoints ?? supportCheckpoints()).map((checkpoint) => checkpoint.id === id
    ? { ...checkpoint, state, ...(state === "running" ? { startedAt: now } : { finishedAt: now }) }
    : checkpoint);
}

function diagnosticsError(code: string, retryable: boolean, userAction: "retry" | "choose_path") {
  return { code, domain: "diagnostics" as const, messageKey: `errors.${code}`, retryable, severity: "error" as const, userAction };
}

function failFinal(
  jobs: JobRecordStore,
  snapshot: JobRecordSnapshot,
  now: string,
  code: string,
  action: "choose_path"
): JobRecordSnapshot {
  return jobs.compareAndSwap(snapshot, JobRecordSchema.parse({
    ...snapshot.job,
    state: "failed_final",
    updatedAt: now,
    finishedAt: now,
    error: diagnosticsError(code, false, action),
    message: "Support bundle recovery requires a new trusted local destination."
  }));
}

function assertStartBinding(binding: SupportBundleBinding, request: DiagnosticsExportSupportBundleRequest): void {
  if (binding.requestId !== request.requestId || binding.previewId !== request.previewId ||
    binding.scopeContextId !== request.scopeContextId || binding.expectedRevision !== request.expectedRevision) {
    throw lifecycleError("diagnostics.request_conflict");
  }
}

function parseRegistry(value: unknown): DiagnosticsRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("diagnostics.registry_invalid");
  const candidate = value as Partial<DiagnosticsRegistry>;
  if (Object.keys(value).sort().join(",") !== "jobIds,machineScopeId,revision,schemaVersion" || candidate.schemaVersion !== 1 ||
    !Number.isSafeInteger(candidate.revision) || candidate.revision! < 0 || typeof candidate.machineScopeId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.machineScopeId) || !Array.isArray(candidate.jobIds) || candidate.jobIds.length > 4096 ||
    candidate.jobIds.some((id) => typeof id !== "string" || !/^job_\d{8}_[a-z0-9]{8,}$/u.test(id)) ||
    new Set(candidate.jobIds).size !== candidate.jobIds.length) throw lifecycleError("diagnostics.registry_invalid");
  return candidate as DiagnosticsRegistry;
}

function parseBinding(value: unknown, jobId: string): SupportBundleBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("diagnostics.binding_invalid");
  const candidate = value as Partial<SupportBundleBinding>;
  const keys = candidate.state === "published"
    ? "activeVaultId,contentBytes,contentSha256,createdAt,destinationPath,expectedRevision,jobId,previewId,publishedAt,requestId,schemaVersion,scopeContextId,state"
    : "activeVaultId,contentBytes,contentSha256,createdAt,destinationPath,expectedRevision,jobId,previewId,requestId,schemaVersion,scopeContextId,state";
  if (Object.keys(value).sort().join(",") !== keys || candidate.schemaVersion !== 1 || candidate.jobId !== jobId ||
    typeof candidate.requestId !== "string" || !/^diagexportreq_[a-z0-9]{16,64}$/u.test(candidate.requestId) ||
    typeof candidate.previewId !== "string" || !/^supportpreview_[a-f0-9]{32,64}$/u.test(candidate.previewId) ||
    typeof candidate.scopeContextId !== "string" || !/^diagctx_[a-f0-9]{32,64}$/u.test(candidate.scopeContextId) ||
    (candidate.activeVaultId !== null && (typeof candidate.activeVaultId !== "string" || !/^vault_\d{8}_[a-z0-9]{8,}$/u.test(candidate.activeVaultId))) ||
    !Number.isSafeInteger(candidate.expectedRevision) || candidate.expectedRevision! < 0 || typeof candidate.destinationPath !== "string" ||
    !path.isAbsolute(candidate.destinationPath) || typeof candidate.contentSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(candidate.contentSha256) ||
    !Number.isSafeInteger(candidate.contentBytes) || candidate.contentBytes! < 1 || candidate.contentBytes! > MAX_PAYLOAD_BYTES ||
    typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt)) ||
    (candidate.state !== "prepared" && candidate.state !== "published") ||
    (candidate.state === "published" && (typeof candidate.publishedAt !== "string" || Number.isNaN(Date.parse(candidate.publishedAt))))) {
    throw lifecycleError("diagnostics.binding_invalid");
  }
  return candidate as SupportBundleBinding;
}

function parseClearReceipt(value: unknown, requestId: string): ClearReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("diagnostics.clear_receipt_invalid");
  const candidate = value as Partial<ClearReceipt>;
  const keys = candidate.state === "committed"
    ? "clearedArtifactCount,committedRevision,createdAt,expectedRevision,jobIds,requestId,schemaVersion,state"
    : "createdAt,expectedRevision,jobIds,requestId,schemaVersion,state";
  if (Object.keys(value).sort().join(",") !== keys || candidate.schemaVersion !== 1 || candidate.requestId !== requestId ||
    (candidate.state !== "prepared" && candidate.state !== "committed") || !Number.isSafeInteger(candidate.expectedRevision) ||
    candidate.expectedRevision! < 0 || !Array.isArray(candidate.jobIds) || typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) || (candidate.state === "committed" &&
      (!Number.isSafeInteger(candidate.committedRevision) || !Number.isSafeInteger(candidate.clearedArtifactCount) || candidate.clearedArtifactCount! < 0))) {
    throw lifecycleError("diagnostics.clear_receipt_invalid");
  }
  return candidate as ClearReceipt;
}

function scopeContextId(machineScopeId: string, activeVaultId: string | null): string {
  return `diagctx_${createHash("sha256").update("pige.diagnostics.scope.v1\0").update(machineScopeId)
    .update("\0").update(activeVaultId ?? "no_active_vault").digest("hex").slice(0, 48)}`;
}

function createJobId(now: string): string {
  return `job_${now.slice(0, 10).replaceAll("-", "")}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function nextRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw lifecycleError("diagnostics.revision_exhausted");
  return value + 1;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string { return JSON.stringify(value); }
function errorCode(value: unknown): string { return value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : "diagnostics.export_failed"; }
function lifecycleError(code: string): PigeDomainError { return new PigeDomainError(code, "Diagnostics lifecycle validation failed."); }
function isErrno(value: unknown, code: string): boolean { return !!value && typeof value === "object" && "code" in value && value.code === code; }

function privateDirectory(input: string, create: boolean): string {
  const resolved = path.resolve(input);
  if (create) fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw lifecycleError("diagnostics.path_unsafe");
  return fs.realpathSync.native(resolved);
}

function privateChild(parentInput: string, name: string): string {
  const parent = privateDirectory(parentInput, false);
  const target = path.join(parent, name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const child = privateDirectory(target, false);
  if (path.dirname(child) !== parent) throw lifecycleError("diagnostics.path_unsafe");
  return child;
}

function writePrivateFile(filePath: string, content: string): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(descriptor, content, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try { writePrivateFile(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, filePath); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function readTextRequired(filePath: string, maxBytes: number): string {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > maxBytes) throw lifecycleError("diagnostics.file_invalid");
    return fs.readFileSync(descriptor, "utf8");
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function readJsonRequired(filePath: string, maxBytes: number): unknown {
  try { return JSON.parse(readTextRequired(filePath, maxBytes)); }
  catch (caught) { if (isErrno(caught, "ENOENT")) throw caught; throw lifecycleError("diagnostics.json_invalid"); }
}

function readJsonOptional(filePath: string, maxBytes: number): unknown | undefined {
  try { return readJsonRequired(filePath, maxBytes); } catch (caught) { if (isErrno(caught, "ENOENT")) return undefined; throw caught; }
}

function moveIfPresent(source: string, destination: string): number {
  try { fs.renameSync(source, destination); return 1; }
  catch (caught) {
    if (isErrno(caught, "ENOENT") && fs.existsSync(destination)) return 0;
    if (isErrno(caught, "ENOENT")) return 0;
    throw caught;
  }
}

function safeDirectoryNames(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
}
