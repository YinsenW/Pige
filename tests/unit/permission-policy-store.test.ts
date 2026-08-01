import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";

const roots: string[] = [];
const REQUEST_ID = "permreq_20260729_0123456789abcdef0123456789abcdef";
const POLICY_REQUEST_ID = "permissionpolicyreq_20260729fullaccess";
const BINDING_DIGEST = `sha256:${"a".repeat(64)}` as const;
const CONFIRMATION = {
  apiVersion: 1 as const,
  confirmationId: "confirm_20260729_abcdefghijklmnop",
  effect: "arbitrary_shell" as const,
  presentation: {
    action: "run_shell_command" as const,
    target: "local_system" as const,
    subject: { kind: "executable_name" as const, value: "lark-cli" }
  },
  owner: { kind: "agent_turn" as const, clientTurnId: "turn_20260729_abcdefghijklmnop" }
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionPolicyStore", () => {
  it("privatizes a Pige-owned fresh app-data directory before creating policy state", () => {
    const parent = temporaryRoot();
    const root = path.join(parent, "electron-user-data");
    fs.mkdirSync(root, { mode: 0o755 });
    const store = new PermissionPolicyStore(root, vi.fn());

    expect(fs.statSync(root).mode & 0o077).toBe(0);
    expect(store.read()).toMatchObject({ revision: 0, defaultMode: "ask_every_time" });
    expect(store.agentRuntimePolicyContext()).toEqual({
      permissionMode: "ask_every_time",
      permissionPolicyRevision: 0
    });
  });

  it("restores the exact Agent authority context after restart", () => {
    const root = temporaryRoot();
    const first = new PermissionPolicyStore(root, vi.fn());
    expect(first.setDefaultMode(0, "remember_scoped_grants")).toBe("committed");

    const restarted = new PermissionPolicyStore(root, vi.fn());
    expect(restarted.agentRuntimePolicyContext()).toEqual({
      permissionMode: "remember_scoped_grants",
      permissionPolicyRevision: 1
    });
  });

  it("atomically restores one exact pending request without granting an effect", () => {
    const root = temporaryRoot();
    const assertWriterLease = vi.fn();
    const first = new PermissionPolicyStore(root, assertWriterLease);

    expect(first.read()).toEqual({
      revision: 0,
      defaultMode: "ask_every_time",
      grants: [],
      invalidGrantCount: 0,
      receipts: []
    });
    expect(first.register({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmation: CONFIRMATION
    })).toMatchObject({
      status: "registered",
      snapshot: {
        revision: 1,
        pending: {
          state: "pending",
          requestId: REQUEST_ID,
          bindingDigest: BINDING_DIGEST,
          revision: 1,
          confirmation: CONFIRMATION
        },
        receipts: []
      }
    });
    expect(assertWriterLease).toHaveBeenCalledTimes(3);

    fs.writeFileSync(path.join(root, "permission-policy", ".policy.json.abandoned.tmp"), "incomplete", {
      encoding: "utf8",
      mode: 0o600
    });
    const restarted = new PermissionPolicyStore(root, vi.fn());
    expect(restarted.read()).toEqual(first.read());
    expect(restarted.register({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmation: CONFIRMATION
    }).status).toBe("restored");
    expect(restarted.register({
      requestId: REQUEST_ID,
      bindingDigest: `sha256:${"b".repeat(64)}`,
      confirmation: CONFIRMATION
    }).status).toBe("busy");

    const record = JSON.parse(fs.readFileSync(path.join(root, "permission-policy", "policy.json"), "utf8"));
    expect(record).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      defaultMode: "ask_every_time",
      grants: [],
      pending: {
        state: "pending",
        requestId: REQUEST_ID,
        bindingDigest: BINDING_DIGEST,
        confirmation: CONFIRMATION
      },
      receipts: []
    });
  });

  it("persists one deterministic decision receipt and fails opposite replay stale", () => {
    const root = temporaryRoot();
    const store = new PermissionPolicyStore(root, vi.fn(), () => "2026-07-29T12:00:00.000Z");
    const registered = store.register({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmation: CONFIRMATION
    });
    expect(registered.status).toBe("registered");

    const committed = store.commitDecision({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: 1,
      decision: "allow"
    });
    expect(committed).toMatchObject({
      status: "committed",
      receipt: {
        state: "decided",
        id: expect.stringMatching(/^permdec_20260729_[a-f0-9]{32}$/u),
        schemaVersion: 1,
        permissionRequestId: REQUEST_ID,
        confirmationId: CONFIRMATION.confirmationId,
        confirmationRevision: 1,
        bindingHash: BINDING_DIGEST,
        revision: 2,
        decision: "allow_once",
        scope: "once",
        decidedBy: "user",
        autoAllowedBy: "none",
        decidedAt: "2026-07-29T12:00:00.000Z"
      },
      snapshot: { revision: 2, receipts: [{ decision: "allow_once" }] }
    });
    expect(committed.status === "committed" && committed.receipt.id)
      .toMatch(/^permdec_20260729_[a-f0-9]{32}$/u);

    const restarted = new PermissionPolicyStore(root, vi.fn());
    expect(restarted.read()).toEqual(committed.snapshot);
    expect(restarted.commitDecision({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: 1,
      decision: "allow"
    }).status).toBe("already_resolved");
    expect(restarted.commitDecision({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: 1,
      decision: "deny"
    })).toEqual({ status: "stale", snapshot: committed.snapshot });
  });

  it("rejects identity drift, unsafe roots, and stale withdrawal before mutation", () => {
    const root = temporaryRoot();
    const store = new PermissionPolicyStore(root, vi.fn());
    store.register({ requestId: REQUEST_ID, bindingDigest: BINDING_DIGEST, confirmation: CONFIRMATION });

    expect(store.commitDecision({
      requestId: REQUEST_ID,
      bindingDigest: `sha256:${"c".repeat(64)}`,
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: 1,
      decision: "allow"
    }).status).toBe("not_found");
    expect(store.withdraw({
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: 1,
      owner: { kind: "operation", operationId: "op_20260729_abcdefgh" }
    }).status).toBe("stale");
    expect(store.read().pending?.requestId).toBe(REQUEST_ID);

    const outside = temporaryRoot();
    const linked = path.join(root, "linked");
    fs.symlinkSync(outside, linked, "dir");
    expect(() => new PermissionPolicyStore(linked, vi.fn())).toThrow(/permission policy state/u);
  });

  it("enables Full Access only from the latest exact user decision and disables it directly", () => {
    const root = temporaryRoot();
    const now = vi.fn(() => "2026-07-29T12:00:00.000Z");
    const store = new PermissionPolicyStore(root, vi.fn(), now);
    expect(store.prepareFullAccessActivation({
      expectedRevision: 0,
      requestId: POLICY_REQUEST_ID,
      activeVaultId: "vault_20260729_permission01",
      confirmationId: CONFIRMATION.confirmationId
    })).toBe("registered");
    const registered = store.register({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmation: CONFIRMATION
    });
    if (registered.status !== "registered") throw new Error("Expected registration.");
    expect(store.commitDecision({
      requestId: REQUEST_ID,
      bindingDigest: BINDING_DIGEST,
      confirmationId: CONFIRMATION.confirmationId,
      expectedRevision: registered.snapshot.pending!.revision,
      decision: "allow"
    }).status).toBe("committed");
    expect(store.finishFullAccessDecision("confirm_20260729_wrongidentity123", "allow")).toBe("stale");
    expect(store.finishFullAccessDecision(CONFIRMATION.confirmationId, "allow")).toBe("committed");
    expect(store.summary("vault_20260729_permission01")).toMatchObject({
      revision: 4,
      defaultMode: "yolo_full_access",
      fullAccess: { enabled: true, enabledAt: "2026-07-29T12:00:00.000Z", canDisable: true },
      grants: []
    });

    const restarted = new PermissionPolicyStore(root, vi.fn(), now);
    expect(restarted.finishFullAccessDecision(CONFIRMATION.confirmationId, "allow")).toBe("committed");
    expect(restarted.setDefaultMode(4, "ask_every_time")).toBe("committed");
    expect(restarted.summary("vault_20260729_permission01")).toMatchObject({
      revision: 5,
      defaultMode: "ask_every_time",
      fullAccess: { enabled: false, canEnable: true }
    });
  });
});

function temporaryRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-permission-policy-")));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}
