import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import type {
  PermissionCapability,
  PermissionDataBoundary,
  PermissionResourceScope
} from "@pige/schemas";
import type {
  PermissionedExternalCapabilityAdapter,
  PermissionedExternalReviewedPlanBinding
} from "./permissioned-external-capability-service";
import { assertPermissionedExternalExecutionAuthority } from "./permissioned-external-capability-service";
import { createPigeTextToolResult } from "./pi-agent-tool-boundary";
import {
  TaskProcessSessionService,
  type TaskProcessSessionRequest
} from "./task-process-session-service";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface TaskExecutionPlanCapabilityMetadata {
  readonly planId: string;
  readonly jobId: string;
  readonly stepOrdinal: number;
  readonly planDigest: `sha256:${string}`;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: `sha256:${string}`;
  readonly actionId: string;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly capability: PermissionCapability;
  readonly dataBoundary: PermissionDataBoundary;
  readonly resourceScope: PermissionResourceScope;
  readonly readOnlyProbe: boolean;
}

export interface TaskExecutionPlanCapabilityRegistration {
  readonly metadata: TaskExecutionPlanCapabilityMetadata;
  readonly process: TaskProcessSessionRequest;
  readonly sessions: TaskProcessSessionService;
  readonly assertAuthority: PermissionedExternalReviewedPlanBinding["assertAuthority"];
}

/**
 * Bridges one already-reviewed immutable plan ordinal into the ordinary external-tool
 * registry. The model supplies no executable or arguments; those stay captured in the
 * registered process request and are revalidated by the process-session owner.
 */
export function createTaskExecutionPlanCapabilityAdapter(
  registration: TaskExecutionPlanCapabilityRegistration
): PermissionedExternalCapabilityAdapter {
  const metadata = normalizeMetadata(registration.metadata);
  assertProcessMatchesMetadata(metadata, registration.process);
  if (!(registration.sessions instanceof TaskProcessSessionService) || typeof registration.assertAuthority !== "function") {
    throw planAdapterError();
  }
  return {
    tool: {
      name: metadata.toolName,
      label: metadata.toolLabel,
      description: metadata.readOnlyProbe
        ? "Runs the exact registered read-only probe for the current reviewed task plan."
        : "Runs the exact next registered step of the current reviewed task plan.",
      parameters: strictObjectSchema({}, []),
      outputSchema: strictObjectSchema({
        status: { enum: ["completed", "failed", "timed_out", "interaction_pending"] },
        stdout: { type: "string", maxLength: 262_144 },
        stderr: { type: "string", maxLength: 262_144 },
        exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
        signal: { anyOf: [{ type: "string" }, { type: "null" }] },
        outputBytes: { type: "integer", minimum: 0, maximum: 262_144 },
        truncated: { type: "boolean" }
      }, ["status", "stdout", "stderr", "exitCode", "signal", "outputBytes", "truncated"]),
      effect: metadata.readOnlyProbe ? "read_only" : "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "none",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: metadata.readOnlyProbe ? "parallel_read_only" : "sequential",
      idempotency: metadata.readOnlyProbe
        ? { mode: "idempotent", scope: "tool_call" }
        : { mode: "idempotent", scope: "tool_call" },
      limits: {
        maxInputBytes: 2,
        maxOutputBytes: 270_336,
        timeoutMs: registration.process.command.timeoutMs
      },
      ownerService: "TaskExecutionPlanService"
    },
    actor: {
      type: "local_tool",
      id: metadata.adapterId,
      displayName: metadata.toolLabel,
      version: metadata.adapterVersion,
      digest: metadata.adapterDigest
    },
    action: {
      id: metadata.actionId,
      version: metadata.adapterVersion,
      labelKey: "permissions.actions.reviewed_task_plan"
    },
    permission: {
      capability: metadata.capability,
      dataBoundary: metadata.dataBoundary,
      resourceScope: metadata.resourceScope,
      reasonCode: "task_execution_plan.registered_step"
    },
    reviewedPlan: {
      planId: metadata.planId,
      jobId: metadata.jobId,
      stepOrdinal: metadata.stepOrdinal,
      planDigest: metadata.planDigest,
      readOnlyProbe: metadata.readOnlyProbe,
      assertAuthority: registration.assertAuthority
    },
    normalizeInput: (input) => exactEmptyInput(input),
    resourceIdentity: () => ({
      planId: metadata.planId,
      jobId: metadata.jobId,
      stepOrdinal: metadata.stepOrdinal,
      planDigest: metadata.planDigest,
      adapterId: metadata.adapterId,
      adapterVersion: metadata.adapterVersion,
      adapterDigest: metadata.adapterDigest,
      actionId: metadata.actionId,
      executableIdentity: registration.process.command.executableIdentity,
      argvHash: hash(registration.process.command.args),
      workingDirectoryHash: hash(registration.process.command.workingDirectory),
      environmentHash: hash(registration.process.environment),
      readOnlyProbe: metadata.readOnlyProbe
    }),
    resourceDisplayName: () => metadata.toolLabel,
    resourceCount: () => 1,
    execute: async (_input, signal, _context, authority) => {
      assertPermissionedExternalExecutionAuthority(authority, metadata.capability);
      const result = await registration.sessions.run(registration.process, signal);
      const details = Object.freeze({ ...result });
      return createPigeTextToolResult(JSON.stringify(details), details);
    },
    adoptCompleted: async (_completionMarkerHash, _input, signal) => {
      signal.throwIfAborted();
      throw new PigeDomainError(
        "task_execution_plan.adoption_requires_owner",
        "The reviewed task plan owner must prove the exact interrupted step before adoption."
      );
    }
  };
}

function normalizeMetadata(value: TaskExecutionPlanCapabilityMetadata): TaskExecutionPlanCapabilityMetadata {
  if (
    !value ||
    !/^plan_[a-f0-9]{32}$/u.test(value.planId) ||
    !/^job_\d{8}_[a-z0-9]{8,}$/u.test(value.jobId) ||
    !Number.isInteger(value.stepOrdinal) || value.stepOrdinal < 1 || value.stepOrdinal > 8 ||
    !SHA256_PATTERN.test(value.planDigest) ||
    !/^[a-z][a-z0-9_.:-]{2,127}$/u.test(value.adapterId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(value.adapterVersion) ||
    !SHA256_PATTERN.test(value.adapterDigest) ||
    !/^[a-z][a-z0-9_.:-]{2,127}$/u.test(value.actionId) ||
    !/^[a-z][a-z0-9_]{2,63}$/u.test(value.toolName) ||
    typeof value.toolLabel !== "string" || value.toolLabel.trim() !== value.toolLabel || value.toolLabel.length < 1 || value.toolLabel.length > 80 ||
    typeof value.readOnlyProbe !== "boolean"
  ) throw planAdapterError();
  return Object.freeze({ ...value });
}

function assertProcessMatchesMetadata(
  metadata: TaskExecutionPlanCapabilityMetadata,
  process: TaskProcessSessionRequest
): void {
  if (
    !process ||
    process.planId !== metadata.planId ||
    process.jobId !== metadata.jobId ||
    process.stepOrdinal !== metadata.stepOrdinal
  ) throw planAdapterError();
}

function exactEmptyInput(value: unknown): Readonly<Record<string, never>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw planAdapterError();
  }
  return Object.freeze({});
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function planAdapterError(): PigeDomainError {
  return new PigeDomainError(
    "task_execution_plan.capability_invalid",
    "The reviewed task execution capability is invalid."
  );
}
