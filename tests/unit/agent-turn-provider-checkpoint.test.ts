import { describe, expect, it } from "vitest";
import {
  createAgentTurnProviderCheckpoint,
  createStartedAgentTurnProviderCheckpoint,
  readAgentTurnProviderCheckpoint,
  type AgentTurnProviderCallBinding
} from "../../apps/desktop/src/main/services/agent-turn-provider-checkpoint";
import type { PiAgentRunResult } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import type { JobRecord } from "@pige/schemas";

const binding: AgentTurnProviderCallBinding = {
  jobId: "job_20260808_providercontinuation01",
  conversationEventId: "evt_20260808_providercontinuation01",
  inputHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  conversationContextHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  toolCatalogHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  contextPackHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  providerProfileId: "provider_deepseek",
  modelProfileId: "model_deepseek_chat",
  modelId: "deepseek-chat"
};

const result: PiAgentRunResult = {
  adapterMode: "embedded_pi_sdk",
  providerProfileId: binding.providerProfileId,
  modelProfileId: binding.modelProfileId,
  modelId: binding.modelId,
  events: [
    { type: "message_start" },
    { type: "message_end" }
  ],
  assistantText: "The exact completed answer.",
  invokedTools: []
};

const continuation = {
  answer: {
    answer: result.assistantText,
    grounding: "general" as const,
    citations: []
  },
  sourceIds: [] as readonly string[]
};

function jobWithCheckpoint(checkpoint: NonNullable<JobRecord["checkpoints"]>[number]): JobRecord {
  return {
    id: binding.jobId,
    class: "agent_turn",
    state: "queued",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:01.000Z",
    message: "Provider continuation fixture.",
    checkpoints: [checkpoint]
  } as JobRecord;
}

describe("Agent turn provider checkpoint", () => {
  it("fails closed when restart sees a provider call without a durable result", () => {
    const started = createStartedAgentTurnProviderCheckpoint({
      job: jobWithCheckpoint({
        id: "placeholder",
        step: "placeholder",
        state: "not_started",
        inputRefs: [],
        outputRefs: []
      }),
      binding,
      now: "2026-08-08T00:00:02.000Z"
    });
    const job = jobWithCheckpoint(started);

    expect(started.state).toBe("running");
    expect(() => readAgentTurnProviderCheckpoint(job, binding)).toThrowError(
      expect.objectContaining({ code: "agent_runtime.turn_changed" })
    );
  });

  it("adopts one exact completed provider transcript and rejects binding drift or duplicate records", () => {
    const completed = createAgentTurnProviderCheckpoint({
      job: jobWithCheckpoint({
        id: "placeholder",
        step: "placeholder",
        state: "not_started",
        inputRefs: [],
        outputRefs: []
      }),
      binding,
      result,
      continuation,
      startedAt: "2026-08-08T00:00:02.000Z",
      now: "2026-08-08T00:00:03.000Z"
    });
    const job = jobWithCheckpoint(completed);

    expect(readAgentTurnProviderCheckpoint(job, binding)).toEqual({ result, ...continuation });
    expect(() => readAgentTurnProviderCheckpoint(job, {
      ...binding,
      modelId: "different-model"
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_changed" }));
    expect(() => readAgentTurnProviderCheckpoint({
      ...job,
      checkpoints: [completed, completed]
    }, binding)).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_changed" }));
  });

  it("rejects a tampered final result instead of replaying or publishing it", () => {
    const completed = createAgentTurnProviderCheckpoint({
      job: jobWithCheckpoint({
        id: "placeholder",
        step: "placeholder",
        state: "not_started",
        inputRefs: [],
        outputRefs: []
      }),
      binding,
      result,
      continuation
    });
    const tampered = {
      ...completed,
      providerCall: {
        ...completed.providerCall,
        result: { ...completed.providerCall.result, assistantText: "tampered" }
      }
    } as typeof completed;

    expect(() => readAgentTurnProviderCheckpoint(jobWithCheckpoint(tampered), binding)).toThrowError(
      expect.objectContaining({ code: "agent_runtime.turn_changed" })
    );

    const tamperedContinuation = {
      ...completed,
      providerCall: {
        ...completed.providerCall,
        continuation: {
          ...completed.providerCall.continuation,
          answer: { ...completed.providerCall.continuation.answer, answer: "tampered" }
        }
      }
    } as typeof completed;
    expect(() => readAgentTurnProviderCheckpoint(jobWithCheckpoint(tamperedContinuation), binding)).toThrowError(
      expect.objectContaining({ code: "agent_runtime.turn_changed" })
    );
  });
});
