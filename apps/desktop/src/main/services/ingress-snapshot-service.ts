import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const SNAPSHOT_SCHEMA_VERSION = 1;
const PRIVATE_ROOT = [".pige", "private", "ingress-snapshots"] as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;

export interface IngressSnapshotBinding {
  readonly vaultId: string;
  readonly parentJobId: string;
  readonly sourceId: string;
  readonly ordinal: number;
}

export interface IngressSnapshotFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
}

export interface CreateIngressSnapshotInput extends IngressSnapshotBinding {
  readonly vaultPath: string;
  readonly sourcePath: string;
  readonly checksum: `sha256:${string}`;
  readonly size: number;
  readonly noFollowIdentity: IngressSnapshotFileIdentity;
}

export interface IngressSnapshotDescriptor extends IngressSnapshotBinding {
  readonly schemaVersion: 1;
  readonly descriptorId: string;
  readonly descriptorDigest: `sha256:${string}`;
  readonly snapshotFileName: string;
  readonly checksum: `sha256:${string}`;
  readonly size: number;
  readonly sourceProvenance: {
    readonly originalPath: string;
    readonly identity: IngressSnapshotFileIdentity;
  };
  readonly managedCopy?: {
    readonly destinationPath: string;
    readonly checksum: `sha256:${string}`;
    readonly size: number;
    readonly adoptedAt: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IngressSnapshotReadLease {
  readonly leaseId: string;
  readonly descriptor: IngressSnapshotDescriptor;
  readonly absolutePath: string;
  readonly checksum: `sha256:${string}`;
  readonly size: number;
  release(): void;
}

export interface IngressSnapshotReleaseProof extends IngressSnapshotBinding {
  readonly expectedDescriptorDigest: `sha256:${string}`;
  readonly parentDisposition: "terminal" | "durable_adopted" | "proven_orphan";
  readonly childOwnershipComplete: true;
  readonly recoveryOwnerIds: readonly [];
}

export type IngressSnapshotReleaseResult =
  | { readonly status: "released" }
  | { readonly status: "busy"; readonly readerCount: number }
  | { readonly status: "not_found" }
  | { readonly status: "stale" };

export interface IngressSnapshotReapCandidate {
  readonly descriptor: IngressSnapshotDescriptor;
  readonly readerCount: number;
}

export class IngressSnapshotService {
  readonly #readers = new Map<string, Set<string>>();
  readonly #now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  async createOrAdopt(input: CreateIngressSnapshotInput): Promise<IngressSnapshotDescriptor> {
    validateCreateInput(input);
    const root = await ensurePrivateRoot(input.vaultPath);
    const finalDirectory = path.join(root, descriptorId(input));
    const existing = await readDescriptorOptional(finalDirectory);
    if (existing) return await this.#adoptExact(existing, input, finalDirectory);

    const stagingDirectory = `${finalDirectory}.staging-${randomUUID()}`;
    await fs.promises.mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
    try {
      const snapshotFileName = `snapshot${safeExtension(input.sourcePath)}`;
      const snapshotPath = path.join(stagingDirectory, snapshotFileName);
      await copyExactSourceToSnapshot(input, snapshotPath);
      const timestamp = this.#now().toISOString();
      const descriptor = createDescriptor(input, snapshotFileName, timestamp);
      await writeDescriptorAtomic(stagingDirectory, descriptor);
      await syncDirectory(stagingDirectory);
      try {
        await fs.promises.rename(stagingDirectory, finalDirectory);
      } catch (caught) {
        if (!isAlreadyExists(caught)) throw caught;
        await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
      }
      await syncDirectory(root);
      const adopted = await readDescriptor(finalDirectory);
      return await this.#adoptExact(adopted, input, finalDirectory);
    } catch (caught) {
      await fs.promises.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (caught instanceof PigeDomainError) throw caught;
      throw snapshotError("ingress_snapshot.create_failed", "The private ingress snapshot could not be created.");
    }
  }

  read(vaultPath: string, binding: IngressSnapshotBinding): IngressSnapshotDescriptor | undefined {
    validateBinding(binding);
    const directory = descriptorDirectoryOptionalSync(vaultPath, binding);
    if (!directory) return undefined;
    const descriptor = readDescriptorOptionalSync(directory);
    if (!descriptor) return undefined;
    assertBinding(descriptor, binding);
    verifySnapshotSync(directory, descriptor);
    return descriptor;
  }

  async readAsync(vaultPath: string, binding: IngressSnapshotBinding): Promise<IngressSnapshotDescriptor | undefined> {
    validateBinding(binding);
    const directory = await descriptorDirectoryOptional(vaultPath, binding);
    if (!directory) return undefined;
    const descriptor = await readDescriptorOptional(directory);
    if (!descriptor) return undefined;
    assertBinding(descriptor, binding);
    await verifySnapshot(directory, descriptor);
    return descriptor;
  }

  acquireRead(vaultPath: string, binding: IngressSnapshotBinding): IngressSnapshotReadLease {
    const descriptor = this.read(vaultPath, binding);
    if (!descriptor) throw snapshotError("ingress_snapshot.not_found", "The private ingress snapshot is unavailable.");
    const directory = descriptorDirectorySync(vaultPath, binding);
    return this.#lease(descriptor, path.join(directory, descriptor.snapshotFileName));
  }

  async acquireReadAsync(vaultPath: string, binding: IngressSnapshotBinding): Promise<IngressSnapshotReadLease> {
    const descriptor = await this.readAsync(vaultPath, binding);
    if (!descriptor) throw snapshotError("ingress_snapshot.not_found", "The private ingress snapshot is unavailable.");
    const directory = descriptorDirectoryFromVault(vaultPath, binding);
    return this.#lease(descriptor, path.join(directory, descriptor.snapshotFileName));
  }

  readerCount(binding: IngressSnapshotBinding): number {
    validateBinding(binding);
    return this.#readers.get(bindingKey(binding))?.size ?? 0;
  }

  async proveReferencedOriginalCurrent(
    vaultPath: string,
    binding: IngressSnapshotBinding
  ): Promise<IngressSnapshotDescriptor> {
    const descriptor = await this.readAsync(vaultPath, binding);
    if (!descriptor) throw snapshotError("ingress_snapshot.not_found", "The private ingress snapshot is unavailable.");
    await verifyOriginalCurrent(descriptor);
    return descriptor;
  }

  async promoteManagedCopy(input: {
    readonly vaultPath: string;
    readonly binding: IngressSnapshotBinding;
    readonly managedRoot: string;
    readonly destinationPath: string;
  }): Promise<IngressSnapshotDescriptor> {
    const descriptor = await this.readAsync(input.vaultPath, input.binding);
    if (!descriptor) throw snapshotError("ingress_snapshot.not_found", "The private ingress snapshot is unavailable.");
    const directory = await descriptorDirectory(input.vaultPath, input.binding);
    const snapshotPath = path.join(directory, descriptor.snapshotFileName);
    const destination = await validateManagedDestination(input.managedRoot, input.destinationPath);
    const existing = await fileIntegrityOptional(destination);
    if (existing) {
      if (existing.checksum !== descriptor.checksum || existing.size !== descriptor.size) throw descriptorMismatch();
    } else {
      await copySnapshotToManagedDestination(snapshotPath, destination, descriptor);
    }
    const timestamp = this.#now().toISOString();
    const { descriptorDigest: _previousDigest, ...unsignedDescriptor } = descriptor;
    const updated = withDigest({
      ...unsignedDescriptor,
      managedCopy: { destinationPath: destination, checksum: descriptor.checksum, size: descriptor.size, adoptedAt: timestamp },
      updatedAt: timestamp
    });
    await writeDescriptorAtomic(directory, updated);
    return await readDescriptor(directory);
  }

  release(vaultPath: string, proof: IngressSnapshotReleaseProof): IngressSnapshotReleaseResult {
    validateReleaseProof(proof);
    const count = this.readerCount(proof);
    if (count > 0) return { status: "busy", readerCount: count };
    const directory = descriptorDirectorySync(vaultPath, proof);
    const descriptor = readDescriptorOptionalSync(directory);
    if (!descriptor) return { status: "not_found" };
    try { assertBinding(descriptor, proof); } catch { return { status: "stale" }; }
    if (descriptor.descriptorDigest !== proof.expectedDescriptorDigest) return { status: "stale" };
    verifySnapshotSync(directory, descriptor);
    fs.rmSync(directory, { recursive: true, force: false });
    return { status: "released" };
  }

  async reap(
    vaultPath: string,
    prove: (candidate: IngressSnapshotReapCandidate) => IngressSnapshotReleaseProof | undefined | Promise<IngressSnapshotReleaseProof | undefined>
  ): Promise<{ readonly scanned: number; readonly released: number; readonly retained: number }> {
    const root = await privateRootOptional(vaultPath);
    if (!root) return { scanned: 0, released: 0, retained: 0 };
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    let scanned = 0;
    let released = 0;
    let retained = 0;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.includes(".staging-")) continue;
      const directory = path.join(root, entry.name);
      const descriptor = await readDescriptorOptional(directory);
      if (!descriptor) { retained += 1; continue; }
      scanned += 1;
      const candidate = { descriptor, readerCount: this.readerCount(descriptor) };
      const proof = await prove(candidate);
      if (!proof) { retained += 1; continue; }
      const result = this.release(vaultPath, proof);
      if (result.status === "released") released += 1;
      else retained += 1;
    }
    return { scanned, released, retained };
  }

  #lease(descriptor: IngressSnapshotDescriptor, absolutePath: string): IngressSnapshotReadLease {
    const key = bindingKey(descriptor);
    const leaseId = `lease_${randomUUID()}`;
    const leases = this.#readers.get(key) ?? new Set<string>();
    leases.add(leaseId);
    this.#readers.set(key, leases);
    let released = false;
    return Object.freeze({
      leaseId,
      descriptor,
      absolutePath,
      checksum: descriptor.checksum,
      size: descriptor.size,
      release: () => {
        if (released) return;
        released = true;
        const current = this.#readers.get(key);
        current?.delete(leaseId);
        if (current?.size === 0) this.#readers.delete(key);
      }
    });
  }

  async #adoptExact(
    descriptor: IngressSnapshotDescriptor,
    input: CreateIngressSnapshotInput,
    directory: string
  ): Promise<IngressSnapshotDescriptor> {
    assertBinding(descriptor, input);
    if (
      descriptor.checksum !== input.checksum ||
      descriptor.size !== input.size ||
      descriptor.sourceProvenance.originalPath !== path.resolve(input.sourcePath) ||
      canonicalJson(descriptor.sourceProvenance.identity) !== canonicalJson(input.noFollowIdentity)
    ) throw descriptorMismatch();
    await verifySnapshot(directory, descriptor);
    return descriptor;
  }
}

