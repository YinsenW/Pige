import { createHash } from "node:crypto";
import type { RetrievalAnswerCitation, RetrievalSearchRequest, RetrievalSearchResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { AgentSubmitTurnRequest } from "@pige/schemas";
import type { CurrentNoteEvidenceBinding } from "./retrieval-evidence-boundary";
import { buildHomeQueryContextPack } from "./retrieval-service";
import { createPigeTextToolResult, type PigeAgentToolDefinition } from "./pi-agent-runtime-adapter";

export const HOME_FIND_RELATED_NOTES_TOOL_NAME = "pige_find_related_notes";
const UNTRUSTED_EVIDENCE_START = "<PIGE_UNTRUSTED_EVIDENCE_V1>";
const UNTRUSTED_EVIDENCE_END = "</PIGE_UNTRUSTED_EVIDENCE_V1>";

export interface NoteAgentContextPack {
  readonly pack: {
    readonly schemaVersion: 1;
    readonly contextPackId: string;
    readonly workflow: "note_agent";
    readonly budgetClass: "note_agent";
    readonly retrievalScope: {
      readonly kind: "current_note";
      readonly pageId: string;
    };
    readonly evidenceRefs: readonly {
      readonly refId: "note_evidence_1";
      readonly kind: "markdown_page" | "source_page";
      readonly pageId: string;
      readonly locator: string;
      readonly citationRefs: readonly ["citation_1"];
      readonly budgetTokens: number;
      readonly trust: "vault_knowledge";
    }[];
    readonly omitted: readonly {
      readonly reason: "current_note_model_budget";
      readonly count: 1;
    }[];
    readonly warnings: readonly {
      readonly code: "current_note_truncated";
    }[];
  };
  readonly modelText: string;
  readonly modelSuppliedRange: CurrentNoteEvidenceBinding["modelSuppliedRange"];
  readonly citation?: RetrievalAnswerCitation;
}

export function buildNoteAgentContextPack(binding: CurrentNoteEvidenceBinding): NoteAgentContextPack {
  const hasEvidence = binding.modelText.trim().length > 0;
  const contextPackId = `context_${createHash("sha256")
    .update(JSON.stringify({
      workflow: "note_agent",
      scope: binding.page.pageId,
      bindingHash: binding.bindingHash,
      modelSuppliedRange: binding.modelSuppliedRange
    }))
    .digest("hex")
    .slice(0, 16)}`;
  const evidenceKind = binding.page.pageType === "source" ? "source_page" : "markdown_page";
  const citation: RetrievalAnswerCitation | undefined = hasEvidence
    ? {
        refId: "citation_1",
        label: "[1]",
        pageId: binding.page.pageId,
        title: binding.page.title,
        pageType: binding.page.pageType,
        locator: binding.durableBodyRange.locator
      }
    : undefined;
  return {
    pack: {
      schemaVersion: 1,
      contextPackId,
      workflow: "note_agent",
      budgetClass: "note_agent",
      retrievalScope: { kind: "current_note", pageId: binding.page.pageId },
      evidenceRefs: citation
        ? [{
            refId: "note_evidence_1",
            kind: evidenceKind,
            pageId: binding.page.pageId,
            locator: binding.durableBodyRange.locator,
            citationRefs: ["citation_1"],
            budgetTokens: Math.max(1, Math.ceil(Array.from(binding.modelText).length / 4)),
            trust: "vault_knowledge"
          }]
        : [],
      omitted: binding.modelSuppliedRange.truncated
        ? [{ reason: "current_note_model_budget", count: 1 }]
        : [],
      warnings: binding.modelSuppliedRange.truncated
        ? [{ code: "current_note_truncated" }]
        : []
    },
    modelText: binding.modelText,
    modelSuppliedRange: binding.modelSuppliedRange,
    ...(citation ? { citation } : {})
  };
}

export function createCurrentNoteRelatedTool(options: {
  readonly authorize: () => void;
  readonly readCurrent: () => CurrentNoteEvidenceBinding;
  readonly search: (request: RetrievalSearchRequest) => RetrievalSearchResult | Promise<RetrievalSearchResult>;
  readonly readExact: (result: RetrievalSearchResult) => { readonly items: RetrievalSearchResult["results"] };
  readonly onResult: (result: RetrievalSearchResult) => void | Promise<void>;
  readonly activeVaultId: string;
  readonly currentPageId: string;
}): PigeAgentToolDefinition {
  return {
    name: HOME_FIND_RELATED_NOTES_TOOL_NAME,
    label: "Find related notes",
    description: "After reading the exact current note, search the active vault for bounded related-note evidence. The Host derives the query and excludes the current note.",
    version: "1",
    capability: "read_current_vault_knowledge",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { status: { type: "string" }, evidence: { type: "array" }, total: { type: "number" }, degraded: { type: "boolean" } },
      required: ["status", "evidence", "total", "degraded"],
      additionalProperties: false
    },
    effect: "read_only",
    inputTrust: "model_generated",
    outputTrust: "untrusted_source",
    dataBoundary: { resourceScope: "current_vault", pathAuthority: "host_only", sourceIdAuthority: "host_only", modelAuthority: "none" },
    execution: "sequential",
    idempotency: { mode: "idempotent", scope: "current_note" },
    limits: { maxInputBytes: 2, maxOutputBytes: 64 * 1_024, timeoutMs: 30_000 },
    ownerService: "HomeAgentService",
    authorize: () => { options.authorize(); return true; },
    execute: async () => {
      options.authorize();
      const current = options.readCurrent();
      const query = Array.from(`${current.page.title}\n${current.modelText}`.normalize("NFKC").replace(/\s+/gu, " ").trim())
        .slice(0, 320).join("");
      if (!query) throw new PigeDomainError("rag.search_not_found", "The current note has no searchable text.");
      const result = await options.search({ scope: { kind: "active_vault", vaultId: options.activeVaultId }, query, limit: 8 });
      if (result.activeVaultId !== options.activeVaultId || result.query !== query) {
        throw new PigeDomainError("rag.search_binding_invalid", "The related-note search binding changed.");
      }
      const items = options.readExact(result).items.filter((item) => item.summary.pageId !== options.currentPageId);
      const filtered = { ...result, total: Math.max(items.length, result.total - (result.results.some((item) => item.summary.pageId === options.currentPageId) ? 1 : 0)), results: items };
      await options.onResult(filtered);
      const selected = buildHomeQueryContextPack(filtered).selectedEvidence.map(({ item, citation }, index) => ({
        citationRef: `citation_${index + 2}`,
        title: item.summary.title,
        pageType: item.summary.pageType,
        locator: citation.locator,
        snippet: item.snippets[0] ?? ""
      }));
      const modelText = `${UNTRUSTED_EVIDENCE_START}\n${JSON.stringify({
        status: selected.length > 0 ? "evidence_found" : "insufficient_evidence",
        evidence: selected,
        total: filtered.total,
        degraded: filtered.degraded
      }).replaceAll("<", "&lt;").replaceAll(">", "&gt;")}\n${UNTRUSTED_EVIDENCE_END}`;
      return createPigeTextToolResult(modelText, {
        resultCount: selected.length,
        invalidPageCount: filtered.invalidPageCount,
        degraded: filtered.degraded
      });
    }
  };
}

