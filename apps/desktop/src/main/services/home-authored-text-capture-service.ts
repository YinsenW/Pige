import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type JobRecord } from "@pige/schemas";
import { z } from "zod";
import type { CaptureService } from "./capture-service";
import { SourcePageService } from "./source-page-service";
import type { JobExecutionFactsPatch } from "./job-execution-coordinator";
import { MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES } from "./pi-agent-tool-boundary";
import {
  createPigeTextToolResult,
  type PigeAgentToolCallContext,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";

export const HOME_CAPTURE_AUTHORED_TEXT_TOOL_NAME = "pige_capture_authored_text";

export interface AuthoredTextProvenance {
  readonly conversationId: string;
  readonly userEventId: string;
  readonly toolCallId: string;
  readonly policyHash: string;
  readonly authoredTextDigest: string;
}

export function authoredTextSourceIdentity(
  provenance: AuthoredTextProvenance | undefined,
  sourceId: string,
  checksumValue: string
) {
  if (provenance && (
    !/^conv_\d{8}(?:_[a-z0-9]{4,})?$/u.test(provenance.conversationId) ||
    !/^evt_\d{8}_[a-z0-9]{8,}$/u.test(provenance.userEventId) ||
    provenance.toolCallId.trim().length === 0 ||
    Buffer.byteLength(provenance.toolCallId, "utf8") > MAX_PIGE_TOOL_CALL_ID_UTF8_BYTES ||
    !/^sha256:[a-f0-9]{64}$/u.test(provenance.policyHash) ||
    provenance.authoredTextDigest !== checksumValue
  )) throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The authored-text preservation provenance is invalid.");
  return {
    inputKind: provenance ? "typed_text" as const : "file_picker" as const,
    uri: `pige://${provenance ? "authored" : "pasted"}-text/${sourceId}`,
    displayName: provenance ? "Authored text" : "Pasted text",
    metadata: provenance ? {
      agentTurnConversationId: provenance.conversationId,
      agentTurnUserEventId: provenance.userEventId,
      agentTurnToolCallId: provenance.toolCallId,
      agentTurnPolicyHash: provenance.policyHash,
      agentTurnAuthoredTextDigest: provenance.authoredTextDigest
    } : {}
  };
}

export function authoredTextMetadataMatches(
  metadata: Record<string, unknown>,
  provenance: AuthoredTextProvenance | undefined
): boolean {
  return provenance === undefined || (
    metadata.agentTurnConversationId === provenance.conversationId &&
    metadata.agentTurnUserEventId === provenance.userEventId &&
    metadata.agentTurnToolCallId === provenance.toolCallId &&
    metadata.agentTurnPolicyHash === provenance.policyHash &&
    metadata.agentTurnAuthoredTextDigest === provenance.authoredTextDigest
  );
}

export interface HomeAuthoredTextCaptureJobPort {
  readAgentTurnJob(jobId: string): JobRecord | undefined;
  patchAgentTurnJob(expected: JobRecord, facts: JobExecutionFactsPatch): JobRecord;
}

export interface HomeAuthoredTextCaptureRequest {
  readonly vaultPath: string;
  readonly activeVaultId: string;
  readonly conversationId: string;
  readonly userEventId: string;
  readonly turnJobId: string;
  readonly policyHash: string;
  readonly authoredText: string;
  readonly locale: "en" | "de" | "fr" | "ja" | "ko" | "zh-Hans";
  readonly toolCallId: string;
  readonly assertCurrent: () => void;
}

export interface HomeAuthoredTextCaptureResult {
  readonly sourceId: string;
  readonly pageId: string;
  readonly captureId: string;
}

export class HomeAuthoredTextCaptureService {
  readonly #capture: CaptureService;
  readonly #jobs: HomeAuthoredTextCaptureJobPort;
  readonly #sourcePages: SourcePageService;

  constructor(
    capture: CaptureService,
    jobs: HomeAuthoredTextCaptureJobPort,
    sourcePages = new SourcePageService()
  ) {
    this.#capture = capture;
    this.#jobs = jobs;
    this.#sourcePages = sourcePages;
  }

  capture(request: HomeAuthoredTextCaptureRequest): HomeAuthoredTextCaptureResult {
    request.assertCurrent();
    const job = this.#requireBoundJob(request);
    const authoredTextDigest = checksum(request.authoredText);
    const sourceId = `src_${request.turnJobId.slice(4)}`;
    const attachmentSetHash = checksum([
      request.activeVaultId,
      request.conversationId,
      request.userEventId,
      request.turnJobId,
      request.policyHash,
      authoredTextDigest
    ].join("\n"));
    const preserved = this.#capture.preserveTextForAgentTurn({
      text: request.authoredText,
      locale: request.locale
    }, {
      jobId: request.turnJobId,
      sourceId,
      inputChecksum: authoredTextDigest,
      ordinal: 0,
      attachmentSetHash,
      authoredTextProvenance: {
        conversationId: request.conversationId,
        userEventId: request.userEventId,
        toolCallId: request.toolCallId,
        policyHash: request.policyHash,
        authoredTextDigest
      }
    });
    request.assertCurrent();
    const sourceRecordPath = path.join(
      request.vaultPath,
      ".pige",
      "source-records",
      sourceId.slice(4, 8),
      sourceId.slice(8, 10),
      `${sourceId}.json`
    );
    const sourceRecord = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
    const page = this.#sourcePages.createForSource(
      request.vaultPath,
      sourceRecord,
      sourceRecordPath,
      request.turnJobId,
      sourceRecord
    );
    request.assertCurrent();
    const current = this.#requireBoundJob(request);
    this.#jobs.patchAgentTurnJob(current, {
      outputRefs: [
        {
          kind: "tool",
          id: "pige_capture_authored_text@1",
          checksum: authoredTextDigest,
          role: "authored_text_capture_tool"
        },
        { kind: "source", id: sourceId, checksum: authoredTextDigest, role: "authored_text_source" },
        { kind: "page", id: page.pageId, locator: page.pagePath, role: "authored_text_source_page" }
      ],
      message: "The explicitly authored text was preserved as exact local evidence."
    });
    return { sourceId, pageId: page.pageId, captureId: preserved.captureId };
  }

  toolForTurn(options: {
    readonly enabled: boolean;
    readonly request: Omit<HomeAuthoredTextCaptureRequest, "toolCallId">;
    readonly onCaptured: (result: HomeAuthoredTextCaptureResult) => void;
  }): PigeAgentToolDefinition | undefined {
    if (!options.enabled || !hasExplicitAuthoredTextCaptureIntent(options.request.authoredText)) return undefined;
    return createCaptureAuthoredTextTool({
      authorize: options.request.assertCurrent,
      capture: (context) => {
        const result = this.capture({ ...options.request, toolCallId: context.toolCallId });
        options.onCaptured(result);
        return result;
      }
    });
  }

  #requireBoundJob(request: HomeAuthoredTextCaptureRequest): JobRecord {
    const job = this.#jobs.readAgentTurnJob(request.turnJobId);
    const userRef = job?.inputRefs?.find((ref) => ref.role === "agent_turn_user_event");
    if (
      !job ||
      job.class !== "agent_turn" ||
      job.state !== "running" ||
      job.activeVaultId !== request.activeVaultId ||
      job.conversationEventId !== request.userEventId ||
      job.policyHash !== request.policyHash ||
      userRef?.id !== request.userEventId ||
      !userRef.locator?.endsWith(`/${request.conversationId}.jsonl`)
    ) {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The authored-text capture no longer matches the active Agent turn."
      );
    }
    return job;
  }
}

