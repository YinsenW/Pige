import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  PermissionActionBindingSchema,
  PermissionActionLifecycleRecordSchema,
  PermissionDecisionRecordSchema,
  type PermissionActionBinding,
  type PermissionActionLifecycleRecord,
  type PermissionDecisionRecord,
  type PermissionResolveRequest
} from "@pige/schemas";
import { JobRecordStore, type NamedJobRecordClaim } from "./job-record-store";
import type { PermissionSettingsService } from "./permission-settings-service";
import { readVaultManifest } from "./vault-layout";

const PERMISSION_BROKER_DIRECTORY = "permission-broker";
const REQUEST_DIRECTORY = "requests";
const DECISION_DIRECTORY = "decisions";
const MAX_RECORD_BYTES = 32 * 1024;
const MAX_REQUEST_RECORDS = 4_096;
const MAX_UNRESOLVED_REQUEST_RECORDS = 512;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface PermissionActionSummary {
  readonly actorDisplayName: string;
  readonly actionLabelKey: string;
  readonly resourceDisplayName?: string;
  readonly resourceKind: "file" | "folder" | "url" | "network" | "shell" | "credential" | "setting" | "package" | "other";
  readonly resourceCount: number;
  readonly reasonCode: string;
}

interface PermissionBrokerTestOnlyHooks {
  readonly beforeCreateCommit?: (directory: "requests" | "decisions") => void;
  readonly beforeReplaceCommit?: (directory: "requests" | "decisions") => void;
}

interface PermissionBrokerServiceCommonOptions {
  readonly rootPath: string;
  readonly permissionSettings?: PermissionSettingsService;
  readonly testOnlyHooks?: PermissionBrokerTestOnlyHooks;
}

export type PermissionBrokerServiceOptions = PermissionBrokerServiceCommonOptions & (
  | {
      readonly assertWriterLease: (vaultPath: string) => void;
      readonly unsafeAllowUnfenced?: never;
    }
  | {
      readonly assertWriterLease?: never;
      readonly unsafeAllowUnfenced: true;
    }
);

export class PermissionConfirmationRequiredError extends PigeDomainError {
  readonly requestId: string;
  readonly bindingHash: string;

  constructor(requestId: string, bindingHash: string) {
    super("permission.confirmation_required", "The exact external action requires one-use permission.");
    this.requestId = requestId;
    this.bindingHash = bindingHash;
  }
}

export class PermissionBrokerService {
  readonly #rootPath: string;
  readonly #assertWriterLease: ((vaultPath: string) => void) | undefined;
  readonly #permissionSettings: PermissionSettingsService | undefined;
  readonly #testOnlyHooks: PermissionBrokerTestOnlyHooks;
  readonly #claimStores = new Map<string, JobRecordStore>();

  constructor(options: PermissionBrokerServiceOptions) {
    if (
      !options ||
      typeof options.rootPath !== "string" ||
      options.rootPath.trim() === "" ||
      (options.assertWriterLease === undefined &&
        !("unsafeAllowUnfenced" in options && options.unsafeAllowUnfenced === true))
    ) {
      throw new PigeDomainError(
        "permission.store_invalid",
        "The Permission Broker store requires an active vault writer lease."
      );
    }
    this.#rootPath = path.resolve(options.rootPath);
    this.#assertWriterLease = options.assertWriterLease;
    this.#permissionSettings = options.permissionSettings;
    this.#testOnlyHooks = options.testOnlyHooks ?? {};
  }

