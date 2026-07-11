import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, PermissionDecisionIdSchema, type JobRecord } from "@pige/schemas";
import {
  LocalToolPackageError,
  stageLocalToolPackage,
  verifyLocalToolPackageDirectory,
  type LocalToolPackageIdentity
} from "./local-tool-package";
import {
  LocalToolLifecycleStore,
  LocalToolLifecycleStoreError
} from "./local-tool-lifecycle-store";
import type {
  LocalToolAssetDefinition,
  LocalToolAssetRecord,
  LocalToolCandidateActionRequest,
  LocalToolCatalog,
  LocalToolDefinition,
  LocalToolFailurePoint,
  LocalToolHealthResult,
  LocalToolInspection,
  LocalToolInstalledTargetRecord,
  LocalToolLifecycleAction,
  LocalToolLifecycleJobRecorder,
  LocalToolLifecycleRecord,
  LocalToolLifecycleResult,
  LocalToolMutationIdentity,
  LocalToolPermissionPort,
  LocalToolRecoveryRequest,
  LocalToolRecoveryResult,
  LocalToolSelfTestPort,
  LocalToolSelfTestResult,
  LocalToolSetEnabledRequest,
  LocalToolTargetActionRequest,
  LocalToolTargetInspection
} from "./local-tool-manager-types";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SELF_TEST_TIMEOUT_MS = 5_000;
const SELF_TEST_MAX_OUTPUT_BYTES = 64 * 1024;

export interface LocalToolManagerOptions {
  readonly trustedAppDataRoot: string;
  readonly localToolRoot: string;
  readonly catalog: LocalToolCatalog;
  readonly permissionPort: LocalToolPermissionPort;
  readonly jobRecorder: LocalToolLifecycleJobRecorder;
  readonly selfTestPort: LocalToolSelfTestPort;
  readonly platform?: "macos" | "windows" | "linux";
  readonly architecture?: "arm64" | "x64";
  readonly now?: () => Date;
  readonly faultInjector?: (point: LocalToolFailurePoint) => void;
  readonly selfTestTimeoutMs?: number;
  readonly selfTestMaxOutputBytes?: number;
}

interface TargetDefinition {
  readonly tool: LocalToolDefinition;
  readonly target: LocalToolDefinition | LocalToolAssetDefinition;
  readonly assetId?: string;
}

interface BegunJob {
  readonly job: JobRecord;
  readonly idempotent: boolean;
}

class LocalToolActionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "LocalToolActionError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class LocalToolManagerService {
  readonly #store: LocalToolLifecycleStore;
  readonly #catalog: ReadonlyMap<string, LocalToolDefinition>;
  readonly #permissionPort: LocalToolPermissionPort;
  readonly #jobRecorder: LocalToolLifecycleJobRecorder;
  readonly #selfTestPort: LocalToolSelfTestPort;
  readonly #platform: "macos" | "windows" | "linux";
  readonly #architecture: "arm64" | "x64";
  readonly #now: () => Date;
  readonly #faultInjector: ((point: LocalToolFailurePoint) => void) | undefined;
  readonly #selfTestTimeoutMs: number;
  readonly #selfTestMaxOutputBytes: number;

  constructor(options: LocalToolManagerOptions) {
    this.#store = new LocalToolLifecycleStore(options.localToolRoot, options.trustedAppDataRoot);
    this.#catalog = validateCatalog(options.catalog);
    this.#permissionPort = options.permissionPort;
    this.#jobRecorder = options.jobRecorder;
    this.#selfTestPort = options.selfTestPort;
    this.#platform = options.platform ?? normalizePlatform(process.platform);
    this.#architecture = options.architecture ?? normalizeArchitecture(process.arch);
    this.#now = options.now ?? (() => new Date());
    this.#faultInjector = options.faultInjector;
    this.#selfTestTimeoutMs = boundedPositiveInteger(options.selfTestTimeoutMs ?? SELF_TEST_TIMEOUT_MS, 60_000);
    this.#selfTestMaxOutputBytes = boundedPositiveInteger(
      options.selfTestMaxOutputBytes ?? SELF_TEST_MAX_OUTPUT_BYTES,
      1024 * 1024
    );
  }

  inspect(toolId: string): LocalToolInspection {
    const tool = this.#requireTool(toolId);
    if (!isPlatformSupported(tool, this.#platform, this.#architecture)) {
      return unsupportedInspection(tool);
    }

    let record: LocalToolLifecycleRecord | undefined;
    try {
      record = this.#store.read(tool.toolId);
    } catch {
      return invalidRecordInspection(tool);
    }

    const root = this.#inspectTarget(tool, tool, record, record, true);
    const assets = (tool.assets ?? []).map((asset) => {
      const assetRecord = record?.assets.find((entry) => entry.assetId === asset.assetId);
      return this.#inspectTarget(tool, asset, record, assetRecord, root.routable);
    });
    const routedCapabilities = uniqueStrings([
      ...(root.routable ? root.capabilities : []),
      ...assets.flatMap((asset) => asset.routable ? asset.capabilities : [])
    ]);
    return { ...root, assets, routedCapabilities };
  }

  health(toolId: string): LocalToolHealthResult {
    const inspection = this.inspect(toolId);
    return {
      toolId: inspection.toolId,
      installState: inspection.installState,
      enabled: inspection.enabled,
      healthy: inspection.healthy,
      routable: inspection.routable,
      assets: inspection.assets.map((asset) => ({
        ...(asset.assetId ? { assetId: asset.assetId } : {}),
        installState: asset.installState,
        enabled: asset.enabled,
        healthy: asset.healthy,
        routable: asset.routable,
        ...(asset.activeVersion ? { activeVersion: asset.activeVersion } : {})
      }))
    };
  }

  install(request: LocalToolCandidateActionRequest): Promise<LocalToolLifecycleResult> {
    return this.#applyCandidate("install", request);
  }

  update(request: LocalToolCandidateActionRequest): Promise<LocalToolLifecycleResult> {
    return this.#applyCandidate("update", request);
  }

  repair(request: LocalToolCandidateActionRequest): Promise<LocalToolLifecycleResult> {
    return this.#applyCandidate("repair", request);
  }

  async test(request: LocalToolTargetActionRequest): Promise<LocalToolLifecycleResult> {
    const target = this.#authorizeTargetAction("test", request);
    const begun = this.#beginJob("test", request, true);
    if (begun.idempotent) return this.#resultFromExistingJob(begun.job, request.toolId);

    let job = begun.job;
    let stagingOwned = false;
    let healthFailureDetected = false;
    let testedRecord: LocalToolLifecycleRecord | undefined;
    try {
      const record = this.#requireRecord(request.toolId);
      testedRecord = record;
      const targetRecord = requireActiveTargetRecord(record, request.assetId);
      assertRequestedVersion(request.version, targetRecord.activeVersion);
      assertTargetMetadataMatchesDefinition(targetRecord, target.target);
      const identity = identityFromRecord(request.toolId, request.assetId, targetRecord, target.target);
      const absolutePath = this.#store.verifiedOwnedPath(requireValue(targetRecord.activeRelativePath));
      this.#store.prepare();
      let staged: ReturnType<typeof stageLocalToolPackage>;
      try {
        staged = stageLocalToolPackage({
          candidatePath: absolutePath,
          stagingPath: this.#store.stagingPath(request.requestId),
          expected: identity
        });
      } catch (caught) {
        healthFailureDetected = caught instanceof LocalToolPackageError;
        throw caught;
      }
      stagingOwned = true;
      this.#inject("test");
      try {
        await this.#runSelfTest(target, staged.stagingPath, staged.manifest);
      } catch (caught) {
        healthFailureDetected = true;
        throw caught;
      }
      this.#store.discardStaging(request.requestId);
      stagingOwned = false;
      assertRecordUnchanged(record, this.#store.read(request.toolId));
      const updatedRecord = updateTargetRecord(record, request.assetId, {
        ...targetRecord,
        installState: "installed",
        health: "pass"
      }, job.id, this.#nowIso());
      this.#store.write(updatedRecord);
      job = this.#completeJob(job, "Local tool test passed.", [toolOutputRef(request, identity.expectedSha256)]);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    } catch (caught) {
      if (stagingOwned) this.#store.discardStaging(request.requestId);
      if (healthFailureDetected && testedRecord) {
        try {
          this.#markTestFailure(request, job.id, testedRecord);
        } catch {
          // The durable Job still reports the failed test if the health record cannot be updated.
        }
      }
      job = this.#failJob(job, caught);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    }
  }

  setEnabled(request: LocalToolSetEnabledRequest): LocalToolLifecycleResult {
    this.#authorizeTargetAction("set_enabled", request);
    const begun = this.#beginJob("set_enabled", request, false);
    if (begun.idempotent) return this.#resultFromExistingJob(begun.job, request.toolId);

    let job = begun.job;
    try {
      const record = this.#requireRecord(request.toolId);
      const targetRecord = requireActiveTargetRecord(record, request.assetId);
      assertRequestedVersion(request.version, targetRecord.activeVersion);
      if (request.enabled) {
        const inspection = inspectionForTarget(this.inspect(request.toolId), request.assetId);
        if (!inspection.healthy || !["installed", "needs_update"].includes(inspection.installState)) {
          throw new LocalToolActionError(
            "settings.local_tool_repair_required",
            "Local tool must pass health validation before it can be enabled.",
            false
          );
        }
      }
      const updatedRecord = updateTargetRecord(
        record,
        request.assetId,
        { ...targetRecord, enabled: request.enabled },
        job.id,
        this.#nowIso()
      );
      this.#inject("record_precommit");
      this.#store.write(updatedRecord);
      job = this.#completeJob(job, request.enabled ? "Local tool enabled." : "Local tool disabled.");
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    } catch (caught) {
      job = this.#failJob(job, caught);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    }
  }

  remove(request: LocalToolTargetActionRequest): LocalToolLifecycleResult {
    const target = this.#authorizeTargetAction("remove", request);
    const begun = this.#beginJob("remove", request, false);
    if (begun.idempotent) return this.#resultFromExistingJob(begun.job, request.toolId);

    let job = begun.job;
    try {
      const existing = this.#store.read(request.toolId);
      if (!existing) {
        job = this.#completeJob(job, "Local tool was already available.");
        return { job, inspection: this.inspect(request.toolId), idempotent: false };
      }
      const currentTarget = targetRecordFor(existing, request.assetId);
      if (!currentTarget?.activeRelativePath) {
        job = this.#completeJob(job, "Local tool was already available.");
        return { job, inspection: this.inspect(request.toolId), idempotent: false };
      }
      assertRequestedVersion(request.version, currentTarget.activeVersion);
      const relativePath = currentTarget.activeRelativePath;
      const availableTarget = availableTargetRecord(target.target);
      const pending = uniqueStrings([...(existing.cleanupPendingRelativePaths ?? []), relativePath]);
      const unavailable = updateTargetRecord(
        { ...existing, cleanupPendingRelativePaths: pending },
        request.assetId,
        availableTarget,
        job.id,
        this.#nowIso()
      );
      this.#inject("record_precommit");
      this.#store.write(unavailable);

      let cleanupWarning = false;
      try {
        this.#store.quarantineOwnedPath(relativePath, request.requestId, request.assetId ? "asset" : "tool");
        const cleaned = {
          ...unavailable,
          cleanupPendingRelativePaths: (unavailable.cleanupPendingRelativePaths ?? [])
            .filter((entry) => entry !== relativePath)
        };
        this.#store.write(cleaned);
      } catch {
        cleanupWarning = true;
      }

      job = cleanupWarning
        ? this.#completeJobWithWarnings(job, "Local tool was disabled; owned-byte cleanup remains pending.")
        : this.#completeJob(job, "Local tool removed.");
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    } catch (caught) {
      job = this.#failJob(job, caught);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    }
  }

  recoverStaging(request: LocalToolRecoveryRequest): LocalToolRecoveryResult {
    this.#authorizeRecovery(request);
    const begun = this.#beginRecoveryJob(request);
    if (begun.idempotent) {
      return { job: begun.job, idempotent: true, recoveredEntries: 0 };
    }

    let job = begun.job;
    try {
      const recoveredEntries = this.#store.recoverOwnedEntries(request.requestId, job.id, this.#nowIso());
      job = this.#completeJob(job, "Local-tool staging recovery completed.");
      return { job, idempotent: false, recoveredEntries };
    } catch (caught) {
      job = this.#failJob(job, caught);
      return { job, idempotent: false, recoveredEntries: 0 };
    }
  }

  async #applyCandidate(
    action: "install" | "update" | "repair",
    request: LocalToolCandidateActionRequest
  ): Promise<LocalToolLifecycleResult> {
    const target = this.#authorizeCandidateAction(action, request);
    const begun = this.#beginJob(action, request, true);
    if (begun.idempotent) return this.#resultFromExistingJob(begun.job, request.toolId);

    let job = begun.job;
    let publishedRelativePath: string | undefined;
    let publishedNew = false;
    let repairRollbackPath: string | undefined;
    let stagingOwned = false;
    try {
      const beforeRecord = this.#store.read(request.toolId);
      this.#assertCandidateTransition(action, beforeRecord, request.assetId, request.version);
      this.#inject("copy");
      this.#store.prepare();
      const stagingPath = this.#store.stagingPath(request.requestId);
      const staged = stageLocalToolPackage({
        candidatePath: request.candidatePath,
        stagingPath,
        expected: target.target
      });
      stagingOwned = true;
      this.#inject("verify");
      this.#inject("test");
      await this.#runSelfTest(target, staged.stagingPath, staged.manifest);

      publishedRelativePath = this.#store.targetRelativePath({
        toolId: request.toolId,
        ...(request.assetId ? { assetId: request.assetId } : {}),
        version: request.version,
        packageSha256: staged.packageSha256
      });
      const publishedPath = this.#store.absoluteOwnedPath(publishedRelativePath);
      this.#inject("publish");
      if (fs.existsSync(publishedPath)) {
        try {
          verifyLocalToolPackageDirectory(publishedPath, target.target);
          this.#store.discardStaging(request.requestId);
          stagingOwned = false;
        } catch (caught) {
          if (action !== "repair" || !recordReferencesPath(beforeRecord, publishedRelativePath)) throw caught;
          repairRollbackPath = this.#store.quarantineOwnedPath(
            publishedRelativePath,
            request.requestId,
            "repair-previous"
          );
          this.#store.publishStaging(staged.stagingPath, publishedRelativePath);
          publishedNew = true;
          stagingOwned = false;
        }
      } else {
        this.#store.publishStaging(staged.stagingPath, publishedRelativePath);
        publishedNew = true;
        stagingOwned = false;
      }
      verifyLocalToolPackageDirectory(publishedPath, target.target);

      const latestRecord = this.#store.read(request.toolId);
      assertRecordUnchanged(beforeRecord, latestRecord);
      const currentRecord = latestRecord ?? createAvailableRecord(target.tool, job.id, this.#nowIso());
      const priorTarget = targetRecordFor(currentRecord, request.assetId);
      const enabled = priorTarget?.activeRelativePath ? priorTarget.enabled : true;
      const installedTarget = installedTargetRecord(target.target, publishedRelativePath, staged.sizeBytes, enabled);
      const updatedRecord = updateTargetRecord(
        currentRecord,
        request.assetId,
        installedTarget,
        job.id,
        this.#nowIso()
      );
      this.#inject("record_precommit");
      this.#store.write(updatedRecord);
      repairRollbackPath = undefined;
      job = this.#completeJob(job, `Local tool ${action} completed.`, [
        toolOutputRef(request, staged.packageSha256)
      ]);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    } catch (caught) {
      if (stagingOwned) this.#store.discardStaging(request.requestId);
      if (publishedNew && publishedRelativePath) {
        try {
          const current = this.#store.read(request.toolId);
          if (!recordReferencesPath(current, publishedRelativePath)) {
            this.#store.quarantineOwnedPath(publishedRelativePath, request.requestId, "failed-publication");
          }
        } catch {
          // Orphaned versions are never routable without a valid record and are recovered later.
        }
      }
      if (repairRollbackPath && publishedRelativePath) {
        try {
          const targetPath = this.#store.absoluteOwnedPath(publishedRelativePath);
          if (fs.existsSync(targetPath)) {
            this.#store.quarantineOwnedPath(publishedRelativePath, request.requestId, "failed-repair");
          }
          this.#store.restoreQuarantinedPath(repairRollbackPath, publishedRelativePath);
        } catch {
          // Cross-file repair rollback is best effort in this bounded foundation.
        }
      }
      job = this.#failJob(job, caught);
      return { job, inspection: this.inspect(request.toolId), idempotent: false };
    }
  }

  #authorizeCandidateAction(
    action: "install" | "update" | "repair",
    request: LocalToolCandidateActionRequest
  ): TargetDefinition {
    const target = this.#authorizeTargetAction(action, request);
    if (request.version !== target.target.version || request.expectedSha256 !== target.target.expectedSha256) {
      throw new PigeDomainError(
        "settings.local_tool_identity_mismatch",
        "Local-tool request does not match the approved catalog definition."
      );
    }
    if (!SHA256_PATTERN.test(request.expectedSha256)) {
      throw new PigeDomainError("settings.local_tool_checksum_mismatch", "Local-tool request checksum is invalid.");
    }
    if (typeof request.candidatePath !== "string" || request.candidatePath.length === 0) {
      throw new PigeDomainError("settings.local_tool_candidate_invalid", "Local-tool candidate path is missing.");
    }
    return target;
  }

  #authorizeTargetAction(
    action: Exclude<LocalToolLifecycleAction, "recover_staging">,
    request: LocalToolMutationIdentity
  ): TargetDefinition {
    assertExplicitUserOrigin(request.userOrigin);
    assertRequestId(request.requestId);
    let decisionId: string;
    try {
      decisionId = PermissionDecisionIdSchema.parse(request.permissionDecisionId);
    } catch {
      throw new PigeDomainError("permission.decision_invalid", "A valid local-tool permission decision is required.");
    }
    const target = this.#requireTarget(request.toolId, request.assetId);
    if (!isPlatformSupported(target.target, this.#platform, this.#architecture)) {
      throw new PigeDomainError("settings.local_tool_unsupported", "Local tool is unsupported on this platform.");
    }
    const enabled = requestEnabledValue(request);
    this.#permissionPort.assertAuthorized({
      permissionDecisionId: decisionId,
      actorType: "local_tool",
      action,
      toolId: request.toolId,
      ...(request.assetId ? { assetId: request.assetId } : {}),
      ...(request.version ? { version: request.version } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      capability: "install_local_tool",
      resourceScope: "current_action"
    });
    return target;
  }

  #authorizeRecovery(request: LocalToolRecoveryRequest): void {
    assertExplicitUserOrigin(request.userOrigin);
    assertRequestId(request.requestId);
    let decisionId: string;
    try {
      decisionId = PermissionDecisionIdSchema.parse(request.permissionDecisionId);
    } catch {
      throw new PigeDomainError("permission.decision_invalid", "A valid local-tool permission decision is required.");
    }
    this.#permissionPort.assertAuthorized({
      permissionDecisionId: decisionId,
      actorType: "local_tool",
      action: "recover_staging",
      toolId: "local-tool-root",
      capability: "install_local_tool",
      resourceScope: "current_action"
    });
  }

  #beginJob(
    action: LocalToolLifecycleAction,
    request: LocalToolMutationIdentity,
    accessesExternalFiles: boolean
  ): BegunJob {
    const existing = this.#jobRecorder.findByRequestId(request.requestId);
    if (existing) {
      assertExistingJobMatches(existing, action, request);
      return { job: existing, idempotent: true };
    }
    const now = this.#nowIso();
    const queued = JobRecordSchema.parse({
      schemaVersion: 1,
      id: createJobId(now),
      class: "tool_install",
      state: "queued",
      priority: "maintenance",
      scope: "machine_local",
      createdAt: now,
      updatedAt: now,
      actor: userActor(),
      inputRefs: jobInputRefs(action, request),
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: accessesExternalFiles,
        permissionDecisionIds: [request.permissionDecisionId]
      },
      message: `Local tool ${action} queued.`
    });
    this.#jobRecorder.write(queued);
    const running = JobRecordSchema.parse({
      ...queued,
      state: "running",
      updatedAt: now,
      startedAt: now,
      message: `Local tool ${action} is running.`
    });
    this.#jobRecorder.write(running);
    return { job: running, idempotent: false };
  }

  #beginRecoveryJob(request: LocalToolRecoveryRequest): BegunJob {
    const identity: LocalToolMutationIdentity = {
      ...request,
      toolId: "local-tool-root"
    };
    return this.#beginJob("recover_staging", identity, false);
  }

  #completeJob(job: JobRecord, message: string, outputRefs?: readonly unknown[]): JobRecord {
    const finishedAt = this.#nowIso();
    const completed = JobRecordSchema.parse({
      ...job,
      state: "completed",
      updatedAt: finishedAt,
      finishedAt,
      ...(outputRefs ? { outputRefs } : {}),
      message
    });
    this.#jobRecorder.write(completed);
    return completed;
  }

  #completeJobWithWarnings(job: JobRecord, message: string): JobRecord {
    const finishedAt = this.#nowIso();
    const completed = JobRecordSchema.parse({
      ...job,
      state: "completed_with_warnings",
      updatedAt: finishedAt,
      finishedAt,
      warnings: [{
        code: "settings.local_tool_cleanup_pending",
        domain: "settings",
        messageKey: "error.settings.local_tool_cleanup_pending"
      }],
      message
    });
    this.#jobRecorder.write(completed);
    return completed;
  }

  #failJob(job: JobRecord, caught: unknown): JobRecord {
    const failure = normalizeFailure(caught);
    const finishedAt = this.#nowIso();
    const failed = JobRecordSchema.parse({
      ...job,
      state: failure.retryable ? "failed_retryable" : "failed_final",
      updatedAt: finishedAt,
      finishedAt,
      error: {
        code: failure.code,
        domain: "settings",
        messageKey: `error.${failure.code}`,
        retryable: failure.retryable,
        severity: "error",
        userAction: failure.retryable ? "retry" : "repair_tool"
      },
      retry: failure.retryable
        ? { retryCount: 0, maxAutomaticRetries: 0, requiresUserAction: true }
        : undefined,
      message: failure.retryable
        ? "Local tool action failed and can be retried."
        : "Local tool action failed closed."
    });
    this.#jobRecorder.write(failed);
    return failed;
  }

  async #runSelfTest(
    target: TargetDefinition,
    stagedRootPath: string,
    manifest: Parameters<LocalToolSelfTestPort["run"]>[0]["manifest"]
  ): Promise<void> {
    const result = await withTimeout(
      this.#selfTestPort.run({
        toolId: target.tool.toolId,
        ...(target.assetId ? { assetId: target.assetId } : {}),
        version: target.target.version,
        stagedRootPath,
        manifest,
        networkAllowed: false,
        timeoutMs: this.#selfTestTimeoutMs,
        maxOutputBytes: this.#selfTestMaxOutputBytes
      }),
      this.#selfTestTimeoutMs
    );
    assertSelfTestResult(result, this.#selfTestMaxOutputBytes);
    if (!result.passed) {
      throw new LocalToolActionError("settings.local_tool_test_failed", "Local-tool self-test failed.", true);
    }
  }

  #markTestFailure(
    request: LocalToolTargetActionRequest,
    jobId: string,
    testedRecord: LocalToolLifecycleRecord
  ): void {
    const record = this.#store.read(request.toolId);
    if (!record) return;
    assertRecordUnchanged(testedRecord, record);
    const target = targetRecordFor(record, request.assetId);
    if (!target?.activeRelativePath) return;
    this.#store.write(updateTargetRecord(
      record,
      request.assetId,
      { ...target, installState: "repair_needed", health: "fail" },
      jobId,
      this.#nowIso()
    ));
  }

  #assertCandidateTransition(
    action: "install" | "update" | "repair",
    record: LocalToolLifecycleRecord | undefined,
    assetId: string | undefined,
    requestedVersion: string
  ): void {
    const target = record ? targetRecordFor(record, assetId) : undefined;
    if (action === "install" && target?.activeRelativePath) {
      throw new LocalToolActionError("settings.local_tool_already_installed", "Local tool is already installed.", false);
    }
    if (action === "update" && !target?.activeRelativePath) {
      throw new LocalToolActionError("settings.local_tool_not_installed", "Local tool must be installed before update.", false);
    }
    if (action === "update" && target?.activeVersion === requestedVersion) {
      throw new LocalToolActionError(
        "settings.local_tool_version_conflict",
        "Local-tool update must select a different approved version.",
        false
      );
    }
    if (action === "repair" && !target?.activeRelativePath) {
      throw new LocalToolActionError("settings.local_tool_not_installed", "Local tool must be installed before repair.", false);
    }
    if (action === "repair") {
      const inspection = inspectionForTarget(this.inspect(record!.toolId), assetId);
      if (inspection.installState !== "repair_needed") {
        throw new LocalToolActionError("settings.local_tool_repair_not_needed", "Local tool does not require repair.", false);
      }
    }
  }

  #inspectTarget(
    tool: LocalToolDefinition,
    definition: LocalToolDefinition | LocalToolAssetDefinition,
    record: LocalToolLifecycleRecord | undefined,
    targetRecord: LocalToolInstalledTargetRecord | undefined,
    parentRoutable: boolean
  ): LocalToolTargetInspection {
    const assetId = "assetId" in definition && definition.assetId ? definition.assetId : undefined;
    const label = assetId ?? tool.label;
    const base = inspectionBase(tool.toolId, assetId, label, definition);
    if (!targetRecord) return { ...base, installState: "available", enabled: false, healthy: false, routable: false };
    if (targetRecord.installState === "error") {
      return { ...base, installState: "error", enabled: false, healthy: false, routable: false };
    }
    if (targetRecord.installState === "available" || !targetRecord.activeRelativePath) {
      return { ...base, installState: "available", enabled: false, healthy: false, routable: false };
    }

    let packageHealthy = false;
    try {
      assertTargetMetadataMatchesDefinition(targetRecord, definition);
      const expectedRelativePath = this.#store.targetRelativePath({
        toolId: tool.toolId,
        ...(assetId ? { assetId } : {}),
        version: requireValue(targetRecord.activeVersion),
        packageSha256: requireValue(targetRecord.activeManifestSha256)
      });
      if (targetRecord.activeRelativePath !== expectedRelativePath) {
        throw new LocalToolActionError(
          "settings.local_tool_record_invalid",
          "Local-tool active path is not bound to its recorded identity.",
          true
        );
      }
      const identity = identityFromRecord(tool.toolId, assetId, targetRecord, definition);
      verifyLocalToolPackageDirectory(this.#store.verifiedOwnedPath(targetRecord.activeRelativePath), identity);
      packageHealthy = targetRecord.health === "pass";
    } catch {
      packageHealthy = false;
    }
    const healthy = packageHealthy && targetRecord.installState !== "repair_needed";
    const installState = healthy
      ? targetRecord.activeVersion === definition.version
        ? "installed"
        : "needs_update"
      : "repair_needed";
    const routable = healthy && targetRecord.enabled && parentRoutable;
    return {
      ...base,
      installState,
      enabled: targetRecord.enabled,
      healthy,
      routable,
      ...(targetRecord.activeVersion ? { activeVersion: targetRecord.activeVersion } : {}),
      ...(targetRecord.activeManifestSha256 ? { manifestSha256: targetRecord.activeManifestSha256 } : {}),
      ...(targetRecord.sizeBytes !== undefined ? { sizeBytes: targetRecord.sizeBytes } : {}),
      capabilities: definition.capabilities,
      license: definition.license,
      platform: definition.platform,
      architecture: definition.architecture
    };
  }

  #requireTool(toolId: string): LocalToolDefinition {
    const tool = this.#catalog.get(toolId);
    if (!tool) throw new PigeDomainError("settings.local_tool_unknown", "Local tool is not in the approved catalog.");
    return tool;
  }

  #requireTarget(toolId: string, assetId?: string): TargetDefinition {
    const tool = this.#requireTool(toolId);
    if (!assetId) return { tool, target: tool };
    const asset = tool.assets?.find((entry) => entry.assetId === assetId);
    if (!asset) throw new PigeDomainError("settings.local_tool_asset_unknown", "Local-tool asset is not in the approved catalog.");
    return { tool, target: asset, assetId };
  }

  #requireRecord(toolId: string): LocalToolLifecycleRecord {
    const record = this.#store.read(toolId);
    if (!record) throw new LocalToolActionError("settings.local_tool_not_installed", "Local tool is not installed.", false);
    return record;
  }

  #resultFromExistingJob(job: JobRecord, toolId: string): LocalToolLifecycleResult {
    return { job, inspection: this.inspect(toolId), idempotent: true };
  }

  #inject(point: LocalToolFailurePoint): void {
    this.#faultInjector?.(point);
  }

  #nowIso(): string {
    return this.#now().toISOString();
  }
}

