import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelEgressApprovalRequestRecordSchema, type ModelEgressApprovalRequestRecord } from "@pige/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelEgressApprovalService,
  ModelEgressConfirmationRequiredError,
  type ModelEgressApprovalBinding
} from "../../apps/desktop/src/main/services/model-egress-approval-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ModelEgressApprovalService", () => {
  it("persists one exact approval, consumes it once, and requires a successor approval", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());
    expect(() => fixture.service.assertApproved(fixture.vaultPath, pending.id, binding()))
      .toThrowError(ModelEgressConfirmationRequiredError);

    const audited = fixture.service.bindAudit(
      fixture.vaultPath,
      pending.id,
      binding(),
      "op_20260714_egressaudit",
      digest("decision")
    );
    expect(audited.authorizationLayer).toBe("model_egress");
    expect(fixture.service.resolve(fixture.vaultPath, pending.id, "allow_once").state).toBe("approved");
    expect(fixture.service.resolve(fixture.vaultPath, pending.id, "allow_once").state).toBe("approved");
    expect(fixture.service.consume(fixture.vaultPath, pending.id, binding()).state).toBe("consumed");
    expect(() => fixture.service.consume(fixture.vaultPath, pending.id, binding()))
      .toThrowError(/cannot authorize/u);

    const successor = fixture.service.prepare(fixture.vaultPath, binding());
    expect(successor.id).not.toBe(pending.id);
    expect(successor.state).toBe("pending");
  });

  it("invalidates an old request when any bound model invocation fact drifts", () => {
    const fixture = createFixture();
    const first = fixture.service.prepare(fixture.vaultPath, binding());
    const changed = binding({ evidenceSummaryHash: digest("changed evidence") });
    const second = fixture.service.prepare(fixture.vaultPath, changed);

    expect(second.id).not.toBe(first.id);
    expect(fixture.service.read(fixture.vaultPath, first.id).state).toBe("invalidated");
    expect(() => fixture.service.assertApproved(fixture.vaultPath, first.id, binding()))
      .toThrowError(/cannot authorize/u);
  });

  it("recovers an approved request after restart without making the approval reusable", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());
    fixture.service.bindAudit(
      fixture.vaultPath,
      pending.id,
      binding(),
      "op_20260714_restartaudit",
      digest("restart decision")
    );
    fixture.service.resolve(fixture.vaultPath, pending.id, "allow_once");

    const reopened = new ModelEgressApprovalService({
      rootPath: fixture.root,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== fixture.vaultPath) throw new Error("unexpected vault");
      }
    });
    expect(reopened.listResolvable(fixture.vaultPath).map((record) => record.id)).toContain(pending.id);
    expect(reopened.consume(fixture.vaultPath, pending.id, binding()).state).toBe("consumed");
    expect(reopened.listResolvable(fixture.vaultPath).find((record) => record.id === pending.id)?.state)
      .toBe("consumed");
  });

  it("keeps denial terminal and rejects an opposite replay", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());
    fixture.service.bindAudit(
      fixture.vaultPath,
      pending.id,
      binding(),
      "op_20260714_deniedaudit",
      digest("denied decision")
    );
    expect(fixture.service.resolve(fixture.vaultPath, pending.id, "deny").state).toBe("denied");
    expect(fixture.service.resolve(fixture.vaultPath, pending.id, "deny").state).toBe("denied");
    expect(() => fixture.service.resolve(fixture.vaultPath, pending.id, "allow_once"))
      .toThrowError(/no longer pending/u);
  });

  it("blocks Provider deletion only while an exact egress reference is active", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());

    expect(() => fixture.service.assertProviderInactive(fixture.vaultPath, "provider_egress"))
      .toThrowError(/active model egress request/u);
    expect(() => fixture.service.assertProviderInactive(fixture.vaultPath, "provider_other"))
      .not.toThrow();

    fixture.service.invalidate(fixture.vaultPath, pending.id);
    expect(() => fixture.service.assertProviderInactive(fixture.vaultPath, "provider_egress"))
      .not.toThrow();
  });

  it("wakes one live invocation only after the durable decision commits", async () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());
    fixture.service.bindAudit(
      fixture.vaultPath,
      pending.id,
      binding(),
      "op_20260714_waiteraudit",
      digest("waiter decision")
    );
    const wait = fixture.service.waitForDecision(fixture.vaultPath, pending.id, binding());
    expect(fixture.service.hasLiveWaiter(pending.id)).toBe(true);
    await expect(fixture.service.waitForDecision(fixture.vaultPath, pending.id, binding()))
      .rejects.toMatchObject({ code: "model_egress.approval_conflict" });

    const approved = fixture.service.resolve(fixture.vaultPath, pending.id, "allow_once");
    await expect(wait).resolves.toMatchObject({ id: pending.id, state: "approved" });
    expect(approved.state).toBe("approved");
    expect(fixture.service.hasLiveWaiter(pending.id)).toBe(false);
  });

  it("fails a live invocation closed on denial or cancellation", async () => {
    const deniedFixture = createFixture();
    const denied = deniedFixture.service.prepare(deniedFixture.vaultPath, binding());
    deniedFixture.service.bindAudit(
      deniedFixture.vaultPath,
      denied.id,
      binding(),
      "op_20260714_waiterdeny",
      digest("waiter deny")
    );
    const deniedWait = deniedFixture.service.waitForDecision(deniedFixture.vaultPath, denied.id, binding());
    deniedFixture.service.resolve(deniedFixture.vaultPath, denied.id, "deny");
    await expect(deniedWait).rejects.toMatchObject({ code: "model_egress.denied" });

    const cancelledFixture = createFixture();
    const cancelled = cancelledFixture.service.prepare(cancelledFixture.vaultPath, binding());
    const controller = new AbortController();
    const cancelledWait = cancelledFixture.service.waitForDecision(
      cancelledFixture.vaultPath,
      cancelled.id,
      binding(),
      controller.signal
    );
    controller.abort();
    await expect(cancelledWait).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelledFixture.service.hasLiveWaiter(cancelled.id)).toBe(false);
  });

  it("stores only bounded body-free hashes in private machine-local files", () => {
    const fixture = createFixture();
    const pending = fixture.service.prepare(fixture.vaultPath, binding());
    const directory = approvalDirectory(fixture.root);
    const filePath = path.join(directory, `${pending.id}.json`);
    const bytes = fs.readFileSync(filePath, "utf8");

    expect(bytes.length).toBeLessThan(24 * 1024);
    expect(bytes).not.toContain("prompt");
    expect(bytes).not.toContain("answer");
    expect(bytes).not.toContain("apiKey");
    expect(bytes).not.toContain("Authorization");
    if (process.platform !== "win32") {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    }
  });

  it("fails closed without the active vault lease or through a symlinked machine root", () => {
    const fixture = createFixture();
    const leaseLost = new ModelEgressApprovalService({
      rootPath: fixture.root,
      assertWriterLease: () => { throw new Error("lease lost"); }
    });
    expect(() => leaseLost.prepare(fixture.vaultPath, binding())).toThrowError("lease lost");

    const external = tempRoot("pige-egress-external-");
    const unsafe = tempRoot("pige-egress-symlink-");
    fs.symlinkSync(external, path.join(unsafe, "model-egress"), "dir");
    const symlinked = new ModelEgressApprovalService({ rootPath: unsafe, unsafeAllowUnfenced: true });
    expect(() => symlinked.prepare(fixture.vaultPath, binding()))
      .toThrowError(/unavailable or unsafe/u);
  });

  it("rechecks the writer lease immediately before publishing a new approval record", () => {
    const fixture = createFixture();
    let leaseChecks = 0;
    const leaseLostAtCommit = new ModelEgressApprovalService({
      rootPath: fixture.root,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== fixture.vaultPath) throw new Error("unexpected vault");
        leaseChecks += 1;
        if (leaseChecks > 1) throw new Error("lease lost before approval commit");
      }
    });

    expect(() => leaseLostAtCommit.prepare(fixture.vaultPath, binding()))
      .toThrowError(/unavailable or unsafe/u);
    const directory = approvalDirectory(fixture.root);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([]);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
  });

  it("reclaims only reconciled terminal records for the same vault before creating a successor", () => {
    const fixture = createFixture();
    const otherVaultPath = createTestVault(fixture.root, "Approval Vault B", "vault_20260714_egress02");
    const sharedService = new ModelEgressApprovalService({
      rootPath: fixture.root,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== fixture.vaultPath && vaultPath !== otherVaultPath) throw new Error("unexpected vault");
      }
    });
    const otherVaultRecord = sharedService.prepare(otherVaultPath, binding({
      vaultId: "vault_20260714_egress02",
      jobId: "job_20260714_othervault",
      payloadHash: digest("other vault")
    }));
    const otherVaultPathOnDisk = path.join(
      approvalDirectory(fixture.root, "vault_20260714_egress02"),
      `${otherVaultRecord.id}.json`
    );
    const otherVaultBytes = fs.readFileSync(otherVaultPathOnDisk);
    const { directory } = populateApprovalStore(fixture, { reconciled: true });

    const successor = sharedService.prepare(fixture.vaultPath, binding({
      jobId: "job_20260714_capacitysuccessor",
      payloadHash: digest("capacity successor")
    }));
    const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));

    expect(successor.state).toBe("pending");
    expect(names).toHaveLength(512);
    expect(fs.readFileSync(otherVaultPathOnDisk)).toEqual(otherVaultBytes);
    expect(() => sharedService.prepare(fixture.vaultPath, binding({
      vaultId: "vault_20260714_egress02",
      jobId: "job_20260714_wrongvault",
      payloadHash: digest("wrong vault")
    }))).toThrowError(/vault identity changed/u);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".json"))).toHaveLength(512);
  });

  it("fails closed at capacity rather than deleting unreconciled terminal decisions", () => {
    const fixture = createFixture();
    const { directory } = populateApprovalStore(fixture, { reconciled: false });

    expect(() => fixture.service.prepare(fixture.vaultPath, binding({
      jobId: "job_20260714_capacityblocked",
      payloadHash: digest("capacity blocked")
    }))).toThrowError(/full of unreconciled/u);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".json"))).toHaveLength(512);
  });

  it("rechecks the writer lease immediately before retiring a reconciled record", () => {
    const fixture = createFixture();
    const { directory } = populateApprovalStore(fixture, { reconciled: true });
    const before = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
    let leaseChecks = 0;
    const leaseLostAtRetirement = new ModelEgressApprovalService({
      rootPath: fixture.root,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== fixture.vaultPath) throw new Error("unexpected vault");
        leaseChecks += 1;
        if (leaseChecks > 1) throw new Error("lease lost before approval retirement");
      }
    });

    expect(() => leaseLostAtRetirement.prepare(fixture.vaultPath, binding({
      jobId: "job_20260714_retirementlease",
      payloadHash: digest("retirement lease")
    }))).toThrowError(/unavailable or unsafe/u);
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()).toEqual(before);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith(".retire-"))).toEqual([]);
  });

  it("preserves a same-name successor if a prunable record changes at cleanup commit", () => {
    const fixture = createFixture();
    const { records } = populateApprovalStore(fixture, { reconciled: true });
    const first = [...records].sort((left, right) => left.id.localeCompare(right.id))[0]!;
    const successorRecord = ModelEgressApprovalRequestRecordSchema.parse({
      ...first,
      payloadHash: digest("same-name cleanup successor")
    });
    const originalRename = fs.renameSync.bind(fs);
    let replaced = false;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (
        !replaced &&
        typeof source === "string" &&
        typeof target === "string" &&
        source.endsWith(`${first.id}.json`) &&
        path.basename(target).startsWith(".retire-")
      ) {
        fs.unlinkSync(source);
        fs.writeFileSync(source, serializeApprovalRecord(successorRecord), { mode: 0o600 });
        replaced = true;
      }
      return originalRename(source, target);
    });
    try {
      expect(() => fixture.service.prepare(fixture.vaultPath, binding({
        jobId: "job_20260714_capacityrace",
        payloadHash: digest("capacity race")
      }))).toThrowError(/revision changed/u);
    } finally {
      rename.mockRestore();
    }

    expect(replaced).toBe(true);
    expect(fixture.service.read(fixture.vaultPath, first.id).payloadHash)
      .toBe(successorRecord.payloadHash);
  });
});

