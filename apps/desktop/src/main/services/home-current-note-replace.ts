import { z } from "zod";
import { PigeDomainError } from "@pige/domain";
import type { AgentSubmitTurnRequest, JobRecord } from "@pige/schemas";
import type { JobExecutionFactsPatch } from "./job-execution-coordinator";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import type {
  HomeAgentCurrentNoteAppendPublication,
  HomeAgentCurrentNoteAppendPublicationPort
} from "./agent-turn-publication";

export const HOME_REPLACE_CURRENT_NOTE_TOOL_NAME = "pige_replace_current_note";

export interface HomeAgentCurrentNoteMutationPort extends HomeAgentCurrentNoteAppendPublicationPort {
  publish(input: {
    readonly vaultPath: string;
    readonly activeVaultId: string;
    readonly job: JobRecord;
    readonly inspection: {
      readonly pageId: string;
      readonly contentHash: string;
      readonly bindingHash: string;
      readonly evidenceRefs: readonly ["citation_1"];
    };
    readonly modelProfileId: string;
    readonly markdown: string;
  }): HomeAgentCurrentNoteAppendPublication;
  publishReplace?(input: {
    readonly vaultPath: string;
    readonly activeVaultId: string;
    readonly job: JobRecord;
    readonly inspection: {
      readonly pageId: string;
      readonly contentHash: string;
      readonly bindingHash: string;
      readonly evidenceRefs: readonly ["citation_1"];
    };
    readonly modelProfileId: string;
    readonly markdown: string;
  }): HomeAgentCurrentNoteAppendPublication;
}

export function publishHomeCurrentNoteReplacement(input: {
  readonly port: { readonly publishReplace: NonNullable<HomeAgentCurrentNoteMutationPort["publishReplace"]> };
  readonly jobs: {
    readAgentTurnJob(jobId: string): JobRecord | undefined;
    patchAgentTurnJob(job: JobRecord, facts: JobExecutionFactsPatch): JobRecord;
  };
  readonly session: { current: JobRecord };
  readonly vaultPath: string;
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly pageId: string;
  readonly contentHash: string;
  readonly bindingHash: string;
  readonly modelProfileId: string;
  readonly markdown: string;
  readonly signal?: AbortSignal;
  readonly priorPublication?: HomeAgentCurrentNoteAppendPublication;
}): HomeAgentCurrentNoteAppendPublication {
  if (input.signal?.aborted) {
    throw new PigeDomainError("agent_runtime.turn_cancelled", "The current-note replacement Job was cancelled before publication.");
  }
  const currentJob = input.jobs.readAgentTurnJob(input.jobId);
  if (!currentJob || currentJob.state !== "running" || currentJob.activeVaultId !== input.activeVaultId) {
    throw new PigeDomainError("agent_runtime.turn_conflict", "The current-note replacement Job is no longer the exact running turn.");
  }
  input.session.current = currentJob;
  const publication = input.port.publishReplace({
    vaultPath: input.vaultPath,
    activeVaultId: input.activeVaultId,
    job: currentJob,
    inspection: {
      pageId: input.pageId,
      contentHash: input.contentHash,
      bindingHash: input.bindingHash,
      evidenceRefs: ["citation_1"]
    },
    modelProfileId: input.modelProfileId,
    markdown: input.markdown
  });
  if (input.priorPublication && JSON.stringify(input.priorPublication) !== JSON.stringify(publication)) {
    throw new PigeDomainError("agent_runtime.tool_input_invalid", "One current-note turn cannot publish two replacement intents.");
  }
  if (!hasHomeCurrentNotePublicationRef(currentJob, publication)) {
    try {
      input.session.current = input.jobs.patchAgentTurnJob(currentJob, homeCurrentNotePublicationFacts(currentJob, publication));
    } catch (caught) {
      input.session.current = input.jobs.readAgentTurnJob(input.jobId) ?? currentJob;
      if (!hasHomeCurrentNotePublicationRef(input.session.current, publication)) throw caught;
    }
  }
  return publication;
}