function validateCatalog(catalog: LocalToolCatalog): ReadonlyMap<string, LocalToolDefinition> {
  const tools = new Map<string, LocalToolDefinition>();
  for (const tool of catalog.tools) {
    validateDefinition(tool, undefined);
    if (tools.has(tool.toolId)) throw new Error(`Duplicate local-tool catalog ID: ${tool.toolId}`);
    const assets = new Set<string>();
    for (const asset of tool.assets ?? []) {
      validateDefinition(asset, tool.toolId);
      if (assets.has(asset.assetId)) throw new Error(`Duplicate local-tool asset ID: ${asset.assetId}`);
      assets.add(asset.assetId);
    }
    tools.set(tool.toolId, tool);
  }
  return tools;
}

function validateDefinition(
  definition: LocalToolDefinition | LocalToolAssetDefinition,
  parentToolId: string | undefined
): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(definition.toolId)) throw new Error("Invalid local-tool catalog ID.");
  if (parentToolId && definition.toolId !== parentToolId) throw new Error("Local-tool asset parent identity mismatch.");
  if (parentToolId && !("assetId" in definition) || parentToolId && !definition.assetId) {
    throw new Error("Local-tool assets require independent asset IDs.");
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,79}$/.test(definition.version)) throw new Error("Invalid local-tool version.");
  if (!SHA256_PATTERN.test(definition.expectedSha256)) throw new Error("Invalid local-tool package checksum.");
  if (!Number.isSafeInteger(definition.expectedSizeBytes) || definition.expectedSizeBytes < 0) {
    throw new Error("Invalid local-tool package size.");
  }
  if (definition.capabilities.length === 0 || new Set(definition.capabilities).size !== definition.capabilities.length) {
    throw new Error("Local-tool capabilities must be non-empty and unique.");
  }
}

