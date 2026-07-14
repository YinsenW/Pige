import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import {
  ModelEgressApprovalService,
  type ModelEgressApprovalBinding
} from "../../apps/desktop/src/main/services/model-egress-approval-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { JobRecordSchema } from "@pige/schemas";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("model egress Job recovery", () => {
  it("adopts a durable allow-once decision after restart without touching a model runtime", () => {
    const fixture = createFixture("approved");
    fixture.approvals.resolve(fixture.vaultPath, fixture.requestId, "allow_once");

    const reopenedApprovals = reopenApprovals(fixture);
    const restarted = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reopenedApprovals
    );

    expect(restarted.reconcileModelEgressApprovals()).toEqual({ reconciled: 1 });
    expect(restarted.readAgentTurnJob(fixture.jobId)).toMatchObject({
      id: fixture.jobId,
      state: "queued",
      inputRefs: fixture.inputRefs
    });
    expect(reopenedApprovals.read(fixture.vaultPath, fixture.requestId).reconciledAt).toBeUndefined();
    expect(reopenedApprovals.read(fixture.vaultPath, fixture.requestId).state).toBe("approved");
    expect(restarted.reconcileModelEgressApprovals()).toEqual({ reconciled: 0 });
    expect(restarted.cancel({ jobId: fixture.jobId }).status).toBe("cancelled");
    expect(reopenedApprovals.read(fixture.vaultPath, fixture.requestId).state).toBe("invalidated");
  });

  it("terminalizes a durable denial after restart while preserving the exact turn input", () => {
    const fixture = createFixture("denied");
    fixture.approvals.resolve(fixture.vaultPath, fixture.requestId, "deny");

    const reopenedApprovals = reopenApprovals(fixture);
    const restarted = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reopenedApprovals
    );

    expect(restarted.reconcileModelEgressApprovals()).toEqual({ reconciled: 1 });
    expect(restarted.readAgentTurnJob(fixture.jobId)).toMatchObject({
      id: fixture.jobId,
      state: "failed_final",
      inputRefs: fixture.inputRefs,
      error: {
        code: "model_provider.egress_denied",
        retryable: false,
        userAction: "none",
        modelEgressApprovalRequestId: fixture.requestId
      }
    });
    expect(restarted.retry({ jobId: fixture.jobId }).status).toBe("not_allowed");
    expect(reopenedApprovals.read(fixture.vaultPath, fixture.requestId).reconciledAt)
      .toEqual(expect.any(String));
  });

  it("requires a fresh request after a consumed decision whose provider completion is unknown", () => {
    const fixture = createFixture("consumed");
    fixture.approvals.resolve(fixture.vaultPath, fixture.requestId, "allow_once");
    fixture.approvals.consume(fixture.vaultPath, fixture.requestId, fixture.binding);

    const reopenedApprovals = reopenApprovals(fixture);
    const restarted = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reopenedApprovals
    );

    expect(restarted.reconcileModelEgressApprovals()).toEqual({ reconciled: 1 });
    expect(restarted.readAgentTurnJob(fixture.jobId)).toMatchObject({
      state: "queued",
      inputRefs: fixture.inputRefs,
      message: expect.stringContaining("fresh one-use approval")
    });
    const successor = reopenedApprovals.prepare(fixture.vaultPath, fixture.binding);
    expect(successor).toMatchObject({ state: "pending", jobId: fixture.jobId });
    expect(successor.id).not.toBe(fixture.requestId);
    expect(reopenedApprovals.read(fixture.vaultPath, fixture.requestId)).toMatchObject({
      state: "consumed",
      reconciledAt: expect.any(String)
    });
  });

  it("rejects a wrong Job binding without changing either durable record", () => {
    const fixture = createFixture("wrong-job");
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.approvals
    );

    expect(() => jobs.resolveModelEgress({
      requestId: fixture.requestId,
      jobId: "job_20260714_otherturn",
      decision: "allow_once"
    })).toThrowError(/another vault/u);
    expect(fixture.approvals.read(fixture.vaultPath, fixture.requestId).state).toBe("pending");
    expect(jobs.readAgentTurnJob(fixture.jobId)?.state).toBe("waiting_model_egress");
  });

  it("does not let a stale Job receive or wake a newly committed approval", async () => {
    const fixture = createFixture("stale-job");
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.approvals
    );
    const wait = fixture.approvals.waitForDecision(
      fixture.vaultPath,
      fixture.requestId,
      fixture.binding
    );
    const current = requireValue(jobs.readAgentTurnJob(fixture.jobId));
    const { error: _error, stage: _stage, ...rest } = current;
    jobs.writeAgentTurnJob(current, JobRecordSchema.parse({
      ...rest,
      state: "queued",
      updatedAt: "2026-07-14T08:02:00.000Z",
      message: "A newer exact Job revision won before the decision."
    }));

    expect(() => jobs.resolveModelEgress({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    })).toThrowError(/no longer waits/u);
    expect(fixture.approvals.read(fixture.vaultPath, fixture.requestId).state).toBe("pending");
    expect(fixture.approvals.hasLiveWaiter(fixture.requestId)).toBe(true);
    fixture.approvals.invalidate(fixture.vaultPath, fixture.requestId);
    await expect(wait).rejects.toMatchObject({ code: "model_egress.approval_stale" });
  });

  it("commits one live denial, preserves input refs, and rejects an opposite replay", async () => {
    const fixture = createFixture("live-denial");
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.approvals
    );
    const wait = fixture.approvals.waitForDecision(
      fixture.vaultPath,
      fixture.requestId,
      fixture.binding
    );

    expect(jobs.resolveModelEgress({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "deny"
    })).toMatchObject({ status: "denied", requestId: fixture.requestId });
    await expect(wait).rejects.toMatchObject({ code: "model_egress.denied" });
    expect(jobs.readAgentTurnJob(fixture.jobId)).toMatchObject({
      state: "failed_final",
      inputRefs: fixture.inputRefs,
      error: { code: "model_provider.egress_denied", retryable: false }
    });
    expect(jobs.resolveModelEgress({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "deny"
    }).status).toBe("denied");
    expect(() => jobs.resolveModelEgress({
      requestId: fixture.requestId,
      jobId: fixture.jobId,
      decision: "allow_once"
    })).toThrowError(/no longer pending/u);
  });

  it("does not wake a live invocation when the Job CAS fails after decision persistence", async () => {
    const fixture = createFixture("cas-failure");
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.approvals
    );
    const wait = fixture.approvals.waitForDecision(
      fixture.vaultPath,
      fixture.requestId,
      fixture.binding
    );
    const originalRename = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).endsWith(`${fixture.jobId}.json`)) {
        throw Object.assign(new Error("synthetic Job CAS commit failure"), { code: "EIO" });
      }
      return originalRename(source, target);
    });
    try {
      expect(() => jobs.resolveModelEgress({
        requestId: fixture.requestId,
        jobId: fixture.jobId,
        decision: "allow_once"
      })).toThrow();
    } finally {
      rename.mockRestore();
    }

    expect(fixture.approvals.read(fixture.vaultPath, fixture.requestId).state).toBe("approved");
    expect(fixture.approvals.hasLiveWaiter(fixture.requestId)).toBe(true);
    expect(jobs.readAgentTurnJob(fixture.jobId)?.state).toBe("waiting_model_egress");
    fixture.approvals.invalidate(fixture.vaultPath, fixture.requestId);
    await expect(wait).rejects.toMatchObject({ code: "model_egress.approval_stale" });
  });

  it("ignores a normally completed consumed record while reconciling a later denial", () => {
    const fixture = createFixture("terminal-consumed");
    fixture.approvals.resolve(fixture.vaultPath, fixture.requestId, "allow_once");
    fixture.approvals.consume(fixture.vaultPath, fixture.requestId, fixture.binding);
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixture.approvals
    );
    const current = requireValue(jobs.readAgentTurnJob(fixture.jobId));
    const { error: _error, stage: _stage, ...rest } = current;
    jobs.writeAgentTurnJob(current, JobRecordSchema.parse({
      ...rest,
      state: "completed",
      updatedAt: "2026-07-14T08:03:00.000Z",
      finishedAt: "2026-07-14T08:03:00.000Z",
      message: "The exact provider invocation completed before restart."
    }));

    const deniedJob = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260714_laterdenialturn",
      conversationLocator: ".pige/conversations/2026/07/conv_20260714_laterdenial.jsonl",
      inputHash: digest("later denial input")
    });
    const deniedBinding = binding(deniedJob.id, fixture.binding.vaultId, "later-denial");
    const deniedRequest = fixture.approvals.prepare(fixture.vaultPath, deniedBinding);
    fixture.approvals.bindAudit(
      fixture.vaultPath,
      deniedRequest.id,
      deniedBinding,
      "op_20260714_laterdenialaudit",
      digest("later denial decision")
    );
    jobs.writeAgentTurnJob(deniedJob, JobRecordSchema.parse({
      ...deniedJob,
      state: "waiting_model_egress",
      stage: "waiting_for_model",
      updatedAt: "2026-07-14T08:04:00.000Z",
      error: {
        code: "model_provider.egress_confirmation_required",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "confirm_model_egress",
        modelEgressApprovalRequestId: deniedRequest.id
      },
      message: "Waiting for a later exact denial."
    }));
    fixture.approvals.resolve(fixture.vaultPath, deniedRequest.id, "deny");

    const restarted = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reopenApprovals(fixture)
    );
    expect(restarted.reconcileModelEgressApprovals()).toEqual({ reconciled: 1 });
    expect(restarted.readAgentTurnJob(fixture.jobId)?.state).toBe("completed");
    expect(restarted.readAgentTurnJob(deniedJob.id)?.state).toBe("failed_final");
  });
});

