import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";

const roots: string[] = [];
const REQUEST_ID = "permreq_20260729_0123456789abcdef0123456789abcdef";
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
});

function temporaryRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-permission-policy-")));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}
