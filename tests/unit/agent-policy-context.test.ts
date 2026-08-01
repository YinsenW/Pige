import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentRuntimePolicyContext } from "../../apps/desktop/src/main/services/agent-policy-context";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";
import {
  createVaultOnDisk,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-policy-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Policy",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  return path.join(root, "Policy");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent runtime policy context", () => {
  it("builds a non-secret policy context from vault config", () => {
    const vaultPath = makeVault();
    const policy = buildAgentRuntimePolicyContext(vaultPath);

    expect(policy.sourceStorage.defaultStrategy).toBe("copy_to_source_library");
    expect(policy.sourceStorage.allowPerCaptureOverride).toBe(false);
    expect(policy.model.modelConfigured).toBe(false);
    expect(policy.model.modelRoutingMode).toBe("default_model_only");
    expect(policy.model.cloudSendPolicy).toBe("ordinary_allowed");
    expect(policy.retrieval.maxSnippetsForCloudSynthesis).toBe(8);
    expect(policy.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(policy)).not.toContain(vaultPath);
  });

  it("changes policy hash when an agent-affecting setting changes", () => {
    const vaultPath = makeVault();
    const before = buildAgentRuntimePolicyContext(vaultPath).policyHash;

    updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const after = buildAgentRuntimePolicyContext(vaultPath).policyHash;

    expect(after).not.toBe(before);
  });

  it("binds generated knowledge and app language preferences into each new policy snapshot", () => {
    const vaultPath = makeVault();
    const preserved = buildAgentRuntimePolicyContext(vaultPath);
    const configured = buildAgentRuntimePolicyContext(vaultPath, {
      appLocale: "fr",
      generatedKnowledgeLanguage: "app_locale"
    });

    expect(preserved.language).toMatchObject({
      generatedKnowledgeLanguage: "preserve_source",
      preserveSourceLanguage: true
    });
    expect(configured.language).toMatchObject({
      appLocale: "fr",
      generatedKnowledgeLanguage: "app_locale",
      preserveSourceLanguage: true
    });
    expect(configured.policyHash).not.toBe(preserved.policyHash);
  });

  it.each(["local_only"] as const)(
    "accepts the explicit %s cloud-send policy and binds it into the policy hash",
    (cloudSendPolicy) => {
      const vaultPath = makeVault();
      const ordinary = buildAgentRuntimePolicyContext(vaultPath);
      const stricter = buildAgentRuntimePolicyContext(vaultPath, { cloudSendPolicy });

      expect(stricter.model.cloudSendPolicy).toBe(cloudSendPolicy);
      expect(stricter.policyHash).not.toBe(ordinary.policyHash);
      expect(stricter.policyContextId).not.toBe(ordinary.policyContextId);
    }
  );

  it("includes the effective default model profile when provided by the model registry", () => {
    const vaultPath = makeVault();
    const policy = buildAgentRuntimePolicyContext(vaultPath, {
      defaultModel: {
        id: "model_default",
        providerProfileId: "provider_default",
        modelId: "gpt-4.1",
        source: "manual",
        enabled: true,
        isDefault: true,
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z"
      },
      defaultProvider: {
        id: "provider_default",
        displayName: "OpenAI",
        providerKind: "openai",
        modelListStrategy: "manual",
        cloudBoundary: "cloud",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z"
      }
    });

    expect(policy.model.modelConfigured).toBe(true);
    expect(policy.model.defaultModelProfileId).toBe("model_default");
    expect(policy.model.cloudBoundary).toBe("cloud");
  });

  it("binds a model-job policy snapshot to the durable job ID", () => {
    const vaultPath = makeVault();
    const policy = buildAgentRuntimePolicyContext(vaultPath, { jobId: "job_20260710_abcdef12" });

    expect(policy.jobId).toBe("job_20260710_abcdef12");
    expect(policy.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("hashes capability facts supplied by their runtime owners", () => {
    const vaultPath = makeVault();
    const policy = buildAgentRuntimePolicyContext(vaultPath, {
      localDatabaseStatus: "ready",
      parserToolchainReady: true,
      ocrEngines: ["apple_vision"],
      lexicalSearchAvailable: true
    });

    expect(policy.localCapabilities).toMatchObject({
      localDatabase: "ready",
      parserToolchainReady: true,
      ocrEngines: ["apple_vision"]
    });
    expect(policy.retrieval.lexicalSearchAvailable).toBe(true);
  });

  it("binds the low-confidence OCR summary setting into each new Agent policy", () => {
    const vaultPath = makeVault();
    const safe = buildAgentRuntimePolicyContext(vaultPath);
    const permissive = buildAgentRuntimePolicyContext(vaultPath, {
      excludeLowConfidenceOcrFromSummaries: false
    });

    expect(safe.localCapabilities.excludeLowConfidenceOcrFromSummaries).toBe(true);
    expect(permissive.localCapabilities.excludeLowConfidenceOcrFromSummaries).toBe(false);
    expect(permissive.policyHash).not.toBe(safe.policyHash);
  });

  it("binds the authoritative permission mode and revision into each new Agent policy", () => {
    const vaultPath = makeVault();
    const ask = buildAgentRuntimePolicyContext(vaultPath, {
      permissionMode: "ask_every_time",
      permissionPolicyRevision: 0
    });
    const remembered = buildAgentRuntimePolicyContext(vaultPath, {
      permissionMode: "remember_scoped_grants",
      permissionPolicyRevision: 1
    });

    expect(ask.authority).toEqual({
      firstPartyTurnAuthority: true,
      highRiskConfirmation: "closed_list",
      permissionMode: "ask_every_time",
      permissionPolicyRevision: 0,
      thirdPartyInheritance: false
    });
    expect(remembered.authority).toMatchObject({
      permissionMode: "remember_scoped_grants",
      permissionPolicyRevision: 1
    });
    expect(remembered.policyHash).not.toBe(ask.policyHash);
    expect(remembered.policyContextId).not.toBe(ask.policyContextId);
  });

  it("compiles the restarted permission store into the typed Agent authority context", () => {
    const vaultPath = makeVault();
    const appDataPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-policy-app-data-")));
    tempRoots.push(appDataPath);
    fs.chmodSync(appDataPath, 0o700);
    const first = new PermissionPolicyStore(appDataPath, () => undefined);
    expect(first.setDefaultMode(0, "remember_scoped_grants")).toBe("committed");

    const restarted = new PermissionPolicyStore(appDataPath, () => undefined);
    const policy = buildAgentRuntimePolicyContext(vaultPath, restarted.agentRuntimePolicyContext());

    expect(policy.authority).toMatchObject({
      permissionMode: "remember_scoped_grants",
      permissionPolicyRevision: 1
    });
  });
});