function installedTargetRecord(
  definition: LocalToolDefinition | LocalToolAssetDefinition,
  relativePath: string,
  sizeBytes: number,
  enabled: boolean
): LocalToolInstalledTargetRecord {
  return {
    installState: "installed",
    enabled,
    activeVersion: definition.version,
    activeManifestSha256: definition.expectedSha256,
    activeRelativePath: relativePath,
    platform: definition.platform,
    architecture: definition.architecture,
    capabilities: [...definition.capabilities],
    license: definition.license,
    sizeBytes,
    health: "pass"
  };
}

function availableTargetRecord(
  definition: LocalToolDefinition | LocalToolAssetDefinition
): LocalToolInstalledTargetRecord {
  return {
    installState: "available",
    enabled: false,
    platform: definition.platform,
    architecture: definition.architecture,
    capabilities: [...definition.capabilities],
    license: definition.license,
    health: "unknown"
  };
}

function createAvailableRecord(tool: LocalToolDefinition, jobId: string, updatedAt: string): LocalToolLifecycleRecord {
  return {
    schemaVersion: 1,
    toolId: tool.toolId,
    ...availableTargetRecord(tool),
    assets: (tool.assets ?? []).map((asset): LocalToolAssetRecord => ({
      assetId: asset.assetId,
      ...availableTargetRecord(asset)
    })),
    updatedAt,
    lastLifecycleJobId: jobId
  };
}

