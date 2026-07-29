import { createHash, randomUUID } from "node:crypto";
import fs, { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import type { HighRiskConfirmationSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  HighRiskConfirmationOwnerSchema,
  HighRiskConfirmationSummarySchema
} from "@pige/schemas";
import { z } from "zod";
import { hasErrorInstanceCode as isErrno } from "./object-error-code";

const MAX_POLICY_BYTES = 256 * 1024;
const MAX_RECEIPTS = 64;
const POLICY_DIRECTORY = "permission-policy";
const POLICY_FILE = "policy.json";

const PendingRequestIdentitySchema = z.object({
  requestId: z.string().regex(/^permission_request_[a-f0-9]{32}$/u),
  bindingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  confirmation: HighRiskConfirmationSummarySchema
}).strict();
const PendingRequestSchema = PendingRequestIdentitySchema.extend({
  state: z.literal("pending"),
  revision: z.number().int().positive()
}).strict();

const DecisionReceiptSchema = z.object({
  state: z.literal("decided"),
  decisionId: z.string().regex(/^permission_decision_[a-f0-9]{32}$/u),
  requestId: z.string().regex(/^permission_request_[a-f0-9]{32}$/u),
  bindingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  confirmationId: z.string().regex(/^confirm_[0-9]{8}_[a-z0-9]{16,64}$/u),
  requestRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  decision: z.enum(["allow", "deny"]),
  owner: HighRiskConfirmationOwnerSchema
}).strict();

const PermissionPolicyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  defaultMode: z.literal("ask_every_time"),
  grants: z.array(z.never()).max(0),
  pending: PendingRequestSchema.optional(),
  receipts: z.array(DecisionReceiptSchema).max(MAX_RECEIPTS)
}).strict();

export interface PermissionPolicyDecisionReceipt {
  readonly state: "decided";
  readonly decisionId: string;
  readonly requestId: string;
  readonly bindingDigest: string;
  readonly confirmationId: string;
  readonly requestRevision: number;
  readonly revision: number;
  readonly decision: "allow" | "deny";
  readonly owner: HighRiskConfirmationSummary["owner"];
}

export interface PermissionPolicySnapshot {
  readonly revision: number;
  readonly pending?: {
    readonly state: "pending";
    readonly requestId: string;
    readonly bindingDigest: string;
    readonly revision: number;
    readonly confirmation: HighRiskConfirmationSummary;
  };
  readonly receipts: readonly PermissionPolicyDecisionReceipt[];
}

export type PermissionPolicyRegistrationResult =
  | { readonly status: "registered" | "restored"; readonly snapshot: PermissionPolicySnapshot }
  | { readonly status: "busy"; readonly snapshot: PermissionPolicySnapshot }
  | { readonly status: "already_resolved"; readonly receipt: PermissionPolicyDecisionReceipt; readonly snapshot: PermissionPolicySnapshot };

export type PermissionPolicyDecisionResult =
  | { readonly status: "committed" | "already_resolved"; readonly receipt: PermissionPolicyDecisionReceipt; readonly snapshot: PermissionPolicySnapshot }
  | { readonly status: "stale" | "not_found"; readonly snapshot: PermissionPolicySnapshot };

export type PermissionPolicyWithdrawalResult =
  | { readonly status: "withdrawn"; readonly snapshot: PermissionPolicySnapshot }
  | { readonly status: "stale" | "not_found"; readonly snapshot: PermissionPolicySnapshot };

export interface PermissionPolicyStorePort {
  read(): PermissionPolicySnapshot;
  register(input: {
    readonly requestId: string;
    readonly bindingDigest: `sha256:${string}`;
    readonly confirmation: HighRiskConfirmationSummary;
  }): PermissionPolicyRegistrationResult;
  commitDecision(input: {
    readonly requestId: string;
    readonly bindingDigest: `sha256:${string}`;
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly decision: "allow" | "deny";
  }): PermissionPolicyDecisionResult;
  withdraw(input: {
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly owner: HighRiskConfirmationSummary["owner"];
  }): PermissionPolicyWithdrawalResult;
}

