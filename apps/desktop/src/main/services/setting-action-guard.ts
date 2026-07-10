import { PigeDomainError } from "@pige/domain";
import type { SettingPermissionRequirement } from "@pige/schemas";
import type { SettingsRegistrySummary } from "@pige/contracts";
import { getSettingsRegistry } from "./settings-registry";

export interface SettingActionConfirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

export async function guardSettingAction(
  settingKeys: readonly string[],
  confirmation: SettingActionConfirmation,
  confirm: (confirmation: SettingActionConfirmation) => Promise<boolean>,
  registry: SettingsRegistrySummary = getSettingsRegistry()
): Promise<void> {
  const byKey = new Map(registry.entries.map((entry) => [entry.key, entry]));
  const requirements = new Set<SettingPermissionRequirement>();
  for (const key of settingKeys) {
    const entry = byKey.get(key);
    if (!entry) throw new PigeDomainError("settings.registry_missing", `No setting registry entry exists for ${key}.`);
    requirements.add(entry.permissionRequirement);
  }
  if (requirements.has("permission_broker")) {
    throw new PigeDomainError("permission.broker_required", "This setting action requires Permission Broker authorization.");
  }
  const requiresConfirmation = [
    "explicit_confirmation",
    "permission_and_confirmation",
    "explicit_warning"
  ].some((requirement) => requirements.has(requirement as SettingPermissionRequirement));
  if (requiresConfirmation && !await confirm(confirmation)) {
    throw new PigeDomainError("permission.user_denied", "The user canceled the setting action.");
  }
}
