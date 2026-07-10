import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVerifiedFileSnapshot } from "../../apps/desktop/src/main/services/verified-file-snapshot";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("verified file snapshot", () => {
  it("copies bytes into a private checksum-bound snapshot and applies POSIX read-only mode", async () => {
    const root = makeRoot();
    const sourcePath = path.join(root, "source.pdf");
    const bytes = Buffer.from("verified source bytes");
    fs.writeFileSync(sourcePath, bytes);

    const snapshot = await createVerifiedFileSnapshot({
      sourcePath,
      expectedChecksum: checksum(bytes),
      expectedSize: bytes.length,
      unavailableCode: "snapshot.unavailable",
      integrityCode: "snapshot.changed",
      containmentRoot: root
    });
    fs.writeFileSync(sourcePath, "replacement bytes", "utf8");

    expect(snapshot.absolutePath).not.toBe(sourcePath);
    expect(fs.readFileSync(snapshot.absolutePath)).toEqual(bytes);
    if (process.platform !== "win32") expect(fs.statSync(snapshot.absolutePath).mode & 0o777).toBe(0o400);
    const snapshotDirectory = path.dirname(snapshot.absolutePath);
    await snapshot.dispose();
    expect(fs.existsSync(snapshotDirectory)).toBe(false);
  });

  it("rejects a managed input whose parent symlink resolves outside its root", async () => {
    const root = makeRoot();
    const outside = makeRoot();
    const outsideFile = path.join(outside, "outside.pdf");
    const bytes = Buffer.from("outside bytes");
    fs.writeFileSync(outsideFile, bytes);
    fs.symlinkSync(outside, path.join(root, "linked"), "dir");

    await expect(createVerifiedFileSnapshot({
      sourcePath: path.join(root, "linked", "outside.pdf"),
      expectedChecksum: checksum(bytes),
      expectedSize: bytes.length,
      unavailableCode: "snapshot.unavailable",
      integrityCode: "snapshot.changed",
      containmentRoot: root
    })).rejects.toMatchObject({ code: "snapshot.changed" });
  });

  it("rejects bytes that do not match the recorded checksum", async () => {
    const root = makeRoot();
    const sourcePath = path.join(root, "source.png");
    const bytes = Buffer.from("actual bytes");
    fs.writeFileSync(sourcePath, bytes);

    await expect(createVerifiedFileSnapshot({
      sourcePath,
      expectedChecksum: checksum(Buffer.from("expected bytes")),
      expectedSize: bytes.length,
      unavailableCode: "snapshot.unavailable",
      integrityCode: "snapshot.changed"
    })).rejects.toMatchObject({ code: "snapshot.changed" });
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-snapshot-test-"));
  roots.push(root);
  return root;
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
