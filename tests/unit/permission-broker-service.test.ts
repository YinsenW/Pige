import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionActionBinding } from "@pige/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPermissionActionBinding,
  createPermissionActionBinding,
  PermissionBrokerService,
  PermissionConfirmationRequiredError,
  type PermissionActionSummary
} from "../../apps/desktop/src/main/services/permission-broker-service";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { PermissionSettingsService } from "../../apps/desktop/src/main/services/permission-settings-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const VAULT_ID = "vault_20260714_permission01";
const OTHER_VAULT_ID = "vault_20260714_permission02";
const JOB_ID = "job_20260714_permission01";
const roots: string[] = [];

const summary: PermissionActionSummary = {
  actorDisplayName: "Synthetic Network Skill",
  actionLabelKey: "permissions.actions.syntheticNetwork",
  resourceKind: "url",
  resourceCount: 1,
  reasonCode: "external.network"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionBrokerService", () => {
  it("auto-authorizes only eligible desktop-local actions and binds the exact permission revision", () => {
    const fixture = createYoloFixture();
    const exact = binding();
    const approved = fixture.service.prepare(fixture.vaultPath, exact, summary);

    expect(approved).toMatchObject({ state: "approved", decision: "allow_once" });
    const decision = readJson(path.join(
      decisionDirectory(fixture.machineRoot, VAULT_ID),
      `${approved.decisionId}.json`
    ));
    expect(decision).toMatchObject({
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access",
      permissionSettingsRevision: 1
    });
    expect(fixture.service.consume(fixture.vaultPath, approved.id, exact).state).toBe("consumed");
    expect(() => fixture.service.assertExecutionAuthority(fixture.vaultPath, approved.id, exact)).not.toThrow();
  });

  it("revokes a YOLO decision before consume or adapter execution when settings change", () => {
    const fixture = createYoloFixture();
    const beforeConsumeBinding = binding();
    const beforeConsume = fixture.service.prepare(fixture.vaultPath, beforeConsumeBinding, summary);
    fixture.settings.disableYolo(1);
    expect(captureError(() => fixture.service.consume(
      fixture.vaultPath,
      beforeConsume.id,
      beforeConsumeBinding
    ))).toMatchObject({ code: "permission.authority_revoked" });

    fixture.settings.enableYolo(2);
    const beforeExecuteBinding = binding({
      jobId: "job_20260714_permissionexecute",
      actionInputHash: digest("execute fence")
    });
    const beforeExecute = fixture.service.prepare(fixture.vaultPath, beforeExecuteBinding, summary);
    fixture.service.consume(fixture.vaultPath, beforeExecute.id, beforeExecuteBinding);
    fixture.settings.disableYolo(3);
    expect(captureError(() => fixture.service.assertExecutionAuthority(
      fixture.vaultPath,
      beforeExecute.id,
      beforeExecuteBinding
    ))).toMatchObject({ code: "permission.authority_revoked" });
  });

  it("keeps remote, destructive, credential, and non-external capabilities pending under YOLO", () => {
    const fixture = createYoloFixture();
    const ineligible = [
      binding({ runtimeKind: "remote_agent_backend", clientCapabilityTier: "web_client" }),
      binding({
        jobId: "job_20260714_destructive",
        actionInputHash: digest("destructive"),
        capability: "run_shell",
        dataBoundary: "destructive"
      }),
      binding({
        jobId: "job_20260714_shell000",
        actionInputHash: digest("shell always confirms"),
        capability: "run_shell",
        dataBoundary: "local"
      }),
      binding({
        jobId: "job_20260714_credential",
        actionInputHash: digest("credential"),
        capability: "use_brokered_credential",
        dataBoundary: "brokered_credential"
      }),
      binding({
        jobId: "job_20260714_settings",
        actionInputHash: digest("settings"),
        capability: "change_settings",
        dataBoundary: "local"
      })
    ];

    for (const exact of ineligible) {
      expect(fixture.service.prepare(fixture.vaultPath, exact, summary).state).toBe("pending");
    }
  });

  it("rejects drift in every exact current-action binding fact", () => {
    const exact = binding();
    const variants: readonly Partial<BindingIdentity>[] = [
      { vaultId: OTHER_VAULT_ID },
      { jobId: "job_20260714_permission02" },
      { actorType: "package" },
      { actorId: "skill.synthetic.changed" },
      { actorVersion: "2.0.0" },
      { actorDigest: digest("changed actor") },
      { actionId: "network.fetch_changed" },
      { actionVersion: "2" },
      { actionInputHash: digest("changed input") },
      { capability: "external_filesystem" },
      { dataBoundary: "filesystem" },
      { resourceScope: "current_file" },
      { resourceIdentityHash: digest("changed resource") },
      { policyContextId: "policy_context_permission_changed" },
      { policyHash: digest("changed policy") },
      { runtimeKind: "remote_agent_backend" },
      { clientCapabilityTier: "web_client" }
    ];

    for (const variant of variants) {
      expect(captureError(() => assertPermissionActionBinding(exact, binding(variant))))
        .toMatchObject({ code: "permission.binding_changed" });
    }
  });

  it("binds the canonical action strictly and cancels an unresolved request when policy facts drift", () => {
    const fixture = createFixture();
    const exact = binding();
    const pending = fixture.service.prepare(fixture.vaultPath, exact, summary);

    expect(fixture.service.prepare(fixture.vaultPath, binding(), summary).id).toBe(pending.id);
    expect(binding().bindingHash).toBe(exact.bindingHash);

    const forged = { ...exact, policyHash: digest("forged policy") };
    expect(captureError(() => fixture.service.prepare(fixture.vaultPath, forged, summary)))
      .toMatchObject({ code: "permission.binding_changed" });
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("pending");

    const changed = binding({ policyHash: digest("changed policy") });
    const replacement = fixture.service.prepare(fixture.vaultPath, changed, summary);
    expect(replacement.id).not.toBe(pending.id);
    expect(replacement.binding.bindingHash).toBe(changed.bindingHash);
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("cancelled");
  });

  it("persists pending, allow-once, consumption, completion, and denial as strict lifecycle states", () => {
    const fixture = createFixture();
    const exact = binding();
    const pending = fixture.service.prepare(fixture.vaultPath, exact, summary);

    expect(pending.state).toBe("pending");
    expect(captureError(() => fixture.service.consume(fixture.vaultPath, pending.id, exact)))
      .toBeInstanceOf(PermissionConfirmationRequiredError);

    const allowed = fixture.service.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    });
    expect(allowed.lifecycle).toMatchObject({
      id: pending.id,
      state: "approved",
      decision: "allow_once",
      decisionId: allowed.decision.id
    });
    expect(allowed.decision).toMatchObject({
      decision: "allow_once",
      scope: "once",
      decidedBy: "user",
      autoAllowedBy: "none"
    });

    const consumed = fixture.service.consume(fixture.vaultPath, pending.id, exact);
    expect(consumed).toMatchObject({ state: "consumed", decision: "allow_once" });
    expect(consumed.consumedAt).toBeDefined();

    const completionMarkerHash = digest("synthetic completed action");
    const completed = fixture.service.markCompleted(
      fixture.vaultPath,
      pending.id,
      exact,
      completionMarkerHash
    );
    expect(completed).toMatchObject({
      state: "consumed",
      completionMarkerHash
    });
    expect(completed.completedAt).toBeDefined();
    expect(fixture.service.markCompleted(
      fixture.vaultPath,
      pending.id,
      exact,
      completionMarkerHash
    ).completedAt).toBe(completed.completedAt);
    expect(captureError(() => fixture.service.markCompleted(
      fixture.vaultPath,
      pending.id,
      exact,
      digest("different completion")
    ))).toMatchObject({ code: "permission.request_stale" });

    const deniedBinding = binding({
      jobId: "job_20260714_permissiondeny",
      actionInputHash: digest("denied input")
    });
    const deniedPending = fixture.service.prepare(fixture.vaultPath, deniedBinding, summary);
    const denied = fixture.service.commitDecision(fixture.vaultPath, {
      requestId: deniedPending.id,
      jobId: deniedBinding.jobId,
      decision: "deny"
    });
    expect(denied.lifecycle).toMatchObject({ state: "denied", decision: "deny" });
    expect(denied.decision.scope).toBe("never");
    expect(captureError(() => fixture.service.consume(
      fixture.vaultPath,
      deniedPending.id,
      deniedBinding
    ))).toBeInstanceOf(PermissionConfirmationRequiredError);
  });

  it("reconciles a committed decision after restart without making consumed authority reusable", () => {
    const fixture = createFixture();
    const exact = binding();
    const pending = fixture.service.prepare(fixture.vaultPath, exact, summary);
    const requestPath = lifecyclePath(fixture.machineRoot, VAULT_ID, pending.id);
    const originalRename = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (
        typeof source === "string" &&
        typeof target === "string" &&
        path.basename(source).startsWith(".tmp-") &&
        target === requestPath
      ) {
        throw Object.assign(new Error("synthetic crash after decision commit"), { code: "EIO" });
      }
      return originalRename(source, target);
    });
    try {
      expect(captureError(() => fixture.service.commitDecision(fixture.vaultPath, {
        requestId: pending.id,
        jobId: JOB_ID,
        decision: "allow_once"
      }))).toMatchObject({ code: "permission.store_invalid" });
    } finally {
      rename.mockRestore();
    }

    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("pending");
    expect(jsonFiles(decisionDirectory(fixture.machineRoot, VAULT_ID))).toHaveLength(1);

    expect(fixture.service.pending(fixture.vaultPath, pending.id)).toBeUndefined();
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("approved");
    const reopened = reopen(fixture.machineRoot);
    expect(reopened.reconcileCommittedDecisions(fixture.vaultPath)).toBe(0);
    expect(reopened.read(fixture.vaultPath, pending.id).state).toBe("approved");
    expect(reopened.consume(fixture.vaultPath, pending.id, exact).state).toBe("consumed");

    const afterSecondRestart = reopen(fixture.machineRoot);
    expect(afterSecondRestart.reconcileCommittedDecisions(fixture.vaultPath)).toBe(0);
    expect(captureError(() => afterSecondRestart.prepare(fixture.vaultPath, exact, summary)))
      .toMatchObject({ code: "permission.completion_uncertain" });
    expect(afterSecondRestart.read(fixture.vaultPath, pending.id).state).toBe("consumed");
  });

  it("rejects recovered saved-grant or YOLO authority for the current-action core", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
    const decisionId = deterministicDecisionId(pending.id, pending.createdAt);
    fs.writeFileSync(path.join(decisionDirectory(fixture.machineRoot, VAULT_ID), `${decisionId}.json`), `${JSON.stringify({
      id: decisionId,
      schemaVersion: 1,
      authorizationLayer: "permission_broker",
      permissionRequestId: pending.id,
      decision: "allow_once",
      scope: "once",
      resourceScope: "current_action",
      decidedBy: "system",
      autoAllowedBy: "yolo_full_access",
      decidedAt: new Date().toISOString()
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    const reopened = reopen(fixture.machineRoot);
    expect(captureError(() => reopened.reconcileCommittedDecisions(fixture.vaultPath)))
      .toMatchObject({ code: "permission.store_invalid" });
    expect(reopened.read(fixture.vaultPath, pending.id).state).toBe("pending");
  });

  it("revalidates already-approved decision authority and deterministic record identity", () => {
    const mutations = [
      (decision: Record<string, unknown>) => ({
        ...decision,
        decidedBy: "system",
        autoAllowedBy: "yolo_full_access"
      }),
      (decision: Record<string, unknown>) => ({
        ...decision,
        id: "permdec_20260714_craftedidentity01"
      })
    ];

    for (const mutate of mutations) {
      const fixture = createFixture();
      const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
      const allowed = fixture.service.commitDecision(fixture.vaultPath, {
        requestId: pending.id,
        jobId: JOB_ID,
        decision: "allow_once"
      });
      const decisionPath = path.join(
        decisionDirectory(fixture.machineRoot, VAULT_ID),
        `${allowed.decision.id}.json`
      );
      fs.writeFileSync(
        decisionPath,
        `${JSON.stringify(mutate(readJson(decisionPath)), null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 }
      );

      const reopened = reopen(fixture.machineRoot);
      expect(captureError(() => reopened.read(fixture.vaultPath, pending.id)))
        .toMatchObject({ code: "permission.store_invalid" });
      expect(captureError(() => reopened.prepare(fixture.vaultPath, binding(), summary)))
        .toMatchObject({ code: "permission.store_invalid" });
    }
  });

  it.skipIf(process.platform === "win32")("detects a decision-directory replacement before commit", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
    const decisions = decisionDirectory(fixture.machineRoot, VAULT_ID);
    const displaced = path.join(fixture.root, "displaced-decisions");
    const external = path.join(fixture.root, "external-decisions");
    fs.mkdirSync(external, { mode: 0o700 });
    let swapped = false;
    const guarded = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeCreateCommit(directory) {
          if (directory !== "decisions" || swapped) return;
          swapped = true;
          fs.renameSync(decisions, displaced);
          fs.symlinkSync(external, decisions);
        }
      }
    });

    expect(captureError(() => guarded.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    }))).toMatchObject({ code: "permission.store_invalid" });
    expect(fs.readdirSync(external)).toEqual([]);
    fs.unlinkSync(decisions);
    fs.renameSync(displaced, decisions);
  });

  it.skipIf(process.platform === "win32")("detects a request-directory replacement before lifecycle commit", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
    const requests = path.dirname(lifecyclePath(fixture.machineRoot, VAULT_ID, pending.id));
    const displaced = path.join(fixture.root, "displaced-requests-at-commit");
    const external = path.join(fixture.root, "external-requests-at-commit");
    fs.mkdirSync(external, { mode: 0o700 });
    let swapped = false;
    let successorName: string | undefined;
    const guarded = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeReplaceCommit(directory) {
          if (directory !== "requests" || swapped) return;
          swapped = true;
          fs.renameSync(requests, displaced);
          successorName = fs.readdirSync(displaced).find((name) => name.startsWith(".tmp-"));
          if (!successorName) throw new Error("Expected one exact temporary request record.");
          fs.writeFileSync(path.join(external, successorName), "successor-must-survive\n", {
            encoding: "utf8",
            mode: 0o600
          });
          fs.symlinkSync(external, requests);
        }
      }
    });

    expect(captureError(() => guarded.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    }))).toMatchObject({ code: "permission.store_invalid" });
    expect(successorName).toBeDefined();
    if (!successorName) throw new Error("Expected the successor temporary record name.");
    expect(fs.readFileSync(path.join(external, successorName), "utf8"))
      .toBe("successor-must-survive\n");
    fs.unlinkSync(requests);
    fs.renameSync(displaced, requests);
    expect(fixture.service.pending(fixture.vaultPath, pending.id)).toBeUndefined();
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("approved");
  });

  it.skipIf(process.platform === "win32")("rejects and preserves a same-name temporary successor before lifecycle commit", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
    const requests = path.dirname(lifecyclePath(fixture.machineRoot, VAULT_ID, pending.id));
    let successorPath: string | undefined;
    let successorBytes: Buffer | undefined;
    const guarded = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeReplaceCommit(directory) {
          if (directory !== "requests" || successorPath) return;
          const temporaryName = fs.readdirSync(requests).find((name) => name.startsWith(".tmp-"));
          if (!temporaryName) throw new Error("Expected one exact temporary request record.");
          successorPath = path.join(requests, temporaryName);
          const byteLength = fs.statSync(successorPath).size;
          fs.unlinkSync(successorPath);
          successorBytes = Buffer.alloc(byteLength, 0x78);
          fs.writeFileSync(successorPath, successorBytes, { mode: 0o600 });
        }
      }
    });

    expect(captureError(() => guarded.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    }))).toMatchObject({ code: "permission.store_invalid" });
    if (!successorPath || !successorBytes) throw new Error("Expected one same-name successor record.");
    expect(fs.readFileSync(successorPath)).toEqual(successorBytes);
    fs.unlinkSync(successorPath);
    expect(fixture.service.pending(fixture.vaultPath, pending.id)).toBeUndefined();
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("approved");
  });

  it.skipIf(process.platform === "win32")("reports directory durability failures instead of returning success", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding(), summary);
    let brokerCommitStarted = false;
    let durabilityFailureInjected = false;
    const guarded = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeCreateCommit(directory) {
          if (directory === "decisions") brokerCommitStarted = true;
        }
      }
    });
    const originalFsync = fs.fsyncSync.bind(fs);
    const fsync = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (
        brokerCommitStarted
        && !durabilityFailureInjected
        && fs.fstatSync(descriptor).isDirectory()
      ) {
        durabilityFailureInjected = true;
        throw Object.assign(new Error("synthetic directory durability failure"), { code: "EIO" });
      }
      return originalFsync(descriptor);
    });
    try {
      expect(captureError(() => guarded.commitDecision(fixture.vaultPath, {
        requestId: pending.id,
        jobId: JOB_ID,
        decision: "allow_once"
      }))).toMatchObject({ code: "permission.store_invalid" });
    } finally {
      fsync.mockRestore();
    }
    expect(fixture.service.pending(fixture.vaultPath, pending.id)).toBeUndefined();
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("approved");
  });

  it("fails closed for the wrong vault, Job, or exact action binding", () => {
    const fixture = createFixture();
    const otherVaultPath = createTestVault(
      fixture.root,
      "Permission Vault B",
      OTHER_VAULT_ID
    );
    const exact = binding();
    const pending = fixture.service.prepare(fixture.vaultPath, exact, summary);

    expect(captureError(() => fixture.service.prepare(
      fixture.vaultPath,
      binding({ vaultId: OTHER_VAULT_ID }),
      summary
    ))).toMatchObject({ code: "permission.request_stale" });
    expect(captureError(() => fixture.service.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: "job_20260714_wrongjob",
      decision: "allow_once"
    }))).toMatchObject({ code: "permission.request_stale" });
    expect(captureError(() => fixture.service.consume(
      fixture.vaultPath,
      pending.id,
      binding({ resourceIdentityHash: digest("different resource") })
    ))).toMatchObject({ code: "permission.binding_changed" });
    expect(captureError(() => fixture.service.read(otherVaultPath, pending.id)))
      .toMatchObject({ code: "permission.store_invalid" });
    expect(fixture.service.read(fixture.vaultPath, pending.id).state).toBe("pending");
  });

  it("stores bounded private body-free request and decision records", () => {
    const fixture = createFixture();
    const privateBody = "SYNTHETIC_PRIVATE_BODY_DO_NOT_PERSIST";
    const rawCredential = "SYNTHETIC_BEARER_DO_NOT_PERSIST";
    const exact = binding({
      actionInputHash: digest(privateBody),
      resourceIdentityHash: digest(rawCredential)
    });
    const pending = fixture.service.prepare(fixture.vaultPath, exact, summary);
    const allowed = fixture.service.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    });
    const requestPath = lifecyclePath(fixture.machineRoot, VAULT_ID, pending.id);
    const decisionPath = path.join(
      decisionDirectory(fixture.machineRoot, VAULT_ID),
      `${allowed.decision.id}.json`
    );
    const durableText = `${fs.readFileSync(requestPath, "utf8")}\n${fs.readFileSync(decisionPath, "utf8")}`;
    const durableRecords = [readJson(requestPath), readJson(decisionPath)];

    expect(Buffer.byteLength(durableText, "utf8")).toBeLessThan(64 * 1024);
    expect(durableText).not.toContain(privateBody);
    expect(durableText).not.toContain(rawCredential);
    expect(collectKeys(durableRecords)).not.toEqual(expect.arrayContaining([
      "body",
      "prompt",
      "arguments",
      "command",
      "credential",
      "secret",
      "token"
    ]));
    expect(readJson(requestPath)).toMatchObject({
      binding: {
        actionInputHash: digest(privateBody),
        resourceIdentityHash: digest(rawCredential)
      }
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(requestPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(requestPath)).mode & 0o777).toBe(0o700);
    }
  });

  it.skipIf(process.platform === "win32")("rejects symlinked machine roots, descendants, and request records", () => {
    const root = tempRoot("pige-permission-symlink-");
    const machineRoot = path.join(root, "machine");
    const externalRoot = path.join(root, "external");
    fs.mkdirSync(machineRoot, { mode: 0o700 });
    fs.mkdirSync(externalRoot, { mode: 0o700 });
    const vaultPath = createTestVault(root, "Symlink Vault", VAULT_ID);
    fs.symlinkSync(externalRoot, path.join(machineRoot, "permission-broker"));
    const symlinkedRoot = reopen(machineRoot);
    expect(captureError(() => symlinkedRoot.prepare(vaultPath, binding(), summary)))
      .toMatchObject({ code: "permission.store_invalid" });
    fs.unlinkSync(path.join(machineRoot, "permission-broker"));

    const safe = reopen(machineRoot);
    const pending = safe.prepare(vaultPath, binding(), summary);
    const requestDirectory = path.dirname(lifecyclePath(machineRoot, VAULT_ID, pending.id));
    const displacedRequests = path.join(root, "displaced-requests");
    fs.renameSync(requestDirectory, displacedRequests);
    fs.symlinkSync(externalRoot, requestDirectory);
    expect(captureError(() => safe.read(vaultPath, pending.id)))
      .toMatchObject({ code: "permission.store_invalid" });
    fs.unlinkSync(requestDirectory);
    fs.renameSync(displacedRequests, requestDirectory);

    const requestPath = lifecyclePath(machineRoot, VAULT_ID, pending.id);
    const displacedRecord = path.join(root, "displaced-request.json");
    fs.renameSync(requestPath, displacedRecord);
    fs.symlinkSync(displacedRecord, requestPath);
    expect(captureError(() => safe.read(vaultPath, pending.id)))
      .toMatchObject({ code: "permission.store_invalid" });
  });

  it.skipIf(process.platform === "win32")("rejects a machine root reached through a symlinked ancestor", () => {
    const root = tempRoot("pige-permission-ancestor-symlink-");
    const realParent = path.join(root, "real-parent");
    const aliasParent = path.join(root, "alias-parent");
    fs.mkdirSync(realParent, { mode: 0o700 });
    fs.symlinkSync(realParent, aliasParent);
    const machineRoot = path.join(aliasParent, "machine");
    fs.mkdirSync(path.join(realParent, "machine"), { mode: 0o700 });
    const vaultPath = createTestVault(root, "Ancestor Symlink Vault", VAULT_ID);
    const service = reopen(machineRoot);

    expect(captureError(() => service.prepare(vaultPath, binding(), summary)))
      .toMatchObject({ code: "permission.store_invalid" });
  });
});

