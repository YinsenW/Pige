import { createHash } from "node:crypto";
import type { AgentRuntimePolicyContext, ModelProfileSummary, ProviderProfileSummary } from "@pige/contracts";
import { readVaultConfig, readVaultManifest } from "./vault-layout";

export interface BuildAgentRuntimePolicyContextOptions {
  readonly jobId?: string;
  readonly defaultModel?: ModelProfileSummary;
  readonly defaultProvider?: ProviderProfileSummary;
  readonly cloudSendPolicy?: AgentRuntimePolicyContext["model"]["cloudSendPolicy"];
  readonly localDatabaseStatus?: AgentRuntimePolicyContext["localCapabilities"]["localDatabase"];
  readonly parserToolchainReady?: boolean;
  readonly ocrEngines?: AgentRuntimePolicyContext["localCapabilities"]["ocrEngines"];
  readonly speechInputAvailable?: boolean;
  readonly embeddingModelInstalled?: boolean;
  readonly lexicalSearchAvailable?: boolean;
  readonly vectorSearchAvailable?: boolean;
  readonly rerankerAvailable?: boolean;
  readonly permissionSettings?: AgentRuntimePolicyContext["permissions"];
}

export interface AgentPermissionSettingsPort {
  policyProjection(): AgentRuntimePolicyContext["permissions"];
}

export function buildAgentRuntimePolicyContext(
  vaultPath: string,
  options: BuildAgentRuntimePolicyContextOptions = {}
): AgentRuntimePolicyContext {
  const manifest = readVaultManifest(vaultPath);
  const config = readVaultConfig(vaultPath);
  const policyWithoutHash = {
    schemaVersion: 1 as const,
    vaultId: manifest.vault_id,
    jobId: options.jobId ?? "job_not_started",
    sourceStorage: {
      defaultStrategy: config.sourceStorage.defaultStrategy,
      sourceAssetRootKind: config.sourceStorage.sourceAssetRootKind,
      allowPerCaptureOverride: false,
      linkStrategyEnabled: false as const
    },
    model: {
      ...(options.defaultModel ? { defaultModelProfileId: options.defaultModel.id } : {}),
      modelConfigured: Boolean(options.defaultModel),
      cloudBoundary: options.defaultProvider?.cloudBoundary ?? "unknown",
      boundaryVerification: options.defaultProvider?.boundaryVerification ?? "unknown",
      cloudSendPolicy: options.cloudSendPolicy ?? "ordinary_allowed",
      modelRoutingMode: "default_model_only" as const
    },
    permissions: options.permissionSettings ?? {
      defaultMode: "ask_every_time" as const,
      yoloEnabled: false,
      savedGrantSummaryRefs: []
    },
    confirmation: {
      safeAutoApplyThreshold: 0.9,
      mutatingReviewThreshold: 0.7,
      riskyChangeRequiresConfirmation: true
    },
    memory: {
      vaultMemoryEnabled: config.memory.vaultMemoryEnabled,
      allowedMemoryScopes: ["preference", "correction", "workflow_lesson", "profile"] as const,
      includeMemoryInBackup: config.backup.includeVaultMemory
    },
    language: {
      appLocale: manifest.default_locale,
      generatedKnowledgeLanguage: "preserve_source" as const,
      preserveSourceLanguage: true,
      ocrLanguageHints: [manifest.default_locale]
    },
    retrieval: {
      lexicalSearchAvailable: options.lexicalSearchAvailable ?? false,
      vectorSearchAvailable: options.vectorSearchAvailable ?? false,
      rerankerAvailable: options.rerankerAvailable ?? false,
      maxSnippetsForCloudSynthesis: 8
    },
    localCapabilities: {
      localDatabase: options.localDatabaseStatus ?? "not_initialized",
      parserToolchainReady: options.parserToolchainReady ?? false,
      ocrEngines: options.ocrEngines ?? [],
      speechInputAvailable: options.speechInputAvailable ?? false,
      embeddingModelInstalled: options.embeddingModelInstalled ?? false,
      hiddenDownloadsAllowed: false as const
    }
  };
  const policyDigest = createHash("sha256").update(JSON.stringify(policyWithoutHash)).digest("hex");

  return {
    policyContextId: `policy_${policyDigest.slice(0, 16)}`,
    policyHash: `sha256:${policyDigest}`,
    builtAt: new Date().toISOString(),
    ...policyWithoutHash
  };
}
