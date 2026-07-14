import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobRecordSchema, type PermissionActionBinding } from "@pige/schemas";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import {
  createPermissionActionBinding,
  PermissionBrokerService,
  type PermissionActionSummary
} from "../../apps/desktop/src/main/services/permission-broker-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
const summary: PermissionActionSummary = {
  actorDisplayName: "Synthetic Recovery Skill",
  actionLabelKey: "permissions.action.fetch_release_notes",
  resourceKind: "network",
  resourceCount: 1,
  reasonCode: "external.release_notes"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Permission Broker Job recovery", () => {
  it("adopts a committed approval during pending reread instead of re-enabling the decision UI", () => {
    const fixture = createWaitingFixture("pending-reread");
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    });

    expect(fixture.jobs.pendingPermission(fixture.requestId)).toBeUndefined();
    expect(fixture.jobs.readAgentTurnJob(fixture.jobId)).toMatchObject({
      state: "queued",
      privacy: { permissionDecisionIds: [expect.stringMatching(/^permdec_/u)] }
    });
  });

  it("adopts one committed approval after restart and rejects an opposite replay", () => {
    const fixture = createWaitingFixture("approved");
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    });

    const restarted = reopen(fixture);
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 1 });
    expect(restarted.jobs.readAgentTurnJob(fixture.jobId)).toMatchObject({
      id: fixture.jobId,
      state: "queued",
      privacy: { permissionDecisionIds: [expect.stringMatching(/^permdec_/u)] }
    });
    expect(restarted.jobs.readAgentTurnJob(fixture.jobId)?.error).toBeUndefined();
    expect(restarted.jobs.resolvePermission({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    }).status).toBe("approved");
    expect(() => restarted.jobs.resolvePermission({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "deny"
    })).toThrowError(expect.objectContaining({ code: "permission.request_stale" }));
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 0 });
  });

  it("terminalizes one committed denial after restart without granting execution authority", () => {
    const fixture = createWaitingFixture("denied");
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "deny"
    });

    const restarted = reopen(fixture);
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 1 });
    expect(restarted.jobs.readAgentTurnJob(fixture.jobId)).toMatchObject({
      id: fixture.jobId,
      state: "failed_final",
      error: {
        code: "permission.denied",
        permissionRequestId: fixture.requestId,
        retryable: false
      }
    });
    expect(restarted.jobs.retry({ jobId: fixture.jobId }).status).toBe("not_allowed");
    expect(restarted.broker.read(fixture.vaultPath, fixture.requestId).state).toBe("denied");
  });

  it("repairs the crash window after the Job completion marker but before Broker completion", () => {
    const fixture = createWaitingFixture("completion-window");
    fixture.jobs.resolvePermission({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    });
    const queued = requireValue(fixture.jobs.readAgentTurnJob(fixture.jobId));
    const running = fixture.jobs.writeAgentTurnJob(queued, JobRecordSchema.parse({
      ...queued,
      state: "running",
      stage: "planning",
      startedAt: "2026-07-14T10:02:00.000Z",
      updatedAt: "2026-07-14T10:02:00.000Z",
      message: "The approved external action is running."
    }));
    const consumed = fixture.broker.consume(fixture.vaultPath, fixture.requestId, fixture.binding);
    fixture.jobs.commitPermissionConsumption({
      jobId: fixture.jobId,
      requestId: fixture.requestId,
      bindingHash: fixture.binding.bindingHash,
      decisionId: requireValue(consumed.decisionId),
      capability: fixture.binding.capability
    });
    const completionMarkerHash = digest("completed external output");
    fixture.jobs.completePermissionAction({
      jobId: fixture.jobId,
      requestId: fixture.requestId,
      bindingHash: fixture.binding.bindingHash,
      completionMarkerHash
    });
    expect(running.id).toBe(fixture.jobId);
    expect(fixture.broker.read(fixture.vaultPath, fixture.requestId).state).toBe("consumed");
    expect(fixture.broker.read(fixture.vaultPath, fixture.requestId).completionMarkerHash).toBeUndefined();

    const restarted = reopen(fixture);
    expect(restarted.jobs.recoverInterruptedJobs()).toMatchObject({ requeued: 1 });
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 1 });
    expect(restarted.broker.read(fixture.vaultPath, fixture.requestId)).toMatchObject({
      state: "consumed",
      completionMarkerHash,
      completedAt: expect.any(String)
    });
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 0 });
  });

  it("terminalizes consumed authority without a matching completion marker and never requeues it", () => {
    const fixture = createWaitingFixture("uncertain-completion");
    fixture.jobs.resolvePermission({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    });
    const queued = requireValue(fixture.jobs.readAgentTurnJob(fixture.jobId));
    fixture.jobs.writeAgentTurnJob(queued, JobRecordSchema.parse({
      ...queued,
      state: "running",
      stage: "planning",
      startedAt: "2026-07-14T10:02:30.000Z",
      updatedAt: "2026-07-14T10:02:30.000Z",
      message: "The approved external action reached the execution boundary."
    }));
    const consumed = fixture.broker.consume(fixture.vaultPath, fixture.requestId, fixture.binding);
    fixture.jobs.commitPermissionConsumption({
      jobId: fixture.jobId,
      requestId: fixture.requestId,
      bindingHash: fixture.binding.bindingHash,
      decisionId: requireValue(consumed.decisionId),
      capability: fixture.binding.capability
    });

    const restarted = reopen(fixture);
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 1 });
    expect(restarted.jobs.readAgentTurnJob(fixture.jobId)).toMatchObject({
      state: "failed_final",
      cancellation: { durableWritesApplied: true },
      error: {
        code: "permission.completion_uncertain",
        permissionRequestId: fixture.requestId,
        retryable: false
      }
    });
    expect(restarted.jobs.recoverInterruptedJobs()).toMatchObject({ requeued: 0 });
    expect(restarted.jobs.retry({ jobId: fixture.jobId }).status).toBe("not_allowed");
    expect(captureError(() => restarted.broker.prepare(
      fixture.vaultPath,
      fixture.binding,
      summary
    ))).toMatchObject({ code: "permission.completion_uncertain" });
  });

  it("cancels an orphaned pending request when restart sees its terminal Job", () => {
    const fixture = createWaitingFixture("cancel-window");
    const waiting = requireValue(fixture.jobs.readAgentTurnJob(fixture.jobId));
    fixture.jobs.writeAgentTurnJob(waiting, JobRecordSchema.parse({
      ...waiting,
      state: "cancelled",
      updatedAt: "2026-07-14T10:03:00.000Z",
      finishedAt: "2026-07-14T10:03:00.000Z",
      cancellation: {
        requestedAt: "2026-07-14T10:03:00.000Z",
        requestedBy: "user",
        safeCheckpointId: "before_durable_write",
        durableWritesApplied: false
      },
      message: "The Job committed cancellation before the Broker request was cleared."
    }));
    expect(fixture.broker.read(fixture.vaultPath, fixture.requestId).state).toBe("pending");

    const restarted = reopen(fixture);
    expect(restarted.jobs.reconcilePermissionActions()).toEqual({ reconciled: 1 });
    expect(restarted.broker.read(fixture.vaultPath, fixture.requestId)).toMatchObject({
      state: "cancelled",
      cancelledAt: expect.any(String)
    });
    expect(restarted.jobs.pendingPermission(fixture.requestId)).toBeUndefined();
  });

  it("cancels an approved but unconsumed request when the waiting Job is cancelled", () => {
    const fixture = createWaitingFixture("approved-cancel");
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    });

    expect(fixture.jobs.cancel({ jobId: fixture.jobId }).status).toBe("cancelled");
    expect(fixture.jobs.readAgentTurnJob(fixture.jobId)?.state).toBe("cancelled");
    expect(fixture.broker.read(fixture.vaultPath, fixture.requestId)).toMatchObject({
      state: "cancelled",
      cancelledAt: expect.any(String)
    });
    expect(fixture.jobs.pendingPermission(fixture.requestId)).toBeUndefined();
  });
});

