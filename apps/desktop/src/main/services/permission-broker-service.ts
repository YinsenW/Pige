import { createHash } from "node:crypto";
import path from "node:path";
import type {
  HighRiskConfirmationOwner,
  HighRiskConfirmationSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  PermissionActionBindingSchema,
  type PermissionActionBinding
} from "@pige/schemas";
import {
  HighRiskConfirmationService,
  type HighRiskConfirmationEffectResolver,
  type HighRiskConfirmationRegistration
} from "./high-risk-confirmation-service";

const FIRST_PARTY_TURN_ACTORS = new Set([
  "local_tool.pige.node_os_readonly",
  "pige.command-execution",
  "pige.pi-package-manager"
]);

type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type PermissionHighRiskIntent = DistributedOmit<
  HighRiskConfirmationRegistration,
  "confirmationId" | "owner"
>;

export type PermissionAuthorityResult =
  | { readonly status: "authorized"; readonly binding: PermissionActionBinding }
  | { readonly status: "confirmation_required"; readonly confirmationId: string; readonly revision: number }
  | { readonly status: "busy" }
  | { readonly status: "denied"; readonly confirmationId: string; readonly revision: number };

interface PermissionBrokerServiceCommonOptions {
  readonly rootPath: string;
  readonly confirmations?: HighRiskConfirmationService;
  readonly testOnlyHooks?: unknown;
}

export type PermissionBrokerServiceOptions = PermissionBrokerServiceCommonOptions & (
  | { readonly assertWriterLease: (vaultPath: string) => void; readonly unsafeAllowUnfenced?: never }
  | { readonly assertWriterLease?: never; readonly unsafeAllowUnfenced: true }
);

/**
 * AR1 authority boundary. Ordinary registered first-party actions inherit the submitted
 * turn and create no permission lifecycle. Exceptional effects are delegated to the
 * single canonical confirmation owner; this service stores no grants or decisions.
 */
export class PermissionBrokerService {
  readonly #rootPath: string;
  readonly #assertWriterLease: ((vaultPath: string) => void) | undefined;
  readonly #confirmations: HighRiskConfirmationService | undefined;

  constructor(options: PermissionBrokerServiceOptions) {
    if (
      !options ||
      typeof options.rootPath !== "string" ||
      options.rootPath.trim() === "" ||
      (options.assertWriterLease === undefined && options.unsafeAllowUnfenced !== true)
    ) {
      throw new PigeDomainError(
        "permission.store_invalid",
        "The authority boundary requires an active vault writer lease."
      );
    }
    this.#rootPath = path.resolve(options.rootPath);
    this.#assertWriterLease = options.assertWriterLease;
    this.#confirmations = options.confirmations;
  }

  authorizeTurnAction(input: {
    readonly vaultPath: string;
    readonly binding: PermissionActionBinding;
    readonly owner?: HighRiskConfirmationOwner;
    readonly highRisk?: PermissionHighRiskIntent;
    readonly resolveHighRisk?: HighRiskConfirmationEffectResolver;
  }): PermissionAuthorityResult {
    const binding = parseAndVerifyBinding(input.binding);
    this.#assertCurrentVault(input.vaultPath);

    if (isFirstPartyTurnAuthority(binding)) {
      if (input.highRisk) throw highRiskClassificationInvalid();
      return { status: "authorized", binding };
    }

    if (!input.highRisk || !input.owner || !input.resolveHighRisk) throw highRiskClassificationRequired();
    assertHighRiskIntentMatchesBinding(binding, input.highRisk);
    const confirmations = this.#confirmations;
    if (!confirmations) throw confirmationOwnerUnavailable();

    const confirmationId = confirmationIdFor(binding.bindingHash);
    const registration = confirmations.register({
      confirmationId,
      ...input.highRisk,
      owner: input.owner
    } as HighRiskConfirmationRegistration, input.resolveHighRisk);

    if (registration.status === "busy") return { status: "busy" };

    if (registration.status === "already_resolved") {
      return registration.decision === "allow"
        ? { status: "authorized", binding }
        : {
            status: "denied",
            confirmationId,
            revision: registration.revision
          };
    }
    return {
      status: "confirmation_required",
      confirmationId,
      revision: registration.revision
    };
  }

  withdrawHighRisk(input: {
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly owner: HighRiskConfirmationOwner;
  }): void {
    this.#confirmations?.withdraw(input);
  }

