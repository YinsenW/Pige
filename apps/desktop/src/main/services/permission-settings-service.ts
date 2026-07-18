import { PigeDomainError } from "@pige/domain";
import {
  PermissionMachineSettingsSchema,
  PermissionSettingsMutationResultSchema,
  PermissionSettingsSummarySchema,
  type PermissionMachineSettings,
  type PermissionSettingsMutationResult,
  type PermissionSettingsSummary
} from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export interface PermissionPolicyProjection {
  readonly defaultMode: PermissionSettingsSummary["defaultMode"];
  readonly yoloEnabled: boolean;
  readonly savedGrantSummaryRefs: readonly string[];
}

export interface PermissionAuthoritySnapshot extends PermissionPolicyProjection {
  readonly revision: number;
}

export class PermissionSettingsService {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  current(): PermissionSettingsSummary {
    return projectPermissionSettings(this.#settings.getPermissionSettings());
  }

  policyProjection(): PermissionPolicyProjection {
    const current = this.current();
    return {
      defaultMode: current.defaultMode,
      yoloEnabled: current.yoloEnabled,
      savedGrantSummaryRefs: current.savedGrants.map((grant) => grant.grantId).sort()
    };
  }

  authoritySnapshot(): PermissionAuthoritySnapshot {
    const current = this.current();
    return {
      revision: current.revision,
      defaultMode: current.defaultMode,
      yoloEnabled: current.yoloEnabled,
      savedGrantSummaryRefs: current.savedGrants.map((grant) => grant.grantId).sort()
    };
  }

  setDefaultMode(
    expectedRevision: number,
    defaultMode: "ask_every_time" | "remember_scoped_grants"
  ): PermissionSettingsMutationResult {
    return this.#mutate(expectedRevision, (current) => ({
      ...current,
      defaultMode,
      yoloEnabled: false,
      yoloFallbackMode: undefined
    }));
  }

  enableYolo(expectedRevision: number): PermissionSettingsMutationResult {
    return this.#mutate(expectedRevision, (current) => {
      if (current.yoloEnabled) return current;
      if (current.defaultMode === "yolo_full_access") throw permissionSettingsInvalid();
      return {
        ...current,
        defaultMode: "yolo_full_access",
        yoloEnabled: true,
        yoloFallbackMode: current.defaultMode
      };
    });
  }

  disableYolo(expectedRevision: number): PermissionSettingsMutationResult {
    return this.#mutate(expectedRevision, (current) => ({
      ...current,
      defaultMode: current.yoloFallbackMode ?? "ask_every_time",
      yoloEnabled: false,
      yoloFallbackMode: undefined
    }));
  }

  revokeGrant(expectedRevision: number, grantId: string): PermissionSettingsMutationResult {
    const current = this.#settings.getPermissionSettings();
    if (current.revision !== expectedRevision) return staleResult(current);
    if (!current.savedGrants.some((grant) => grant.grantId === grantId)) {
      return PermissionSettingsMutationResultSchema.parse({
        status: "not_found",
        settings: projectPermissionSettings(current)
      });
    }
    return this.#mutate(expectedRevision, (settings) => ({
      ...settings,
      savedGrants: settings.savedGrants.filter((grant) => grant.grantId !== grantId)
    }));
  }

  revokeAllGrants(expectedRevision: number): PermissionSettingsMutationResult {
    return this.#mutate(expectedRevision, (current) => ({ ...current, savedGrants: [] }));
  }

  assertYoloAuthority(expectedRevision: number): void {
    const current = this.#settings.getPermissionSettings();
    if (
      current.revision !== expectedRevision ||
      !current.yoloEnabled ||
      current.defaultMode !== "yolo_full_access"
    ) {
      throw new PigeDomainError(
        "permission.authority_revoked",
        "YOLO authority changed before the external action executed."
      );
    }
  }

  #mutate(
    expectedRevision: number,
    mutation: (settings: PermissionMachineSettings) => PermissionMachineSettings
  ): PermissionSettingsMutationResult {
    const result = this.#settings.mutatePermissionSettings(expectedRevision, (current) =>
      PermissionMachineSettingsSchema.parse(mutation(current))
    );
    return PermissionSettingsMutationResultSchema.parse({
      status: result.status,
      settings: projectPermissionSettings(result.settings)
    });
  }
}

function projectPermissionSettings(settings: PermissionMachineSettings): PermissionSettingsSummary {
  return PermissionSettingsSummarySchema.parse({
    apiVersion: 1,
    revision: settings.revision,
    defaultMode: settings.defaultMode,
    yoloEnabled: settings.yoloEnabled,
    savedGrants: settings.savedGrants
      .map((grant) => ({
        grantId: grant.grantId,
        actorType: grant.actorType,
        actorDisplayName: grant.actorDisplayName,
        capability: grant.capability,
        resourceScope: grant.resourceScope,
        resourceKind: grant.resourceKind,
        decisionScope: grant.decisionScope,
        createdAt: grant.createdAt,
        ...(grant.lastUsedAt ? { lastUsedAt: grant.lastUsedAt } : {})
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.grantId.localeCompare(right.grantId))
  });
}

function staleResult(settings: PermissionMachineSettings): PermissionSettingsMutationResult {
  return PermissionSettingsMutationResultSchema.parse({
    status: "stale",
    settings: projectPermissionSettings(settings)
  });
}

function permissionSettingsInvalid(): PigeDomainError {
  return new PigeDomainError("permission.settings_invalid", "Permission settings are internally inconsistent.");
}
