import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";

export type AgentRepairCategory =
  | "schema_invalid"
  | "tool_input_invalid"
  | "citation_invalid"
  | "grounding_invalid"
  | "evidence_stale"
  | "result_incomplete";

export interface AgentRepairFeedback {
  readonly apiVersion: 1;
  readonly kind: "repair_required";
  readonly category: AgentRepairCategory;
  readonly fieldRefs: readonly string[];
  readonly allowedOpaqueRefs: readonly string[];
  readonly repairHintKey: string;
  readonly failureFingerprint: string;
}

export interface PiAgentCompletionBoundary {
  readonly terminalToolNames: readonly string[];
  readonly maxWallTimeMs: number;
  readonly maxToolCalls: number;
  readonly maxWorkBytes: number;
  readonly maxRepeatedFailureFingerprints: number;
}

export class AgentRepairRequiredError extends Error {
  readonly feedback: AgentRepairFeedback;

  constructor(feedback: AgentRepairFeedback) {
    super(JSON.stringify(feedback));
    this.name = "AgentRepairRequiredError";
    this.feedback = feedback;
  }
}

export function createAgentRepairFeedback(input: {
  readonly category: AgentRepairCategory;
  readonly fieldRefs?: readonly string[];
  readonly allowedOpaqueRefs?: readonly string[];
  readonly repairHintKey: string;
  readonly progressFingerprint?: unknown;
}): AgentRepairFeedback {
  const fieldRefs = normalizeRepairRefs(input.fieldRefs ?? [], 16);
  const allowedOpaqueRefs = normalizeRepairRefs(input.allowedOpaqueRefs ?? [], 32);
  const fingerprint = createHash("sha256")
    .update(input.category, "utf8")
    .update("\0", "utf8")
    .update(stableFingerprintValue(input.progressFingerprint), "utf8")
    .digest("hex");
  return Object.freeze({
    apiVersion: 1,
    kind: "repair_required",
    category: input.category,
    failureFingerprint: fingerprint,
    fieldRefs,
    allowedOpaqueRefs,
    repairHintKey: normalizeRepairHintKey(input.repairHintKey)
  });
}

export class PiCompletionPolicy {
  readonly #boundary: PiAgentCompletionBoundary | undefined;
  readonly #startedAt = Date.now();
  readonly #failureCounts = new Map<string, number>();
  readonly #repairCategories = new Set<AgentRepairCategory>();
  #toolCalls = 0;
  #workBytes = 0;
  #acceptedTerminal = false;
  #blockedTerminal = false;
  #hostSettled = false;
  #fatalFailure: PigeDomainError | undefined;

  constructor(
    boundary: PiAgentCompletionBoundary | undefined,
    registeredToolNames: readonly string[]
  ) {
    this.#boundary = validateBoundary(boundary, registeredToolNames);
  }

  recordToolCall(toolName: string, args: unknown): void {
    if (!this.#boundary) return;
    this.#toolCalls += 1;
    this.#workBytes += Buffer.byteLength(toolName, "utf8") + boundedJsonByteLength(args);
    this.#assertBudget();
  }

  recordRepair(feedback: AgentRepairFeedback): void {
    if (!this.#boundary) return;
    this.#repairCategories.add(feedback.category);
    this.#workBytes += Buffer.byteLength(JSON.stringify(feedback), "utf8");
    const count = (this.#failureCounts.get(feedback.failureFingerprint) ?? 0) + 1;
    this.#failureCounts.set(feedback.failureFingerprint, count);
    if (count > this.#boundary.maxRepeatedFailureFingerprints) {
      this.#fail("Pi repeated the same invalid completion without observable repair progress.");
    }
    this.#assertBudget();
  }

  recordTerminalAccepted(toolName: string): void {
    if (this.#boundary?.terminalToolNames.includes(toolName)) this.#acceptedTerminal = true;
  }

  recordTerminalBlocked(toolName: string): void {
    if (this.#boundary?.terminalToolNames.includes(toolName)) this.#blockedTerminal = true;
  }

  recordHostSettled(): void {
    this.#hostSettled = true;
  }

  assertCanContinue(): void {
    if (!this.#boundary) return;
    this.#assertBudget();
    if (this.#fatalFailure) throw this.#fatalFailure;
  }

  assertCompleted(): void {
    if (!this.#boundary) return;
    this.assertCanContinue();
    if (!this.terminalSettled()) {
      throw new PigeDomainError(
        "agent_runtime.knowledge_action_missing",
        "The Pi Agent turn ended without a validated terminal action."
      );
    }
  }

  repairAttempted(): boolean {
    return this.#failureCounts.size > 0;
  }

  shouldReportProtocolOnFauxExhaustion(): boolean {
    return [...this.#repairCategories].some((category) =>
      category === "schema_invalid" ||
      category === "citation_invalid" ||
      category === "grounding_invalid" ||
      category === "evidence_stale"
    );
  }

  terminalAccepted(): boolean {
    return this.#acceptedTerminal;
  }

  terminalSettled(): boolean {
    return this.#acceptedTerminal || this.#blockedTerminal || this.#hostSettled;
  }

  #assertBudget(): void {
    if (!this.#boundary || this.#fatalFailure) return;
    if (
      Date.now() - this.#startedAt > this.#boundary.maxWallTimeMs ||
      this.#toolCalls > this.#boundary.maxToolCalls ||
      this.#workBytes > this.#boundary.maxWorkBytes
    ) {
      this.#fail("Pi exceeded the bounded autonomous completion work budget.");
    }
  }

  #fail(message: string): void {
    this.#fatalFailure ??= new PigeDomainError("model_provider.tool_protocol_incompatible", message);
  }
}

function validateBoundary(
  boundary: PiAgentCompletionBoundary | undefined,
  registeredToolNames: readonly string[]
): PiAgentCompletionBoundary | undefined {
  if (!boundary) return undefined;
  const terminalToolNames = Array.from(new Set(boundary.terminalToolNames));
  const registered = new Set(registeredToolNames);
  if (
    terminalToolNames.length === 0 || terminalToolNames.length > 16 ||
    terminalToolNames.some((name) => !registered.has(name)) ||
    !boundedInteger(boundary.maxWallTimeMs, 1_000, 600_000) ||
    !boundedInteger(boundary.maxToolCalls, 1, 256) ||
    !boundedInteger(boundary.maxWorkBytes, 4_096, 1_048_576) ||
    !boundedInteger(boundary.maxRepeatedFailureFingerprints, 1, 16)
  ) {
    throw new PigeDomainError(
      "agent_runtime.completion_repair_invalid",
      "The bounded autonomous completion repair contract is invalid."
    );
  }
  return Object.freeze({ ...boundary, terminalToolNames });
}

function normalizeRepairRefs(values: readonly string[], limit: number): readonly string[] {
  const normalized = Array.from(new Set(values.map((value) => value.trim()))).sort();
  if (normalized.length > limit || normalized.some((value) => !/^[A-Za-z0-9_.:-]{1,128}$/u.test(value))) {
    throw new PigeDomainError("agent_runtime.repair_feedback_invalid", "The internal repair references are invalid.");
  }
  return Object.freeze(normalized);
}

function normalizeRepairHintKey(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_.-]{2,127}$/u.test(normalized)) {
    throw new PigeDomainError("agent_runtime.repair_feedback_invalid", "The internal repair hint is invalid.");
  }
  return normalized;
}

function stableFingerprintValue(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
    }) ?? typeof value;
  } catch {
    return typeof value;
  }
}

function boundedJsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(stableFingerprintValue(value), "utf8");
  } catch {
    return 1_048_577;
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
