import type {
  AgentRuntimeStatus,
  LocalDatabaseStatus,
  ModelProfileSummary,
  ProviderProfileSummary,
  VaultSummary
} from "@pige/contracts";
import { buildAgentRuntimePolicyContext } from "./agent-policy-context";
import type { AgentIngestCapabilityPort } from "./agent-ingest-service";

export interface AgentRuntimeVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface AgentRuntimeModelPort {
  getDefaultModel(): ModelProfileSummary | undefined;
  getDefaultProvider(): ProviderProfileSummary | undefined;
  hasDefaultRuntimeBinding(): boolean;
}

export interface AgentRuntimeDatabasePort {
  status(vaultPath: string): LocalDatabaseStatus;
}

export class AgentRuntimeService {
  readonly #vaults: AgentRuntimeVaultPort;
  readonly #models: AgentRuntimeModelPort;
  readonly #database: AgentRuntimeDatabasePort;
  readonly #capabilities: AgentIngestCapabilityPort | undefined;

  constructor(
    vaults: AgentRuntimeVaultPort,
    models: AgentRuntimeModelPort,
    database: AgentRuntimeDatabasePort,
    capabilities?: AgentIngestCapabilityPort
  ) {
    this.#vaults = vaults;
    this.#models = models;
    this.#database = database;
    this.#capabilities = capabilities;
  }

  runtimeStatus(): AgentRuntimeStatus {
    const activeVault = this.#vaults.current();
    const activeVaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !activeVaultPath) {
      return createBaseStatus({
        state: "blocked_no_vault",
        canRunModelJobs: false,
        missingDependencies: ["vault"]
      });
    }

    const runtimeBinding = resolveReadyRuntimeBinding(this.#models);
    const defaultModel = runtimeBinding?.model;
    const defaultProvider = runtimeBinding?.provider;
    const localDatabase = this.#database.status(activeVaultPath).status;
    const policy = buildAgentRuntimePolicyContext(activeVaultPath, {
      ...(defaultModel ? { defaultModel } : {}),
      ...(defaultProvider ? { defaultProvider } : {}),
      localDatabaseStatus: localDatabase,
      ...(this.#capabilities?.snapshot() ?? {})
    });

    return createBaseStatus({
      state: defaultModel ? "ready" : "waiting_for_model",
      canRunModelJobs: Boolean(defaultModel),
      missingDependencies: defaultModel ? [] : ["default_model"],
      ...(defaultModel ? { defaultModelProfileId: defaultModel.id } : {}),
      policySnapshot: {
        policyContextId: policy.policyContextId,
        policyHash: policy.policyHash,
        builtAt: policy.builtAt,
        vaultId: policy.vaultId,
        cloudBoundary: policy.model.cloudBoundary,
        localDatabase: policy.localCapabilities.localDatabase
      }
    });
  }
}

function resolveReadyRuntimeBinding(models: AgentRuntimeModelPort): {
  readonly model: ModelProfileSummary;
  readonly provider: ProviderProfileSummary;
} | undefined {
  try {
    const model = models.getDefaultModel();
    const provider = models.getDefaultProvider();
    const runtimeBindingAvailable = models.hasDefaultRuntimeBinding();
    if (
      !model ||
      !provider ||
      !runtimeBindingAvailable ||
      !model.enabled ||
      !model.isDefault ||
      model.providerProfileId !== provider.id
    ) {
      return undefined;
    }
    return { model, provider };
  } catch {
    return undefined;
  }
}

function createBaseStatus(
  status: Pick<AgentRuntimeStatus, "state" | "canRunModelJobs" | "missingDependencies"> &
    Partial<Pick<AgentRuntimeStatus, "defaultModelProfileId" | "policySnapshot">>
): AgentRuntimeStatus {
  return {
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    adapterMode: "embedded_pi_sdk",
    ...status
  };
}
