import { randomBytes } from "node:crypto";
import {
  PiPackageRollbackRequestSchema, PiPackageRollbackResultSchema,
  PiPackageSetPinnedRequestSchema, PiPackageSetPinnedResultSchema,
  PiPackageUpdateRequestSchema, PiPackageUpdateResultSchema,
  type PiPackageRegistrySummary, type PiPackageRollbackRequest, type PiPackageRollbackResult,
  type PiPackageSetPinnedRequest, type PiPackageSetPinnedResult,
  type PiPackageUpdateRequest, type PiPackageUpdateResult
} from "@pige/schemas";
import {
  PiPackageManagerService, type PiPackageRecord, type PiPackageRegistryFile,
  type PreparedPiPackageUpdate
} from "./pi-package-manager-service";
import type { PiPackageUpdateReceipt } from "./pi-package-lifecycle-store";

export interface PiPackageUpdateServiceOptions {
  readonly manager: PiPackageManagerService;
  readonly now?: () => Date;
  readonly rollbackId?: () => string;
}

export class PiPackageUpdateService {
  readonly #manager: PiPackageManagerService;
  readonly #now: () => Date;
  readonly #rollbackId: () => string;
  readonly #recovery: Promise<void>;

  constructor(options: PiPackageUpdateServiceOptions) {
    this.#manager = options.manager;
    this.#now = options.now ?? (() => new Date());
    this.#rollbackId = options.rollbackId ?? createRollbackId;
    this.#recovery = this.#manager.withLifecycleLock(() => this.#recoverPending());
  }

  async summary(): Promise<PiPackageRegistrySummary> {
    await this.#recovery;
    return this.#manager.summary();
  }

