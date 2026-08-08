import { createHash } from "node:crypto";
import type { AgentTurnAnswer } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  AgentTurnAnswerSchema,
  JobCheckpointSchema,
  type JobCheckpoint,
  type JobRecord
} from "@pige/schemas";
import { z } from "zod";
import type { PiAgentRunResult } from "./pi-agent-runtime-adapter";

export const AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID = "agent_turn_provider_call_completed";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const ProviderEventRecordSchema = z.object({
  type: z.string().min(1).max(120),
  toolName: z.string().min(1).max(160).optional(),
  isError: z.boolean().optional()
}).strict();
const ProviderRunResultSchema = z.object({
  adapterMode: z.literal("embedded_pi_sdk"),
  providerProfileId: z.string().min(1).max(256),
  modelProfileId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
  events: z.array(ProviderEventRecordSchema).max(512),
  assistantText: z.string().trim().min(1).max(8_000),
  invokedTools: z.array(z.string().min(1).max(160)).max(64)
}).strict();
const AgentTurnProviderContinuationSchema = z.object({
  answer: AgentTurnAnswerSchema,
  sourceIds: z.array(z.string().min(1).max(256)).max(64)
}).strict();

const ProviderCallBindingSchema = z.object({
  jobId: z.string().min(1).max(200),
  conversationEventId: z.string().regex(/^evt_[0-9]{8}_[a-z0-9]{8,}$/u),
  inputHash: Sha256Schema,
  conversationContextHash: Sha256Schema,
  toolCatalogHash: Sha256Schema,
  contextPackHash: Sha256Schema.optional(),
  providerProfileId: z.string().min(1).max(256),
  modelProfileId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256)
}).strict();

const StoredProviderCallSchema = z.object({
  schemaVersion: z.literal(1),
  state: z.enum(["started", "completed"]),
  binding: ProviderCallBindingSchema,
  result: ProviderRunResultSchema.optional(),
  resultHash: Sha256Schema.optional(),
  continuation: AgentTurnProviderContinuationSchema.optional(),
  continuationHash: Sha256Schema.optional()
}).strict().superRefine((value, context) => {
  if (value.state === "completed" && (!value.result || !value.resultHash || !value.continuation || !value.continuationHash)) {
    context.addIssue({ code: "custom", message: "A completed provider checkpoint must retain its result, continuation, and hashes." });
  }
  if (value.state === "started" && (value.result || value.resultHash || value.continuation || value.continuationHash)) {
    context.addIssue({ code: "custom", message: "A started provider checkpoint must not retain a provider result or continuation." });
  }
});

const AgentTurnProviderCheckpointSchema = JobCheckpointSchema.extend({
  id: z.literal(AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID),
  step: z.literal(AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID),
  state: z.enum(["running", "done"]),
  providerCall: StoredProviderCallSchema
}).passthrough();

export interface AgentTurnProviderCallBinding {
  readonly jobId: string;
  readonly conversationEventId: string;
  readonly inputHash: string;
  readonly conversationContextHash: string;
  readonly toolCatalogHash: string;
  readonly contextPackHash?: string;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly modelId: string;
}

export interface AgentTurnProviderContinuation {
  readonly answer: AgentTurnAnswer;
  readonly sourceIds: readonly string[];
}

export interface AgentTurnProviderCheckpointPort {
  readonly begin: (expected: JobRecord, binding: AgentTurnProviderCallBinding) => JobRecord;
  readonly checkpoint: (
    expected: JobRecord,
    input: AgentTurnProviderCallBinding & {
      readonly result: PiAgentRunResult;
      readonly continuation: AgentTurnProviderContinuation;
    }
  ) => JobRecord;
  readonly read: (
    job: JobRecord,
    binding: AgentTurnProviderCallBinding
  ) => AgentTurnProviderAdoption | undefined;
}

export function createAgentTurnProviderCallBinding(input: {
  readonly jobId: string;
  readonly conversationEventId: string;
  readonly inputHash: string;
  readonly conversationContextHash: string;
  readonly toolCatalogHash: string;
  readonly contextPackHash?: string;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly modelId: string;
}): AgentTurnProviderCallBinding {
  return {
    ...input,
    ...(input.contextPackHash ? { contextPackHash: input.contextPackHash } : {})
  };
}

export function createAndAdoptAgentTurnProviderCall(input: {
  readonly port: AgentTurnProviderCheckpointPort;
  readonly current: JobRecord;
  readonly jobId: string;
  readonly conversationEventId: string;
  readonly inputHash: string;
  readonly conversationContextHash: string;
  readonly toolCatalogHash: string;
  readonly contextPackHash?: string;
  readonly providerProfileId: string;
  readonly modelProfileId: string;
  readonly modelId: string;
}): {
  readonly binding: AgentTurnProviderCallBinding;
  readonly job: JobRecord;
  readonly adoption?: AgentTurnProviderAdoption;
} {
  const binding = createAgentTurnProviderCallBinding(input);
  return { binding, ...adoptOrBeginAgentTurnProviderCall({ ...input, binding }) };
}

