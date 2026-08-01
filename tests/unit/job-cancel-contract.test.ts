import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentConversationTurnSummarySchema,
  JobCancelRequestSchema,
  JobCancelResultSchema
} from "@pige/schemas";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REQUEST = {
  apiVersion: 1 as const,
  requestId: "jobcancelreq_0123456789abcdef",
  activeVaultId: "vault_20260710_0123456789abcdef",
  jobId: "job_20260710_0123456789abcdef",
  expectedUpdatedAt: "2026-07-10T12:00:00.000Z"
};
const JOB = {
  id: REQUEST.jobId,
  class: "parse" as const,
  state: "running" as const,
  canReconnectDependency: false,
  canReconnectBackupDestination: false,
  canContinueIncomplete: false,
  canCancel: true,
  canRetry: false,
  message: "Parsing preserved source.",
  createdAt: "2026-07-10T11:59:00.000Z",
  updatedAt: REQUEST.expectedUpdatedAt
};

describe("Job cancellation authority contract", () => {
  it("requires exact Vault and Job revision identity and keeps failures body-free", () => {
    expect(JobCancelRequestSchema.parse(REQUEST)).toEqual(REQUEST);
    expect(() => JobCancelRequestSchema.parse({ ...REQUEST, expectedUpdatedAt: undefined })).toThrow();
    expect(() => JobCancelRequestSchema.parse({ ...REQUEST, unexpected: true })).toThrow();

    expect(JobCancelResultSchema.parse({
      apiVersion: 1,
      requestId: REQUEST.requestId,
      activeVaultId: REQUEST.activeVaultId,
      jobId: REQUEST.jobId,
      status: "stale",
      job: JOB
    })).toMatchObject({ status: "stale", job: { updatedAt: REQUEST.expectedUpdatedAt } });
    expect(() => JobCancelResultSchema.parse({
      apiVersion: 1,
      requestId: REQUEST.requestId,
      activeVaultId: REQUEST.activeVaultId,
      jobId: REQUEST.jobId,
      status: "stale"
    })).toThrow();
    expect(() => JobCancelResultSchema.parse({
      apiVersion: 1,
      requestId: REQUEST.requestId,
      activeVaultId: REQUEST.activeVaultId,
      jobId: REQUEST.jobId,
      status: "failed",
      job: JOB
    })).toThrow();
  });

  it("requires a current Job revision on cancelable conversation turns", () => {
    const identity = {
      jobId: REQUEST.jobId,
      userEventId: "evt_20260710_0123456789abcdef",
      state: "running" as const
    };
    expect(() => AgentConversationTurnSummarySchema.parse(identity)).toThrow();
    expect(AgentConversationTurnSummarySchema.parse({ ...identity, updatedAt: REQUEST.expectedUpdatedAt }))
      .toMatchObject({ updatedAt: REQUEST.expectedUpdatedAt });
    expect(AgentConversationTurnSummarySchema.parse({ ...identity, state: "completed" }))
      .not.toHaveProperty("updatedAt");
  });

  it("parses both IPC directions and fences Main before aborting any process", () => {
    const preload = read("apps/desktop/src/preload/index.ts");
    expect(preload).toContain("JobCancelRequestSchema.parse(value)");
    expect(preload).toContain("JobCancelResultSchema.parse(await ipcRenderer.invoke(\"jobs.cancel\", request))");
    expect(preload).toContain("result.jobId !== request.jobId");

    const main = read("apps/desktop/src/main/index.ts");
    const handler = main.slice(
      main.indexOf('ipcMain.handle("jobs.cancel"'),
      main.indexOf('ipcMain.handle("jobs.retry"')
    );
    expect(handler).toContain("JobCancelRequestSchema.parse(value)");
    expect(handler).toContain("jobs.inspectCancelCurrentness(request)");
    expect(handler.indexOf("jobs.inspectCancelCurrentness(request)"))
      .toBeLessThan(handler.indexOf("getTaskProcessSessionService().cancelJob(request.jobId)"));
    expect(handler).toContain('status: "stale", job: currentness.job');
  });

  it("binds every renderer cancellation caller to its authoritative Job revision", () => {
    const helper = read("apps/desktop/src/renderer/src/job-cancel-request.ts");
    expect(helper).toContain("apiVersion: 1");
    expect(helper).toContain("requestId:");
    expect(helper).toContain("activeVaultId: identity.activeVaultId");
    expect(helper).toContain("expectedUpdatedAt: identity.expectedUpdatedAt");
    expect(helper).toContain("groups.flat().find((candidate) => candidate.id === jobId)");

    const app = read("apps/desktop/src/renderer/src/App.tsx");
    expect(app).toContain("cancelKnownJob(activeVaultIdRef.current, jobId, recentJobs, backupJobs, activityJobs)");
    const note = read("apps/desktop/src/renderer/src/components/CurrentNoteAgent.tsx");
    expect(note).toContain("expectedUpdatedAt: latestTurn.updatedAt");
    const backup = read("apps/desktop/src/renderer/src/components/VaultBackupSettingsPanel.tsx");
    expect(backup).toContain("expectedUpdatedAt: activeBackupJob.updatedAt");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}
