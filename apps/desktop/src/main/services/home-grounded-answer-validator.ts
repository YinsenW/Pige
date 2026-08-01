import type { AgentAnswerCitation, AgentTurnAnswer, AgentSubmitTurnRequest } from "@pige/contracts";

const CITATION_REF = /\bcitation_[1-9][0-9]*\b/gu;

const INSUFFICIENT_EVIDENCE: Readonly<Record<AgentSubmitTurnRequest["locale"], string>> = Object.freeze({
  en: "I couldn't verify an answer from the selected local evidence.",
  de: "Ich konnte anhand der ausgewählten lokalen Belege keine Antwort verifizieren.",
  fr: "Je n’ai pas pu vérifier de réponse à partir des éléments locaux sélectionnés.",
  ja: "選択されたローカル根拠から回答を確認できませんでした。",
  ko: "선택한 로컬 근거로 답변을 확인할 수 없었습니다.",
  "zh-Hans": "我无法根据所选本地证据验证答案。"
});

export interface HomeGroundedAnswerInput {
  readonly assistantText: string;
  readonly availableCitations: readonly AgentAnswerCitation[];
  readonly groundingRequired: boolean;
  readonly locale: AgentSubmitTurnRequest["locale"];
}

export interface HomeGroundedAnswerProjection {
  readonly answer: string;
  readonly grounding: AgentTurnAnswer["grounding"];
  readonly citations: readonly AgentAnswerCitation[];
}

/**
 * Projects Pi-owned final prose without adding a terminal tool or repair turn.
 * General prose remains Pi-owned when retrieval was optional. Exact source/current-note/
 * Dataset turns require a Host-owned ref, while unknown refs always collapse to an honest
 * insufficient-evidence result instead of becoming a fabricated citation.
 */
export function validateHomeGroundedAnswer(input: HomeGroundedAnswerInput): HomeGroundedAnswerProjection {
  const available = new Map(input.availableCitations.map((citation) => [citation.refId, citation]));
  const explicitRefs = Array.from(new Set(input.assistantText.match(CITATION_REF) ?? []));
  const hasUnknownRef = explicitRefs.some((ref) => !available.has(ref));

  if (hasUnknownRef || (input.groundingRequired && explicitRefs.length === 0)) {
    return insufficient(input.locale);
  }
  if (explicitRefs.length === 0) {
    return Object.freeze({ answer: input.assistantText, grounding: "general", citations: Object.freeze([]) });
  }

  const citations = input.availableCitations.filter((citation) => explicitRefs.includes(citation.refId));
  if (citations.length === 0) return insufficient(input.locale);
  return Object.freeze({
    answer: input.assistantText,
    grounding: "local_knowledge",
    citations: Object.freeze([...citations])
  });
}

function insufficient(locale: AgentSubmitTurnRequest["locale"]): HomeGroundedAnswerProjection {
  return Object.freeze({
    answer: INSUFFICIENT_EVIDENCE[locale],
    grounding: "insufficient_evidence",
    citations: Object.freeze([])
  });
}
