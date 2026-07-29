import { randomUUID } from "node:crypto";
import fs, { constants as fsConstants } from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  OperationRecordSchema,
  PermissionDecisionIdSchema,
  PermissionRequestIdSchema,
  type JobRecord
} from "@pige/schemas";
import { JobRecordStore } from "./job-record-store";
import type { PermissionPolicyRecordLinkPort } from "./permission-policy-runtime";
import { hasErrorInstanceCode as isErrno } from "./object-error-code";

const MAX_OPERATION_BYTES = 256 * 1024;

export interface PermissionPolicyActiveVault {
  readonly vaultId: string;
  readonly vaultPath: string;
}

export class PermissionPolicyRecordLink implements PermissionPolicyRecordLinkPort {
  readonly #activeVault: () => PermissionPolicyActiveVault | undefined;
  readonly #assertWriterLease: (vaultPath: string) => void;
  readonly #now: () => string;

  constructor(options: {
    readonly activeVault: () => PermissionPolicyActiveVault | undefined;
    readonly assertWriterLease: (vaultPath: string) => void;
    readonly now?: () => string;
  }) {
    this.#activeVault = options.activeVault;
    this.#assertWriterLease = options.assertWriterLease;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  recordPending(input: { readonly requestId: string; readonly jobId?: string }): void {
    const requestId = PermissionRequestIdSchema.parse(input.requestId);
    if (!input.jobId) return;
    this.#appendJobRefs(input.jobId, { requestId });
  }

  recordDecision(input: {
    readonly requestId: string;
    readonly decisionId: string;
    readonly jobId?: string;
    readonly operationId?: string;
  }): void {
    PermissionRequestIdSchema.parse(input.requestId);
    const decisionId = PermissionDecisionIdSchema.parse(input.decisionId);
    if (input.operationId) this.#assertOperationLinkable(input.operationId, input.jobId);
    if (input.jobId) this.#appendJobRefs(input.jobId, { decisionId });
    if (input.operationId) this.#appendOperationRef(input.operationId, decisionId, input.jobId);
  }

  #assertOperationLinkable(operationId: string, expectedJobId?: string): void {
    const active = this.#requireActiveVault();
    const current = readOperation(resolveOperationPath(active.vaultPath, operationId));
    if (!current || (expectedJobId && current.operation.jobId !== expectedJobId)) throw linkStale();
  }

  #appendJobRefs(
    jobId: string,
    input: { readonly requestId?: string; readonly decisionId?: string }
  ): void {
    const active = this.#requireActiveVault();
    const store = new JobRecordStore({
      rootPath: path.join(active.vaultPath, ".pige", "jobs"),
      assertWriterLease: () => this.#assertWriterLease(active.vaultPath)
    });
    const snapshot = store.read(jobPath(active.vaultPath, jobId));
    if (snapshot.job.activeVaultId !== active.vaultId) throw linkStale();
    const requestIds = appendUnique(snapshot.job.permissionRequestIds, input.requestId);
    const decisionIds = appendUnique(snapshot.job.permissionDecisionIds, input.decisionId);
    if (
      requestIds === snapshot.job.permissionRequestIds &&
      decisionIds === snapshot.job.permissionDecisionIds
    ) return;
    store.mutate(snapshot, (current) => JobRecordSchema.parse({
      ...current,
      updatedAt: nextTimestamp(current.updatedAt, this.#now()),
      ...(requestIds ? { permissionRequestIds: requestIds } : {}),
      ...(decisionIds ? { permissionDecisionIds: decisionIds } : {})
    }));
  }

  #appendOperationRef(operationId: string, decisionId: string, expectedJobId?: string): void {
    const active = this.#requireActiveVault();
    const operationPath = resolveOperationPath(active.vaultPath, operationId);
    const current = readOperation(operationPath);
    if (!current || (expectedJobId && current.operation.jobId !== expectedJobId)) throw linkStale();
    if (current.operation.permissionDecisionIds?.includes(decisionId)) return;
    if ((current.operation.permissionDecisionIds?.length ?? 0) >= 32) throw linkStale();
    const next = OperationRecordSchema.parse({
      ...current.operation,
      permissionDecisionIds: [...(current.operation.permissionDecisionIds ?? []), decisionId]
    });
    this.#assertWriterLease(active.vaultPath);
    replaceOperation(operationPath, current.bytes, next);
    this.#assertWriterLease(active.vaultPath);
  }

  #requireActiveVault(): PermissionPolicyActiveVault {
    const active = this.#activeVault();
    if (!active) throw linkStale();
    const vaultPath = path.resolve(active.vaultPath);
    const stats = fs.lstatSync(vaultPath);
    if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync.native(vaultPath) !== vaultPath) {
      throw linkStale();
    }
    this.#assertWriterLease(vaultPath);
    return { vaultId: active.vaultId, vaultPath };
  }
}

function appendUnique(values: readonly string[] | undefined, value: string | undefined): readonly string[] | undefined {
  if (!value || values?.includes(value)) return values;
  if ((values?.length ?? 0) >= 32) throw linkStale();
  return [...(values ?? []), value];
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = /^job_(\d{8})_[a-z0-9]{8,}$/u.exec(jobId)?.[1];
  if (!date) throw linkStale();
  return path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6), `${jobId}.json`);
}

function resolveOperationPath(vaultPath: string, operationId: string): string {
  const date = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(operationId)?.[1];
  if (!date) throw linkStale();
  const parent = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6));
  try {
    if (fs.realpathSync.native(parent) !== parent) throw linkStale();
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return path.join(parent, `${operationId}.json`);
    throw caught;
  }
  return path.join(parent, `${operationId}.json`);
}

function readOperation(filePath: string): { readonly bytes: Buffer; readonly operation: ReturnType<typeof OperationRecordSchema.parse> } | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > MAX_OPERATION_BYTES) {
      throw linkStale();
    }
    const bytes = fs.readFileSync(descriptor);
    return { bytes, operation: OperationRecordSchema.parse(JSON.parse(bytes.toString("utf8"))) };
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw linkStale();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function replaceOperation(
  filePath: string,
  expectedBytes: Buffer,
  operation: ReturnType<typeof OperationRecordSchema.parse>
): void {
  const current = readOperation(filePath);
  if (!current || !current.bytes.equals(expectedBytes)) throw linkStale();
  const nextBytes = Buffer.from(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
  if (nextBytes.length > MAX_OPERATION_BYTES) throw linkStale();
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, nextBytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const latest = readOperation(filePath);
    if (!latest || !latest.bytes.equals(expectedBytes)) throw linkStale();
    fs.renameSync(temporary, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function nextTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : new Date(Date.parse(current) + 1).toISOString();
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function linkStale(): PigeDomainError {
  return new PigeDomainError("permission.record_link_stale", "The permission audit record binding changed.");
}
