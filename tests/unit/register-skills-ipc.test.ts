import { describe, expect, it, vi } from "vitest";
import { registerSkillsIpc } from "../../apps/desktop/src/main/register-skills-ipc";

const requestId = "skillreq_0123456789abcdef";
const stagingId = "skillstage_0123456789abcdef0123456789abcdef";
const manifestSha256 = `sha256:${"a".repeat(64)}`;
const bundleSha256 = manifestSha256;
const lifecycleRequestId = "skill_lifecycle_request_0123456789abcdef";
const activeVaultId = "vault_20260728_skillipc";

function register(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (_event: unknown, request?: unknown) => unknown>();
  const publishRegistryChanged = vi.fn();
  const exportSkill = vi.fn((request) => ({
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    skillId: request.skillId,
    registryRevision: 2,
    status: "exported" as const
  }));
  registerSkillsIpc({
    ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler) },
    getActiveVaultId: () => activeVaultId,
    getWindow: () => ({}) as never,
    showOpenDialog: async () => ({ canceled: false, filePaths: ["/tmp/local-SKILL.md"] }),
    showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/exported-SKILL.md" }),
    summary: () => ({ status: "ready", registry: registry(2) }),
    stageFromUrl: (request) => ({
      status: "ready",
      requestId: request.requestId,
      staged: {
        stagingId,
        manifestSha256,
        bundleSha256,
        registryRevision: 2,
        expiresAt: "2026-07-27T12:30:00.000Z",
        sourceUrl: "https://example.com/SKILL.md",
        id: "paper-reading",
        name: "Paper Reading",
        version: "1",
        description: "Create source-backed research notes.",
        scope: "machine_local",
        kind: "pure",
        capabilities: ["read_current_source"],
        dataBoundaries: ["local"],
        files: [{ relativePath: "SKILL.md", utf8ByteSize: 512, sha256: manifestSha256 }],
        warnings: ["untrusted_remote_source"]
      }
    }),
    stageFromMarkdown: (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "ready",
      staged: {
        stagingId,
        manifestSha256,
        bundleSha256,
        registryRevision: 2,
        expiresAt: "2026-07-27T12:30:00.000Z",
        id: "paper-reading",
        name: "Paper Reading",
        version: "1",
        description: "Create source-backed research notes.",
        scope: "machine_local",
        kind: "pure",
        capabilities: ["read_current_source"],
        dataBoundaries: ["local"],
        files: [{ relativePath: "SKILL.md", utf8ByteSize: 512, sha256: manifestSha256 }],
        warnings: []
      }
    }),
    stageFromZip: (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "cancelled"
    }),
    stageUpdate: (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      skillId: request.skillId,
      status: "current",
      registry: registry(2)
    }),
    installStaged: (request) => ({ status: "committed", requestId: request.requestId, registry: registry(3) }),
    discardStaged: (request) => ({ status: "discarded", requestId: request.requestId }),
    disable: () => ({ status: "committed", registry: registry(3) }),
    enable: (request) => ({
      apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
      skillId: request.skillId, status: "committed", registry: registry(3)
    }),
    uninstall: (request) => ({
      apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
      skillId: request.skillId, status: "committed", registry: registry(3)
    }),
    exportSkill,
    publishRegistryChanged,
    ...overrides
  });
  return { handlers, publishRegistryChanged, exportSkill };
}