function updateTargetRecord(
  record: LocalToolLifecycleRecord,
  assetId: string | undefined,
  target: LocalToolInstalledTargetRecord,
  jobId: string,
  updatedAt: string
): LocalToolLifecycleRecord {
  if (!assetId) {
    const {
      activeVersion: _activeVersion,
      activeManifestSha256: _activeManifestSha256,
      activeRelativePath: _activeRelativePath,
      sizeBytes: _sizeBytes,
      ...recordWithoutActiveTarget
    } = record;
    return {
      ...recordWithoutActiveTarget,
      ...target,
      updatedAt,
      lastLifecycleJobId: jobId
    };
  }
  const assets = [...record.assets];
  const index = assets.findIndex((asset) => asset.assetId === assetId);
  const assetRecord: LocalToolAssetRecord = { assetId, ...target };
  if (index >= 0) assets[index] = assetRecord;
  else assets.push(assetRecord);
  return { ...record, assets, updatedAt, lastLifecycleJobId: jobId };
}

function targetRecordFor(
  record: LocalToolLifecycleRecord,
  assetId: string | undefined
): LocalToolInstalledTargetRecord | undefined {
  return assetId ? record.assets.find((asset) => asset.assetId === assetId) : record;
}

function requireActiveTargetRecord(
  record: LocalToolLifecycleRecord,
  assetId: string | undefined
): LocalToolInstalledTargetRecord {
  const target = targetRecordFor(record, assetId);
  if (!target?.activeRelativePath) {
    throw new LocalToolActionError("settings.local_tool_not_installed", "Local tool is not installed.", false);
  }
  return target;
}

