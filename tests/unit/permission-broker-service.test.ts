import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionActionBinding } from "@pige/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";
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

  it("routes a classified first-party shell action through canonical confirmation", async () => {
    const fixture = createFixture();
    const exact = binding({
      actorType: "local_tool",
      actorId: "pige.command-execution",
      capability: "run_shell",
      dataBoundary: "local"
    });
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
          subject: { kind: "executable_name" as const, value: "node" }
        }
      }
    };

    expect(fixture.broker.authorizeTurnAction(request)).toMatchObject({
      status: "confirmation_required",
      revision: 1
    });
    expect(fixture.confirmations.pending()).toMatchObject({
      status: "pending",
      confirmation: { effect: "arbitrary_shell" }
    });
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
          subject: { kind: "package_name" as const, value: "@larksuite/cli@1.0.72" }
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

  it("remembers one exact safe scope and auto-authorizes only a matching later action", async () => {
    const fixture = createFixture();
    fs.chmodSync(fixture.machineRoot, 0o700);
    const store = new PermissionPolicyStore(
      fixture.machineRoot,
      vi.fn(),
      () => "2026-07-29T12:00:00.000Z"
    );
    expect(store.setDefaultMode(0, "remember_scoped_grants")).toBe("committed");
    const confirmations = new HighRiskConfirmationService(store);
    const broker = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      confirmations
    });
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

    const blocked = broker.authorizeTurnAction(request);
    if (blocked.status !== "confirmation_required") throw new Error("Expected confirmation.");
    const pending = confirmations.pending();
    if (pending.status !== "pending" || !pending.rememberScopedGrant) {
      throw new Error("Expected a safe remembered-scope candidate.");
    }
    expect(pending.rememberScopedGrant).toMatchObject({
      scope: "resource_scope",
      safeScopeLabel: "Reviewed Skill - Current action"
    });
    await expect(confirmations.resolve({
      apiVersion: 1,
      confirmationId: blocked.confirmationId,
      expectedRevision: blocked.revision,
      decision: "allow",
      rememberScopedGrant: {
        decision: "allow_scoped",
        grantContextId: pending.rememberScopedGrant.grantContextId
      }
    })).resolves.toMatchObject({ status: "committed", decision: "allow" });
    expect(store.summary(VAULT_ID)).toMatchObject({
      defaultMode: "remember_scoped_grants",
      grants: [{ actorType: "skill", capability: "run_shell", canRevoke: true }]
    });

    const nextBinding = binding({
      actorType: "skill",
      actorId: "skill.external.shell",
      capability: "run_shell",
      actionInputHash: digest("next input")
    });
    expect(broker.authorizeTurnAction({ ...request, binding: nextBinding }))
      .toEqual({ status: "authorized", binding: nextBinding });
    expect(store.read().receipts.at(-1)).toMatchObject({
      decidedBy: "system",
      autoAllowedBy: "saved_grant",
      decision: "allow_once"
    });

    const summary = store.summary(VAULT_ID);
    expect(store.revokeGrant(summary.revision, summary.grants[0]!.grantId)).toBe("committed");
    expect(broker.authorizeTurnAction({
      ...request,
      binding: binding({
        actorType: "skill",
        actorId: "skill.external.shell",
        capability: "run_shell",
        actionInputHash: digest("third input")
      })
    })).toMatchObject({ status: "confirmation_required" });
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

  it("auto-authorizes eligible Full Access effects but retains every hard confirmation boundary", () => {
    const fixture = createFixture(true);
    const policyRoot = path.join(path.dirname(fixture.machineRoot), "policy");
    fs.mkdirSync(policyRoot, { mode: 0o700 });
    const store = new PermissionPolicyStore(policyRoot, vi.fn(), () => "2026-07-29T12:00:00.000Z");
    const confirmations = new HighRiskConfirmationService(store);
    const broker = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      confirmations
    });
    const seedBinding = binding();
    const seedConfirmation = {
      apiVersion: 1 as const,
      confirmationId: "confirm_20260729_yolofullaccess1234",
      effect: "arbitrary_shell" as const,
      presentation: {
        action: "run_shell_command" as const,
        target: "local_system" as const,
        subject: { kind: "executable_name" as const, value: "node" }
      },
      owner: OWNER
    };
    expect(store.prepareFullAccessActivation({
      expectedRevision: 0,
      requestId: "permissionpolicyreq_20260729fullaccess",
      activeVaultId: VAULT_ID,
      confirmationId: seedConfirmation.confirmationId
    })).toBe("registered");
    const registration = store.register({
      requestId: "permreq_20260729_abcdefabcdefabcdefabcdefabcd",
      bindingDigest: seedBinding.bindingHash,
      jobId: seedBinding.jobId,
      confirmation: seedConfirmation
    });
    if (registration.status !== "registered") throw new Error("Expected registration.");
    store.commitDecision({
      requestId: "permreq_20260729_abcdefabcdefabcdefabcdefabcd",
      bindingDigest: seedBinding.bindingHash,
      confirmationId: seedConfirmation.confirmationId,
      expectedRevision: registration.snapshot.pending!.revision,
      decision: "allow"
    });
    expect(store.finishFullAccessDecision(seedConfirmation.confirmationId, "allow")).toBe("committed");

    const ordinary = binding({
      capability: "run_shell",
      dataBoundary: "local",
      actionInputHash: digest("full access ordinary")
    });
    expect(broker.authorizeTurnAction({
      vaultPath: fixture.vaultPath,
      binding: ordinary,
      owner: OWNER,
      resolveHighRisk: () => "committed",
      highRisk: {
        effect: "arbitrary_shell",
        presentation: seedConfirmation.presentation
      }
    })).toEqual({ status: "authorized", binding: ordinary });
    expect(store.read().receipts.at(-1)).toMatchObject({
      autoAllowedBy: "yolo_full_access",
      decision: "allow_once"
    });

    const hardBoundaries = [
      {
        binding: binding({ capability: "change_pige_schema", actionInputHash: digest("protected authority") }),
        highRisk: {
          effect: "authority_boundary_change" as const,
          presentation: {
            action: "change_authority_boundary" as const,
            target: "authority_boundary" as const,
            subject: { kind: "display_name" as const, value: "Protected settings" }
          }
        }
      },
      {
        binding: binding({ capability: "external_filesystem", dataBoundary: "filesystem", actionInputHash: digest("overwrite") }),
        highRisk: {
          effect: "overwrite_user_original" as const,
          presentation: {
            action: "overwrite_original" as const,
            target: "user_owned_original" as const,
            subject: { kind: "display_name" as const, value: "Original file" }
          }
        }
      },
      {
        binding: binding({ capability: "external_filesystem", dataBoundary: "filesystem", actionInputHash: digest("external write") }),
        highRisk: {
          effect: "write_outside_authorized_root" as const,
          presentation: {
            action: "write_external_item" as const,
            target: "external_location" as const,
            subject: { kind: "display_name" as const, value: "External folder" }
          }
        }
      },
      {
        binding: binding({ capability: "use_brokered_credential", dataBoundary: "brokered_credential", actionInputHash: digest("secret") }),
        highRisk: {
          effect: "export_secret" as const,
          presentation: {
            action: "export_credential" as const,
            target: "credential_material" as const,
            subject: { kind: "display_name" as const, value: "Credential" }
          }
        }
      }
    ];
    for (const [index, candidate] of hardBoundaries.entries()) {
      expect(broker.authorizeTurnAction({
        vaultPath: fixture.vaultPath,
        binding: candidate.binding,
        owner: OWNER,
        resolveHighRisk: () => "committed",
        highRisk: candidate.highRisk
      }), `hard boundary ${index}`).toMatchObject({ status: "confirmation_required" });
      const pending = confirmations.pending();
      if (pending.status !== "pending") throw new Error("Expected a hard-boundary confirmation.");
      confirmations.withdraw({
        confirmationId: pending.confirmation.confirmationId,
        expectedRevision: pending.revision,
        owner: pending.confirmation.owner
      });
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
