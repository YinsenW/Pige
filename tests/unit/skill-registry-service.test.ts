import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SkillRegistryFileSchema,
  SkillRegistrySummarySchema
} from "@pige/schemas";
import {
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

    const summary = new SkillRegistryService(root).summary();

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

    expect(new SkillRegistryService(root).summary().skills[0]).toMatchObject({
      id: "web-research",
      enabled: false,
      capabilities: ["external_network", "external_filesystem", "use_brokered_credential"],
      dataBoundaries: ["filesystem", "network", "brokered_credential"]
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

    const summary = new SkillRegistryService(root).summary();
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

    expect(new SkillRegistryService(root).summary()).toMatchObject({ skills: [], invalidManifestCount: 1 });
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
    expect(new SkillRegistryService(root).summary()).toMatchObject({
      revision: 4,
      skills: [{ id: "disable-me", enabled: false }]
    });
    expect(fs.readdirSync(path.join(root, "skills")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects a malformed durable registry instead of inventing empty inventory", () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, "skills", "installed"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "registry.json"), JSON.stringify({
      schemaVersion: 1,
      revision: 2,
      skills: [{ id: "duplicate", version: "1" }, { id: "duplicate", version: "1" }]
    }));
    expect(() => new SkillRegistryService(root).summary()).toThrow("Skill Registry state is unavailable or invalid");
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
