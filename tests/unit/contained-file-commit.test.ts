import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContainedFileCommit } from "../../apps/desktop/src/main/services/contained-file-commit";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directoryPath of temporaryDirectories.splice(0)) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  }
});

describe("contained file commit", () => {
  it("preserves boundary order and exact JSON, text, and binary bytes", async () => {
    const root = createTemporaryRoot();
    const events: string[] = [];
    const commit = createContainedFileCommit(createBoundary(events));
    const jsonPath = path.join(root, "nested", "record.json");
    const textPath = path.join(root, "record.txt");
    const binaryPath = path.join(root, "record.bin");

    commit.writeJsonAtomic(jsonPath, { ready: true }, root);
    await commit.writeTextAtomicAsync(textPath, "  exact text\n\n", root);
    await commit.writeBinaryAtomicAsync(binaryPath, Uint8Array.from([0, 1, 2, 255]), root);

    expect(events).toEqual([
      `prepare-sync:${jsonPath}`,
      `verify-sync:${jsonPath}`,
      `prepare:${textPath}`,
      `verify:${textPath}`,
      `prepare:${binaryPath}`,
      `verify:${binaryPath}`
    ]);
    expect(fs.readFileSync(jsonPath, "utf8")).toBe(`${JSON.stringify({ ready: true }, null, 2)}\n`);
    expect(fs.readFileSync(textPath, "utf8")).toBe("  exact text\n\n");
    expect(fs.readFileSync(binaryPath)).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(readTemporaryFiles(root)).toEqual([]);
    expect(readTemporaryFiles(path.dirname(jsonPath))).toEqual([]);
  });

  it("removes the temporary while preserving a renamed target when post-write verification fails", async () => {
    const root = createTemporaryRoot();
    const filePath = path.join(root, "record.txt");
    const commit = createContainedFileCommit({
      ...createBoundary([]),
      verify: async () => {
        throw new Error("outside");
      }
    });

    await expect(commit.writeTextAtomicAsync(filePath, "committed", root)).rejects.toThrow("outside");

    expect(fs.readFileSync(filePath, "utf8")).toBe("committed");
    expect(readTemporaryFiles(root)).toEqual([]);
  });
});

function createBoundary(events: string[]) {
  return {
    prepareSync: (_vaultPath: string, filePath: string) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      events.push(`prepare-sync:${filePath}`);
    },
    verifySync: (_vaultPath: string, filePath: string) => {
      events.push(`verify-sync:${filePath}`);
    },
    prepare: async (_vaultPath: string, filePath: string) => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      events.push(`prepare:${filePath}`);
    },
    verify: async (_vaultPath: string, filePath: string) => {
      events.push(`verify:${filePath}`);
    }
  };
}

function createTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-contained-commit-"));
  temporaryDirectories.push(root);
  return root;
}

function readTemporaryFiles(directoryPath: string): string[] {
  return fs.readdirSync(directoryPath).filter((entry) => entry.endsWith(".tmp"));
}
