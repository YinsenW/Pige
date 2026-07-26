import { randomUUID } from "node:crypto";
import fs from "node:fs";

export interface ContainedFileCommitBoundary {
  readonly prepareSync: (vaultPath: string, filePath: string) => void;
  readonly verifySync: (vaultPath: string, filePath: string) => void;
  readonly prepare: (vaultPath: string, filePath: string) => Promise<void>;
  readonly verify: (vaultPath: string, filePath: string) => Promise<void>;
}

export function createContainedFileCommit(boundary: ContainedFileCommitBoundary) {
  function writeJsonAtomic(filePath: string, value: unknown, vaultPath: string): void {
    boundary.prepareSync(vaultPath, filePath);
    const temporaryPath = createTemporaryPath(filePath);
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      fs.renameSync(temporaryPath, filePath);
      boundary.verifySync(vaultPath, filePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  async function writeJsonAtomicAsync(filePath: string, value: unknown, vaultPath: string): Promise<void> {
    await writeTextAtomicAsync(filePath, `${JSON.stringify(value, null, 2)}\n`, vaultPath);
  }

  async function writeTextAtomicAsync(filePath: string, value: string, vaultPath: string): Promise<void> {
    await writeAtomicAsync(filePath, value, vaultPath, "utf8");
  }

  async function writeBinaryAtomicAsync(filePath: string, value: Uint8Array, vaultPath: string): Promise<void> {
    await writeAtomicAsync(filePath, value, vaultPath);
  }

  async function writeAtomicAsync(
    filePath: string,
    value: string | Uint8Array,
    vaultPath: string,
    encoding?: BufferEncoding
  ): Promise<void> {
    await boundary.prepare(vaultPath, filePath);
    const temporaryPath = createTemporaryPath(filePath);
    try {
      await fs.promises.writeFile(temporaryPath, value, { encoding, flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporaryPath, filePath);
      await boundary.verify(vaultPath, filePath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
    }
  }

  return { writeBinaryAtomicAsync, writeJsonAtomic, writeJsonAtomicAsync, writeTextAtomicAsync };
}

function createTemporaryPath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}
