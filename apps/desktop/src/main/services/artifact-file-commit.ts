import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeArtifactJsonAtomic(filePath: string, value: unknown): void {
  writeArtifactTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeArtifactJsonAtomicAsync(filePath: string, value: unknown): Promise<void> {
  await writeArtifactTextAtomicAsync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeArtifactTextAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, value, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export async function writeArtifactTextAtomicAsync(filePath: string, value: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, value, "utf8");
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}