  prepare(
    vaultPath: string,
    bindingInput: PermissionActionBinding,
    summary: PermissionActionSummary
  ): PermissionActionLifecycleRecord {
    const binding = parseAndVerifyBinding(bindingInput);
    const roots = this.#roots(vaultPath, binding.vaultId);
    const records = readRequestRecords(roots.requests, binding.vaultId);
    assertPersistedDecisionAuthority(roots.decisions, records);
    const related = records.filter((record) =>
      record.binding.jobId === binding.jobId &&
      record.binding.actorId === binding.actorId &&
      record.binding.actionId === binding.actionId
    );
    const exact = related.filter((record) => record.binding.bindingHash === binding.bindingHash);
    const reusable = exact.find((record) =>
      record.state === "pending" ||
      record.state === "approved" ||
      (record.state === "consumed" && record.completionMarkerHash !== undefined)
    );
    if (reusable) {
      assertPermissionActionBinding(reusable.binding, binding);
      return reusable.state === "pending"
        ? this.#authorizeWithYolo(vaultPath, reusable)
        : reusable;
    }
    if (exact.some((record) => record.state === "consumed" && record.completionMarkerHash === undefined)) {
      throw permissionCompletionUncertain();
    }
    for (const stale of related) {
      if (stale.state === "pending" || stale.state === "approved") this.cancel(vaultPath, stale.id);
    }
    const unresolvedCount = records.filter((record) =>
      record.state === "pending" ||
      record.state === "approved" ||
      (record.state === "consumed" && record.completionMarkerHash === undefined)
    ).length;
    if (
      records.length >= MAX_REQUEST_RECORDS ||
      unresolvedCount >= MAX_UNRESOLVED_REQUEST_RECORDS
    ) throw permissionCapacityExceeded();

    const now = new Date().toISOString();
    const request = PermissionActionLifecycleRecordSchema.parse({
      schemaVersion: 1,
      id: createPermissionRequestId(now),
      authorizationLayer: "permission_broker",
      state: "pending",
      binding,
      ...summary,
      createdAt: now,
      updatedAt: now
    });
    const created = this.#withClaim(vaultPath, request.id, (claim) => {
      createRecord(
        roots.requests,
        request.id,
        request,
        () => this.#assertMutation(vaultPath, claim),
        () => this.#testOnlyHooks.beforeCreateCommit?.("requests")
      );
      return this.read(vaultPath, request.id);
    });
    return this.#authorizeWithYolo(vaultPath, created);
  }

  read(vaultPath: string, requestId: string): PermissionActionLifecycleRecord {
    const { requests, decisions, vaultId } = this.#roots(vaultPath);
    const record = readLifecycleRecord(requests, requestId);
    if (record.binding.vaultId !== vaultId) throw permissionStoreInvalid();
    assertPersistedDecisionAuthority(decisions, [record]);
    return record;
  }

  readOptional(vaultPath: string, requestId: string): PermissionActionLifecycleRecord | undefined {
    const { requests } = this.#roots(vaultPath);
    if (!isPermissionRequestId(requestId) || !recordExists(requests, requestId)) return undefined;
    return this.#reconcileCommittedDecision(vaultPath, this.read(vaultPath, requestId));
  }

  pending(vaultPath: string, requestId: string): PermissionActionLifecycleRecord | undefined {
    const record = this.readOptional(vaultPath, requestId);
    if (!record) return undefined;
    return record.state === "pending" ? record : undefined;
  }

  listForJob(vaultPath: string, jobId: string): readonly PermissionActionLifecycleRecord[] {
    const { requests, decisions, vaultId } = this.#roots(vaultPath);
    const records = readRequestRecords(requests, vaultId);
    assertPersistedDecisionAuthority(decisions, records);
    return records
      .filter((record) => record.binding.jobId === jobId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listResolvable(vaultPath: string): readonly PermissionActionLifecycleRecord[] {
    const { requests, decisions, vaultId } = this.#roots(vaultPath);
    const records = readRequestRecords(requests, vaultId);
    assertPersistedDecisionAuthority(decisions, records);
    return records.filter((record) =>
      record.state === "pending" ||
      record.state === "approved" ||
      record.state === "denied" ||
      record.state === "consumed"
    );
  }

  reconcileCommittedDecisions(vaultPath: string): number {
    const { requests, decisions, vaultId } = this.#roots(vaultPath);
    let reconciled = 0;
    const records = readRequestRecords(requests, vaultId);
    assertPersistedDecisionAuthority(decisions, records);
    for (const record of records) {
      if (record.state !== "pending") continue;
      if (this.#reconcileCommittedDecision(vaultPath, record).state !== "pending") reconciled += 1;
    }
    return reconciled;
  }

  commitDecision(
    vaultPath: string,
    request: PermissionResolveRequest
  ): { readonly lifecycle: PermissionActionLifecycleRecord; readonly decision: PermissionDecisionRecord } {
    const roots = this.#roots(vaultPath);
    return this.#withClaim(vaultPath, request.requestId, (claim) => {
      const current = this.read(vaultPath, request.requestId);
      if (current.binding.jobId !== request.jobId) throw permissionStale();
      const alreadyMatches =
        (request.decision === "allow_once" && (current.state === "approved" || current.state === "consumed")) ||
        (request.decision === "deny" && current.state === "denied");
      if (alreadyMatches && current.decisionId) {
        const existingDecision = readDecisionRecord(roots.decisions, current.decisionId);
        assertCurrentActionDecision(current, existingDecision);
        return {
          lifecycle: current,
          decision: existingDecision
        };
      }
      if (current.state !== "pending") throw permissionReplay();

      const now = new Date().toISOString();
      const decisionId = createPermissionDecisionId(current.id, current.createdAt);
      const decision = PermissionDecisionRecordSchema.parse({
        id: decisionId,
        schemaVersion: 1,
        authorizationLayer: "permission_broker",
        permissionRequestId: current.id,
        decision: request.decision,
        scope: request.decision === "allow_once" ? "once" : "never",
        resourceScope: current.binding.resourceScope,
        decidedBy: "user",
        autoAllowedBy: "none",
        decidedAt: now
      });
      if (!recordExists(roots.decisions, decision.id)) {
        createRecord(
          roots.decisions,
          decision.id,
          decision,
          () => this.#assertMutation(vaultPath, claim),
          () => this.#testOnlyHooks.beforeCreateCommit?.("decisions")
        );
      } else if (!sameCanonicalRecord(readDecisionRecord(roots.decisions, decision.id), decision)) {
        throw permissionReplay();
      }
      const next = lifecycleForDecision(current, decision);
      replaceRecord(
        roots.requests,
        current.id,
        current,
        next,
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema,
        () => this.#testOnlyHooks.beforeReplaceCommit?.("requests")
      );
      return { lifecycle: this.read(vaultPath, current.id), decision };
    });
  }

  consume(
    vaultPath: string,
    requestId: string,
    bindingInput: PermissionActionBinding
  ): PermissionActionLifecycleRecord {
    const binding = parseAndVerifyBinding(bindingInput);
    const roots = this.#roots(vaultPath, binding.vaultId);
    return this.#withClaim(vaultPath, requestId, (claim) => {
      const current = this.read(vaultPath, requestId);
      assertPermissionActionBinding(current.binding, binding);
      if (current.state === "consumed") return current;
      if (current.state !== "approved" || current.decision !== "allow_once" || !current.decisionId) {
        throw new PermissionConfirmationRequiredError(current.id, binding.bindingHash);
      }
      this.#assertLiveDecisionAuthority(readDecisionRecord(roots.decisions, current.decisionId));
      const now = new Date().toISOString();
      const consumed = PermissionActionLifecycleRecordSchema.parse({
        ...current,
        state: "consumed",
        updatedAt: now,
        consumedAt: now
      });
      replaceRecord(
        roots.requests,
        current.id,
        current,
        consumed,
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema
      );
      return this.read(vaultPath, current.id);
    });
  }

  assertExecutionAuthority(
    vaultPath: string,
    requestId: string,
    bindingInput: PermissionActionBinding
  ): void {
    const binding = parseAndVerifyBinding(bindingInput);
    const roots = this.#roots(vaultPath, binding.vaultId);
    const current = this.read(vaultPath, requestId);
    assertPermissionActionBinding(current.binding, binding);
    if (current.state !== "consumed" || !current.decisionId) throw permissionStale();
    this.#assertLiveDecisionAuthority(readDecisionRecord(roots.decisions, current.decisionId));
  }

  markCompleted(
    vaultPath: string,
    requestId: string,
    bindingInput: PermissionActionBinding,
    completionMarkerHash: string
  ): PermissionActionLifecycleRecord {
    const binding = parseAndVerifyBinding(bindingInput);
    if (!SHA256_PATTERN.test(completionMarkerHash)) throw permissionStoreInvalid();
    const roots = this.#roots(vaultPath, binding.vaultId);
    return this.#withClaim(vaultPath, requestId, (claim) => {
      const current = this.read(vaultPath, requestId);
      assertPermissionActionBinding(current.binding, binding);
      if (current.state !== "consumed") throw permissionStale();
      if (current.completionMarkerHash) {
        if (current.completionMarkerHash !== completionMarkerHash) throw permissionStale();
        return current;
      }
      const now = new Date().toISOString();
      const completed = PermissionActionLifecycleRecordSchema.parse({
        ...current,
        completionMarkerHash,
        completedAt: now,
        updatedAt: now
      });
      replaceRecord(
        roots.requests,
        current.id,
        current,
        completed,
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema
      );
      return this.read(vaultPath, current.id);
    });
  }

  cancel(vaultPath: string, requestId: string): PermissionActionLifecycleRecord {
    const roots = this.#roots(vaultPath);
    return this.#withClaim(vaultPath, requestId, (claim) => {
      const current = this.read(vaultPath, requestId);
      if (current.state === "cancelled" || current.state === "denied" || current.state === "consumed") {
        return current;
      }
      const now = new Date().toISOString();
      const cancelled = PermissionActionLifecycleRecordSchema.parse({
        ...current,
        state: "cancelled",
        decision: undefined,
        decisionId: undefined,
        decidedAt: undefined,
        updatedAt: now,
        cancelledAt: now
      });
      replaceRecord(
        roots.requests,
        current.id,
        current,
        cancelled,
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema
      );
      return this.read(vaultPath, current.id);
    });
  }

  #withClaim<T>(vaultPath: string, requestId: string, action: (claim: NamedJobRecordClaim) => T): T {
    if (!isPermissionRequestId(requestId)) throw permissionStoreInvalid();
    const store = this.#claimStore(vaultPath);
    const claim = store.acquireNamedClaim("permission-request", requestId);
    try {
      return action(claim);
    } finally {
      claim.release();
    }
  }

  #authorizeWithYolo(
    vaultPath: string,
    record: PermissionActionLifecycleRecord
  ): PermissionActionLifecycleRecord {
    if (!this.#permissionSettings || !isYoloEligibleBinding(record.binding)) return record;
    const roots = this.#roots(vaultPath, record.binding.vaultId);
    return this.#withClaim(vaultPath, record.id, (claim) => {
      const current = this.read(vaultPath, record.id);
      if (current.state !== "pending") return current;
      const authority = this.#permissionSettings?.authoritySnapshot();
      if (
        !authority ||
        !authority.yoloEnabled ||
        authority.defaultMode !== "yolo_full_access"
      ) return current;

      const now = new Date().toISOString();
      const decision = PermissionDecisionRecordSchema.parse({
        id: createPermissionDecisionId(current.id, current.createdAt),
        schemaVersion: 1,
        authorizationLayer: "permission_broker",
        permissionRequestId: current.id,
        decision: "allow_once",
        scope: "once",
        resourceScope: current.binding.resourceScope,
        decidedBy: "system",
        autoAllowedBy: "yolo_full_access",
        permissionSettingsRevision: authority.revision,
        decidedAt: now
      });
      if (!recordExists(roots.decisions, decision.id)) {
        createRecord(
          roots.decisions,
          decision.id,
          decision,
          () => this.#assertMutation(vaultPath, claim),
          () => this.#testOnlyHooks.beforeCreateCommit?.("decisions")
        );
      } else if (!sameCanonicalRecord(readDecisionRecord(roots.decisions, decision.id), decision)) {
        throw permissionReplay();
      }
      const approved = lifecycleForDecision(current, decision);
      replaceRecord(
        roots.requests,
        current.id,
        current,
        approved,
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema,
        () => this.#testOnlyHooks.beforeReplaceCommit?.("requests")
      );
      return this.read(vaultPath, current.id);
    });
  }

  #assertLiveDecisionAuthority(decision: PermissionDecisionRecord): void {
    if (decision.autoAllowedBy !== "yolo_full_access") return;
    if (!this.#permissionSettings || decision.permissionSettingsRevision === undefined) {
      throw permissionStoreInvalid();
    }
    this.#permissionSettings.assertYoloAuthority(decision.permissionSettingsRevision);
  }

  #reconcileCommittedDecision(
    vaultPath: string,
    record: PermissionActionLifecycleRecord
  ): PermissionActionLifecycleRecord {
    if (record.state !== "pending") return record;
    const roots = this.#roots(vaultPath, record.binding.vaultId);
    const decisionId = createPermissionDecisionId(record.id, record.createdAt);
    if (!recordExists(roots.decisions, decisionId)) return record;
    return this.#withClaim(vaultPath, record.id, (claim) => {
      const current = this.read(vaultPath, record.id);
      if (current.state !== "pending") return current;
      const decision = readDecisionRecord(roots.decisions, decisionId);
      assertCurrentActionDecision(current, decision);
      replaceRecord(
        roots.requests,
        current.id,
        current,
        lifecycleForDecision(current, decision),
        () => this.#assertMutation(vaultPath, claim),
        PermissionActionLifecycleRecordSchema,
        () => this.#testOnlyHooks.beforeReplaceCommit?.("requests")
      );
      return this.read(vaultPath, current.id);
    });
  }

  #claimStore(vaultPath: string): JobRecordStore {
    const resolvedVaultPath = path.resolve(vaultPath);
    const existing = this.#claimStores.get(resolvedVaultPath);
    if (existing) return existing;
    const store = new JobRecordStore(this.#assertWriterLease
      ? {
          rootPath: path.join(resolvedVaultPath, ".pige", "jobs"),
          assertWriterLease: () => this.#assertWriterLease?.(resolvedVaultPath)
        }
      : {
          rootPath: path.join(resolvedVaultPath, ".pige", "jobs"),
          unsafeAllowUnfenced: true
        });
    this.#claimStores.set(resolvedVaultPath, store);
    return store;
  }

  #roots(vaultPath: string, expectedVaultId?: string): PermissionRoots {
    const resolvedVaultPath = path.resolve(vaultPath);
    const manifest = readVaultManifest(resolvedVaultPath);
    if (expectedVaultId && manifest.vault_id !== expectedVaultId) throw permissionStale();
    const machineRoot = capturePrivateDirectory(this.#rootPath);
    const brokerRoot = ensurePrivateDirectoryChain(machineRoot, PERMISSION_BROKER_DIRECTORY);
    const vaultRoot = ensurePrivateDirectoryChain(brokerRoot, manifest.vault_id);
    const requests = ensurePrivateDirectoryChain(vaultRoot, REQUEST_DIRECTORY);
    const decisions = ensurePrivateDirectoryChain(vaultRoot, DECISION_DIRECTORY);
    return { requests, decisions, vaultId: manifest.vault_id };
  }

  #assertMutation(vaultPath: string, claim: NamedJobRecordClaim): void {
    try {
      this.#assertWriterLease?.(path.resolve(vaultPath));
      claim.assertHeld();
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw permissionStoreInvalid();
    }
  }
}

