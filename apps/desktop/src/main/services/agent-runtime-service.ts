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

    const defaultModel = this.#models.getDefaultModel();
    const defaultProvider = this.#models.getDefaultProvider();
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

function createBaseStatus(
  status: Pick<AgentRuntimeStatus, "state" | "canRunModelJobs" | "missingDependencies"> &
    Partial<Pick<AgentRuntimeStatus, "defaultModelProfileId" | "policySnapshot">>
): AgentRuntimeStatus {
  return {
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    adapterMode: "phase_1_stub",
    ...status
  };
}