function identityFromRecord(
  toolId: string,
  assetId: string | undefined,
  record: LocalToolInstalledTargetRecord,
  definition: LocalToolDefinition | LocalToolAssetDefinition
): LocalToolPackageIdentity {
  return {
    toolId,
    ...(assetId ? { assetId } : {}),
    version: requireValue(record.activeVersion),
    platform: definition.platform,
    architecture: definition.architecture,
    capabilities: definition.capabilities,
    license: definition.license,
    expectedSha256: requireValue(record.activeManifestSha256),
    expectedSizeBytes: requireValue(record.sizeBytes)
  };
}

function assertTargetMetadataMatchesDefinition(
  record: LocalToolInstalledTargetRecord,
  definition: LocalToolDefinition | LocalToolAssetDefinition
): void {
  if (
    record.platform !== definition.platform ||
    record.architecture !== definition.architecture ||
    !equalStringSets(record.capabilities, definition.capabilities) ||
    record.license.spdxId !== definition.license.spdxId ||
    record.license.name !== definition.license.name
  ) {
    throw new LocalToolActionError(
      "settings.local_tool_record_invalid",
      "Local-tool lifecycle metadata does not match the approved catalog.",
      true
    );
  }
}

function assertRecordUnchanged(
  before: LocalToolLifecycleRecord | undefined,
  current: LocalToolLifecycleRecord | undefined
): void {
  if (JSON.stringify(before) !== JSON.stringify(current)) {
    throw new LocalToolActionError(
      "settings.local_tool_record_changed",
      "Local-tool lifecycle record changed during this action.",
      true
    );
  }
}

