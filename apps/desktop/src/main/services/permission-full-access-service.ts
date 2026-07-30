import { createHash } from "node:crypto";
import type { PermissionSetDefaultModeRequest } from "@pige/contracts";
import type { HighRiskConfirmationRegistrationResult } from "./high-risk-confirmation-service";
import { HighRiskConfirmationService } from "./high-risk-confirmation-service";
import { PermissionPolicyStore, type PermissionPolicySnapshot } from "./permission-policy-store";

export type PermissionFullAccessRequestResult =
  | { readonly status: "committed" | "stale" | "failed" }
  | {
      readonly status: "confirmation_required";
      readonly confirmationId: string;
      readonly confirmationRevision: number;
    };

export class PermissionFullAccessService {
  readonly #store: PermissionPolicyStore;
  readonly #confirmations: HighRiskConfirmationService;
  readonly #activeVaultId: () => string | undefined;

  constructor(input: {
    readonly store: PermissionPolicyStore;
    readonly confirmations: HighRiskConfirmationService;
    readonly activeVaultId: () => string | undefined;
  }) {
    this.#store = input.store;
    this.#confirmations = input.confirmations;
    this.#activeVaultId = input.activeVaultId;
  }

  request(request: PermissionSetDefaultModeRequest): PermissionFullAccessRequestResult {
    if (request.mode !== "yolo_full_access" || this.#activeVaultId() !== request.activeVaultId) {
      return { status: "stale" };
    }
    const confirmationId = confirmationIdFor(request);
    const prepared = this.#store.prepareFullAccessActivation({
      expectedRevision: request.expectedRevision,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      confirmationId
    });
    if (prepared === "stale") return { status: "stale" };
    if (prepared === "busy") return { status: "stale" };
    return this.#bind(this.#store.read());
  }

  restore(): void {
    if (!this.#store.read().fullAccessActivation) return;
    this.#bind(this.#store.read());
  }

  #bind(snapshot: PermissionPolicySnapshot): PermissionFullAccessRequestResult {
    const activation = snapshot.fullAccessActivation;
    if (!activation) return { status: snapshot.defaultMode === "yolo_full_access" ? "committed" : "stale" };
    const bindingDigest = bindingDigestFor(activation);
    const result = this.#confirmations.register({
      confirmationId: activation.confirmationId,
      effect: "authority_boundary_change",
      presentation: {
        action: "change_authority_boundary",
        target: "authority_boundary",
        subject: { kind: "display_name", value: "YOLO Full Access" }
      },
      owner: { kind: "permission_policy", policyRequestId: activation.requestId }
    }, (decision) => {
      const current = this.#store.read().fullAccessActivation;
      if (
        !current ||
        current.confirmationId !== activation.confirmationId ||
        current.requestId !== activation.requestId ||
        current.activeVaultId !== activation.activeVaultId ||
        this.#activeVaultId() !== activation.activeVaultId
      ) return "stale";
      return {
        status: "committed",
        continueEffect: () => {
          this.#store.finishFullAccessDecision(activation.confirmationId, decision);
        }
      };
    }, bindingDigest);
    return this.#registrationResult(result, activation.confirmationId);
  }

  #registrationResult(
    result: HighRiskConfirmationRegistrationResult,
    confirmationId: string
  ): PermissionFullAccessRequestResult {
    if (result.status === "already_resolved") {
      return {
        status: this.#store.finishFullAccessDecision(confirmationId, result.decision) === "committed"
          ? "committed"
          : "stale"
      };
    }
    if (result.status === "busy") return { status: "stale" };
    return {
      status: "confirmation_required",
      confirmationId,
      confirmationRevision: result.revision
    };
  }
}

function confirmationIdFor(request: PermissionSetDefaultModeRequest): string {
  return `confirm_19700101_${digest("pige.permission.full_access.confirmation.v1", {
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    expectedRevision: request.expectedRevision
  }).slice(0, 32)}`;
}

function bindingDigestFor(activation: NonNullable<PermissionPolicySnapshot["fullAccessActivation"]>): `sha256:${string}` {
  return `sha256:${digest("pige.permission.full_access.binding.v1", activation)}`;
}

function digest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}