type PermissionPolicyRecord = z.infer<typeof PermissionPolicyRecordSchema>;

export class PermissionPolicyStore implements PermissionPolicyStorePort {
  readonly #root: string;
  readonly #recordPath: string;
  readonly #assertWriterLease: () => void;

  constructor(appDataRootInput: string, assertWriterLease: () => void) {
    if (!path.isAbsolute(appDataRootInput)) throw policyInvalid();
    this.#assertWriterLease = assertWriterLease;
    const appDataRoot = captureOwnedDirectory(appDataRootInput, true);
    this.#root = captureOwnedDirectory(path.join(appDataRoot, POLICY_DIRECTORY), true);
    this.#recordPath = path.join(this.#root, POLICY_FILE);
    this.#readRecord();
  }

  read(): PermissionPolicySnapshot {
    return projectSnapshot(this.#readRecord());
  }

  register(input: {
    readonly requestId: string;
    readonly bindingDigest: `sha256:${string}`;
    readonly confirmation: HighRiskConfirmationSummary;
  }): PermissionPolicyRegistrationResult {
    const pendingIdentity = PendingRequestIdentitySchema.parse(input);
    const confirmation = pendingIdentity.confirmation;
    const current = this.#readRecord();
    const receipt = current.receipts.find((item) => item.confirmationId === confirmation.confirmationId);
    if (receipt) return { status: "already_resolved", receipt, snapshot: projectSnapshot(current) };
    if (current.pending) {
      const status = samePendingIdentity(current.pending, pendingIdentity) ? "restored" : "busy";
      return { status, snapshot: projectSnapshot(current) };
    }
    const revision = nextRevision(current.revision);
    const next = PermissionPolicyRecordSchema.parse({
      ...current,
      revision,
      pending: { state: "pending", revision, ...pendingIdentity }
    });
    this.#write(next);
    return { status: "registered", snapshot: projectSnapshot(next) };
  }

  commitDecision(input: {
    readonly requestId: string;
    readonly bindingDigest: `sha256:${string}`;
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly decision: "allow" | "deny";
  }): PermissionPolicyDecisionResult {
    const current = this.#readRecord();
    const existing = current.receipts.find((item) => item.confirmationId === input.confirmationId);
    if (existing) {
      return existing.decision === input.decision
        ? { status: "already_resolved", receipt: existing, snapshot: projectSnapshot(current) }
        : { status: "stale", snapshot: projectSnapshot(current) };
    }
    if (
      !current.pending ||
      current.pending.requestId !== input.requestId ||
      current.pending.bindingDigest !== input.bindingDigest ||
      current.pending.confirmation.confirmationId !== input.confirmationId
    ) {
      return { status: "not_found", snapshot: projectSnapshot(current) };
    }
    if (current.pending.revision !== input.expectedRevision) {
      return { status: "stale", snapshot: projectSnapshot(current) };
    }
    const revision = nextRevision(current.revision);
    const receipt = DecisionReceiptSchema.parse({
      state: "decided",
      decisionId: decisionId(current.pending.confirmation, input.expectedRevision, input.decision),
      requestId: input.requestId,
      bindingDigest: input.bindingDigest,
      confirmationId: input.confirmationId,
      requestRevision: input.expectedRevision,
      revision,
      decision: input.decision,
      owner: current.pending.confirmation.owner
    });
    const next = PermissionPolicyRecordSchema.parse({
      ...current,
      revision,
      pending: undefined,
      receipts: [...current.receipts, receipt].slice(-MAX_RECEIPTS)
    });
    this.#write(next);
    return { status: "committed", receipt, snapshot: projectSnapshot(next) };
  }

  withdraw(input: {
    readonly confirmationId: string;
    readonly expectedRevision: number;
    readonly owner: HighRiskConfirmationSummary["owner"];
  }): PermissionPolicyWithdrawalResult {
    const current = this.#readRecord();
    if (!current.pending || current.pending.confirmation.confirmationId !== input.confirmationId) {
      return { status: "not_found", snapshot: projectSnapshot(current) };
    }
    if (
      current.pending.revision !== input.expectedRevision ||
      canonicalJson(current.pending.confirmation.owner) !== canonicalJson(input.owner)
    ) return { status: "stale", snapshot: projectSnapshot(current) };
    const next = PermissionPolicyRecordSchema.parse({
      ...current,
      revision: nextRevision(current.revision),
      pending: undefined
    });
    this.#write(next);
    return { status: "withdrawn", snapshot: projectSnapshot(next) };
  }

  #readRecord(): PermissionPolicyRecord {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(this.#recordPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const stats = fs.fstatSync(descriptor);
      if (!isPrivateRegularFile(stats) || stats.size > MAX_POLICY_BYTES) throw policyInvalid();
      return PermissionPolicyRecordSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
    } catch (caught) {
      if (isErrno(caught, "ENOENT")) return initialRecord();
      if (caught instanceof PigeDomainError) throw caught;
      throw policyInvalid();
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #write(record: PermissionPolicyRecord): void {
    this.#assertWriterLease();
    const bytes = `${JSON.stringify(PermissionPolicyRecordSchema.parse(record), null, 2)}\n`;
    if (Buffer.byteLength(bytes, "utf8") > MAX_POLICY_BYTES) throw policyInvalid();
    const temporaryPath = path.join(this.#root, `.${POLICY_FILE}.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
        0o600
      );
      fs.writeFileSync(descriptor, bytes, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      this.#assertWriterLease();
      fs.renameSync(temporaryPath, this.#recordPath);
      fsyncDirectory(this.#root);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporaryPath, { force: true });
    }
    this.#assertWriterLease();
  }
}

function initialRecord(): PermissionPolicyRecord {
  return { schemaVersion: 1, revision: 0, defaultMode: "ask_every_time", grants: [], receipts: [] };
}

function projectSnapshot(record: PermissionPolicyRecord): PermissionPolicySnapshot {
  return {
    revision: record.revision,
    ...(record.pending ? { pending: record.pending } : {}),
    receipts: record.receipts
  };
}

function captureOwnedDirectory(directoryPathInput: string, create: boolean): string {
  try {
    const directoryPath = path.resolve(directoryPathInput);
    if (create) fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwned(stats) || (stats.mode & 0o077) !== 0) {
      throw policyInvalid();
    }
    const realPath = fs.realpathSync.native(directoryPath);
    if (realPath !== directoryPath) throw policyInvalid();
    return realPath;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw policyInvalid();
  }
}

function isPrivateRegularFile(stats: Stats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1 && isOwned(stats) && (stats.mode & 0o077) === 0;
}

function isOwned(stats: Stats): boolean {
  return typeof process.getuid !== "function" || stats.uid === process.getuid();
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function nextRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) throw policyInvalid();
  return revision + 1;
}

function samePendingIdentity(
  left: z.infer<typeof PendingRequestSchema>,
  right: z.infer<typeof PendingRequestIdentitySchema>
): boolean {
  return left.requestId === right.requestId &&
    left.bindingDigest === right.bindingDigest &&
    canonicalJson(left.confirmation) === canonicalJson(right.confirmation);
}

function decisionId(
  confirmation: HighRiskConfirmationSummary,
  revision: number,
  decision: "allow" | "deny"
): string {
  return `permission_decision_${createHash("sha256")
    .update("pige.permission.decision.v1\0", "utf8")
    .update(canonicalJson({ confirmation, revision, decision }), "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw policyInvalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw policyInvalid();
}

function policyInvalid(): PigeDomainError {
  return new PigeDomainError("permission.policy_store_invalid", "The private permission policy state is invalid.");
}