type BindingIdentity = Omit<PermissionActionBinding, "bindingHash">;

function binding(overrides: Partial<BindingIdentity> = {}): PermissionActionBinding {
  return createPermissionActionBinding({
    vaultId: VAULT_ID,
    jobId: JOB_ID,
    actorType: "skill",
    actorId: "skill.synthetic.network",
    actorVersion: "1.0.0",
    actorDigest: digest("synthetic skill package"),
    actionId: "network.fetch",
    actionVersion: "1",
    actionInputHash: digest("synthetic action input"),
    capability: "external_network",
    dataBoundary: "network",
    resourceScope: "current_action",
    resourceIdentityHash: digest("https://example.invalid/current"),
    policyContextId: "policy_context_permission_test",
    policyHash: digest("permission policy"),
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    ...overrides
  });
}

function createFixture(): {
  readonly root: string;
  readonly machineRoot: string;
  readonly vaultPath: string;
  readonly service: PermissionBrokerService;
} {
  const root = tempRoot("pige-permission-broker-");
  const machineRoot = path.join(root, "machine");
  fs.mkdirSync(machineRoot, { mode: 0o700 });
  const vaultPath = createTestVault(root, "Permission Vault", VAULT_ID);
  return {
    root,
    machineRoot,
    vaultPath,
    service: reopen(machineRoot)
  };
}

