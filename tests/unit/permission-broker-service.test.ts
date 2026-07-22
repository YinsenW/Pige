import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionActionBinding } from "@pige/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import {
  assertPermissionActionBinding,
  createPermissionActionBinding,
  PermissionBrokerService
} from "../../apps/desktop/src/main/services/permission-broker-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260722_authority01";
const JOB_ID = "job_20260722_authority01";
const OWNER = { kind: "agent_turn" as const, clientTurnId: "turn_20260722_abcdefghijklmnop" };

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionBrokerService AR1 authority", () => {
  it("authorizes an ordinary registered first-party action without any permission record", () => {
    const fixture = createFixture();
    const exact = binding({
      actorType: "local_tool",
      actorId: "pige.command-execution",
      capability: "run_shell",
      dataBoundary: "local"
    });

    expect(fixture.broker.authorizeTurnAction({ vaultPath: fixture.vaultPath, binding: exact }))
      .toEqual({ status: "authorized", binding: exact });
    expect(fixture.broker.listForJob(fixture.vaultPath, JOB_ID)).toEqual([]);
    expect(findJsonFiles(fixture.machineRoot)).toEqual([]);
  });

  it("does not let third-party or changed-boundary actions inherit submitted-turn authority", () => {
    const fixture = createFixture();
    for (const candidate of [
      binding({ actorType: "skill", actorId: "skill.external.shell", capability: "run_shell" }),
      binding({ actorType: "local_tool", actorId: "pige.command-execution", dataBoundary: "destructive" }),
      binding({ actorType: "local_tool", actorId: "pige.command-execution", runtimeKind: "remote_agent_backend", clientCapabilityTier: "web_client" })
    ]) {
      expect(() => fixture.broker.authorizeTurnAction({ vaultPath: fixture.vaultPath, binding: candidate }))
        .toThrowError(expect.objectContaining({ code: "permission.high_risk_classification_required" }));
    }
    expect(findJsonFiles(fixture.machineRoot)).toEqual([]);
  });

  it("registers one exact high-risk effect with the canonical owner and honors deny without a lifecycle record", async () => {
    const fixture = createFixture();
    const exact = binding({ actorType: "skill", actorId: "skill.external.shell", capability: "run_shell" });
    const request = {
      vaultPath: fixture.vaultPath,
      binding: exact,
      owner: OWNER,
      resolveHighRisk: () => "committed" as const,
      highRisk: {
        effect: "arbitrary_shell" as const,
        presentation: {
          action: "run_shell_command" as const,
          target: "local_system" as const,
          subject: { kind: "executable_name" as const, value: "lark-cli" }
        }
      }
    };

    const blocked = fixture.broker.authorizeTurnAction(request);
    expect(blocked).toMatchObject({ status: "confirmation_required", revision: 1 });
    if (blocked.status !== "confirmation_required") throw new Error("Expected confirmation.");
    expect(fixture.confirmations.pending()).toMatchObject({
      status: "pending",
      revision: blocked.revision,
      confirmation: { confirmationId: blocked.confirmationId, owner: OWNER, effect: "arbitrary_shell" }
    });

    await expect(fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: blocked.confirmationId,
      expectedRevision: blocked.revision,
      decision: "deny"
    })).resolves.toMatchObject({ status: "committed", decision: "deny" });
    expect(fixture.broker.authorizeTurnAction(request)).toMatchObject({ status: "denied" });
    expect(findJsonFiles(fixture.machineRoot)).toEqual([]);
  });

  it("returns exact one-use authority after canonical allow and rejects contradictory effect tuples", async () => {
    const fixture = createFixture();
    const exact = binding({ actorType: "package", actorId: "package.external.install", capability: "install_package", dataBoundary: "network" });
    const request = {
      vaultPath: fixture.vaultPath,
      binding: exact,
      owner: OWNER,
      resolveHighRisk: () => "committed" as const,
      highRisk: {
        effect: "install_unreviewed_package" as const,
        presentation: {
          action: "install_package" as const,
          target: "local_toolchain" as const,
          subject: { kind: "package_name" as const, value: "@larksuite/cli" }
        }
      }
    };
    const blocked = fixture.broker.authorizeTurnAction(request);
    if (blocked.status !== "confirmation_required") throw new Error("Expected confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: blocked.confirmationId,
      expectedRevision: blocked.revision,
      decision: "allow"
    });
    expect(fixture.broker.authorizeTurnAction(request)).toEqual({ status: "authorized", binding: exact });

    expect(() => fixture.broker.authorizeTurnAction({
      ...request,
      highRisk: {
        effect: "arbitrary_shell",
        presentation: {
          action: "run_shell_command",
          target: "local_system",
          subject: { kind: "executable_name", value: "node" }
        }
      }
    })).toThrowError(expect.objectContaining({ code: "permission.high_risk_classification_invalid" }));
  });

  it("preserves every exact path, scope, identity and policy fence in the binding hash", () => {
    const exact = binding();
    const variants: readonly Partial<BindingIdentity>[] = [
      { vaultId: "vault_20260722_authority02" },
      { jobId: "job_20260722_authority02" },
      { actorId: "skill.external.changed" },
      { actionInputHash: digest("changed input") },
      { resourceScope: "current_file" },
      { resourceIdentityHash: digest("changed resource") },
      { policyHash: digest("changed policy") },
      { runtimeKind: "remote_agent_backend", clientCapabilityTier: "web_client" }
    ];
    for (const variant of variants) {
      expect(() => assertPermissionActionBinding(exact, binding(variant)))
        .toThrowError(expect.objectContaining({ code: "permission.binding_changed" }));
    }
  });

  it("fails closed when the canonical confirmation owner is not wired", () => {
    const fixture = createFixture(false);
    expect(() => fixture.broker.authorizeTurnAction({
      vaultPath: fixture.vaultPath,
      binding: binding({ actorType: "skill", actorId: "skill.external.shell", capability: "run_shell" }),
      owner: OWNER,
      resolveHighRisk: () => "committed" as const,
      highRisk: {
        effect: "arbitrary_shell",
        presentation: {
          action: "run_shell_command",
          target: "local_system",
          subject: { kind: "executable_name", value: "node" }
        }
      }
    })).toThrowError(expect.objectContaining({ code: "permission.confirmation_owner_unavailable" }));
  });
});

type BindingIdentity = Omit<PermissionActionBinding, "bindingHash">;

function binding(overrides: Partial<BindingIdentity> = {}): PermissionActionBinding {
  return createPermissionActionBinding({
    vaultId: VAULT_ID,
    jobId: JOB_ID,
    actorType: "skill",
    actorId: "skill.external.network",
    actorVersion: "1.0.0",
    actorDigest: digest("actor"),
    actionId: "network.fetch",
    actionVersion: "1",
    actionInputHash: digest("input"),
    capability: "external_network",
    dataBoundary: "network",
    resourceScope: "current_action",
    resourceIdentityHash: digest("resource"),
    policyContextId: "policy_context_authority",
    policyHash: digest("policy"),
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    ...overrides
  });
}

function createFixture(withConfirmations = true): {
  machineRoot: string;
  vaultPath: string;
  confirmations: HighRiskConfirmationService;
  broker: PermissionBrokerService;
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ar1-authority-")));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(machineRoot);
  fs.mkdirSync(vaultPath);
  const confirmations = new HighRiskConfirmationService();
  const broker = new PermissionBrokerService({
    rootPath: machineRoot,
    unsafeAllowUnfenced: true,
    ...(withConfirmations ? { confirmations } : {})
  });
  return { machineRoot, vaultPath, confirmations, broker };
}

function findJsonFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".json"));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
