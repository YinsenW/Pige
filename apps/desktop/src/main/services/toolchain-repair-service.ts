import { createHash } from "node:crypto";
import type {
  ToolchainHealth,
  ToolchainRepairEligibility,
  ToolchainRepairRequest,
  ToolchainRepairResult
} from "@pige/contracts";

export const PIGE_RELEASES_URL = "https://github.com/YinsenW/Pige/releases";

interface ToolchainRepairDependencies {
  readonly health: () => ToolchainHealth;
  readonly openReleases: (url: string) => Promise<void>;
}

export class ToolchainRepairService {
  readonly #dependencies: ToolchainRepairDependencies;

  constructor(dependencies: ToolchainRepairDependencies) {
    this.#dependencies = dependencies;
  }

  async repair(request: ToolchainRepairRequest): Promise<ToolchainRepairResult> {
    const current = toolchainRepairEligibility(this.#dependencies.health());
    if (!current) return result(request, "not_needed");
    if (
      request.expectedHealthId !== current.healthId ||
      !sameIds(request.expectedMissingRequiredToolIds, current.missingRequiredToolIds)
    ) {
      return result(request, "stale");
    }

    try {
      await this.#dependencies.openReleases(PIGE_RELEASES_URL);
      return result(request, "opened");
    } catch {
      return result(request, "failed");
    }
  }
}

export function toolchainRepairEligibility(health: ToolchainHealth): ToolchainRepairEligibility | undefined {
  const missingRequiredToolIds = health.tools
    .filter((tool) => tool.required && tool.status === "missing")
    .map((tool) => tool.id)
    .sort();
  if (missingRequiredToolIds.length === 0) return undefined;
  const digest = createHash("sha256")
    .update(JSON.stringify(missingRequiredToolIds))
    .digest("hex");
  return {
    healthId: `toolchain_health_${digest}`,
    missingRequiredToolIds
  };
}

function sameIds(expected: readonly string[], current: readonly string[]): boolean {
  return expected.length === current.length && expected.every((id, index) => id === current[index]);
}

function result(
  request: ToolchainRepairRequest,
  status: ToolchainRepairResult["status"]
): ToolchainRepairResult {
  return {
    apiVersion: 1,
    requestId: request.requestId,
    expectedHealthId: request.expectedHealthId,
    expectedMissingRequiredToolIds: request.expectedMissingRequiredToolIds,
    status
  };
}