export function createPermissionActionBinding(
  input: Omit<PermissionActionBinding, "bindingHash">
): PermissionActionBinding {
  const parsed = PermissionActionBindingSchema.omit({ bindingHash: true }).parse(input);
  return PermissionActionBindingSchema.parse({
    ...parsed,
    bindingHash: hashCanonical("pige.permission.action_binding.v1", parsed)
  });
}

export function assertPermissionActionBinding(
  actualInput: PermissionActionBinding,
  expectedInput: PermissionActionBinding
): void {
  const actual = parseAndVerifyBinding(actualInput);
  const expected = parseAndVerifyBinding(expectedInput);
  if (!sameCanonicalRecord(actual, expected)) throw permissionBindingChanged();
}

interface PermissionRoots {
  readonly requests: DirectoryIdentity;
  readonly decisions: DirectoryIdentity;
  readonly vaultId: string;
}

interface DirectoryIdentity {
  readonly path: string;
  readonly realPath: string;
  readonly dev: number;
  readonly ino: number;
}

interface TemporaryRecordIdentity {
  readonly path: string;
  readonly descriptor: number;
  readonly dev: number;
  readonly ino: number;
  readonly byteLength: number;
  readonly contentSha256: string;
}

function lifecycleForDecision(
  current: PermissionActionLifecycleRecord,
  decision: PermissionDecisionRecord
): PermissionActionLifecycleRecord {
  assertCurrentActionDecision(current, decision);
  const state = decision.decision === "allow_once" ? "approved" : decision.decision === "deny" ? "denied" : undefined;
  if (!state) throw permissionStoreInvalid();
  return PermissionActionLifecycleRecordSchema.parse({
    ...current,
    state,
    decision: decision.decision,
    decisionId: decision.id,
    decidedAt: decision.decidedAt,
    updatedAt: decision.decidedAt
  });
}

