// This is the executable Requirement-ID format authority. Verification scripts
// may read this source constant, but must not maintain a second, divergent
// pattern. The controlled-area allowlist remains a separate traceability rule.
export const PIGE_REQUIREMENT_ID_PATTERN = /^PIGE-([A-Z][A-Z0-9]*)-(\d{3})$/;

export type PigeRequirementId = `PIGE-${Uppercase<string>}-${number}`;

export const PIGE_VAULT_SCHEMA_VERSION = 1;
export const PIGE_APP_MIN_VERSION = "0.1.0";
export const PIGE_DEFAULT_VAULT_NAME = "Pige Vault";
export const PIGE_VAULT_ID_PATTERN = /^vault_\d{8}_[a-z0-9]{6,}$/;

export type PigeVaultId = `vault_${string}`;

export type PigeRuntimeKind = "desktop_local" | "remote_agent_backend";

export type PigeClientCapabilityTier = "desktop_full" | "web_client" | "mobile_lite";

export class PigeDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PigeDomainError";
    this.code = code;
  }
}

export function isPigeRequirementId(value: string): value is PigeRequirementId {
  return PIGE_REQUIREMENT_ID_PATTERN.test(value);
}

export function isPigeVaultId(value: string): value is PigeVaultId {
  return PIGE_VAULT_ID_PATTERN.test(value);
}

export function createPigeVaultId(now: Date, randomSuffix: string): PigeVaultId {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomSuffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  if (suffix.length < 6) {
    throw new PigeDomainError("vault_id_suffix_invalid", "Vault ID suffix must contain at least 6 alphanumeric characters.");
  }
  return `vault_${date}_${suffix}`;
}
