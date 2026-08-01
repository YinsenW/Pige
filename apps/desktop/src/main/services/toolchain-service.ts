import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ToolchainHealth, ToolchainToolStatus } from "@pige/contracts";
import { ToolchainManifestSchema } from "@pige/schemas";
import { toolchainRepairEligibility } from "./toolchain-repair-service";

export interface ToolchainRecoveryDependencies {
  readonly hasActiveVault: () => boolean;
  readonly requeueWaitingParses: () => { readonly requeued: number };
  readonly requeueWaitingDatasetImports: () => { readonly requeued: number };
  readonly requeueWaitingOcr: () => { readonly requeued: number };
  readonly requeueWaitingAgentIngest: () => { readonly requeued: number };
  readonly scheduleParseProcessing: () => void;
  readonly scheduleDatasetImportProcessing: () => void;
  readonly scheduleOcrProcessing: () => void;
  readonly scheduleAgentIngestProcessing: () => void;
  readonly onRecoveryFailure: (owner: "parse" | "dataset_import" | "ocr" | "ingest") => void;
}

export class ToolchainService {
  readonly #manifestPath: string;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    manifestPath = path.resolve(process.cwd(), "resources/toolchain-manifest/toolchain.manifest.json"),
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#manifestPath = manifestPath;
    this.#resolveModule = resolveModule;
  }

  health(): ToolchainHealth {
    const manifest = ToolchainManifestSchema.parse(JSON.parse(fs.readFileSync(this.#manifestPath, "utf8")));
    const tools: ToolchainToolStatus[] = manifest.tools.map((tool) => {
      const resolvedPath = tool.bundledPath ? path.resolve(path.dirname(this.#manifestPath), tool.bundledPath) : undefined;
      const ready = resolvedPath
        ? fs.existsSync(resolvedPath)
        : tool.bundledModule
          ? canResolveModule(tool.bundledModule, this.#resolveModule)
          : false;
      return {
        id: tool.id,
        name: tool.name,
        required: tool.required,
        status: ready ? "ready" : "missing",
        ...(resolvedPath ? { resolvedPath } : {}),
        ...(tool.repairHint ? { repairHint: tool.repairHint } : {})
      };
    });

    const missingRequired = tools.some((tool) => tool.required && tool.status === "missing");
    const health: ToolchainHealth = {
      status: missingRequired ? "needs_repair" : "ready",
      checkedAt: new Date().toISOString(),
      tools
    };
    const repair = toolchainRepairEligibility(health);
    return repair ? { ...health, repair } : health;
  }

  recheckAndRecover(dependencies: ToolchainRecoveryDependencies): ToolchainHealth {
    const health = this.health();
    if (health.status !== "ready" || !dependencies.hasActiveVault()) return health;

    try {
      if (dependencies.requeueWaitingParses().requeued > 0) dependencies.scheduleParseProcessing();
    } catch {
      dependencies.onRecoveryFailure("parse");
    }
    try {
      if (dependencies.requeueWaitingDatasetImports().requeued > 0) dependencies.scheduleDatasetImportProcessing();
    } catch {
      dependencies.onRecoveryFailure("dataset_import");
    }
    try {
      if (dependencies.requeueWaitingOcr().requeued > 0) dependencies.scheduleOcrProcessing();
    } catch {
      dependencies.onRecoveryFailure("ocr");
    }
    try {
      if (dependencies.requeueWaitingAgentIngest().requeued > 0) dependencies.scheduleAgentIngestProcessing();
    } catch {
      dependencies.onRecoveryFailure("ingest");
    }
    return health;
  }
}

function canResolveModule(moduleId: string, resolveModule: (moduleId: string) => string): boolean {
  try {
    return Boolean(resolveModule(moduleId));
  } catch {
    if (!moduleId.endsWith("/package.json")) return false;
    try {
      return Boolean(resolveModule(moduleId.slice(0, -"/package.json".length)));
    } catch {
      return false;
    }
  }
}
