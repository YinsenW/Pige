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
  HighRiskConfirmationResolveResultSchema
} from "@pige/schemas";
import {
  PermissionPolicyRuntimeState,
  type PermissionPolicyRuntimeCommit,
  type PermissionPolicyRecordLinkPort,
  type PermissionPolicyRuntimePending
} from "./permission-policy-runtime";
import type { PermissionPolicyStorePort } from "./permission-policy-store";

export type HighRiskConfirmationEffectResult = "committed" | "stale" | "failed";
export interface HighRiskConfirmationCommittedEffect {
  readonly status: "committed";
  readonly continueEffect: () => void;
}
export type HighRiskConfirmationEffectResolver = (
  decision: "allow" | "deny"
) => HighRiskConfirmationEffectResult |
  HighRiskConfirmationCommittedEffect |
  Promise<HighRiskConfirmationEffectResult | HighRiskConfirmationCommittedEffect>;

export type HighRiskConfirmationRegistration = Omit<HighRiskConfirmationSummary, "apiVersion">;
export type HighRiskConfirmationRegistrationResult =
  | { readonly status: "registered" | "restored" | "busy"; readonly revision: number; readonly confirmation: HighRiskConfirmationSummary }
  | { readonly status: "already_resolved"; readonly revision: number; readonly decision: "allow" | "deny" };

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
type Pending = PermissionPolicyRuntimePending<HighRiskConfirmationEffectResolver>;

export class HighRiskConfirmationService {
  readonly #state: PermissionPolicyRuntimeState<HighRiskConfirmationEffectResolver>;
  #inFlight: InFlightResolution | undefined;
  readonly #listeners = new Set<(event: HighRiskConfirmationChangedEvent) => void>();

  constructor(store?: PermissionPolicyStorePort, links?: PermissionPolicyRecordLinkPort) {
    this.#state = new PermissionPolicyRuntimeState(store, links);
  }

  pending(): HighRiskConfirmationPendingResult {
    const pending = this.#state.pending();
    return HighRiskConfirmationPendingResultSchema.parse(pending
      ? { apiVersion: 1, status: "pending", revision: pending.revision, confirmation: pending.confirmation }
      : { apiVersion: 1, status: "none", revision: this.#state.revision() });
  }

  register(
    registration: HighRiskConfirmationRegistration,
    resolver: HighRiskConfirmationEffectResolver,
    bindingDigest?: string,
    jobId?: string
  ): HighRiskConfirmationRegistrationResult {
    const result = this.#state.register({
      registration,
      resolver,
      ...(bindingDigest ? { bindingDigest } : {}),
      ...(jobId ? { jobId } : {})
    });
    if (result.status === "already_resolved") {
      return { status: result.status, revision: result.receipt.revision, decision: result.receipt.decision };
    }
    if (result.status === "registered") this.#emit();
    return {
      status: this.#inFlight && result.status === "restored" ? "busy" : result.status,
      revision: result.pending.revision,
      confirmation: result.pending.confirmation
    };
  }

  async resolve(request: HighRiskConfirmationResolveRequest): Promise<HighRiskConfirmationResolveResult> {
    const parsed = HighRiskConfirmationResolveRequestSchema.parse(request);
    const receipt = this.#state.receipt(parsed.confirmationId);
    if (receipt) {
      return receipt.decision === parsed.decision
        ? HighRiskConfirmationResolveResultSchema.parse({ apiVersion: 1, status: "already_resolved", ...receipt })
        : this.#stale();
    }
    const pending = this.#state.pending();
    if (!pending || pending.confirmation.confirmationId !== parsed.confirmationId) {
      return HighRiskConfirmationResolveResultSchema.parse({
        apiVersion: 1, status: "not_found", revision: this.#state.revision()
      });
    }
    if (pending.revision !== parsed.expectedRevision) return this.#stale();
    if (this.#inFlight) {
      return this.#sameInFlight(parsed) ? this.#inFlight.promise : this.#stale();
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
    const pending = this.#state.pending();
    if (
      this.#inFlight &&
      pending?.confirmation.confirmationId === request.confirmationId &&
      pending.revision === request.expectedRevision
    ) return "resolving";
    const status = this.#state.withdraw(request);
    if (status === "withdrawn") this.#emit();
    return status;
  }

  onChanged(listener: (event: HighRiskConfirmationChangedEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #executeResolution(
    pending: Pending,
    parsed: HighRiskConfirmationResolveRequest
  ): Promise<HighRiskConfirmationResolveResult> {
    const resolver = pending.resolver;
    if (!resolver) return this.#failed(parsed.confirmationId);
    let outcome: HighRiskConfirmationEffectResult | HighRiskConfirmationCommittedEffect;
    try {
      outcome = await resolver(parsed.decision);
    } catch {
      outcome = "failed";
    }
    if (outcome === "failed") return this.#failed(parsed.confirmationId);
    if (!this.#state.isCurrent(pending)) return this.#stale();
    if (outcome === "stale") {
      this.#state.clearStale(pending);
      this.#emit();
      return this.#stale();
    }

    let committed: PermissionPolicyRuntimeCommit;
    try {
      committed = this.#state.commit(pending, parsed.decision);
    } catch {
      return this.#failed(parsed.confirmationId);
    }
    if (!("receipt" in committed)) return this.#stale();
    this.#emit();
    if (typeof outcome === "object") {
      try { outcome.continueEffect(); } catch { /* The owning Job projects effect failure. */ }
    }
    return HighRiskConfirmationResolveResultSchema.parse({
      apiVersion: 1,
      status: committed.status === "already_resolved" ? "already_resolved" : "committed",
      confirmationId: committed.receipt.confirmationId,
      revision: committed.receipt.revision,
      decision: committed.receipt.decision
    });
  }

  #sameInFlight(request: HighRiskConfirmationResolveRequest): boolean {
    return this.#inFlight?.confirmationId === request.confirmationId &&
      this.#inFlight.revision === request.expectedRevision &&
      this.#inFlight.decision === request.decision;
  }

  #failed(confirmationId: string): HighRiskConfirmationResolveResult {
    return HighRiskConfirmationResolveResultSchema.parse({
      apiVersion: 1, status: "failed", confirmationId, revision: this.#state.revision()
    });
  }

  #stale(): HighRiskConfirmationResolveResult {
    return HighRiskConfirmationResolveResultSchema.parse({ apiVersion: 1, status: "stale", current: this.pending() });
  }

  #emit(): void {
    const event = HighRiskConfirmationChangedEventSchema.parse(this.pending());
    for (const listener of this.#listeners) listener(event);
  }
}