function createYoloFixture(): ReturnType<typeof createFixture> & {
  readonly settings: PermissionSettingsService;
} {
  const fixture = createFixture();
  const settings = new PermissionSettingsService(new LocalSettingsStore(fixture.machineRoot));
  expect(settings.enableYolo(0).status).toBe("committed");
  return {
    ...fixture,
    settings,
    service: new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true,
      permissionSettings: settings
    })
  };
}

function reopen(machineRoot: string): PermissionBrokerService {
  return new PermissionBrokerService({ rootPath: machineRoot, unsafeAllowUnfenced: true });
}

function createTestVault(root: string, vaultName: string, vaultId: string): string {
  createVaultOnDisk({
    parentDirectory: path.join(root, "vaults"),
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  const vaultPath = path.join(root, "vaults", vaultName);
  const manifestPath = path.join(vaultPath, ".pige", "manifest.json");
  const manifest = readJson(manifestPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, vault_id: vaultId }, null, 2)}\n`, "utf8");
  return vaultPath;
}

function lifecyclePath(machineRoot: string, vaultId: string, requestId: string): string {
  return path.join(machineRoot, "permission-broker", vaultId, "requests", `${requestId}.json`);
}

function decisionDirectory(machineRoot: string, vaultId: string): string {
  return path.join(machineRoot, "permission-broker", vaultId, "decisions");
}

function deterministicDecisionId(requestId: string, createdAt: string): string {
  return `permdec_${createdAt.slice(0, 10).replaceAll("-", "")}_${createHash("sha256")
    .update(`pige.permission.decision.v1\0${requestId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function jsonFiles(directory: string): string[] {
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      collectKeys(item, keys);
    }
  }
  return keys;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected the action to fail closed.");
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function tempRoot(prefix: string): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}
