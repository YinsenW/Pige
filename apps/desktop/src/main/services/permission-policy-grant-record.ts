import { createHash } from "node:crypto";
import type { HighRiskConfirmationSummary } from "@pige/contracts";
import {
  PermissionActionBindingSchema,
  PermissionDefaultModeSchema,
  PermissionGrantContextIdSchema,
  PermissionGrantSummarySchema,
  type PermissionActionBinding,
  type PermissionGrantSummary
} from "@pige/schemas";
import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const PermissionPolicyGrantRecordSchema = PermissionGrantSummarySchema.extend({
  actorId: z.string().min(3).max(128),
  actorDigest: DigestSchema,
  resourceIdentityHash: DigestSchema,
  policyHash: DigestSchema,
  runtimeKind: z.enum(["desktop_local", "remote_agent_backend"]),
  clientCapabilityTier: z.enum(["desktop_full", "web_client", "mobile_lite"])
}).strict();

export const PermissionPolicyGrantCandidateSchema = z.object({
  grantContextId: PermissionGrantContextIdSchema,
  scope: z.enum(["actor_version", "resource_scope"]),
  safeScopeLabel: z.string().min(1).max(192),
  grant: PermissionPolicyGrantRecordSchema
}).strict();

export const PermissionPolicyDefaultModeRecordSchema = PermissionDefaultModeSchema;

export type PermissionPolicyGrantRecord = z.infer<typeof PermissionPolicyGrantRecordSchema>;
export type PermissionPolicyGrantCandidate = z.infer<typeof PermissionPolicyGrantCandidateSchema>;

export function createPermissionPolicyGrantCandidate(
  bindingInput: PermissionActionBinding,
  confirmation: HighRiskConfirmationSummary,
  now: string
): PermissionPolicyGrantCandidate | undefined {
  const binding = PermissionActionBindingSchema.parse(bindingInput);
  if (!isRememberable(binding, confirmation)) return undefined;
  const actorLabel = actorLabelFor(binding.actorType);
  const resourceLabel = resourceLabelFor(binding.resourceScope);
  const scope = "resource_scope" as const;
  const identity = {
    actorType: binding.actorType,
    actorId: binding.actorId,
    actorVersion: binding.actorVersion,
    actorDigest: binding.actorDigest,
    capability: binding.capability,
    dataBoundary: binding.dataBoundary,
    scope,
    resourceScope: binding.resourceScope,
    resourceIdentityHash: binding.resourceIdentityHash,
    policyHash: binding.policyHash,
    runtimeKind: binding.runtimeKind,
    clientCapabilityTier: binding.clientCapabilityTier
  };
  const digest = createHash("sha256")
    .update("pige.permission.grant.v1\0", "utf8")
    .update(canonicalJson(identity), "utf8")
    .digest("hex");
  const date = /^confirm_(\d{8})_/u.exec(confirmation.confirmationId)?.[1] ?? "19700101";
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  return PermissionPolicyGrantCandidateSchema.parse({
    grantContextId: `grantctx_${digest.slice(0, 32)}`,
    scope,
    safeScopeLabel: `${actorLabel} - ${resourceLabel}`,
    grant: {
      grantId: `grant_${date}_${digest.slice(0, 32)}`,
      ...identity,
      actorLabel,
      resourceLabel,
      createdAt,
      expiresAt,
      canRevoke: true
    }
  });
}

export function permissionGrantMatches(
  grant: PermissionPolicyGrantRecord,
  bindingInput: PermissionActionBinding,
  now: string
): boolean {
  const binding = PermissionActionBindingSchema.parse(bindingInput);
  return Date.parse(grant.expiresAt) > Date.parse(now) &&
    grant.actorType === binding.actorType &&
    grant.actorId === binding.actorId &&
    grant.actorVersion === binding.actorVersion &&
    grant.actorDigest === binding.actorDigest &&
    grant.capability === binding.capability &&
    grant.dataBoundary === binding.dataBoundary &&
    grant.resourceScope === binding.resourceScope &&
    grant.resourceIdentityHash === binding.resourceIdentityHash &&
    grant.policyHash === binding.policyHash &&
    grant.runtimeKind === binding.runtimeKind &&
    grant.clientCapabilityTier === binding.clientCapabilityTier;
}

export function isPermissionPolicyAutoAllowEligible(
  bindingInput: PermissionActionBinding,
  confirmation: HighRiskConfirmationSummary
): boolean {
  const binding = PermissionActionBindingSchema.parse(bindingInput);
  return isRememberable(binding, confirmation) &&
    !["overwrite_user_original", "write_outside_authorized_root"].includes(confirmation.effect);
}

export function projectPermissionGrant(grant: PermissionPolicyGrantRecord): PermissionGrantSummary {
  return PermissionGrantSummarySchema.parse({
    grantId: grant.grantId,
    actorType: grant.actorType,
    actorLabel: grant.actorLabel,
    actorVersion: grant.actorVersion,
    capability: grant.capability,
    dataBoundary: grant.dataBoundary,
    scope: grant.scope,
    resourceScope: grant.resourceScope,
    resourceLabel: grant.resourceLabel,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    canRevoke: true
  });
}

function isRememberable(binding: PermissionActionBinding, confirmation: HighRiskConfirmationSummary): boolean {
  return binding.dataBoundary !== "destructive" &&
    binding.dataBoundary !== "brokered_credential" &&
    !["delete_vault", "use_brokered_credential", "change_pige_schema"].includes(binding.capability) &&
    !["irreversible_delete", "export_secret", "risky_agent_edit", "authority_boundary_change"].includes(confirmation.effect);
}

function actorLabelFor(actorType: PermissionActionBinding["actorType"]): string {
  return ({
    agent: "Pige Agent",
    skill: "Reviewed Skill",
    package: "Reviewed Package",
    local_tool: "Local tool",
    model_provider: "Model service"
  } as const)[actorType];
}

function resourceLabelFor(scope: PermissionActionBinding["resourceScope"]): string {
  return ({
    current_action: "Current action",
    current_source: "Current source",
    current_note: "Current note",
    current_url: "Current URL",
    current_domain: "Current domain",
    current_file: "Current file",
    current_folder: "Current folder",
    current_vault: "Current Vault",
    actor_version: "Actor version",
    provider_profile: "Provider profile",
    all_declared: "Declared resources"
  } as const)[scope];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
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
  throw new Error("The permission grant identity is invalid.");
}