function assertCurrentActionDecision(
  request: PermissionActionLifecycleRecord,
  decision: PermissionDecisionRecord
): void {
  if (
    decision.id !== createPermissionDecisionId(request.id, request.createdAt) ||
    decision.permissionRequestId !== request.id ||
    decision.resourceScope !== request.binding.resourceScope ||
    decision.reason !== undefined ||
    (decision.decision === "allow_once" && decision.scope !== "once") ||
    (decision.decision === "deny" && decision.scope !== "never") ||
    (decision.decision !== "allow_once" && decision.decision !== "deny") ||
    !isSupportedCurrentActionAuthority(decision)
  ) throw permissionStoreInvalid();
}

function isSupportedCurrentActionAuthority(decision: PermissionDecisionRecord): boolean {
  if (decision.decidedBy === "user") {
    return decision.autoAllowedBy === "none" && decision.permissionSettingsRevision === undefined;
  }
  return decision.decidedBy === "system" &&
    decision.decision === "allow_once" &&
    decision.autoAllowedBy === "yolo_full_access" &&
    decision.permissionSettingsRevision !== undefined;
}

function isYoloEligibleBinding(binding: PermissionActionBinding): boolean {
  return binding.runtimeKind === "desktop_local" &&
    binding.clientCapabilityTier === "desktop_full" &&
    (binding.capability === "external_filesystem" ||
      binding.capability === "external_network") &&
    binding.dataBoundary !== "destructive" &&
    binding.dataBoundary !== "cloud" &&
    binding.dataBoundary !== "brokered_credential";
}