function inspectionBase(
  toolId: string,
  assetId: string | undefined,
  label: string,
  definition: LocalToolDefinition | LocalToolAssetDefinition
): Omit<LocalToolTargetInspection, "installState" | "enabled" | "healthy" | "routable"> {
  return {
    toolId,
    ...(assetId ? { assetId } : {}),
    label,
    desiredVersion: definition.version,
    platform: definition.platform,
    architecture: definition.architecture,
    capabilities: definition.capabilities,
    license: definition.license
  };
}

function unsupportedInspection(tool: LocalToolDefinition): LocalToolInspection {
  const root = {
    ...inspectionBase(tool.toolId, undefined, tool.label, tool),
    installState: "unsupported" as const,
    enabled: false,
    healthy: false,
    routable: false
  };
  const assets = (tool.assets ?? []).map((asset) => ({
    ...inspectionBase(tool.toolId, asset.assetId, asset.assetId, asset),
    installState: "unsupported" as const,
    enabled: false,
    healthy: false,
    routable: false
  }));
  return { ...root, assets, routedCapabilities: [] };
}

function invalidRecordInspection(tool: LocalToolDefinition): LocalToolInspection {
  const root = {
    ...inspectionBase(tool.toolId, undefined, tool.label, tool),
    installState: "error" as const,
    enabled: false,
    healthy: false,
    routable: false
  };
  const assets = (tool.assets ?? []).map((asset) => ({
    ...inspectionBase(tool.toolId, asset.assetId, asset.assetId, asset),
    installState: "error" as const,
    enabled: false,
    healthy: false,
    routable: false
  }));
  return { ...root, assets, routedCapabilities: [] };
}

function inspectionForTarget(inspection: LocalToolInspection, assetId?: string): LocalToolTargetInspection {
  if (!assetId) return inspection;
  const asset = inspection.assets.find((entry) => entry.assetId === assetId);
  if (!asset) throw new LocalToolActionError("settings.local_tool_asset_unknown", "Local-tool asset is unknown.", false);
  return asset;
}

function isPlatformSupported(
  definition: LocalToolPackageIdentity,
  platform: "macos" | "windows" | "linux",
  architecture: "arm64" | "x64"
): boolean {
  return definition.platform === platform && definition.architecture === architecture;
}

function assertExplicitUserOrigin(userOrigin: string): void {
  if (userOrigin !== "user") {
    throw new PigeDomainError(
      "permission.user_origin_required",
      "Local-tool lifecycle changes require an explicit user action."
    );
  }
}

function assertRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new PigeDomainError("settings.local_tool_request_invalid", "Local-tool request identity is invalid.");
  }
}

function assertRequestedVersion(requested: string | undefined, active: string | undefined): void {
  if (requested && requested !== active) {
    throw new LocalToolActionError(
      "settings.local_tool_version_conflict",
      "Local-tool action does not match the active version.",
      false
    );
  }
}

