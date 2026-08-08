import { describe, expect, it } from "vitest";
import type { JobRecord } from "@pige/schemas";
import { JobDependencyRepairService } from "../../apps/desktop/src/main/services/job-dependency-repair-service";

const job = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  schemaVersion: 1,
  id: "job_dependency_repair_01",
  class: "parse",
  state: "waiting_dependency",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:01:00.000Z",
  activeVaultId: "vault_dependency_repair_01",
  waitingDependency: {
    dependencyKind: "local_tool",
    requiredAction: "repair_tool",
    messageKey: "job.waiting.localTool"
  },
  ...overrides
});

describe("JobDependencyRepairService", () => {
  it("prepares only a current waiting dependency and strips opaque detail", () => {
    const result = new JobDependencyRepairService().prepare(job(), {
      activeVaultId: "vault_dependency_repair_01",
      jobId: "job_dependency_repair_01",
      expectedUpdatedAt: "2026-08-09T00:01:00.000Z"
    });

    expect(result).toEqual({
      status: "ready",
      jobId: "job_dependency_repair_01",
      activeVaultId: "vault_dependency_repair_01",
      expectedUpdatedAt: "2026-08-09T00:01:00.000Z",
      dependencyKind: "local_tool",
      requiredAction: "repair_tool",
      messageKey: "job.waiting.localTool"
    });
    expect(result).not.toHaveProperty("dependencyId");
  });

  it("fails closed on identity, state, and unavailable-action drift", () => {
    const service = new JobDependencyRepairService();
    const request = {
      activeVaultId: "vault_dependency_repair_01",
      jobId: "job_dependency_repair_01",
      expectedUpdatedAt: "2026-08-09T00:01:00.000Z"
    };

    expect(service.prepare(job(), { ...request, expectedUpdatedAt: "2026-08-09T00:02:00.000Z" })).toEqual({ status: "stale" });
    expect(service.prepare(job({ state: "failed_retryable" }), request)).toEqual({ status: "ineligible" });
    expect(service.prepare(job({ waitingDependency: { dependencyKind: "runtime_capability", requiredAction: "unavailable", messageKey: "job.waiting.capability" } }), request)).toEqual({ status: "ineligible" });
    expect(service.prepare(undefined, request)).toEqual({ status: "not_found" });
  });

  it("repairs before resume and retains the job when repair fails", async () => {
    const service = new JobDependencyRepairService();
    const request = {
      activeVaultId: "vault_dependency_repair_01",
      jobId: "job_dependency_repair_01",
      expectedUpdatedAt: "2026-08-09T00:01:00.000Z"
    };
    const order: string[] = [];
    let current = job();
    await service.repairAndResume({
      request,
      readCurrentJob: () => current,
      repair: async () => {
        order.push("repair");
        current = job({ state: "queued", updatedAt: "2026-08-09T00:01:01.000Z", waitingDependency: undefined });
      },
      resume: async () => { order.push("resume"); }
    });
    expect(order).toEqual(["repair", "resume"]);

    await expect(service.repairAndResume({
      request,
      readCurrentJob: () => current,
      repair: async () => { throw new Error("repair failed"); },
      resume: async () => { order.push("must-not-resume"); }
    })).rejects.toThrow("repair failed");
    expect(order).not.toContain("must-not-resume");

    current = job();
    await expect(service.repairAndResume({
      request,
      readCurrentJob: () => current,
      repair: async () => { /* owner returned without clearing the durable wait */ },
      resume: async () => { order.push("incomplete-resume"); }
    })).rejects.toThrow("did not clear the waiting state");
    expect(order).not.toContain("incomplete-resume");

    current = job({ updatedAt: "2026-08-09T00:02:00.000Z" });
    await expect(service.repairAndResume({
      request,
      readCurrentJob: () => current,
      repair: async () => { order.push("stale-repair"); },
      resume: async () => { order.push("stale-resume"); }
    })).rejects.toThrow("ineligible");
    expect(order).not.toContain("stale-repair");
  });
});