  async update(requestInput: PiPackageUpdateRequest, signal = new AbortController().signal): Promise<PiPackageUpdateResult> {
    const request = PiPackageUpdateRequestSchema.parse(requestInput);
    const identity = updateIdentity(request);
    try {
      await this.#recovery;
      return await this.#manager.withLifecycleLock(async () => {
        const current = this.#manager.readLifecycleRegistry();
        const record = current.packages.find((candidate) => candidate.packageId === request.packageId);
        if (record?.pinned) return updateResult(identity, "failed");
        const replay = this.#manager.lifecycleStore.updateReceiptForRequest(request.requestId);
        if (replay) return this.#adoptUpdateReplay(request, replay);
        if (current.revision !== request.expectedRegistryRevision) return updateResult(identity, "stale", this.#project(current));
        if (!record) return updateResult(identity, "not_found", this.#project(current));
        if (record.version === request.targetVersion) return updateResult(identity, "failed");
        this.#manager.lifecycleStore.assertInstalled(record);
        let prepared: PreparedPiPackageUpdate | undefined;
        try {
          prepared = await this.#manager.prepareExactUpdateCandidate({
            requestId: request.requestId, current: record, targetVersion: request.targetVersion,
            targetIntegrity: request.targetIntegrity, signal
          });
          const rollbackId = this.#rollbackId();
          const receipt = this.#manager.lifecycleStore.prepareUpdate({
            requestId: request.requestId, rollbackId, expectedRegistryRevision: current.revision,
            previousRecord: record, nextRecord: prepared.record, candidatePath: prepared.candidatePath,
            createdAt: this.#now().toISOString()
          });
          this.#manager.discardPreparedUpdate(prepared);
          prepared = undefined;
          this.#manager.lifecycleStore.ensureUpdated(receipt);
          const next = this.#manager.replaceLifecycleRecord(current.revision, record, receipt.nextRecord);
          this.#manager.lifecycleStore.markUpdateCommitted(receipt, next.revision);
          return updateResult(identity, "committed", this.#project(next));
        } finally {
          if (prepared) this.#manager.discardPreparedUpdate(prepared);
        }
      });
    } catch { return updateResult(identity, "failed"); }
  }

  async rollback(requestInput: PiPackageRollbackRequest): Promise<PiPackageRollbackResult> {
    const request = PiPackageRollbackRequestSchema.parse(requestInput);
    const identity = rollbackIdentity(request);
    try {
      await this.#recovery;
      return await this.#manager.withLifecycleLock(() => {
        const current = this.#manager.readLifecycleRegistry();
        const record = current.packages.find((candidate) => candidate.packageId === request.packageId);
        if (record?.pinned) return rollbackResult(identity, "failed");
        const receipt = this.#manager.lifecycleStore.readUpdateReceipt(request.rollbackId);
        if (receipt?.state === "rolled_back" && receipt.rollbackRequestId === request.requestId &&
          receipt.rollbackExpectedRegistryRevision === request.expectedRegistryRevision &&
          receipt.rolledBackRegistryRevision === current.revision && receipt.packageId === request.packageId &&
          receipt.previousRecord.version === request.targetVersion && record && sameRecord(receipt.previousRecord, record)) {
          return rollbackResult(identity, "committed", this.#project(current));
        }
        if (current.revision !== request.expectedRegistryRevision) return rollbackResult(identity, "stale", this.#project(current));
        if (!record) return rollbackResult(identity, "not_found", this.#project(current));
        if (!receipt || receipt.state !== "committed" || receipt.packageId !== request.packageId ||
          receipt.previousRecord.version !== request.targetVersion || !sameRecord(receipt.nextRecord, record)) {
          return rollbackResult(identity, "not_found", this.#project(current));
        }
        const prepared = this.#manager.lifecycleStore.prepareRollback({
          receipt, requestId: request.requestId, expectedRegistryRevision: current.revision
        });
        this.#manager.lifecycleStore.ensureRolledBack(prepared);
        const next = this.#manager.replaceLifecycleRecord(current.revision, record, prepared.previousRecord);
        this.#manager.lifecycleStore.markRollbackCommitted(prepared, next.revision);
        return rollbackResult(identity, "committed", this.#project(next));
      });
    } catch { return rollbackResult(identity, "failed"); }
  }

  async setPinned(requestInput: PiPackageSetPinnedRequest): Promise<PiPackageSetPinnedResult> {
    const request = PiPackageSetPinnedRequestSchema.parse(requestInput);
    const identity = pinnedIdentity(request);
    try {
      await this.#recovery;
      return await this.#manager.withLifecycleLock(() => {
        const current = this.#manager.readLifecycleRegistry();
        if (current.revision !== request.expectedRegistryRevision) return pinnedResult(identity, "stale", this.#project(current));
        const record = current.packages.find((candidate) => candidate.packageId === request.packageId);
        if (!record) return pinnedResult(identity, "not_found", this.#project(current));
        if ((record.pinned === true) === request.pinned) return pinnedResult(identity, "committed", this.#project(current));
        const replacement = request.pinned ? { ...record, pinned: true as const } : withoutPin(record);
        const next = this.#manager.replaceLifecycleRecord(current.revision, record, replacement);
        return pinnedResult(identity, "committed", this.#project(next));
      });
    } catch { return pinnedResult(identity, "failed"); }
  }

  #adoptUpdateReplay(request: PiPackageUpdateRequest, receipt: PiPackageUpdateReceipt<PiPackageRecord>): PiPackageUpdateResult {
    const identity = updateIdentity(request);
    if (receipt.packageId !== request.packageId || receipt.nextRecord.version !== request.targetVersion ||
      receipt.nextRecord.integrity !== request.targetIntegrity || receipt.expectedRegistryRevision !== request.expectedRegistryRevision) {
      return updateResult(identity, "failed");
    }
    const current = this.#manager.readLifecycleRegistry();
    return receipt.state === "committed" && current.revision === receipt.committedRegistryRevision &&
      current.packages.some((record) => sameRecord(record, receipt.nextRecord))
      ? updateResult(identity, "committed", this.#project(current))
      : updateResult(identity, "failed");
  }

  #recoverPending(): void {
    for (const receipt of this.#manager.lifecycleStore.listPendingUpdates()) {
      const current = this.#manager.readLifecycleRegistry();
      const record = current.packages.find((candidate) => candidate.packageId === receipt.packageId);
      if (receipt.state === "prepared") {
        if (current.revision === receipt.expectedRegistryRevision && record && sameRecord(record, receipt.previousRecord)) {
          this.#manager.lifecycleStore.ensureUpdated(receipt);
          const next = this.#manager.replaceLifecycleRecord(current.revision, record, receipt.nextRecord);
          this.#manager.lifecycleStore.markUpdateCommitted(receipt, next.revision);
        } else if (current.revision === receipt.expectedRegistryRevision + 1 && record && sameRecord(record, receipt.nextRecord)) {
          this.#manager.lifecycleStore.ensureUpdated(receipt);
          this.#manager.lifecycleStore.markUpdateCommitted(receipt, current.revision);
        } else throw new Error("Pi package update recovery conflicts with registry state.");
      } else {
        const expected = receipt.rollbackExpectedRegistryRevision!;
        if (current.revision === expected && record && sameRecord(record, receipt.nextRecord)) {
          this.#manager.lifecycleStore.ensureRolledBack(receipt);
          const next = this.#manager.replaceLifecycleRecord(current.revision, record, receipt.previousRecord);
          this.#manager.lifecycleStore.markRollbackCommitted(receipt, next.revision);
        } else if (current.revision === expected + 1 && record && sameRecord(record, receipt.previousRecord)) {
          this.#manager.lifecycleStore.ensureRolledBack(receipt);
          this.#manager.lifecycleStore.markRollbackCommitted(receipt, current.revision);
        } else throw new Error("Pi package rollback recovery conflicts with registry state.");
      }
    }
  }

  #project(registry: PiPackageRegistryFile): PiPackageRegistrySummary {
    return this.#manager.projectLifecycleRegistry(registry);
  }
}

