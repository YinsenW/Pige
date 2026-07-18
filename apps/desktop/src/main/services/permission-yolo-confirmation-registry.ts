import { randomBytes } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { PermissionYoloConfirmationTokenSchema } from "@pige/schemas";

const DEFAULT_TTL_MS = 120_000;
const MAX_TOKENS_PER_SENDER = 4;

interface ConfirmationRecord {
  readonly senderId: number;
  readonly expectedRevision: number;
  readonly expiresAtMs: number;
}

export interface PermissionYoloConfirmation {
  readonly confirmationToken: string;
  readonly expiresAt: string;
}

export class PermissionYoloConfirmationRegistry {
  readonly #records = new Map<string, ConfirmationRecord>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(now: () => number = Date.now, ttlMs = DEFAULT_TTL_MS) {
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  issue(senderId: number, expectedRevision: number): PermissionYoloConfirmation {
    this.#purgeExpired();
    const senderTokens = [...this.#records.entries()]
      .filter(([, record]) => record.senderId === senderId)
      .sort((left, right) => left[1].expiresAtMs - right[1].expiresAtMs);
    while (senderTokens.length >= MAX_TOKENS_PER_SENDER) {
      const oldest = senderTokens.shift();
      if (oldest) this.#records.delete(oldest[0]);
    }
    const now = this.#now();
    const token = PermissionYoloConfirmationTokenSchema.parse(
      `permyolo_${new Date(now).toISOString().slice(0, 10).replaceAll("-", "")}_${randomBytes(16).toString("hex")}`
    );
    const expiresAtMs = now + this.#ttlMs;
    this.#records.set(token, { senderId, expectedRevision, expiresAtMs });
    return { confirmationToken: token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  consume(senderId: number, expectedRevision: number, confirmationToken: string): void {
    this.#purgeExpired();
    const record = this.#records.get(confirmationToken);
    this.#records.delete(confirmationToken);
    if (
      !record ||
      record.senderId !== senderId ||
      record.expectedRevision !== expectedRevision ||
      record.expiresAtMs <= this.#now()
    ) {
      throw new PigeDomainError(
        "permission.yolo_confirmation_invalid",
        "YOLO confirmation is missing, stale, expired, or already consumed."
      );
    }
  }

  clearSender(senderId: number): void {
    for (const [token, record] of this.#records) {
      if (record.senderId === senderId) this.#records.delete(token);
    }
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [token, record] of this.#records) {
      if (record.expiresAtMs <= now) this.#records.delete(token);
    }
  }
}
