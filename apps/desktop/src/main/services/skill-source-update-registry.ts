import {
  SkillInstallStagedResultSchema,
  SkillInstallUrlSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillManifest,
  type SkillRegistryFile,
  type SkillRegistryRecord,
  type SkillRegistrySummary,
  type SkillStageUpdateRequest,
  type SkillStageUpdateResult
} from "@pige/schemas";
import {
  SkillRegistryLifecycleStore,
  type SkillUpdateReceipt
} from "./skill-registry-lifecycle-store";

export interface SkillStagedUpdateBinding {
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly installedManifestSha256: string;
  readonly installedVersion: string;
  readonly installedUpdatedAt: string;
  readonly enabled: boolean;
}

export interface SkillUpdateTarget extends SkillStagedUpdateBinding {
  readonly sourceUrl: string;
}

export type SkillUpdateResolution =
  | { readonly status: "ready"; readonly target: SkillUpdateTarget }
  | { readonly status: "result"; readonly result: SkillStageUpdateResult };

export interface SkillStagedInstallCandidate {
  readonly stagingId: string;
  readonly requestId: string;
  readonly sourceUrl: string;
  readonly manifestSha256: string;
  readonly expiresAt: string;
  readonly manifest: SkillManifest;
  readonly bytes: Buffer;
  readonly update?: SkillStagedUpdateBinding;
}

export interface SkillStagingStorePort {
  readForInstall(stagingId: string, manifestSha256: string): SkillStagedInstallCandidate | "stale" | undefined;
  discardExact(stagingId: string, manifestSha256: string): "discarded" | "stale" | "not_found";
}

interface RegistryPorts {
  readonly readRegistry: () => SkillRegistryFile;
  readonly readManifest: (skillId: string) => { readonly manifest: SkillManifest; readonly sha256: string };
  readonly isLifecycleEligible: (record: SkillRegistryRecord) => boolean;
  readonly project: (registry: SkillRegistryFile) => SkillRegistrySummary;
  readonly nextRegistry: (current: SkillRegistryFile, skills: readonly SkillRegistryRecord[]) => SkillRegistryFile;
  readonly writeRegistry: (registry: SkillRegistryFile) => void;
  readonly lifecycleStore: SkillRegistryLifecycleStore;
}

export class SkillSourceUpdateRegistry {
  readonly #ports: RegistryPorts;

  constructor(ports: RegistryPorts) {
    this.#ports = ports;
  }

  resolveTarget(requestInput: SkillStageUpdateRequest): SkillUpdateResolution {
    const request = SkillStageUpdateRequestSchema.parse(requestInput);
    try {
      const current = this.#ports.readRegistry();
      if (request.expectedRegistryRevision !== current.revision) {
        return { status: "result", result: this.result(request, "stale", current) };
      }
      const record = current.skills.find((candidate) => candidate.id === request.skillId);
      if (!record) return { status: "result", result: this.result(request, "not_found", current) };
      const loaded = this.#ports.readManifest(record.id);
      const sourceUrl = SkillInstallUrlSchema.safeParse(loaded.manifest.sourceUrl);
      if (!this.#ports.isLifecycleEligible(record) || !sourceUrl.success || !loaded.manifest.updatedAt) {
        return { status: "result", result: this.result(request, "not_found", current) };
      }
      return {
        status: "ready",
        target: {
          activeVaultId: request.activeVaultId,
          skillId: record.id,
          expectedRegistryRevision: current.revision,
          installedManifestSha256: record.manifestSha256,
          installedVersion: record.version,
          installedUpdatedAt: loaded.manifest.updatedAt,
          enabled: record.enabled,
          sourceUrl: sourceUrl.data
        }
      };
    } catch {
      return { status: "result", result: this.result(request, "failed") };
    }
  }

