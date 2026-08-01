import path from "node:path";
import {
  SkillDiscardStagedResultSchema,
  SkillExportResultSchema,
  SkillInstallStagedResultSchema,
  SkillLifecycleMutationResultSchema,
  SkillRegistryMutationResultSchema,
  SkillRegistryQueryResultSchema,
  SkillRegistrySummarySchema,
  SkillRestoreResultSchema,
  SkillStageUpdateResultSchema,
  type SkillDisableRequest,
  type SkillDiscardStagedRequest,
  type SkillDiscardStagedResult,
  type SkillEnableRequest,
  type SkillExportRequest,
  type SkillExportResult,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillLifecycleMutationResult,
  type SkillRegistryMutationResult,
  type SkillRegistryQueryRequest,
  type SkillRegistryQueryResult,
  type SkillRegistrySummary,
  type SkillRestoreRequest,
  type SkillRestoreResult,
  type SkillStageUpdateRequest,
  type SkillStageUpdateResult,
  type SkillUninstallRequest
} from "@pige/schemas";
import { SkillRegistryService } from "./skill-registry-service";
import type { SkillStagingStorePort } from "./skill-source-update-registry";
import { SkillUrlInstallService } from "./skill-url-install-service";

export interface ActiveSkillVault {
  readonly vaultId: string;
  readonly vaultPath: string;
}

export class ScopedSkillRegistryService {
  readonly #machine: SkillRegistryService;
  readonly #activeVault: () => ActiveSkillVault | undefined;
  readonly #vaultRegistries = new Map<string, SkillRegistryService>();

  constructor(machine: SkillRegistryService, activeVault: () => ActiveSkillVault | undefined) {
    this.#machine = machine;
    this.#activeVault = activeVault;
  }

  registryFor(scope: "machine_local" | "vault", activeVaultId: string): SkillRegistryService {
    const active = this.#requireVault(activeVaultId);
    if (scope === "machine_local") return this.#machine;
    const root = path.join(active.vaultPath, ".pige");
    let registry = this.#vaultRegistries.get(root);
    if (!registry) {
      registry = new SkillRegistryService(root, { scope: "vault", recoverOrphanedMutationLock: true });
      this.#vaultRegistries.set(root, registry);
    }
    return registry;
  }

  revisionFor(_scope: "machine_local" | "vault", activeVaultId: string): number {
    return this.#combined(activeVaultId).revision;
  }

