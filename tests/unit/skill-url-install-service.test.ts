import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRegistryService } from "../../apps/desktop/src/main/services/skill-registry-service";
import {
  SkillUrlInstallService
} from "../../apps/desktop/src/main/services/skill-url-install-service";

const roots: string[] = [];
const requestId = "skillreq_0123456789abcdef";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SkillUrlInstallService", () => {
  it("stages a bounded pure Markdown Skill without execution and installs it once through registry CAS", async () => {
    const root = createRoot();
    const sentinel = path.join(root, "sibling-sentinel.txt");
    fs.writeFileSync(sentinel, "untouched", "utf8");
    const fetchSnapshot = vi.fn(async () => snapshot(skillMarkdown()));
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });

    const staged = await service.stageFromUrl({
      apiVersion: 1,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    });
    expect(staged).toMatchObject({
      status: "ready",
      requestId,
      staged: {
        id: "paper-reading",
        scope: "machine_local",
        kind: "pure",
        dataBoundaries: ["local"],
        warnings: ["untrusted_remote_source"]
      }
    });
    if (staged.status !== "ready") throw new Error("Expected a staged Skill.");
    expect(JSON.stringify(staged)).not.toContain("## Procedure");
    expect(JSON.stringify(staged)).not.toContain(root);

    const request = {
      apiVersion: 1 as const,
      requestId,
      stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256,
      expectedRegistryRevision: staged.staged.registryRevision,
      enabled: true
    };
    const installed = service.installStaged(request);
    expect(installed).toMatchObject({
      status: "committed",
      requestId,
      registry: { revision: 1, skills: [{ id: "paper-reading", enabled: true }] }
    });
    expect(service.installStaged(request)).toMatchObject({ status: "committed", requestId });
    expect(registry.summary()).toMatchObject({
      status: "ready",
      registry: { revision: 1, skills: [{ id: "paper-reading" }] }
    });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("untouched");
  });

  it("stages and atomically commits one exact source-aware update while preserving enablement", async () => {
    const root = createRoot();
    const initial = skillMarkdown({ version: "1", updatedAt: "2026-07-27T10:00:00.000Z", sourceUrl: "https://example.com/SKILL.md" });
    const updated = skillMarkdown({ version: "2", updatedAt: "2026-07-28T10:00:00.000Z", sourceUrl: "https://example.com/SKILL.md" });
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot(initial))
      .mockResolvedValueOnce(snapshot(updated));
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    const initialStage = await service.stageFromUrl({
      apiVersion: 1,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    });
    if (initialStage.status !== "ready") throw new Error("Expected initial stage.");
    expect(service.installStaged({
      apiVersion: 1,
      requestId,
      stagingId: initialStage.staged.stagingId,
      manifestSha256: initialStage.staged.manifestSha256,
      expectedRegistryRevision: initialStage.staged.registryRevision,
      enabled: true
    })).toMatchObject({ status: "committed" });

    const updateRequest = {
      apiVersion: 1 as const,
      requestId: "skill_lifecycle_request_update0123456789",
      activeVaultId: "vault_20260728_skillupdate",
      skillId: "paper-reading",
      expectedRegistryRevision: 1
    };
    const staged = await service.stageUpdate(updateRequest);
    expect(staged).toMatchObject({ status: "ready", staged: { id: "paper-reading", version: "2", registryRevision: 1 } });
    if (staged.status !== "ready") throw new Error("Expected update stage.");
    const committed = service.installStaged({
      apiVersion: 1,
      requestId: "skillreq_update0123456789",
      stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256,
      expectedRegistryRevision: staged.staged.registryRevision,
      enabled: true
    });
    expect(committed).toMatchObject({
      status: "committed",
      registry: { revision: 2, skills: [{ id: "paper-reading", version: "2", enabled: true, canUpdate: true }] }
    });
    expect(fs.readFileSync(path.join(root, "skills", "installed", "paper-reading", "SKILL.md"), "utf8")).toBe(updated);
    const retained = fs.readFileSync(path.join(
      root, "skills", "trash", "updates", "skillreq_update0123456789", "skill", "SKILL.md"
    ), "utf8");
    expect(retained).toBe(initial);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("fails a staged update closed after registry drift without replacing installed bytes", async () => {
    const root = createRoot();
    const initial = skillMarkdown({ version: "1", updatedAt: "2026-07-27T10:00:00.000Z", sourceUrl: "https://example.com/SKILL.md" });
    const updated = skillMarkdown({ version: "2", updatedAt: "2026-07-28T10:00:00.000Z", sourceUrl: "https://example.com/SKILL.md" });
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snapshot(initial)).mockResolvedValueOnce(snapshot(updated));
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    const first = await service.stageFromUrl({ apiVersion: 1, requestId, sourceUrl: "https://example.com/SKILL.md" });
    if (first.status !== "ready") throw new Error("Expected initial stage.");
    service.installStaged({
      apiVersion: 1, requestId, stagingId: first.staged.stagingId,
      manifestSha256: first.staged.manifestSha256, expectedRegistryRevision: 0, enabled: true
    });
    const update = await service.stageUpdate({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_updatedrift012345",
      activeVaultId: "vault_20260728_skillupdate",
      skillId: "paper-reading",
      expectedRegistryRevision: 1
    });
    if (update.status !== "ready") throw new Error("Expected update stage.");
    expect(registry.disable({ apiVersion: 1, skillId: "paper-reading", expectedRevision: 1 })).toMatchObject({ status: "committed" });
    expect(service.installStaged({
      apiVersion: 1,
      requestId: "skillreq_updatedrift012345",
      stagingId: update.staged.stagingId,
      manifestSha256: update.staged.manifestSha256,
      expectedRegistryRevision: update.staged.registryRevision,
      enabled: true
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(path.join(root, "skills", "installed", "paper-reading", "SKILL.md"), "utf8")).toBe(initial);
  });

  it("adopts an exact durable stage across restart and fails changed or unsafe input closed", async () => {
    const root = createRoot();
    const firstFetch = vi.fn(async () => snapshot(skillMarkdown()));
    const registry = new SkillRegistryService(root);
    const first = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot: firstFetch } });
    const request = {
      apiVersion: 1 as const,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    };
    const staged = await first.stageFromUrl(request);
    expect(staged.status).toBe("ready");

    const restartFetch = vi.fn(async () => snapshot(skillMarkdown({ id: "wrong" })));
    const restarted = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot: restartFetch } });
    expect(await restarted.stageFromUrl(request)).toEqual(staged);
    expect(restartFetch).not.toHaveBeenCalled();
    expect(await restarted.stageFromUrl({ ...request, sourceUrl: "https://other.example/SKILL.md" }))
      .toMatchObject({ status: "failed", requestId });

    const unsafe = new SkillUrlInstallService({
      appDataRoot: createRoot(),
      registry: new SkillRegistryService(createRoot()),
      fetcher: { fetchSnapshot: async () => snapshot("<html>not markdown</html>", "text/html") }
    });
    expect(await unsafe.stageFromUrl({ ...request, requestId: "skillreq_ffffffffffffffff" }))
      .toMatchObject({ status: "invalid", reason: "unsafe_content" });
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-skill-url-install-"));
  roots.push(root);
  return root;
}

function skillMarkdown(overrides: {
  readonly id?: string;
  readonly version?: string;
  readonly updatedAt?: string;
  readonly sourceUrl?: string;
} = {}): string {
  return [
    "---",
    `id: ${overrides.id ?? "paper-reading"}`,
    "name: Paper Reading",
    `version: ${overrides.version ?? "1"}`,
    "description: Create source-backed research notes.",
    "scope: machine_local",
    "kind: pure",
    ...(overrides.sourceUrl ? [`sourceUrl: ${overrides.sourceUrl}`] : []),
    ...(overrides.updatedAt ? [`updatedAt: ${overrides.updatedAt}`] : []),
    "capabilities:",
    "  - read_current_source",
    "---",
    "",
    "## Procedure",
    "",
    "Read the exact preserved source and create cited notes."
  ].join("\n");
}

function snapshot(rawContent: string, contentType = "text/markdown") {
  return {
    originalUrl: "https://example.com/SKILL.md",
    finalUrl: "https://example.com/SKILL.md",
    contentType,
    rawContent,
    extractedText: rawContent,
    warnings: []
  };
}
