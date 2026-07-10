import { describe, expect, it } from "vitest";
import {
  ModelEgressDecisionSchema,
  PermissionDecisionRecordSchema,
  PermissionRequestSchema,
  ProviderProfileSchema
} from "@pige/schemas";

const timestamp = "2026-07-10T00:00:00.000Z";
const policyHash = `sha256:${"a".repeat(64)}`;

describe("security-sensitive shared contracts", () => {
  it("rejects raw-secret capabilities and YOLO eligibility for always-confirmed actions", () => {
    const request = {
      id: "permreq_20260710_abcdef12",
      schemaVersion: 1 as const,
      authorizationLayer: "permission_broker" as const,
      actorType: "skill" as const,
      actorId: "skill_example",
      actorVersion: "1.0.0",
      capability: "change_settings" as const,
      resourceScope: "current_vault" as const,
      dataBoundary: "destructive" as const,
      duration: "once" as const,
      runtimeKind: "desktop_local" as const,
      clientCapabilityTier: "desktop_full" as const,
      requiresExplicitConfirmation: true,
      yoloEligible: false,
      reason: "Apply a user-reviewed settings change.",
      createdAt: timestamp,
      defaultModeAtRequest: "yolo_full_access" as const
    };

    expect(PermissionRequestSchema.parse(request).yoloEligible).toBe(false);
    expect(() => PermissionRequestSchema.parse({ ...request, yoloEligible: true })).toThrow(
      "An always-confirmed action cannot be YOLO eligible."
    );
    expect(() => PermissionRequestSchema.parse({ ...request, capability: "access_secret" })).toThrow();
  });

  it("rejects contradictory permission decision, scope, actor, and auto-allow combinations", () => {
    const manualAllowOnce = {
      id: "permdec_20260710_abcdef12",
      schemaVersion: 1 as const,
      authorizationLayer: "permission_broker" as const,
      permissionRequestId: "permreq_20260710_abcdef12",
      decision: "allow_once" as const,
      scope: "once" as const,
      resourceScope: "current_file" as const,
      decidedBy: "user" as const,
      autoAllowedBy: "none" as const,
      decidedAt: timestamp
    };
    const automaticAllowOnce = {
      ...manualAllowOnce,
      id: "permdec_20260710_abcdef13",
      decidedBy: "system" as const,
      autoAllowedBy: "saved_grant" as const
    };
    const scopedAllow = {
      ...manualAllowOnce,
      id: "permdec_20260710_abcdef14",
      decision: "allow_scoped" as const,
      scope: "resource_scope" as const
    };

    expect(PermissionDecisionRecordSchema.parse(manualAllowOnce).scope).toBe("once");
    expect(PermissionDecisionRecordSchema.parse(automaticAllowOnce).autoAllowedBy).toBe("saved_grant");
    expect(PermissionDecisionRecordSchema.parse(scopedAllow).decision).toBe("allow_scoped");
    expect(() => PermissionDecisionRecordSchema.parse({ ...manualAllowOnce, scope: "never" })).toThrow(
      "allow-once decision must use the once"
    );
    expect(() => PermissionDecisionRecordSchema.parse({
      ...automaticAllowOnce,
      decidedBy: "user"
    })).toThrow("must be recorded as a system decision");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...scopedAllow,
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access"
    })).toThrow("must not create another persistent scoped grant");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...scopedAllow,
      resourceScope: "current_action"
    })).toThrow("cannot target only the current action");
    expect(() => PermissionDecisionRecordSchema.parse({
      ...manualAllowOnce,
      decision: "deny",
      scope: "once"
    })).toThrow("denial must use the never");
  });

  it("enforces fail-safe model-egress outcomes from boundary, policy, and content class", () => {
    const common = {
      schemaVersion: 1 as const,
      providerProfileId: "provider_example",
      payloadCharacters: 1000,
      estimatedPayloadTokens: 250,
      normalPayloadCharacterLimit: 18000,
      policyHash
    };

    expect(
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "confirm",
        reasonCode: "unknown_boundary_confirmation",
        cloudBoundary: "unknown",
        boundaryVerification: "unknown",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["ordinary"]
      }).outcome
    ).toBe("confirm");

    expect(() =>
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "allow",
        reasonCode: "ordinary_external_allowed",
        cloudBoundary: "unknown",
        boundaryVerification: "unknown",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["ordinary"]
      })
    ).toThrow("Model egress outcome must be confirm");

    expect(
      ModelEgressDecisionSchema.parse({
        ...common,
        outcome: "block",
        reasonCode: "restricted_content_block",
        cloudBoundary: "local",
        boundaryVerification: "loopback_verified",
        cloudSendPolicy: "ordinary_allowed",
        contentClasses: ["restricted"]
      }).outcome
    ).toBe("block");
  });

  it("rejects contradictory or understated model-egress classifications", () => {
    const common = {
      schemaVersion: 1 as const,
      outcome: "allow" as const,
      reasonCode: "ordinary_external_allowed" as const,
      providerProfileId: "provider_example",
      cloudBoundary: "cloud" as const,
      boundaryVerification: "builtin_verified" as const,
      cloudSendPolicy: "ordinary_allowed" as const,
      estimatedPayloadTokens: 25,
      normalPayloadCharacterLimit: 1000,
      policyHash
    };

    expect(() => ModelEgressDecisionSchema.parse({
      ...common,
      contentClasses: ["ordinary", "private"],
      payloadCharacters: 100
    })).toThrow("ordinary is mutually exclusive");

    expect(() => ModelEgressDecisionSchema.parse({
      ...common,
      contentClasses: ["ordinary"],
      payloadCharacters: 1001
    })).toThrow("must be classified as large");
  });

  it("strips arbitrary provider headers from persisted provider metadata", () => {
    const parsed = ProviderProfileSchema.parse({
      id: "provider_example",
      displayName: "Example",
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual",
      cloudBoundary: "unknown",
      boundaryVerification: "unknown",
      defaultHeaders: { Authorization: "Bearer secret" },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(parsed).not.toHaveProperty("defaultHeaders");
  });

  it("normalizes safe provider URLs and rejects unsafe URLs in persisted metadata", () => {
    const profile = {
      id: "provider_example",
      displayName: "Example",
      providerKind: "openai_compatible" as const,
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual" as const,
      cloudBoundary: "local" as const,
      boundaryVerification: "loopback_verified" as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ProviderProfileSchema.parse({
      ...profile,
      baseUrl: " HTTP://[::1]:11434/v1/// "
    }).baseUrl).toBe("http://[::1]:11434/v1");

    for (const baseUrl of [
      "http://models.example.com/v1",
      "ftp://localhost/v1",
      "https://token@models.example.com/v1",
      "https://models.example.com/v1?api_key=secret",
      "https://models.example.com/v1#credential"
    ]) {
      expect(() => ProviderProfileSchema.parse({ ...profile, baseUrl })).toThrow();
    }
  });

  it("rejects provider boundary metadata that can disguise a cloud endpoint as verified local", () => {
    const common = {
      id: "provider_example",
      displayName: "Example",
      authSecretRef: "provider_secret_example",
      modelListStrategy: "manual" as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    }).cloudBoundary).toBe("cloud");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "cloud"
    })).toThrow("require builtin_verified");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified"
    })).toThrow("must use the cloud boundary");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    })).toThrow("fixed official endpoint");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      cloudBoundary: "local",
      boundaryVerification: "loopback_verified"
    })).toThrow("Only a canonical loopback provider URL");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "openai_compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      cloudBoundary: "unknown",
      boundaryVerification: "unknown"
    })).toThrow("loopback compatible provider must use local");
    expect(() => ProviderProfileSchema.parse({
      ...common,
      providerKind: "custom",
      baseUrl: "https://models.example.com/v1",
      cloudBoundary: "cloud",
      boundaryVerification: "builtin_verified"
    })).toThrow("cannot claim builtin_verified");
  });
});
