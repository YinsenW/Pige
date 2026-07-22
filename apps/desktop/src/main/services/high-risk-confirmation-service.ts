import type {
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationOwner,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  HighRiskConfirmationSummary
} from "@pige/contracts";
import {
  HighRiskConfirmationChangedEventSchema,
  HighRiskConfirmationPendingResultSchema,
  HighRiskConfirmationResolveRequestSchema,
  HighRiskConfirmationResolveResultSchema,
  HighRiskConfirmationSummarySchema
} from "@pige/schemas";

export type HighRiskConfirmationEffectResult = "committed" | "stale" | "failed";
export type HighRiskConfirmationEffectResolver = (
  decision: "allow" | "deny"
) => HighRiskConfirmationEffectResult | Promise<HighRiskConfirmationEffectResult>;

export type HighRiskConfirmationRegistration = Omit<
  HighRiskConfirmationSummary,
  "apiVersion"
>;

export type HighRiskConfirmationRegistrationResult =
  | { readonly status: "registered"; readonly revision: number; readonly confirmation: HighRiskConfirmationSummary }
  | { readonly status: "restored"; readonly revision: number; readonly confirmation: HighRiskConfirmationSummary }
  | { readonly status: "busy"; readonly revision: number; readonly confirmation: HighRiskConfirmationSummary }
  | {
      readonly status: "already_resolved";
      readonly revision: number;
      readonly decision: "allow" | "deny";
    };

interface PendingEffect {
  readonly confirmation: HighRiskConfirmationSummary;
  readonly revision: number;
  resolver: HighRiskConfirmationEffectResolver;
}

interface ResolutionReceipt {
  readonly confirmationId: string;
  readonly revision: number;
  readonly decision: "allow" | "deny";
}

interface InFlightResolution {
  readonly confirmationId: string;
  readonly revision: number;
  readonly decision: "allow" | "deny";
  readonly promise: Promise<HighRiskConfirmationResolveResult>;
}

export interface HighRiskConfirmationWithdrawal {
  readonly confirmationId: string;
  readonly expectedRevision: number;
  readonly owner: HighRiskConfirmationOwner;
}

export type HighRiskConfirmationWithdrawalResult = "withdrawn" | "stale" | "not_found" | "resolving";

const MAX_RECEIPTS = 64;

export class HighRiskConfirmationService {
  #revision = 0;
  #pending: PendingEffect | undefined;
  #inFlight: InFlightResolution | undefined;
  readonly #receipts = new Map<string, ResolutionReceipt>();
  readonly #listeners = new Set<(event: HighRiskConfirmationChangedEvent) => void>();

