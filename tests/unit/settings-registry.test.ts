import { describe, expect, it } from "vitest";
import { SettingPermissionRequirementSchema } from "@pige/schemas";
import { getSettingsRegistry } from "../../apps/desktop/src/main/services/settings-registry";

describe("settings registry", () => {
  it("classifies implemented user-visible and agent-affecting settings", () => {
    const registry = getSettingsRegistry();
    const byKey = new Map(registry.entries.map((entry) => [entry.key, entry]));

    expect(byKey.get("app.locale")?.scope).toBe("machine_local");
    expect(byKey.get("appearance.theme")).toMatchObject({
      scope: "machine_local", backedUpByDefault: false, applyBehavior: "immediate"
    });
    expect(byKey.get("appearance.generatedKnowledgeLanguage")).toMatchObject({
      scope: "machine_local",
      backedUpByDefault: false,
      applyBehavior: "new_jobs",
      agentPolicyEffect: "language.generatedKnowledgeLanguage"
    });
    expect(byKey.get("startup.destination")).toMatchObject({
      scope: "machine_local", backedUpByDefault: false, applyBehavior: "next_launch"
    });
    expect(byKey.get("window.layoutMode")?.scope).toBe("machine_local");
    expect(byKey.get("window.alwaysOnTop")?.owner).toBe("Window Service");
    expect(byKey.get("vault.activePath")?.scope).toBe("machine_local");
    expect(byKey.get("vault.id")?.scope).toBe("vault_identity");
    expect(byKey.get("sourceStorage.defaultStrategy")?.scope).toBe("vault_portable");
    expect(byKey.get("sourceStorage.defaultStrategy")?.agentPolicyEffect).toBe("sourceStorage.defaultStrategy");
    expect(byKey.get("backup.entryPoints")?.scope).toBe("derived_status");
    expect(byKey.get("backup.includeConversations")).toMatchObject({
      page: "Vault & Note Storage",
      scope: "vault_portable",
      owner: "Backup Service",
      storage: ".pige/config.json",
      backedUpByDefault: true,
      applyBehavior: "new_jobs",
      permissionRequirement: "none"
    });
    expect(byKey.get("memory.includeMemoryInBackup")).toMatchObject({
      scope: "vault_portable",
      storage: ".pige/config.json"
    });
    expect(byKey.get("memory.includeMemoryInBackup")?.agentPolicyEffect).toBeUndefined();
    expect(byKey.get("vault.pigePolicy")).toMatchObject({
      page: "Agent & Memory",
      scope: "vault_portable",
      storage: "PIGE.md",
      backedUpByDefault: true,
      applyBehavior: "requires_confirmation",
      permissionRequirement: "explicit_confirmation",
      agentPolicyEffect: "vault.pigePolicy"
    });
    expect(byKey.get("models.providerApiKeys")?.scope).toBe("secret");
    expect(byKey.get("models.defaultPiAgentModel")?.agentPolicyEffect).toBe("model.defaultModelProfileId");
    expect([...byKey.keys()].filter((key) => key.startsWith("permissions."))).toEqual([]);
    expect(byKey.get("diagnostics.supportBundleExport")?.scope).toBe("runtime_transient");
    expect(byKey.get("toolchain.health")?.scope).toBe("derived_status");
    expect(byKey.get("speech.dictationLanguage")).toMatchObject({
      page: "Local Capabilities",
      scope: "machine_local",
      owner: "Speech Service, I18N Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none",
      agentPolicyEffect: "language.voiceInputLanguage"
    });
    expect(byKey.get("ocr.enginePreference")).toMatchObject({
      scope: "machine_local", backedUpByDefault: false, applyBehavior: "new_jobs"
    });
    expect(byKey.get("ocr.languagePreference")).toMatchObject({
      scope: "machine_local",
      backedUpByDefault: false,
      agentPolicyEffect: "language.ocrLanguageHints"
    });
    expect(byKey.get("updates.channel")).toMatchObject({
      scope: "machine_local", backedUpByDefault: false, applyBehavior: "new_jobs"
    });
    expect(byKey.get("ocr.excludeLowConfidenceFromSummaries")).toMatchObject({
      page: "Local Capabilities",
      scope: "machine_local",
      owner: "OCR Service, Agent Orchestrator",
      storage: "OS app data/ocr-summary-preference.json",
      backedUpByDefault: false,
      applyBehavior: "new_jobs",
      permissionRequirement: "none",
      agentPolicyEffect: "localCapabilities.excludeLowConfidenceOcrFromSummaries"
    });
    expect(registry.entries.every((entry) => SettingPermissionRequirementSchema.safeParse(entry.permissionRequirement).success)).toBe(true);
    expect(byKey.get("vault.activePath")?.permissionRequirement).toBe("permission_and_confirmation");
    expect(byKey.get("models.providerProfiles")?.permissionRequirement).toBe("explicit_confirmation");
    expect(byKey.get("models.providerApiKeys")?.permissionRequirement).toBe("explicit_warning");
    expect(byKey.get("maintenance.localDatabaseReset")?.permissionRequirement).toBe("explicit_confirmation");
    expect(byKey.get("diagnostics.supportBundleExport")?.permissionRequirement).toBe("explicit_confirmation");
  });
});
