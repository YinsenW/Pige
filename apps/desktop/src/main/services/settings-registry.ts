import type { SettingsRegistrySummary } from "@pige/contracts";

export const implementedSettingsRegistry: SettingsRegistrySummary = {
  entries: [
    {
      key: "app.locale",
      page: "Appearance & Language",
      scope: "machine_local",
      owner: "Settings Service, I18N Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "window.layoutMode",
      page: "General",
      scope: "machine_local",
      owner: "Window Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "window.alwaysOnTop",
      page: "General",
      scope: "machine_local",
      owner: "Window Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "window.sidebarOpen",
      page: "General",
      scope: "machine_local",
      owner: "Window Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "vault.activePath",
      page: "Vault & Note Storage",
      scope: "machine_local",
      owner: "Vault Runtime Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "requires_coordination",
      permissionRequirement: "permission_and_confirmation"
    },
    {
      key: "vault.recentVaults",
      page: "Vault & Note Storage",
      scope: "machine_local",
      owner: "Vault Runtime Service",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "vault.id",
      page: "Vault & Note Storage",
      scope: "vault_identity",
      owner: "Vault Runtime Service",
      storage: ".pige/manifest.json",
      backedUpByDefault: true,
      applyBehavior: "requires_confirmation",
      permissionRequirement: "explicit_confirmation"
    },
    {
      key: "sourceStorage.defaultStrategy",
      page: "Vault & Note Storage",
      scope: "vault_portable",
      owner: "Source Storage Service",
      storage: ".pige/config.json",
      backedUpByDefault: true,
      applyBehavior: "new_jobs",
      permissionRequirement: "none",
      agentPolicyEffect: "sourceStorage.defaultStrategy"
    },
    {
      key: "backup.entryPoints",
      page: "Vault & Note Storage",
      scope: "derived_status",
      owner: "Backup Service",
      storage: "Computed from active vault and release phase",
      backedUpByDefault: false,
      applyBehavior: "recomputed",
      permissionRequirement: "none"
    },
    {
      key: "models.providerProfiles",
      page: "Models",
      scope: "machine_local",
      owner: "Model Provider Registry",
      storage: "OS app data/provider-profiles.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "explicit_confirmation"
    },
    {
      key: "models.providerApiKeys",
      page: "Models",
      scope: "secret",
      owner: "Settings and Secrets Service",
      storage: "OS keychain/encrypted app data secret store",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "explicit_warning"
    },
    {
      key: "models.manualModelIds",
      page: "Models",
      scope: "machine_local",
      owner: "Model Provider Registry",
      storage: "OS app data/model-profiles.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none"
    },
    {
      key: "models.defaultPiAgentModel",
      page: "Models",
      scope: "machine_local",
      owner: "Model Provider Registry, Agent Orchestrator",
      storage: "OS app data/model-profiles.json",
      backedUpByDefault: false,
      applyBehavior: "new_jobs",
      permissionRequirement: "none",
      agentPolicyEffect: "model.defaultModelProfileId"
    },
    {
      key: "permissions.defaultMode",
      page: "Permissions & Privacy",
      scope: "machine_local",
      owner: "Permission Settings Service, Permission Broker",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none",
      agentPolicyEffect: "permissions.defaultMode"
    },
    {
      key: "permissions.yoloEnabled",
      page: "Permissions & Privacy",
      scope: "machine_local",
      owner: "Permission Settings Service, Permission Broker",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "explicit_confirmation",
      agentPolicyEffect: "permissions.yoloEnabled"
    },
    {
      key: "permissions.savedGrants",
      page: "Permissions & Privacy",
      scope: "machine_local",
      owner: "Permission Settings Service, Permission Broker",
      storage: "OS app data/settings.json",
      backedUpByDefault: false,
      applyBehavior: "immediate",
      permissionRequirement: "none",
      agentPolicyEffect: "permissions.savedGrantSummaryRefs"
    },
    {
      key: "maintenance.localDatabaseReset",
      page: "Index & Maintenance",
      scope: "runtime_transient",
      owner: "Local Database Service",
      storage: "Runtime action plus rebuildable .pige/db state",
      backedUpByDefault: false,
      applyBehavior: "recomputed",
      permissionRequirement: "explicit_confirmation"
    },
    {
      key: "diagnostics.health",
      page: "Updates & Diagnostics",
      scope: "derived_status",
      owner: "Diagnostics Service",
      storage: "OS app data diagnostics store",
      backedUpByDefault: false,
      applyBehavior: "recomputed",
      permissionRequirement: "none"
    },
    {
      key: "diagnostics.supportBundleExport",
      page: "Updates & Diagnostics",
      scope: "runtime_transient",
      owner: "Diagnostics Service",
      storage: "User-selected local output path",
      backedUpByDefault: false,
      applyBehavior: "requires_confirmation",
      permissionRequirement: "explicit_confirmation"
    },
    {
      key: "toolchain.health",
      page: "System",
      scope: "derived_status",
      owner: "Runtime Capability Service",
      storage: "resources/toolchain-manifest/toolchain.manifest.json plus resolved bundled paths",
      backedUpByDefault: false,
      applyBehavior: "recomputed",
      permissionRequirement: "none"
    }
  ]
};

export function getSettingsRegistry(): SettingsRegistrySummary {
  return implementedSettingsRegistry;
}
