import {
  deriveSkillDataBoundaries,
  SkillCapabilityListSchema,
  SkillDataBoundaryListSchema,
  SkillInstallStagedResultSchema,
  SkillInstallUrlSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillStagedFileSummarySchema,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillInstallSourceKind,
  type SkillManifest,
  type SkillRegistryFile,
  type SkillRegistryRecord,
  type SkillRegistrySummary,
  type SkillStageUpdateRequest,
  type SkillStageUpdateResult,
  type SkillStageWarning
} from "@pige/schemas";
import {
  digestStableJson,
  projectInstalledExternalDisclosure,
  SkillRegistryLifecycleStore,
  type SkillInstallReceipt,
  type SkillUpdateReceipt
} from "./skill-registry-lifecycle-store";
import type { SkillBundleFile } from "./skill-zip-stage-service";

export interface SkillStagedUpdateBinding {
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly installedManifestSha256: string;
  readonly installedVersion: string;
  readonly installedUpdatedAt: string;
  readonly enabled: boolean;
  readonly kind?: "external_web";
  readonly installedBundleSha256?: string;
  readonly installedInstallReceiptSha256?: string;
  readonly installedCapabilities?: SkillManifest["capabilities"];
  readonly installedDataBoundaries?: ReturnType<typeof deriveSkillDataBoundaries>;
  readonly sourceKind?: "local_markdown" | "local_zip" | "local_file";
  readonly installedFiles?: readonly {
    readonly relativePath: string;
    readonly utf8ByteSize: number;
    readonly sha256: `sha256:${string}`;
  }[];
}

export type SkillUpdateTarget = SkillStagedUpdateBinding & (
  | { readonly sourceUrl: string; readonly sourceKind?: never }
  | { readonly sourceKind: "local_markdown" | "local_zip" | "local_file"; readonly sourceUrl?: never }
);

export type SkillUpdateResolution =
  | { readonly status: "ready"; readonly target: SkillUpdateTarget }
  | { readonly status: "result"; readonly result: SkillStageUpdateResult };

export interface SkillStagedInstallCandidate {
  readonly stagingId: string;
  readonly requestId: string;
  readonly sourceUrl?: string;
  readonly source: SkillInstallSourceKind;
  readonly manifestSha256: string;
  readonly bundleSha256: string;
  readonly expiresAt: string;
  readonly manifest: SkillManifest;
  readonly bytes: Buffer;
  readonly files: readonly {
    readonly relativePath: string;
    readonly bytes: Buffer;
    readonly sha256: `sha256:${string}`;
  }[];
  readonly warnings?: readonly SkillStageWarning[];
  readonly update?: SkillStagedUpdateBinding;
}

export interface SkillStagingStorePort {
  readForInstall(stagingId: string, manifestSha256: string, bundleSha256: string): SkillStagedInstallCandidate | "stale" | undefined;
  discardExact(stagingId: string, manifestSha256: string, bundleSha256: string): "discarded" | "stale" | "not_found";
}

export function isSkillUpdateStageRecord(record: Record<string, unknown>): boolean {
  if (!record.update || typeof record.update !== "object" || Array.isArray(record.update)) return false;
  const update = record.update as Record<string, unknown>;
  const keys = Object.keys(update).sort().join(",");
  const pureKeys = "activeVaultId,enabled,expectedRegistryRevision,installedBundleSha256,installedFiles,installedManifestSha256,installedUpdatedAt,installedVersion,skillId,sourceUrl";
  const localKeys = "activeVaultId,enabled,expectedRegistryRevision,installedBundleSha256,installedFiles,installedInstallReceiptSha256,installedManifestSha256,installedUpdatedAt,installedVersion,skillId,sourceKind";
  const externalKeys = "activeVaultId,enabled,expectedRegistryRevision,installedBundleSha256,installedCapabilities,installedDataBoundaries,installedInstallReceiptSha256,installedManifestSha256,installedUpdatedAt,installedVersion,kind,skillId,sourceUrl";
  const external = keys === externalKeys && update.kind === "external_web";
  const local = keys === localKeys && ["local_markdown", "local_zip", "local_file"].includes(String(update.sourceKind));
  const remote = keys === pureKeys || external;
  return (remote || local) && SkillStageUpdateRequestSchema.safeParse({
    apiVersion: 1, requestId: record.requestId, activeVaultId: update.activeVaultId,
    skillId: update.skillId, expectedRegistryRevision: update.expectedRegistryRevision
  }).success && (!remote || (update.sourceUrl === record.requestSourceUrl && update.sourceUrl === record.finalSourceUrl &&
    SkillInstallUrlSchema.safeParse(update.sourceUrl).success)) && typeof update.enabled === "boolean" &&
    typeof update.installedManifestSha256 === "string" && /^sha256:[a-f0-9]{64}$/u.test(update.installedManifestSha256) &&
    typeof update.installedVersion === "string" && typeof update.installedUpdatedAt === "string" &&
    ((!external && !local) || (typeof update.installedBundleSha256 === "string" && /^sha256:[a-f0-9]{64}$/u.test(update.installedBundleSha256) &&
      typeof update.installedInstallReceiptSha256 === "string" && /^sha256:[a-f0-9]{64}$/u.test(update.installedInstallReceiptSha256) &&
      (local || (SkillCapabilityListSchema.safeParse(update.installedCapabilities).success &&
        SkillDataBoundaryListSchema.safeParse(update.installedDataBoundaries).success)))) &&
    (!update.installedFiles || (Array.isArray(update.installedFiles) && update.installedFiles.length >= 1 &&
      update.installedFiles.every((file) => SkillStagedFileSummarySchema.safeParse(file).success))) &&
    Number.isFinite(Date.parse(update.installedUpdatedAt));
}