function assertPersistedDecisionAuthority(
  decisions: DirectoryIdentity,
  records: readonly PermissionActionLifecycleRecord[]
): void {
  for (const record of records) {
    if (record.state !== "approved" && record.state !== "consumed" && record.state !== "denied") continue;
    const expectedDecisionId = createPermissionDecisionId(record.id, record.createdAt);
    if (record.decisionId !== expectedDecisionId) throw permissionStoreInvalid();
    const decision = readDecisionRecord(decisions, expectedDecisionId);
    assertCurrentActionDecision(record, decision);
    if (
      record.decision !== decision.decision ||
      record.decidedAt !== decision.decidedAt ||
      ((record.state === "approved" || record.state === "consumed") && decision.decision !== "allow_once") ||
      (record.state === "denied" && decision.decision !== "deny")
    ) throw permissionStoreInvalid();
  }
}

function parseAndVerifyBinding(input: PermissionActionBinding): PermissionActionBinding {
  const binding = PermissionActionBindingSchema.parse(input);
  const { bindingHash, ...identity } = binding;
  if (bindingHash !== hashCanonical("pige.permission.action_binding.v1", identity)) {
    throw permissionBindingChanged();
  }
  return binding;
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    if (typeof value === "number" && !Number.isFinite(value)) throw permissionStoreInvalid();
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
  throw permissionStoreInvalid();
}