  summary(request: SkillRegistryQueryRequest): SkillRegistryQueryResult {
    try {
      return SkillRegistryQueryResultSchema.parse({ ...request, status: "ready", registry: this.#combined(request.activeVaultId) });
    } catch {
      return SkillRegistryQueryResultSchema.parse({ ...request, status: "failed", error: unavailableError() });
    }
  }

  installStaged(request: SkillInstallStagedRequest, staging: SkillStagingStorePort): SkillInstallStagedResult {
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
      if (!prepared) return SkillInstallStagedResultSchema.parse({ requestId: request.requestId,
        activeVaultId: request.activeVaultId, status: "stale", registry: this.#combined(request.activeVaultId) });
      const candidate = staging.readForInstall(request.stagingId, request.manifestSha256, request.bundleSha256);
      if (candidate && candidate !== "stale" && candidate.manifest.scope === request.scope &&
        prepared.combined.skills.some((skill) => skill.id === candidate.manifest.id && skill.scope !== request.scope)) {
        return SkillInstallStagedResultSchema.parse({ requestId: request.requestId, activeVaultId: request.activeVaultId,
          status: "failed", error: unavailableError() });
      }
      const result = prepared.registry.installStaged({ ...request, expectedRegistryRevision: prepared.registry.currentRevision() }, staging);
      return SkillInstallStagedResultSchema.parse({ ...result, activeVaultId: request.activeVaultId,
        ...("registry" in result ? { registry: this.#combined(request.activeVaultId) } : {}) });
    } catch {
      return SkillInstallStagedResultSchema.parse({ requestId: request.requestId, activeVaultId: request.activeVaultId,
        status: "failed", error: unavailableError() });
    }
  }

  discardStaged(request: SkillDiscardStagedRequest, staging: SkillStagingStorePort): SkillDiscardStagedResult {
    try {
      const result = this.registryFor(request.scope, request.activeVaultId).discardStaged(request, staging);
      return SkillDiscardStagedResultSchema.parse({ ...result, activeVaultId: request.activeVaultId });
    } catch {
      return SkillDiscardStagedResultSchema.parse({ requestId: request.requestId, activeVaultId: request.activeVaultId,
        status: "failed", error: unavailableError() });
    }
  }

  async stageUpdate(
    request: SkillStageUpdateRequest,
    staging: SkillUrlInstallService,
    selectedPath?: string
  ): Promise<SkillStageUpdateResult> {
    const identity = lifecycleIdentity(request);
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
      if (!prepared) return SkillStageUpdateResultSchema.parse({ ...identity, status: "stale", registry: this.#combined(request.activeVaultId) });
      const result = await staging.stageUpdate(
        { ...request, expectedRegistryRevision: prepared.registry.currentRevision() }, selectedPath,
        new AbortController().signal, prepared.registry
      );
      if (result.status === "ready") return SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: result.staged });
      if (result.status === "failed" || result.status === "cancelled") return SkillStageUpdateResultSchema.parse({ ...identity, status: result.status });
      return SkillStageUpdateResultSchema.parse({ ...identity, status: result.status, registry: this.#combined(request.activeVaultId) });
    } catch { return SkillStageUpdateResultSchema.parse({ ...identity, status: "failed" }); }
  }

  resolveUpdateSource(request: SkillStageUpdateRequest, staging: SkillUrlInstallService) {
    const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
    if (!prepared) return undefined;
    return staging.resolveUpdateSource({ ...request, expectedRegistryRevision: prepared.registry.currentRevision() });
  }

  disable(request: SkillDisableRequest): SkillRegistryMutationResult {
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRevision);
      if (!prepared) return SkillRegistryMutationResultSchema.parse({ status: "stale", registry: this.#combined(request.activeVaultId) });
      const result = prepared.registry.disable({ ...request, expectedRevision: prepared.registry.currentRevision() });
      return "registry" in result ? SkillRegistryMutationResultSchema.parse({ ...result, registry: this.#combined(request.activeVaultId) }) : result;
    } catch { return SkillRegistryMutationResultSchema.parse({ status: "failed", error: unavailableError() }); }
  }

  enable(request: SkillEnableRequest): SkillLifecycleMutationResult { return this.#lifecycle("enable", request); }
  uninstall(request: SkillUninstallRequest): SkillLifecycleMutationResult { return this.#lifecycle("uninstall", request); }

  restore(request: SkillRestoreRequest): SkillRestoreResult {
    const identity = { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
      scope: request.scope, restoreContextId: request.restoreContextId, skillId: request.skillId };
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
      if (!prepared) return SkillRestoreResultSchema.parse({ ...identity, status: "stale", registry: this.#combined(request.activeVaultId) });
      if (prepared.combined.skills.some((skill) => skill.id === request.skillId && skill.scope !== request.scope)) {
        return SkillRestoreResultSchema.parse({ ...identity, status: "ineligible", registry: prepared.combined });
      }
      const result = prepared.registry.restore({ ...request, expectedRegistryRevision: prepared.registry.currentRevision() });
      if (result.status === "failed") return result;
      return SkillRestoreResultSchema.parse({ ...result, registry: this.#combined(request.activeVaultId) });
    } catch { return SkillRestoreResultSchema.parse({ ...identity, status: "failed" }); }
  }

  export(request: SkillExportRequest, destinationPath: string): SkillExportResult {
    const identity = lifecycleIdentity(request);
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
      if (!prepared) return SkillExportResultSchema.parse({ ...identity, registryRevision: this.revisionFor(request.scope,
        request.activeVaultId), status: "stale" });
      const result = prepared.registry.export({ ...request, expectedRegistryRevision: prepared.registry.currentRevision() }, destinationPath);
      return SkillExportResultSchema.parse({ ...result, ...identity,
        registryRevision: this.revisionFor(request.scope, request.activeVaultId) });
    } catch { return SkillExportResultSchema.parse({ ...identity, registryRevision: request.expectedRegistryRevision, status: "failed" }); }
  }

  #lifecycle(kind: "enable" | "uninstall", request: SkillEnableRequest | SkillUninstallRequest): SkillLifecycleMutationResult {
    const identity = lifecycleIdentity(request);
    try {
      const prepared = this.#prepare(request.scope, request.activeVaultId, request.expectedRegistryRevision);
      if (!prepared) return SkillLifecycleMutationResultSchema.parse({ ...identity, status: "stale", registry: this.#combined(request.activeVaultId) });
      const inner = { ...request, expectedRegistryRevision: prepared.registry.currentRevision() };
      const result = kind === "enable" ? prepared.registry.enable(inner) : prepared.registry.uninstall(inner);
      return result.status === "failed" ? result : SkillLifecycleMutationResultSchema.parse({ ...result, registry: this.#combined(request.activeVaultId) });
    } catch { return SkillLifecycleMutationResultSchema.parse({ ...identity, status: "failed" }); }
  }

  #prepare(scope: "machine_local" | "vault", activeVaultId: string, expected: number) {
    const combined = this.#combined(activeVaultId);
    if (combined.revision !== expected) return undefined;
    return { combined, registry: this.registryFor(scope, activeVaultId) };
  }

  #combined(activeVaultId: string): SkillRegistrySummary {
    const machine = readSummary(this.#machine);
    const vault = readSummary(this.registryFor("vault", activeVaultId));
    return SkillRegistrySummarySchema.parse({ apiVersion: 1, revision: safeAdd(machine.revision, vault.revision),
      invalidManifestCount: machine.invalidManifestCount + vault.invalidManifestCount,
      skills: [...machine.skills, ...vault.skills].sort((a, b) => a.name.localeCompare(b.name, "en") ||
        a.scope.localeCompare(b.scope, "en") || a.id.localeCompare(b.id, "en")),
      restorableSkills: [...machine.restorableSkills, ...vault.restorableSkills] });
  }

  #requireVault(activeVaultId: string): ActiveSkillVault {
    const active = this.#activeVault();
    if (!active || active.vaultId !== activeVaultId || !path.isAbsolute(active.vaultPath)) throw new Error("skill.vault_stale");
    return active;
  }
}

function readSummary(service: SkillRegistryService): SkillRegistrySummary {
  const result = service.summary();
  if (result.status !== "ready") throw new Error("skill.registry_unavailable");
  return result.registry;
}
function lifecycleIdentity(request: { readonly requestId: string; readonly activeVaultId: string;
  readonly scope: "machine_local" | "vault"; readonly skillId: string }) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
    scope: request.scope, skillId: request.skillId };
}
function safeAdd(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER - right) throw new Error("skill.registry_revision_exhausted");
  return left + right;
}
function unavailableError() {
  return { code: "skill.registry_unavailable", domain: "skill", messageKey: "error.generic",
    retryable: true, severity: "error", userAction: "retry" } as const;
}
