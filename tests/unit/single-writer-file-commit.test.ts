import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeSingleWriterFileAtomic,
  writeSingleWriterJsonAtomic
} from "../../apps/desktop/src/main/services/single-writer-file-commit";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directoryPath of temporaryDirectories.splice(0)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

describe("single-writer file commit", () => {
  it("preserves exact text and binary bytes through atomic replacement", () => {
    const root = createTemporaryRoot();
    const textPath = path.join(root, "nested", "record.txt");
    const binaryPath = path.join(root, "source.bin");

    writeSingleWriterFileAtomic(textPath, "  exact text\n\n");
    writeSingleWriterFileAtomic(binaryPath, Buffer.from([0, 1, 2, 255]));

    expect(fs.readFileSync(textPath, "utf8")).toBe("  exact text\n\n");
    expect(fs.readFileSync(binaryPath)).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(readTemporaryFiles(path.dirname(textPath))).toEqual([]);
  });

  it("writes deterministic pretty JSON with one trailing newline", () => {
    const root = createTemporaryRoot();
    const filePath = path.join(root, "record.json");
    const value = { id: "source", ready: true };

    writeSingleWriterJsonAtomic(filePath, value);

    expect(fs.readFileSync(filePath, "utf8")).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });
});

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-single-writer-commit-"));
  temporaryDirectories.push(root);
  return root;
}

function readTemporaryFiles(directoryPath: string): string[] {
  return fs.readdirSync(directoryPath).filter((entry) => entry.endsWith(".tmp"));
}