function createPermissionRequestId(now: string): string {
  return `permreq_${now.slice(0, 10).replaceAll("-", "")}_${randomBytes(12).toString("hex")}`;
}

function createPermissionDecisionId(requestId: string, createdAt: string): string {
  return `permdec_${createdAt.slice(0, 10).replaceAll("-", "")}_${createHash("sha256")
    .update(`pige.permission.decision.v1\0${requestId}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function ensurePrivateDirectoryChain(parent: DirectoryIdentity, name: string): DirectoryIdentity {
  assertDirectoryIdentity(parent);
  const directoryPath = path.join(parent.path, name);
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    flushDirectory(parent);
  }
  const identity = capturePrivateDirectory(directoryPath);
  if (identity.realPath !== parent.realPath && !identity.realPath.startsWith(`${parent.realPath}${path.sep}`)) {
    throw permissionStoreInvalid();
  }
  assertDirectoryIdentity(parent);
  assertDirectoryIdentity(identity);
  return identity;
}

function capturePrivateDirectory(directoryPath: string): DirectoryIdentity {
  const resolvedPath = path.resolve(directoryPath);
  let stat: fs.Stats;
  let realPath: string;
  try {
    stat = fs.lstatSync(resolvedPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe");
    realPath = fs.realpathSync.native(resolvedPath);
    if (realPath !== resolvedPath) throw new Error("unsafe ancestor");
    if (process.platform !== "win32") fs.chmodSync(resolvedPath, PRIVATE_DIRECTORY_MODE);
  } catch {
    throw permissionStoreInvalid();
  }
  return { path: resolvedPath, realPath, dev: stat.dev, ino: stat.ino };
}

function assertDirectoryIdentity(identity: DirectoryIdentity): void {
  const current = capturePrivateDirectory(identity.path);
  if (
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    current.realPath !== identity.realPath
  ) throw permissionStoreInvalid();
}

function readRequestRecords(root: DirectoryIdentity, vaultId: string): PermissionActionLifecycleRecord[] {
  assertDirectoryIdentity(root);
  const names = fs.readdirSync(root.path)
    .filter((name) => /^permreq_\d{8}_[a-z0-9]{8,}\.json$/u.test(name))
    .sort();
  assertDirectoryIdentity(root);
  if (names.length > MAX_REQUEST_RECORDS) throw permissionStoreInvalid();
  return names.map((name) => {
    const record = readLifecycleRecord(root, name.slice(0, -5));
    if (record.binding.vaultId !== vaultId) throw permissionStoreInvalid();
    return record;
  });
}

function readLifecycleRecord(root: DirectoryIdentity, requestId: string): PermissionActionLifecycleRecord {
  if (!isPermissionRequestId(requestId)) throw permissionStoreInvalid();
  const record = readRecord(root, requestId, PermissionActionLifecycleRecordSchema);
  if (record.id !== requestId) throw permissionStoreInvalid();
  return record;
}

function readDecisionRecord(root: DirectoryIdentity, decisionId: string): PermissionDecisionRecord {
  if (!/^permdec_\d{8}_[a-z0-9]{8,}$/u.test(decisionId)) throw permissionStoreInvalid();
  const record = readRecord(root, decisionId, PermissionDecisionRecordSchema);
  if (record.id !== decisionId) throw permissionStoreInvalid();
  return record;
}

function readRecord<T>(
  root: DirectoryIdentity,
  id: string,
  schema: { parse(value: unknown): T }
): T {
  assertDirectoryIdentity(root);
  const filePath = path.join(root.path, `${id}.json`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size <= 0 || before.size > MAX_RECORD_BYTES || before.nlink !== 1) {
      throw permissionStoreInvalid();
    }
    const bytes = Buffer.alloc(before.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw permissionStoreInvalid();
    const named = fs.lstatSync(filePath);
    if (
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.dev !== before.dev ||
      named.ino !== before.ino ||
      named.nlink !== 1
    ) throw permissionStoreInvalid();
    assertDirectoryIdentity(root);
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw permissionStoreInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createRecord<T>(
  root: DirectoryIdentity,
  id: string,
  record: T,
  assertMutation: () => void,
  beforeCommit?: () => void
): void {
  beforeCommit?.();
  assertDirectoryIdentity(root);
  const filePath = path.join(root.path, `${id}.json`);
  const temporary = writeTemporary(root, serializeRecord(record));
  try {
    assertMutation();
    assertDirectoryIdentity(root);
    assertTemporaryIdentity(root, temporary);
    fs.linkSync(temporary.path, filePath);
    assertTemporaryAtPath(root, temporary, filePath);
    assertDirectoryIdentity(root);
    unlinkTemporary(root, temporary);
    flushDirectory(root);
    assertDirectoryIdentity(root);
  } catch (caught) {
    tryUnlinkTemporary(root, temporary);
    if (isErrno(caught, "EEXIST")) throw permissionReplay();
    if (caught instanceof PigeDomainError) throw caught;
    throw permissionStoreInvalid();
  } finally {
    fs.closeSync(temporary.descriptor);
  }
}

function replaceRecord<T>(
  root: DirectoryIdentity,
  id: string,
  expected: T,
  next: T,
  assertMutation: () => void,
  schema: { parse(value: unknown): T },
  beforeCommit?: () => void
): void {
  const expectedBytes = serializeRecord(expected);
  const expectedRevision = hashBytes(expectedBytes);
  const current = readRecord(root, id, schema);
  if (hashBytes(serializeRecord(current)) !== expectedRevision) throw permissionRevisionConflict();
  const temporary = writeTemporary(root, serializeRecord(next));
  const filePath = path.join(root.path, `${id}.json`);
  try {
    beforeCommit?.();
    assertDirectoryIdentity(root);
    const currentBeforeCommit = readRecord(root, id, schema);
    if (hashBytes(serializeRecord(currentBeforeCommit)) !== expectedRevision) throw permissionRevisionConflict();
    assertMutation();
    assertDirectoryIdentity(root);
    assertTemporaryIdentity(root, temporary);
    fs.renameSync(temporary.path, filePath);
    assertTemporaryAtPath(root, temporary, filePath);
    assertDirectoryIdentity(root);
    flushDirectory(root);
    assertDirectoryIdentity(root);
  } catch (caught) {
    tryUnlinkTemporary(root, temporary);
    if (caught instanceof PigeDomainError) throw caught;
    throw permissionStoreInvalid();
  } finally {
    fs.closeSync(temporary.descriptor);
  }
}

function serializeRecord(value: unknown): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.length <= 0 || bytes.length > MAX_RECORD_BYTES) throw permissionStoreInvalid();
  return bytes;
}

function writeTemporary(root: DirectoryIdentity, bytes: Buffer): TemporaryRecordIdentity {
  assertDirectoryIdentity(root);
  const temporaryPath = path.join(root.path, `.tmp-${randomUUID()}`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_RDWR |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      PRIVATE_FILE_MODE
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1) throw permissionStoreInvalid();
    const temporary: TemporaryRecordIdentity = {
      path: temporaryPath,
      descriptor,
      dev: opened.dev,
      ino: opened.ino,
      byteLength: bytes.length,
      contentSha256: hashBytes(bytes)
    };
    if (process.platform !== "win32") fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    if (fs.writeSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw permissionStoreInvalid();
    fs.fsyncSync(descriptor);
    assertDirectoryIdentity(root);
    assertTemporaryIdentity(root, temporary);
    return temporary;
  } catch (caught) {
    if (descriptor !== undefined) {
      try {
        const opened = fs.fstatSync(descriptor);
        tryUnlinkTemporary(root, {
          path: temporaryPath,
          descriptor,
          dev: opened.dev,
          ino: opened.ino,
          byteLength: bytes.length,
          contentSha256: hashBytes(bytes)
        });
      } catch {
        // Preserve the authoritative write failure.
      }
      fs.closeSync(descriptor);
    }
    if (caught instanceof PigeDomainError) throw caught;
    throw permissionStoreInvalid();
  }
}

function flushDirectory(directory: DirectoryIdentity): void {
  assertDirectoryIdentity(directory);
  if (process.platform === "win32") return;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFlush(caught)) throw permissionStoreInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  assertDirectoryIdentity(directory);
}

