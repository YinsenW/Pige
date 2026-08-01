import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobChangedEvent, JobSummary, VaultSummary } from "@pige/contracts";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";
import { JobStateEventService } from "../../apps/desktop/src/main/services/job-state-event-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JobStateEventService", () => {
  it("publishes safe summaries only after exact active-vault durable commits", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-event-"));
    roots.push(vaultPath);
    const activeVaultId = "vault_20260801_jobevent";
    const jobsRoot = path.join(vaultPath, ".pige", "jobs");
    fs.mkdirSync(jobsRoot, { recursive: true });
    const events: JobChangedEvent[] = [];
    const service = new JobStateEventService({
      current: () => ({ vaultId: activeVaultId } as VaultSummary),
      activeVaultPath: () => vaultPath
    }, {
      summarize: (job) => summary(job)
    }, (event) => events.push(event));
    const store = new JobRecordStore({ rootPath: jobsRoot, unsafeAllowUnfenced: true });
    const jobPath = path.join(jobsRoot, "2026", "08", "job_20260801_jobevent.json");

    const created = store.createIfAbsent(jobPath, record(activeVaultId));
    const running = store.compareAndSwap(created, record(activeVaultId, {
      state: "running",
      stage: "importing",
      progress: { completedUnits: 8, totalUnits: 20, unit: "row" },
      updatedAt: "2026-08-01T08:00:01.000Z",
      message: "Dataset import running."
    }));

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[1]).toMatchObject({
      activeVaultId,
      job: {
        id: running.job.id,
        state: "running",
        progress: { completedUnits: 8, totalUnits: 20 },
        canCancel: true
      }
    });
    expect(JSON.stringify(events)).not.toContain(vaultPath);

    service.close();
    store.compareAndSwap(running, record(activeVaultId, {
      state: "completed",
      updatedAt: "2026-08-01T08:00:02.000Z",
      message: "Dataset import completed."
    }));
    expect(events).toHaveLength(2);
  });

  it("ignores commits from another vault root or vault identity", () => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-event-active-"));
    const otherVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-event-other-"));
    roots.push(vaultPath, otherVaultPath);
    const events: JobChangedEvent[] = [];
    const service = new JobStateEventService({
      current: () => ({ vaultId: "vault_20260801_activevault" } as VaultSummary),
      activeVaultPath: () => vaultPath
    }, { summarize: (job) => summary(job) }, (event) => events.push(event));
    const otherJobsRoot = path.join(otherVaultPath, ".pige", "jobs");
    fs.mkdirSync(otherJobsRoot, { recursive: true });
    const store = new JobRecordStore({ rootPath: otherJobsRoot, unsafeAllowUnfenced: true });

    store.createIfAbsent(
      path.join(otherJobsRoot, "2026", "08", "job_20260801_otherjob.json"),
      record("vault_20260801_othervault", { id: "job_20260801_otherjob" })
    );

    expect(events).toEqual([]);
    service.close();
  });
});

function record(activeVaultId: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: "job_20260801_jobevent",
    class: "dataset_import",
    state: "queued",
    activeVaultId,
    sourceId: "src_20260801_jobevent",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    message: "Dataset import queued.",
    ...overrides
  });
}

function summary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    class: job.class,
    state: job.state,
    ...(job.stage ? { stage: job.stage } : {}),
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.sourceId ? { sourceId: job.sourceId } : {}),
    sourceDisplayName: "accounts.csv",
    sourceKind: "csv_file",
    canReconnectDependency: false,
    canReconnectBackupDestination: false,
    canContinueIncomplete: false,
    canCancel: job.state === "queued" || job.state === "running",
    canRetry: false,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
