import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AgentTurnAnswer } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { ConversationEvent } from "@pige/schemas";

const MAX_TURN_TEXT_BYTES = 64 * 1024;

export interface DurableAssistantPayload {
  readonly text: string;
  readonly structured: boolean;
  readonly grounding?: AgentTurnAnswer["grounding"];
  readonly citations?: AgentTurnAnswer["citations"];
  readonly datasetResult?: AgentTurnAnswer["datasetResult"];
}

export function readDurableAgentTurnAnswer(event: ConversationEvent): AgentTurnAnswer {
  const normalized = normalizeDurableAssistantEvent(event);
  const answer: AgentTurnAnswer = {
    answer: normalized.text,
    grounding: normalized.grounding ?? "general",
    citations: normalized.citations ?? [],
    ...(normalized.datasetResult === undefined ? {} : { datasetResult: normalized.datasetResult })
  };
  assertDurableAssistantIntegrity(event);
  return answer;
}

export function normalizeDurableAssistantEvent(event: ConversationEvent): DurableAssistantPayload {
  if (event.type !== "assistant_message" || typeof event.text !== "string") {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The durable assistant result is invalid.");
  }
  const structured =
    event.answerGrounding !== undefined ||
    event.answerCitations !== undefined ||
    event.answerDatasetResult !== undefined;
  if (structured && event.answerGrounding === undefined) {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The durable assistant result metadata is incomplete.");
  }
  return {
    text: validateAnswerText(event.text),
    structured,
    ...(event.answerGrounding === undefined ? {} : { grounding: event.answerGrounding }),
    ...(event.answerCitations === undefined ? {} : { citations: event.answerCitations }),
    ...(event.answerDatasetResult === undefined ? {} : { datasetResult: event.answerDatasetResult })
  };
}

export function assertDurableAssistantIntegrity(event: ConversationEvent): void {
  if (event.type !== "assistant_message" || !event.contentHash) return;
  if (!event.jobId || !event.parentEventId) {
    throw new PigeDomainError("agent_runtime.turn_changed", "The durable assistant result changed after completion.");
  }
  const answer = normalizeDurableAssistantEvent(event);
  const hashVersion = answer.datasetResult === undefined ? "v1" : "v2";
  const expected = hashValue(
    `pige.agent_assistant.${hashVersion}\0${event.jobId}\0${event.parentEventId}\0${JSON.stringify({
      text: answer.text,
      grounding: answer.structured ? answer.grounding : null,
      citations: answer.structured ? answer.citations : null,
      ...(answer.datasetResult === undefined ? {} : { datasetResult: answer.datasetResult })
    })}`
  );
  if (event.contentHash !== expected) {
    throw new PigeDomainError("agent_runtime.turn_changed", "The durable assistant result changed after completion.");
  }
}

function validateAnswerText(value: string): string {
  const text = value.trim();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_TURN_TEXT_BYTES || /\u0000/u.test(text)) {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The durable assistant result is invalid.");
  }
  return text;
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