function isUnsupportedDirectoryFlush(value: unknown): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  if (new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]).has(code)) return true;
  return process.platform === "win32" && new Set(["EACCES", "EISDIR", "EPERM"]).has(code);
}

function recordExists(root: DirectoryIdentity, id: string): boolean {
  assertDirectoryIdentity(root);
  const exists = fs.existsSync(path.join(root.path, `${id}.json`));
  assertDirectoryIdentity(root);
  return exists;
}

function sameCanonicalRecord(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPermissionRequestId(value: string): boolean {
  return /^permreq_\d{8}_[a-z0-9]{8,}$/u.test(value);
}

function assertTemporaryIdentity(root: DirectoryIdentity, temporary: TemporaryRecordIdentity): void {
  const opened = fs.fstatSync(temporary.descriptor);
  if (
    !opened.isFile() ||
    opened.dev !== temporary.dev ||
    opened.ino !== temporary.ino ||
    opened.size !== temporary.byteLength
  ) throw permissionStoreInvalid();
  const bytes = Buffer.alloc(temporary.byteLength);
  if (fs.readSync(temporary.descriptor, bytes, 0, bytes.length, 0) !== bytes.length) {
    throw permissionStoreInvalid();
  }
  if (hashBytes(bytes) !== temporary.contentSha256) throw permissionStoreInvalid();
  assertTemporaryAtPath(root, temporary, temporary.path);
}

function assertTemporaryAtPath(
  root: DirectoryIdentity,
  temporary: TemporaryRecordIdentity,
  namedPath: string
): void {
  assertDirectoryIdentity(root);
  const named = fs.lstatSync(namedPath);
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.dev !== temporary.dev ||
    named.ino !== temporary.ino ||
    named.size !== temporary.byteLength
  ) throw permissionStoreInvalid();
  assertDirectoryIdentity(root);
}