function createFixture(): {
  readonly root: string;
  readonly vaultPath: string;
  readonly service: ModelEgressApprovalService;
} {
  const root = tempRoot("pige-egress-approval-");
  const vaultPath = createTestVault(root, "Approval Vault", "vault_20260714_egress01");
  return {
    root,
    vaultPath,
    service: new ModelEgressApprovalService({
      rootPath: root,
      assertWriterLease: (currentVaultPath) => {
        if (currentVaultPath !== vaultPath) throw new Error("unexpected vault");
      }
    })
  };
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
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    ...manifest,
    vault_id: vaultId
  }, null, 2)}\n`, "utf8");
  return vaultPath;
}

function binding(overrides: Partial<ModelEgressApprovalBinding> = {}): ModelEgressApprovalBinding {
  return {
    jobId: "job_20260714_egress01",
    vaultId: "vault_20260714_egress01",
    providerProfileId: "provider_egress",
    modelProfileId: "model_egress",
    providerIdentityHash: digest("provider"),
    modelIdentityHash: digest("model"),
    policyHash: digest("policy"),
    payloadHash: digest("payload"),
    evidenceSummaryHash: digest("evidence"),
    baseDecisionHash: digest("base decision"),
    reasonCode: "sensitive_confirmation",
    contentClasses: ["sensitive"],
    payloadCharacters: 256,
    estimatedPayloadTokens: 64,
    normalPayloadCharacterLimit: 8_000,
    ...overrides
  };
}

function populateApprovalStore(
  fixture: ReturnType<typeof createFixture>,
  options: { readonly reconciled: boolean }
): { readonly directory: string; readonly records: readonly ModelEgressApprovalRequestRecord[] } {
  const seedBinding = binding({ jobId: "job_20260714_capacityseed", payloadHash: digest("capacity seed") });
  const seed = fixture.service.prepare(fixture.vaultPath, seedBinding);
  fixture.service.bindAudit(
    fixture.vaultPath,
    seed.id,
    seedBinding,
    "op_20260714_capacityseed",
    digest("capacity decision")
  );
  fixture.service.resolve(fixture.vaultPath, seed.id, "deny");
  const terminal = options.reconciled
    ? fixture.service.markReconciled(fixture.vaultPath, seed.id)
    : fixture.service.read(fixture.vaultPath, seed.id);
  const directory = approvalDirectory(fixture.root);
  fs.unlinkSync(path.join(directory, `${seed.id}.json`));
  const records = Array.from({ length: 512 }, (_, index) => ModelEgressApprovalRequestRecordSchema.parse({
    ...terminal,
    id: `egressreq_20260714_${index.toString(36).padStart(16, "0")}`
  }));
  for (const record of records) {
    fs.writeFileSync(path.join(directory, `${record.id}.json`), serializeApprovalRecord(record), { mode: 0o600 });
  }
  return { directory, records };
}

function approvalDirectory(root: string, vaultId = "vault_20260714_egress01"): string {
  return path.join(root, "model-egress", "model-egress-approvals", vaultId);
}

function serializeApprovalRecord(record: ModelEgressApprovalRequestRecord): string {
  return `${JSON.stringify(ModelEgressApprovalRequestRecordSchema.parse(record), null, 2)}\n`;
}

function digest(value: string): string {
  return `sha256:${Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