  #assertCurrentVault(vaultPath: string): void {
    const resolved = path.resolve(vaultPath);
    if (resolved === this.#rootPath || resolved.startsWith(`${this.#rootPath}${path.sep}`)) {
      throw new PigeDomainError("permission.binding_changed", "The vault authority boundary is invalid.");
    }
    try {
      this.#assertWriterLease?.(resolved);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError("permission.binding_changed", "The submitted turn is no longer current.");
    }
  }
}

export function createPermissionActionBinding(
  input: Omit<PermissionActionBinding, "bindingHash">
): PermissionActionBinding {
  const parsed = PermissionActionBindingSchema.omit({ bindingHash: true }).parse(input);
  return PermissionActionBindingSchema.parse({
    ...parsed,
    bindingHash: hashCanonical("pige.permission.action_binding.v1", parsed)
  });
}

export function assertPermissionActionBinding(
  actualInput: PermissionActionBinding,
  expectedInput: PermissionActionBinding
): void {
  const actual = parseAndVerifyBinding(actualInput);
  const expected = parseAndVerifyBinding(expectedInput);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new PigeDomainError("permission.binding_changed", "The exact action binding changed.");
  }
}

function isFirstPartyTurnAuthority(binding: PermissionActionBinding): boolean {
  return binding.runtimeKind === "desktop_local" &&
    binding.clientCapabilityTier === "desktop_full" &&
    binding.actorType === "local_tool" &&
    FIRST_PARTY_TURN_ACTORS.has(binding.actorId) &&
    binding.dataBoundary !== "destructive" &&
    binding.dataBoundary !== "brokered_credential" &&
    binding.capability !== "delete_vault" &&
    binding.capability !== "use_brokered_credential" &&
    binding.capability !== "change_settings" &&
    binding.capability !== "change_pige_schema" &&
    binding.capability !== "spawn_agent";
}

function assertHighRiskIntentMatchesBinding(
  binding: PermissionActionBinding,
  intent: PermissionHighRiskIntent
): void {
  const valid = (() => {
    switch (intent.effect) {
      case "arbitrary_shell":
        return binding.capability === "run_shell";
      case "install_unreviewed_package":
        return binding.capability === "install_package" || binding.capability === "install_local_tool";
      case "irreversible_delete":
        return binding.capability === "delete_vault" && binding.dataBoundary === "destructive";
      case "overwrite_user_original":
      case "write_outside_authorized_root":
        return binding.capability === "external_filesystem" && binding.dataBoundary === "filesystem";
      case "export_secret":
        return binding.capability === "use_brokered_credential" && binding.dataBoundary === "brokered_credential";
      case "risky_agent_edit":
        return binding.capability === "write_vault";
      case "authority_boundary_change":
        return binding.capability === "change_settings" || binding.capability === "change_pige_schema";
    }
  })();
  if (!valid) throw highRiskClassificationInvalid();
}

function parseAndVerifyBinding(input: PermissionActionBinding): PermissionActionBinding {
  const binding = PermissionActionBindingSchema.parse(input);
  const { bindingHash, ...identity } = binding;
  if (bindingHash !== hashCanonical("pige.permission.action_binding.v1", identity)) {
    throw new PigeDomainError("permission.binding_changed", "The exact action binding changed.");
  }
  return binding;
}

function confirmationIdFor(bindingHash: string): string {
  return `confirm_19700101_${bindingHash.slice("sha256:".length, "sha256:".length + 32)}`;
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    if (typeof value === "number" && !Number.isFinite(value)) throw highRiskClassificationInvalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw highRiskClassificationInvalid();
}

function legacyLifecycleRemoved(): PigeDomainError {
  return new PigeDomainError(
    "permission.legacy_lifecycle_removed",
    "The legacy permission lifecycle is unavailable."
  );
}

function highRiskClassificationRequired(): PigeDomainError {
  return new PigeDomainError(
    "permission.high_risk_classification_required",
    "The capability does not inherit submitted-turn authority."
  );
}

function highRiskClassificationInvalid(): PigeDomainError {
  return new PigeDomainError(
    "permission.high_risk_classification_invalid",
    "The high-risk effect does not match the exact capability binding."
  );
}

function confirmationOwnerUnavailable(): PigeDomainError {
  return new PigeDomainError(
    "permission.confirmation_owner_unavailable",
    "The high-risk confirmation owner is unavailable."
  );
}
