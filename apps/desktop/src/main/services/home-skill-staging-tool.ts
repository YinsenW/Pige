import { createHash } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import { SkillInstallUrlSchema, type SkillStageFromUrlResult } from "@pige/schemas";
import { z } from "zod";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import type { SkillChatStageBinding } from "./skill-url-install-service";

export const HOME_STAGE_SUBMITTED_SKILL_URL_TOOL_NAME = "pige_stage_submitted_skill_url";

export interface HomeSkillStagingServicePort {
  stageFromChatUrl(
    request: { readonly apiVersion: 1; readonly requestId: string; readonly sourceUrl: string },
    binding: SkillChatStageBinding,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<SkillStageFromUrlResult>;
}

export interface HomeSkillStagingTurn {
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly conversationEventId: string;
  readonly authoredText: string;
  readonly assertCurrent: () => void;
}

export class HomeSkillStagingToolService {
  readonly #staging: HomeSkillStagingServicePort;

  constructor(staging: HomeSkillStagingServicePort) {
    this.#staging = staging;
  }

  toolsForTurn(turn: HomeSkillStagingTurn): readonly PigeAgentToolDefinition[] {
    const candidates = extractSubmittedSkillInstallUrls(turn.authoredText);
    if (candidates.length === 0) return [];
    const InputSchema = z.object({
      candidateIndex: z.number().int().min(1).max(candidates.length)
    }).strict();
    const authorizedCalls = new Map<string, number>();
    let selectedCandidateIndex: number | undefined;
    return [{
      name: HOME_STAGE_SUBMITTED_SKILL_URL_TOOL_NAME,
      label: "Stage submitted Skill for review",
      description: `Stage exactly one of the ${candidates.length} HTTPS Skill URL candidates explicitly submitted in this user turn. This creates a bounded review only; it never installs, enables, or grants capabilities.`,
      version: "1",
      capability: "stage_submitted_skill",
      parameters: {
        type: "object",
        properties: { candidateIndex: { type: "integer", minimum: 1, maximum: candidates.length } },
        required: ["candidateIndex"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: {
          modelText: { type: "string" },
          details: { type: "object" }
        },
        required: ["modelText", "details"],
        additionalProperties: false
      },
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: {
        resourceScope: "current_vault",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "current_vault" },
      limits: { maxInputBytes: 1_024, maxOutputBytes: 64 * 1_024, timeoutMs: 30_000 },
      ownerService: "HomeSkillStagingToolService",
      authorize: (args, context) => {
        turn.assertCurrent();
        const parsed = InputSchema.safeParse(args);
        if (!parsed.success || (selectedCandidateIndex !== undefined && selectedCandidateIndex !== parsed.data.candidateIndex)) {
          throw new PigeDomainError("agent_runtime.tool_call_invalid", "The Skill staging candidate is unavailable.");
        }
        selectedCandidateIndex ??= parsed.data.candidateIndex;
        authorizedCalls.set(context.toolCallId, parsed.data.candidateIndex);
        return true;
      },
      execute: async (args, signal, context) => {
        turn.assertCurrent();
        const parsed = InputSchema.safeParse(args);
        const authorizedCandidate = authorizedCalls.get(context.toolCallId);
        authorizedCalls.delete(context.toolCallId);
        if (!parsed.success || authorizedCandidate !== parsed.data.candidateIndex ||
          selectedCandidateIndex !== parsed.data.candidateIndex) {
          throw new PigeDomainError(
            "agent_runtime.tool_binding_changed",
            "The Skill staging candidate changed after authorization."
          );
        }
        const sourceUrl = candidates[parsed.data.candidateIndex - 1];
        if (!sourceUrl) {
          throw new PigeDomainError("agent_runtime.tool_call_invalid", "The Skill staging candidate is unavailable.");
        }
        const binding: SkillChatStageBinding = {
          activeVaultId: turn.activeVaultId,
          jobId: turn.jobId,
          clientTurnId: turn.clientTurnId,
          conversationEventId: turn.conversationEventId,
          candidateIndex: parsed.data.candidateIndex
        };
        const result = await this.#staging.stageFromChatUrl({
          apiVersion: 1,
          requestId: createChatSkillStageRequestId(binding),
          sourceUrl
        }, binding, signal, turn.assertCurrent);
        turn.assertCurrent();
        if (result.status !== "ready") {
          throw new PigeDomainError("skill.stage_unavailable", "The submitted Skill could not be staged for review.");
        }
        return createPigeTextToolResult(
          `Skill review staged for ${result.staged.name} ${result.staged.version}. The user must inspect and approve it in Settings before installation.`,
          { staged: result.staged }
        );
      }
    }];
  }
}

export function extractSubmittedSkillInstallUrls(value: string): readonly string[] {
  const candidates: string[] = [];
  for (const match of value.matchAll(/https:\/\/[^\s<>"'`]+/giu)) {
    let candidate = match[0];
    while (/[),.;\]}]$/u.test(candidate)) candidate = candidate.slice(0, -1);
    const parsed = SkillInstallUrlSchema.safeParse(candidate);
    if (parsed.success && !candidates.includes(parsed.data)) candidates.push(parsed.data);
    if (candidates.length >= 8) break;
  }
  return candidates;
}

function createChatSkillStageRequestId(binding: SkillChatStageBinding): string {
  const digest = createHash("sha256")
    .update("pige.skill.chat_stage.v1\0", "utf8")
    .update(binding.activeVaultId, "utf8")
    .update("\0", "utf8")
    .update(binding.jobId, "utf8")
    .update("\0", "utf8")
    .update(binding.clientTurnId, "utf8")
    .update("\0", "utf8")
    .update(binding.conversationEventId, "utf8")
    .update("\0", "utf8")
    .update(String(binding.candidateIndex), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `skillreq_${digest}`;
}