export function createAgentTurnAnswer(input: {
  readonly groundedAnswer: AgentTurnAnswer;
  readonly retrieval?: AgentTurnAnswer["retrieval"];
  readonly datasetResult?: AgentTurnAnswer["datasetResult"];
  readonly memoryCount: number;
}): AgentTurnAnswer {
  return {
    ...input.groundedAnswer,
    ...(input.retrieval ? { retrieval: input.retrieval } : {}),
    ...(input.datasetResult ? { datasetResult: input.datasetResult } : {}),
    ...(input.memoryCount > 0 ? { memoryContext: { kind: "vault_memory", count: input.memoryCount } } : {})
  };
}

export function adoptOrBeginAgentTurnProviderCall(input: {
  readonly port: AgentTurnProviderCheckpointPort;
  readonly current: JobRecord;
  readonly binding: AgentTurnProviderCallBinding;
}): { readonly job: JobRecord; readonly adoption?: AgentTurnProviderAdoption } {
  const adoption = input.port.read(input.current, input.binding);
  return adoption
    ? { job: input.current, adoption }
    : { job: input.port.begin(input.current, input.binding) };
}

export function checkpointAgentTurnProviderCall(input: {
  readonly port: AgentTurnProviderCheckpointPort;
  readonly current: JobRecord;
  readonly binding: AgentTurnProviderCallBinding;
  readonly result: PiAgentRunResult;
  readonly continuation: AgentTurnProviderContinuation;
}): JobRecord {
  return input.port.checkpoint(input.current, {
    ...input.binding,
    providerProfileId: input.result.providerProfileId,
    modelProfileId: input.result.modelProfileId,
    modelId: input.result.modelId,
    result: input.result,
    continuation: input.continuation
  });
}

export interface AgentTurnProviderAdoption extends AgentTurnProviderContinuation {
  readonly result: PiAgentRunResult;
}

export type AgentTurnProviderCheckpoint = JobCheckpoint & {
  readonly id: typeof AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID;
  readonly step: typeof AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID;
} & ({
  readonly state: "running";
  readonly providerCall: {
    readonly schemaVersion: 1;
    readonly state: "started";
    readonly binding: AgentTurnProviderCallBinding;
  };
} | {
  readonly state: "done";
  readonly providerCall: {
    readonly schemaVersion: 1;
    readonly state: "completed";
    readonly binding: AgentTurnProviderCallBinding;
    readonly result: PiAgentRunResult;
    readonly resultHash: string;
    readonly continuation: AgentTurnProviderContinuation;
    readonly continuationHash: string;
  };
});

export function createAgentTurnProviderCheckpoint(input: {
  readonly job: JobRecord;
  readonly binding: AgentTurnProviderCallBinding;
  readonly result: PiAgentRunResult;
  readonly continuation: AgentTurnProviderContinuation;
  readonly startedAt?: string;
  readonly now?: string;
}): AgentTurnProviderCheckpoint {
  const binding = ProviderCallBindingSchema.parse(input.binding);
  if (binding.jobId !== input.job.id) {
    throw providerCheckpointChanged("The provider checkpoint Job identity is not current.");
  }
  const result = ProviderRunResultSchema.parse(input.result) as PiAgentRunResult;
  if (
    result.providerProfileId !== binding.providerProfileId ||
    result.modelProfileId !== binding.modelProfileId ||
    result.modelId !== binding.modelId
  ) {
    throw providerCheckpointChanged("The completed Pi provider result does not match its selected binding.");
  }
  const continuation = AgentTurnProviderContinuationSchema.parse(input.continuation) as AgentTurnProviderContinuation;
  const resultHash = hashValue(result);
  const continuationHash = hashValue(continuation);
  const now = input.now ?? new Date().toISOString();
  return AgentTurnProviderCheckpointSchema.parse({
    id: AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID,
    step: AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID,
    state: "done",
    startedAt: input.startedAt ?? now,
    finishedAt: now,
    inputRefs: [
      {
        kind: "conversation",
        id: binding.conversationEventId,
        checksum: binding.inputHash,
        role: "agent_turn_provider_call_input"
      },
      {
        kind: "tool",
        id: "agent_turn_provider_context",
        checksum: binding.conversationContextHash,
        role: "agent_turn_provider_context"
      },
      {
        kind: "tool",
        id: "agent_turn_provider_catalog",
        checksum: binding.toolCatalogHash,
        role: "agent_turn_provider_catalog"
      },
      ...(binding.contextPackHash ? [{
        kind: "tool" as const,
        id: "agent_turn_provider_context_pack",
        checksum: binding.contextPackHash,
        role: "agent_turn_provider_context_pack"
      }] : [])
    ],
    outputRefs: [{
      kind: "tool",
      id: "agent_turn_provider_result",
      checksum: resultHash,
      role: "agent_turn_provider_transcript"
    }, {
      kind: "tool",
      id: "agent_turn_assistant_continuation",
      checksum: continuationHash,
      role: "agent_turn_assistant_continuation"
    }],
    checksumAfter: continuationHash,
    resumeHint: "Adopt the exact completed provider transcript only when the Job, turn, context, catalog, and provider binding still match.",
    providerCall: {
      schemaVersion: 1,
      state: "completed",
      binding,
      result,
      resultHash,
      continuation,
      continuationHash
    }
  }) as AgentTurnProviderCheckpoint;
}

