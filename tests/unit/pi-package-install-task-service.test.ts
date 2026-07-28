import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiPackageRegistrySummary } from "@pige/contracts";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  PermissionedExternalCapabilityRegistry,
  type PermissionedExternalCapabilityAdapter
} from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import {
  PiPackageInstallTaskService,
  type PiPackageInstallTaskRuntimeContext
} from "../../apps/desktop/src/main/services/pi-package-install-task-service";
import { createPigeTextToolResult } from "../../apps/desktop/src/main/services/pi-agent-tool-boundary";

const roots: string[] = [];
const request = {
  apiVersion: 1 as const,
  requestId: "pi_package_request_abcdefghijklmnop",
  expectedRegistryRevision: 0,
  packageName: "pige-synthetic-package",
  version: "1.2.3"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageInstallTaskService", () => {
  it("persists exact task authority, waits for the global confirmation, and adopts the terminal request", async () => {
    const fixture = createFixture();
    const execution = fixture.service.install(request, new AbortController().signal);

    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({
      status: "pending",
      confirmation: {
        effect: "install_unreviewed_package",
        owner: { kind: "pi_package_install_task" },
        presentation: {
          subject: { kind: "package_name", value: "pige-synthetic-package@1.2.3" }
        }
      }
    }));
    expect(fixture.execute).not.toHaveBeenCalled();
    const taskFiles = fs.readdirSync(path.join(fixture.appDataRoot, "pi-package-install-tasks"));
    expect(taskFiles).toHaveLength(1);
    const pendingRecord = JSON.parse(fs.readFileSync(
      path.join(fixture.appDataRoot, "pi-package-install-tasks", taskFiles[0]!),
      "utf8"
    ));
    expect(pendingRecord).toMatchObject({
      state: "pending",
      request,
      binding: {
        vaultId: fixture.context.vaultId,
        policyContextId: fixture.context.policyContextId,
        policyHash: fixture.context.policyHash
      }
    });
    expect(pendingRecord).not.toHaveProperty("clientTurnId");

    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected package confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });
    const result = await execution;
    expect(result).toMatchObject({
      apiVersion: 1,
      requestId: request.requestId,
      status: "installed_disabled",
      registry: { revision: 1, packages: [{ packageName: request.packageName, enabled: false }] }
    });
    expect(result.taskId).toMatch(/^pi_package_task_[a-z0-9]{32}$/u);
    expect(fixture.execute).toHaveBeenCalledTimes(1);

    const adopted = await fixture.service.install(request, new AbortController().signal);
    expect(adopted).toEqual(result);
    expect(fixture.execute).toHaveBeenCalledTimes(1);

    const restarted = fixture.restart();
    await expect(restarted.service.install(request, new AbortController().signal)).resolves.toEqual(result);
    expect(restarted.execute).not.toHaveBeenCalled();
    expect(restarted.confirmations.pending()).toMatchObject({ status: "none" });
  });

  it("denies before package execution and returns the authoritative registry", async () => {
    const fixture = createFixture();
    const execution = fixture.service.install(request, new AbortController().signal);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected package confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "deny"
    });

    await expect(execution).resolves.toMatchObject({
      status: "denied",
      registry: { revision: 0, packages: [] }
    });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("fails closed on registry, request, and private authority drift", async () => {
    const stale = createFixture({ revision: 2 });
    await expect(stale.service.install(request, new AbortController().signal)).resolves.toMatchObject({
      status: "stale",
      registry: { revision: 2 }
    });
    expect(stale.confirmations.pending()).toMatchObject({ status: "none" });
    expect(stale.execute).not.toHaveBeenCalled();

    const fixture = createFixture();
    const execution = fixture.service.install(request, new AbortController().signal);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected package confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "deny"
    });
    await execution;

    await expect(fixture.service.install(
      { ...request, version: "1.2.4" },
      new AbortController().signal
    )).resolves.toMatchObject({ status: "failed" });
    fixture.context.policyHash = digest("changed policy");
    await expect(fixture.service.install(request, new AbortController().signal)).resolves.toMatchObject({
      status: "failed"
    });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("rejects a stale task binding after confirmation but before package execution", async () => {
    const fixture = createFixture();
    let currentPolicyHash = fixture.context.policyHash;
    fixture.context.assertCurrent = vi.fn(() => {
      if (fixture.context.policyHash !== currentPolicyHash) throw new Error("stale policy");
    });
    const execution = fixture.service.install(request, new AbortController().signal);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    fixture.context.policyHash = digest("replacement policy");
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected package confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });

    await expect(execution).resolves.toMatchObject({ status: "failed" });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.confirmations.pending()).toMatchObject({ status: "none" });
    currentPolicyHash = fixture.context.policyHash;
  });

  it("rejects registry revision drift while confirmation is pending", async () => {
    const fixture = createFixture();
    const execution = fixture.service.install(request, new AbortController().signal);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    fixture.replaceRegistry({ apiVersion: 1, revision: 1, packages: [] });
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected package confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });

    const result = await execution;
    expect(result).toMatchObject({ status: "failed" });
    expect(result).not.toHaveProperty("registry");
    expect(fixture.execute).not.toHaveBeenCalled();
  });
});

