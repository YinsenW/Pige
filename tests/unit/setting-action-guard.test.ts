import { describe, expect, it, vi } from "vitest";
import { guardSettingAction } from "../../apps/desktop/src/main/services/setting-action-guard";

const prompt = {
  title: "Confirm",
  message: "Confirm this action.",
  confirmLabel: "Continue"
};

describe("setting action guard", () => {
  it("consumes the registry and requires confirmation for database reset", async () => {
    const confirm = vi.fn(async () => true);
    await guardSettingAction(["maintenance.localDatabaseReset"], prompt, confirm);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("uses one confirmation for provider metadata plus secret storage", async () => {
    const confirm = vi.fn(async () => true);
    await guardSettingAction(["models.providerProfiles", "models.providerApiKeys"], prompt, confirm);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("fails closed when confirmation is canceled or a registry key is missing", async () => {
    await expect(guardSettingAction(["maintenance.localDatabaseReset"], prompt, async () => false))
      .rejects.toMatchObject({ code: "permission.user_denied" });
    await expect(guardSettingAction(["missing.setting"], prompt, async () => true))
      .rejects.toMatchObject({ code: "settings.registry_missing" });
  });

  it("does not invent a confirmation for a no-permission setting", async () => {
    const confirm = vi.fn(async () => true);
    await guardSettingAction(["app.locale"], prompt, confirm);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("fails closed for a Permission Broker requirement until a broker decision exists", async () => {
    await expect(guardSettingAction(["sensitive.setting"], prompt, async () => true, {
      entries: [{
        key: "sensitive.setting",
        page: "Permissions",
        scope: "machine_local",
        owner: "Permission Broker",
        storage: "OS app data",
        backedUpByDefault: false,
        applyBehavior: "immediate",
        permissionRequirement: "permission_broker"
      }]
    })).rejects.toMatchObject({ code: "permission.broker_required" });
  });
});