export function projectPureSkillUpdateReview(
  update: SkillStagedUpdateBinding,
  nextFiles: readonly { readonly relativePath: string; readonly sha256: `sha256:${string}` }[]
) {
  if (!update.installedBundleSha256 || !update.installedFiles) throw new Error("skill.update_review_invalid");
  const previous = new Map(update.installedFiles.map((file) => [file.relativePath, file.sha256]));
  const next = new Map(nextFiles.map((file) => [file.relativePath, file.sha256]));
  return {
    kind: "pure" as const, previousVersion: update.installedVersion,
    previousManifestSha256: update.installedManifestSha256, previousBundleSha256: update.installedBundleSha256,
    addedFiles: [...next.keys()].filter((file) => !previous.has(file)).sort(),
    removedFiles: [...previous.keys()].filter((file) => !next.has(file)).sort(),
    changedFiles: [...next.keys()].filter((file) => previous.has(file) && previous.get(file) !== next.get(file)).sort(),
    finalEnabled: update.enabled
  };
}

interface RegistryPorts {
  readonly readRegistry: () => SkillRegistryFile;
  readonly readManifest: (skillId: string) => {
    readonly manifest: SkillManifest;
    readonly sha256: string;
    readonly bundleSha256: string;
    readonly receipt: SkillInstallReceipt | undefined;
    readonly files: readonly SkillBundleFile[];
  };
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
      const pure = this.#ports.isLifecycleEligible(record);
      const disclosure = loaded.manifest.kind === "external_web"
        ? projectInstalledExternalDisclosure(loaded)
        : undefined;
      const external = record.trust === "user_confirmed" && loaded.sha256 === record.manifestSha256 &&
        loaded.manifest.id === record.id && loaded.manifest.version === record.version &&
        sourceUrl.success && loaded.manifest.kind === "external_web" && disclosure?.source === "https" &&
        disclosure.sourceUrl === sourceUrl.data;
      const localSource = pure && !sourceUrl.success
        ? resolveLocalSource(loaded.receipt, loaded.files)
        : undefined;
      if ((!pure && !external) || (!sourceUrl.success && !localSource) || !loaded.manifest.updatedAt) {
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
          ...(sourceUrl.success ? { sourceUrl: sourceUrl.data } : {
            sourceKind: localSource!,
            installedBundleSha256: loaded.bundleSha256,
            installedInstallReceiptSha256: digestStableJson(loaded.receipt!),
            installedFiles: loaded.files.map((file) => ({
              relativePath: file.relativePath,
              utf8ByteSize: file.bytes.length,
              sha256: file.sha256
            }))
          }),
          ...(pure && sourceUrl.success ? {
            installedBundleSha256: loaded.bundleSha256,
            installedFiles: loaded.files.map((file) => ({
              relativePath: file.relativePath,
              utf8ByteSize: file.bytes.length,
              sha256: file.sha256
            }))
          } : {}),
          ...(external ? {
            kind: "external_web" as const,
            installedBundleSha256: loaded.bundleSha256,
            installedInstallReceiptSha256: digestStableJson(loaded.receipt!),
            installedCapabilities: [...loaded.manifest.capabilities],
            installedDataBoundaries: [...deriveSkillDataBoundaries(loaded.manifest.capabilities)]
          } : {})
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
    const externalUpdate = update.kind === "external_web";
    const localUpdate = update.sourceKind === "local_markdown" || update.sourceKind === "local_zip" || update.sourceKind === "local_file";
    const loaded = existing ? this.#ports.readManifest(existing.id) : undefined;
    if (!existing || !loaded || request.expectedRegistryRevision !== update.expectedRegistryRevision ||
      update.activeVaultId.length === 0 || update.skillId !== parsed.id ||
      existing.manifestSha256 !== update.installedManifestSha256 || existing.version !== update.installedVersion ||
      existing.enabled !== update.enabled || request.enabled !== (externalUpdate ? false : update.enabled) ||
      parsed.kind !== (externalUpdate ? "external_web" : "pure") ||
      parsed.sourceUrl !== candidate.sourceUrl || !parsed.updatedAt || parsed.version === existing.version ||
      Date.parse(parsed.updatedAt) <= Date.parse(update.installedUpdatedAt) ||
      request.manifestSha256 === existing.manifestSha256) return installFailed(request.requestId);
    if (externalUpdate && (candidate.source !== "https" || candidate.sourceUrl === undefined ||
      update.installedBundleSha256 !== loaded.bundleSha256 || !loaded.receipt ||
      update.installedInstallReceiptSha256 !== digestStableJson(loaded.receipt))) return installFailed(request.requestId);
    if (localUpdate && ((update.sourceKind !== "local_file" && candidate.source !== update.sourceKind) ||
      !["local_markdown", "local_zip"].includes(candidate.source) || candidate.sourceUrl !== undefined ||
      update.installedBundleSha256 !== loaded.bundleSha256 || !loaded.receipt ||
      update.installedInstallReceiptSha256 !== digestStableJson(loaded.receipt))) return installFailed(request.requestId);
    const now = new Date().toISOString();
    const finalEnabled = externalUpdate ? false : existing.enabled;
    const fullTreeUpdate = externalUpdate || localUpdate;
    const replacementInstallReceipt: SkillInstallReceipt | undefined = fullTreeUpdate ? {
      schemaVersion: 1,
      requestId: request.requestId,
      stagingId: request.stagingId,
      manifestSha256: request.manifestSha256,
      bundleSha256: request.bundleSha256,
      enabled: finalEnabled,
      source: candidate.source,
      ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
      warnings: candidate.warnings ?? (candidate.source === "https" ? ["untrusted_remote_source"] : [])
    } : undefined;
    const receipt = this.#ports.lifecycleStore.prepareUpdate({
      requestId: request.requestId,
      stagingId: request.stagingId,
      activeVaultId: update.activeVaultId,
      expectedRegistryRevision: update.expectedRegistryRevision,
      oldRecord: existing,
      newManifestSha256: request.manifestSha256,
      newVersion: parsed.version,
      enabled: finalEnabled,
      bytes: candidate.bytes,
      ...(fullTreeUpdate ? { files: candidate.files, installReceipt: replacementInstallReceipt! } : {}),
      createdAt: now
    });
    const nextSkills = [...current.skills];
    nextSkills[existingIndex] = {
      ...existing,
      version: parsed.version,
      manifestSha256: request.manifestSha256,
      enabled: finalEnabled,
      updatedAt: now
    };
    const next = this.#ports.nextRegistry(current, nextSkills);
    assertLock();
    this.#ports.writeRegistry(next);
    this.#ports.lifecycleStore.markUpdateCommitted(receipt, next.revision);
    try { staging.discardExact(request.stagingId, request.manifestSha256, request.bundleSha256); } catch { /* committed update owns cleanup retry */ }
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
          enabled: receipt.enabled,
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

export function canUpdateSkill(
  manifest: SkillManifest,
  disclosure?: { readonly source: SkillInstallSourceKind; readonly sourceUrl?: string }
): boolean {
  const source = SkillInstallUrlSchema.safeParse(manifest.sourceUrl);
  if (!manifest.updatedAt) return false;
  if (manifest.kind === "pure") return source.success || manifest.sourceUrl === undefined;
  return manifest.kind === "external_web" && disclosure?.source === "https" && disclosure.sourceUrl === source.data;
}

function resolveLocalSource(
  receipt: SkillInstallReceipt | undefined,
  files: readonly SkillBundleFile[]
): "local_markdown" | "local_zip" | "local_file" | undefined {
  if (!receipt) return undefined;
  if (receipt.source === "local_markdown" || receipt.source === "local_zip") return receipt.source;
  if (receipt.source !== undefined || receipt.sourceUrl !== undefined) return undefined;
  return files.length === 1 && files[0]?.relativePath === "SKILL.md" ? "local_file" : "local_zip";
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