export function hasExplicitCurrentNoteRelatedIntent(text: string, locale: AgentSubmitTurnRequest["locale"]): boolean {
  const normalized = text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || /^[>"'`]|^```/u.test(normalized)) return false;
  return ({
    en: /^(?:please )?(?:find|show|search for) (?:the )?(?:related|similar|linked) notes?\b|^(?:please )?(?:find|show) (?:the )?backlinks?\b/iu,
    de: /^(?:bitte )?(?:finde|zeige|suche) (?:verwandte|ähnliche|verknüpfte) notizen\b|^(?:bitte )?(?:finde|zeige) rückverweise\b/iu,
    fr: /^(?:veuillez )?(?:trouve|montre|recherche) (?:les )?notes? (?:liées|similaires|associées)\b|^(?:veuillez )?(?:trouve|montre) (?:les )?rétroliens\b/iu,
    ja: /^(?:この|現在の)ノート(?:に)?(?:関連する|似た|リンクされた)ノート(?:を)?(?:探|表示)|^バックリンク(?:を)?(?:探|表示)/u,
    ko: /^(?:이|현재) 노트(?:와|에)? (?:관련된|비슷한|연결된) 노트를? (?:찾|보여)|^백링크를? (?:찾|보여)/u,
    "zh-Hans": /^(?:请)?(?:查找|寻找|显示|搜索)(?:与)?(?:当前|这篇|这个)笔记(?:相关|相似|关联)的?笔记|^(?:请)?(?:查找|显示)反向链接/u
  } satisfies Record<AgentSubmitTurnRequest["locale"], RegExp>)[locale].test(normalized);
}
