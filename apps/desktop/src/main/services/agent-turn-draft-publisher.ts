import type { AgentTurnDraftEvent } from "@pige/contracts";
import type { HomeAgentDraftSnapshot } from "./home-agent-service";

const DEFAULT_MIN_INTERVAL_MS = 80;
const MAX_DRAFT_CHARACTERS = 8_000;
const MAX_BINDING_CHARACTERS = 256;

export interface AgentTurnDraftPublisherOptions {
  readonly clientTurnId: string | undefined;
  readonly send: (event: AgentTurnDraftEvent) => void;
  readonly minIntervalMs?: number;
}

export class AgentTurnDraftPublisher {
  readonly #clientTurnId: string | undefined;
  readonly #send: (event: AgentTurnDraftEvent) => void;
  readonly #minIntervalMs: number;
  #closed = false;
  #lastSentAt = Number.NEGATIVE_INFINITY;
  #lastText: string | undefined;
  #binding: Omit<HomeAgentDraftSnapshot, "text"> | undefined;
  #pending: HomeAgentDraftSnapshot | undefined;
  #sequence = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: AgentTurnDraftPublisherOptions) {
    this.#clientTurnId = options.clientTurnId;
    this.#send = options.send;
    const requestedInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.#minIntervalMs = Number.isFinite(requestedInterval) && requestedInterval >= 1
      ? Math.trunc(requestedInterval)
      : DEFAULT_MIN_INTERVAL_MS;
  }

  publish(snapshot: HomeAgentDraftSnapshot): void {
    if (
      this.#closed ||
      !this.#clientTurnId ||
      snapshot.clientTurnId !== this.#clientTurnId ||
      !isValidSnapshot(snapshot) ||
      !this.#matchesBinding(snapshot) ||
      snapshot.text === this.#pending?.text
    ) {
      return;
    }
    if (snapshot.text === this.#lastText) {
      this.#pending = undefined;
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = undefined;
      return;
    }
    const now = Date.now();
    const remaining = this.#minIntervalMs - (now - this.#lastSentAt);
    if (remaining <= 0) {
      this.#emit(snapshot, now);
      return;
    }
    this.#pending = snapshot;
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      const pending = this.#pending;
      this.#pending = undefined;
      if (pending && !this.#closed) this.#emit(pending, Date.now());
    }, remaining);
  }

  close(): void {
    this.#closed = true;
    this.#pending = undefined;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #emit(snapshot: HomeAgentDraftSnapshot, sentAt: number): void {
    this.#lastSentAt = sentAt;
    this.#lastText = snapshot.text;
    this.#sequence += 1;
    try {
      this.#send({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: snapshot.requestId,
        clientTurnId: snapshot.clientTurnId,
        jobId: snapshot.jobId,
        conversationId: snapshot.conversationId,
        conversationEventId: snapshot.conversationEventId,
        sequence: this.#sequence,
        text: snapshot.text
      });
    } catch {
      this.close();
    }
  }

  #matchesBinding(snapshot: HomeAgentDraftSnapshot): boolean {
    if (!this.#binding) {
      const { text: _text, ...binding } = snapshot;
      this.#binding = binding;
      return true;
    }
    return snapshot.requestId === this.#binding.requestId &&
      snapshot.clientTurnId === this.#binding.clientTurnId &&
      snapshot.jobId === this.#binding.jobId &&
      snapshot.conversationId === this.#binding.conversationId &&
      snapshot.conversationEventId === this.#binding.conversationEventId;
  }
}

function isValidSnapshot(snapshot: HomeAgentDraftSnapshot): boolean {
  return isBoundedIdentifier(snapshot.requestId) &&
    isBoundedIdentifier(snapshot.clientTurnId) &&
    isBoundedIdentifier(snapshot.jobId) &&
    isBoundedIdentifier(snapshot.conversationId) &&
    isBoundedIdentifier(snapshot.conversationEventId) &&
    Array.from(snapshot.text).length > 0 &&
    Array.from(snapshot.text).length <= MAX_DRAFT_CHARACTERS &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(snapshot.text);
}

function isBoundedIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_BINDING_CHARACTERS;
}
