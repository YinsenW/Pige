import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

export interface VerifiedFileSnapshot {
  readonly absolutePath: string;
  readonly checksum: string;
  readonly size: number;
  dispose(): Promise<void>;
}

export interface VerifiedFileSnapshotInput {
  readonly sourcePath: string;
  readonly expectedChecksum: string;
  readonly expectedSize: number;
  readonly unavailableCode: string;
  readonly integrityCode: string;
  readonly containmentRoot?: string;
}

export async function createVerifiedFileSnapshot(
  input: VerifiedFileSnapshotInput
): Promise<VerifiedFileSnapshot> {
  let source: fs.promises.FileHandle | undefined;
  let destination: fs.promises.FileHandle | undefined;
  let temporaryDirectory: string | undefined;
  try {
    const sourcePath = path.resolve(input.sourcePath);
    const realPathBefore = await fs.promises.realpath(sourcePath).catch(() => undefined);
    if (!realPathBefore) throw unavailableError(input);
    if (input.containmentRoot) {
      const realRoot = await fs.promises.realpath(input.containmentRoot).catch(() => undefined);
      if (!realRoot || !isContainedPath(realPathBefore, realRoot)) {
        throw new PigeDomainError(input.integrityCode, "The verified input resolves outside its allowed root.");
      }
    }

    const pathStatBefore = await fs.promises.lstat(sourcePath).catch(() => undefined);
    if (!pathStatBefore?.isFile() || pathStatBefore.isSymbolicLink()) throw unavailableError(input);
    if (pathStatBefore.size !== input.expectedSize) throw integrityError(input);

    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    source = await fs.promises.open(sourcePath, flags).catch(() => undefined);
    if (!source) throw unavailableError(input);
    const descriptorStatBefore = await source.stat();
    if (
      !descriptorStatBefore.isFile() ||
      descriptorStatBefore.dev !== pathStatBefore.dev ||
      descriptorStatBefore.ino !== pathStatBefore.ino ||
      descriptorStatBefore.size !== input.expectedSize
    ) throw integrityError(input);

    temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pige-verified-input-"));
    await fs.promises.chmod(temporaryDirectory, 0o700);
    const extension = safeExtension(sourcePath);
    const snapshotPath = path.join(temporaryDirectory, `snapshot-${randomUUID()}${extension}`);
    destination = await fs.promises.open(
      snapshotPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600
    );

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < descriptorStatBefore.size) {
      const read = await source.read(
        buffer,
        0,
        Math.min(buffer.length, descriptorStatBefore.size - position),
        position
      );
      if (read.bytesRead === 0) throw integrityError(input);
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < chunk.length) {
        const result = await destination.write(chunk, written, chunk.length - written, position + written);
        if (result.bytesWritten === 0) throw integrityError(input);
        written += result.bytesWritten;
      }
      position += read.bytesRead;
    }
    await destination.sync();

    const descriptorStatAfter = await source.stat();
    const pathStatAfter = await fs.promises.lstat(sourcePath).catch(() => undefined);
    const realPathAfter = await fs.promises.realpath(sourcePath).catch(() => undefined);
    if (
      position !== descriptorStatBefore.size ||
      descriptorStatAfter.dev !== descriptorStatBefore.dev ||
      descriptorStatAfter.ino !== descriptorStatBefore.ino ||
      descriptorStatAfter.size !== descriptorStatBefore.size ||
      descriptorStatAfter.mtimeMs !== descriptorStatBefore.mtimeMs ||
      descriptorStatAfter.ctimeMs !== descriptorStatBefore.ctimeMs ||
      !pathStatAfter?.isFile() ||
      pathStatAfter.isSymbolicLink() ||
      pathStatAfter.dev !== descriptorStatBefore.dev ||
      pathStatAfter.ino !== descriptorStatBefore.ino ||
      realPathAfter !== realPathBefore
    ) throw integrityError(input);

    const checksum = `sha256:${hash.digest("hex")}`;
    if (checksum !== input.expectedChecksum) throw integrityError(input);
    const destinationStat = await destination.stat();
    if (!destinationStat.isFile() || destinationStat.size !== input.expectedSize) throw integrityError(input);
    await destination.close();
    destination = undefined;
    await source.close();
    source = undefined;
    if (process.platform !== "win32") await fs.promises.chmod(snapshotPath, 0o400);

    const ownedDirectory = temporaryDirectory;
    temporaryDirectory = undefined;
    return {
      absolutePath: snapshotPath,
      checksum,
      size: input.expectedSize,
      dispose: async () => {
        await fs.promises.rm(ownedDirectory, { recursive: true, force: true });
      }
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("source.snapshot_failed", "Pige could not create a private immutable source input snapshot.");
  } finally {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    if (temporaryDirectory) {
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function unavailableError(input: VerifiedFileSnapshotInput): PigeDomainError {
  return new PigeDomainError(input.unavailableCode, "The verified input file is unavailable.");
}

function integrityError(input: VerifiedFileSnapshotInput): PigeDomainError {
  return new PigeDomainError(input.integrityCode, "The verified input file changed while its immutable snapshot was created.");
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function safeExtension(filePath: string): string {
  const extension = path.extname(filePath);
  return /^\.[a-z0-9]{1,12}$/iu.test(extension) ? extension : ".bin";
}
