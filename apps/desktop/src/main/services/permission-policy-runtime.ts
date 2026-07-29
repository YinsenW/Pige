import type {
  HighRiskConfirmationOwner,
  HighRiskConfirmationSummary
} from "@pige/contracts";
import { HighRiskConfirmationSummarySchema } from "@pige/schemas";
import {
  createPermissionPolicyRequestId,
  type PermissionPolicyDecisionReceipt,
  type PermissionPolicySnapshot,
  type PermissionPolicyStorePort
} from "./permission-policy-store";

export interface PermissionPolicyRuntimePending<TResolver> {
  readonly confirmation: HighRiskConfirmationSummary;
  readonly revision: number;
  resolver: TResolver | undefined;
  bindingDigest?: `sha256:${string}`;
  requestId?: string;
  jobId?: string;
  operationId?: string;
}

export interface PermissionPolicyRuntimeReceipt {
  readonly confirmationId: string;
  readonly revision: number;
  readonly decision: "allow" | "deny";
  readonly decisionId?: string;
  readonly requestId?: string;
  readonly jobId?: string;
  readonly operationId?: string;
}

export interface PermissionPolicyRecordLinkPort {
  recordPending(input: { readonly requestId: string; readonly jobId?: string }): void;
  recordDecision(input: {
    readonly requestId: string;
    readonly decisionId: string;
    readonly jobId?: string;
    readonly operationId?: string;
  }): void;
}

export type PermissionPolicyRuntimeRegistration<TResolver> =
  | { readonly status: "registered" | "restored"; readonly pending: PermissionPolicyRuntimePending<TResolver> }
  | { readonly status: "busy"; readonly pending: PermissionPolicyRuntimePending<TResolver> }
  | { readonly status: "already_resolved"; readonly receipt: PermissionPolicyRuntimeReceipt };

export type PermissionPolicyRuntimeCommit =
  | { readonly status: "committed" | "already_resolved"; readonly receipt: PermissionPolicyRuntimeReceipt }
  | { readonly status: "stale" | "not_found" };

const MAX_RECEIPTS = 64;

export class PermissionPolicyRuntimeState<TResolver> {
  #revision = 0;
  #pending: PermissionPolicyRuntimePending<TResolver> | undefined;
  readonly #receipts = new Map<string, PermissionPolicyRuntimeReceipt>();
  readonly #store: PermissionPolicyStorePort | undefined;
  readonly #links: PermissionPolicyRecordLinkPort | undefined;

