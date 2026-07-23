import { describe, expect, it, vi } from "vitest";
import { JobClassSchema } from "@pige/schemas";
import {
  createJobClassExecutorRegistry,
  JobClassExecutorRegistry
} from "../../apps/desktop/src/main/services/job-class-executor-registry";

describe("JobClassExecutorRegistry", () => {
  it("registers one explicit policy for every durable Job class", () => {
    const registry = createJobClassExecutorRegistry();
    expect(new Set(registry.classes())).toEqual(new Set(JobClassSchema.options));
    expect(registry.require("parse")).toMatchObject({
      actionOwner: "generic",
      runningCancellation: "cooperative",
      retryPolicy: "requeue",
      interruptedRecovery: "idempotent"
    });
    expect(registry.require("retrieval_query")).toMatchObject({
      actionOwner: "generic",
      runningCancellation: "not_allowed",
      retryPolicy: "reject",
      interruptedRecovery: "explicit_retry"
    });
    expect(registry.require("backup")).toMatchObject({
      actionOwner: "external",
      runningCancellation: "external",
      retryPolicy: "external",
      interruptedRecovery: "external"
    });
    expect(registry.require("restore")).toMatchObject({
      actionOwner: "external",
      runningCancellation: "external",
      retryPolicy: "external",
      interruptedRecovery: "explicit_retry"
    });
    for (const jobClass of [
      "capture_batch",
      "permissioned_skill",
      "tool_install",
      "migration",
      "maintenance"
    ] as const) {
      expect(registry.require(jobClass)).toMatchObject({
        actionOwner: "external",
        runningCancellation: "external",
        retryPolicy: "external",
        interruptedRecovery: "explicit_retry"
      });
    }
  });

  it("rejects duplicate or unavailable executors without invoking another class", () => {
    const registry = new JobClassExecutorRegistry();
    registry.register({
      jobClass: "capture",
      actionOwner: "generic",
      runningCancellation: "not_allowed",
      retryPolicy: "requeue",
      interruptedRecovery: "idempotent"
    });
    expect(() => registry.register({
      jobClass: "capture",
      actionOwner: "generic",
      runningCancellation: "cooperative",
      retryPolicy: "reject",
      interruptedRecovery: "external"
    })).toThrowError(expect.objectContaining({ code: "job.executor_duplicate" }));
    expect(() => registry.require("ocr")).toThrowError(expect.objectContaining({
      code: "job.executor_unavailable"
    }));
  });

  it("binds action adapters only to their exact class", async () => {
    const backupCancel = vi.fn(() => ({ status: "cancelled" as const }));
    const parseSchedule = vi.fn();
    const registry = createJobClassExecutorRegistry({
      backup: { cancel: backupCancel },
      parse: { schedule: parseSchedule }
    });

    await registry.require("backup").cancel?.({ jobId: "job_20260723_backup01" });
    registry.require("parse").schedule?.("job_20260723_parse001");
    expect(backupCancel).toHaveBeenCalledOnce();
    expect(parseSchedule).toHaveBeenCalledWith("job_20260723_parse001");
    expect(registry.require("ocr").cancel).toBeUndefined();
  });

  it("schedules every registered production executor through one exhaustive registry pass", () => {
    const captureSchedule = vi.fn();
    const datasetSchedule = vi.fn();
    const registry = createJobClassExecutorRegistry({
      capture: { schedule: captureSchedule },
      dataset_import: { schedule: datasetSchedule }
    });

    registry.scheduleAll();

    expect(captureSchedule).toHaveBeenCalledOnce();
    expect(datasetSchedule).toHaveBeenCalledOnce();
  });
});