export const ingressSnapshotService = new IngressSnapshotService();

function createDescriptor(input: CreateIngressSnapshotInput, snapshotFileName: string, timestamp: string): IngressSnapshotDescriptor {
  return withDigest({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    descriptorId: descriptorId(input),
    vaultId: input.vaultId,
    parentJobId: input.parentJobId,
    sourceId: input.sourceId,
    ordinal: input.ordinal,
    snapshotFileName,
    checksum: input.checksum,
    size: input.size,
    sourceProvenance: { originalPath: path.resolve(input.sourcePath), identity: input.noFollowIdentity },
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function withDigest(input: Omit<IngressSnapshotDescriptor, "descriptorDigest"> & { readonly descriptorDigest?: never }): IngressSnapshotDescriptor {
  return Object.freeze({ ...input, descriptorDigest: hashCanonical("pige.ingress_snapshot.descriptor.v1", input) });
}

async function copyExactSourceToSnapshot(input: CreateIngressSnapshotInput, destinationPath: string): Promise<void> {
  const sourcePath = path.resolve(input.sourcePath);
  const pathBefore = await fs.promises.lstat(sourcePath).catch(() => undefined);
  const realBefore = await fs.promises.realpath(sourcePath).catch(() => undefined);
  if (!pathBefore?.isFile() || pathBefore.isSymbolicLink() || !realBefore || realBefore !== sourcePath) throw sourceUnavailable();
  assertIdentity(pathBefore, input.noFollowIdentity);
  const source = await fs.promises.open(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
  if (!source) throw sourceUnavailable();
  let destination: fs.promises.FileHandle | undefined;
  try {
    const descriptorBefore = await source.stat();
    assertIdentity(descriptorBefore, input.noFollowIdentity);
    destination = await fs.promises.open(destinationPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < input.size) {
      const read = await source.read(buffer, 0, Math.min(buffer.length, input.size - position), position);
      if (read.bytesRead === 0) throw sourceChanged();
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < chunk.length) {
        const result = await destination.write(chunk, written, chunk.length - written, position + written);
        if (result.bytesWritten === 0) throw sourceChanged();
        written += result.bytesWritten;
      }
      position += read.bytesRead;
    }
    await destination.sync();
    const descriptorAfter = await source.stat();
    const pathAfter = await fs.promises.lstat(sourcePath).catch(() => undefined);
    const realAfter = await fs.promises.realpath(sourcePath).catch(() => undefined);
    assertIdentity(descriptorAfter, input.noFollowIdentity);
    if (!pathAfter?.isFile() || pathAfter.isSymbolicLink() || realAfter !== realBefore) throw sourceChanged();
    assertIdentity(pathAfter, input.noFollowIdentity);
    if (position !== input.size || `sha256:${hash.digest("hex")}` !== input.checksum) throw sourceChanged();
  } finally {
    await destination?.close().catch(() => undefined);
    await source.close().catch(() => undefined);
  }
  if (process.platform !== "win32") await fs.promises.chmod(destinationPath, 0o400);
}

async function verifyOriginalCurrent(descriptor: IngressSnapshotDescriptor): Promise<void> {
  const sourcePath = descriptor.sourceProvenance.originalPath;
  const stat = await fs.promises.lstat(sourcePath).catch(() => undefined);
  const real = await fs.promises.realpath(sourcePath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || real !== sourcePath) throw sourceUnavailable();
  assertIdentity(stat, descriptor.sourceProvenance.identity);
  const integrity = await fileIntegrity(sourcePath);
  if (integrity.checksum !== descriptor.checksum || integrity.size !== descriptor.size) throw sourceChanged();
}

async function copySnapshotToManagedDestination(
  snapshotPath: string,
  destinationPath: string,
  descriptor: IngressSnapshotDescriptor
): Promise<void> {
  const temporary = `${destinationPath}.${randomUUID()}.tmp`;
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  try {
    await fs.promises.copyFile(snapshotPath, temporary, fs.constants.COPYFILE_EXCL | (fs.constants.COPYFILE_FICLONE ?? 0));
    const integrity = await fileIntegrity(temporary);
    if (integrity.checksum !== descriptor.checksum || integrity.size !== descriptor.size) throw descriptorMismatch();
    await fs.promises.rename(temporary, destinationPath);
    const adopted = await fileIntegrity(destinationPath);
    if (adopted.checksum !== descriptor.checksum || adopted.size !== descriptor.size) throw descriptorMismatch();
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function validateManagedDestination(rootPath: string, destinationPath: string): Promise<string> {
  const root = await fs.promises.realpath(rootPath).catch(() => undefined);
  if (!root) throw descriptorMismatch();
  const destination = path.resolve(destinationPath);
  if (!isContained(destination, root)) throw descriptorMismatch();
  let current = path.dirname(destination);
  const pending: string[] = [];
  while (!fs.existsSync(current)) {
    pending.push(current);
    const parent = path.dirname(current);
    if (parent === current) throw descriptorMismatch();
    current = parent;
  }
  const realParent = await fs.promises.realpath(current).catch(() => undefined);
  if (!realParent || !isContained(realParent, root)) throw descriptorMismatch();
  const parentStat = await fs.promises.lstat(current).catch(() => undefined);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink()) throw descriptorMismatch();
  for (const directory of pending.reverse()) await fs.promises.mkdir(directory, { mode: 0o700 });
  const existing = await fs.promises.lstat(destination).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw descriptorMismatch();
  return destination;
}

async function ensurePrivateRoot(vaultPath: string): Promise<string> {
  const vault = await fs.promises.realpath(vaultPath).catch(() => undefined);
  if (!vault) throw descriptorMismatch();
  const root = path.join(vault, ...PRIVATE_ROOT);
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const real = await fs.promises.realpath(root).catch(() => undefined);
  const stat = await fs.promises.lstat(root).catch(() => undefined);
  if (!real || !isContained(real, vault) || !stat?.isDirectory() || stat.isSymbolicLink()) throw descriptorMismatch();
  return real;
}

function descriptorDirectorySync(vaultPath: string, binding: IngressSnapshotBinding): string {
  const vault = fs.realpathSync(vaultPath);
  const root = path.join(vault, ...PRIVATE_ROOT);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !isContained(fs.realpathSync(root), vault)) throw descriptorMismatch();
  return path.join(root, descriptorId(binding));
}

function descriptorDirectoryOptionalSync(vaultPath: string, binding: IngressSnapshotBinding): string | undefined {
  const vault = fs.realpathSync(vaultPath);
  const root = path.join(vault, ...PRIVATE_ROOT);
  let rootStat: fs.Stats;
  try { rootStat = fs.lstatSync(root); } catch (caught) { if (isNotFound(caught)) return undefined; throw caught; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !isContained(fs.realpathSync(root), vault)) throw descriptorMismatch();
  return path.join(root, descriptorId(binding));
}

async function descriptorDirectory(vaultPath: string, binding: IngressSnapshotBinding): Promise<string> {
  return path.join(await ensurePrivateRoot(vaultPath), descriptorId(binding));
}

async function descriptorDirectoryOptional(
  vaultPath: string,
  binding: IngressSnapshotBinding
): Promise<string | undefined> {
  const root = await privateRootOptional(vaultPath);
  return root ? path.join(root, descriptorId(binding)) : undefined;
}

function descriptorDirectoryFromVault(vaultPath: string, binding: IngressSnapshotBinding): string {
  return path.join(fs.realpathSync(vaultPath), ...PRIVATE_ROOT, descriptorId(binding));
}

async function privateRootOptional(vaultPath: string): Promise<string | undefined> {
  const vault = await fs.promises.realpath(vaultPath).catch(() => undefined);
  if (!vault) throw descriptorMismatch();
  const root = path.join(vault, ...PRIVATE_ROOT);
  const stat = await fs.promises.lstat(root).catch((caught: unknown) => {
    if (isNotFound(caught)) return undefined;
    throw caught;
  });
  if (!stat) return undefined;
  const real = await fs.promises.realpath(root).catch(() => undefined);
  if (!real || !stat.isDirectory() || stat.isSymbolicLink() || !isContained(real, vault)) throw descriptorMismatch();
  return real;
}

async function writeDescriptorAtomic(directory: string, descriptor: IngressSnapshotDescriptor): Promise<void> {
  const target = path.join(directory, "descriptor.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.promises.open(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.promises.rename(temporary, target);
}

async function readDescriptor(directory: string): Promise<IngressSnapshotDescriptor> {
  const descriptor = await readDescriptorOptional(directory);
  if (!descriptor) throw snapshotError("ingress_snapshot.not_found", "The private ingress snapshot is unavailable.");
  return descriptor;
}

async function readDescriptorOptional(directory: string): Promise<IngressSnapshotDescriptor | undefined> {
  try { return parseDescriptor(JSON.parse(await fs.promises.readFile(path.join(directory, "descriptor.json"), "utf8"))); }
  catch (caught) {
    if (isNotFound(caught)) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw descriptorMismatch();
  }
}

function readDescriptorOptionalSync(directory: string): IngressSnapshotDescriptor | undefined {
  try { return parseDescriptor(JSON.parse(fs.readFileSync(path.join(directory, "descriptor.json"), "utf8"))); }
  catch (caught) {
    if (isNotFound(caught)) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw descriptorMismatch();
  }
}

function parseDescriptor(value: unknown): IngressSnapshotDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw descriptorMismatch();
  const record = value as Record<string, unknown>;
  const descriptor = record as unknown as IngressSnapshotDescriptor;
  validateBinding(descriptor);
  if (
    descriptor.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    descriptor.descriptorId !== descriptorId(descriptor) ||
    !SHA256_PATTERN.test(descriptor.checksum) ||
    !SHA256_PATTERN.test(descriptor.descriptorDigest) ||
    !Number.isInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > MAX_SOURCE_BYTES ||
    !/^snapshot(?:\.[A-Za-z0-9]{1,12})?$/u.test(descriptor.snapshotFileName) ||
    !descriptor.sourceProvenance || typeof descriptor.sourceProvenance.originalPath !== "string" ||
    !path.isAbsolute(descriptor.sourceProvenance.originalPath) ||
    typeof descriptor.createdAt !== "string" || typeof descriptor.updatedAt !== "string"
  ) throw descriptorMismatch();
  validateIdentity(descriptor.sourceProvenance.identity);
  const { descriptorDigest: _digest, ...unsigned } = descriptor;
  if (hashCanonical("pige.ingress_snapshot.descriptor.v1", unsigned) !== descriptor.descriptorDigest) throw descriptorMismatch();
  return Object.freeze(descriptor);
}

async function verifySnapshot(directory: string, descriptor: IngressSnapshotDescriptor): Promise<void> {
  const snapshotPath = path.join(directory, descriptor.snapshotFileName);
  const stat = await fs.promises.lstat(snapshotPath).catch(() => undefined);
  const real = await fs.promises.realpath(snapshotPath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink() || real !== snapshotPath || !isContained(snapshotPath, directory)) throw descriptorMismatch();
  const integrity = await fileIntegrity(snapshotPath);
  if (integrity.checksum !== descriptor.checksum || integrity.size !== descriptor.size) throw descriptorMismatch();
}

function verifySnapshotSync(directory: string, descriptor: IngressSnapshotDescriptor): void {
  const snapshotPath = path.join(directory, descriptor.snapshotFileName);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(snapshotPath); } catch { throw descriptorMismatch(); }
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(snapshotPath) !== snapshotPath || !isContained(snapshotPath, directory)) throw descriptorMismatch();
  const integrity = fileIntegritySync(snapshotPath);
  if (integrity.checksum !== descriptor.checksum || integrity.size !== descriptor.size) throw descriptorMismatch();
}

function validateCreateInput(input: CreateIngressSnapshotInput): void {
  validateBinding(input);
  if (!path.isAbsolute(input.vaultPath) || !path.isAbsolute(input.sourcePath) || !SHA256_PATTERN.test(input.checksum)) throw descriptorMismatch();
  if (!Number.isInteger(input.size) || input.size < 0 || input.size > MAX_SOURCE_BYTES) throw descriptorMismatch();
  validateIdentity(input.noFollowIdentity);
  if (input.noFollowIdentity.size !== input.size) throw descriptorMismatch();
}

function validateBinding(binding: IngressSnapshotBinding): void {
  if (!binding || !ID_PATTERN.test(binding.vaultId) || !ID_PATTERN.test(binding.parentJobId) || !ID_PATTERN.test(binding.sourceId) || !Number.isInteger(binding.ordinal) || binding.ordinal < 0 || binding.ordinal > 255) {
    throw descriptorMismatch();
  }
}

function validateIdentity(identity: IngressSnapshotFileIdentity): void {
  if (!identity || [identity.device, identity.inode, identity.size, identity.modifiedAtMs, identity.changedAtMs].some((value) => !Number.isFinite(value) || value < 0)) {
    throw descriptorMismatch();
  }
}

function validateReleaseProof(proof: IngressSnapshotReleaseProof): void {
  validateBinding(proof);
  if (!SHA256_PATTERN.test(proof.expectedDescriptorDigest) || !["terminal", "durable_adopted", "proven_orphan"].includes(proof.parentDisposition) || proof.childOwnershipComplete !== true || !Array.isArray(proof.recoveryOwnerIds) || proof.recoveryOwnerIds.length !== 0) {
    throw descriptorMismatch();
  }
}

function assertBinding(descriptor: IngressSnapshotBinding, binding: IngressSnapshotBinding): void {
  if (bindingKey(descriptor) !== bindingKey(binding)) throw descriptorMismatch();
}

function assertIdentity(stat: fs.Stats, identity: IngressSnapshotFileIdentity): void {
  if (stat.dev !== identity.device || stat.ino !== identity.inode || stat.size !== identity.size || stat.mtimeMs !== identity.modifiedAtMs || stat.ctimeMs !== identity.changedAtMs) throw sourceChanged();
}

function descriptorId(binding: IngressSnapshotBinding): string {
  return `snap_${createHash("sha256").update(bindingKey(binding), "utf8").digest("hex").slice(0, 40)}`;
}

function bindingKey(binding: IngressSnapshotBinding): string {
  return `${binding.vaultId}\0${binding.parentJobId}\0${binding.sourceId}\0${binding.ordinal}`;
}

async function fileIntegrity(filePath: string): Promise<{ readonly checksum: `sha256:${string}`; readonly size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    size += bytes.byteLength;
  }
  return { checksum: `sha256:${hash.digest("hex")}`, size };
}

