import fs from "node:fs";

const PORTABLE_UNSUPPORTED_CODES = new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]);
const WINDOWS_UNSUPPORTED_CODES = new Set(["EACCES", "EISDIR", "EPERM"]);

export function flushDirectoryWhereSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFlush(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Cleanup must not replace the durable write result.
      }
    }
  }
}

export function isUnsupportedDirectoryFlush(
  value: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  return PORTABLE_UNSUPPORTED_CODES.has(code) || (platform === "win32" && WINDOWS_UNSUPPORTED_CODES.has(code));
}
