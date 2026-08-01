import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRegistryFileSchema } from "@pige/schemas";
import { PureSkillRuntimeService } from "../../apps/desktop/src/main/services/pure-skill-runtime-service";
import { assertPigeAgentToolDescriptors } from "../../apps/desktop/src/main/services/pi-agent-tool-boundary";
import { ScopedSkillRegistryService, type ActiveSkillVault } from "../../apps/desktop/src/main/services/scoped-skill-registry-service";
import { SkillRegistryService, parseSkillManifest } from "../../apps/desktop/src/main/services/skill-registry-service";
import { skillBundleSha256, type SkillBundleFile } from "../../apps/desktop/src/main/services/skill-zip-stage-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PureSkillRuntimeService", () => {
  it("selects only relevant enabled pure Skills and reads reviewed files without path authority", async () => {
    const fixture = createFixture();
    seedPureSkill(fixture.machineRoot, "paper-reading", "machine_local", "Paper Reading", "read papers");
    seedPureSkill(path.join(fixture.vault.vaultPath, ".pige"), "vault-notes", "vault", "Vault Notes", "vault notes");
    const runtime = new PureSkillRuntimeService(fixture.scoped);

    expect(runtime.toolsForTurn(turn(fixture.vault.vaultId, "neutral_attachment", "Use Paper Reading"))).toEqual([]);
    expect(runtime.toolsForTurn(turn(fixture.vault.vaultId, "explicit_user_task", "Summarize this"))).toEqual([]);
    const tools = runtime.toolsForTurn(turn(
      fixture.vault.vaultId,
      "explicit_user_task",
      "Use Paper Reading and the vault notes workflow."
    ));
    expect(tools).toHaveLength(2);
    assertPigeAgentToolDescriptors(tools);
    expect(tools.map((tool) => tool.label)).toEqual(["Use paper-reading", "Use vault-notes"]);
    expect(JSON.stringify(tools.map(({ name, label, description, parameters }) =>
      ({ name, label, description, parameters })))).not.toContain(fixture.root);

    const machineTool = tools.find((tool) => tool.label === "Use paper-reading")!;
    await expect(machineTool.execute(
      { relativePath: "references/style.md" },
      new AbortController().signal,
      { toolCallId: "tool_call_pure_skill_reference", signal: new AbortController().signal }
    )).resolves.toMatchObject({
      content: [{ type: "text", text: "Use concise cited paragraphs.\n" }],
      details: {
        skillId: "paper-reading",
        skillName: "Paper Reading",
        skillVersion: "1.0.0",
        relativePath: "references/style.md"
      }
    });
    await expect(machineTool.execute(
      { relativePath: "../secret" },
      new AbortController().signal,
      { toolCallId: "tool_call_pure_skill_escape", signal: new AbortController().signal }
    )).rejects.toMatchObject({ code: "agent_runtime.tool_input_invalid" });
  });

  it("revalidates exact registry, bundle, and active Vault identity before model exposure", async () => {
    const fixture = createFixture();
    seedPureSkill(path.join(fixture.vault.vaultPath, ".pige"), "vault-notes", "vault", "Vault Notes", "vault notes");
    const runtime = new PureSkillRuntimeService(fixture.scoped);
    const tool = runtime.toolsForTurn(turn(
      fixture.vault.vaultId,
      "explicit_user_task",
      "Please use vault notes."
    ))[0]!;
    fs.appendFileSync(path.join(
      fixture.vault.vaultPath,
      ".pige",
      "skills",
      "installed",
      "vault-notes",
      "references",
      "style.md"
    ), "tampered");
    await expect(tool.execute(
      { relativePath: "SKILL.md" },
      new AbortController().signal,
      { toolCallId: "tool_call_pure_skill_drift", signal: new AbortController().signal }
    )).rejects.toMatchObject({ code: "skill.runtime_binding_changed" });

    fixture.active = {
      vaultId: "vault_20260801_other",
      vaultPath: path.join(fixture.root, "other-vault")
    };
    fs.mkdirSync(path.join(fixture.active.vaultPath, ".pige"), { recursive: true });
    expect(() => tool.authorize?.(
      { relativePath: "SKILL.md" },
      { toolCallId: "tool_call_pure_skill_vault", signal: new AbortController().signal }
    )).toThrow("skill.vault_stale");
  });

  it("fails closed when machine and Vault registries expose the same enabled identity", () => {
    const fixture = createFixture();
    seedPureSkill(fixture.machineRoot, "shared-skill", "machine_local", "Shared Skill", "shared");
    seedPureSkill(path.join(fixture.vault.vaultPath, ".pige"), "shared-skill", "vault", "Shared Skill", "shared");
    expect(() => fixture.scoped.enabledPureSkillRuntimes(fixture.vault.vaultId))
      .toThrow("skill.runtime_identity_ambiguous");
  });
});

function createFixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-pure-skill-runtime-")));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  fs.mkdirSync(machineRoot);
  const vault: ActiveSkillVault = {
    vaultId: "vault_20260801_pureskill",
    vaultPath: path.join(root, "vault")
  };
  fs.mkdirSync(path.join(vault.vaultPath, ".pige"), { recursive: true });
  const state: { active: ActiveSkillVault } = { active: vault };
  const scoped = new ScopedSkillRegistryService(new SkillRegistryService(machineRoot), () => state.active);
  return {
    root,
    machineRoot,
    vault,
    scoped,
    get active() { return state.active; },
    set active(value: ActiveSkillVault) { state.active = value; }
  };
}

function turn(
  activeVaultId: string,
  authoredTaskIntent: "explicit_user_task" | "neutral_attachment",
  authoredText: string
) {
  return { activeVaultId, authoredTaskIntent, authoredText, assertCurrent: vi.fn() };
}

function seedPureSkill(
  root: string,
  id: string,
  scope: "machine_local" | "vault",
  name: string,
  trigger: string
): void {
  const source = [
    "---",
    `id: ${id}`,
    `name: ${name}`,
    "version: 1.0.0",
    `description: Apply the ${name} workflow.`,
    `scope: ${scope}`,
    "kind: pure",
    "capabilities:",
    "  - read_current_source",
    "triggers:",
    `  - ${trigger}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Follow references/style.md when producing the answer.",
    ""
  ].join("\n");
  parseSkillManifest(source);
  const files: readonly SkillBundleFile[] = [
    bundleFile("SKILL.md", source),
    bundleFile("references/style.md", "Use concise cited paragraphs.\n")
  ];
  const bundleSha256 = skillBundleSha256(files);
  const installed = path.join(root, "skills", "installed", id);
  fs.mkdirSync(path.join(installed, "references"), { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(installed, ...file.relativePath.split("/")), file.bytes);
  fs.writeFileSync(path.join(installed, ".pige-install.json"), `${JSON.stringify({
    schemaVersion: 1,
    requestId: `skillreq_${id.replace(/[^a-z0-9]/gu, "")}0123456789abcdef`,
    stagingId: `skillstage_${"a".repeat(32)}`,
    manifestSha256: files[0]!.sha256,
    bundleSha256,
    enabled: false,
    source: "local_zip",
    warnings: []
  })}\n`);
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "registry.json"), `${JSON.stringify(SkillRegistryFileSchema.parse({
    schemaVersion: 1,
    revision: 3,
    skills: [{
      id,
      version: "1.0.0",
      manifestSha256: files[0]!.sha256,
      enabled: true,
      trust: "user_confirmed",
      installedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    }]
  }))}\n`);
}

function bundleFile(relativePath: string, source: string): SkillBundleFile {
  const bytes = Buffer.from(source, "utf8");
  return { relativePath, bytes, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}