function fileIntegritySync(filePath: string): { readonly checksum: `sha256:${string}`; readonly size: number } {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let size = 0;
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        size += bytesRead;
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return { checksum: `sha256:${hash.digest("hex")}`, size };
}

async function fileIntegrityOptional(filePath: string): Promise<{ readonly checksum: `sha256:${string}`; readonly size: number } | undefined> {
  try { return await fileIntegrity(filePath); } catch (caught) { if (isNotFound(caught)) return undefined; throw caught; }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await fs.promises.open(directory, fs.constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function safeExtension(filePath: string): string {
  const extension = path.extname(filePath);
  return /^\.[A-Za-z0-9]{1,12}$/u.test(extension) ? extension.toLowerCase() : ".bin";
}

function isContained(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(domain, "utf8").update("\0", "utf8").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isAlreadyExists(caught: unknown): boolean {
  return Boolean(
    caught &&
    typeof caught === "object" &&
    "code" in caught &&
    ["EEXIST", "ENOTEMPTY"].includes((caught as NodeJS.ErrnoException).code ?? "")
  );
}

function isNotFound(caught: unknown): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && (caught as NodeJS.ErrnoException).code === "ENOENT");
}

function descriptorMismatch(): PigeDomainError {
  return snapshotError("ingress_snapshot.descriptor_mismatch", "The private ingress snapshot identity does not match its durable owner.");
}

function sourceUnavailable(): PigeDomainError {
  return snapshotError("ingress_snapshot.source_unavailable", "The accepted source file is unavailable for private snapshot creation.");
}

function sourceChanged(): PigeDomainError {
  return snapshotError("ingress_snapshot.source_changed", "The accepted source file changed across its private snapshot boundary.");
}

function snapshotError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}
