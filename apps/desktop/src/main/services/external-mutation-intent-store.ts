import { createHash } from "node:crypto";
import fs, { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { ExternalMutationIntentSchema, type ExternalMutationIntent } from "@pige/schemas";

const DIRECTORY = "external-mutation-intents";
const MAX_RECORD_BYTES = 64 * 1_024;
const REVISION_FILE = /^(\d{8})\.json$/u;

export class ExternalMutationIntentStore {
  readonly #rootPath: string;

  constructor(machineRootPath: string) {
    this.#rootPath = ensurePrivateDirectory(path.join(path.resolve(machineRootPath), DIRECTORY));
  }

  create(intent: ExternalMutationIntent): ExternalMutationIntent {
    const parsed = ExternalMutationIntentSchema.parse(intent);
    assertIntentPathBinding(parsed);
    if (parsed.revision !== 1 || parsed.state !== "planned") throw intentInvalid();
    const intentDirectory = ensurePrivateDirectory(this.#intentDirectory(parsed.id));
    const recordPath = revisionPath(intentDirectory, 1);
    try {
      writeRecordNoReplace(recordPath, parsed);
      fsyncDirectory(intentDirectory);
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
    }
    const existing = this.read(parsed.id);
    if (!sameIntentIdentity(existing, parsed)) throw intentConflict();
    return existing;
  }

  read(intentId: string): ExternalMutationIntent {
    const directory = this.#intentDirectory(intentId);
    const revisions = readRevisionNumbers(directory);
    if (revisions.length === 0 || revisions[0] !== 1) throw intentInvalid();
    for (let index = 1; index < revisions.length; index += 1) {
      if (revisions[index] !== revisions[index - 1]! + 1) throw intentInvalid();
    }
    const latestRevision = revisions.at(-1) as number;
    const latest = readRecord(revisionPath(directory, latestRevision));
    if (latest.id !== intentId || latest.revision !== latestRevision) throw intentInvalid();
    assertIntentPathBinding(latest);
    return latest;
  }

  transition(
    intentId: string,
    expectedState: ExternalMutationIntent["state"],
    nextState: ExternalMutationIntent["state"]
  ): ExternalMutationIntent {
    const current = this.read(intentId);
    if (current.state === nextState) return current;
    if (current.state !== expectedState || !isAllowedTransition(expectedState, nextState)) throw intentConflict();
    const next = ExternalMutationIntentSchema.parse({
      ...current,
      revision: current.revision + 1,
      state: nextState,
      updatedAt: new Date().toISOString()
    });
    const directory = this.#intentDirectory(intentId);
    try {
      writeRecordNoReplace(revisionPath(directory, next.revision), next);
      fsyncDirectory(directory);
      return next;
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
      const winner = this.read(intentId);
      if (winner.state === nextState && sameIntentIdentity(winner, next)) return winner;
      throw intentConflict();
    }
  }

  listIncomplete(): readonly ExternalMutationIntent[] {
    return Object.freeze(fs.readdirSync(this.#rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^extmut_\d{8}_[a-z0-9]{12,}$/u.test(entry.name))
      .map((entry) => this.read(entry.name))
      .filter((intent) => intent.state !== "completed" && intent.state !== "failed_uncertain")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
  }

  #intentDirectory(intentId: string): string {
    if (!/^extmut_\d{8}_[a-z0-9]{12,}$/u.test(intentId)) throw intentInvalid();
    return path.join(this.#rootPath, intentId);
  }
}

function sameIntentIdentity(left: ExternalMutationIntent, right: ExternalMutationIntent): boolean {
  const {
    state: _leftState,
    createdAt: _leftCreatedAt,
    updatedAt: _leftUpdatedAt,
    revision: _leftRevision,
    ...leftIdentity
  } = left;
  const {
    state: _rightState,
    createdAt: _rightCreatedAt,
    updatedAt: _rightUpdatedAt,
    revision: _rightRevision,
    ...rightIdentity
  } = right;
  return JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity);
}

function assertIntentPathBinding(intent: ExternalMutationIntent): void {
  if (
    !path.isAbsolute(intent.targetPath) ||
    path.resolve(intent.targetPath) !== intent.targetPath ||
    !path.isAbsolute(intent.stagePath) ||
    path.resolve(intent.stagePath) !== intent.stagePath ||
    path.dirname(intent.targetPath) !== path.dirname(intent.stagePath) ||
    intent.targetPath === intent.stagePath ||
    path.basename(intent.stagePath) !== `.pige-${intent.id}.stage` ||
    hashResourcePath(intent.targetPath) !== intent.targetResourceHash
  ) throw intentInvalid();
}

function hashResourcePath(targetPath: string): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige.external_resource.v1", "utf8")
    .update("\0", "utf8")
    .update(targetPath, "utf8")
    .digest("hex")}`;
}

function isAllowedTransition(from: ExternalMutationIntent["state"], to: ExternalMutationIntent["state"]): boolean {
  return (from === "planned" && (to === "published" || to === "failed_uncertain")) ||
    (from === "published" && (to === "operation_committed" || to === "failed_uncertain")) ||
    (from === "operation_committed" && (to === "completed" || to === "failed_uncertain"));
}

function readRevisionNumbers(directory: string): number[] {
  assertPrivateDirectory(directory);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && REVISION_FILE.test(entry.name))
    .map((entry) => Number(REVISION_FILE.exec(entry.name)?.[1]))
    .sort((left, right) => left - right);
}

function readRecord(recordPath: string): ExternalMutationIntent {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(recordPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    assertPrivateFile(stats);
    if (stats.size > MAX_RECORD_BYTES) throw intentInvalid();
    return ExternalMutationIntentSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw intentInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeRecordNoReplace(recordPath: string, value: ExternalMutationIntent): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      recordPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(bytes, "utf8") > MAX_RECORD_BYTES) throw intentInvalid();
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function revisionPath(directory: string, revision: number): string {
  return path.join(directory, `${revision.toString().padStart(8, "0")}.json`);
}

function ensurePrivateDirectory(directoryPath: string): string {
  try {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(directoryPath);
    fs.chmodSync(directoryPath, 0o700);
    fsyncDirectory(path.dirname(directoryPath));
    return fs.realpathSync.native(directoryPath);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw intentInvalid();
  }
}

function assertPrivateDirectory(directoryPath: string): void {
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwned(stats) || (stats.mode & 0o077) !== 0) {
    throw intentInvalid();
  }
}

function assertPrivateFile(stats: Stats): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || !isOwned(stats) || (stats.mode & 0o077) !== 0) {
    throw intentInvalid();
  }
}

function isOwned(stats: Stats): boolean {
  return typeof process.getuid !== "function" || stats.uid === process.getuid();
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function intentInvalid(): PigeDomainError {
  return new PigeDomainError("external_mutation.intent_invalid", "The external mutation intent store is invalid.");
}

function intentConflict(): PigeDomainError {
  return new PigeDomainError("external_mutation.intent_conflict", "The external mutation intent changed concurrently.");
}

function isErrno(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}