interface Fixture {
  readonly root: string;
  readonly machineRoot: string;
  readonly vaultPath: string;
  readonly vaults: {
    readonly current: () => ReturnType<typeof loadVaultSummary>;
    readonly activeVaultPath: () => string;
    readonly assertWriterLease: () => void;
  };
  readonly broker: PermissionBrokerService;
  readonly jobs: JobsService;
  readonly binding: PermissionActionBinding;
  readonly requestId: string;
  readonly jobId: string;
}

function createWaitingFixture(suffix: string): Fixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `pige-permission-job-${suffix}-`)));
  roots.push(root);
  const vaultName = `Permission ${suffix}`;
  createVaultOnDisk({
    parentDirectory: root,
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-14T10:00:00.000Z")
  });
  const vaultPath = path.join(root, vaultName);
  const vault = loadVaultSummary(vaultPath);
  const vaults = {
    current: () => vault,
    activeVaultPath: () => vaultPath,
    assertWriterLease: () => undefined
  };
  const machineRoot = path.join(root, "machine-permission");
  fs.mkdirSync(machineRoot, { mode: 0o700 });
  const broker = new PermissionBrokerService({
    rootPath: machineRoot,
    assertWriterLease: () => undefined
  });
  const jobs = new JobsService(vaults, undefined, undefined, undefined, undefined, undefined, undefined, broker);
  const safeSuffix = suffix.replaceAll("-", "");
  const created = jobs.createAgentTurnJob({
    conversationEventId: `evt_20260714_${safeSuffix}permission`,
    conversationLocator: `.pige/conversations/2026/07/conv_20260714_${safeSuffix}.jsonl`,
    inputHash: digest(`permission input ${suffix}`)
  });
  const running = jobs.writeAgentTurnJob(created, JobRecordSchema.parse({
    ...created,
    state: "running",
    stage: "planning",
    startedAt: "2026-07-14T10:01:00.000Z",
    updatedAt: "2026-07-14T10:01:00.000Z",
    message: "Pi selected one permissioned external action."
  }));
  const binding = createPermissionActionBinding({
    vaultId: vault.vaultId,
    jobId: running.id,
    actorType: "skill",
    actorId: "skill.synthetic.recovery",
    actorVersion: "1.0.0",
    actorDigest: digest("recovery skill"),
    actionId: "network.fetch_release_notes",
    actionVersion: "1",
    actionInputHash: digest(`action ${suffix}`),
    capability: "external_network",
    dataBoundary: "network",
    resourceScope: "current_action",
    resourceIdentityHash: digest(`resource ${suffix}`),
    policyContextId: "policy_context_permission_recovery",
    policyHash: digest("permission recovery policy"),
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full"
  });
  const request = broker.prepare(vaultPath, binding, summary);
  jobs.bindPermissionRequest({
    jobId: running.id,
    requestId: request.id,
    bindingHash: binding.bindingHash
  });
  return {
    root,
    machineRoot,
    vaultPath,
    vaults,
    broker,
    jobs,
    binding,
    requestId: request.id,
    jobId: running.id
  };
}

function reopen(fixture: Fixture): { readonly broker: PermissionBrokerService; readonly jobs: JobsService } {
  const broker = new PermissionBrokerService({
    rootPath: fixture.machineRoot,
    assertWriterLease: () => undefined
  });
  return {
    broker,
    jobs: new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      broker
    )
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a durable value.");
  return value;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected the action to fail.");
}
