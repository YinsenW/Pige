import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
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
  it("retains exact chat-origin reviews across restart and filters them by active vault", async () => {
    const root = createRoot();
    const fetchSnapshot = vi.fn(async () => snapshot(externalSkillMarkdown({ sourceUrl: "https://example.com/SKILL.md" })));
    const registry = new SkillRegistryService(root);
    const binding = {
      activeVaultId: "vault_20260729_chatskill",
      jobId: "job_20260729_chatskill01",
      clientTurnId: "turn_20260729_chatskillturn01",
      conversationEventId: "evt_20260729_chatskill01",
      candidateIndex: 1
    } as const;
    const request = {
      apiVersion: 1 as const,
      requestId: "skillreq_chat0123456789abcd",
      sourceUrl: "https://example.com/SKILL.md"
    };
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    const staged = await service.stageFromChatUrl(request, binding, new AbortController().signal, () => undefined);
    expect(staged).toMatchObject({ status: "ready", staged: {
      id: "web-research", kind: "external_web", source: "https", sourceUrl: request.sourceUrl
    } });
    expect(await service.stageFromChatUrl(request, binding, new AbortController().signal, () => undefined))
      .toMatchObject({ status: "ready", staged: { stagingId: staged.status === "ready" ? staged.staged.stagingId : "" } });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    const restarted = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    expect(restarted.pendingStagedReviews({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_pending0123456789",
      activeVaultId: binding.activeVaultId
    })).toMatchObject({ status: "ready", staged: [{ id: "web-research", sourceUrl: request.sourceUrl }] });
    expect(restarted.pendingStagedReviews({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_other01234567890",
      activeVaultId: "vault_20260729_otherchat"
    })).toMatchObject({ status: "ready", staged: [] });
    expect(await restarted.stageFromChatUrl(request, { ...binding, jobId: "job_20260729_changedjob" },
      new AbortController().signal, () => undefined)).toMatchObject({ status: "failed" });
  });

  it("fails chat staging before publication when the exact turn binding drifts after fetch", async () => {
    const root = createRoot();
    const fetchSnapshot = vi.fn(async () => snapshot(skillMarkdown()));
    const service = new SkillUrlInstallService({
      appDataRoot: root,
      registry: new SkillRegistryService(root),
      fetcher: { fetchSnapshot }
    });
    let checks = 0;
    const result = await service.stageFromChatUrl({
      apiVersion: 1,
      requestId: "skillreq_drift0123456789abc",
      sourceUrl: "https://example.com/SKILL.md"
    }, {
      activeVaultId: "vault_20260729_chatdrift",
      jobId: "job_20260729_chatdrift",
      clientTurnId: "turn_20260729_chatdrift001",
      conversationEventId: "evt_20260729_chatdrift",
      candidateIndex: 1
    }, new AbortController().signal, () => {
      checks += 1;
      if (checks === 3) throw new Error("turn changed");
    });
    expect(result).toMatchObject({ status: "failed" });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(service.pendingStagedReviews({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_drift0123456789a",
      activeVaultId: "vault_20260729_chatdrift"
    })).toMatchObject({ status: "ready", staged: [] });
  });

  it("stages and installs one complete reviewed ZIP bundle atomically", async () => {
    const root = createRoot();
    const selectedPath = path.join(root, "local-skill.zip");
    fs.writeFileSync(selectedPath, await createZip([
      ["bundle/SKILL.md", skillMarkdown({ id: "zip-review" })],
      ["bundle/references/guide.md", "# Guide\nUse local evidence.\n"],
      ["bundle/references/config.json", "{\"safe\":true}\n"]
    ]), { mode: 0o600 });
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry });
    const request = { apiVersion: 1 as const, requestId: "skillreq_zip0123456789abcd", activeVaultId: "vault_20260728_zipskill" };
    const staged = await service.stageFromZip(request, selectedPath);
    expect(staged).toMatchObject({ ...request, status: "ready", staged: {
      id: "zip-review",
      files: [{ relativePath: "references/config.json" }, { relativePath: "references/guide.md" }, { relativePath: "SKILL.md" }]
    } });
    if (staged.status !== "ready") throw new Error("Expected ZIP stage.");
    expect(JSON.stringify(staged)).not.toContain(selectedPath);
    expect(service.installStaged({
      apiVersion: 1,
      requestId: request.requestId,
      stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256,
      bundleSha256: staged.staged.bundleSha256,
      expectedRegistryRevision: staged.staged.registryRevision,
      enabled: true
    })).toMatchObject({ status: "committed", registry: { skills: [{ id: "zip-review" }] } });
    expect(fs.readFileSync(path.join(root, "skills", "installed", "zip-review", "references", "guide.md"), "utf8"))
      .toBe("# Guide\nUse local evidence.\n");
    expect(fs.existsSync(path.join(root, "skills", "staging", staged.staged.stagingId))).toBe(false);
  });

  it("stages one exact local Markdown file without projecting its path or remote update authority", async () => {
    const root = createRoot();
    const selectedPath = path.join(root, "local-skill.md");
    fs.writeFileSync(selectedPath, skillMarkdown(), { encoding: "utf8", mode: 0o600 });
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry });
    const request = {
      apiVersion: 1 as const,
      requestId: "skillreq_local0123456789ab",
      activeVaultId: "vault_20260728_localskill"
    };
    const staged = await service.stageFromMarkdown(request, selectedPath);
    expect(staged).toMatchObject({ ...request, status: "ready", staged: { id: "paper-reading", warnings: [] } });
    expect(JSON.stringify(staged)).not.toContain(selectedPath);
    expect(JSON.stringify(staged)).not.toContain("sourceUrl");
    if (staged.status !== "ready") throw new Error("Expected local Markdown stage.");
    expect(service.installStaged({
      apiVersion: 1, requestId: request.requestId, stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256, bundleSha256: staged.staged.bundleSha256,
      expectedRegistryRevision: staged.staged.registryRevision, enabled: true
    })).toMatchObject({ status: "committed", registry: { skills: [{ id: "paper-reading", canUpdate: false }] } });

    const linkedPath = path.join(root, "linked.md");
    fs.symlinkSync(selectedPath, linkedPath);
    expect(await service.stageFromMarkdown({ ...request, requestId: "skillreq_unsafe0123456789a" }, linkedPath))
      .toMatchObject({ status: "failed" });
  });

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
      bundleSha256: staged.staged.bundleSha256,
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

  it("stages strict External/Web manifests from every existing source and installs them disabled without effects", async () => {
    const root = createRoot();
    const sentinel = path.join(root, "effect-sentinel.txt");
    fs.writeFileSync(sentinel, "untouched", "utf8");
    const remoteSource = externalSkillMarkdown({ sourceUrl: "https://example.com/SKILL.md" });
    const fetchSnapshot = vi.fn(async () => snapshot(remoteSource));
    const registry = new SkillRegistryService(root);
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    const staged = await service.stageFromUrl({
      apiVersion: 1,
      requestId: "skillreq_external0123456789",
      sourceUrl: "https://example.com/SKILL.md"
    });
    expect(staged).toMatchObject({ status: "ready", staged: {
      id: "web-research",
      kind: "external_web",
      source: "https",
      sourceUrl: "https://example.com/SKILL.md",
      capabilities: ["external_network", "use_brokered_credential"],
      dataBoundaries: ["network", "brokered_credential"],
      files: [{ relativePath: "SKILL.md" }],
      warnings: ["untrusted_remote_source"]
    } });
    if (staged.status !== "ready") throw new Error("Expected External/Web stage.");
    const install = {
      apiVersion: 1 as const,
      requestId: "skillreq_externalinstall0123",
      stagingId: staged.staged.stagingId,
      manifestSha256: staged.staged.manifestSha256,
      bundleSha256: staged.staged.bundleSha256,
      expectedRegistryRevision: staged.staged.registryRevision
    };
    expect(service.installStaged({ ...install, enabled: true })).toMatchObject({ status: "failed" });
    const committed = service.installStaged({ ...install, enabled: false });
    expect(committed).toMatchObject({ status: "committed", registry: {
      skills: [{
        id: "web-research",
        kind: "external_web",
        enabled: false,
        canEnable: false,
        source: "https",
        sourceUrl: "https://example.com/SKILL.md",
        manifestSha256: staged.staged.manifestSha256,
        bundleSha256: staged.staged.bundleSha256,
        files: staged.staged.files,
        warnings: ["untrusted_remote_source"]
      }]
    } });
    expect(registry.enable({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_external0123456789",
      activeVaultId: "vault_20260729_externalstage",
      skillId: "web-research",
      expectedRegistryRevision: 1
    })).toMatchObject({ status: "not_found", registry: { skills: [{ id: "web-research", canEnable: false }] } });
    expect(new SkillRegistryService(root).summary()).toEqual(registry.summary());
    expect(fs.readFileSync(sentinel, "utf8")).toBe("untouched");
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    for (const source of ["local_markdown", "local_zip"] as const) {
      const localRoot = createRoot();
      const localService = new SkillUrlInstallService({ appDataRoot: localRoot, registry: new SkillRegistryService(localRoot) });
      const request = {
        apiVersion: 1 as const,
        requestId: source === "local_markdown" ? "skillreq_externalmarkdown01" : "skillreq_externalzip000001",
        activeVaultId: "vault_20260729_externalstage"
      };
      const localManifest = externalSkillMarkdown();
      const result = source === "local_markdown"
        ? await (async () => {
          const selected = path.join(localRoot, "external.md");
          fs.writeFileSync(selected, localManifest, "utf8");
          return await localService.stageFromMarkdown(request, selected);
        })()
        : await (async () => {
          const selected = path.join(localRoot, "external.zip");
          fs.writeFileSync(selected, await createZip([
            ["skill/SKILL.md", localManifest],
            ["skill/references/policy.json", "{\"mode\":\"reviewed\"}\n"]
          ]));
          return await localService.stageFromZip(request, selected);
        })();
      expect(result).toMatchObject({ status: "ready", staged: {
        kind: "external_web", source, dataBoundaries: ["network", "brokered_credential"]
      } });
    }
  });

  it("rejects ambiguous External/Web authority before staging", async () => {
    const root = createRoot();
    const fetchSnapshot = vi.fn(async () => snapshot(externalSkillMarkdown({
      dataBoundary: ["local"],
      sourceUrl: "https://example.com/SKILL.md"
    })));
    const service = new SkillUrlInstallService({
      appDataRoot: root,
      registry: new SkillRegistryService(root),
      fetcher: { fetchSnapshot }
    });
    expect(await service.stageFromUrl({
      apiVersion: 1,
      requestId: "skillreq_externalinvalid0123",
      sourceUrl: "https://example.com/SKILL.md"
    })).toMatchObject({ status: "invalid", reason: "manifest_invalid" });
    expect(fs.readdirSync(path.join(root, "skills", "staging"))).toEqual([]);
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
      bundleSha256: initialStage.staged.bundleSha256,
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
      bundleSha256: staged.staged.bundleSha256,
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
      manifestSha256: first.staged.manifestSha256, bundleSha256: first.staged.bundleSha256,
      expectedRegistryRevision: 0, enabled: true
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
      bundleSha256: update.staged.bundleSha256,
      expectedRegistryRevision: update.staged.registryRevision,
      enabled: true
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(path.join(root, "skills", "installed", "paper-reading", "SKILL.md"), "utf8")).toBe(initial);
  });

  it("returns stale instead of current when registry authority changes during an unchanged fetch", async () => {
    const root = createRoot();
    const initial = skillMarkdown({ version: "1", updatedAt: "2026-07-27T10:00:00.000Z", sourceUrl: "https://example.com/SKILL.md" });
    const registry = new SkillRegistryService(root);
    const fetchSnapshot = vi.fn().mockResolvedValueOnce(snapshot(initial));
    const service = new SkillUrlInstallService({ appDataRoot: root, registry, fetcher: { fetchSnapshot } });
    const first = await service.stageFromUrl({ apiVersion: 1, requestId, sourceUrl: "https://example.com/SKILL.md" });
    if (first.status !== "ready") throw new Error("Expected initial stage.");
    service.installStaged({
      apiVersion: 1, requestId, stagingId: first.staged.stagingId,
      manifestSha256: first.staged.manifestSha256, bundleSha256: first.staged.bundleSha256,
      expectedRegistryRevision: 0, enabled: true
    });
    fetchSnapshot.mockImplementationOnce(async () => {
      expect(registry.disable({ apiVersion: 1, skillId: "paper-reading", expectedRevision: 1 }))
        .toMatchObject({ status: "committed" });
      return snapshot(initial);
    });
    expect(await service.stageUpdate({
      apiVersion: 1,
      requestId: "skill_lifecycle_request_updatecurrent012345",
      activeVaultId: "vault_20260728_skillupdate",
      skillId: "paper-reading",
      expectedRegistryRevision: 1
    })).toMatchObject({ status: "stale", registry: { revision: 2 } });
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
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-skill-url-install-")));
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

function externalSkillMarkdown(overrides: {
  readonly sourceUrl?: string;
  readonly dataBoundary?: readonly string[];
} = {}): string {
  return [
    "---",
    "id: web-research",
    "name: Web Research",
    "version: 1",
    "description: Review public sources with declared capabilities.",
    "scope: machine_local",
    "kind: external_web",
    ...(overrides.sourceUrl ? [`sourceUrl: ${overrides.sourceUrl}`] : []),
    "capabilities:",
    "  - external_network",
    "  - use_brokered_credential",
    `dataBoundary: [${(overrides.dataBoundary ?? ["network", "brokered_credential"]).join(", ")}]`,
    "---",
    "",
    "## Procedure",
    "",
    "Use only reviewed runtime capabilities after installation."
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
