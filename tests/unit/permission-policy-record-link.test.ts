import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";
import { PermissionPolicyRecordLink } from "../../apps/desktop/src/main/services/permission-policy-record-link";
import { OperationRecordSchema } from "@pige/schemas";

const roots: string[] = [];
const VAULT_ID = "vault_20260729_abcdefghijklmnop";
const JOB_ID = "job_20260729_abcdefghijklmnop";
const OPERATION_ID = "op_20260729_abcdefgh";
const REQUEST_ID = "permreq_20260729_0123456789abcdef0123456789abcdef";
const DECISION_ID = "permdec_20260729_0123456789abcdef0123456789abcdef";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionPolicyRecordLink", () => {
  it("idempotently appends pending and decision identities to one existing Job and Operation", () => {
    const vaultPath = createVault();
    const assertWriterLease = vi.fn();
    const jobStore = new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige", "jobs"),
      assertWriterLease: () => assertWriterLease(vaultPath)
    });
    const jobPath = path.join(vaultPath, ".pige", "jobs", "2026", "07", `${JOB_ID}.json`);
    jobStore.createIfAbsent(jobPath, {
      schemaVersion: 1,
      id: JOB_ID,
      class: "agent_turn",
      state: "waiting_permission",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      activeVaultId: VAULT_ID,
      actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      message: "Waiting for permission."
    });
    const operationPath = createOperation(vaultPath);
    const link = new PermissionPolicyRecordLink({
      activeVault: () => ({ vaultId: VAULT_ID, vaultPath }),
      assertWriterLease,
      now: () => "2026-07-29T12:00:01.000Z"
    });

    link.recordPending({ requestId: REQUEST_ID, jobId: JOB_ID });
    link.recordPending({ requestId: REQUEST_ID, jobId: JOB_ID });
    link.recordDecision({
      requestId: REQUEST_ID,
      decisionId: DECISION_ID,
      jobId: JOB_ID,
      operationId: OPERATION_ID
    });
    link.recordDecision({
      requestId: REQUEST_ID,
      decisionId: DECISION_ID,
      jobId: JOB_ID,
      operationId: OPERATION_ID
    });

    expect(jobStore.read(jobPath).job).toMatchObject({
      permissionRequestIds: [REQUEST_ID],
      permissionDecisionIds: [DECISION_ID],
      updatedAt: "2026-07-29T12:00:01.001Z"
    });
    expect(OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath, "utf8"))))
      .toMatchObject({ permissionDecisionIds: [DECISION_ID] });
    expect(assertWriterLease).toHaveBeenCalled();
  });

  it("keeps legacy records readable and fails vault or Job identity drift before mutation", () => {
    const vaultPath = createVault();
    const jobStore = new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige", "jobs"),
      unsafeAllowUnfenced: true
    });
    const jobPath = path.join(vaultPath, ".pige", "jobs", "2026", "07", `${JOB_ID}.json`);
    const legacy = jobStore.createIfAbsent(jobPath, {
      schemaVersion: 1,
      id: JOB_ID,
      class: "agent_turn",
      state: "running",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      activeVaultId: VAULT_ID,
      message: "Running."
    }).job;
    expect(legacy.permissionRequestIds).toBeUndefined();
    expect(legacy.permissionDecisionIds).toBeUndefined();

    const drifted = new PermissionPolicyRecordLink({
      activeVault: () => ({ vaultId: "vault_20260729_differentvault", vaultPath }),
      assertWriterLease: vi.fn()
    });
    expect(() => drifted.recordPending({ requestId: REQUEST_ID, jobId: JOB_ID }))
      .toThrow(/audit record binding changed/u);
    expect(jobStore.read(jobPath).job).toEqual(legacy);
  });

  it("rejects a missing or differently bound Operation before mutating the Job", () => {
    const vaultPath = createVault();
    const jobStore = new JobRecordStore({
      rootPath: path.join(vaultPath, ".pige", "jobs"),
      unsafeAllowUnfenced: true
    });
    const jobPath = path.join(vaultPath, ".pige", "jobs", "2026", "07", `${JOB_ID}.json`);
    const originalJob = jobStore.createIfAbsent(jobPath, {
      schemaVersion: 1,
      id: JOB_ID,
      class: "agent_turn",
      state: "waiting_permission",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      activeVaultId: VAULT_ID,
      message: "Waiting for permission."
    }).job;
    const link = new PermissionPolicyRecordLink({
      activeVault: () => ({ vaultId: VAULT_ID, vaultPath }),
      assertWriterLease: vi.fn()
    });

    expect(() => link.recordDecision({
      requestId: REQUEST_ID,
      decisionId: DECISION_ID,
      jobId: JOB_ID,
      operationId: OPERATION_ID
    })).toThrow(/audit record binding changed/u);
    expect(jobStore.read(jobPath).job).toEqual(originalJob);

    const operationPath = createOperation(vaultPath, null);
    const originalOperation = fs.readFileSync(operationPath, "utf8");
    expect(() => link.recordDecision({
      requestId: REQUEST_ID,
      decisionId: DECISION_ID,
      jobId: JOB_ID,
      operationId: OPERATION_ID
    })).toThrow(/audit record binding changed/u);
    expect(jobStore.read(jobPath).job).toEqual(originalJob);
    expect(fs.readFileSync(operationPath, "utf8")).toBe(originalOperation);

    createOperation(vaultPath, "job_20260729_differentjob");
    const mismatchedOperation = fs.readFileSync(operationPath, "utf8");
    expect(() => link.recordDecision({
      requestId: REQUEST_ID,
      decisionId: DECISION_ID,
      jobId: JOB_ID,
      operationId: OPERATION_ID
    })).toThrow(/audit record binding changed/u);
    expect(jobStore.read(jobPath).job).toEqual(originalJob);
    expect(fs.readFileSync(operationPath, "utf8")).toBe(mismatchedOperation);
  });
});

function createVault(): string {
  const vaultPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-permission-link-")));
  fs.chmodSync(vaultPath, 0o700);
  for (const relative of [".pige", ".pige/jobs", ".pige/operations", ".pige/operations/2026", ".pige/operations/2026/07"]) {
    fs.mkdirSync(path.join(vaultPath, relative), { mode: 0o700 });
  }
  roots.push(vaultPath);
  return vaultPath;
}

function createOperation(vaultPath: string, jobId: string | null = JOB_ID): string {
  const operation = OperationRecordSchema.parse({
    id: OPERATION_ID,
    schemaVersion: 1,
    ...(jobId ? { jobId } : {}),
    createdAt: "2026-07-29T12:00:00.000Z",
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "repair_record",
    targetRefs: [],
    sourceRefs: [],
    summary: "Repaired one record.",
    reversible: "no",
    warnings: []
  });
  const operationPath = path.join(vaultPath, ".pige", "operations", "2026", "07", `${OPERATION_ID}.json`);
  fs.writeFileSync(operationPath, `${JSON.stringify(operation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return operationPath;
}