export function createCurrentNoteReplaceTool(input: {
  readonly authorize: () => void;
  readonly publish: (markdown: string) => HomeAgentCurrentNoteAppendPublication;
}): PigeAgentToolDefinition {
  const InputSchema = z.object({ markdown: z.string().min(1).max(16 * 1024) }).strict();
  const parse = (args: unknown): z.infer<typeof InputSchema> => {
    const parsed = InputSchema.safeParse(args);
    if (!parsed.success) throw new PigeDomainError("agent_runtime.tool_input_invalid", "The current-note replacement tool input is invalid.");
    return parsed.data;
  };
  return {
    name: HOME_REPLACE_CURRENT_NOTE_TOOL_NAME,
    label: "Replace current note",
    description: "Stage one bounded whole-note Markdown replacement for the exact inspected current note. The Host always requires bounded review before applying it.",
    version: "1",
    capability: "write_vault_knowledge",
    parameters: {
      type: "object",
      properties: { markdown: { type: "string", minLength: 1, maxLength: 16 * 1024 } },
      required: ["markdown"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["review_required"] } },
      required: ["status"],
      additionalProperties: false
    },
    effect: "idempotent_write",
    inputTrust: "model_generated",
    outputTrust: "host_validated",
    dataBoundary: { resourceScope: "current_note", pathAuthority: "host_only", sourceIdAuthority: "host_only", modelAuthority: "none" },
    execution: "sequential",
    idempotency: { mode: "idempotent", scope: "current_note" },
    limits: { maxInputBytes: 20 * 1024, maxOutputBytes: 1_024, timeoutMs: 30_000 },
    ownerService: "CurrentNoteReplaceService",
    authorize: (args) => { input.authorize(); parse(args); return true; },
    execute: async (args) => {
      input.authorize();
      const publication = input.publish(parse(args).markdown);
      if (publication.status !== "review_required") throw new PigeDomainError("agent_runtime.turn_conflict", "A whole-note replacement must enter bounded review.");
      return createPigeTextToolResult("review_required: The exact current-note replacement was staged for bounded review.", { status: "review_required" });
    }
  };
}

export function hasExplicitCurrentNoteReplaceIntent(text: string, locale: AgentSubmitTurnRequest["locale"]): boolean {
  const normalized = text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || /^[>"'`]|^```/u.test(normalized)) return false;
  const patterns: Record<AgentSubmitTurnRequest["locale"], RegExp> = {
    en: /^(?:please )?(?:replace|rewrite|overwrite) (?:the )?(?:current|this) note\b/iu,
    de: /^(?:bitte )?(?:ersetze|überschreibe|schreibe) (?:die )?(?:aktuelle|diese) notiz\b/iu,
    fr: /^(?:veuillez )?(?:remplace|réécris|réécrire) (?:la )?(?:note actuelle|cette note)\b/iu,
    ja: /^(?:現在の|この)ノート(?:を)?(?:置き換え|書き換え|全面的に書き直し)/u,
    ko: /^(?:현재|이) 노트를? (?:교체|바꿔|다시 작성|덮어)/u,
    "zh-Hans": /^(?:请)?(?:替换|重写|改写|覆盖)(?:当前|这篇|这个)笔记/u
  };
  return patterns[locale].test(normalized);
}

export function hasHomeCurrentNotePublicationRef(job: JobRecord, publication: HomeAgentCurrentNoteAppendPublication): boolean {
  return publication.status === "applied"
    ? job.operationIds?.includes(publication.operationId) === true
    : job.proposalIds?.includes(publication.proposalId) === true;
}

export function homeCurrentNotePublicationFacts(job: JobRecord, publication: HomeAgentCurrentNoteAppendPublication): JobExecutionFactsPatch {
  const outputRefs = [...(job.outputRefs ?? [])];
  if (publication.status === "applied") {
    if (!outputRefs.some((ref) => ref.kind === "operation" && ref.id === publication.operationId)) {
      outputRefs.push({ kind: "operation", id: publication.operationId, role: "current_note_replace_operation" });
    }
    return { outputRefs, operationIds: Array.from(new Set([...(job.operationIds ?? []), publication.operationId])) };
  }
  if (!outputRefs.some((ref) => ref.kind === "proposal" && ref.id === publication.proposalId)) {
    outputRefs.push({ kind: "proposal", id: publication.proposalId, role: "awaiting_review" });
  }
  return { outputRefs, proposalIds: Array.from(new Set([...(job.proposalIds ?? []), publication.proposalId])) };
}
