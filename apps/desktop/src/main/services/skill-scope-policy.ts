import type { SkillManifest } from "@pige/schemas";
import type { SkillRegistryService } from "./skill-registry-service";

export type InstalledSkillScope = "machine_local" | "vault";

export interface SkillRegistryRoutingPort {
  registryFor(scope: InstalledSkillScope, activeVaultId: string): SkillRegistryService;
  revisionFor(scope: InstalledSkillScope, activeVaultId: string): number;
}

export function withLegacySkillScope(
  input: object, fallbackScope: InstalledSkillScope, fallbackVault = "vault_19700101_legacy"
): object {
  const value = input as { readonly activeVaultId?: string; readonly scope?: InstalledSkillScope };
  return {
    ...input,
    activeVaultId: value.activeVaultId ?? fallbackVault,
    scope: value.scope ?? fallbackScope
  };
}

export function withLegacyActiveVault(input: object, fallback = "vault_19700101_legacy"): object {
  const value = input as { readonly activeVaultId?: string };
  return { ...input, activeVaultId: value.activeVaultId ?? fallback };
}

export function isAllowedStagedManifest(manifest: SkillManifest): manifest is SkillManifest & {
  readonly scope: InstalledSkillScope; readonly kind: "pure" | "external_web";
} {
  return (manifest.kind === "pure" || manifest.kind === "external_web") &&
    (manifest.scope === "machine_local" || (manifest.scope === "vault" && manifest.kind === "pure"));
}
