import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  ExternalMutationIntentSchema,
  OperationRecordSchema,
  type ExternalMutationIntent,
  type OperationRecord
} from "@pige/schemas";
import { ExternalMutationIntentStore } from "./external-mutation-intent-store";
import { ExternalOperationRecordStore } from "./external-operation-record-store";

export const MAX_EXTERNAL_TEXT_CREATE_BYTES = 48 * 1_024;

export interface ExternalFilePublicationIdentity {
  readonly targetPath: string;
  readonly stagePath: string;
  readonly contentHash: `sha256:${string}`;
  readonly byteLength: number;
}

export interface ExternalFilePublicationPlan extends ExternalFilePublicationIdentity {
  readonly content: Buffer;
}

/**
 * Platform-owned publication boundary. Production must not provide a plain Node
 * implementation: the port must bind an opened parent-directory handle and use
 * no-follow relative operations (or the platform equivalent) for every step.
 * A thrown publishExclusive call must prove that no target was published and
 * that any owned stage was removed; process loss is recovered through adopt.
 */
export interface ExternalFilePublicationPort {
  captureTarget(targetPathInput: unknown): string;
  publishExclusive(
    plan: ExternalFilePublicationPlan,
    signal: AbortSignal,
    assertWriterLease: () => void
  ): void;
  adoptExclusive(plan: ExternalFilePublicationIdentity, assertWriterLease: () => void): void;
  finalize(plan: ExternalFilePublicationIdentity): void;
}

export interface ExternalTextFileCreateAuthority {
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly jobId: string;
  readonly toolCallId: string;
  readonly permissionRequestId: string;
  readonly permissionDecisionId: string;
  readonly bindingHash: `sha256:${string}`;
  readonly policyContextId: string;
  readonly policyHash: `sha256:${string}`;
  readonly assertWriterLease: () => void;
}

export interface ExternalTextFileCreateResult {
  readonly intentId: string;
  readonly operationId: string;
  readonly targetResourceHash: `sha256:${string}`;
  readonly contentHash: `sha256:${string}`;
  readonly byteLength: number;
}

export class ExternalTextFileCreateService {
  readonly #platform: ExternalFilePublicationPort;
  readonly #intents: ExternalMutationIntentStore;
  readonly #operations: ExternalOperationRecordStore;

  constructor(input: {
    readonly platform: ExternalFilePublicationPort;
    readonly machineRootPath: string;
    readonly operationStore?: ExternalOperationRecordStore;
  }) {
    this.#platform = input.platform;
    this.#intents = new ExternalMutationIntentStore(input.machineRootPath);
    this.#operations = input.operationStore ?? new ExternalOperationRecordStore();
  }

  create(
    targetPathInput: unknown,
    contentInput: unknown,
    authority: ExternalTextFileCreateAuthority,
    signal: AbortSignal
  ): ExternalTextFileCreateResult {
    signal.throwIfAborted();
    const content = normalizeText(contentInput);
    const contentBytes = Buffer.from(content, "utf8");
    const targetPath = this.#platform.captureTarget(targetPathInput);
    const createdAt = new Date().toISOString();
    const targetResourceHash = hashDomain("pige.external_resource.v1", targetPath);
    const contentHash = hashDomain("pige.external_content.v1", contentBytes);
    const identitySuffix = hashDomain(
      "pige.external_mutation_identity.v1",
      `${authority.jobId}\0${authority.toolCallId}\0${authority.bindingHash}\0${targetResourceHash}\0${contentHash}`
    ).slice("sha256:".length, "sha256:".length + 20);
    const dateKey = /^job_(\d{8})_/u.exec(authority.jobId)?.[1] ?? createdAt.slice(0, 10).replaceAll("-", "");
    const intentId = `extmut_${dateKey}_${identitySuffix}`;
    const operationId = `op_${dateKey}_${identitySuffix}`;
    const stagePath = path.join(path.dirname(targetPath), `.pige-${intentId}.stage`);
    const intent = this.#intents.create(ExternalMutationIntentSchema.parse({
      id: intentId,
      schemaVersion: 1,
      revision: 1,
      state: "planned",
      vaultId: authority.vaultId,
      jobId: authority.jobId,
      toolCallId: authority.toolCallId,
      permissionRequestId: authority.permissionRequestId,
      permissionDecisionId: authority.permissionDecisionId,
      bindingHash: authority.bindingHash,
      policyContextId: authority.policyContextId,
      policyHash: authority.policyHash,
      targetPath,
      stagePath,
      targetResourceHash,
      contentHash,
      byteLength: contentBytes.byteLength,
      operationId,
      createdAt,
      updatedAt: createdAt
    }));
    if (intent.state !== "planned") {
      assertContent(intent, contentBytes);
      return this.adopt(intent.id, authority);
    }

    try {
      this.#platform.publishExclusive(planFor(intent, contentBytes), signal, authority.assertWriterLease);
      this.#intents.transition(intent.id, "planned", "published");
      return this.#commitOperation(this.#intents.read(intent.id), authority);
    } catch (caught) {
      try { this.#intents.transition(intent.id, "planned", "failed_uncertain"); } catch { /* retain original failure */ }
      if (caught instanceof PigeDomainError) throw caught;
      if (isAbortError(caught)) throw externalCreateError("external_filesystem.cancelled");
      throw externalCreateError("external_filesystem.write_failed");
    }
  }

  adopt(
    intentId: string,
    authority: ExternalTextFileCreateAuthority
  ): ExternalTextFileCreateResult {
    let intent = this.#intents.read(intentId);
    assertAuthority(intent, authority);
    if (intent.state === "failed_uncertain") throw externalCreateError("external_filesystem.write_uncertain");
    this.#platform.adoptExclusive(identityFor(intent), authority.assertWriterLease);
    if (intent.state === "planned") intent = this.#intents.transition(intent.id, "planned", "published");
    if (intent.state === "published") return this.#commitOperation(intent, authority);
    return projectResult(intent);
  }

  finalize(
    intentId: string,
    authority: ExternalTextFileCreateAuthority
  ): ExternalTextFileCreateResult {
    let intent = this.#intents.read(intentId);
    assertAuthority(intent, authority);
    if (intent.state === "completed") return projectResult(intent);
    if (intent.state !== "operation_committed") throw externalCreateError("external_filesystem.write_uncertain");
    this.#platform.finalize(identityFor(intent));
    intent = this.#intents.transition(intent.id, "operation_committed", "completed");
    return projectResult(intent);
  }

  #commitOperation(intent: ExternalMutationIntent, authority: ExternalTextFileCreateAuthority): ExternalTextFileCreateResult {
    authority.assertWriterLease();
    this.#operations.write(authority.vaultPath, createOperation(intent), authority.assertWriterLease);
    const committed = intent.state === "operation_committed"
      ? intent
      : this.#intents.transition(intent.id, "published", "operation_committed");
    return projectResult(committed);
  }
}

