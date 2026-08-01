import type {
  SkillExportResult, SkillLifecycleMutationResult, SkillRegistryQueryResult, SkillStageUpdateResult
} from "@pige/contracts";

export async function loadCurrentSkillRegistry(): Promise<SkillRegistryQueryResult | undefined> {
  const requestedVault = await window.pige.vault.current();
  if (!requestedVault) return undefined;
  const requestId = createRequestId();
  const result = await window.pige.skills.summary({ apiVersion: 1, requestId, activeVaultId: requestedVault.vaultId });
  const currentVault = await window.pige.vault.current();
  return (result.requestId === undefined || result.requestId === requestId) &&
    (result.activeVaultId === undefined || result.activeVaultId === requestedVault.vaultId) &&
    currentVault?.vaultId === requestedVault.vaultId ? result : undefined;
}

export async function currentSkillVaultId(): Promise<string | undefined> {
  return (await window.pige.vault.current())?.vaultId;
}

export function createSkillInstallRequestId(): `skillreq_${string}` {
  return `skillreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function createSkillLifecycleRequestId(): `skill_lifecycle_request_${string}` {
  return `skill_lifecycle_request_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function matchesSkillLifecycleIdentity(
  result: SkillLifecycleMutationResult | SkillExportResult | SkillStageUpdateResult,
  requestId: string, activeVaultId: string, scope: string, skillId: string
): boolean {
  return result.requestId === requestId && result.activeVaultId === activeVaultId &&
    (result.scope === undefined || result.scope === scope) && result.skillId === skillId;
}

function createRequestId(): `skill_lifecycle_request_${string}` {
  return `skill_lifecycle_request_${crypto.randomUUID().replaceAll("-", "")}`;
}
