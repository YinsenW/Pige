import fs from "node:fs";
import path from "node:path";

export function writeSingleWriterJsonAtomic(filePath: string, value: unknown): void {
  writeSingleWriterFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeSingleWriterFileAtomic(filePath: string, value: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}