export function hasExplicitAuthoredTextCaptureIntent(text: string): boolean {
  const normalized = text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return AUTHORED_TEXT_CAPTURE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function createCaptureAuthoredTextTool(options: {
  readonly authorize: () => void;
  readonly capture: (context: PigeAgentToolCallContext) => Pick<HomeAuthoredTextCaptureResult, "sourceId" | "pageId">;
}): PigeAgentToolDefinition {
  const InputSchema = z.object({}).strict();
  const assertInput = (args: unknown): void => {
    options.authorize();
    if (!InputSchema.safeParse(args).success) {
      throw new PigeDomainError("agent_runtime.tool_input_invalid", "The authored-text capture input is invalid.");
    }
  };
  return {
    name: HOME_CAPTURE_AUTHORED_TEXT_TOOL_NAME,
    label: "Capture authored text",
    description: "Preserve the exact current user-authored text as one local source. Use only when the user explicitly asks to save, capture, or preserve this text.",
    version: "1",
    capability: "write_vault_knowledge",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["captured"] },
        sourceRef: { type: "string", pattern: "^src_[0-9]{8}_[a-z0-9]{8,}$" },
        pageRef: { type: "string", pattern: "^page_[a-z0-9_]{8,}$" }
      },
      required: ["status", "sourceRef", "pageRef"],
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
    idempotency: { mode: "idempotent", scope: "tool_call" },
    limits: { maxInputBytes: 256, maxOutputBytes: 512, timeoutMs: 30_000 },
    ownerService: "HomeAuthoredTextCaptureService",
    authorize: (args) => {
      assertInput(args);
      return true;
    },
    execute: async (args, _signal, context) => {
      assertInput(args);
      const captured = options.capture(context);
      return createPigeTextToolResult(
        `Captured the exact authored text as ${captured.sourceId} with source page ${captured.pageId}.`,
        { status: "captured", sourceRef: captured.sourceId, pageRef: captured.pageId }
      );
    }
  };
}

const AUTHORED_TEXT_CAPTURE_INTENT_PATTERNS = [
  /^(?:please\s+)?(?:save|capture|preserve)\s+(?:this|the)\s+(?:(?:short|typed|authored|local|exact)\s+){0,4}(?:text|note|source|evidence)\b/u,
  /^(?:bitte\s+)?(?:speichere|erfasse|bewahre)\s+(?:diesen|diese|den)\s+(?:text|notiz|quelle)\b/u,
  /^(?:veuillez\s+|s'il vous plaît\s+)?(?:enregistre|capture|conserve)\s+(?:ce|cette)\s+(?:texte|note|source)\b/u,
  /^(?:この|次の)(?:テキスト|文章|メモ|内容)(?:を)?(?:保存|記録)/u,
  /^(?:이|다음)\s*(?:텍스트|문장|메모|내용)(?:을|를)?\s*(?:저장|기록)/u,
  /^(?:请)?(?:保存|记录|收录)(?:这|以下|下面)(?:段|份)?(?:文本|文字|笔记|内容|资料)/u
] as const;

function checksum(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
