import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionFullAccessService } from "../../apps/desktop/src/main/services/permission-full-access-service";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";

const VAULT_ID = "vault_20260729_fullaccess01";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionFullAccessService", () => {
  it("enables only after the exact durable second confirmation and disables through ordinary CAS", async () => {
    const fixture = createFixture();
    const requested = fixture.service.request(request());
    expect(requested).toMatchObject({ status: "confirmation_required" });
    expect(fixture.store.summary(VAULT_ID)).toMatchObject({
      defaultMode: "ask_every_time",
      fullAccess: { enabled: false, canEnable: false }
    });
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected Full Access confirmation.");
    expect(pending.confirmation).toMatchObject({
      effect: "authority_boundary_change",
      owner: { kind: "permission_policy", policyRequestId: request().requestId }
    });

    await expect(fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    })).resolves.toMatchObject({ status: "committed", decision: "allow" });
    expect(fixture.store.summary(VAULT_ID)).toMatchObject({
      defaultMode: "yolo_full_access",
      fullAccess: { enabled: true, enabledAt: "2026-07-29T12:00:00.000Z", canDisable: true }
    });
    expect(fixture.store.setDefaultMode(fixture.store.read().revision, "ask_every_time")).toBe("committed");
    expect(fixture.store.summary(VAULT_ID)).toMatchObject({
      defaultMode: "ask_every_time",
      fullAccess: { enabled: false, canEnable: true }
    });
  });

  it("rebinds a crash-restored prompt and adopts deny exactly once without enabling", async () => {
    const root = temporaryRoot();
    const first = createFixture(root);
    expect(first.service.request(request()).status).toBe("confirmation_required");

    const restarted = createFixture(root);
    restarted.service.restore();
    const pending = restarted.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected restored Full Access confirmation.");
    await expect(restarted.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "deny"
    })).resolves.toMatchObject({ status: "committed", decision: "deny" });
    expect(restarted.store.summary(VAULT_ID)).toMatchObject({
      defaultMode: "ask_every_time",
      fullAccess: { enabled: false, canEnable: true }
    });
    expect(restarted.service.request(request({ expectedRevision: restarted.store.read().revision })).status)
      .toBe("confirmation_required");
  });

  it("fails closed on vault or revision drift before registering a prompt", () => {
    const activeVault = { value: VAULT_ID };
    const fixture = createFixture(undefined, activeVault);
    activeVault.value = "vault_20260729_fullaccess02";
    expect(fixture.service.request(request())).toEqual({ status: "stale" });
    expect(fixture.confirmations.pending()).toMatchObject({ status: "none", revision: 0 });
    activeVault.value = VAULT_ID;
    expect(fixture.service.request(request({ expectedRevision: 1 }))).toEqual({ status: "stale" });
    expect(fixture.store.read().revision).toBe(0);
  });

  it("replaces an orphaned activation instead of permanently locking permission modes", () => {
    const fixture = createFixture();
    expect(fixture.store.prepareFullAccessActivation({
      expectedRevision: 0,
      requestId: "permissionpolicyreq_20260729orphaned",
      activeVaultId: VAULT_ID,
      confirmationId: "confirm_20260729_orphanedactivation"
    })).toBe("registered");
    expect(fixture.store.summary(VAULT_ID)).toMatchObject({
      revision: 1,
      defaultMode: "ask_every_time",
      fullAccess: { enabled: false, canEnable: false }
    });

    expect(fixture.service.request(request({ expectedRevision: 1 }))).toMatchObject({
      status: "confirmation_required"
    });
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected replacement Full Access confirmation.");
    expect(pending.confirmation.owner).toEqual({
      kind: "permission_policy",
      policyRequestId: request().requestId
    });
  });

  it("reports an active confirmation as authoritative stale state instead of a generic failure", () => {
    const fixture = createFixture();
    expect(fixture.service.request(request())).toMatchObject({ status: "confirmation_required" });
    const revision = fixture.store.read().revision;

    expect(fixture.service.request({
      ...request({ expectedRevision: revision }),
      requestId: "permissionpolicyreq_20260729secondtry"
    })).toEqual({ status: "stale" });
    expect(fixture.confirmations.pending()).toMatchObject({
      status: "pending",
      confirmation: { owner: { kind: "permission_policy", policyRequestId: request().requestId } }
    });
  });
});

function request(overrides: { expectedRevision?: number } = {}) {
  return {
    apiVersion: 1 as const,
    requestId: "permissionpolicyreq_20260729fullaccess",
    activeVaultId: VAULT_ID,
    expectedRevision: overrides.expectedRevision ?? 0,
    mode: "yolo_full_access" as const,
    fullAccessAcknowledgement: {
      kind: "yolo_full_access" as const,
      explicitUserAction: true as const,
      hardBoundariesAcknowledged: true as const
    }
  };
}

function createFixture(
  root = temporaryRoot(),
  activeVault = { value: VAULT_ID }
): {
  store: PermissionPolicyStore;
  confirmations: HighRiskConfirmationService;
  service: PermissionFullAccessService;
} {
  const store = new PermissionPolicyStore(root, vi.fn(), () => "2026-07-29T12:00:00.000Z");
  const confirmations = new HighRiskConfirmationService(store);
  const service = new PermissionFullAccessService({
    store,
    confirmations,
    activeVaultId: () => activeVault.value
  });
  return { store, confirmations, service };
}

function temporaryRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-full-access-")));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}
