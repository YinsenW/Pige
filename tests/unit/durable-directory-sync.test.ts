import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  flushDirectoryWhereSupported,
  isUnsupportedDirectoryFlush
} from "../../apps/desktop/src/main/services/durable-directory-sync";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directoryPath of temporaryDirectories.splice(0)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

describe("durable directory sync", () => {
  it("flushes a real directory when the platform supports it", () => {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-directory-sync-"));
    temporaryDirectories.push(directoryPath);

    expect(() => flushDirectoryWhereSupported(directoryPath)).not.toThrow();
  });

  it("recognizes only the bounded unsupported error set", () => {
    const unsupported = Object.assign(new Error("unsupported"), { code: "ENOTSUP" });
    const windowsOnly = Object.assign(new Error("denied"), { code: "EPERM" });
    const realFailure = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(isUnsupportedDirectoryFlush(unsupported, "darwin")).toBe(true);
    expect(isUnsupportedDirectoryFlush(windowsOnly, "win32")).toBe(true);
    expect(isUnsupportedDirectoryFlush(windowsOnly, "darwin")).toBe(false);
    expect(isUnsupportedDirectoryFlush(realFailure, "win32")).toBe(false);
    expect(isUnsupportedDirectoryFlush("ENOTSUP", "darwin")).toBe(false);
  });

  it("propagates real directory failures", () => {
    const missingPath = path.join(os.tmpdir(), `pige-directory-sync-missing-${process.pid}-${Date.now()}`);

    expect(() => flushDirectoryWhereSupported(missingPath)).toThrow();
  });
});
