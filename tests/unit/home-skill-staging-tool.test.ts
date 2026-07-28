import { describe, expect, it, vi } from "vitest";
import {
  HOME_STAGE_SUBMITTED_SKILL_URL_TOOL_NAME,
  HomeSkillStagingToolService,
  extractSubmittedSkillInstallUrls
} from "../../apps/desktop/src/main/services/home-skill-staging-tool";

const manifestSha256 = `sha256:${"a".repeat(64)}` as const;
const bundleSha256 = `sha256:${"b".repeat(64)}` as const;

describe("HomeSkillStagingToolService", () => {
  it("stages one exact Host-parsed submitted HTTPS candidate without installing it", async () => {
    const stageFromChatUrl = vi.fn(async (request) => ({
      status: "ready" as const,
      requestId: request.requestId,
      staged: stagedSummary(request.sourceUrl)
    }));
    const assertCurrent = vi.fn();
    const service = new HomeSkillStagingToolService({ stageFromChatUrl });
    const tools = service.toolsForTurn({
      activeVaultId: "vault_20260729_skillchat",
      jobId: "job_20260729_skillchat",
      clientTurnId: "turn_20260729_skillchat001",
      conversationEventId: "evt_20260729_skillchat",
      authoredText: "Please stage https://example.com/SKILL.md for review.",
      assertCurrent
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe(HOME_STAGE_SUBMITTED_SKILL_URL_TOOL_NAME);
    const context = { toolCallId: "call_chat_skill_1", signal: new AbortController().signal };
    expect(tools[0]!.authorize?.({ candidateIndex: 1 }, context)).toBe(true);
    const result = await tools[0]!.execute({ candidateIndex: 1 }, context.signal, context);

    expect(result.details).toMatchObject({ staged: { id: "paper-reading", sourceUrl: "https://example.com/SKILL.md" } });
    expect(stageFromChatUrl).toHaveBeenCalledTimes(1);
    expect(stageFromChatUrl).toHaveBeenCalledWith(
      expect.objectContaining({ apiVersion: 1, sourceUrl: "https://example.com/SKILL.md" }),
      expect.objectContaining({ candidateIndex: 1, jobId: "job_20260729_skillchat" }),
      context.signal,
      assertCurrent
    );
    expect(JSON.stringify(result)).not.toContain("SKILL body");
  });

  it("omits invalid candidates and rejects invented or changed selections before staging", async () => {
    const stageFromChatUrl = vi.fn();
    const service = new HomeSkillStagingToolService({ stageFromChatUrl });
    expect(service.toolsForTurn({
      activeVaultId: "vault_20260729_skillnone",
      jobId: "job_20260729_skillnone",
      clientTurnId: "turn_20260729_skillnone001",
      conversationEventId: "evt_20260729_skillnone",
      authoredText: "Review http://example.com/SKILL.md and https://example.com/SKILL.md?token=secret",
      assertCurrent: () => undefined
    })).toEqual([]);

    const tools = service.toolsForTurn({
      activeVaultId: "vault_20260729_skillguard",
      jobId: "job_20260729_skillguard",
      clientTurnId: "turn_20260729_skillguard01",
      conversationEventId: "evt_20260729_skillguard",
      authoredText: "Review https://one.example/SKILL.md and https://two.example/SKILL.md",
      assertCurrent: () => undefined
    });
    const context = { toolCallId: "call_chat_skill_guard", signal: new AbortController().signal };
    expect(() => tools[0]!.authorize?.({ candidateIndex: 3 }, context)).toThrow();
    expect(tools[0]!.authorize?.({ candidateIndex: 1 }, context)).toBe(true);
    await expect(tools[0]!.execute({ candidateIndex: 2 }, context.signal, context)).rejects.toThrow();
    expect(stageFromChatUrl).not.toHaveBeenCalled();
  });

  it("extracts only unique strict HTTPS Skill install URLs in submitted order", () => {
    expect(extractSubmittedSkillInstallUrls(
      "https://one.example/SKILL.md, https://one.example/SKILL.md https://two.example/SKILL.md."
    )).toEqual(["https://one.example/SKILL.md", "https://two.example/SKILL.md"]);
  });
});

function stagedSummary(sourceUrl: string) {
  return {
    stagingId: "skillstage_0123456789abcdef0123456789abcdef",
    manifestSha256,
    bundleSha256,
    registryRevision: 0,
    expiresAt: "2026-07-30T00:00:00.000Z",
    sourceUrl,
    id: "paper-reading",
    name: "Paper Reading",
    version: "1",
    description: "Review papers safely.",
    scope: "machine_local" as const,
    kind: "pure" as const,
    capabilities: ["read_current_source" as const],
    dataBoundaries: ["local" as const],
    files: [{ relativePath: "SKILL.md", utf8ByteSize: 256, sha256: manifestSha256 }],
    warnings: ["untrusted_remote_source" as const]
  };
}