function assertExistingJobMatches(
  job: JobRecord,
  action: LocalToolLifecycleAction,
  request: LocalToolMutationIdentity
): void {
  if (job.class !== "tool_install" || job.scope !== "machine_local") {
    throw new PigeDomainError("settings.local_tool_request_conflict", "Local-tool request identity is already in use.");
  }
  const targetId = targetRefId(request.toolId, request.assetId, request.version);
  const actionRef = job.inputRefs?.find((ref) => ref.role === "local_tool_action");
  const targetRef = job.inputRefs?.find((ref) => ref.role === "local_tool_target");
  const parameterRef = job.inputRefs?.find((ref) => ref.role === "local_tool_parameters");
  if (
    actionRef?.id !== action ||
    targetRef?.id !== targetId ||
    parameterRef?.id !== requestFingerprint(action, request)
  ) {
    throw new PigeDomainError("settings.local_tool_request_conflict", "Local-tool request identity conflicts with prior input.");
  }
}

function jobInputRefs(action: LocalToolLifecycleAction, request: LocalToolMutationIdentity) {
  return [
    { kind: "tool" as const, id: request.requestId, role: "local_tool_request" },
    { kind: "tool" as const, id: action, role: "local_tool_action" },
    { kind: "tool" as const, id: targetRefId(request.toolId, request.assetId, request.version), role: "local_tool_target" },
    { kind: "tool" as const, id: requestFingerprint(action, request), role: "local_tool_parameters" }
  ];
}

function requestFingerprint(action: LocalToolLifecycleAction, request: LocalToolMutationIdentity): string {
  const extended = request as LocalToolMutationIdentity & {
    readonly enabled?: boolean;
    readonly expectedSha256?: string;
  };
  const payload = JSON.stringify({
    action,
    toolId: request.toolId,
    assetId: request.assetId ?? null,
    version: request.version ?? null,
    enabled: extended.enabled ?? null,
    expectedSha256: extended.expectedSha256 ?? null
  });
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

function requestEnabledValue(request: LocalToolMutationIdentity): boolean | undefined {
  const value = (request as LocalToolMutationIdentity & { readonly enabled?: boolean }).enabled;
  return typeof value === "boolean" ? value : undefined;
}

function targetRefId(toolId: string, assetId?: string, version?: string): string {
  return [toolId, assetId ?? "engine", version ?? "active"].join(":");
}

function toolOutputRef(request: LocalToolMutationIdentity, checksum: string) {
  return {
    kind: "tool" as const,
    id: targetRefId(request.toolId, request.assetId, request.version),
    checksum,
    role: "local_tool_active_version"
  };
}

function createJobId(now: string): string {
  const dateKey = now.slice(0, 10).replaceAll("-", "");
  return `job_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function userActor() {
  return {
    kind: "user" as const,
    runtimeKind: "desktop_local" as const,
    clientCapabilityTier: "desktop_full" as const
  };
}

function normalizeFailure(caught: unknown): LocalToolActionError {
  if (caught instanceof LocalToolActionError) return caught;
  if (caught instanceof LocalToolPackageError || caught instanceof LocalToolLifecycleStoreError) {
    return new LocalToolActionError(caught.code, caught.message, isRetryableCode(caught.code));
  }
  if (caught instanceof PigeDomainError && caught.code.startsWith("settings.")) {
    return new LocalToolActionError(caught.code, caught.message, false);
  }
  return new LocalToolActionError(
    "settings.local_tool_io_failed",
    "Local-tool lifecycle action failed without exposing local paths.",
    true
  );
}

function isRetryableCode(code: string): boolean {
  return [
    "settings.local_tool_io_failed",
    "settings.local_tool_test_failed",
    "settings.local_tool_record_invalid",
    "settings.local_tool_candidate_missing"
  ].includes(code);
}

function assertSelfTestResult(result: LocalToolSelfTestResult, maxOutputBytes: number): void {
  const keys = Object.keys(result as unknown as Record<string, unknown>);
  const allowed = new Set(["schemaVersion", "passed", "outputBytes", "messageCode"]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    result.schemaVersion !== 1 ||
    typeof result.passed !== "boolean" ||
    !Number.isSafeInteger(result.outputBytes) ||
    result.outputBytes < 0 ||
    result.outputBytes > maxOutputBytes ||
    typeof result.messageCode !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,119}$/.test(result.messageCode)
  ) {
    throw new LocalToolActionError(
      "settings.local_tool_test_protocol_invalid",
      "Local-tool self-test returned an invalid bounded response.",
      true
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new LocalToolActionError(
          "settings.local_tool_test_timeout",
          "Local-tool self-test exceeded its time limit.",
          true
        )), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function recordReferencesPath(record: LocalToolLifecycleRecord | undefined, relativePath: string): boolean {
  if (!record) return false;
  if (record.activeRelativePath === relativePath) return true;
  return record.assets.some((asset) => asset.activeRelativePath === relativePath);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new LocalToolActionError("settings.local_tool_record_invalid", "Local-tool lifecycle record is incomplete.", true);
  }
  return value;
}

function boundedPositiveInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("Invalid local-tool bound.");
  return value;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function normalizePlatform(platform: NodeJS.Platform): "macos" | "windows" | "linux" {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  throw new Error(`Unsupported local-tool host platform: ${platform}`);
}

function normalizeArchitecture(architecture: string): "arm64" | "x64" {
  if (architecture === "arm64" || architecture === "x64") return architecture;
  throw new Error(`Unsupported local-tool host architecture: ${architecture}`);
}