  result(
    requestInput: SkillStageUpdateRequest,
    status: "current" | "stale" | "not_found" | "failed",
    registry?: SkillRegistryFile
  ): SkillStageUpdateResult {
    const request = SkillStageUpdateRequestSchema.parse(requestInput);
    try {
      const identity = {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        skillId: request.skillId
      };
      const current = status === "failed" ? undefined : (registry ?? this.#ports.readRegistry());
      const resolvedStatus = status === "current" && current!.revision !== request.expectedRegistryRevision
        ? "stale"
        : status;
      return SkillStageUpdateResultSchema.parse(
        resolvedStatus === "failed"
          ? { ...identity, status: resolvedStatus }
          : { ...identity, status: resolvedStatus, registry: this.#ports.project(current!) }
      );
    } catch {
      return SkillStageUpdateResultSchema.parse({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        skillId: request.skillId,
        status: "failed"
      });
    }
  }

  commit(
    request: SkillInstallStagedRequest,
    candidate: SkillStagedInstallCandidate,
    parsed: SkillManifest,
    current: SkillRegistryFile,
    staging: SkillStagingStorePort,
    assertLock: () => void
  ): SkillInstallStagedResult {
    const update = candidate.update!;
    const existingIndex = current.skills.findIndex((skill) => skill.id === parsed.id);
    const existing = existingIndex >= 0 ? current.skills[existingIndex]! : undefined;
    if (!existing || request.expectedRegistryRevision !== update.expectedRegistryRevision ||
      update.activeVaultId.length === 0 || update.skillId !== parsed.id ||
      existing.manifestSha256 !== update.installedManifestSha256 || existing.version !== update.installedVersion ||
      existing.enabled !== update.enabled || request.enabled !== update.enabled ||
      parsed.sourceUrl !== candidate.sourceUrl || !parsed.updatedAt || parsed.version === existing.version ||
      Date.parse(parsed.updatedAt) <= Date.parse(update.installedUpdatedAt) ||
      request.manifestSha256 === existing.manifestSha256) return installFailed(request.requestId);
    const now = new Date().toISOString();
    const receipt = this.#ports.lifecycleStore.prepareUpdate({
      requestId: request.requestId,
      stagingId: request.stagingId,
      activeVaultId: update.activeVaultId,
      expectedRegistryRevision: update.expectedRegistryRevision,
      oldRecord: existing,
      newManifestSha256: request.manifestSha256,
      newVersion: parsed.version,
      enabled: existing.enabled,
      bytes: candidate.bytes,
      createdAt: now
    });
    const nextSkills = [...current.skills];
    nextSkills[existingIndex] = {
      ...existing,
      version: parsed.version,
      manifestSha256: request.manifestSha256,
      updatedAt: now
    };
    const next = this.#ports.nextRegistry(current, nextSkills);
    assertLock();
    this.#ports.writeRegistry(next);
    this.#ports.lifecycleStore.markUpdateCommitted(receipt, next.revision);
    try { staging.discardExact(request.stagingId, request.manifestSha256); } catch { /* committed update owns cleanup retry */ }
    return SkillInstallStagedResultSchema.parse({
      status: "committed",
      requestId: request.requestId,
      registry: this.#ports.project(next)
    });
  }

  recover(receipts: readonly SkillUpdateReceipt[], assertLock: () => void): void {
    for (const receipt of receipts) {
      const current = this.#ports.readRegistry();
      const index = current.skills.findIndex((record) => record.id === receipt.skillId);
      if (current.revision === receipt.expectedRegistryRevision) {
        if (index < 0 || JSON.stringify(current.skills[index]) !== JSON.stringify(receipt.oldRecord)) {
          throw new Error("skill.update_recovery_conflict");
        }
        this.#ports.lifecycleStore.ensureUpdated(receipt);
        const nextSkills = [...current.skills];
        nextSkills[index] = {
          ...receipt.oldRecord,
          version: receipt.newVersion,
          manifestSha256: receipt.newManifestSha256,
          updatedAt: receipt.createdAt
        };
        const next = this.#ports.nextRegistry(current, nextSkills);
        assertLock();
        this.#ports.writeRegistry(next);
        this.#ports.lifecycleStore.markUpdateCommitted(receipt, next.revision);
        continue;
      }
      const record = index >= 0 ? current.skills[index] : undefined;
      if (current.revision === receipt.expectedRegistryRevision + 1 && record?.manifestSha256 === receipt.newManifestSha256 &&
        record.version === receipt.newVersion && record.enabled === receipt.enabled) {
        this.#ports.lifecycleStore.markUpdateCommitted(receipt, current.revision);
        continue;
      }
      throw new Error("skill.update_recovery_conflict");
    }
  }
}

export function canUpdateSkill(manifest: SkillManifest): boolean {
  return manifest.kind === "pure" && Boolean(manifest.updatedAt) && SkillInstallUrlSchema.safeParse(manifest.sourceUrl).success;
}

function installFailed(requestId: string): SkillInstallStagedResult {
  return SkillInstallStagedResultSchema.parse({
    status: "failed",
    requestId,
    error: {
      code: "skill.registry_unavailable",
      domain: "skill",
      messageKey: "error.generic",
      retryable: true,
      severity: "error",
      userAction: "retry"
    }
  });
}