function createFixture(input: { revision?: number } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-task-")));
  roots.push(root);
  const appDataRoot = path.join(root, "app-data");
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(appDataRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(vaultPath, { recursive: true, mode: 0o700 });
  const confirmations = new HighRiskConfirmationService();
  const broker = new PermissionBrokerService({
    rootPath: appDataRoot,
    assertWriterLease: (candidate) => {
      if (candidate !== vaultPath) throw new Error("stale vault");
    },
    confirmations
  });
  let registry: PiPackageRegistrySummary = {
    apiVersion: 1,
    revision: input.revision ?? 0,
    packages: []
  };
  const execute = vi.fn(async () => {
    registry = {
      apiVersion: 1,
      revision: registry.revision + 1,
      packages: [{
        packageId: "pkg_0123456789abcdef01234567",
        packageName: request.packageName,
        version: request.version,
        state: "installed_disabled",
        packageTypes: ["extension"],
        dependencyCount: 0,
        enabled: false,
        trust: "community",
        canUpdate: true,
        canRollback: false,
        rollbackTarget: null
      }]
    };
    return createPigeTextToolResult("installed", { status: "installed_disabled" });
  });
  const context: MutableContext = {
    vaultPath,
    vaultId: "vault_20260728_packagetask01",
    policyContextId: "policy_context_package_task",
    policyHash: digest("package policy"),
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    assertCurrent: vi.fn()
  };
  const makeService = () => {
    const capabilities = new PermissionedExternalCapabilityRegistry([packageAdapter(execute)], broker);
    return new PiPackageInstallTaskService({
      appDataRoot,
      capabilities,
      packageRegistry: { summary: () => registry },
      confirmations,
      currentContext: () => context
    });
  };
  return {
    appDataRoot,
    confirmations,
    context,
    execute,
    replaceRegistry: (next: PiPackageRegistrySummary) => {
      registry = next;
    },
    service: makeService(),
    restart: () => {
      const restartedConfirmations = new HighRiskConfirmationService();
      const restartedBroker = new PermissionBrokerService({
        rootPath: appDataRoot,
        assertWriterLease: () => undefined,
        confirmations: restartedConfirmations
      });
      const restartedExecute = vi.fn(execute.getMockImplementation()!);
      const capabilities = new PermissionedExternalCapabilityRegistry(
        [packageAdapter(restartedExecute)],
        restartedBroker
      );
      return {
        confirmations: restartedConfirmations,
        execute: restartedExecute,
        service: new PiPackageInstallTaskService({
          appDataRoot,
          capabilities,
          packageRegistry: { summary: () => registry },
          confirmations: restartedConfirmations,
          currentContext: () => context
        })
      };
    }
  };
}

type MutableContext = Omit<PiPackageInstallTaskRuntimeContext, "policyHash" | "assertCurrent"> & {
  policyHash: string;
  assertCurrent: ReturnType<typeof vi.fn>;
};

function packageAdapter(
  execute: PermissionedExternalCapabilityAdapter["execute"]
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "pige_install_pi_package",
      label: "Install Pi package",
      description: "Installs one exact package without executing it.",
      parameters: { type: "object", additionalProperties: false },
      outputSchema: { type: "object", additionalProperties: false },
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
      limits: { maxInputBytes: 1024, maxOutputBytes: 4096, timeoutMs: 180_000 },
      ownerService: "PiPackageManagerService"
    },
    actor: {
      type: "local_tool",
      id: "pige.pi-package-manager",
      displayName: "Pige Package Manager",
      version: "1.0.0",
      digest: digest("package actor")
    },
    action: { id: "package.install_exact_pi_package", version: "1", labelKey: "permissions.actions.install_pi_package" },
    permission: {
      capability: "install_package",
      dataBoundary: "network",
      resourceScope: "current_action",
      reasonCode: "package.install.exact",
      highRisk: (input) => {
        const value = input as { packageName: string; version: string };
        return {
          effect: "install_unreviewed_package",
          presentation: {
            action: "install_package",
            target: "local_toolchain",
            subject: { kind: "package_name", value: `${value.packageName}@${value.version}` }
          }
        };
      }
    },
    normalizeInput: (input) => {
      const value = input as { request_id: string; package_name: string; version: string };
      return { requestId: value.request_id, packageName: value.package_name, version: value.version };
    },
    resourceIdentity: (input) => input,
    resourceDisplayName: () => `${request.packageName}@${request.version}`,
    resourceCount: () => 1,
    execute
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
