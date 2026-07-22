import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  ExternalMutationIntentSchema,
  OperationRecordSchema,
  type ExternalMutationIntent,
  type OperationRecord,
  type PermissionActionBinding
} from "@pige/schemas";
import { ExternalMutationIntentStore } from "./external-mutation-intent-store";
import { ExternalOperationRecordStore } from "./external-operation-record-store";
import {
  assertPublicationReceipt,
  capturedExternalTarget,
  EXTERNAL_TEXT_FILE_CREATE_ACTION_ID,
  EXTERNAL_TEXT_FILE_CREATE_ACTION_VERSION,
  hashExternalTargetPermissionIdentity,
  hashExternalTextCreateActionInput,
  type CapturedExternalTarget,
  type ExternalFilePublicationFailureCode,
  type ExternalFilePublicationReceipt
} from "./external-file-publication-protocol";
import { assertPermissionActionBinding } from "./permission-broker-service";

export const MAX_EXTERNAL_TEXT_CREATE_BYTES = 48 * 1_024;

export interface ExternalFilePublicationIdentity {
  readonly targetPath: string;
  readonly targetLeafName: string;
  readonly parentIdentityHash: `sha256:${string}`;
  readonly targetResourceHash: `sha256:${string}`;
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
  captureTarget(targetPathInput: unknown): Promise<CapturedExternalTarget>;
  publishExclusive(
    plan: ExternalFilePublicationPlan,
    signal: AbortSignal,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt>;
  adoptExclusive(
    plan: ExternalFilePublicationIdentity,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt>;
  finalize(
    plan: ExternalFilePublicationIdentity,
    assertWriterLease: () => void
  ): Promise<ExternalFilePublicationReceipt>;
}

export interface ExternalTextFileCreateAuthority {
  readonly vaultPath: string;
  readonly toolCallId: string;
  readonly binding: PermissionActionBinding;
  readonly assertExecutionAuthority: (binding: PermissionActionBinding) => void;
  readonly markCompleted: (completionMarkerHash: `sha256:${string}`) => void;
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

  async captureTarget(targetPathInput: unknown): Promise<CapturedExternalTarget> {
    return capturedExternalTarget(await this.#platform.captureTarget(targetPathInput));
  }

  async create(
    capturedTargetInput: CapturedExternalTarget,
    contentInput: unknown,
    authority: ExternalTextFileCreateAuthority,
    signal: AbortSignal
  ): Promise<ExternalTextFileCreateResult> {
    signal.throwIfAborted();
    const content = normalizeText(contentInput);
    const contentBytes = Buffer.from(content, "utf8");
    const capturedTarget = capturedExternalTarget(capturedTargetInput);
    const targetPath = capturedTarget.targetPath;
    const createdAt = new Date().toISOString();
    const targetResourceHash = capturedTarget.targetResourceHash;
    const contentHash = hashDomain("pige.external_content.v1", contentBytes);
    assertExecutionAuthority(authority, targetResourceHash, contentHash, contentBytes.byteLength);
    const binding = authority.binding;
    const identitySuffix = hashDomain(
      "pige.external_mutation_identity.v1",
      `${binding.jobId}\0${authority.toolCallId}\0${binding.bindingHash}\0${targetResourceHash}\0${contentHash}`
    ).slice("sha256:".length, "sha256:".length + 20);
    const dateKey = /^job_(\d{8})_/u.exec(binding.jobId)?.[1] ??
      createdAt.slice(0, 10).replaceAll("-", "");
    const intentId = `extmut_${dateKey}_${identitySuffix}`;
    const operationId = `op_${dateKey}_${identitySuffix}`;
    const stagePath = path.join(path.dirname(targetPath), `.pige-${intentId}.stage`);
    const intent = this.#intents.create(ExternalMutationIntentSchema.parse({
      id: intentId,
      schemaVersion: 2,
      revision: 1,
      state: "planned",
      vaultId: binding.vaultId,
      jobId: binding.jobId,
      toolCallId: authority.toolCallId,
      bindingHash: binding.bindingHash,
      policyContextId: binding.policyContextId,
      policyHash: binding.policyHash,
      targetPath,
      targetLeafName: capturedTarget.targetLeafName,
      parentIdentityHash: capturedTarget.parentIdentityHash,
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
      return await this.adopt(intent.id, authority);
    }

    let receipt: ExternalFilePublicationReceipt;
    try {
      receipt = await this.#platform.publishExclusive(
        planFor(intent, contentBytes),
        signal,
        publicationAuthorityFor(authority, targetResourceHash, contentHash, contentBytes.byteLength)
      );
    } catch (caught) {
      try { this.#intents.transition(intent.id, "planned", "failed_uncertain"); } catch { /* retain original failure */ }
      throw externalCreateError("external_filesystem.write_uncertain");
    }
    try {
      assertPublicationReceipt(receipt, expectedReceipt(intent, receipt.state, "errorCode" in receipt ? receipt.errorCode : undefined));
    } catch (caught) {
      try { this.#intents.transition(intent.id, "planned", "failed_uncertain"); } catch { /* retain original failure */ }
      throw caught;
    }
    if (receipt.state === "failed_no_effect" || receipt.state === "cancelled") {
      this.#intents.transition(intent.id, "planned", receipt.state);
      throw externalCreateError(receipt.errorCode);
    }
    if (receipt.state !== "published") {
      try { this.#intents.transition(intent.id, "planned", "failed_uncertain"); } catch { /* retain protocol failure */ }
      throw externalCreateError("external_filesystem.publication_protocol_invalid");
    }
    this.#intents.transition(intent.id, "planned", "published");
    try {
      return this.#commitOperation(this.#intents.read(intent.id), authority);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw externalCreateError("external_filesystem.write_failed");
    }
  }

  async adopt(
    intentId: string,
    authority: ExternalTextFileCreateAuthority
  ): Promise<ExternalTextFileCreateResult> {
    let intent = this.#intents.read(intentId);
    assertAuthority(intent, authority);
    if (intent.state === "failed_uncertain") throw externalCreateError("external_filesystem.write_uncertain");
    if (intent.state === "cancelled") throw externalCreateError("external_filesystem.cancelled");
    if (intent.state === "failed_no_effect") throw externalCreateError("external_filesystem.write_failed");
    if (intent.state === "completed") {
      markCompleted(intent, authority);
      return projectResult(intent);
    }
    let receipt: ExternalFilePublicationReceipt;
    try {
      receipt = await this.#platform.adoptExclusive(
        identityFor(intent),
        publicationAuthorityFor(
          authority,
          intent.targetResourceHash as `sha256:${string}`,
          intent.contentHash as `sha256:${string}`,
          intent.byteLength
        )
      );
      assertPublicationReceipt(receipt, expectedReceipt(intent, "published"));
    } catch {
      try { this.#intents.transition(intent.id, intent.state, "failed_uncertain"); } catch { /* retain uncertain failure */ }
      throw externalCreateError("external_filesystem.write_uncertain");
    }
    if (intent.state === "planned") intent = this.#intents.transition(intent.id, "planned", "published");
    if (intent.state === "published") return this.#commitOperation(intent, authority);
    return projectResult(intent);
  }

  async finalize(
    intentId: string,
    authority: ExternalTextFileCreateAuthority
  ): Promise<ExternalTextFileCreateResult> {
    let intent = this.#intents.read(intentId);
    assertAuthority(intent, authority);
    if (intent.state === "completed") {
      markCompleted(intent, authority);
      return projectResult(intent);
    }
    if (intent.state !== "operation_committed") throw externalCreateError("external_filesystem.write_uncertain");
    authority.assertWriterLease();
    let receipt: ExternalFilePublicationReceipt;
    try {
      receipt = await this.#platform.finalize(identityFor(intent), authority.assertWriterLease);
      assertPublicationReceipt(
        receipt,
        expectedReceipt(intent, receipt.state, "errorCode" in receipt ? receipt.errorCode : undefined)
      );
      if (receipt.state === "finalized") authority.assertWriterLease();
    } catch {
      try { this.#intents.transition(intent.id, "operation_committed", "failed_uncertain"); } catch { /* retain uncertain failure */ }
      throw externalCreateError("external_filesystem.write_uncertain");
    }
    if (receipt.state === "failed_no_effect" || receipt.state === "cancelled") {
      throw externalCreateError(receipt.errorCode);
    }
    if (receipt.state !== "finalized") {
      try { this.#intents.transition(intent.id, "operation_committed", "failed_uncertain"); } catch { /* retain protocol failure */ }
      throw externalCreateError("external_filesystem.publication_protocol_invalid");
    }
    intent = this.#intents.transition(intent.id, "operation_committed", "completed");
    markCompleted(intent, authority);
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
    targetLeafName: intent.targetLeafName,
    parentIdentityHash: intent.parentIdentityHash as `sha256:${string}`,
    targetResourceHash: intent.targetResourceHash as `sha256:${string}`,
    stagePath: intent.stagePath,
    contentHash: intent.contentHash as `sha256:${string}`,
    byteLength: intent.byteLength
  });
}

function expectedReceipt(
  intent: ExternalMutationIntent,
  state: ExternalFilePublicationReceipt["state"],
  errorCode?: ExternalFilePublicationFailureCode
): ExternalFilePublicationReceipt {
  return Object.freeze({
    state,
    parentIdentityHash: intent.parentIdentityHash as `sha256:${string}`,
    targetResourceHash: intent.targetResourceHash as `sha256:${string}`,
    contentHash: intent.contentHash as `sha256:${string}`,
    byteLength: intent.byteLength,
    ...(errorCode === undefined ? {} : { errorCode })
  }) as ExternalFilePublicationReceipt;
}

function createOperation(intent: ExternalMutationIntent): OperationRecord {
  return OperationRecordSchema.parse({
    id: intent.operationId,
    schemaVersion: 1,
    jobId: intent.jobId,
    createdAt: intent.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    policyAudit: {
      policyContextId: intent.policyContextId,
      policyHash: intent.policyHash,
      enforcementOwners: ["Submitted Turn Authority", "External Filesystem Mutation Service", "Platform Publication Adapter"]
    },
    kind: "create_external_file",
    targetRefs: [{ kind: "external_resource", id: intent.targetResourceHash }],
    sourceRefs: [],
    after: { kind: "external_resource", id: intent.targetResourceHash, checksum: intent.contentHash },
    summary: "Created one authority-bound external UTF-8 file.",
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
  const binding = authority.binding;
  if (
    intent.vaultId !== binding.vaultId || intent.jobId !== binding.jobId ||
    intent.toolCallId !== authority.toolCallId ||
    intent.bindingHash !== binding.bindingHash ||
    intent.policyContextId !== binding.policyContextId ||
    intent.policyHash !== binding.policyHash
  ) throw externalCreateError("external_filesystem.authority_changed");
  assertExecutionAuthority(
    authority,
    intent.targetResourceHash as `sha256:${string}`,
    intent.contentHash as `sha256:${string}`,
    intent.byteLength
  );
}

function assertExecutionAuthority(
  authority: ExternalTextFileCreateAuthority,
  targetResourceHash: `sha256:${string}`,
  contentHash: `sha256:${string}`,
  byteLength: number
): void {
  assertCreatePermission(authority.binding, authority.toolCallId, targetResourceHash, contentHash, byteLength);
  try {
    authority.assertExecutionAuthority(authority.binding);
  } catch {
    throw externalCreateError("external_filesystem.authority_changed");
  }
}

function publicationAuthorityFor(
  authority: ExternalTextFileCreateAuthority,
  targetResourceHash: `sha256:${string}`,
  contentHash: `sha256:${string}`,
  byteLength: number
): () => void {
  return () => {
    authority.assertWriterLease();
    assertExecutionAuthority(authority, targetResourceHash, contentHash, byteLength);
  };
}

function assertCreatePermission(
  binding: PermissionActionBinding,
  toolCallId: string,
  targetResourceHash: `sha256:${string}`,
  contentHash: `sha256:${string}`,
  byteLength: number
): void {
  try {
    assertPermissionActionBinding(binding, binding);
  } catch {
    throw externalCreateError("external_filesystem.authority_changed");
  }
  if (
    binding.actionId !== EXTERNAL_TEXT_FILE_CREATE_ACTION_ID ||
    binding.actionVersion !== EXTERNAL_TEXT_FILE_CREATE_ACTION_VERSION ||
    binding.capability !== "external_filesystem" ||
    binding.dataBoundary !== "filesystem" ||
    binding.resourceScope !== "current_file" ||
    binding.resourceIdentityHash !== hashExternalTargetPermissionIdentity(targetResourceHash) ||
    binding.actionInputHash !== hashExternalTextCreateActionInput({
      toolCallId,
      targetResourceHash,
      contentHash,
      byteLength
    })
  ) throw externalCreateError("external_filesystem.authority_changed");
}

function markCompleted(intent: ExternalMutationIntent, authority: ExternalTextFileCreateAuthority): void {
  const completionMarkerHash = hashDomain(
    "pige.external_mutation_completion.v1",
    `${intent.id}\0${intent.operationId}\0${intent.targetResourceHash}\0${intent.contentHash}`
  );
  try {
    authority.markCompleted(completionMarkerHash);
  } catch {
    throw externalCreateError("external_filesystem.authority_changed");
  }
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
