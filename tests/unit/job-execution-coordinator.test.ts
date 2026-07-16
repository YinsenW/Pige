import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobRecordSchema, type JobRecord, type JobState } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  JobExecutionCoordinator,
  isLegalJobStateTransition,
  isTerminalJobState,
  type JobExecutionOutcome
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
    expect(isLegalJobStateTransition("queued", "cancelled")).toBe(true);
    expect(isLegalJobStateTransition("waiting_dependency", "cancelled")).toBe(true);
    expect(isLegalJobStateTransition("waiting_permission", "failed_final")).toBe(true);
    expect(isLegalJobStateTransition("waiting_model_egress", "failed_retryable")).toBe(true);
    expect(isLegalJobStateTransition("queued", "waiting_dependency")).toBe(true);
    expect(isLegalJobStateTransition("queued", "failed_final")).toBe(true);
    expect(isLegalJobStateTransition("queued", "completed")).toBe(false);
    for (const state of outcomeStates) expect(isLegalJobStateTransition("running", state)).toBe(true);
    for (const state of [
      "completed_with_warnings",
      "failed_retryable",
      "cancelled"
    ] satisfies JobState[]) {
      expect(isLegalJobStateTransition("cancel_requested", state)).toBe(true);
    }
    for (const state of [
      "completed",
      "failed_final",
      "waiting_dependency",
      "waiting_permission",
      "waiting_model_egress",
      "awaiting_review"
    ] satisfies JobState[]) {
      expect(isLegalJobStateTransition("cancel_requested", state)).toBe(false);
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
        dependency: { ...dependency(), dependencyId: "provider_other" }
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const resumedDependency = fixture.coordinator.resume(waitingDependency, {
      stage: "planning",
      message: "Model configured.",
      proof: {
        kind: "dependency_repaired",
        dependency: dependency()
      }
    });
    expect(resumedDependency.job.operationIds).toBeUndefined();
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
      warnings: [{ code: "agent_runtime.output_partial" }]
    });
    expect(Date.parse(completed.updatedAt)).toBeGreaterThan(Date.parse(CLOCK_AT));
    expect(completed.finishedAt).toBe(completed.updatedAt);

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
    expect(final.state).toBe("failed_final");
    expect(Date.parse(final.updatedAt)).toBeGreaterThan(Date.parse(CLOCK_AT));
    expect(final.finishedAt).toBe(final.updatedAt);
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

  it("prepares explicit same-Job retries with a strictly newer revision", () => {
    const fixture = makeFixture();
    const retryable = fixture.coordinator.settle(
      fixture.coordinator.begin(fixture.create(), { stage: "planning", message: "Planning." }),
      {
        kind: "requeue",
        error: retryableError(),
        reason: "provider timeout",
        maxAutomaticRetries: 0,
        requiresUserAction: true,
        message: "Retry explicitly."
      }
    );
    const queued = fixture.coordinator.prepareRetry(retryable, { message: "Retry queued." });
    expect(queued.job).toMatchObject({ id: retryable.job.id, state: "queued", message: "Retry queued." });
    expect(Date.parse(queued.job.updatedAt)).toBeGreaterThan(Date.parse(retryable.job.updatedAt));
    expect(queued.job.error).toBeUndefined();
    expect(queued.job.progress).toBeUndefined();
  });

  it("queues only explicit dependency, recovery, and Agent continuation commands", () => {
    const dependencyFixture = makeFixture();
    const waiting = dependencyFixture.coordinator.settle(
      dependencyFixture.coordinator.begin(dependencyFixture.create(), {
        stage: "waiting_for_model",
        message: "Waiting."
      }),
      {
        kind: "waiting",
        reason: "dependency",
        dependency: dependency(),
        message: "Configure a model."
      }
    );
    expect(() => dependencyFixture.coordinator.queue(waiting, {
      reason: "dependency_repaired",
      clearStage: true,
      message: "Missing proof."
    } as never)).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    expect(() => dependencyFixture.coordinator.queue(waiting, {
      reason: "dependency_repaired",
      clearStage: true,
      message: "Mismatched proof.",
      proof: {
        kind: "dependency_repaired",
        dependency: { ...dependency(), dependencyId: "provider_other" }
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const queued = dependencyFixture.coordinator.queue(waiting, {
      reason: "dependency_repaired",
      clearStage: true,
      message: "Dependency repaired.",
      proof: {
        kind: "dependency_repaired",
        dependency: dependency()
      }
    }).job;
    expect(queued).toMatchObject({
      state: "queued",
      message: "Dependency repaired."
    });
    expect(queued.stage).toBeUndefined();
    expect(queued.waitingDependency).toBeUndefined();
    expect(Date.parse(queued.updatedAt)).toBeGreaterThan(Date.parse(waiting.job.updatedAt));

    const sourceFixture = makeFixture(7);
    const sourceWaiting = sourceFixture.create(makeJob(sourceFixture.jobId, {
      state: "waiting_dependency",
      stage: "capturing_source",
      sourceId: "src_20260716_abcdef12",
      conversationEventId: "evt_20260716_abcdef12",
      message: "Waiting for source preservation."
    }));
    expect(() => sourceFixture.coordinator.queue(sourceWaiting, {
      reason: "source_preserved",
      message: "Wrong source.",
      proof: {
        kind: "source_preserved",
        sourceId: "src_20260716_other123",
        conversationEventId: "evt_20260716_abcdef12"
      }
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));
    const sourceQueued = sourceFixture.coordinator.queue(sourceWaiting, {
      reason: "source_preserved",
      clearStage: true,
      message: "Source preservation completed.",
      proof: {
        kind: "source_preserved",
        sourceId: "src_20260716_abcdef12",
        conversationEventId: "evt_20260716_abcdef12"
      }
    }).job;
    expect(sourceQueued).toMatchObject({ state: "queued", sourceId: "src_20260716_abcdef12" });
    expect(sourceQueued.stage).toBeUndefined();

    const continuationFixture = makeFixture(1);
    const running = continuationFixture.coordinator.begin(continuationFixture.create(), {
      stage: "writing",
      message: "Writing."
    });
    const continued = continuationFixture.coordinator.queue(running, {
      reason: "agent_continuation",
      stage: "planning",
      message: "Continue the same Agent turn."
    }).job;
    expect(continued).toMatchObject({ state: "queued", stage: "planning" });

    const cancelledFixture = makeFixture(2);
    const cancellationRequested = cancelledFixture.coordinator.requestCancellation(
      cancelledFixture.coordinator.begin(cancelledFixture.create(), {
        stage: "planning",
        message: "Planning."
      }),
      { requestedBy: "user", message: "Cancel." }
    );
    expect(() => cancelledFixture.coordinator.queue(cancellationRequested, {
      reason: "agent_continuation",
      message: "Must not continue."
    })).toThrowError(expect.objectContaining({ code: "job.cancellation_pending" }));
  });

  it("recovers interrupted jobs through one queued-or-retryable owner", () => {
    const idempotentFixture = makeFixture();
    const running = idempotentFixture.coordinator.begin(idempotentFixture.create(), {
      stage: "parsing",
      message: "Parsing."
    });
    const queued = idempotentFixture.coordinator.recoverInterrupted(running, {
      canResumeIdempotently: true,
      queuedMessage: "Requeued after restart.",
      retryableMessage: "Retry explicitly."
    }).job;
    expect(queued).toMatchObject({ state: "queued", message: "Requeued after restart." });
    expect(queued.stage).toBeUndefined();

    const uncertainFixture = makeFixture(1);
    const requested = uncertainFixture.coordinator.requestCancellation(
      uncertainFixture.coordinator.begin(uncertainFixture.create(), {
        stage: "writing",
        message: "Writing."
      }),
      { requestedBy: "user", message: "Cancellation requested." }
    );
    const cancelled = uncertainFixture.coordinator.recoverInterrupted(requested, {
      canResumeIdempotently: false,
      queuedMessage: "Do not queue.",
      retryableMessage: "Retry explicitly after restart."
    }).job;
    expect(cancelled).toMatchObject({
      state: "cancelled",
      cancellation: { requestedBy: "user", durableWritesApplied: false }
    });
  });

  it("fails closed after an uncertain durable effect without permitting replay", () => {
    const fixture = makeFixture();
    const running = fixture.coordinator.begin(fixture.create(), {
      stage: "writing",
      message: "Publishing output."
    });
    const failed = fixture.coordinator.terminalizeUncertainEffect(running, {
      checkpointId: "publication_started",
      error: finalError(),
      reason: "publication_acknowledgement_missing",
      message: "The durable result could not be verified.",
      facts: { operationIds: ["op_20260716_abcdef12"] }
    });

    expect(failed.job).toMatchObject({
      state: "failed_final",
      operationIds: ["op_20260716_abcdef12"],
      cancellation: {
        safeCheckpointId: "publication_started",
        durableWritesApplied: true
      },
      retry: {
        maxAutomaticRetries: 0,
        requiresUserAction: false,
        lastRetryReason: "publication_acknowledgement_missing"
      }
    });
    expect(() => fixture.coordinator.prepareRetry(failed, {
      message: "Must not replay an uncertain effect."
    })).toThrowError(expect.objectContaining({ code: "job.terminal_immutable" }));
  });

  it("adopts a proven durable completion without beginning another execution", () => {
    const fixture = makeFixture();
    const queued = fixture.create();

    expect(() => fixture.coordinator.adoptDurableCompletion(queued, {
      checkpointId: "assistant_event_committed",
      message: "Recovered.",
      facts: { operationIds: ["op_20260716_abcdef12"] }
    })).toThrowError(expect.objectContaining({ code: "job.recovery_proof_invalid" }));

    const completed = fixture.coordinator.adoptDurableCompletion(queued, {
      checkpointId: "assistant_event_committed",
      message: "Recovered from the durable assistant event.",
      facts: {
        outputRefs: [{ kind: "conversation", id: "conversation_20260716_abcdef12" }],
        operationIds: ["op_20260716_abcdef12"]
      }
    });

    expect(completed.job).toMatchObject({
      state: "completed",
      outputRefs: [{ kind: "conversation", id: "conversation_20260716_abcdef12" }],
      cancellation: {
        safeCheckpointId: "assistant_event_committed",
        durableWritesApplied: true
      }
    });
    expect(completed.job.startedAt).toBeUndefined();
    expect(completed.job.finishedAt).toBe(completed.job.updatedAt);

    const cancellationRace = makeCancellationRace(1, false);
    const preserved = cancellationRace.fixture.coordinator.adoptDurableCompletion(
      cancellationRace.requested,
      {
        checkpointId: "assistant_event_committed",
        message: "Recovered durable output after cancellation was requested.",
        facts: {
          outputRefs: [{ kind: "conversation", id: "conversation_20260716_abcdef12" }],
          operationIds: ["op_20260716_abcdef12"]
        }
      }
    ).job;
    expect(preserved).toMatchObject({
      state: "completed_with_warnings",
      outputRefs: [{ kind: "conversation", id: "conversation_20260716_abcdef12" }],
      cancellation: {
        requestedBy: "user",
        safeCheckpointId: "assistant_event_committed",
        durableWritesApplied: true
      }
    });
  });

  it("resolves only the exact bound review and leaves the terminal result immutable", () => {
    const fixture = makeFixture();
    const awaitingReview = fixture.coordinator.settle(
      fixture.coordinator.begin(fixture.create(), {
        stage: "writing",
        message: "Preparing proposal."
      }),
      {
        kind: "waiting",
        reason: "review",
        proposalId: "proposal_20260716_abcdef12",
        message: "Review the proposal."
      }
    );

    expect(() => fixture.coordinator.resolveReview(awaitingReview, {
      proposalId: "proposal_20260716_other000",
      result: "completed",
      message: "Wrong proposal."
    })).toThrowError(expect.objectContaining({ code: "job.resume_proof_invalid" }));

    const completed = fixture.coordinator.resolveReview(awaitingReview, {
      proposalId: "proposal_20260716_abcdef12",
      result: "completed_with_warnings",
      message: "Proposal applied with a warning.",
      facts: {
        operationIds: ["op_20260716_review0001"],
        warnings: [warning()]
      }
    });
    expect(completed.job).toMatchObject({
      state: "completed_with_warnings",
      operationIds: ["op_20260716_review0001"],
      warnings: [{ code: "agent_runtime.output_partial" }]
    });
    expect(() => fixture.coordinator.resolveReview(completed, {
      proposalId: "proposal_20260716_abcdef12",
      result: "completed",
      message: "Must remain terminal."
    })).toThrowError(expect.objectContaining({ code: "job.terminal_immutable" }));
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
    const pendingFixture = makeFixture(2);
    const pendingOutcome = pendingFixture.coordinator.cancelPending(pendingFixture.create(), {
      requestedBy: "user",
      safeCheckpointId: "before_execution",
      message: "Cancelled before execution."
    }).job;
    expect(pendingOutcome).toMatchObject({
      state: "cancelled",
      cancellation: {
        requestedBy: "user",
        safeCheckpointId: "before_execution",
        durableWritesApplied: false
      }
    });

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
      cancellation: { requestedBy: "user", durableWritesApplied: false }
    });
    expect(cleanOutcome.finishedAt).toBe(cleanOutcome.updatedAt);

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
      durableResultComplete: true,
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

    const guardedPendingFixture = makeFixture(3);
    const guardedPending = guardedPendingFixture.create(makeJob(guardedPendingFixture.jobId, {
      state: "failed_retryable",
      cancellation: {
        safeCheckpointId: "publication_started",
        durableWritesApplied: true
      }
    }));
    expect(() => guardedPendingFixture.coordinator.cancelPending(guardedPending, {
      requestedBy: "user",
      safeCheckpointId: "before_execution",
      message: "Cancelled."
    })).toThrowError(expect.objectContaining({ code: "job.cancellation_unsafe" }));
  });

  it("projects every late wait or failure to clean cancellation when no durable effect exists", () => {
    for (const [index, outcome] of lateNonCompletionOutcomes().entries()) {
      const race = makeCancellationRace(index, false);
      const projected = race.fixture.coordinator.settle(race.requested, outcome).job;

      expect(projected).toMatchObject({
        state: "cancelled",
        cancellation: { requestedBy: "user", durableWritesApplied: false }
      });
      expect(projected.waitingDependency).toBeUndefined();
      expect(projected.error).toBeUndefined();
      expect(projected.finishedAt).toBe(projected.updatedAt);
    }

    const unprovenCompletionRace = makeCancellationRace(18, false);
    const unprovenCompletion = unprovenCompletionRace.fixture.coordinator.settle(
      unprovenCompletionRace.requested,
      {
        kind: "completed",
        message: "An unproven completion arrived after cancellation.",
        facts: { outputRefs: [{ kind: "page", id: "page_01" }] }
      }
    ).job;
    expect(unprovenCompletion).toMatchObject({
      state: "cancelled",
      cancellation: { durableWritesApplied: false }
    });
    expect(unprovenCompletion.outputRefs).toBeUndefined();
  });

  it("fails closed for late partial outcomes and preserves only proven complete durable output", () => {
    for (const [index, outcome] of lateNonCompletionOutcomes().entries()) {
      const race = makeCancellationRace(index, true);
      const projected = race.fixture.coordinator.settle(race.requested, outcome).job;

      expect(projected).toMatchObject({
        state: "failed_retryable",
        cancellation: {
          requestedBy: "user",
          safeCheckpointId: "publication_started",
          durableWritesApplied: true
        },
        retry: {
          maxAutomaticRetries: 0,
          requiresUserAction: true,
          lastRetryReason: "job.cancelled_after_durable_output"
        }
      });
      expect(projected.waitingDependency).toBeUndefined();
      expect(projected.finishedAt).toBeUndefined();
    }

    const uncertainRace = makeCancellationRace(19, false);
    const uncertain = uncertainRace.fixture.coordinator.terminalizeUncertainEffect(
      uncertainRace.requested,
      {
        checkpointId: "publication_acknowledgement_missing",
        error: finalError(),
        reason: "publication_acknowledgement_missing",
        message: "Durable publication could not be verified after cancellation."
      }
    ).job;
    expect(uncertain).toMatchObject({
      state: "failed_retryable",
      cancellation: {
        requestedBy: "user",
        safeCheckpointId: "publication_acknowledgement_missing",
        durableWritesApplied: true
      },
      retry: {
        maxAutomaticRetries: 0,
        requiresUserAction: true,
        lastRetryReason: "job.cancelled_after_durable_output"
      }
    });

    const completeRace = makeCancellationRace(20, true);
    const completed = completeRace.fixture.coordinator.settle(completeRace.requested, {
      kind: "completed",
      message: "Durable output completed while cancellation was in flight.",
      facts: { outputRefs: [{ kind: "page", id: "page_01" }] }
    }).job;
    expect(completed).toMatchObject({
      state: "completed_with_warnings",
      outputRefs: [{ kind: "page", id: "page_01" }],
      cancellation: {
        requestedBy: "user",
        safeCheckpointId: "publication_started",
        durableWritesApplied: true
      }
    });
    expect(completed.finishedAt).toBe(completed.updatedAt);
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

  it("keeps JobsService free of direct lifecycle-state writers", () => {
    const source = fs.readFileSync(path.resolve(
      "apps/desktop/src/main/services/jobs-service.ts"
    ), "utf8");
    expect(source).not.toMatch(
      /state:\s*"(?:waiting_permission|waiting_model_egress|awaiting_review|cancel_requested|cancelled|completed|completed_with_warnings|failed_retryable|failed_final)"/u
    );
    expect(source).not.toContain("#mutateJob(");
    expect(source).not.toContain("#replaceExpectedJob(");
    expect(source).not.toContain("createJobCancellationOutcome(");
    expect(source).not.toContain("withDurableWriteState(");
    expect(source.match(/compareAndSwap\(/gu)).toHaveLength(2);
  });
});

function makeCancellationRace(index: number, durableWritesApplied: boolean): {
  fixture: ReturnType<typeof makeFixture>;
  requested: JobRecordSnapshot;
} {
  const fixture = makeFixture(index);
  let running = fixture.coordinator.begin(fixture.create(), {
    stage: "writing",
    message: "Publishing output."
  });
  if (durableWritesApplied) {
    running = fixture.coordinator.markDurableBoundary(running, {
      checkpointId: "publication_started"
    });
  }
  return {
    fixture,
    requested: fixture.coordinator.requestCancellation(running, {
      requestedBy: "user",
      message: "Cancellation requested."
    })
  };
}

function lateNonCompletionOutcomes(): JobExecutionOutcome[] {
  return [
    {
      kind: "waiting",
      reason: "dependency",
      dependency: dependency(),
      error: retryableError(),
      message: "Late dependency wait."
    },
    {
      kind: "waiting",
      reason: "permission",
      permissionRequestId: "permreq_20260716_abcdef12",
      error: permissionError(),
      message: "Late permission wait."
    },
    {
      kind: "waiting",
      reason: "model_egress",
      approvalRequestId: "egressreq_20260716_abcdef1234567890",
      error: egressError(),
      message: "Late model-egress wait."
    },
    {
      kind: "waiting",
      reason: "review",
      proposalId: "proposal_20260716_abcdef12",
      message: "Late review wait."
    },
    {
      kind: "requeue",
      error: retryableError(),
      reason: "late_retryable_failure",
      maxAutomaticRetries: 3,
      message: "Late retryable failure."
    },
    {
      kind: "failed",
      error: finalError(),
      message: "Late final failure."
    }
  ];
}

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
