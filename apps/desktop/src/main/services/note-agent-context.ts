import { createHash } from "node:crypto";
import type { RetrievalAnswerCitation } from "@pige/contracts";
import type { CurrentNoteEvidenceBinding } from "./retrieval-evidence-boundary";

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
  const hasEvidence = binding.modelText.length > 0;
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