describe("registerSkillsIpc", () => {
  it("owns the single ZIP picker and never accepts a renderer path", async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ["/tmp/review.zip"] }));
    const stageFromZip = vi.fn((request) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "cancelled" as const
    }));
    const { handlers } = register({ showOpenDialog, stageFromZip });
    const request = { apiVersion: 1 as const, requestId, activeVaultId };

    expect(await handlers.get("skills.stageFromZip")?.({ sender: {} }, request)).toEqual({ ...request, status: "cancelled" });
    expect(showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      properties: ["openFile"],
      filters: [{ name: "ZIP archive", extensions: ["zip"] }]
    }));
    expect(stageFromZip).toHaveBeenCalledWith(request, "/tmp/review.zip");
    await expect(handlers.get("skills.stageFromZip")?.({ sender: {} }, { ...request, path: "/tmp/forbidden.zip" }))
      .rejects.toThrow();
  });

  it("owns pathless local Markdown selection and fences vault identity across the dialog", async () => {
    const successful = register();
    const request = { apiVersion: 1 as const, requestId, activeVaultId };
    const result = await successful.handlers.get("skills.stageFromMarkdown")?.({ sender: {} }, request);
    expect(result).toMatchObject({ ...request, status: "ready", staged: { id: "paper-reading" } });
    expect(JSON.stringify(result)).not.toContain("/tmp/local-SKILL.md");

    const cancelledStage = vi.fn();
    const cancelled = register({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }), stageFromMarkdown: cancelledStage
    });
    expect(await cancelled.handlers.get("skills.stageFromMarkdown")?.({ sender: {} }, request))
      .toMatchObject({ status: "cancelled" });
    expect(cancelledStage).not.toHaveBeenCalled();

    let active = activeVaultId;
    const driftedStage = vi.fn();
    const drifted = register({
      getActiveVaultId: () => active,
      showOpenDialog: async () => {
        active = "vault_20260728_otherid";
        return { canceled: false, filePaths: ["/tmp/forbidden.md"] };
      },
      stageFromMarkdown: driftedStage
    });
    expect(await drifted.handlers.get("skills.stageFromMarkdown")?.({ sender: {} }, request))
      .toMatchObject({ status: "failed" });
    expect(driftedStage).not.toHaveBeenCalled();
  });

  it("parses lifecycle requests and publishes only committed registry changes", async () => {
    const { handlers, publishRegistryChanged } = register();
    const stage = await handlers.get("skills.stageFromUrl")?.({}, {
      apiVersion: 1,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    });
    expect(stage).toMatchObject({ status: "ready", requestId });

    const update = await handlers.get("skills.stageUpdate")?.({}, lifecycleRequest());
    expect(update).toMatchObject({ status: "current", requestId: lifecycleRequestId });

    const install = await handlers.get("skills.installStaged")?.({}, {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      bundleSha256,
      expectedRegistryRevision: 2,
      enabled: true
    });
    expect(install).toMatchObject({ status: "committed", requestId });
    expect(publishRegistryChanged).toHaveBeenCalledTimes(1);

    await handlers.get("skills.discardStaged")?.({}, {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      bundleSha256
    });
    expect(publishRegistryChanged).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed requests and mismatched service identities before publication", async () => {
    const { handlers, publishRegistryChanged } = register({
      stageFromUrl: () => ({ status: "invalid", requestId: "skillreq_ffffffffffffffff", reason: "manifest_invalid" })
    });
    await expect(handlers.get("skills.stageFromUrl")?.({}, {
      apiVersion: 1,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    })).rejects.toThrow("identity");
    await expect(handlers.get("skills.installStaged")?.({}, {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      bundleSha256,
      expectedRegistryRevision: 2,
      enabled: true,
      body: "forbidden"
    })).rejects.toThrow();
    expect(publishRegistryChanged).not.toHaveBeenCalled();
  });

  it("vault-fences installed lifecycle mutations and publishes only exact committed identities", async () => {
    const enable = vi.fn((request) => ({
      apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId,
      skillId: request.skillId, status: "committed" as const, registry: registry(3)
    }));
    const { handlers, publishRegistryChanged } = register({ enable });
    const request = lifecycleRequest();
    expect(await handlers.get("skills.enable")?.({}, request)).toMatchObject({ status: "committed" });
    expect(enable).toHaveBeenCalledOnce();
    expect(publishRegistryChanged).toHaveBeenCalledOnce();

    const blockedEnable = vi.fn();
    const blockedUninstall = vi.fn();
    const blockedUpdate = vi.fn();
    const changed = register({
      getActiveVaultId: () => "vault_20260728_other",
      enable: blockedEnable,
      uninstall: blockedUninstall,
      stageUpdate: blockedUpdate
    });
    expect(await changed.handlers.get("skills.uninstall")?.({}, request)).toMatchObject({ status: "failed" });
    expect(JSON.stringify(await changed.handlers.get("skills.enable")?.({}, request))).not.toContain("other");
    expect(blockedEnable).not.toHaveBeenCalled();
    expect(blockedUninstall).not.toHaveBeenCalled();
    expect(await changed.handlers.get("skills.stageUpdate")?.({}, request)).toMatchObject({ status: "failed" });
    expect(blockedUpdate).not.toHaveBeenCalled();
    expect(changed.publishRegistryChanged).not.toHaveBeenCalled();
  });

  it("owns the pathless export dialog and rechecks vault identity after await", async () => {
    const request = lifecycleRequest();
    const blockedDialog = vi.fn();
    const blocked = register({
      getActiveVaultId: () => "vault_20260728_other",
      showSaveDialog: blockedDialog
    });
    expect(await blocked.handlers.get("skills.export")?.({ sender: {} }, request))
      .toMatchObject({ status: "failed" });
    expect(blockedDialog).not.toHaveBeenCalled();
    expect(blocked.exportSkill).not.toHaveBeenCalled();

    const successful = register();
    const result = await successful.handlers.get("skills.export")?.({ sender: {} }, request);
    expect(result).toMatchObject({ status: "exported", skillId: request.skillId });
    expect(JSON.stringify(result)).not.toContain("/tmp/exported-SKILL.md");
    expect(successful.exportSkill).toHaveBeenCalledWith(request, "/tmp/exported-SKILL.md");

    const cancelled = register({ showSaveDialog: async () => ({ canceled: true }) });
    expect(await cancelled.handlers.get("skills.export")?.({ sender: {} }, request))
      .toMatchObject({ status: "cancelled" });
    expect(cancelled.exportSkill).not.toHaveBeenCalled();

    let active = activeVaultId;
    const drifted = register({
      getActiveVaultId: () => active,
      showSaveDialog: async () => {
        active = "vault_20260728_other";
        return { canceled: false, filePath: "/tmp/forbidden.md" };
      }
    });
    expect(await drifted.handlers.get("skills.export")?.({ sender: {} }, request))
      .toMatchObject({ status: "failed" });
    expect(drifted.exportSkill).not.toHaveBeenCalled();
  });
});

function registry(revision: number) {
  return { apiVersion: 1 as const, revision, invalidManifestCount: 0, skills: [] };
}

function lifecycleRequest() {
  return {
    apiVersion: 1 as const,
    requestId: lifecycleRequestId,
    activeVaultId,
    skillId: "paper-reading",
    expectedRegistryRevision: 2
  };
}
