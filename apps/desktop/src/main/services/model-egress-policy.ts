import type { AgentRuntimePolicyContext, ProviderProfileSummary } from "@pige/contracts";
import {
  ModelEgressDecisionSchema,
  type ModelEgressContentClass,
  type ModelEgressDecision
} from "@pige/schemas";

export interface ModelEgressPayloadClassification {
  readonly payloadCharacters: number;
  readonly estimatedPayloadTokens: number;
  readonly normalPayloadCharacterLimit: number;
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly restrictedContent: boolean;
}

export function createModelEgressDecision(
  provider: ProviderProfileSummary,
  policy: AgentRuntimePolicyContext,
  payload: ModelEgressPayloadClassification
): ModelEgressDecision {
  const contentClasses = classifyContent(payload);
  const verifiedLocal = provider.cloudBoundary === "local" && provider.boundaryVerification === "loopback_verified";
  let outcome: ModelEgressDecision["outcome"];
  let reasonCode: ModelEgressDecision["reasonCode"];

  if (contentClasses.includes("restricted")) {
    outcome = "block";
    reasonCode = "restricted_content_block";
  } else if (verifiedLocal) {
    outcome = "allow";
    reasonCode = "verified_local";
  } else if (policy.model.cloudSendPolicy === "local_only") {
    outcome = "block";
    reasonCode = "local_only_block";
  } else if (
    provider.cloudBoundary === "local" ||
    (provider.cloudBoundary === "unknown" && provider.boundaryVerification !== "user_asserted")
  ) {
    outcome = "confirm";
    reasonCode = "unknown_boundary_confirmation";
  } else if (policy.model.cloudSendPolicy === "confirm_all") {
    outcome = "confirm";
    reasonCode = "confirm_all";
  } else if (contentClasses.includes("sensitive")) {
    outcome = "confirm";
    reasonCode = "sensitive_confirmation";
  } else if (
    policy.model.cloudSendPolicy === "confirm_private_or_large" &&
    (contentClasses.includes("private") || contentClasses.includes("large"))
  ) {
    outcome = "confirm";
    reasonCode = "private_or_large_confirmation";
  } else {
    outcome = "allow";
    reasonCode = "ordinary_external_allowed";
  }

  return ModelEgressDecisionSchema.parse({
    schemaVersion: 1,
    outcome,
    reasonCode,
    providerProfileId: provider.id,
    cloudBoundary: provider.cloudBoundary,
    boundaryVerification: provider.boundaryVerification ?? "unknown",
    cloudSendPolicy: policy.model.cloudSendPolicy,
    contentClasses,
    payloadCharacters: payload.payloadCharacters,
    estimatedPayloadTokens: payload.estimatedPayloadTokens,
    normalPayloadCharacterLimit: payload.normalPayloadCharacterLimit,
    policyHash: policy.policyHash
  });
}

function classifyContent(payload: ModelEgressPayloadClassification): ModelEgressContentClass[] {
  if (payload.restrictedContent) return ["restricted"];
  const classes: ModelEgressContentClass[] = [];
  if (payload.privateContent) classes.push("private");
  if (payload.payloadCharacters > payload.normalPayloadCharacterLimit) classes.push("large");
  if (payload.sensitiveContent) classes.push("sensitive");
  return classes.length > 0 ? classes : ["ordinary"];
}
