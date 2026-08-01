import { createHash } from "node:crypto";
import {
  CollectionRevealRequestSchema,
  CollectionRevealResultSchema,
  type CollectionRevealRequest,
  type CollectionRevealResult
} from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import { readBundle, readCollectionSnapshot } from "./managed-collection-storage";

export interface ManagedCollectionRevealVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ManagedCollectionRevealRegistrar {
  reveal(absolutePath: string): Promise<void> | void;
}

interface RevealBinding {
  readonly bundlePath: string;
  readonly revisionId: string;
  readonly proof: string;
}

type RevealResolver = (
  vaultPath: string,
  datasetId: string,
  tableId: string
) => RevealBinding | undefined;

export class ManagedCollectionRevealService {
  readonly #vaults: ManagedCollectionRevealVaultPort;
  readonly #registrar: ManagedCollectionRevealRegistrar;
  readonly #resolve: RevealResolver;

  constructor(
    vaults: ManagedCollectionRevealVaultPort,
    registrar: ManagedCollectionRevealRegistrar,
    resolve: RevealResolver = resolveRevealBinding
  ) {
    this.#vaults = vaults;
    this.#registrar = registrar;
    this.#resolve = resolve;
  }

  async reveal(request: CollectionRevealRequest): Promise<CollectionRevealResult> {
    const parsed = CollectionRevealRequestSchema.parse(request);
    const identity = { ...parsed } as const;
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionRevealResultSchema.parse({ ...identity, status: "stale" });
    try {
      const initial = this.#resolve(vaultPath, parsed.datasetId, parsed.tableId);
      if (!initial) return CollectionRevealResultSchema.parse({ ...identity, status: "not_found" });
      if (initial.revisionId !== parsed.revisionId) {
        return CollectionRevealResultSchema.parse({ ...identity, status: "stale" });
      }
      const currentPath = this.#activeVaultPath(parsed.activeVaultId);
      if (currentPath !== vaultPath) return CollectionRevealResultSchema.parse({ ...identity, status: "stale" });
      const current = this.#resolve(vaultPath, parsed.datasetId, parsed.tableId);
      if (!current || current.revisionId !== parsed.revisionId || current.proof !== initial.proof ||
          current.bundlePath !== initial.bundlePath) {
        return CollectionRevealResultSchema.parse({ ...identity, status: "stale" });
      }
      if (this.#activeVaultPath(parsed.activeVaultId) !== vaultPath) {
        return CollectionRevealResultSchema.parse({ ...identity, status: "stale" });
      }
      await this.#registrar.reveal(current.bundlePath);
      return CollectionRevealResultSchema.parse({ ...identity, status: "revealed" });
    } catch {
      return CollectionRevealResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #activeVaultPath(activeVaultId: string): string | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === activeVaultId ? vaultPath : undefined;
  }
}

function resolveRevealBinding(vaultPath: string, datasetId: string, tableId: string): RevealBinding | undefined {
  const binding = readBundle(vaultPath, datasetId);
  if (!binding || !readCollectionSnapshot(binding, tableId)) return undefined;
  return {
    bundlePath: binding.bundlePath,
    revisionId: binding.revision.id,
    proof: createHash("sha256").update(binding.manifestBytes).digest("hex")
  };
}