  pending(): HighRiskConfirmationPendingResult {
    return HighRiskConfirmationPendingResultSchema.parse(this.#pending
      ? {
          apiVersion: 1,
          status: "pending",
          revision: this.#pending.revision,
          confirmation: this.#pending.confirmation
        }
      : { apiVersion: 1, status: "none", revision: this.#revision });
  }

  register(
    registration: HighRiskConfirmationRegistration,
    resolver: HighRiskConfirmationEffectResolver
  ): HighRiskConfirmationRegistrationResult {
    const receipt = this.#receipts.get(registration.confirmationId);
    if (receipt) {
      return { status: "already_resolved", revision: receipt.revision, decision: receipt.decision };
    }
    if (this.#pending) {
      if (this.#sameRegistration(this.#pending.confirmation, registration)) {
        if (this.#inFlight) {
          return { status: "busy", revision: this.#pending.revision, confirmation: this.#pending.confirmation };
        }
        this.#pending.resolver = resolver;
        return { status: "restored", revision: this.#pending.revision, confirmation: this.#pending.confirmation };
      }
      return { status: "busy", revision: this.#pending.revision, confirmation: this.#pending.confirmation };
    }

    const confirmation = HighRiskConfirmationSummarySchema.parse({
      apiVersion: 1,
      ...registration
    });
    this.#revision += 1;
    this.#pending = { confirmation, revision: this.#revision, resolver };
    this.#emit();
    return { status: "registered", revision: this.#revision, confirmation };
  }

  async resolve(request: HighRiskConfirmationResolveRequest): Promise<HighRiskConfirmationResolveResult> {
    const parsed = HighRiskConfirmationResolveRequestSchema.parse(request);
    const receipt = this.#receipts.get(parsed.confirmationId);
    if (receipt) {
      if (receipt.decision !== parsed.decision) {
        return HighRiskConfirmationResolveResultSchema.parse({
          apiVersion: 1,
          status: "stale",
          current: this.pending()
        });
      }
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "already_resolved",
        ...receipt
      });
    }

    const pending = this.#pending;
    if (!pending || pending.confirmation.confirmationId !== parsed.confirmationId) {
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "not_found",
        revision: this.#revision
      });
    }
    if (parsed.expectedRevision !== pending.revision) {
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "stale",
        current: this.pending()
      });
    }

    const inFlight = this.#inFlight;
    if (inFlight) {
      if (
        inFlight.confirmationId === parsed.confirmationId &&
        inFlight.revision === parsed.expectedRevision &&
        inFlight.decision === parsed.decision
      ) {
        return inFlight.promise;
      }
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "stale",
        current: this.pending()
      });
    }

    const promise = Promise.resolve().then(() => this.#executeResolution(pending, parsed));
    this.#inFlight = {
      confirmationId: parsed.confirmationId,
      revision: parsed.expectedRevision,
      decision: parsed.decision,
      promise
    };
    try {
      return await promise;
    } finally {
      if (this.#inFlight?.promise === promise) this.#inFlight = undefined;
    }
  }

  withdraw(request: HighRiskConfirmationWithdrawal): HighRiskConfirmationWithdrawalResult {
    const pending = this.#pending;
    if (!pending || pending.confirmation.confirmationId !== request.confirmationId) return "not_found";
    if (
      pending.revision !== request.expectedRevision ||
      JSON.stringify(pending.confirmation.owner) !== JSON.stringify(request.owner)
    ) return "stale";
    if (this.#inFlight) return "resolving";
    this.#pending = undefined;
    this.#revision += 1;
    this.#emit();
    return "withdrawn";
  }

  async #executeResolution(
    pending: PendingEffect,
    parsed: HighRiskConfirmationResolveRequest
  ): Promise<HighRiskConfirmationResolveResult> {

    let outcome: HighRiskConfirmationEffectResult;
    try {
      outcome = await pending.resolver(parsed.decision);
    } catch {
      outcome = "failed";
    }
    if (outcome === "failed") {
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "failed",
        confirmationId: parsed.confirmationId,
        revision: this.#revision
      });
    }
    if (this.#pending !== pending) {
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "stale",
        current: this.pending()
      });
    }

    this.#pending = undefined;
    this.#revision += 1;
    if (outcome === "stale") {
      this.#emit();
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1,
        status: "stale",
        current: this.pending()
      });
    }

    const terminal = {
      confirmationId: parsed.confirmationId,
      revision: this.#revision,
      decision: parsed.decision
    } satisfies ResolutionReceipt;
    this.#remember(terminal);
    this.#emit();
    return HighRiskConfirmationResolveResultSchema.parse({
      apiVersion: 1,
      status: "committed",
      ...terminal
    });
  }

  onChanged(listener: (event: HighRiskConfirmationChangedEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #sameRegistration(
    current: HighRiskConfirmationSummary,
    next: HighRiskConfirmationRegistration
  ): boolean {
    return current.confirmationId === next.confirmationId &&
      current.effect === next.effect &&
      JSON.stringify(current.presentation) === JSON.stringify(next.presentation) &&
      JSON.stringify(current.owner) === JSON.stringify(next.owner);
  }

  #remember(receipt: ResolutionReceipt): void {
    this.#receipts.set(receipt.confirmationId, receipt);
    const oldest = this.#receipts.keys().next().value as string | undefined;
    if (this.#receipts.size > MAX_RECEIPTS && oldest) this.#receipts.delete(oldest);
  }

  #emit(): void {
    const event = HighRiskConfirmationChangedEventSchema.parse(this.pending());
    for (const listener of this.#listeners) listener(event);
  }
}