function updateIdentity(request: PiPackageUpdateRequest) {
  return { apiVersion: request.apiVersion, requestId: request.requestId, packageId: request.packageId,
    targetVersion: request.targetVersion, targetIntegrity: request.targetIntegrity } as const;
}

function rollbackIdentity(request: PiPackageRollbackRequest) {
  return { apiVersion: request.apiVersion, requestId: request.requestId, packageId: request.packageId,
    rollbackId: request.rollbackId, targetVersion: request.targetVersion } as const;
}

function pinnedIdentity(request: PiPackageSetPinnedRequest) {
  return { apiVersion: request.apiVersion, requestId: request.requestId, packageId: request.packageId,
    pinned: request.pinned } as const;
}

function updateResult(
  identity: ReturnType<typeof updateIdentity>, status: "committed" | "stale" | "not_found" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageUpdateResult {
  return PiPackageUpdateResultSchema.parse({ ...identity, status, ...(registry ? { registry } : {}) });
}

function rollbackResult(
  identity: ReturnType<typeof rollbackIdentity>, status: "committed" | "stale" | "not_found" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageRollbackResult {
  return PiPackageRollbackResultSchema.parse({ ...identity, status, ...(registry ? { registry } : {}) });
}

function pinnedResult(
  identity: ReturnType<typeof pinnedIdentity>, status: "committed" | "stale" | "not_found" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageSetPinnedResult {
  return PiPackageSetPinnedResultSchema.parse({ ...identity, status, ...(registry ? { registry } : {}) });
}

function withoutPin(record: PiPackageRecord): PiPackageRecord {
  const { pinned: _pinned, ...unpinned } = record;
  return unpinned;
}

function sameRecord(left: PiPackageRecord, right: PiPackageRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createRollbackId(): string {
  return `pi_package_rollback_${randomBytes(16).toString("hex")}`;
}