function planFor(intent: ExternalMutationIntent, content: Buffer): ExternalFilePublicationPlan {
  return Object.freeze({
    ...identityFor(intent),
    content
  });
}

function identityFor(intent: ExternalMutationIntent): ExternalFilePublicationIdentity {
  return Object.freeze({
    targetPath: intent.targetPath,
    stagePath: intent.stagePath,
    contentHash: intent.contentHash as `sha256:${string}`,
    byteLength: intent.byteLength
  });
}

function createOperation(intent: ExternalMutationIntent): OperationRecord {
  return OperationRecordSchema.parse({
    id: intent.operationId,
    schemaVersion: 1,
    jobId: intent.jobId,
    createdAt: intent.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    permissionDecisionIds: [intent.permissionDecisionId],
    policyAudit: {
      policyContextId: intent.policyContextId,
      policyHash: intent.policyHash,
      enforcementOwners: ["Permission Broker", "External Filesystem Mutation Service", "Platform Publication Adapter"]
    },
    kind: "create_external_file",
    targetRefs: [{ kind: "external_resource", id: intent.targetResourceHash }],
    sourceRefs: [],
    after: { kind: "external_resource", id: intent.targetResourceHash, checksum: intent.contentHash },
    summary: "Created one permission-approved external UTF-8 file.",
    reversible: "no",
    warnings: []
  });
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") throw externalCreateError("external_filesystem.invalid_input");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > MAX_EXTERNAL_TEXT_CREATE_BYTES || bytes.toString("utf8") !== value) {
    throw externalCreateError("external_filesystem.invalid_text");
  }
  return value;
}

function assertContent(intent: ExternalMutationIntent, content: Buffer): void {
  if (
    content.byteLength !== intent.byteLength ||
    hashDomain("pige.external_content.v1", content) !== intent.contentHash
  ) throw externalCreateError("external_filesystem.write_uncertain");
}

function assertAuthority(intent: ExternalMutationIntent, authority: ExternalTextFileCreateAuthority): void {
  if (
    intent.vaultId !== authority.vaultId || intent.jobId !== authority.jobId ||
    intent.toolCallId !== authority.toolCallId || intent.permissionRequestId !== authority.permissionRequestId ||
    intent.permissionDecisionId !== authority.permissionDecisionId || intent.bindingHash !== authority.bindingHash ||
    intent.policyContextId !== authority.policyContextId || intent.policyHash !== authority.policyHash
  ) throw externalCreateError("external_filesystem.authority_changed");
}

function projectResult(intent: ExternalMutationIntent): ExternalTextFileCreateResult {
  return Object.freeze({
    intentId: intent.id,
    operationId: intent.operationId,
    targetResourceHash: intent.targetResourceHash as `sha256:${string}`,
    contentHash: intent.contentHash as `sha256:${string}`,
    byteLength: intent.byteLength
  });
}

function hashDomain(domain: string, value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(domain, "utf8").update("\0", "utf8").update(value).digest("hex")}`;
}

function externalCreateError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The external filesystem request could not be completed safely.");
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
