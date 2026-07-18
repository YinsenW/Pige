import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

export type ExternalPublicationHash = `sha256:${string}`;
export const EXTERNAL_TEXT_FILE_CREATE_ACTION_ID = "external_text_file.create";
export const EXTERNAL_TEXT_FILE_CREATE_ACTION_VERSION = "1";

export interface CapturedExternalTarget {
  readonly targetPath: string;
  readonly targetLeafName: string;
  readonly parentIdentityHash: ExternalPublicationHash;
  readonly targetResourceHash: ExternalPublicationHash;
}

interface ExternalFilePublicationReceiptIdentity {
  readonly parentIdentityHash: ExternalPublicationHash;
  readonly targetResourceHash: ExternalPublicationHash;
  readonly contentHash: ExternalPublicationHash;
  readonly byteLength: number;
}

export interface ExternalFilePublicationSuccessReceipt extends ExternalFilePublicationReceiptIdentity {
  readonly state: "published" | "finalized";
}

export type ExternalFilePublicationFailureCode =
  | "external_filesystem.authority_changed"
  | "external_filesystem.cancelled"
  | "external_filesystem.changed"
  | "external_filesystem.target_exists"
  | "external_filesystem.writer_lease_lost"
  | "external_filesystem.write_failed";

export interface ExternalFilePublicationFailureReceipt extends ExternalFilePublicationReceiptIdentity {
  readonly state: "failed_no_effect" | "cancelled";
  readonly errorCode: ExternalFilePublicationFailureCode;
}

export type ExternalFilePublicationReceipt =
  | ExternalFilePublicationSuccessReceipt
  | ExternalFilePublicationFailureReceipt;

const FAILURE_CODES = new Set<ExternalFilePublicationFailureCode>([
  "external_filesystem.authority_changed",
  "external_filesystem.cancelled",
  "external_filesystem.changed",
  "external_filesystem.target_exists",
  "external_filesystem.writer_lease_lost",
  "external_filesystem.write_failed"
]);

export function capturedExternalTarget(input: {
  readonly targetPath: string;
  readonly targetLeafName: string;
  readonly parentIdentityHash: ExternalPublicationHash;
  readonly targetResourceHash?: ExternalPublicationHash;
}): CapturedExternalTarget {
  const targetPath = normalizeAbsolutePath(input.targetPath);
  const targetLeafName = normalizeLeafName(input.targetLeafName);
  if (path.basename(targetPath) !== targetLeafName || path.dirname(targetPath) === targetPath) {
    throw publicationProtocolError();
  }
  assertHash(input.parentIdentityHash);
  const targetResourceHash = hashExternalTarget(input.parentIdentityHash, targetLeafName);
  if (input.targetResourceHash !== undefined && input.targetResourceHash !== targetResourceHash) {
    throw publicationProtocolError();
  }
  return Object.freeze({ targetPath, targetLeafName, parentIdentityHash: input.parentIdentityHash, targetResourceHash });
}

export function hashExternalTarget(parentIdentityHash: ExternalPublicationHash, targetLeafName: string): ExternalPublicationHash {
  assertHash(parentIdentityHash);
  const leaf = normalizeLeafName(targetLeafName);
  return hashDomain("pige.external_resource.v2", `${parentIdentityHash}\0${leaf}`);
}

export function hashExternalTextCreateActionInput(input: {
  readonly toolCallId: string;
  readonly targetResourceHash: ExternalPublicationHash;
  readonly contentHash: ExternalPublicationHash;
  readonly byteLength: number;
}): ExternalPublicationHash {
  if (typeof input.toolCallId !== "string" || input.toolCallId.length === 0 || input.toolCallId.length > 256) {
    throw publicationProtocolError();
  }
  assertHash(input.targetResourceHash);
  assertHash(input.contentHash);
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0 || input.byteLength > 48 * 1_024) {
    throw publicationProtocolError();
  }
  return hashDomain(
    "pige.permission.action_input.v1",
    canonicalJson({
      byteLength: input.byteLength,
      contentHash: input.contentHash,
      mode: "create_only",
      targetResourceHash: input.targetResourceHash,
      toolCallId: input.toolCallId
    })
  );
}

export function hashExternalTargetPermissionIdentity(targetResourceHash: ExternalPublicationHash): ExternalPublicationHash {
  assertHash(targetResourceHash);
  return hashDomain("pige.permission.resource_identity.v1", canonicalJson(targetResourceHash));
}

export function assertPublicationReceipt(
  receipt: ExternalFilePublicationReceipt,
  expected: {
    readonly state: ExternalFilePublicationReceipt["state"];
    readonly parentIdentityHash: ExternalPublicationHash;
    readonly targetResourceHash: ExternalPublicationHash;
    readonly contentHash: ExternalPublicationHash;
    readonly byteLength: number;
    readonly errorCode?: ExternalFilePublicationFailureReceipt["errorCode"];
  }
): void {
  const errorCode = "errorCode" in receipt ? receipt.errorCode : undefined;
  if (
    receipt.state !== expected.state ||
    receipt.parentIdentityHash !== expected.parentIdentityHash ||
    receipt.targetResourceHash !== expected.targetResourceHash ||
    receipt.contentHash !== expected.contentHash ||
    receipt.byteLength !== expected.byteLength ||
    errorCode !== expected.errorCode ||
    ((receipt.state === "published" || receipt.state === "finalized") && errorCode !== undefined) ||
    ((receipt.state === "failed_no_effect" || receipt.state === "cancelled") &&
      (errorCode === undefined || !FAILURE_CODES.has(errorCode))) ||
    (receipt.state === "cancelled" && errorCode !== "external_filesystem.cancelled")
  ) throw publicationProtocolError();
}

function normalizeAbsolutePath(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(value) || !path.isAbsolute(value)
  ) throw publicationProtocolError();
  const resolved = path.resolve(value);
  if (resolved !== value) throw publicationProtocolError();
  return resolved;
}

function normalizeLeafName(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 255 || value === "." || value === ".." ||
    /[\u0000-\u001f\u007f]/u.test(value) || value.includes("/") || value.includes("\\") || path.basename(value) !== value
  ) throw publicationProtocolError();
  return value;
}

function assertHash(value: string): asserts value is ExternalPublicationHash {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw publicationProtocolError();
}

function hashDomain(domain: string, value: string): ExternalPublicationHash {
  return `sha256:${createHash("sha256").update(domain, "utf8").update("\0", "utf8").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw publicationProtocolError();
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
  throw publicationProtocolError();
}

function publicationProtocolError(): PigeDomainError {
  return new PigeDomainError(
    "external_filesystem.publication_protocol_invalid",
    "The platform publication response could not be verified."
  );
}
