import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import type { PermissionedExternalCapabilityAdapter } from "./permissioned-external-capability-service";
import { createPigeTextToolResult } from "./pi-agent-tool-boundary";
import {
  PiPackageManagerService,
  normalizePiPackageInstallRequest,
  type PiPackageInstallRequest,
  type PiPackageInstallSummary
} from "./pi-package-manager-service";

const ACTOR_DIGEST = `sha256:${createHash("sha256").update("pige.first_party.pi_package_manager.v1", "utf8").digest("hex")}`;

export function createPiPackageInstallCapabilityAdapter(
  packages: PiPackageManagerService
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_install_pi_package",
      label: "Install Pi package",
      description: "Installs one exact Pi npm package version into Pige-managed machine-local storage without running package code or lifecycle scripts. The package remains disabled until separately enabled.",
      parameters: strictObjectSchema({
        request_id: { type: "string", minLength: 8, maxLength: 120 },
        package_name: { type: "string", minLength: 1, maxLength: 128 },
        version: { type: "string", minLength: 5, maxLength: 64 }
      }, ["request_id", "package_name", "version"]),
      outputSchema: strictObjectSchema({
        status: { const: "installed_disabled" },
        packageId: { type: "string", pattern: "^pkg_[a-f0-9]{24}$" },
        packageName: { type: "string", minLength: 1, maxLength: 128 },
        version: { type: "string", minLength: 5, maxLength: 64 },
        revision: { type: "integer", minimum: 1 },
        packageTypes: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { enum: ["extension", "skill", "prompt", "theme"] }
        },
        dependencyCount: { type: "integer", minimum: 0, maximum: 256 },
        requiresEnable: { const: true }
      }, ["status", "packageId", "packageName", "version", "revision", "packageTypes", "dependencyCount", "requiresEnable"]),
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: {
        resourceScope: "none",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 1_024, maxOutputBytes: 4_096, timeoutMs: 180_000 },
      ownerService: "PiPackageManagerService"
    },
    actor: {
      type: "local_tool",
      id: "pige.pi-package-manager",
      displayName: "Pige Package Manager",
      version: "1.0.0",
      digest: ACTOR_DIGEST
    },
    action: {
      id: "package.install_exact_pi_package",
      version: "1",
      labelKey: "permissions.actions.install_pi_package"
    },
    permission: {
      capability: "install_package",
      dataBoundary: "network",
      resourceScope: "current_action",
      reasonCode: "package.install.exact",
      highRisk: (input) => ({
        effect: "install_unreviewed_package",
        presentation: {
          action: "install_package",
          target: "local_toolchain",
          subject: {
            kind: "package_name",
            value: `${(input as PiPackageInstallRequest).packageName}@${(input as PiPackageInstallRequest).version}`
          }
        }
      })
    },
    normalizeInput: normalizeInput,
    resourceIdentity: (input) => {
      const request = input as PiPackageInstallRequest;
      return { packageName: request.packageName, version: request.version };
    },
    resourceDisplayName: (input) => {
      const request = input as PiPackageInstallRequest;
      return `${request.packageName}@${request.version}`;
    },
    resourceCount: () => 1,
    execute: async (input, signal, _context, authority) => {
      const result = await packages.install(input as PiPackageInstallRequest, signal, authority);
      return resultForTool(result);
    },
    adoptCompleted: async (_completionMarkerHash, input, signal) => {
      signal.throwIfAborted();
      return resultForTool(packages.adopt(input as PiPackageInstallRequest));
    }
  };
}

function normalizeInput(args: unknown): PiPackageInstallRequest {
  const input = exactInput(args, ["request_id", "package_name", "version"]);
  if (typeof input.request_id !== "string" || typeof input.package_name !== "string" || typeof input.version !== "string") {
    throw new PigeDomainError("package.request_invalid", "Pi package install input is invalid.");
  }
  return normalizePiPackageInstallRequest({
    requestId: input.request_id,
    packageName: input.package_name,
    version: input.version
  });
}

function resultForTool(result: PiPackageInstallSummary) {
  const details = Object.freeze({ ...result });
  return createPigeTextToolResult(JSON.stringify(details), details);
}

function exactInput(args: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new PigeDomainError("package.request_invalid", "Pi package install input is invalid.");
  }
  const input = args as Record<string, unknown>;
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new PigeDomainError("package.request_invalid", "Pi package install input contains unsupported fields.");
  }
  return input;
}

function strictObjectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "object", additionalProperties: false, properties, required });
}
