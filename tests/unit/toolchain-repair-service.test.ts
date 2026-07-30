import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PIGE_RELEASES_URL,
  ToolchainRepairService
} from "../../apps/desktop/src/main/services/toolchain-repair-service";

function health(missingToolIds: readonly string[]) {
  return {
    status: missingToolIds.length > 0 ? ("needs_repair" as const) : ("ready" as const),
    checkedAt: "2026-07-30T00:00:00.000Z",
    tools: missingToolIds.map((id) => ({
      id,
      name: id,
      required: true,
      status: "missing" as const,
      resolvedPath: `/private/${id}`,
      repairHint: `Repair ${id}`
    }))
  };
}

function request(missingRequiredToolIds: readonly string[]) {
  return {
    apiVersion: 1 as const,
    requestId: "toolchain_repair_request_abcdefghijklmnop",
    expectedHealthId: `toolchain_health_${"a".repeat(64)}`,
    expectedMissingRequiredToolIds: missingRequiredToolIds
  };
}

describe("toolchain repair service", () => {
  it("opens only the fixed Pige Releases page for the exact current missing-tool identity", async () => {
    const openReleases = vi.fn(async () => undefined);
    const service = new ToolchainRepairService({
      health: () => health(["uv", "git"]),
      openReleases
    });

    const repairRequest = request(["git", "uv"]);
    const current = serviceHealthIdentity(["uv", "git"]);
    await expect(service.repair({ ...repairRequest, expectedHealthId: current })).resolves.toEqual({
      ...repairRequest,
      expectedHealthId: current,
      status: "opened"
    });
    expect(openReleases).toHaveBeenCalledExactlyOnceWith(PIGE_RELEASES_URL);
  });

  it("fails stale before an external effect when the missing-tool identity drifts", async () => {
    const openReleases = vi.fn(async () => undefined);
    const service = new ToolchainRepairService({ health: () => health(["git", "uv"]), openReleases });

    const repairRequest = request(["git"]);
    await expect(service.repair(repairRequest)).resolves.toEqual({ ...repairRequest, status: "stale" });
    expect(openReleases).not.toHaveBeenCalled();
  });

  it("returns not_needed without an external effect after the installation becomes healthy", async () => {
    const openReleases = vi.fn(async () => undefined);
    const service = new ToolchainRepairService({ health: () => health([]), openReleases });

    const repairRequest = request(["git"]);
    await expect(service.repair(repairRequest)).resolves.toEqual({ ...repairRequest, status: "not_needed" });
    expect(openReleases).not.toHaveBeenCalled();
  });

  it("returns a body-free failure when the operating system refuses to open the page", async () => {
    const service = new ToolchainRepairService({
      health: () => health(["git"]),
      openReleases: async () => {
        throw new Error("private operating-system detail");
      }
    });

    const repairRequest = request(["git"]);
    const current = serviceHealthIdentity(["git"]);
    await expect(service.repair({ ...repairRequest, expectedHealthId: current })).resolves.toEqual({
      ...repairRequest,
      expectedHealthId: current,
      status: "failed"
    });
  });
});

function serviceHealthIdentity(missingToolIds: readonly string[]): string {
  const sorted = [...missingToolIds].sort((left, right) => left.localeCompare(right));
  return `toolchain_health_${createHash("sha256").update(JSON.stringify(sorted)).digest("hex")}`;
}
