import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelProfileSummary, ProviderProfileSummary } from "@pige/contracts";
import type { CloudSendPolicy } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentRuntimePolicyContext } from "../../apps/desktop/src/main/services/agent-policy-context";
import {
  createModelEgressDecision,
  type ModelEgressPayloadClassification
} from "../../apps/desktop/src/main/services/model-egress-policy";
import {
  assertApprovedModelProviderBinding,
  createModelRuntimeBindingIdentity
} from "../../apps/desktop/src/main/services/model-runtime-binding";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const NOW = "2026-07-12T08:00:00.000Z";
const tempRoots: string[] = [];

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-egress-policy-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Egress Policy",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date(NOW)
  });
  return path.join(root, "Egress Policy");
}

function makeProvider(
  id: string,
  cloudBoundary: ProviderProfileSummary["cloudBoundary"],
  boundaryVerification: NonNullable<ProviderProfileSummary["boundaryVerification"]>
): ProviderProfileSummary {
  const builtInCloud = cloudBoundary === "cloud" && boundaryVerification === "builtin_verified";
  return {
    id,
    displayName: id,
    providerKind: builtInCloud ? "openai" : "openai_compatible",
    ...(builtInCloud ? {} : {
      baseUrl: cloudBoundary === "local" && boundaryVerification === "loopback_verified"
        ? "http://127.0.0.1:11434/v1"
        : `https://${id}.example.test/v1`
    }),
    modelListStrategy: "list_models",
    cloudBoundary,
    boundaryVerification,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function makeModel(id: string, providerProfileId: string): ModelProfileSummary {
  return {
    id,
    providerProfileId,
    modelId: "shared-model-id",
    source: "provider_list",
    enabled: true,
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function makePayload(
  overrides: Partial<ModelEgressPayloadClassification> = {}
): ModelEgressPayloadClassification {
  return {
    payloadCharacters: 1_200,
    estimatedPayloadTokens: 300,
    normalPayloadCharacterLimit: 5_000,
    privateContent: false,
    sensitiveContent: false,
    restrictedContent: false,
    ...overrides
  };
}

function makePolicy(vaultPath: string, cloudSendPolicy: CloudSendPolicy = "ordinary_allowed") {
  return buildAgentRuntimePolicyContext(vaultPath, { cloudSendPolicy });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("model egress policy", () => {
  const trustedExternalProviders = [
    ["verified cloud", makeProvider("provider_cloud", "cloud", "builtin_verified")],
    ["user-asserted self-hosted", makeProvider("provider_self_hosted", "self_hosted", "user_asserted")],
    ["connected exact endpoint", makeProvider("provider_connected", "unknown", "user_asserted")]
  ] as const;

  const ordinaryAllowedPayloads = [
    ["ordinary", makePayload(), ["ordinary"]],
    ["private", makePayload({ privateContent: true }), ["private"]],
    [
      "bounded large",
      makePayload({ payloadCharacters: 5_001, estimatedPayloadTokens: 1_251 }),
      ["large"]
    ]
  ] as const;

  for (const [providerLabel, provider] of trustedExternalProviders) {
    for (const [payloadLabel, payload, contentClasses] of ordinaryAllowedPayloads) {
      it(`allows ${payloadLabel} content for a ${providerLabel} profile under ordinary_allowed`, () => {
        const decision = createModelEgressDecision(provider, makePolicy(makeVault()), payload);

        expect(decision).toMatchObject({
          outcome: "allow",
          reasonCode: "ordinary_external_allowed",
          providerProfileId: provider.id,
          cloudSendPolicy: "ordinary_allowed",
          contentClasses
        });
      });
    }
  }

  it.each(trustedExternalProviders)(
    "treats sensitive context submitted to a connected %s profile as part of the ordinary task",
    (_label, provider) => {
      const decision = createModelEgressDecision(
        provider,
        makePolicy(makeVault()),
        makePayload({ sensitiveContent: true })
      );

      expect(decision).toMatchObject({
        outcome: "allow",
        reasonCode: "ordinary_external_allowed",
        contentClasses: ["sensitive"]
      });
    }
  );

  it.each([
    makeProvider("provider_cloud_restricted", "cloud", "builtin_verified"),
    makeProvider("provider_local_restricted", "local", "loopback_verified")
  ])("blocks restricted content for $id before any provider trust can allow it", (provider) => {
    const decision = createModelEgressDecision(
      provider,
      makePolicy(makeVault()),
      makePayload({ privateContent: true, sensitiveContent: true, restrictedContent: true })
    );

    expect(decision).toMatchObject({
      outcome: "block",
      reasonCode: "restricted_content_block",
      contentClasses: ["restricted"]
    });
  });

  it.each([
    ["unknown boundary", makeProvider("provider_unknown", "unknown", "unknown")],
    ["unverified local boundary", makeProvider("provider_local_unverified", "local", "user_asserted")]
  ] as const)("blocks an unverified %s without creating a confirmation", (_label, provider) => {
    const decision = createModelEgressDecision(provider, makePolicy(makeVault()), makePayload());

    expect(decision).toMatchObject({
      outcome: "block",
      reasonCode: "unknown_boundary_confirmation"
    });
  });

  it.each([
    ["confirm_private_or_large", makePayload(), "allow", "ordinary_external_allowed"],
    [
      "confirm_private_or_large",
      makePayload({ privateContent: true }),
      "allow",
      "ordinary_external_allowed"
    ],
    [
      "confirm_private_or_large",
      makePayload({ payloadCharacters: 5_001, estimatedPayloadTokens: 1_251 }),
      "allow",
      "ordinary_external_allowed"
    ],
    ["confirm_all", makePayload(), "allow", "ordinary_external_allowed"],
    ["local_only", makePayload(), "block", "local_only_block"]
  ] as const)(
    "applies %s immediately with the expected %s outcome",
    (cloudSendPolicy, payload, outcome, reasonCode) => {
      const decision = createModelEgressDecision(
        makeProvider("provider_strict_cloud", "cloud", "builtin_verified"),
        makePolicy(makeVault(), cloudSendPolicy),
        payload
      );

      expect(decision).toMatchObject({ outcome, reasonCode, cloudSendPolicy });
    }
  );

  it.each([
    "ordinary_allowed",
    "confirm_private_or_large",
    "confirm_all",
    "local_only"
  ] as const)("allows non-restricted content for verified loopback local under %s", (cloudSendPolicy) => {
    const decision = createModelEgressDecision(
      makeProvider("provider_loopback", "local", "loopback_verified"),
      makePolicy(makeVault(), cloudSendPolicy),
      makePayload({ privateContent: true, sensitiveContent: true, payloadCharacters: 5_001 })
    );

    expect(decision).toMatchObject({
      outcome: "allow",
      reasonCode: "verified_local",
      providerProfileId: "provider_loopback",
      cloudSendPolicy
    });
  });

  it("binds authorization to the exact provider profile and rejects reuse after a profile switch", () => {
    const vaultPath = makeVault();
    const firstProvider = makeProvider("provider_first", "cloud", "builtin_verified");
    const nextProvider = makeProvider("provider_next", "cloud", "builtin_verified");
    const firstModel = makeModel("model_first", firstProvider.id);
    const nextModel = makeModel("model_next", nextProvider.id);
    const firstBinding = createModelRuntimeBindingIdentity(firstModel, firstProvider);
    const nextBinding = createModelRuntimeBindingIdentity(nextModel, nextProvider);
    const firstDecision = createModelEgressDecision(firstProvider, makePolicy(vaultPath), makePayload());
    const nextDecision = createModelEgressDecision(nextProvider, makePolicy(vaultPath), makePayload());

    expect(firstDecision.providerProfileId).toBe(firstProvider.id);
    expect(nextDecision.providerProfileId).toBe(nextProvider.id);
    expect(nextDecision.providerProfileId).not.toBe(firstDecision.providerProfileId);
    expect(nextBinding.providerIdentityHash).not.toBe(firstBinding.providerIdentityHash);
    expect(nextBinding.modelIdentityHash).not.toBe(firstBinding.modelIdentityHash);
    expect(() =>
      assertApprovedModelProviderBinding(
        nextModel,
        nextProvider,
        firstBinding,
        "The previously approved provider profile cannot authorize the selected profile."
      )
    ).toThrow("The previously approved provider profile cannot authorize the selected profile.");
  });
});