function unlinkTemporary(root: DirectoryIdentity, temporary: TemporaryRecordIdentity): void {
  assertTemporaryIdentity(root, temporary);
  fs.unlinkSync(temporary.path);
  assertDirectoryIdentity(root);
}

function tryUnlinkTemporary(root: DirectoryIdentity, temporary: TemporaryRecordIdentity): void {
  try {
    unlinkTemporary(root, temporary);
  } catch {
    // Cleanup never replaces the authoritative failure.
  }
}

function isErrno(caught: unknown, code: string): boolean {
  return typeof caught === "object" && caught !== null && "code" in caught && caught.code === code;
}

function permissionStoreInvalid(): PigeDomainError {
  return new PigeDomainError(
    "permission.store_invalid",
    "The machine-local Permission Broker store is unavailable or unsafe."
  );
}

function permissionCapacityExceeded(): PigeDomainError {
  return new PigeDomainError(
    "permission.capacity_exceeded",
    "The machine-local Permission Broker store has too many unreconciled requests."
  );
}

function permissionBindingChanged(): PigeDomainError {
  return new PigeDomainError(
    "permission.binding_changed",
    "The actor, action, resource, input, policy, runtime, or vault binding changed."
  );
}

function permissionStale(): PigeDomainError {
  return new PigeDomainError(
    "permission.request_stale",
    "The Permission Broker request no longer matches the current action."
  );
}

function permissionReplay(): PigeDomainError {
  return new PigeDomainError(
    "permission.request_replay",
    "The Permission Broker request has already been resolved or replaced."
  );
}

function permissionRevisionConflict(): PigeDomainError {
  return new PigeDomainError(
    "permission.revision_conflict",
    "The Permission Broker request changed before the exact replacement committed."
  );
}

function permissionCompletionUncertain(): PigeDomainError {
  return new PigeDomainError(
    "permission.completion_uncertain",
    "The external action may have committed before its durable completion marker was recorded."
  );
}
