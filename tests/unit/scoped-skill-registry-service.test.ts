import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedSkillRegistryService, type ActiveSkillVault } from "../../apps/desktop/src/main/services/scoped-skill-registry-service";
import { SkillRegistryService } from "../../apps/desktop/src/main/services/skill-registry-service";
import { SkillUrlInstallService } from "../../apps/desktop/src/main/services/skill-url-install-service";

describe("ScopedSkillRegistryService", () => {
  it("keeps a pure Vault Skill portable, isolated, reversible, updateable, and disabled by default", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-skill-")));
    const appData = path.join(root, "app-data");
    const vaultA = createVault(root, "vault-a", "vault_20260801_aaaaaa");
    const vaultB = createVault(root, "vault-b", "vault_20260801_bbbbbb");
    let active: ActiveSkillVault | undefined = vaultA;
    let version = 1;
    const sourceUrl = "https://skills.example/vault-notes/SKILL.md";
    const machine = new SkillRegistryService(appData);
    const scoped = new ScopedSkillRegistryService(machine, () => active);
    const staging = new SkillUrlInstallService({
      appDataRoot: appData,
      registry: scoped,
      fetcher: { fetchSnapshot: async () => ({ finalUrl: sourceUrl, contentType: "text/markdown",
        rawContent: manifest(version) }) }
    });

    const staged = await staging.stageFromUrl({ apiVersion: 1, requestId: "skillreq_vaultinstall0001",
      activeVaultId: vaultA.vaultId, sourceUrl });
    expect(staged).toMatchObject({ status: "ready", activeVaultId: vaultA.vaultId,
      staged: { id: "vault-notes", scope: "vault", registryRevision: 0 } });
    if (staged.status !== "ready") throw new Error("stage failed");
    const installed = scoped.installStaged({ apiVersion: 1, requestId: "skillreq_vaultinstall0002",
      activeVaultId: vaultA.vaultId, scope: "vault", stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256, bundleSha256: staged.staged.bundleSha256,
      expectedRegistryRevision: 0, enabled: false }, staging);
    expect(installed).toMatchObject({ status: "committed", registry: { revision: 1,
      skills: [{ id: "vault-notes", scope: "vault", enabled: false, canEnable: true }] } });
    expect(fs.existsSync(path.join(vaultA.vaultPath, ".pige", "skills", "installed", "vault-notes", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "skills", "installed", "vault-notes"))).toBe(false);

    active = vaultB;
    expect(scoped.summary(query(vaultB.vaultId, "0001"))).toMatchObject({ status: "ready", registry: { skills: [] } });
    expect(scoped.enable(lifecycle(vaultA.vaultId, "vault", 1, "0001"))).toMatchObject({ status: "failed" });
    active = vaultA;
    expect(scoped.enable(lifecycle(vaultA.vaultId, "vault", 1, "0002"))).toMatchObject({ status: "committed",
      registry: { revision: 2, skills: [{ enabled: true }] } });
    expect(scoped.disable({ apiVersion: 1, activeVaultId: vaultA.vaultId, scope: "vault",
      skillId: "vault-notes", expectedRevision: 2 })).toMatchObject({ status: "committed",
      registry: { revision: 3, skills: [{ enabled: false }] } });

    version = 2;
    const update = await scoped.stageUpdate({ ...lifecycle(vaultA.vaultId, "vault", 3, "0003"), apiVersion: 1 }, staging);
    expect(update).toMatchObject({ status: "ready", staged: { scope: "vault", registryRevision: 3,
      pureUpdateReview: { previousVersion: "1", finalEnabled: false } } });
    if (update.status !== "ready") throw new Error("update stage failed");
    expect(scoped.installStaged({ apiVersion: 1, requestId: "skillreq_vaultinstall0003",
      activeVaultId: vaultA.vaultId, scope: "vault", stagingId: update.staged.stagingId,
      manifestSha256: update.staged.manifestSha256, bundleSha256: update.staged.bundleSha256,
      expectedRegistryRevision: update.staged.registryRevision, enabled: false }, staging)).toMatchObject({
        status: "committed", registry: { revision: 4, skills: [{ version: "2", enabled: false }] }
      });

    const removed = scoped.uninstall(lifecycle(vaultA.vaultId, "vault", 4, "0004"));
    expect(removed).toMatchObject({ status: "committed", registry: { revision: 5, skills: [],
      restorableSkills: [{ skillId: "vault-notes", scope: "vault" }] } });
    if (removed.status !== "committed") throw new Error("uninstall failed");
    const trash = removed.registry.restorableSkills[0]!;
    expect(scoped.restore({ apiVersion: 1, requestId: requestId("0005"), activeVaultId: vaultA.vaultId,
      scope: "vault", restoreContextId: trash.restoreContextId, skillId: trash.skillId,
      expectedRegistryRevision: 5 })).toMatchObject({ status: "committed", registry: { revision: 6,
        skills: [{ id: "vault-notes", enabled: false }], restorableSkills: [] } });
    const destination = path.join(root, "vault-notes.md");
    expect(scoped.export(lifecycle(vaultA.vaultId, "vault", 6, "0006"), destination)).toMatchObject({
      status: "exported", registryRevision: 6, scope: "vault"
    });
    expect(fs.readFileSync(destination, "utf8")).toContain("version: 2");
  });
});

function createVault(root: string, name: string, vaultId: string): ActiveSkillVault {
  const vaultPath = path.join(root, name);
  fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
  return { vaultId, vaultPath };
}
function query(activeVaultId: string, suffix: string) {
  return { apiVersion: 1 as const, requestId: requestId(suffix), activeVaultId };
}
function lifecycle(activeVaultId: string, scope: "machine_local" | "vault", revision: number, suffix: string) {
  return { apiVersion: 1 as const, requestId: requestId(suffix), activeVaultId, scope,
    skillId: "vault-notes", expectedRegistryRevision: revision };
}
function requestId(suffix: string): `skill_lifecycle_request_${string}` {
  return `skill_lifecycle_request_20260801${suffix.padStart(8, "0")}`;
}
function manifest(version: number): string {
  return `---\nid: vault-notes\nname: Vault Notes\nversion: ${version}\ndescription: Portable Vault note workflow\nscope: vault\nkind: pure\ncapabilities:\n  - read_current_source\ntriggers:\n  - vault notes\nsourceUrl: https://skills.example/vault-notes/SKILL.md\nupdatedAt: 2026-08-0${version}T00:00:00.000Z\n---\n# Vault Notes v${version}\n`;
}
