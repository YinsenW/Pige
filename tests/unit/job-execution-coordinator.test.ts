import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobRecordSchema, type JobRecord, type JobState } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  JobExecutionCoordinator,
  isLegalJobStateTransition,
  isTerminalJobState
} from "../../apps/desktop/src/main/services/job-execution-coordinator";
import {
  JobRecordStore,
  type JobRecordSnapshot
} from "../../apps/desktop/src/main/services/job-record-store";

const CREATED_AT = "2026-07-16T08:00:00.000Z";
const CLOCK_AT = "2026-07-16T08:01:00.000Z";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JobExecutionCoordinator", () => {
  it("exposes the complete legal transition graph without making terminal states mutable", () => {
    const beginStates: JobState[] = [
      "queued",
      "failed_retryable",
      "waiting_dependency",
      "waiting_permission",
      "waiting_model_egress",
      "awaiting_review"
    ];
    const outcomeStates: JobState[] = [
      "completed",
      "completed_with_warnings",
      "cancelled",
      "failed_retryable",
      "failed_final",
      "waiting_dependency",
      "waiting_permission",
      "waiting_model_egress",
      "awaiting_review"
    ];

    for (const state of beginStates) expect(isLegalJobStateTransition(state, "running")).toBe(true);
    expect(isLegalJobStateTransition("running", "cancel_requested")).toBe(true);
    for (const from of ["running", "cancel_requested"] satisfies JobState[]) {
      for (const state of outcomeStates) expect(isLegalJobStateTransition(from, state)).toBe(true);
    }
    for (const terminal of [
      "completed",
      "completed_with_warnings",
      "failed_final",
      "cancelled",
      "compacted"
    ] satisfies JobState[]) {
      expect(isTerminalJobState(terminal)).toBe(true);
      expect(isLegalJobStateTransition(terminal, "running")).toBe(false);
    }
    expect(isLegalJobStateTransition("queued", "completed")).toBe(false);
    expect(isLegalJobStateTransition("running", "running")).toBe(false);
  });

  it("begins only queued and retryable jobs with coordinator-owned lifecycle projections", () => {
    for (const [index, state] of ([
      "queued",
      "failed_retryable"
    ] satisfies JobState[]).entries()) {
      const fixture = makeFixture(index);
      const cancellation = state === "failed_retryable"
        ? {
            requestedAt: "2026-07-16T08:00:30.000Z",
            requestedBy: "user" as const,
            safeCheckpointId: "page_publication_started",
            durableWritesApplied: true
          }
        : undefined;
      const retry = state === "failed_retryable"
        ? { retryCount: 1, maxAutomaticRetries: 3, lastRetryReason: "provider timeout" }
        : undefined;
      const created = fixture.create(makeJob(fixture.jobId, {
        state,
        startedAt: "2026-07-16T08:00:10.000Z",
        finishedAt: "2026-07-16T08:00:20.000Z",
        cancellation,
        retry,
        error: state === "failed_retryable" ? retryableError() : undefined
      }));

      const running = fixture.coordinator.begin(created, {
        stage: "planning",
        message: "Agent execution started.",
        facts: {
          policyContextId: "policy_context_01",
          policyHash: sha256("a"),
          inputRefs: [{ kind: "source", id: "src_20260716_abcdef12" }]
        }
      }).job;

      expect(running).toMatchObject({
        state: "running",
        stage: "planning",
        startedAt: CLOCK_AT,
        updatedAt: CLOCK_AT,
        message: "Agent execution started.",
        policyContextId: "policy_context_01"
      });
      expect(running.finishedAt).toBeUndefined();
      expect(running.waitingDependency).toBeUndefined();
      expect(running.error).toBeUndefined();
      if (state === "failed_retryable") {
        expect(running.retry).toMatchObject({ retryCount: 2, maxAutomaticRetries: 3 });
        expect(running.cancellation).toEqual({
          safeCheckpointId: "page_publication_started",
          durableWritesApplied: true
        });
      }
    }
  });

  it("patches only bounded durable facts and merges monotonic evidence", () => {
    const fixture = makeFixture();
    const running = fixture.coordinator.begin(fixture.create(), {
      stage: "planning",
      message: "Planning."
    });
    const patched = fixture.coordinator.patch(running, {
      stage: "writing",
      outputRefs: [{ kind: "page", id: "page_01" }],
      operationIds: ["op_20260716_abcdef12", "op_20260716_abcdef12"],
      proposalIds: ["proposal_20260716_abcdef12"],
      checkpoints: [{
        id: "write",
        step: "write note",
        state: "done",
        inputRefs: [],
        outputRefs: [{ kind: "page", id: "page_01" }]
      }],
      progress: { completedUnits: 1, totalUnits: 2, unit: "steps" },
      privacy: {
        usedCloudModel: true,
        usedNetwork: true,
        usedShell: false,
        accessedExternalFiles: false,
        permissionDecisionIds: ["permdec_20260716_abcdef12"]
      },
      message: "Writing durable output."
    }).job;

    expect(patched).toMatchObject({
      state: "running",
      stage: "writing",
      operationIds: ["op_20260716_abcdef12"],
      proposalIds: ["proposal_20260716_abcdef12"],
      progress: { completedUnits: 1, totalUnits: 2 },
      message: "Writing durable output."
    });
    expect(patched.checkpoints).toHaveLength(1);
    expect(patched.privacy?.usedCloudModel).toBe(true);

    for (const forbidden of ["state", "updatedAt", "startedAt", "finishedAt", "retry", "cancellation"]) {
      expect(() => fixture.coordinator.patch(
        fixture.store.read(fixture.jobPath),
        { [forbidden]: forbidden === "state" ? "completed" : {} } as never
      )).toThrowError(expect.objectContaining({ code: "job.command_invalid" }));
    }
  });

  it("requires exact durable proof before resuming dependency, permission, model-egress, and review waits", () => {
    const fixture = makeFixture();
    const running = fixture.coordinator.begin(fixture.create(), {
      stage: "planning",
      message: "Planning."
    });
    const waitingDependency = fixture.coordinator.settle(running, {
      kind: "waiting",
      reason: "dependency",
      dependency: dependency(),
      error: retryableError(),
      message: "Configure a model."
    });
    expect(waitingDependency.job).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: { dependencyKind: "model_provider" },
      error: { code: "model_provider.unavailable" }
    });

    expect(() => fixture.coordinator.begin(waitingDependency, {
      stage: "planning",
      message: "Bare resume."
    })).toThrowError(expect.objectContaining({ code: "job.transition_invalid" }));
    expect(() => fixture.coordinator.resume(waitingDependency, {
      stage: "planning",
      message: "Wrong dependency repaired.",
      proof: {
        kind: "dependency_repaired",
        dependency: { ...dependency(), dependencyId: "provider_other" },
        operationId: "op_20260716_dependency01"
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const resumedDependency = fixture.coordinator.resume(waitingDependency, {
      stage: "planning",
      message: "Model configured.",
      proof: {
        kind: "dependency_repaired",
        dependency: dependency(),
        operationId: "op_20260716_dependency01"
      }
    });
    expect(resumedDependency.job.operationIds).toContain("op_20260716_dependency01");
    const waitingPermission = fixture.coordinator.settle(resumedDependency, {
      kind: "waiting",
      reason: "permission",
      permissionRequestId: "permreq_20260716_abcdef12",
      error: permissionError(),
      message: "Permission is required."
    });
    expect(waitingPermission.job).toMatchObject({
      state: "waiting_permission",
      permissionRequestIds: ["permreq_20260716_abcdef12"],
      error: { permissionRequestId: "permreq_20260716_abcdef12" }
    });

    expect(() => fixture.coordinator.resume(waitingPermission, {
      stage: "planning",
      message: "Wrong permission resolved.",
      proof: {
        kind: "permission_decided",
        permissionRequestId: "permreq_20260716_other000",
        permissionDecisionId: "permdec_20260716_abcdef12"
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const resumedPermission = fixture.coordinator.resume(waitingPermission, {
      stage: "planning",
      message: "Permission resolved.",
      proof: {
        kind: "permission_decided",
        permissionRequestId: "permreq_20260716_abcdef12",
        permissionDecisionId: "permdec_20260716_abcdef12"
      }
    });
    expect(resumedPermission.job.privacy?.permissionDecisionIds).toContain("permdec_20260716_abcdef12");
    const waitingEgress = fixture.coordinator.settle(resumedPermission, {
      kind: "waiting",
      reason: "model_egress",
      approvalRequestId: "egressreq_20260716_abcdef1234567890",
      error: egressError(),
      message: "Model egress approval is required."
    });
    expect(waitingEgress.job).toMatchObject({
      state: "waiting_model_egress",
      error: { modelEgressApprovalRequestId: "egressreq_20260716_abcdef1234567890" }
    });

    expect(() => fixture.coordinator.resume(waitingEgress, {
      stage: "planning",
      message: "Wrong egress resolved.",
      proof: {
        kind: "model_egress_decided",
        approvalRequestId: "egressreq_20260716_0000000000000000",
        operationId: "op_20260716_egress0001"
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const resumedEgress = fixture.coordinator.resume(waitingEgress, {
      stage: "planning",
      message: "Model egress resolved.",
      proof: {
        kind: "model_egress_decided",
        approvalRequestId: "egressreq_20260716_abcdef1234567890",
        operationId: "op_20260716_egress0001"
      }
    });
    const waitingReview = fixture.coordinator.settle(resumedEgress, {
      kind: "waiting",
      reason: "review",
      proposalId: "proposal_20260716_abcdef12",
      message: "Review the proposed write."
    });
    expect(waitingReview.job).toMatchObject({
      state: "awaiting_review",
      proposalIds: ["proposal_20260716_abcdef12"]
    });
    expect(() => fixture.coordinator.resume(waitingReview, {
      stage: "writing",
      message: "Wrong proposal resolved.",
      proof: {
        kind: "review_resolved",
        proposalId: "proposal_20260716_other000",
        operationId: "op_20260716_review0001"
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const resumedReview = fixture.coordinator.resume(waitingReview, {
      stage: "writing",
      message: "Proposal resolved.",
      proof: {
        kind: "review_resolved",
        proposalId: "proposal_20260716_abcdef12",
        operationId: "op_20260716_review0001"
      }
    });
    expect(resumedReview.job).toMatchObject({
      state: "running",
      operationIds: [
        "op_20260716_dependency01",
        "op_20260716_egress0001",
        "op_20260716_review0001"
      ]
    });
  });

  it("completes or fails running jobs with owned finished and retry projections", () => {
    const completedFixture = makeFixture();
    const completed = completedFixture.coordinator.settle(
      completedFixture.coordinator.begin(completedFixture.create(), {
        stage: "writing",
        message: "Writing."
      }),
      {
        kind: "completed",
        result: "completed_with_warnings",
        message: "Completed with one warning.",
        facts: { warnings: [warning()] }
      }
    ).job;
    expect(completed).toMatchObject({
      state: "completed_with_warnings",
      finishedAt: CLOCK_AT,
      updatedAt: CLOCK_AT,
      warnings: [{ code: "agent_runtime.output_partial" }]
    });

    const retryFixture = makeFixture(1);
    const retryable = retryFixture.coordinator.settle(
      retryFixture.coordinator.begin(retryFixture.create(), {
        stage: "planning",
        message: "Planning."
      }),
      {
        kind: "requeue",
        error: retryableError(),
        reason: "provider timeout before durable output",
        maxAutomaticRetries: 2,
        nextRetryAt: "2026-07-16T08:05:00.000Z",
        message: "The provider is temporarily unavailable."
      }
    ).job;
    expect(retryable).toMatchObject({
      state: "failed_retryable",
      retry: {
        retryCount: 0,
        maxAutomaticRetries: 2,
        lastRetryReason: "provider timeout before durable output"
      }
    });
    expect(retryable.finishedAt).toBeUndefined();

    const finalFixture = makeFixture(2);
    const final = finalFixture.coordinator.settle(
      finalFixture.coordinator.begin(finalFixture.create(), {
        stage: "writing",
        message: "Writing."
      }),
      {
        kind: "failed",
        error: finalError(),
        message: "The input cannot be processed."
      }
    ).job;
    expect(final).toMatchObject({ state: "failed_final", finishedAt: CLOCK_AT });
  });

  it("keeps terminal records byte-for-byte immutable", () => {
    const fixture = makeFixture();
    const terminal = fixture.coordinator.settle(
      fixture.coordinator.begin(fixture.create(), { stage: "planning", message: "Planning." }),
      { kind: "completed", message: "Completed." }
    );
    const before = fs.readFileSync(fixture.jobPath);

    expect(() => fixture.coordinator.begin(terminal, {
      stage: "planning",
      message: "Run again."
    })).toThrowError(expect.objectContaining({ code: "job.terminal_immutable" }));
    expect(() => fixture.coordinator.patch(terminal, {
      message: "Changed."
    })).toThrowError(expect.objectContaining({ code: "job.terminal_immutable" }));
    expect(() => fixture.coordinator.settle(terminal, {
      kind: "completed",
      message: "Changed again."
    })).toThrowError(expect.objectContaining({ code: "job.terminal_immutable" }));
    expect(fs.readFileSync(fixture.jobPath)).toEqual(before);
  });

  it("allows exactly one CAS winner under stale-snapshot contention", () => {
    const fixture = makeFixture();
    const queued = fixture.create();
    const contender = fixture.store.read(fixture.jobPath);

    const winner = fixture.coordinator.begin(queued, {
      stage: "planning",
      message: "Winner started."
    });
    expect(() => fixture.coordinator.begin(contender, {
      stage: "retrieving",
      message: "Loser started."
    })).toThrowError(expect.objectContaining({ code: "job.revision_conflict" }));
    expect(fixture.store.read(fixture.jobPath).job).toEqual(winner.job);
  });

  it("projects cancellation before and after the durable boundary without false clean cancellation", () => {
    const cleanFixture = makeFixture();
    const cleanRequested = cleanFixture.coordinator.requestCancellation(
      cleanFixture.coordinator.begin(cleanFixture.create(), {
        stage: "writing",
        message: "Preparing output."
      }),
      { requestedBy: "user", message: "Cancellation requested." }
    );
    const cleanOutcome = cleanFixture.coordinator.cancellationOutcome(cleanRequested, {
      cancelledMessage: "Cancelled before durable output.",
      preservedResultMessage: "Durable output was preserved."
    }).job;
    expect(cleanOutcome).toMatchObject({
      state: "cancelled",
      cancellation: { requestedBy: "user", durableWritesApplied: false },
      finishedAt: CLOCK_AT
    });

    const durableFixture = makeFixture(1);
    const guarded = durableFixture.coordinator.markDurableBoundary(
      durableFixture.coordinator.begin(durableFixture.create(), {
        stage: "writing",
        message: "Writing output."
      }),
      { checkpointId: "page_publication_started" }
    );
    const lateRequested = durableFixture.coordinator.requestCancellation(guarded, {
      requestedBy: "user",
      message: "Cancellation requested."
    });
    const durableOutcome = durableFixture.coordinator.cancellationOutcome(lateRequested, {
      cancelledMessage: "Cancelled.",
      preservedResultMessage: "Durable output committed before cancellation; result preserved.",
      facts: { operationIds: ["op_20260716_abcdef12"] }
    }).job;
    expect(durableOutcome).toMatchObject({
      state: "completed_with_warnings",
      cancellation: {
        requestedBy: "user",
        safeCheckpointId: "page_publication_started",
        durableWritesApplied: true
      },
      operationIds: ["op_20260716_abcdef12"],
      message: "Durable output committed before cancellation; result preserved."
    });
  });

  it("rejects body-bearing or retry-inconsistent failure summaries without changing the record", () => {
    const fixture = makeFixture();
    const running = fixture.coordinator.begin(fixture.create(), {
      stage: "planning",
      message: "Planning."
    });
    const before = fs.readFileSync(fixture.jobPath);

    expect(() => fixture.coordinator.settle(running, {
      kind: "requeue",
      error: { ...retryableError(), body: "raw provider response" } as never,
      reason: "timeout",
      maxAutomaticRetries: 1,
      message: "Failed."
    })).toThrow();
    expect(() => fixture.coordinator.settle(running, {
      kind: "failed",
      error: retryableError(),
      message: "Failed."
    })).toThrowError(expect.objectContaining({ code: "job.failure_invalid" }));
    expect(fs.readFileSync(fixture.jobPath)).toEqual(before);
    expect(JSON.stringify(fixture.store.read(fixture.jobPath).job)).not.toContain("raw provider response");
  });
});

function makeFixture(index = 0): {
  root: string;
  jobsRoot: string;
  jobId: string;
  jobPath: string;
  store: JobRecordStore;
  coordinator: JobExecutionCoordinator;
  create(job?: JobRecord): JobRecordSnapshot;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-coordinator-"));
  tempRoots.push(root);
  const jobsRoot = path.join(root, "jobs");
  fs.mkdirSync(jobsRoot);
  const jobId = `job_20260716_abcdef${String(index).padStart(6, "0")}`;
  const jobPath = path.join(jobsRoot, "2026", "07", `${jobId}.json`);
  const store = new JobRecordStore({ rootPath: jobsRoot, unsafeAllowUnfenced: true });
  const coordinator = new JobExecutionCoordinator(store, {
    now: () => new Date(CLOCK_AT)
  });
  return {
    root,
    jobsRoot,
    jobId,
    jobPath,
    store,
    coordinator,
    create: (job = makeJob(jobId)) => store.createIfAbsent(jobPath, job)
  };
}

function makeJob(jobId: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: jobId,
    class: "agent_turn",
    state: "queued",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    message: "Queued.",
    ...overrides
  });
}

function dependency(): NonNullable<JobRecord["waitingDependency"]> {
  return {
    dependencyKind: "model_provider",
    dependencyId: "provider_test",
    requiredAction: "configure_model",
    messageKey: "jobs.waiting.configure_model"
  };
}

function retryableError(): NonNullable<JobRecord["error"]> {
  return {
    code: "model_provider.unavailable",
    domain: "model_provider",
    messageKey: "errors.model_provider.unavailable",
    retryable: true,
    severity: "error",
    userAction: "configure_model"
  };
}

function permissionError(): NonNullable<JobRecord["error"]> {
  return {
    code: "permission.required",
    domain: "permission",
    messageKey: "errors.permission.required",
    retryable: true,
    severity: "warning",
    userAction: "grant_permission"
  };
}

function egressError(): NonNullable<JobRecord["error"]> {
  return {
    code: "agent_runtime.model_egress_confirmation_required",
    domain: "agent_runtime",
    messageKey: "errors.agent_runtime.model_egress_confirmation_required",
    retryable: true,
    severity: "warning",
    userAction: "confirm_model_egress"
  };
}

function finalError(): NonNullable<JobRecord["error"]> {
  return {
    code: "agent_runtime.input_invalid",
    domain: "agent_runtime",
    messageKey: "errors.agent_runtime.input_invalid",
    retryable: false,
    severity: "error",
    userAction: "none"
  };
}

function warning(): NonNullable<JobRecord["warnings"]>[number] {
  return {
    code: "agent_runtime.output_partial",
    domain: "agent_runtime",
    messageKey: "errors.agent_runtime.output_partial"
  };
}

function sha256(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
