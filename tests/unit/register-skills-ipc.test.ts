import { describe, expect, it, vi } from "vitest";
import { registerSkillsIpc } from "../../apps/desktop/src/main/register-skills-ipc";

const requestId = "skillreq_0123456789abcdef";
const stagingId = "skillstage_0123456789abcdef0123456789abcdef";
const manifestSha256 = `sha256:${"a".repeat(64)}`;

function register(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (_event: unknown, request?: unknown) => unknown>();
  const publishRegistryChanged = vi.fn();
  registerSkillsIpc({
    ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler) },
    summary: () => ({ status: "ready", registry: registry(2) }),
    stageFromUrl: (request) => ({
      status: "ready",
      requestId: request.requestId,
      staged: {
        stagingId,
        manifestSha256,
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
    installStaged: (request) => ({ status: "committed", requestId: request.requestId, registry: registry(3) }),
    discardStaged: (request) => ({ status: "discarded", requestId: request.requestId }),
    disable: () => ({ status: "committed", registry: registry(3) }),
    publishRegistryChanged,
    ...overrides
  });
  return { handlers, publishRegistryChanged };
}

describe("registerSkillsIpc", () => {
  it("parses lifecycle requests and publishes only committed registry changes", async () => {
    const { handlers, publishRegistryChanged } = register();
    const stage = await handlers.get("skills.stageFromUrl")?.({}, {
      apiVersion: 1,
      requestId,
      sourceUrl: "https://example.com/SKILL.md"
    });
    expect(stage).toMatchObject({ status: "ready", requestId });

    const install = await handlers.get("skills.installStaged")?.({}, {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256,
      expectedRegistryRevision: 2,
      enabled: true
    });
    expect(install).toMatchObject({ status: "committed", requestId });
    expect(publishRegistryChanged).toHaveBeenCalledTimes(1);

    await handlers.get("skills.discardStaged")?.({}, {
      apiVersion: 1,
      requestId,
      stagingId,
      manifestSha256
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
      expectedRegistryRevision: 2,
      enabled: true,
      body: "forbidden"
    })).rejects.toThrow();
    expect(publishRegistryChanged).not.toHaveBeenCalled();
  });
});

function registry(revision: number) {
  return { apiVersion: 1 as const, revision, invalidManifestCount: 0, skills: [] };
}