export function createStartedAgentTurnProviderCheckpoint(input: {
  readonly job: JobRecord;
  readonly binding: AgentTurnProviderCallBinding;
  readonly now?: string;
}): AgentTurnProviderCheckpoint {
  const binding = ProviderCallBindingSchema.parse(input.binding);
  const now = input.now ?? new Date().toISOString();
  return AgentTurnProviderCheckpointSchema.parse({
    id: AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID,
    step: AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID,
    state: "running",
    startedAt: now,
    inputRefs: [
      {
        kind: "conversation",
        id: binding.conversationEventId,
        checksum: binding.inputHash,
        role: "agent_turn_provider_call_input"
      },
      {
        kind: "tool",
        id: "agent_turn_provider_context",
        checksum: binding.conversationContextHash,
        role: "agent_turn_provider_context"
      },
      {
        kind: "tool",
        id: "agent_turn_provider_catalog",
        checksum: binding.toolCatalogHash,
        role: "agent_turn_provider_catalog"
      },
      ...(binding.contextPackHash ? [{
        kind: "tool" as const,
        id: "agent_turn_provider_context_pack",
        checksum: binding.contextPackHash,
        role: "agent_turn_provider_context_pack"
      }] : [])
    ],
    outputRefs: [],
    resumeHint: "The provider call was started but its result was not durably committed; fail closed without replay.",
    providerCall: {
      schemaVersion: 1,
      state: "started",
      binding
    }
  }) as AgentTurnProviderCheckpoint;
}

export function assertAgentTurnProviderCheckpointBinding(
  job: JobRecord,
  bindingInput: AgentTurnProviderCallBinding
): AgentTurnProviderCheckpoint | undefined {
  const matches = (job.checkpoints ?? []).filter(
    (checkpoint) => checkpoint.id === AGENT_TURN_PROVIDER_CALL_CHECKPOINT_ID
  );
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) {
    throw providerCheckpointChanged("The Agent Job contains an ambiguous provider checkpoint.");
  }
  const parsed = AgentTurnProviderCheckpointSchema.safeParse(matches[0]);
  if (!parsed.success) {
    throw providerCheckpointChanged("The provider checkpoint is not valid durable state.");
  }
  const binding = ProviderCallBindingSchema.parse(bindingInput);
  if (binding.jobId !== job.id) {
    throw providerCheckpointChanged("The provider checkpoint Job identity is not current.");
  }
  if (JSON.stringify(parsed.data.providerCall.binding) !== JSON.stringify(binding)) {
    throw providerCheckpointChanged("The provider checkpoint no longer matches the exact Agent turn.");
  }
  return parsed.data as AgentTurnProviderCheckpoint;
}

export function readAgentTurnProviderCheckpoint(
  job: JobRecord,
  bindingInput: AgentTurnProviderCallBinding
): AgentTurnProviderAdoption | undefined {
  const parsed = assertAgentTurnProviderCheckpointBinding(job, bindingInput);
  if (!parsed) return undefined;
  if (
    parsed.state !== "done" ||
    parsed.providerCall.state !== "completed" ||
    !parsed.providerCall.result ||
    !parsed.providerCall.resultHash ||
    !parsed.providerCall.continuation ||
    !parsed.providerCall.continuationHash
  ) {
    throw providerCheckpointChanged("The provider call completed state is uncertain; replay is forbidden.");
  }
  const stored = parsed.providerCall;
  if (
    stored.result.providerProfileId !== bindingInput.providerProfileId ||
    stored.result.modelProfileId !== bindingInput.modelProfileId ||
    stored.result.modelId !== bindingInput.modelId ||
    stored.resultHash !== hashValue(stored.result) ||
    stored.continuationHash !== hashValue(stored.continuation)
  ) {
    throw providerCheckpointChanged("The completed provider checkpoint no longer matches the exact Agent turn.");
  }
  return {
    result: stored.result as PiAgentRunResult,
    ...stored.continuation
  };
}

function hashValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function providerCheckpointChanged(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_changed", message);
}
