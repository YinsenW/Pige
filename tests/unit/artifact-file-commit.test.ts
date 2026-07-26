import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeArtifactJsonAtomic,
  writeArtifactJsonAtomicAsync,
  writeArtifactTextAtomic,
  writeArtifactTextAtomicAsync
} from "../../apps/desktop/src/main/services/artifact-file-commit";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directoryPath of temporaryDirectories.splice(0)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

describe("artifact file commit", () => {
  it("preserves exact text and replaces the destination atomically", () => {
    const root = createTemporaryRoot();
    const filePath = path.join(root, "nested", "artifact.txt");

    writeArtifactTextAtomic(filePath, "first\n");
    writeArtifactTextAtomic(filePath, "  replacement\n\n");

    expect(fs.readFileSync(filePath, "utf8")).toBe("  replacement\n\n");
    expect(readTemporaryFiles(path.dirname(filePath))).toEqual([]);
  });

  it("writes deterministic pretty JSON with one trailing newline", async () => {
    const root = createTemporaryRoot();
    const syncPath = path.join(root, "sync.json");
    const asyncPath = path.join(root, "async.json");
    const value = { id: "artifact", nested: { ready: true } };

    writeArtifactJsonAtomic(syncPath, value);
    await writeArtifactJsonAtomicAsync(asyncPath, value);

    const expected = `${JSON.stringify(value, null, 2)}\n`;
    expect(fs.readFileSync(syncPath, "utf8")).toBe(expected);
    expect(fs.readFileSync(asyncPath, "utf8")).toBe(expected);
  });

  it("preserves exact async text and removes its temporary", async () => {
    const root = createTemporaryRoot();
    const filePath = path.join(root, "nested", "artifact.txt");

    await writeArtifactTextAtomicAsync(filePath, "\nexact async body  \n");

    expect(fs.readFileSync(filePath, "utf8")).toBe("\nexact async body  \n");
    expect(readTemporaryFiles(path.dirname(filePath))).toEqual([]);
  });
});

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-artifact-commit-"));
  temporaryDirectories.push(root);
  return root;
}

function readTemporaryFiles(directoryPath: string): string[] {
  return fs.readdirSync(directoryPath).filter((entry) => entry.endsWith(".tmp"));
}