  constructor(store?: PermissionPolicyStorePort, links?: PermissionPolicyRecordLinkPort) {
    this.#store = store;
    this.#links = links;
    if (this.#store) this.#adopt(this.#store.read());
  }

  revision(): number {
    return this.#revision;
  }

  pending(): PermissionPolicyRuntimePending<TResolver> | undefined {
    return this.#pending;
  }

  receipt(confirmationId: string): PermissionPolicyRuntimeReceipt | undefined {
    return this.#receipts.get(confirmationId);
  }

  register(input: {
    readonly registration: Omit<HighRiskConfirmationSummary, "apiVersion">;
    readonly resolver: TResolver;
    readonly bindingDigest?: string;
    readonly jobId?: string;
  }): PermissionPolicyRuntimeRegistration<TResolver> {
    const confirmation = HighRiskConfirmationSummarySchema.parse({ apiVersion: 1, ...input.registration });
    if (this.#store) return this.#registerDurable(confirmation, input);
    const receipt = this.#receipts.get(confirmation.confirmationId);
    if (receipt) return { status: "already_resolved", receipt };
    if (this.#pending) {
      if (!sameConfirmation(this.#pending.confirmation, confirmation)) {
        return { status: "busy", pending: this.#pending };
      }
      this.#pending.resolver = input.resolver;
      return { status: "restored", pending: this.#pending };
    }
    this.#revision += 1;
    this.#pending = { confirmation, revision: this.#revision, resolver: input.resolver };
    return { status: "registered", pending: this.#pending };
  }

  isCurrent(pending: PermissionPolicyRuntimePending<TResolver>): boolean {
    return this.#pending === pending;
  }

  commit(
    pending: PermissionPolicyRuntimePending<TResolver>,
    decision: "allow" | "deny"
  ): PermissionPolicyRuntimeCommit {
    if (!this.isCurrent(pending)) return { status: "stale" };
    if (this.#store) {
      const bindingDigest = pending.bindingDigest;
      if (!bindingDigest) return { status: "stale" };
      const result = this.#store.commitDecision({
        requestId: createPermissionPolicyRequestId(bindingDigest, pending.confirmation.confirmationId),
        bindingDigest,
        confirmationId: pending.confirmation.confirmationId,
        expectedRevision: pending.revision,
        decision
      });
      if (result.status !== "committed" && result.status !== "already_resolved") {
        this.#adopt(result.snapshot);
        return { status: result.status };
      }
      const receipt = runtimeReceipt(result.receipt);
      this.#recordDecision(receipt);
      this.#adopt(result.snapshot);
      return { status: result.status, receipt };
    }
    this.#pending = undefined;
    this.#revision += 1;
    const receipt = { confirmationId: pending.confirmation.confirmationId, revision: this.#revision, decision };
    this.#remember(receipt);
    return { status: "committed", receipt };
  }

  clearStale(pending: PermissionPolicyRuntimePending<TResolver>): boolean {
    if (!this.isCurrent(pending)) return false;
    if (this.#store) {
      const result = this.#store.withdraw({
        confirmationId: pending.confirmation.confirmationId,
        expectedRevision: pending.revision,
        owner: pending.confirmation.owner
      });
      this.#adopt(result.snapshot);
      return result.status === "withdrawn";
    }
    this.#pending = undefined;
    this.#revision += 1;
    return true;
  }

  withdraw(input: {
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly owner: HighRiskConfirmationOwner;
  }): "withdrawn" | "stale" | "not_found" {
    const pending = this.#pending;
    if (!pending || pending.confirmation.confirmationId !== input.confirmationId) return "not_found";
    if (
      pending.revision !== input.expectedRevision ||
      canonicalJson(pending.confirmation.owner) !== canonicalJson(input.owner)
    ) return "stale";
    if (this.#store) {
      const result = this.#store.withdraw(input);
      this.#adopt(result.snapshot);
      return result.status;
    }
    this.#pending = undefined;
    this.#revision += 1;
    return "withdrawn";
  }

  #registerDurable(
    confirmation: HighRiskConfirmationSummary,
    input: {
      readonly resolver: TResolver;
      readonly bindingDigest?: string;
      readonly jobId?: string;
    }
  ): PermissionPolicyRuntimeRegistration<TResolver> {
    if (!input.bindingDigest) throw new Error("A durable confirmation requires its binding digest.");
    createPermissionPolicyRequestId(input.bindingDigest, confirmation.confirmationId);
    const bindingDigest = input.bindingDigest as `sha256:${string}`;
    const result = this.#store!.register({
      requestId: createPermissionPolicyRequestId(bindingDigest, confirmation.confirmationId),
      bindingDigest,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      confirmation
    });
    if (result.status === "already_resolved") {
      const receipt = runtimeReceipt(result.receipt);
      this.#recordDecision(receipt);
      this.#adopt(result.snapshot);
      return { status: "already_resolved", receipt };
    }
    if (result.status === "busy") {
      this.#adopt(result.snapshot);
      const pending = this.#pending;
      if (!pending) throw new Error("The durable confirmation state is unavailable.");
      return { status: "busy", pending };
    }
    this.#links?.recordPending({
      requestId: createPermissionPolicyRequestId(bindingDigest, confirmation.confirmationId),
      ...(input.jobId ? { jobId: input.jobId } : {})
    });
    this.#adopt(result.snapshot);
    const pending = this.#pending;
    if (!pending) throw new Error("The durable confirmation state is unavailable.");
    pending.resolver = input.resolver;
    pending.bindingDigest = bindingDigest;
    pending.requestId = createPermissionPolicyRequestId(bindingDigest, confirmation.confirmationId);
    if (input.jobId) pending.jobId = input.jobId;
    else delete pending.jobId;
    if (confirmation.owner.kind === "operation") pending.operationId = confirmation.owner.operationId;
    else delete pending.operationId;
    return { status: result.status, pending };
  }

  #adopt(snapshot: PermissionPolicySnapshot): void {
    const previous = this.#pending;
    this.#revision = snapshot.revision;
    this.#receipts.clear();
    for (const receipt of snapshot.receipts) this.#remember(runtimeReceipt(receipt));
    this.#pending = snapshot.pending
      ? {
          confirmation: snapshot.pending.confirmation,
          revision: snapshot.pending.revision,
          resolver: previous && sameConfirmation(previous.confirmation, snapshot.pending.confirmation)
            ? previous.resolver
            : undefined,
          ...(previous?.bindingDigest ? { bindingDigest: previous.bindingDigest } : {}),
          requestId: snapshot.pending.requestId,
          ...(snapshot.pending.jobId ? { jobId: snapshot.pending.jobId } : {}),
          ...(snapshot.pending.confirmation.owner.kind === "operation"
            ? { operationId: snapshot.pending.confirmation.owner.operationId }
            : {})
        }
      : undefined;
  }

  #remember(receipt: PermissionPolicyRuntimeReceipt): void {
    this.#receipts.set(receipt.confirmationId, receipt);
    const oldest = this.#receipts.keys().next().value as string | undefined;
    if (this.#receipts.size > MAX_RECEIPTS && oldest) this.#receipts.delete(oldest);
  }

  #recordDecision(receipt: PermissionPolicyRuntimeReceipt): void {
    if (!receipt.decisionId || !receipt.requestId) throw new Error("The durable permission receipt is incomplete.");
    this.#links?.recordDecision({
      requestId: receipt.requestId,
      decisionId: receipt.decisionId,
      ...(receipt.jobId ? { jobId: receipt.jobId } : {}),
      ...(receipt.operationId ? { operationId: receipt.operationId } : {})
    });
  }
}

function runtimeReceipt(receipt: PermissionPolicyDecisionReceipt): PermissionPolicyRuntimeReceipt {
  return {
    confirmationId: receipt.confirmationId,
    revision: receipt.revision,
    decision: receipt.decision === "deny" ? "deny" : "allow",
    decisionId: receipt.id,
    requestId: receipt.permissionRequestId,
    ...(receipt.jobId ? { jobId: receipt.jobId } : {}),
    ...(receipt.operationId ? { operationId: receipt.operationId } : {})
  };
}

function sameConfirmation(left: HighRiskConfirmationSummary, right: HighRiskConfirmationSummary): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("The durable confirmation identity is invalid.");
}
