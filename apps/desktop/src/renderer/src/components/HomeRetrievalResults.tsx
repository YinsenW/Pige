import type {
  AgentTurnAnswer,
  HomeAgentModelUsage,
  RetrievalAnswerCitation,
  RetrievalAskResult,
  RetrievalSearchResultItem
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export function ConversationCitations(props: {
  readonly answer: AgentTurnAnswer | undefined;
  readonly noteLoadingPageId: string | null;
  readonly onOpen: (pageId: string, query?: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const citations = props.answer?.citations.filter(
    (citation): citation is RetrievalAnswerCitation => !("kind" in citation)
  ) ?? [];
  if (citations.length === 0) return null;
  return (
    <div className="citation-list conversation-citations" aria-label={props.t("retrieval.citations")}>
      {citations.map((citation) => (
        <button
          type="button"
          className="citation-row"
          key={citation.refId}
          disabled={props.noteLoadingPageId === citation.pageId}
          onClick={() => void props.onOpen(citation.pageId, props.answer?.retrieval?.query)}
        >
          <span className="citation-index" aria-hidden="true">{citation.label}</span>
          <span className="citation-copy">
            <strong>{citation.title}</strong>
            <span>{props.t(`library.type.${citation.pageType}`)}</span>
          </span>
          <PigeIcon name="expand" size={13} />
        </button>
      ))}
    </div>
  );
}

export function RetrievalResults(props: {
  readonly result: RetrievalAskResult;
  readonly modelUsage: HomeAgentModelUsage;
  readonly noteLoadingPageId: string | null;
  readonly onOpen: (pageId: string, query: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="retrieval-results" aria-label={props.t("retrieval.results")}>
      <section className="retrieval-answer" aria-label={props.t("retrieval.summary")}>
        <p className="retrieval-eyebrow">{props.t("retrieval.summary")}</p>
        <p className="retrieval-answer-text">{props.result.answer}</p>
        {props.result.warnings.includes("insufficient_evidence") ? (
          <p className="muted retrieval-warning">{props.t("retrieval.insufficientEvidence")}</p>
        ) : null}
        {props.result.citations.length > 0 ? (
          <div className="retrieval-citations" aria-label={props.t("retrieval.citations")}>
            {props.result.citations.map((citation) => (
              <button
                type="button"
                className="ghost"
                key={citation.refId}
                disabled={props.noteLoadingPageId === citation.pageId}
                onClick={() => void props.onOpen(citation.pageId, props.result.query)}
              >
                {citation.label} {citation.title}
              </button>
            ))}
          </div>
        ) : null}
        {props.result.warnings.includes("limited_evidence") ? (
          <p className="muted retrieval-warning">{props.t("retrieval.limitedEvidence")}</p>
        ) : null}
        {props.result.degraded ? (
          <p className="muted retrieval-warning">{props.t("retrieval.degraded")}</p>
        ) : null}
      </section>
      <header className="retrieval-header">
        <div>
          <h2>{props.t("retrieval.results")}</h2>
          <p className="muted">
            {props.t(props.result.answerMode === "model_grounded" ? "retrieval.modelGrounded" : "retrieval.localOnly")} · {props.t("retrieval.total")}: {props.result.total}
          </p>
          {props.modelUsage === "cloud" ? (
            <p className="muted retrieval-cloud-boundary">{props.t("retrieval.cloudSent")}</p>
          ) : null}
        </div>
      </header>
      {props.result.results.length === 0 ? (
        <p className="library-empty">{props.t("retrieval.empty")}</p>
      ) : (
        <div className="retrieval-list">
          {props.result.results.map((item) => (
            <RetrievalResultRow
              key={item.summary.pageId}
              item={item}
              loading={props.noteLoadingPageId === item.summary.pageId}
              citationLabel={props.result.citations.find((citation) => citation.pageId === item.summary.pageId)?.label}
              onOpen={(pageId) => props.onOpen(pageId, props.result.query)}
              t={props.t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function toRetrievalAskResult(answer: AgentTurnAnswer): RetrievalAskResult {
  if (!answer.retrieval) throw new Error("Agent retrieval metadata is unavailable.");
  const citations = answer.citations.filter(
    (citation): citation is RetrievalAnswerCitation => !("kind" in citation)
  );
  return {
    ...answer.retrieval,
    answeredAt: new Date().toISOString(),
    answer: answer.answer,
    answerMode: "model_grounded",
    confidence: answer.grounding === "insufficient_evidence"
      ? "insufficient"
      : citations.length > 1 ? "grounded" : "limited",
    citations,
    warnings: answer.grounding === "insufficient_evidence"
      ? ["insufficient_evidence"]
      : [
          ...(citations.length === 1 ? ["limited_evidence" as const] : []),
          ...(answer.retrieval.degraded ? ["search_degraded" as const] : [])
        ]
  };
}

function RetrievalResultRow(props: {
  readonly item: RetrievalSearchResultItem;
  readonly loading: boolean;
  readonly citationLabel: string | undefined;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <article className="retrieval-row">
      <div className="retrieval-row-main">
        <strong>{props.item.summary.title}</strong>
        <span>{props.item.snippets[0] ?? props.item.summary.pagePath}</span>
      </div>
      <div className="retrieval-row-meta">
        {props.citationLabel ? <span>{props.citationLabel}</span> : null}
        <span>{props.t(`library.type.${props.item.summary.pageType}`)}</span>
        <button type="button" className="ghost" disabled={props.loading} onClick={() => void props.onOpen(props.item.summary.pageId)}>
          {props.loading ? props.t("note.opening") : props.t("note.open")}
        </button>
      </div>
    </article>
  );
}
