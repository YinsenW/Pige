import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CrashRecoveryService, type CrashRecoverySummary } from "../../apps/desktop/src/main/services/crash-recovery-service";
import { DiagnosticsService } from "../../apps/desktop/src/main/services/diagnostics-service";
import { DiagnosticsHealthSchema } from "@pige/schemas";

const roots: string[] = [];
const makeRoot = (): string => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-crash-recovery-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("crash recovery service", () => {
  it("detects an unclosed session and publishes a bounded durable recovery summary", () => {
    const root = makeRoot();
    new CrashRecoveryService(root, () => new Date("2026-08-01T01:00:00.000Z")).beginSession();

    const restarted = new CrashRecoveryService(root, () => new Date("2026-08-01T01:01:00.000Z"));
    expect(restarted.beginSession()?.status).toBe("recovering");
    restarted.observe({ capturesPreserved: 2, jobsRecovered: 3, jobsNeedRetry: 1, proposalsRecovered: 1, proposalsAwaitingReview: 2 });
    const summary = restarted.complete();

    expect(summary).toMatchObject({
      status: "needs_attention", capturesPreserved: 2, jobsRecovered: 3,
      jobsNeedRetry: 1, proposalsRecovered: 1, proposalsAwaitingReview: 2, sourcesNeedRepair: 0
    });
    expect(summary?.recoveryId).toMatch(/^crashrecovery_[a-f0-9]{32}$/u);
    expect(new CrashRecoveryService(root).summary()).toEqual(summary);
    expect(new CrashRecoveryService(root).history()).toEqual([summary]);
    expect(DiagnosticsHealthSchema.parse({
      status: "degraded", checkedAt: "2026-08-01T01:02:00.000Z", localOnly: true,
      recentErrorCount: 0, checks: [], crashRecovery: summary
    }).crashRecovery).toEqual(summary);
    expect(JSON.stringify(summary)).not.toContain(root);
  });

  it("removes the active marker on a clean exit and does not fabricate a recovery", () => {
    const root = makeRoot();
    const first = new CrashRecoveryService(root);
    expect(first.beginSession()).toBeUndefined();
    first.markClean();
    expect(new CrashRecoveryService(root).beginSession()).toBeUndefined();
  });

  it("does not mutate a completed summary when late recovery work settles", () => {
    const root = makeRoot();
    new CrashRecoveryService(root).beginSession();
    const restarted = new CrashRecoveryService(root);
    restarted.beginSession();
    const complete = restarted.complete();
    expect(restarted.observe({ jobsNeedRetry: 1 })).toEqual(complete);
  });

  it("includes the pathless recovery summary in the local support payload", () => {
    const root = makeRoot();
    new CrashRecoveryService(root).beginSession();
    const recovery = new CrashRecoveryService(root);
    recovery.beginSession();
    recovery.observe({ jobsRecovered: 1 });
    recovery.complete();
    const diagnostics = new DiagnosticsService(root, {
      crashRecoverySummary: () => recovery.summary(), crashRecoveryHistory: () => recovery.history()
    });
    diagnostics.recordEvent({ level: "info", code: "app.ready", message: "App ready." });
    const selection = diagnostics.eventSelection();
    const event = selection.events[0];
    if (!event) throw new Error("Expected a selectable diagnostics event.");
    const payload = JSON.parse(diagnostics.createSupportBundlePayload(diagnostics.previewSupportBundle({
      apiVersion: 1,
      requestId: "diagpreviewreq_crashrecovery000",
      scopeContextId: `diagctx_${"a".repeat(48)}`,
      expectedRevision: 0,
      activeVaultId: null,
      eventSelectionRevision: selection.revision,
      selectedDiagnosticEventIds: [event.eventId]
    }))) as {
      diagnosticsHealth: { crashRecovery?: CrashRecoverySummary; crashRecoveryHistory?: CrashRecoverySummary[] };
    };
    expect(payload.diagnosticsHealth.crashRecovery).toMatchObject({ status: "recovered", jobsRecovered: 1 });
    expect(payload.diagnosticsHealth.crashRecoveryHistory).toHaveLength(1);
    expect(JSON.stringify(payload.diagnosticsHealth.crashRecovery)).not.toContain(root);
  });

  it("retains only the ten most recent completed recoveries", () => {
    const root = makeRoot();
    for (let index = 0; index < 12; index += 1) {
      new CrashRecoveryService(root).beginSession();
      const recovery = new CrashRecoveryService(root, () => new Date(Date.UTC(2026, 7, 1, 2, index)));
      recovery.beginSession();
      recovery.complete();
      recovery.markClean();
    }
    const history = new CrashRecoveryService(root).history();
    expect(history).toHaveLength(10);
    expect(history.map((entry) => entry.completedAt)).toEqual([...history.map((entry) => entry.completedAt)].sort());
  });

  it("fails visibly on a malformed prior marker and clears only the completed summary", () => {
    const root = makeRoot();
    const directory = path.join(root, "diagnostics", "crash-recovery");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "active-session.json"), "not-json\n");
    const service = new CrashRecoveryService(root);
    expect(service.beginSession()?.status).toBe("recovering");
    expect(service.complete()?.status).toBe("recovered");
    service.clearSummary();
    expect(service.summary()).toBeUndefined();
    expect(fs.existsSync(path.join(directory, "active-session.json"))).toBe(true);
  });
});
