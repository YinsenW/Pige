import { describe, expect, it } from "vitest";
import { SettingPermissionRequirementSchema } from "@pige/schemas";
import { getSettingsRegistry } from "../../apps/desktop/src/main/services/settings-registry";

describe("settings registry", () => {
  it("classifies implemented user-visible and agent-affecting settings", () => {
    const registry = getSettingsRegistry();
    const byKey = new Map(registry.entries.map((entry) => [entry.key, entry]));

    expect(byKey.get("app.locale")?.scope).toBe("machine_local");
    expect(byKey.get("window.layoutMode")?.scope).toBe("machine_local");
    expect(byKey.get("window.alwaysOnTop")?.owner).toBe("Window Service");
    expect(byKey.get("vault.activePath")?.scope).toBe("machine_local");
    expect(byKey.get("vault.id")?.scope).toBe("vault_identity");
    expect(byKey.get("sourceStorage.defaultStrategy")?.scope).toBe("vault_portable");
    expect(byKey.get("sourceStorage.defaultStrategy")?.agentPolicyEffect).toBe("sourceStorage.defaultStrategy");
    expect(byKey.get("backup.entryPoints")?.scope).toBe("derived_status");
    expect(byKey.get("models.providerApiKeys")?.scope).toBe("secret");
    expect(byKey.get("models.defaultPiAgentModel")?.agentPolicyEffect).toBe("model.defaultModelProfileId");
    expect(byKey.get("permissions.defaultMode")?.scope).toBe("machine_local");
    expect(byKey.get("permissions.defaultMode")?.agentPolicyEffect).toBe("permissions.defaultMode");
    expect(byKey.get("permissions.yoloEnabled")?.permissionRequirement).toBe("explicit_confirmation");
    expect(byKey.get("permissions.savedGrants")?.backedUpByDefault).toBe(false);
    expect(byKey.get("diagnostics.supportBundleExport")?.scope).toBe("runtime_transient");
    expect(byKey.get("toolchain.health")?.scope).toBe("derived_status");
    expect(registry.entries.every((entry) => SettingPermissionRequirementSchema.safeParse(entry.permissionRequirement).success)).toBe(true);
    expect(byKey.get("vault.activePath")?.permissionRequirement).toBe("permission_and_confirmation");
    expect(byKey.get("models.providerProfiles")?.permissionRequirement).toBe("explicit_confirmation");
    expect(byKey.get("models.providerApiKeys")?.permissionRequirement).toBe("explicit_warning");
    expect(byKey.get("maintenance.localDatabaseReset")?.permissionRequirement).toBe("explicit_confirmation");
    expect(byKey.get("diagnostics.supportBundleExport")?.permissionRequirement).toBe("explicit_confirmation");
  });
});
