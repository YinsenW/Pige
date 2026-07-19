import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SkillRegistryFileSchema,
  SkillRegistrySummarySchema,
  type SkillRegistrySummary
} from "@pige/schemas";
import {
  acquireSkillRegistryMutationLock,
  SkillRegistryService,
  parseSkillManifest
} from "../../apps/desktop/src/main/services/skill-registry-service";

const timestamp = "2026-07-18T12:00:00.000Z";
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SkillRegistryService", () => {
  it("projects only checksum-bound machine-local manifest metadata without paths, bodies, or source details", () => {
    const root = createRoot();
    const source = manifest({
      id: "paper-reading",
      name: "Paper Reading",
      version: "1.2.0",
      description: "Build source-backed research notes.",
      capabilities: ["read_current_source", "suggest_note", "create_review_proposal"],
      extra: [
        "author: Example Author",
        "license: Apache-2.0",
        "sourceUrl: https://example.com/private/install-location",
        "permissionSummary: This internal explanation must not cross the renderer boundary."
      ],
      body: "## Procedure\n\nRead the preserved source and produce cited notes."
    });
    seedInstalledSkill(root, source, true);

    const summary = readySummary(new SkillRegistryService(root));

    expect(summary).toEqual({
      apiVersion: 1,
      revision: 3,
      invalidManifestCount: 0,
      skills: [{
        id: "paper-reading",
        name: "Paper Reading",
        version: "1.2.0",
        description: "Build source-backed research notes.",
        scope: "machine_local",
        kind: "pure",
        enabled: true,
        trust: "user_confirmed",
        capabilities: ["read_current_source", "suggest_note", "create_review_proposal"],
        dataBoundaries: ["local"],
        author: "Example Author",
        license: "Apache-2.0"
      }]
    });
    expect(SkillRegistrySummarySchema.parse(summary)).toEqual(summary);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("SKILL.md");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("private/install-location");
    expect(serialized).not.toContain("internal explanation");
    expect(serialized).not.toContain("Read the preserved source");
  });

  it("derives external data boundaries from strict capabilities instead of trusting display copy", () => {
    const root = createRoot();
    const source = manifest({
      id: "web-research",
      name: "Web Research",
      version: "2",
      description: "Fetch reviewed web sources.",
      kind: "external_web",
      capabilities: ["external_network", "external_filesystem", "use_brokered_credential"],
      extra: ["dataBoundary: [local]"],
      body: "## Procedure\n\nRequest capabilities through Pige services."
    });
    seedInstalledSkill(root, source, false);

    expect(readySummary(new SkillRegistryService(root)).skills[0]).toMatchObject({
      id: "web-research",
      enabled: false,
      capabilities: ["external_network", "external_filesystem", "use_brokered_credential"],
      dataBoundaries: ["filesystem", "network", "brokered_credential"]
    });
  });

  it("rejects path and credential-shaped display metadata while allowing benign public URLs", () => {
    const root = createRoot();
    const unsafeSources = [
      manifest({
        id: "path-display",
        name: "Path Display",
        version: "1",
        description: "Reads /Users/example/private/notes.md",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "sensitive-url-display",
        name: "Sensitive URL Display",
        version: "1",
        description: "Visit https://example.com/?token=private",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "aws-key-display",
        name: "AWS Key Display",
        version: "1",
        description: "Credential AKIAABCDEFGHIJKLMNOP",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "bearer-display",
        name: "Bearer Display",
        version: "1",
        description: "Authorization Bearer abcdefghijklmnop",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "private-key-display",
        name: "Private Key Display",
        version: "1",
        description: "-----BEGIN PRIVATE KEY-----",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "root-path-display",
        name: "Root Path Display",
        version: "1",
        description: "Reads /private",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "assigned-path-display",
        name: "Assigned Path Display",
        version: "1",
        description: "path=/secret",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "labelled-path-display",
        name: "Labelled Path Display",
        version: "1",
        description: "path:/secret",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "url-adjacent-path-display",
        name: "URL Adjacent Path Display",
        version: "1",
        description: "See https://example.com),path=/secret",
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "current-drive-display",
        name: "Current Drive Display",
        version: "1",
        description: String.raw`Reads \private`,
        capabilities: ["read_current_source"],
        body: "## Procedure\n\nRead."
      }),
      manifest({
        id: "author-display",
        name: "Author Display",
        version: "1",
        description: "A local workflow.",
        capabilities: ["read_current_source"],
        extra: [String.raw`author: C:\Users\example\private`],
        body: "## Procedure\n\nRead."
      })
    ];
    for (const source of unsafeSources) seedInstalledSkill(root, source, true);
    seedInstalledSkill(root, manifest({
      id: "public-docs",
      name: "Public Docs",
      version: "1",
      description: "See https://example.com/docs for public guidance.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nRead."
    }), true);

    expect(readySummary(new SkillRegistryService(root))).toMatchObject({
      skills: [{ id: "public-docs" }],
      invalidManifestCount: unsafeSources.length
    });
  });

  it("fails malformed, changed, mismatched, and unconfirmed manifests closed", () => {
    const root = createRoot();
    const valid = manifest({
      id: "valid-skill",
      name: "Valid Skill",
      version: "1",
      description: "A valid local workflow.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nRead only the current source."
    });
    seedInstalledSkill(root, valid, true, { trust: "user_confirmed" });
    const changed = manifest({
      id: "changed-skill",
      name: "Changed Skill",
      version: "1",
      description: "Changed after registration.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nChanged."
    });
    seedInstalledSkill(root, changed, true, { manifestSha256: `sha256:${"a".repeat(64)}` });
    const unconfirmed = manifest({
      id: "unconfirmed-skill",
      name: "Unconfirmed Skill",
      version: "1",
      description: "Not installed through a confirmed flow.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nDo nothing."
    });
    seedInstalledSkill(root, unconfirmed, true, { trust: "built_in" });
    const malformed = manifest({
      id: "malformed-skill",
      name: "Malformed Skill",
      version: "1",
      description: "Contains an undeclared executable field.",
      capabilities: ["read_current_source"],
      extra: ["command: rm -rf /"],
      body: "## Procedure\n\nNever run."
    });
    seedRawInstalledSkill(root, "malformed-skill", "1", malformed, true);

    const summary = readySummary(new SkillRegistryService(root));
    expect(summary.skills.map((skill) => skill.id)).toEqual(["valid-skill"]);
    expect(summary.invalidManifestCount).toBe(3);
  });

  it("rejects symlinked manifests without exposing their target", () => {
    if (process.platform === "win32") return;
    const root = createRoot();
    const source = manifest({
      id: "linked-skill",
      name: "Linked Skill",
      version: "1",
      description: "Must not follow a link.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nDo nothing."
    });
    const installed = path.join(root, "skills", "installed", "linked-skill");
    fs.mkdirSync(installed, { recursive: true });
    const outside = path.join(root, "outside.md");
    fs.writeFileSync(outside, source);
    fs.symlinkSync(outside, path.join(installed, "SKILL.md"));
    writeRegistry(root, [{
      id: "linked-skill",
      version: "1",
      manifestSha256: digest(source),
      enabled: true,
      trust: "user_confirmed",
      installedAt: timestamp,
      updatedAt: timestamp
    }]);

    expect(readySummary(new SkillRegistryService(root))).toMatchObject({ skills: [], invalidManifestCount: 1 });
  });

  it("disables by revision with atomic persistence while stale and missing requests change nothing", () => {
    const root = createRoot();
    const source = manifest({
      id: "disable-me",
      name: "Disable Me",
      version: "1",
      description: "A reversible local workflow.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nRead only."
    });
    seedInstalledSkill(root, source, true);
    const service = new SkillRegistryService(root);

    expect(service.disable({ apiVersion: 1, skillId: "disable-me", expectedRevision: 2 }).status).toBe("stale");
    expect(service.disable({ apiVersion: 1, skillId: "missing-skill", expectedRevision: 3 }).status).toBe("not_found");
    const committed = service.disable({ apiVersion: 1, skillId: "disable-me", expectedRevision: 3 });
    expect(committed).toMatchObject({
      status: "committed",
      registry: { revision: 4, skills: [{ id: "disable-me", enabled: false }] }
    });
    expect(readySummary(new SkillRegistryService(root))).toMatchObject({
      revision: 4,
      skills: [{ id: "disable-me", enabled: false }]
    });
    expect(fs.readdirSync(path.join(root, "skills")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("fails body-free while another process owns the registry mutation lock, then rechecks and commits", async () => {
    const root = createRoot();
    const source = manifest({
      id: "cross-process-disable",
      name: "Cross Process Disable",
      version: "1",
      description: "A lock-fenced local workflow.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nRead only."
    });
    seedInstalledSkill(root, source, true);
    const service = new SkillRegistryService(root);
    const lockPath = path.join(root, "skills", ".registry.lock");
    const child = spawn(process.execPath, [
      "-e",
      `const fs=require("node:fs");const crypto=require("node:crypto");const lockPath=process.argv[1];const fd=fs.openSync(lockPath,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,ownerId:crypto.randomUUID(),pid:process.pid})+"\\n");fs.fsyncSync(fd);process.send("locked");process.on("message",()=>{fs.unlinkSync(lockPath);fs.closeSync(fd);process.exit(0);});`,
      lockPath
    ], { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit", "ipc"] });
    try {
      await once(child, "message");
      const failed = service.disable({
        apiVersion: 1,
        skillId: "cross-process-disable",
        expectedRevision: 3
      });
      expect(failed).toEqual({
        status: "failed",
        error: {
          code: "skill.registry_busy",
          domain: "skill",
          messageKey: "error.generic",
          retryable: true,
          severity: "error",
          userAction: "retry"
        }
      });
      expect(JSON.stringify(failed)).not.toContain(root);
    } finally {
      child.send("release");
      await once(child, "exit");
    }

    expect(service.disable({
      apiVersion: 1,
      skillId: "cross-process-disable",
      expectedRevision: 3
    })).toMatchObject({ status: "committed", registry: { revision: 4 } });
  });

  it("never removes a successor mutation lock when an old owner releases", async () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    const lockPath = path.join(root, "skills", ".registry.lock");
    const oldOwner = acquireSkillRegistryMutationLock(lockPath);
    fs.unlinkSync(lockPath);
    const child = spawn(process.execPath, [
      "-e",
      `const fs=require("node:fs");const crypto=require("node:crypto");const lockPath=process.argv[1];const fd=fs.openSync(lockPath,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,ownerId:crypto.randomUUID(),pid:process.pid})+"\\n");fs.fsyncSync(fd);process.send("locked");process.on("message",()=>{fs.unlinkSync(lockPath);fs.closeSync(fd);process.exit(0);});`,
      lockPath
    ], { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit", "ipc"] });
    try {
      await once(child, "message");
      oldOwner.release();
      expect(() => acquireSkillRegistryMutationLock(lockPath)).toThrow(/EEXIST/u);
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      child.send("release");
      await once(child, "exit");
    }
  });

  it("recovers a valid orphan only for the single-instance startup owner", () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, "skills"), { recursive: true });
    const lockPath = path.join(root, "skills", ".registry.lock");
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      ownerId: "00000000-0000-4000-8000-000000000000",
      pid: 999_999
    })}\n`, { mode: 0o600 });

    const service = new SkillRegistryService(root, { recoverOrphanedMutationLock: true });
    expect(service.summary()).toMatchObject({ status: "ready", registry: { revision: 0 } });
    const successor = acquireSkillRegistryMutationLock(lockPath);
    successor.assertOwned();
    successor.release();
  });

  it("recovers an empty crash-torn lock for the single-instance startup owner", () => {
    const root = createRoot();
    const skillRoot = path.join(root, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, ".registry.lock"), "", { mode: 0o600 });

    expect(new SkillRegistryService(root, { recoverOrphanedMutationLock: true }).summary())
      .toMatchObject({ status: "ready", registry: { revision: 0 } });
    expect(fs.existsSync(path.join(skillRoot, ".registry.lock"))).toBe(false);
  });

  it("keeps desktop startup available while an unsafe lock blocks mutation", () => {
    const root = createRoot();
    const skillRoot = path.join(root, "skills");
    fs.mkdirSync(path.join(skillRoot, ".registry.lock"), { recursive: true });

    const service = new SkillRegistryService(root, { recoverOrphanedMutationLock: true });
    expect(service.summary()).toMatchObject({ status: "ready", registry: { revision: 0 } });
    expect(service.disable({ apiVersion: 1, skillId: "missing", expectedRevision: 0 }))
      .toMatchObject({ status: "failed", error: { code: "skill.registry_busy" } });
  });

  it("recovers a same-process lock after transient release rename failure", () => {
    const root = createRoot();
    const skillRoot = path.join(root, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });
    const lockPath = path.join(skillRoot, ".registry.lock");
    const owner = acquireSkillRegistryMutationLock(lockPath);
    const rename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (source === lockPath && String(destination).includes(".released.")) {
        const failure = new Error("transient rename failure") as NodeJS.ErrnoException;
        failure.code = "EACCES";
        throw failure;
      }
      return rename(source, destination);
    });
    owner.release();
    renameSpy.mockRestore();
    expect(fs.existsSync(lockPath)).toBe(true);

    const successor = acquireSkillRegistryMutationLock(lockPath);
    successor.assertOwned();
    successor.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("returns a strict body-free failure for malformed durable registry state", () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, "skills", "installed"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "registry.json"), JSON.stringify({
      schemaVersion: 1,
      revision: 2,
      skills: [{ id: "duplicate", version: "1" }, { id: "duplicate", version: "1" }]
    }));
    const result = new SkillRegistryService(root).summary();
    expect(result).toEqual({
      status: "failed",
      error: {
        code: "skill.registry_unavailable",
        domain: "skill",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      }
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe("parseSkillManifest", () => {
  it("accepts the documented block-list metadata and normalizes numeric versions", () => {
    expect(parseSkillManifest(manifest({
      id: "paper-reading",
      name: "Paper Reading",
      version: "1",
      description: "Extract source-backed notes.",
      capabilities: ["read_current_source", "suggest_note"],
      body: "## Procedure\n\nRead the paper."
    }))).toMatchObject({ version: "1", kind: "pure", scope: "machine_local" });
  });

  it("rejects hidden capabilities, duplicate fields, executable metadata, and capability-kind drift", () => {
    const base = manifest({
      id: "strict-skill",
      name: "Strict Skill",
      version: "1",
      description: "Strictly parsed.",
      capabilities: ["read_current_source"],
      body: "## Procedure\n\nRead."
    });
    expect(() => parseSkillManifest(base.replace("capabilities:\n", "capabilities:\ncapabilities:\n"))).toThrow();
    expect(() => parseSkillManifest(base.replace("description:", "command: node evil.js\ndescription:"))).toThrow();
    expect(() => parseSkillManifest(base.replace("read_current_source", "raw_secret_access"))).toThrow();
    expect(() => parseSkillManifest(base.replace("read_current_source", "external_network"))).toThrow(
      "Skill metadata failed strict validation"
    );
    expect(() => parseSkillManifest(base.replace(
      "name: Strict Skill",
      String.raw`name: "Strict\u0000Skill"`
    ))).toThrow("Skill metadata quoted scalar is invalid");
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-skill-registry-"));
  temporaryRoots.push(root);
  return root;
}

function readySummary(service: SkillRegistryService): SkillRegistrySummary {
  const result = service.summary();
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected a ready Skill Registry summary.");
  return result.registry;
}

function manifest(input: {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly kind?: "pure" | "external_web";
  readonly capabilities: readonly string[];
  readonly extra?: readonly string[];
  readonly body: string;
}): string {
  return [
    "---",
    `id: ${input.id}`,
    `name: ${input.name}`,
    `version: ${input.version}`,
    `description: ${input.description}`,
    "scope: machine_local",
    `kind: ${input.kind ?? "pure"}`,
    "capabilities:",
    ...input.capabilities.map((capability) => `  - ${capability}`),
    ...(input.extra ?? []),
    "---",
    "",
    input.body,
    ""
  ].join("\n");
}

function seedInstalledSkill(
  root: string,
  source: string,
  enabled: boolean,
  overrides: Partial<{ readonly manifestSha256: string; readonly trust: "built_in" | "user_confirmed" }> = {}
): void {
  const parsed = parseSkillManifest(source);
  const directory = path.join(root, "skills", "installed", parsed.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), source);
  const registryPath = path.join(root, "skills", "registry.json");
  const existing = fs.existsSync(registryPath)
    ? SkillRegistryFileSchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8")))
    : { schemaVersion: 1 as const, revision: 3, skills: [] };
  writeRegistry(root, [...existing.skills, {
    id: parsed.id,
    version: parsed.version,
    manifestSha256: overrides.manifestSha256 ?? digest(source),
    enabled,
    trust: overrides.trust ?? "user_confirmed",
    installedAt: timestamp,
    updatedAt: timestamp
  }], existing.revision);
}

function seedRawInstalledSkill(
  root: string,
  id: string,
  version: string,
  source: string,
  enabled: boolean
): void {
  const directory = path.join(root, "skills", "installed", id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), source);
  const registryPath = path.join(root, "skills", "registry.json");
  const existing = fs.existsSync(registryPath)
    ? SkillRegistryFileSchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8")))
    : { schemaVersion: 1 as const, revision: 3, skills: [] };
  writeRegistry(root, [...existing.skills, {
    id,
    version,
    manifestSha256: digest(source),
    enabled,
    trust: "user_confirmed",
    installedAt: timestamp,
    updatedAt: timestamp
  }], existing.revision);
}

function writeRegistry(root: string, skills: readonly unknown[], revision = 3): void {
  const registry = SkillRegistryFileSchema.parse({ schemaVersion: 1, revision, skills });
  const directory = path.join(root, "skills");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
}

function digest(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}