function createFixture(suffix: string): {
  readonly root: string;
  readonly machineRoot: string;
  readonly vaultPath: string;
  readonly vaults: {
    readonly current: () => ReturnType<typeof loadVaultSummary>;
    readonly activeVaultPath: () => string;
  };
  readonly approvals: ModelEgressApprovalService;
  readonly requestId: string;
  readonly jobId: string;
  readonly inputRefs: readonly unknown[];
  readonly binding: ModelEgressApprovalBinding;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pige-egress-job-${suffix}-`));
  roots.push(root);
  const vaultName = `Egress ${suffix}`;
  createVaultOnDisk({
    parentDirectory: root,
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-14T08:00:00.000Z")
  });
  const vaultPath = path.join(root, vaultName);
  const vault = loadVaultSummary(vaultPath);
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  const machineRoot = path.join(root, "machine-egress");
  fs.mkdirSync(machineRoot);
  const approvals = new ModelEgressApprovalService({ rootPath: machineRoot, unsafeAllowUnfenced: true });
  const jobs = new JobsService(vaults, undefined, undefined, undefined, undefined, undefined, approvals);
  const identitySuffix = suffix.replaceAll("-", "");
  const created = jobs.createAgentTurnJob({
    conversationEventId: `evt_20260714_${identitySuffix}turn`,
    conversationLocator: `.pige/conversations/2026/07/conv_20260714_${identitySuffix}.jsonl`,
    inputHash: digest(`input ${suffix}`)
  });
  const approvalBinding = binding(created.id, vault.vaultId, suffix);
  const pending = approvals.prepare(vaultPath, approvalBinding);
  approvals.bindAudit(
    vaultPath,
    pending.id,
    approvalBinding,
    `op_20260714_${identitySuffix}audit`,
    digest(`decision ${suffix}`)
  );
  const waiting = jobs.writeAgentTurnJob(created, JobRecordSchema.parse({
    ...created,
    state: "waiting_model_egress",
    stage: "waiting_for_model",
    updatedAt: "2026-07-14T08:01:00.000Z",
    error: {
      code: "model_provider.egress_confirmation_required",
      domain: "model_provider",
      messageKey: "errors.model_provider.egress_confirmation_required",
      retryable: false,
      severity: "warning",
      userAction: "confirm_model_egress",
      modelEgressApprovalRequestId: pending.id
    },
    message: "Waiting for one exact model send decision."
  }));
  return {
    root,
    machineRoot,
    vaultPath,
    vaults,
    approvals,
    requestId: pending.id,
    jobId: waiting.id,
    inputRefs: waiting.inputRefs,
    binding: approvalBinding
  };
}

function reopenApprovals(fixture: {
  readonly machineRoot: string;
  readonly vaultPath: string;
}): ModelEgressApprovalService {
  return new ModelEgressApprovalService({
    rootPath: fixture.machineRoot,
    assertWriterLease: (vaultPath) => {
      if (vaultPath !== fixture.vaultPath) throw new Error("unexpected vault");
    }
  });
}

function binding(jobId: string, vaultId: string, suffix: string): ModelEgressApprovalBinding {
  return {
    jobId,
    vaultId,
    providerProfileId: "provider_egress",
    modelProfileId: "model_egress",
    providerIdentityHash: digest(`provider ${suffix}`),
    modelIdentityHash: digest(`model ${suffix}`),
    policyHash: digest(`policy ${suffix}`),
    payloadHash: digest(`payload ${suffix}`),
    evidenceSummaryHash: digest(`evidence ${suffix}`),
    baseDecisionHash: digest(`base decision ${suffix}`),
    reasonCode: "sensitive_confirmation",
    contentClasses: ["sensitive"],
    payloadCharacters: 256,
    estimatedPayloadTokens: 64,
    normalPayloadCharacterLimit: 8_000
  };
}

function digest(value: string): string {
  return `sha256:${Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
