import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import {
  SkillZipStageError,
  SkillZipStageService
} from "../../apps/desktop/src/main/services/skill-zip-stage-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SkillZipStageService", () => {
  it("normalizes one wrapped pure Skill root and returns only verified UTF-8 files", async () => {
    const root = createRoot();
    const archivePath = path.join(root, "review.zip");
    fs.writeFileSync(archivePath, await createZip([
      ["review/SKILL.md", manifest()],
      ["review/references/guide.md", "# Guide\nUse exact source evidence.\n"],
      ["review/references/config.json", "{\"mode\":\"safe\"}\n"]
    ]), { mode: 0o600 });

    const bundle = await new SkillZipStageService(root).readSelectedArchive(archivePath);

    expect(bundle.files.map((file) => file.relativePath)).toEqual([
      "references/config.json", "references/guide.md", "SKILL.md"
    ]);
    expect(bundle.manifestBytes.toString("utf8")).toBe(manifest());
    expect(bundle.bundleSha256).not.toBe(bundle.manifestSha256);
    expect(JSON.stringify(bundle)).not.toContain(archivePath);
    expect(fs.readdirSync(path.join(root, "skills", "zip-import"))).toEqual([]);
  });

  it("rejects colliding names and link-like entries without retaining a snapshot", async () => {
    const root = createRoot();
    const service = new SkillZipStageService(root);
    const collision = path.join(root, "collision.zip");
    fs.writeFileSync(collision, await createZip([
      ["SKILL.md", manifest()],
      ["Guide.md", "one"],
      ["guide.MD", "two"]
    ]), { mode: 0o600 });
    await expect(service.readSelectedArchive(collision)).rejects.toMatchObject<Partial<SkillZipStageError>>({
      reason: "archive_unsafe"
    });

    const linked = path.join(root, "linked.zip");
    fs.linkSync(collision, linked);
    await expect(service.readSelectedArchive(linked)).rejects.toMatchObject<Partial<SkillZipStageError>>({
      reason: "archive_unsafe"
    });
    expect(fs.readdirSync(path.join(root, "skills", "zip-import"))).toEqual([]);
  });
});

function createRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-skill-zip-")));
  roots.push(root);
  return root;
}

function manifest(): string {
  return [
    "---",
    "id: zip-review",
    "name: ZIP Review",
    "version: 1",
    "description: Review one pure local Skill bundle.",
    "scope: machine_local",
    "kind: pure",
    "capabilities: [read_current_source]",
    "data_boundaries: [local]",
    "---",
    "# Procedure",
    "Use exact source evidence.",
    ""
  ].join("\n");
}

async function createZip(entries: readonly (readonly [string, string])[]): Promise<Buffer> {
  const archive = new ZipFile();
  const chunks: Buffer[] = [];
  archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const [name, content] of entries) archive.addBuffer(Buffer.from(content, "utf8"), name);
  archive.end();
  return completed;
}
